import assert from 'node:assert/strict';
import test from 'node:test';

const configuredOrigin = process.env.SPECTRO_STAGING_ORIGIN;

test(
  'hosted authentication staging preflight',
  {
    skip: configuredOrigin === undefined ? 'Set SPECTRO_STAGING_ORIGIN to an HTTPS origin' : false,
  },
  async () => {
    const origin = new URL(configuredOrigin);
    assert.equal(origin.protocol, 'https:', 'Staging Console must use HTTPS');
    assert.equal(origin.origin, configuredOrigin, 'Provide only the origin, without a path');
    assert.equal(origin.username, '', 'Do not put credentials in the staging URL');
    assert.equal(origin.password, '', 'Do not put credentials in the staging URL');

    const request = (path) =>
      fetch(new URL(path, origin), {
        redirect: 'manual',
        cache: 'no-store',
        signal: AbortSignal.timeout(10_000),
      });

    const health = await request('/health');
    assert.equal(health.status, 200, 'The same origin must route /health to the product API');
    assert.deepEqual(await health.json(), { service: 'spectro-api', status: 'ok' });

    const session = await request('/v1/auth/session');
    assert.equal(session.status, 401, 'An anonymous visitor must not have a Console session');
    assert.equal(session.headers.get('cache-control'), 'no-store');
    assert.equal((await session.json()).error?.code, 'unauthorized');

    const protectedRead = await request(
      '/v1/projects/prj_preflight/events?environment=production&from=0&to=1',
    );
    assert.equal(protectedRead.status, 401, 'Project data must reject anonymous requests');

    const login = await request('/v1/auth/login');
    assert.equal(login.status, 302, 'Login must redirect to the managed identity provider');
    assert.equal(login.headers.get('cache-control'), 'no-store');
    const destination = login.headers.get('location');
    assert.ok(destination, 'Login redirect is missing');
    const authorizationUrl = new URL(destination);
    assert.equal(authorizationUrl.protocol, 'https:', 'The identity provider must use HTTPS');
    assert.equal(
      authorizationUrl.searchParams.get('redirect_uri'),
      new URL('/v1/auth/callback', origin).href,
      'OIDC callback must return to the same origin',
    );
    const state = authorizationUrl.searchParams.get('state');
    assert.ok(state && /^[A-Za-z0-9_-]{43}$/.test(state), 'Login state is missing or malformed');
    assert.equal(authorizationUrl.searchParams.get('code_challenge_method'), 'S256');
    assert.ok(authorizationUrl.searchParams.has('nonce'), 'OIDC nonce is missing');

    const cookie = login.headers.get('set-cookie');
    assert.ok(cookie?.startsWith('__Host-spectro-login='), 'Host-only login cookie is missing');
    assert.ok(
      cookie.match(/^__Host-spectro-login=([^;]+)/)?.[1] === state,
      'Login state cookie must match the OIDC request state',
    );
    assert.ok(/;\s*Secure(?:;|$)/i.test(cookie), 'Login cookie must be Secure');
    assert.ok(/;\s*HttpOnly(?:;|$)/i.test(cookie), 'Login cookie must be HttpOnly');
    assert.ok(/;\s*SameSite=Lax(?:;|$)/i.test(cookie), 'Login cookie must use SameSite=Lax');
    assert.ok(/;\s*Path=\/(?:;|$)/i.test(cookie), 'Login cookie must use Path=/');
    assert.ok(!/;\s*Domain=/i.test(cookie), 'Login cookie must not set Domain');

    const unboundCallback = await request(`/v1/auth/callback?state=${state}&code=invalid`);
    assert.equal(unboundCallback.status, 400, 'Callback without its browser cookie must fail');
    assert.equal((await unboundCallback.json()).error?.code, 'login_invalid');
  },
);
