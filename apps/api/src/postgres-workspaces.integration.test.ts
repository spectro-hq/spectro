import { randomUUID } from 'node:crypto';

import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createApiApp } from './app.js';
import type { EventQueryStore } from './events.js';
import type { OrganizationRole } from './organization-permissions.js';
import { PostgresAuthControlPlane } from './postgres-auth-control-plane.js';
import { PostgresWorkspaceStore } from './postgres-workspaces.js';
import type { OrganizationSummary, ProjectSummary, WorkspacePage } from './workspaces.js';

const sql = postgres(
  process.env.SPECTRO_POSTGRES_URL ?? 'postgres://spectro:spectro_local@127.0.0.1:5432/spectro',
  { max: 5 },
);
const auth = new PostgresAuthControlPlane(sql);
const workspaces = new PostgresWorkspaceStore(sql);
const suffix = randomUUID().replaceAll('-', '');
const prefix = `Workspace test ${suffix}`;
const ownerId = `usr_owner_${suffix}`;
const teammateId = `usr_team_${suffix}`;
const outsiderId = `usr_other_${suffix}`;
const userIds = [ownerId, teammateId, outsiderId];
const origin = 'https://console.spectro.example';
const listEvents = vi.fn<EventQueryStore['list']>(async () => ({ data: [] }));
const app = createApiApp({
  hostedAuth: {
    publicOrigin: origin,
    csrfSecret: 'a-secret-with-at-least-thirty-two-bytes',
    oidc: {
      authorizationUrl: async () => new URL('https://issuer.example/authorize'),
      exchange: async () => ({ issuer: 'https://issuer.example', subject: suffix }),
    },
    controlPlane: auth,
  },
  workspaceStore: workspaces,
  eventStore: { list: listEvents },
});
let ownerHeaders: Record<string, string>;
let teammateHeaders: Record<string, string>;
let outsiderHeaders: Record<string, string>;

async function sessionHeaders(userId: string): Promise<Record<string, string>> {
  const token = await auth.createSession({ userId, expiresAt: new Date(Date.now() + 300_000) });
  const cookie = `__Host-spectro-session=${token}`;
  const response = await app.inject({
    method: 'GET',
    url: '/v1/auth/session',
    headers: { cookie },
  });
  expect(response.statusCode).toBe(200);
  const csrf: string = response.json().csrfToken;
  return { cookie, origin, 'x-csrf-token': csrf };
}

async function createOrganization(
  label: string,
  headers = ownerHeaders,
): Promise<OrganizationSummary> {
  const response = await app.inject({
    method: 'POST',
    url: '/v1/organizations',
    headers,
    payload: { name: `${prefix} ${label}` },
  });
  expect(response.statusCode).toBe(201);
  return response.json<OrganizationSummary>();
}

async function createProject(
  organizationId: string,
  headers = ownerHeaders,
): Promise<ProjectSummary> {
  const response = await app.inject({
    method: 'POST',
    url: `/v1/organizations/${organizationId}/projects`,
    headers,
    payload: { name: 'Web', environments: ['production', 'staging'] },
  });
  expect(response.statusCode).toBe(201);
  return response.json<ProjectSummary>();
}

