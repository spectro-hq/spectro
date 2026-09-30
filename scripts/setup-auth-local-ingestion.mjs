import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const root = new URL('../', import.meta.url);
const envFile = new URL('.env.ingest-local', root);
const role = 'spectro_auth_local_ingest';
let password = randomBytes(32).toString('hex');
if (existsSync(envFile)) {
  const saved = parseEnv(readFileSync(envFile, 'utf8'));
  const url = new URL(saved.SPECTRO_INGEST_KEY_POSTGRES_URL ?? '');
  if (
    url.hostname !== '127.0.0.1' ||
    url.port !== '5488' ||
    url.username !== role ||
    url.pathname !== '/spectro_auth_local' ||
    !/^[a-f0-9]{64}$/.test(url.password)
  ) {
    throw new Error(
      'Unexpected local ingestion configuration. Existing credentials were not changed.',
    );
  }
  password = url.password;
}

try {
  execFileSync(
    'docker',
    [
      'compose',
      '-f',
      'infra/auth-local/compose.yaml',
      'exec',
      '-T',
      'postgres',
      'psql',
      '-U',
      'spectro',
      '-d',
      'spectro_auth_local',
      '-v',
      'ON_ERROR_STOP=1',
    ],
    {
      cwd: fileURLToPath(root),
      input: `
      BEGIN;
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN
          CREATE ROLE ${role} LOGIN;
        END IF;
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}' AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls))
          OR EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.member WHERE r.rolname = '${role}') THEN
          RAISE EXCEPTION 'Unexpected privileges on the local ingestion role';
        END IF;
      END $$;
      ALTER ROLE ${role} PASSWORD '${password}';
      ALTER ROLE ${role} SET default_transaction_read_only = on;
      GRANT CONNECT ON DATABASE spectro_auth_local TO ${role};
      GRANT USAGE ON SCHEMA public TO ${role};
      GRANT SELECT ON project_write_keys TO ${role};
      COMMIT;
    `,
      stdio: ['pipe', 'ignore', 'pipe'],
    },
  );
} catch {
  // Do not print psql diagnostics: they can contain the password-bearing SQL.
  throw new Error(
    'Could not prepare the local ingestion role. Check the auth-local database and migrations.',
  );
}

if (!existsSync(envFile)) {
  writeFileSync(
    envFile,
    [
      '# Local ingestion only. Never commit this file.',
      'NODE_ENV=production',
      'SPECTRO_INGEST_HOST=127.0.0.1',
      'SPECTRO_INGEST_PORT=4401',
      'SPECTRO_NATS_URL=nats://127.0.0.1:4222',
      `SPECTRO_INGEST_KEY_POSTGRES_URL=postgres://${role}:${password}@127.0.0.1:5488/spectro_auth_local`,
      '',
    ].join('\n'),
    { flag: 'wx', mode: 0o600 },
  );
}
chmodSync(envFile, 0o600);
console.log(
  'Local ingestion ready: read-only key lookup on auth-local PostgreSQL; private configuration preserved.',
);
