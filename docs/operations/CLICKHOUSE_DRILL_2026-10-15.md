# ClickHouse logical restore drill: 2026-10-15

Encrypted export: `clickhouse-20261015T092532Z-t5jIp9`.
Initial local report: `restore-drill-1J6yTZ`.
Container: `spectro-ch-restore-drill-1J6yTZ`, ClickHouse 26.3.33.24.

The first script stopped with `Export/restore row count mismatch`. That failed
run's report remains incomplete; it was not retroactively rewritten as success.
Investigation used the already-restored isolated container, not the live service.

- Native export: 521 physical rows, 514 distinct event IDs.
- Export contains different processing versions, not simply identical rows.
- Restored `FINAL` query: 514 rows.
- Source reference selects latest `processed_at_ms` per actual ReplacingMergeTree
  sorting key: project, environment, event date, type, name, ID.
- Selected export and restored FINAL each have 514 logical rows. Canonical JSON
  tuples of every exported stored column, sorted by row, match byte-for-byte.
- SHA256 on both sides:
  `e8b4d2bcb5a1e3cb7fb81040cb27b51500b1b1a7a2006776fa61af361562140a`.
- Same-key/same-version ambiguity guard is part of the corrected script; it
  refuses to invent a winner when tied versions have different stored contents.

The original physical-row equality criterion was incorrect for a replacing
engine: replacement/merging can change physical cardinality without losing
logical latest events. The comparison does not establish exactly when the
replacement occurred in the original run. Recovery verification now compares
logical version-selected content, while recording physical cardinality separately.

Isolation can produce hostname-resolution warnings even when commands succeed;
the corrected script supplies a loopback hostname for new containers. This does
not justify weakening network isolation.

Result: supplemental investigation verified logical stored-event content against
this exported file. Source-cutoff completeness, materialized-column equivalence,
accounts/grants, cross-service consistency, historical physical versions and full
disaster recovery remain unverified. No encrypted backup or volume was deleted;
the isolated container was stopped after investigation. Its restored volume and
container scratch data contain plaintext event data and require protected custody
until explicit cleanup.
