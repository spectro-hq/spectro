import { Link } from '@tanstack/react-router';
import type { EventListItem, ExplorerSearch } from './event-query.js';

import { formatSessionMetric } from './session-timeline.js';
import { PayloadViewer } from './payload-viewer.js';
import { SpectroIcon } from './spectro-icons.js';

export const eventTypeLabels = {
  session: 'Session',
  page: 'Page',
  error: 'Error',
  performance: 'Performance',
  network: 'Network',
  interaction: 'Interaction',
  custom: 'Custom',
} as const;

export type DetailTab = 'event' | 'context' | 'raw';

export function formatTimestamp(timestamp: number): string {
  return new Intl.DateTimeFormat('en', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
    hour12: false,
  }).format(timestamp);
}

export function formatTimelineTimestamp(timestamp: number): string {
  return new Intl.DateTimeFormat('en', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(timestamp);
}

export function formatDateTime(timestamp: number): string {
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(timestamp);
}

export function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function eventSummary(item: EventListItem): string {
  const payload = item.event.payload;
  if (item.event.type === 'error' && typeof payload.message === 'string') return payload.message;
  if (item.event.type === 'performance' && typeof payload.value === 'number') {
    return formatSessionMetric(payload.value, payload.unit);
  }
  if (item.event.type === 'network' && isUnknownRecord(payload.request)) {
    const request = payload.request;
    return [request.method, request.url].filter((part) => typeof part === 'string').join(' ');
  }
  return eventTypeLabels[item.event.type];
}

export function EventDetail({
  event,
  search,
  tab,
  onTabChange,
  showProcessingTime = false,
}: {
  readonly showProcessingTime?: boolean;
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
          <div className="detail-title">
            <span className={`detail-signal ${event.event.type}`} aria-hidden="true" />
            <h2 id="selected-event-name">{event.event.name}</h2>
          </div>
          <p>{showProcessingTime ? eventTypeLabels[event.event.type] : eventSummary(event)}</p>
        </div>
        <time dateTime={new Date(event.event.timestamp).toISOString()}>
          {showProcessingTime ? 'Occurred ' : ''}
          {formatDateTime(event.event.timestamp)}
          {showProcessingTime ? (
            <span className="live-processed-time">
              Processed {formatDateTime(event.processing.processedAt)}
            </span>
          ) : null}
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
                    <Link
                      className="session-link"
                      to="/sessions/$sessionId"
                      params={{ sessionId: context.session.id }}
                      search={{
                        ...(search.organization === undefined
                          ? {}
                          : { organization: search.organization }),
                        project: search.project,
                        environment: search.environment,
                        range: search.range,
                        source: search.source,
                        event: event.event.id,
                      }}
                    >
                      {context.session.id}
                    </Link>
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
