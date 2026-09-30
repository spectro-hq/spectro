import { createHash } from 'node:crypto';

import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { v7 as uuidv7 } from 'uuid';

import {
  createApiApp,
  PostgresAuthControlPlane,
  PostgresProjectWriteKeyStore,
  PostgresWorkspaceStore,
  type HostedAuthOptions,
} from '@spectro/api';
import {
  createIngestApp,
  InMemoryEventStore,
  PostgresIngestWriteKeyAuthorizer,
} from '@spectro/ingest';
import { ENVELOPE_VERSION, EVENT_VERSION, type Envelope } from '@spectro/protocol';

const describeIntegration = process.env.SPECTRO_INTEGRATION === '1' ? describe : describe.skip;
const sql = postgres(
  process.env.SPECTRO_POSTGRES_URL ?? 'postgres://spectro:spectro_local@127.0.0.1:5432/spectro',
  { max: 5 },
);
const auth = new PostgresAuthControlPlane(sql);
const suffix = uuidv7().replaceAll('-', '');
const prefix = `Write-key test ${suffix}`;
const ownerId = `usr_key_owner_${suffix}`;
const memberId = `usr_key_member_${suffix}`;
const outsiderId = `usr_key_other_${suffix}`;
const userIds = [ownerId, memberId, outsiderId];
const origin = 'https://console.spectro.example';
const hostedAuth: HostedAuthOptions = {
  publicOrigin: origin,
  csrfSecret: 'a-secret-with-at-least-thirty-two-bytes',
  oidc: {
    authorizationUrl: async () => new URL('https://issuer.example/authorize'),
    exchange: async () => ({ issuer: 'https://issuer.example', subject: suffix }),
  },
  controlPlane: auth,
};
const apiApp = createApiApp({
  hostedAuth,
  workspaceStore: new PostgresWorkspaceStore(sql),
  projectWriteKeyStore: new PostgresProjectWriteKeyStore(sql),
  ingestionEndpoint: 'https://ingest.spectro.example/v1/envelope',
});
const ingestStore = new InMemoryEventStore();
const ingestApp = createIngestApp({
  writeKeyAuthorizer: new PostgresIngestWriteKeyAuthorizer(sql),
  store: ingestStore,
});
let ownerHeaders: Record<string, string>;
let memberHeaders: Record<string, string>;
let outsiderHeaders: Record<string, string>;

async function sessionHeaders(userId: string): Promise<Record<string, string>> {
  const token = await auth.createSession({
    userId,
    expiresAt: new Date(Date.now() + 300_000),
  });
  const cookie = `__Host-spectro-session=${token}`;
  const response = await apiApp.inject({
    method: 'GET',
    url: '/v1/auth/session',
    headers: { cookie },
  });
  expect(response.statusCode).toBe(200);
  const csrf: string = response.json().csrfToken;
  return { cookie, origin, 'x-csrf-token': csrf };
}

function envelope(projectId: string, environment: string): Envelope {
  const timestamp = Date.now();
  return {
    version: ENVELOPE_VERSION,
    sentAt: timestamp,
    items: [
      {
        type: 'event',
        payload: {
          id: uuidv7(),
          type: 'custom',
          name: 'write_key_integration',
          version: EVENT_VERSION,
          timestamp,
          context: {
            sdk: { name: '@spectro/integration-test', version: '0.1.0' },
            project: { id: projectId },
            environment,
          },
          payload: { properties: {} },
        },
      },
    ],
  };
}