describe('workspace provisioning across HTTP and PostgreSQL', () => {
  beforeAll(async () => {
    await sql`INSERT INTO console_users ${sql(userIds.map((id) => ({ id })))}`;
    [ownerHeaders, teammateHeaders, outsiderHeaders] = await Promise.all([
      sessionHeaders(ownerId),
      sessionHeaders(teammateId),
      sessionHeaders(outsiderId),
    ]);
  });

  afterAll(async () => {
    await app.close();
    // Only remove fixtures bearing this run's random identifier, never the Auth0 account.
    const organizations = await sql<
      { readonly id: string }[]
    >`SELECT id FROM organizations WHERE name LIKE ${`${prefix}%`}`;
    const ids = organizations.map((organization) => organization.id);
    if (ids.length > 0) {
      await sql`DELETE FROM workspace_audit_log WHERE organization_id IN ${sql(ids)}`;
      await sql`DELETE FROM project_environments WHERE project_id IN (SELECT id FROM projects WHERE organization_id IN ${sql(ids)})`;
      await sql`DELETE FROM projects WHERE organization_id IN ${sql(ids)}`;
      await sql`DELETE FROM organization_memberships WHERE organization_id IN ${sql(ids)}`;
      await sql`DELETE FROM organizations WHERE id IN ${sql(ids)}`;
    }
    await sql`DELETE FROM console_sessions WHERE user_id IN ${sql(userIds)}`;
    await sql`DELETE FROM console_users WHERE id IN ${sql(userIds)}`;
    await sql.end();
  });

  it('starts with no membership, then creates an Owner and an authorized project', async () => {
    const before = await app.inject({
      method: 'GET',
      url: '/v1/organizations',
      headers: ownerHeaders,
    });
    expect(before.json()).toEqual({ data: [] });
    const organization = await createOrganization('first');
    expect(organization.role).toBe('owner');
    const [membership] =
      await sql`SELECT user_id, role FROM organization_memberships WHERE organization_id = ${organization.id}`;
    expect(membership).toEqual({ user_id: ownerId, role: 'owner' });
    const project = await createProject(organization.id);
    expect(project.organizationId).toBe(organization.id);
    const projects = await app.inject({
      method: 'GET',
      url: `/v1/organizations/${organization.id}/projects`,
      headers: ownerHeaders,
    });
    expect(projects.json()).toEqual({ data: [project] });
    const eventUrl = `/v1/projects/${project.id}/events?environment=production&from=0&to=1`;
    const callsBefore = listEvents.mock.calls.length;
    expect(
      (await app.inject({ method: 'GET', url: eventUrl, headers: ownerHeaders })).statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ method: 'GET', url: eventUrl, headers: outsiderHeaders })).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: eventUrl.replace('production', 'unknown'),
          headers: ownerHeaders,
        })
      ).statusCode,
    ).toBe(403);
    expect(listEvents.mock.calls.length - callsBefore).toBe(1);
    const audit =
      await sql`SELECT actor_id, action, resource_id FROM workspace_audit_log WHERE organization_id = ${organization.id} ORDER BY id`;
    expect(audit).toEqual([
      { actor_id: ownerId, action: 'organization.created', resource_id: organization.id },
      { actor_id: ownerId, action: 'project.created', resource_id: project.id },
    ]);
  });

  it('isolates organization/project listings and denies foreign and missing organizations equally', async () => {
    const own = await createOrganization('own');
    const foreign = await createOrganization('foreign', outsiderHeaders);
    await createProject(foreign.id, outsiderHeaders);
    const response = await app.inject({
      method: 'GET',
      url: '/v1/organizations',
      headers: ownerHeaders,
    });
    const ids = response
      .json<WorkspacePage<OrganizationSummary>>()
      .data.map((organization) => organization.id);
    expect(ids).toContain(own.id);
    expect(ids).not.toContain(foreign.id);
    for (const organizationId of [foreign.id, 'org_missing']) {
      // oxlint-disable-next-line no-await-in-loop -- verify both deny paths.
      const read = await app.inject({
        method: 'GET',
        url: `/v1/organizations/${organizationId}/projects`,
        headers: ownerHeaders,
      });
      // oxlint-disable-next-line no-await-in-loop -- verify both deny paths.
      const write = await app.inject({
        method: 'POST',
        url: `/v1/organizations/${organizationId}/projects`,
        headers: ownerHeaders,
        payload: { name: 'Denied', environments: ['production'] },
      });
      expect(read.statusCode).toBe(403);
      expect(write.statusCode).toBe(403);
      expect(read.json().error.code).toBe('forbidden');
    }
    const [denied] =
      await sql`SELECT count(*)::int AS count FROM projects WHERE name = 'Denied' AND organization_id = ${foreign.id}`;
    expect(denied?.count).toBe(0);
  });

  it.each<OrganizationRole>(['owner', 'admin', 'member', 'viewer'])(
    'enforces the live %s role on project creation',
    async (role) => {
      const organization = await createOrganization(role);
      await sql`INSERT INTO organization_memberships (organization_id, user_id, role) VALUES (${organization.id}, ${teammateId}, ${role})`;
      const url = `/v1/organizations/${organization.id}/projects`;
      expect((await app.inject({ method: 'GET', url, headers: teammateHeaders })).statusCode).toBe(
        200,
      );
      const write = await app.inject({
        method: 'POST',
        url,
        headers: teammateHeaders,
        payload: { name: 'By teammate', environments: ['production'] },
      });
      expect(write.statusCode).toBe(role === 'owner' || role === 'admin' ? 201 : 403);
      const audit =
        await sql`SELECT actor_id FROM workspace_audit_log WHERE organization_id = ${organization.id} AND action = 'project.created'`;
      expect(audit).toEqual(role === 'owner' || role === 'admin' ? [{ actor_id: teammateId }] : []);
      await sql`DELETE FROM organization_memberships WHERE organization_id = ${organization.id} AND user_id = ${teammateId}`;
      expect((await app.inject({ method: 'GET', url, headers: teammateHeaders })).statusCode).toBe(
        403,
      );
    },
  );

  it('paginates both lists without duplicates or foreign data', async () => {
    const organization = await createOrganization('pagination');
    const projects = await Promise.all([
      createProject(organization.id),
      createProject(organization.id),
      createProject(organization.id),
    ]);
    const path = `/v1/organizations/${organization.id}/projects`;
    const first = (
      await app.inject({ method: 'GET', url: `${path}?limit=2`, headers: ownerHeaders })
    ).json<WorkspacePage<ProjectSummary>>();
    expect(first.data).toHaveLength(2);
    expect(first.nextCursor).toBeDefined();
    const second = (
      await app.inject({
        method: 'GET',
        url: `${path}?limit=2&cursor=${first.nextCursor}`,
        headers: ownerHeaders,
      })
    ).json<WorkspacePage<ProjectSummary>>();
    expect(second.data).toHaveLength(1);
    expect(second.nextCursor).toBeUndefined();
    expect(new Set([...first.data, ...second.data].map((project) => project.id))).toEqual(
      new Set(projects.map((project) => project.id)),
    );
    const allOrganizations = (
      await app.inject({ method: 'GET', url: '/v1/organizations', headers: ownerHeaders })
    ).json<WorkspacePage<OrganizationSummary>>();
    const orgFirst = (
      await app.inject({ method: 'GET', url: '/v1/organizations?limit=1', headers: ownerHeaders })
    ).json<WorkspacePage<OrganizationSummary>>();
    const orgRest = (
      await app.inject({
        method: 'GET',
        url: `/v1/organizations?cursor=${orgFirst.nextCursor}`,
        headers: ownerHeaders,
      })
    ).json<WorkspacePage<OrganizationSummary>>();
    expect([...orgFirst.data, ...orgRest.data]).toEqual(allOrganizations.data);
  });

  it('rolls back a partially created project if an environment insert fails', async () => {
    const organization = await createOrganization('rollback');
    await expect(
      workspaces.createProject({
        userId: ownerId,
        organizationId: organization.id,
        name: 'Rollback',
        environments: ['production', 'production'],
      }),
    ).rejects.toMatchObject({ code: '23505' });
    const projects = await app.inject({
      method: 'GET',
      url: `/v1/organizations/${organization.id}/projects`,
      headers: ownerHeaders,
    });
    expect(projects.json()).toEqual({ data: [] });
    const [audit] =
      await sql`SELECT count(*)::int AS count FROM workspace_audit_log WHERE organization_id = ${organization.id}`;
    expect(audit?.count).toBe(1);
  });

  it('rejects revoked, expired and disabled sessions before provisioning', async () => {
    const attempt = (headers: Record<string, string>) =>
      app.inject({
        method: 'POST',
        url: '/v1/organizations',
        headers,
        payload: { name: `${prefix} forbidden` },
      });
    const revokedHeaders = await sessionHeaders(teammateId);
    expect(
      (await app.inject({ method: 'POST', url: '/v1/auth/logout', headers: revokedHeaders }))
        .statusCode,
    ).toBe(204);
    expect((await attempt(revokedHeaders)).statusCode).toBe(401);
    const expiredHeaders = await sessionHeaders(teammateId);
    await sql`UPDATE console_sessions SET expires_at = created_at + interval '1 microsecond' WHERE user_id = ${teammateId}`;
    expect((await attempt(expiredHeaders)).statusCode).toBe(401);
    const disabledHeaders = await sessionHeaders(teammateId);
    await sql`UPDATE console_users SET disabled_at = now() WHERE id = ${teammateId}`;
    try {
      expect((await attempt(disabledHeaders)).statusCode).toBe(401);
      const [created] =
        await sql`SELECT count(*)::int AS count FROM organizations WHERE name = ${`${prefix} forbidden`}`;
      expect(created?.count).toBe(0);
    } finally {
      await sql`UPDATE console_users SET disabled_at = NULL WHERE id = ${teammateId}`;
    }
  });
});
