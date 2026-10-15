import { describe, expect, it } from 'vitest';

import { parseSessionSearch } from './session-query.js';

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
