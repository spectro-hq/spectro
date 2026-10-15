# PostgreSQL first restore drill: 2026-10-15

Scope: PostgreSQL only. Not complete disaster recovery.

- Operator encrypted backup: `postgres-20261015T074102Z-xls1F6`.
- Operator restore report: `restore-drill-QCnpUW`; reported decryption and
  transactional restore success. Restore stderr was empty.
- Local PostgreSQL 18.6 container: `spectro-pg-restore-drill-QCnpUW`.
- Ciphertext checksum verified by restore script. No plaintext host dump;
  restored database volume contains sensitive plaintext data and is retained.
- Container stopped after verification; network `none`, no published ports.

## Read-only comparison

The source was queried after the backup, not at its snapshot cutoff. Therefore
matching aggregates are supporting evidence only, not a proof of row equality.
No password hashes, credentials or user records were selected for the report.

- All seven migration names match.
- Public column metadata signature matches: `c9e4639751367c41eadf05ac459eb1a0`.
- Organizations, projects, environments, memberships, users and write-key row
  counts each equal one in both databases at comparison time.
- Project-to-organization, membership-to-user and key-to-environment orphan
  counts are zero on both sides.
- Both databases expose 129 constraints. Nine CHECK definitions differ in
  deparsed varchar-array versus element-level text casts. Allowed literals match;
  this appears representationally equivalent, but behavioral constraint testing
  was not performed. Other constraint definition lines match. Raw metadata MD5
  is a comparison aid, not a cryptographic backup integrity claim.

## Permissions: isolated authorization verified; login recovery incomplete

Source roles `spectro_api` and `spectro_ingest` exist without superuser,
create-database or create-role privileges. Source table grants show ingestion
has SELECT only on `project_write_keys`; API owns application tables.

Initially the restored database had neither application role: pg_dump did not include
cluster-global roles, and the drill used `--no-owner --no-acl`. All restored
tables were owned by the drill administrator before the permission exercise.

After operator authorization, `scripts/staging-postgres-permissions-drill.sql`
recreated NOLOGIN test roles, transferred public-table and schema ownership to
the API role, and applied database/schema/table grants and ingestion read-only
defaults. Actual SET ROLE execution confirmed key reads and denied user,
session, organization and project reads, key UPDATE/DELETE, and schema CREATE.
API project reads, no-op UPDATEs and schema CREATE succeeded inside a rolled-back
transaction. INSERT privilege was also false for ingestion. No test tables
remained. Role metadata confirmed no login, superuser, create-database,
create-role, replication or bypass-RLS flags; the read-only default was checked
as configuration, not demonstrated through a real role login.

The exact drill container was stopped afterward. No source grants, credentials
or data changed. This establishes tested local authorization semantics only,
not password rotation, connection authentication, Auth0, application startup or
complete recovery. Do not connect live services to this clone.

Still required: exact source-cutoff baselines in future backup manifests,
credential/login recovery, protected configuration/secrets, ClickHouse and JetStream
backup and coordinated replay, full application validation, off-host schedule
and retention, and explicit cleanup of the local sensitive drill volume.
