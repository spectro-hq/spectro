import { ConsoleShell } from './console-shell.js';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useMemo, useState, type FormEvent } from 'react';

import { CommittedInput, readSessionToken, writeSessionToken } from './console-shared.js';
import { isTimeRange, TIME_RANGES } from './event-query.js';
import { createIllustrativeReleases } from './illustrative-releases.js';
import {
  fetchReleasePage,
  type ReleaseHealth,
  type ReleasePage,
  type ReleaseSearch,
} from './release-query.js';
import { SpectroIcon } from './spectro-icons.js';

function rate(count: number, total: number): string {
  return total === 0 ? '0%' : `${((count / total) * 100).toFixed(count / total < 0.01 ? 2 : 1)}%`;
}

function releaseKey(release: ReleaseHealth): string {
  return release.release;
}

function observationWindow(release: ReleaseHealth): string {
  const formatter = new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${formatter.format(release.firstSeen)} – ${formatter.format(release.lastSeen)}`;
}

export function ReleaseHealthExplorer() {
  const search = useSearch({ from: '/releases' });
  const navigate = useNavigate({ from: '/releases' });
  const [token, setToken] = useState(readSessionToken);
  const [tokenDraft, setTokenDraft] = useState('');
  const [connectionOpen, setConnectionOpen] = useState(
    search.source === 'live' && token.length === 0,
  );
  const [credentialVersion, setCredentialVersion] = useState(0);
  const [queryAnchor, setQueryAnchor] = useState(() => Date.now());
  const [selectedKey, setSelectedKey] = useState<string>();
  const range = TIME_RANGES[search.range];

  const updateSearch = (patch: Partial<ReleaseSearch>): void => {
    void navigate({ search: (previous) => ({ ...previous, ...patch }) });
  };

  const releaseQuery = useInfiniteQuery({
    queryKey: [
      'releases',
      search.project,
      search.environment,
      search.range,
      search.source,
      queryAnchor,
      credentialVersion,
    ],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) => {
      if (search.source === 'illustrative')
        return createIllustrativeReleases(queryAnchor, search) satisfies ReleasePage;
      return fetchReleasePage({
        query: {
          projectId: search.project,
          environment: search.environment,
          from: queryAnchor - range.milliseconds,
          to: queryAnchor,
          limit: 20,
          ...(pageParam ? { cursor: pageParam } : {}),
        },
        token,
        signal,
      });
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: search.source === 'illustrative' || token.length > 0,
  });

  const releases = useMemo(
    () => releaseQuery.data?.pages.flatMap((page) => page.data) ?? [],
    [releaseQuery.data],
  );
  const selected = releases.find((release) => releaseKey(release) === selectedKey) ?? releases[0];
  const totalEvents = releases.reduce((sum, release) => sum + release.eventCount, 0);
  const totalErrors = releases.reduce((sum, release) => sum + release.errorCount, 0);
  const degradedSignals = releases.reduce(
    (sum, release) =>
      sum + release.errorCount + release.poorPerformanceCount + release.networkFailureCount,
    0,
  );
  const queryEnabled = search.source === 'illustrative' || token.length > 0;

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
    <ConsoleShell title="Releases" search={search}>
      <main className="event-workspace performance-workspace release-workspace">
        <section className="command-deck" aria-labelledby="release-title">
          <div className="workspace-title">
            <h1 id="release-title">Releases</h1>
            <span>Health across product signals</span>
          </div>
          <label className="control-field project-field" htmlFor="release-project-id">
            <span>Project</span>
            <CommittedInput
              ariaLabel="Project ID"
              id="release-project-id"
              key={search.project}
              value={search.project}
              validate={(value) => /^prj_[A-Za-z0-9_-]{1,120}$/.test(value)}
              onCommit={(project) => updateSearch({ project })}
            />
          </label>
          <label className="control-field" htmlFor="release-environment-id">
            <span>Environment</span>
            <CommittedInput
              ariaLabel="Environment"
              id="release-environment-id"
              key={search.environment}
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
              aria-label="Refresh releases"
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
          <section className="connection-panel" aria-labelledby="release-connection-title">
            <div>
              <h2 id="release-connection-title">Local query connection</h2>
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
            <p>These versions demonstrate release investigation, not production telemetry.</p>
            <button type="button" onClick={() => setConnectionOpen(true)}>
              Connect ClickHouse query
            </button>
          </section>
        ) : null}

        <section className="release-overview" aria-label="Loaded release summary">
          {!queryEnabled ? (
            <div className="release-overview-state">
              <strong>Connect the local API to inspect release health.</strong>
              <span>No release totals are shown until credentials are available.</span>
            </div>
          ) : releaseQuery.isLoading ? (
            <div className="release-overview-state" aria-live="polite">
              <strong>Reading version signals…</strong>
              <span>Aggregating bounded evidence for this query window.</span>
            </div>
          ) : releaseQuery.error ? (
            <div className="release-overview-state error-state" role="alert">
              <strong>Release summary is unavailable.</strong>
              <span>Check the local API and token, then retry.</span>
            </div>
          ) : (
            <>
              <div className="release-overview-lead">
                <span>Observed releases</span>
                <strong>{releases.length}</strong>
                <p>
                  Versions carrying evidence in the selected {range.label.toLowerCase()} window.
                </p>
              </div>
              <dl>
                <div>
                  <dt>Captured events</dt>
                  <dd>{totalEvents.toLocaleString()}</dd>
                </div>
                <div>
                  <dt>Error share</dt>
                  <dd>{rate(totalErrors, totalEvents)}</dd>
                </div>
                <div>
                  <dt>Degraded signals</dt>
                  <dd>{degradedSignals.toLocaleString()}</dd>
                </div>
              </dl>
            </>
          )}
        </section>

        <div className="performance-bench release-bench">
          <section className="performance-ledger" aria-labelledby="release-list-title">
            <header className="panel-heading">
              <div>
                <h2 id="release-list-title">Release evidence</h2>
                <span>Latest observed first</span>
              </div>
              <output>{releases.length} loaded</output>
            </header>
            {!queryEnabled ? (
              <div className="ledger-state empty-state">
                <SpectroIcon name="release" size={26} />
                <strong>Release evidence is not connected.</strong>
                <p>Add a local API token to query this project.</p>
              </div>
            ) : releaseQuery.isLoading ? (
              <output className="ledger-state loading-state">
                <span className="loading-line" />
                <span className="loading-line" />
                <p>Reading version signals…</p>
              </output>
            ) : releaseQuery.error ? (
              <div className="ledger-state error-state" role="alert">
                <strong>Release evidence could not be loaded.</strong>
                <p>{releaseQuery.error.message} Check the local API and token, then retry.</p>
              </div>
            ) : releases.length === 0 ? (
              <div className="ledger-state empty-state">
                <SpectroIcon name="release" size={26} />
                <strong>No versioned events in this window.</strong>
                <p>Widen the range or verify release context in the SDK.</p>
              </div>
            ) : (
              <div className="performance-rows">
                {releases.map((release) => {
                  const active = release.release === selected?.release;
                  return (
                    <button
                      className={`performance-row release-row ${active ? 'selected' : ''}`}
                      key={release.release}
                      type="button"
                      aria-current={active ? 'true' : undefined}
                      onClick={() => setSelectedKey(release.release)}
                    >
                      <span className="release-glyph">
                        <SpectroIcon name="release" size={17} />
                      </span>
                      <span className="metric-copy">
                        <strong>{release.release}</strong>
                        <small>
                          {release.affectedSessionCount.toLocaleString()} sessions observed
                        </small>
                      </span>
                      <span className="metric-value">
                        <strong>{rate(release.errorCount, release.eventCount)}</strong>
                        <small>errors</small>
                      </span>
                      <span className="metric-health">
                        <strong>{release.eventCount.toLocaleString()}</strong>
                        <small>events</small>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
            {releaseQuery.hasNextPage ? (
              <footer className="ledger-footer">
                <span>Earlier releases are available</span>
                <button
                  className="secondary-button"
                  type="button"
                  disabled={releaseQuery.isFetchingNextPage}
                  onClick={() => void releaseQuery.fetchNextPage()}
                >
                  {releaseQuery.isFetchingNextPage ? 'Loading…' : 'Load more'}
                </button>
              </footer>
            ) : null}
          </section>

          {selected ? (
            <aside
              className="performance-detail release-detail"
              aria-labelledby="selected-release-title"
            >
              <header>
                <span className="release-glyph">
                  <SpectroIcon name="release" size={18} />
                </span>
                <div>
                  <h2 id="selected-release-title">{selected.release}</h2>
                  <p>{observationWindow(selected)}</p>
                </div>
              </header>
              <dl className="performance-readout">
                <div>
                  <dt>Error share</dt>
                  <dd>{rate(selected.errorCount, selected.eventCount)}</dd>
                </div>
                <div>
                  <dt>Errors</dt>
                  <dd>{selected.errorCount.toLocaleString()}</dd>
                </div>
                <div>
                  <dt>Poor performance</dt>
                  <dd>{selected.poorPerformanceCount.toLocaleString()}</dd>
                </div>
                <div>
                  <dt>Network failures</dt>
                  <dd>{selected.networkFailureCount.toLocaleString()}</dd>
                </div>
                <div>
                  <dt>Sessions</dt>
                  <dd>{selected.affectedSessionCount.toLocaleString()}</dd>
                </div>
                <div>
                  <dt>Evidence</dt>
                  <dd>{selected.eventCount.toLocaleString()}</dd>
                </div>
              </dl>
              <div className="release-signal-stack">
                <a
                  href={`/issues?${new URLSearchParams({ ...baseSearch, release: selected.release }).toString()}`}
                >
                  <span>Errors</span>
                  <strong>{selected.errorCount.toLocaleString()}</strong>
                  <small>{rate(selected.errorCount, selected.eventCount)} of events</small>
                </a>
                <a
                  href={`/performance?${new URLSearchParams({ ...baseSearch, release: selected.release }).toString()}`}
                >
                  <span>Performance</span>
                  <strong>{selected.poorPerformanceCount.toLocaleString()}</strong>
                  <small>poor-rated samples</small>
                </a>
                <a
                  href={`/network?${new URLSearchParams({ ...baseSearch, release: selected.release }).toString()}`}
                >
                  <span>Network</span>
                  <strong>{selected.networkFailureCount.toLocaleString()}</strong>
                  <small>failed requests</small>
                </a>
              </div>
              <a
                className="occurrence-link"
                href={`/?${new URLSearchParams({ ...baseSearch, release: selected.release }).toString()}`}
              >
                Inspect all release events <span aria-hidden="true">→</span>
              </a>
              <p className="issue-scope-note">
                Signals are shown separately; Spectro does not manufacture a composite health score.
              </p>
            </aside>
          ) : (
            <aside className="performance-detail empty-detail">
              <SpectroIcon name="release" size={26} />
              <strong>Select a release to inspect it.</strong>
            </aside>
          )}
        </div>
      </main>
    </ConsoleShell>
  );
}
