# @spectro/browser

Spectro's browser SDK captures errors, performance, network signals, session/page lifecycles, explicitly marked interactions, and custom events.

This is an alpha release. Pin the exact version while evaluating it:

```sh
npm install @spectro/browser@0.1.0-alpha.0
```

Initialize once in your browser application entry point (after the browser is available for SSR frameworks):

```ts
import { init, track, captureException } from '@spectro/browser';

init({
  projectId: 'YOUR_PROJECT_ID',
  environment: 'development',
  apiKey: 'YOUR_BROWSER_WRITE_KEY',
  endpoint: 'https://ingest-staging.spectrohq.com',
  release: 'my-app@0.1.0',
});

track('checkout_started', { source: 'cart' });
captureException(new Error('Example handled error'));
```

Create the browser write key in your Spectro project. Its project and environment must match the SDK options. Restrict allowed origins to your application's exact origin, including scheme and port. Browser write keys are visible to users and authorize event submission only. Never use an Auth0 secret or Console session as a write key.

`endpoint` is the ingestion origin, without `/v1/envelope`: the transport appends that path. The staging host above is for invited testing, not a general public ingestion service. If your Content Security Policy restricts `connect-src`, allow your ingestion origin.

Automatic error, performance, Fetch/XHR and lifecycle capture are enabled by default. Interaction capture only observes elements explicitly marked with `data-spectro-monitor-id`. Resource Timing capture is opt-in. Disable individual plugins using `errors: false`, `performance: false`, `network: false`, `lifecycle: false`, or `interactions: false`.

```html
<button data-spectro-monitor-id="checkout.submit">Place order</button>
```

The SDK excludes passwords, input values, authorization, cookies, request/response bodies, and element text by default. Sensitive property keys are filtered recursively, but custom properties still require review: avoid putting personal or sensitive content in arbitrary fields.

Routine events flush every five seconds, while high-priority failures use a short coalescing window. Page exit delivery is best-effort. A bounded IndexedDB outbox retries urgent events after reload/reconnect; set `persistence: false` to disable it. Delivery is at least once across ambiguous failures. `flush()` requests delivery, and `destroy()` removes instrumentation without implicitly flushing.

Capture methods degrade safely and report through an optional `onError` callback. Do not log sensitive application data in that callback. Alpha support targets modern browsers with Fetch and ESM; legacy browsers and a script-tag/CDN build are not provided in this release.

## License

MIT. See LICENSE. Other directories of the Spectro platform repository have separate licensing status.
