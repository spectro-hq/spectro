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

  it('refuses the static adapter in production even with a configured token', () => {
    expect(() =>
      createLocalProjectAuthorizer({
        NODE_ENV: 'production',
        SPECTRO_API_LOCAL_PROJECT_ID: 'prj_checkout',
        SPECTRO_API_LOCAL_TOKEN: 'local-secret',
      }),
    ).toThrow('Static project authorization is unavailable in production');
  });
});
