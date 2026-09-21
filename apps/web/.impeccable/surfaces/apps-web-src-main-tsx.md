---
version: 1
slug: 'apps-web-src-main-tsx'
primary_target: 'apps/web/src/main.tsx'
related_targets: ['apps/web/src/styles.css', 'apps/web/src/event-query.ts']
---

# Event Explorer surface brief

- Scope/mode: authenticated Console event explorer; Operate.
- Audience/job: a frontend developer repeatedly narrows a project time window, scans heterogeneous events, and inspects the selected event with its session, page, user, release, SDK, and payload context.
- Primary task: find a relevant event, understand what surrounded it, and continue backward through stable cursor pages.
- Required states: local authorization setup, loading, populated, empty, query error, and additional-page loading. Illustrative data must be visibly identified.
- Chosen direction: Focus Bench, selected by the user from seed `299e769a`; approved comp `.impeccable/mocks/decision/event-explorer-focus-bench.webp`.
- Memorable moment: selecting a row moves one ultraviolet alignment marker into the persistent detail bench; motion is a short state transition, never decorative.
- Responsive rule: desktop keeps ledger and detail bench side by side; under 980px they become a stacked ledger and in-flow inspector; under 640px navigation labels collapse and tabular rows retain event/time before secondary context.
- Credential constraint: local bearer token is session-scoped and never written to the URL or persistent storage. Production identity remains unresolved.
- Data constraint: real API results are primary. A deliberate illustrative mode is available for development and is always labeled.

## Approved comp inventory

| Ingredient     | Commitment                                                                                                | Medium                                                         |
| -------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| App rail       | Slim 72–176px rail; wordmark, Events active, low-noise secondary destinations                             | Semantic HTML/CSS; authored inline SVG icons                   |
| Command row    | Project, environment, time range, refresh, connection state                                               | Native buttons/selects/forms styled in system grammar          |
| Time ruler     | Compact full-width histogram/tick field; selected time marker                                             | Semantic SVG with generated bars from current event timestamps |
| Event ledger   | Dense rows with timestamp, name, type, session, and page; selected row uses one ultraviolet rule and wash | Semantic table on desktop, ordered records on compact screens  |
| Detail bench   | Persistent 40% panel with Event, Context, Raw tabs; one focal surface may use diffuse lift                | React/HTML/CSS; JSON remains selectable text                   |
| Primary action | Connect local API / refresh; restrained solid ultraviolet only where action is required                   | Semantic button                                                |
| Event identity | Compact monospaced names, identifiers, versions, timestamps                                               | Text; never rasterized                                         |
| Status         | Small meaningful dots and explicit labels                                                                 | CSS circles plus text                                          |

## Sampled/authoritative color record

- Approved-comp page ground: `#fbfdff`; implementation remains aligned with established atmospheric `#f4f7fb` where the original shell is visible.
- Rail field: `#f6fafd`.
- Instrument surface: `#fefefe` / established `#ffffff`.
- Readout field: `#f2f6fc` / established `#f0f4f9`.
- Ink and signals use authoritative DESIGN.md values: ink `#142238`, violet `#635bff`, cyan `#12a8c4`, green `#087f5b`, hairline `#cdd6e3`.

## Literalization boundary

## Visual refinement · September 15, 2026

The user supplied dashboard references for finish and texture, explicitly excluding their content and layout as requirements. The Console keeps Focus Bench behavior and composition while adopting quieter white surfaces, lighter dividers, restrained elevation, and more readable typography.

- Console UI font: native platform sans (`-apple-system`, `BlinkMacSystemFont`, `Segoe UI`); this surface-specific choice supersedes the foundation Avenir stack for operator text.
- Page title: 28px / 600; panel title: 18px / 500; controls and event names: 13px / 500; supporting labels and telemetry: 12px, regular where possible. Values are authored in rem and respect browser font settings.
- Monospace remains limited to event names, IDs, timestamps, and raw values. Time-range controls use the UI face.
- Ground/readouts: `#f7f8fa`; divider: `#e3e7ed`; inspector lift: `0 4px 24px rgb(28 47 78 / 5%)`.
- Render evidence: `.impeccable/review/refined-desktop.png` (1440px) and `.impeccable/review/refined-mobile.png` (390px). Both have no horizontal page overflow.

## Native workspace refinement · September 21, 2026

The owner approved the KeygenGo application preview as a finish reference for the Console shell, Events, and Issues. Preserve the existing investigation flow while moving to a connected, native-tool workspace.

- Surface-specific neutrals: ink `#24252b`, muted `#61616c`, ground/readout `#f5f5f7`, rail `#ededf0`, divider `#e2e2e7`, surface white. Selection uses `#5850df` with white foreground.
- Desktop toolbar controls use a 7px radius and 36px minimum height; narrow-screen controls retain a 44px minimum target. Connected working panels use a shared 12px outer radius, one border, and internal separators instead of independent card shadows.
- The side rail uses a white active item with a violet icon; event and issue selection uses solid violet with white text. Hover and keyboard focus remain distinct.
- Page headings are 22px, panel headings 14px, normal controls 13px, and metadata 12px. Native system sans remains the UI face; search guidance uses sans and machine-shaped event values retain monospace.
- Desktop event rows are 40px with quiet alternating backgrounds. Issue rows retain room for error messages and impact; mobile stacks the inspector beneath the list.
- This surface-specific refinement supersedes the earlier panel lift, detached card spacing, and selection wash guidance above. Product copy, query behavior, and API contracts remain unchanged.
- Navigation and controls use the authored Spectro Signals IconSet: a 20px grid, 1.5px rounded strokes, and observation/signal geometry. The wordmark and browser favicon use the owner-supplied circular spectrum logo without reinterpretation.
- Event payloads use the shared read-only machine-data viewer: numbered, selectable code with JSON/YAML switching, horizontal overflow for long values, and copy feedback tied to the visible format.
- The four authored primary-navigation metaphors are fixed as symmetric waveform (Events), hexagonal alert (Issues), concentric receiver (Live), and stacked data cylinder (Schemas). Secondary Settings and API Guide retain the original sliders and open-book metaphors. Their SVG paths use `currentColor` so default, hover, active, and dark-mode states remain token-controlled.
- A compact sun/moon control is available in the Events and Issues command bars. The first visit follows the operating-system color preference; an explicit choice persists locally and is applied before React mounts to avoid a theme flash.
- Dark mode is independently composed from semantic tokens: a blue-black field, distinct rail and work surfaces, restrained borders, and the same ultraviolet/cyan/green meanings as light mode. It is not produced by filter or inversion.

## Content boundary

The comp’s exact event counts, user initials, dates, SDK versions, paths, errors, and timestamps are illustrative composition content, not product claims. Implementation must derive real values from the API or use clearly labeled synthetic fixtures. No raster from the decision round ships inside the product UI.

## Unresolved decisions

- Production sign-in and membership provider.
- Saved views and server-backed filter presets.
- Aggregated event-volume endpoint; the V1 ruler derives only from currently loaded rows and says so.
