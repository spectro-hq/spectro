---
name: Spectro
description: A quiet digital observatory that makes contextual product signals legible.
colors:
  observatory-ink: '#142238'
  instrument-muted: '#56657a'
  operational-status: '#38506f'
  atmospheric-bg: '#f4f7fb'
  instrument-surface: '#ffffff'
  hairline: '#cdd6e3'
  instrument-border: '#bfcbd9'
  ultraviolet-signal: '#635bff'
  ultraviolet-wash: '#eeedff'
  illustrative-border: '#e4e1fa'
  ultraviolet-text: '#463ccf'
  cyan-terminal: '#12a8c4'
  healthy-green: '#087f5b'
  readout-bg: '#f0f4f9'
typography:
  display:
    fontFamily: '-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif'
    fontSize: 'clamp(3.2rem, 6.2vw, 6rem)'
    fontWeight: 620
    lineHeight: 0.94
    letterSpacing: '-0.04em'
  body:
    fontFamily: '-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif'
    fontSize: 'clamp(1rem, 1.4vw, 1.16rem)'
    fontWeight: 400
    lineHeight: 1.72
  label:
    fontFamily: '-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif'
    fontSize: '0.72rem'
    fontWeight: 700
    letterSpacing: '0.08em'
  mono:
    fontFamily: 'SFMono-Regular, Consolas, monospace'
    fontSize: '0.7rem'
    fontWeight: 700
  brand:
    fontFamily: '-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif'
    fontSize: '1.05rem'
    fontWeight: 700
    letterSpacing: '-0.02em'
  status:
    fontFamily: '-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif'
    fontSize: '0.78rem'
    fontWeight: 650
  fact:
    fontFamily: '-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif'
    fontSize: '0.84rem'
    fontWeight: 700
  instrument-title:
    fontFamily: 'SFMono-Regular, Consolas, monospace'
    fontSize: 'clamp(1.35rem, 2.4vw, 2rem)'
    fontWeight: 620
    letterSpacing: '-0.03em'
  node-index:
    fontFamily: 'SFMono-Regular, Consolas, monospace'
    fontSize: '0.62rem'
  node-detail:
    fontFamily: '-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif'
    fontSize: '0.65rem'
    lineHeight: 1.35
  display-compact:
    fontFamily: '-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif'
    fontSize: 'clamp(3rem, 15vw, 4.5rem)'
    fontWeight: 620
    lineHeight: 0.94
  page-display:
    fontFamily: '-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif'
    fontSize: '1.75rem'
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: '-0.035em'
  section-title:
    fontFamily: '-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif'
    fontSize: '1.25rem'
    fontWeight: 600
  panel-title:
    fontFamily: '-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif'
    fontSize: '1.125rem'
    fontWeight: 500
  row-title:
    fontFamily: '-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif'
    fontSize: '0.9375rem'
    fontWeight: 600
  payload-title:
    fontFamily: '-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif'
    fontSize: '0.875rem'
    fontWeight: 500
rounded:
  chart-bar: '4px'
  signal: '999px'
  readout: '12px'
  instrument: '16px'
spacing:
  xs: '8px'
  sm: '16px'
  md: '24px'
  lg: '40px'
  xl: '64px'
components:
  instrument-card:
    backgroundColor: '{colors.instrument-surface}'
    textColor: '{colors.observatory-ink}'
    rounded: '{rounded.instrument}'
    padding: 'clamp(1.4rem, 3vw, 2.5rem)'
  protocol-tag:
    backgroundColor: '{colors.ultraviolet-wash}'
    textColor: '{colors.ultraviolet-text}'
    typography: '{typography.mono}'
    rounded: '{rounded.signal}'
    padding: '0.4rem 0.62rem'
  event-readout:
    backgroundColor: '{colors.readout-bg}'
    textColor: '{colors.observatory-ink}'
    typography: '{typography.mono}'
    rounded: '{rounded.readout}'
    padding: '1rem 1.15rem'
---

# Design System: Spectro

## Overview

**Creative North Star: "The Digital Observatory"**

Spectro should feel like a precision instrument operated in cool daylight: quiet enough for sustained analytical work, but unmistakably alive when a meaningful signal appears. The interface favors evidence, context, and readable structure over dashboard theater.

The visual ratio is **90% quiet, 10% signal**. Pale atmospheric space, ink typography, and hairline rules form the stable field; ultraviolet and cyan appear only where state or information flow deserves attention. Motion explains state; it does not decorate state.

**Key Characteristics:**

- Cool daylight surfaces with dark blue-black ink.
- Strong editorial hierarchy paired with compact monospaced telemetry.
- Sparse signal color used to reveal state, sequence, and health.
- Responsive layouts that preserve reading order before visual symmetry.

## Colors

The palette combines cool, nearly neutral instrumentation surfaces with a narrow ultraviolet-to-cyan signal spectrum and one operational green.

### Primary

- **Ultraviolet Signal:** Reserved for focus, selection, active event nodes, and short-lived emphasis.

### Secondary

