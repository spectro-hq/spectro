import { randomBytes, randomUUID } from 'node:crypto';

import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PostgresAuthControlPlane } from './postgres-auth-control-plane.js';
import { createApiApp } from './app.js';
import type { HostedAuthOptions } from './hosted-auth.js';

const sql = postgres(
  process.env.SPECTRO_POSTGRES_URL ?? 'postgres://spectro:spectro_local@127.0.0.1:5432/spectro',
  { max: 2 },
);
const store = new PostgresAuthControlPlane(sql);
const suffix = randomUUID().replaceAll('-', '');
const userId = `usr_${suffix}`;
const otherUserId = `usr_other_${suffix}`;
const organizationId = `org_${suffix}`;
const otherOrganizationId = `org_other_${suffix}`;
const projectId = `prj_${suffix}`;
const otherProjectId = `prj_other_${suffix}`;
const newSubject = `new-${suffix}`;
let discoveredUserId: string | undefined;

describe('PostgresAuthControlPlane integration', () => {
  beforeAll(async () => {
    await sql`INSERT INTO console_users (id, email) VALUES (${userId}, 'same@example.test'), (${otherUserId}, 'same@example.test')`;
    await sql`INSERT INTO external_identities (issuer, subject, user_id) VALUES ('https://issuer.example.test', 'subject-one', ${userId})`;
    await sql`INSERT INTO organizations (id, name) VALUES (${organizationId}, 'One'), (${otherOrganizationId}, 'Two')`;
    await sql`
      INSERT INTO organization_memberships (organization_id, user_id, role)
      VALUES (${organizationId}, ${userId}, 'viewer'), (${otherOrganizationId}, ${otherUserId}, 'owner')
    `;
    await sql`
      INSERT INTO projects (id, organization_id, name)
      VALUES (${projectId}, ${organizationId}, 'First'), (${otherProjectId}, ${otherOrganizationId}, 'Second')
    `;
    await sql`
      INSERT INTO project_environments (project_id, name)
      VALUES (${projectId}, 'production'), (${otherProjectId}, 'production')
    `;
  });

  afterAll(async () => {
    await sql`DELETE FROM console_sessions WHERE user_id IN (${userId}, ${otherUserId})`;
    await sql`DELETE FROM project_environments WHERE project_id IN (${projectId}, ${otherProjectId})`;
    await sql`DELETE FROM projects WHERE id IN (${projectId}, ${otherProjectId})`;
    await sql`DELETE FROM organization_memberships WHERE organization_id IN (${organizationId}, ${otherOrganizationId})`;
    await sql`DELETE FROM organizations WHERE id IN (${organizationId}, ${otherOrganizationId})`;
    await sql`DELETE FROM external_identities WHERE user_id IN (${userId}, ${otherUserId})`;
    await sql`DELETE FROM console_users WHERE id IN (${userId}, ${otherUserId})`;
    if (discoveredUserId !== undefined) {
      await sql`DELETE FROM console_sessions WHERE user_id = ${discoveredUserId}`;
      await sql`DELETE FROM external_identities WHERE user_id = ${discoveredUserId}`;
      await sql`DELETE FROM console_users WHERE id = ${discoveredUserId}`;
    }
    await store.close();
  });

  it('binds an external identity to issuer and subject rather than email', async () => {
    await expect(
      sql`
        INSERT INTO external_identities (issuer, subject, user_id)
        VALUES ('https://issuer.example.test', 'subject-one', ${otherUserId})
      `,
    ).rejects.toMatchObject({ code: '23505' });

    const rows = await sql<{ readonly user_id: string }[]>`
      SELECT user_id FROM external_identities
      WHERE issuer = 'https://issuer.example.test' AND subject = 'subject-one'
    `;
    expect(rows).toEqual([{ user_id: userId }]);
  });

  it('consumes login attempts once and does not merge users by email', async () => {
    const state = randomBytes(32).toString('base64url');
    await store.createLoginAttempt({ state, codeVerifier: 'verifier', nonce: 'nonce' });
    expect(await store.consumeLoginAttempt(state)).toEqual({
      codeVerifier: 'verifier',
      nonce: 'nonce',
    });
    expect(await store.consumeLoginAttempt(state)).toBeUndefined();
    const identity = {
      issuer: 'https://issuer.example.test',
      subject: newSubject,
      email: 'same@example.test',
    };
    discoveredUserId = await store.findOrCreateUser(identity);
    expect(discoveredUserId).toMatch(/^usr_/);
    expect(discoveredUserId).not.toBe(userId);
    expect(await store.findOrCreateUser(identity)).toBe(discoveredUserId);
  });

  it('enforces live membership and actor identity across HTTP and PostgreSQL', async () => {
    const token = await store.createSession({ userId, expiresAt: new Date(Date.now() + 60_000) });
    const origin = 'https://console.spectro.example';
    const hostedAuth: HostedAuthOptions = {
      publicOrigin: origin,
      csrfSecret: 'a-secret-with-at-least-thirty-two-bytes',
      oidc: {
        authorizationUrl: async () => new URL('https://issuer.example.test/authorize'),
        exchange: async () => ({ issuer: 'https://issuer.example.test', subject: 'subject-one' }),
      },
      controlPlane: store,
    };
    let actorId: string | undefined;
    const app = createApiApp({
      hostedAuth,
      eventStore: { list: async () => ({ data: [] }) },
      issueLifecycleStore: {
        getMany: async () => new Map(),
        history: async () => [],
        set: async (input) => {
          actorId = input.actorId;
          return {
            fingerprint: input.fingerprint,
            status: input.status,
            updatedAt: new Date().toISOString(),
          };
        },
      },
    });
    try {
      const headers = { cookie: `__Host-spectro-session=${token}` };
      const query = '?environment=production&from=100&to=200';
      expect(
        (
          await app.inject({
            method: 'GET',
            url: `/v1/projects/${projectId}/events${query}`,
            headers,
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await app.inject({
            method: 'GET',
            url: `/v1/projects/${otherProjectId}/events${query}`,
            headers,
          })
        ).statusCode,
      ).toBe(403);
      const session = await app.inject({ method: 'GET', url: '/v1/auth/session', headers });
      const csrf: string = session.json().csrfToken;
      const issueUrl = `/v1/projects/${projectId}/issues/${'a'.repeat(32)}`;
      const write = () =>
        app.inject({
          method: 'PATCH',
          url: issueUrl,
          headers: { ...headers, origin, 'x-csrf-token': csrf },
          payload: { environment: 'production', status: 'resolved' },
        });
      expect((await write()).statusCode).toBe(403);
      await sql`UPDATE organization_memberships SET role = 'member' WHERE organization_id = ${organizationId} AND user_id = ${userId}`;
      expect((await write()).statusCode).toBe(200);
      expect(actorId).toBe(userId);
      await sql`DELETE FROM organization_memberships WHERE organization_id = ${organizationId} AND user_id = ${userId}`;
      expect((await write()).statusCode).toBe(403);
      const logout = await app.inject({
        method: 'POST',
        url: '/v1/auth/logout',
        headers: { ...headers, origin, 'x-csrf-token': csrf },
      });
      expect(logout.statusCode).toBe(204);
      expect(await store.resolveSession(token)).toBeUndefined();
    } finally {
      await app.close();
      await store.revokeSession(token);
      await sql`
        INSERT INTO organization_memberships (organization_id, user_id, role)
        VALUES (${organizationId}, ${userId}, 'viewer')
        ON CONFLICT (organization_id, user_id) DO UPDATE SET role = 'viewer'
      `;
    }
  });

  it('checks live membership, project, environment, and action before granting access', async () => {
    const token = await store.createSession({
      userId,
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect(await store.resolveSession(token)).toEqual({ userId });
    expect(
      await store.authorizeProject({
        sessionToken: token,
        projectId,
        environment: 'production',
        action: 'project:read',
      }),
    ).toEqual({ userId });
    expect(
      await store.authorizeProject({
        sessionToken: token,
        projectId,
        environment: 'production',
        action: 'issue:write',
      }),
    ).toBeUndefined();
    expect(
      await store.authorizeProject({
        sessionToken: token,
        projectId: otherProjectId,
        environment: 'production',
        action: 'project:read',
      }),
    ).toBeUndefined();
    expect(
      await store.authorizeProject({
        sessionToken: token,
        projectId,
        environment: 'unregistered',
        action: 'project:read',
      }),
    ).toBeUndefined();

    await sql`
      UPDATE organization_memberships SET role = 'member'
      WHERE organization_id = ${organizationId} AND user_id = ${userId}
    `;
    expect(
      await store.authorizeProject({
        sessionToken: token,
        projectId,
        environment: 'production',
        action: 'issue:write',
      }),
    ).toEqual({ userId });

    await sql`
      DELETE FROM organization_memberships
      WHERE organization_id = ${organizationId} AND user_id = ${userId}
    `;
    expect(
      await store.authorizeProject({
        sessionToken: token,
        projectId,
        environment: 'production',
        action: 'project:read',
      }),
    ).toBeUndefined();
    await store.revokeSession(token);
    expect(await store.resolveSession(token)).toBeUndefined();
  });

  it('denies expired and disabled sessions', async () => {
    const token = await store.createSession({
      userId: otherUserId,
      expiresAt: new Date(Date.now() + 60_000),
    });
    await sql`
      UPDATE console_sessions SET expires_at = created_at + interval '1 microsecond'
      WHERE user_id = ${otherUserId}
    `;
    expect(await store.resolveSession(token)).toBeUndefined();

    const active = await store.createSession({
      userId: otherUserId,
      expiresAt: new Date(Date.now() + 60_000),
    });
    await sql`UPDATE console_users SET disabled_at = now() WHERE id = ${otherUserId}`;
    expect(await store.resolveSession(active)).toBeUndefined();
    expect(
      await store.authorizeProject({
        sessionToken: active,
        projectId: otherProjectId,
        environment: 'production',
        action: 'project:read',
      }),
    ).toBeUndefined();
    await expect(
      store.createSession({ userId: otherUserId, expiresAt: new Date(Date.now() + 60_000) }),
    ).rejects.toThrow('User cannot receive a session');
  });
});
