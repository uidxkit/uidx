# Session handoff — 2026-08-22

> **For agentic workers:** this session finished **C10b's follow-up, D1, D2,
> D7, D8 (both halves), D11 and D12**, and got **[ADR 0006](../../decisions/0006-images-and-vector-artwork.md)
> accepted**. Everything is committed and pushed. **D12 closed Epic D**, and
> **F3's composition half** started Phase 5: `<Instance>` places a component by
> its global name, overrides are read and rendered, and the reference graph and
> the layers rail both know about instances. **Authoring an override from the
> canvas is not built** — it is written up as **F3b**, and it wants a decision
> before code. **F10** shipped alongside it: a drawn node becomes a
> `<Component>` from the toolbar, and **F11** places instances of it — so ADR
> 0006 §7's workflow now runs end to end without touching the file. **F6 and
> F7 then closed the loop on composition**: a component declares its properties
> by name, an instance fills them in, and the write lands on the *consuming*
> page rather than on the component's file — which is the whole reason declared
> properties were chosen over reaching inside. `overrides` stays as the
> hand-written escape hatch, on the user's call. **F8 then gave a component its
> states** ([ADR 0005](../../decisions/0005-variants.md)): declared axes, one
> full tree per combination, a derived address segment instead of Figma's
> `State=Hover` microformat, and a generated side-by-side arrangement. An
> instance picks one through F7's own `props` panel. **F9 then gave the editor
> the set itself**, and closed F7's cross-page rename debt on the way: the shell
> now tracks a revision per page and sends one envelope per file.

**Written so a fresh session can continue without re-deriving what this one
measured.** The gate is green at the time of writing: format, lint, typecheck,
build, `uidx check` on the repo examples, and **1384 tests** (format 178,
server 91, schema 218, viewer 815, cli 82).

## Read in this order

1. This document.
2. [backlog.md](../../backlog.md) — "Picking this up cold" and the table under it.
3. [needs-review.md](../../needs-review.md) — **sixteen entries are ⬜ waiting on
   the user**, oldest first. Work does not wait on that queue, but a defect found in
   something already called done outranks whatever is next.
4. [The C10 status doc](2026-08-21-canvas-manipulation-c10.md) before touching
   any gesture or overlay maths — it carries the coordinate facts measured out
   of the SDK.
5. [ADR 0006](../../decisions/0006-images-and-vector-artwork.md) before touching
   images or vectors. It is accepted, so it is a description of the code rather
   than a proposal.

## What shipped this session

| Story | What | Verified |
|---|---|---|
| **C10b follow-up** | a canvas drop keeps the node where the pointer left it | live |
| **D1** | the creation toolbar — draw a Frame, Text, Rectangle, Ellipse, Vector | live |
| **D2** | delete on selection | live |
| **D7** | dragging a flowed child reorders it, with a caret | live |
| **D8** vector half | drop an SVG, get `<Vector>` nodes | live |
| **D8** image half | raster images as asset references | live |
| **D11** | the pen tool, and `vectorPaths` becoming two-way | live |
| **D12** | a path's points can be dragged, its handles pulled, a point deleted | live |
| **F3** (part) | `<Instance>` composes; overrides render; authoring one does not | live |
| **F10** | a drawn node becomes a `<Component>` from the toolbar | live |
| **F11** | a picker places an `<Instance>` where you click | live |
| **F6** | a component declares properties; a panel manages them | live |
| **F7** | an instance fills them in, on the page the author has open | live |
| **F8** | variants — declared axes, one full tree per state, laid out side by side | live |
| **F9** | the editor manages the set — add/remove a state, grow an axis, rename a value | live |
| **ADR 0006** | accepted — a path in the file, not the content hash | — |

Two stories were *added* rather than closed: **D11** and **D12** came out of
the direction changing mid-session (vector content should be **authored** here,
not only imported), and **F10** came out of ADR 0006 §7 (reuse of artwork is a
component, so it needs nothing new).

Where each piece lives:

