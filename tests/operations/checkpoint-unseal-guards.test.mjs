import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const script = fileURLToPath(
  new URL('../../scripts/staging-checkpoint-unseal.sh', import.meta.url),
);
test('checkpoint unseal syntax and argument guards', () => {
  assert.equal(spawnSync('/bin/bash', ['-n', script]).status, 0);
  assert.equal(spawnSync('/bin/bash', [script, '--help']).status, 0);
  for (const args of [[], ['/'], ['relative', '/identity'], ['/backup', 'relative']]) {
    assert.equal(spawnSync('/bin/bash', [script, ...args]).status, 2);
  }
});
test('noninteractive unseal refuses before contacting Docker or age', () => {
  const directory = mkdtempSync(join(tmpdir(), 'spectro-unseal-guard-'));
  const log = join(directory, 'unexpected-command');
  for (const command of ['docker', 'age', 'shasum', 'mktemp']) {
    writeFileSync(
      join(directory, command),
      '#!/bin/sh\necho unexpected > "$GUARD_LOG"\nexit 77\n',
      { mode: 0o700 },
    );
  }
  const result = spawnSync('/bin/bash', [script, '/backup', '/identity'], {
    env: { ...process.env, PATH: directory, GUARD_LOG: log },
    encoding: 'utf8',
  });
  assert.equal(result.status, 2);
  assert(!readdirSync(directory).includes('unexpected-command'));
});
test('checkpoint unseal never uses archived Compose or shell configuration', () => {
  const source = readFileSync(script, 'utf8');
  assert.doesNotMatch(source, /docker compose|source .*\.env|eval /);
  assert.match(source, /--network none/);
  assert.match(source, /--read-only --cap-drop ALL/);
  assert.match(source, /trap cleanup EXIT/);
});
