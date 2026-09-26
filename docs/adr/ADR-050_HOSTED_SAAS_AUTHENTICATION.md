# ADR-050: Hosted SaaS authentication and authorization

Status: accepted

Date: 2026-09-26

## Context

Spectro's first production release is an operator-hosted, multi-tenant SaaS. The Console currently uses a local bearer token stored in browser `sessionStorage`; the product API authorizes that token against one configured project. Ingestion currently accepts one configured write key for every project and environment. These adapters support local development but cannot isolate production organizations, identify people who change issue state, or confine a browser key to its intended telemetry stream.

ADR-041 already separates product authorization from ingestion admission. The event protocol requires project and environment context and keeps credentials outside events. This decision defines the production identity and permission model without changing that protocol or coupling the independently deployable API and ingestion services.

## Decision

### Console identity and sessions

- Spectro operates one managed OpenID Connect (OIDC) identity provider for the first SaaS release. The product API handles the Authorization Code login callback and validates the issuer, audience, state, nonce, and PKCE transaction through a maintained OIDC implementation. Provider configuration and the specific hosted vendor can change without changing Spectro user IDs or permission rules. Spectro does not operate its own password database in this release.
- Link an external identity to a Spectro user by the provider's stable `(issuer, subject)` pair. Email is profile and invitation data, not an account key; matching email addresses never silently merge accounts.
- The product API creates a random, opaque session credential after login and stores only its verifier in PostgreSQL, with expiration and revocation state. The browser receives it in a host-only `__Host-` cookie with `Secure`, `HttpOnly`, `SameSite=Lax`, and `Path=/`. The Console and product API share an HTTPS origin through routing; ingestion uses a separate host and never receives the Console cookie.
- The Console uses the session cookie for API requests. The local bearer-token field and its `sessionStorage` copy are removed from the production flow. OIDC provider tokens are not exposed to the SPA or used as the Console's product API credential.
- Logout revokes the server session. Expiration, account disablement, and session revocation are enforced server-side. State-changing API requests require a session-bound CSRF token and same-origin verification. No protected GET endpoint changes state.
- Production API startup requires the identity and session configuration. The static project-token adapter is restricted to explicit local/test mode and cannot be selected in production.

### Tenancy and authorization

- PostgreSQL is the control-plane source of truth for users, external identities, sessions, organizations, memberships, projects, and environments. A user can belong to multiple organizations. Every project belongs to one organization; every environment belongs to one project.
- Creating an organization gives its creator the Owner role. Other users gain access through an explicit invitation or membership change; neither email-domain matching nor a successful login grants organization access. Invite acceptance verifies the intended identity and a short-lived, single-use invitation.
- The initial roles are Owner, Admin, Member, and Viewer. Owner can transfer ownership and delete the organization; at least one Owner must remain. Admin can manage non-owner members, projects, environments, and ingestion keys. Member can read project data and change issue status. Viewer can read project data. Every role has only the permissions stated for its organization.
- V1 organization membership applies to all projects and environments in that organization. Private projects, environment-level grants, custom roles, and customer-managed federation are outside the first-release scope.
- On every protected request, the product API validates the session, resolves the target project and environment to its organization, and checks the action against current membership. Missing configuration or unavailable authorization state fails closed. Query parameters and event context cannot grant access. Issue lifecycle `actor_id` comes from the authenticated Spectro user, not request input.
- Authentication events, membership changes, and key creation, rotation, and revocation are auditable without storing raw credentials. Console users and the end users represented by event `context.user` and `context.session` are separate identities.

### Browser ingestion admission

