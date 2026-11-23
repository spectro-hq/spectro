# Isolated application recovery acceptance: 2026-10-24

PR #5 was verified merged as `6141e57d71d284c87096c29e751cc17555a4eb54`.
An ARM64 runtime image was built from that clean source revision, without mounting
backup data or credentials during build. No live server was accessed or changed.

## Isolation and entry points

- Source: the verified stopped component set recorded in
  `COORDINATED_RESTORE_2026-10-24.md`, report `checkpoint-restore-75a3b5b7`.
- Each database/broker data volume was cold-copied into a new labeled volume.
  Source data mounts were read-only; original components remained stopped.
- A new Docker network has `Internal=true`; no host ports were published.
- Private recovered configuration was mounted read-only. Only database/broker
  passwords were consumed; archived Compose and external Auth0 config were not
  launched. The harness runs as root only inside a read-only, capability-dropped
  disposable application container to read owner-only recovery configuration.
  This is not a production container privilege recommendation.
- API/ingestion use the existing public app factories and listen on loopback
  inside the container. Calls use real HTTP, not Fastify inject.
- Hosted authentication middleware and PostgreSQL sessions remain real. Only the
  external identity adapter is replaced by a test adapter that refuses calls;
  a synthetic session and admin membership are created in the cloned database.
- The worker is an independent `services/processor/dist/server.js` process using
  recovered NATS/ClickHouse processor credentials. No in-memory event store or
  injected processor substitutes for the durable pipeline.

## Successful result

Ignored report: `.local/application-recovery-43049efa/result.json`.
Inventory: adjacent `resources.json` in this isolated worktree.
The observed clone/start/probe/stop interval was 11.6 seconds. This excludes
decryption, image building and external recovery; it is not full RTO.

1. Existing ClickHouse logical baseline is 770 events. A scoped key is created
   through the restored API for an existing restored project/environment.
2. HTTP ingestion accepts three synthetic events in one envelope: two identical
   errors and one custom signal, with a unique synthetic session.
3. Before the worker starts, NATS has one stored/pending envelope and no ack
   pending; ClickHouse remains at 770. This observes durable admission separately
   from processing, rather than polling only after everything has finished.
4. Actual processor startup consumes the envelope. API HTTP query returns the
   exact three UUIDv7 event IDs, and ClickHouse total is 773.
5. Both errors have the same server-computed fingerprint; Issues returns one
   group with two occurrences.
6. Anonymous event query returns 401. Wrong browser origin returns 403. Key
   deletion returns 204, followed by rejection of the revoked key with 401.
7. Final stored/ack-pending counts are zero, and acknowledged stream sequence
   advances from 289 to 290 (one envelope, not three delivery positions).
8. Internal networking/no published ports verified independently from container
   settings. All new containers stopped. Source set and encrypted checkpoint
   retained unchanged; sensitive clone volumes/network retained for explicit cleanup.

## Failed attempts and corrections

Reports `ab296725`, `bea3eda0` and `4e678361` remained FAIL. The initial phase
label was too broad: key creation had succeeded, but direct protocol preflight
rejected a synthetic fixture that reused object references across events.
Independent context objects corrected the fixture; the protocol was not changed.

Run `6ff2a52b` reached processing, event query and issue aggregation but failed
key deletion: the test sent JSON Content-Type with an empty DELETE body and
received `FST_ERR_CTP_EMPTY_JSON_BODY`. Removing the inappropriate header fixed
the HTTP fixture, not the API. Final PASS used new clones; failed containers
were stopped and their reports were not rewritten as success.

## Reproduction

Build the clean runtime image using `infra/staging/Dockerfile --target runtime`
as `spectro-app-recovery:6141e57`, then run:

```sh
node scripts/application-recovery-local-drill.mjs /absolute/path/to/checkpoint-restore-75a3b5b7/resources.json
```

The orchestrator requires a prior PASS report, stopped labeled components, cold
source volumes and local OrbStack. It mounts the adjacent HTTP probe read-only
into the image. Command output is captured without publishing private responses.
This bounded probe expects this checkpoint's 770-event baseline, not arbitrary
backups. Four guard tests cover path/endpoint rejection and isolation constraints.

## Remaining limits

PASS for recovered application data flow through scoped HTTP admission, durable
queue, independent worker, persistence, API events/Issues query and selected
authorization/revocation checks. Not full public-service disaster recovery:

- No real OIDC browser login, production API/ingestion CLI auth bootstrap,
  certificate reissuance, public DNS or Console browser startup.
- No new nonempty broker crash/cold restore test. Earlier synthetic broker and
  write-before-ack tests remain separate evidence.
- No complete external-service RPO/RTO or automated off-host backup policy.
- No cleanup was authorized or performed. Keep encrypted checkpoints and private
  identity independently; review exact plaintext directories and volumes before deletion.
