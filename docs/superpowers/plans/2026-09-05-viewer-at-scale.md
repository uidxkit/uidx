# Viewer at Scale Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every stage of an edit proportional to the edit: incremental re-parse on the server and client, patch deltas on the wire, writers posting patches to the session, and a renderer that re-records only the chunk that changed.

**Architecture:** `applyPatchesIncremental` in `@uidx/format` re-lowers one element of the existing tree and shifts offsets; the session and the client both use it, so `file:changed` can carry patches instead of documents. The harness posts patches to a new HTTP route. The renderer patch replaces the whole-page picture with chunk pictures invalidated by `markDirty`.

**Tech Stack:** TypeScript, vitest, micromark/mdast (already the parser), Vue 3, pnpm patch on `@open-pencil/core`.

**Spec:** `docs/superpowers/specs/2026-09-05-viewer-at-scale-design.md`

## Global Constraints

- Node 22: prefix commands with `export PATH=/Users/guybehar/.nvm/versions/node/v22.15.0/bin:$PATH &&`.
- Work on `main`; commit per task.
- Server and CLI run from dist: `pnpm build:cli` then restart the `uidx-meridian-transit` preview after server changes. The viewer and `@uidx/format`/`@uidx/schema` are served from source by Vite.
- The renderer patch is applied with `pnpm patch @open-pencil/core@0.14.0`; apply the existing `patches/@open-pencil__core.patch` into the edit dir first, or `patch-commit` drops its hunks.
- Never leave `design-systems/meridian/atlas.uidx` with anything but the user's own edits.

---

### Task 1: `applyPatchesIncremental` — re-lower one element

**Files:**
- Modify: `packages/format/src/parse.ts` — export `Lowerer`, `parseFragmentRoot(text)`, `FLOW_MODES`, and a `LoweringContext` builder `contextFor(doc, parentAddress)`.
- Create: `packages/format/src/incremental.ts` — `applyPatchesIncremental(doc, patches): { doc: UidxDocument; changed: string[]; fellBack: boolean }`.
- Modify: `packages/format/src/index.ts`.
- Test: `packages/format/test/incremental.test.ts`.

**Interfaces:** `applyPatchesIncremental(doc: UidxDocument, patches: readonly UidxPatch[]): { doc: UidxDocument; changed: string[]; fellBack: boolean }` — `changed` lists the addresses re-lowered (the enclosing element after the parent-bump rule); `fellBack` is true when a full parse ran.

- [ ] Test: for each op kind (set, add, remove, set-mode, insert-node, remove-node, move-node) on a fixture with a component, variants, an instance, a slot, and a tokens page, the incremental result's tree (element, name, address, attrs values/raw/loc/valueLoc, loc, openTagLoc, selfClosing, indent, children) deep-equals `parse(applyPatches(...).source).doc.tree`, `source` and `sourceHash` equal, `assertOffsetInvariant` passes, and `fellBack` is false for attribute ops on inner nodes.
- [ ] Test: a rename to a duplicate sibling falls back and the result is the full parse's; a `set` on the root falls back; the atlas file: attribute op on `Atlas#station=approach, land=mesh/atlas` completes under 50 ms (measured, asserted at 250 ms for CI slack) with `fellBack === false`.
- [ ] Implement per spec §1. Enclosing node: deepest node whose `loc` contains the union changed range in the *old* source; bump while the parent is Component/Variant/Instance/Slot/Variable/Collection. Fragment: `wrap = '<Page>\n' + newSource.slice(lineStart, newEnd) + '\n</Page>\n'`; `newEnd = old.loc.end + delta`; lower `tree.children[0].children[0]` via `lowerer.element(child, parentAddress, parentElement, rootName, axes, modes, inFill, inComponent, parentFlows)`; shift all offsets in the lowered subtree by `lineStart - wrapPrefix.length`; replace in the parent's children by index; check sibling names; shift offsets after `old.loc.end` by `delta` across the whole tree (ancestors: `end += delta`; nodes with `loc.start >= old.loc.end`: both); `intent` unchanged (the tree is after it).
- [ ] Run, commit.

### Task 2: The session applies incrementally and broadcasts deltas