| Module | Owns |
|---|---|
| `packages/viewer/src/drop-target.ts` | what a drop reparents into (C10b), and where a draw lands (D1) |
| `packages/viewer/src/flow-reorder.ts` | D7: which slot a flowed drag is over, and the caret |
| `packages/viewer/src/tool-keys.ts` | D1/D2: the toolbar's keyboard, three-valued so it can decline a key |
| `packages/viewer/src/EditToolbar.vue` | the toolbar itself |
| `packages/schema/src/create.ts` | what a new node is born with |
| `packages/viewer/src/svg-import.ts` | D8: SVG → `<Vector>`, reporting what it cannot carry |
| `packages/viewer/src/pen-model.ts` | D11: pen vertices, the path they spell, and their bounds |
| `packages/viewer/src/vertex-edit.ts` | D12: an existing path as chains of those same vertices |
| `packages/schema/src/to-scene.ts` | F3: `expandInstance` grows an instance's children |
| `packages/server/src/symbols.ts` | F3: instance edges in the reference graph G5 built; F6/F7: property bindings and instance values (UIDX404–406) |
| `packages/format/src/component-props.ts` | F6/F7: what a component declares (`componentProps`) and what an instance assigns (`instanceProps`) |
| `packages/viewer/src/component-prop-edits.ts` | F6: declare, rename, retype, remove — a rename is one envelope, a removal bakes the default in |
| `packages/viewer/src/instance-prop-edits.ts` | F7: the rows an instance shows, assigning one, and resetting one by *removing* the key; F8: an axis is a row with a stated domain, so it draws as a picker |
| `packages/format/src/variants.ts` | F8: the axes a component declares, the coordinates a variant assigns, and the name derived from them |
| `packages/schema/src/variant-layout.ts` | F8: where the variants go — generated, never authored, and shared with F2's export |
| `packages/viewer/src/variant-edits.ts` | F9: add/remove a state, grow or narrow an axis, and the widen-move-narrow a value rename needs |
| `packages/format/src/assets.ts` | D8: which references a document makes, and whether a path is well-formed |
| `packages/server/src/assets.ts` | D8: the bytes, on the viewer's own origin |
| `packages/viewer/src/asset-store.ts` | D8: fetch, hash, and fill the graph's `images` map |

## Facts this session measured

Each of these cost time to establish. None is guessable from the source.

**`vectorPaths` round-trips to a fixed point after one pass.** Measured across
lines, cubics, quadratics, smooth curves, arcs and multi-subpath data. The only
loss is arc → cubic, and it happens *inbound* — once a path has been through the
SDK once, writing it back out is stable. This overturned the prop table's
one-way note and is what unblocked authoring vectors visually
([ADR 0006 §8](../../decisions/0006-images-and-vector-artwork.md)).

**An image fill is raster only, and that is a measurement.** `applyImageFill`
decodes through CanvasKit's `MakeImageFromEncoded`, which returns null for SVG.
So an SVG is not a fill; it becomes `<Vector>` nodes.

**Images are fills, not strokes.** Figma allows an image stroke; this scene
graph does not — `Stroke` carries a flat colour and no image field, and
`composeStrokes` documents it. Scanning `strokes` would validate the path of
something that can never draw.

**`hitTestFrame` must be scoped to the page**, not to `graph.rootId`. The SDK's
root is a zero-sized document `FRAME` above the `CANVAS`; scoping there finds
nothing at all, so every drop resolved to null. Caught by a roundtrip test, not
by the unit tests.

**Vite's SPA fallback swallows late middleware.** `vite.middlewares.use` called
after `createViteServer` sits *behind* Vite's own fallback, which answers every
unmatched path with `index.html` — a PNG came back as `text/html` 200. The asset
route is a plugin now, whose `configureServer` runs before the internal
middlewares. Also: mount it without a trailing slash, or connect never matches a
child path.

**`uidx check` resolves the manifest per page**, not from `cwd`. It used to do
the latter, so every image in a document checked from another directory reported
as missing.

**`-0 !== 0` under `Object.is`**, which leaked into pen tangents and made an
equality check fail on a mirrored handle. `mirror()` in `pen-model.ts` exists
for that one reason.

**Wrap in a flow is detected by the main axis going backwards**, not by
cross-axis grouping — `counterAxisAlignItems` breaks the latter.

**A `<Component>` cannot be created empty, which decides F10's patch shape.**
`applyPatches` re-parses between ops and a childless `<Component>` is a UIDX104
error, so "insert an empty component, then `move-node` into it" is rejected
halfway. The component has to be inserted already carrying a copy of the node,
with the original removed afterwards — which means the diff reads as an add and
a remove rather than as a block move.

**A component property is a resolver, not a new code path.** `scenePropFor`
already substitutes `{target}` before the prop table sees a value, so F6 needed
only `withProperties` in `to-scene.ts` — chained onto the document's resolver
and narrowed per subtree. The discriminator is that a token's global name always
contains `#` and a property name never does. That also means a component's
properties shadow an enclosing component's completely, which is right.

