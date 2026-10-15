import { isTimeRange, type DataSource, type TimeRange } from './event-query.js';

export interface SessionSearch {
  readonly organization?: string | undefined;
  readonly project: string;
  readonly environment: string;
  readonly range: TimeRange;
  readonly source: DataSource;
  readonly event?: string | undefined;
}

function optionalBoundedString(value: unknown, maxLength: number): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength
    ? value
    : undefined;
}

export function parseSessionSearch(search: Record<string, unknown>): SessionSearch {
  const organization =
    typeof search.organization === 'string' &&
    /^org_[A-Za-z0-9_-]{1,120}$/.test(search.organization)
      ? search.organization
      : undefined;
  const project =
    typeof search.project === 'string' && /^prj_[A-Za-z0-9_-]{1,120}$/.test(search.project)
      ? search.project
      : 'prj_checkout';
  const environment = optionalBoundedString(search.environment, 64) ?? 'production';
  const range =
    typeof search.range === 'string' && isTimeRange(search.range) ? search.range : '24h';
  const event = optionalBoundedString(search.event, 128);

  return {
    ...(organization === undefined ? {} : { organization }),
    project,
    environment,
    range,
    source: search.source === 'live' ? 'live' : 'illustrative',
    ...(event === undefined ? {} : { event }),
  };
}
