import { QueryClient, QueryClientProvider, useInfiniteQuery } from '@tanstack/react-query';
import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { StrictMode, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';

import {
  fetchEventPage,
  isEventName,
  isEventType,
  isTimeRange,
  parseExplorerSearch,
  TIME_RANGES,
  type EventListItem,
  type EventListPage,
  type ExplorerSearch,
} from './event-query.js';
import { createIllustrativePage } from './illustrative-events.js';
import './styles.css';

type IconName =
  | 'activity'
  | 'book'
  | 'calendar'
  | 'chevron'
  | 'database'
  | 'filter'
  | 'pulse'
  | 'refresh'
  | 'search'
  | 'settings';

function Icon({ name, size = 18 }: { readonly name: IconName; readonly size?: number }) {
  const paths: Record<IconName, ReactNode> = {
    activity: <path d="M3 12h3l2.2-6 3.7 12 2.5-7H21" />,
    book: (
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H11v17H6.5A2.5 2.5 0 0 0 4 22Zm16 0A2.5 2.5 0 0 0 17.5 3H13v17h4.5A2.5 2.5 0 0 1 20 22Z" />
    ),
    calendar: (
      <path d="M7 2v3m10-3v3M3 9h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" />
    ),
    chevron: <path d="m8 10 4 4 4-4" />,
    database: (
      <path d="M4 6c0-2 3.6-3 8-3s8 1 8 3-3.6 3-8 3-8-1-8-3Zm0 0v6c0 2 3.6 3 8 3s8-1 8-3V6M4 12v6c0 2 3.6 3 8 3s8-1 8-3v-6" />
    ),
    filter: <path d="M3 5h18l-7 8v5l-4 2v-7Z" />,
    pulse: <path d="M4 12a8 8 0 0 1 16 0m-13 0a5 5 0 0 1 10 0m-7 0a2 2 0 1 1 4 0" />,
    refresh: <path d="M20 6v5h-5M4 18v-5h5m10-3a8 8 0 0 0-13.7-3L4 8m16 8-1.3 1A8 8 0 0 1 5 14" />,
    search: <path d="m21 21-4.35-4.35M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z" />,
    settings: (
      <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm7.4-3.5 1.3-1-2-3.5-1.6.7a7 7 0 0 0-1.3-.8L15.6 5h-4l-.2 1.7a7 7 0 0 0-1.5.8l-1.6-.7-2 3.5 1.3 1a7 7 0 0 0 0 1.7l-1.3 1 2 3.5 1.6-.7a7 7 0 0 0 1.5.8l.2 1.7h4l.2-1.7a7 7 0 0 0 1.3-.8l1.6.7 2-3.5-1.3-1a7 7 0 0 0 0-1Z" />
    ),
  };

  return (
    <svg
      aria-hidden="true"
      className="icon"
      fill="none"
      height={size}
      viewBox="0 0 24 24"
      width={size}
    >
      <g stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7">
        {paths[name]}
      </g>
    </svg>
  );
}

function AppFrame() {
  return <Outlet />;
}

const rootRoute = createRootRoute({ component: AppFrame });
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  validateSearch: parseExplorerSearch,
  component: EventExplorer,
});
const routeTree = rootRoute.addChildren([indexRoute]);
const router = createRouter({ routeTree });
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 15_000,
      refetchOnWindowFocus: false,
    },
  },
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

const eventTypeLabels = {
  session: 'Session',
  page: 'Page',
  error: 'Error',
  performance: 'Performance',
  network: 'Network',
  interaction: 'Interaction',
  custom: 'Custom',
} as const;

type DetailTab = 'event' | 'context' | 'raw';

const rulerBinIds = Array.from({ length: 40 }, (_, index) => `time-bin-${index + 1}`);

