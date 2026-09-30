import { afterEach, describe, expect, it, vi } from 'vitest';

import { createApiApp } from './app.js';
import type { HostedAuthOptions } from './hosted-auth.js';
import { WorkspaceAccessDeniedError, type WorkspaceStore } from './workspaces.js';

const origin = 'https://console.spectro.example';
const cookie = '__Host-spectro-session=test-session';
const apps: ReturnType<typeof createApiApp>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function setup(configured = true) {
  const resolveSession = vi.fn<HostedAuthOptions['controlPlane']['resolveSession']>(
    async (token) => (token === 'test-session' ? { userId: 'usr_owner' } : undefined),
  );
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
      resolveSession,
      authorizeProject: async () => undefined,
      revokeSession: async () => {},
    },
  };
  const store = {
    listOrganizations: vi.fn<WorkspaceStore['listOrganizations']>(async () => ({ data: [] })),
    createOrganization: vi.fn<WorkspaceStore['createOrganization']>(async (input) => ({
      id: 'org_new',
      name: input.name,
      role: 'owner',
    })),
    listProjects: vi.fn<WorkspaceStore['listProjects']>(async () => ({ data: [] })),
    createProject: vi.fn<WorkspaceStore['createProject']>(async (input) => ({
      id: 'prj_new',
      organizationId: input.organizationId,
      name: input.name,
      environments: input.environments,
    })),
  };
  const app = createApiApp({ hostedAuth: auth, ...(configured ? { workspaceStore: store } : {}) });
  apps.push(app);
  const session = await app.inject({ method: 'GET', url: '/v1/auth/session', headers: { cookie } });
  const csrf: string = session.json().csrfToken;
  return { app, store, resolveSession, headers: { cookie, origin, 'x-csrf-token': csrf } };
}

