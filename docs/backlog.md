# UIDX backlog

Last updated 2026-09-05.

## Picking this up cold

Read this section and the table below; skip the rest until you need it.

**Coming to this fresh: start at
[the 2026-09-05 handoff](superpowers/plans/2026-09-05-session-handoff.md).** It
is the state of play as of the last session — what shipped, what each piece
measured, the traps that cost that session time, and **why the gate is red**.
The [2026-08-22 handoff](superpowers/plans/2026-08-22-session-handoff.md)
remains the record of the canvas-editing era.

**Shipped but not yet signed off: [needs-review.md](needs-review.md).** Every
story lands there with what it was for and what to check, and stays until it is
reviewed. Work does not wait on that queue — but a defect found in something
already called done outranks whatever is next.

**The roadmap is set by the 2026-08-20 direction: finish the inspector,
then edit on the canvas, then create.** All three are done. **C9, C10a, C10b,
C7, E4 and now D1 / D2 have shipped**, so the inspector is finished, the canvas
is editable, rearrangeable *and* draws — and **Phase 3b's exit criterion is
met**. **D7, D8 and D11 have shipped since.** The direction moved on 2026-08-22:
vector content should be **authored here**, not only imported, and raster
images should work — so [ADR 0006](decisions/0006-images-and-vector-artwork.md)
grew to cover all three shapes artwork comes in and was accepted (a path in the
file, not the content hash). D8's image half and D11's pen tool both landed
against it. **F10 shipped too** — a drawn node becomes a `<Component>` from the
toolbar, so the SVG → icon → component half of ADR 0006 §7's workflow now works
without touching the file. **D12 closed Epic D** — a `<Vector>`'s points can be dragged,
its handles pulled and a point deleted, all as one `set vectorPaths` per settled
gesture. **Phase 5 has started: F3's composition half shipped** — `<Instance>`
is in the grammar, a component resolves by its bare global name across the whole
document, overrides are read and rendered, and both `uidx check`'s reference
graph and the layers rail know about instances. **Authoring an override from the
canvas is not built** and is the next thing to decide — see **F3b**, which needs
a product call on what an override may carry. **F11** shipped too, so
ADR 0006 §7's workflow now runs end to end from the UI: drop an SVG, correct the
points, make a component, place instances of it — without touching the file.
**D7** (reorder a flowed child), **D8** (images and vector content), **F5**
(slots), **F6** (a component declares its properties) and **F7** (an instance
assigns them) were added on 2026-08-22. None is needed for Phase 3b's exit
criterion. F5, F6 and F7 all sit behind **F3**, since slots and component
properties are both features of instances; F6 before F7. Later the same day,
[ADR 0005](decisions/0005-variants.md) settled how a component carries its
states — one `<Component>`, declared axes, a full tree per `<Variant>` — and
added **F8** (variants) and **F9** (an instance picks one; the editor manages
the set), while **F2** grew from a `.fig` writer into the story of handing the
whole design system to designers in Figma. F8 needs neither F3 nor F6; F9
needs F8, F3 and F7. Spike **S5** measured what the SDK's `.fig` pair does
with a component set, and its findings are pinned in `fig-roundtrip.test.ts`.

**Picking up any canvas work: start from
[the C10 status doc](superpowers/plans/2026-08-21-canvas-manipulation-c10.md).**
It carries the coordinate facts this repo measured out of the SDK — the
world transform pivots on a node's *origin*, not its centre;
`getAbsoluteRotation` is sign-inverted; `getWorldHandles` is the renderer's
own answer and the thing to hit-test against — plus the verification traps
that cost a session hours. Three rounds of wrong fixes came from assuming those
conventions rather than measuring them.
C10b added a fourth: **`hitTestFrame` must be scoped to the page, not to
`graph.rootId`** — the SDK's root is a zero-sized document `FRAME` above the
`CANVAS`, and scoping there finds nothing at all. The open item it left — a drop
losing the node's position, because the drop was one `move-node` with no
geometry beside it — was closed on 2026-08-22.

