import { createClient } from '@clickhouse/client';
import { connect } from '@nats-io/transport-node';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { v7 as uuidv7 } from 'uuid';

import {
  ClickHouseEventQueryStore,
  ClickHouseIssueQueryStore,
  ClickHouseNetworkQueryStore,
  ClickHousePerformanceQueryStore,
  PostgresAuthControlPlane,
  PostgresProjectWriteKeyStore,
  PostgresWorkspaceStore,
  createApiApp,
} from '@spectro/api';
import { createIngestApp, PostgresIngestWriteKeyAuthorizer } from '@spectro/ingest';
import { JetStreamAdmissionSink, ensureJetStreamPipeline } from '@spectro/pipeline';
import { ENVELOPE_VERSION, EVENT_VERSION, type Envelope } from '@spectro/protocol';

const enabled =
  process.env.SPECTRO_INTEGRATION === '1' &&
  process.env.SPECTRO_INGEST_KEY_POSTGRES_URL !== undefined;
const suite = enabled ? describe : describe.skip;
const sql = postgres(
  process.env.SPECTRO_POSTGRES_URL ??
    'postgres://spectro:spectro_local@127.0.0.1:5488/spectro_auth_local',
);
const reader = postgres(
  process.env.SPECTRO_INGEST_KEY_POSTGRES_URL ??
    'postgres://unconfigured@127.0.0.1:5488/spectro_auth_local',
);
const clickhouse = createClient({
  url: process.env.SPECTRO_CLICKHOUSE_URL ?? 'http://localhost:8123',
  username: process.env.SPECTRO_CLICKHOUSE_USER ?? 'spectro',
  password: process.env.SPECTRO_CLICKHOUSE_PASSWORD ?? 'spectro_local',
  database: process.env.SPECTRO_CLICKHOUSE_DATABASE ?? 'spectro',
});
const suffix = uuidv7().replaceAll('-', '');
const userId = `usr_hosted_acceptance_${suffix}`;
const auth = new PostgresAuthControlPlane(sql);
const origin = 'https://localhost:5188';
const browserOrigin = 'http://localhost:3000';
const api = createApiApp({
  hostedAuth: {
    publicOrigin: origin,
    csrfSecret: 'local-acceptance-secret-with-at-least-32-bytes',
    controlPlane: auth,
    oidc: {
      authorizationUrl: async () => new URL('https://issuer.example/authorize'),
      exchange: async () => ({ issuer: 'https://issuer.example', subject: suffix }),
    },
  },
  workspaceStore: new PostgresWorkspaceStore(sql),
  projectWriteKeyStore: new PostgresProjectWriteKeyStore(sql),
  ingestionEndpoint: 'https://localhost:5188/ingest',
  eventStore: new ClickHouseEventQueryStore(clickhouse),
  issueStore: new ClickHouseIssueQueryStore(clickhouse),
  networkStore: new ClickHouseNetworkQueryStore(clickhouse),
  performanceStore: new ClickHousePerformanceQueryStore(clickhouse),
});
let headers: Record<string, string>;
let organizationId: string | undefined;
let projectId: string | undefined;

