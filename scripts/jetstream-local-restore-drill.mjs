// Synthetic-only local broker recovery test. No staging URLs or credentials.
/* eslint-disable no-await-in-loop -- Recovery steps and bounded readiness polls must execute sequentially. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const require = createRequire(new URL('../packages/pipeline/package.json', import.meta.url));
const { connect, createInbox, nanos } = await import(require.resolve('@nats-io/transport-node'));
const { jetstream, jetstreamManager } = await import(require.resolve('@nats-io/jetstream'));
const docker = (...args) =>
  execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
assert(!process.env.DOCKER_HOST && !process.env.DOCKER_CONTEXT, 'Unset Docker endpoint overrides');
assert(
  docker('context', 'inspect', '--format', '{{.Endpoints.docker.Host}}').startsWith('unix://'),
  'Local Docker only',
);
docker('image', 'inspect', 'nats:2.14.6-alpine');
const id = randomUUID().slice(0, 8);
const reportDir = resolve('.local', `jetstream-drill-${id}`);
mkdirSync(reportDir, { recursive: true, mode: 0o700 });
const names = [`spectro-js-drill-${id}-source`, `spectro-js-drill-${id}-restore`];
const started = [];
const connections = [];
const stream = 'SYNTHETIC_RECOVERY';
const consumer = 'synthetic-worker';
const subject = 'synthetic.recovery';
const encode = (value) => new TextEncoder().encode(JSON.stringify(value));
const decode = (value) => JSON.parse(new TextDecoder().decode(value));
writeFileSync(
  resolve(reportDir, 'resources.json'),
  JSON.stringify({ names, syntheticOnly: true }),
  { mode: 0o600 },
);
console.log(`Report directory: ${reportDir}`);

async function api(nc, subjectName, value) {
  const response = decode((await nc.request(subjectName, encode(value), { timeout: 10_000 })).data);
  if (response.error) throw new Error(JSON.stringify(response.error));
  return response;
}

async function start(name) {
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
    '256m',
    '--cpus',
    '1',
    '--label',
    'spectro.purpose=synthetic-jetstream-drill',
    '-p',
    '127.0.0.1::4222',
    'nats:2.14.6-alpine',
    '-js',
    '-sd',
    '/data',
  );
  started.push(name);
  const port = docker('port', name, '4222/tcp');
  assert(/^127\.0\.0\.1:\d+$/.test(port), 'Only local port permitted');
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const nc = await connect({ servers: `nats://${port}`, timeout: 1000, reconnect: false });
      connections.push(nc);
      return nc;
    } catch (error) {
      if (attempt === 19) throw error;
      await delay(100);
    }
  }
  throw new Error('Local broker not ready');
}

try {
  const source = await start(names[0]);
  const sm = await jetstreamManager(source);
  const sj = jetstream(source);
  await sm.streams.add({
    name: stream,
    subjects: [subject],
    retention: 'workqueue',
    storage: 'file',
    num_replicas: 1,
  });
  await sm.consumers.add(stream, {
    durable_name: consumer,
    ack_policy: 'explicit',
    deliver_policy: 'all',
    ack_wait: nanos(2000),
    max_deliver: 10,
  });
  for (const marker of ['already-acked', 'in-flight', 'not-delivered'])
    await sj.publish(subject, encode({ marker, synthetic: true }));
  const sc = await sj.consumers.get(stream, consumer);
  const acked = await sc.next({ expires: 3000 });
  assert(acked);
  assert.equal(decode(acked.data).marker, 'already-acked');
  assert.equal(await acked.ackAck(), true);
  const inFlight = await sc.next({ expires: 3000 });
  assert(inFlight);
  assert.equal(decode(inFlight.data).marker, 'in-flight');
  const before = await sm.consumers.info(stream, consumer);
  assert.equal(before.num_ack_pending, 1);
  assert.equal(before.num_pending, 1);
  const inbox = createInbox();
  const sub = source.subscribe(inbox);
  const chunks = [];
  const timer = setTimeout(() => sub.unsubscribe(), 15_000);
  const receive = (async () => {
    for await (const message of sub) {
      if (message.reply) source.publish(message.reply);
      if (message.data.length === 0) {
        sub.unsubscribe();
        return;
      }
      chunks.push(Buffer.from(message.data));
    }
    throw new Error('Snapshot ended without EOF');
  })();
  const snapshot = await api(source, `$JS.API.STREAM.SNAPSHOT.${stream}`, {
    deliver_subject: inbox,
    chunk_size: 1024,
    no_consumers: false,
    jsck: true,
  });
  try {
    await receive;
  } finally {
    clearTimeout(timer);
    sub.unsubscribe();
  }
  const archive = Buffer.concat(chunks);
  assert(archive.length > 0);
  writeFileSync(resolve(reportDir, 'synthetic.snapshot'), archive, { mode: 0o600 });
  const target = await start(names[1]);
  const restore = await api(target, `$JS.API.STREAM.RESTORE.${stream}`, {
    config: snapshot.config,
    state: snapshot.state,
  });
  assert(restore.deliver_subject);
  for (let offset = 0; offset < archive.length; offset += 1024) {
    const reply = await target.request(
      restore.deliver_subject,
      archive.subarray(offset, offset + 1024),
      { timeout: 10_000 },
    );
    if (reply.data.length) {
      const response = decode(reply.data);
      assert(!response.error, JSON.stringify(response));
    }
  }
  const completed = decode(
    (await target.request(restore.deliver_subject, new Uint8Array(), { timeout: 10_000 })).data,
  );
  assert(!completed.error, JSON.stringify(completed));
  const tm = await jetstreamManager(target);
  const restoredState = await tm.consumers.info(stream, consumer);
  assert.equal(restoredState.num_ack_pending, 1);
  assert.equal(restoredState.num_pending, 1);
  const tc = await jetstream(target).consumers.get(stream, consumer);
  const received = [];
  for (let attempt = 0; attempt < 4 && received.length < 2; attempt += 1) {
    const message = await tc.next({ expires: 5000 });
    if (!message) continue;
    const marker = decode(message.data).marker;
    received.push({
      marker,
      streamSequence: message.info.streamSequence,
      deliveryCount: message.info.deliveryCount,
    });
    assert.equal(await message.ackAck(), true);
  }
  assert.deepEqual(received.map((item) => item.marker).toSorted(), ['in-flight', 'not-delivered']);
  assert(received.find((item) => item.marker === 'in-flight').deliveryCount >= 2);
  const finalStream = await tm.streams.info(stream);
  assert.equal(finalStream.state.messages, 0);
  const result = {
    status: 'PASS',
    syntheticOnly: true,
    snapshotBytes: archive.length,
    snapshotSHA256: createHash('sha256').update(archive).digest('hex'),
    before: { pending: before.num_pending, ackPending: before.num_ack_pending },
    restored: { pending: restoredState.num_pending, ackPending: restoredState.num_ack_pending },
    received,
    finalStoredMessages: finalStream.state.messages,
    limitations: [
      'No ClickHouse write-before-ack test in this drill',
      'No live snapshot, credentials, cross-service checkpoint or power-loss guarantee tested',
    ],
  };
  writeFileSync(resolve(reportDir, 'result.json'), JSON.stringify(result, null, 2), {
    mode: 0o600,
  });
  console.log(JSON.stringify(result, null, 2));
} finally {
  for (const nc of connections) await nc.close().catch(() => {});
  for (const name of started) {
    try {
      docker('stop', name);
    } catch {
      console.error(`Inspect and stop local drill container: ${name}`);
    }
  }
  console.log(
    'Local synthetic drill containers stopped; retained for explicit cleanup. No staging connection made.',
  );
}