- A browser SDK write key grants only event admission for one project and one environment. The product API manages key creation, display, rotation, and revocation under Admin or Owner permission. Multiple keys can overlap during a bounded rotation window. Raw key material is displayed once and only a verifier is retained in the control plane.
- Ingestion resolves a supplied key through a read-only authorization boundary. For every event in an envelope, the authenticated project's ID and environment must equal `event.context.project.id` and `event.context.environment`. Any mismatch rejects the entire envelope before JetStream admission. A missing, revoked, or expired key cannot admit events; an unavailable key lookup does not fail open.
- Browser keys are visible in customer JavaScript and network requests. They are admission scopes, not proof that a request came from an authentic browser or a particular person. Origin restrictions, per-key and per-project quotas, and abuse monitoring limit exposure but do not confer read or administrative permission.
- Write keys travel only in transport headers. Neither keys nor Console sessions enter event payloads, JetStream messages, ClickHouse rows, or ordinary logs. The SDK's privacy and bounded-delivery rules continue to apply.

### Service boundaries

- Product API, ingestion, and processor use separate infrastructure credentials with only the database and JetStream permissions each needs. Ingestion cannot use a Console session or a browser key to query product data.
- Future server-to-server product API access requires its own scoped machine credentials and decision. Browser write keys and human sessions are not reused for that purpose.

## Alternatives considered

### Keep the static bearer adapter in production

Rejected because one token and one project do not represent users, memberships, revocation, or organization boundaries.

### Use ingestion keys for Console access

Rejected in ADR-041 because public browser write admission must not authorize data queries or administrative actions.

### Keep provider access tokens in browser storage

Rejected because the SPA does not need them for same-origin API calls and browser-readable storage increases the impact of script compromise. Revocable server sessions also let Spectro enforce membership changes independently of provider token lifetime.

### Build password and account-recovery flows in the product API

Rejected for the hosted SaaS launch because a managed identity provider can own credential verification and recovery while Spectro owns its distinct organization authorization rules.

### Add project-level ACLs immediately

Deferred because the initial organization-wide model covers the confirmed team workflow with fewer permission combinations. A need for private projects requires a separate decision before changing this boundary.

## Compatibility and consequences

- Event JSON Schema, SDK public capture APIs, and the `/v1/envelope` transport shape remain unchanged. The existing `X-Spectro-Key` header becomes project- and environment-scoped in production.
- Product API route paths and query contracts remain, but authentication changes from local `Authorization: Bearer` to a server session cookie. The authorizer port must return a user principal and evaluate an action, rather than only a project boolean.
- The Console's local-token UI and request headers must migrate to session-aware API requests. The SDK's own tab session is telemetry context and is unaffected by the Console login session.
- PostgreSQL gains additive tables and migrations for identity, tenancy, sessions, invitations, keys, and audit records. Key lookup availability becomes part of ingestion admission health.
- The first hosted deployment must choose and configure a managed OIDC issuer and login methods that fit its users. Vendor selection is an operational choice, not a different authorization model.

## Migration and rollback

1. Add control-plane migrations and tested repositories for identity, memberships, sessions, project/environment ownership, invitations, and key verifiers.
2. Add the OIDC callback, server sessions, CSRF protection, and action-aware product API authorization. Migrate the Console to those endpoints and bind issue history to the authenticated actor.
3. Add scoped write-key management and ingestion lookup. Verify cross-organization denial, read-only roles, session removal, key scope mismatch, rotation, revocation, and lookup failure across the real API and ingestion boundaries.
4. Keep local adapters available only in explicit development/test mode. Production rollout requires both auth paths before serving customer traffic. If rollout is reversed, disable protected production access and admission rather than accepting the old shared credentials.

## References

- [ADR-009, ADR-010, ADR-016, and ADR-017](./SPECTRO_ADR_V1.md)
- [ADR-041: Event query API V1](./ADR-041_EVENT_QUERY_API_V1.md)
- [OAuth 2.0 Security Best Current Practice](https://www.rfc-editor.org/rfc/rfc9700.html)
- [OpenID Connect Core](https://openid.net/specs/openid-connect-core-1_0.html)
- [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
- [OWASP Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html)
- [OWASP Cross-Site Request Forgery Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)
