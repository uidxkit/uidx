# npm distribution

The consumer installs **one local devDependency**, `uidx`, which exposes the
`uidx` executable. The release tarball bundles the built `@uidx/format`,
`@uidx/schema`, `@uidx/server`, `@uidx/agent` and `@uidx/viewer` packages, plus
the patched Open Pencil core and scene graph, plus PptxGenJS and its patched
image-size dependency. The viewer includes its JavaScript,
WASM and fonts. Nothing needs to be installed globally.

External npm dependencies remain normal dependencies, including Vite and its
platform-specific binaries. The release packer promotes external requirements
from bundled packages into the consumer package manifest. It refuses conflicting
version ranges instead of silently choosing one. Internal exports point to
JavaScript and declarations in `dist/`; the `development` condition selects
TypeScript source only within this repository.

In an application, the CLI lives in `node_modules/uidx/`; its bundled libraries,
server and viewer live in `node_modules/uidx/node_modules/`. The application's
`.uidx/` contains authored pages, assets, manifest and configuration.

`npm run uidx` starts one process scoped to the nearest project. It serves the
viewer, WebSocket synchronization, and project MCP endpoint on the same port.
`.uidx/config.json` sets the preferred port (`{"port":4400}`); `--port` overrides
it. The discovery file `.uidx/.uidx-server.json` records the actual port, project
root and MCP URL. CLI agent commands and the `uidx mcp` stdio bridge discover and
verify this project server before calling its tools.

The local npm postinstall initializes the workspace automatically. Setup adds
viewer and MCP scripts, merges `.mcp.json`, and installs portable authoring,
project workflow, eval API, and component documentation skills into
`.agents/skills`, `.claude/skills`, and `.uidx/.uidx-agent/skills`. Reinitializing
preserves existing MCP registrations and authored skill directories. Source
checkouts, directory links and global installs do not run project setup.
Use `UIDX_SKIP_INIT=1` or disable install scripts to opt out, then run
`npx --no-install uidx init` explicitly. Script conflicts skip automatic setup;
choose another name with `uidx init --script design`.

## Build and install an unpublished release

Build and pack using the repository's pinned pnpm version:

```bash
corepack pnpm pack:release
```

This produces a single `dist/packages/uidx-<version>.tgz`. The build compiles
all internal packages and the viewer. The packer stages their published files,
includes the installed patched SDK with its licenses and assets, and produces
a standard npm bundle. It clears old generated tarballs before packing.
The consumer postinstall only initializes the project; it does not build code,
apply dependency patches, or copy runtime assets.

Install that one tarball in an application:

```bash
cd /path/to/my-project
npm install --save-dev /path/to/uidx/dist/packages/uidx-0.0.0.tgz
npm run uidx
```

The installation test creates a temporary npm project and installs the single
tarball as its only direct devDependency. It checks automatic setup without an
explicit init command, confirms the drawing patches and shared SDK instance,
imports the CLI API, and runs `npm run uidx` using consumer configuration.
It fetches the viewer/JS/WASM/fonts and uses the CLI to read, create, edit,
search, and render a page to PNG. The generated MCP stdio command connects to
that same server and edits the same files. It closes the server and removes
the temporary project afterwards:

```bash
corepack pnpm test:install
node scripts/smoke-install.mjs --ignore-scripts # explicit-init fallback
```

These checks need registry access and permission to bind a localhost port.
They use npm and packaged files to catch missing assets, lost patches, source
exports and workspace-only resolution that source tests cannot detect.

## Develop against another project

After installing this checkout's dependencies and running `pnpm build:cli`,
install the CLI directory as a local dependency of the application:

```bash
cd /path/to/my-project
npm install --save-dev /path/to/uidx/packages/cli
npx --no-install uidx init
npm run uidx -- --viewer-dev
```

The local `node_modules/uidx` link resolves the checkout's built backend and
viewer source. Setup is explicit for directory links. `--viewer-dev` enables
viewer hot reload; rebuild and restart after backend edits. Omit the flag to
use the built viewer. Published packages do not ship viewer source.

Alternatively run `pnpm dev /path/to/my-project` from the uidx checkout. This
builds the backend and CLI, then starts the source viewer for the target project.
`pnpm test:linked` verifies the project-local directory link in a temporary app.

## Publish

Set internal package versions consistently, regenerate the lockfile, then
build, test and run `pnpm pack:release`. Publish **the resulting uidx tarball**;
it includes the internal packages and their patched runtime, so they do not
need separate registry releases. Do not publish directly from `packages/cli`,
because that bypasses release bundling. Follow the [release guide](releasing.md)
for CI gates, protected tag publishing, provenance and account configuration.

After publication, consumers run `npm install --save-dev uidx`, followed by
`npm run uidx`. Packing and installation tests do not publish anything.
