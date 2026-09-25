# Browser outbox smoke test

Run the harness with Vite from the repository root:

```sh
pnpm --filter @spectro/web exec vite ../../tests/browser-smoke --config vite.smoke.config.ts --host 127.0.0.1 --port 5188 --strictPort
```

Open `http://127.0.0.1:5188/?mode=offline` in a browser, capture and flush an
unhandled runtime error, then use “Switch online + reload”. The reload keeps
the browser's IndexedDB intact; the harness changes only its injected Fetch
response to simulate the offline-to-online transition. On the online page,
`persistedAfterStartupRetry: 0` plus a populated `automaticallyRetriedEnvelope`
means the SDK restored, sent, and removed the queued error.

This verifies browser IndexedDB persistence and page-reload behavior, but does
not emulate the browser's native offline/network controls.

## Backend recovery integration

With the local services running (`pnpm infra:up`), run `pnpm test:integration`
from the repository root. The pipeline test also initializes the public browser
SDK and sends an unhandled manual error over HTTP to ingestion, through real
JetStream and the processor into ClickHouse.

The test discards the first successful admission response to simulate a lost
acknowledgement, destroys the SDK, and restores the persisted error in a new
SDK instance. It waits for both deliveries to be processed, checks that the
event identity and context survive the retry, and verifies one event and one
issue occurrence through the query API. Each run uses a unique project.

This integration test uses `fake-indexeddb` for storage and Fastify injection
for query API requests. The browser harness above separately verifies native
IndexedDB across an actual page reload; a full browser-to-console acceptance
run remains a separate check.
