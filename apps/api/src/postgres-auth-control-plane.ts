import { createHash, randomBytes } from 'node:crypto';

import type { Sql } from 'postgres';

import { organizationRoleAllows, type OrganizationRole } from './organization-permissions.js';

interface SessionUserRow {
  readonly user_id: string;
}

interface ProjectMembershipRow extends SessionUserRow {
  readonly role: OrganizationRole;
}

interface LoginAttemptRow {
  readonly code_verifier: string;
  readonly nonce: string;
  readonly return_path: '/' | '/invite';
}

function tokenHash(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

function validSessionToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(token);
}

export class PostgresAuthControlPlane {
  readonly #sql: Sql;

  constructor(sql: Sql) {
    this.#sql = sql;
  }

  async close(): Promise<void> {
    await this.#sql.end();
  }

  async createLoginAttempt(input: {
    readonly state: string;
    readonly codeVerifier: string;
    readonly nonce: string;
    readonly returnPath?: '/' | '/invite';
  }): Promise<void> {
    await this.#sql`DELETE FROM oidc_login_attempts WHERE expires_at < now()`;
    await this.#sql`
      INSERT INTO oidc_login_attempts (state_hash, code_verifier, nonce, expires_at, return_path)
      VALUES (${tokenHash(input.state)}, ${input.codeVerifier}, ${input.nonce}, now() + interval '10 minutes', ${input.returnPath ?? '/'})
    `;
  }

  async consumeLoginAttempt(state: string): Promise<
    | {
        readonly codeVerifier: string;
        readonly nonce: string;
        readonly returnPath?: '/' | '/invite';
      }
    | undefined
  > {
    if (!validSessionToken(state)) return undefined;
    const [row] = await this.#sql<LoginAttemptRow[]>`
      DELETE FROM oidc_login_attempts
      WHERE state_hash = ${tokenHash(state)} AND expires_at > now()
      RETURNING code_verifier, nonce, return_path
    `;
    return row === undefined
      ? undefined
      : {
          codeVerifier: row.code_verifier,
          nonce: row.nonce,
          ...(row.return_path === '/' ? {} : { returnPath: row.return_path }),
        };
  }

  async findOrCreateUser(input: {
    readonly issuer: string;
    readonly subject: string;
    readonly email?: string;
    readonly emailVerified?: boolean;
  }): Promise<string> {
    if (
      input.issuer.length < 1 ||
      input.issuer.length > 2048 ||
      input.subject.length < 1 ||
      input.subject.length > 255
    ) {
      throw new Error('OIDC identity is invalid');
    }
    return this.#sql.begin(async (transaction) => {
      await transaction`
        SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify([input.issuer, input.subject])}, 0))
      `;
      const [existing] = await transaction<SessionUserRow[]>`
        SELECT user_id FROM external_identities
        WHERE issuer = ${input.issuer} AND subject = ${input.subject}
      `;
      const email =
        input.email !== undefined && input.email.length <= 320
          ? input.email.trim().toLowerCase()
          : null;
      const verified = email !== null && input.emailVerified === true;
      if (existing !== undefined) {
        await transaction`UPDATE console_users SET email = ${email}, email_verified = ${verified} WHERE id = ${existing.user_id}`;
        return existing.user_id;
      }
      const userId = `usr_${randomBytes(16).toString('base64url')}`;
      await transaction`
        INSERT INTO console_users (id, email, email_verified)
        VALUES (${userId}, ${email}, ${verified})
      `;
      await transaction`
        INSERT INTO external_identities (issuer, subject, user_id)
        VALUES (${input.issuer}, ${input.subject}, ${userId})
      `;
      return userId;
    });
  }

  async createSession(input: {
    readonly userId: string;
    readonly expiresAt: Date;
  }): Promise<string> {
    if (!Number.isFinite(input.expiresAt.getTime()) || input.expiresAt.getTime() <= Date.now()) {
      throw new Error('Session expiration must be in the future');
    }

    const token = randomBytes(32).toString('base64url');
    const rows = await this.#sql<SessionUserRow[]>`
      INSERT INTO console_sessions (token_hash, user_id, expires_at)
      SELECT ${tokenHash(token)}, id, ${input.expiresAt}
      FROM console_users
      WHERE id = ${input.userId} AND disabled_at IS NULL
      RETURNING user_id
    `;
    if (rows.length !== 1) throw new Error('User cannot receive a session');
    return token;
  }

  async resolveSession(token: string): Promise<{ readonly userId: string } | undefined> {
    if (!validSessionToken(token)) return undefined;
    const [row] = await this.#sql<SessionUserRow[]>`
      SELECT session.user_id
      FROM console_sessions AS session
      JOIN console_users AS person ON person.id = session.user_id
      WHERE session.token_hash = ${tokenHash(token)}
        AND session.expires_at > now()
        AND session.revoked_at IS NULL
        AND person.disabled_at IS NULL
    `;
    return row === undefined ? undefined : { userId: row.user_id };
  }

  async authorizeProject(input: {
    readonly sessionToken: string;
    readonly projectId: string;
    readonly environment: string;
    readonly action: 'project:read' | 'issue:write';
  }): Promise<{ readonly userId: string } | undefined> {
    if (!validSessionToken(input.sessionToken)) return undefined;
    const [row] = await this.#sql<ProjectMembershipRow[]>`
      SELECT session.user_id, membership.role
      FROM console_sessions AS session
      JOIN console_users AS person ON person.id = session.user_id
      JOIN organization_memberships AS membership ON membership.user_id = person.id
      JOIN projects AS project ON project.organization_id = membership.organization_id
      WHERE session.token_hash = ${tokenHash(input.sessionToken)}
        AND session.expires_at > now()
        AND session.revoked_at IS NULL
        AND person.disabled_at IS NULL
        AND project.id = ${input.projectId}
        AND EXISTS (
          SELECT 1 FROM project_environments AS environment
          WHERE environment.project_id = project.id
            AND environment.name = ${input.environment}
        )
    `;
    if (row === undefined || !organizationRoleAllows(row.role, input.action)) return undefined;
    return { userId: row.user_id };
  }

  async revokeSession(token: string): Promise<void> {
    if (!validSessionToken(token)) return;
    await this.#sql`
      UPDATE console_sessions
      SET revoked_at = now()
      WHERE token_hash = ${tokenHash(token)} AND revoked_at IS NULL
    `;
  }
}