suite('hosted scoped ingestion through the running durable pipeline', () => {
  beforeAll(async () => {
    await sql`INSERT INTO console_users (id) VALUES (${userId})`;
    const session = await auth.createSession({ userId, expiresAt: new Date(Date.now() + 300_000) });
    const cookie = `__Host-spectro-session=${session}`;
    const response = await api.inject({
      method: 'GET',
      url: '/v1/auth/session',
      headers: { cookie },
    });
    if (response.statusCode !== 200) throw new Error('Could not prepare the acceptance session');
    headers = { cookie, origin, 'x-csrf-token': response.json<{ csrfToken: string }>().csrfToken };
  });

  afterAll(async () => {
    await api.close();
    if (projectId !== undefined) {
      await clickhouse.command({
        query: 'ALTER TABLE events_v1 DELETE WHERE project_id = {projectId:String}',
        query_params: { projectId },
        clickhouse_settings: { mutations_sync: '1' },
      });
      await sql`DELETE FROM project_write_keys WHERE project_id = ${projectId}`;
      await sql`DELETE FROM project_environments WHERE project_id = ${projectId}`;
      await sql`DELETE FROM projects WHERE id = ${projectId}`;
    }
    if (organizationId !== undefined) {
      await sql`DELETE FROM workspace_audit_log WHERE organization_id = ${organizationId}`;
      await sql`DELETE FROM organization_memberships WHERE organization_id = ${organizationId}`;
      await sql`DELETE FROM organizations WHERE id = ${organizationId}`;
    }
    await sql`DELETE FROM console_sessions WHERE user_id = ${userId}`;
    await sql`DELETE FROM console_users WHERE id = ${userId}`;
    await Promise.all([sql.end(), reader.end(), clickhouse.close()]);
  });

  it('uses a key-reader role without Console access or write privileges', async () => {
    const [privileges] = await reader<
      { keys: boolean; sessions: boolean; users: boolean; writes: boolean; read_only: string }[]
    >`
      SELECT has_table_privilege(current_user, 'project_write_keys', 'SELECT') AS keys,
             has_table_privilege(current_user, 'console_sessions', 'SELECT') AS sessions,
             has_table_privilege(current_user, 'console_users', 'SELECT') AS users,
             has_table_privilege(current_user, 'project_write_keys', 'INSERT, UPDATE, DELETE') AS writes,
             current_setting('default_transaction_read_only') AS read_only
    `;
    expect(privileges).toEqual({
      keys: true,
      sessions: false,
      users: false,
      writes: false,
      read_only: 'on',
    });
  });

  it('persists four signal types, isolates scope and origin, and revokes admission', async () => {
    const organization = await api.inject({
      method: 'POST',
      url: '/v1/organizations',
      headers,
      payload: { name: `Hosted acceptance ${suffix}` },
    });
    expect(organization.statusCode).toBe(201);
    organizationId = organization.json<{ id: string }>().id;
    const project = await api.inject({
      method: 'POST',
      url: `/v1/organizations/${organizationId}/projects`,
      headers,
      payload: { name: 'Acceptance', environments: ['development', 'staging'] },
    });
    expect(project.statusCode).toBe(201);
    projectId = project.json<{ id: string }>().id;
    const keyPath = `/v1/projects/${projectId}/environments/development/write-keys`;
    const keyResponse = await api.inject({
      method: 'POST',
      url: keyPath,
      headers,
      payload: {
        environment: 'development',
        label: 'Temporary acceptance',
        allowedOrigins: [browserOrigin],
      },
    });
    expect(keyResponse.statusCode).toBe(201);
    const key = keyResponse.json<{ key: string; metadata: { id: string } }>();
    const timestamp = Date.now();
    const context = {
      sdk: { name: '@spectro/integration-test', version: '0.1.0' },
      project: { id: projectId },
      environment: 'development',
      session: { id: `ses_${suffix}`, startedAt: timestamp },
      page: { id: `page_${suffix}`, url: `${browserOrigin}/`, path: '/' },
    };
    const envelope: Envelope = {
      version: ENVELOPE_VERSION,
      sentAt: timestamp,
      items: [
        {
          type: 'event',
          payload: {
            id: uuidv7(),
            version: EVENT_VERSION,
            timestamp,
            context,
            type: 'error',
            name: 'runtime_error',
            payload: {
              mechanism: 'runtime',
              name: 'AcceptanceError',
              message: `Hosted acceptance ${suffix}`,
              handled: false,
              stack: [],
            },
          },
        },
        {
          type: 'event',
          payload: {
            id: uuidv7(),
            version: EVENT_VERSION,
            timestamp: timestamp + 1,
            context,
            type: 'network',
            name: 'fetch_request',
            payload: {
              request: { method: 'GET', url: `${browserOrigin}/network-failure` },
              response: { status: 503 },
              timing: { start: 0, duration: 20 },
              initiator: 'fetch',
              success: false,
            },
          },
        },
        {
          type: 'event',
          payload: {
            id: uuidv7(),
            version: EVENT_VERSION,
            timestamp: timestamp + 2,
            context,
            type: 'performance',
            name: 'navigation_timing',
            payload: { metric: 'navigation', value: 120, unit: 'ms', navigationType: 'navigate' },
          },
        },
        {
          type: 'event',
          payload: {
            id: uuidv7(),
            version: EVENT_VERSION,
            timestamp: timestamp + 3,
            context,
            type: 'interaction',
            name: 'element_click',
            payload: { target: { monitorId: 'acceptance-all', tag: 'button' } },
          },
        },
      ],
    };
    const connection = await connect({
      servers: process.env.SPECTRO_NATS_URL ?? 'nats://127.0.0.1:4222',
    });
    await ensureJetStreamPipeline(connection);
    const ingest = createIngestApp({
      writeKeyAuthorizer: new PostgresIngestWriteKeyAuthorizer(reader),
      store: new JetStreamAdmissionSink(connection),
    });
    const ingestHeaders = { 'x-spectro-key': key.key, origin: browserOrigin };
    const eventQuery = `environment=development&from=${timestamp - 1}&to=${timestamp + 1000}`;
    try {
      const admitted = await ingest.inject({
        method: 'POST',
        url: '/v1/envelope',
        headers: ingestHeaders,
        payload: envelope,
      });
      expect(admitted.statusCode).toBe(202);
      expect(admitted.json()).toEqual({ accepted: 4 });
      await vi.waitFor(
        async () => {
          const events = await api.inject({
            method: 'GET',
            url: `/v1/projects/${projectId}/events?${eventQuery}&sessionId=${context.session.id}`,
            headers,
          });
          expect(events.statusCode).toBe(200);
          const data = events.json<{
            data: {
              event: { type: string; context: unknown };
              processing: { errorFingerprint?: string };
            }[];
          }>().data;
          expect(data).toHaveLength(4);
          expect(data.map((item) => item.event.type)).toEqual(
            expect.arrayContaining(['error', 'interaction', 'network', 'performance']),
          );
          expect(
            data.find((item) => item.event.type === 'error')?.processing.errorFingerprint,
          ).toMatch(/^[a-f0-9]{32}$/);
          expect(events.body.includes(key.key)).toBe(false);
        },
        { timeout: 10_000, interval: 150 },
      );
      const [issues, network, performance] = await Promise.all(
        ['issues', 'network', 'performance'].map((surface) =>
          api.inject({
            method: 'GET',
            url: `/v1/projects/${projectId}/${surface}?${eventQuery}`,
            headers,
          }),
        ),
      );
      expect(issues?.statusCode).toBe(200);
      expect(issues?.json<{ data: { occurrenceCount: number }[] }>().data[0]?.occurrenceCount).toBe(
        1,
      );
      expect(network?.statusCode).toBe(200);
      expect(network?.json<{ data: unknown[] }>().data).toHaveLength(1);
      expect(performance?.statusCode).toBe(200);
      expect(performance?.json<{ data: unknown[] }>().data).toHaveLength(1);
      const deniedOrigin = await ingest.inject({
        method: 'POST',
        url: '/v1/envelope',
        headers: { ...ingestHeaders, origin: 'http://localhost:3999' },
        payload: envelope,
      });
      expect(deniedOrigin.statusCode).toBe(403);
      for (const invalidContext of [
        { ...context, environment: 'staging' },
        { ...context, project: { id: `prj_outside_${suffix}` } },
      ]) {
        // oxlint-disable-next-line no-await-in-loop -- exercise independent admission scopes.
        const denied = await ingest.inject({
          method: 'POST',
          url: '/v1/envelope',
          headers: ingestHeaders,
          payload: {
            ...envelope,
            items: envelope.items.map((item) => ({
              ...item,
              payload: { ...item.payload, context: invalidContext },
            })),
          },
        });
        expect(denied.statusCode).toBe(403);
      }
      const consoleCookieDenied = await ingest.inject({
        method: 'POST',
        url: '/v1/envelope',
        headers: { cookie: headers.cookie ?? '', origin: browserOrigin },
        payload: envelope,
      });
      expect(consoleCookieDenied.statusCode).toBe(401);
      const browserKeyReadDenied = await api.inject({
        method: 'GET',
        url: `/v1/projects/${projectId}/events?${eventQuery}`,
        headers: { authorization: `Bearer ${key.key}` },
      });
      expect(browserKeyReadDenied.statusCode).toBe(401);
      const revoke = await api.inject({
        method: 'DELETE',
        url: `${keyPath}/${key.metadata.id}`,
        headers,
      });
      expect(revoke.statusCode).toBe(204);
      const revoked = await ingest.inject({
        method: 'POST',
        url: '/v1/envelope',
        headers: ingestHeaders,
        payload: envelope,
      });
      expect(revoked.statusCode).toBe(401);
    } finally {
      await ingest.close();
      await connection.drain();
    }
  }, 20_000);
});
