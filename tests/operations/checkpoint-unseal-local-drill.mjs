// Manual, synthetic-only local Docker drill. Run from a TTY; never reads real backups.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

assert(process.stdin.isTTY, 'Run this manual drill in a terminal');
assert(!process.env.DOCKER_HOST && !process.env.DOCKER_CONTEXT);
assert.equal(execFileSync('docker', ['context', 'show'], { encoding: 'utf8' }).trim(), 'orbstack');
const root = mkdtempSync(join(tmpdir(), 'spectro-synthetic-unseal-'));
const bin = join(root, 'bin');
mkdirSync(bin);
const age = execFileSync('/usr/bin/which', ['age'], { encoding: 'utf8' }).trim();
const key = join(root, 'synthetic-only-key');
execFileSync('age-keygen', ['-o', key], { stdio: ['ignore', 'pipe', 'pipe'] });
const recipient = execFileSync('age-keygen', ['-y', key], { encoding: 'utf8' }).trim();
const identity = join(root, 'synthetic-identity.age');
writeFileSync(identity, 'Synthetic fixture; not a user private identity.\n', { mode: 0o600 });
// Replace only identity unlock, so no real passphrase is entered or stored.
// The checkpoint itself is genuinely age-encrypted and decrypted by age.
writeFileSync(
  join(bin, 'age'),
  '#!/bin/sh\nif [ "$1" = --decrypt ] && [ "$2" = "$SYNTHETIC_IDENTITY" ]; then exec /bin/cat "$SYNTHETIC_KEY"; else exec "$REAL_AGE" "$@"; fi\n',
  { mode: 0o700 },
);
const names = [
  'postgres.dump',
  'postgres-globals.sql',
  'clickhouse-schema.sql',
  'events.native',
  'clickhouse-final-count.txt',
  'nats-cold-data.tar',
  'deployment-config.tar',
  'images.json',
  'pipeline.json',
  'quiesced-at.txt',
  'MANIFEST.txt',
];
const script = fileURLToPath(
  new URL('../../scripts/staging-checkpoint-unseal.sh', import.meta.url),
);
const results = [];
for (const corruptChecksum of [false, true]) {
  const backup = join(root, corruptChecksum ? 'corrupt' : 'valid');
  const input = join(backup, 'input');
  mkdirSync(input, { recursive: true });
  const hashes = names.map((name) => {
    const value = `synthetic-only-${name}\n`;
    writeFileSync(join(input, name), value, { mode: 0o600 });
    return `${createHash('sha256').update(value).digest('hex')}  ${name}\n`;
  });
  writeFileSync(join(input, 'SHA256SUMS'), hashes.join(''));
  writeFileSync(join(input, 'STATUS'), 'COMPLETE server export; synthetic fixture only\n');
  if (corruptChecksum) writeFileSync(join(input, 'postgres.dump'), 'corrupted-synthetic-input');
  const tar = join(backup, 'synthetic.tar');
  execFileSync('tar', ['-cf', tar, '-C', input, '.']);
  const archive = join(backup, 'checkpoint.tar.age');
  execFileSync(age, ['-r', recipient, '-o', archive, tar]);
  writeFileSync(
    join(backup, 'SHA256SUMS'),
    `${createHash('sha256').update(readFileSync(archive)).digest('hex')}  checkpoint.tar.age\n`,
  );
  const result = spawnSync(
    '/usr/bin/script',
    ['-q', '/dev/null', '/bin/bash', script, backup, identity],
    {
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        SYNTHETIC_IDENTITY: identity,
        SYNTHETIC_KEY: key,
        REAL_AGE: age,
      },
      stdio: ['inherit', 'pipe', 'pipe'],
      encoding: 'utf8',
      timeout: 60_000,
    },
  );
  assert.equal(result.status, corruptChecksum ? 1 : 0, `${result.stdout}\n${result.stderr}`);
  const report = result.stdout.match(/Report directory: (.+)/)?.[1].trim();
  assert(report);
  const container = readFileSync(join(report, 'container-name'), 'utf8').trim();
  const info = JSON.parse(
    execFileSync('docker', ['inspect', '--format', '{{json .}}', container], { encoding: 'utf8' }),
  );
  assert.equal(info.State.Running, false);
  assert.equal(info.HostConfig.NetworkMode, 'none');
  assert.equal(info.HostConfig.ReadonlyRootfs, true);
  assert.equal(Object.keys(info.HostConfig.PortBindings ?? {}).length, 0);
  assert.match(
    readFileSync(join(report, 'STATUS'), 'utf8'),
    corruptChecksum ? /^INCOMPLETE/ : /^PASS:/,
  );
  results.push({ corruptChecksum, stopped: true, isolated: true, container, report });
}
console.log(
  JSON.stringify(
    { status: 'PASS', syntheticOnly: true, results, retainedForExplicitCleanup: true },
    null,
    2,
  ),
);
