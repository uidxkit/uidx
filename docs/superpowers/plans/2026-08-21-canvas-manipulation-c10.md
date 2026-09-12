# C10 — Canvas manipulation: status and remaining work

> **For agentic workers:** C10 is **done** — C10a, C7 and now **C10b** (drag to
> reparent) are all shipped and live-verified. What remains is the loose ends in
> [Open items](#open-items); the roadmap moves on to **D1 / D2**.
> Read [Coordinate facts](#coordinate-facts-established-by-measurement) before
> touching any gesture or overlay maths — three rounds of wrong fixes came
> from assuming otherwise.

**Written 2026-08-21**, mid-session, so a fresh session can continue without
re-deriving what this one measured.

## Where this stands

| Story | State | Notes |
|---|---|---|
| **C9** inspector finish | ✅ shipped | recorded in the backlog |
| **C10a** move / resize / rotate / nudge | ✅ shipped, live-verified | this document |
| **C7** unset properties | ✅ shipped; last criterion verified and fixed 2026-08-22 | see [Open items](#open-items) |
| **C10b** drag to reparent | ✅ shipped, live-verified 2026-08-22 | [what shipped](#c10b--what-shipped) |

The gate is green at the time of writing: format, lint, typecheck, build,
`uidx check` on the repo examples, and **860 tests** (782 when this document was
first written, 832 before C10b).

## C10a — what shipped

The canvas can be edited. `useCanvasControls.ts` grew a gesture state machine
beside the navigation it already had, rather than adopting the SDK's
`useCanvasInput`: the header's long-standing note said to swap it in "when the
canvas is allowed to write", but the composable also switches on draw, pen and
text editing, which have no patch path behind them. A canvas that can only do
what was implemented for it cannot quietly stop matching the file it renders.

| Module | Owns |
|---|---|
| `packages/schema/src/authorship.ts` | D4's geometry predicates, asked from both sides |
| `packages/schema/src/defaults.ts` | what the engine falls back to (C7) |
| `packages/viewer/src/gesture-model.ts` | gesture arithmetic: grips, rects, modifiers, nudge, cursors |
| `packages/viewer/src/resize-writes.ts` | what a settled resize commits, including the sizing flip |
| `packages/viewer/src/useCanvasControls.ts` | the state machine and the SDK commit calls |
| `packages/viewer/src/drop-target.ts` | C10b: what a drop reparents into, and the chain under the pointer |
| `patches/@open-pencil__core.patch` | the size pill's position and rotation |

Four properties worth preserving:

- **No new patch plumbing.** A canvas drag becomes patches exactly as a panel
  scrub does — `node:updated` → `fromSceneChange` → `patch-burst` — so D4's
  filter, the burst batching and C3's revision guard all apply without knowing
  the canvas exists.
- **A gesture the file cannot record is one the canvas does not offer.**
  Moving a node its parent places is refused, asking `authorship.ts` the same
  question `fromSceneChange` asks afterwards. Two copies of that judgement
  would drift into a canvas that offers a gesture the filter then discards.
- **Previews run layout.** Through `editor.updateNode` inside
  `runPreviewUpdates`, the idiom the panel already used — the editor runs
  layout for the node it touched, the wrapper downgrades the event so nothing
  is written. Without it a dragged node follows the pointer while its parent's
  flow stands still, and everything snaps into place on release.
- **The cursor is the only affordance.** The renderer draws the grips and
  never draws the rotate zone, so the pointer has to say what a press would
  do — including saying nothing over a node whose parent places it.

## Coordinate facts, established by measurement

Established by drawing DOM dots at each candidate model's predicted grip
positions over the live canvas and screenshotting them against the rendered
truth. `getWorldHandles`' dots sat exactly on the drawn grips; a centre-pivot
model's floated off in the empty zone every press had been probing.

- A node's world transform is **`translate(origin) · rotate(node.rotation)`** —
  the pivot is the node's **top-left origin**, not its centre. Positive
  rotation is **clockwise** in y-down screen space.
- `getAbsolutePosition(node, graph)` returns the **world-mapped origin** of
  that transform (it equals `getWorldHandles(...).nw` exactly). Never treat it
  as the corner of an axis-aligned rect for a rotated node.
- **`getAbsoluteRotation` is sign-inverted** relative to `node.rotation` — it
  reported `292.933` for a node whose rotation is `67.067`. It takes no part
  in gesture maths; use `node.rotation`, since v1 documents cannot author
  rotated ancestors.
- `getWorldHandles(node, graph)` is the renderer's own answer for grip
  positions, in the same canvas units `screenToCanvas` produces. Hit-test
  against it rather than re-deriving.
- An **edge** grip resizes along the node's own axis, so only that component
  of a drag registers — correct, and what Figma does. The cursor must
  therefore point along that axis (`resizeCursor`), or the gesture reads as
  broken-slow: on a node turned 81.7°, a horizontal drag on the "east" grip
  registers at cos(81.7°) ≈ 14%.

## Verification pitfalls that cost this session hours

Both produced confident, wrong conclusions — one of them a revert of a
*correct* fix.

1. **Stale modules after a Vite 500.** A syntax error makes HMR fail with a
   500; the page then keeps running the last good modules even after the file
   is fixed, and every probe measures dead code. **Check the browser console
   for `[vite] Failed to reload` before trusting any live result**, and
   restart the dev server — not just reload — after a transform error.
2. **Screenshot → client coordinates.** Browser-pane screenshots cover the
   whole viewport: `client = shot × (viewportWidth / shotWidth)`. Do **not**
   add `canvas.getBoundingClientRect().left` on top; that double-offset
   shifted every synthetic pointer ~133px.
3. **Synthetic keyboard edits are unreliable here.** Driving
   `NumberFieldRoot` by setting `input.value` and dispatching `input`/`blur`
   produced commits sometimes and silence other times. Prefer a real
   `computer` drag on a `.scrub`, or a unit test, over synthetic typing.

## Open items

Ordered by how much they would bite a user.

- [x] **C7's hug-flip criterion is verified, and the defect it found is fixed.**
      Done 2026-08-22 with the probe this item asked for. Typing `240` into the width of a
      frame that hugs writes `width={240}` and leaves
      `primaryAxisSizingMode="AUTO"`, so the file states a size and a mode that
      contradict each other.

      **Why the panel path is not enough.** The first preview asks a node that
      still reads `HUG`, computes `{ primaryAxisSizing: 'FIXED' }`, and applies
      it to the graph — where `runPreviewUpdates` downgrades the event, so it
      never reaches the file but *does* change the node. Every keystroke after
      that, and the commit, ask a node that now reads `FIXED` and get `{}`. The
      commit writes the width alone. The flip is spent on a write that cannot
      persist by design.

      **The fix**, shipped: the flip is decided from the document rather than
      the scene — `authoredSizing` in `resize-writes.ts`, read through
      `resolve(current.tree, address)` in `applyProp`, the same source the
      positioning toggle two lines below already used. That matches E4's
      file-as-source-of-truth policy. `panel-typed-size.test.ts` drives
      preview-then-commit, the only sequence that catches it. Verified in the
      browser on all three paths: primary axis, counter axis, and a text that
      measures itself.

      **Worth carrying to C10b and D7:** a preview may move the scene, so the
      scene cannot be asked a question whose answer the commit depends on.

      *Note for driving the panel from a test harness:* the typing gesture needs
      a **double-click** on the number first. `SizeField.vue` renders its `<input>` only under
      `v-if="state.editing"`, entered by `@dblclick="actions.startEdit()"` — which
      is very likely why synthetic typing "stopped producing commits" before.
- [ ] **Clear a set property back to unset**, emitting `remove` — the last
      criterion of [properties-panel.md](../../properties-panel.md)'s C7
      section. Now that every property is one click from being written, there
      is no way back except editing the file.
- [x] **C10b — drag to reparent.** Shipped 2026-08-22;
      [what shipped](#c10b--what-shipped).
- [x] **A canvas drop keeps the node where it was dropped.** Done 2026-08-22,
      the day C10b shipped without it. The envelope is the move then `set`/`add`
      of `x` and `y` in the new parent's frame, gated on `isPositionAuthored`
      asked of the home the node is about to have. `rebasePatches` had to learn
      to read an envelope in order first — see above.

      **Still true, and out of scope:** dropping into an auto-layout frame
      leaves whatever `x`/`y` the file already had sitting there unread. The
      layout ignores them and D4 refuses to write them, so they are inert, but
      they are stale. The rail leaves them too. Clearing them would be a
      `remove` in the same envelope, and belongs with D7 (reorder a flowed
      child) rather than here.
- [ ] **A node dragged out of a clipping frame vanishes mid-drag.** Only its
      selection chrome follows the pointer, because the node is still parented
      to the frame that clips it until the drop lands. Figma unclips the dragged
      node. Cosmetic, and only for `clipsContent` parents.
- [ ] **A minimum size for resize.** Dragging a grip far enough collapses a
      node to `0`, and for a text that means it disappears. Figma clamps.
- [ ] **`@open-pencil/core` is patched.** `patches/@open-pencil__core.patch`
      corrects `drawSingleSelectionSize`, whose pill position mirrored the
      offset (`+sin` where rotating `(0, hh)` gives `−sin`) and drew upright
      while the same file's frame title rotates. **Re-derive or re-apply on
      any SDK upgrade**, and consider reporting it upstream.
- [ ] **Known flakes, not ours:** `Workspace > picks up a save through the
      watcher` in `@uidx/server` times out roughly one run in ten. It predates
      this work. A second one in the same package and the same family —
      `FileSession > recovers automatically on the next valid save` — failed two
      of four full-suite runs on 2026-08-22 and passed every time the package was
      run alone, so it is load-sensitive rather than one-in-ten. Both are watcher
      timing; neither has a story yet.

## C10b — what shipped

**Dropping a node inside another frame reparents it**, the way the layers rail
already does on drop — and by the same rules, because it is a second caller of
them rather than a second copy.

| Module | Owns |
|---|---|
| `packages/viewer/src/drop-target.ts` | `containerChainAt` (the scene half) and `dropTargetFor` / `reparentTo` (the document half) |
| `packages/viewer/src/useCanvasControls.ts` | the move gesture's drop branch and the highlight |
| `packages/viewer/src/CanvasPane.vue` | the translation between scene ids and addresses, and the emit |

Five properties worth preserving:

- **One rulebook.** `dropTargetFor` asks `moveFor` — the rail's own decision
  function — what the document allows. A drop the rail refuses is a drop the
  canvas refuses, with the same arithmetic and the same reason.
- **Three refusals, and the difference between the last two is the point.** The
  dragged node and its descendants are stepped past (a drag carries its own
  subtree under the pointer). The node's own parent ends the walk with "no
  reparent" — that was a move, and walking outward to a grandparent would turn
  a nudge into a promotion nobody asked for. A container that *refuses this
  particular move* — a duplicate sibling name, a `<Component>` that already has
  its one child — also ends the walk, because the author aimed at that frame
  and it said no. A node that could never take a child is not a refusal and the
  walk steps past it. That is the same split `LayersPane` makes between
  `canContainChildren` and a null `moveFor`.
- **The drop keeps the node where the pointer left it.** `x`/`y` are relative
  to the parent, so a bare reparent silently re-reads them against a different
  origin and the node jumps by the distance between the two frames. The
  envelope is therefore the move *then* the position writes, in that order,
  addressed to the node's **new** address — `applyPatches` re-parses between
  ops, so the address exists by the time they run, and the server applies the
  batch in memory and writes once, so a drop cannot reparent without
  repositioning. Into an auto-layout frame there is nothing to write:
  `isPositionAuthored` is asked of the home the node is *about* to have, and a
  flowed child's position is the layout's answer, not the author's.
- **The scene graph is not touched.** The patch goes to the file and the echo
  reparents the node through `applyChanges`, so the canvas cannot show a tree
  the file does not have. `commitMoveWithReparent` is deliberately *not*
  called: it only records an undo entry, and one whose forward pass reparents
  in a graph that was never reparented is worse than none. A canvas reparent
  therefore has no scene undo entry — exactly where a rail reparent stands.
- **The highlight is the renderer's own.** `editor.setDropTarget(id)` sets
  `state.dropTargetId`, which `canvas/scene.js` already strokes. Nothing new
  is drawn.

### Two facts this story added

**`rebasePatches` reads an envelope in order.** E4 validated each patch against
the incoming document independently, which refuses every drop: the position
writes name an address the envelope's own `move-node` creates, and it does not
exist in the document yet. It now carries the moves it has seen and reads a
later address back through them (`remapAddress`, run backwards) before
resolving it. Any future gesture that emits a structural op followed by writes
to what it created depends on this.

### One coordinate fact this story added

**`hitTestFrame` must be scoped to the page, not to `graph.rootId`.** The SDK's
own root is a zero-sized document `FRAME` above the `CANVAS`; scoping there
bounds-checks the canvas against 0×0 and finds nothing at all, so every drop
resolved to null. `SceneResult.rootId` is the page (ADR 0003) and is the scope
to pass. The unit tests could not catch this — they hand `dropTargetFor` a
chain directly — and `reparent-roundtrip.test.ts` exists because it did.

### Verified live, on a scratch page

A page with two frames side by side and a rectangle in the left one, driven
through a real browser at `--port 5199`:

| | |
|---|---|
| drag within the node's own frame | position write, no reparent (x 30→120) |
| drag into the other frame | `move-node` + `set x`/`set y`; the node stays exactly under the pointer (predicted 80, 90 — written 80, 90) |
| drag into an auto-layout frame | `move-node` alone, no position written; the child flows and the inspector dims X/Y |
| drop on empty canvas | promoted to a page child |
| a page child dragged across the background | stays a page child, position written |
| that page child dragged into a frame | reparents, selection follows to the new address |
| mid-drag | the target frame is outlined; the outline clears on release |

No `[vite] Failed to reload`, no page errors. The one 404 is `/favicon.ico`,
which predates this work.

## C10b — the original plan

## C10b — drag to reparent

**Goal:** dropping a node inside another frame reparents it, as the layers
rail already does on drop.

**Why it was split from C10a:** it emits a structural `move-node` rather than
a prop write, and needs drop-target affordances on the canvas. The rules it
needs already exist — `layer-moves.ts` decides them for the rail — so the
work is a second caller, not a second rulebook.

### Task 1: the drop target is decided in a pure module

- [ ] **Step 1: failing tests** — extend `packages/viewer/test/layer-moves.test.ts`
      (or a new `drop-target.test.ts`) for a `dropTargetFor(point, graph)`:
      the innermost container under the pointer that is not the dragged node
      or a descendant of it; null when that would be a no-op (same parent,
      same index).
- [ ] **Step 2: RED. Step 3:** implement, reusing `layer-moves.ts`'s existing
      legality rules rather than restating them. `isWithin` from
      `@uidx/format` is the one home for address algebra — do not write a
      second copy.
- [ ] **Step 4: GREEN + commit.**

### Task 2: the gesture, and the affordance

- [ ] **Step 1: failing controller tests** in `canvas-edit.test.ts` — a move
      whose pointer ends over another frame emits a reparent rather than an
      `x`/`y` write; a move that ends over the same parent still emits the
      position write.
- [ ] **Step 2: RED. Step 3:** extend the `move` gesture in
      `useCanvasControls.ts`. The SDK offers `commitMoveWithReparent` and
      `setDropTarget` / `setLayoutInsertIndicator` for the highlight — the
      same overlay family C10a's hover work already drives.
- [ ] **Step 4:** the drop emits `move-node` through the patch path; check the
      diff is one structural change, not a structural change plus geometry.
- [ ] **Step 5: GREEN + full suite + live pass + commit.**

### Task 3: gate and record

- [ ] Full monorepo gate: `pnpm format:check && pnpm lint && pnpm typecheck &&
      pnpm build && pnpm test && pnpm build:cli && pnpm check:examples`.
- [ ] Live pass on a scratch copy — never a repo example.
- [ ] Update `docs/backlog.md`: C10 fully done, test counts refreshed from the
      actual `pnpm test` totals, roadmap pointer moved to D1 / D2.
