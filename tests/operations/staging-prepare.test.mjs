import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

test('staging preparation protects credentials and refuses accidental rotation', () => {
  const directory = mkdtempSync(join(tmpdir(), 'spectro-staging-test-'));
  const script = join(directory, 'prepare.mjs');
  copyFileSync(new URL('../../infra/staging/prepare.mjs', import.meta.url), script);
  const output = execFileSync(process.execPath, [script], { encoding: 'utf8' });
  const path = join(directory, '.env');
  const before = readFileSync(path, 'utf8');
  assert.equal(statSync(path).mode & 0o777, 0o600);
  const credentials = [...before.matchAll(/(?:PASSWORD|CSRF_SECRET)=(s[a-f0-9]{64})/g)];
  assert.equal(credentials.length, 9);
  assert.equal(new Set(credentials.map((match) => match[1])).size, 9);
  for (const match of credentials) assert.ok(!output.includes(match[1]));
  assert.match(before, /SPECTRO_OIDC_CLIENT_SECRET=\n/);
  assert.throws(() => execFileSync(process.execPath, [script], { stdio: 'pipe' }));
  assert.equal(readFileSync(path, 'utf8'), before);
});
