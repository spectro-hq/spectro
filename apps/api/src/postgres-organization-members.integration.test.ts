import { createHash, randomUUID } from 'node:crypto';

import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApiApp } from './app.js';
import { PostgresAuthControlPlane } from './postgres-auth-control-plane.js';
import { PostgresOrganizationMemberStore } from './postgres-organization-members.js';
import { PostgresWorkspaceStore } from './postgres-workspaces.js';

const sql = postgres(
  process.env.SPECTRO_POSTGRES_URL ?? 'postgres://spectro:spectro_local@127.0.0.1:5432/spectro',
  { max: 8 },
);
const auth = new PostgresAuthControlPlane(sql);
const members = new PostgresOrganizationMemberStore(sql);
const suffix = randomUUID().replaceAll('-', '');
const owner = `usr_owner_${suffix}`;
const admin = `usr_admin_${suffix}`;
const guest = `usr_guest_${suffix}`;
const other = `usr_other_${suffix}`;
const ids = [owner, admin, guest, other];
const organizations: string[] = [];
const origin = 'https://console.spectro.example';
const app = createApiApp({
  hostedAuth: {
    publicOrigin: origin,
    csrfSecret: 'a-secret-with-at-least-thirty-two-bytes',
    oidc: {
      authorizationUrl: async ({ state }) =>
        new URL(`https://issuer.example/authorize?state=${state}`),
      exchange: async () => ({
        issuer: 'https://issuer.example',
        subject: suffix,
        email: 'guest@example.test',
        emailVerified: true,
      }),
    },
    controlPlane: auth,
  },
  organizationMemberStore: members,
  workspaceStore: new PostgresWorkspaceStore(sql),
});
let headers: Record<string, Record<string, string>> = {};
function fixtureHeaders(id: string): Record<string, string> {
  const value = headers[id];
  if (!value) throw new Error('Missing fixture session');
  return value;
}
async function session(userId: string): Promise<Record<string, string>> {
  const token = await auth.createSession({ userId, expiresAt: new Date(Date.now() + 300_000) });
  const cookie = `__Host-spectro-session=${token}`;
  const response = await app.inject({ url: '/v1/auth/session', headers: { cookie } });
  const csrf: string = response.json().csrfToken;
  return { cookie, origin, 'x-csrf-token': csrf };
}
async function workspace(): Promise<string> {
  const result = await app.inject({
    method: 'POST',
    url: '/v1/organizations',
    headers: fixtureHeaders(owner),
    payload: { name: `Membership test ${suffix}` },
  });
  const id: string = result.json().id;
  organizations.push(id);
  await sql`INSERT INTO organization_memberships (organization_id, user_id, role) VALUES (${id}, ${admin}, 'admin')`;
  return id;
}
async function invite(
  organizationId: string,
  email = 'guest@example.test',
  role = 'member',
  actorId = owner,
) {
  return app.inject({
    method: 'POST',
    url: `/v1/organizations/${organizationId}/invitations`,
    headers: fixtureHeaders(actorId),
    payload: { email, role },
  });
}
async function claimed(link: string, userId = guest): Promise<Record<string, string>> {
  const token = new URLSearchParams(new URL(link).hash.slice(1)).get('token');
  const response = await app.inject({
    method: 'POST',
    url: '/v1/invitations/claim',
    headers: { origin },
    payload: { token },
  });
  expect(response.statusCode).toBe(204);
  expect(response.headers['set-cookie']).toContain('HttpOnly');
  expect(response.headers['set-cookie']).toContain('Secure');
  const person = headers[userId];
  if (!person) throw new Error('Missing fixture headers');
  return { ...person, cookie: `${person.cookie}; __Host-spectro-invitation=${token}` };
}
describe('team membership across HTTP, sessions and PostgreSQL', () => {
  beforeAll(async () => {
    await sql`INSERT INTO console_users ${sql(ids.map((id) => ({ id, email: id === guest ? 'guest@example.test' : `${id}@example.test`, email_verified: true })))}`;
    headers = Object.fromEntries(
      await Promise.all(ids.map(async (id) => [id, await session(id)] as const)),
    );
  });
  afterAll(async () => {
    await app.close();
    if (organizations.length) {
      await sql`DELETE FROM organization_invitations WHERE organization_id IN ${sql(organizations)}`;
      await sql`DELETE FROM workspace_audit_log WHERE organization_id IN ${sql(organizations)}`;
      await sql`DELETE FROM organization_memberships WHERE organization_id IN ${sql(organizations)}`;
      await sql`DELETE FROM organizations WHERE id IN ${sql(organizations)}`;
    }
    await sql`DELETE FROM console_sessions WHERE user_id IN ${sql(ids)}`;
    await sql`DELETE FROM console_users WHERE id IN ${sql(ids)}`;
    await sql.end();
  });
  it('claims a fragment link, verifies the recipient, accepts once and audits without raw secrets', async () => {
    const org = await workspace();
    const created = await invite(org, ' Guest@Example.test ');
    expect(created.statusCode).toBe(201);
    const { link, id }: { link: string; id: string } = created.json();
    expect(new URL(link).search).toBe('');
    const token = new URLSearchParams(new URL(link).hash.slice(1)).get('token');
    if (!token) throw new Error('Missing invitation token');
    const [stored] =
      await sql`SELECT token_hash, email FROM organization_invitations WHERE id = ${id}`;
    expect(stored?.token_hash).toEqual(createHash('sha256').update(token).digest());
    expect(stored?.email).toBe('guest@example.test');
    expect((await invite(org)).statusCode).toBe(409);
    const recipient = await claimed(link);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/invitations/preview',
          headers: recipient,
          payload: {},
        })
      ).json().role,
    ).toBe('member');
    const mismatched = await claimed(link, other);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/invitations/accept',
          headers: mismatched,
          payload: {},
        })
      ).json().error.code,
    ).toBe('recipient_mismatch');
    await sql`UPDATE console_users SET email_verified = false WHERE id = ${guest}`;
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/invitations/accept',
          headers: recipient,
          payload: {},
        })
      ).json().error.code,
    ).toBe('email_unverified');
    await sql`UPDATE console_users SET email_verified = true WHERE id = ${guest}`;
    const results = await Promise.all(
      [1, 2].map(() =>
        app.inject({
          method: 'POST',
          url: '/v1/invitations/accept',
          headers: recipient,
          payload: {},
        }),
      ),
    );
    expect(results.filter((result) => result.statusCode === 200)).toHaveLength(1);
    expect(results.filter((result) => result.statusCode === 410)).toHaveLength(1);
    expect((await invite(org)).json().error.code).toBe('already_member');
    const audit =
      await sql`SELECT action, resource_id, next_role FROM workspace_audit_log WHERE organization_id = ${org} ORDER BY id`;
    expect(audit.map((row) => row.action)).toEqual([
      'organization.created',
      'invitation.created',
      'invitation.accepted',
    ]);
    expect(JSON.stringify(audit)).not.toContain(token);
    expect(JSON.stringify(audit)).not.toContain('guest@example.test');
  });
  it('enforces live roles, non-Owner Admin scope, isolation, bounded pagination and stale-role conflicts', async () => {
    const org = await workspace();
    await sql`INSERT INTO organization_memberships (organization_id, user_id, role) VALUES (${org}, ${guest}, 'viewer')`;
    const base = `/v1/organizations/${org}`;
    expect(
      (await app.inject({ url: `${base}/members`, headers: fixtureHeaders(other) })).statusCode,
    ).toBe(403);
    expect(
      (await app.inject({ url: `${base}/members?limit=1`, headers: fixtureHeaders(guest) })).json()
        .nextCursor,
    ).toBeDefined();
    expect(
      (await app.inject({ url: `${base}/members?limit=101`, headers: fixtureHeaders(owner) }))
        .statusCode,
    ).toBe(400);
    expect(
      (await app.inject({ url: `${base}/invitations`, headers: fixtureHeaders(guest) })).statusCode,
    ).toBe(403);
    expect((await invite(org, 'new@example.test', 'owner', admin)).json().error.code).toBe(
      'owner_protected',
    );
    for (const [target, role, expectedRole, code] of [
      [owner, 'viewer', 'owner', 403],
      [guest, 'owner', 'viewer', 403],
      [guest, 'member', 'admin', 409],
      [guest, 'member', 'viewer', 204],
    ] as const) {
      // oxlint-disable-next-line no-await-in-loop -- check each distinct authorization/conflict boundary.
      const response = await app.inject({
        method: 'PATCH',
        url: `${base}/members/${target}`,
        headers: fixtureHeaders(admin),
        payload: { role, expectedRole },
      });
      expect(response.statusCode).toBe(code);
    }
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `${base}/members/${owner}`,
          headers: fixtureHeaders(admin),
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `${base}/members/${guest}`,
          headers: fixtureHeaders(admin),
        })
      ).statusCode,
    ).toBe(204);
    expect(
      (await app.inject({ url: `${base}/members`, headers: fixtureHeaders(guest) })).statusCode,
    ).toBe(403);
  });
  it('serializes concurrent Owner demotions and rejects removal of the remaining Owner', async () => {
    const org = await workspace();
    await sql`UPDATE organization_memberships SET role = 'owner' WHERE organization_id = ${org} AND user_id = ${admin}`;
    const results = await Promise.all(
      [owner, admin].map((target) =>
        app.inject({
          method: 'PATCH',
          url: `/v1/organizations/${org}/members/${target}`,
          headers: fixtureHeaders(target),
          payload: { role: 'admin', expectedRole: 'owner' },
        }),
      ),
    );
    expect(results.filter((result) => result.statusCode === 204)).toHaveLength(1);
    expect(results.filter((result) => result.statusCode === 409)).toHaveLength(1);
    const [remaining] = await sql<
      { user_id: string }[]
    >`SELECT user_id FROM organization_memberships WHERE organization_id = ${org} AND role = 'owner'`;
    if (!remaining) throw new Error('Owner lost');
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `/v1/organizations/${org}/members/${remaining.user_id}`,
          headers: fixtureHeaders(remaining.user_id),
        })
      ).json().error.code,
    ).toBe('last_owner');
  });
  it('rejects expiry, revocation, existing membership and expired or forged authentication/CSRF', async () => {
    const org = await workspace();
    const created = await invite(org);
    const { id, link }: { id: string; link: string } = created.json();
    const recipient = await claimed(link);
    const path = `/v1/organizations/${org}/invitations/${id}`;
    expect((await app.inject({ method: 'DELETE', url: path })).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: path,
          headers: { ...fixtureHeaders(owner), origin: 'https://evil.example' },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/invitations/claim',
          payload: { token: new URLSearchParams(new URL(link).hash.slice(1)).get('token') },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (await app.inject({ method: 'DELETE', url: path, headers: fixtureHeaders(owner) }))
        .statusCode,
    ).toBe(204);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/invitations/accept',
          headers: recipient,
          payload: {},
        })
      ).statusCode,
    ).toBe(410);
    const replacement = await invite(org);
    const next = replacement.json<{ id: string; link: string }>();
    await sql`UPDATE organization_invitations SET created_at = now() - interval '8 days', expires_at = now() - interval '1 day' WHERE id = ${next.id}`;
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/invitations/claim',
          headers: { origin },
          payload: { token: new URLSearchParams(new URL(next.link).hash.slice(1)).get('token') },
        })
      ).statusCode,
    ).toBe(410);
    expect((await invite(org)).statusCode).toBe(201);
  });
});
