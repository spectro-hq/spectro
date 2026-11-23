# Spectro landing page: English copy and structure

Status: shipped copy deck for the **The page is a session** redesign at `/landing/`. All product examples use sample data. No customer, adoption, pricing, benchmark, or integration-time claims are made.

Every major section carries a spine marker labeled in machine register: `runtime_error`, `context`, `issue`, `web_vital_lcp` + `fetch_request`, `init()`, `privacy`, `faq`, `early_access`.

## Navigation

Spectro logo and wordmark. Product → `#product`; SDK → `#developers`; Privacy → `#privacy`; Console → `/` (existing users).

## Hero

**Headline:** Follow the error

**Category:** Frontend observability with shared context.

**Supporting copy:** Investigate browser errors alongside requests, performance and custom events, with shared session, page and release context.

**Primary CTA:** Request early access

**Secondary text link:** Explore the product → `#product`

**Application note:** Opens a public GitHub issue. A GitHub account is required.

**Product demonstration:** Checkout session · Sample data. Context bands: session `ses_8f3e2c`; page `/checkout · page_checkout`; release `web@1.4.2`. Timeline axis −60 s → 0 s. Events: `element_click` (Interaction, −45 s), `fetch_request` (Network, −28 s), `runtime_error` (Error, −12 s; initially selected).

- Click detail: A deliberate interaction. A click on the explicitly marked checkout button. Monitor ID: `submit-order`. Target: `button`.
- Request detail: A completed request. `POST shop.example/api/payments`. Response: `200`. Duration: `418.2 ms`.
- Error detail: `TypeError`. Cannot read properties of undefined (reading 'id'). Source: `/checkout:412`. Handled: No.
- Persistent context: the session, page and release bands stay in view for every selection.

**Demo caption:** Select an event — this example sends no telemetry.

**Evidence note:** The request returned 200. These events share context; their order does not establish a cause.

## Investigation

**Headline:** Keep the context

**Body:** Select an error. Inspect its page and release, then open its session to explore the events captured there.

**Workflow:** Select the error → Read its context → Follow the session.

**Workflow descriptions:** Start with the error message and source. Keep the session, page and release in view. Inspect other captured events in the same session.

**Capture caption:** The event explorer, with a selected checkout error and its context. A "Sample data" capsule is right-aligned at the end of the caption row.

Proof: existing real event-explorer capture; focused context crop on phones. The hero's native radio controls let visitors inspect different events without a login or live ingestion.

## Error groups

**Headline:** Investigate recurring errors

**Body:** See occurrences and affected sessions for each error group. Open the matching events to investigate individual reports.

**Supporting copy:** Track open, resolved and ignored issues as your team investigates.

**Capture caption:** 28 occurrences, 17 affected sessions and an entry to matching events. View full-size capture. A "Sample data" capsule is right-aligned at the end of the caption row.

Proof: existing real issue detail, preserving the illustrative fixture's values and investigation control.

## Performance

**Headline:** Inspect page performance

**Body:** Read Web Vitals by page. Compare percentiles and rating distributions, then open the contributing events with their context.

**Capture caption:** Checkout LCP with percentiles and rating distribution. View full-size capture. A "Sample data" capsule is right-aligned at the end of the caption row.

Proof: existing real performance detail; no synthetic score, benchmark, or unsupported diagnostic promise.

## Requests

**Headline:** Inspect the request

**Body:** Compare request duration, failures and response status by target and page. Move from a request group to individual network events.

**Supporting copy:** Timing and status help you investigate. Request and response bodies are excluded by default.

**Capture caption:** Request timing, failures and response status. View full-size capture. A "Sample data" capsule is right-aligned at the end of the caption row.

Proof: existing real network detail. No claim that a successful neighboring request caused an error.

## SDK setup

**Headline:** Connect your browser app

**Body:** Initialize the browser SDK with your project and environment. Errors, Web Vitals, requests and page lifecycles share the same event context.

**Second paragraph:** Add your own product events with `track()`. Inspect them in the same event explorer.

**Third paragraph:** Working with a coding agent? The brief gives it everything it needs — install, init, and instrumentation in one pass.

