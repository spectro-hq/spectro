import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const script = fileURLToPath(
  new URL('../../scripts/staging-checkpoint-local-restore.mjs', import.meta.url),
);
test('coordinated restore rejects arbitrary volume names before Docker', () => {
  for (const args of [
    [],
    ['postgres-data'],
    ['spectro-staging_postgres-data'],
    ['spectro-checkpoint-unseal-../../-input'],
  ]) {
    const result = spawnSync(process.execPath, [script, ...args], {
      encoding: 'utf8',
      env: { ...process.env, PATH: '/nonexistent' },
    });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Usage:/);
  }
});
test('coordinated restore rejects remote endpoint overrides before Docker', () => {
  const result = spawnSync(process.execPath, [script, 'spectro-checkpoint-unseal-abcdef-input'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: '/nonexistent', DOCKER_HOST: 'sentinel-private-override' },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unset Docker endpoint overrides/);
  assert.doesNotMatch(result.stderr, /sentinel-private-override/);
});
test('restoration keeps fixed network isolation, password checks and final stop', () => {
  const source = readFileSync(script, 'utf8');
  assert.doesNotMatch(
    source.replaceAll('http://127.0.0.1:8222', 'LOOPBACK_MONITOR'),
    /https?:\/\/|docker compose|source .*\.env/,
  );
  assert.match(source, /'--network',\s*'none'/);
  assert.match(source, /auth-host=scram-sha-256/);
  assert.match(source, /incorrectPasswordRejected: true/);
  assert.match(source, /sourceHash, restoredHash/);
  assert.match(source, /finally \{/);
  assert.match(source, /docker\(\['stop', name\]\)/);
});
