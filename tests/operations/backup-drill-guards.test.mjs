import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const quote = (s) => "'" + s.replaceAll("'", "'\\''") + "'";
const names = [
  'staging-postgres-backup.sh',
  'staging-postgres-restore-drill.sh',
  'staging-clickhouse-backup.sh',
  'staging-clickhouse-restore-drill.sh',
];
for (const name of names) {
  test(`${name}: syntax, help and invalid destination fail closed`, () => {
    const path = join(root, 'scripts', name);
    assert.equal(spawnSync('bash', ['-n', path]).status, 0);
    assert.equal(spawnSync('bash', [path, '--help']).status, 0);
    for (const args of [[], ['/'], ['relative-path']]) {
      assert.equal(spawnSync('bash', [path, ...args]).status, 2);
    }
  });
  test(`${name}: non-interactive invocation cannot contact services`, () => {
    const dir = mkdtempSync(join(tmpdir(), 'spectro-guard-'));
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    const log = join(dir, 'commands.log');
    for (const dependency of ['ssh', 'age', 'shasum', 'mktemp', 'docker']) {
      writeFileSync(
        join(bin, dependency),
        '#!/bin/sh\nprintf "%s\\n" "$0" >> "$GUARD_COMMAND_LOG"\nexit 77\n',
        { mode: 0o700 },
      );
    }
    const result = spawnSync('/bin/bash', [join(root, 'scripts', name), join(dir, 'output')], {
      env: { ...process.env, PATH: bin, GUARD_COMMAND_LOG: log },
      encoding: 'utf8',
    });
    assert.equal(result.status, 2);
    assert(!readdirSync(dir).includes('commands.log'), 'No external command should execute');
    assert(!readdirSync(dir).includes('output'), 'No output directory should be created');
  });
}

// All service binaries are replaced; this test can never reach a real SSH host.
for (const name of ['staging-postgres-backup.sh', 'staging-clickhouse-backup.sh']) {
  test(`${name}: failed export cannot produce SUCCESS even when encryption succeeds`, (t) => {
    if (!['darwin', 'linux'].includes(process.platform))
      return t.skip('PTY launcher not supported');
    if (process.platform === 'darwin' && !process.stdin.isTTY)
      return t.skip('macOS script requires inherited TTY; run this file directly in a terminal');
    const dir = mkdtempSync(join(tmpdir(), 'spectro-export-fail-'));
    const bin = join(dir, 'bin');
    const output = join(dir, 'output');
    mkdirSync(bin);
    writeFileSync(join(bin, 'ssh'), '#!/bin/sh\nexit 41\n', { mode: 0o700 });
    writeFileSync(
      join(bin, 'age'),
      '#!/bin/sh\nwhile [ "$#" -gt 0 ]; do case "$1" in -o|--output) shift; output=$1;; esac; shift; done\nprintf synthetic-ciphertext > "$output"\nexit 0\n',
      { mode: 0o700 },
    );
    const path = join(root, 'scripts', name);
    const args =
      process.platform === 'darwin'
        ? ['-q', '/dev/null', '/bin/bash', path, output]
        : ['-q', '-e', '-c', `/bin/bash ${quote(path)} ${quote(output)}`, '/dev/null'];
    const result = spawnSync('script', args, {
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, AGE_PASSPHRASE: '' },
      encoding: 'utf8',
      timeout: 10_000,
      stdio: ['inherit', 'pipe', 'pipe'],
    });
    if (result.error?.code === 'ENOENT') return t.skip('script utility unavailable');
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    assert(existsSync(output), `${result.stdout}\n${result.stderr}`);
    const backups = readdirSync(output);
    assert.equal(backups.length, 1);
    const backup = join(output, backups[0]);
    assert(!readdirSync(backup).includes('SUCCESS'));
    assert(!readdirSync(backup).includes('SHA256SUMS'));
    assert.match(readFileSync(join(backup, 'STATUS'), 'utf8'), /INCOMPLETE/);
  });
}
