# SDK alpha release

ADR-055 covers the four MIT packages. Platform services are not licensed by this release. Protocol/envelope versions remain V1. First release: `0.1.0-alpha.0`, with npm tag `alpha`. Nothing here publishes automatically on ordinary commits.

## Prepare and inspect

```sh
pnpm install --frozen-lockfile
pnpm verify
pnpm sdk:verify
```

The last command packs protocol, types, core and browser with pnpm and inspects the real archives. It installs them in an independent temporary consumer, checks runtime delivery and privacy, runs the repository's TypeScript 7 checker against consumer declarations, and builds a browser application with Vite. It requires npm registry access for external dependencies. Artifacts are in `.local/sdk-release/`; package source and README are MIT, while repository-wide licensing remains open. Review archive listings and package metadata before publishing.

## First publication

Confirm the maintainer account has publish permission for the npm `spectro` organization and complete npm login/2FA on the maintainer machine. Do not paste tokens or OTPs into chat. If npm cannot configure trusted publishers for new packages yet, bootstrap these exact reviewed tarballs from that machine:

Commit and review the release changes before publication. `npm whoami` verifies identity, not organization/package authorization; an E403 from `npm org ls spectro` may indicate a restricted CLI credential or missing organization-management permission, and does not by itself prove publishing is denied. Confirm the account's package creation/publish rights in npm organization settings, and refresh the local login if needed.

```sh
npm publish .local/sdk-release/spectro-protocol-0.1.0-alpha.0.tgz --access public --tag alpha
npm publish .local/sdk-release/spectro-types-0.1.0-alpha.0.tgz --access public --tag alpha
npm publish .local/sdk-release/spectro-core-0.1.0-alpha.0.tgz --access public --tag alpha
npm publish .local/sdk-release/spectro-browser-0.1.0-alpha.0.tgz --access public --tag alpha
```

These commands make public, immutable npm releases. Run only after artifact review and explicit release authorization. npm may prompt for browser/2FA approval. Stop on errors; after a partial publication, publish only remaining packages. Do not republish or reuse a version. Verify exact version installation from npm in a fresh customer project before announcing availability.

## Subsequent automated publication

Configure a trusted publisher in each package's npm settings: GitHub owner `spectro-hq`, repository `spectro`, workflow filename `sdk-release.yml`, environment `npm`, with direct `npm publish` permission. Configure the GitHub `npm` environment with appropriate release reviewers. The workflow uses Node 24 and npm OIDC/provenance without stored npm write tokens. See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/).

Update all four package versions and core's emitted SDK version together; the consumer smoke test checks their agreement. Commit/review changes. Run SDK alpha release manually on main, initially with `publish=false` to review artifacts. After review, run with `publish=true` to build, verify and publish. Avoid changing source between review and publication. The `alpha` tag keeps prereleases away from unqualified latest installs. Never publish another npm scope, app, or service through this workflow.
