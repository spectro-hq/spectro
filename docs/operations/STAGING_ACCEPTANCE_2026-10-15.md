# Staging acceptance: 2026-10-15

Scope: `roshanca.com` with `@spectro/browser@0.1.0-alpha.0`, sending to
`ingest-staging.spectrohq.com`; inspected through the operator's local Chrome
and authenticated staging Console. This is a bounded acceptance record, not
production certification. No real passwords or private user payloads were used.

## Observed results

| Area                 | Evidence                                                                                                                                                                                                                                                                                    | Result and limits                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Page/session         | Homepage, article navigation and refresh produced distinct page IDs with the same session ID; matching ClickHouse-backed Console timeline                                                                                                                                                   | Passed for this navigation sequence, not all browser lifecycle cases                                         |
| Real error stack     | `SPECTRO_STACK_ACCEPTANCE_001`: same-origin `spectro-error-probe.js`, `spectroProbeLeaf` at 10:11, `spectroProbeEntry` at 14:5                                                                                                                                                              | Stack retained in queried event payload                                                                      |
| Error grouping       | Three explicit clicks yielded one issue, three occurrences, one session; fingerprint `84336c697d25f5cd5fff17a07f0b53c3`                                                                                                                                                                     | Passed for identical named call chain                                                                        |
| Reconnect            | `SPECTRO_OFFLINE_ACCEPTANCE_001`; request failed with `ERR_INTERNET_DISCONNECTED`, then event `01a13e6a-9315-7187-97c8-114329801ecb` was resent with HTTP 202 and appeared once in Issues                                                                                                   | Passed for temporary tab-level offline simulation                                                            |
| Reload recovery      | Ingestion URL blocked while the site remained available; `SPECTRO_RELOAD_RECOVERY_001` persisted in IndexedDB; after reload the same ID `01a13e75-8ed8-70b6-8771-feb2690273db` was retried; after unblock it received 202 and appeared once in Issues; local queued record absent afterward | Passed for endpoint failure across document reload; not browser crash, storage eviction or unlimited retries |
| Network privacy      | A real browser Fetch used synthetic query, fragment and header markers; captured `fetch_request` ID `01a13e6e-e0a9-71e6-90d6-41d1723e6a10` retained the clean path and status, omitted all three markers; envelope returned 202                                                             | Passed at the browser outbound boundary; not a full privacy audit                                            |
| Custom-field privacy | Installed npm alpha artifacts, injected Fetch transport: synthetic password, cookie, authorization, request-body and nested values absent; safe controls retained; write key only in transport header                                                                                       | Local artifact boundary test, not a live custom-event ingestion test                                         |
| SDK regression       | Core 11 tests and browser 59 tests passed                                                                                                                                                                                                                                                   | Automated suite evidence, separate from live browser checks                                                  |
| Fixture cleanup      | Blog PR #4 introduced opt-in fixture; follow-up branch `codex/remove-stack-probe`, commit `08bc922`, removed it; deployed `/spectro-test/` returned 404                                                                                                                                     | Test records intentionally retained; cleanup is Git-recoverable                                              |

Chrome Console-injected errors can use VM/anonymous locations excluded by the
SDK source URL filter. That test did not establish missing real-file stacks.
The real-file test above did. Arbitrary free-text error messages and custom
values are not guaranteed PII-free: customers must still avoid sensitive data.

## Remaining gates

- Encrypted off-host backups and an isolated, verified restore (ADR-054).
- Failure-mode coverage beyond the bounded checks above: long outages, retry
  exhaustion, browser crash, storage denial/eviction, quota and scope changes.
- Hosted authorization/revocation regression and release-specific acceptance
  must be tracked independently; these checks do not establish those results.
- Route navigation loading is tracked separately in Spectro issue #1; this
  acceptance work does not modify that implementation.
- SDK alpha publication is usable, but npm dist-tag cleanup was not completed
  in the publication session; do not describe it as a stable release.

## Next operation

Follow [backup and restore preparation](./STAGING_BACKUP_RESTORE_PLAN.md).
Do not restore over the live volumes or treat a VPS snapshot as proof of
application-consistent recovery.