**C7's hug-flip criterion was verified on 2026-08-22 — it failed, and is
fixed.** The preview burned the flip: `applyProp` asked the scene node, which
the gesture's own first preview had already moved. It now asks the document.
See [C6 / C7](#c6--c7-the-panel-becomes-a-real-inspector--m--m) for the
mechanism, which is worth reading before writing any other gesture that
previews before it commits.

The next pieces, in order:

| Story | What | Size |
|---|---|---|
| **F14** | `retag`, so an element's tag can change without a reprint | S |
| **F5 (rest)** | Convert to slot, the first fill by drop, reset and delete contents | M |
| **F3b** | Authoring an override — the half of F3 that is not built | M |

**What the viewer is now**, since two specs changed it and the older prose below
still describes the earlier shape in places: three panes, **Layers | Canvas |
Inspector**. The layers rail reads from the parsed document rather than the
scene graph, so one gesture writes one patch. It navigates, hides, renames,
drags to reorder and reparent, and is operable from the keyboard. Every colour
and metric lives in `packages/viewer/src/theme.css`; no component contains a raw
colour. The intent Markdown is parsed and never written to, but no longer
displayed.

**Working agreements this repo has settled on**, worth knowing before you edit:
judgement belongs in pure modules (`layer-rows.ts`, `layer-moves.ts`,
`layer-keys.ts`) with the `.vue` files as glue, because the canvas render path
cannot be driven headlessly (spike S1); address algebra has exactly one home
(`isWithin` in `@uidx/format`) and a second copy is a defect; and a fresh clone
fails five `packages/cli` tests until `pnpm build:cli` runs, because they exec
`dist/uidx.js` and `dist/` is gitignored.

## Where things stand

| Phase | State | Notes |
|---|---|---|
| **0 — SDK spike** | ✅ complete | Go/no-go passed. [Findings](phase-0-findings.md) corrected several spec assumptions |
| **1 — format** | ✅ complete | `@uidx/format` and `uidx check` |
| **2 — one-way live** | ✅ complete | `uidx open` serves a socket-driven viewer with incremental updates |
| **2b — document model** | ✅ complete | **New.** ADRs [0003](decisions/0003-page-root-and-two-level-addressing.md) and [0004](decisions/0004-global-document-namespace.md): `<Page>` root, a document manifest, one global namespace. Epic G |
| **3 — property write-back** | ✅ complete | Exit criterion met: a 40px drag on a number produced one write, one `patch:applied` and a one-line diff. C5's deferrals all landed since: paint stacks and enums in C8, the inspector's Figma affordances in C9, unset properties in C7 |
| **3b — structural write-back** | ✅ exit criterion met; still growing | D3 (layers pane, drag to reorder/reparent) pulled forward by the Figma chrome work and shipped, D5 closed the mouse-only gap it left, and D6 cleared the four rail defects that work parked. **C10 is done**: C10a made the canvas editable — move, resize, rotate, nudge — and C10b made it rearrangeable, so a drop inside another frame reparents and keeps the node where the pointer left it. **D1 and D2 close it**: a toolbar draws the five §3.3 elements and the selection can be deleted. D7 (reorder a flowed child), D8 (images and vector content), D11 (the pen) and D12 (editing a path's points) were added later and are not part of the criterion. **Epic D is closed** |
| **4 — polish** | 🟡 partial | Diagnostics work landed early and `fmt` (A3) shipped inside Epic G; E4 (rebase a stale patch) and E5 (`uidx open` with no browser launcher) shipped 2026-08-22. `new` (A4), selection↔intent (E2) and the diagnostics quality pass (E3) remain |
| **5 — future** | 🟡 started | **Composition is usable end to end as of 2026-08-23.** F3 shipped `<Instance>`, global component resolution and overrides; F10 and F11 made a component from a selection and placed an instance from the toolbar; F6 let a component declare its properties and F7 let an instance fill them in, which is the pair that makes using a component *choosing its content* rather than reaching inside. F8 then gave a component its states — declared axes, one full tree per combination, laid out side by side, with an instance picking one through the same `props` object. F9 then gave the editor the set itself — add a state, remove one, grow or narrow an axis, rename a value across every page that names it. **Slots landed 2026-08-28** (F5): a component declares a hole, a consuming page fills it, and that fill is the first authored, selectable, patchable content ever to live under an instance. Still ahead: `retag` and the two slot gestures it gates (F14 and the rest of F5), authoring an override (F3b), adding or renaming a variant *axis* (the same patch-format problem `retag` solves one case of, see F9), libraries, export to Figma. Tokens moved into Epic G |

Packages: `@uidx/format`, `@uidx/schema`, `@uidx/server`, `@uidx/viewer`, `@uidx/cli`.
1792 tests, CI green on every push. The gate is format → lint → typecheck →
build → test → `uidx check` on the repo's own examples. Two watcher tests in
`@uidx/server` flake under a parallel run — see the C10 status doc.

### The document model reshaped the plan

Two ADRs landed on 2026-08-15 and they move work across phases:

- **A `.uidx` file is a page, not a component.** `<Page>` is the root and holds
  any number of components and frames (ADR 0003).
- **Component names and token paths are global to a document**, declared by a
  `uidx.json` manifest. No imports, no path or file qualifiers (ADR 0004).
- **`.fig` export is a design goal, not a Phase 5 story.** It is the argument
  that decided global naming, so F2 now grades the model rather than adapting to
  it.

The practical effects: a new **Epic G** lands before Phase 3; `uidx fmt` (A3) is
pulled forward to carry the address migration; tokens leave Phase 5 because
binding is a format concern; and the `fileId` the patch envelope needs is now
known before C1 is built rather than after.

### The Figma chrome work reshaped the plan too

A second spec landed on 2026-08-19 and pulls a piece of Phase 3b forward for a
reason unrelated to sequencing — the viewer looked and read like a debug view
of itself, and fixing that meant a real layer tree, which meant drag-to-reorder
already existed once the tree did. See
[the spec](superpowers/specs/2026-08-19-figma-viewer-chrome-design.md).

- **The three panes are now Layers | Canvas | Inspector**, not Intent | Canvas
  | Contract. `IntentPane.vue` is deleted and the intent Markdown is no longer
  displayed anywhere in the viewer — still parsed, still never written to
  (§3.1), just not shown. That supersedes **B3**.
- **D3 (the layers pane, with drag to reorder and reparent) shipped**, pulled
  forward out of Phase 3b. Rename — previously only sketched as something to
  land somewhere in Epic D — shipped alongside it, on the tree rather than the
  panel.
- **The tree reads from the parsed document, not the scene graph**, so a drag
  commits one `move-node` on drop with nothing to coalesce. That is also why it
  does not use the SDK's own `useLayerDrag`: on drop it calls
  `editor.reorderChildWithUndo(...)` directly against the scene graph, which is
  the exact double-write this design avoids.
- **C6 is untouched — still next.** This work built the rail and the visual
  system the inspector will sit in, not the inspector's own structure;
  `PropertiesPane.vue` lost its outline dump but is still the flat list C5 shipped.
- **Every colour and metric in the viewer moved into one token file**,
  `packages/viewer/src/theme.css`. No component may contain a raw colour — a
  constraint the plan stated but never assigned to a task, so it only ever
  bound *new* CSS. A review during the work found 29 raw colour literals
  surviving in `App.vue`, `CanvasPane.vue`, `ErrorBoundary.vue` and
  `PropertiesPane.vue` that no task closed, which is why an unplanned Task 10
  swept them into tokens.

Practical effect: Phase 3b stops being all-or-nothing. D3 is done; D1 and D2
are not.

### Delivered beyond the original plan

Work that was in the spec but had no story, mostly found by auditing §3–§11
against the implementation:

- **Canvas navigation and selection** (§7) — pan, zoom, click-to-select, hover.
  Deliberately not `useCanvasInput`, which would also enable editing the
  document before write-back exists. G7 completed it with Figma's deep-select
  gestures.
- **Per-pane error boundaries** (§11) — a canvas failure no longer takes the
  intent pane with it.
- **CI** — format, lint, typecheck, build, 832 tests and a dogfooding
  `uidx check` on every push.
- **Frontmatter shape validation and the unknown-prop lint** (§3.2, §3.3).
- **A measured parse budget** (§5) — which turned out to be missed, and is now
  met; see below.

### Known problems — cleared

All five were fixed before Phase 3 started, on the reasoning that C1 is the
first story that writes to a user's file and every one of them touches the path
it writes through.

| | |
|---|---|
| ~~Parse budget missed~~ | **Fixed.** 13.6ms → **8.0ms** for 511 lines, against §5's 10ms. One cause: `micromark-extension-mdxjs` runs acorn over every expression and stores an estree nothing reads, since `values.ts` re-parses attribute values under the restricted §3.3 grammar anyway. Composing `mdxJsx` + `mdxExpression` + `mdxMd` without `acorn` removes the JavaScript parse and, with `mdxjsEsm` gone, makes an `import` in the contract region the error it always should have been |
| ~~`applyPatch` parses twice~~ | **Fixed.** 27.7ms → **6.4ms**. The validating parse (§9.5) is inherent — it checks a document that did not exist until the call. The resolving parse was not: `applyPatch(source, patch, { document })` takes the document a `FileSession` already holds, and rejects one that does not describe the source it is patching |
| ~~Document load is parse-bound~~ | **Fixed**, both halves. 362ms → **128ms** for 20 pages falls out of the parser work above (18ms → 6.4ms per page); the rest is that `createUidxServer` now boots Vite *concurrently* with the load rather than after it, so what remains overlaps work that has to happen anyway. `snapshot()` also puts the entry page first, so the page the author asked for does not queue behind pages they are not looking at. `document-perf.test.ts` now bounds the per-page figure, which is the one comparable to §5 — a whole-document bound would pass or fail on page count |
| ~~Text blocked offline~~ | **Fixed**, and the diagnosis in the old entry was half right. The chain is: a missing glyph raises a font demand; `renderText` draws *nothing* for a node whose readiness is `pending`, and only its `exhausted` branch reaches the fallback. An unreachable provider therefore does not degrade text, it holds the node in `pending`. `fonts.ts` now names the providers it disables and refuses the fetch outright, so the demand settles at once. And the viewer reads the bundled faces' `cmap` (`glyph-coverage.ts`) to say *which* characters cannot draw and in which node, so the blank box stops being silent |
| ~~No lint/format tooling~~ | **Fixed.** ESLint 9 flat config and Prettier, both in the CI gate ahead of typecheck. Prose is excluded from Prettier deliberately — the ADRs and this file are hand-wrapped, and reflowing them is a diff nobody can review. The first run found dead code in `patch.ts` and raw HTML reaching `v-html` in the intent pane; both are fixed |
| ~~Pan and zoom crawl on a large page~~ | **Fixed** (2026-09-04), and it was never the renderer. Meridian's atlas page is 11.5k scene nodes; a wheel tick took 220–420ms because the viewer's gestures called `requestRender`, which bumps the editor's `sceneVersion` and so discarded open-pencil's cached picture of the whole page on every frame — the page was re-recorded per tick instead of replayed. Viewport and hover changes now call `requestRepaint` (13ms → the picture replays), and `CanvasPane` renders on two stacked canvases, `scene` under `overlays`, which lets the renderer keep the page as a raster while the camera moves: a pan or zoom is then one image blit, measured 0ms, with a crisp re-render once the input goes quiet. The layers rail was the other half: 11.5k rows put ~90k nodes in the DOM, which made *any* DOM write — the status bar's per-tick camera readout — a 15–20ms relayout, and a selection a 300–800ms re-diff. The rail now renders only the rows near its scroll viewport (`layer-window.ts`) on a spacer the height of the list, opens closed below the top level past 200 rows the way Figma opens a file, and the readout is written once per frame. Same page after: 473 DOM nodes, 204MB heap where it was 255MB |
| ~~Workspace packages ship TS source~~ | **Fixed.** `format`, `schema` and `server` build to `dist` and export it. The CLI bundles nothing and resolves them at run time, which is what let its `dependencies` drop from sixteen entries to the two libraries it actually imports — the bundle went 68 KB → 19 KB with it. A `development` export condition keeps this repo's own typecheck and tests reading source, so no build stands between an edit and a test run |

### Known problems — open

One, and it is waste rather than a defect. The other — changed artwork never
reaching the screen — is fixed; see G10.

| | |
|---|---|
| **One image is fetched twice per session** | `CanvasPane` and the thumbnailer each hold their own `createAssetStore()`, so viewing a page's tile and then opening that page issues two `GET /__uidx/asset/…` for the same path. Waste rather than a defect: it is the origin the viewer is already served from, with the browser's HTTP cache in front of it, and the second copy of the bytes is dropped when the pane unmounts. The fix is one store owned by `App` and passed to both — deferred because `CanvasPane`'s store is also wired into its drop-target, SVG-import and D8 image-placement paths, and moving ownership under them earns less than it risks — S |

Roles used below:

- **Author** — designer or engineer editing a `.uidx` file or its canvas
- **Reviewer** — someone reading the diff in a pull request
- **Agent** — an AI tool generating or refactoring `.uidx` files offline
- **CI** — the automated gate

Sizing is relative (S / M / L). Spec phase in brackets.

---

## Epic A — Finish the format and its CI gate  [Phase 1 / 4]

The library exists; the tooling around it does not.

### A1. `uidx check` as a CI gate  — S  [Phase 1]

> **✅ done**
> As **CI**, I want a command that validates every `.uidx` file in the repo and
> fails the build on error, so that a malformed design contract can never merge.

- `uidx check <glob>` parses and validates every match.
- Diagnostics print as `file:line:col severity CODE: message` (spec §8).
- Exit code 1 if any diagnostic is an error, 0 otherwise; warnings do not fail.
- A directory or glob with no matches is an error, not a silent pass.
- `--format json` emits machine-readable diagnostics for editor integration.

*Everything needed is already exported from `@uidx/format`.*

### A2. Audit §3.3 against the scene graph  — M  [Phase 1]

> **✅ done**
> As an **Author**, I want the documented property vocabulary to cover what the
> renderer can actually do, so that I am not blocked by a property the format
> cannot express.

- Every field of `SceneNode` is triaged: mapped, deliberately excluded, or deferred.
- `primaryAxisSizingMode`, `counterAxisSizingMode`, `textAutoResize` and
  `vectorPaths` are written into the spec (all four are already implemented).
- Each excluded field carries a one-line reason.
- The `FILL` sizing value gets a decision — `SceneNode` supports it but Figma's
  `AUTO`/`FIXED` spelling cannot express it.

*Rendering the spec's own canonical example needed four undocumented props. That
is a strong signal the vocabulary was drafted from memory; assume more gaps.*

### A3. `uidx fmt`, and the legacy migration  — M  [Phase 2b]

> **✅ done**
> As an **Author**, I want to canonicalise a file's formatting on demand, so that
> hand-written and agent-written files converge on one house style.

- `uidx fmt <file>` rewrites via `emitDocument`, which is already idempotent.
- Prompts before overwriting unless `--yes`.
- `--check` reports whether the file is already canonical without writing.
- Output matches what `insert-node` produces, so created nodes never churn (§9.5).

**Pulled forward from Phase 4, and grown to M**, because ADR 0003 changed the
shape of every existing file. `--migrate` does the mechanical part:

- Adds the now-mandatory `name` to the root component, taken from the
  frontmatter `id` — the last moment that mapping is still true (ADR 0003 §4).
- Moves `status` and `version` out of frontmatter onto the component, keeping an
  attribute already on the element in preference to the frontmatter copy.
- Proves the result by parsing it, and reports the remaining diagnostics against
  the *migrated* text when it cannot — pointing at the original would name lines
  that no longer describe the failure.

Two bullets this story originally carried were wrong, and are dropped:

- *"Wraps a bare `<Component>` root in `<Page>`"* — nothing to do. A bare root
  already parses as sugar, and `emitDocument` materialises the wrapper when it
  prints, so plain `fmt` does this by construction.
- *"Rewrites addresses to `entity#path`"* — no file contains an address. They are
  derived from names at parse time. This becomes real only when `<Instance>`
  lands (F3) and override keys put a stored address in a file.

And one was inverted: *"refuses to run on a document that does not currently
parse"*. `--migrate` exists precisely for documents that no longer parse; what it
refuses is to **write** a result that still does not.

### A4. `uidx new`  — S  [Phase 4]

> ⬜ not started
> As an **Author**, I want to scaffold a valid file, so that I start from
> something that renders rather than a blank page.

- `uidx new page <name>` writes a `<Page>` from the §3.5 template.
- `uidx new tokens <name>` writes a `<Tokens>` file (G4).
- `uidx new document` writes a `uidx.json` manifest (G3), refusing if the
  directory is already inside one.
- Refuses to overwrite an existing file.
- Output passes `uidx check` and renders in the viewer.

---

## Epic B — One-way live preview  [Phase 2]

The first independently useful product: a live spec previewer. No write-back.

### B1. Serve the viewer from a programmatic Vite server  — M

> **✅ done**
> As an **Author**, I want `uidx open ./button.uidx` to start a local server and
> open my browser, so that previewing a component takes one command.

- `@uidx/server` boots Vite programmatically and serves the prebuilt viewer.
- `--port` (default 4400) auto-increments when busy.
- No user-facing build step; the viewer ships as `dist/`.
- No network calls at runtime (G7).

### B2. Watch the file and push changes  — M

> **✅ done**
> As an **Author**, I want the canvas to update when I save in any editor, so
> that my editor and the preview stay in sync without me switching tools.

- chokidar watches the target file; on change it reads, hashes, parses.
- Valid parse broadcasts `file:changed` with an incremented `revision`.
- Parse failure broadcasts `file:error` with diagnostics and **does not** crash
  the server or clear the last good canvas.
- Recovery is automatic on the next valid save.

### B3. Three-pane viewer shell  — M

> **Superseded** — see the
> [2026-08-19 Figma chrome spec](superpowers/specs/2026-08-19-figma-viewer-chrome-design.md)
> As an **Author**, I want intent, canvas and properties side by side, so that I
> read a component's rules and its geometry together.

What shipped, and stood until 2026-08-19:

- CSS grid: Intent | Canvas | Properties.
- Intent pane renders the markdown region read-only, plus a frontmatter badge row
  (`id`, `status`, `version`, `tags`).
- The tool never writes to the intent region (§3.1).

The panes are now Layers | Canvas | Inspector. `IntentPane.vue` is deleted and
the intent Markdown is not displayed anywhere in the viewer — it is still
parsed and still never written to, it is simply not shown. See "The Figma
chrome work reshaped the plan too", above.

### B4. Harden the canvas pane  — M

> **✅ done**
> As an **Author**, I want the canvas to render reliably offline, so that the
> viewer works on an air-gapped machine.

Carries the Phase 0 findings into real code:

- `canvaskit.wasm` vendored as a static asset, not fetched from a CDN.
- Inter faces from `@open-pencil/core/assets` fed to `fontManager` via
  `markLoaded` + `setHostFontLoader`, **before mount**. Two earlier approaches
  failed: `EditorOptions.loadFont` is never called, and registering into the
  renderer's `TypefaceFontProvider` is discarded the next time `createSurface`
  rebuilds it — after which text keeps *measuring* correctly while the glyphs
  silently vanish.
- `esbuild` / `optimizeDeps` / `build` targets set to `esnext` for yoga's
  top-level await.
- `zoomToFit()` on first load only. Refitting after every update resets the
  camera on every save — superseded by B7.
- `computeAllLayouts` runs before first paint (inside `toSceneGraph`); the SDK
  does not lay out on construction, so without it every frame stays 100x100.

### B5. Parse-error overlay  — S

> **✅ done**
> As an **Author**, I want a readable error over the last good render when my
> file is broken, so that I can fix it without losing my place.

- `file:error` shows diagnostics with line/column over a dimmed last-good canvas.
- Overlay clears automatically on the next valid `file:changed`.
- An SDK render throw is caught by an error boundary; the intent pane survives (§11).

### B7. Reconcile incoming documents instead of replacing them  — L

> **✅ done**
> As an **Author**, I want an external save to update only what changed, so that
> my zoom, my selection and my place on the canvas survive every edit.

**This story contradicts spec §6.2 on purpose.** The spec says the viewer should
"replace the workspace document" on `file:changed`. That is correct-but-coarse:
it rebuilds every node for a one-character edit and, as currently written, resets
the camera on every save. Watching it happen makes the problem obvious — zoom
into a detail, save, and you are thrown back to a fit-to-screen view.

- Diff the incoming `UidxDocument` against the current one by address.
- Apply only real differences: `graph.updateNode` for changed props, and
  create / delete / reparent for structural changes.
- Preserve viewport, selection, undo history and text-edit state across an
  external save.
- No `zoomToFit` except on first load and on explicit user action.

**Why this is tractable here:** scene node ids *are* UIDX addresses
([ADR 0001](decisions/0001-node-addressing.md)), so nodes match across two
documents by address with no heuristics and no keying problem. This is a direct
payoff of that decision — the same property that makes the bimap free makes
reconciliation a straight tree-walk.

Note it is the mirror image of `fromSceneChange`: that one turns scene mutations
into file patches, this one turns file changes into scene mutations. Worth
implementing them next to each other in `@uidx/schema` so the prop table is used
in both directions and neither drifts.

**Interim (S), if the full reconcile is deferred:** save and restore viewport and
selection around `replaceGraph`. Cheap, and it removes the most visible
irritation, but it still rebuilds the tree and still loses undo history — so it
is a stopgap, not the story.

### B6. `uidx open` boot sequence  — S

> **✅ done**
> As an **Author**, I want fast, obvious failure when my file is invalid, so that
> I am not staring at an empty browser tab wondering what went wrong.

- Resolve path → parse once → on failure print diagnostics and exit 1.
- On success start the server, print the URL, launch the browser
  (`--no-open` skips), watch until SIGINT.
- `--verbose` logs parse timings, WS traffic and patch spans.

---

## Epic G — The document model  [Phase 2b]

Turns one file into one page, and the repo into one document with a global
namespace. Comes before Phase 3 because it changes the address space that every
patch is written against, and because `.fig` export (F2) is only mechanical if
the model is Figma's from the start.

**Exit criterion: a document holding several pages, one of them a token file,
renders any page with components and tokens resolved by bare name — and
`uidx check` reports an unresolved reference, a duplicate name and a cycle, each
against both locations.**

### G1. `<Page>` root and the two-level grammar  — M

> **✅ done**
> As an **Author**, I want a file to hold several components, so that I can see
> and edit a set of related entities together instead of one per tab.

- `ELEMENTS` and `CONTAINER_ELEMENTS` gain `Page`; the flat whitelist check at
  `parse.ts:155` becomes per-level (ADR 0003 §1).
- `<Page>` takes any number of children; `<Component>` keeps its one-child rule.
- The root check at `parse.ts:424` accepts `<Page>`, or a bare `<Component>` as
  sugar — which then **requires** a `name`, inverting the rule at `parse.ts:173`.
- `status` and `version` move from frontmatter onto `<Component>`; no key is
  valid in both places (ADR 0003 §3). `status` is required on every component,
  for the reason §3.2 required it of a file. Metadata is `METADATA_ATTRS` in
  `@uidx/format` rather than a `KNOWN_PROPS` entry, so it never reaches the scene
  graph and never trips the §3.3 lint — and the drift test pinning `KNOWN_PROPS`
  to the scene vocabulary stays true.
- `toSceneGraph` maps `<Page>` onto the graph's existing page node, so the
  scene-id exception moves off `<Component>` and every component gets its plain
  address as its id.
- `computeAllLayouts` runs per top-level child, not once against a single root.

### G2. Addresses become `entity#path`  — M

> **✅ done**
> As an **Agent**, I want one unambiguous address law, so that a generated patch
> targets the same node the file does.

- Page-absolute addresses everywhere; component-relative only in override keys
  (ADR 0003 §2).
- `#` bounds the entity, so `/` stays free as a name character the way Figma
  groups components (ADR 0004 §3).
- The component-relative form is the substring after `#` — no segment arithmetic.
- `UidxPatch` addresses, the schema bimap and diagnostics all move together;
  splitting them across stories leaves the tree addressable two ways.

*Landed with G1 — separating them would have left the tree addressable two ways,
since introducing a page level changes every address by itself. `isWithin` and
`addressDepth` live in `@uidx/format` because the patcher and the reconciler both
had a hand-rolled `startsWith(addr + '/')` that a grouped component name breaks.
`uidx fmt --migrate` (A3) is still what makes this landable on files that already
exist.*

### G3. The document manifest  — M

> **✅ done**
> As an **Author**, I want the tool to know which files belong together, so that
> a component name means one thing across my whole design system.

- `uidx.json` at the workspace root: `id` plus a `files` glob (ADR 0004 §1).
- `uidx open <page>` walks up to the nearest manifest and loads every member.
- A page outside any document is an error naming the fix, not a silent
  single-file fallback.
- `uidx check` takes the document as its default target; the glob argument stays
  for CI over a subset.
- **One document per workspace**, spanning every design system in it. A design
  system is a directory and a name prefix, not a boundary — so no `systems`
  field, and no per-system namespace. `uidx new document` refusing when already
  inside one is the normal guard rather than an edge case (A4).

*Measured rather than assumed, and the worry this story carried was aimed at the
wrong thing. `applyPatch`'s double parse is on the write path and has nothing to
do with document load. What load actually costs is 362ms of parsing for 20 pages
— read time is 0.4ms, so I/O is not the lever. If startup needs to get faster the
answer is a faster parser, a cache, or lazy loading of pages the open page does
not reference; `document-perf.test.ts` is there to tell you whether it worked.*

### G4. Global symbol table and reference diagnostics  — M

> **✅ done** — the deferred half landed with G5 and F3, which is when the graph
> gained edges. `symbols.ts` reports unresolved references with `suggest()`
> near-matches and detects cycles by DFS, and `uidx check` runs the whole pass
> (`check.ts` calls `buildSymbolTable`). The row said "partial" long after it
> stopped being true
> As **CI**, I want an unresolved or ambiguous reference to fail the build, so
> that a broken design system can never merge.

- The `id → file` map at `check.ts:45` generalises to every component name and
  variable path.
- Duplicate names report against **both** locations, not just the second. This is
  the expected way two design systems in one workspace collide, so the message
  should suggest `/` grouping rather than reading as a corrupt-file error.
- Unresolved references name the missing symbol and suggest near-matches from
  the table (shares machinery with E3).
- ⬜ Reference cycles detected by DFS. **Moved to F3**, where the edges are born.
  A cycle needs references, references need a syntax, and that syntax is decided
  by `<Instance>` (F3) and token aliases (G5) — a DFS over a graph with no edges
  would be theatre, and would be designed against a guess. F3 carries the
  requirement that it exist *before* the first instance can create one.
- Unresolved-reference diagnostics are likewise deferred to whichever of G5/F3
  lands first. `suggest()` is built and tested now because the *hint* is what
  global naming costs a diagnostic — "not found" cannot say which file it should
  have been in — and it is shared with E3.

### G5. Token files and alias binding  — L

> **✅ done**
> As an **Author**, I want values to reference the design system rather than
> repeat its numbers, so that the scale is enforced by the format.

- A token file is a `.uidx` with `<Tokens>` where a page has `<Page>`: same
  extension, same parser, same frontmatter, same `uidx check`.
- Figma's vocabulary per ADR 0002 — `<Collection>` and `<Variable>`, not a
  bespoke token tree. Modes are deliberately deferred; note the gap rather than
  half-building it.
- Binding is written readably — `cornerRadius="{radius#md}"` — and the schema
  layer produces the engine's alias shape. The file gets the designer's spelling,
  the schema layer absorbs the serialization (ADR 0002).
- **`#`, not `.`.** ADR 0004 §2 sketched `{radius.md}` before §3 of the same ADR
  settled `#` as the entity boundary, and the two were never reconciled. A token
  address is `collection#variable` — the same law as a node address — rather than
  a third separator borrowed from other token tools. The ADR is amended.
- The validator accepts an alias wherever a value is legal, so a number-typed
  prop can hold one.
- **Cycle detection landed here, not in F3.** G4 deferred it on the reasoning
  that references need a syntax and `<Instance>` would be the first to have one.
  Token aliases got there first: a `<Variable>` whose value is `{other#token}`
  *is* a reference, and a chain of them closes a loop. So the DFS is built
  against real edges, which is exactly what that deferral was protecting. F3
  inherits it rather than owning it.
- Unresolved references landed with it, for the same reason, with near-match
  suggestions from `suggest()`.
- The §3.3 property whitelist does not apply to the token tree: `value` is no
  more an unknown scene property than `status` is.
- `applyTokens` registers collections on a `SceneGraph`, separate from
  `toSceneGraph` because variables live beside the node tree rather than in it —
  and each refuses the other's document shape rather than half-working.
- The intent region of a token file documents *why* the scale exists. This is
  the point of using `.uidx` rather than JSON, and it should be in the template.

*Moved out of Phase 5 (was F1). Binding is a format concern, and the properties
panel in C5 is generated from it — building C5 first means building it twice.*

Render-time resolution landed with **G6**. Modes are still deliberately
deferred; the gap is real and named rather than half-built.

### G6. `FileSession` becomes a document workspace  — L

> **✅ done**
> As an **Author**, I want editing a component to update every page that uses
> it, so that the document behaves like one system rather than several files.

- ✅ A session per member file; per-file revisions and per-file echo ledgers,
  which come free because each `FileSession` already owns both. Revisions stay
  per page rather than becoming document-wide — a document-wide counter would
  make every save look like a change to every page, which is exactly what C3's
  `baseRevision` check needs to tell apart.
- ✅ A reverse dependency map: editing a token re-broadcasts every page bound to
  it. Rebuilt wholesale on any change rather than maintained incrementally — it
  walks documents already in memory with no I/O, and a second code path could
  disagree with the first about what a page declares.
- ✅ Every protocol message carries the page it concerns, plus a
  `document:opened` naming the shape on connect.
- ✅ **Fixes the `FileSession` reload race.** Reloads are serialised through a
  promise chain, so two rapid saves can no longer interleave and commit the older
  document at the higher revision.
- ✅ `createUidxServer` opens the workspace and sends every page on connect,
  preceded by a `document:opened` naming the shape. It falls back to a lone
  session when there is no manifest, which is what the headless tests use.
- ✅ The viewer holds every page and resolves an alias when it renders, so
  `cornerRadius="{radius#md}"` paints as 8. A token change rebuilds rather than
  diffs: the page's own document has not moved, so a diff would correctly find
  nothing to do while the values every node resolved against have changed.
- An unresolved token falls back to the engine default with a warning rather
  than drawing the literal `"{radius#md}"`. `uidx check` is where that is
  reported properly.

*`document.ts` and `symbols.ts` moved from `@uidx/cli` into `@uidx/server`,
behind subpath exports so `uidx check` still does not drag Vite in. The CLI
depends on the server, so a live document could not stay in the CLI.*

### G7. Figma's selection model  — M

> **✅ done**
> As an **Author**, I want to select a nested element, so that I can inspect and
> eventually edit anything on the page rather than only its outermost frame.

Today `selectAtPoint` is a shallow hit test scoped to the page, so the only
selectable node is the top-level frame. Nothing nested can be reached.

- Click selects a top-level entity; double-click enters it and selects the child;
  Cmd/Ctrl+click deep-selects to the leaf.
- Escape steps *out* one container level, and only clears when already at the
  top — it currently clears unconditionally (`useCanvasControls.ts:184`).
- Hover honours the same modifier, or the "obvious what a click would hit"
  promise at `useCanvasControls.ts:145` breaks whenever Cmd is down.
- Deep select skips nodes absent from the bimap, or the properties panel offers
  controls for something no patch can reach (see D4).

*The SDK had every piece: `hitTestAtPoint(x, y, deep)`, `enterContainer` /
`exitContainer`. Double-click was deliberately left unbound for exactly this.*

Two behaviours the story did not name, found by building it:

- **Entering a leaf is a no-op, not a descent.** Double-clicking a node with
  nothing inside it finds the same node again; stepping in anyway would strand
  the author inside something with no children and no visible way back.
- **Clicking empty space steps out**, not merely deselects — which is what makes
  double-click-in and click-out feel symmetrical.

**Unblocks C5.** A properties panel that could only reach the outermost frame was
not worth building; now it can address anything the file declares.

### G8. Typed tokens, modes and scopes  — L

> **✅ done** — shipped 2026-08-25/26, thirteen tasks, five packages. Spec:
> [typed tokens and modes](superpowers/specs/2026-08-25-typed-tokens-and-modes-design.md),
> plan: [the same](superpowers/plans/2026-08-25-typed-tokens-and-modes.md)
> As an **Author**, I want one token to hold different values in different
> contexts, so that a light and a dark theme are one variable rather than two
> named `surface-light` and `surface-dark`.

*Recorded late.* The work shipped without a story here at all — it was planned
and executed straight from its spec, and the code cites "story G8" in five
files (`types.ts`, `parse.ts`, `scope-for-prop.ts`, `migrate-tokens.ts`,
`to-scene.ts`) that this list never defined. Written up now so the number means
something to whoever greps it.

- **A `<Variable>` declares its `type`** — Figma's four, `COLOR | FLOAT |
  STRING | BOOLEAN`. Required, because Figma picks a type at creation and so do
  we; `uidx migrate tokens` writes it into files that predate the rule.
- **A `<Collection>` declares `modes` and a `<Variable>` holds one `<Mode>` per
  column.** A `<Mode>` is not addressable: a binding names `{semantic#surface}`
  and the render context picks the column, so giving it an address would
  collide with a variable named `surface/light`.
- **A node selects a mode** with `modes={{ collection: mode }}`, and the tuple
  rides *down* the renderer's existing descent as inherited context — Figma's
  `explicitVariableModes` / `resolvedVariableModes` split. Nothing ever walks
  up, which is what keeps it O(1) per node.
- **Resolution changed shape**: a flat `address → literal` map became a pure
  `TokenIndex` plus `TokenResolver.resolve(tuple)`, memoised per tuple.
- **`scopes` gate the picker** — Figma's 22 plus `SPACING` — so a
  `CORNER_RADIUS` variable is offered for corner radius and not for gap. A
  binding outside a variable's scopes warns rather than failing the check.
- Eight codes, UIDX122–129, plus UIDX408/409 in the workspace band. Two
  deviations from the plan are recorded in it: `fitsVariableType` rather than a
  second `matchesType`, and the last two codes landing in the server's band
  because that is where the cross-page pass lives.

**Still open from this work:** no example or design file exercises `<Mode>`,
`modes=` or `scopes=`, so the dogfooding gate never covers the newest half of
the grammar. The tests do; `uidx check examples` does not.

### G9. The document has a home page  — M

> **✅ done**
> As an **Author**, I want to see every page of the document at once, so that I
> can find the sheet I want by looking at it rather than by remembering what its
> name means.

The rail (G6) lists pages by name. A name is enough to switch between three
sheets and not enough to navigate a design system — `design/option-4` is eight,
and its own `home.uidx` draft has drawn the answer since before the rail
existed: a grid of live-rendered wells, the two inventories a design system has,
and the counts across the top.

- The dashboard is what a URL carrying no `?page=` means. A one-page document
  opens its page instead — there is nothing to survey, and `uidx open one.uidx`
  must behave as it did.
- Every stat is counted from documents the shell already holds. The draft's own
  anti-pattern — *NEVER show a stat that is not derivable from the file* — is
  enforced by construction: `home-model.ts` is a walk over `doc.tree` and a read
  of the token index, and there is nowhere in it to put anything else.
- A thumbnail is `toSceneGraph` plus the SDK's `renderThumbnail`, through one
  1x1 raster surface built the way `@open-pencil/core`'s own headless helper
  builds one — *not* through that helper, whose `initCanvasKit` resolves
  `canvaskit-wasm/full` by Node path and would fetch a second 7 MB binary in a
  browser. `getCanvasKit` and `fontManager` are both already-warm singletons, so
  the dashboard costs one surface and no second download.
- Cached on `file@revision`, so a save re-renders exactly the page that was
  saved and returning from a page is free.

**No server work and no protocol message.** ADR 0004 §1 made document load
mandatory, so the client has already been holding every page since G6 — the
dashboard is a view of state the app maintains anyway, which is what makes it
impossible for it and the canvas to disagree.

*Measured on the 25 scene pages of `design/option-1..4` — the largest 1586
scene nodes once instances are expanded, one page 1440x3616: ~100 ms to boot the
renderer, then a median of 73 ms per tile and 2.1 s for all 25 serialised. In
the browser, cold, including the wasm: 8 tiles in 3.8 s, and 3 ms to restore
them all from cache on the way back.*

Four things the story did not name, found by building it:

- **PNG, not SVG.** `renderNodesToSVG` emits `<text font-family>` and hands the
  text to the browser's font stack; Inter is fed to Skia, not installed as a web
  font, so every tile would substitute a face and drift. The raster path draws
  the same glyphs the canvas does, because it *is* the canvas's rasteriser.
- **The tile mounts before its page arrives.** The dashboard renders as soon as
  `document:opened` names the pages, which is before any `file:changed` carries
  one. A draw driven by a one-shot trigger finds nothing, and never asks again —
  empty wells for the whole session, and the larger the document the wider the
  window. The draw is a condition re-evaluated on every change instead.
- **`IntersectionObserver` is an optimisation, never the gate.** It needs a
  rendering lifecycle to deliver its first callback and there are environments
  that do not drive one — a headless browser (S1 again), a tab backgrounded at
  first paint. Visibility is measured directly at mount; the observer only
  carries the tiles that arrive by scrolling.
- **A tile resolves the document, not the page.** Built with only `tokens`, an
  `<Instance>` had no definition to expand and contributed no geometry at all —
  `properties.uidx` is 211 instances and drew nearly empty. The build takes the
  same four options `CanvasPane` does: `resolveComponent`, `resolveAlias` and
  `resolveAsset` alongside `tokens`. Three of the four resolve references out
  of *other* pages, which is the point of ADR 0004 §2 landing on the client.
  Artwork goes through one `createAssetStore` for the whole document — a path
  is document-relative (ADR 0006 §3), so a logo on six pages is one fetch — and
  a reference that fails draws as a placeholder and is retried on the page's
  next render, which is what a save produces.

  It also puts a second half on invalidation: a component edit changes every
  page that instances it while none of their revisions move, so a page holding
  instances is keyed on a definitions stamp as well — the coarse answer
  `CanvasPane.definitionsMoved` already settles for.

---

### G10. Changed artwork reaches the screen  — S

> **✅ done**
> As an **Author**, I want an image I have just re-exported to appear in the
> editor, so that I can iterate on artwork without restarting the server.

A `.uidx` file is watched by its `FileSession`. The bytes behind an image paint
had nothing watching them at all, and the viewer's asset store holds them by
path for the life of the session — so overwriting `assets/logo.png` left the
canvas *and* its thumbnail drawing the old picture, with nothing that could
correct either. No `file:changed` fires, so no revision moves, so neither the
canvas rebuild nor the thumbnail cache key had any reason to think anything had
happened.

- The server watches **the referenced set, not the asset folder**: `assetRefs`
  over the parsed pages, re-synced from `reindex()` — which already runs on
  every page change, so a page that starts or stops naming an image adjusts the
  set without anything else having to notice. A document with no artwork
  allocates no watcher at all.
- Watched as **directories, filtered to the reference set**. Two ordinary cases
  make per-file watches wrong: artwork that does not exist yet has nothing to
  attach to and chokidar establishes no watch, and image tools save by writing a
  temporary file and renaming it over the target, which replaces the inode a
  per-file watch is attached to. A non-recursive directory watch sees create,
  modify, rename and delete alike; the filter is what stops the other ninety-
  eight files in `assets/` from being announced.
- `asset:changed` carries the `src` and no bytes — the client's store fetches
  over the route it always does; this only says what it holds is stale. Not
  page-addressed, because a `src` is document-relative (ADR 0006 §3) and any
  number of pages may paint with it.
- `AssetStore.invalidate(src)` is the client half, and it clears the *failure*
  as well as the bytes, or a file that has since been saved would keep being
  reported missing.

**The real defect was on the tile, and it was older than this story.** A
thumbnail redrew when its own `card.revision` moved, and a page draws through
components and artwork that live in *other* files — neither of which touches
this page's file. So the `definitions` stamp G9 added for component edits was
never reaching the tile either: it changed the cache key and nothing re-asked.
`PageThumb` now redraws on a stamp assembled by the shell, which is the only
thing that sees the whole document, and folded in per page — a page with no
instances is unmoved by a component edit, a page with no image paint by
artwork appearing.

Two things found by building it:

- **chokidar does not watch what does not exist.** A first attempt watched the
  referenced files; the test for artwork appearing later failed, and a probe
  showed no watch is established for an absent path. An earlier probe had
  *passed* only because a sibling file in the same directory pulled in the
  directory watch that was really doing the work.
- **`ignoreInitial` swallows a write that lands before the first scan.** About
  7ms here. It cannot be lost in use, where artwork changes long after the
  server started, and it is lost about half the time by a test that writes on
  the next line — so the watcher exposes `whenReady()` and the tests await it
  rather than sleeping.

---

---

## Epic C — Property write-back  [Phase 3]  ✅

The first half of bi-directional editing. **Exit criterion (spec §12): dragging a
padding value for five seconds produces exactly one file write, a one-line diff,
and zero flicker.**

**Met.** Driven against the running app rather than asserted: a 40-pixel drag on
a `fontSize` scrub produced one `node:patch` frame, one `patch:applied`, and a
diff of exactly one line. No echo — the watcher event the write caused was
swallowed by the ledger, so the revision went 1 → 2 and stopped there. The button
reflowed around the bigger text, and none of that computed geometry reached the
file, which is D4 doing its job on the live path.

### C1. Patch endpoint with atomic writes  — M

> **✅ done**
> As an **Author**, I want canvas edits to reach the file safely, so that a
> crash mid-write can never truncate my component.

- ✅ WS `node:patch` → `applyPatches` → write temp file → rename (§9.4). The temp
  name deliberately does not end in `.uidx`: `documentMembers` globs for that
  extension, and a manifest that briefly matched a half-written file would load
  it as a page.
- ✅ Acks `patch:applied` with the new revision, to the sender alone. A rejection
  is about one client's in-flight gesture and means nothing to the others; what
  they get is the `file:changed` the session broadcasts when a write lands.
- ✅ **The envelope names the page it targets** (ADR 0004), and `sessionFor`
  routes on it rather than on the connection.
- ✅ Structural ops apply one at a time with a re-parse between (§6.3) —
  `applyPatches` already did this, and now passes the session's own document to
  the first op so the write path costs one parse rather than two.
- ✅ Post-apply invariants: `applyPatches` refuses to return a document that does
  not parse, and the patcher already enforced sibling-name uniqueness and a pure
  block move.

Three behaviours the story did not name, found by building it:

- **A patch that changes nothing is not a revision.** Dragging a value back to
  where it started must leave the file, the diff and the revision counter alone,
  or every no-op gesture invalidates every other client's `baseRevision`.
- **Patches queue on the same chain as reloads.** They were separate at first,
  and a watcher event landing between reading `state.doc` and writing the result
  means patching a document the file no longer holds.
- **A refusal needs its own message.** `patch:stale` says "re-sync and retry";
  an unresolvable address or a failed write is not retryable, so `patch:rejected`
  carries a reason meant for the author.

### C2. Echo ledger  — M

> **✅ done**
> As an **Author**, I want my own edits not to bounce back at me, so that
> dragging never flickers or drops input.

- ✅ `WriteLedger` existed since B2 but nothing recorded into it; the write path
  now does.
- ✅ A watcher event whose hash is in the ledger is swallowed — no broadcast.
- ✅ The TTL is a named constant with a comment.
- **Recorded before the write, not after.** The watcher can fire while `rename`
  is still returning, and an echo arriving before its own ledger entry is exactly
  the flicker this exists to prevent. A failed write claims the entry back, or it
  would sit there and swallow the next genuine save that produced those bytes.

### C3. Revision tracking and stale rejection  — S

> **✅ done**
> As an **Author**, I want a hand edit and a canvas edit racing to fail loudly
> rather than corrupt my file.

- ✅ Every patch carries `baseRevision` **for the page it targets**; revisions are
  per-page after G6. The server rejects with `patch:stale` if it has moved on.
- ✅ Addresses resolve against the tree of the patch's `baseRevision` — enforced
  by rejecting anything written against another one, which is the strict reading
  and the only one that cannot apply an edit to whatever now sits at an address.
- ✅ The client discards optimistic state, re-syncs and says so. `patch-channel.ts`
  tracks what is in flight and answers the server's three replies as the three
  different things they are to a person: an ack is silent, `patch:stale` says
  somebody edited first and to try again, and `patch:rejected` passes the
  server's own reason through. Collapsing them into "failed" would leave the
  author unable to tell a race from a mistake.

### C4. Gesture batching  — S

> **✅ done**
> As an **Author**, I want a five-second drag to produce one line in my diff, not
> three hundred writes.

- ✅ Discrete edits (toggling `visible`, typing a string) apply optimistically and
  send immediately.
- ✅ Continuous gestures send nothing until commit.
- ✅ The rule turned out to be exactly as advertised: subscribe to `node:updated`
  and never to `node:previewUpdated`, and there is no state machine at all. The
  panel's preview path calls `updateNodePreview`, which repaints without
  emitting, so the canvas follows a scrub while the file does not hear about it.

*Measured on the real thing: a 40-pixel drag on `fontSize` produced **one**
`node:patch` frame, one `patch:applied`, and a one-line diff.*

**One thing the story did not name, and it is the sharp edge.** Applying an
incoming document mutates the graph, and mutation emits `node:updated` — the same
event a user's edit emits. Without a guard the server's own `file:changed` is
translated straight back into patches and posted to the server, which answers
with another `file:changed`. `applyingRemote` in `CanvasPane` is that guard. The
loop is not theoretical; it is what happens the first time these are wired
together.

### C6 / C7. The panel becomes a real inspector  — M + M

> **C6 ✅ done. C7 ✅ done**, one criterion since verified and failing — see
> [docs/properties-panel.md](properties-panel.md), and
> [the C6 plan](superpowers/plans/2026-08-17-properties-panel-c6.md) for what
> shipped
> As an **Author**, I want an inspector I can develop a design in, not just a
> list of the decisions already in the file.

C6 shipped: `prop-ui.ts` in `@uidx/schema` carries grouping, applicability,
control kind, enum domains and pairing for all 70 shown props, with two drift
tests; `editable.ts` reads it and `sectionsFor` builds the sections;
`PropertiesPane.vue` renders them through the SDK's section/grid/segmented
primitives with a new `PropertyField.vue` for the per-field markup. The look
follows Figma's inspector in the dark theme: paired X/Y and W/H as compact
boxes with letter prefixes inside, filled fields that only show a border when
engaged, checkbox-before-label boolean rows, section headers with a wired
chevron toggle. Two things the plan's inline code would have missed, caught in
review and live verification: the held-preview value for a scrub in flight now
travels into `PropertyField` (the plan predated that behaviour), and the
section header's slot `actions.toggle` had to be wired to a real button — the
jsdom test emitted `update:open` directly and could not see the dead click,
so it drives the button now. Writes are unchanged — verified live, a scrub is
still one one-line `set`.

C7 shipped: every property that applies to the selected element has a row,
carrying the value the engine resolves to and reading a step back, so the
authored rows keep the weight. Showing is not writing — nothing reaches the
file until a row is changed, and then it is one added attribute. The defaults
are *measured* rather than declared (`defaults.ts` builds a bare node of each
element and reads it back through the same `fromScene` mappings the write
path uses), because a hand-written table drifts and a dimmed row showing the
wrong value states something the document does not mean. Where unset means
"no constraint" — the min/max pairs, an auto line height — the row shows a
dash rather than a zero that would state a limit nobody set; W and H keep
theirs too, since the element default is not what a hugging node resolves to.

The D4 half landed with it: a panel edit carries authorship a reflow burst
cannot, so it says so and the derived-geometry check steps aside for exactly
the props named. Two defects in that signal were caught live, both the same
kind — a signal meant for one write leaking into the burst around it. It
vouched for every node in the burst, so one typed width wrote computed
geometry onto the Component and the text as well; it now names the node it
speaks for. And it flipped the hugging axis during *preview*, where
`runPreviewUpdates` downgrades the event so nothing persists, leaving the
commit nothing to flip and the file holding a width its own sizing mode
contradicted.

**Verified on 2026-08-22: the second of those two fixes did not hold. Fixed
the same day** — `authoredSizing` in `resize-writes.ts`, with the account below
kept because the shape of the mistake outlives it.
Typing `240` into the width of `Button/Primary#container` — a frame that hugs
on both axes — writes `width={240}` to the file and leaves
`primaryAxisSizingMode="AUTO"` untouched. The document now states a size and a
mode that contradict each other, which is what the flip exists to prevent.

The mechanism, from a probe on `applyProp` rather than a reading of the code:

| Event | Node's `primaryAxisSizing` | `sizingFlipFor` returns |
|---|---|---|
| preview, first keystroke | `HUG` | `{ primaryAxisSizing: 'FIXED' }` |
| preview, later keystrokes | `FIXED` | `{}` |
| **commit** | `FIXED` | `{}` |

The first preview *does* compute the flip and applies it to the scene node —
and `runPreviewUpdates` downgrades that event, so it never reaches the file.
But it has already mutated the graph. Every later preview, and then the commit,
asks a node that now reads `FIXED` whether it is hugging, gets "no", and writes
the width alone. The flip is not missing; it is spent on a write that by design
cannot persist.

`sizingFlipFor` is correct and its unit tests pass. They pass because they ask
it the question directly; nothing tests the question the *commit* asks, which
is the one that has already been answered by a preview.

**The fix follows E4's policy — the file is the source of truth.** The flip is
decided from the document (`resolve(current.tree, address)`, which `applyProp`
already reached for the positioning toggle two lines below), never from a scene
node an earlier preview has moved. `authoredSizing` reads what the file states
and, where it states nothing, the engine's own default through `defaultFor` —
which matters for a `<Component>`, whose hugging wrapper no file ever mentions.
The tests drive preview-then-commit, the only sequence that catches this;
`sizingFlipFor`'s own unit tests passed throughout and always would.

Verified in the browser on the repo's own example, all three paths: a width
flips the primary axis of a HORIZONTAL frame, a height flips the counter axis
and leaves the primary alone, and a width on a text that measures itself pins
`textAutoResize` to `NONE` and writes the measured height with it — the same
thing taking Absolute does for `x`/`y`.

**The general lesson, for any gesture that previews before it commits:** a
preview may move the scene, so the scene cannot be asked a question whose
answer the commit depends on. Ask the document.

**Still open:** clearing a set property back to unset, emitting `remove` — the
last criterion of the spec, and more wanted now that every property is one click
from being written.

C5 met its acceptance criteria but used one of the four headless primitives it
named, and what shipped is a flat list of whatever attributes the file declares.
The spec splits the fix in two:

- **C6 — structure.** Grouping, applicability and enum domains move into
  `@uidx/schema` as `prop-ui.ts`, because a panel "generated from the prop table"
  cannot be while the table knows only names and scene fields. Sections, paired
  X/Y and W/H rows, and real enum controls follow from it. Writes nothing
  differently, so it ships and reviews on its own.
- **C7 — unset properties.** Every applicable property shows, dimmed, with the
  default it resolves to; changing one emits an `add`. This is what turns the
  panel from a viewer of existing decisions into a tool for making them.

C7 also carries a defect the spec surfaced: **D4 silently drops an explicit
edit.** Typing a width into a hugging frame is discarded, because the derived-
geometry heuristic cannot tell a designer from a reflow. `fromSceneChange` gains
an `authored` signal, and setting a size on a hugging axis flips it to `FIXED`
the way Figma and the SDK both do.

### C10. Canvas manipulation — move, resize, rotate, nudge, reparent  — M + M

> **✅ done** — C10a and C10b both shipped and live-verified. Status,
> coordinate facts and the remaining open items:
> [2026-08-21-canvas-manipulation-c10.md](superpowers/plans/2026-08-21-canvas-manipulation-c10.md)
> As an **Author**, I want to move and size things on the canvas, so that the
> viewer stops being a place where I read decisions and becomes one where I
> make them.

C10a shipped: drag to move, eight grips to resize, a rotate zone outside each
corner, and arrow-key nudge — all of them working on rotated and nested
nodes. `useCanvasControls.ts` grew a gesture state machine beside the
navigation it already had, rather than adopting the SDK's `useCanvasInput`:
that composable also switches on draw, pen and text editing, which have no
patch path behind them, and a canvas that can only do what was implemented
for it cannot quietly stop matching the file it renders. Every write path on
the editor interface is optional, so absent them this is exactly the
navigation-only controller it was before.

No new patch plumbing. A canvas drag becomes patches the way a panel scrub
does, so D4's filter, `patch-burst` and C3's revision guard apply without
knowing the canvas exists. D4's predicates moved to `authorship.ts` and are
now asked from both sides — the canvas asks before a gesture what
`fromSceneChange` asks after it, so a gesture the file cannot record is one
the canvas does not offer.

A spike settled the story's one real unknown before any of it was built: the
SDK's resize commit sends `x/y/width/height` and nothing else, so a hugging
frame's new width arrived while the axis still read `HUG` and D4 dropped it —
the gesture produced no patch at all. The fix is not to weaken the filter:
dragging a handle in Figma switches the axis to Fixed, so the gesture says so
(`resize-writes.ts`) and the write becomes something the file can hold.

**Four defects the live passes found, each reported by the author and each a
wrong assumption rather than a slip.** The gestures were hit-tested against
an axis-aligned rect in the *node's* coordinates while the pointer arrived in
canvas coordinates, so grips were only ever found on a node whose parent sits
at the origin. Previews wrote through the graph's own preview call, which
runs no layout, so a dragged node followed the pointer while its parent's
flow stood still and everything snapped into place on release. The rotate
zone worked but was undiscoverable — sixteen units of empty space drawn by
nothing — until the cursor started saying what a press would do. And the
resize arrows ignored rotation, inviting drags of which only a sliver
projected onto the axis: on a node turned 81.7°, 14% of it.

The coordinate model took three attempts and was settled by drawing dots at
each candidate's predicted grip positions over the live canvas. See the
status doc: the pivot is a node's origin, `getAbsoluteRotation` is
sign-inverted, and `getWorldHandles` is the renderer's own answer.

`@open-pencil/core` is patched (`patches/`) for the size pill, whose position
mirrored its rotation offset and floated off any turned node. Re-derive on an
SDK upgrade.

C10b shipped after it: **a drop inside another frame reparents**, the way the
rail already does on drop. It is a second caller of the rail's rules, not a
second copy — `dropTargetFor` walks the containers under the pointer and asks
`moveFor` what the document allows, so a drop the rail refuses is one the
canvas refuses. The gesture writes one `move-node` and nothing else, and never
touches the scene graph: the file's echo reparents the node, so the canvas
cannot show a tree the file does not have. The highlight is the renderer's own
`setDropTarget`.

**A drop keeps the node where the pointer left it.** The envelope is the move
then `set`/`add` of `x` and `y` in the new parent's frame, addressed to the
node's *new* address because they apply after it, and gated on
`isPositionAuthored` asked of the home the node is about to have — so a drop
into an auto-layout frame writes no position at all. That gate is why the
canvas and `fromSceneChange` cannot disagree about whose decision a position
is. Shipped the same day as C10b itself, after the first live pass showed the
node jumping by the new parent's origin.

It cost a fix in E4: **`rebasePatches` now reads an envelope in order.** It
validated each patch against the incoming document independently, which refuses
every drop — the position writes name an address the envelope's own `move-node`
creates. Any future gesture that emits a structural op and then writes to what
it created depends on this. Still left behind: a node dragged out of a
`clipsContent` frame vanishes mid-drag (Figma unclips it), and stale `x`/`y`
survive a drop into an auto-layout frame, inert but wrong — that one belongs
with D7.

The fourth measured coordinate fact came from here: **`hitTestFrame` must be
scoped to the page, not to `graph.rootId`.** The SDK's own root is a
zero-sized document `FRAME` above the `CANVAS`, so scoping there bounds-checks
against 0×0 and resolves every drop to null. Only the roundtrip test could
catch it — the unit tests hand `dropTargetFor` a chain directly.

### C9. Inspector finish — the picker dialog, instruments, hover, the rebuilt sections  — M + M

> **✅ done** — spec:
> [2026-08-20-inspector-finish-design.md](superpowers/specs/2026-08-20-inspector-finish-design.md),
> plan: [2026-08-20-inspector-finish-c9.md](superpowers/plans/2026-08-20-inspector-finish-c9.md)
> As an **Author**, I want the panel to behave like Figma's, so that the
> inspector stops being a list of rows and becomes something you work in.

What shipped:

- **The colour picker is a dialog**, not a native input: SV area, hue and
  alpha tracks, hex, opacity, the eyedropper where the browser has one, and
  the document's own colours as swatches (`documentSwatches`). One
  `ColorPickerDialog.vue` serves both the paint stack and the effects list.
- **Numbers became instruments.** Every number that has a glyph wears it
  inside the box and scrubs on it; the wheel previews per notch and commits
  once after 400ms of rest. Effect X/Y/blur/spread moved onto
  `NumberFieldRoot`, closing one of C8's two knowing nits — the other, the
  native colour input, is what the dialog above replaced.
- **Panel hover lights the canvas** through the SDK's own overlays: a
  padding field tints that band, a gap lights the spacing, an arrangement
  prop lights the children, geometry lights the node. `hover-map.ts` decides;
  the panel only reports which prop the cursor is over.
- **Auto layout rebuilt to the reference** — W and H became one Resizing row
  carrying the Hug/Fixed state that governs them (so the separate sizing-mode
  rows are gone), the 9-dot matrix collapses both alignment props into one
  click, and padding shows one box per axis while the pair agrees and four
  when it does not.
- **Appearance rebuilt** — opacity and corner smoothing are percentages end
  to end, corner radius collapses the same way padding does, and visibility
  moved onto the section header as an eye.
- **Icons everywhere a glyph exists**, as one `field-icons.ts` table of 12×12
  stroke paths rendered by one component, so the theme owns their colour and
  a review diffs a glyph like any other value.

Verified live on a scratch page, against the spec's Done-when: an SV drag
recoloured the canvas continuously and landed one revision; six wheel notches
on a gap produced one revision and one line; hovering `paddingLeft` lit that
band with its value pill; one matrix click wrote both axis props under one
revision.

Four judgement calls worth knowing, each a deviation from the plan as
written:

- **A token-bound `cornerRadius` keeps its binding row.** The collapse
  control takes over only for literals, because C6's guarantee is that a
  binding is replaced by an explicit detach and nothing else.
- **A uniform corner edit writes `cornerRadius` alone** unless the file
  already authors per-corner props — expanding a shorthand into four longhand
  props behind the author's back is a diff nobody asked for.
- **A dimension the file does not author reads as a dash, not a zero.**
  Printing `0` for a hugging height is a claim the document never made. C7 is
  the story that gives it the resolved default instead.
- **A colour-only gesture does not write `opacity`** into a paint that never
  declared one, the same normalize-before-you-call-it-an-edit rule C8 settled.

The plan's dialog could not be dismissed, opened below the fold at the bottom
of a scrolled panel, closed itself on every commit, and let the native range
paint over its own ramps; the Phase A live pass caught all four. Its `blur`
glyph was also the same droplet the eyedropper wears, which the Phase B live
pass caught.

Known, not C9's: `Workspace > picks up a save through the watcher` in
`@uidx/server` times out roughly one run in ten. It predates this work — C9
touched only `packages/viewer` — and is worth a look before it costs someone
a CI rerun.

### C8. Structured controls — fills, strokes, effects, constraints, dashes  — M + M

> **✅ done** — spec:
> [2026-08-20-structured-controls-design.md](superpowers/specs/2026-08-20-structured-controls-design.md)
> As an **Author**, I want to change a colour from the panel, so that the
> most-touched visual decision in any design stops being the one thing the
> inspector cannot touch.

Figma's own controls in the dark theme: a paint stack for `fills` and
`strokes` (solid paints edit fully — swatch, picker popover, hex, opacity,
eye, remove; gradients and images render labelled, read-only, but still hide
and remove), an effects list, two constraint selects and a dash field that
refuses garbage red without writing. Empty Fill/Stroke/Effects sections
render with Figma's `+` on every non-root node — the one slice of C7 pulled
forward — and the first click is an `add`. All of it edits a copy of the
prop's one JSON value in the pure `paint-edit.ts` and commits the whole value
through the existing path, so add-vs-set, D4 filtering and the burst batching
apply unchanged. `vectorPaths` and `arcData` stay read-only by design.

Verified live: `+` on a bare rectangle, a hex recolour, an added shadow and a
constraint change each landed as one attribute on one node with no banner —
and the check caught a real defect on the way: giving one node its first fill
rewrote a sibling's untouched fills with `opacity: 1, visible: true`, because
`fromSceneChange` compared the authored shape against the scene's normalized
one. Both sides now normalize before comparing. Two knowing nits: effect
numbers commit on change rather than scrubbing (every scalar elsewhere
scrubs), and the picker is a native colour input rather than the SDK's
`ColorPickerRoot` composition — both contained follow-ups if wanted.

### C5. Properties panel restricted to the v1 table  — M

> **🟡 mostly done** — the shape is complete; three control types are deferred
> As an **Author**, I want the panel to expose only what the patcher can write,
> so that I never make an edit that silently fails to persist.

- ✅ Built on `NumberFieldRoot`, which is genuinely headless — it owns scrubbing,
  expression evaluation and the keyboard contract and renders *nothing*, so the
  pane supplies the markup and binds the actions it hands back.
- ✅ Controls are gated on `PROP_TABLE`: `isMapped` asks `@uidx/schema`, and this
  package never keeps its own list.
- ✅ Mutations translate through `fromSceneChange` — the panel commits to the
  scene graph and the graph's event produces the patch, so panel edits and canvas
  gestures share one filter rather than two.
- ✅ **A bound value shows as its token, not its number.** It renders
  `"{radius#md}"` with what it resolves to beside it, and detaching is a button
  press that writes the literal — never a side effect of typing.
- ✅ Depends on G7, which shipped: any node the file declares can be selected and
  edited, not only the outermost frame.

**Two gates, not one**, which the story collapsed into a single sentence. "Is the
prop in the table?" and "can this value's shape be edited?" are different
questions with different answers: `fills` *is* in the table and still has no
control. Both cases are shown read-only **with the reason attached**, so "cannot
edit this" never reads as "this does not exist".

Of the three deferrals this story named, two are since closed — enums by C6
(`prop-ui.ts` carries the domains) and paint stacks by C8 — leaving one:

- **Multi-select.** Editing needs a mixed-value model; `NumberFieldRoot` has one
  and nothing else here does. Selecting several nodes shows no editor rather
  than silently editing whichever came first.

---

## Epic D — Structural write-back  [Phase 3b]

**Exit criterion (spec §12): create → restyle → reorder → delete on the canvas
produces a diff a reviewer reads as exactly those four operations, with the
`move-node` showing a pure block move.**

### D1. Creation toolbar  — M

> **✅ done** — shipped and live-verified 2026-08-22
> As an **Author**, I want to draw a new node on the canvas, so that I can build
> a component visually instead of typing JSX.

- Toolbar offers exactly the §3.3 whitelist: Frame, Text, Rectangle, Ellipse, Vector.
- New nodes are auto-named `<element>-<n>` with sibling uniqueness (`autoName`, done).
- Creation defaults live in `@uidx/schema` so file output stays canonical.
- Emits `insert-node`; output matches `uidx fmt` style.

`EditToolbar.vue` sits in the shell's top bar, on Figma's own letters — F, T,
R, O, and P for `<Vector>`, since Figma's V is the move tool and the pen is
what makes vectors there. The armed tool lives in `App.vue` rather than in the
toolbar: the canvas is what draws with it and the keyboard can change it
without the pointer ever reaching the tray, so one owner with two ways in.
Using a tool puts it away, which is Figma's behaviour and what stops a stray
click after a deliberate one from littering the file.

**The draw gesture is a marquee, not a half-made node.** `useCanvasControls`
gained a `draw` gesture that sweeps `editor.setMarquee` — the same overlay a
marquee selection uses, so the affordance costs nothing to draw and there is no
provisional node in the scene graph to clean up if the gesture is abandoned. An
armed tool takes the press outright rather than deferring to grips or hit
tests: drawing over a selected node's own handles is the ordinary way to make a
shape inside it.

**What a new node is made of lives in `@uidx/schema`** (`create.ts`), because
the file is the artifact and what a created node looks like in it is a property
of the format, not of whichever surface made it. The rule is "what the author
decided, and what the engine will not give them": measured against
`defaults.ts`, a bare Frame, Rectangle, Ellipse and Vector all resolve `fills`
to `[]`, so a node created without one draws nothing — and a tool that appears
to do nothing is worse than no tool. Everything the engine does answer
(100x100, `layoutMode: NONE`, a black fill on text) is left unwritten and the
inspector dims it, the way C7 intends. A click therefore states no size at all;
only a sweep does. Text splits the way Figma's does — dragged is a fixed box,
clicked hugs its characters.

`insertTargetFor` picks the parent by the same walk `dropTargetFor` makes, from
the rect's *origin* — where the author started drawing is what they were
drawing inside. It parts company with a drop on one point: a container that
refuses this *element* is stepped past rather than treated as a refusal,
because drawing a `<Component>` over a frame is not a mis-aimed gesture, it is
an element that belongs a level up. A drop had someone aiming at a frame; a
draw has someone aiming at a place.

One thing to know: **a `<Vector>` is created with a placeholder triangle.** One
with no `vectorPaths` renders nothing, so the tool would otherwise place an
invisible node. Real vector authoring is D8's.

**The live pass found a patcher defect and it is fixed.** Running `uidx fmt`
over a file the toolbar had written rewrote it: `insertChildBlock` expanded a
self-closing parent by splicing `>` onto the last attribute's line, where
`emitTree` puts it on its own line at the parent's indent whenever the
attributes are one per line. So drawing a frame and then drawing inside it
produced exactly the format churn §9.5 forbids. D1 is what made it reachable
from the UI, but the rail's drag-to-reparent could always hit it. The
`isMultilineTag` helper it needed also replaced `addProp`'s private copy of the
same judgement.

Worth carrying: the test that was supposed to cover this asserted
`emitDocument(parsed) === emitDocument(parseOrThrow(emitDocument(parsed)))`,
which compares `emitDocument` with itself and passes whatever the patcher
wrote. The assertion that catches it is against the *patched source* —
`emitDocument(parseOrThrow(source)) === source`, over a fixture that was
canonical to begin with.

### D2. Delete on selection  — S

> **✅ done** — shipped and live-verified 2026-08-22
> As an **Author**, I want to delete a selected node, so that removing an element
> does not mean hand-editing the file.

- Emits `remove-node`.
- The sole child of `<Component>` cannot be deleted; the UI disables it rather
  than letting the patch throw (guard already enforced in the patcher).

`canRemove` in `layer-moves.ts` mirrors `removeNode`'s guards for the reason
every predicate in that file does: a toolbar has to grey a button out while the
pointer is still moving, which a `PatchError` arriving after the write cannot
do. Both the button and the Delete/Backspace shortcut ask it, so the keyboard
cannot do what the button refuses. The selection is cleared by the caller
rather than on the echo — the address it names stops existing the moment the
patch lands, and a selection pointing at nothing is what leaves the inspector
showing a node that has gone.

### D3. Layers pane with drag to reorder and reparent  — L

> **✅ done** — pulled forward out of Phase 3b by the 2026-08-19 Figma chrome
> work; `LayersPane.vue`
> As an **Author**, I want to restructure the tree by dragging, so that
> hierarchy changes are as easy as they are in Figma.

- `LayersPane.vue` reads from the parsed document (`doc.tree`), not the scene
  graph — **not** built on the SDK's `LayerTreeRoot` / `useLayerDrag`, though
  those were the assumed primitives when this story was written. The rail
  hand-rolls its own hit-testing and drop instructions instead: `useLayerDrag`
  calls `editor.reorderChildWithUndo(...)` directly on the scene graph, which
  would feed a graph mutation back through `patches` — the double-write this
  design exists to avoid. Confirmed against the SDK source
  (`@open-pencil/vue` `dist/index2.js`).
- Drag commits a single `move-node` on drop; only local state moves during the
  drag.
- A reparent that would duplicate a sibling name is refused, and refused
  *silently*: `moveFor` returns null and the drop indicator simply never
  appears, so the author is never offered an affordance for something that will
  not happen. There is no message, deliberately — a banner explaining a drag
  that was never accepted arrives after the gesture it is about. The patcher
  enforces the same rule behind it.
- Rename shipped alongside it, on the tree rather than the panel — previously
  only parked somewhere in Epic D with no story of its own. Inline rename emits
  `set name`; because addresses are name paths, renaming a node also remaps the
  addresses of every descendant, plus the pane's own selection and expanded-set
  state, which is what `remapAddress` is for.

**The `node:reparented` / `node:reordered` coalescing watch-item is struck, not
just resolved.** It assumed a drag would go through the scene graph and emit
that pair. Because the tree is document-native and emits `move-node` directly
on drop, there is no scene-graph event pair to coalesce — the hazard does not
get solved, it stops existing.

### D4. Generated content stays out of the file  — M

> **✅ done**
> As a **Reviewer**, I want the diff to contain only authored intent, so that I
> can trust that every line is a decision someone made.

- ✅ One rule, both cases: **the address space covers authored source spans only.**
- ✅ Layout reflow filtered (`fromSceneChange`).
- ✅ Instance children never become patches. "Absent from the bimap" is the test,
  and it is the first thing `fromSceneChange` checks. Still only half-exercised
  until F3 lands real instances — but the rule is written where the events arrive
  rather than waiting for them.
- ✅ **A page child's `x`/`y` is authored and reaches the file** (ADR 0003).

**The story named the symptom; the cause was bigger.** The filter tested both
position and size against one question — "is the parent an auto-layout frame?" —
and those are decided by different things:

- **Position** is the *parent's* business. A child of an auto-layout frame is
  placed by it; a child of a plain frame or of `<Page>` sits where somebody put
  it. `layoutPositioning="ABSOLUTE"` takes a node back out of its parent's flow,
  so its position is authored again even inside one.
- **Size** is the *node's own* business. A frame set to hug measures its content,
  a frame set to fill is stretched by its parent, and a text node that
  auto-resizes is sized by its glyphs.

So a text node inside a plain frame had its measured `width` and `height` written
into the file whenever anything near it reflowed — the exact failure this story
exists to prevent, in the case its one test did not cover. Reading the node's
*current* sizing mode is the right discriminator rather than a guess, because the
SDK flips an axis to `FIXED` when a user sizes it by hand: `HUG` still standing
means the number that just arrived was computed. The axis-to-dimension mapping is
the SDK's own, from `layout/effective-generated-text.js`.

### D5. The layers rail is operable from the keyboard  — M

> **✅ done**
> As an **Author**, I want to move through the tree and rename in it without
> touching the mouse, so that the rail is usable at speed and usable at all by
> anyone who does not point.

D3 shipped the rail mouse-first and left it mouse-only. A row's selection is
reachable exactly one way: clicking a `<span>` that carries no `tabindex`, no
`role` and no keydown handler. Tab does not reach a row, so nothing in the tree
can be selected, expanded or renamed from the keyboard — which also means the
rail announces itself to a screen reader as a stack of unlabelled `div`s rather
than as a tree.

- Roving tabindex over the rows: one row is in the tab order at a time and the
  arrow keys move which one, so the rail is a single tab stop rather than a
  hundred.
- `role="tree"` on the list, `role="treeitem"` on each row, with `aria-level`
  from `row.depth`, `aria-expanded` where it already exists on the chevron, and
  `aria-selected` where `data-selected` already is. The row data carries all of
  it; only the markup is missing.
- Up and down move the focused row through the *visible* rows — `visibleRows`
  already computes exactly that list, so this is not a second traversal.
- Right expands a collapsed row and then descends; left collapses an expanded
  one and then climbs to the parent. Figma's own bindings, and the tree pattern's.
- Enter opens the rename on the focused row, Escape abandons it. Both already
  exist behind `startRename` and `cancelRename`; neither has a key that reaches
  them.

**It also owes the spec a `scrollIntoView`.** A selection made on the canvas is
supposed to become visible in the rail, and the watcher that handles it
(`LayersPane.vue`) expands the collapsed ancestors and stops — so selecting a
node in a long tree opens the path to it and then leaves it scrolled off screen.
Expanding without scrolling is half the promise, and it is the half that only
shows up on a document big enough to overflow the rail. It lands here rather
than as a patch on D3 because focus management is what decides where the rail
scrolls to, and building the two separately means building the scroll twice.

*Sized M rather than S because the roving-tabindex model has to agree with the
existing `collapsed` / `editing` state — the focused row and the selected row
are not the same thing, and a rename opening has to move focus into the input
and give it back on close.*

**What shipped, and one correction to the sizing note.** The focused row and the
selected row turned out to be the *same* thing: selection follows focus, as it
does in Figma, so arrowing moves the canvas and the inspector with it. The
navigation judgement lives in `layer-keys.ts`, pure and total — every key maps
to an explicit intent or to nothing — which is what made the boundaries (right
on a leaf, left at the root, down on the last row) testable without a DOM.

The sizing note was right about where the trouble would be, and did not prevent
it. `collapsed` and the roving tabindex disagreed exactly as predicted: because
`toggle()` mutates `collapsed` without touching `selection`, collapsing an
ancestor of the selected row left **no row tabbable at all** — the rail became
unreachable by Tab after two ordinary mouse clicks, in the story whose whole
point is keyboard reachability. It was caught twice independently, by review of
the code and by driving the running app, and fixed by falling back to the
nearest still-visible ancestor rather than to the first row, so the tab stop
stays near where the author was working.

### D6. The rail's address bookkeeping survives a reparent  — S

> **✅ done**
> As an **Author**, I want the rail to keep pointing at the node I just moved,
> so that acting on something does not lose it.

All four fixed. `remapAddress` stopped splicing strings and rejoins each
descendant segment through `addressOf`, so a promotion writes `#` where the
old suffix had `/` and a demotion the reverse — one fix for both `collapsed`
and the selection, since both remap through it. The reconcile path in
`CanvasPane.render` now re-applies the shell's selection after `applyChanges`,
which is the moment the renamed ids first exist; verified in the running
viewer — the outline survives a rename where it used to clear. `onDrop` emits
its patch unconditionally and takes the node's name from the document `moveFor`
resolved against rather than a row lookup that could miss. And the local
`current` in `applySelection` is `graph` now.

Two defects the Figma chrome work found and deliberately parked, plus two nits
found alongside them. None writes a wrong value to the file — all four are the
viewer disagreeing with itself about where a node now lives.

- **A reparent that crosses the entity boundary mis-remaps descendants.**
  Dropping a nested `Frame` onto the page row is legal, and the moved node's own
  new address is computed correctly through `addressOf`. Its *descendants* are
  not: `remapCollapsed` and `App.onMoved` rewrite them by string slice, so
  `Button/Primary#container/group/icon` becomes `group/icon` where the truth is
  `group#icon` — the promoted node is an entity now, so its children join with
  `#` rather than `/`. Confined to the `collapsed` set and to a selection *of a
  descendant*; no patch uses these strings. The fix is to route descendants
  through the same `addressOf` the moved node already uses.
- **The canvas outline is lost after a rename or a reparent.** The shell remaps
  `selection` before the file round-trips, so `applySelection` runs while the
  graph still holds the old ids, matches nothing, and clears. The reconcile path
  that later creates the new ids never re-applies — only the rebuild path does.
  Not a regression (rail-driven canvas selection did not exist before), but it
  is the one place the reconcile path needs the re-apply more than the rebuild
  path does.
- **`onDrop` can discard a valid patch silently** if its row lookup misses.
  Unreachable today — a non-null `moveFor` implies the node resolved, so
  `layerRows` contains it — but the pre-fix code emitted unconditionally.
- **`CanvasPane.vue` shadows `current`**: a local `const current = scene.value`
  sits twenty lines from a module-level `let current: UidxDocument | null`.

*Sized S because all four are localised and none needs a design decision. The
first is the only one with user-visible behaviour.*

### D7. Dragging a flowed child reorders it, the way Figma does  — L

> **✅ done** — shipped and live-verified 2026-08-22
> As an **Author**, I want to drag a child of an auto-layout frame to a new
> slot in the flow, so that rearranging laid-out content is as direct on the
> canvas as it already is in the rail.

The 2026-08-22 Figma-parity work settled what a drag on a flowed child must
*not* do — write x/y the layout owns — and left the gesture refusing outright
(`canMove` in `useCanvasControls`). Figma's answer is richer: the drag becomes
a *reorder*. The child follows the pointer, siblings part to show the slot,
and release commits an index, not a position.

- The pointer maps to an insertion index among the siblings — past-the-midpoint
  along the parent's axis, the same arithmetic D3's rail does vertically. A
  wrapped flow (`layoutWrap`) makes this two-dimensional and is the main reason
  this is not an S.
- Release commits a single `move-node`, the op D3 already ships for the rail:
  the patcher, the duplicate-name refusal (`moveFor`) and the descendant
  address remapping (`remapAddress`, `App.onMoved`) all exist and must be
  reused, not re-derived. A drag that lands back in its own slot commits
  nothing.
- During the drag the scene must only *preview* (`runPreviewUpdates`), the
  discipline every other gesture already follows — one drag, one patch, and
  the file never sees the intermediate slots. What the preview shows (the full
  Figma sibling-parting animation, or an insertion caret to start) is the
  story's main open design question; an honest caret beats a half-right
  animation.
- Same-parent reorder is the story; dragging *out* of the flow (reparent onto
  the page or another frame) can stay with the rail until this settles — the
  canvas refusing a cross-parent drag is a smaller sin than guessing the
  target parent wrong mid-gesture.
- `canMove`'s refusal is replaced by the reorder gesture only for flowed
  children; absolute children and plain-frame children keep the move gesture
  untouched.

*Sized L like D3, and for the same reason: the patch is one op, but the
gesture — hit-testing a flow, previewing honestly, refusing cleanly — is the
whole story.*

What shipped, against each of those points:

- **`flow-reorder.ts` is the arithmetic**, with no canvas in it. Wrap is handled
  by grouping the siblings into runs and detecting a wrap as *the main axis
  going backwards* — not by comparing cross-axis positions, because
  `counterAxisAlignItems` puts differently-sized children at different cross
  offsets within one row, and a cross-axis grouping splits one row into several.
  The pointer picks a run (the nearest when it is outside them all), then counts
  midpoints within it.
- **`reorderFor` expresses the index through `moveFor`**, so a canvas reorder is
  refused for the reasons a rail drop is. D7 is a third caller of D3's rules,
  not a third copy. It also owns the no-op: a drag that wanders and lands back
  in its own slot commits nothing, which falls out cleanly because the index is
  counted against the siblings with the dragged child already removed.
- **The preview is the caret**, `editor.setLayoutInsertIndicator` — the SDK
  draws it already. The dragged child deliberately does *not* follow the
  pointer: it cannot without writing geometry its parent owns, which is the
  whole reason the drag is a reorder. The honest caret the story asked for.
- **Cross-parent drags stay with the rail**, as the story allowed.
- **`canMove`'s refusal is replaced only for flowed children.** An absolute
  child and a plain-frame child keep the move gesture untouched, and a flowed
  child with no siblings keeps the old refusal — there is no slot to move to.

One assertion inverted deliberately: C10a's "offers no move cursor over a node
its parent places" is now "offers the move cursor", because D7 gives that drag a
meaning. The rule did not change — offer the hand exactly where a press would do
something — so the cursor asks `flowSlotAt` rather than assuming.

### D8. Images and vector content — place, import, and where the bytes live  — L

> **✅ done** — both halves shipped and live-verified 2026-08-22, against
> [ADR 0006](decisions/0006-images-and-vector-artwork.md)
> As an **Author**, I want to bring a logo, a photograph or an icon into a
> page, so that a design holds the artwork it ships with rather than a grey box
> standing in for one.

Two halves that share a story and split cleanly, because only one of them needs
a decision about the file format first.

**Vector first, because the format already holds it.** `<Vector>` is on the
§3.3 whitelist and carries `vectorPaths` — `{ windingRule, data }` where `data`
is an SVG `d` string. The SDK imports SVG today: `prepareSVGImport(source)`
parses it and `createSVGNodesFromImport(graph, parentId, data)` builds nodes
from the result. The direction that works is file → scene, which is the
direction an import wants: drop or paste an SVG, write `<Vector>` nodes
carrying its paths, let the existing build path render them.

- **Do not import by pushing a `VectorNetwork` into the graph and reading it
  back.** `prop-table.ts` says why `vectorPaths` is one-way: reconstructing a
  `d` string from a network is lossy, and v1 ships no vector editing. An
  importer that round-trips through the graph would rediscover that the hard
  way.
- A multi-path SVG becomes several `<Vector>` nodes in a frame, not one node
  that has forgotten which path was which.
- Per-path fills and strokes land on the paint stack C8 already ships.
- What the importer cannot represent — filters, clip paths, embedded rasters,
  text that was never outlined — is **reported, not dropped**. A silently
  simplified logo is worse than a refused one, and the near-match machinery E3
  shares is where that message belongs.
- Scope: this **places and imports**. It is not a pen tool. Drawing and editing
  vector geometry on canvas needs a patch path per vertex and is its own story,
  for the reason C10a declined the SDK's `useCanvasInput`.

**The decision is written.** [ADR 0006](decisions/0006-images-and-vector-artwork.md)
answers all of it — an image is a fill (§1), the reference is a manifest-relative
path (§2), `uidx.json` declares `assets` (§3), a dangling reference fails
`uidx check` (§4), `scaleMode` maps straight through (§5), and the bytes reach
the viewer over the server's own origin at `/__uidx/asset/…` (§9). What is left
is the code. The original framing of the question, kept because it is what the
ADR answers:

**Images need a decision before they need code.** A `.uidx` file is text, and
"never reprint" makes every edit a span replacement — bytes cannot live in it.
So an image is a *reference*, and what it refers to is the open question:

- A path relative to the document root, which reads in a diff and moves with
  the file — or a content hash, which the SDK already speaks: `createImage(data)`,
  `computeImageHash`, and a fill of `{ type: 'IMAGE', imageHash, imageScaleMode }`
  (`ImageScaleMode` is `FILL | FIT | CROP | TILE`, its own enum domain, plus an
  `imageTransform` for crop). **This wants an ADR**, the way global naming got
  0004: it decides what a reviewer sees, what `.fig` export has to pack (F2),
  and whether two pages using one logo share a byte or a path.
- Wherever the bytes live, `uidx.json` is where the document says so. It
  already declares `files`; assets are the same kind of statement (ADR 0004).
- `uidx check` gains a diagnostic for a reference with nothing behind it. A
  missing asset is a broken build and CI is where that should surface, not the
  viewer.
- The paint stack ships solids and gradients; an image paint needs a control of
  its own — one that shows the picture rather than a hex value — and the
  read-only-with-a-reason path C5 built is what it looks like until then.
- Whether an image is a fill on a `Rectangle` (Figma's model) or an `<Image>`
  element of its own belongs to the same ADR. Figma's answer is a fill, and
  ADR 0002 says the authored surface tracks Figma rather than the scene graph.

*Sized L for the pair. The vector half alone is an M and needs nothing new from
the format; the image half is blocked on the ADR and should not start before
it. Split them if the ADR takes a session of its own.*

**The vector half shipped**, and it does not use the SDK's importer.
`prepareSVGImport` produces `VectorNetwork`s while `vectorPaths` is a `d`
string, so the SDK's route means reconstructing a `d` from a network — the
lossy round trip the bullet above warns against, arrived at from the other
side. An SVG *already contains* `d` strings, so `svg-import.ts` reads them
straight across and uses `svgpath` only to bake ancestor transforms into the
coordinates. Arcs stay arcs, and a path that needed no transform crosses byte
for byte.

Against the rest of the bullets: the basic shapes convert exactly (circles as
two half-arcs, since one full arc is degenerate); the `viewBox` maps onto the
node's own box, which is the usual reason an icon imports at a quarter size; a
multi-path SVG becomes several `<Vector>` nodes in a `<Frame>`; fills, strokes,
`stroke-width` and `fill-rule` land on C8's paint stack with SVG's own
inheritance; and text, rasters, `<use>`, filters, clip paths, masks, gradient
references and stylesheets are all **reported**, reaching the author in the
shell's banner rather than being dropped.

It lives in `@uidx/viewer`, not `@uidx/schema`, and the split is worth stating:
D1 put "what a new node is made of" in the schema package because every surface
must agree on it. An importer is a different kind of thing — a *source adapter*
reading someone else's format. It needs a DOM, which the schema package has
neither at run time nor in its tests, and the CLI resolves that package at run
time and does not want an SVG parser in its tree. A future `uidx import` moves
the module and its tests as they are.

**The live pass found a real bug beyond the story.** The import's message shared
a ref with C3's patch notices, and the `insert-node` echo cleared it
milliseconds after it appeared — because a landed patch is deliberately silent.
The two are cleared by different things and now have different owners in
`App.vue`.

**The image half shipped**, and it is the ADR end to end: `uidx.json` gains
`assets` (defaulting to `assets/**`, `images/**`, `icons/**`); the manifest
enumerates what it declares, which answers *declared* and *present* in one pass
and is what lets the three diagnostics — malformed path, missing file,
undeclared folder — say three different things; `toSceneGraph` gains a
`resolveAsset` alongside `resolveAlias`, translating the file's `src` into the
`imageHash` the renderer reads; and `asset-store.ts` fetches the bytes, hashes
them and fills the graph's `images` map.

**Images are fills only, and that is a measurement rather than a preference.**
Figma allows an image stroke; this scene graph does not — `Stroke` carries a
flat colour and no image field, and `composeStrokes` already documents it.
Scanning `strokes` for references would validate the path of something that can
never draw, which reads as support rather than as the gap it is.

Two things the live pass caught that the tests did not. **`uidx check` resolved
the manifest from `cwd` rather than from each page**, so every image in a
document checked from another directory reported as missing. And **the asset
route never ran**: middleware added after `createViteServer` sits behind Vite's
own SPA fallback, so a PNG came back as `text/html`. It is a plugin now, which
registers before the internal middlewares.

A missing image is named on the canvas rather than in the shell's banner. The
two are different kinds of message — the banner is for something that just
happened and clears itself, this is a state the document is *in* until someone
puts the file there — and the glyph panel beside it says the same kind of thing
for the same reason.

*The original framing of the open question, kept because it is what the ADR
answered:* [ADR
0006](decisions/0006-images-and-vector-artwork.md) answers the open question
the bullets above pose — a path relative to the manifest rather than the
content hash the SDK speaks, an image as a *fill* rather than an element, an
`assets` glob in `uidx.json`, and a `uidx check` diagnostic for a reference with
nothing behind it. It is **proposed, not accepted**: it decides what a reviewer
sees in a diff and what F2 has to pack, so it wants a human yes before code
follows it.

### D11. The pen tool — draw a vector on the canvas  — L

> **✅ done** — shipped and live-verified 2026-08-22; unblocked by
> [ADR 0006 §8](decisions/0006-images-and-vector-artwork.md)
> As an **Author**, I want to draw a shape point by point, so that an icon can
> be made here rather than in another tool and imported.

D8 places and imports; this originates. The format change it rests on is one
line — `vectorPaths` gains a `fromScene` — and the reason it was one-way is
[measured and answered in ADR 0006 §8](decisions/0006-images-and-vector-artwork.md):
a `d` string round-trips to a fixed point after one normalising pass, and
everything a pen produces (lines and cubic curves) survives it exactly.

- Click places a corner vertex; click-and-drag places a smooth one and pulls its
  handles. Clicking the first vertex closes the path; Escape or Enter finishes
  it open. Figma's pen, because an author who knows one knows this one.
- **The write is vouched.** `fromScene` returning a value unconditionally would
  re-spell a path on any unrelated edit to the node — normalisation arriving as
  churn. The gesture vouches for `vectorPaths` through the `authored` signal
  `fromSceneChange` already takes (C7 built it for this shape of problem), so
  nothing else can originate a geometry write.
- One `set vectorPaths` when the path is finished, not one per vertex. The
  in-flight path is a preview like every other gesture, so the file never sees
  the intermediate shapes and the diff is the shape that was drawn.
- **`P` becomes the pen and D1's placeholder triangle goes.** A path-less
  `<Vector>` renders nothing, which is why placing one needed a default shape;
  once `P` draws, that reason is gone.
- The SDK ships `penState` and `drawPenOverlay` — the in-progress path,
  vertices and handles are drawn by the renderer, the same way C10b's drop
  highlight and D7's caret are. Do not draw a second one.

*Sized L: the arithmetic is small, but a modal multi-click gesture is a new
shape for `useCanvasControls` — every gesture so far begins and ends with one
press.*

What shipped, against those points. `pen-model.ts` holds the arithmetic with no
canvas in it, in **tangents** rather than absolute control points — the shape
both consumers want, since the SDK's `penState` overlay and a `VectorNetwork`
store the same, so the preview and the committed geometry cannot disagree.
Bounds solve the cubic extrema rather than boxing the control polygon: a handle
reaches well outside the curve it shapes, and a node whose box exceeds its ink
selects and resizes around empty space. An open path is stroked and a closed one
filled, which is the difference between a drawn line appearing and appearing to
have failed. The write is vouched through `VOUCHED_ONLY`, so nothing but the pen
can originate geometry.

A test pins ADR 0006 §8's property from the pen's own end: what the pen produces
survives parse-and-re-emit byte for byte, so a drawn path cannot re-spell itself
the first time it is saved.

**The placeholder triangle stayed, as a fallback rather than the normal case.**
The ADR expected it to go; `createSpec` has to be total, and a caller with no
path still needs something that draws. Nothing reaches it today.

**Found while looking at the result:** the inspector still told the author
"vector geometry is one-way — nothing on the canvas can originate it", which
D11 had just made false. A panel explaining a limitation the product no longer
has is worse than one that says nothing.

### D12. Edit an existing path's vertices  — M

> **✅ done** — shipped and live-verified 2026-08-22; the last story in Epic D
> As an **Author**, I want to move the points of a shape I already have, so that
> an imported icon can be corrected instead of re-exported.

- Double-click a `<Vector>` to enter vertex editing, the same descent gesture
  G7 built for containers. Escape leaves it.
- Drag a vertex; drag a handle; Delete removes a vertex. One `set vectorPaths`
  per settled drag, vouched exactly as D11's is.
- **The first edit to an imported arc converts it to cubics, and says so
  first.** ADR 0006 §8 measures the conversion as the only lossy step in the
  round trip. Every vector editor does this — Figma's network has no arc
  primitive either — but it reformats a file the author did not ask to reformat,
  so it is announced rather than discovered.
- `nodeEditState` and `drawNodeEditOverlay` exist in the SDK; the vertices and
  handles are the renderer's to draw.

What shipped, against each of those points:

**`vertex-edit.ts` is the arithmetic**, and it reuses D11's `PenVertex` rather
than inventing a second idea of what a point is — the pen draws a path and this
corrects one, so a smooth point had better mean the same thing to both. What is
genuinely new is **subpaths**: a pen draws one chain, and an imported icon is
routinely several — a ring, a letter with a counter — all inside one `d` on one
`<Vector>`. So the model is a list of chains, and `parseSVGPath` groups its
segments per subpath, which is what lets `closed` be *read* off the geometry
(the last segment ends where the first began) instead of guessed.

**Nothing is written until the drag settles, and the preview costs no writes at
all.** This is the one gesture in the repo that does not need `runPreviewUpdates`,
because `drawNodeEditOverlay` re-renders the shape from `nodeEditState` itself —
it swaps the node's network for the overlay's for the duration of one paint. So
the canvas shows the edit, the scene graph never sees it, and there is no
preview to keep honest. C4's discipline is obtained here by having nothing to
discipline.

**The commit is a vouched `updateNode`, which makes it `applyProp`'s shape
rather than a new one.** `vectorPaths` is in `VOUCHED_ONLY`, so the write only
survives `fromSceneChange` because the gesture claims it — and the `d` is spelled
by `vectorNetworkToSVGPaths`, the same function ADR 0006 §8 measured the fixed
point through. Nothing in this repo spells a path; an earlier draft had a second
speller in `vertex-edit.ts` for the warning below and it was deleted, because two
spellers is two things to keep agreeing.

**The node's box is deliberately not refitted to the ink, and that is a
measurement.** Figma refits; this does not. `getVectorPaths` in the renderer
draws `node.vectorNetwork` without reading width or height, and a direct resize
of a `<Vector>` here already changes the box and leaves the ink alone — so the
box is a layout box either way and nothing is distorted by leaving it. The
positive reason is stronger than the absence of harm: a `d` is relative to the
node's origin, so refitting would move that origin, and nudging one point would
re-spell every other point in the file. That is the churn the vouch exists to
prevent, arriving through the front door.

**The warning is measured, not assumed.** ADR 0006 §8 asks for the arc
conversion to be announced before the first edit. What is actually compared is
narrower and more useful: what the file holds now, against what an untouched
write-back would spell for it, through the speller that will do the writing. A
path the pen drew is already a fixed point, so it says nothing — which is what
keeps the message worth reading when it appears. An arc gets its own sentence
because it is the one lossy case; everything else (`Z` after a curve becoming an
explicit line, `Q` and `S` becoming `C`) is exact.

**Handles are hit-tested before vertices**, which is the opposite of the obvious
order. A handle whose grip falls inside its own vertex's grab radius would
otherwise be unreachable at any zoom an author actually works at. It is safe
only because `handleNear` ignores zero-length tangents — so a corner point,
whose handles sit exactly on top of it, is never shadowed — and only tests the
handles the overlay is drawing.

**Mirroring is read off the geometry, because the file has nowhere to put it.**
Figma stores `handleMirroring` per vertex; an SVG `d` cannot. So a point whose
tangents already point exactly opposite ways *is* a smooth point and stays
smooth through an edit, and one whose tangents disagree is a corner and stays
sharp. Equal lengths mirror as Figma's ANGLE_AND_LENGTH, unequal ones as ANGLE.
Alt breaks it, as it does there.

**Delete is taken from the shell for the duration.** D2 binds it to removing the
selected *node*, on the window, and the selected node during vertex editing is
the one whose point is being removed. The canvas emits `vertex-edit` and the
shell stands down — told rather than inferred, because a mode that lives in the
controller is not something `App.vue` can see, and a guess would be wrong in
exactly the case that matters. The toolbar's Delete button greys out with it.

**Escape leaves, and a press outside the node leaves.** A press that misses a
point but lands on the shape only clears the point selection: an author who
lands 10px off should not be dropped out of the mode. Outside the node is the
way out for anyone who does not know about Escape, so the mode is not a trap.

*Open, and deliberately not built:* arrow keys decline to do anything while a
path's points are open, rather than nudging the node out from under the point
being aimed at. Nudging the **point** is the obvious follow-up and is not in
this story.

*Also worth knowing:* the shell's notice banner is a layout row, so the
re-spelling warning shifts the canvas down as vertex editing opens. Pre-existing
behaviour of every notice, but D12 is the first thing to fire one at the start of
a pointer sequence. It cost the live pass a run — a cached canvas rect aimed 33px
high and missed every point.

---

## Epic E — Resilience and polish  [Phase 4]

### E1. Connection loss is visible and self-healing  — S

> **✅ done**
> As an **Author**, I want to know when the viewer has lost the server, so that I
> do not keep editing into a void.

- Banner on WS drop; automatic reconnect.
- The server is stateless per connection: a full `file:changed` on reconnect.

### E2. Selection ↔ intent highlighting  — M

> ⬜ not started
> As an **Author**, I want selecting a node to highlight the rule that governs
> it, so that intent and geometry stay connected.

- Canvas selection maps to a UIDX address and highlights the corresponding
  region of the intent pane.
- Requires a convention for linking prose to addresses — design work, not just
  plumbing.

### E3. Diagnostics quality pass  — S

> **🟡 partial**
> As an **Author**, I want errors that tell me how to fix them, so that the
> whitelist feels like guidance rather than rejection.

- Every `UIDX###` code gets a message with a suggested fix.
- Unknown-element and unknown-prop errors suggest near-matches.
- A corpus test covers CRLF, tabs and unicode names (partly covered already).

### E5. `uidx open` survives a machine with no browser launcher  — S

> **✅ done** — 2026-08-22
> As an **Author** on a headless box — a container, a remote dev host, CI — I
> want `uidx open` to serve the viewer, so that a missing `xdg-open` is not the
> end of the command.

Found while verifying C7 on 2026-08-22. `launch()` in `packages/cli/src/commands/open.ts`
wraps `spawn` in a `try/catch` whose comment says that failing to launch a
browser "is not a reason to fail the command" — but `spawn` reports ENOENT by
emitting an asynchronous `error` event, which no `try/catch` can see. The event
is unhandled, so Node throws and takes the *server* down with it, seconds after
it printed the URL it is now no longer serving.

- ✅ An `error` handler on the child; the catch stays for the synchronous case.
- ✅ Covered by a test that clears `PATH` and asserts the server still serves.
  It fails without the handler, which a test of this shape has to be shown to
  do — an unhandled rejection is easy to write a test that never notices.
- `--no-open` was the workaround, and still works.

### E4. A stale patch rebases instead of being thrown away  — M

> **✅ done**
> As an **Author**, I want an edit made while the last one was still landing to
> apply anyway, so that working quickly does not cost me work.

C3 made a losing race fail *loudly*, which was the right call over corrupting a
file — but the author still loses the edit and has to redo it. Reported from
real use: scrub a property, act again before the first write's `file:changed`
echo returns, and the second patch arrives carrying the old `baseRevision`. The
server answers `patch:stale`, the client re-syncs, and the banner says *"The
file changed underneath that edit, so it was not applied."*

Measured rather than assumed: one gesture produces exactly one `node:patch` and
advances the revision by one. Nothing double-writes. The race is inherent to
answering asynchronously, and the layers rail widened the window simply by
adding three more ways to write — the eye, rename and drag now interleave with
inspector scrubs.

- The client rebases a stale patch onto the revision the server actually has,
  rather than discarding it. Addresses are stable across an unrelated edit, so
  in almost every case the patch applies unchanged.
- A rebase that *cannot* be trusted still refuses: the address no longer
  resolves, or the property it targets changed underneath. Those keep C3's loud
  failure, which is the case C3 was actually protecting against.
- The distinction is worth stating in the message — "somebody edited the node
  you were editing" is a different event from "somebody edited the file".

*Sized M rather than S because deciding which stale patches are safe to rebase
is the whole story; the retry itself is small. Do not start it by making the
client retry blindly — that is how C3's guarantee gets quietly repealed.*

*Shipped with one deliberate deviation from the second bullet: a property that
changed underneath does **not** refuse. The file is the source of truth and its
changes land whenever they land — but the one property under the author's
finger is theirs, so the active edit wins it (`rebasePatches` in the viewer).
What still refuses, loudly and with its own message, is a target that is gone
or that a different element now occupies. The same policy got a canvas half:
an in-flight drag or panel scrub is re-applied over a remote document as it
lands (`reapplyPreview`, `panelPreview`), so the file changing mid-gesture
never snaps the node out of the author's hand.*

---

## Epic F — Beyond v1  [Phase 5]

### F1. Off-scale linting with snap-to-token  — M

> ⬜ not started
> As an **Author**, I want to be warned when a value drifts off the token scale,
> so that the design system stays coherent.

- Warn-only first; snapping in the write path only once warnings are trusted.

*Rescoped and shrunk from L. Binding moved to **G5** — a value that references a
token is a format feature, not a lint. What is left here is the diagnostic for
raw values that sit near a token but not on it.*

### F2. Export the design system to Figma  — L

> ⬜ not started
> As an **Author**, I want to hand my whole design system to designers as one
> Figma file, so that UIDX fits the workflow that already exists instead of
> asking anyone to leave their tool.

`uidx export fig [--out <file>]` resolves the document the way `uidx open`
does — walk up to `uidx.json`, load every member page — and writes one `.fig`
a designer imports into Figma. The whole system travels: pages, components,
variants, tokens, instances with their assignments.

- Via `exportFigFile` / `parseFigFile` from `@open-pencil/core/io/formats/fig`
  — **not** `@open-pencil/fig`, which exposes only archive/container APIs and
  throws if you ask it for scene-graph conversion (corrected by S4).
  `sceneNodeToJSX` may also enable the reverse (`.fig` → `.uidx`) importer.
- Export is headless: the CanvasKit and renderer arguments are optional and
  only produce a thumbnail. So this is not blocked by S1, and it runs in CI.
- The mapping is a table, not a translation layer:

| uidx | `.fig` |
|---|---|
| document (`uidx.json`) | one file |
| page file | page — one component per file, so one Figma page per component (see below) |
| `<Component>` | `COMPONENT` |
| `<Component variants={…}>` | `COMPONENT_SET`; axes → `componentPropertyDefinitions` type `VARIANT`, domain → `variantOptions`, first value → `defaultValue` |
| `<Variant state="hover">` | child `COMPONENT` named by `buildVariantName`, carrying its `variantPropSpecs`, at the grid position the viewer draws (one layout function, F8's) |
| token file | variable collection; a `"{radius#md}"` binding → the engine's alias shape, per G5 |
| `<Instance>` | `INSTANCE`; `props` → `componentPropertyValues`, variant axes resolved to a `componentId` via `findVariantByValues` |
| intent Markdown | nothing — it has no Figma home, and `--verbose` says so once rather than silently |

- **One component, one file, one Figma page.** The file→page row is the
  identity — a `.uidx` file *is* a page (ADR 0003) and export splits and
  merges nothing — so where a component lands in Figma is decided by where it
  is authored. A design system bound for designers therefore puts each
  component in its own file: `Button/Primary` arrives as its own Figma page,
  named and navigable in the page list, rather than sharing a page with
  whatever it happened to be authored beside. A component's variants (F8) are
  not separate pages — the whole set is one component and stays on its one
  page. ADR 0003 deliberately left both shapes legal, several components on a
  page or one per file, and named the choice as one for teams; this is where
  it stops being neutral. Export maps the layout as-is — a multi-component
  page exports as a multi-component page — and `--verbose` notes any page
  carrying more than one component, so the handoff shape is chosen rather
  than stumbled into. The repo's own examples already follow the convention.
- **Done when a designer can use it, not when the bytes parse back**: import
  the exported file in the Figma app, find each example component on its own
  page in Figma's page list, place an instance of `Button/Primary`, and
  switch it from `default` to `hover` in Figma's own panel. Geometry parity
  on the repo's examples is measured against the viewer, not eyeballed.
- **Two measured gaps stand between S5 and that criterion.** The SDK's own
  round-trip preserves a `COMPONENT_SET`'s type and its children's names but
  drops `componentPropertyDefinitions` and `variantPropSpecs`, and its
  exporter writes a set as a plain `FRAME` — no `STATE_GROUP`, no
  `isStateGroup` anywhere in the SDK. Figma may well reconstruct the axes
  from the `state=hover` child names, which is its own historical convention
  — but that is a hope, not a measurement, and testing it in the Figma app is
  this story's first task. If it does not hold, the fix is upstream in the
  exporter via `patches/` (the size-pill precedent), never a reconciliation
  layer here.
- Slots (F5) have no `.fig` shape: a filled slot exports as the ordinary
  children it produced, and the export says so plainly rather than silently
  (F5's own note).

*This story grades the model rather than adapting to it. ADR 0004 chose a
global namespace **because** export is only mechanical if the model is Figma's
from the start — so anything here that needs a translation table is evidence the
model drifted, and is worth fixing upstream rather than papering over. ADR 0005
was written under the same law, and its variant mapping above is
column-for-column — the model being graded, and passing on paper. See S4, S5.*

### F3. Instances and overrides  — L

> **🟡 composition shipped and live-verified 2026-08-22; authoring an override
> from the canvas is not built** — see the note at the end
> As an **Author**, I want to place one component inside another, so that a
> design system composes.

- Adds `<Instance>` to the whitelist, legal on a page and inside a frame.
- References a component by bare global name — no import, no file qualifier
  (ADR 0004 §2).
- Overrides key off the main component's *internal* address, which is now
  literally the substring after `#`:
  `overrides={{ 'container/label': { characters: 'Save' } }}`.
- Editing an instance writes an override to the consuming page; editing the main
  writes to the page that defines it. **One canvas gesture, two possible target
  files** — which is what C1's page-addressed envelope exists for.
- Cycle detection already exists — G5 built it, because token aliases created the
  first references. This story adds `<Instance>` edges to the same graph rather
  than building a new check.
- Requires D4's non-authored filter to already be true.
- **New, from the 2026-08-19 Figma chrome work:** the layers rail reads
  `doc.tree`, which cannot see an `<Instance>`'s generated children — they are
  not authored source spans, so they have no address to give a row. When
  instances land, those children need adding to the tree as read-only rows, or
  the rail shows a structure the canvas contradicts.

*The multi-file half of this story moved to **G3** and **G6**. What is left is
composition itself.*

What shipped, against each of those points:

**The reference machinery was already there, and that is the story's best
result.** G4 deferred unresolved-reference and cycle checking on the grounds
that `<Instance>` would be the first thing with a reference syntax; token
aliases got there first and built it against real edges. So F3 adds *edges* to
`collectReferences` rather than a second checker, and an `<Instance
component="Button/Primry">` gets UIDX401 with a near-miss suggestion, and a
component that instantiates itself gets UIDX403, through exactly the code path a
token alias uses.

**The one instance-specific decision is where an edge starts.** A token alias
runs from the variable's own address; an instance's runs from *the name of the
`<Component>` it sits inside*, not from the instance's address. That is what
makes a loop close: `A#root/me → A` is not a cycle and `A → A` is. An instance
standing on a page outside any component keeps its own address, which nothing
can target, so it is a source and never part of a loop.

**An instance *is* the component, placed somewhere.** It takes the definition's
own scene properties as its base and the use's are laid over the top — so the
definition decides what the thing looks like and the use decides where it sits.
Its children are grown from the component's, and they are **absent from the
bimap**, which is D4's whole test for "the SDK made this". That rule was written
where the events arrive and had nothing to exercise it until now; the schema
tests that drive a scene edit into a generated child and get no patch back are
the ones it was written for.

**The generated ids are still the addresses those nodes would have had** if
someone had written them there. Not to make them writable — they are not linked,
so nothing can — but because every other part of the viewer already reads an id
as a path, and an opaque id would mean the rail, the hover map and the
hit-testing each needing a second scheme. Nothing can collide with them either:
an `<Instance>` has no authored children, so no real address ever begins with
one.

**`component` and `overrides` are `STRUCTURAL_PROPS`.** Neither is a scene
property — one is a reference into the document's namespace and the other is a
map keyed by addresses inside the component it names — so both are absent from
`PROP_TABLE` and stop at `scenePropFor`. They are in `KNOWN_PROPS` so the §3.3
lint does not call them unknown, and the drift test that holds those two lists
together now names the exception rather than being weakened by it. Putting
either on some other element is an error (UIDX114), because both are spelled
correctly and would silently do nothing.

**A page that uses instances rebuilds rather than reconciling.** An instance's
subtree comes from a definition that may live on another page entirely, so a
page-shaped diff cannot see what changed it: an edited `overrides` map produces
no property change at all, and an edited definition produces changes on nodes
the instances only copy. So `diffDocuments` returns null — rebuild — whenever a
component or an instance is involved, and `CanvasPane` rebuilds when the
component index it drew from has been re-parsed. Deliberately confined: a
document with no `<Instance>` in either version takes exactly the path it always
did, which is every file in this repo before `sign-in.uidx`.

**Expansion is bounded in both places that do it.** The scene builder and the
layers rail each carry the chain of component names they are inside and stop
when one repeats. `uidx check` reports the cycle properly; the renderer's job is
to survive it, because a file is briefly cyclic while somebody is typing and a
stack overflow in the viewer is one keystroke away without this.

**The rail shows the generated children and they do nothing.** Rename, drag,
the visibility toggle and selection are each refused — every one of them would
be a patch aimed at a line that does not exist. Selection is refused for the
same reason `isAddressable` refuses a deep canvas click into an instance, said
the same way in the other pane. `<Instance>` gets Figma's own icon: a single
diamond where `Component` is two, outlined where that is filled.

**Found while threading the resolver through, and fixed:** `insertSubtree`
passed only `resolveAlias` to `scenePropsFor`, dropping `resolveAsset`. A node
inserted incrementally against an image the store had *already* fetched got no
`imageHash` and drew nothing until the next rebuild. Narrow — a first reference
to an image forces a rebuild anyway, because the bytes arriving is itself a
change the diff cannot see — but real, and pre-dating this story.

**Also fixed, and this one is defensive rather than observed:** `CanvasPane`
recorded the component index on *every* render, including the incremental ones
that never consult it. That made the two watchers order-dependent — a save
touching a definition and the rendered page in one tick would let the
incremental render mark the new index as already drawn, and the rebuild the
definition needed would never run. It records the index only in the branch that
actually builds a graph now. The live pass could not make the two changes land
in one tick, so this is correct-by-construction rather than a reproduced bug.

**What is *not* built: authoring an override.** Editing a generated child on the
canvas or in the inspector does not write an `overrides` entry — the child is
unselectable, exactly as D4 requires, and nothing yet turns "the author changed
this generated node" into "add a key to the consuming instance". The story's
"one canvas gesture, two possible target files" is therefore unexercised.
Overrides are read, rendered and checked; they are written by hand. That is a
story of its own — **F3b** — and what it needs before code is a product call on
which properties an override may carry, plus a deliberate change to what
"absent from the bimap" means: today that is `return []` in `fromSceneChange`
and the whole of D4's protection, and F3b needs it to sometimes mean "patch the
owning instance instead".

**One limitation worth knowing.** C7's dimmed fallback for an instance comes
from a bare `INSTANCE` probe in `defaults.ts`, so the panel shows the engine's
answer rather than the resolved component's. An instance's `W` and `H` read as
unset even when the component gives it a size. That is F7's to fix — it is the
story that gives an instance a panel of its own.

### F11. Placing an instance from the UI  — S

> **✅ done** — shipped and live-verified 2026-08-22; the last step of ADR 0006
> §7's workflow
> As an **Author**, I want to drop an instance of a component onto the page, so
> that using the system does not mean typing its name into the file.

F10 made the component and F3 renders instances of it; nothing places one. §3.3's
creation whitelist is the five *drawing* elements, and an `<Instance>` is not
drawn — it needs a name, which means a picker rather than a tool.

- A list of the document's components, which `componentIndex` already builds for
  the canvas and the rail.
- The drop lands as one `insert-node` through `insertTargetFor`, exactly as D1's
  toolbar does; nothing new in the patch path.
- The instance's name is `autoName`'s, from the component's last segment —
  `Icon/Check` placed twice gives `Check-1` and `Check-2`.

*Sized S because every piece exists. What it does not have is a home in the
chrome: the toolbar is a row of five letters and a picker is not one of them.*

What shipped:

**A picker, and then the gesture the five already share.** Choosing a component
arms the canvas exactly as a drawing tool does, so the canvas gains no mode of
its own — `insertTargetFor`, `localTo`, the append rule and the put-itself-away
rule are all D1's, unchanged. A click is the only gesture offered because it is
the only one that means anything: an instance has no size of its own to sweep,
it hugs whatever the component is.

**`placing` is a sibling of `tool`, not a value inside it.** §3.3's creation
whitelist is the five elements a person *draws*, and widening it to carry a
component name would have made "creatable" mean two different things. The two
are mutually exclusive instead — arming either disarms the other, and Escape or
`V` puts both away — because the canvas has one press to give.

**An instance is named after what it is an instance of.** `autoName` on the
component's last segment, so two `Icon/Check`s read as `check-1` and `check-2`
rather than `instance-1` and `instance-2`, which say nothing. The grouping in a
name (`Icon/`) is a namespace, not part of the noun.

**Each button wears the icon of the thing it makes**, which is the rule the five
drawing tools already followed: the rail's filled `Component` for the one that
makes a definition, the rail's outlined `Instance` for the one that places a
use. Placing is greyed out entirely while the document declares no components,
and the empty picker says how to get one rather than just being empty.

**With this, ADR 0006 §7's workflow runs end to end from the UI**: drop an SVG
(D8) → get `<Vector>` nodes → correct them (D12) → make a `<Component>` (F10) →
place `<Instance>`s (F11). Verified as one unbroken sequence in a browser, with
the file never touched by hand.

### F3b. Authoring an override  — M

> ⬜ not started — the half of F3 that is not built
> As an **Author**, I want to change one word of one instance on the canvas, so
> that using a component does not mean forking it.

F3 reads, renders and checks overrides; nothing writes one. The child of an
instance is unselectable — which is D4 being right, not a gap to paper over —
so this story is about giving that refusal an alternative rather than removing
it.

The file the patch lands in is *not* the puzzle, and an earlier draft of this
entry said it was — wrongly. The `overrides` map belongs to the `<Instance>`,
and the instance is on the page the author has open; it is the *component* that
is elsewhere. Editing through an instance writes to the page in front of you.
What makes this a story rather than an afternoon is the other three things.

- **It changes what "absent from the bimap" means, which is load-bearing.**
  Today `fromSceneChange` reads a missing address as "the SDK generated this,
  emit nothing" and returns `[]` — one line, and the whole of D4's protection
  against computed geometry reaching the file. F3b needs that same absence to
  sometimes mean "emit a patch against a *different* node": the instance that
  owns this generated child, with the change folded into its `overrides`. The
  rule stops being "never" and becomes "never, except through this one door",
  and the door has to be narrow enough that a layout reflow inside an instance
  still writes nothing.
- **The patch rewrites a whole map, and the burst machinery assumes otherwise.**
  `overrides` is one attribute holding every override for every child, so
  changing one property of one child emits a `set overrides` carrying all of
  them. `collapseBurst` and `novelPatches` both key on `(address, prop)` and
  would see one long-running edit where the panel's scrub sees a stream of
  distinct ones. Either they learn about maps or the format grows a finer op.
- **Which properties may be overridden is a product decision, and it is yours.**
  Figma allows text, fills, visibility and a few more, and refuses anything
  structural. The options here are "everything the prop table maps" or a named
  subset — and it decides how much of the inspector goes live when a generated
  node is selected. I did not want to pick that on your behalf.
- **Reset needs a vocabulary the inspector does not have.** Figma marks
  overridden properties and offers "reset". Without that an author can override
  something and have no way to see it, or to put it back.

The parts that *are* solved: the key an override needs is `relativeAddress` of
the child within the component, which is exactly what the generated ids already
spell; the rail's generated rows would go live for properties and stay inert for
anything structural, since renaming or reparenting an instance's child is the
component's business.

*Sized M because the mechanics are small. The reason it is not done is the third
bullet plus the first — one product call, and one invariant worth changing
deliberately rather than in passing.*

### F10. Make a component from a selection  — S

> **✅ done** — shipped and live-verified 2026-08-22; surfaced by
> [ADR 0006 §7](decisions/0006-images-and-vector-artwork.md)
> As an **Author**, I want to turn something I have drawn into a component, so
> that the icon I just imported can be used on twelve pages instead of copied
> onto them.

The step between D8 and F3, and the reason ADR 0006 noticed it: the importer
makes `<Vector>` nodes and F3 places `<Instance>`s, but nothing turns the first
into something the second can name. Today that means hand-editing the file,
which is precisely what the canvas exists to stop.

- Wraps the selection in a `<Component name="…" status="draft">` at the page
  level, since ADR 0003 §1 says a `<Component>` is a page child and never nests
  inside a node.
- One `insert-node` plus one `move-node`, or a single richer op — the shape is
  the story's one real question. `insert-node` already carries children
  (`UidxNodeSpec.children`), so wrap-then-move is expressible today; a node that
  is moved *into* the thing being created is what makes it fiddly.
- v1 caps a `<Component>` at one child (`patch.ts`), so a multi-node selection
  wraps in a `<Frame>` first. That is the same rule `canInsert` already enforces
  and must be asked, not re-derived.
- The name is the author's, and it is global (ADR 0004 §2), so a collision is a
  refusal the UI shows rather than a patch that throws — the `canRemove`/`moveFor`
  pattern D1 and D2 already follow.
- The moved subtree's addresses all change, so `remapAddress` and `App.onMoved`
  apply exactly as they do for a reparent.

*Small, and independent of F3: a component can be hand-written today, so F3 does
not wait on this. But the SVG → icon → instance workflow does not close without
it, which is why it exists.*

What shipped, against each of those points:

**The op shape was the story's one real question, and the answer is two ops in
an order the story did not suggest.** `insert-node` the `<Component>` *carrying
a copy of the node*, then `remove-node` the original. The obvious shape — insert
an empty component, `move-node` into it — cannot work: `applyPatches` re-parses
between ops, and a `<Component>` with no child is a UIDX104 error, so the
intermediate document is rejected halfway. That is exactly the "fiddly" this
story predicted, and inserting the component non-empty is the way round it. The
cost is that the moved subtree is re-emitted from its spec rather than moved as
text, so the diff reads as an add and a remove rather than the pure block move a
`move-node` gives.

**Every refusal is a predicate that already existed.** `canRemove` is precisely
"may this node be taken out of where it is", which is the precondition for
moving it into a new component — so a `<Component>`'s sole child and anything
under the synthetic page ADR 0003 §4 implies are both refused without a new
rule. `canInsert(doc, '', 'Component')` answers the other half.

**The name is checked against the whole namespace, not just the components.**
ADR 0004 §2 gives components and token variables one namespace, so `taken` is
both — built in the shell, which is the only place that has every page. A name
holding `#` is refused too, since that character bounds an entity from the path
inside it and a name with one would address something that is not the component.

**Found live, and it is the detail worth keeping.** The first version stripped
the node's `x`/`y` and gave the component none — so making a component
teleported the artwork to the page origin. The position *moves up*: the child's
is dropped (a `<Component>` hugs its single child, so a position there is a
number the file states and the layout ignores — D4's stale geometry arriving by
another door) and the component, which is a page child whose position *is*
authored, takes it. The drawing stays where the author left it.

**The name is asked for before the gesture, not after.** A dialog rather than a
create-then-rename, because a colliding name has to be a refusal the author sees
rather than a second patch that fails — D1 and D2's "grey the control out while
the pointer is still moving", applied to a name. It suggests the node's own
name, says which rule a name broke rather than only that it broke one, and stays
quiet on an empty field, since a dialog that opens already complaining reads as
broken.

**What is still missing from the workflow.** ADR 0006 §7's sequence is *drop the
SVG → get `<Vector>` nodes → make them a `<Component>` → place `<Instance>`s*.
The first three now work from the UI; the fourth does not. §3.3's creation
whitelist is the five drawing elements, so there is no tool that places an
instance, and doing it needs a component picker — a story of its own, noted as
**F11**.

### F6. A component declares its properties — create, manage, remove  — L

> **✅ done** — the format half and the panel, both shipped and live-verified
> 2026-08-22
> As an **Author**, I want to declare a component's properties and edit them
> later, so that a consumer can change a button's label or hide its icon
> without reaching inside the component.

**Unlike slots (F5), the engine already carries this whole model**, so this is
a format-and-panel story rather than a rendering one. A component node has
`componentPropertyDefinitions: ComponentPropertyDefinition[]` —
`{ id, name, type, defaultValue, variantOptions?, preferredValues? }` — and
`ComponentPropertyType` is `VARIANT | TEXT | BOOLEAN | INSTANCE_SWAP`. A layer
inside the component points at one through
`ComponentPropertyReference { propertyId, field }`, where `field` is
`VISIBLE | TEXT | INSTANCE_SWAP`. The work is deciding how a `.uidx` file says
all of that, and what the panel does with it.

- **Key by name, never by the SDK's id.** ADR 0004 made names the addressing
  currency, and Figma's own internal spelling — `Label#8:0` — is exactly the
  qualifier that ADR refused. The build path maps name → id; the file never
  sees an id. Uniqueness within a component is the rule sibling names already
  follow, and a duplicate reports against both declarations the way G4's
  duplicate check does.
- **One binding syntax, not two.** A layer consuming a property is the same
  shape as a value bound to a token, which G5 already ships and `PropertyField`
  already renders as its token with the resolved value beside it. Reusing that
  spelling is worth a great deal; introducing a second one is a cost the format
  pays forever. **Settle this before writing the grammar** — it is the story's
  one real design decision.
- **Rename is a remap, not a rename.** Changing a property's name has to carry
  every reference inside the component and every value set on every instance,
  in one envelope. That is `remapAddress` and `App.onMoved` restated, which D6
  built for reparenting — a second caller, not a second rulebook.
- **Removing one has to decide what instances keep.** Figma drops the value.
  Whatever this picks, `uidx check` is where a stale value surfaces, because a
  hand-edited file is the case that matters.
- `defaultValue` is a **string even for a BOOLEAN** in the SDK. The file should
  carry `{true}` — a real JSON5 boolean under §3.3's grammar — and convert at
  the boundary, the way every other `toScene` / `fromScene` mapping does. Two
  spellings of truth in the authored surface is how a format starts lying.
- **VARIANT is out of scope here, and stays out for good.**
  [ADR 0005](decisions/0005-variants.md) gave variants the grammar this bullet
  asked for: axes are declared by a `variants` attribute on the component (F8),
  not by a property definition, so this story ships TEXT, BOOLEAN and
  INSTANCE_SWAP and never grows a VARIANT row. The two share the `props`
  surface and one name namespace — a collision is a duplicate-declaration
  error against both locations, G4's rule.
- **A naming collision worth settling in the same breath:** this repo already
  calls a scene attribute a "property" — `PROP_TABLE`, `prop-ui.ts`, every
  section C6 built. Component properties are a different thing living in the
  same panel, stacked above the layer's the way Figma stacks them. Name them
  apart in the UI and in the code, or every conversation about "properties"
  from here on costs a paragraph of disambiguation.

*Sized L. The engine work is nothing; the grammar, the rename remap and the
check diagnostics are the story.*

What shipped, against each of those points:

**The binding syntax is settled, and it needed no second spelling.** That bullet
called it the story's one real design decision. The answer is a fact about
addresses rather than a sigil: a token variable's global name *is* its address,
which always contains `#` (`radius#md`), so a bare `{label}` cannot be one. One
syntax, no prefix, and `PropertyField` already renders a bound value as its name
with the resolved value beside it.

**It needed no new path through the mapping layer either.** `scenePropFor`
already substitutes `{target}` before the prop table sees a value, so a
component property is nothing but *a resolver that knows the names in scope* —
`withProperties` in `to-scene.ts`, chained onto the document's. Scoped per
subtree, which is the whole subtlety: two components may each declare `label`
and mean different things, and an inner component shadows an outer one
completely.

**Types are one-to-one with the field they fill**, from the SDK's own
`ComponentPropertyReference.field`: TEXT→`characters`, BOOLEAN→`visible`,
INSTANCE_SWAP→`component`. So a TEXT property bound to `visible` is UIDX404
rather than a string rendered where a boolean belongs and the renderer taking
the blame.

**Resolution joins the pass F3 extended rather than starting a third.** An
unresolved property name is the same UIDX401, with the same near-miss
suggestions, as an unresolved token or component — the difference is only that a
property reference is *scoped*, so it resolves against the component it sits
inside and never joins the global namespace or the cycle graph. A component
whose property is named after itself is not a loop.

**Declarations are keyed by name and validated entry by entry.** A default is
required, because F7 shows an unset property's default dimmed and a property
with nothing to fall back to has nothing to show. A BOOLEAN's default is a real
JSON5 boolean, converted at the boundary the way every other mapping here does.
Every bad entry is reported, not just the first, so a file with three mistakes
takes one pass.

**Found by F6's own test, and it was F3's bug:** `collectReferences` read an
`<Instance>`'s `component` attribute as a literal name even when it held a
binding, so `component="{icon}"` emitted a second edge targeting the literal
`"{icon}"` and reported a name the author never wrote. It skips an aliased value
now. The matching half in the scene builder is that `component` is a structural
prop, so `scenePropFor` never substitutes its alias — `componentFor` is the only
place that can, and now does.

**The panel is a section above the layer's own properties**, the way Figma
stacks them, and named apart from them throughout — "Component properties" in
the UI, `component-prop` in the code — because F6's own bullet warned that this
repo already calls a scene attribute a property and every later conversation
would otherwise cost a paragraph of disambiguation.

**Its edits do not travel the panel's `commit` route, and could not.** `props`
is in `STRUCTURAL_PROPS`, so `scenePropFor` stops it and no scene node ever
carries it — a declaration is a structural edit, and it goes straight at the
document the way the layers rail's do. That is a second `patches` emit on
`PropertiesPane`, beside the `preview`/`commit` pair C4 built.

**Rename is the remap the story asked for**, in one envelope: the declaration
plus a `set` for every layer that read the old name. A document holding a
renamed property and a binding to its old name is one `uidx check` rejects, so
the two cannot be separate saves.

**Removing one bakes its default in wherever it was read**, which is the
decision the story left open ("removing one has to decide what instances
keep"). Simply dropping the declaration would leave a dangling `{name}` — a
UIDX401 and a layer that draws nothing — so removing a property would silently
break the component that declared it. Writing the last default at each site
leaves the component looking exactly as it did and the file saying literally
what it now means, which is what "remove" ought to mean for the person pressing
it.

**Each row says how many layers read it**, because that is the difference
between "this is safe" and "this touches four layers", and the author should
know which they are about to do before renaming or removing.

*Still not built, and F7 did not close it: **`renameProperty` does not carry an
instance's values.** F7 shipped the values, so the debt is now real rather than
hypothetical — rename a property and every instance that set it is left holding
a key the component no longer declares. F7's panel names that state and offers
to drop it, so the file is never silently wrong, but the author still has to
re-set the value by hand. Carrying same-page instances is one more entry in the
binding-site list; carrying instances on other pages needs several envelopes,
because C1's envelope is page-addressed, and that is the part that is not a
one-line change.*

### F7. An instance shows its properties, and assigning one is an edit  — M

> **✅ done** — shipped and live-verified 2026-08-23
> As an **Author**, I want to select an instance and fill in its properties, so
> that using a component is choosing its content rather than overriding its
> insides.

The consuming half of F6, and the half an author actually spends time in.

- The panel lists the main component's declared properties, in the order the
  definition states, with the control the type implies: a text field for TEXT,
  a toggle for BOOLEAN, a component picker for INSTANCE_SWAP whose suggestions
  are the definition's `preferredValues`. C6 and C8 already know how to render
  a typed control; what is new is where the list comes from.
- Assigning writes to the **consuming** page, keyed by property name —
  `<Instance component="Button/Primary" props={{ label: 'Save', icon: false }} />`.
  One gesture, and the file it lands in is not the file that defines the
  component. That is what C1's page-addressed envelope exists for.
- The values reach the scene as `componentPropertyValues` on the instance. D4's
  rule needs no change: a value the author set is authored, and anything the
  component computes for itself is not.
- **An unset property shows its default, dimmed** — exactly C7's treatment of
  an unset scene prop, for exactly C7's reason. The row should say the default
  came from the *definition* rather than the engine, because those are
  different claims and only one of them a person wrote.
- **Resetting a property to its default is `remove` on that key** — the same
  gesture C7's still-open "clear a set property back to unset" item needs. They
  should land as one control, not two that behave almost alike.
- **What it must refuse**, and refuse in `uidx check` rather than only in the
  viewer, because a hand-edited file is the case that matters: a value for a
  property the component does not declare, and a value the definition's type
  contradicts. G4's symbol table already reaches a component by global name,
  which is where its property list will hang.
- An instance whose component has since dropped a property is holding a stale
  value. Say so, name it, and offer to remove it — never keep quietly writing
  a value nothing consumes.

*Sized M on the assumption F6 lands first. Without it there is no list to show,
and building the panel against a guessed grammar is how it gets built twice.*

**`props` on both sides of the contract, deliberately.** A `<Component>`'s
`props` declares the list and an `<Instance>`'s fills it in; reading either is
reading the same set of names, so it is one word rather than two. Their *shapes*
differ — `{ type, default }` against the value itself — so the parser checks
them apart, and the mistake worth catching is copying the component's own line
into the instance, which parses and would otherwise mean nothing.

**Values lay over defaults rather than replacing them**, so "unset" is a real
state that follows the definition when it changes. That is the whole of what a
design system buys, and it is why **reset is a `remove` of the key, not a write
of the default's current value** — the difference between "this instance chooses
the same thing" and "this instance does not choose". The last key going takes
the attribute with it, rather than leaving `props={{}}` for a reader to wonder
about.

**One line changed in the scene builder**, which is the claim F6 made and F7
had to hold up: `expandInstance` already narrowed the alias resolver to the
definition's declared defaults, so laying the instance's own over the top was a
`new Map([...defaults, ...values])` and nothing else. Nested instances come out
for free, because the narrowing was already per-expansion.

**Bad values are filtered on the way to the renderer, not trusted.** A value for
a property that was removed, or a string where a boolean belongs, would
otherwise draw something the document does not mean. They are dropped, the
instance falls back to the default and still draws, and `uidx check` says
exactly what is wrong: **UIDX405** for a name the component does not declare
(with the near-miss suggestion the symbol table already computes) and
**UIDX406** for a value the declaration's type contradicts. Both are silent when
the component itself does not resolve — `checkReferences` already said the one
thing the author can act on.

**The panel names a value nothing consumes, in two sentences for two mistakes.**
The stale one the story asked for, and one it did not: a *mistyped* value draws
as an unset row, because that is exactly what the renderer does with it, so
without a word about it the row would read "nothing chosen here" while the file
plainly says otherwise. `uidx check` naming it in a file the author may not have
open is not good enough for the panel that is showing them the row. Neither can
be produced by pressing anything in the panel; both arrive by hand.

**`examples/sign-in.uidx` now uses properties rather than the override it
shipped with.** The escape hatch stays in the format — the product call was to
keep `overrides` for what no property covers yet — but the repo's own example of
using a component should show the route it wants people on, and its
anti-patterns now say so.

*Known limitation, unchanged by this story and now visible on every instance:
C7's dimmed fallback probes a bare `INSTANCE` node in `defaults.ts`, so an
instance's `W`/`H` read as unset even when the component gives it a size.*

### F8. Variants — a component declares its states, side by side  — L

> **✅ done** — shipped and live-verified 2026-08-23
> As an **Author**, I want one component to carry its states — default, hover,
> pressed, disabled — so that a button is one entity with four looks rather
> than four components pretending to be related.

[ADR 0005](decisions/0005-variants.md) decides the model; this story builds
it. One `<Component>` declares its axes and holds one full tree per
combination — no component-set element, no promotion ceremony, and no
`State=Hover` name microformat anywhere an author types:

```mdx
<Component name="Button/Primary" status="stable"
  variants={{ state: ['default', 'hover', 'pressed', 'disabled'] }}>
  <Variant state="default">
    <Frame name="container" ...>...</Frame>
  </Variant>
  <Variant state="hover">
    <Frame name="container" ...>...</Frame>
  </Variant>
</Component>
```

- `<Variant>` joins the grammar, legal only directly under a `<Component>`
  that declares `variants`; its attributes are exactly the declared axes. The
  §3.3 whitelist does not apply to it — the token tree's carve-out, again.
- The parser enforces the ADR's rules, each diagnostic naming the fix: an
  axis value outside the domain, an unassigned axis, a duplicate combination,
  a missing default combination (every axis's first value), `variants`
  declared over plain children, and `#`, `/`, `=` or `,` in an axis name or
  value.
- A variant's name — and so its address segment — is **derived** from its
  coordinates in declared axis order:
  `Button/Primary#state=hover/container/label`. The derivation lives in
  `@uidx/format`, which owns names; a drift test in `@uidx/schema` pins it to
  the SDK's own `buildVariantName`, the package that can see both spellings.
  Changing a coordinate is therefore a rename and rides `remapAddress`.
- `toSceneGraph` builds what the SDK already speaks (measured, see S5):
  a `COMPONENT_SET` carrying `componentPropertyDefinitions` of type
  `VARIANT`, one `COMPONENT` child per `<Variant>` with its
  `variantPropSpecs`.
- Variants render side by side inside a labelled set outline — first axis
  along a row, further axes stacking rows. The grid is **generated, never
  authored**: one layout function in `@uidx/schema` (F2's exporter needs the
  same positions), and `authorship.ts` gains the predicate that nothing about
  a `<Variant>`'s geometry is authored, so a reflow burst can never write a
  variant's position (D4's law).
- Everything inside a variant is an ordinary authored node — selection, the
  rail, the inspector and span patches work verbatim, which is the entire
  argument for full trees. The rail shows `<Variant>` rows with rename
  disabled: a variant has no name of its own, and its coordinates are F9's
  business.
- `uidx fmt` prints the canonical shape; `uidx check` covers the diagnostics
  above; the repo's own example grows a hover state on `Button/Primary` so
  the gate dogfoods it.

*Sized L: the grammar and diagnostics are an M, but the derived-name law, the
set rendering and the authorship predicate reach format, schema and viewer.
Needs neither F3 nor F6 — a page of variants renders with no instance in
sight.*


**The whole of the grammar, and one carve-out.** `<Variant>` joins `ELEMENTS`
and `CONTAINER_ELEMENTS` with a child table of its own (`COMPONENT_CHILD_ELEMENTS`),
`variants` joins the component's metadata-shaped attrs rather than `KNOWN_PROPS`
— it decides what gets *built*, one `COMPONENT_SET` instead of one `COMPONENT`,
rather than being set on anything — and the §3.3 lint skips a `<Variant>` the
way it skips the token tree. Five diagnostics, each naming its own fix:
**UIDX117** the declaration's shape, **UIDX118** one variant's coordinates,
**UIDX119** a duplicate combination, **UIDX120** the missing default, **UIDX121**
the two shapes mixed. Plus **UIDX407** at the *use* site for a combination
nobody designed, because sparseness is deliberate in the component and a
mistake in the instance.

**A duplicate combination arrives as a duplicate derived name**, which is
correct mechanically and wrong to say out loud — nobody wrote that name. It
gets its own code and its own sentence, about the thing the author did write.

**Coordinates are ordered by the declaration, not by the tag.** Two variants
writing their axes in different orders derive the same name for the same
combination, so a rename is never an accident of typing order. That single
choice is what makes the derived name a *function of the component* rather than
of a JS object's insertion order, and it is guarded.

**The set/component split lives in the schema layer and nowhere else.**
`nodeTypeFor` is the one place a `<Component>` that declares variants becomes a
`COMPONENT_SET`; there is deliberately no second `NODE_TYPE` entry, because an
author never writes a `<ComponentSet>` and a table keyed by element name would
imply they could. Every node inside a variant stays an ordinary authored source
span, which is the decisive argument for full trees: selection, the rail, the
inspector and span patches all applied verbatim, with no code written for them.

**The arrangement is a measured pass, not auto-layout**, and that was forced
rather than chosen: `computeAllLayouts` on a set leaves every variant at its
default 100x100 box, so each variant is laid out on its own and then placed.
`arrangeVariants` in `@uidx/schema` is the one function that decides where —
first axis along a row, further axes stacking rows, columns as wide as their
widest cell — and F2's exporter will call the same one, because an exporter
cannot ask a renderer where things ended up.

**The update path needed the same pass, and finding that out was the point of
the live check.** `applyChanges` re-runs layout per top-level entity; without
teaching it about sets, an edit *inside* one variant resized that variant and
left it overlapping its neighbour. It now shares `layOutSets` with the build
path, and a test pins the two to the same numbers.

**The axes reach the scene as `componentPropertyDefinitions`**, keyed by name
(ADR 0004's currency; Figma's own `Label#8:0` is the qualifier it refused), with
`variantPropSpecs` on each variant derived from the *name* rather than the
attributes — the name is already in declared order. They are there because F2
needs them, and the arrangement's ability to recompute from the graph alone is
what made them necessary now rather than later.

**D4's new predicate is the whole node, not the geometry.** ADR 0005 asked for
"nothing about a `<Variant>`'s geometry is authored"; a `<Variant>` also has no
legal attribute beyond its coordinates, so `fromSceneChange` returns `[]` for
one outright — any patch it produced would write a line `uidx check` rejects.
The rail refuses rename, drag and the visibility toggle for the same reason, on
a new `derived` flag that is deliberately *not* `generated`: a variant row has
a line in the file and is selectable, and its children are ordinary.

**An instance picks a combination through `props`** (§4), so F7's panel is the
whole of the UI — one surface, one spelling, one namespace. What is new is the
control: an axis has a *stated domain*, so it draws as a picker rather than a
text field, and a value outside it is refused before it can be typed. Resetting
an axis is the same `remove` of the key F7 built, which is what makes an unset
axis follow the component's default combination.

**`examples/toggle.uidx` is new rather than a hover state bolted onto
`Button/Primary`.** The story asked for the latter; `primary-button.uidx` is the
repo's canonical addressing fixture and some twenty test files read its
addresses, so growing it a variant would have meant rewriting all of them to
demonstrate a feature. The new example is a better demonstration anyway — a
toggle's whole meaning *is* its state — and it carries two axes, a deliberately
sparse combination, and three instances picking different ones.

*Not built, and it is F9's: no gesture creates a `<Variant>`, declares an axis
or adds a value. F8 renders and checks what a person writes; F9's "the editor
manages the set" is the other half. F9's first half — an instance picking a
variant — shipped here, because it was one control in a panel F7 had already
built.*

*Also untested and worth a look before F9: an `INSTANCE_SWAP` property pointing
at a component that has variants.*

### F9. An instance picks a variant; the editor manages the set  — M

> **✅ done** — shipped and live-verified 2026-08-23
> As an **Author**, I want to flip a placed button to its hover state, and to
> grow the set — a new state, a new size — without hand-writing trees, so that
> variants are something I use, not only something the file can hold.

The consuming half of F8, the way F7 is F6's. Two halves sharing one surface:

- **Picking.** `props={{ state: 'hover' }}` on an `<Instance>` selects the
  combination; an unset axis falls back to its default, so a bare instance
  renders the default variant. The panel renders each axis as the enum
  control its declared domain implies (C6/C8 machinery), stacked above F7's
  TEXT and BOOLEAN rows the way Figma stacks them. The scene side is the
  SDK's own `switchInstanceVariant` / `findVariantByValues`.
- Switching re-applies overrides by path — ADR 0005's "override keys never
  name a variant" rule, which is also Figma's behaviour — so flipping to
  hover does not cost the author their `characters: 'Save'`.
- An unset axis shows its default dimmed, with the *declaration* named as the
  source — C7's unset treatment under F7's provenance rule. Resetting is
  `remove` on the key, the same control F7 lands.
- **Refused in `uidx check`, not only the viewer**, because a hand-edited
  file is the case that matters: a value outside the axis domain, an axis the
  component never declared, a combination no `<Variant>` provides — each with
  near-matches from `suggest()`, reported at the use site.
- **Managing.** "Add variant" duplicates the default variant's tree under new
  coordinates — one `insert-node`. "Add axis" extends the declaration and
  every existing variant with the new axis's default, one envelope. Renaming
  an axis or a value is a **remap, not a rename**: the declaration, every
  `<Variant>`'s attributes and derived address, and every instance's `props`
  across the document move together — F6's rename law and D6's machinery, a
  third caller rather than a third rulebook.
- Deleting a variant an instance depends on leaves that instance pointing at
  nothing; `uidx check` says so at the use site and names the nearest
  surviving combination.

*Sized M on F8's model doing the heavy lifting. The picking half sits behind
F8, F3 and F7; the managing half needs only F8 and can land with it if
instances are still out.*

**The picking half shipped inside F8**, because it turned out to be one control
in a panel F7 had already built: an axis is a `props` row with a stated domain,
so it draws as a picker. Everything the story asks for there — the fallback to
the default combination, overrides re-applying by path across a switch, reset as
`remove` on the key, and the three `uidx check` refusals (UIDX405/406/407) — is
in F8's entry.

**A format constraint shaped every operation here, and it was measured rather
than assumed.** `applyPatches` re-parses between ops, so every *intermediate*
document has to be valid on its own — and a `<Variant>`'s coordinates live on
the variant while their domain lives on the component. Declaring an axis first
reports UIDX118 on every variant that has not got it yet; writing the attribute
first reports UIDX118 for an axis nobody declared. There is no ordering, because
no op spans two nodes.

So the managing half divides in two, and the division is the format's:

- **Add a state, remove a state, add a value to an axis, remove a value** —
  each one clean patch. Adding a *value* needs no variant change at all, because
  combinations may be sparse; that is what makes "add a state" and "design it"
  two honest steps rather than one pretending to be one.
- **Rename a value** — possible, by widening the domain to hold both spellings,
  moving each variant, and narrowing again. Three ops, every one of them a
  document that parses. The widening is *ordered* so some combination is still
  the default at every step, or the middle document trips UIDX120.
- **Add, remove or rename an *axis*** — **not built, and not buildable** under
  the current invariant. Each needs the declaration and every variant to move
  together. The two honest ways out are a whole-component `remove-node` +
  `insert-node` (which loses the formatting and comments inside it) or a new
  multi-node atomic op in the patch format. That is a decision to put to the
  user, not one to make quietly.

**Adding a state copies the closest existing one**, measured by shared
coordinates — so a new `size=sm, state=hover` starts from the `state=hover` row
rather than from whatever was declared first. A variant holds exactly one child,
and an author adding a state wants a tree to edit, not a blank frame to rebuild.

**Two removals are refused rather than cascaded**, each with the sentence that
names the next step: the *default* combination (an instance saying nothing
renders it — reorder the axis first) and an axis value some state still uses
(dropping it would take designed work with it). A panel that produces an invalid
file is worse than one that says no.

**Three of the patcher's structural guards predated `<Variant>` and were wrong
about it** — found by building this, and invisible to F8, which only ever *read*
variant files. The child whitelist refused a `<Variant>` inside a
`<Component>`; the one-child rule refused the second state; and the auto-namer
invented a `name=` on a node whose name is derived, producing UIDX118.

**F7's named debt is closed here.** Renaming a component *property* now carries
the instances that set it, across pages. F6's note called the remaining work "the
binding-site list"; the real blocker was the *envelope*, which is page-addressed
— so the shell now tracks a revision per page and sends one envelope per file.
Not atomic across files, and it cannot be: two pages do not share a revision, so
a rename whose second envelope goes stale leaves the document briefly
disagreeing with itself, which `uidx check` reports precisely rather than
leaving anyone to guess.

**A real bug the live pass found, in F6's code rather than this story's.** The
rename input committed on `keydown.enter` *and* on `blur` — and Enter clears the
rename, which unmounts the input, which fires `blur`. Two identical envelopes.
Latent since F6, where two `set`s of one attribute rebase cleanly and nobody
notices; visible the moment a rename became several ops, because the second
envelope finds the nodes the first renamed and the shell says an edit that
landed "was not applied". Both panels now commit only from the row still being
renamed.

### F12. Linking a layer's value to a property, from the panel  — M

> **✅ done** — the link controls, the dialog and the section restyle, shipped
> and live-verified 2026-08-23
> As an **Author**, I want to link a layer's value to one of its component's
> properties from the panel, so that declaring `characters="{label}"` is a
> gesture rather than a hand edit.

F6 declared properties and F7 assigned them on an instance, but the direction
between the two was never built: *inside* a component, a binding could only be
typed into the file. The panel rendered a bound row and offered a detach, and
that detach was disabled for every binding that mattered.

**The disabled detach was the tell, and it was a real bug.** `PropertyField`
gated it on `resolvedValue === null`, and `resolvedValue` is `number | null` —
number-typed because a bound row's control is the token scrubber. A TEXT
property never resolves to a number, so the button read "replace the binding
with null" and refused. Unlinking now writes the property's *declared default*
instead, which is a value every type has and which leaves the canvas unchanged.

**The bindable fields are `PROPERTY_FIELD` read backwards**, not a second list.
`propertyTypeForField` inverts the map F6 built, so the menu on `characters`
offers TEXT declarations and nothing else, and UIDX404 — a TEXT property bound
to `visible` — is unreachable from the UI rather than merely unlikely.

**A property binding and a token binding stopped sharing a row.** They still
share one *syntax*, which F6 settled and which nothing here disturbs; what they
do not share is a presentation. A token shows its resolved value because that
number is the point; a property shows its name alone, the way Figma's pill does,
because the resolver has no answer for it and Figma displays none either. The
address fact that separates them is the one F6 already relies on: a token's name
contains `#` and a property's may not.

**Declare-and-link is one envelope**, for the reason `renameProperty` is: a
declaration nothing reads and a `{name}` nothing declares are each a document
`uidx check` rejects, so neither may be a separate save. The dialog seeds its
default from the literal the field held, so the gesture leaves the canvas as it
was — which is what makes it safe enough to try.

**`editProperty` replaced `renameProperty` underneath.** The edit dialog changes
a name and a default together, and both write the whole `props` attribute — two
envelopes would compute the second against the map the first replaced.
`renameProperty` is now that function with the default left alone, so the
cross-page instance sweep F9 built has exactly one caller's worth of rules.

**The section reads as statements rather than controls.** A property was a name
button, a type word, a default input and a remove button — four controls per
row. It is one pill now (glyph, name, value) with edit and remove on hover, and
`+` opens the same dialog a row's edit does. That cost the inline rename input,
and with it the blur-after-Enter double-fire F9 had to guard: a modal has one
submit and no blur to race it. The invariant that guard protected — one envelope
per submit — is still tested.

*Sized M. The format layer needed no changes at all: `PROPERTY_FIELD`,
`bindingFits`, `propertyBinding` and `bindingSites` were all already there, and
the story is the panel plus the two edit helpers.*

### F13. Figma parity — sections, naming, and the instance-swap row  — M

> **✅ done** — labels, regrouping and the swap row, shipped and live-verified
> 2026-08-23. Spec: [panel-figma-parity.md](panel-figma-parity.md).
> As an **Author who uses Figma**, I want the panel's sections, wording and
> assignment controls where Figma puts them, so that nothing has to be hunted
> for twice.

**The relation between sections and assignment turned out to be a rule, not a
coincidence**, and Figma states it: a boolean property is applied from the
Appearance section, a text property from the Text section at the top, an
instance swap from the top of the panel. Each type fills one input, the apply
affordance lives on that input, and the input's section is fixed. UIDX already
had the rule as data — `PROPERTY_FIELD` — and F12 built apply/switch/remove on
it; what was misplaced was everything around it.

**Content sat in the seventh section.** A `<Text>` now leads with Text, which
is Figma's placement and the reason is the field itself: Content is the layer's
payload and the anchor a text property binds to, so burying it under six
geometry sections read as an afterthought. `sectionOrderFor` is element-aware;
every other element keeps the standard order.

**Position and Layout split the way UI3 splits them** — where a node *is*
versus how it *sizes*. The dimensions and min/max moved into Layout, which also
absorbed the separate "Layout child" section and `strokesIncludedInLayout`
(Figma keeps the inside-stroke toggle in auto-layout settings, because it is a
layout fact about a stroke rather than a stroke fact). One Layout section,
holding two kinds of prop: the auto-layout ones a frame owns, and the
dimension and participation ones every element has. The old drift test asserted
*every* layout prop was frame-restricted; it now pins the auto-layout subset,
which is the invariant that was actually meant.

**Field order inside a section became a decision instead of an accident.**
`FIELD_ORDER` states it, and Visible leads Appearance for the same reason
Content leads Text — it is the row a boolean property binds to.

**Every row and every enum option says Figma's word.** `PropUi.label` covers
the rows, a screaming-snake prettifier plus a small override map covers the
options, and both are presentation only: the file and every patch still carry
the authored name and the canonical value. Two drift tests hold the line — no
entry without a label, and no two options inside one domain reading alike. The
second earned its keep immediately: Figma offers wrap spacing as "Auto", but
`counterAxisAlignContent`'s *other* value is `AUTO`, and reading unlike Figma
beats reading ambiguously.

**Instance swap got the UI F12 left it without**, completing the
type↔input↔section triangle. The helper layer needed nothing — `bindCandidates`
and friends already accepted `component` — so the story was the row, and the
row is above the sections because `component` is a `STRUCTURAL_PROP` that never
reaches a scene node. The structure and Figma's placement agree.

**The link controls became one component rather than three lookalikes.**
Reusing F12's menu honestly meant lifting it out of `PropertyField` into
`PropertyLink`, which is what lets Content, Visible and the component picker be
the same gesture wherever a Figma user meets it.

*Sized M. No format or schema-mapping change: the whole story is `prop-ui.ts`
plus the viewer.*

### F5. Slots — a component declares a hole, an instance fills it  — L

> **🟡 grammar, render and diagnostics shipped 2026-08-28; two gestures and a
> format decision remain** — [ADR 0007](decisions/0007-slots.md) and
> [the design spec](superpowers/specs/2026-08-26-slots-design.md), 2026-08-26
> As an **Author**, I want a component to declare a slot that each instance
> fills with its own content, so that a card, a dialog or a list row is one
> component rather than one per body.

Figma's slots answer the oldest complaint about instances: you can override
what is already there, but you cannot put something new inside. A slot is a
declared hole — it takes part in the definition's layout, it can carry default
content, and the consumer decides what goes in it.

- `<Slot name="body" />` inside a `<Component>`, with names unique within that
  component the way sibling names already are.
- **A slot's layout belongs to the definition, not to what fills it.** Sizing,
  alignment and grow are the slot's own, so a card decides how its body sits
  and the consumer decides only what the body *is*. That is the whole
  difference between a slot and "an instance you may add children to".
- Default content is the slot's children in the definition, shown when a
  consumer fills nothing — Figma's placeholder, and the reason a slot is worth
  more than an empty frame.
- Filling is authored in the **consuming** page: an `<Instance>` gains children
  addressed by slot name. Those children are real authored source spans in that
  page, unlike an instance's generated children — so they have addresses, they
  can be selected, and the rail can show them as ordinary rows. That is exactly
  the gap F3's last bullet names.
- **Update means both halves**, and they are different operations: renaming or
  re-laying-out a slot in the definition, which every instance must follow, and
  swapping the content of one instance, which no other instance may see. The
  first is a patch to the defining page, the second to the consuming one —
  C1's page-addressed envelope is what makes that expressible.

**Both open questions are now settled** by ADR 0007, written 2026-08-26 against
Figma's own slots feature. The SDK has no slot node — measured, not assumed:
`NodeType` is eighteen values and none is a slot, and the only occurrence of the
word in `@open-pencil` is a sentence inside a React codegen prompt. So
`toSceneGraph` decides, and §1 says a `<Slot>` lowers to a `FRAME`. `.fig`
export flattens and **reports** the loss rather than dropping it quietly (§6),
which stays F2's to verify.

Three decisions the ADR adds beyond the sketch above: the same `<Slot>` element
declares and fills, with its *position* deciding whether it may carry layout;
the fill's scene id follows the definition's position while its address follows
the file, which is what keeps "an id is a path" true while leaving the fill
writable; and deleting a slot is a `uidx check` error at every fill site rather
than Figma's silent, destructive reset.

*Depends on F3 — a slot is a feature of instances, and there are no instances
yet. Sized L for F3's reason: the grammar is small and the consequences reach
the rail, the address space and the exporter.*

**What shipped 2026-08-28.** `<Slot>` is in the grammar; `<Instance>` is a
container whose one legal child is a fill; a fill carries `name` and nothing
else; seven diagnostics (UIDX130–133 per-file, UIDX410–412 cross-page); the
renderer substitutes fill for default and links fill nodes into the bimap; the
rail draws slots and their fills; the toolbar makes a slot. `examples/card.uidx`
and `examples/dashboard.uidx` carry all three of ADR 0007 §2's states through
the CI gate, so `uidx check` over `examples/` is the regression test.

**Two rules could not be stated where the spec put them**, and both were found
by building it rather than by reading the plan again.

- **A fill's emptiness is a fact about position, and `appliesTo` is keyed by
  element.** `sectionsFor` gates it, where the parent is already in hand.
  Without that the panel offers `layoutMode` on a node whose write the parser
  rejects as UIDX131 — a control that cannot be obeyed.
- **`canInsert` and `moveFor` each kept a private copy of the child-element
  rules**, which went wrong the moment `<Instance>` became a container: both
  would have let a `<Text>` be dragged straight into an instance. Both now read
  `legalChildElementsOf`, the parser's own table. The rule has one home, the way
  `isWithin` does for address algebra — and the second copy was a defect exactly
  as this repo's working agreement says.

**The live pass found what 1077 passing tests did not.** Every card drew
correctly on the canvas while the rail showed `placeholder` under all three,
including the two that fill the slot. `layerRows` mirrors `expandInstance` — its
own comment says the two have to agree — and the substitution went into one and
not the other, so the rail cloned the default and marked it `generated`, the
flag that makes a row inert. That undid the story's headline: slot fill is meant
to be the first content under an instance that can be selected, and it was, in
the bimap and on the canvas, and was not in the one pane an author reaches for.
Fixed; the row now carries the fill's *address* rather than the cloned scene id,
which is ADR 0007 §3's divergence arriving in a third place.

**Not built, and each for a stated reason:**

- **Convert to slot** — shipped with F14's `retag`. It lives in the inspector
  rather than on the toolbar: the five drawing tools up there are modes you arm
  and then use, and this is a thing done to whatever is already selected. It is
  offered for **any** element whose attributes would still mean something on a
  `<Slot>` — a frame, a bare rectangle — and withheld from a `<Text>` or a
  `<Vector>`, because the §3.3 prop whitelist is global and `characters` or
  `vectorPaths` on a slot would be a document that validates and means nothing.
  `appliesTo` in `prop-ui.ts` is the one per-element table that can say so, so
  it is the one that decides. *Originally deferred because* it rewrites an
  element's tag in place and **no patch op did that**: `set`/`add`/`remove` carry attributes, the node ops
  carry whole subtrees. Doing it as remove-plus-insert would reprint everything
  inside the frame, which is the one thing this format promises never to do. A
  format decision of the same shape as F9's variant-axis problem, and it went to
  the user as **F14** rather than being settled inside this story.
- **A slot outside a component** was accepted at any depth below a page-level
  frame — the check only refused a page's *direct* child, while ADR 0007 §1's
  reason is about being outside a component. Fixed on both sides: the parser
  threads `inComponent` down its descent, and `canInsert`/`moveFor` walk up for
  the same fact, so the rail cannot offer what the checker rejects.
- **The first fill by drop, Reset slot and Delete contents** all shipped
  alongside it. Reset needed no new patch — removing the fill *is* the reset —
  while Delete contents is its own gesture, because `<Slot name="body" />` and
  no fill at all are different documents that render differently.

**Still not built:** placing an instance directly into a slot (F11's toolbar
gesture aimed at a slot under the cursor).

### F15. A component is a frame (ADR 0008)  — M

> **✅ done** — shipped 2026-08-28. [ADR 0008](decisions/0008-component-is-a-frame.md)
> As an **Author**, I want the component I make to *be* the frame I drew, so
> that I am not handed a wrapper I never asked for and an extra segment in
> every address inside it.

- **The one-child rule is gone from `<Component>`** and stays on `<Variant>`,
  which never shared it for the same reason: a variant is one state's tree and
  `arrangeVariants` measures one box per variant. A relaxation, not a break —
  every file written under the old rule still parses and addresses the same way.
- **`retag` grew an `attrs` payload**, because a `<Component>` without `status`
  is UIDX110 and a `<Frame>` with one is UIDX111, and `applyPatches` re-parses
  between ops — so there is no order in which the tag and its metadata are two
  patches.
- **"Make component" is a retag**, and was the last gesture in the editor that
  reprinted a subtree. It still *wraps* what cannot be a component — a
  `<Vector>` carrying `vectorPaths` is not a frame and never will be, and F10
  exists so a drawn mark becomes a component (ADR 0006 §7). Which of the two an
  author gets is decided by `attrsSurviveAs`, the same per-element question
  slots ask, rather than by a special case.

*Unwrapping existing files is a migration nobody has written yet: it shortens
addresses, and an address is a contract `overrides` keys hold. See ADR 0008 §4.*

### F16. `status` becomes optional (ADR 0009)  — S

> **✅ done** — shipped 2026-08-28. [ADR 0009](decisions/0009-status-is-optional.md)
> As an **Author**, I do not want to be labelled `draft` by a dialog that never
> asked me, on a field I have no way to change.

Required, it produced `draft` on everything and collected no maturity
information at all. Three things ADR 0003 §3 did not account for, all visible
the first time somebody made a component: `status` is excluded from
`editableProps` and absent from `PROP_UI`, so **no control for it exists or
could**; "Make component" wrote it because the grammar demanded a value; and
none of `draft | stable | deprecated` means "I have not thought about this yet",
which is the true state of a component at the moment it is drawn.

Optional now, still checked when present, and nothing writes it on the author's
behalf. UIDX108 is retired in place — the table is append-only.

*Named and not closed: if `status` is worth keeping, it is worth a control. A
row in `PROP_UI` with its three values is the shape that would take.*

### F14. `retag` — changing an element's tag without reprinting it  — S

> ⬜ **decided 2026-08-28**: add the op. Surfaced by F5, and it unblocks
> "Convert to slot"
> As an **Author**, I want to turn a frame I already built into a slot without
> losing the comments and formatting inside it, so that retrofitting a
> component is a one-word diff rather than a rewrite.

The patch format has three attribute ops and three node ops, and nothing that
changes what an element *is*. Every gesture that wants one today has to fake it
by removing a subtree and inserting it back — which reprints everything inside,
the one thing "never reprint" forbids.

- `{ op: 'retag', address, element }` rewrites the tag name in the open tag and,
  when the node is not self-closing, in the close tag. Two span replacements
  over offsets the parser already records, which is the same machinery every
  other op runs on.
- **Refused when the result would not parse**, by the guard that already exists:
  `applyPatches` re-parses and rejects a document that does not validate, so a
  retag into an illegal position fails as a rejected patch rather than a broken
  file.
- The address does not change — a retag is not a rename — so nothing downstream
  has to be remapped, which is what makes this an S rather than D6 all over
  again.

*Named here rather than settled inside F5, because a new op is a format
decision and this repo's rule is that those are put to the user. The two
alternatives were: remove-plus-insert, which loses the node's insides, and
leaving convert-to-slot unbuilt.*

### F4. Libraries — cross-document reuse  — L

> ⬜ not started
> As an **Author**, I want to consume a component from another document, so that
> two products can share one design system.

- `design-system:Button/Primary` — the `:` qualifier ADR 0004 §4 reserved.
- The character is reserved now precisely so this story does not change the
  address grammar when it arrives.
- Figma's own model: within a document you reference; across documents you
  publish and consume. Version and update semantics are the real work here, not
  the syntax.

---

## Measured — 2026-09-05, the instant-edit loop

Spec: `superpowers/specs/2026-09-05-instant-edits-and-inverse-patch-undo-design.md`.
Plan: `superpowers/plans/2026-09-05-instant-edits-and-inverse-patch-undo.md`.
Measured on `design-systems/meridian/atlas.uidx` (63,396 lines, 7,141 nodes)
in the viewer against `uidx open`, eye toggle on a top-level row.

| Stage | Before | After |
|---|---|---|
| Rail and canvas show the change | 7 s (after the round trip) | 54 ms (predicted, same tick) |
| Server round trip to `file:changed` | 2.6 s | 1.6 s |
| Client task when the confirmation lands | 4.1–4.4 s (full rebuild) | 0.3–0.4 s (diff + one re-record) |
| Patches leaving the socket per toggle | 1, plus a 413-op reflow burst under the incremental path | 1 |
| Server cost of a 400-op attribute batch | ~400 parses (minutes; wedged the process) | 1 parse (~3.5 s in the test, parse included) |

Follow-up the same day: a toggle on a node *inside* the Atlas component (the
page instances it fifteen times) still paid a full rebuild on the click,
because the diff treated any change inside a component as a rebuild. It now
updates each instance's copy in place; measured on
`Atlas#station=approach, land=mesh/atlas`: no blocking task at the click,
0.25–0.33 s when the file confirms, where the same toggle had cost 1.8 s at the
click and 3.5 s at the confirmation.

Second follow-up: with the canvas confirmed ready, the same toggle still cost
2.5 s at the click and a rebuild at the confirmation. Two causes: the
incremental apply re-laid out every top-level entity (the whole `doc` frame,
0.6–0.9 s), and the components watch compared the whole component index a
tick after the diff had drawn the same-page change. Layout is now targeted
(36 ms in node for the atlas toggle) and the watch compares foreign
definitions only.

Three defects closed on the way: the server parsed every patch twice (and the
harness every op twice); an unvouched geometry change overwrote alias-bound
sizes with literals; and component definitions were compared by node identity,
so a page that declared a component rebuilt on every save.

Undo (⌘Z / ⇧⌘Z) is live for author edits, outside edits and LLM turns, as new
inverse writes through the same channel — verified live on atlas for an eye
toggle (revisions 7–9) and for an outside `opacity` edit (revisions 10–11).

Left for later stories (spec §7): structural-op prediction, group ids from
`uidx apply` / `uidx_apply`, stack persistence, incremental re-parse, a
re-resolve message instead of the dependent re-broadcast.

## Measured — 2026-09-05 (evening), the viewer-at-scale story

Spec: `superpowers/specs/2026-09-05-viewer-at-scale-design.md`.
Plan: `superpowers/plans/2026-09-05-viewer-at-scale.md`. Same atlas page.

| Stage | Before | After |
|---|---|---|
| Server parse per patch | 1.0 s (whole file) | 0.2 s (one element re-lowered) |
| `file:changed` on the wire | 15 MB document | 212-byte delta; dependents get a 50-byte re-resolve |
| Click to confirmed revision (rail probe) | 1.6–2.6 s | 0.5 s |
| Client diff on confirm | 0.3 s | milliseconds (shifted copies compared by attribute text) |
| LLM / `uidx apply` write | file write, watcher, 1 s re-parse | `POST /__uidx/patch`, one write, delta broadcast |
| Renderer on a version bump | every page child re-recorded | only chunks the viewer marked dirty |

Two follow-ups the same evening, after the first live pass still felt slow on
atlas: plain attribute edits (visible, fills, opacity, …) now skip parsing
entirely — the tree takes the value and offsets after it move — 20 ms on atlas
where the element re-lowering was 194 ms; and the renderer draws a page child
with more than 512 descendants as its own paint plus one cached picture per
child, so a toggle inside one atlas section re-records that section, not the
whole `doc` frame (atlas has only two page children, so page-child chunks
alone re-recorded everything).

Third follow-up: toggling an *instance* (the states grid on atlas) or the
component root itself still rebuilt, because any attribute change on an
`<Instance>`, `<Component>` or `<Variant>` node was treated as a change to
what instances expand to. Now only `component`, `props`, `overrides`,
`layoutGrow` (and a root's `variants`/`props`/coordinates) rebuild; the
instance's own look, and a root's, recompute each instance root in place
(`update-instance-root`), tested against a full rebuild.

Verified live: an eye toggle travels as a 1-patch delta and the client's applied
hash matches the server's (no `page:request` needed); undo the same; two POSTs
to the patch route landed as revisions 4 and 5; `uidx apply` posts through the
route when the viewer is open. The renderer chunking could not be timed in the
desktop pane (hidden panes never initialise the canvas); it is the one item
awaiting a visible-tab measurement.

## Measured — 2026-09-05 (late), an edit costs the edit

The states-grid toggle on atlas still took over a second. Measured with the
canvas live rather than reasoned about, and the answer was in four places, none
of them where the previous rounds had guessed.

| Stage | Before | After |
|---|---|---|
| Prediction (client) | 94 ms | 1 ms |
| Canvas diff | 11 ms | 23 ms |
| applyChanges (layout) | 163–191 ms | 4 ms |
| First scene render | 235–251 ms | 58 ms |
| Server patch through the workspace | 2,370 ms | 67 ms |
| Click → painted, end to end | >1 s | 130 ms, confirmed at 126 ms |

What each one was:

- **`startsOf` in `format/diagnostics.ts` was a scan, not a cache.** It kept
  line starts in a `Map` keyed by the whole source, so every one of the
  thousands of lookups in a symbol pass compared a 3.3MB string: 1,174 ms for
  one page, and the workspace runs two such passes per edit. A one-entry cache
  checked by reference makes it 23 ms. This was half the server's total time
  and shows up as `startsOf` at 7.1 s of 14.2 s in a CPU profile.
- **A no-op write counted as a change.** `SceneGraph.updateNode` emitted
  `node:updated` even when every value written was identical, and the layout
  engine rewrites x/y/width/height on every node it visits. Hiding one cell
  emitted 5,689 events while exactly two of 11,499 nodes actually changed —
  and each event marked a renderer chunk dirty, so 12 of 21 pictures
  re-recorded. Patched to drop unchanged keys.
- **Layout climbed to the page every time.** `layOutAround` now skips a hidden
  node's own subtree and stops climbing when a frame's box stops changing.
- **An `<Instance>`'s own attributes took the slow path.** They are values like
  any other; only `<Variant>` needs the conservative re-lowering, because its
  attributes are its coordinates. The per-edit offset-invariant walk also left
  the hot path — the tests assert it instead.

Two more followed, and took the click under 100 ms:

- **The click pays for the tree, not the file.** Predicting with a full
  re-lowering cost 62 ms of splicing and offset-shifting per click. The canvas,
  the rail and the inspector read values, not spans, so the click predicts the
  tree alone (`predictDocument`, structurally shared) and the document with
  correct offsets arrives with the server's answer, after the paint.
- **Chunks split recursively.** A chunk child that is itself large splits
  again, so an edit re-records the cell it touched rather than the row: 676
  cached pictures on atlas, exactly one re-recorded per toggle.

Warm measurement, states-grid instance toggle on atlas: one 66–92 ms task per
click (24–30 ms of it synchronous), server confirmation at ~130 ms, no second
task. It was over a second when this round started.

Left: startup still parses all 33 pages (3.4 s) and holds them — pages on
demand remains the next architectural step — and the canvas diff still walks
both trees (13 ms) rather than skipping shared subtrees by identity.

## Spikes / unknowns

Not user-facing, but they gate work above.

- **S1. Headless rendering for CI.** `useCanvasKitLoader` awaits a
  `requestAnimationFrame` before creating its surface, and a backgrounded tab
  never fires one. Any screenshot or visual-regression test needs a foregrounded
  browser. Blocks automated visual testing. — S
- **S2. Text measurement fidelity.** Layout currently sizes text via the SDK's
  estimator. `@open-pencil/core/layout` exports `setTextMeasurer`; check whether
  a real measurer is needed for the file's geometry to match Figma's. — S
- **S3. Reparent event pairing.** ✅ **moot — struck, not answered.** The
  question assumed D3 would drive the scene graph and have to coalesce a
  `reparented` / `reordered` pair. D3 shipped document-native instead: the tree
  reads `doc.tree` and emits `move-node` directly on drop, so there is no
  scene-graph event pair to design a coalescing for. — S
- **S4. `.fig` round-trip fidelity.** ✅ **done — the assumption holds.**
  `fig-roundtrip.test.ts` exports a real `SceneGraph` to `.fig` and parses it
  back. Four things survive: a frame tree with its geometry, **variable
  collections and their variables** (so G5 has somewhere to land), a `COMPONENT`
  that comes back a `COMPONENT` rather than a flattened frame (so F3's
  definition/instance distinction is real, not something export has to
  reconstruct), and **`/` inside a name** — which is what ADR 0004 §3's grouping
  convention rests on.

  Two corrections fell out. `@open-pencil/fig` does **not** do this: calling
  `assertFigPackageReady()` throws *"currently exposes archive/container APIs;
  use @open-pencil/core for SceneGraph .fig read/write"*. The real API is
  `exportFigFile` / `parseFigFile` from `@open-pencil/core/io/formats/fig`, and
  F2 said the wrong package. It is also **headless** — CanvasKit and the renderer
  are optional arguments that only add a thumbnail — so unlike S1 this runs in
  CI today.

- **S5. `.fig` component-set fidelity.** ✅ **done — half holds, half does
  not.** `fig-roundtrip.test.ts` builds a `COMPONENT_SET` holding two variant
  `COMPONENT`s (definitions and `variantPropSpecs` verified present before
  the trip, so a loss means dropped rather than never set) and round-trips
  it. What survives: the set comes back a `COMPONENT_SET`, and each variant a
  `COMPONENT` still named `state=default` / `state=hover` — the spelling
  ADR 0005 derives variant addresses from, and Figma's own convention. What
  does not: `componentPropertyDefinitions` and `variantPropSpecs` come back
  empty, `mapToFigmaType('COMPONENT_SET')` is `'FRAME'`, and neither
  `STATE_GROUP` nor `isStateGroup` occurs anywhere in the SDK. So variant
  *identity* survives in exactly the place the model leans on it — the names
  — while the *declarations* ride nothing yet. F2 owns testing what the Figma
  app reconstructs from names alone, and the upstream patch if the answer is
  "not enough". The SDK's editor API is otherwise complete:
  `createComponentSetFromComponents`, `findVariantByValues`,
  `getDefaultVariantForComponentSet`, `switchInstanceVariant`, and
  `parseVariantName` / `buildVariantName` as the one naming law. — S

---

## Suggested order

```
A1 ▶ B1 ▶ B2 ▶ B3 ▶ B4 ▶ B5 ▶ B6 ▶ A2 ▶ E1        ✅ shipped — one-way preview
                    │
                    ▼
G1 ▶ G2 ▶ A3 ▶ G3 ▶ G4 ▶ G5 ▶ G6 ▶ G7             document model      [Phase 2b]
                    │
                    ▼
D4 ▶ C1 ▶ C2 ▶ C3 ▶ C4 ▶ C5                       property write-back [Phase 3]
                    │
                    ▼
D3 ▶ D5 ▶ D6 ▶ D1 ▶ D2 ▶ D7 ▶ D8 ▶ D11 ▶ D12      structural         [Phase 3b]
                    │
                    ▼
F3 ▶ F10 ▶ F6 ▶ F7 ▶ F8 ▶ F9 ▶ F5 ▶ F1 ▶ F2 ▶ F4  composition, export [Phase 5]
                    │
                    ▼
A4, E2, E3                                        polish              [Phase 4]
```

**D11 and D12 are new**, added 2026-08-22 when the direction became "author
vector content here, do not only import it". They sit after D8 because the pen
needs somewhere to put a path and D8 built the `<Vector>` handling; D12 after
D11 because there is nothing to edit until something can draw. Neither is part
of Phase 3b's exit criterion, which is already met. **D3, D5 and D6 shipped
first**, out of order, pulled forward by the
2026-08-19 Figma chrome work; the row above is redrawn to say so rather than
still promising D1 first. **D1 and D2 have since shipped too**, so what is left
of the row is D7 and D8. **C10b sits between D6 and D1** — it is an Epic C
story, but it emits a structural `move-node`, so it reuses D3's rulebook
(`moveFor`) rather than adding one; nothing in D1 or D2 waits on it. D8's image half is gated on an ADR, not on D1.
**F5, F6 and F7 all sit behind F3**, because a slot and a component property
are both features of instances. **F6 before F7**: there is no property list to
show until something declares one, and a panel built against a guessed grammar
gets built twice. That ordering paid: F7's scene half was one `new Map([...])`,
because F6 had already narrowed the alias resolver per expansion.

**F8 sat behind nothing new** — a page of variants renders with no instance in
sight, and its ADR (0005) was already written — and was drawn after F7 only
because F9 wanted the `props` surface F7 builds. That paid twice over: **F9's
first half shipped inside F8**, because "an instance picks a variant" turned out
to be one control in a panel F7 had already built. What is left of **F9** is the
authoring side, the editor managing the set. **F10 sits beside F3, not behind it** — a component can be hand-written today,
so instances do not wait on a gesture that makes one. It is drawn after F3 only
because an author who cannot yet place an instance has little reason to make a
component. **F2 after F8**, so the export
carries variants the first time a designer opens it, and because S5 left F2 a
verification task only variants can exercise.

Five notes on ordering.

**G before C.** Epic G changes the address space every patch is written against.
Building the write path first means writing it twice.

**A3 sits inside G, right after G2.** The migration is what makes the new
addressing landable on files that already exist, so it ships with the change
rather than after it.

**D4 before C1**, not just before D1. D4 now owns the rule that a page child's
`x`/`y` is authored while an auto-layout child's is not — a property-write-back
concern, not only a structural one.

**G7 before C5.** A properties panel that can only reach the outermost frame is
not worth building.

**G4 before F3.** Cycle detection has to exist before the first `<Instance>` can
create a cycle.

Still true from before: **A2 before C5**, since the panel is generated from the
prop table.

## Definition of done

A story is done when it has tests at the right level (unit for format/schema,
integration for server, manual-verified for viewer), it does not regress the
suite, and — for anything touching the write path — the diff it produces has been
looked at by a human and reads as the operation it claims to be.

That last clause is what [needs-review.md](needs-review.md) is for. A story is
*finished* when the gate is green and its entry is written; it is *signed off*
when the entry moves to Reviewed. The two are deliberately separate, so the next
story can start without waiting for someone to be at a keyboard — but nothing
reaches Reviewed on my say-so, and an entry that comes back with a finding is
picked up ahead of new work.
