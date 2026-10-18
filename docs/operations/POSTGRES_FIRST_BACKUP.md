# First encrypted PostgreSQL transfer to the operator Mac

This is the first part of the [restore plan](./STAGING_BACKUP_RESTORE_PLAN.md),
not a complete Spectro backup. It does not pause services or change their data.
`pg_dump` obtains a consistent PostgreSQL snapshot; it does not coordinate with
ClickHouse or JetStream. Cluster-global roles, deployment secrets and certificates
remain separate recovery requirements.

## Operator action

Install age from Homebrew if absent, then run from an interactive Mac terminal:

```sh
brew install age
bash /Users/roshan/Projects/spectro-hq/spectro/scripts/staging-postgres-backup.sh /Users/roshan/Documents/SpectroBackups
```

Use a long unique random passphrase, saved in the macOS Passwords app. If age
offers automatic generation when leaving the prompt empty, do not do that in
an agent-controlled or recorded terminal; generated secrets may be printed.
Never enter the passphrase in chat, command arguments, environment variables,
shell history or a recorded terminal. Do not enable shell tracing. Keep an
independent offline recovery copy of the passphrase. The backup directory and
its encrypted content must remain outside the repository and public hosting.

The script verifies dependencies before contacting the server, creates a unique
owner-only output directory, streams custom-format pg_dump over SSH directly
into age encryption and hashes the ciphertext. Failure preserves a marked
incomplete directory for operator inspection; it never deletes backups or
overwrites a previous run. `SUCCESS` proves only encrypted transfer completion,
not decryption or restore. SHA256 detects accidental ciphertext changes, not
the completeness of the database snapshot.

## Next step (not yet executed)

After success, the operator decrypts in their own terminal into an isolated,
owner-only drill workspace. Restore using PostgreSQL 18 in OrbStack with new
volumes, no published port and no connection to staging services. Inspect the
archive and restore errors; compare migrations, table counts, relations and
reference control-plane records. Recreating grants/roles and restoring remaining
services are required before claiming complete disaster recovery. Never paste
dump contents, password hashes or user records into chat.

References: [PostgreSQL pg_dump](https://www.postgresql.org/docs/18/app-pgdump.html),
[age passphrase encryption](https://github.com/FiloSottile/age#usage).
