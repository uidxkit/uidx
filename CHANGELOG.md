# Changelog

User-visible changes are recorded here. Versions follow semantic versioning;
pre-1.0 releases may change the design format or public APIs. Release notes must
describe migrations when an existing document or integration is affected.

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
