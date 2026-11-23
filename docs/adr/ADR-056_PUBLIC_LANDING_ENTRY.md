# ADR-056: Static public landing entry

Status: accepted

Date: 2026-10-18

## Context

Spectro needs a public introduction that explains the product before visitors enter an authenticated workspace. ADR-026 reserves the console for a React + Vite SPA and leaves the public site's framework open. The current root URL and deep links already belong to that console.

## Decision

Add `/landing/` as an independently authored static HTML entry in the existing web build. Vite emits both the existing console entry and the landing entry. The landing page has its own styles and a small progressive-enhancement script, with no console router, session query, analytics SDK, or API dependency. Product descriptions and native interactive examples remain usable without JavaScript.

Keep `/`, existing deep links, authentication callbacks, and deployment topology unchanged. The landing page's console action links to `/`, where the existing authentication flow applies. Public setup links point to the repository's SDK documentation. A separate marketing hostname or root-route migration is outside this change and requires its own deployment decision.

Use real console captures made with repository-owned illustrative fixtures, labeled as sample data. Do not publish customer telemetry, invented adoption figures, prices, or claims about future features. No third-party media, fonts, or runtime dependencies are required.

## Alternatives and consequences

A new site package and deployment would add maintenance without a current hosting requirement. Replacing the console root would break existing bookmarks and authentication continuations. A client-rendered marketing route would unnecessarily couple public content to console code and authentication. The static entry shares artifact delivery while keeping the two entry graphs separate.

## Compatibility, validation, and rollback

This extends ADR-026 without replacing its console decision. Verify both emitted HTML entries, the unauthenticated landing page, existing console routes, native examples without JavaScript, responsive layouts, keyboard interaction, and clipboard denial. Remove the additional build input and landing files to roll back; no data migration is needed.
