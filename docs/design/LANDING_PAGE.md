# Spectro public landing page

## Entry and intent

The public page is `apps/web/landing/index.html`, served at `/landing/`. It introduces frontend observability with shared context to independent developers, small product teams and frontend engineers investigating production issues. The primary action requests early access through a real, prefilled GitHub issue. Existing users can still enter the Console at `/`. `apps/web/src/landing/` owns only the public page's CSS and optional enhancement (`main.ts` → `enhance.ts`). Vite emits a separate entry graph; the Console router and authentication are not loaded by the landing page. [ADR-056](../adr/ADR-056_PUBLIC_LANDING_ENTRY.md) records this boundary.

Preview with `pnpm --filter @spectro/web dev`, then open `http://localhost:5174/landing/`. The public page needs no backend. Build with `pnpm --filter @spectro/web build`. Hosting the page on a new domain or replacing the Console root is a separate deployment decision.

## Direction: the page is a session

The redesign replaces the previous "The product performs" composition. The concept: **the page itself is one trace**. The visitor follows a single checkout session from a `runtime_error` outward through its shared context — the same movement the product supports. There is exactly one full instrument (the hero); everything below it is a drill-down along the same trace.

A continuous hairline spine runs down the left gutter (`--rail`, visible from ~1100px). Every major section carries a `.trace-marker` node on that spine, labeled in machine register with the event or concept it resolves: `runtime_error`, `context`, `issue`, `web_vital_lcp`/`fetch_request` (paired), `init()`, `privacy`, `faq`, `early_access`. With JavaScript, an `IntersectionObserver` marks the in-view marker `.is-active`; without it the markers are static and fully readable.

Visual language is "Digital Observatory":

- Hero, SDK and footer-adjacent fields are dark blue-black, built on the existing console dark tokens (`--n-*`: ground `#0e1420`, surface `#171e2a`, readout `#121a27`, ink `#f1f4fa`).
- Product-proof and explanatory fields are cool daylight (`#f4f7fb`, `#ffffff`, ink `#142238`).
- The cyan → ultraviolet spectrum (`#12a8c4` → `#635bff`) appears only on the timeline connector, the active node, and the marker/active states — roughly 10% of the viewport at any time.
- Ultraviolet (`#635bff`/`#463ccf`) is the selection, focus and CTA color; the successful-request readout stays neutral — green is reserved for genuinely healthy values inside captures.
- Type is the native system stack plus `ui-monospace` for all machine values. No web fonts, images or external requests.

## Structure

`<main>` wraps all content fields; the site header sits in its own dark field so the spine stays continuous and the footer closes the trace outside `<main>`.

1. **Header field (dark):** brand, Product/SDK/Privacy nav, Console link for existing users. The bar is `position: fixed` spanning the full viewport edge-to-edge with an opaque `--n-ground` field; an inner `.page-width.header-inner` row keeps brand and nav aligned with the content grid (rail-indented at ≥1100px). Scrolling adds `.is-scrolled` (hairline bottom border + lift shadow). Section anchors land clear of the bar through `scroll-padding-top`/`scroll-margin-top` sized from `--header-h` (96px desktop, 76px ≤640px), and `.trace`'s top padding tracks the same variable. Nav links carry a gradient `::after` that sweeps in on hover/focus and pins under the current section via `aria-current="location"`; the Console pill is exempt.
2. **Hero (dark, marker `runtime_error`):** `Follow the error` + category `Frontend observability with shared context.` + lede + `Request early access` / `Explore the product`. The full session instrument sits below the copy: three context bands (session `ses_8f3e2c`, page `/checkout · page_checkout`, release `web@1.4.2`) whose tracks share one x-axis with the timeline; a `fieldset` of three native radios (`element_click` −45 s, `fetch_request` −28 s, `runtime_error` −12 s, initially selected) positioned on the axis; a gradient connector over the covered span; a drop-line under the selected node into the evidence readout; and the evidence note qualifying that order does not establish a cause. Selection switches the readout via pure CSS (`:checked` sibling rules) — no JavaScript is required.
3. **Keep the context (light, marker `context`):** the real event-explorer capture (`events.webp`, with `event-context.webp` as the ≤540px `<picture>` alternative) annotated with three numbered `.annotate` markers that mirror the adjacent ordered investigation steps — select the error → read its context → follow the session.
4. **Investigate recurring errors (light, marker `issue`):** asymmetric 7/5 split, `issues.webp` capture before copy.
5. **Performance + requests (light, paired markers `web_vital_lcp`, `fetch_request`):** `performance.webp` and `network.webp` as a balanced pair; section heading is `aria-label` with `t3`-tier item titles.
6. **Connect your browser app (dark, marker `init()`):** copy left; right column leads with `.agent-brief` (gradient-chevron marker) — a copyable plain-language integration brief for coding agents (`#agent-brief-text`, own `data-copy` button, pinned `@0.1.0-alpha.0`, placeholder values only) — followed by an `or integrate by hand` divider and the ordered two-step manual setup (pinned `npm install` + the `init`/`track` example), each step with its own `data-copy`/`data-copy-target` button. Three copy controls total. The endpoint stays an origin placeholder (`https://YOUR_INGESTION_ORIGIN`); the `/v1/envelope` suffix is appended by the SDK.
7. **Capture with care (light, marker `privacy`):** copy beside a mono "Not collected by default" ledger listing the eight exclusions with strike glyphs.
8. **Before you begin (light, marker `faq`):** four exclusive `details` items, first open. Items animate their `::details-content` block-size between 0 and auto (240ms) plus `content-visibility` with `allow-discrete` in the transition shorthand — a separate `transition-behavior` declaration does not engage reliably on this page; the glyph is a 1px `+` whose vertical bar rotates 90° into a `−` while open, and the question ink shifts ultraviolet. All animation sits inside `prefers-reduced-motion: no-preference`.
9. **Bring a real project (light, marker `early_access`):** display-size closing headline, identical CTA URL, merged disclosure paragraph (`aria-describedby`).
10. **Footer field (light):** brand, tagline, GitHub/SDK guide/Console links; the field flexes to fill short viewports.

