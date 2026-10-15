import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const directory = fileURLToPath(new URL('./', import.meta.url));
const target = `${directory}.env`;
if (existsSync(target)) {
  throw new Error('Staging .env already exists. Existing credentials were not changed.');
}
mkdirSync(directory, { recursive: true });
const secret = () => `s${randomBytes(32).toString('hex')}`;
writeFileSync(
  target,
  [
    'CONSOLE_HOST=staging.spectrohq.com',
    'INGEST_HOST=ingest-staging.spectrohq.com',
    `POSTGRES_ADMIN_PASSWORD=${secret()}`,
    `POSTGRES_API_PASSWORD=${secret()}`,
    `POSTGRES_INGEST_PASSWORD=${secret()}`,
    `CLICKHOUSE_ADMIN_PASSWORD=${secret()}`,
    `CLICKHOUSE_API_PASSWORD=${secret()}`,
    `CLICKHOUSE_PROCESSOR_PASSWORD=${secret()}`,
    `NATS_INGEST_PASSWORD=${secret()}`,
    `NATS_PROCESSOR_PASSWORD=${secret()}`,
    `SPECTRO_AUTH_CSRF_SECRET=${secret()}`,
    'SPECTRO_OIDC_ISSUER=https://dev-d0d6unpx3uzthqly.us.auth0.com/',
    'SPECTRO_OIDC_CLIENT_ID=95I4nEuHy0XJ464GepfQxZmxiBeTHpqa',
    'SPECTRO_OIDC_CLIENT_SECRET=',
    '',
  ].join('\n'),
  { flag: 'wx', mode: 0o600 },
);
chmodSync(target, 0o600);
console.log(
  'Created private staging .env. Verify the OIDC Client ID and fill its secret before starting.',
);
