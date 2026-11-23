// Runs only inside the disposable internal-network application recovery container.
/* eslint-disable no-await-in-loop -- Durable admission, processing and query observations are ordered. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import postgres from 'postgres';
import { ClickHouseLogLevel, createClient } from '@clickhouse/client';
import { connect } from '@nats-io/transport-node';
import { v7 as uuidv7 } from 'uuid';
import {
  createApiApp,
  PostgresAuthControlPlane,
  PostgresWorkspaceStore,
  PostgresProjectWriteKeyStore,
  ClickHouseEventQueryStore,
  ClickHouseIssueQueryStore,
} from '@spectro/api';
import { createIngestApp, PostgresIngestWriteKeyAuthorizer } from '@spectro/ingest';
import { JetStreamAdmissionSink, readAdmissionPipelineSnapshot } from '@spectro/pipeline';
import { validateEnvelope } from '@spectro/protocol';

assert.equal(process.env.SPECTRO_RECOVERY_ONLY, 'internal-clone');
const values = new Map(
  readFileSync('/recovery/config/infra/staging/.env', 'utf8')
    .split('\n')
    .map((line) => {
      const i = line.indexOf('=');
      return [
        line.slice(0, i),
        line
          .slice(i + 1)
          .trim()
          .replace(/^(['"])(.*)\1$/, '$2'),
      ];
    }),
);
function secret(key) {
  const value = values.get(key);
  assert(/^s[a-f0-9]{64}$/.test(value ?? ''), 'Unexpected recovered credential format');
  return value;
}
const sql = postgres({
  host: 'postgres',
  database: 'spectro',
  username: 'spectro_api',
  password: secret('POSTGRES_API_PASSWORD'),
  connect_timeout: 5,
  onnotice: () => {},
});
const reader = postgres({
  host: 'postgres',
  database: 'spectro',
  username: 'spectro_ingest',
  password: secret('POSTGRES_INGEST_PASSWORD'),
  connect_timeout: 5,
  onnotice: () => {},
});
const clickhouse = createClient({
  url: 'http://clickhouse:8123',
  database: 'spectro',
  username: 'spectro_api',
  password: secret('CLICKHOUSE_API_PASSWORD'),
  request_timeout: 5000,
  log: { level: ClickHouseLogLevel.OFF },
});
const nonce = randomUUID().replaceAll('-', '');
const userId = `usr_recovery_${nonce}`;
const sessionId = `ses_recovery_${nonce}`;
const browserOrigin = 'https://recovery.invalid';
const publicOrigin = 'https://console.recovery.invalid';
let api, ingest, nc, worker;
let phase = 'database connections';
let failed = false;
const result = {};
async function countAll() {
  const r = await clickhouse.query({
    query: 'SELECT count() AS count FROM spectro.events_v1 FINAL',
    format: 'JSONEachRow',
  });
  return Number((await r.json())[0].count);
}
async function stopWorker() {
  if (!worker || worker.exitCode !== null || worker.signalCode !== null) return;
  const closed = new Promise((resolve) => worker.once('exit', resolve));
  worker.kill('SIGTERM');
  const completed = await Promise.race([closed.then(() => true), delay(5000).then(() => false)]);
  if (!completed) {
    worker.kill('SIGKILL');
    await closed;
  }
}
async function request(url, options, expected) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(5000) });
  if (response.status !== expected) {
    const body = await response
      .clone()
      .json()
      .catch(() => ({}));
    const code = body.error?.code ?? body.code ?? body.error;
    result.httpFailure = {
      expected,
      actual: response.status,
      ...(typeof code === 'string' && /^[A-Za-z_]{1,64}$/.test(code) ? { code } : {}),
    };
  }
  assert.equal(response.status, expected, `Unexpected HTTP status at ${phase}`);
  return response;
}
try {
  const before = await countAll();
  assert.equal(before, 770, 'This bounded probe expects the verified checkpoint');
  const [scope] =
    await sql`SELECT p.id AS project_id,p.organization_id,e.name AS environment FROM projects p JOIN project_environments e ON e.project_id=p.id ORDER BY p.id,e.name LIMIT 1`;
  assert(scope);
  await sql`INSERT INTO console_users(id,email_verified) VALUES(${userId},true)`;
  await sql`INSERT INTO organization_memberships(organization_id,user_id,role) VALUES(${scope.organization_id},${userId},'admin')`;
  const auth = new PostgresAuthControlPlane(sql);
  const token = await auth.createSession({ userId, expiresAt: new Date(Date.now() + 300_000) });
  api = createApiApp({
    hostedAuth: {
      publicOrigin,
      csrfSecret: `synthetic-recovery-${nonce}-never-used-in-production`,
      controlPlane: auth,
      oidc: {
        authorizationUrl: async () => {
          throw new Error('External identity calls prohibited');
        },
        exchange: async () => {
          throw new Error('External identity calls prohibited');
        },
      },
    },
    workspaceStore: new PostgresWorkspaceStore(sql),
    projectWriteKeyStore: new PostgresProjectWriteKeyStore(sql),
    ingestionEndpoint: 'http://127.0.0.1',
    eventStore: new ClickHouseEventQueryStore(clickhouse),
    issueStore: new ClickHouseIssueQueryStore(clickhouse),
  });
  const apiUrl = await api.listen({ host: '127.0.0.1', port: 0 });
  const cookie = `__Host-spectro-session=${token}`;
  const session = await request(`${apiUrl}/v1/auth/session`, { headers: { cookie } }, 200);
  const { csrfToken } = await session.json();
  const headers = {
    cookie,
    origin: publicOrigin,
    'x-csrf-token': csrfToken,
    'content-type': 'application/json',
  };
  const keyPath = `/v1/projects/${scope.project_id}/environments/${encodeURIComponent(scope.environment)}/write-keys`;
  phase = 'create scoped key through restored API';
  const created = await request(
    `${apiUrl}${keyPath}`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        environment: scope.environment,
        label: 'Isolated application recovery probe',
        allowedOrigins: [browserOrigin],
      }),
    },
    201,
  );
  const key = await created.json();
  assert(key.key && key.metadata.id);
  phase = 'connect restored NATS as ingestion user';
  nc = await connect({
    servers: 'nats://nats:4222',
    user: 'ingest',
    pass: secret('NATS_INGEST_PASSWORD'),
    timeout: 3000,
    maxReconnectAttempts: 0,
  });
  phase = 'start HTTP ingestion app';
  ingest = createIngestApp({
    writeKeyAuthorizer: new PostgresIngestWriteKeyAuthorizer(reader),
    store: new JetStreamAdmissionSink(nc),
  });
  const ingestUrl = await ingest.listen({ host: '127.0.0.1', port: 0 });
  const now = Date.now();
  const context = {
    sdk: { name: '@spectro/application-recovery-probe', version: '0.1.0' },
    project: { id: scope.project_id },
    environment: scope.environment,
    session: { id: sessionId, startedAt: now },
    page: { id: `page_${nonce}`, url: `${browserOrigin}/recovery`, path: '/recovery' },
  };
  const events = [0, 1].map((i) => ({
    id: uuidv7(),
    version: 1,
    timestamp: now + i,
    type: 'error',
    name: 'runtime_error',
    context: structuredClone(context),
    payload: {
      mechanism: 'runtime',
      name: 'RecoveryProbeError',
      message: `synthetic-recovery-${nonce}`,
      handled: false,
      stack: [],
    },
  }));
  events.push({
    id: uuidv7(),
    version: 1,
    timestamp: now + 2,
    type: 'custom',
    name: 'application_recovery_probe',
    context,
    payload: { properties: { synthetic: true } },
  });
  const envelope = {
    version: 1,
    sentAt: now,
    items: events.map((payload) => ({ type: 'event', payload })),
  };
  phase = 'validate synthetic recovery envelope';
  assert(validateEnvelope(envelope).success);
  const ingestHeaders = {
    'x-spectro-key': key.key,
    origin: browserOrigin,
    'content-type': 'application/json',
  };
  phase = 'admit to restored durable queue before starting worker';
  const accepted = await request(
    `${ingestUrl}/v1/envelope`,
    { method: 'POST', headers: ingestHeaders, body: JSON.stringify(envelope) },
    202,
  );
  assert.equal((await accepted.json()).accepted, 3);
  const queued = await readAdmissionPipelineSnapshot(nc);
  assert.equal(queued.streamStoredMessages, 1);
  assert.equal(queued.consumerPending, 1);
  assert.equal(queued.consumerAckPending, 0);
  assert.equal(await countAll(), before);
  result.durableAdmissionObservedBeforeProcessing = true;
  phase = 'start actual processor server and query new events through HTTP API';
  worker = spawn(process.execPath, ['services/processor/dist/server.js'], {
    cwd: '/workspace',
    env: {
      ...process.env,
      SPECTRO_NATS_URL: 'nats://nats:4222',
      SPECTRO_NATS_USER: 'processor',
      SPECTRO_NATS_PASSWORD: secret('NATS_PROCESSOR_PASSWORD'),
      SPECTRO_CLICKHOUSE_URL: 'http://clickhouse:8123',
      SPECTRO_CLICKHOUSE_USER: 'spectro_processor',
      SPECTRO_CLICKHOUSE_PASSWORD: secret('CLICKHOUSE_PROCESSOR_PASSWORD'),
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  // Discard stderr instead of leaking private runtime diagnostics into the report.
  worker.stderr.resume();
  const query = `environment=${encodeURIComponent(scope.environment)}&from=${now - 1}&to=${now + 10000}`;
  const eventsUrl = `${apiUrl}/v1/projects/${scope.project_id}/events?${query}&sessionId=${sessionId}`;
  let received = [];
  for (let attempt = 0; attempt < 60; attempt++) {
    assert(worker.exitCode === null && worker.signalCode === null, 'Processor exited unexpectedly');
    const response = await request(eventsUrl, { headers: { cookie } }, 200);
    received = (await response.json()).data;
    if (received.length === 3) break;
    await delay(250);
  }
  assert.equal(received.length, 3);
  assert.deepEqual(received.map((x) => x.event.id).toSorted(), events.map((x) => x.id).toSorted());
  const fingerprints = received
    .filter((x) => x.event.type === 'error')
    .map((x) => x.processing.errorFingerprint);
  assert.equal(fingerprints.length, 2);
  assert(/^[a-f0-9]{32}$/.test(fingerprints[0]));
  assert.equal(fingerprints[0], fingerprints[1]);
  assert.equal(await countAll(), before + 3);
  phase = 'verify issue aggregation and recovered authorization';
  const issues = await request(
    `${apiUrl}/v1/projects/${scope.project_id}/issues?${query}`,
    { headers: { cookie } },
    200,
  );
  const groups = (await issues.json()).data;
  assert.equal(groups.length, 1);
  assert.equal(groups[0].occurrenceCount, 2);
  await request(eventsUrl, {}, 401);
  await request(
    `${ingestUrl}/v1/envelope`,
    {
      method: 'POST',
      headers: { ...ingestHeaders, origin: 'https://denied.invalid' },
      body: JSON.stringify(envelope),
    },
    403,
  );
  await request(
    `${apiUrl}${keyPath}/${key.metadata.id}`,
    { method: 'DELETE', headers: { cookie, origin: publicOrigin, 'x-csrf-token': csrfToken } },
    204,
  );
  await request(
    `${ingestUrl}/v1/envelope`,
    { method: 'POST', headers: ingestHeaders, body: JSON.stringify(envelope) },
    401,
  );
  phase = 'verify queue drained and source rows retained';
  let final;
  for (let attempt = 0; attempt < 30; attempt++) {
    final = await readAdmissionPipelineSnapshot(nc);
    if (final.streamStoredMessages === 0 && final.consumerAckPending === 0) break;
    await delay(100);
  }
  assert.equal(final.streamStoredMessages, 0);
  assert.equal(final.consumerAckPending, 0);
  assert.equal(final.consumerAcknowledgedSequence, queued.consumerAcknowledgedSequence + 1);
  Object.assign(result, {
    restoredBaselineEvents: before,
    newEventsQueried: 3,
    actualProcessorProcess: true,
    httpApiAndIngestion: true,
    issueGroups: 1,
    errorOccurrences: 2,
    anonymousReadRejected: true,
    wrongOriginRejected: true,
    revokedKeyRejected: true,
    finalStoredMessages: 0,
    finalAckPending: 0,
    finalAcknowledgedSequence: final.consumerAcknowledgedSequence,
    externalOidcNotUsed: true,
  });
} catch (error) {
  failed = true;
  result.failureType = error.name;
  if (typeof error.code === 'string' && /^[A-Z_0-9]{1,48}$/.test(error.code))
    result.failureCode = error.code;
  console.error(`FAIL at phase: ${phase}; private response/command output suppressed.`);
} finally {
  await stopWorker();
  await ingest?.close().catch(() => {});
  await api?.close().catch(() => {});
  await nc?.drain().catch(() => {});
  await Promise.all([sql.end(), reader.end(), clickhouse.close()]);
}
console.log(
  JSON.stringify(
    {
      status: failed ? 'FAIL' : 'PASS',
      phase,
      evidence: result,
      limitations: [
        'Test hosted session created inside cloned database; no real OIDC/browser login',
        'API and ingestion use public app factories with a test identity adapter, not their production CLI bootstrap',
        'No complete external-provider/certificate recovery or full RPO/RTO measurement',
      ],
    },
    null,
    2,
  ),
);
if (failed) process.exitCode = 1;