describe('workspace API boundary', () => {
  it('requires a live session for all organization and project endpoints', async () => {
    const { app, store, headers, resolveSession } = await setup();
    const requests = [
      { method: 'GET', url: '/v1/organizations' },
      { method: 'POST', url: '/v1/organizations', payload: { name: 'Team' } },
      { method: 'GET', url: '/v1/organizations/org_one/projects' },
      {
        method: 'POST',
        url: '/v1/organizations/org_one/projects',
        payload: { name: 'Web', environments: ['production'] },
      },
    ] as const;
    for (const request of requests) {
      // oxlint-disable-next-line no-await-in-loop -- exercise each authentication boundary independently.
      expect((await app.inject(request)).statusCode).toBe(401);
    }
    resolveSession.mockResolvedValue(undefined);
    const expired = await app.inject({ ...requests[1], headers });
    expect(expired.statusCode).toBe(401);
    expect(expired.headers['cache-control']).toBe('no-store');
    expect(store.createOrganization).not.toHaveBeenCalled();
    expect(store.listOrganizations).not.toHaveBeenCalled();
    expect(store.createProject).not.toHaveBeenCalled();
    expect(store.listProjects).not.toHaveBeenCalled();
  });

  it('requires same-origin, session-bound CSRF on both creation routes', async () => {
    const { app, store, headers } = await setup();
    for (const request of [
      { url: '/v1/organizations', payload: { name: 'Team' } },
      {
        url: '/v1/organizations/org_one/projects',
        payload: { name: 'Web', environments: ['production'] },
      },
    ]) {
      for (const submitted of [
        { cookie, origin },
        { ...headers, origin: 'https://other.example' },
        { ...headers, 'x-csrf-token': 'wrong' },
      ]) {
        // oxlint-disable-next-line no-await-in-loop -- verify each invalid CSRF variant.
        const response = await app.inject({ method: 'POST', ...request, headers: submitted });
        expect(response.statusCode).toBe(403);
        expect(response.json().error.code).toBe('csrf_invalid');
      }
    }
    expect(store.createOrganization).not.toHaveBeenCalled();
    expect(store.createProject).not.toHaveBeenCalled();
  });

  it('derives ownership from the session and accepts bounded trimmed names', async () => {
    const { app, store, headers } = await setup();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/organizations',
      headers,
      payload: { name: '  Team  ' },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({ id: 'org_new', name: 'Team', role: 'owner' });
    expect(store.createOrganization).toHaveBeenCalledWith({ userId: 'usr_owner', name: 'Team' });
    for (const payload of [
      { name: 'Team', userId: 'usr_other' },
      { name: 'Team', role: 'owner' },
      { name: ' ' },
      { name: 'x'.repeat(121) },
    ]) {
      // oxlint-disable-next-line no-await-in-loop -- invalid request matrix.
      const invalid = await app.inject({
        method: 'POST',
        url: '/v1/organizations',
        headers,
        payload,
      });
      expect(invalid.statusCode).toBe(400);
    }
    expect(store.createOrganization).toHaveBeenCalledOnce();
  });

  it('validates environments and rejects client-supplied authority fields', async () => {
    const { app, store, headers } = await setup();
    const url = '/v1/organizations/org_one/projects';
    const response = await app.inject({
      method: 'POST',
      url,
      headers,
      payload: { name: ' Web ', environments: [' production ', 'staging'] },
    });
    expect(response.statusCode).toBe(201);
    expect(store.createProject).toHaveBeenCalledWith({
      userId: 'usr_owner',
      organizationId: 'org_one',
      name: 'Web',
      environments: ['production', 'staging'],
    });
    for (const payload of [
      { name: 'Web', environments: [] },
      { name: 'Web', environments: ['production', ' production '] },
      { name: 'Web', environments: ['x'.repeat(65)] },
      { name: 'Web', environments: [' '] },
      { name: 'Web', environments: Array.from({ length: 11 }, (_, i) => `env-${i}`) },
      { name: 'Web', environments: ['production'], organizationId: 'org_other' },
      { name: 'Web', environments: ['production'], userId: 'usr_other' },
    ]) {
      // oxlint-disable-next-line no-await-in-loop -- invalid request matrix.
      expect((await app.inject({ method: 'POST', url, headers, payload })).statusCode).toBe(400);
    }
    expect(store.createProject).toHaveBeenCalledOnce();
  });

  it('bounds pagination and never treats a cursor as authorization', async () => {
    const { app, store, headers } = await setup();
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/v1/organizations?limit=2&cursor=org_cursor',
          headers,
        })
      ).statusCode,
    ).toBe(200);
    expect(store.listOrganizations).toHaveBeenCalledWith({
      userId: 'usr_owner',
      limit: 2,
      cursor: 'org_cursor',
    });
    for (const url of [
      '/v1/organizations?limit=101',
      '/v1/organizations?limit=0',
      '/v1/organizations?cursor=prj_wrong',
      '/v1/organizations?userId=usr_other',
      '/v1/organizations/org_one/projects?cursor=org_wrong',
      '/v1/organizations/invalid/projects',
    ]) {
      // oxlint-disable-next-line no-await-in-loop -- invalid request matrix.
      expect((await app.inject({ method: 'GET', url, headers })).statusCode).toBe(400);
    }
    store.listProjects.mockRejectedValue(new WorkspaceAccessDeniedError());
    const denied = await app.inject({
      method: 'GET',
      url: '/v1/organizations/org_other/projects?cursor=prj_cursor',
      headers,
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.headers['cache-control']).toBe('no-store');
  });

  it('fails closed without leaking database or identity failures', async () => {
    const { app, store, headers, resolveSession } = await setup();
    store.createOrganization.mockRejectedValue(new Error('private database credential'));
    const failed = await app.inject({
      method: 'POST',
      url: '/v1/organizations',
      headers,
      payload: { name: 'Team' },
    });
    expect(failed.statusCode).toBe(503);
    expect(failed.body).not.toContain('private');
    resolveSession.mockRejectedValue(new Error('private identity state'));
    expect(
      (await app.inject({ method: 'GET', url: '/v1/organizations', headers })).json().error.code,
    ).toBe('authorization_unavailable');
    const unconfigured = await setup(false);
    expect(
      (
        await unconfigured.app.inject({
          method: 'GET',
          url: '/v1/organizations',
          headers: unconfigured.headers,
        })
      ).statusCode,
    ).toBe(503);
    expect(() => createApiApp({ workspaceStore: store })).toThrow('requires hosted authentication');
  });
});