**Guide link:** Read the SDK guide

**Agent path — "Hand it to your coding agent":**

> Integrate the Spectro browser SDK into this app.
>
> Install @spectro/browser@0.1.0-alpha.0, call init() once at startup with our projectId, environment, browser write key, ingestion origin (no /v1/envelope — the SDK appends it) and release, then instrument the key product actions with track(). Follow the SDK guide for the API: https://github.com/spectro-hq/spectro/blob/main/packages/browser/README.md

**Agent note:** Paste it into Claude Code, Cursor, Codex or any agent that can edit your repo. It performs the same steps below with your real project settings.

**Divider:** or integrate by hand

**Install:**

```sh
npm install @spectro/browser@0.1.0-alpha.0
```

**Browser setup:**

```ts
import { init, track } from '@spectro/browser';

init({
  projectId: 'YOUR_PROJECT_ID',
  environment: 'production',
  apiKey: 'YOUR_BROWSER_WRITE_KEY',
  endpoint: 'https://YOUR_INGESTION_ORIGIN',
  release: 'YOUR_APP_RELEASE',
});

track('checkout_started', {
  source: 'cart',
});
```

**Setup note:** The SDK is in alpha. Replace the example values with your project settings. Use the ingestion origin without `/v1/envelope`; the SDK appends that path. Restrict your browser write key to your app's allowed origins.

**Controls:** "Copy" on the agent brief and each manual step (aria-labels: "Copy the coding agent brief", "Copy install command", "Copy setup code"). Success shows a transient ✓ beside the button; the live-region text ("Agent brief copied. Paste it into your coding agent." / "Install command copied." / "Code copied. Replace the example values with your project settings.") stays assistive-tech-only. Failure shows the visible message: Copy is unavailable — select the code above and copy it manually.

## Privacy

**Headline:** Capture with care

**Body:** By default, the browser SDK excludes passwords, input values, cookies, authorization headers, request and response bodies, and element text. It does not capture DOM snapshots or screen recordings.

**Second paragraph:** Interaction capture observes only explicitly marked elements. Review custom event properties before sending them; filtering is not a substitute for deciding what your app should collect.

No compliance certification, blanket safety, or platform-wide MIT licensing claim.

## Questions

**Headline:** Before you begin

**What can I investigate today?** Browser errors, performance, network activity and sessions, plus custom events. Release views and the shared event explorer connect these signals to captured evidence.

**Does Spectro record the screen?** No. Spectro captures structured events and their context. Session timelines show those events; they do not record screens or take DOM snapshots.

**Is the browser SDK open source?** Yes. The browser, core, types and protocol packages are MIT-licensed and currently in alpha. The hosted platform's license is separate and has not been finalized. Link: Explore the SDK source.

**How does early access work?** Submit a public request on GitHub with your frontend stack and what you want to investigate. Do not include credentials, private project details or customer data. The team can follow up in that issue; a request is not a confirmed invitation.

## Early access

**Headline:** Bring a real project

**Body:** Spectro is still evolving. We’re looking for independent developers and small product teams willing to connect a real project and share what helps, what is missing and where setup gets in the way.

**Primary CTA:** Request early access

**Disclosure (single paragraph, `aria-describedby`):** Opens a prefilled public GitHub issue. A GitHub account is required. Share your frontend stack and what you want to investigate; keep credentials and private data out. The team can reply there — a request does not confirm access or a response time.

## Footer

Spectro logo and wordmark, the same size as the header. From signals to better products. Links: GitHub, SDK guide, Console.

## Application channel

Use the live public repository's enabled GitHub Issues channel (`spectro-hq/spectro`). A direct `/issues/new` URL carries a short prefilled title and application body, so it works before any issue template is merged and without JavaScript. The body asks only for frontend stack, project type, investigation needs, and optional public project URL. Responses remain in the issue; no email, secret, customer telemetry, or private project detail is requested. No issue is automatically submitted and no success state is fabricated.

A private email form would require a chosen form service or backend, a recipient, privacy copy, and delivery verification. That is an optional replacement, not an unconfigured dependency of the GitHub channel.
