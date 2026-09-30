import { afterEach, describe, expect, it, vi } from 'vitest';

import { createApiApp } from './app.js';
import type { HostedAuthOptions } from './hosted-auth.js';
import {
  ProjectWriteKeyAccessDeniedError,
  type ProjectWriteKeyStore,
} from './project-write-keys.js';

const origin = 'https://console.spectro.example';
const cookie = '__Host-spectro-session=test-session';
const rawKey = `spk_${'A'.repeat(43)}`;
const metadata = {
  id: 'key_checkout',
  environment: 'production',
  label: 'Browser production',
  keyHint: 'A7KQ',
  allowedOrigins: ['https://app.example.com'],
  createdAt: '2026-09-29T00:00:00.000Z',
  revokedAt: null,
} as const;
const apps: ReturnType<typeof createApiApp>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function setup() {
  const auth: HostedAuthOptions = {
    publicOrigin: origin,
    csrfSecret: 'a-secret-with-at-least-thirty-two-bytes',
    oidc: {
      authorizationUrl: async () => new URL('https://issuer.example/authorize'),
      exchange: async () => ({ issuer: 'https://issuer.example', subject: 'test' }),
    },
    controlPlane: {
      createLoginAttempt: async () => {},
      consumeLoginAttempt: async () => undefined,
      findOrCreateUser: async () => 'usr_owner',
      createSession: async () => 'test-session',
      resolveSession: vi.fn<HostedAuthOptions['controlPlane']['resolveSession']>(async (token) =>
        token === 'test-session' ? { userId: 'usr_owner' } : undefined,
      ),
      authorizeProject: async () => undefined,
      revokeSession: async () => {},
    },
  };
  const store: ProjectWriteKeyStore = {
    list: vi.fn<ProjectWriteKeyStore['list']>(async () => [metadata]),
    create: vi.fn<ProjectWriteKeyStore['create']>(async () => ({ key: rawKey, metadata })),
    revoke: vi.fn<ProjectWriteKeyStore['revoke']>(async () => {}),
  };
  const app = createApiApp({
    hostedAuth: auth,
    projectWriteKeyStore: store,
    ingestionEndpoint: 'https://ingest.spectro.example/v1/envelope',
  });
  apps.push(app);
  const session = await app.inject({ method: 'GET', url: '/v1/auth/session', headers: { cookie } });
  const csrf = session.json<{ csrfToken: string }>().csrfToken;
  return {
    app,
    store,
    headers: { cookie, origin, 'x-csrf-token': csrf },
    path: '/v1/projects/prj_checkout/environments/production/write-keys',
  };
}

