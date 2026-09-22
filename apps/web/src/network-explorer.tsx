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
import { createIllustrativeNetwork } from './illustrative-network.js';
import {
  fetchNetworkPage,
  formatNetworkTarget,
  networkInitiatorSchema,
  type NetworkGroup,
  type NetworkPage,
  type NetworkSearch,
} from './network-query.js';
import { SpectroIcon, SpectroMark } from './spectro-icons.js';

function networkGroupKey(group: NetworkGroup): string {
  return `${group.initiator}:${group.method}:${group.url}:${group.pagePath ?? ''}`;
}

export function NetworkExplorer() {
  const search = useSearch({ from: '/network' });
  const navigate = useNavigate({ from: '/network' });
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
