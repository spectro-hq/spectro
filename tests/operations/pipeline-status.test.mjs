import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const statusEntry = fileURLToPath(
  new URL('../../services/processor/dist/status.js', import.meta.url),
);

function checkStatus(overrides = {}) {
  const result = spawnSync(process.execPath, [statusEntry], {
    cwd: repositoryRoot,
    env: { ...process.env, ...overrides },
    encoding: 'utf8',
    timeout: 10_000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  const status = JSON.parse(result.stdout.trim());
  return { exitCode: result.status, status, stderr: result.stderr };
}

test('reads a live JetStream and ClickHouse snapshot', () => {
  const result = checkStatus();
  assert.ok(result.exitCode === 0 || result.exitCode === 1);
  assert.ok(result.status.status === 'ok' || result.status.status === 'degraded');
  assert.equal(result.status.clickhouseAvailable, true);
  assert.ok(result.status.jetstream.streamMaxBytes > 0);
  assert.equal(result.status.jetstream.consumerMaxDeliver, 10);
});

test('reports a disconnected broker without leaking its URL credentials', () => {
  const result = checkStatus({ SPECTRO_NATS_URL: 'nats://operator:sentinel-secret@127.0.0.1:1' });
  assert.equal(result.exitCode, 2);
  assert.equal(result.status.status, 'unavailable');
  assert.ok(result.status.codes.includes('nats_unavailable'));
  assert.equal(result.status.clickhouseAvailable, true);
  assert.doesNotMatch(`${JSON.stringify(result.status)}${result.stderr}`, /sentinel-secret/);
});

test('reports a disconnected event plane without leaking its credentials', () => {
  const result = checkStatus({
    SPECTRO_CLICKHOUSE_URL: 'http://127.0.0.1:1',
    SPECTRO_CLICKHOUSE_PASSWORD: 'sentinel-secret',
  });
  assert.equal(result.exitCode, 2);
  assert.equal(result.status.status, 'unavailable');
  assert.ok(result.status.codes.includes('clickhouse_unavailable'));
  assert.ok(result.status.jetstream !== null);
  assert.doesNotMatch(`${JSON.stringify(result.status)}${result.stderr}`, /sentinel-secret/);
});

test('rejects invalid alert configuration without contacting dependencies', () => {
  const result = checkStatus({ SPECTRO_OPS_MAX_STORED_MESSAGES: '-1' });
  assert.equal(result.exitCode, 2);
  assert.deepEqual(result.status, {
    status: 'unavailable',
    codes: ['invalid_status_configuration'],
  });
});
