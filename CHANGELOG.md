# Changelog

User-visible changes are recorded here. Versions follow semantic versioning;
pre-1.0 releases may change the design format or public APIs. Release notes must
describe migrations when an existing document or integration is affected.

## 0.1.6 — 2026-09-25

- The first `uidx dev` sets up the workspace itself when the install script did
  not run: recent npm versions block a package's install scripts until they are
  approved, which left a fresh install with no `.uidx/`, no `uidx` scripts and
  no skills. The setup is the same one the install script performs, and the
  command says what it added.

## 0.1.5 — 2026-09-20

- The prebuilt viewer is served by `@uidx/server`'s own static server instead
  of `vite preview`. Vite, and the platform-specific native binaries Vite 8
  runs on (rolldown, lightningcss), are no longer runtime dependencies of
  `@uidxkit/uidx`; an install whose optional native packages did not match the
  machine — a lockfile made on another OS, optional dependencies switched off,
  an unsupported libc — failed with `ERR_MODULE_NOT_FOUND` on the first `uidx`
  command. Installs are also about 30 MB smaller. `--viewer-dev` still boots a
  Vite dev server from a source checkout.
- Windows: `uidx read`, `uidx render` and the agent tools find the document
  again. Manifest discovery answered forward-slash paths that never matched
  the backslash root, so every command reported no `uidx.json` under a project
  that had one.
- Windows: rendering no longer aborts with `ENOENT … D:\D:\…canvaskit.wasm`.
  The bundled drawing SDK turned the CanvasKit file URL into a path through
  `URL.pathname`, which is not a filesystem path on Windows.

## 0.1.4 — 2026-09-15

- Canvas: a press selects the element under it immediately, the way Figma
  does, instead of waiting for the release; a click that wobbles a few pixels
  stays a click rather than nudging what it selected (#15).
- Canvas: the rotation grip drawn on a stem above the selection now responds —
  it shows the rotate cursor and dragging it turns the element, with the angle
  shown beside the pointer. Previously it was painted but not a target; only
  the invisible zones outside the corners rotated, and those still do (#16).
- Properties: scrubbing or typing corner radius and padding now previews live
  in the field and on the canvas, like every other numeric field, with one
  write to the file on release (#17, #18).
- Canvas: moving, nudging or rotating an element on the canvas is now written
  to the `.uidx` file. Previously only panel edits were persisted, and a canvas
  gesture silently reverted on reload (#19).

## 0.1.3 — 2026-09-13

- Update `typescript-eslint`, `ai-sdk-ollama`, `@ai-sdk/anthropic` and `zod`
  dependencies.

## 0.1.2 — 2026-09-13

- Document third-party license notices for the libraries statically linked into
  CanvasKit (FreeType, HarfBuzz, libjpeg-turbo, libpng, zlib, ICU, Wuffs) and note
  that Google Fonts imports retain their own licenses.
- Update `vite`, `vitest`, `ai`, `@ai-sdk/openai-compatible` and development-tool
  dependencies; bump GitHub Actions to their latest pinned versions.

## 0.1.1 — 2026-09-12

- Refresh the GitHub and npm READMEs and workflow image for `@uidxkit/uidx`.
- Show project-local npm installation and remove local-checkout installation
  instructions from the READMEs.

## 0.1.0 — 2026-09-12

- Project-local `@uidxkit/uidx` devDependency with automatic workspace, npm-script,
  skill and MCP setup; explicit setup remains available.
- One release tarball containing the server, viewer and patched drawing SDK.
- Bidirectional `.uidx` editing, reusable components, variables, fonts and
  project-bound CLI/MCP tools.
- MIT licensing, third-party notices, contributor and security policies,
  release validation and local-server request protections.
- Node 22.19 minimum, Node 24 LTS development runtime, patched dependencies
  and a verified image-size security backport included in consumer installations.