describeIntegration('hosted write-key flow across API, PostgreSQL, and Ingest', () => {
  beforeAll(async () => {
    await sql`INSERT INTO console_users ${sql(userIds.map((id) => ({ id })))}`;
    [ownerHeaders, memberHeaders, outsiderHeaders] = await Promise.all([
      sessionHeaders(ownerId),
      sessionHeaders(memberId),
      sessionHeaders(outsiderId),
    ]);
  });

  afterAll(async () => {
    await Promise.all([apiApp.close(), ingestApp.close()]);
    const organizations = await sql<{ readonly id: string }[]>`
      SELECT id FROM organizations WHERE name LIKE ${`${prefix}%`}
    `;
    const organizationIds = organizations.map((organization) => organization.id);
    if (organizationIds.length > 0) {
      const projects = await sql<{ readonly id: string }[]>`
        SELECT id FROM projects WHERE organization_id IN ${sql(organizationIds)}
      `;
      const projectIds = projects.map((project) => project.id);
      await sql`DELETE FROM workspace_audit_log WHERE organization_id IN ${sql(organizationIds)}`;
      if (projectIds.length > 0) {
        await sql`DELETE FROM project_write_keys WHERE project_id IN ${sql(projectIds)}`;
        await sql`DELETE FROM project_environments WHERE project_id IN ${sql(projectIds)}`;
        await sql`DELETE FROM projects WHERE id IN ${sql(projectIds)}`;
      }
      await sql`DELETE FROM organization_memberships WHERE organization_id IN ${sql(organizationIds)}`;
      await sql`DELETE FROM organizations WHERE id IN ${sql(organizationIds)}`;
    }
    await sql`DELETE FROM console_sessions WHERE user_id IN ${sql(userIds)}`;
    await sql`DELETE FROM console_users WHERE id IN ${sql(userIds)}`;
    await sql.end();
  });

  it('provisions, authorizes, rotates, and revokes keys within project boundaries', async () => {
    const organizationResponse = await apiApp.inject({
      method: 'POST',
      url: '/v1/organizations',
      headers: ownerHeaders,
      payload: { name: `${prefix} owner` },
    });
    expect(organizationResponse.statusCode).toBe(201);
    const organization = organizationResponse.json<{ id: string }>();
    const projectResponse = await apiApp.inject({
      method: 'POST',
      url: `/v1/organizations/${organization.id}/projects`,
      headers: ownerHeaders,
      payload: { name: 'Web', environments: ['production', 'staging'] },
    });
    expect(projectResponse.statusCode).toBe(201);
    const project = projectResponse.json<{ id: string }>();
    const keysPath = `/v1/projects/${project.id}/environments/production/write-keys`;

    await sql`
      INSERT INTO organization_memberships (organization_id, user_id, role)
      VALUES (${organization.id}, ${memberId}, 'member')
    `;
    const memberDenied = await apiApp.inject({
      method: 'POST',
      url: keysPath,
      headers: memberHeaders,
      payload: { environment: 'production', label: 'Member key', allowedOrigins: [] },
    });
    expect(memberDenied.statusCode).toBe(403);

    const created = await apiApp.inject({
      method: 'POST',
      url: keysPath,
      headers: ownerHeaders,
      payload: {
        environment: 'production',
        label: 'Browser production',
        allowedOrigins: ['https://app.example.com'],
      },
    });
    expect(created.statusCode).toBe(201);
    const first = created.json<{
      key: string;
      metadata: { id: string; keyHint: string };
    }>();
    expect(first.key).toMatch(/^spk_[A-Za-z0-9_-]{43}$/);
    expect(first.metadata.keyHint).not.toBe(first.key);

    const [stored] = await sql<{ readonly verifier: Buffer; readonly key_hint: string }[]>`
      SELECT verifier, key_hint FROM project_write_keys WHERE id = ${first.metadata.id}
    `;
    expect(stored).toBeDefined();
    expect(stored?.verifier.equals(createHash('sha256').update(first.key).digest())).toBe(true);
    expect(stored?.key_hint).not.toBe(first.key);

    const listed = await apiApp.inject({ method: 'GET', url: keysPath, headers: ownerHeaders });
    expect(listed.statusCode).toBe(200);
    expect(listed.body).not.toContain(first.key);
    expect(listed.json().data).toHaveLength(1);

    const ingestHeaders = {
      'x-spectro-key': first.key,
      origin: 'https://app.example.com',
    };
    const accepted = await ingestApp.inject({
      method: 'POST',
      url: '/v1/envelope',
      headers: ingestHeaders,
      payload: envelope(project.id, 'production'),
    });
    expect(accepted.statusCode).toBe(202);
    expect(ingestStore.all()).toHaveLength(1);

    const wrongOrigin = await ingestApp.inject({
      method: 'POST',
      url: '/v1/envelope',
      headers: { 'x-spectro-key': first.key, origin: 'https://attacker.example' },
      payload: envelope(project.id, 'production'),
    });
    expect(wrongOrigin.statusCode).toBe(403);
    for (const wrongScope of [
      envelope(project.id, 'staging'),
      envelope(`prj_outside_${suffix}`, 'production'),
    ]) {
      // oxlint-disable-next-line no-await-in-loop -- validate both project and environment boundaries.
      const response = await ingestApp.inject({
        method: 'POST',
        url: '/v1/envelope',
        headers: ingestHeaders,
        payload: wrongScope,
      });
      expect(response.statusCode).toBe(403);
    }
    expect(ingestStore.all()).toHaveLength(1);

    const rotated = await apiApp.inject({
      method: 'POST',
      url: keysPath,
      headers: ownerHeaders,
      payload: {
        environment: 'production',
        label: 'Browser production replacement',
        allowedOrigins: ['https://app.example.com'],
      },
    });
    expect(rotated.statusCode).toBe(201);
    const second = rotated.json<{ key: string; metadata: { id: string } }>();
    expect(second.key).not.toBe(first.key);

    const revoked = await apiApp.inject({
      method: 'DELETE',
      url: `${keysPath}/${first.metadata.id}`,
      headers: ownerHeaders,
    });
    expect(revoked.statusCode).toBe(204);
    const rejectedOldKey = await ingestApp.inject({
      method: 'POST',
      url: '/v1/envelope',
      headers: ingestHeaders,
      payload: envelope(project.id, 'production'),
    });
    expect(rejectedOldKey.statusCode).toBe(401);
    const acceptedReplacement = await ingestApp.inject({
      method: 'POST',
      url: '/v1/envelope',
      headers: { ...ingestHeaders, 'x-spectro-key': second.key },
      payload: envelope(project.id, 'production'),
    });
    expect(acceptedReplacement.statusCode).toBe(202);
    expect(ingestStore.all()).toHaveLength(2);

    const foreignOrganization = await apiApp.inject({
      method: 'POST',
      url: '/v1/organizations',
      headers: outsiderHeaders,
      payload: { name: `${prefix} outsider` },
    });
    expect(foreignOrganization.statusCode).toBe(201);
    const foreignOrg = foreignOrganization.json<{ id: string }>();
    const foreignProjectResponse = await apiApp.inject({
      method: 'POST',
      url: `/v1/organizations/${foreignOrg.id}/projects`,
      headers: outsiderHeaders,
      payload: { name: 'Private web', environments: ['production'] },
    });
    expect(foreignProjectResponse.statusCode).toBe(201);
    const foreignProject = foreignProjectResponse.json<{ id: string }>();
    const crossOrganization = await apiApp.inject({
      method: 'GET',
      url: `/v1/projects/${foreignProject.id}/environments/production/write-keys`,
      headers: ownerHeaders,
    });
    expect(crossOrganization.statusCode).toBe(403);

    const audit = await sql<{ readonly action: string; readonly resource_id: string }[]>`
      SELECT action, resource_id FROM workspace_audit_log
      WHERE organization_id = ${organization.id}
        AND resource_id IN (${first.metadata.id}, ${second.metadata.id})
      ORDER BY id
    `;
    expect(audit).toEqual([
      { action: 'api_key.created', resource_id: first.metadata.id },
      { action: 'api_key.created', resource_id: second.metadata.id },
      { action: 'api_key.revoked', resource_id: first.metadata.id },
    ]);
  });
});
