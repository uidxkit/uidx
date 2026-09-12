# Releasing uidx

uidx is a project-local development dependency. Publish the single tested
`uidx-<version>.tgz` produced by `scripts/pack-release.mjs`. Do not publish directly
from `packages/cli`: that directory does not contain the bundled runtime patches,
viewer assets, and third-party notices required by a working installation.

## One-time maintainer setup

The repository must be public before describing it as publicly available open
source or publishing with npm provenance. Review its files and history for private
material before changing visibility. Enable GitHub private vulnerability reporting
and protect `main` with required CI checks and pull-request review.

Create a GitHub environment named `npm` with required maintainer approval and
restrict deployments to release tags. Confirm ownership and availability of the
`uidx` package name. Configure an [npm trusted publisher](https://docs.npmjs.com/trusted-publishers/)
for owner `beharguy`, repository `uidx`, workflow `release.yml`, environment `npm`.
The workflow uses GitHub OIDC and needs no long-lived npm token. First publication
may require an authenticated maintainer to bootstrap the package before its npm
settings are available; use the verified tarball and npm's interactive 2FA flow.
Do not store registry tokens in this repository. These account settings must be
completed by a maintainer; committing the workflow does not enable them.

## Prepare a release

1. Use Node from `.nvmrc` and the pinned pnpm version. Install with
   `pnpm install --frozen-lockfile`.
2. Choose a new semver version and update the root and all workspace package
   versions together. `0.0.0` is a development placeholder and is rejected by
   the release workflow. Record changes and migration notes in `CHANGELOG.md`.
   Before 1.0, document any API or format changes explicitly.
3. Run the same gates as CI:

   ```sh
   pnpm format:check
   pnpm lint
   pnpm typecheck
   pnpm build:cli
   pnpm test
   pnpm audit:release
   pnpm test:release
   node scripts/pack-release.mjs
   pnpm test:install
   node scripts/smoke-install.mjs --ignore-scripts
   pnpm test:linked
   ```

4. Review the tarball's files, notices and generated checksum. Test on the supported
   Node LTS versions; CI covers Node 22.19 and 24.21 on Linux. macOS is also used
   in local development. Windows is not yet a release-tested platform.
5. Merge the reviewed change into `main`, create an annotated `v<version>` tag on
   that commit and push the tag. The release workflow reruns CI, downloads the
   artifact from that run, verifies its checksum/version, then awaits the protected
   `npm` environment before publishing that exact tarball with provenance.

After publishing, verify `npm install --save-dev uidx` in a fresh project and
`npm run uidx -- --no-open`. Confirm the viewer, `.uidx` setup and MCP bridge work.
Create release notes linking the changelog and npm package. If a release is broken,
deprecate that version with a concrete explanation and publish a new patch version;
do not overwrite an existing artifact or move a published tag.

## Dependency and license updates

Review `pnpm audit:release` output, including lower-severity advisories. The gate
audits development dependencies too because some become browser bundle code.
New high or critical findings block publication. Two image-size advisories have a
documented, verified local backport; see [the security policy](../SECURITY.md).
Do not broaden that exception to new advisories or versions without investigation.

Update patches and overrides deliberately, install with the lockfile, regenerate
the viewer notices, and rerun source and packaged-install checks. Release packing
copies the patched dependencies and writes dependency overrides into the shipped
manifests; a workspace-only override is insufficient for npm consumers.
