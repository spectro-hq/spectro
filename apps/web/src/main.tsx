import {
  QueryClient,
  QueryClientProvider,
  useInfiniteQuery,
  useMutation,
  useQuery,
} from '@tanstack/react-query';
import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { StrictMode, useEffect, useMemo, useState, type FormEvent } from 'react';
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
import { createIllustrativeIssues } from './illustrative-issues.js';
import { createIllustrativeNetwork } from './illustrative-network.js';
import { createIllustrativePerformance } from './illustrative-performance.js';
import {
  fetchIssueHistory,
  fetchIssuePage,
  parseIssueSearch,
  updateIssueStatus,
  type ErrorIssue,
  type IssuePage,
  type IssueSearch,
  type IssueStatus,
} from './issue-query.js';
import { PayloadViewer } from './payload-viewer.js';
import {
  fetchNetworkPage,
  formatNetworkTarget,
  networkInitiatorSchema,
  parseNetworkSearch,
  type NetworkGroup,
  type NetworkPage,
  type NetworkSearch,
} from './network-query.js';
import {
  fetchPerformancePage,
  parsePerformanceSearch,
  performanceMetricSchema,
  type PerformanceGroup,
  type PerformancePage,
  type PerformanceSearch,
} from './performance-query.js';
import { buildSessionHref, parseSessionSearch, type SessionSearch } from './session-query.js';
import { SpectroIcon, SpectroMark } from './spectro-icons.js';
import './styles.css';

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
const issuesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/issues',
  validateSearch: parseIssueSearch,
  component: IssuesExplorer,
});
const sessionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/sessions/$sessionId',
  validateSearch: parseSessionSearch,
  component: SessionExplorer,
});
const performanceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/performance',
  validateSearch: parsePerformanceSearch,
  component: PerformanceExplorer,
});
const networkRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/network',
  validateSearch: parseNetworkSearch,
  component: NetworkExplorer,
});
const routeTree = rootRoute.addChildren([
  indexRoute,
  issuesRoute,
  sessionRoute,
  performanceRoute,
  networkRoute,
]);
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
type ColorTheme = 'light' | 'dark';

const rulerBinIds = Array.from({ length: 40 }, (_, index) => `time-bin-${index + 1}`);

function initialColorTheme(): ColorTheme {
  const documentTheme = document.documentElement.dataset.theme;
  if (documentTheme === 'light' || documentTheme === 'dark') return documentTheme;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function ThemeToggle() {
  const [theme, setTheme] = useState<ColorTheme>(initialColorTheme);
  const nextTheme = theme === 'dark' ? 'light' : 'dark';

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', theme === 'dark' ? '#0e1420' : '#f5f5f7');
  }, [theme]);

  const toggleTheme = (): void => {
    setTheme(nextTheme);
    try {
      localStorage.setItem('spectro.color-theme', nextTheme);
    } catch {
      // Theme selection still works for this session when storage is unavailable.
    }
  };

  return (
    <button
      aria-label={`Switch to ${nextTheme} mode`}
      aria-pressed={theme === 'dark'}
      className="theme-toggle"
      title={`Switch to ${nextTheme} mode`}
      type="button"
      onClick={toggleTheme}
    >
      <SpectroIcon name={theme === 'dark' ? 'sun' : 'moon'} size={17} />
    </button>
  );
}

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

