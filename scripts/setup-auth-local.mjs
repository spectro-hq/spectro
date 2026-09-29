import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const certificates = new URL('.local/auth/', root);
const key = new URL('localhost-key.pem', certificates);
const cert = new URL('localhost.pem', certificates);
const envFile = new URL('.env.auth-local', root);

mkdirSync(certificates, { recursive: true, mode: 0o700 });

if (existsSync(key) !== existsSync(cert)) {
  throw new Error('Incomplete local certificate pair. Restore both files before running setup.');
}
if (!existsSync(cert)) {
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-sha256',
      '-nodes',
      '-days',
      '30',
      '-subj',
      '/CN=localhost',
      '-addext',
      'subjectAltName=DNS:localhost,IP:127.0.0.1',
      '-addext',
      'basicConstraints=critical,CA:FALSE',
      '-addext',
      'extendedKeyUsage=serverAuth',
      '-keyout',
      fileURLToPath(key),
      '-out',
      fileURLToPath(cert),
    ],
    { stdio: 'ignore' },
  );
}
chmodSync(key, 0o600);

if (!existsSync(envFile)) {
  // JSON quoting keeps supplied public configuration on a single dotenv line.
  const issuer = JSON.stringify(process.env.SPECTRO_OIDC_ISSUER ?? '');
  const clientId = JSON.stringify(process.env.SPECTRO_OIDC_CLIENT_ID ?? '');
  writeFileSync(
    envFile,
    [
      '# Local authentication only. Never commit this file.',
      'NODE_ENV=production',
      'SPECTRO_AUTH_MODE=hosted',
      'SPECTRO_PUBLIC_ORIGIN=https://localhost:5188',
      'SPECTRO_API_HOST=127.0.0.1',
      'SPECTRO_API_PORT=4488',
      'SPECTRO_POSTGRES_URL=postgres://spectro:spectro_local@127.0.0.1:5488/spectro_auth_local',
      `SPECTRO_AUTH_CSRF_SECRET=${randomBytes(32).toString('hex')}`,
      `SPECTRO_OIDC_ISSUER=${issuer}`,
      `SPECTRO_OIDC_CLIENT_ID=${clientId}`,
      '# Paste the Auth0 application Client Secret below, in quotes.',
      'SPECTRO_OIDC_CLIENT_SECRET=""',
      '',
    ].join('\n'),
    { flag: 'wx', mode: 0o600 },
  );
}

console.log('Local auth files ready; existing configuration and certificates were preserved.');
console.log(`Edit ${fileURLToPath(envFile)} to supply your OIDC credentials.`);
console.log(`Local HTTPS certificate: ${fileURLToPath(cert)}`);
console.log('Auth0 Allowed Callback URLs: https://localhost:5188/v1/auth/callback');
console.log('The certificate is self-signed; browser trust must be configured separately.');
