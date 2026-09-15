import { describe, expect, it } from 'vitest';

import { createLocalProjectAuthorizer, StaticProjectAuthorizer } from './auth.js';

describe('StaticProjectAuthorizer', () => {
  const authorizer = new StaticProjectAuthorizer({
    projectId: 'prj_checkout',
    token: 'local-secret',
  });

  it('accepts only the configured bearer token and project pair', async () => {
    await expect(
      authorizer.authorize({
        authorization: 'Bearer local-secret',
        projectId: 'prj_checkout',
      }),
    ).resolves.toBe(true);
    await expect(
      authorizer.authorize({
        authorization: 'Bearer local-secret',
        projectId: 'prj_other',
      }),
    ).resolves.toBe(false);
    await expect(
      authorizer.authorize({ authorization: 'Bearer wrong', projectId: 'prj_checkout' }),
    ).resolves.toBe(false);
  });

  it('denies access when local authorization is not explicitly configured', async () => {
    const missingConfiguration = createLocalProjectAuthorizer({});

    await expect(
      missingConfiguration.authorize({
        authorization: 'Bearer anything',
        projectId: 'prj_checkout',
      }),
    ).resolves.toBe(false);
  });
});
