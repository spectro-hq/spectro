import { useInfiniteQuery } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useMemo, useState, type FormEvent } from 'react';

import {
  CommittedInput,
  readSessionToken,
  ThemeToggle,
  writeSessionToken,
} from './console-shared.js';
import { isTimeRange, TIME_RANGES } from './event-query.js';
import { createIllustrativePerformance } from './illustrative-performance.js';
import {
  fetchPerformancePage,
  performanceMetricSchema,
  type PerformanceGroup,
  type PerformancePage,
  type PerformanceSearch,
} from './performance-query.js';
import { SpectroIcon, SpectroMark } from './spectro-icons.js';

function formatMetricValue(value: number, unit: 'ms' | 'score'): string {
  if (unit === 'score') return value.toFixed(2);
  return `${Math.round(value).toLocaleString()} ms`;
}

function relativeTime(timestamp: number, anchor: number): string {
  const elapsed = Math.max(0, anchor - timestamp);
  if (elapsed < 60_000) return 'just now';
  if (elapsed < 60 * 60_000) return `${Math.floor(elapsed / 60_000)}m ago`;
  if (elapsed < 24 * 60 * 60_000) return `${Math.floor(elapsed / (60 * 60_000))}h ago`;
  return `${Math.floor(elapsed / (24 * 60 * 60_000))}d ago`;
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

export function PerformanceExplorer() {
  const search = useSearch({ from: '/performance' });
  const navigate = useNavigate({ from: '/performance' });
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
          <a className="rail-link" href={`/releases?${new URLSearchParams(baseSearch).toString()}`}>
            <SpectroIcon name="release" />
            <span>Releases</span>
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