function formatTimelineTimestamp(timestamp: number): string {
  return new Intl.DateTimeFormat('en', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
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
    data: page.data.filter((item) => {
      const { event } = item;
      return (
        event.timestamp >= anchor - TIME_RANGES[search.range].milliseconds &&
        (search.type === undefined || event.type === search.type) &&
        (search.name === undefined || event.name === search.name) &&
        (search.release === undefined || event.context.release?.version === search.release) &&
        (search.sessionId === undefined || event.context.session?.id === search.sessionId) &&
        (search.pageId === undefined || event.context.page?.id === search.pageId) &&
        (search.fingerprint === undefined ||
          item.processing.errorFingerprint === search.fingerprint)
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
      search.fingerprint,
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
          ...(search.fingerprint === undefined ? {} : { fingerprint: search.fingerprint }),
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
          <SpectroMark />
          spectro
        </a>
        <div className="topbar-actions">
          <div className="runtime-state">
            <span className={`status-light ${search.source}`} aria-hidden="true" />
            <span>
              {search.source === 'live' ? 'Local API connected' : 'Illustrative workspace'}
            </span>
          </div>
          <ThemeToggle />
        </div>
      </header>

      <aside className="console-rail" aria-label="Primary navigation">
        <nav>
          <a className="rail-link active" href="/" aria-current="page">
            <SpectroIcon name="events" />
            <span>Events</span>
          </a>
          <a
            className="rail-link"
            href={`/issues?${new URLSearchParams({
              project: search.project,
              environment: search.environment,
              range: search.range,
              source: search.source,
            }).toString()}`}
          >
            <SpectroIcon name="issues" />
            <span>Issues</span>
          </a>
          <a
            className="rail-link"
            href={`/performance?${new URLSearchParams({
              project: search.project,
              environment: search.environment,
              range: search.range,
              source: search.source,
            }).toString()}`}
          >
            <SpectroIcon name="performance" />
            <span>Performance</span>
          </a>
          <a
            className="rail-link"
            href={`/network?${new URLSearchParams({
              project: search.project,
              environment: search.environment,
              range: search.range,
              source: search.source,
            }).toString()}`}
          >
            <SpectroIcon name="network" />
            <span>Network</span>
          </a>
          <span className="rail-link" aria-disabled="true" title="Coming after the event explorer">
            <SpectroIcon name="live" />
            <span>Live</span>
          </span>
          <span className="rail-link" aria-disabled="true" title="Coming after the event explorer">
            <SpectroIcon name="schemas" />
            <span>Schemas</span>
          </span>
        </nav>
        <nav className="rail-secondary" aria-label="Secondary navigation">
          <span className="rail-link" aria-disabled="true">
            <SpectroIcon name="settings" />
            <span>Settings</span>
          </span>
          <span
            className="rail-link"
            aria-disabled="true"
            title="API guide is available in the repository"
          >
            <SpectroIcon name="book" />
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
            <SpectroIcon name="calendar" size={16} />
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
            <SpectroIcon name="chevron" size={16} />
          </label>

          <div className="command-actions">
            <button
              className="icon-button"
              type="button"
              onClick={() => setQueryAnchor(Date.now())}
              aria-label="Refresh events"
            >
              <SpectroIcon name="refresh" />
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
            <SpectroIcon name="search" />
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
            <SpectroIcon name="chevron" size={16} />
          </label>
          <details className="more-filters">
            <summary>
              <SpectroIcon name="filter" />
              More filters
              {[search.release, search.sessionId, search.pageId, search.fingerprint].filter(Boolean)
                .length > 0 ? (
                <span className="filter-count">
                  {
                    [search.release, search.sessionId, search.pageId, search.fingerprint].filter(
                      Boolean,
                    ).length
                  }
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
              <label htmlFor="event-fingerprint-filter">
                <span>Error fingerprint</span>
                <CommittedInput
                  ariaLabel="Error fingerprint"
                  id="event-fingerprint-filter"
                  key={`event-fingerprint-${search.fingerprint ?? ''}`}
                  value={search.fingerprint ?? ''}
                  placeholder="32 hexadecimal characters"
                  pattern="[0-9a-fA-F]{32}"
                  title="Enter a 32-character hexadecimal fingerprint"
                  validate={(value) => value === '' || /^[0-9a-fA-F]{32}$/.test(value)}
                  onCommit={(fingerprint) =>
                    updateFilter({ fingerprint: fingerprint.toLowerCase() || undefined })
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
                fingerprint: undefined,
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
            search={search}
            source={search.source}
          />
          <EventDetail
            event={selectedEvent}
            search={search}
            tab={detailTab}
            onTabChange={setDetailTab}
          />
        </div>
      </main>
    </div>
  );
}

function formatDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.round(milliseconds / 1_000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder === 0 ? `${minutes}m` : `${minutes}m ${remainder}s`;
}

function orderEventsChronologically(events: readonly EventListItem[]): EventListItem[] {
  const ordered: EventListItem[] = [];
  for (const item of events) {
    const insertionIndex = ordered.findIndex(
      (candidate) => candidate.event.timestamp > item.event.timestamp,
    );
    if (insertionIndex === -1) ordered.push(item);
    else ordered.splice(insertionIndex, 0, item);
  }
  return ordered;
}

function SessionExplorer() {
  const { sessionId } = sessionRoute.useParams();
  const search = sessionRoute.useSearch();
  const navigate = sessionRoute.useNavigate();
  const [token, setToken] = useState(readSessionToken);
  const [tokenDraft, setTokenDraft] = useState('');
  const [connectionOpen, setConnectionOpen] = useState(
    search.source === 'live' && token.length === 0,
  );
  const [credentialVersion, setCredentialVersion] = useState(0);
  const [queryAnchor, setQueryAnchor] = useState(() => Date.now());
  const [detailTab, setDetailTab] = useState<DetailTab>('event');
  const range = TIME_RANGES[search.range];
  const validSessionId = sessionId.length > 0 && sessionId.length <= 128;

  const updateSearch = (patch: Partial<SessionSearch>): void => {
    void navigate({ search: (previous) => ({ ...previous, ...patch }) });
  };

  const eventsQuery = useInfiniteQuery({
    queryKey: [
      'session-events',
      search.project,
      search.environment,
      search.range,
      search.source,
      sessionId,
      queryAnchor,
      credentialVersion,
    ],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) => {
      if (search.source === 'illustrative') {
        return filteredIllustrativePage({ ...search, sessionId }, queryAnchor);
      }
      return fetchEventPage({
        query: {
          projectId: search.project,
          environment: search.environment,
          from: queryAnchor - range.milliseconds,
          to: queryAnchor,
          sessionId,
          limit: 100,
          ...(pageParam === undefined ? {} : { cursor: pageParam }),
        },
        token,
        signal,
      });
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: validSessionId && (search.source === 'illustrative' || token.length > 0),
  });

  const events = useMemo(
    () => eventsQuery.data?.pages.flatMap((page) => page.data) ?? [],
    [eventsQuery.data],
  );
  const timelineEvents = useMemo(() => orderEventsChronologically(events), [events]);
  const selectedEvent = events.find((item) => item.event.id === search.event) ?? events[0];
  const firstEvent = timelineEvents[0];
  const lastEvent = timelineEvents.at(-1);
  const pageCount = new Set(
    events.map((item) => item.event.context.page?.id).filter((id) => id !== undefined),
  ).size;
  const errorCount = events.filter((item) => item.event.type === 'error').length;
  const sessionDuration =
    firstEvent && lastEvent ? lastEvent.event.timestamp - firstEvent.event.timestamp : 0;
  const eventSearch = new URLSearchParams({
    project: search.project,
    environment: search.environment,
    range: search.range,
    source: search.source,
    sessionId,
  });

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

  return (
    <div className="console-shell session-shell">
      <header className="console-topbar">
        <a className="wordmark" href="/" aria-label="Spectro events">
          <SpectroMark />
          spectro
        </a>
        <div className="topbar-actions">
          <div className="runtime-state">
            <span className={`status-light ${search.source}`} aria-hidden="true" />
            <span>
              {search.source === 'live' ? 'Local API connected' : 'Illustrative workspace'}
            </span>
          </div>
          <ThemeToggle />
        </div>
      </header>

      <aside className="console-rail" aria-label="Primary navigation">
        <nav>
          <a className="rail-link active" href={`/?${eventSearch.toString()}`}>
            <SpectroIcon name="events" />
            <span>Events</span>
          </a>
          <a
            className="rail-link"
            href={`/issues?${new URLSearchParams({
              project: search.project,
              environment: search.environment,
              range: search.range,
              source: search.source,
            }).toString()}`}
          >
            <SpectroIcon name="issues" />
            <span>Issues</span>
          </a>
          <a
            className="rail-link"
            href={`/performance?${new URLSearchParams({
              project: search.project,
              environment: search.environment,
              range: search.range,
              source: search.source,
            }).toString()}`}
          >
            <SpectroIcon name="performance" />
            <span>Performance</span>
          </a>
          <a
            className="rail-link"
            href={`/network?${new URLSearchParams({
              project: search.project,
              environment: search.environment,
              range: search.range,
              source: search.source,
            }).toString()}`}
          >
            <SpectroIcon name="network" />
            <span>Network</span>
          </a>
          <span className="rail-link" aria-disabled="true">
            <SpectroIcon name="live" />
            <span>Live</span>
          </span>
          <span className="rail-link" aria-disabled="true">
            <SpectroIcon name="schemas" />
            <span>Schemas</span>
          </span>
        </nav>
        <nav className="rail-secondary" aria-label="Secondary navigation">
          <span className="rail-link" aria-disabled="true">
            <SpectroIcon name="settings" />
            <span>Settings</span>
          </span>
          <span className="rail-link" aria-disabled="true">
            <SpectroIcon name="book" />
            <span>API guide</span>
          </span>
        </nav>
      </aside>

      <main className="event-workspace session-workspace">
        <section className="session-command" aria-labelledby="session-title">
          <div>
            <a className="back-link" href={`/?${eventSearch.toString()}`}>
              <span aria-hidden="true">←</span> Events
            </a>
            <h1 id="session-title">Session {sessionId}</h1>
            <p>Signals ordered as they unfolded across this browser session.</p>
          </div>
          <div className="session-actions">
            <label className="control-field select-field">
              <span>Time range</span>
              <SpectroIcon name="calendar" size={16} />
              <select
                aria-label="Time range"
                value={search.range}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  if (isTimeRange(value)) {
                    updateSearch({ range: value, event: undefined });
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
              <SpectroIcon name="chevron" size={16} />
            </label>
            <button
              className="icon-button"
              type="button"
              aria-label="Refresh session"
              onClick={() => setQueryAnchor(Date.now())}
            >
              <SpectroIcon name="refresh" />
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
          <section className="connection-panel" aria-labelledby="session-connection-title">
            <div>
              <h2 id="session-connection-title">Local query connection</h2>
              <p>The bearer token stays in this browser tab and is sent only as a header.</p>
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
            </form>
          </section>
        ) : null}

        {search.source === 'illustrative' ? (
          <section className="illustrative-banner" aria-live="polite">
            <span>Illustrative data</span>
            <p>This session demonstrates investigation flow, not production telemetry.</p>
            <button type="button" onClick={() => setConnectionOpen(true)}>
              Connect ClickHouse query
            </button>
          </section>
        ) : null}

        <section className="session-summary" aria-label="Loaded session summary">
          <div>
            <strong>{events.length}</strong>
            <span>Signals</span>
          </div>
          <div>
            <strong>{pageCount}</strong>
            <span>Pages</span>
          </div>
          <div>
            <strong>{errorCount}</strong>
            <span>Errors</span>
          </div>
          <div>
            <strong>{formatDuration(sessionDuration)}</strong>
            <span>Observed span</span>
          </div>
          <p>Summary reflects the loaded {range.label.toLowerCase()} query window.</p>
        </section>

        <div className="session-bench">
          <section className="session-timeline" aria-labelledby="session-timeline-title">
            <header className="panel-heading">
              <div>
                <h2 id="session-timeline-title">Session timeline</h2>
                <span>Earliest to latest</span>
              </div>
              <output>{events.length} loaded</output>
            </header>
            {!validSessionId ? (
              <div className="ledger-state error-state" role="alert">
                <strong>This session identifier is invalid.</strong>
                <p>Return to Events and choose a session from captured context.</p>
              </div>
            ) : eventsQuery.isLoading ? (
              <output className="ledger-state loading-state">
                <span className="loading-line" />
                <span className="loading-line" />
                <p>Reconstructing session timeline…</p>
              </output>
            ) : eventsQuery.error ? (
              <div className="ledger-state error-state" role="alert">
                <strong>The session could not be loaded.</strong>
                <p>{eventsQuery.error.message} Check the local API and token, then retry.</p>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => void eventsQuery.refetch()}
                >
                  Try again
                </button>
              </div>
            ) : timelineEvents.length === 0 ? (
              <div className="ledger-state empty-state">
                <SpectroIcon name="session" size={25} />
                <strong>No signals were found for this session.</strong>
                <p>Widen the time range or return to Events to select another session.</p>
              </div>
            ) : (
              <ol className="timeline-list">
                {timelineEvents.map((item) => {
                  const selected = item.event.id === selectedEvent?.event.id;
                  return (
                    <li key={item.event.id}>
                      <button
                        className={`timeline-event ${selected ? 'selected' : ''}`}
                        type="button"
                        aria-current={selected ? 'true' : undefined}
                        onClick={() => updateSearch({ event: item.event.id })}
                      >
                        <span className={`timeline-node ${item.event.type}`} aria-hidden="true" />
                        <time dateTime={new Date(item.event.timestamp).toISOString()}>
                          {formatTimelineTimestamp(item.event.timestamp)}
                        </time>
                        <span className="timeline-copy">
                          <strong>{item.event.name}</strong>
                          <small>{eventSummary(item)}</small>
                        </span>
                        <span className={`event-type ${item.event.type}`}>
                          {eventTypeLabels[item.event.type]}
                        </span>
                        <span className="timeline-page">
                          {item.event.context.page?.path ?? 'No page context'}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            )}
            {!eventsQuery.isLoading && !eventsQuery.error && events.length > 0 ? (
              <footer className="ledger-footer">
                <span>
                  {eventsQuery.hasNextPage
                    ? 'Earlier session signals are available'
                    : 'Complete loaded session window'}
                </span>
                {eventsQuery.hasNextPage ? (
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={eventsQuery.isFetchingNextPage}
                    onClick={() => void eventsQuery.fetchNextPage()}
                  >
                    {eventsQuery.isFetchingNextPage ? 'Loading…' : 'Load earlier'}
                  </button>
                ) : null}
              </footer>
            ) : null}
          </section>
          <EventDetail
            event={selectedEvent}
            search={search}
            tab={detailTab}
            onTabChange={setDetailTab}
          />
        </div>
      </main>
    </div>
  );
}

function formatMetricValue(value: number, unit: 'ms' | 'score'): string {
  if (unit === 'score') return value.toFixed(2);
  return `${Math.round(value).toLocaleString()} ms`;
}

function metricEventName(metric: PerformanceGroup['metric']): string {
  if (metric === 'long_task') return 'long_task';
  if (metric === 'navigation') return 'navigation_timing';
  if (metric === 'resource_timing') return 'resource_request';
  return `web_vital_${metric}`;
}

function performanceGroupKey(group: PerformanceGroup): string {
  return `${group.metric}:${group.pagePath ?? ''}`;
}

function PerformanceExplorer() {
  const search = performanceRoute.useSearch();
  const navigate = performanceRoute.useNavigate();
  const [token, setToken] = useState(readSessionToken);
  const [tokenDraft, setTokenDraft] = useState('');
  const [connectionOpen, setConnectionOpen] = useState(
    search.source === 'live' && token.length === 0,
  );
  const [credentialVersion, setCredentialVersion] = useState(0);
  const [queryAnchor, setQueryAnchor] = useState(() => Date.now());
  const [selectedKey, setSelectedKey] = useState<string>();
  const range = TIME_RANGES[search.range];

  const updateSearch = (patch: Partial<PerformanceSearch>): void => {
    void navigate({ search: (previous) => ({ ...previous, ...patch }) });
  };

  const performanceQuery = useInfiniteQuery({
    queryKey: [
      'performance',
      search.project,
      search.environment,
      search.range,
      search.source,
      search.metric,
      search.pagePath,
      search.release,
      queryAnchor,
      credentialVersion,
    ],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) => {
      if (search.source === 'illustrative') {
        return createIllustrativePerformance(queryAnchor, search) satisfies PerformancePage;
      }
      return fetchPerformancePage({
        query: {
          projectId: search.project,
          environment: search.environment,
          from: queryAnchor - range.milliseconds,
          to: queryAnchor,
          limit: 50,
          ...(search.metric ? { metric: search.metric } : {}),
          ...(search.pagePath ? { pagePath: search.pagePath } : {}),
          ...(search.release ? { release: search.release } : {}),
          ...(pageParam ? { cursor: pageParam } : {}),
        },
        token,
        signal,
      });
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: search.source === 'illustrative' || token.length > 0,
  });

  const groups = useMemo(
    () => performanceQuery.data?.pages.flatMap((page) => page.data) ?? [],
    [performanceQuery.data],
  );
  const selected = groups.find((group) => performanceGroupKey(group) === selectedKey) ?? groups[0];
  const totalSamples = groups.reduce((total, group) => total + group.sampleCount, 0);
  const totalPoor = groups.reduce((total, group) => total + group.poorCount, 0);
  const affectedSessions = groups.reduce((total, group) => total + group.affectedSessionCount, 0);

  const connect = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const nextToken = tokenDraft.trim();
    if (nextToken.length === 0) return;
    setToken(nextToken);
    writeSessionToken(nextToken);
    setCredentialVersion((value) => value + 1);
    setConnectionOpen(false);
    updateSearch({ source: 'live' });
    setQueryAnchor(Date.now());
  };

  const baseSearch = {
    project: search.project,
    environment: search.environment,
    range: search.range,
    source: search.source,
  };

  return (
    <div className="console-shell performance-shell">
      <header className="console-topbar">
        <a className="wordmark" href="/" aria-label="Spectro events">
          <SpectroMark />
          spectro
        </a>
        <div className="topbar-actions">
          <div className="runtime-state">
            <span className={`status-light ${search.source}`} aria-hidden="true" />
            <span>
              {search.source === 'live' ? 'Local API connected' : 'Illustrative workspace'}
            </span>
          </div>
          <ThemeToggle />
        </div>
      </header>
      <aside className="console-rail" aria-label="Primary navigation">
        <nav>
          <a className="rail-link" href={`/?${new URLSearchParams(baseSearch).toString()}`}>
            <SpectroIcon name="events" />
            <span>Events</span>
          </a>
          <a className="rail-link" href={`/issues?${new URLSearchParams(baseSearch).toString()}`}>
            <SpectroIcon name="issues" />
            <span>Issues</span>
          </a>
          <a className="rail-link active" href="/performance" aria-current="page">
            <SpectroIcon name="performance" />
            <span>Performance</span>
          </a>
          <a className="rail-link" href={`/network?${new URLSearchParams(baseSearch).toString()}`}>
            <SpectroIcon name="network" />
            <span>Network</span>
          </a>
          <span className="rail-link" aria-disabled="true">
            <SpectroIcon name="live" />
            <span>Live</span>
          </span>
          <span className="rail-link" aria-disabled="true">
            <SpectroIcon name="schemas" />
            <span>Schemas</span>
          </span>
        </nav>
        <nav className="rail-secondary" aria-label="Secondary navigation">
          <span className="rail-link" aria-disabled="true">
            <SpectroIcon name="settings" />
            <span>Settings</span>
          </span>
          <span className="rail-link" aria-disabled="true">
            <SpectroIcon name="book" />
            <span>API guide</span>
          </span>
        </nav>
      </aside>

      <main className="event-workspace performance-workspace">
        <section className="command-deck" aria-labelledby="performance-title">
          <div className="workspace-title">
            <h1 id="performance-title">Performance</h1>
            <span>Field metrics grouped by page</span>
          </div>
          <label className="control-field project-field" htmlFor="performance-project-id">
            <span>Project</span>
            <CommittedInput
              ariaLabel="Project ID"
              id="performance-project-id"
              key={`performance-project-${search.project}`}
              value={search.project}
              validate={(value) => /^prj_[A-Za-z0-9_-]{1,120}$/.test(value)}
              onCommit={(project) => updateSearch({ project })}
            />
          </label>
          <label className="control-field" htmlFor="performance-environment-id">
            <span>Environment</span>
            <CommittedInput
              ariaLabel="Environment"
              id="performance-environment-id"
              key={`performance-environment-${search.environment}`}
              value={search.environment}
              validate={(value) => value.length > 0 && value.length <= 64}
              onCommit={(environment) => updateSearch({ environment })}
            />
          </label>
          <label className="control-field select-field">
            <span>Time range</span>
            <SpectroIcon name="calendar" size={16} />
            <select
              aria-label="Time range"
              value={search.range}
              onChange={(event) => {
                const value = event.currentTarget.value;
                if (isTimeRange(value)) {
                  updateSearch({ range: value });
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
            <SpectroIcon name="chevron" size={16} />
          </label>
          <div className="command-actions">
            <button
              className="icon-button"
              type="button"
              aria-label="Refresh performance"
              onClick={() => setQueryAnchor(Date.now())}
            >
              <SpectroIcon name="refresh" />
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
          <section className="connection-panel" aria-labelledby="performance-connection-title">
            <div>
              <h2 id="performance-connection-title">Local query connection</h2>
              <p>The bearer token stays in this browser tab and is sent only as a header.</p>
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
            </form>
          </section>
        ) : null}

        {search.source === 'illustrative' ? (
          <section className="illustrative-banner" aria-live="polite">
            <span>Illustrative data</span>
            <p>These aggregates demonstrate performance investigation, not production telemetry.</p>
            <button type="button" onClick={() => setConnectionOpen(true)}>
              Connect ClickHouse query
            </button>
          </section>
        ) : null}

        <section className="performance-summary" aria-label="Loaded performance summary">
          <div>
            <strong>{groups.length}</strong>
            <span>metric groups</span>
          </div>
          <div>
            <strong>{totalSamples}</strong>
            <span>samples</span>
          </div>
          <div>
            <strong>{affectedSessions}</strong>
            <span>affected sessions</span>
          </div>
          <div>
            <strong>{totalPoor}</strong>
            <span>poor ratings</span>
          </div>
          <p>Counts describe loaded groups in the selected {range.label.toLowerCase()} window.</p>
        </section>

        <section className="performance-filters" aria-label="Performance filters">
          <label className="release-filter">
            <span>Metric</span>
            <select
              aria-label="Performance metric"
              value={search.metric ?? ''}
              onChange={(event) => {
                const result = performanceMetricSchema.safeParse(event.currentTarget.value);
                updateSearch({ metric: result.success ? result.data : undefined });
              }}
            >
              <option value="">All metrics</option>
              {performanceMetricSchema.options.map((metric) => (
                <option key={metric} value={metric}>
                  {metric.toUpperCase()}
                </option>
              ))}
            </select>
          </label>
          <label className="search-field" htmlFor="performance-page-filter">
            <SpectroIcon name="search" />
            <CommittedInput
              ariaLabel="Exact page path"
              id="performance-page-filter"
              key={`performance-page-${search.pagePath ?? ''}`}
              placeholder="Exact page path"
              value={search.pagePath ?? ''}
              validate={(value) => value.length <= 2_048}
              onCommit={(pagePath) => updateSearch({ pagePath: pagePath || undefined })}
            />
          </label>
          <label className="release-filter" htmlFor="performance-release-filter">
            <span>Release</span>
            <CommittedInput
              ariaLabel="Release"
              id="performance-release-filter"
              key={`performance-release-${search.release ?? ''}`}
              placeholder="All releases"
              value={search.release ?? ''}
              validate={(value) => value.length <= 128}
              onCommit={(release) => updateSearch({ release: release || undefined })}
            />
          </label>
          <button
            className="clear-button"
            type="button"
            onClick={() =>
              updateSearch({ metric: undefined, pagePath: undefined, release: undefined })
            }
          >
            Clear
          </button>
        </section>

        <div className="performance-bench">
          <section className="performance-ledger" aria-labelledby="performance-groups-title">
            <header className="panel-heading">
              <div>
                <h2 id="performance-groups-title">Metric groups</h2>
                <span>Most recently observed</span>
              </div>
              <output>{groups.length} loaded</output>
            </header>
            {performanceQuery.isLoading ? (
              <output className="ledger-state loading-state">
                <span className="loading-line" />
                <span className="loading-line" />
                <p>Aggregating field performance…</p>
              </output>
            ) : performanceQuery.error ? (
              <div className="ledger-state error-state" role="alert">
                <strong>Performance could not be loaded.</strong>
                <p>{performanceQuery.error.message} Check the local API and token, then retry.</p>
              </div>
            ) : groups.length === 0 ? (
              <div className="ledger-state empty-state">
                <SpectroIcon name="performance" size={26} />
                <strong>No performance groups match this view.</strong>
                <p>Clear a filter or widen the selected time range.</p>
              </div>
            ) : (
              <div className="performance-rows">
                {groups.map((group) => {
                  const key = performanceGroupKey(group);
                  const active = key === performanceGroupKey(selected ?? group);
                  const rated = group.goodCount + group.needsImprovementCount + group.poorCount;
                  const poorShare = rated === 0 ? 0 : (group.poorCount / rated) * 100;
                  return (
                    <button
                      className={`performance-row ${active ? 'selected' : ''}`}
                      key={key}
                      type="button"
                      aria-current={active ? 'true' : undefined}
                      onClick={() => setSelectedKey(key)}
                    >
                      <span className="metric-badge">{group.metric.toUpperCase()}</span>
                      <span className="metric-copy">
                        <strong>{group.pagePath ?? 'Page unavailable'}</strong>
                        <small>{group.latestRelease ?? 'Release unavailable'}</small>
                      </span>
                      <span className="metric-value">
                        <strong>{formatMetricValue(group.p75, group.unit)}</strong>
                        <small>P75</small>
                      </span>
                      <span className="metric-health">
                        <strong>{poorShare.toFixed(0)}%</strong>
                        <small>poor</small>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          {selected ? (
            <aside className="performance-detail" aria-labelledby="selected-performance-title">
              <header>
                <span className="metric-badge">{selected.metric.toUpperCase()}</span>
                <div>
                  <h2 id="selected-performance-title">{selected.pagePath ?? 'Page unavailable'}</h2>
                  <p>{selected.latestRelease ?? 'Release unavailable'}</p>
                </div>
              </header>
              <dl className="performance-readout">
                <div>
                  <dt>Average</dt>
                  <dd>{formatMetricValue(selected.average, selected.unit)}</dd>
                </div>
                <div>
                  <dt>P75</dt>
                  <dd>{formatMetricValue(selected.p75, selected.unit)}</dd>
                </div>
                <div>
                  <dt>P95</dt>
                  <dd>{formatMetricValue(selected.p95, selected.unit)}</dd>
                </div>
                <div>
                  <dt>Samples</dt>
                  <dd>{selected.sampleCount}</dd>
                </div>
                <div>
                  <dt>Sessions</dt>
                  <dd>{selected.affectedSessionCount}</dd>
                </div>
                <div>
                  <dt>Last seen</dt>
                  <dd>{relativeTime(selected.lastSeen, queryAnchor)}</dd>
                </div>
              </dl>
              <section className="rating-distribution" aria-label="Captured rating distribution">
                <div>
                  <span>Good</span>
                  <strong>{selected.goodCount}</strong>
                </div>
                <div>
                  <span>Needs improvement</span>
                  <strong>{selected.needsImprovementCount}</strong>
                </div>
                <div>
                  <span>Poor</span>
                  <strong>{selected.poorCount}</strong>
                </div>
              </section>
              <a
                className="occurrence-link"
                href={`/?${new URLSearchParams({
                  ...baseSearch,
                  type: 'performance',
                  name: metricEventName(selected.metric),
                  event: selected.latestEventId,
                  ...(selected.latestRelease ? { release: selected.latestRelease } : {}),
                }).toString()}`}
              >
                Inspect performance events <span aria-hidden="true">→</span>
              </a>
              <p className="issue-scope-note">
                Percentiles and ratings reflect captured samples in this query window. Missing
                ratings are not inferred.
              </p>
            </aside>
          ) : (
            <aside className="performance-detail empty-detail">
              <SpectroIcon name="performance" size={26} />
              <strong>Select a metric group to inspect it.</strong>
            </aside>
          )}
        </div>
      </main>
    </div>
  );
}

function networkGroupKey(group: NetworkGroup): string {
  return `${group.initiator}:${group.method}:${group.url}:${group.pagePath ?? ''}`;
}

function NetworkExplorer() {
  const search = networkRoute.useSearch();
  const navigate = networkRoute.useNavigate();
  const [token, setToken] = useState(readSessionToken);
  const [tokenDraft, setTokenDraft] = useState('');
  const [connectionOpen, setConnectionOpen] = useState(
    search.source === 'live' && token.length === 0,
  );
  const [credentialVersion, setCredentialVersion] = useState(0);
  const [queryAnchor, setQueryAnchor] = useState(() => Date.now());
  const [selectedKey, setSelectedKey] = useState<string>();
  const range = TIME_RANGES[search.range];

  const updateSearch = (patch: Partial<NetworkSearch>): void => {
    void navigate({ search: (previous) => ({ ...previous, ...patch }) });
  };

  const networkQuery = useInfiniteQuery({
    queryKey: [
      'network',
      search.project,
      search.environment,
      search.range,
      search.source,
      search.initiator,
      search.method,
      search.success,
      search.pagePath,
      search.release,
      queryAnchor,
      credentialVersion,
    ],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) => {
      if (search.source === 'illustrative') {
        return createIllustrativeNetwork(queryAnchor, search) satisfies NetworkPage;
      }
      return fetchNetworkPage({
        query: {
          projectId: search.project,
          environment: search.environment,
          from: queryAnchor - range.milliseconds,
          to: queryAnchor,
          limit: 50,
          ...(search.initiator ? { initiator: search.initiator } : {}),
          ...(search.method ? { method: search.method } : {}),
          ...(search.success === undefined ? {} : { success: search.success }),
          ...(search.pagePath ? { pagePath: search.pagePath } : {}),
          ...(search.release ? { release: search.release } : {}),
          ...(pageParam ? { cursor: pageParam } : {}),
        },
        token,
        signal,
      });
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: search.source === 'illustrative' || token.length > 0,
  });

  const groups = useMemo(
    () => networkQuery.data?.pages.flatMap((page) => page.data) ?? [],
    [networkQuery.data],
  );
  const selected = groups.find((group) => networkGroupKey(group) === selectedKey) ?? groups[0];
  const requests = groups.reduce((total, group) => total + group.requestCount, 0);
  const failures = groups.reduce((total, group) => total + group.failureCount, 0);
  const sessions = groups.reduce((total, group) => total + group.affectedSessionCount, 0);

  const connect = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const nextToken = tokenDraft.trim();
    if (!nextToken) return;
    setToken(nextToken);
    writeSessionToken(nextToken);
    setCredentialVersion((value) => value + 1);
    setConnectionOpen(false);
    updateSearch({ source: 'live' });
    setQueryAnchor(Date.now());
  };

  const baseSearch = {
    project: search.project,
    environment: search.environment,
    range: search.range,
    source: search.source,
  };

  return (
    <div className="console-shell network-shell">
      <header className="console-topbar">
        <a className="wordmark" href="/" aria-label="Spectro events">
          <SpectroMark />
          spectro
        </a>
        <div className="topbar-actions">
          <div className="runtime-state">
            <span className={`status-light ${search.source}`} aria-hidden="true" />
            <span>
              {search.source === 'live' ? 'Local API connected' : 'Illustrative workspace'}
            </span>
          </div>
          <ThemeToggle />
        </div>
      </header>
      <aside className="console-rail" aria-label="Primary navigation">
        <nav>
          <a className="rail-link" href={`/?${new URLSearchParams(baseSearch).toString()}`}>
            <SpectroIcon name="events" />
            <span>Events</span>
          </a>
          <a className="rail-link" href={`/issues?${new URLSearchParams(baseSearch).toString()}`}>
            <SpectroIcon name="issues" />
            <span>Issues</span>
          </a>
          <a
            className="rail-link"
            href={`/performance?${new URLSearchParams(baseSearch).toString()}`}
          >
            <SpectroIcon name="performance" />
            <span>Performance</span>
          </a>
          <a className="rail-link active" href="/network" aria-current="page">
            <SpectroIcon name="network" />
            <span>Network</span>
          </a>
          <span className="rail-link" aria-disabled="true">
            <SpectroIcon name="live" />
            <span>Live</span>
          </span>
          <span className="rail-link" aria-disabled="true">
            <SpectroIcon name="schemas" />
            <span>Schemas</span>
          </span>
        </nav>
        <nav className="rail-secondary" aria-label="Secondary navigation">
          <span className="rail-link" aria-disabled="true">
            <SpectroIcon name="settings" />
            <span>Settings</span>
          </span>
          <span className="rail-link" aria-disabled="true">
            <SpectroIcon name="book" />
            <span>API guide</span>
          </span>
        </nav>
      </aside>

      <main className="event-workspace performance-workspace">
        <section className="command-deck" aria-labelledby="network-title">
          <div className="workspace-title">
            <h1 id="network-title">Network</h1>
            <span>Requests grouped by target and page</span>
          </div>
          <label className="control-field project-field" htmlFor="network-project-id">
            <span>Project</span>
            <CommittedInput
              ariaLabel="Project ID"
              id="network-project-id"
              key={`network-project-${search.project}`}
              value={search.project}
              validate={(value) => /^prj_[A-Za-z0-9_-]{1,120}$/.test(value)}
              onCommit={(project) => updateSearch({ project })}
            />
          </label>
          <label className="control-field" htmlFor="network-environment-id">
            <span>Environment</span>
            <CommittedInput
              ariaLabel="Environment"
              id="network-environment-id"
              key={`network-environment-${search.environment}`}
              value={search.environment}
              validate={(value) => value.length > 0 && value.length <= 64}
              onCommit={(environment) => updateSearch({ environment })}
            />
          </label>
          <label className="control-field select-field">
            <span>Time range</span>
            <SpectroIcon name="calendar" size={16} />
            <select
              aria-label="Time range"
              value={search.range}
              onChange={(event) => {
                const value = event.currentTarget.value;
                if (isTimeRange(value)) {
                  updateSearch({ range: value });
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
            <SpectroIcon name="chevron" size={16} />
          </label>
          <div className="command-actions">
            <button
              className="icon-button"
              type="button"
              aria-label="Refresh network"
              onClick={() => setQueryAnchor(Date.now())}
            >
              <SpectroIcon name="refresh" />
            </button>
            <button
              className="connection-button"
              type="button"
              onClick={() => setConnectionOpen((value) => !value)}
            >
              {token ? 'Connection' : 'Connect API'}
            </button>
          </div>
        </section>

        {connectionOpen ? (
          <section className="connection-panel" aria-labelledby="network-connection-title">
            <div>
              <h2 id="network-connection-title">Local query connection</h2>
              <p>The bearer token stays in this browser tab and is sent only as a header.</p>
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
              <button className="primary-button" type="submit" disabled={!tokenDraft.trim()}>
                Query local API
              </button>
            </form>
          </section>
        ) : null}

        {search.source === 'illustrative' ? (
          <section className="illustrative-banner" aria-live="polite">
            <span>Illustrative data</span>
            <p>These request groups demonstrate network investigation, not production telemetry.</p>
            <button type="button" onClick={() => setConnectionOpen(true)}>
              Connect ClickHouse query
            </button>
          </section>
        ) : null}

        <section className="performance-summary" aria-label="Loaded network summary">
          <div>
            <strong>{groups.length}</strong>
            <span>request groups</span>
          </div>
          <div>
            <strong>{requests}</strong>
            <span>requests</span>
          </div>
          <div>
            <strong>{failures}</strong>
            <span>failures</span>
          </div>
          <div>
            <strong>{sessions}</strong>
            <span>affected sessions</span>
          </div>
          <p>Counts reflect loaded groups in the selected {range.label.toLowerCase()} window.</p>
        </section>

        <section className="network-filters" aria-label="Network filters">
          <label className="release-filter">
            <span>Initiator</span>
            <select
              aria-label="Network initiator"
              value={search.initiator ?? ''}
              onChange={(event) => {
                const result = networkInitiatorSchema.safeParse(event.currentTarget.value);
                updateSearch({ initiator: result.success ? result.data : undefined });
              }}
            >
              <option value="">All initiators</option>
              {networkInitiatorSchema.options.map((value) => (
                <option key={value} value={value}>
                  {value.toUpperCase()}
                </option>
              ))}
            </select>
          </label>
          <label className="release-filter" htmlFor="network-method-filter">
            <span>Method</span>
            <CommittedInput
              ariaLabel="HTTP method"
              id="network-method-filter"
              key={`network-method-${search.method ?? ''}`}
              placeholder="All methods"
              value={search.method ?? ''}
              validate={(value) => value === '' || /^[A-Z]{1,16}$/.test(value)}
              onCommit={(method) => updateSearch({ method: method || undefined })}
            />
          </label>
          <label className="release-filter">
            <span>Outcome</span>
            <select
              aria-label="Request outcome"
              value={search.success === undefined ? '' : String(search.success)}
              onChange={(event) =>
                updateSearch({
                  success:
                    event.currentTarget.value === ''
                      ? undefined
                      : event.currentTarget.value === 'true',
                })
              }
            >
              <option value="">All outcomes</option>
              <option value="true">Successful</option>
              <option value="false">Failed</option>
            </select>
          </label>
          <button
            className="clear-button"
            type="button"
            onClick={() =>
              updateSearch({
                initiator: undefined,
                method: undefined,
                success: undefined,
                pagePath: undefined,
                release: undefined,
              })
            }
          >
            Clear
          </button>
        </section>

        <div className="performance-bench">
          <section className="performance-ledger" aria-labelledby="network-groups-title">
            <header className="panel-heading">
              <div>
                <h2 id="network-groups-title">Request groups</h2>
                <span>Most recently observed</span>
              </div>
              <output>{groups.length} loaded</output>
            </header>
            {networkQuery.isLoading ? (
              <output className="ledger-state loading-state">
                <span className="loading-line" />
                <span className="loading-line" />
                <p>Aggregating network requests…</p>
              </output>
            ) : networkQuery.error ? (
              <div className="ledger-state error-state" role="alert">
                <strong>Network data could not be loaded.</strong>
                <p>{networkQuery.error.message} Check the local API and token, then retry.</p>
              </div>
            ) : groups.length === 0 ? (
              <div className="ledger-state empty-state">
                <SpectroIcon name="network" size={26} />
                <strong>No request groups match this view.</strong>
                <p>Clear a filter or widen the selected time range.</p>
              </div>
            ) : (
              <div className="performance-rows">
                {groups.map((group) => {
                  const key = networkGroupKey(group);
                  const active = key === networkGroupKey(selected ?? group);
                  const failureRate =
                    group.requestCount === 0 ? 0 : (group.failureCount / group.requestCount) * 100;
                  return (
                    <button
                      className={`performance-row network-row ${active ? 'selected' : ''}`}
                      key={key}
                      type="button"
                      aria-current={active ? 'true' : undefined}
                      onClick={() => setSelectedKey(key)}
                    >
                      <span className="metric-badge">{group.method}</span>
                      <span className="metric-copy network-copy">
                        <strong>{formatNetworkTarget(group.url)}</strong>
                        <small>
                          {group.pagePath ?? 'Page unavailable'} · {group.initiator}
                        </small>
                      </span>
                      <span className="metric-value">
                        <strong>{Math.round(group.p75Duration)} ms</strong>
                        <small>P75</small>
                      </span>
                      <span className="metric-health">
                        <strong>{failureRate.toFixed(0)}%</strong>
                        <small>failed</small>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
            {!networkQuery.isLoading &&
            !networkQuery.error &&
            groups.length > 0 &&
            networkQuery.hasNextPage ? (
              <footer className="ledger-footer">
                <span>More request groups are available</span>
                <button
                  className="secondary-button"
                  type="button"
                  disabled={networkQuery.isFetchingNextPage}
                  onClick={() => void networkQuery.fetchNextPage()}
                >
                  {networkQuery.isFetchingNextPage ? 'Loading…' : 'Load more'}
                </button>
              </footer>
            ) : null}
          </section>
          {selected ? (
            <aside className="performance-detail" aria-labelledby="selected-network-title">
              <header>
                <span className="metric-badge">{selected.method}</span>
                <div>
                  <h2 id="selected-network-title">{formatNetworkTarget(selected.url)}</h2>
                  <p>
                    {selected.initiator} · {selected.pagePath ?? 'Page unavailable'}
                  </p>
                </div>
              </header>
              <dl className="performance-readout">
                <div>
                  <dt>Average</dt>
                  <dd>{Math.round(selected.averageDuration)} ms</dd>
                </div>
                <div>
                  <dt>P75</dt>
                  <dd>{Math.round(selected.p75Duration)} ms</dd>
                </div>
                <div>
                  <dt>P95</dt>
                  <dd>{Math.round(selected.p95Duration)} ms</dd>
                </div>
                <div>
                  <dt>Requests</dt>
                  <dd>{selected.requestCount}</dd>
                </div>
                <div>
                  <dt>Failures</dt>
                  <dd>{selected.failureCount}</dd>
                </div>
                <div>
                  <dt>Last status</dt>
                  <dd>{selected.latestStatus ?? 'Unavailable'}</dd>
                </div>
              </dl>
              <section className="rating-distribution" aria-label="Response distribution">
                <div>
                  <span>2xx</span>
                  <strong>{selected.status2xxCount}</strong>
                </div>
                <div>
                  <span>3xx</span>
                  <strong>{selected.status3xxCount}</strong>
                </div>
                <div>
                  <span>4xx</span>
                  <strong>{selected.status4xxCount}</strong>
                </div>
                <div>
                  <span>5xx</span>
                  <strong>{selected.status5xxCount}</strong>
                </div>
                <div>
                  <span>Transport failures</span>
                  <strong>{selected.transportFailureCount}</strong>
                </div>
              </section>
              <a
                className="occurrence-link"
                href={`/?${new URLSearchParams({ ...baseSearch, type: 'network', name: selected.initiator === 'resource' ? 'resource_request' : `${selected.initiator}_request`, event: selected.latestEventId, ...(selected.latestRelease ? { release: selected.latestRelease } : {}) }).toString()}`}
              >
                Inspect network events <span aria-hidden="true">→</span>
              </a>
              <p className="issue-scope-note">
                Durations and response classes reflect captured requests in this query window. URLs
                are stored without queries or credentials.
              </p>
            </aside>
          ) : (
            <aside className="performance-detail empty-detail">
              <SpectroIcon name="network" size={26} />
              <strong>Select a request group to inspect it.</strong>
            </aside>
          )}
        </div>
      </main>
    </div>
  );
}

function relativeTime(timestamp: number, anchor: number): string {
  const elapsed = Math.max(0, anchor - timestamp);
  if (elapsed < 60_000) return 'just now';
  if (elapsed < 60 * 60_000) return `${Math.floor(elapsed / 60_000)}m ago`;
  if (elapsed < 24 * 60 * 60_000) return `${Math.floor(elapsed / (60 * 60_000))}h ago`;
  return `${Math.floor(elapsed / (24 * 60 * 60_000))}d ago`;
}

function IssuesExplorer() {
  const search = issuesRoute.useSearch();
  const navigate = issuesRoute.useNavigate();
  const [token, setToken] = useState(readSessionToken);
  const [tokenDraft, setTokenDraft] = useState('');
  const [connectionOpen, setConnectionOpen] = useState(
    search.source === 'live' && token.length === 0,
  );
  const [credentialVersion, setCredentialVersion] = useState(0);
  const [queryAnchor, setQueryAnchor] = useState(() => Date.now());
  const range = TIME_RANGES[search.range];

  const updateSearch = (patch: Partial<IssueSearch>): void => {
    void navigate({ search: (previous) => ({ ...previous, ...patch }) });
  };
  const updateFilter = (patch: Partial<IssueSearch>): void => {
    updateSearch({ ...patch, issue: undefined });
  };

  const issuesQuery = useInfiniteQuery({
    queryKey: [
      'issues',
      search.project,
      search.environment,
      search.range,
      search.source,
      search.name,
      search.release,
      search.status,
      queryAnchor,
      credentialVersion,
    ],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) => {
      if (search.source === 'illustrative') {
        return { data: createIllustrativeIssues(queryAnchor, search) } satisfies IssuePage;
      }
      return fetchIssuePage({
        query: {
          projectId: search.project,
          environment: search.environment,
          from: queryAnchor - range.milliseconds,
          to: queryAnchor,
          limit: 50,
          ...(search.name === undefined ? {} : { name: search.name }),
          ...(search.release === undefined ? {} : { release: search.release }),
          ...(search.status === undefined ? {} : { status: search.status }),
          ...(pageParam === undefined ? {} : { cursor: pageParam }),
        },
        token,
        signal,
      });
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: search.source === 'illustrative' || token.length > 0,
  });

  const issues = useMemo(
    () => issuesQuery.data?.pages.flatMap((page) => page.data) ?? [],
    [issuesQuery.data],
  );
  const selectedIssue = issues.find((issue) => issue.fingerprint === search.issue) ?? issues[0];
  const occurrenceCount = issues.reduce((total, issue) => total + issue.occurrenceCount, 0);
  const sessionCount = issues.reduce((total, issue) => total + issue.affectedSessionCount, 0);

  const connect = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const nextToken = tokenDraft.trim();
    if (nextToken.length === 0) return;
    setToken(nextToken);
    writeSessionToken(nextToken);
    setCredentialVersion((value) => value + 1);
    setConnectionOpen(false);
    updateSearch({ source: 'live', issue: undefined });
    setQueryAnchor(Date.now());
  };

  const disconnect = (): void => {
    setToken('');
    setTokenDraft('');
    writeSessionToken('');
    setCredentialVersion((value) => value + 1);
    updateSearch({ source: 'illustrative', issue: undefined });
  };

  const eventSearch = new URLSearchParams({
    project: search.project,
    environment: search.environment,
    range: search.range,
    source: search.source,
  });

  return (
    <div className="console-shell issues-shell">
      <header className="console-topbar">
        <a className="wordmark" href="/" aria-label="Spectro events">
          <SpectroMark />
          spectro
        </a>
        <div className="topbar-actions">
          <div className="runtime-state">
            <span className={`status-light ${search.source}`} aria-hidden="true" />
            <span>
              {search.source === 'live' ? 'Local API connected' : 'Illustrative workspace'}
            </span>
          </div>
          <ThemeToggle />
        </div>
      </header>

      <aside className="console-rail" aria-label="Primary navigation">
        <nav>
          <a className="rail-link" href={`/?${eventSearch.toString()}`}>
            <SpectroIcon name="events" />
            <span>Events</span>
          </a>
          <a className="rail-link active" href="/issues" aria-current="page">
            <SpectroIcon name="issues" />
            <span>Issues</span>
          </a>
          <a
            className="rail-link"
            href={`/performance?${new URLSearchParams({
              project: search.project,
              environment: search.environment,
              range: search.range,
              source: search.source,
            }).toString()}`}
          >
            <SpectroIcon name="performance" />
            <span>Performance</span>
          </a>
          <a
            className="rail-link"
            href={`/network?${new URLSearchParams({
              project: search.project,
              environment: search.environment,
              range: search.range,
              source: search.source,
            }).toString()}`}
          >
            <SpectroIcon name="network" />
            <span>Network</span>
          </a>
          <span className="rail-link" aria-disabled="true" title="Coming after error issues">
            <SpectroIcon name="live" />
            <span>Live</span>
          </span>
          <span className="rail-link" aria-disabled="true" title="Coming after error issues">
            <SpectroIcon name="schemas" />
            <span>Schemas</span>
          </span>
        </nav>
        <nav className="rail-secondary" aria-label="Secondary navigation">
          <span className="rail-link" aria-disabled="true">
            <SpectroIcon name="settings" />
            <span>Settings</span>
          </span>
          <span className="rail-link" aria-disabled="true">
            <SpectroIcon name="book" />
            <span>API guide</span>
          </span>
        </nav>
      </aside>

      <main className="event-workspace issue-workspace">
        <section className="command-deck" aria-labelledby="issues-title">
          <div className="workspace-title">
            <h1 id="issues-title">Issues</h1>
            <span>Errors grouped by server fingerprint</span>
          </div>
          <label className="control-field project-field" htmlFor="issue-project-id">
            <span>Project</span>
            <CommittedInput
              ariaLabel="Project ID"
              id="issue-project-id"
              key={`issue-project-${search.project}`}
              value={search.project}
              validate={(value) => /^prj_[A-Za-z0-9_-]{1,120}$/.test(value)}
              onCommit={(project) => updateFilter({ project })}
            />
          </label>
          <label className="control-field" htmlFor="issue-environment-id">
            <span>Environment</span>
            <CommittedInput
              ariaLabel="Environment"
              id="issue-environment-id"
              key={`issue-environment-${search.environment}`}
              value={search.environment}
              validate={(value) => value.length > 0 && value.length <= 64}
              onCommit={(environment) => updateFilter({ environment })}
            />
          </label>
          <label className="control-field select-field">
            <span>Time range</span>
            <SpectroIcon name="calendar" size={16} />
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
            <SpectroIcon name="chevron" size={16} />
          </label>
          <div className="command-actions">
            <button
              className="icon-button"
              type="button"
              onClick={() => setQueryAnchor(Date.now())}
              aria-label="Refresh issues"
            >
              <SpectroIcon name="refresh" />
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
          <section className="connection-panel" aria-labelledby="issue-connection-title">
            <div>
              <h2 id="issue-connection-title">Local query connection</h2>
              <p>The bearer token stays in this browser tab and is sent only as a header.</p>
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
            <p>These grouped errors demonstrate investigation flow, not production telemetry.</p>
            <button type="button" onClick={() => setConnectionOpen(true)}>
              Connect ClickHouse query
            </button>
          </section>
        ) : null}

        <section className="issue-summary" aria-label="Loaded issue window summary">
          <div>
            <strong>{issues.length}</strong>
            <span>grouped issues</span>
          </div>
          <div>
            <strong>{occurrenceCount}</strong>
            <span>occurrences</span>
          </div>
          <div>
            <strong>{sessionCount}</strong>
            <span>affected sessions</span>
          </div>
          <p>Counts reflect the selected {range.label.toLowerCase()} window.</p>
        </section>

        <section className="issue-filters" aria-label="Issue filters">
          <label className="search-field" htmlFor="issue-name-filter">
            <SpectroIcon name="search" />
            <CommittedInput
              ariaLabel="Exact error event name"
              id="issue-name-filter"
              key={`issue-name-${search.name ?? ''}`}
              pattern="[a-z][a-z0-9_]{0,63}"
              placeholder="Exact error event name"
              title="For example, runtime_error"
              value={search.name ?? ''}
              validate={(value) => value.length === 0 || isEventName(value)}
              onCommit={(name) => updateFilter({ name: name || undefined })}
            />
          </label>
          <label className="release-filter" htmlFor="issue-release-filter">
            <span>Release</span>
            <CommittedInput
              ariaLabel="Release"
              id="issue-release-filter"
              key={`issue-release-${search.release ?? ''}`}
              placeholder="All releases"
              value={search.release ?? ''}
              validate={(value) => value.length <= 128}
              onCommit={(release) => updateFilter({ release: release || undefined })}
            />
          </label>
          <label className="release-filter">
            <span>Status</span>
            <select
              aria-label="Issue lifecycle status"
              value={search.status ?? ''}
              onChange={(event) =>
                updateFilter({
                  status:
                    event.currentTarget.value === ''
                      ? undefined
                      : (event.currentTarget.value as IssueStatus),
                })
              }
            >
              <option value="">All statuses</option>
              <option value="open">Open</option>
              <option value="resolved">Resolved</option>
              <option value="ignored">Ignored</option>
            </select>
          </label>
          <button
            className="clear-button"
            type="button"
            onClick={() => updateSearch({ name: undefined, release: undefined, issue: undefined })}
          >
            Clear
          </button>
        </section>

        <div className="issue-bench">
          <section className="issue-ledger" aria-labelledby="issue-ledger-title">
            <header className="panel-heading">
              <div>
                <h2 id="issue-ledger-title">Error groups</h2>
                <span>
                  {search.source === 'live' ? 'Most recently seen' : 'Illustrative groups'}
                </span>
              </div>
              <output>{issues.length} loaded</output>
            </header>
            {issuesQuery.isLoading ? (
              <output className="ledger-state loading-state">
                <span className="loading-line" />
                <span className="loading-line" />
                <p>Grouping error signals…</p>
              </output>
            ) : issuesQuery.error ? (
              <div className="ledger-state error-state" role="alert">
                <strong>Issues could not be loaded.</strong>
                <p>{issuesQuery.error.message} Check the local API and token, then retry.</p>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => void issuesQuery.refetch()}
                >
                  Try again
                </button>
              </div>
            ) : issues.length === 0 ? (
              <div className="ledger-state empty-state">
                <SpectroIcon name="issues" size={24} />
                <strong>No grouped errors match this view.</strong>
                <p>Clear a filter or widen the selected time range.</p>
              </div>
            ) : (
              <div className="issue-rows">
                {issues.map((issue) => {
                  const selected = issue.fingerprint === selectedIssue?.fingerprint;
                  return (
                    <button
                      className={`issue-row ${selected ? 'selected' : ''}`}
                      key={issue.fingerprint}
                      type="button"
                      aria-label={`Inspect ${issue.name ?? 'error'}: ${issue.message}`}
                      aria-current={selected ? 'true' : undefined}
                      onClick={() => updateSearch({ issue: issue.fingerprint })}
                    >
                      <span className="issue-signal" aria-hidden="true" />
                      <span className="issue-copy">
                        <strong>{issue.name ?? 'Error'}</strong>
                        <span>{issue.message}</span>
                        <small>
                          {issue.latestPagePath ?? 'Page unavailable'} ·{' '}
                          {issue.latestRelease ?? 'Release unavailable'}
                        </small>
                      </span>
                      <span className="issue-impact">
                        <strong>{issue.occurrenceCount}</strong>
                        <span>events</span>
                        <time dateTime={new Date(issue.lastSeen).toISOString()}>
                          {relativeTime(issue.lastSeen, queryAnchor)}
                        </time>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
            {!issuesQuery.isLoading && !issuesQuery.error && issues.length > 0 ? (
              <footer className="ledger-footer">
                <span>
                  {issuesQuery.hasNextPage
                    ? 'More issue groups are available'
                    : 'End of issue window'}
                </span>
                {issuesQuery.hasNextPage ? (
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={issuesQuery.isFetchingNextPage}
                    onClick={() => void issuesQuery.fetchNextPage()}
                  >
                    {issuesQuery.isFetchingNextPage ? 'Loading…' : 'Load more'}
                  </button>
                ) : null}
              </footer>
            ) : null}
          </section>

          <IssueDetail
            anchor={queryAnchor}
            issue={selectedIssue}
            search={search}
            token={token}
            onUpdated={() => void issuesQuery.refetch()}
          />
        </div>
      </main>
    </div>
  );
}

function IssueDetail({
  anchor,
  issue,
  onUpdated,
  search,
  token,
}: {
  readonly anchor: number;
  readonly issue: ErrorIssue | undefined;
  readonly onUpdated: () => void;
  readonly search: IssueSearch;
  readonly token: string;
}) {
  const history = useQuery({
    queryKey: ['issue-history', search.project, search.environment, issue?.fingerprint, token],
    queryFn: ({ signal }) => {
      if (issue === undefined) throw new Error('Select an issue before loading its history.');
      return fetchIssueHistory({
        projectId: search.project,
        environment: search.environment,
        fingerprint: issue.fingerprint,
        token,
        signal,
      });
    },
    enabled: search.source === 'live' && token.length > 0 && issue !== undefined,
  });
  const lifecycle = useMutation({
    mutationFn: (status: IssueStatus) => {
      if (issue === undefined) throw new Error('Select an issue before changing its status.');
      return updateIssueStatus({
        projectId: search.project,
        environment: search.environment,
        fingerprint: issue.fingerprint,
        status,
        token,
      });
    },
    onSuccess: () => {
      onUpdated();
      void history.refetch();
    },
  });

  if (!issue) {
    return (
      <aside className="issue-detail empty-detail" aria-label="Issue detail">
        <SpectroIcon name="issues" size={26} />
        <strong>Select an issue to inspect it.</strong>
        <p>Its impact and latest available context will appear here.</p>
      </aside>
    );
  }

  const occurrences = new URLSearchParams({
    project: search.project,
    environment: search.environment,
    range: search.range,
    source: search.source,
    type: 'error',
    fingerprint: issue.fingerprint,
    event: issue.latestEventId,
  });

  return (
    <aside className="issue-detail" aria-labelledby="selected-issue-name">
      <header className="issue-detail-heading">
        <span className="issue-signal" aria-hidden="true" />
        <div>
          <h2 id="selected-issue-name">{issue.name ?? 'Error'}</h2>
          <p>{issue.message}</p>
        </div>
      </header>
      <div className="issue-statline">
        <div>
          <strong>{issue.occurrenceCount}</strong>
          <span>Occurrences</span>
        </div>
        <div>
          <strong>{issue.affectedSessionCount}</strong>
          <span>Sessions</span>
        </div>
        <div>
          <strong>{issue.affectedUserCount}</strong>
          <span>Users</span>
        </div>
      </div>
      <section className="issue-lifecycle" aria-labelledby="issue-status-title">
        <div>
          <span id="issue-status-title">Lifecycle status</span>
          <strong>{issue.status}</strong>
        </div>
        <div className="status-actions" aria-label="Set issue lifecycle status">
          {(['open', 'resolved', 'ignored'] as const).map((status) => (
            <button
              type="button"
              key={status}
              aria-pressed={issue.status === status}
              disabled={search.source !== 'live' || lifecycle.isPending}
              onClick={() => lifecycle.mutate(status)}
            >
              {status}
            </button>
          ))}
        </div>
        {search.source !== 'live' ? <p>Connect the API to persist lifecycle changes.</p> : null}
        {lifecycle.isError ? <p role="alert">{lifecycle.error.message}</p> : null}
      </section>
      {search.source === 'live' ? (
        <section className="issue-history" aria-labelledby="issue-history-title">
          <div className="issue-history-heading">
            <span id="issue-history-title">Recent changes</span>
            {history.isFetching ? <small>Refreshing…</small> : null}
          </div>
          {history.isError ? <p role="alert">{history.error.message}</p> : null}
          {history.data?.data.length === 0 ? <p>No lifecycle changes recorded yet.</p> : null}
          {history.data?.data.length ? (
            <ol>
              {history.data.data.map((record) => (
                <li key={record.id}>
                  <span>
                    {record.previousStatus === undefined
                      ? 'Created as'
                      : `${record.previousStatus} →`}{' '}
                    <strong>{record.status}</strong>
                  </span>
                  <time dateTime={record.changedAt}>
                    {formatDateTime(Date.parse(record.changedAt))}
                  </time>
                </li>
              ))}
            </ol>
          ) : null}
        </section>
      ) : null}
      <dl className="issue-readout">
        <div>
          <dt>First seen</dt>
          <dd>{formatDateTime(issue.firstSeen)}</dd>
        </div>
        <div>
          <dt>Last seen</dt>
          <dd>{relativeTime(issue.lastSeen, anchor)}</dd>
        </div>
        <div>
          <dt>Latest page</dt>
          <dd>{issue.latestPagePath ?? 'Not available'}</dd>
        </div>
        <div>
          <dt>Latest release</dt>
          <dd>{issue.latestRelease ?? 'Not available'}</dd>
        </div>
        <div className="fingerprint-readout">
          <dt>Fingerprint</dt>
          <dd>{issue.fingerprint}</dd>
        </div>
      </dl>
      <a className="occurrence-link" href={`/?${occurrences.toString()}`}>
        View matching events
        <span aria-hidden="true">→</span>
      </a>
      <p className="issue-scope-note">
        Counts are calculated inside this query window. Lifecycle status persists across windows;
        ownership is not part of this version.
      </p>
    </aside>
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
  search,
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
  readonly search: ExplorerSearch;
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
          <SpectroIcon name="filter" size={24} />
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
                    <td className="telemetry-cell">
                      {item.event.context.session?.id ? (
                        <a
                          className="session-link"
                          href={buildSessionHref(
                            item.event.context.session.id,
                            search,
                            item.event.id,
                          )}
                        >
                          {item.event.context.session.id}
                        </a>
                      ) : (
                        '—'
                      )}
                    </td>
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
  search,
  tab,
  onTabChange,
}: {
  readonly event: EventListItem | undefined;
  readonly search: ExplorerSearch;
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
        <SpectroIcon name="events" size={26} />
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
                <dd>
                  {context.session?.id ? (
                    <a
                      className="session-link"
                      href={buildSessionHref(context.session.id, search, event.event.id)}
                    >
                      {context.session.id}
                    </a>
                  ) : (
                    'Not available'
                  )}
                </dd>
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
            <PayloadViewer value={event.event.payload} />
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
