import { describe, expect, it } from 'vitest';

import { buildSessionHref, parseSessionSearch } from './session-query.js';

describe('parseSessionSearch', () => {
  it('keeps valid shareable state and applies safe defaults', () => {
    expect(
      parseSessionSearch({
        project: 'prj_storefront',
        environment: 'staging',
        range: '6h',
        source: 'live',
        event: 'evt_1',
      }),
    ).toEqual({
      project: 'prj_storefront',
      environment: 'staging',
      range: '6h',
      source: 'live',
      event: 'evt_1',
    });

    expect(parseSessionSearch({ project: '../private', range: 'forever' })).toEqual({
      project: 'prj_checkout',
      environment: 'production',
      range: '24h',
      source: 'illustrative',
    });
  });
});

describe('buildSessionHref', () => {
  it('encodes the session path and investigation context', () => {
    expect(
      buildSessionHref(
        'ses/checkout',
        {
          project: 'prj_checkout',
          environment: 'production',
          range: '30m',
          source: 'illustrative',
        },
        'evt_1',
      ),
    ).toBe(
      '/sessions/ses%2Fcheckout?project=prj_checkout&environment=production&range=30m&source=illustrative&event=evt_1',
    );
  });
});
