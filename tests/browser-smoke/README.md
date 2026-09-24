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
