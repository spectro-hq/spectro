import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ConsoleShell } from './console-shell.js';
import { CommittedInput, readSessionToken, writeSessionToken } from './console-shared.js';
import { hostedConsole } from './auth-client.js';
import {
  EventDetail,
  eventTypeLabels,
  formatTimelineTimestamp,
  formatTimestamp,
  type DetailTab,
} from './event-detail.js';
import {
  EventQueryError,
  isEventName,
  isEventType,
  type EventListItem,
  type ExplorerSearch,
} from './event-query.js';
import { createIllustrativePage } from './illustrative-events.js';
import { fetchObservation, type ObservationResult } from './live-query.js';
import {
  emptyArrivalBuffer,
  observeArrivals,
  revealArrivals,
  observationFrom,
  LIVE_INTERVAL_MS,
  LIVE_OVERLAP_MS,
} from './live-observation.js';
import { SpectroIcon } from './spectro-icons.js';

export function LiveExplorer() {
  const search = useSearch({ from: '/live' });
  const navigate = useNavigate({ from: '/live' });
  const scopeKey = JSON.stringify([
    search.organization,
    search.project,
    search.environment,
    search.source,
    search.type,
    search.name,
    search.sessionId,
  ]);
  return (
    <ConsoleShell title="Live" search={search}>
      <LiveObservation
        key={scopeKey}
        search={search}
        updateSearch={(patch) =>
          void navigate({ search: (previous) => ({ ...previous, ...patch }) })
        }
      />
    </ConsoleShell>
  );
}

