import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import cookie from '@fastify/cookie';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import * as oidc from 'openid-client';
import { z } from 'zod';

import type { PostgresAuthControlPlane } from './postgres-auth-control-plane.js';

const SESSION_COOKIE = '__Host-spectro-session';
const LOGIN_COOKIE = '__Host-spectro-login';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
const loginCallbackSchema = z.object({
  state: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  code: z.string().min(1).optional(),
  error: z.string().min(1).optional(),
});

export interface OidcIdentity {
  readonly issuer: string;
  readonly subject: string;
  readonly email?: string;
  readonly emailVerified?: boolean;
}

export interface OidcProvider {
  authorizationUrl(input: {
    readonly state: string;
    readonly nonce: string;
    readonly codeVerifier: string;
    readonly prompt?: 'login';
  }): Promise<URL>;
  exchange(input: {
    readonly callbackUrl: URL;
    readonly state: string;
    readonly nonce: string;
    readonly codeVerifier: string;
  }): Promise<OidcIdentity>;
}

export type HostedAuthFailureReason =
  | 'callback_state_invalid'
  | 'login_attempt_store_failed'
  | 'login_attempt_unavailable'
  | 'provider_rejected'
  | 'authorization_code_missing'
  | 'oidc_exchange_failed'
  | 'identity_store_failed'
  | 'session_store_failed'
  | 'previous_session_revocation_failed'
  | 'session_cookie_failed';

export type HostedAuthFailureCategory =
  | 'oauth_response'
  | 'client_error'
  | 'transport_or_validation'
  | 'unexpected';

export type HostedAuthOAuthErrorCode =
  | 'access_denied'
  | 'invalid_client'
  | 'invalid_grant'
  | 'invalid_request'
  | 'invalid_scope'
  | 'server_error'
  | 'temporarily_unavailable'
  | 'unauthorized_client'
  | 'unsupported_grant_type'
  | 'other';

export interface HostedAuthFailureDetails {
  readonly category: HostedAuthFailureCategory;
  readonly oauthErrorCode?: HostedAuthOAuthErrorCode;
  readonly httpStatus?: number;
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
    readonly prompt?: 'login';
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
      ...(input.prompt === undefined ? {} : { prompt: input.prompt }),
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
      ...(typeof claims.email === 'string' && claims.email.length <= 320
        ? { email: claims.email, emailVerified: claims.email_verified === true }
        : {}),
    };
  }
}