- **Cyan Terminal:** Marks completion, destinations, and the far edge of a signal path.
- **Healthy Green:** Communicates a verified healthy or accepted state; never use it as decoration.

### Neutral

- **Observatory Ink:** Primary copy, headings, and high-confidence values.
- **Instrument Muted:** Supporting explanations, labels, and low-priority metadata.
- **Atmospheric Background:** The page field surrounding work surfaces.
- **Instrument Surface:** Focused analytical containers.
- **Hairline / Instrument Border:** Structure, grouping, and quiet separation.
- **Readout Background:** Compact telemetry and machine-readable summaries.

### Named Rules

**The Ten-Percent Signal Rule.** Accent color should occupy no more than roughly one tenth of a working view; its rarity is what makes it informative.

**The Meaningful Green Rule.** Green is evidence of health or acceptance, never a generic brand accent.

## Typography

**Display Font:** The native system UI sans-serif stack, led by San Francisco on Apple platforms

**Body Font:** The native system UI sans-serif stack, led by San Francisco on Apple platforms
**Label/Mono Font:** SFMono-Regular with Consolas and monospace fallbacks

**Character:** Native platform typography keeps dense analytical text crisp at small sizes and familiar during long sessions. Monospaced type distinguishes protocol names, identifiers, versions, and values without turning the whole product into a developer console.

### Hierarchy

- **Display** (620, fluid, 0.94): Milestone or page-level statements; keep them short and balanced.
- **Body** (400, fluid, 1.72): Explanatory copy with a maximum comfortable line length around 62 characters.
- **Label** (700, compact tracking, uppercase): Coordinates, system labels, and instrument captions.
- **Mono** (700, compact): Event names, protocol tags, identifiers, and tabular values.

### Interface Type Scale

- **Page display:** `1.75rem`; reserved for a single page-level metric or statement.
- **Section title:** `1.25rem`; used for focused detail headings and primary metric values.
- **Row title:** `0.9375rem`; used for the main label in dense operational rows.
- **Body:** `0.8125rem`; used for descriptions and supporting prose.
- **Caption:** `0.75rem`; used for timestamps, metadata, and control labels.
- **Micro:** `0.7rem`; used sparingly for compact status or secondary numeric context.

### Named Rules

**The Telemetry Boundary Rule.** Use monospaced type only when the content is machine-shaped; use the humanist face for meaning and guidance.

## Layout

Desktop views use an editorial split: context and intent on the left, the operational instrument on the right. Containers breathe generously and align to a small, repeatable spacing rhythm. At widths below 980px the split becomes a single reading column; below 640px fact grids stack, horizontal process diagrams become vertical, and page gutters settle at 16px. The minimum supported viewport is 320px, with no horizontal scrolling.

## Elevation & Depth

The system is flat by default. Hairlines and tonal shifts define most grouping; one diffuse ambient shadow may lift the currently important instrument above the page field. Status dots may carry a small local glow when it clarifies state.

### Shadow Vocabulary

- **Instrument lift** (`0 28px 60px rgb(28 47 78 / 12%)`): Only for the primary working instrument or modal-equivalent focal surface.
- **Signal glow** (`0 3px 12px rgb(82 76 214 / 30%)`): Only around active nodes in a compact signal path.
- **Health glow** (`0 2px 8px rgb(8 127 91 / 28%)`): Only around a small verified-health indicator.

### Named Rules

**The Flat-by-Default Rule.** Surfaces earn depth through task importance or state; ordinary containers stay flat.

## Shapes

Spectro combines precise circles for signal nodes with gently rounded instrument containers. Major instruments use a 16px radius, nested readouts use 12px, and status or protocol tags use a full capsule. Borders remain one pixel and cool gray. Avoid decorative side stripes and arbitrary radius variation.

## Components

### Protocol Tags

- **Shape:** Compact full capsule.
- **Color:** Pale ultraviolet wash with dark ultraviolet mono text.
- **Use:** Event type and protocol version; never a generic category chip.

### Status Labels

- **Reference:** [`apps/web/.impeccable/references/status-labels-reference.png`](apps/web/.impeccable/references/status-labels-reference.png) is an owner-supplied finish reference. It informs treatment only; its example state names are not product requirements.
- **Structure:** Pair a compact authored status icon with an explicit text label inside a full capsule. Never rely on color alone.
- **Tone:** Use a quiet tinted wash with a darker foreground from the same semantic hue. Keep fills soft enough to sit inside dense operational views without competing with selection.
- **Semantics:** Orange communicates pending or attention, blue review or informational state, ultraviolet active processing, neutral gray inactivity, red cancellation or failure, and green only verified approval or health.
- **Use:** Reserve this treatment for finite workflow or lifecycle states. Event types, filters, navigation, and arbitrary categories use their own established patterns.

### Navigation Icons

