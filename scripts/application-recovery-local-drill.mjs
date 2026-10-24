// Clone a verified stopped recovery set; never reuse its writable volumes.
/* eslint-disable no-await-in-loop -- Clone, readiness, probe and shutdown must be ordered. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const resourceFile = process.argv[2];
if (
  process.argv.length !== 3 ||
  !isAbsolute(resourceFile ?? '') ||
  !/\/checkpoint-restore-[a-f0-9]{8}\/resources\.json$/.test(resourceFile)
) {
  console.error(
    'Supply the absolute resources.json path of a verified stopped component recovery.',
  );
  process.exit(2);
}
assert(!process.env.DOCKER_HOST && !process.env.DOCKER_CONTEXT, 'Unset Docker endpoint overrides');
const docker = (args) =>
  execFileSync('docker', args, {
    encoding: 'utf8',
    maxBuffer: 2 * 1024 * 1024,
    timeout: 120_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
assert.equal(docker(['context', 'show']).trim(), 'orbstack');
assert(
  docker(['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'])
    .trim()
    .startsWith('unix://'),
);
const source = JSON.parse(readFileSync(resourceFile, 'utf8'));
const prior = JSON.parse(readFileSync(resolve(dirname(resourceFile), 'result.json'), 'utf8'));
assert.equal(prior.status, 'PASS');
assert.equal(prior.stopped, true);
for (const kind of ['helper', 'pg', 'ch', 'nats']) {
  assert(/^spectro-cp-restore-[a-f0-9]{8}-(helper|pg|ch|nats)$/.test(source.names[kind] ?? ''));
  assert.equal(
    docker(['inspect', '--format', '{{.State.Running}}', source.names[kind]]).trim(),
    'false',
  );
}
for (const [kind, volume] of Object.entries(source.volumes)) {
  assert.equal(
    volume,
    `${source.names[kind === 'work' ? 'helper' : kind]}-${kind === 'work' ? 'work' : 'data'}`,
  );
  assert.equal(
    docker(['volume', 'inspect', '--format', '{{index .Labels "spectro.purpose"}}', volume]).trim(),
    'checkpoint-local-restore',
  );
  assert.equal(
    docker(['ps', '--filter', `volume=${volume}`, '--format', '{{.Names}}']).trim(),
    '',
    'Source volume must be cold',
  );
}
const image = 'spectro-app-recovery:6141e57';
docker(['image', 'inspect', image]);
const suffix = randomUUID().slice(0, 8);
const prefix = `spectro-app-recovery-${suffix}`;
const network = `${prefix}-internal`;
const names = Object.fromEntries(['pg', 'ch', 'nats', 'app'].map((k) => [k, `${prefix}-${k}`]));
const volumes = Object.fromEntries(['pg', 'ch', 'nats'].map((k) => [k, `${prefix}-${k}-data`]));
const report = resolve('.local', `application-recovery-${suffix}`);
mkdirSync(report, { recursive: true, mode: 0o700 });
writeFileSync(
  resolve(report, 'resources.json'),
  JSON.stringify(
    {
      sourceResourceFile: resourceFile,
      names,
      volumes,
      network,
      sourceWorkVolume: source.volumes.work,
      image,
    },
    null,
    2,
  ),
  { mode: 0o600 },
);
console.log(`Report directory: ${report}`);
const started = [];
let phase = 'clone stopped data';
let failed = false;
let probe;
const startedAt = new Date().toISOString();
function start(kind, args) {
  docker([
    'run',
    '-d',
    '--name',
    names[kind],
    '--network',
    network,
    '--network-alias',
    { pg: 'postgres', ch: 'clickhouse', nats: 'nats' }[kind],
    '--restart',
    'no',
    '--cpus',
    '2',
    '--pids-limit',
    '1024',
    '--label',
    'spectro.purpose=application-recovery',
    ...args,
  ]);
  started.push(names[kind]);
}
async function ready(kind, args) {
  for (let i = 0; i < 60; i++) {
    try {
      docker(['exec', names[kind], ...args]);
      return;
    } catch {
      await delay(500);
    }
  }
  throw new Error('Local readiness timeout');
}
try {
  docker([
    'network',
    'create',
    '--internal',
    '--label',
    'spectro.purpose=application-recovery',
    network,
  ]);
  assert.equal(docker(['network', 'inspect', '--format', '{{.Internal}}', network]).trim(), 'true');
  for (const kind of ['pg', 'ch', 'nats']) {
    docker(['volume', 'create', '--label', 'spectro.purpose=application-recovery', volumes[kind]]);
    docker([
      'run',
      '--rm',
      '--network',
      'none',
      '--label',
      'spectro.purpose=application-recovery',
      '-v',
      `${source.volumes[kind]}:/source:ro`,
      '-v',
      `${volumes[kind]}:/target`,
      '--entrypoint',
      'sh',
      'nats:2.14.6-alpine',
      '-c',
      'set -eu; cp -a /source/. /target/',
    ]);
  }
  phase = 'start cloned components on internal network';
  start('pg', [
    '--memory',
    '1g',
    '-v',
    `${volumes.pg}:/var/lib/postgresql`,
    'postgres:18.6-alpine',
  ]);
  start('ch', [
    '--memory',
    '2g',
    '-v',
    `${volumes.ch}:/var/lib/clickhouse`,
    'clickhouse/clickhouse-server:26.3.33.24-alpine',
  ]);
  start('nats', [
    '--memory',
    '256m',
    '-v',
    `${volumes.nats}:/data`,
    '-v',
    `${source.volumes.work}:/work:ro`,
    '--entrypoint',
    'sh',
    'nats:2.14.6-alpine',
    '-c',
    'set -eu; export NATS_INGEST_PASSWORD="$(/work/read-secret.sh NATS_INGEST_PASSWORD)" NATS_PROCESSOR_PASSWORD="$(/work/read-secret.sh NATS_PROCESSOR_PASSWORD)"; exec nats-server -c /work/config/infra/staging/nats.conf',
  ]);
  await ready('pg', ['pg_isready', '-h', '127.0.0.1', '-U', 'spectro_restore', '-d', 'spectro']);
  await ready('ch', ['clickhouse-client', '--query', 'SELECT 1']);
  await ready('nats', ['wget', '-q', '-O', '-', 'http://127.0.0.1:8222/healthz']);
  phase = 'execute real HTTP and worker probe';
  const script = fileURLToPath(
    new URL('../tests/integration/application-recovery-probe.mjs', import.meta.url),
  );
  docker([
    'create',
    '--name',
    names.app,
    '--network',
    network,
    '--user',
    '0:0',
    '--read-only',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    '--tmpfs',
    '/tmp:rw,nosuid,size=16m',
    '--memory',
    '512m',
    '--cpus',
    '2',
    '--pids-limit',
    '128',
    '--label',
    'spectro.purpose=application-recovery',
    '-v',
    `${source.volumes.work}:/recovery:ro`,
    '-v',
    `${script}:/workspace/tests/integration/application-recovery-probe.mjs:ro`,
    '-e',
    'SPECTRO_RECOVERY_ONLY=internal-clone',
    '--entrypoint',
    'node',
    image,
    'tests/integration/application-recovery-probe.mjs',
  ]);
  started.push(names.app);
  const output = docker(['start', '-a', names.app]);
  probe = JSON.parse(output.trim());
  assert.equal(probe.status, 'PASS');
  assert.equal(docker(['inspect', '--format', '{{.State.ExitCode}}', names.app]).trim(), '0');
  phase = 'verify network and no published ports';
  for (const name of started) {
    const info = JSON.parse(docker(['inspect', '--format', '{{json .HostConfig}}', name]));
    assert.equal(info.NetworkMode, network);
    assert.equal(Object.keys(info.PortBindings ?? {}).length, 0);
  }
} catch {
  failed = true;
  if (started.includes(names.app)) {
    try {
      probe = JSON.parse(docker(['logs', names.app]).trim());
    } catch {
      /* Never emit private raw logs. */
    }
  }
  console.error(`FAIL at phase: ${phase}; private container output suppressed.`);
} finally {
  let stopped = true;
  for (const name of started.toReversed()) {
    try {
      docker(['stop', name]);
    } catch {
      stopped = false;
      failed = true;
    }
  }
  const result = {
    status: failed ? 'FAIL' : 'PASS',
    phase,
    startedAt,
    completedAt: new Date().toISOString(),
    internalNetwork: true,
    noPublishedPorts: true,
    stopped,
    probe,
    originalRecoverySetUnchanged: true,
    protectedCloneVolumesRetained: true,
  };
  writeFileSync(resolve(report, 'result.json'), JSON.stringify(result, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(result, null, 2));
}
if (failed) process.exitCode = 1;
