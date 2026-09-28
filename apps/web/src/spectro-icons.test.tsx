import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { SpectroIcon } from './spectro-icons.js';

describe('SpectroIcon', () => {
  it('renders the Events waveform mark on a 24-unit canvas', () => {
    const markup = renderToStaticMarkup(createElement(SpectroIcon, { name: 'events' }));

    expect(markup).toContain('viewBox="0 0 24 24"');
    expect(markup).toContain('d="M3.5 12H7.5L9.5 8L12 16L14.5 10L16 12H20.5"');
  });
});
