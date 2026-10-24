# Quiesced staging checkpoint: 2026-10-18

Operator approved a brief maintenance window. The server is a source-archive
deployment at `/opt/spectro-staging`, not a Git checkout; do not use `git pull`
there or overwrite its server-only `.env`.

## Procedure and observed result

`scripts/staging-checkpoint-remote.sh` was run under a 120-second timeout with a
40-second kill grace and an independent systemd resume timer at 180 seconds.
Mocks exercise successful export and export failure, checking watchdog ordering,
resume invocation and incomplete-status preservation. They do not simulate a
power failure, actual systemd timeout or every possible service-start failure.

- Web, API and ingestion were stopped; processor drained existing accepted work.
- Status asserted zero stored messages/bytes, pending, ack-pending and lost bytes,
  and matching delivered/acknowledged sequence 289 before stopping processor/NATS.
- PostgreSQL custom dump and global roles, ClickHouse actual DDL and explicit
  stored columns in Native format, stopped NATS `/data`, and deployment
  configuration were exported to an owner-only directory. Configuration/global
  role archives contain credentials and must never be published or pasted.
- NATS snapshot API permissions were not broadened. Its archive was taken cold,
  not from changing live storage; this cold restore remains unverified.
- EXIT cleanup started services and cancelled the independent recovery timer.
  Compose also reran its existing migration/grant dependency jobs during start.
- Independent checks after resume: application/database containers running,
  API/ingestion healthy, processor `ok`, zero queue backlog and acknowledged
  sequence 289. Both public HTTPS health endpoints returned `status: ok`.

Server export: `/opt/spectro-checkpoints/checkpoint-20261018T052707Z-67a3b19c`.
Encrypted Mac destination:
`/Users/roshan/Documents/SpectroBackups/checkpoint-20261018T052707Z-aQpYBb`.
Archive streams over SSH into age recipient encryption, with no plaintext Mac
archive. Ciphertext SHA256 verification passed. Private identity stays encrypted
on the operator Mac, with operator-controlled passphrase custody.

## Remaining verification and custody

Operator subsequently reported successful identity decryption and full archive
listing through a pipe, without a plaintext Mac archive. This establishes key
usability and readable archive structure, not database restore correctness.
Isolated coordinated restore remains pending. Do not claim a demonstrated
disaster-recovery RPO/RTO, complete source
identity, restored credentials or full application acceptance from this export.
Certificates and external Auth0 configuration are excluded. The server's protected
plaintext export is retained pending verification and explicit cleanup; the old
database volumes and application images have not been deleted. No new application
images have been deployed in this maintenance step.
