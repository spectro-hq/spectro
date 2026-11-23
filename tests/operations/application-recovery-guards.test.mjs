import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const script = fileURLToPath(
  new URL('../../scripts/application-recovery-local-drill.mjs', import.meta.url),
);
test('application recovery rejects arbitrary metadata paths before Docker', () => {
  for (const args of [
    [],
    ['relative'],
    ['/opt/spectro-staging/resources.json'],
    ['/tmp/checkpoint-restore-invalid/resources.json'],
  ]) {
    const r = spawnSync(process.execPath, [script, ...args], {
      env: { ...process.env, PATH: '/nonexistent' },
      encoding: 'utf8',
    });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /absolute resources.json path/);
  }
});
test('application recovery rejects Docker endpoint overrides', () => {
  const r = spawnSync(
    process.execPath,
    [script, '/tmp/checkpoint-restore-abcdef01/resources.json'],
    {
      env: { ...process.env, PATH: '/nonexistent', DOCKER_HOST: 'sentinel-private-endpoint' },
      encoding: 'utf8',
    },
  );
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Unset Docker endpoint overrides/);
  assert.doesNotMatch(r.stderr, /sentinel-private-endpoint/);
});
test('application drill has cold read-only sources, an internal network and final stop', () => {
  const source = readFileSync(script, 'utf8');
  assert.match(source, /'--internal'/);
  assert.match(source, /Source volume must be cold/);
  assert.match(source, /:\/source:ro/);
  assert.match(source, /finally \{/);
  assert.match(source, /docker\(\['stop', name\]\)/);
  assert.doesNotMatch(source, /'-p'|'--publish'|--network.*host|docker compose/);
});
test('HTTP probe uses explicit test identity and never targets deployed domains', () => {
  const source = readFileSync(
    new URL('../integration/application-recovery-probe.mjs', import.meta.url),
    'utf8',
  );
  assert.match(source, /External identity calls prohibited/);
  assert.match(source, /internal-clone/);
  assert.match(source, /structuredClone\(context\)/);
  assert.match(source, /services\/processor\/dist\/server.js/);
  assert.doesNotMatch(source, /spectrohq\.com|roshanca\.com|auth0\.com/);
});
