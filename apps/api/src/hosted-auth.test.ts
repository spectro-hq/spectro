import { describe, expect, it, vi } from 'vitest';

import { createApiApp } from './app.js';
import type { EventQueryStore } from './events.js';
import type { HostedAuthOptions, OidcProvider } from './hosted-auth.js';
import type { IssueLifecycleStore } from './issue-lifecycle.js';

const origin = 'https://console.spectro.example';
const sessionCookie = '__Host-spectro-session=session-credential';

function setup() {
  const attempts = new Map<string, { nonce: string; codeVerifier: string }>();
  const resolveSession = vi.fn<HostedAuthOptions['controlPlane']['resolveSession']>(
    async (token) => (token === 'session-credential' ? { userId: 'usr_one' } : undefined),
  );
  const authorizeProject = vi.fn<HostedAuthOptions['controlPlane']['authorizeProject']>(
    async (input) =>
      input.projectId === 'prj_allowed' &&
      input.environment === 'production' &&
      input.action === 'project:read'
        ? { userId: 'usr_one' }
        : undefined,
  );
  const revokeSession = vi.fn<HostedAuthOptions['controlPlane']['revokeSession']>(async () => {});
  const exchange = vi.fn<OidcProvider['exchange']>(async () => ({
    issuer: 'https://idp.example',
    subject: 'stable-subject',
    email: 'profile@example.test',
  }));
  const controlPlane: HostedAuthOptions['controlPlane'] = {
    createLoginAttempt: async ({ state, nonce, codeVerifier }) => {
      attempts.set(state, { nonce, codeVerifier });
    },
    consumeLoginAttempt: async (state) => {
      const value = attempts.get(state);
      attempts.delete(state);
      return value;
    },
    findOrCreateUser: async () => 'usr_one',
    createSession: async () => 'session-credential',
    resolveSession,
    authorizeProject,
    revokeSession,
  };
  const hostedAuth: HostedAuthOptions = {
    publicOrigin: origin,
    csrfSecret: 'a-secret-with-at-least-thirty-two-bytes',
    oidc: {
      authorizationUrl: async ({ state }) =>
        new URL(`https://idp.example/authorize?state=${state}`),
      exchange,
    },
    controlPlane,
  };
  return { hostedAuth, attempts, resolveSession, authorizeProject, revokeSession, exchange };
}

describe('hosted product API authentication', () => {
  it('binds a single-use OIDC callback to the browser login cookie', async () => {
    const fixture = setup();
    const app = createApiApp({ hostedAuth: fixture.hostedAuth });
    const login = await app.inject({ method: 'GET', url: '/v1/auth/login' });
    expect(login.statusCode).toBe(302);
    const state = new URL(login.headers.location as string).searchParams.get('state');
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(login.headers['set-cookie']).toContain('__Host-spectro-login=');
    expect(login.headers['set-cookie']).toContain('HttpOnly');
    expect(login.headers['set-cookie']).toContain('Secure');
    const cookie = `__Host-spectro-login=${state}`;

    const missingCookie = await app.inject({
      method: 'GET',
      url: `/v1/auth/callback?state=${state}&code=some-code`,
    });
    expect(missingCookie.statusCode).toBe(400);
    expect(fixture.attempts.size).toBe(1);

    const callback = await app.inject({
      method: 'GET',
      url: `/v1/auth/callback?state=${state}&code=some-code`,
      headers: { cookie },
    });
    expect(callback.statusCode).toBe(302);
    expect(callback.headers.location).toBe('/');
    expect(callback.headers['set-cookie']).toEqual(
      expect.arrayContaining([
        expect.stringContaining('__Host-spectro-session=session-credential'),
      ]),
    );
    expect(fixture.exchange).toHaveBeenCalledOnce();
    expect(fixture.exchange).toHaveBeenCalledWith(
      expect.objectContaining({
        callbackUrl: new URL(`${origin}/v1/auth/callback?state=${state}&code=some-code`),
      }),
    );

    const replay = await app.inject({
      method: 'GET',
      url: `/v1/auth/callback?state=${state}&code=some-code`,
      headers: { cookie },
    });
    expect(replay.statusCode).toBe(400);
    expect(fixture.exchange).toHaveBeenCalledOnce();
    await app.close();
  });

  it('requires a live session, current project permission and a registered environment', async () => {
    const fixture = setup();
    const eventStore = { list: vi.fn<EventQueryStore['list']>(async () => ({ data: [] })) };
    const app = createApiApp({ hostedAuth: fixture.hostedAuth, eventStore });
    const url = '/v1/projects/prj_allowed/events?environment=production&from=100&to=200';
    expect((await app.inject({ method: 'GET', url })).statusCode).toBe(401);
    expect(
      (await app.inject({ method: 'GET', url, headers: { cookie: sessionCookie } })).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: url.replace('production', 'staging'),
          headers: { cookie: sessionCookie },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: url.replace('prj_allowed', 'prj_other'),
          headers: { cookie: sessionCookie },
        })
      ).statusCode,
    ).toBe(403);
    expect(eventStore.list).toHaveBeenCalledOnce();
    await app.close();
  });

  it('requires same-origin CSRF verification for issue writes and logout', async () => {
    const fixture = setup();
    fixture.authorizeProject.mockResolvedValue({ userId: 'usr_one' });
    const set = vi.fn<IssueLifecycleStore['set']>(async () => ({
      fingerprint: 'a'.repeat(32),
      status: 'resolved' as const,
      updatedAt: new Date().toISOString(),
    }));
    const issueLifecycleStore: IssueLifecycleStore = {
      getMany: async () => new Map(),
      set,
      history: async () => [],
    };
    const app = createApiApp({ hostedAuth: fixture.hostedAuth, issueLifecycleStore });
    const session = await app.inject({
      method: 'GET',
      url: '/v1/auth/session',
      headers: { cookie: sessionCookie },
    });
    expect(session.statusCode).toBe(200);
    expect(session.headers['cache-control']).toBe('no-store');
    const csrfToken: string = session.json().csrfToken;
    const url = `/v1/projects/prj_allowed/issues/${'a'.repeat(32)}`;
    const body = { environment: 'production', status: 'resolved' };
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url,
          headers: {
            cookie: sessionCookie,
            origin: 'https://attacker.example',
            'x-csrf-token': csrfToken,
          },
          payload: body,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url,
          headers: { cookie: sessionCookie, origin },
          payload: body,
        })
      ).statusCode,
    ).toBe(403);
    expect(set).not.toHaveBeenCalled();

    const updated = await app.inject({
      method: 'PATCH',
      url,
      headers: { cookie: sessionCookie, origin, 'x-csrf-token': csrfToken },
      payload: body,
    });
    expect(updated.statusCode).toBe(200);
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ actorId: 'usr_one' }));

    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/auth/logout',
          headers: {
            cookie: sessionCookie,
            origin: 'https://attacker.example',
            'x-csrf-token': csrfToken,
          },
        })
      ).statusCode,
    ).toBe(403);
    const logout = await app.inject({
      method: 'POST',
      url: '/v1/auth/logout',
      headers: { cookie: sessionCookie, origin, 'x-csrf-token': csrfToken },
    });
    expect(logout.statusCode).toBe(204);
    expect(fixture.revokeSession).toHaveBeenCalledWith('session-credential');
    await app.close();
  });
});