**G5's reference graph already had room for `<Instance>`.** `collectReferences`
and `findCycles` in `packages/server/src/symbols.ts` were built for token
aliases, and F3 needed only to add edges: an unresolved component name and an
unresolved token alias are one diagnostic through one code path. The one
instance-specific fact is that an instance's edge starts at *the name of the
`<Component>` it sits inside*, not at the instance's address — `A#root/me → A`
is not a loop and `A → A` is.

**`nodeEditState` is in world coordinates, and it re-renders the shape itself.**
`drawNodeEditOverlay` swaps the node's `vectorNetwork` for the overlay's for one
paint (inverting `getWorldMatrix` to get back to local), and the pipeline skips
the node's ordinary draw and its selection box while it is set. So D12's vertex
drag previews with **no scene write at all** — the only gesture here that needs
no `runPreviewUpdates`.

**A `<Vector>`'s box and its ink are independent in this system.** The renderer
draws `node.vectorNetwork` unscaled — `getVectorPaths` never reads width or
height — and `scaleVectorNetworkForResize` is only ever applied to the
*descendants* of a resized node, never to the node itself. So resizing a vector
here already moves the box and leaves the ink; D12 refitting the box would have
been the odd one out, not the other way round.

## Traps to avoid repeating

**A test that compares a thing to itself passes for free.** One of this
session's patcher tests asserted `emitDocument` against `emitDocument` and was
green against a broken patcher. When a test guards a fix, run it against the
code *without* the fix and watch it go red before believing it.

**The unit tests structurally cannot see the canvas** (spike S1), so four of the
six real bugs this session found came from a live pass in a real browser rather
than from `vitest`. Budget for one on anything touching rendering, the server,
or a gesture.

**Several times my own expectation was wrong, not the code** — polygon
re-spelling, bounds arithmetic, an address separator, an index shifted by a new
fixture. When a new test fails, check the expectation before editing the
subject.

## Running a live pass

The recipe, so the next session does not rebuild it:

```sh
pnpm build:cli   # a fresh clone fails five packages/cli tests until this runs
node packages/cli/dist/uidx.js open <file> \
  --port 5199 --no-open --root /home/user/uidx/packages/viewer
```

Then drive it with Playwright-core against the preinstalled Chromium at
`/opt/pw-browsers/chromium-1194/chrome-linux/chrome`, launched with
`--no-sandbox --enable-unsafe-swiftshader` (there is no GPU).

The canvas maps world to client as `client = canvasRect.left + panX + world * zoom`
— read `panX`/`panY`/`zoom` out of the page rather than assuming them, because a
freshly opened document is auto-fitted.

## What is next

1. **F3b** — authoring an override. Not blocked on the *file* question (the
   `overrides` map is on the `<Instance>`, which is on the page the author has
   open — an earlier note here said otherwise and was wrong). What it needs is
   a product call on which properties an override may carry, and a deliberate
   change to what "absent from the bimap" means: today it is `return []` in
   `fromSceneChange` and the whole of D4's protection, and F3b needs it to
   sometimes mean "patch the owning instance instead".
2. **Adding or renaming a variant *axis*** — F9 found this is not buildable
   under the current patch invariant, and it wants a decision before code.
   `applyPatches` re-parses between ops so every intermediate document must be
   valid; a `<Variant>`'s coordinates live on the variant and their domain on
   the component; no op spans two nodes. So either the whole `<Component>` gets
   rewritten as `remove-node` + `insert-node` (losing its formatting and any
   comments inside) or the patch format grows a multi-node atomic op (weakening
   spec §9.5's invariant). Renaming a *value* is unaffected and shipped.
3. **An `INSTANCE_SWAP` property pointing at a component that has variants** —
   untested, and the one interaction between F6 and F8 nothing exercises.
4. **C7's dimmed fallback on an instance** — it probes a bare `INSTANCE` node in
   `defaults.ts`, so an instance's `W`/`H` read as unset even when the component
   gives it a size. Pre-existing; F7 is the story that put a panel in front of
   it, on every instance the author selects.

## One thing left hanging

The user's message about asset folder conventions was cut off mid-sentence:

> "Regarding your question I prefer path. Regarding the icon, there is a folder
> for assets or images/icons. The"

The first half was answered — the file stores a **path**, which is
[ADR 0006 §2](../../decisions/0006-images-and-vector-artwork.md). The second
half was read as endorsing conventional folders, and `assets` in `uidx.json`
defaults to `['assets/**', 'images/**', 'icons/**']` because of it. If the rest
of that sentence mattered, it is still unasked.