function CommittedInput({
  ariaLabel,
  id,
  onCommit,
  pattern,
  placeholder,
  title,
  validate,
  value,
}: {
  readonly ariaLabel: string;
  readonly id: string;
  readonly onCommit: (value: string) => void;
  readonly pattern?: string;
  readonly placeholder?: string;
  readonly title?: string;
  readonly validate: (value: string) => boolean;
  readonly value: string;
}) {
  const [draft, setDraft] = useState(value);
  const valid = validate(draft);

  const commit = (): void => {
    if (valid && draft !== value) onCommit(draft);
  };

  return (
    <input
      aria-invalid={!valid}
      aria-label={ariaLabel}
      id={id}
      pattern={pattern}
      placeholder={placeholder}
      spellCheck="false"
      title={title}
      value={draft}
      onBlur={commit}
      onChange={(event) => setDraft(event.currentTarget.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
      }}
    />
  );
}

function formatTimestamp(timestamp: number): string {
  return new Intl.DateTimeFormat('en', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
    hour12: false,
  }).format(timestamp);
}

function formatDateTime(timestamp: number): string {
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(timestamp);
}

function formatValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null) return 'null';
  return JSON.stringify(value) ?? 'undefined';
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function eventSummary(item: EventListItem): string {
  const payload = item.event.payload;
  if (item.event.type === 'error' && typeof payload.message === 'string') return payload.message;
  if (item.event.type === 'performance' && typeof payload.value === 'number') {
    return `${payload.value} ${typeof payload.unit === 'string' ? payload.unit : ''}`.trim();
  }
  if (item.event.type === 'network' && isUnknownRecord(payload.request)) {
    const request = payload.request;
    return [request.method, request.url].filter((part) => typeof part === 'string').join(' ');
  }
  return eventTypeLabels[item.event.type];
}

function filteredIllustrativePage(search: ExplorerSearch, anchor: number): EventListPage {
  const page = createIllustrativePage(anchor, search.project, search.environment);
  return {
    data: page.data.filter(({ event }) => {
      return (
        (search.type === undefined || event.type === search.type) &&
        (search.name === undefined || event.name === search.name) &&
        (search.release === undefined || event.context.release?.version === search.release) &&
        (search.sessionId === undefined || event.context.session?.id === search.sessionId) &&
        (search.pageId === undefined || event.context.page?.id === search.pageId)
      );
    }),
  };
}

function readSessionToken(): string {
  try {
    return sessionStorage.getItem('spectro.local-api-token') ?? '';
  } catch {
    return '';
  }
}

function writeSessionToken(token: string): void {
  try {
    if (token.length > 0) sessionStorage.setItem('spectro.local-api-token', token);
    else sessionStorage.removeItem('spectro.local-api-token');
  } catch {
    // The token remains in React memory when session storage is unavailable.
  }
}