## Early-access channel

The owner confirmed there was no existing application backend and requested an application channel. The public `spectro-hq/spectro` repository was verified to have Issues enabled on 2026-10-28. Both primary actions use the same direct `https://github.com/spectro-hq/spectro/issues/new` URL with a prefilled title and body; no unmerged issue template, frontend script, form service or new backend is required.

The draft asks for frontend stack, project type, investigation needs and an optional public project URL. It requests no email, credentials, customer telemetry or private project details. A GitHub account is required, requests are public, and follow-up can happen in the issue — disclosed beside both CTAs (`aria-describedby`) and in the early-access FAQ. A request does not promise admission or a response time. The visitor reviews and submits on GitHub; this page neither submits an issue nor fabricates a success state.

A future private application form needs a chosen service/backend, recipient, privacy copy and delivery verification. It is not a launch dependency of the working GitHub route. The Console login remains an existing-user link rather than the acquisition action.

## Images and sample content

All images in `apps/web/public/landing/` are captures of this repository's actual UI using `source=illustrative`, taken at base revision `b69fb03` and re-shot at device pixel ratio 2 against `vite dev` on the current working tree (console code unchanged since `b69fb03` apart from unrelated owner edits). They use synthetic fixtures from `illustrative-events.ts`, `illustrative-issues.ts`, `illustrative-performance.ts`, and `illustrative-network.ts`. The event captures are cropped to the full bounds of the listed component selector — no fixed-height clipping. The three detail captures are shot at a 1920×900 viewport and cropped to the component's content box, excluding the console's own hairline borders, so the unified `.capture-frame` (hairline border, 16px radius) is the only visible frame; every capture image renders at `width: 100%` so it always fills its frame at any breakpoint. The `width`/`height` attributes record the 1× CSS-pixel size; the files themselves are 2×.

| Asset                | Source surface                        | Crop                        | Intrinsic size |
| -------------------- | ------------------------------------- | --------------------------- | -------------- |
| `events.webp`        | `/?source=illustrative`               | `.focus-bench`              | 2400×1434      |
| `event-context.webp` | `/?source=illustrative`               | `.event-detail`             | 968×1430       |
| `issues.webp`        | `/issues?source=illustrative`         | `.issue-detail`             | 1422×1324      |
| `performance.webp`   | `/performance?source=illustrative`    | `.performance-detail`       | 1422×1030      |
| `network.webp`       | `/network?source=illustrative`        | `.performance-detail`       | 1422×1172      |
| `og.png`             | Redesigned hero, rendered at 1200×630 | `og:image` + `twitter:card` | —              |

Creator: Spectro project UI, captured locally for this page. No external photographs, stock imagery, generated imagery, fonts, or footage are used. These assets retain the repository's existing platform/brand licensing status; no new license is granted. Every proof figure carries a right-aligned "Sample data" capsule in its caption row — never over the capture — and each links to the full-size capture.

The live instrument reproduces the existing `element_click`, `fetch_request`, and first `runtime_error` fixtures, including shared session `ses_8f3e2c`, page `page_checkout` and release `web@1.4.2`. The request succeeds with status 200; the visible `.evidence-note` states that ordering does not establish a cause. All displayed counts, durations, times, IDs and release names are illustrative. SDK project, key, ingestion origin and release placeholders must be supplied by the integrating developer. The landing entry does not import or initialize the browser SDK.