**Files:** `packages/server/src/protocol.ts`, `packages/server/src/session.ts`, `packages/server/src/workspace.ts`, tests in `packages/server/test/`.

- [ ] `file:changed` gains `patches?: UidxPatch[]`, `base?: number`, `sourceHash: string`; `doc` becomes optional. New client message `page:request { file }`. New server message `page:reresolve { file }`.
- [ ] `patchNow` uses `applyPatchesIncremental`; broadcasts `{ patches, base: previousRevision, sourceHash, patchId, revision }` without `doc`. `reloadNow` (watcher) broadcasts `patches = diffToPatches(previous, next)` with `base` when the previous state was ok, else the full doc; an empty diff with a changed hash still goes out (prose) and the client requests.
- [ ] `snapshot()` (connect and `page:request`) sends the full doc with `sourceHash`.
- [ ] Workspace: dependents get `page:reresolve` instead of a snapshot.
- [ ] Server handles `page:request` by sending that page's snapshot to the requesting socket only.
- [ ] Tests: delta shape, watcher delta, prose-only, request/reply. Commit.

### Task 3: The client applies deltas

**Files:** `packages/viewer/src/App.vue`, `packages/viewer/src/socket.ts` (if types), tests.

- [ ] On `file:changed` with `patches` and `base === revisions.get(file)` and a held doc: `applyPatchesIncremental(held, patches)`; if `sourceHash` matches, adopt; else `page:request`. Without `base` or a held doc: adopt `doc` if present, else request.
- [ ] `page:reresolve`: re-run `showPage` with a fresh object identity for the file so the canvas re-resolves (shallow copy of the doc).
- [ ] `shown` uses `applyPatchesIncremental(doc, inFlight.patches()).doc` (structural prediction). Keep `predictDocument` for inverses.
- [ ] Undo-stack `pushExternal` for delta revisions uses the message's `patches` directly as `forward`, `inversePatches(previous, patches)` as inverse (falls back to `diffToPatches` when inversion throws).
- [ ] Tests for the in-flight/shown path with a structural op. Commit.

### Task 4: `POST /__uidx/patch` and writers through the session

**Files:** `packages/server/src/server.ts` (route plugin), `packages/agent/src/edit/apply.ts`, `packages/agent/src/core/viewer.ts`, `packages/cli/src/commands/apply.ts`, tests.

- [ ] Route: read the JSON body, validate `{ file, patches, baseRevision? }`, call `sessionFor(file).patch({ patchId: 'http-<n>', baseRevision: baseRevision ?? session.revision, patches })`, answer `{ revision, sourceHash }` on applied, `{ error }` with status 409 on stale and 422 on rejected.
- [ ] Harness: `postPatches(root, file, patches)` in `core/viewer.ts` using the discovery card; `applyOps` compiles ops to patches as today, then posts when a viewer answers, else writes the file. `onWrite` receives the server's `sourceHash`. Checkpoint capture unchanged.
- [ ] CLI `apply` uses the same helper.
- [ ] Tests: route with a real session; harness posts when a fake server answers, writes when none. Commit; `pnpm build:cli`; restart the preview.

### Task 5: Renderer chunk pictures (pnpm patch)

**Files:** `patches/@open-pencil__core.patch` (regenerated), `packages/viewer/src/CanvasPane.vue` (markDirty calls).

- [ ] `pnpm patch @open-pencil/core@0.14.0`; apply the existing patch into the dir; edit `dist/canvas/renderer/pipeline.js`, `retained-backing.js`, `renderer.js`, `state.js`: chunk list, `markDirty`, per-chunk record, viewport skip; `pnpm patch-commit`.
- [ ] CanvasPane: `editor.renderer`/`canvasRenderers` `markDirty(id)` from `watchGraph` handlers and from the touched ids after `applyChanges` (return them from `applyChanges` as `touched`).
- [ ] Live: profiler stats show `record` time for a toggle well under the page record; commit.

### Task 6: Measure and record

- [ ] Atlas and globe in a visible tab: click-to-paint, confirm time, LLM edit via `uidx apply` landing time. Update `docs/backlog.md` and `docs/needs-review.md`. Commit.
