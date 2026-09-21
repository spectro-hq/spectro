import type { ReactNode } from 'react';

export type SpectroIconName =
  | 'book'
  | 'calendar'
  | 'check'
  | 'chevron'
  | 'copy'
  | 'events'
  | 'filter'
  | 'interaction'
  | 'issues'
  | 'live'
  | 'network'
  | 'page'
  | 'performance'
  | 'refresh'
  | 'schemas'
  | 'search'
  | 'session'
  | 'settings'
  | 'moon'
  | 'sun';

const iconPaths: Readonly<Record<SpectroIconName, ReactNode>> = {
  book: (
    <>
      <path d="M3.25 4.75A2.25 2.25 0 0 1 5.5 2.5H9v14.75H5.5A2.25 2.25 0 0 0 3.25 19.5Z" />
      <path d="M16.75 4.75A2.25 2.25 0 0 0 14.5 2.5H11v14.75h3.5a2.25 2.25 0 0 1 2.25 2.25Z" />
    </>
  ),
  calendar: (
    <>
      <path d="M5.5 2.5v3m9-3v3M3 7.5h14" />
      <rect height="14" rx="2.25" width="14" x="3" y="4" />
      <path d="M6.5 11h2m3 0h2m-7 3h2" />
    </>
  ),
  check: <path d="m4 10.5 3.5 3.5L16 5.5" />,
  chevron: <path d="m6.5 8 3.5 3.5L13.5 8" />,
  copy: (
    <>
      <rect height="11" rx="2" width="11" x="6" y="6" />
      <path d="M14 6V4.5A1.5 1.5 0 0 0 12.5 3h-9A1.5 1.5 0 0 0 2 4.5v9A1.5 1.5 0 0 0 3.5 15H6" />
    </>
  ),
  events: <path d="M3 9v2m3.5-5v8m3.5-11v14m3.5-11v8M17 9v2" />,
  filter: (
    <>
      <path d="M2.5 4h15l-6 6.5v4.25l-3 1.75v-6Z" />
      <circle cx="15.75" cy="15.75" r="1.75" />
    </>
  ),
  interaction: (
    <>
      <path d="m6 3 7.25 7.25-3.1.65 2.4 4.15-2.4 1.4-2.35-4.1-2.05 2.45Z" />
      <path d="M13.75 3.25v2m3 1.25-1.5 1.25M10 2.5l.25 2" />
    </>
  ),
  issues: (
    <>
      <path d="M10 2.25 17 6.25v7.5l-7 4-7-4v-7.5Z" />
      <path d="M10 6.25v4.25m0 3v.25" />
    </>
  ),
  live: (
    <>
      <circle cx="10" cy="12" r="1.5" />
      <path d="M6.5 14.25a5 5 0 1 1 7 0M3.75 16a8 8 0 1 1 12.5 0" />
    </>
  ),
  network: (
    <>
      <circle cx="4" cy="10" r="1.5" />
      <circle cx="16" cy="5" r="1.5" />
      <circle cx="16" cy="15" r="1.5" />
      <path d="m5.5 9.35 9-3.7m-9 5 9 3.7" />
    </>
  ),
  page: (
    <>
      <path d="M4 2.5h8l4 4v11H4Z" />
      <path d="M12 2.5v4h4M7 10h6m-6 3h4" />
    </>
  ),
  performance: (
    <>
      <path d="M3 14.75a8 8 0 0 1 14 0" />
      <path d="m10 11 3.75-4.25" />
      <circle cx="10" cy="11" r="1.25" />
      <path d="M5.25 12.25 4 11.5m10.75.75L16 11.5M10 5v1.5" />
    </>
  ),
  refresh: (
    <>
      <path d="M16.75 6.5V3.25H13.5M3.25 13.5v3.25H6.5" />
      <path d="M15.8 8A6.25 6.25 0 0 0 5.1 5.75L3.25 7.5m13.5 5-1.85 1.75A6.25 6.25 0 0 1 4.2 12" />
    </>
  ),
  schemas: (
    <>
      <ellipse cx="10" cy="4.5" rx="6.5" ry="2.25" />
      <path d="M3.5 4.5v5c0 1.25 2.9 2.25 6.5 2.25s6.5-1 6.5-2.25v-5M3.5 9.5v5c0 1.25 2.9 2.25 6.5 2.25s6.5-1 6.5-2.25v-5" />
    </>
  ),
  search: (
    <>
      <circle cx="8.75" cy="8.75" r="5.75" />
      <path d="m13 13 4 4" />
      <circle cx="8.75" cy="8.75" r="1" />
    </>
  ),
  session: (
    <>
      <circle cx="10" cy="6" r="3" />
      <path d="M4 17c.5-3.25 2.5-5 6-5s5.5 1.75 6 5" />
      <path d="M15.25 9.25h2.25v2.25" />
    </>
  ),
  moon: <path d="M16.5 13.25A7 7 0 0 1 6.75 3.5 7.25 7.25 0 1 0 16.5 13.25Z" />,
  settings: (
    <>
      <path d="M3 5h4m4 0h6M3 10h8m4 0h2M3 15h2m4 0h8" />
      <circle cx="9" cy="5" r="2" />
      <circle cx="13" cy="10" r="2" />
      <circle cx="7" cy="15" r="2" />
    </>
  ),
  sun: (
    <>
      <circle cx="10" cy="10" r="3.25" />
      <path d="M10 1.75v1.5m0 13.5v1.5M1.75 10h1.5m13.5 0h1.5M4.15 4.15l1.1 1.1m9.5 9.5 1.1 1.1m0-11.7-1.1 1.1m-9.5 9.5-1.1 1.1" />
    </>
  ),
};

export function SpectroIcon({
  name,
  size = 18,
}: {
  readonly name: SpectroIconName;
  readonly size?: number;
}) {
  return (
    <svg
      aria-hidden="true"
      className="icon spectro-icon"
      fill="none"
      height={size}
      viewBox="0 0 20 20"
      width={size}
    >
      <g stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5">
        {iconPaths[name]}
      </g>
    </svg>
  );
}

export function SpectroMark({ size = 22 }: { readonly size?: number }) {
  return (
    <img
      alt=""
      aria-hidden="true"
      className="spectro-mark"
      height={size}
      src="/spectro-logo.png"
      width={size}
    />
  );
}