function LiveObservation({
  search,
  updateSearch,
}: {
  readonly search: ExplorerSearch;
  readonly updateSearch: (patch: Partial<ExplorerSearch>) => void;
}) {
  const [token, setToken] = useState(readSessionToken);
  const [tokenDraft, setTokenDraft] = useState('');
  const [buffer, setBuffer] = useState(emptyArrivalBuffer);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(paused);
  const [selected, setSelected] = useState<EventListItem>();
  const [tab, setTab] = useState<DetailTab>('event');
  const [visible, setVisible] = useState(() => document.visibilityState !== 'hidden');
  const [gap, setGap] = useState(false);
  const [accessBlocked, setAccessBlocked] = useState(false);
  const last = useRef<number | undefined>(undefined);
  const lastSuccess = useRef<number | undefined>(undefined);
  const failures = useRef(0);
  const [demoAnchor] = useState(() => Date.now());
  const queryClient = useQueryClient();
  const queryKey = useMemo(
    () => [
      'live-observation',
      search.organization,
      search.project,
      search.environment,
      search.source,
      search.type,
      search.name,
      search.sessionId,
    ],
    [
      search.organization,
      search.project,
      search.environment,
      search.source,
      search.type,
      search.name,
      search.sessionId,
    ],
  );
  const query = useQuery<ObservationResult>({
    queryKey,
    gcTime: 0,
    staleTime: 0,
    retry: false,
    enabled: visible && !accessBlocked && (search.source === 'illustrative' || token.length > 0),
    refetchInterval: (q) =>
      search.source === 'illustrative' ||
      accessBlocked ||
      (q.state.error instanceof EventQueryError && [400, 401, 403].includes(q.state.error.status))
        ? false
        : Math.min(30_000, LIVE_INTERVAL_MS * 2 ** Math.min(failures.current, 4)),
    queryFn: async ({ signal }): Promise<ObservationResult> => {
      if (search.source === 'illustrative') {
        const page = createIllustrativePage(demoAnchor, search.project, search.environment);
        return {
          data: page.data.filter(
            (item) =>
              (!search.type || item.event.type === search.type) &&
              (!search.name || item.event.name === search.name) &&
              (!search.sessionId || item.event.context.session?.id === search.sessionId),
          ),
          observedAt: demoAnchor,
          truncated: false,
        };
      }
      const now = Date.now();
      const interrupted =
        lastSuccess.current !== undefined && now - lastSuccess.current > LIVE_OVERLAP_MS;
      if (interrupted) setGap(true);
      const from = interrupted ? undefined : observationFrom(last.current, last.current ?? now);
      try {
        const result = await fetchObservation({
          search,
          token,
          ...(from === undefined ? {} : { from }),
          signal,
        });
        last.current = result.observedAt;
        lastSuccess.current = Date.now();
        failures.current = 0;
        return result;
      } catch (error) {
        if (!signal.aborted) failures.current++;
        throw error;
      }
    },
  });
  const denied =
    accessBlocked ||
    (query.error instanceof EventQueryError && [401, 403].includes(query.error.status));
  const invalidQuery = query.error instanceof EventQueryError && query.error.status === 400;
  useEffect(() => {
    const change = (): void => {
      const next = document.visibilityState !== 'hidden';
      setVisible(next);
      if (!next) void queryClient.cancelQueries({ queryKey, exact: true });
    };
    document.addEventListener('visibilitychange', change);
    return () => document.removeEventListener('visibilitychange', change);
  }, [queryClient, queryKey]);
  useEffect(() => {
    const data = query.data;
    if (!data) return;
    setBuffer((state) => {
      if (search.source !== 'illustrative')
        return observeArrivals(state, data.data, data.observedAt, pausedRef.current);
      // Static preview groups demonstrate discovery order without simulating a live connection.
      let next = state;
      for (let index = data.data.length - 1; index >= 0; index -= 3) {
        const start = Math.max(0, index - 2);
        next = observeArrivals(
          next,
          data.data.slice(start, index + 1),
          data.observedAt - Math.floor(start / 3) * LIVE_INTERVAL_MS,
          pausedRef.current,
        );
      }
      return next;
    });
    setSelected((current) => current ?? data.data[0]);
  }, [query.data, search.source]);
  useEffect(() => {
    if (!denied || accessBlocked) return;
    /* oxlint-disable react/set-state-in-effect -- Clear retained snapshots when the external authorization boundary rejects access. */
    setAccessBlocked(true);
    setBuffer(emptyArrivalBuffer());
    setSelected(undefined);
    queryClient.removeQueries({ queryKey, exact: true });
    /* oxlint-enable react/set-state-in-effect */
  }, [denied, accessBlocked, queryClient, queryKey]);

  const groups = new Map<number, typeof buffer.displayed>();
  for (const row of buffer.displayed)
    groups.set(row.observedAt, [...(groups.get(row.observedAt) ?? []), row]);
  const status = denied
    ? 'Access unavailable'
    : !visible
      ? 'Observation suspended'
      : query.isError
        ? invalidQuery
          ? 'Check observation filters'
          : 'Reconnecting'
        : paused
          ? 'Reading paused'
          : query.data
            ? 'Observing'
            : 'Connecting';
  const reveal = (): void => {
    setBuffer(revealArrivals);
    pausedRef.current = false;
    setPaused(false);
  };
  const historySearch = {
    project: search.project,
    environment: search.environment,
    range: '24h',
    source: search.source,
    ...(search.organization ? { organization: search.organization } : {}),
    ...(search.type ? { type: search.type } : {}),
    ...(search.name ? { name: search.name } : {}),
    ...(search.sessionId ? { sessionId: search.sessionId } : {}),
  } as const;
  return (
    <main className="event-workspace live-workspace">
      <section className="command-deck" aria-labelledby="live-title">
        <div className="workspace-title">
          <h1 id="live-title">Live</h1>
          <span>Observe new events as they become available</span>
        </div>
        <label className="control-field project-field" htmlFor="live-project">
          <span>Project</span>
          <CommittedInput
            id="live-project"
            ariaLabel="Project ID"
            value={search.project}
            validate={(value) => /^prj_[A-Za-z0-9_-]{1,120}$/.test(value)}
            onCommit={(project) => updateSearch({ project })}
          />
        </label>
        <label className="control-field" htmlFor="live-environment">
          <span>Environment</span>
          <CommittedInput
            id="live-environment"
            ariaLabel="Environment"
            value={search.environment}
            validate={(value) => value.length > 0 && value.length <= 64}
            onCommit={(environment) => updateSearch({ environment })}
          />
        </label>
        {search.source === 'illustrative' ? (
          <span className="live-demo-note">Illustrative preview</span>
        ) : null}
      </section>
      {!hostedConsole && token.length === 0 && search.source !== 'illustrative' ? (
        <section className="connection-panel">
          <div>
            <h2>Local query connection</h2>
            <p>Use the local Console read token to observe real events.</p>
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const next = tokenDraft.trim();
              if (next) {
                writeSessionToken(next);
                setToken(next);
                setTokenDraft('');
                updateSearch({ source: 'live' });
              }
            }}
          >
            <label>
              Local bearer token
              <input
                aria-label="Local bearer token"
                type="password"
                autoComplete="off"
                value={tokenDraft}
                onChange={(event) => setTokenDraft(event.currentTarget.value)}
              />
            </label>
            <button className="primary-button" disabled={!tokenDraft.trim()}>
              Connect
            </button>
          </form>
        </section>
      ) : null}
      <section className="live-toolbar" aria-label="Live observation controls">
        <output className="live-status">
          <span
            className={`status-light ${query.data && visible && !query.isError && !denied && search.source !== 'illustrative' ? 'live' : ''}`}
            aria-hidden="true"
          />
          {search.source === 'illustrative' ? 'Preview' : status}
        </output>
        <span className="live-cadence">
          {search.source === 'illustrative'
            ? 'Sample events · no live connection'
            : 'Updates about every 3 seconds'}
        </span>
        <button
          className="connection-button"
          type="button"
          disabled={denied}
          onClick={() => {
            if (paused) reveal();
            else {
              pausedRef.current = true;
              setPaused(true);
            }
          }}
          aria-pressed={paused}
        >
          <svg
            viewBox="0 0 20 20"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            {paused ? <path d="m7 4 9 6-9 6Z" /> : <path d="M7 4v12M13 4v12" />}
          </svg>
          {paused ? 'Resume' : 'Pause'}
        </button>
        <label className="release-filter">
          <select
            aria-label="Event type"
            value={search.type ?? ''}
            onChange={(event) =>
              updateSearch({
                type: isEventType(event.currentTarget.value)
                  ? event.currentTarget.value
                  : undefined,
              })
            }
          >
            <option value="">All event types</option>
            {Object.entries(eventTypeLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="search-field" htmlFor="live-name">
          <SpectroIcon name="search" size={16} />
          <CommittedInput
            id="live-name"
            ariaLabel="Exact event name"
            placeholder="Exact event name · Enter to apply"
            value={search.name ?? ''}
            validate={(value) => !value || isEventName(value)}
            onCommit={(name) => updateSearch({ name: name || undefined })}
          />
        </label>
        <label className="search-field" htmlFor="live-session">
          <SpectroIcon name="search" size={16} />
          <CommittedInput
            id="live-session"
            ariaLabel="Session ID"
            placeholder="Session ID · Enter to apply"
            value={search.sessionId ?? ''}
            validate={(value) => value.length <= 128}
            onCommit={(sessionId) => updateSearch({ sessionId: sessionId || undefined })}
          />
        </label>
        {search.type || search.name || search.sessionId ? (
          <button
            className="clear-button"
            onClick={() => updateSearch({ type: undefined, name: undefined, sessionId: undefined })}
          >
            Clear
          </button>
        ) : null}
      </section>
      {query.isError || denied ? (
        <div className="live-notice" role="alert">
          {denied
            ? 'Your session expired or access changed. Sign in again to continue.'
            : invalidQuery
              ? 'The observation request is invalid. Check the project, environment, and filters, then retry. Automatic updates are stopped.'
              : 'Observation could not be updated. Retrying automatically; the displayed events remain available.'}
          {denied && hostedConsole ? (
            <a href="/v1/auth/login">Sign in</a>
          ) : (
            <button
              className="clear-button"
              onClick={() => {
                setAccessBlocked(false);
                void query.refetch();
              }}
            >
              Retry now
            </button>
          )}
        </div>
      ) : null}
      {gap || buffer.evicted > 0 || query.data?.truncated ? (
        <output className="live-notice">
          {gap
            ? 'Observation restarted after an interruption. Some arrivals may have been missed. '
            : ''}
          {buffer.evicted > 0
            ? `${buffer.evicted} events were removed by the observation buffer limit. `
            : ''}
          {query.data?.truncated
            ? 'This update reached its load limit. Some arrivals were not loaded. '
            : ''}
          <Link to="/" search={historySearch}>
            Inspect Events history
          </Link>
        </output>
      ) : null}
      <div className="live-bench">
        <section className="live-ledger" aria-labelledby="live-arrivals-title">
          <header className="panel-heading">
            <h2 id="live-arrivals-title">New arrivals</h2>
            {paused ? (
              <button
                className="live-new-events"
                disabled={buffer.pending.length === 0}
                onClick={reveal}
              >
                Show {buffer.pending.length} new events
              </button>
            ) : (
              <output>{buffer.displayed.length} observed</output>
            )}
          </header>
          {query.isLoading ? (
            <div className="ledger-state loading-state">
              <span className="loading-line" />
              <span className="loading-line" />
              <p>Starting observation…</p>
            </div>
          ) : null}
          {!query.isLoading && buffer.displayed.length === 0 ? (
            <div className="ledger-state empty-state">
              <SpectroIcon name="live" size={26} />
              <strong>
                {denied ? 'Observation requires access.' : 'Waiting for matching events.'}
              </strong>
              <p>
                {search.source === 'illustrative'
                  ? 'Clear a filter to see the sample events.'
                  : 'Send an event from your connected app, or clear a filter.'}
              </p>
              <Link to="/" search={historySearch}>
                Open Events
              </Link>
            </div>
          ) : null}
          {[...groups].map(([observedAt, rows]) => (
            <section
              className="live-arrival-group"
              key={observedAt}
              aria-label={`Observed ${formatTimelineTimestamp(observedAt)}`}
            >
              <h3>
                Observed {formatTimelineTimestamp(observedAt)} <span>· {rows.length} events</span>
              </h3>
              {rows.map(({ item }) => (
                <button
                  key={item.event.id}
                  className={`live-event-row ${selected?.event.id === item.event.id ? 'selected' : ''}`}
                  aria-pressed={selected?.event.id === item.event.id}
                  onClick={() => setSelected(item)}
                >
                  <time
                    title="Event occurrence time"
                    dateTime={new Date(item.event.timestamp).toISOString()}
                  >
                    {formatTimestamp(item.event.timestamp)}
                  </time>
                  <span className={`event-dot ${item.event.type}`} aria-hidden="true" />
                  <strong>{item.event.name}</strong>
                  <span className={`live-type ${item.event.type}`}>
                    {eventTypeLabels[item.event.type]}
                  </span>
                  <span title={item.event.context.session?.id}>
                    {item.event.context.session?.id ?? 'No session'}
                  </span>
                  <span title={item.event.context.page?.path}>
                    {item.event.context.page?.path ?? 'No page'}
                  </span>
                </button>
              ))}
            </section>
          ))}
        </section>
        <EventDetail
          event={denied ? undefined : selected}
          search={search}
          tab={tab}
          onTabChange={setTab}
          showProcessingTime
        />
      </div>
    </main>
  );
}
