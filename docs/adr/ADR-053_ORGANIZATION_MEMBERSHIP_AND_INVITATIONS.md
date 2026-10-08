# ADR-053: Organization membership and invitations

Status: Accepted

## Context

ADR-050 defines organization-wide roles and verified, single-use invitations. Hosted
onboarding now works; teams need a safe way to join an existing workspace without
creating another organization. No email delivery service has been selected.

## Decision

- First release uses an explicitly created invitation link, copied and delivered
  by the administrator. Spectro does not send email in this slice.
- Owners may manage all roles. Admins may only invite, change, or remove non-Owner
  members. Members and Viewers may read the member directory, not invitations.
- Every membership mutation locks the organization before checking the actor's
  current membership and the target. Removing or demoting the last active Owner
  is rejected, including concurrent requests. Changes take effect on subsequent
  requests; a stale UI never grants authority.
- Invitations target a trimmed, lower-case email address, expire after seven days,
  are revocable and single-use. At most 100 pending invitations exist per
  organization. Duplicate pending invitations and existing members are rejected.
  Expired invitations can be replaced. Acceptance never overwrites an existing role.
- Acceptance requires the current session's enabled user and a matching email
  explicitly verified by the configured OIDC issuer. Email remains profile data,
  never an account key. Each successful login refreshes that profile snapshot;
  missing verification is false. Existing accounts must sign in again to refresh it.
- Random 256-bit invitation secrets are returned only on creation; PostgreSQL
  stores SHA-256 verifiers, never readable secrets. The link carries the secret in
  its fragment, not the URL query. The join page clears that fragment immediately
  and exchanges it in a same-origin JSON POST for a ten-minute Secure, HttpOnly,
  SameSite=Lax `__Host-spectro-invitation` cookie. This cookie is a short-lived
  bearer continuation, not authentication or membership. Claiming grants nothing.
- Login accepts only the exact continuation path `/invite` or `/`; that path is
  bound to the single-use OIDC attempt. Arbitrary return URLs are rejected. A join
  screen bypasses workspace onboarding, previews only for the verified recipient,
  and requires an explicit session-bound, CSRF-protected POST to accept.
- Creation, revocation, acceptance, role changes, and removal are audited in the
  same transaction, using resource IDs and bounded old/new roles. Tokens, email
  addresses, provider responses, cookies, and private payloads are not audit data.
- Lists are bounded and cursor-paginated. Unknown organizations and nonmembers
  share a denied response; unavailable/replayed/revoked/expired links share an
  unavailable response. All control-plane responses are no-store.

## Consequences

This adds verified profile snapshots, invitations, role audit columns, and an OIDC
continuation path to PostgreSQL. It does not change event protocols, project-wide
access, storage topology, or SDK APIs. Sending email, invitation reminders,
project-specific membership, and organization deletion are separate follow-ups.
Acceptance and ownership concurrency require real PostgreSQL integration tests,
in addition to HTTP validation, CSRF, isolation, and failure-path tests.
