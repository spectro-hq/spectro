import { describe, expect, it } from 'vitest';

import { ingestApiKeyFrom } from './config.js';

describe('ingestApiKeyFrom', () => {
  it('uses the configured API key', () => {
    expect(
      ingestApiKeyFrom({
        NODE_ENV: 'production',
        SPECTRO_INGEST_API_KEY: 'sp_configured',
      }),
    ).toBe('sp_configured');
  });

  it('uses the local development key outside production', () => {
    expect(ingestApiKeyFrom({ NODE_ENV: 'development' })).toBe('sp_local_dev');
  });

  it('requires a configured API key in production', () => {
    expect(() => ingestApiKeyFrom({ NODE_ENV: 'production' })).toThrow(
      'SPECTRO_INGEST_API_KEY is required in production.',
    );
  });
});