- **Reference:** [`apps/web/.impeccable/references/navigation-icons-dark-mode-reference.png`](apps/web/.impeccable/references/navigation-icons-dark-mode-reference.png) records the owner-approved direction for navigation icon character and dark-mode contrast.
- **Construction:** The five primary destinations use a 20px authored SVG grid, 1.5px rounded strokes, `currentColor`, and no baked-in background. Events is a symmetric pulse waveform, Issues a hexagonal alert, Performance a semicircular gauge with one needle and focal hub, Live a concentric receiver, and Schemas a stacked data cylinder. Secondary Settings and API Guide retain their original sliders and open-book metaphors.
- **States:** Default icons are quiet slate, hover icons use the ultraviolet foreground, and active icons sit in the established selected-navigation treatment. Shape and label must continue to identify the destination without color.

## Color modes

Light and dark modes are two composed observatory environments, not an inversion pair. Both modes retain the same information hierarchy and semantic color roles.

- Follow the operating-system preference on first use; a user toggle becomes the persistent override.
- Apply the selected mode before React renders so the shell does not flash through the wrong palette.
- Remap semantic surface, border, ink, muted, selection, code, and telemetry tokens. Components must not introduce mode-specific hardcoded colors.
- Dark mode uses blue-black page and rail fields with progressively lighter working surfaces. Borders remain visible but subdued; ordinary panels do not gain decorative glow.
- Ultraviolet continues to mean focus or selection, cyan continues to describe data flow, and green remains reserved for verified health. All text and controls must retain accessible contrast in either mode.

### Cards / Containers

- **Corner Style:** Gently rounded instrument silhouette.
- **Background:** White instrument surface above the atmospheric page field.
- **Shadow Strategy:** Only the primary instrument receives ambient lift.
- **Border:** One-pixel cool structural line.

### Session Timelines

- Enter a session from contextual identifiers in the Event ledger or detail view; session navigation is evidence drill-down, not a new primary destination.

### Performance Investigations

- Group field performance by metric and page path so the first question stays “where is the experience degrading?” rather than “which raw sample is largest?”
- Use p75 as the primary comparative value, preserve each metric's native unit, and pair it with explicit good / needs improvement / poor counts. Never collapse heterogeneous metrics into one synthetic score.
- Treat the group ledger and selected readout as one connected instrument. The detail concludes with a contextual route back to the contributing Events evidence rather than duplicating the raw-event explorer.
- Present signals chronologically from earliest to latest. A quiet hairline connects compact semantic nodes; selection uses the established ultraviolet wash.
- Keep the timeline and selected event detail in one connected working surface on desktop. On narrow screens, preserve reading order by stacking detail after the timeline.
- Summary values describe only the loaded query window. Illustrative sessions obey the selected time range and remain labeled as synthetic.
- **Internal Padding:** Fluid from 22.4px to 40px.

### Navigation

The foundation top bar is a quiet structural rail: wordmark on the left, truthful runtime state on the right, and one hairline beneath. Future navigation should preserve this low-noise treatment and make active state explicit rather than adding ornamental chrome.

### Spectro Signals IconSet

- **Grid:** Author interface icons on a `20 × 20` grid with a `1.5px` stroke, round caps, and round joins. Optical overshoot is allowed only to keep circles and diagonals equally weighted.
- **Geometry:** Derive product icons from observation windows, connected signal traces, focus nodes, and spectrum separation. Navigation concepts should remain recognizable without falling back to generic dashboard glyphs.
- **Color:** Icons inherit `currentColor`. Ultraviolet marks active focus, cyan marks a signal destination, and green remains reserved for verified health. Multicolor treatment belongs to the brand mark, not ordinary controls.
- **Use:** Render authored SVG components rather than an icon font. Icons are decorative beside visible labels and remain hidden from assistive technology; icon-only buttons require an accessible name.
- **Brand mark:** Use the owner-supplied circular observatory mark as the sole source of truth. Its three cyan-to-ultraviolet spectrum arcs surround a white focus ring and dark central aperture. Do not redraw or reinterpret it inside product surfaces.

### Signal Path

The signature sequence uses numbered nodes connected by an ultraviolet-to-cyan line. On narrow screens it rotates into a vertical path without changing semantic order. The terminal node alone takes cyan to make direction legible.

### Machine Data Viewer

- Render structured payloads as selectable, read-only code with persistent line numbers and restrained semantic syntax color.
- Keep format selection and copy beside the viewer title. Copy always uses the currently visible representation and confirms success in place.
- Support JSON as the default and YAML as the alternate representation. Long machine values scroll horizontally rather than wrapping into ambiguous lines.

## Do's and Don'ts

### Do:

- **Do** pair every visible signal with available project, environment, user, session, or page context.
- **Do** reserve high-chroma color for state, direction, selection, and health.
- **Do** keep metadata compact, tabular, and visibly subordinate to the analytical question.
- **Do** preserve semantic reading order when a horizontal composition stacks on mobile.

### Don't:

- **Don't** fill pages with interchangeable KPI cards or decorative gradients.
- **Don't** animate without explaining causality, progress, or state change.
- **Don't** use monospaced typography for prose or product guidance.
- **Don't** present illustrative data as live production telemetry.