export interface HostedAuthOptions {
  readonly publicOrigin: string;
  readonly csrfSecret: string;
  readonly oidc: OidcProvider;
  readonly onLoginFailure?: (
    reason: HostedAuthFailureReason,
    details?: HostedAuthFailureDetails,
  ) => void;
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

export async function requireConsoleSession(
  request: FastifyRequest,
  reply: FastifyReply,
  options: HostedAuthOptions,
  verifyCsrf = false,
): Promise<{ readonly userId: string } | undefined> {
  reply.header('cache-control', 'no-store');
  const token = sessionToken(request);
  try {
    const principal =
      token === undefined ? undefined : await options.controlPlane.resolveSession(token);
    if (principal === undefined || token === undefined) {
      reply
        .code(401)
        .send({ error: { code: 'unauthorized', message: 'Authentication is required.' } });
      return undefined;
    }
    if (verifyCsrf && !requireSameOriginCsrf(request, reply, options, token)) return undefined;
    return principal;
  } catch {
    reply.code(503).send({
      error: {
        code: 'authorization_unavailable',
        message: 'Authorization is temporarily unavailable.',
      },
    });
    return undefined;
  }
}

function redirectToLoginFailure(
  reply: FastifyReply,
  publicOrigin: string,
  returnPath: '/' | '/invite',
): FastifyReply {
  const destination = new URL(returnPath, publicOrigin);
  destination.searchParams.set('auth_error', 'login_failed');
  return reply.header('cache-control', 'no-store').redirect(destination.href);
}

function failLogin(
  reply: FastifyReply,
  options: HostedAuthOptions,
  reason: HostedAuthFailureReason,
  details?: HostedAuthFailureDetails,
  returnPath: '/' | '/invite' = '/',
): FastifyReply {
  try {
    options.onLoginFailure?.(reason, details);
  } catch {
    // Diagnostics must never interfere with the authentication response.
  }
  return redirectToLoginFailure(reply, options.publicOrigin, returnPath);
}

function safeOAuthErrorCode(value: string | undefined): HostedAuthOAuthErrorCode {
  switch (value) {
    case 'access_denied':
    case 'invalid_client':
    case 'invalid_grant':
    case 'invalid_request':
    case 'invalid_scope':
    case 'server_error':
    case 'temporarily_unavailable':
    case 'unauthorized_client':
    case 'unsupported_grant_type':
      return value;
    default:
      return 'other';
  }
}

function oidcFailureDetails(error: unknown): HostedAuthFailureDetails {
  if (error instanceof oidc.ResponseBodyError) {
    return {
      category: 'oauth_response',
      oauthErrorCode: safeOAuthErrorCode(error.error),
      httpStatus: error.status,
    };
  }
  if (error instanceof oidc.AuthorizationResponseError) {
    return {
      category: 'oauth_response',
      oauthErrorCode: safeOAuthErrorCode(error.error),
    };
  }
  if (error instanceof oidc.ClientError) return { category: 'client_error' };
  if (error instanceof TypeError) return { category: 'transport_or_validation' };
  return { category: 'unexpected' };
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

  app.get('/v1/auth/login', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    const continuation = z
      .object({
        returnTo: z.enum(['/', '/invite']).optional(),
        prompt: z.literal('login').optional(),
      })
      .strict()
      .safeParse(request.query);
    if (!continuation.success)
      return reply
        .code(400)
        .send({ error: { code: 'invalid_request', message: 'Login destination is invalid.' } });
    const returnPath = continuation.data.returnTo ?? '/';
    const state = randomBytes(32).toString('base64url');
    const nonce = randomBytes(32).toString('base64url');
    const codeVerifier = oidc.randomPKCECodeVerifier();
    try {
      const url = await options.oidc.authorizationUrl({
        state,
        nonce,
        codeVerifier,
        ...(continuation.data.prompt ? { prompt: continuation.data.prompt } : {}),
      });
      if (url.protocol !== 'https:') throw new Error('OIDC authorization URL must use HTTPS');
      await options.controlPlane.createLoginAttempt({ state, nonce, codeVerifier, returnPath });
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
      return failLogin(reply, options, 'callback_state_invalid');
    }
    let failureReason: HostedAuthFailureReason = 'login_attempt_store_failed';
    let returnPath: '/' | '/invite' = '/';
    try {
      const attempt = await options.controlPlane.consumeLoginAttempt(parsed.data.state);
      if (attempt === undefined) return failLogin(reply, options, 'login_attempt_unavailable');
      returnPath = attempt.returnPath ?? '/';
      if (parsed.data.error !== undefined)
        return failLogin(reply, options, 'provider_rejected', undefined, returnPath);
      if (parsed.data.code === undefined)
        return failLogin(reply, options, 'authorization_code_missing', undefined, returnPath);
      const callbackUrl = new URL('/v1/auth/callback', options.publicOrigin);
      callbackUrl.search = new URL(request.url, options.publicOrigin).search;
      failureReason = 'oidc_exchange_failed';
      const identity = await options.oidc.exchange({
        callbackUrl,
        state: parsed.data.state,
        ...attempt,
      });
      failureReason = 'identity_store_failed';
      const userId = await options.controlPlane.findOrCreateUser(identity);
      failureReason = 'session_store_failed';
      const token = await options.controlPlane.createSession({
        userId,
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      });
      const previousToken = sessionToken(request);
      if (previousToken !== undefined) {
        failureReason = 'previous_session_revocation_failed';
        await options.controlPlane.revokeSession(previousToken);
      }
      failureReason = 'session_cookie_failed';
      reply.setCookie(SESSION_COOKIE, token, {
        path: '/',
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        maxAge: SESSION_TTL_MS / 1_000,
      });
      return reply.header('cache-control', 'no-store').redirect(returnPath);
    } catch (error) {
      return failLogin(
        reply,
        options,
        failureReason,
        failureReason === 'oidc_exchange_failed' ? oidcFailureDetails(error) : undefined,
        returnPath,
      );
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
