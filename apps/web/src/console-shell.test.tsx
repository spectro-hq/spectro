import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ConsoleShell } from './console-shell.js';

const routerMock = vi.hoisted(() => ({
  hrefFor(to: string, search?: Record<string, unknown>): string {
    const query = new URLSearchParams(
      Object.entries(search ?? {}).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    ).toString();
    return query === '' ? to : `${to}?${query}`;
  },
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    search,
    children,
    ...rest
  }: {
    to: string;
    search?: Record<string, unknown>;
    children?: ReactNode;
  }) => (
    <a href={routerMock.hrefFor(to, search)} {...rest}>
      {children}
    </a>
  ),
  useLocation: (options?: { select?: (location: { pathname: string }) => string }) =>
    options?.select ? options.select({ pathname: '/' }) : { pathname: '/' },
  useNavigate: () => vi.fn<(options: unknown) => Promise<void>>(),
}));

vi.mock('./console-shared.js', () => ({
  ThemeToggle: () => null,
}));

describe('ConsoleShell', () => {
  it('places the full-height sidebar before the main-column header', () => {
    const markup = renderToStaticMarkup(
      <ConsoleShell
        title="Events"
        search={{
          project: 'prj_test',
          environment: 'test',
          range: '30m',
          source: 'illustrative',
        }}
      >
        <main>Events content</main>
      </ConsoleShell>,
    );

    expect(markup.indexOf('id="console-sidebar"')).toBeLessThan(
      markup.indexOf('class="console-topbar shared-topbar"'),
    );
    expect(markup).toContain('class="rail-brand desktop-rail-brand"');
    expect(markup).toContain('aria-label="Breadcrumb"');
  });

  it('renders internal navigation links with scope search params preserved', () => {
    const markup = renderToStaticMarkup(
      <ConsoleShell
        title="Events"
        search={{
          organization: 'org_test',
          project: 'prj_test',
          environment: 'test',
          range: '30m',
          source: 'live',
        }}
      >
        <main>Events content</main>
      </ConsoleShell>,
    );

    expect(markup).toContain(
      'href="/issues?organization=org_test&amp;project=prj_test&amp;environment=test&amp;range=30m&amp;source=live"',
    );
    expect(markup).toContain(
      'href="/settings?organization=org_test&amp;project=prj_test&amp;environment=test&amp;range=30m&amp;source=live&amp;section=project"',
    );
  });
});
