# Organization membership acceptance

Implements [ADR-053](../adr/ADR-053_ORGANIZATION_MEMBERSHIP_AND_INVITATIONS.md).
Settings → Members is organization-wide, not project/environment-scoped. All
members may read the directory; only Owners and Admins may manage membership.
Admins cannot grant or change Owner access. A workspace retains an active Owner.

## Local verification

Apply the additive migration to the existing local control plane, then test its
real HTTP/session/PostgreSQL boundaries:

```sh
SPECTRO_POSTGRES_URL=postgres://spectro:spectro_local@127.0.0.1:5488/spectro_auth_local pnpm --filter @spectro/api migrate
SPECTRO_POSTGRES_URL=postgres://spectro:spectro_local@127.0.0.1:5488/spectro_auth_local pnpm --filter @spectro/api exec vitest run src/postgres-organization-members.integration.test.ts src/postgres-auth-control-plane.integration.test.ts src/postgres-workspaces.integration.test.ts src/postgres-project-write-keys.integration.test.ts
```

Tests create unique fixture organizations/users and remove only those fixtures.
They cover concurrent last-Owner demotion, single-use acceptance, verified email,
wrong recipient, live role checks/removal, Admin restrictions, expiry/revocation,
pagination, CSRF, audit privacy, profile refresh and login continuation. Event
plane ingestion remains covered by its existing integration suite, not this slice.

## Two-account browser acceptance

1. Restart the hosted API and web preview after migration/build. Sign in again to
   refresh the OIDC verified-email snapshot (previously stored users default to
   unverified). No Client Secret changes are needed.
2. Account A opens Settings → Members. Invite account B's exact email as Member.
   Copy the one-time link. Spectro does **not** send an email; deliver it manually.
   Closing “I saved it” discards the raw link; to replace it, revoke and recreate.
3. In another browser profile, B opens the link, signs in, and returns to the join
   screen rather than onboarding. Check organization and role, then explicitly
   accept. Members should show both accounts. B can read projects and update
   issue status, but cannot manage keys, projects, invitations or membership.
4. A changes B to Viewer. Refresh B's Console: reads work, issue writes fail.
   Promote B to Admin: project/key and non-Owner membership management works;
   editing, removing or inviting an Owner remains denied.
5. A revokes an unused invitation: its link must fail. A used or expired link must
   also fail. A different verified email must not preview/accept B's invitation;
   unverified email must explain verification and reauthentication.
6. Attempt to demote/remove the only Owner: keep the membership and show recovery
   guidance. With two Owners, concurrent self-demotions must leave one Owner.
7. A removes B: B's next protected request fails. Foreign organization IDs/cursors
   must not disclose members or invitations. Check light/dark, narrow layout,
   long names/emails, keyboard focus, errors, copy denial and disabled mutations.

Use non-production test accounts. Do not paste invitation secrets, cookies or
provider tokens into screenshots, chat, audit output or service logs. The fragment
is cleared on arrival; a ten-minute HttpOnly continuation cookie survives login.
If that cookie expires, reopen the original invitation link. No localStorage or
sessionStorage is used for invitation secrets.

## Remaining scope

Email delivery/reminders, quotas/rate limiting, public SDK publication and operator
rollout are follow-ups. Workspace roles remain organization-wide. This feature
does not add project-level ACLs, account merging or organization deletion.