describe('project write-key API boundary', () => {
  it('shows the raw key only in the successful create response', async () => {
    const { app, store, headers, path } = await setup();
    const created = await app.inject({
      method: 'POST',
      url: path,
      headers,
      payload: {
        environment: 'production',
        label: ' Browser production ',
        allowedOrigins: ['https://app.example.com'],
      },
    });

    expect(created.statusCode).toBe(201);
    expect(created.headers['cache-control']).toBe('no-store');
    expect(created.json()).toEqual({ key: rawKey, metadata });
    expect(store.create).toHaveBeenCalledWith({
      userId: 'usr_owner',
      projectId: 'prj_checkout',
      environment: 'production',
      label: 'Browser production',
      allowedOrigins: ['https://app.example.com'],
    });

    const listed = await app.inject({ method: 'GET', url: path, headers });
    expect(listed.statusCode).toBe(200);
    expect(listed.headers['cache-control']).toBe('no-store');
    expect(listed.json()).toEqual({
      data: [metadata],
      ingestionEndpoint: 'https://ingest.spectro.example/v1/envelope',
    });
    expect(listed.body).not.toContain(rawKey);
  });

  it('requires a session and same-origin CSRF for create and revoke', async () => {
    const { app, store, headers, path } = await setup();
    const payload = {
      environment: 'production',
      label: 'Browser production',
      allowedOrigins: ['https://app.example.com'],
    };
    expect((await app.inject({ method: 'POST', url: path, payload })).statusCode).toBe(401);
    for (const invalidHeaders of [
      { cookie, origin },
      { ...headers, origin: 'https://attacker.example' },
      { ...headers, 'x-csrf-token': 'wrong-token' },
    ]) {
      // oxlint-disable-next-line no-await-in-loop -- exercise independent CSRF failure variants.
      const response = await app.inject({
        method: 'POST',
        url: path,
        headers: invalidHeaders,
        payload,
      });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ error: { code: 'csrf_invalid' } });
    }
    expect(store.create).not.toHaveBeenCalled();
  });

  it('validates origin, environment, and authority-bearing request fields', async () => {
    const { app, store, headers, path } = await setup();
    for (const payload of [
      { environment: 'staging', label: 'Browser', allowedOrigins: [] },
      { environment: 'production', label: 'Browser', allowedOrigins: ['http://app.example.com'] },
      {
        environment: 'production',
        label: 'Browser',
        allowedOrigins: ['https://app.example.com/path'],
      },
      {
        environment: 'production',
        label: 'Browser',
        allowedOrigins: ['https://app.example.com'],
        userId: 'usr_other',
      },
    ]) {
      // oxlint-disable-next-line no-await-in-loop -- invalid request matrix.
      expect((await app.inject({ method: 'POST', url: path, headers, payload })).statusCode).toBe(
        400,
      );
    }
    expect(store.create).not.toHaveBeenCalled();
  });

  it('revokes only the key scoped by the authenticated project and environment', async () => {
    const { app, store, headers, path } = await setup();
    const response = await app.inject({
      method: 'DELETE',
      url: `${path}/key_checkout`,
      headers,
    });

    expect(response.statusCode).toBe(204);
    expect(store.revoke).toHaveBeenCalledWith({
      userId: 'usr_owner',
      projectId: 'prj_checkout',
      environment: 'production',
      keyId: 'key_checkout',
    });
    expect(
      (await app.inject({ method: 'DELETE', url: `${path}/invalid`, headers })).statusCode,
    ).toBe(400);
  });

  it('supports rotation by creating a replacement before revoking the previous key', async () => {
    const { app, store, headers, path } = await setup();
    const replacement = {
      key: `spk_${'B'.repeat(43)}`,
      metadata: { ...metadata, id: 'key_checkout_next', keyHint: 'B8LQ' },
    };
    vi.mocked(store.create)
      .mockResolvedValueOnce({ key: rawKey, metadata })
      .mockResolvedValueOnce(replacement);
    const payload = {
      environment: 'production',
      label: 'Browser production',
      allowedOrigins: ['https://app.example.com'],
    };
    const previous = await app.inject({ method: 'POST', url: path, headers, payload });
    const next = await app.inject({ method: 'POST', url: path, headers, payload });
    expect(previous.statusCode).toBe(201);
    expect(next.statusCode).toBe(201);
    expect(next.json<{ key: string }>().key).not.toBe(previous.json<{ key: string }>().key);

    const revoked = await app.inject({
      method: 'DELETE',
      url: `${path}/${metadata.id}`,
      headers,
    });
    expect(revoked.statusCode).toBe(204);
    expect(store.revoke).toHaveBeenCalledWith({
      userId: 'usr_owner',
      projectId: 'prj_checkout',
      environment: 'production',
      keyId: metadata.id,
    });
  });

  it('maps role denial and control-plane failures to stable responses', async () => {
    const { app, store, headers, path } = await setup();
    vi.mocked(store.create).mockRejectedValueOnce(new ProjectWriteKeyAccessDeniedError());
    const denied = await app.inject({
      method: 'POST',
      url: path,
      headers,
      payload: { environment: 'production', label: 'Browser', allowedOrigins: [] },
    });
    expect(denied.statusCode).toBe(403);

    vi.mocked(store.create).mockRejectedValueOnce(new Error('private database credential'));
    const unavailable = await app.inject({
      method: 'POST',
      url: path,
      headers,
      payload: { environment: 'production', label: 'Browser', allowedOrigins: [] },
    });
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.body).not.toContain('private');
    expect(unavailable.json()).toMatchObject({ error: { code: 'control_plane_unavailable' } });
  });
});
