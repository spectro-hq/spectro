# Members extension evidence

Recorded 2026-10-08 from source. Scope: Settings Project / Members and invitation acceptance. This is an ordinary extension of the incumbent Console, with no approved change to the global visual world.

Authority checked: `PRODUCT.md`, root `DESIGN.md`, root `.impeccable/design.json`, and `apps/web/.impeccable/surfaces/apps-web-src-project-settings-tsx.md`. Source checked: `project-settings.tsx`, `workspace-members.tsx`, `invite-acceptance.tsx`, `settings-navigation.ts`, `spectro-icons.tsx`, and `styles.css` under `apps/web/src/`.

## Source evidence

- The section links reuse `ConsoleShell` and preserve organization, project, environment, range and source in the URL. The selected section has `aria-current`, violet foreground and a 2px underline; the links have a 48px minimum height.
- Members and invitations reuse the existing Settings heading, scope capsule, one-border panel, form, primary / secondary / text buttons, and one-time-secret presentation. Acceptance reuses the established centered workspace gate, setup panel and brand mark. No avatar, decorative metric or new motion is introduced.
- The extension consumes existing semantic variables: `--ink`, `--muted`, `--hairline`, `--border`, `--surface`, `--violet`, `--violet-dark`, `--violet-wash`, `--focus-border`, `--danger`, `--control-radius` and `--panel-radius`. The added Members CSS contains no hardcoded color palette. The light Console uses ink `#24252b`, ground `#f5f5f7` and violet `#5850df`; dark uses ink `#f1f4fa`, ground `#0e1420` and violet `#8a83ff`. These are observed incumbent values, not new global tokens.
- Native system sans-serif is inherited. Member identity text is 0.85rem / 600; explanations are 0.8rem / 1.55; role controls are 0.82rem. Settings headings retain the existing 1.35rem page and 1rem section sizes. Shared buttons resolve to 0.8125rem / 500 after the incumbent later override. Controls use the existing 7px radius; Settings panels use 12px; the workspace setup panel retains its existing 16px radius.
- Rows use 20px vertical padding with hairline separators. Member role controls and removal controls have 44px minimum heights. At 760px, member rows and section headings stack, the invite form expands, and the acceptance primary action spans the panel. The existing 480px gate and Settings rules remain in effect. Long member identities and acceptance titles use `overflow-wrap: anywhere`.
- Source provides role explanations, administrator-only management, loading / retry feedback, an empty invitations state, named invitation status text, a temporary selectable invitation link, clipboard failure recovery, and explicit recipient acceptance. Native confirmation protects role changes, removal and revocation. These are code observations, not claims that all states have passed browser review.

## Verification disposition

**Visual verification pending — recapture required.** Actual Members and invitation acceptance desktop / mobile captures in light and dark modes were not obtained because browser capture was blocked by policy. Existing Schema captures are unrelated evidence and cannot establish this extension's appearance. No visual approval or rendered contrast / overflow result is claimed. Required recapture includes the member directory, invitation form and newly created link, read-only roles, and recipient preview / recovery states.

Root `DESIGN.md` and `.impeccable/design.json` were preserved byte-for-byte. Pre-existing drift remains: root palette primitives describe the earlier cool-blue field while current Console source uses grey / violet light tokens; sidecar Instrument Card uses Avenir while source inherits native typography. The root record also retains its existing noncanonical `Color modes` section placement. No defect was converted into a new global rule, and no drift was repaired in this extension record.

## Asset scope

No shipping raster asset was added or changed. `git diff HEAD` for tracked PNG / JPG / JPEG / WebP / GIF / AVIF assets returned no changes, and `apps/web/public` contains no untracked additions. The invitation gate uses existing `SpectroMark`, which references `/spectro-logo.png`; the owner-supplied mark and existing favicon assets remain unchanged. Existing review screenshots and reference images are not new shipping assets or Members capture provenance.
