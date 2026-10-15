// Synthetic-only processor/JetStream/ClickHouse boundary drill.
/* eslint-disable no-await-in-loop -- Fault injection and bounded readiness polls require ordered execution. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
const require = createRequire(new URL('./package.json', import.meta.url));
const { connect } = await import(require.resolve('@nats-io/transport-node'));
const { createClient } = await import(require.resolve('@clickhouse/client'));
const { v7: uuidv7 } = await import('uuid');
const { validateEnvelope } = await import('@spectro/protocol');
const {
  ensureJetStreamPipeline,
  JetStreamAdmissionSink,
  JetStreamAdmissionSource,
  readAdmissionPipelineSnapshot,
  ADMITTED_STREAM,
  PROCESSOR_CONSUMER,
} = await import('@spectro/pipeline');
const { EventProcessor, ClickHouseProcessedEventWriter, ProcessorWorker } =
  await import('@spectro/processor');
const docker = (...args) =>
  execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
assert(!process.env.DOCKER_HOST && !process.env.DOCKER_CONTEXT);
assert(
  docker('context', 'inspect', '--format', '{{.Endpoints.docker.Host}}').startsWith('unix://'),
);
const id = randomUUID().slice(0, 8);
const report = resolve('.local', `pipeline-ack-loss-${id}`);
mkdirSync(report, { recursive: true, mode: 0o700 });
const names = [`spectro-ack-drill-${id}-nats`, `spectro-ack-drill-${id}-ch`];
const started = [];
let nc;
let ch;
writeFileSync(resolve(report, 'resources.json'), JSON.stringify({ names, syntheticOnly: true }), {
  mode: 0o600,
});
console.log(`Report directory: ${report}`);
function start(name, image, containerPort, memory, args = []) {
  docker('image', 'inspect', image);
  docker(
    'run',
    '-d',
    '--name',
    name,
    '--hostname',
    'localhost',
    '--restart',
    'no',
    '--memory',
    memory,
    '--cpus',
    '2',
    '--label',
    'spectro.purpose=synthetic-ack-loss-drill',
    '-p',
    `127.0.0.1::${containerPort}`,
    image,
    ...args,
  );
  started.push(name);
  const address = docker('port', name, `${containerPort}/tcp`);
  assert(/^127\.0\.0\.1:\d+$/.test(address));
  return address;
}
try {
  const natsAddress = start(names[0], 'nats:2.14.6-alpine', 4222, '256m', ['-js', '-sd', '/data']);
  const chAddress = start(names[1], 'clickhouse/clickhouse-server:26.3.33.24-alpine', 8123, '2g');
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      nc = await connect({ servers: `nats://${natsAddress}`, reconnect: false, timeout: 1000 });
      break;
    } catch (error) {
      if (attempt === 29) throw error;
      await delay(100);
    }
  }
  assert(nc);
  // Use an explicit localhost-only drill user via the container's local client;
  // no source accounts or secrets are copied. Public source auth is not tested.
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      docker('exec', names[1], 'clickhouse-client', '--query', 'SELECT 1');
      ready = true;
      break;
    } catch {
      await delay(250);
    }
  }
  assert(ready, 'Local ClickHouse readiness');
  const syntheticPassword = `synthetic-${randomUUID()}`;
  docker(
    'exec',
    names[1],
    'clickhouse-client',
    '--query',
    `CREATE USER drill IDENTIFIED BY '${syntheticPassword}'; GRANT ALL ON spectro.* TO drill`,
    '--multiquery',
  );
  const ddl = readFileSync(
    new URL('../../infra/docker/clickhouse/init/001_events_v1.sql', import.meta.url),
    'utf8',
  );
  execFileSync('docker', ['exec', '-i', names[1], 'clickhouse-client', '--multiquery'], {
    input: ddl,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  ch = createClient({
    url: `http://${chAddress}`,
    username: 'drill',
    password: syntheticPassword,
    database: 'spectro',
  });
  await ch.command({ query: 'SYSTEM STOP MERGES spectro.events_v1' });
  await ensureJetStreamPipeline(nc);
  const source = await JetStreamAdmissionSource.create(nc);
  const eventId = uuidv7();
  const now = Date.now();
  const projectId = `prj_synthetic_${id}`;
  const envelope = {
    version: 1,
    sentAt: now,
    items: [
      {
        type: 'event',
        payload: {
          id: eventId,
          version: 1,
          timestamp: now,
          type: 'custom',
          name: 'ack_loss_recovery_probe',
          context: {
            sdk: { name: '@spectro/local-drill', version: '0.1.0' },
            project: { id: projectId },
            environment: 'synthetic',
          },
          payload: { properties: { marker: 'synthetic-only' } },
        },
      },
    ],
  };
  const validation = validateEnvelope(envelope);
  assert(validation.success, 'Synthetic fixture must conform to the actual protocol');
  await new JetStreamAdmissionSink(nc).append(envelope);
  let writes = 0;
  const durableWriter = new ClickHouseProcessedEventWriter(ch);
  const processor = new EventProcessor(
    {
      append: async (events) => {
        await durableWriter.append(events);
        writes += 1;
      },
    },
    () => now + (writes + 1) * 1000,
  );
  let droppedAck = false;
  let firstEnvelopeId;
  const faultSource = {
    next: async (expires) => {
      const delivery = await source.next(expires);
      if (!delivery) return delivery;
      firstEnvelopeId = delivery.admitted.envelopeId;
      return {
        ...delivery,
        admitted: delivery.admitted,
        acknowledge: () => {
          droppedAck = true;
        },
        retry: (ms) => delivery.retry(ms),
        terminate: () => delivery.terminate(),
      };
    },
  };
  await new ProcessorWorker(faultSource, processor).runOnce(3000);
  assert(droppedAck);
  assert.equal(writes, 1);
  const query = async () => {
    const response = await ch.query({
      query:
        'SELECT count() AS count, max(processed_at_ms) AS version FROM spectro.events_v1 FINAL WHERE event_id={id:UUID}',
      query_params: { id: eventId },
      format: 'JSONEachRow',
    });
    return (await response.json())[0];
  };
  const first = await query();
  assert.equal(Number(first.count), 1);
  assert.equal(Number(first.version), now + 1000);
  const pending = await readAdmissionPipelineSnapshot(nc);
  assert.equal(pending.consumerAckPending, 1);
  let replayEnvelopeId;
  const observingSource = {
    next: async (expires) => {
      const delivery = await source.next(expires);
      if (delivery) replayEnvelopeId = delivery.admitted.envelopeId;
      return delivery;
    },
  };
  const replay = await new ProcessorWorker(observingSource, processor).runOnce(5000);
  assert.equal(replay.status, 'processed');
  assert.equal(replayEnvelopeId, firstEnvelopeId);
  assert.equal(writes, 2);
  await nc.flush();
  const second = await query();
  assert.equal(Number(second.count), 1);
  assert.equal(Number(second.version), now + 2000, 'Replay must actually reach ClickHouse');
  let finalState;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    finalState = await readAdmissionPipelineSnapshot(nc);
    if (finalState.streamStoredMessages === 0 && finalState.consumerAckPending === 0) break;
    await delay(50);
  }
  assert.equal(finalState.streamStoredMessages, 0);
  assert.equal(finalState.consumerAckPending, 0);
  // The operations snapshot exposes stream_seq, which stays 1 on redelivery.
  // consumer_seq counts deliveries and must advance for the same stream entry.
  const consumerInfo = JSON.parse(
    new TextDecoder().decode(
      (
        await nc.request(
          `$JS.API.CONSUMER.INFO.${ADMITTED_STREAM}.${PROCESSOR_CONSUMER}`,
          new Uint8Array(),
          { timeout: 3000 },
        )
      ).data,
    ),
  );
  assert(!consumerInfo.error);
  assert(consumerInfo.delivered.consumer_seq >= 2);
  const result = {
    status: 'PASS',
    syntheticOnly: true,
    successfulWrites: writes,
    firstLogicalCount: Number(first.count),
    replayLogicalCount: Number(second.count),
    replayVersionObserved: true,
    sameEnvelopeIdentity: true,
    deliveredConsumerSequence: consumerInfo.delivered.consumer_seq,
    finalQueueMessages: finalState.streamStoredMessages,
    limitations: [
      'Fault injected by suppressing processor ack, not OS crash',
      'No API query/issue aggregation assertion',
      'No coordinated live recovery checkpoint or authentication recovery',
    ],
  };
  writeFileSync(resolve(report, 'result.json'), JSON.stringify(result, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(result, null, 2));
} finally {
  if (ch) await ch.close().catch(() => {});
  if (nc) await nc.close().catch(() => {});
  for (const name of started) {
    try {
      docker('stop', name);
    } catch {
      console.error(`Inspect and stop local drill container: ${name}`);
    }
  }
  console.log(
    'Local synthetic containers stopped; retained for explicit cleanup. No staging connection made.',
  );
}
