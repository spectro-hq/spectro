# Write-before-ack local drill: 2026-10-15

Run: `pnpm --filter @spectro/processor... build`, then
`node tests/integration/local-ack-loss-drill.mjs`.

Successful result: ignored `.local/pipeline-ack-loss-217d0d53/result.json`.
Uses separate local NATS 2.14.6 and ClickHouse 26.3.33.24 containers, loopback-only
ports, a new synthetic project/event, and a randomly generated local-only test
credential. No real event contents or source credentials are copied. Resources
are stopped in finally and retained for explicit cleanup, not deleted.

## Actual boundaries and assertions

- Public protocol validator accepts the UUIDv7 synthetic envelope before publish.
- Actual JetStream admission sink/source and actual ProcessorWorker/EventProcessor
  use the actual ClickHouseProcessedEventWriter with acknowledged async inserts.
- Fault adapter suppresses only the first processor acknowledgement after a
  completed storage write. This models lost ack, not OS/process failure.
- First durable write is queried: one logical event and first processing version.
  The broker still reports one ack-pending envelope.
- The broker redelivers the same envelope identity to the normal worker. Two
  successful storage writes are observed, and consumer delivery sequence is 2.
  Stream sequence does not count deliveries and is not used as that assertion.
- A FINAL query after replay returns exactly one event with the second injected
  processing version. Checking that newer version prevents a false pass before
  replay has actually reached ClickHouse.
- After the real acknowledgement, broker stored messages and ack-pending are zero.

Result: PASS for this injected write-before-ack failure path. Duplicate physical
writes are allowed; the demonstrated guarantee is one latest logical event via
ReplacingMergeTree FINAL, not a globally exactly-once physical write guarantee.
The processing clock is injected with distinct increasing timestamps, not a
test of wall-clock collisions or regression. API/Issues aggregation, complete
cross-service backup checkpoints, real authentication and power-loss behavior
are outside this run.

Earlier attempts failed due to drill implementation errors: a UUIDv4 fixture was
rejected by the actual protocol, and a final assertion confused stream sequence
with consumer delivery sequence. Both failed attempts stopped their containers;
neither is represented as passing. The successful run used fresh containers.
