import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import cookie from '@fastify/cookie';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import * as oidc from 'openid-client';
import { z } from 'zod';

import type { PostgresAuthControlPlane } from './postgres-auth-control-plane.js';

const SESSION_COOKIE = '__Host-spectro-session';
const LOGIN_COOKIE = '__Host-spectro-login';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
const loginCallbackSchema = z.object({ state: z.string().regex(/^[A-Za-z0-9_-]{43}$/) });

export interface OidcIdentity {
  readonly issuer: string;
  readonly subject: string;
  readonly email?: string;
}

export interface OidcProvider {
  authorizationUrl(input: {
    readonly state: string;
    readonly nonce: string;
    readonly codeVerifier: string;
  }): Promise<URL>;
  exchange(input: {
    readonly callbackUrl: URL;
    readonly state: string;
    readonly nonce: string;
    readonly codeVerifier: string;
  }): Promise<OidcIdentity>;
}

export class ManagedOidcProvider implements OidcProvider {
  readonly #issuer: URL;
  readonly #clientId: string;
  readonly #clientSecret: string;
  readonly #redirectUri: string;
  #configuration: Promise<oidc.Configuration> | undefined;

  constructor(input: {
    readonly issuer: string;
    readonly clientId: string;
    readonly clientSecret: string;
    readonly redirectUri: string;
  }) {
    this.#issuer = new URL(input.issuer);
    if (this.#issuer.protocol !== 'https:') throw new Error('OIDC issuer must use HTTPS');
    this.#clientId = input.clientId;
    this.#clientSecret = input.clientSecret;
    this.#redirectUri = input.redirectUri;
  }

  #config(): Promise<oidc.Configuration> {
    if (this.#configuration !== undefined) return this.#configuration;
    const pending = oidc.discovery(this.#issuer, this.#clientId, this.#clientSecret);
    this.#configuration = pending;
    void pending.catch(() => {
      this.#clearFailedDiscovery(pending);
    });
    return pending;
  }

  #clearFailedDiscovery(pending: Promise<oidc.Configuration>): void {
    if (this.#configuration === pending) this.#configuration = undefined;
  }

  async authorizationUrl(input: {
    readonly state: string;
    readonly nonce: string;
    readonly codeVerifier: string;
  }): Promise<URL> {
    const configuration = await this.#config();
    const challenge = await oidc.calculatePKCECodeChallenge(input.codeVerifier);
    return oidc.buildAuthorizationUrl(configuration, {
      redirect_uri: this.#redirectUri,
      scope: 'openid email',
      response_type: 'code',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state: input.state,
      nonce: input.nonce,
    });
  }

  async exchange(input: {
    readonly callbackUrl: URL;
    readonly state: string;
    readonly nonce: string;
    readonly codeVerifier: string;
  }): Promise<OidcIdentity> {
    const configuration = await this.#config();
    const tokens = await oidc.authorizationCodeGrant(configuration, input.callbackUrl, {
      pkceCodeVerifier: input.codeVerifier,
      expectedState: input.state,
      expectedNonce: input.nonce,
      idTokenExpected: true,
    });
    const claims = tokens.claims();
    if (claims === undefined || claims.iss !== configuration.serverMetadata().issuer) {
      throw new Error('OIDC identity validation failed');
    }
    const audience = claims.aud;
    if (
      audience !== this.#clientId &&
      !(Array.isArray(audience) && audience.includes(this.#clientId))
    ) {
      throw new Error('OIDC audience validation failed');
    }
    return {
      issuer: claims.iss,
      subject: claims.sub,
      ...(typeof claims.email === 'string' ? { email: claims.email } : {}),
    };
  }
}

export interface HostedAuthOptions {
  readonly publicOrigin: string;
  readonly csrfSecret: string;
  readonly oidc: OidcProvider;
  readonly controlPlane: Pick<
    PostgresAuthControlPlane,
    | 'createLoginAttempt'
    | 'consumeLoginAttempt'
    | 'findOrCreateUser'
    | 'createSession'
    | 'resolveSession'
    | 'authorizeProject'
    | 'revokeSession'
  >;
}

function csrfToken(secret: string, credential: string): string {
  return createHmac('sha256', secret)
    .update('spectro-csrf-v1:')
    .update(credential)
    .digest('base64url');
}

function validCsrfToken(actual: string | undefined, expected: string): boolean {
  if (actual === undefined) return false;
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

export function sessionToken(request: FastifyRequest): string | undefined {
  return request.cookies[SESSION_COOKIE];
}

export function requireSameOriginCsrf(
  request: FastifyRequest,
  reply: FastifyReply,
  options: HostedAuthOptions,
  token: string,
): boolean {
  const submitted = request.headers['x-csrf-token'];
  if (
    request.headers.origin !== options.publicOrigin ||
    typeof submitted !== 'string' ||
    !validCsrfToken(submitted, csrfToken(options.csrfSecret, token))
  ) {
    reply
      .code(403)
      .send({ error: { code: 'csrf_invalid', message: 'Request verification failed.' } });
    return false;
  }
  return true;
}

export function registerHostedAuth(app: FastifyInstance, options: HostedAuthOptions): void {
  const origin = new URL(options.publicOrigin);
  if (origin.protocol !== 'https:' || origin.origin !== options.publicOrigin) {
    throw new Error('Hosted Console origin must be an HTTPS origin');
  }
  if (Buffer.byteLength(options.csrfSecret, 'utf8') < 32) {
    throw new Error('CSRF secret must contain at least 32 bytes');
  }
  void app.register(cookie);

  app.get('/v1/auth/login', async (_request, reply) => {
    reply.header('cache-control', 'no-store');
    const state = randomBytes(32).toString('base64url');
    const nonce = randomBytes(32).toString('base64url');
    const codeVerifier = oidc.randomPKCECodeVerifier();
    try {
      const url = await options.oidc.authorizationUrl({ state, nonce, codeVerifier });
      if (url.protocol !== 'https:') throw new Error('OIDC authorization URL must use HTTPS');
      await options.controlPlane.createLoginAttempt({ state, nonce, codeVerifier });
      reply.setCookie(LOGIN_COOKIE, state, {
        path: '/',
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        maxAge: 600,
      });
      return reply.header('cache-control', 'no-store').redirect(url.href);
    } catch {
      return reply.code(503).send({
        error: { code: 'login_unavailable', message: 'Login is temporarily unavailable.' },
      });
    }
  });

  app.get('/v1/auth/callback', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    reply.clearCookie(LOGIN_COOKIE, { path: '/' });
    const parsed = loginCallbackSchema.safeParse(request.query);
    if (!parsed.success || request.cookies[LOGIN_COOKIE] !== parsed.data.state) {
      return reply.code(400).send({
        error: { code: 'login_invalid', message: 'Login could not be verified.' },
      });
    }
    try {
      const attempt = await options.controlPlane.consumeLoginAttempt(parsed.data.state);
      if (attempt === undefined) {
        return reply.code(400).send({
          error: { code: 'login_invalid', message: 'Login could not be verified.' },
        });
      }
      const callbackUrl = new URL('/v1/auth/callback', options.publicOrigin);
      callbackUrl.search = new URL(request.url, options.publicOrigin).search;
      const identity = await options.oidc.exchange({
        callbackUrl,
        state: parsed.data.state,
        ...attempt,
      });
      const userId = await options.controlPlane.findOrCreateUser(identity);
      const token = await options.controlPlane.createSession({
        userId,
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      });
      const previousToken = sessionToken(request);
      if (previousToken !== undefined) await options.controlPlane.revokeSession(previousToken);
      reply.setCookie(SESSION_COOKIE, token, {
        path: '/',
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        maxAge: SESSION_TTL_MS / 1_000,
      });
      return reply.header('cache-control', 'no-store').redirect('/');
    } catch {
      return reply.code(400).send({
        error: { code: 'login_invalid', message: 'Login could not be verified.' },
      });
    }
  });

  app.get('/v1/auth/session', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    const token = sessionToken(request);
    if (token === undefined) {
      return reply
        .code(401)
        .send({ error: { code: 'unauthorized', message: 'Authentication is required.' } });
    }
    try {
      const principal = await options.controlPlane.resolveSession(token);
      if (principal === undefined) {
        return reply
          .code(401)
          .send({ error: { code: 'unauthorized', message: 'Authentication is required.' } });
      }
      return { userId: principal.userId, csrfToken: csrfToken(options.csrfSecret, token) };
    } catch {
      return reply.code(503).send({
        error: {
          code: 'authorization_unavailable',
          message: 'Authorization is temporarily unavailable.',
        },
      });
    }
  });

  app.post('/v1/auth/logout', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    const token = sessionToken(request);
    if (token === undefined) {
      return reply
        .code(401)
        .send({ error: { code: 'unauthorized', message: 'Authentication is required.' } });
    }
    if (!requireSameOriginCsrf(request, reply, options, token)) return;
    try {
      await options.controlPlane.revokeSession(token);
      reply.clearCookie(SESSION_COOKIE, { path: '/' });
      return reply.code(204).send();
    } catch {
      return reply.code(503).send({
        error: {
          code: 'authorization_unavailable',
          message: 'Authorization is temporarily unavailable.',
        },
      });
    }
  });
}
