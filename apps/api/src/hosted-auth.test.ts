import { describe, expect, it, vi } from 'vitest';
import { ResponseBodyError } from 'openid-client';

import { createApiApp } from './app.js';
import type { EventQueryStore } from './events.js';
import type {
  HostedAuthFailureDetails,
  HostedAuthFailureReason,
  HostedAuthOptions,
  OidcProvider,
} from './hosted-auth.js';
import type { IssueLifecycleStore } from './issue-lifecycle.js';
import type { LiveEventStore } from './live-events.js';

const origin = 'https://console.spectro.example';
const sessionCookie = '__Host-spectro-session=session-credential';

function setup() {
  const attempts = new Map<
    string,
    { nonce: string; codeVerifier: string; returnPath?: '/' | '/invite' }
  >();
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
  const onLoginFailure =
    vi.fn<(reason: HostedAuthFailureReason, details?: HostedAuthFailureDetails) => void>();
  const exchange = vi.fn<OidcProvider['exchange']>(async () => ({
    issuer: 'https://idp.example',
    subject: 'stable-subject',
    email: 'profile@example.test',
  }));
  const controlPlane: HostedAuthOptions['controlPlane'] = {
    createLoginAttempt: async ({ state, nonce, codeVerifier, returnPath }) => {
      attempts.set(state, {
        nonce,
        codeVerifier,
        ...(returnPath === undefined ? {} : { returnPath }),
      });
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
    onLoginFailure,
    oidc: {
      authorizationUrl: async ({ state }) =>
        new URL(`https://idp.example/authorize?state=${state}`),
      exchange,
    },
    controlPlane,
  };
  return {
    hostedAuth,
    attempts,
    resolveSession,
    authorizeProject,
    revokeSession,
    onLoginFailure,
    exchange,
  };
}

describe('hosted product API authentication', () => {
  it('binds only allowlisted invitation destinations to the login attempt, including failures', async () => {
    const fixture = setup();
    const app = createApiApp({ hostedAuth: fixture.hostedAuth });
    try {
      for (const destination of [
        'https://evil.example',
        '//evil.example',
        '/invite?token=private',
        '/settings',
      ]) {
        expect(
          // oxlint-disable-next-line no-await-in-loop -- malicious destination matrix.
          (await app.inject(`/v1/auth/login?returnTo=${encodeURIComponent(destination)}`))
            .statusCode,
        ).toBe(400);
      }
      const login = await app.inject('/v1/auth/login?returnTo=%2Finvite&prompt=login');
      const state = new URL(login.headers.location as string).searchParams.get('state');
      const callback = await app.inject({
        url: `/v1/auth/callback?state=${state}&code=some-code`,
        headers: { cookie: `__Host-spectro-login=${state}` },
      });
      expect(callback.headers.location).toBe('/invite');
      const retry = await app.inject('/v1/auth/login?returnTo=%2Finvite');
      const nextState = new URL(retry.headers.location as string).searchParams.get('state');
      fixture.exchange.mockRejectedValue(new Error('private detail'));
      const failed = await app.inject({
        url: `/v1/auth/callback?state=${nextState}&code=some-code`,
        headers: { cookie: `__Host-spectro-login=${nextState}` },
      });
      expect(failed.headers.location).toBe(`${origin}/invite?auth_error=login_failed`);
      expect(failed.body).not.toContain('private detail');
    } finally {
      await app.close();
    }
  });
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
    expect(missingCookie.statusCode).toBe(302);
    expect(missingCookie.headers.location).toBe(`${origin}/?auth_error=login_failed`);
    expect(fixture.onLoginFailure).toHaveBeenCalledWith('callback_state_invalid', undefined);
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
    expect(replay.statusCode).toBe(302);
    expect(replay.headers.location).toBe(`${origin}/?auth_error=login_failed`);
    expect(fixture.exchange).toHaveBeenCalledOnce();
    expect(fixture.onLoginFailure).toHaveBeenCalledWith('login_attempt_unavailable', undefined);
    await app.close();
  });

  it('returns provider errors to a safe sign-in screen without exposing their description', async () => {
    const fixture = setup();
    const app = createApiApp({ hostedAuth: fixture.hostedAuth });
    const login = await app.inject({ method: 'GET', url: '/v1/auth/login' });
    const state = new URL(login.headers.location as string).searchParams.get('state');
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const callback = await app.inject({
      method: 'GET',
      url: `/v1/auth/callback?state=${state}&error=access_denied&error_description=Email+not+verified`,
      headers: { cookie: `__Host-spectro-login=${state}` },
    });

    expect(callback.statusCode).toBe(302);
    expect(callback.headers.location).toBe(`${origin}/?auth_error=login_failed`);
    expect(callback.body).not.toContain('Email not verified');
    expect(fixture.attempts.size).toBe(0);
    expect(fixture.exchange).not.toHaveBeenCalled();
    expect(fixture.onLoginFailure).toHaveBeenCalledOnce();
    expect(fixture.onLoginFailure).toHaveBeenCalledWith('provider_rejected', undefined);
    await app.close();
  });

  it('reports OIDC exchange failures without exposing provider details', async () => {
    const fixture = setup();
    fixture.exchange.mockRejectedValue(
      new ResponseBodyError('private token exchange detail', {
        cause: { error: 'invalid_client', error_description: 'private provider detail' },
        response: new Response(null, { status: 401 }),
      }),
    );
    const app = createApiApp({ hostedAuth: fixture.hostedAuth });
    const login = await app.inject({ method: 'GET', url: '/v1/auth/login' });
    const state = new URL(login.headers.location as string).searchParams.get('state');
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const callback = await app.inject({
      method: 'GET',
      url: `/v1/auth/callback?state=${state}&code=some-code`,
      headers: { cookie: `__Host-spectro-login=${state}` },
    });

    expect(callback.statusCode).toBe(302);
    expect(callback.headers.location).toBe(`${origin}/?auth_error=login_failed`);
    expect(callback.body).not.toContain('private token exchange detail');
    expect(callback.body).not.toContain('private provider detail');
    expect(fixture.onLoginFailure).toHaveBeenCalledOnce();
    expect(fixture.onLoginFailure).toHaveBeenCalledWith('oidc_exchange_failed', {
      category: 'oauth_response',
      oauthErrorCode: 'invalid_client',
      httpStatus: 401,
    });
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

  it('rechecks session and environment membership for every live observation page', async () => {
    const fixture = setup();
    const list = vi.fn<LiveEventStore['list']>(async () => ({ data: [], from: 100, to: 200 }));
    const app = createApiApp({ hostedAuth: fixture.hostedAuth, liveStore: { list } });
    const url = '/v1/projects/prj_allowed/live?environment=production&from=100&to=200';
    try {
      expect((await app.inject(url)).statusCode).toBe(401);
      expect((await app.inject({ url, headers: { cookie: sessionCookie } })).statusCode).toBe(200);
      expect(
        (
          await app.inject({
            url: url.replace('production', 'staging'),
            headers: { cookie: sessionCookie },
          })
        ).statusCode,
      ).toBe(403);
      expect(
        (
          await app.inject({
            url: url.replace('prj_allowed', 'prj_other'),
            headers: { cookie: sessionCookie },
          })
        ).statusCode,
      ).toBe(403);
      fixture.resolveSession.mockResolvedValue(undefined);
      expect((await app.inject({ url, headers: { cookie: sessionCookie } })).statusCode).toBe(401);
      expect(list).toHaveBeenCalledOnce();
    } finally {
      await app.close();
    }
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
