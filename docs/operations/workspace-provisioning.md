# Workspace provisioning acceptance

This slice implements ADR-050's explicit organization creation and organization-wide project permissions. It adds control-plane API routes, first-run organization/project onboarding, project-scoped Browser write-key management, and additive audit migrations.

## Expected flow

1. Sign in through Auth0. The Spectro identity and session exist, but login alone grants no organization access.
2. `GET /v1/organizations` returns only the signed-in user's memberships (an empty list for a new user).
3. Explicitly create an organization with `POST /v1/organizations`. Its creator receives Owner membership in the same transaction as the organization and audit record.
4. Create a project with `POST /v1/organizations/:organizationId/projects`, supplying its environment names. Owner and Admin may do this; Member and Viewer may only list projects.
5. The Console opens Project settings. An Owner/Admin creates an environment-scoped Browser write key; its raw secret is shown once. Configure allowed browser origins, then use the generated SDK snippet to send events. Every event's project and environment must match the key scope.
6. Use the project ID and registered environment on the existing event, issue, performance, network and release endpoints. Their existing authorization resolves the project through its organization membership.

Creation uses the signed-in user's ID as the actor. It does not accept a role, member ID, project ID or organization ID in the JSON body. See [API request contracts](../../apps/api/README.md#workspace-provisioning).

## Automated local acceptance

The isolated Auth0 test database remains on port 5488. Run from the current checkout; these commands do not require the OIDC client secret:

```sh
SPECTRO_POSTGRES_URL=postgres://spectro:spectro_local@127.0.0.1:5488/spectro_auth_local \
  pnpm --filter @spectro/api migrate

SPECTRO_POSTGRES_URL=postgres://spectro:spectro_local@127.0.0.1:5488/spectro_auth_local \
  pnpm --filter @spectro/api exec vitest run \
  src/postgres-workspaces.integration.test.ts \
  src/postgres-auth-control-plane.integration.test.ts
```

The workspace test exercises Fastify requests, real PostgreSQL sessions, memberships, projects, environments and audit transactions. Only the event-plane reader is a test double, so a successful event read proves authorization, not ClickHouse ingestion or query correctness. The existing full integration gate covers the event pipeline separately. Fixtures have per-run random identifiers and cleanup does not modify the manually registered Auth0 user.

## Rollout and limits

- Apply migrations 005 and 006, deploy the product API and ingestion service with separate PostgreSQL credentials, then exercise onboarding and key rotation with a non-production account.
- On rollback, deploy the previous API and leave the additive audit table intact. Existing user sessions and tenant records do not require a destructive rollback.
- Organization/project switching is available in the Console. [Invitations and membership management](./organization-membership.md) now implement ADR-053, including protected ownership changes. Quotas/rate limits, organization deletion and publishing the Browser SDK remain follow-ups.
- Creation requests are not idempotent. After a network timeout, list the caller's organizations/projects before retrying. Names are display labels and are not uniqueness or identity keys.
- No customer organization is automatically provisioned by the acceptance test. An Auth0 registration still requires an explicit organization creation action.