function EventExplorer() {
  const search = indexRoute.useSearch();
  const navigate = indexRoute.useNavigate();
  const [token, setToken] = useState(readSessionToken);
  const [tokenDraft, setTokenDraft] = useState('');
  const [connectionOpen, setConnectionOpen] = useState(
    search.source === 'live' && token.length === 0,
  );
  const [credentialVersion, setCredentialVersion] = useState(0);
  const [queryAnchor, setQueryAnchor] = useState(() => Date.now());
  const [detailTab, setDetailTab] = useState<DetailTab>('event');
  const range = TIME_RANGES[search.range];

  const updateSearch = (patch: Partial<ExplorerSearch>): void => {
    void navigate({ search: (previous) => ({ ...previous, ...patch }) });
  };

  const updateFilter = (patch: Partial<ExplorerSearch>): void => {
    updateSearch({ ...patch, event: undefined });
  };

  const eventsQuery = useInfiniteQuery({
    queryKey: [
      'events',
      search.project,
      search.environment,
      search.range,
      search.source,
      search.type,
      search.name,
      search.release,
      search.sessionId,
      search.pageId,
      queryAnchor,
      credentialVersion,
    ],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) => {
      if (search.source === 'illustrative') {
        return filteredIllustrativePage(search, queryAnchor);
      }
      return fetchEventPage({
        query: {
          projectId: search.project,
          environment: search.environment,
          from: queryAnchor - range.milliseconds,
          to: queryAnchor,
          limit: 50,
          ...(search.type === undefined ? {} : { type: search.type }),
          ...(search.name === undefined ? {} : { name: search.name }),
          ...(search.release === undefined ? {} : { release: search.release }),
          ...(search.sessionId === undefined ? {} : { sessionId: search.sessionId }),
          ...(search.pageId === undefined ? {} : { pageId: search.pageId }),
          ...(pageParam === undefined ? {} : { cursor: pageParam }),
        },
        token,
        signal,
      });
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: search.source === 'illustrative' || token.length > 0,
  });

  const events = useMemo(
    () => eventsQuery.data?.pages.flatMap((page) => page.data) ?? [],
    [eventsQuery.data],
  );
  const selectedEvent = events.find((item) => item.event.id === search.event) ?? events[0];

  const connect = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const nextToken = tokenDraft.trim();
    if (nextToken.length === 0) return;
    setToken(nextToken);
    writeSessionToken(nextToken);
    setCredentialVersion((value) => value + 1);
    setConnectionOpen(false);
    updateSearch({ source: 'live', event: undefined });
    setQueryAnchor(Date.now());
  };

  const disconnect = (): void => {
    setToken('');
    setTokenDraft('');
    writeSessionToken('');
    setCredentialVersion((value) => value + 1);
    updateSearch({ source: 'illustrative', event: undefined });
  };

  return (
    <div className="console-shell">
      <header className="console-topbar">
        <a className="wordmark" href="/" aria-label="Spectro events">
          <span className="wordmark-mark" aria-hidden="true" />
          spectro
        </a>
        <div className="runtime-state">
          <span className={`status-light ${search.source}`} aria-hidden="true" />
          <span>{search.source === 'live' ? 'Local API connected' : 'Illustrative workspace'}</span>
        </div>
      </header>

      <aside className="console-rail" aria-label="Primary navigation">
        <nav>
          <a className="rail-link active" href="/" aria-current="page">
            <Icon name="activity" />
            <span>Events</span>
          </a>
          <span className="rail-link" aria-disabled="true" title="Coming after the event explorer">
            <Icon name="pulse" />
            <span>Live</span>
          </span>
          <span className="rail-link" aria-disabled="true" title="Coming after the event explorer">
            <Icon name="database" />
            <span>Schemas</span>
          </span>
        </nav>
        <nav className="rail-secondary" aria-label="Secondary navigation">
          <span className="rail-link" aria-disabled="true">
            <Icon name="settings" />
            <span>Settings</span>
          </span>
          <span
            className="rail-link"
            aria-disabled="true"
            title="API guide is available in the repository"
          >
            <Icon name="book" />
            <span>API guide</span>
          </span>
        </nav>
      </aside>

      <main className="event-workspace">
        <section className="command-deck" aria-labelledby="events-title">
          <div className="workspace-title">
            <h1 id="events-title">Events</h1>
            <span>{search.source === 'live' ? 'ClickHouse query' : 'Illustrative data'}</span>
          </div>

          <label className="control-field project-field" htmlFor="project-id">
            <span>Project</span>
            <CommittedInput
              ariaLabel="Project ID"
              id="project-id"
              key={`project-${search.project}`}
              value={search.project}
              validate={(value) => /^prj_[A-Za-z0-9_-]{1,120}$/.test(value)}
              onCommit={(project) => updateFilter({ project })}
            />
          </label>

          <label className="control-field" htmlFor="environment-id">
            <span>Environment</span>
            <CommittedInput
              ariaLabel="Environment"
              id="environment-id"
              key={`environment-${search.environment}`}
              value={search.environment}
              validate={(value) => value.length > 0 && value.length <= 64}
              onCommit={(environment) => updateFilter({ environment })}
            />
          </label>

          <label className="control-field select-field">
            <span>Time range</span>
            <Icon name="calendar" size={16} />
            <select
              aria-label="Time range"
              value={search.range}
              onChange={(event) => {
                const value = event.currentTarget.value;
                if (isTimeRange(value)) {
                  updateFilter({ range: value });
                  setQueryAnchor(Date.now());
                }
              }}
            >
              {Object.entries(TIME_RANGES).map(([value, option]) => (
                <option key={value} value={value}>
                  {option.label}
                </option>
              ))}
            </select>
            <Icon name="chevron" size={16} />
          </label>

          <div className="command-actions">
            <button
              className="icon-button"
              type="button"
              onClick={() => setQueryAnchor(Date.now())}
              aria-label="Refresh events"
            >
              <Icon name="refresh" />
            </button>
            <button
              className="connection-button"
              type="button"
              onClick={() => setConnectionOpen((value) => !value)}
            >
              {token.length > 0 ? 'Connection' : 'Connect API'}
            </button>
          </div>
        </section>

        {connectionOpen ? (
          <section className="connection-panel" aria-labelledby="connection-title">
            <div>
              <h2 id="connection-title">Local query connection</h2>
              <p>
                The bearer token stays in this browser tab’s session and is sent only in the
                authorization header.
              </p>
            </div>
            <form onSubmit={connect}>
              <label>
                <span>Local bearer token</span>
                <input
                  autoComplete="off"
                  name="token"
                  type="password"
                  value={tokenDraft}
                  onChange={(event) => setTokenDraft(event.currentTarget.value)}
                />
              </label>
              <button
                className="primary-button"
                type="submit"
                disabled={tokenDraft.trim().length === 0}
              >
                Query local API
              </button>
              {token.length > 0 ? (
                <button className="text-button" type="button" onClick={disconnect}>
                  Disconnect
                </button>
              ) : null}
            </form>
          </section>
        ) : null}

        {search.source === 'illustrative' ? (
          <section className="illustrative-banner" aria-live="polite">
            <span>Illustrative data</span>
            <p>These events demonstrate the explorer and are not production telemetry.</p>
            <button type="button" onClick={() => setConnectionOpen(true)}>
              Connect ClickHouse query
            </button>
          </section>
        ) : null}

        <EventRuler
          endTime={queryAnchor}
          events={events}
          selectedEvent={selectedEvent}
          rangeLabel={range.label}
        />

        <section className="filter-deck" aria-label="Event filters">
          <label className="search-field" htmlFor="event-name-filter">
            <Icon name="search" />
            <CommittedInput
              ariaLabel="Exact event name"
              id="event-name-filter"
              key={`name-${search.name ?? ''}`}
              pattern="[a-z][a-z0-9_]{0,63}"
              placeholder="Exact event name · Enter to apply"
              title="Lowercase snake_case event name"
              value={search.name ?? ''}
              validate={(value) => value.length === 0 || isEventName(value)}
              onCommit={(name) => updateFilter({ name: name || undefined })}
            />
          </label>
          <label className="select-filter">
            <span className="sr-only">Event type</span>
            <select
              value={search.type ?? ''}
              onChange={(event) => {
                const value = event.currentTarget.value;
                updateFilter({ type: isEventType(value) ? value : undefined });
              }}
            >
              <option value="">All event types</option>
              {Object.entries(eventTypeLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <Icon name="chevron" size={16} />
          </label>
          <details className="more-filters">
            <summary>
              <Icon name="filter" />
              More filters
              {[search.release, search.sessionId, search.pageId].filter(Boolean).length > 0 ? (
                <span className="filter-count">
                  {[search.release, search.sessionId, search.pageId].filter(Boolean).length}
                </span>
              ) : null}
            </summary>
            <div className="filter-popover">
              <label>
                <span>Release</span>
                <input
                  value={search.release ?? ''}
                  onChange={(event) =>
                    updateFilter({ release: event.currentTarget.value || undefined })
                  }
                />
              </label>
              <label>
                <span>Session ID</span>
                <input
                  value={search.sessionId ?? ''}
                  onChange={(event) =>
                    updateFilter({ sessionId: event.currentTarget.value || undefined })
                  }
                />
              </label>
              <label>
                <span>Page ID</span>
                <input
                  value={search.pageId ?? ''}
                  onChange={(event) =>
                    updateFilter({ pageId: event.currentTarget.value || undefined })
                  }
                />
              </label>
            </div>
          </details>
          <button
            className="clear-button"
            type="button"
            onClick={() =>
              updateSearch({
                type: undefined,
                name: undefined,
                release: undefined,
                sessionId: undefined,
                pageId: undefined,
                event: undefined,
              })
            }
          >
            Clear
          </button>
        </section>

        <div className="focus-bench">
          <EventLedger
            events={events}
            error={eventsQuery.error}
            hasNextPage={eventsQuery.hasNextPage}
            isFetchingNextPage={eventsQuery.isFetchingNextPage}
            isLoading={eventsQuery.isLoading}
            onLoadMore={() => void eventsQuery.fetchNextPage()}
            onRetry={() => void eventsQuery.refetch()}
            onSelect={(eventId) => updateSearch({ event: eventId })}
            selectedId={selectedEvent?.event.id}
            source={search.source}
          />
          <EventDetail event={selectedEvent} tab={detailTab} onTabChange={setDetailTab} />
        </div>
      </main>
    </div>
  );
}

function EventRuler({
  endTime,
  events,
  selectedEvent,
  rangeLabel,
}: {
  readonly endTime: number;
  readonly events: readonly EventListItem[];
  readonly selectedEvent: EventListItem | undefined;
  readonly rangeLabel: string;
}) {
  const bins = rulerBinIds.map((id) => ({ id, count: 0 }));
  const timestamps = events.map(({ event }) => event.timestamp);
  const maximum = Math.max(...timestamps, endTime);
  const minimum = Math.min(...timestamps, maximum - 1);
  const span = Math.max(1, maximum - minimum);
  for (const timestamp of timestamps) {
    const index = Math.min(
      bins.length - 1,
      Math.floor(((timestamp - minimum) / span) * bins.length),
    );
    const bin = bins[index];
    if (bin) bin.count += 1;
  }
  const highest = Math.max(...bins.map((bin) => bin.count), 1);
  const selectedPosition = selectedEvent
    ? ((selectedEvent.event.timestamp - minimum) / span) * 100
    : undefined;

  return (
    <figure className="event-ruler">
      <figcaption>
        <strong>Loaded event activity</strong>
        <span>
          {events.length} {events.length === 1 ? 'event' : 'events'} · {rangeLabel.toLowerCase()}
        </span>
      </figcaption>
      <div className="ruler-plot" aria-label="Distribution of currently loaded events over time">
        {bins.map((bin) => (
          <span
            className={`ruler-bar ${bin.count > 0 ? 'active' : ''}`}
            key={bin.id}
            style={{ height: `${Math.max(5, (bin.count / highest) * 86)}%` }}
          />
        ))}
        {selectedPosition === undefined ? null : (
          <span
            className="selected-marker"
            style={{ left: `${selectedPosition}%` }}
            aria-hidden="true"
          />
        )}
      </div>
      <div className="ruler-labels" aria-hidden="true">
        <span>Earlier</span>
        <span>Now</span>
      </div>
    </figure>
  );
}

function EventLedger({
  events,
  error,
  hasNextPage,
  isFetchingNextPage,
  isLoading,
  onLoadMore,
  onRetry,
  onSelect,
  selectedId,
  source,
}: {
  readonly events: readonly EventListItem[];
  readonly error: Error | null;
  readonly hasNextPage: boolean;
  readonly isFetchingNextPage: boolean;
  readonly isLoading: boolean;
  readonly onLoadMore: () => void;
  readonly onRetry: () => void;
  readonly onSelect: (eventId: string) => void;
  readonly selectedId: string | undefined;
  readonly source: ExplorerSearch['source'];
}) {
  return (
    <section className="event-ledger" aria-labelledby="event-ledger-title" aria-busy={isLoading}>
      <header className="panel-heading">
        <div>
          <h2 id="event-ledger-title">Event ledger</h2>
          <span>{source === 'illustrative' ? 'Illustrative rows' : 'Newest first'}</span>
        </div>
        <output>{events.length} loaded</output>
      </header>
      {isLoading ? (
        <output className="ledger-state loading-state">
          <span className="loading-line" />
          <span className="loading-line" />
          <span className="loading-line" />
          <p>Querying event plane…</p>
        </output>
      ) : error ? (
        <div className="ledger-state error-state" role="alert">
          <strong>Events could not be loaded.</strong>
          <p>{error.message} Check the local API and token, then retry.</p>
          <button className="secondary-button" type="button" onClick={onRetry}>
            Try again
          </button>
        </div>
      ) : events.length === 0 ? (
        <div className="ledger-state empty-state">
          <Icon name="filter" size={24} />
          <strong>No events match this view.</strong>
          <p>Clear a filter or widen the selected time range.</p>
        </div>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">Time</th>
                <th scope="col">Event</th>
                <th scope="col">Type</th>
                <th scope="col">Session</th>
                <th scope="col">Page</th>
              </tr>
            </thead>
            <tbody>
              {events.map((item) => {
                const selected = item.event.id === selectedId;
                return (
                  <tr key={item.event.id} className={selected ? 'selected' : undefined}>
                    <td className="event-time">{formatTimestamp(item.event.timestamp)}</td>
                    <td>
                      <button
                        className="event-name-button"
                        type="button"
                        onClick={() => onSelect(item.event.id)}
                        aria-current={selected ? 'true' : undefined}
                      >
                        <span className={`event-dot ${item.event.type}`} aria-hidden="true" />
                        {item.event.name}
                      </button>
                    </td>
                    <td>
                      <span className={`event-type ${item.event.type}`}>
                        {eventTypeLabels[item.event.type]}
                      </span>
                    </td>
                    <td className="telemetry-cell">{item.event.context.session?.id ?? '—'}</td>
                    <td className="telemetry-cell">{item.event.context.page?.path ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {!isLoading && !error && events.length > 0 ? (
        <footer className="ledger-footer">
          <span>{hasNextPage ? 'More events are available' : 'End of loaded window'}</span>
          {hasNextPage ? (
            <button
              className="secondary-button"
              type="button"
              onClick={onLoadMore}
              disabled={isFetchingNextPage}
            >
              {isFetchingNextPage ? 'Loading…' : 'Load earlier'}
            </button>
          ) : null}
        </footer>
      ) : null}
    </section>
  );
}

function EventDetail({
  event,
  tab,
  onTabChange,
}: {
  readonly event: EventListItem | undefined;
  readonly tab: DetailTab;
  readonly onTabChange: (tab: DetailTab) => void;
}) {
  const tabs: Array<{ id: DetailTab; label: string }> = [
    { id: 'event', label: 'Event' },
    { id: 'context', label: 'Context' },
    { id: 'raw', label: 'Raw' },
  ];

  if (!event) {
    return (
      <aside className="event-detail empty-detail" aria-label="Event detail">
        <Icon name="activity" size={26} />
        <strong>Select an event to inspect it.</strong>
        <p>Its payload and available context will stay aligned with the ledger.</p>
      </aside>
    );
  }

  const context = event.event.context;

  return (
    <aside className="event-detail" aria-labelledby="selected-event-name">
      <header className="detail-heading">
        <div className="detail-identity">
          <span className={`detail-signal ${event.event.type}`} aria-hidden="true" />
          <div>
            <h2 id="selected-event-name">{event.event.name}</h2>
            <p>{eventSummary(event)}</p>
          </div>
        </div>
        <time dateTime={new Date(event.event.timestamp).toISOString()}>
          {formatDateTime(event.event.timestamp)}
        </time>
      </header>
      <div className="detail-tabs" role="tablist" aria-label="Selected event detail">
        {tabs.map((item, index) => (
          <button
            aria-controls={`detail-panel-${item.id}`}
            aria-selected={tab === item.id}
            id={`detail-tab-${item.id}`}
            key={item.id}
            onClick={() => onTabChange(item.id)}
            onKeyDown={(keyboardEvent) => {
              if (keyboardEvent.key !== 'ArrowLeft' && keyboardEvent.key !== 'ArrowRight') return;
              keyboardEvent.preventDefault();
              const direction = keyboardEvent.key === 'ArrowRight' ? 1 : -1;
              const nextTab = tabs[(index + direction + tabs.length) % tabs.length];
              if (nextTab) {
                onTabChange(nextTab.id);
                requestAnimationFrame(() =>
                  document.getElementById(`detail-tab-${nextTab.id}`)?.focus(),
                );
              }
            }}
            role="tab"
            tabIndex={tab === item.id ? 0 : -1}
            type="button"
          >
            {item.label}
          </button>
        ))}
      </div>
      <div
        className="detail-panel"
        id={`detail-panel-${tab}`}
        role="tabpanel"
        aria-labelledby={`detail-tab-${tab}`}
      >
        {tab === 'event' ? (
          <>
            <dl className="context-readout primary-readout">
              <div>
                <dt>Project</dt>
                <dd>{context.project.id}</dd>
              </div>
              <div>
                <dt>Environment</dt>
                <dd>{context.environment}</dd>
              </div>
              <div>
                <dt>Type</dt>
                <dd>{eventTypeLabels[event.event.type]}</dd>
              </div>
              <div>
                <dt>Protocol</dt>
                <dd>event v{event.event.version}</dd>
              </div>
              <div>
                <dt>Session</dt>
                <dd>{context.session?.id ?? 'Not available'}</dd>
              </div>
              <div>
                <dt>Page</dt>
                <dd>{context.page?.path ?? 'Not available'}</dd>
              </div>
              <div>
                <dt>Release</dt>
                <dd>{context.release?.version ?? 'Not available'}</dd>
              </div>
              <div>
                <dt>Fingerprint</dt>
                <dd>{event.processing.errorFingerprint ?? 'Not applicable'}</dd>
              </div>
            </dl>
            <section className="payload-section">
              <h3>Event payload</h3>
              <dl className="payload-readout">
                {Object.entries(event.event.payload).map(([key, value]) => (
                  <div key={key}>
                    <dt>{key}</dt>
                    <dd>{formatValue(value)}</dd>
                  </div>
                ))}
              </dl>
            </section>
          </>
        ) : null}
        {tab === 'context' ? (
          <dl className="context-readout context-grid">
            <div>
              <dt>SDK</dt>
              <dd>
                {context.sdk.name} {context.sdk.version}
              </dd>
            </div>
            <div>
              <dt>User</dt>
              <dd>{context.user?.id ?? 'Anonymous'}</dd>
            </div>
            <div>
              <dt>Anonymous ID</dt>
              <dd>{context.user?.anonymousId ?? 'Not available'}</dd>
            </div>
            <div>
              <dt>Page ID</dt>
              <dd>{context.page?.id ?? 'Not available'}</dd>
            </div>
            <div>
              <dt>Page URL</dt>
              <dd>{context.page?.url ?? 'Not available'}</dd>
            </div>
            <div>
              <dt>Trace ID</dt>
              <dd>{context.trace?.traceId ?? 'Not available'}</dd>
            </div>
            <div>
              <dt>Envelope sent</dt>
              <dd>{formatDateTime(event.processing.envelopeSentAt)}</dd>
            </div>
            <div>
              <dt>Processed</dt>
              <dd>{formatDateTime(event.processing.processedAt)}</dd>
            </div>
            {Object.entries(context.tags ?? {}).map(([key, value]) => (
              <div key={key}>
                <dt>Tag · {key}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        {tab === 'raw' ? (
          <pre className="raw-event">
            <code>{JSON.stringify(event, null, 2)}</code>
          </pre>
        ) : null}
      </div>
    </aside>
  );
}

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Spectro root element is missing');

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