## Enhancement contract

`apps/web/src/landing/enhance.ts` is progressive enhancement only:

- **Copy controls:** every `button[data-copy][data-copy-target]` resolves its target element by ID, copies `textContent` (never markup) via an injectable `copy` function, and reports through the shared `[data-copy-status]` live region. On success the button gains `.is-copied` for 1.8s, revealing a cyan `✓` beside it (`.copy-check`); the live region stays visually hidden for assistive tech and only renders visibly on failure (`.is-shown`), where the manual-copy message explains the fallback. Buttons ship `hidden` and are revealed only after enhancement; denied/unavailable clipboard paths re-enable the button; a per-button pending flag prevents overlapping writes; cleanup clears timers, state classes and re-hides buttons, ignoring late completions.
- **Spine observer:** marks the section nearest each `.trace-marker` active when `IntersectionObserver` exists; a missing API is a no-op and cleanup disconnects the observer.
- **Nav observer + scrolled state:** the same observer maps intersecting sections to `#`-linked nav links and sets `aria-current="location"` on the active one (clearing all for sections without a link). Its `rootMargin` band is computed in pixels from `window.innerHeight` — percentage margins resolve against the root rectangle's width, which would collapse the band on wide viewports — and the observer is rebuilt on `resize` (rAF-throttled). A passive scroll listener toggles `.is-scrolled` past an 8px threshold. Both are additive, no-op without the API, and unwind observers, listeners, classes and attributes on cleanup.

The page never requires it: radios, FAQ `details`, links, anchors and all copy targets' visible source all work without JavaScript.

## Verification

Unit coverage lives in `apps/web/src/landing/landing.test.ts`: static content without rendering/auth, working anchor/control references, fieldset legend and `aria-controls` resolution, fixture fidelity and the successful-request boundary, local captures (files exist, alt text, "Sample data" captions, self-links), consistent original logos, pinned SDK install and placeholder-only setup, privacy copy, the real public application URL and its disclosure, generalized copy success/failure/overlap/cleanup behavior, and the spine observer fallback and disconnect. The web suite passed all 111 tests across 23 files.

`pnpm --filter @spectro/web test`, `pnpm --filter @spectro/web check`, `pnpm --filter @spectro/web build`, `pnpm lint` and `pnpm exec oxfmt --check` on every changed file all pass. The built Console and landing documents retain independent CSS and JavaScript entries. The pre-existing Console CSS, Vite entry configuration, README, `.gitignore` and ADR working-tree changes were preserved byte-identical.

Browser acceptance ran against a production `vite build` served by `vite preview` on `http://localhost:4174` (no `file://`), driven by Playwright + Chromium at device pixel ratio 1 (2 for the annotation and proof-figure crops). Evidence and measured results are under `.impeccable/review/landing-redesign/`:

- First-viewport and full-page PNGs at 1440, 768, 390 and 320px after a full scroll pass to trigger lazy images; `scrollWidth <= innerWidth` at all four. `acceptance.json` records `complete`, `naturalWidth` and the bounding box of every `<img>` — all loaded and painted.
- All three event selections at 1440 and 390 (`select-*` PNGs of the instrument).
- JavaScript-disabled full page at 1440: radio switching and content still work (`nojs-1440-full.png`).
- Real keyboard input: arrow keys move the checked radio; visible focus ring (`focus-radio.png`).
- `prefers-reduced-motion` emulation: connector transition resolves to `0s`, `scroll-behavior` stays `auto`.
- Zero console errors; all 36 network requests are local (`localhost:4174`).
- `annotations-<width>.png`: 2× crops of the event-explorer capture showing the numbered markers — three on `events.webp` at ≥541px, only marker 2 on `event-context.webp` at ≤540px.
- `captures-1440.png` / `captures-390.png`: 2× crops of the three proof figures (issue, performance, request) including captions — the `.capture-frame` is the only visible frame and each image fills it edge-to-edge with no console border line or empty strip inside.
- `og.png` verified at exactly 1200×630.

The `.annotate` markers sit on glyph-free spots adjacent to their targets, verified against the re-shot captures: 1 on the empty right portion of the selected `runtime_error` ledger row, 2 in the blank margin between the context fact grid and the payload section, 3 in the blank header space right of the "Session" column label.

The optional impeccable detector reports one intentional warning (instrument mono micro-labels at the 11px functional floor, matching observability density) plus `design-system-*` advisories that reference the previous page's token file; this direction's dark tokens are taken from the console's own dark surface. Earlier detector findings (sub-11px functional text, tonal glow shadow) were resolved.
