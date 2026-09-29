# Hosted authentication staging acceptance

This runbook validates the production authentication model from ADR-050 against a staging deployment. It does not select an identity provider or store credentials in the repository.

If no staging domain is available yet, use the [local HTTPS Auth0 environment](./auth-local.md) to validate login, reload, and logout first.

## Configure the staging deployment

The Console and product API must be reachable through one HTTPS origin. Configure these API environment variables in the staging secret manager:

- `SPECTRO_AUTH_MODE=hosted`
- `SPECTRO_POSTGRES_URL`
- `SPECTRO_PUBLIC_ORIGIN`, set to the Console/API HTTPS origin
- `SPECTRO_AUTH_CSRF_SECRET`, at least 32 bytes
- `SPECTRO_OIDC_ISSUER`, an HTTPS issuer URL
- `SPECTRO_OIDC_CLIENT_ID`
- `SPECTRO_OIDC_CLIENT_SECRET`

In the managed OIDC provider, register `${SPECTRO_PUBLIC_ORIGIN}/v1/auth/callback` as an allowed redirect URI and enable Authorization Code with PKCE S256. Keep client credentials and the CSRF secret in the deployment secret manager; do not commit or paste them into chat.

## Run the automated preflight

From the repository root, provide only the staging origin (no path, query, or credentials):

```sh
SPECTRO_STAGING_ORIGIN=https://console-staging.example.com pnpm test:auth:staging
```

The check verifies HTTPS, same-origin API health, anonymous access denial, no-store session responses, the provider redirect and OIDC state/nonce/PKCE fields, secure host-only login-cookie attributes, and rejection of a callback without its initiating browser cookie. Calling `/v1/auth/login` creates one short-lived login transaction in the staging database.

Without `SPECTRO_STAGING_ORIGIN`, the check is reported as skipped. This is useful in local development and CI environments that do not have staging credentials.

## Verify the browser flow

Use a staging test account that already has organization and project membership. Organization creation and invitations are not part of this authentication acceptance.

1. Open the Console in a private browser window and sign in through the configured provider.
2. Confirm the callback returns to the Console and the session endpoint shows the expected Spectro user.
3. In browser storage tools, confirm the session credential is only in the `__Host-spectro-session` cookie, marked `Secure`, `HttpOnly`, `SameSite=Lax`, and `Path=/`. The SPA must not store provider tokens or a bearer session token in local or session storage.
4. Reload the Console and open a project the test user belongs to. Confirm it stays signed in and can read the project.
5. If a non-member test account is available, confirm it cannot read that project.
6. Sign out. Confirm the session cookie is cleared and a subsequent session request returns `401`.

Do not include cookies, authorization codes, client credentials, or CSRF values in screenshots or shared logs. Record only pass/fail results and non-sensitive request paths/status codes.
