import { describe, expect, it } from 'vitest';

import { createApiApp } from './app.js';

describe('GET /health', () => {
  it('reports the product API boundary', async () => {
    const app = createApiApp();
    const response = await app.inject({ method: 'GET', url: '/health' });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ service: 'spectro-api', status: 'ok' });
  });
});
