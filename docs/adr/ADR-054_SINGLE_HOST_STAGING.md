# ADR-054: Single-host staging deployment

Status: accepted

Date: 2026-10-14

## Context

The first hosted acceptance environment uses a Hetzner CAX21 ARM64 host with 8 GB memory and 80 GB disk. The operator owns spectrohq.com and has configured Auth0 callbacks. A reproducible deployment must preserve ADR-050's same-origin Console session and infrastructure credential boundaries.

## Decision

Run independently built API, ingestion, processor, and static Console containers with PostgreSQL, ClickHouse, NATS JetStream, and Caddy using Docker Compose. This is an operator staging environment, not a self-hosted product distribution or a high-availability production topology. Only Caddy publishes host ports 80 and 443. Console and API share staging.spectrohq.com; ingestion uses ingest-staging.spectrohq.com. Database and broker ports remain private.

Build on the target architecture. Keep generated credentials in a mode-0600 ignored environment file and never copy that file into an image. PostgreSQL uses separate bootstrap, API/schema-owner, and read-only ingestion accounts. ClickHouse uses separate bootstrap, read-only API, and insert-only processor accounts. NATS uses separate admission and processor accounts with scoped subjects, including the provisioning requests required by the existing startup contract.

Persist databases, JetStream, and Caddy certificates in named volumes. Gate application startup on health checks and a ledger-backed migration job; grant ingestion access after migrations. Bound container logs and ClickHouse memory. Do not automatically delete data, change event retention, or migrate existing local acceptance data. Off-host database backups and a verified restore remain prerequisites for external testers.

## Alternatives considered

Managed databases reduce maintenance but add cost and credentials before measured demand. Kubernetes adds unnecessary operational work for this stage. A static hosting platform alone cannot run the current data pipeline. These options remain available when scaling evidence justifies them.

## Compatibility, migration, and rollback

No protocol or identity semantics change. ARM64 uses the same source and database schema. Initialize a fresh staging database using ordered migrations and bootstrap scoped credentials. Keep localhost Auth0 callbacks alongside staging. First deploy requires the operator to fill the OIDC secret and explicitly start services. Roll back application images while retaining volumes; schema changes require a compatibility review and backup before migration. Never use compose down --volumes for rollback. A single host remains a shared failure domain, and staging is not a production readiness claim.
