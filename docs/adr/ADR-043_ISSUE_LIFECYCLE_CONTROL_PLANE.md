# ADR-043: Issue lifecycle state in PostgreSQL

Status: accepted

## Context

ADR-042 derives error groups from ClickHouse event data. Operators now need a small durable workflow state without mutating event-plane facts or pretending that a time-window aggregate is itself a stored entity.

## Decision

- Store one lifecycle record per `(project_id, environment, fingerprint)` in PostgreSQL.
- Lifecycle status is `open`, `resolved`, or `ignored`; absence of a row means `open`.
- Update through an authorized idempotent API operation. The server owns `updated_at`.
- Join lifecycle state onto ClickHouse issue aggregates in the product API, not through cross-database SQL.
- Do not add assignment, comments, history, severity, or notifications in this slice.

## Consequences

ClickHouse remains the source of occurrence counts and evidence. A missing lifecycle row means `open`; a configured but unavailable control plane fails the query rather than misrepresenting a previously resolved issue as open.

## Alternatives

- Writing status into ClickHouse was rejected because workflow state is transactional control-plane data.
- Encoding status in event tags was rejected because events are immutable evidence and clients must not own server workflow state.
- Adding a general ORM was rejected because one table and one injected port do not justify another abstraction layer.

## Migration and rollback

The migration creates an additive `issue_lifecycle` table. Rollback disables the mutation route and drops the table; issue aggregation continues with every issue interpreted as open.
