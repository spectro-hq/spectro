# ADR-044: Issue lifecycle history and ordered PostgreSQL migrations

Status: accepted

Date: 2026-09-15

Supersedes the no-history and one-off initialization portions of ADR-043.

## Context

ADR-043 introduced current issue lifecycle state in PostgreSQL. Operators need an audit trail for status transitions, and existing databases need the same schema evolution path as newly created local environments.

## Decision

- Record a history row transactionally whenever an issue lifecycle status actually changes. Idempotent writes do not create duplicate history.
- Keep history append-only and query it by project, environment, and fingerprint in reverse chronological order with a bounded limit.
- Allow a nullable actor identifier until production identity is integrated; do not infer an actor from the bearer credential.
- Apply numbered SQL migrations in lexical order and record successful migrations in `control_plane_migrations`.
- Mount the same migration directory into fresh local PostgreSQL containers and run the migration command before integration tests.
- Filter by lifecycle status in the product API after joining ClickHouse-derived issues with PostgreSQL state. Preserve pagination with a cursor for the last examined ClickHouse issue.

## Consequences

Lifecycle transitions are inspectable without changing immutable event facts. The product API remains responsible for the cross-store join, and status-filtered pages may scan multiple bounded ClickHouse pages. Migration SQL becomes the single schema source for both fresh and existing databases.

## Alternatives

- Database triggers were rejected because transition semantics and actor context belong at the application boundary.
- Recording every idempotent write was rejected because it creates noise without representing a state transition.
- A general migration framework was rejected because ordered SQL plus a ledger is sufficient at the current scale.
- Treating the bearer token as an actor was rejected because it may be an API credential rather than a user identity.

## Compatibility impact

Current lifecycle reads and writes remain compatible. The history endpoint and status filter are additive. Deployments must run migrations before serving code that writes or reads history.

## Migration and rollback

Apply migrations with `pnpm --filter @spectro/api migrate`. Rollback disables the history endpoint and history insertion before dropping `issue_lifecycle_history`; current lifecycle state remains intact. The migration ledger should not be manually rewritten.
