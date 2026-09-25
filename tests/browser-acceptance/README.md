# Browser-to-console acceptance

This local-only harness exercises a real browser, ingestion, JetStream,
processor, ClickHouse, query API, and the React Console. It uses the isolated
project `prj_browser_acceptance` and environment `acceptance`.

With local infrastructure, ingestion, and the processor running, start a
separate local API and Console so the existing development session on 5174 is
untouched:

```sh
SPECTRO_API_PORT=4410 SPECTRO_API_HOST=127.0.0.1 \
  SPECTRO_API_LOCAL_PROJECT_ID=prj_browser_acceptance \
  SPECTRO_API_LOCAL_TOKEN=sp_acceptance_local pnpm --filter @spectro/api start

SPECTRO_WEB_PORT=5189 SPECTRO_WEB_API_TARGET=http://127.0.0.1:4410 \
  pnpm --filter @spectro/web exec vite --host 127.0.0.1

pnpm --filter @spectro/web exec vite ../../tests/browser-acceptance \
  --config vite.acceptance.config.ts --host 127.0.0.1 --port 5188 --strictPort
```

Open `http://127.0.0.1:5188/?mode=ack-loss`, capture the runtime error, and
confirm `lostAcknowledgement: true` and `persistedUrgentEvents: 1`. The first
request was accepted by real ingestion before its response was discarded by
the harness. Reload with the transport restored. The same error ID should be
retried from native IndexedDB, with `persistedUrgentEvents: 0` afterward.

On the live page, capture a failed request and monitored interaction, then
flush all signals. Navigation Timing supplies a performance event. Open
`http://127.0.0.1:5189/?project=prj_browser_acceptance&environment=acceptance&range=30m&source=live`,
select **Connect API**, and enter the local token `sp_acceptance_local`. Check
the Events list for error, network, interaction, and performance events, and
open the session timeline. The Issues page should show one occurrence of the
runtime error despite the retry.

Stop only the temporary API, Console, and harness processes after the run.
