# Local Auth0 login over HTTPS

Use this environment to validate the hosted authentication flow before a staging domain exists. It serves the production Console build on `https://localhost:5188`, proxies product API requests to loopback port `4488`, and uses an isolated PostgreSQL database on loopback port `5488`. The usual development Console on `5174` can keep running.

## Prepare

Prerequisites: the repository's Node.js/pnpm versions, installed workspace dependencies, Docker, and OpenSSL with `req -addext` support.

Run from this checkout's repository root:

```sh
pnpm auth:local:prepare
```

This creates a 30-day self-signed localhost certificate, a private `.env.auth-local` configuration file with a random CSRF secret, starts the isolated database, builds the API and Console, and applies database migrations. Existing configuration and certificates are preserved on repeat runs. `.env.auth-local` and `.local/` are ignored by Git.

Edit `.env.auth-local` with your Auth0 application's issuer URL (including its trailing slash), client ID, and client secret. Do not use a `VITE_` variable for secrets: the production Console does not need them. A missing client secret prevents the API from starting.

## Configure Auth0

In your existing tenant, open **Applications → Applications → Spectro Console Staging → Settings**:

- Application Type: **Regular Web Applications**.
- Allowed Callback URLs: `https://localhost:5188/v1/auth/callback`.
- Save Changes.

The callback runs in your browser, so Auth0 does not need to reach a publicly hosted Spectro server. This setup logs out of the Spectro session only; it does not terminate the Auth0 SSO session. A later sign-in may therefore return immediately without another password prompt.

## Trust the local certificate

The setup command does not modify your system trust store. On macOS, import `.local/auth/localhost.pem` into your login keychain using Keychain Access. Open this certificate's **Trust** section and allow it for **Secure Sockets Layer (SSL)**. Trust only the certificate generated in this checkout. Restart the browser if needed. The private key remains in `.local/auth/localhost-key.pem` and must not be imported or shared.

An existing trusted localhost certificate/key pair can also be placed at those paths. Both must be present. For renewal, stop the preview, move the old pair aside, rerun setup, and trust the replacement certificate.

## Start and verify

Run each command in its own terminal from the repository root:

```sh
pnpm auth:local:api
```

```sh
pnpm auth:local:web
```

Open `https://localhost:5188` and sign in. Use `localhost` consistently, because the OIDC callback and CSRF origin checks use this exact origin. Changes to the Console require rebuilding; this is a production preview, not the hot-reloading development server.

The preflight can trust this specific certificate without changing Node's global TLS checks:

```sh
NODE_EXTRA_CA_CERTS="$PWD/.local/auth/localhost.pem" \
SPECTRO_STAGING_ORIGIN=https://localhost:5188 \
pnpm test:auth:staging
```

Then follow the login, reload, and logout steps in [hosted authentication acceptance](./hosted-auth-staging.md). A first-time user has no organization membership; project reads returning `403` are expected. This local database does not provision an organization or run the analytics/ingestion stack. Use illustrative Console data for a visual check after login, and test membership separately before production acceptance.

Stop the API and preview with Ctrl+C. Stop the database with `docker compose -f infra/auth-local/compose.yaml stop`; its named volume retains local test accounts and sessions.
