import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { ConsoleShell } from './console-shell.js';

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
});
