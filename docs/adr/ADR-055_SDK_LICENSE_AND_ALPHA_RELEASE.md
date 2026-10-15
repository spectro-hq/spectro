# ADR-055: MIT SDK packages and alpha releases

Status: accepted

Date: 2026-10-15

## Context

The operator controls the npm `spectro` organization and approved MIT licensing for the SDK. A hosted staging deployment now exists, but customers cannot install the browser SDK from npm. ADR-025 kept licensing undecided pending an explicit product decision.

## Decision

License only `packages/browser`, `packages/core`, `packages/types`, and `packages/protocol` under MIT, including their original protocol schemas and package documentation. Put the full license in each package and set package metadata accordingly. This partially resolves ADR-025; the platform and other repository directories remain unlicensed pending a separate decision. Do not introduce a repository-wide MIT license or imply rights to third-party dependencies or brand assets.

Prepare all four packages at `0.1.0-alpha.0`, published in dependency order: protocol, types, core, browser. Retain existing ESM exports and workspace boundaries. Use pnpm pack to rewrite workspace and catalog references into installable dependency versions. Include runtime JS, declarations, maps, schemas, package README and license; exclude tests, build state, credentials and platform code. Verify actual tarballs in an independent consumer, including runtime transport/privacy behavior, TypeScript checking and a browser bundle, before publication.

Manual workflow dispatch builds and verifies artifacts by default. Explicit publishing uses npm's alpha dist-tag, never latest, and GitHub-hosted OIDC trusted publishing after npm ownership/trust configuration. Bootstrap new packages through an authenticated maintainer's local npm client when trusted publishing cannot be configured before the first publication. Never put npm credentials in source. Publication is a separate operator action after artifact review.

## Alternatives and consequences

A single bundled SDK would reduce public packages but change package distribution boundaries unnecessarily. A repository-wide license would silently license the platform. Private packages would impede independent early adopters. Alpha APIs may change; package semantic versions do not change Protocol V1 event/envelope versions.

## Migration and rollback

No existing published versions need migration. Pin first adopters to an exact alpha version. Keep a release record and increment versions together for subsequent SDK releases, including emitted SDK metadata. npm versions are immutable; correct faulty releases with a new version and deprecate the faulty version rather than attempting to reuse it. Platform licensing remains open. Standard repository checks and packed-consumer acceptance gate each release.
