// Local-only recovery from an operator-unsealed checkpoint. No live URLs or ports.
/* eslint-disable no-await-in-loop -- Restore, readiness and authorization checks are ordered. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const inputVolume = process.argv[2];
if (
  process.argv.length !== 3 ||
  !/^spectro-checkpoint-unseal-[A-Za-z0-9]{6}-input$/.test(inputVolume ?? '')
) {
  console.error(
    'Usage: node scripts/staging-checkpoint-local-restore.mjs spectro-checkpoint-unseal-XXXXXX-input',
  );
  process.exit(2);
}
assert(!process.env.DOCKER_HOST && !process.env.DOCKER_CONTEXT, 'Unset Docker endpoint overrides');
const docker = (args, input) =>
  execFileSync('docker', args, {
    input,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    timeout: 90_000,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
const binary = (args) =>
  execFileSync('docker', args, {
    maxBuffer: 32 * 1024 * 1024,
    timeout: 90_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
assert.equal(docker(['context', 'show']).trim(), 'orbstack');
assert(
  docker(['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'])
    .trim()
    .startsWith('unix://'),
);
const label = docker([
  'volume',
  'inspect',
  '--format',
  '{{index .Labels "spectro.purpose"}}',
  inputVolume,
]).trim();
assert.equal(label, 'checkpoint-unseal', 'Only a previously unsealed checkpoint volume is allowed');
const images = {
  helper: 'nats:2.14.6-alpine',
  pg: 'postgres:18.6-alpine',
  ch: 'clickhouse/clickhouse-server:26.3.33.24-alpine',
  nats: 'nats:2.14.6-alpine',
};
for (const image of Object.values(images)) docker(['image', 'inspect', image]);
const id = randomUUID().slice(0, 8);
const report = resolve('.local', `checkpoint-restore-${id}`);
mkdirSync(report, { recursive: true, mode: 0o700 });
const names = Object.fromEntries(
  Object.keys(images).map((kind) => [kind, `spectro-cp-restore-${id}-${kind}`]),
);
const volumes = {
  work: `${names.helper}-work`,
  pg: `${names.pg}-data`,
  ch: `${names.ch}-data`,
  nats: `${names.nats}-data`,
};
const started = [];
const evidence = {};
let phase = 'prepare';
let failed = false;
writeFileSync(
  resolve(report, 'resources.json'),
  JSON.stringify({ inputVolume, names, volumes }, null, 2),
  { mode: 0o600 },
);
console.log(`Report directory: ${report}`);
function exec(kind, args, input) {
  return docker(['exec', ...(input === undefined ? [] : ['-i']), names[kind], ...args], input);
}
function readInput(path) {
  return binary(['exec', names.helper, 'cat', `/input/${path}`]);
}
function putWork(path, content) {
  exec('helper', ['sh', '-c', 'umask 077; cat > "$1"', 'sh', `/work/${path}`], content);
}
function start(kind, mounts, entry, args, memory) {
  docker([
    'run',
    '-d',
    '--name',
    names[kind],
    '--hostname',
    'localhost',
    '--network',
    'none',
    '--restart',
    'no',
    '--memory',
    memory,
    '--cpus',
    '2',
    '--pids-limit',
    '1024',
    '--label',
    'spectro.purpose=checkpoint-local-restore',
    ...mounts.flatMap((mount) => ['-v', mount]),
    ...(entry ? ['--entrypoint', entry] : []),
    images[kind],
    ...args,
  ]);
  started.push(names[kind]);
}
async function ready(kind, args) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      exec(kind, args);
      return;
    } catch {
      await delay(500);
    }
  }
  throw new Error('Readiness failed');
}
function pg(sql) {
  return exec('pg', [
    'psql',
    '-X',
    '-qAt',
    '-v',
    'ON_ERROR_STOP=1',
    '-U',
    'spectro_restore',
    '-d',
    'spectro',
    '-c',
    sql,
  ]).trim();
}
function ch(sql) {
  return exec('ch', ['clickhouse-client', '--query', sql]).trim();
}
function authenticated(kind, role, key, sql, wrong = false) {
  const command =
    kind === 'pg'
      ? [
          'psql',
          '-X',
          '-qAt',
          '-v',
          'ON_ERROR_STOP=1',
          '-v',
          'VERBOSITY=sqlstate',
          '-h',
          '127.0.0.1',
          '-U',
          role,
          '-d',
          'spectro',
          '-c',
          sql,
        ]
      : ['clickhouse-client', '--host', '127.0.0.1', '--user', role, '--query', sql];
  return exec(kind, [
    'sh',
    '-c',
    `set -eu; password=$(/work/read-secret.sh "$1"); if [ "$2" = wrong ]; then password=synthetic-invalid-password; fi; shift 2; ${kind === 'pg' ? 'export PGPASSWORD="$password"' : 'export CLICKHOUSE_PASSWORD="$password"'}; exec "$@"`,
    'sh',
    key,
    wrong ? 'wrong' : 'correct',
    ...command,
  ]).trim();
}
function denied(callback, pattern) {
  let rejected = false;
  try {
    callback();
  } catch (error) {
    rejected = pattern.test(String(error.stderr ?? ''));
  }
  assert(rejected, 'Expected authorization/authentication denial, not an arbitrary failure');
}
try {
  for (const volume of Object.values(volumes))
    docker(['volume', 'create', '--label', 'spectro.purpose=checkpoint-local-restore', volume]);
  start(
    'helper',
    [`${inputVolume}:/input:ro`, `${volumes.work}:/work`],
    'sh',
    ['-c', 'chmod 700 /work; exec sleep 86400'],
    '128m',
  );
  phase = 'verify input and extract private configuration inside helper';
  exec('helper', [
    'sh',
    '-c',
    'set -eu; cd /input; sha256sum -c SHA256SUMS >/dev/null; grep -q "^COMPLETE server export" STATUS; mkdir -m 700 /work/config; tar --no-same-owner -xf deployment-config.tar -C /work/config; test -f /work/config/infra/staging/.env; test ! -L /work/config/infra/staging/.env',
  ]);
  putWork(
    'read-secret.sh',
    `#!/bin/sh
set -eu
awk -v key="$1" '
$0 ~ "^" key "=" {v=substr($0,index($0,"=")+1); q=sprintf("%c",39); d=sprintf("%c",34); if((substr(v,1,1)==q&&substr(v,length(v),1)==q)||(substr(v,1,1)==d&&substr(v,length(v),1)==d))v=substr(v,2,length(v)-2); if(length(v)!=65||substr(v,1,1)!="s"||substr(v,2)~/[^a-f0-9]/)exit 1; count++; value=v}
END {if(count!=1)exit 1; print value}' /work/config/infra/staging/.env
`,
  );
  exec('helper', ['chmod', '700', '/work/read-secret.sh']);
  exec('helper', [
    'sh',
    '-c',
    'umask 077; od -An -N32 -tx1 /dev/urandom | tr -d " \\n" > /work/bootstrap-password',
  ]);
  const checkpoint = JSON.parse(readInput('pipeline.json').toString());
  assert.equal(checkpoint.status, 'ok');
  assert.equal(checkpoint.jetstream.streamStoredMessages, 0);
  assert.equal(checkpoint.jetstream.consumerAckPending, 0);

  phase = 'restore PostgreSQL globals and database';
  start(
    'pg',
    [`${volumes.pg}:/var/lib/postgresql`, `${volumes.work}:/work:ro`],
    'sh',
    [
      '-c',
      'export POSTGRES_USER=spectro_restore POSTGRES_DB=spectro_restore POSTGRES_PASSWORD="$(cat /work/bootstrap-password)" POSTGRES_INITDB_ARGS="--auth-host=scram-sha-256 --auth-local=trust"; exec docker-entrypoint.sh postgres',
    ],
    '1g',
  );
  await ready('pg', [
    'pg_isready',
    '-h',
    '127.0.0.1',
    '-U',
    'spectro_restore',
    '-d',
    'spectro_restore',
  ]);
  exec(
    'pg',
    ['psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'spectro_restore', '-d', 'spectro_restore'],
    readInput('postgres-globals.sql'),
  );
  exec('pg', ['createdb', '-U', 'spectro_restore', '-O', 'spectro_admin', 'spectro']);
  exec(
    'pg',
    [
      'pg_restore',
      '-U',
      'spectro_restore',
      '-d',
      'spectro',
      '--exit-on-error',
      '--single-transaction',
    ],
    readInput('postgres.dump'),
  );
  pg(
    'REVOKE ALL ON DATABASE spectro FROM PUBLIC; GRANT CONNECT ON DATABASE spectro TO spectro_api,spectro_ingest;',
  );
  const migrations = Number(pg('SELECT count(*) FROM control_plane_migrations'));
  assert.equal(migrations, 7);
  assert.equal(
    pg("SELECT count(*) FROM pg_constraint WHERE contype='f' AND NOT convalidated"),
    '0',
  );
  phase = 'verify recovered PostgreSQL login and grants';
  phase = 'PostgreSQL admin login';
  authenticated('pg', 'spectro_admin', 'POSTGRES_ADMIN_PASSWORD', 'SELECT 1');
  phase = 'PostgreSQL API login';
  authenticated('pg', 'spectro_api', 'POSTGRES_API_PASSWORD', 'SELECT count(*) FROM projects');
  phase = 'PostgreSQL ingestion login';
  authenticated(
    'pg',
    'spectro_ingest',
    'POSTGRES_INGEST_PASSWORD',
    'SELECT count(*) FROM project_write_keys',
  );
  phase = 'PostgreSQL incorrect password rejection';
  denied(
    () => authenticated('pg', 'spectro_api', 'POSTGRES_API_PASSWORD', 'SELECT 1', true),
    /28P01|password authentication failed/i,
  );
  phase = 'PostgreSQL ingestion private-read denial';
  denied(
    () =>
      authenticated(
        'pg',
        'spectro_ingest',
        'POSTGRES_INGEST_PASSWORD',
        'SELECT count(*) FROM console_users',
      ),
    /42501/,
  );
  phase = 'PostgreSQL ingestion write denial';
  denied(
    () =>
      authenticated(
        'pg',
        'spectro_ingest',
        'POSTGRES_INGEST_PASSWORD',
        'UPDATE project_write_keys SET label=label WHERE false',
      ),
    /42501|25006/,
  );
  const projectScopes = new Set(
    pg(
      'SELECT project_id || chr(9) || name FROM project_environments ORDER BY project_id,name',
    ).split('\n'),
  );
  evidence.postgres = {
    migrations,
    sourceRolePasswordsVerified: true,
    incorrectPasswordRejected: true,
    ingestionRestricted: true,
    databaseConnectGrantsRecreated: true,
  };

  phase = 'restore ClickHouse schema and stored events';
  start(
    'ch',
    [`${volumes.ch}:/var/lib/clickhouse`, `${volumes.work}:/work:ro`],
    undefined,
    [],
    '2g',
  );
  await ready('ch', ['clickhouse-client', '--query', 'SELECT 1']);
  ch('CREATE DATABASE spectro');
  exec('ch', ['clickhouse-client', '--multiquery'], readInput('clickhouse-schema.sql'));
  ch('SYSTEM STOP MERGES spectro.events_v1');
  const columns =
    'event_id,event_version,event_type,event_name,timestamp_ms,envelope_sent_at_ms,processed_at_ms,processing_version,project_id,environment,sdk_name,sdk_version,session_id,user_id,anonymous_id,page_id,page_url,page_path,release_version,trace_id,tags,error_fingerprint,context_json,payload_json';
  exec(
    'ch',
    ['clickhouse-client', '--query', `INSERT INTO spectro.events_v1 (${columns}) FORMAT Native`],
    readInput('events.native'),
  );
  // Native reference and canonical hashes stay inside disposable container storage.
  const nativeTar = binary(['cp', `${names.helper}:/input/events.native`, '-']);
  exec('ch', ['tar', '-xf', '-', '-C', '/tmp'], nativeTar);
  const key =
    'project_id,environment,toDate(fromUnixTimestamp64Milli(timestamp_ms)),event_type,event_name,event_id';
  const reference = `(SELECT * FROM table ORDER BY processed_at_ms DESC LIMIT 1 BY ${key})`;
  phase = 'compare ClickHouse Native export and restored logical contents';
  const local = (sql) =>
    exec('ch', [
      'clickhouse',
      'local',
      '--background_schedule_pool_size',
      '16',
      '--file',
      '/tmp/events.native',
      '--input-format',
      'Native',
      '--query',
      sql,
    ]).trim();
  assert.equal(
    local(
      `SELECT count() FROM (SELECT ${key},processed_at_ms FROM table GROUP BY ${key},processed_at_ms HAVING uniqExact(tuple(${columns}))>1) FORMAT TSVRaw`,
    ),
    '0',
  );
  const logicalCount = Number(ch('SELECT count() FROM spectro.events_v1 FINAL FORMAT TSVRaw'));
  assert.equal(logicalCount, Number(readInput('clickhouse-final-count.txt').toString().trim()));
  assert.equal(logicalCount, Number(local(`SELECT count() FROM ${reference} FORMAT TSVRaw`)));
  const canonical = `SELECT toJSONString(tuple(${columns})) AS row FROM`;
  phase = 'compare ClickHouse canonical content hashes';
  const sourceHash = exec('ch', [
    'sh',
    '-c',
    'set -eu; clickhouse local --background_schedule_pool_size 16 --file /tmp/events.native --input-format Native --query "$1" > /tmp/source-canonical; sha256sum /tmp/source-canonical',
    'sh',
    `${canonical} ${reference} ORDER BY row FORMAT TSVRaw`,
  ]).split(' ')[0];
  const restoredHash = exec('ch', [
    'sh',
    '-c',
    'set -eu; clickhouse-client --query "$1" > /tmp/restored-canonical; sha256sum /tmp/restored-canonical',
    'sh',
    `${canonical} spectro.events_v1 FINAL ORDER BY row FORMAT TSVRaw`,
  ]).split(' ')[0];
  assert.equal(sourceHash, restoredHash);
  phase = 'verify ClickHouse credentials, privileges and PostgreSQL scope linkage';
  exec('ch', [
    'sh',
    '-c',
    `set -eu; api=$(/work/read-secret.sh CLICKHOUSE_API_PASSWORD); worker=$(/work/read-secret.sh CLICKHOUSE_PROCESSOR_PASSWORD); printf "CREATE USER spectro_api IDENTIFIED WITH sha256_password BY '%s'; GRANT SELECT ON spectro.events_v1 TO spectro_api; CREATE USER spectro_processor IDENTIFIED WITH sha256_password BY '%s'; GRANT INSERT ON spectro.events_v1 TO spectro_processor;" "$api" "$worker" | clickhouse-client --multiquery`,
  ]);
  assert.equal(
    Number(
      authenticated(
        'ch',
        'spectro_api',
        'CLICKHOUSE_API_PASSWORD',
        'SELECT count() FROM spectro.events_v1 FINAL',
      ),
    ),
    logicalCount,
  );
  authenticated('ch', 'spectro_processor', 'CLICKHOUSE_PROCESSOR_PASSWORD', 'SELECT 1');
  denied(
    () => authenticated('ch', 'spectro_api', 'CLICKHOUSE_API_PASSWORD', 'SELECT 1', true),
    /AUTHENTICATION_FAILED|Code: 516/,
  );
  denied(
    () =>
      authenticated(
        'ch',
        'spectro_processor',
        'CLICKHOUSE_PROCESSOR_PASSWORD',
        'SELECT count() FROM spectro.events_v1',
      ),
    /ACCESS_DENIED|Code: 497/,
  );
  denied(
    () =>
      authenticated(
        'ch',
        'spectro_api',
        'CLICKHOUSE_API_PASSWORD',
        'INSERT INTO spectro.events_v1 SELECT * FROM spectro.events_v1 WHERE 0',
      ),
    /ACCESS_DENIED|Code: 497/,
  );
  const eventScopes = ch(
    'SELECT DISTINCT project_id,environment FROM spectro.events_v1 FINAL FORMAT TSVRaw',
  ).split('\n');
  assert(
    eventScopes.every((scope) => projectScopes.has(scope)),
    'Restored events must reference restored project/environment scopes',
  );
  evidence.clickhouse = {
    logicalEvents: logicalCount,
    canonicalSHA256: restoredHash,
    matchesCheckpointCount: true,
    projectEnvironmentLinkage: true,
    recreatedPasswordsAndScopedGrantsVerified: true,
  };

  phase = 'restore stopped NATS data with recovered private configuration';
  const natsTar = readInput('nats-cold-data.tar');
  // Fill only the newly created broker volume, before its server starts.
  const loader = `${names.nats}-loader`;
  docker(
    [
      'run',
      '--rm',
      '-i',
      '--network',
      'none',
      '--name',
      loader,
      '--label',
      'spectro.purpose=checkpoint-local-restore',
      '-v',
      `${volumes.nats}:/data`,
      '--entrypoint',
      'tar',
      images.helper,
      '--no-same-owner',
      '-xf',
      '-',
      '-C',
      '/data',
    ],
    natsTar,
  );
  start(
    'nats',
    [`${volumes.nats}:/data`, `${volumes.work}:/work:ro`],
    'sh',
    [
      '-c',
      'set -eu; export NATS_INGEST_PASSWORD="$(/work/read-secret.sh NATS_INGEST_PASSWORD)" NATS_PROCESSOR_PASSWORD="$(/work/read-secret.sh NATS_PROCESSOR_PASSWORD)"; exec nats-server -c /work/config/infra/staging/nats.conf',
    ],
    '256m',
  );
  await ready('nats', ['wget', '-q', '-O', '-', 'http://127.0.0.1:8222/healthz']);
  const snapshot = JSON.parse(
    exec('nats', [
      'wget',
      '-q',
      '-O',
      '-',
      'http://127.0.0.1:8222/jsz?accounts=true&streams=true&consumers=true&config=true',
    ]),
  );
  const streams = (snapshot.account_details ?? []).flatMap(
    (account) => account.stream_detail ?? [],
  );
  const stream = streams.find((item) => item.name === 'SPECTRO_ADMITTED');
  assert(stream, 'Cold restored stream must exist');
  assert.equal(stream.state.messages, 0);
  assert.equal(stream.state.last_seq, checkpoint.jetstream.consumerAcknowledgedSequence);
  const consumer = (stream.consumer_detail ?? []).find(
    (item) => item.name === 'spectro-processor-v1',
  );
  assert(consumer, 'Cold restored durable consumer must exist');
  assert.equal(consumer.num_ack_pending ?? 0, 0);
  assert.equal(consumer.num_pending ?? 0, 0);
  assert.equal(consumer.ack_floor.stream_seq, checkpoint.jetstream.consumerAcknowledgedSequence);
  phase = 'verify recovered NATS client passwords';
  for (const [user, secret] of [
    ['processor', 'NATS_PROCESSOR_PASSWORD'],
    ['ingest', 'NATS_INGEST_PASSWORD'],
  ]) {
    const response = exec('nats', [
      'sh',
      '-c',
      String.raw`set -eu; password=$(/work/read-secret.sh "$1"); printf 'CONNECT {"user":"%s","pass":"%s"}\r\nPING\r\n' "$2" "$password" | nc -w 2 127.0.0.1 4222 || true`,
      'sh',
      secret,
      user,
    ]);
    assert.match(response, /PONG\r?\n/);
    assert.doesNotMatch(response, /-ERR/);
  }
  const rejectedNats = exec('nats', [
    'sh',
    '-c',
    String.raw`printf 'CONNECT {"user":"processor","pass":"synthetic-invalid-password"}\r\nPING\r\n' | nc -w 2 127.0.0.1 4222 || true`,
  ]);
  assert.match(rejectedNats, /-ERR.*Authorization/i);
  evidence.nats = {
    coldRestoreVerified: true,
    emptyQueue: true,
    retainedAcknowledgedSequence: consumer.ack_floor.stream_seq,
    recoveredConfigurationUsed: true,
    recoveredClientPasswordsVerified: true,
  };
  phase = 'verify isolation';
  for (const name of started) {
    const info = JSON.parse(docker(['inspect', '--format', '{{json .HostConfig}}', name]));
    assert.equal(info.NetworkMode, 'none');
    assert.equal(Object.keys(info.PortBindings ?? {}).length, 0);
  }
} catch {
  failed = true;
  console.error(`FAIL at phase: ${phase}. Private command output suppressed; resources will stop.`);
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
    evidence,
    stopped,
    limitations: [
      'No real Auth0/application startup or replay into the restored databases',
      'No source-cutoff PostgreSQL row checksum baseline was captured',
      'ClickHouse grants were recreated, not exported from system tables',
      'Empty broker checkpoint does not exercise nonempty cold restore or new message replay',
      'No measured full application RPO/RTO',
    ],
    protectedPlaintextVolumesRetained: true,
  };
  writeFileSync(resolve(report, 'result.json'), JSON.stringify(result, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(result, null, 2));
}
if (failed) process.exitCode = 1;
