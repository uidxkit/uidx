# Needs review

A queue, not a log. Every story I finish lands here with what it was for and
what to check; you clear entries as you get to them and I keep working past
them. Nothing here blocks the next story — the point of the file is that it
does not have to.

**How to use it.** Work down the open entries. For each one: read *the goal*,
then walk *what to validate*. If it holds, say so and I move the entry to
[Reviewed](#reviewed) with the date. If it does not, tell me what you saw and
the entry stays open with your finding written into it, ahead of whatever I am
doing at the time — a defect in something already called done outranks new work.

**Status key.** ⬜ waiting on you · 🔁 you found something, I am on it ·
✅ you signed it off (moved down).

**Before any live check.** A fresh clone fails five `packages/cli` tests until
`pnpm build:cli` runs, and the viewer needs a document, not a bare file:

```
pnpm install && pnpm build:cli
printf '{ "id": "scratch", "files": ["**/*.uidx"] }' > /tmp/scratch/uidx.json
node packages/cli/dist/uidx.js open /tmp/scratch/<page>.uidx --port 5199
```

Always on a scratch copy, never on a repo example — a live pass writes to the
file it opens.

---

## Open

### ⬜ H3 — pins under the hand: CSS rows, converting gestures, travelling pins

*Shipped 2026-08-30 · Phase 5 · [ADR 0011 §6](decisions/0011-pins-a-child-states-its-offset.md) ·
commits `392d552`, `e9c34b6`*

**The goal.** Three live findings from one review pass, one root: everything
around a pin still spoke the coordinate language to a file that speaks
offsets. The panel showed X beside Right (two numbers, one position); a drag
half-landed and snapped back; a drop past the parent's edge was refused whole
(UIDX135, the pin travelled to a page that has no edges).

**What changed.**

1. **The Position section speaks CSS.** Exactly the edges the pin holds:
   Left, Right, Top, Bottom, Center. The near edges are labelled Left/Top
   *everywhere* — page level and flowed children included, per review: one
   language, no X/Y anywhere. File spellings unchanged. The pin widget hides
   where a pin is illegal.
2. **A settled gesture converts.** Drag and resize commit their box as ever;
   `fromSceneChange` now turns a pinned axis's geometry into offsets
   (`pinWrites`, moved to the schema). No vouch needed: a reflow round-trips
   to the stored numbers and emits nothing — tested, not assumed.
3. **A pin belongs to the frame you are in.** A drop onto the page or into a
   flow strips it (ordered so every intermediate state parses); a drop into
   another box keeps it, re-measured from the new parent's edges.

**What to validate**, on a scratch copy of `examples/pinned-card.uidx`:

1. Select `close`: a **Right** row, **T** for the vertical near edge, no X
   anywhere. Select `title`: **L/T** boxes, no Right.
2. **Drag `close`.** It stays where you drop it; the file's `right` changed
   and no `x` appeared. This was the snap-back.
3. **Resize `rule`** by its east grip: `right` changes, never `width`.
4. **Drag `close` out onto the page.** No error; it lands where dropped, and
   its `constraints`/`right` are gone from the file. Drag it back into
   `body`: pin does not return (Figma-alike; say if you want re-pinning).
5. **Widget**: plain click = one constraint, shift-click = add (stretch).

**Known not built**: `.fig` parity (H4), `SCALE` (H5). Mid-drag preview still
resolves against the old parent size during a *parent* resize (the
`layOutEntity` seam, noted in H1's entry).

### 🔁 H2 — pins in the inspector

*Shipped 2026-08-29 · Phase 5 · [ADR 0011](decisions/0011-pins-a-child-states-its-offset.md) ·
[design spec](superpowers/specs/2026-08-29-pins-and-constraints-design.md) ·
[plan](superpowers/plans/2026-08-29-pins-h2.md)*

**The goal.** H1 made pins work in the file; you still had to type the offset by
hand. Now the panel holds it: the offset is a row you can scrub, X and Y read
where the node actually sits rather than the coordinate the file does not
state, and Figma's edge widget replaces C8's two selects.

**A defect you found, since fixed (`HEAD`).** Clicking an edge on a node with
an authored `width` or `height` was refused outright — *"height is computed
under a STRETCH pin"*. The envelope was right as a whole and wrong op by op:
the server re-parses between ops, so every intermediate state has to be a
legal document, and no naive order survives that. Writing the constraint first
leaves the old answer beside it; writing the new offset first states one the
*old* constraint forbids. It now emits removals, then the constraint, then the
offsets — and the regression test runs the real `applyPatches` over the real
source, because what matters is that the file the server would write is one it
can still read.

**A UX defect you found, since fixed (`b450b71`).** The edges were pure
toggles, so clicking the bottom edge while the top was lit produced a stretch
— silently changing an element's size when the author meant to move it. Now a
plain click is one constraint and Shift adds a second, which is what Figma
documents.

**A third defect you found, since fixed (`819883a`).** Moving the horizontal
pin from left to right also rewrote `bottom`. The conversion ran on both axes
every time, so a click on one rewrote a line nobody touched — and re-derived
it from a measured box, which meant the staleness below could corrupt an axis
the gesture had nothing to do with. It now converts only the axis that
changed.

**The stale measurement, also fixed in `819883a`.** Scrub `right` on
`close` from 16 to 40 and the panel's X stayed at 284 when the node had moved
to 260.

The cause was not flush ordering, which is what I first assumed. **The canvas
rebuilds asynchronously — `renderWithAssets` awaits assets — from a watcher
that is not**, so the shell's `flush: 'post'` read could run long before the
graph had anything new in it. No amount of tick-juggling fixes that; nothing
in the shell can know when the render finished. The canvas now bumps a
`graphRevision` when the graph has settled and the shell watches it.
`exportBounds` had the same latent race and is fixed with it — it never showed
because a selection change, which is what usually triggers it, comes long
after any render.

**Worth confirming live**, since the fix was reasoned from the code rather
than watched: scrub an offset and check X follows it within a beat.

**A fifth defect you found, still open — the canvas never learned the
conversion.** Drag a pinned child and the pinned axis does not move; resize a
stretched one and the width does not change. Only the panel can write a pinned
axis. Held by `packages/viewer/test/pin-gestures.test.ts`, which is red.

Measured live on `pins-demo/pinned-card.uidx`, on `close`
(`{ horizontal: 'MAX', vertical: 'MIN' }`): a drag moved Y and lost X. The panel
read X 183 → 223 during the gesture and 183 again after a reload, because it
reads the resolved scene box while the file still said `right={37}`. The same
gesture on `rule` (`STRETCH`) keeps its height and loses its width.

The cause is one seam. `settle` commits raw scene geometry —
`editor.updateNode(id, { x, y })`, `useCanvasControls.ts:1079` — and that
reaches the file only through `fromSceneChange`, which drops every geometry
prop the pin owns (`isPinnedAxis`, `from-scene.ts:145`). Nothing converts the
settled box into offsets on the way, so the write evaporates without saying so.
Vouching the gesture the way the panel vouches a typed edit is *not* the fix:
that writes a raw `x` next to a `right`, the pair UIDX134 refuses. `pinWrites`
is the conversion and already exists — it just has no caller outside
`PropertiesPane.vue`, which is what its own comment means by "shared with the
widget and with H3's gestures".

The seam the test assumes is a proposal, not a decision: the controller reports
the box a gesture settled on (`onGeometry`) and the host converts it, since
`CanvasPane` is what owns the pin and the measured parent. That keeps the
controller pin-ignorant, the way it is document-ignorant for `onReparent` and
`onReorder`. Two guard tests in the same file assert what the gesture commits
today, so a red there means the fixture broke rather than the feature.

One more thing to decide with it: a plain drag re-picks the shallow entity
(`pick(..., isDeep(event))`, `useCanvasControls.ts:517`), so dragging a child
already selected in the rail grabs its component instead and the inspector
switches with it. ⌘/ctrl moves the leaf. Figma keeps a selected child selected
under a drag, which is likely what an author expects here too.

**What to validate**, on a scratch copy of `examples/pinned-card.uidx`:

1. **Select `close`.** X reads **284** (320 − 16 − 20), not 0. A **Right** row
   shows 16. On a stretched axis the W or H row reads the resolved size for
   the same reason. There is no Center X or Bottom row — a pin offset appears only
   where the node's own constraint names it.
2. **Scrub Right to 40.** The circle moves and the file gains `right={40}` and
   nothing else. Then watch X: this is the defect above.
3. **Type an X.** The file's `right` changes instead, and no `x` appears.
4. **The widget.** A plain click pins that axis to that edge, *replacing*
   whatever it held; **shift-click** adds or removes an edge, so both edges is
   the stretch and neither is the centre. That is Figma's rule, taken from its
   help centre rather than from memory — "Hold down Shift to select or apply
   more than one constraint at a time" — after the first cut shipped as pure
   toggles and turned "pin me to the bottom" into "stretch me" on one click.
   The centre dot centres both axes. There is no SCALE.
5. **Click a lit edge off.** The axis centres, the offset is written from where
   the node actually was, and the coordinate it replaces leaves the file in the
   same envelope — so the child does not jump.

**Known not built**, so do not report these as defects: canvas gestures still
write coordinates rather than offsets (H3), `.fig` parity (H4), and `SCALE`
(H5 — UIDX136 is the answer meanwhile). A pin conflict such as `x` beside
`right` under MAX is an **error**, so `parse` returns no document and the page
will not open at all until it is fixed — consistent with every other UIDX
error, and worth knowing before you try one by hand.


### ⬜ H1 — pins: a child positioned relative to its parent

*Shipped 2026-08-29 · Phase 5 · [ADR 0011](decisions/0011-pins-a-child-states-its-offset.md) ·
[design spec](superpowers/specs/2026-08-29-pins-and-constraints-design.md) ·
[plan](superpowers/plans/2026-08-29-pins-h1.md)*

**The goal.** A child could not be positioned relative to its parent. `constraints`
had been in the vocabulary since C8 and inert ever since — the scene graph stores
the two fields and its layout pass has never read them. Now a child states the
**offset** from the edge its constraint names (`right`, `bottom`, `centerX`,
`centerY` beside `x`/`y`), and the coordinate is computed against whatever size
the parent actually has.

The decision underneath it is ADR 0011 §1, and it is the thing to keep in mind
while reviewing: Figma stores the coordinate and rewrites it at every resize.
Doing that here would rewrite every pinned child's line in the file each time a
card is resized, which is the derived geometry D4 exists to keep out. So the
offset is stated and the coordinate is derived — and **a parent resize should be
a one-line diff**.

**What to validate.** `examples/pinned-card.uidx` is new and exists for this —
copy `examples/` somewhere scratch and open it.

1. **Widen `body` from 320.** `close` stays 16 from the right edge, `rule` grows
   with the card, `caption` stays centred. Then look at the file: **the only
   changed line should be `body`'s own `width`.** If any child's line moved, the
   whole design failed and everything else here is beside the point.
2. **Select `close` and look at the inspector.** Constraints shows `MAX` / `MIN`
   and both selects work — that pair has been editable since C8 and now means
   something. **But there is no Right row, and X reads `0` while the node sits
   at 524.** Neither is a defect to report: the four offset props have no
   `prop-ui` entry yet, so the panel does not know they exist, and X falls back
   to the unset default because the file states no `x`. Making the panel show
   the offset it actually holds — and the derived X — is the first half of H2.
   Verified live on 2026-08-29 rather than assumed.
3. **Drag `close` on the canvas.** It still moves, because a pinned child is
   positioned by hand and `canMove` deliberately did not change. **But the
   gesture writes `x`, which the file will then refuse** — that is H3's work
   and is the known rough edge of this story, not a defect. Undo it.
4. **Try the refusals by hand**, each of which should name why: `x` beside
   `right` under a MAX pin and `width` under a STRETCH one (UIDX134); a pin on
   a child of an auto-layout frame without `layoutPositioning="ABSOLUTE"`, and
   a pin on a page's own child (UIDX135); `SCALE`, which should point you at
   `STRETCH` (UIDX136).
5. **Nest one.** Put a small frame inside `rule` pinned `MAX` with `right={8}`
   and widen the card: it should track the rule's *resolved* width, not the
   authored one. That is the top-down walk, and it is the case a bottom-up one
   gets wrong.

**Known not built**, so do not report these as defects: the pin-aware inspector
— no Right/Bottom/Center rows, and a misleading X — and the 9-point widget (H2), gestures that write the offset instead of the
coordinate (H3), `.fig` round-trip assertions (H4), and `SCALE` (H5, and
UIDX136 is the answer meanwhile). **Live preview during a gesture does not
re-resolve**: the viewer's in-flight path reaches layout through the SDK
editor's `runLayoutForNode` rather than through `layOutEntity`, so a pinned
child settles correctly when the file echo lands but may lag mid-drag. H3 owns
that seam.

**Two things measured rather than assumed**, both written into the code that
depends on them. An `ABSOLUTE` child does not grow a hugging parent — without
that, `STRETCH` inside a hug would be circular. And the pin pass's cost is
counted, not only timed: the obvious wrong implementation measured *faster*
than the correct one, because Yoga skips a `NONE`-mode frame, so a timing
budget alone would have passed the regression it was written to catch.


### ⬜ F5 — slots: a component declares a hole, a consuming page fills it

*Shipped 2026-08-28 · Phase 5 · [ADR 0007](decisions/0007-slots.md) ·
[design spec](superpowers/specs/2026-08-26-slots-design.md)*

**The goal.** An instance could change what was already there and could not put
anything new inside — which is why a design system grows `Card/WithChart`,
`Card/WithTable` and `Card/WithList`, identical everywhere but one region. A
`<Slot>` is that region declared: it takes part in the definition's layout,
carries default content, and the consuming page decides what goes in it.

**What to validate.** `examples/card.uidx` and `examples/dashboard.uidx` are new
and exist for this — copy `examples/` somewhere scratch and open
`dashboard.uidx`.

1. **Three cards, one component, three states.** `revenue` fills the slot,
   `pending` is `<Slot name="body" />` and draws nothing there deliberately, and
   `blank` never mentions the slot so it draws the definition's placeholder.
   None of the three restates the padding, radius or spacing.
2. **Expand `revenue` in the rail.** `figure` and `delta` are there and are
   ordinary rows — select, rename, drag, hide. `title` beside them is a
   generated clone and does none of those. This is the thing F3 named as
   missing, and it is the check that matters most: it was broken on the first
   live pass while every test passed, because `layerRows` had not learned the
   substitution `expandInstance` had.
3. **Scrub `figure`'s font size.** The patch must land in `dashboard.uidx`, not
   in `card.uidx`. That is ADR 0007 §3 working: the scene id follows the
   definition, the address follows the file.
4. **Select `body` inside `revenue`** — the inspector shows *nothing*, because a
   fill carries `name` and nothing else. Now open `card.uidx` and select its
   `body`: full layout controls. Same element, opposite sides of the instance
   boundary. Try adding `layoutMode` to the fill by hand and `uidx check` should
   say UIDX131 and name the definition.
5. **Select a frame in `card.uidx` and press New slot** (the dashed square,
   between Make component and Place instance). One `insert-node`, and the new
   slot must be **selected** afterwards — with no canvas indicator for an empty
   one, an unselected new slot is one you cannot find.
6. **Delete the `<Slot>` from `card.uidx` by hand.** Every page that fills it
   should be named, by page and address (UIDX411) — not a silent reset.
7. **Try the refusals by hand**, each of which should name *why*: a `<Slot>` on
   a page, as a component's direct child, and inside a fill (UIDX133); two
   fills for one slot (UIDX132); two slots of one name anywhere in a component
   (UIDX130).

**Known not built**, so do not report these as defects: Convert to slot (needs
`retag`, F14), the first fill by dropping onto an unfilled slot region, Reset
slot, Delete contents, and placing an instance directly into a slot.

**One spec observation worth a decision.** UIDX411's discriminator is "does any
component in the document still declare that name". Delete a slot that only one
component declared and you get UIDX410 instead — "declares no slot, did you
mean…" — which reads as a typo rather than as "your content stopped drawing".
The single-component case is the common one.


### ⬜ C10b — drag to reparent on the canvas

*Shipped 2026-08-22 · Phase 3b · commits `af7a400`, `b518249`, `236c14b` ·
status doc: [C10](superpowers/plans/2026-08-21-canvas-manipulation-c10.md#c10b--what-shipped)*

**The goal.** Finish canvas manipulation. C10a made the canvas editable — move,
resize, rotate, nudge — but a node could only ever move *within* its own parent.
C10b makes it rearrangeable: dropping a node inside another frame reparents it,
the way the layers rail already does on drop. It is the last piece of C10, and
it was the thing standing between here and D1 / D2.

**The design decision worth knowing before you look.** The canvas does not get
its own rules. `dropTargetFor` asks `moveFor` — the rail's decision function —
what the document allows, so a drop the rail refuses is a drop the canvas
refuses, for the same reason. And the drop writes one `move-node` and never
touches the scene graph: the file's echo reparents the node. That is what stops
the canvas from showing a tree the file does not have.

**What to validate.** Open a scratch page with two frames side by side and a
rectangle inside the left one, then:

1. **A plain move still writes position.** Drag the rectangle around inside its
   own frame. The file's `x`/`y` change; nothing reparents. This is the case
   that would break if the drop branch were too eager.
2. **A drop into the other frame reparents.** Drag it across. Expect: the rail
   re-nests it, the selection follows it to its new address (top bar shows
   `right#box`), and the diff is **one** structural change — the `<Rectangle>`
   moves between the two `<Frame>`s with its attributes carried across
   character-for-character. If you see an `x=` or `y=` change in that same
   diff, that is a bug; tell me.
3. **The highlight says where it will land.** While the pointer is over the
   target frame and before you release, the frame is outlined. It clears on
   release. Drag back out over empty canvas and the outline goes.
4. **A drop on empty canvas promotes to a page child.** The rectangle becomes a
   top-level `<Page>` child and its address loses the `left#` prefix. This is
   the only way back out of a frame with the pointer alone.
5. **A refusal is a refusal.** Give both frames a child named `box`, then try to
   drag one onto the other. Nothing should happen — it must not silently land
   somewhere else instead.
6. **Undo.** Ctrl/Cmd+Z after a canvas reparent does *not* undo it. That is
   known and matches the rail (see below), but confirm it does not do something
   worse than nothing.

**What I already know is wrong with it**, so you do not have to spend the
review finding it:

- **A node dragged out of a `clipsContent` frame vanishes mid-drag**, leaving
  only its selection chrome following the pointer. Figma unclips the dragged
  node. Cosmetic, and only for clipping parents.
- **Stale `x`/`y` survive a drop into an auto-layout frame.** The layout ignores
  them and D4 refuses to write them, so they are inert — but they are wrong.
  The rail leaves them too. Clearing them is a `remove` in the same envelope and
  belongs with D7.

*The jump on drop that this entry originally listed is fixed — see the entry
below, which supersedes it.*

**Where it lives.** `packages/viewer/src/drop-target.ts` (new — all the
judgement), `useCanvasControls.ts` (the gesture branch and the highlight),
`CanvasPane.vue` (scene-id ↔ address translation and the emit). Tests:
`drop-target.test.ts` (unit), `canvas-edit.test.ts` (controller),
`reparent-roundtrip.test.ts` (document → graph → hit test → patcher).

**Gate at the time of shipping.** format, lint, typecheck, build, 850 tests,
`uidx check` on the examples — all green. Live-verified in a real browser; the
one console 404 is `/favicon.ico` and predates this work.

**One thing the tests could not have caught**, worth knowing because it will
bite the next canvas story too: `hitTestFrame` has to be scoped to the *page*,
not to `graph.rootId`. The SDK's own root is a zero-sized document `FRAME`
above the `CANVAS`, so scoping there bounds-checks against 0×0 and resolves
every drop to null. The unit tests hand `dropTargetFor` a chain directly and
sailed past it; the roundtrip test is what found it, and is why it exists.

### ⬜ C10b follow-up — a drop keeps the node where you dropped it

*Shipped 2026-08-22 · follows the C10b entry above, which shipped without it ·
status doc: [C10 open items](superpowers/plans/2026-08-21-canvas-manipulation-c10.md#open-items)*

**The goal.** Close the one thing I flagged as wrong with C10b, and the one you
told me to take. A node's `x`/`y` are relative to its parent, so reparenting it
without restating them silently re-reads them against a different origin: the
node jumped by exactly the distance between the two frames. Dropping something
into a frame should leave it where you dropped it.

**How it works, in one line each.** The drop is now an ordered envelope — the
`move-node`, then `set` (or `add`) of `x` and `y` in the new parent's frame,
addressed to the node's **new** address because they apply after the move. The
numbers come from the difference between two world origins. Whether to write
them at all is `isPositionAuthored` — the same predicate D4 uses — asked of the
home the node is *about* to have, so a drop into an auto-layout frame writes
nothing, because a flowed child's position is the layout's answer.

**What to validate.**

1. **Into a plain frame, the node stays put.** Drag a rectangle from one frame
   into another and drop it somewhere specific. It should stay exactly under
   the pointer — no jump on release, and none a beat later when the file echoes
   back. The inspector's X/Y should read the new parent-relative numbers.
2. **The diff is still readable as one gesture.** Three ops, no more: the
   `<Rectangle>` moves between the two `<Frame>`s and its `x`/`y` change. Every
   other attribute must be byte-identical. If you see `width`, `height`, or a
   fill in that diff, that is a bug.
3. **`add` versus `set`.** Drop a node that has *no* `x`/`y` in the file (delete
   them by hand first) into a plain frame. It should gain them, formatted like
   its neighbours. Dropping a node that already has them should change them in
   place, not duplicate them.
4. **Into an auto-layout frame, nothing is written.** Build a frame with
   `layoutMode="VERTICAL"` and drop a node into it. It should flow into the
   stack, the diff should be the `move-node` alone, and the inspector should dim
   X/Y and show a "Layout child" section. This is the branch that would be
   wrong if the gate were missing — you would get a position the layout
   immediately overrides.
5. **The race, if you can provoke it.** With the viewer open, edit the file in
   an editor and save it at the same moment as a drop. The drop should still
   land (E4 rebases it), not roll back with a stale banner. This is the path
   that needed the rebase fix below; it is the least-covered by hand, and the
   one I would most like a second pair of eyes on.

**The non-obvious part, which is where I would look for bugs.** `rebasePatches`
(E4) validated each patch in an envelope independently against the incoming
document. The position writes name an address the envelope's *own* `move-node`
creates — it is not in that document and never will be until the envelope runs
— so every drop racing a file change was refused whole. It now carries the
moves it has seen and reads a later address back through them before resolving
it, reusing `remapAddress` run backwards. Four tests in `patch-rebase.test.ts`
cover it, including that a genuinely missing target still refuses the whole
envelope.

**Verified live.** Predicted the node would land at `x=80 y=90` and it did,
to the unit. The auto-layout drop wrote no position and the child flowed.

**Where it lives.** `drop-target.ts` (the envelope), `CanvasPane.vue`
(`placeAfterDrop` — the two scene questions), `patch-rebase.ts` (ordered
envelopes). Tests: `drop-target.test.ts`, `reparent-roundtrip.test.ts`,
`patch-rebase.test.ts`. Gate green at 860 tests, up from 850.

### ⬜ D1 — the creation toolbar

*Shipped 2026-08-22 · Phase 3b · backlog: [D1](backlog.md#d1-creation-toolbar--m)*

**The goal.** Make the canvas somewhere you *build*, not only somewhere you
rearrange. A toolbar arms one of the five §3.3 elements, you sweep a rect on the
canvas, and a node appears in the file where you drew it.

**The two decisions worth knowing before you look.**

*Where a new node's contents come from.* Not the viewer — `@uidx/schema`
(`create.ts`). The file is the artifact, so what a created node looks like in it
is a property of the format, and a toolbar, an agent and a future `uidx new`
should all produce the same lines. The rule is "what the author decided, and
what the engine will not give them": a bare Frame, Rectangle, Ellipse and Vector
all resolve `fills` to `[]`, so without one a created node draws nothing.
Everything the engine *does* answer is left unwritten, and C7 dims it.

*The sweep is a marquee.* No provisional node goes into the scene graph, so an
abandoned gesture leaves nothing to clean up. It reuses the SDK's own marquee
overlay.

**What to validate.**

1. **Each of the five tools draws.** Press F, T, R, O, P in turn (or click the
   tray) and sweep on the canvas. Each should produce a node of that element,
   visible, named `<element>-1`, selected afterwards, and appearing in the rail.
   The tool should put itself away after one use.
2. **It lands where you drew it, inside what you drew it in.** Sweep inside a
   frame: the node should be that frame's child, with `x`/`y` relative to *that
   frame*, not the page. Sweep on empty canvas: it should be a page child.
3. **A click is not a zero-sized node.** Click without dragging. You should get
   a node at the click point with **no** `width`/`height` in the file at all —
   the inspector shows 100×100 dimmed, which is the engine answering. If you see
   `width={0}`, that is a bug.
4. **Text behaves the way Figma's does.** A dragged text is a fixed box; a
   clicked one gets `textAutoResize="WIDTH_AND_HEIGHT"` and hugs its characters.
5. **The output is canonical.** Run `uidx fmt --yes` on a file after creating a
   few nodes. It must leave every created node alone — that is D1's "output
   matches `uidx fmt` style". I checked this with the CLI rather than only in a
   test, and it is how I found the defect below, so it is worth your repeating:
   note that `fmt` will still reformat any *hand-written* nodes whose own style
   is not canonical, which is not the editor's doing.
6. **Names do not collide.** Draw three rectangles in the same frame:
   `rectangle-1`, `-2`, `-3`. Draw one in a *different* frame and it should be
   `rectangle-1` again — uniqueness is per-parent.
7. **An armed tool does not select or resize.** With a node selected and a tool
   armed, sweep straight across that node's resize grips. It must draw, not
   resize. This is the case I most expected to get wrong.

**A defect this shipped with, found and fixed during the live pass.** `uidx
fmt` rewrote a file the toolbar had just written: expanding a self-closing
parent spliced `>` onto the last attribute's line, where canonical style puts it
on its own line. Drawing a frame and then drawing inside it hit it every time.
Fixed in `patch.ts`, with a test in the format package.

The reason it got past me is worth more than the fix: the test meant to cover it
compared `emitDocument` against itself, so it passed whatever the patcher wrote.
It now asserts against the patched source. **If you want one thing to be
sceptical about in this entry, make it that** — I would not have caught it
without running the real CLI.

**Known and deliberate.** A `<Vector>` is created with a placeholder triangle
path. One with no `vectorPaths` renders nothing at all, so the tool would place
an invisible node; real vector authoring is D8's. The path does not follow a
later resize, which is true of every authored path in this repo rather than
something this default introduced.

**Where it lives.** `packages/schema/src/create.ts` (what a node is made of),
`packages/viewer/src/EditToolbar.vue`, `tool-keys.ts` (shortcuts, pure),
`drop-target.ts` (`insertTargetFor`), the `draw` gesture in
`useCanvasControls.ts`, `createNode` in `CanvasPane.vue`. Tests:
`create.test.ts`, `tool-keys.test.ts`, `edit-toolbar.test.ts`,
`create-roundtrip.test.ts`, plus seven in `canvas-edit.test.ts`.

**Verified live.** All five tools, drawn into a frame, into another frame, and
onto empty canvas; a clicked text hugging; a Vector visible inside a
freshly-drawn Frame.

### ⬜ D2 — delete on selection

*Shipped 2026-08-22 · Phase 3b · backlog: [D2](backlog.md#d2-delete-on-selection--s)*

**The goal.** Removing an element should not mean hand-editing the file.

**The one interesting part.** The sole child of a `<Component>` may not be
deleted — v1 says a component has exactly one child. The patcher already
refused it, but refusing at the patcher means the author presses a button and
gets an error banner. D2 asks for the control to be *disabled* instead, so
`canRemove` exists as a predicate beside the patcher's guard, and both the
button and the keyboard ask it.

**What to validate.**

1. **Delete works from both.** Select a node, press Delete (or Backspace), and
   separately use the toolbar's bin. Both should remove it and clear the
   selection, leaving the inspector empty rather than showing a node that is
   gone.
2. **The sole child of a `<Component>` cannot go.** Select it. The bin should be
   greyed. Press Backspace: nothing should happen — **and no error banner should
   appear**. A banner would mean the guard leaked to the patcher, which is the
   exact thing this story is about.
3. **Backspace in a field is still Backspace.** Click into a hex or a number
   field in the inspector and press Backspace. It must edit the text, not delete
   the node. This guard is shared with the tool shortcuts, so it is worth one
   deliberate try.
4. **Nothing selected, nothing offered.** The bin is disabled. So is the whole
   toolbar when the connection drops — pull the server down and check.

**Where it lives.** `canRemove` in `packages/viewer/src/layer-moves.ts`,
`isDeleteKey` in `tool-keys.ts`, `removeSelection` in `App.vue`, the bin in
`EditToolbar.vue`. Tests: `layer-moves.test.ts`, `tool-keys.test.ts`,
`edit-toolbar.test.ts`.

**Verified live.** Bin greyed for a `<Component>`'s sole child and Backspace a
no-op there with no banner; Delete removed a text; the bin removed a page-level
rectangle.

**Gate for both.** format, lint, typecheck, build, **909 tests** (up from 860),
`uidx check` on the examples — all green.

### ⬜ D7 — dragging a flowed child reorders it

*Shipped 2026-08-22 · Phase 3b · backlog: [D7](backlog.md#d7-dragging-a-flowed-child-reorders-it-the-way-figma-does--l)*

**The goal.** A child of an auto-layout frame could not be dragged at all: its
`x`/`y` belong to the layout (D4), so C10a refused the gesture outright rather
than write geometry the file would not keep. Figma's answer is that the drag
means something else — an *index*, not a position. Now it does.

**The decision I would most like checked.** The dragged child **does not follow
the pointer**. It cannot, without writing geometry its parent owns — which is
the whole reason the drag is a reorder — so what you get instead is an insertion
caret between the two siblings it would land between. The backlog called for
exactly this ("an honest caret beats a half-right animation"), and I think it is
right, but you are the one who will feel whether it reads as responsive or as
inert. If it feels dead, say so and I will look at what Figma actually does with
the dragged node.

**What to validate.** Build a frame with `layoutMode="VERTICAL"` and three
children:

1. **A drag reorders.** Drag the top child down past the last one. The rail and
   the canvas should both show the new order, and the diff should be **one**
   `move-node` — no `x`, no `y`, nothing else. Geometry in that diff is the
   failure this story exists to avoid.
2. **The caret tracks the pointer.** While dragging, a line should appear
   between the siblings the child would land between, spanning the row, and
   should move slot to slot as you go. It clears on release.
3. **A drag that lands where it started commits nothing.** Nudge a child a few
   pixels within its own slot and release. The revision counter in the top bar
   must not move. This is the one I would check in both directions — drag up a
   little and drag down a little — because it is the classic reorder
   off-by-one, and it comes out right only because the index is counted against
   the siblings with the dragged child already removed.
4. **Horizontal frames too.** Same with `layoutMode="HORIZONTAL"`: the caret
   should be vertical and the counting should follow x.
5. **Wrapping is the reason this is an L.** Set `layoutWrap` so the children
   form two rows. Dragging should place *within the row you are pointing at* —
   same x in row two must not give the same index as row one. This is the case
   I have unit tests for but did **not** exercise in the browser, so it is the
   weakest point of the story; if you only stress one thing, stress this.
6. **Nothing else lost its gesture.** A child pinned with
   `layoutPositioning="ABSOLUTE"` should still *move* freely, and a child of a
   plain (non-layout) frame should still move. Resize grips and rotation should
   be untouched everywhere.

**A deliberate inversion, so it does not look like a regression.** C10a shipped
a test asserting there is *no* move cursor over a node its parent places. That
assertion is now the opposite, because the drag has a meaning. The underlying
rule is unchanged — offer the hand exactly where a press would do something —
and the cursor asks `flowSlotAt` rather than assuming.

**Out of scope, as the story allowed.** Dragging a child *out* of the flow onto
the page or another frame still is not offered on the canvas; that stays with
the layers rail. Guessing a target parent mid-gesture is a worse failure than
refusing.

**Where it lives.** `packages/viewer/src/flow-reorder.ts` (all the arithmetic),
`reorderFor` in `layer-moves.ts`, the `reorder` gesture in
`useCanvasControls.ts`, `slotUnder` in `CanvasPane.vue`. Tests:
`flow-reorder.test.ts`, `layer-moves.test.ts`, `canvas-edit.test.ts`,
`reorder-roundtrip.test.ts` (which runs real Yoga layout, so the sibling rects
are the ones an author would be pointing at).

**Verified live.** Dragged the top child to the bottom and back; the file order
followed and no position was ever written. A no-op drag left the revision
untouched. The caret drew where the drop landed.

**Gate.** format, lint, typecheck, build, **932 tests** (up from 909),
`uidx check` on the examples.

### ⬜ D8, the vector half — drop an SVG, get `<Vector>` nodes

*Shipped 2026-08-22 · Phase 3b · backlog: [D8](backlog.md#d8-images-and-vector-content--place-import-and-where-the-bytes-live--l)*

**The goal.** Bring artwork into a page. Drop an `.svg` on the canvas and it
becomes `<Vector>` nodes in the file, rendered by the existing build path.

**The decision that shapes everything else.** I did **not** use the SDK's
`prepareSVGImport`. It produces `VectorNetwork`s, and `vectorPaths` is a `d`
string — so going the SDK's way means reconstructing a `d` from a network,
which is the lossy round trip the story explicitly warns against, just reached
from the other direction. An SVG already *contains* `d` strings, so the importer
reads them straight across and uses `svgpath` only to bake ancestor transforms
into the coordinates. Arcs stay arcs, and a path that needed no transform
crosses byte for byte.

**What to validate.** Drag a real SVG onto the canvas — an icon from a library
you actually use is a better test than anything I would write:

1. **It lands where you dropped it, at the right size.** The commonest way an
   SVG import goes wrong is a `viewBox` mismatch: a 24-unit icon placed at 96px
   arriving a quarter size. Check a few with different `viewBox`/`width`
   combinations.
2. **It looks like the original.** Open the same file in a browser side by side.
   Fills, strokes, stroke widths, even-odd holes, nested `<g transform>`.
3. **Multi-path SVGs keep their parts.** Several paths should become several
   `<Vector>` nodes inside a `<Frame>`, each separately selectable in the rail —
   not one node that has forgotten which path was which.
4. **The banner tells you what was lost.** Drop something with text that was
   never outlined, or a gradient fill, or a filter. You should get a message
   naming each one. **This is the criterion I would most like you to push on**:
   the story's rule is that what cannot be represented is *reported, not
   dropped*, and the failure mode is a logo that quietly lost something and
   passed review anyway. Try an SVG you know is complicated and see whether the
   message is enough to act on.
5. **The paths are honest in the file.** Open the `.uidx`. A path that needed no
   transform should read exactly as it did in the SVG. A transformed one should
   have the transform baked in, not carried as an attribute.

**Known and deliberate.** A gradient or pattern (`fill="url(#…)"`) imports the
geometry with **no fill** rather than guessing a colour, and says so. Class-based
paints from an embedded `<style>` are not read — reported, not silently
defaulted. This places and imports; it is not a pen tool, per the story's scope.

**A bug the live pass found, beyond the story.** The import's message shared a
ref with C3's patch notices, and the successful `insert-node` echo cleared it
milliseconds after it appeared — a landed patch is deliberately silent. So the
first live run imported correctly and told the author nothing. The two notices
are cleared by different things and now have different owners.

**Where it lives.** `packages/viewer/src/svg-import.ts` (all of it, pure),
`onDrop` in `CanvasPane.vue`, the banner split in `App.vue`. Tests:
`svg-import.test.ts` (24). `svgpath` is a new viewer dependency.

### ✅ ADR 0006 — artwork *(accepted 2026-08-22: path, not hash)*

*Written 2026-08-22 · status **proposed** ·
[ADR 0006](decisions/0006-images-and-vector-artwork.md)*

**This entry is different from the others: nothing has been built.** D8's image
half is blocked on a format decision, the backlog said so, and this is that
decision written down. It is marked *proposed* rather than *accepted* because
it changes what a reviewer sees in a diff, what `.fig` export has to pack, and
what CI can fail on — so it wants a human yes before code follows it.

**Widened 2026-08-22** after you asked what happens to vector content and
symbols — the first draft only answered the raster question. It now covers all
three shapes artwork comes in, and surfaced a missing story (**F10**, make a
component from a selection) while doing it.

**What it decides**, in six lines:

- An image is a **fill**, not an element — Figma's model, and ADR 0002 says the
  authored surface tracks Figma. `fills={[{ type: 'IMAGE', src: 'assets/hero.jpg', scaleMode: 'FILL' }]}`.
- The reference is a **path relative to `uidx.json`**, not the content hash the
  SDK speaks natively.
- **`uidx.json` gains `assets`**, a glob list, defaulting to `["assets/**"]`. A
  `src` outside it is a diagnostic; remote URLs are refused, not fetched.
- **A missing asset fails `uidx check`.** The viewer draws a labelled
  placeholder for the same case.
- **Vector artwork is inlined, never referenced** — `<Vector>` carrying the
  paths, not `<Vector src="logo.svg">`. Content that can be text is text; only
  bytes that cannot be are referenced.
- **Reuse is a component, not an asset.** One icon on twelve pages is a
  `<Component>` and twelve `<Instance>`s, which is Figma's answer and the
  mechanism F3 already needs.

**The one to argue with.** Path versus hash. I chose the path because a diff
has to be readable — `assets/logo.svg` → `assets/logo-2026.svg` says what
happened where two hashes say only that something did — and because a
content-addressed store is a garbage collector nobody asked for. The hash is
still computed at load and is what reaches the scene graph; it is derived, never
authored. **If you would rather have the hash** (it is what F2 needs, and what
Figma does), say so — the whole image half rests on this and it is much cheaper
to change now than after the loader, the check diagnostic and the paint control
exist.

**The second thing to push on.** §6 says a vector is never referenced, which
means an icon set maintained outside the document (someone's Illustrator
folder) does not re-sync — you re-import and read the diff. I think that is the
right trade for a format whose claim is that the file states what it draws, but
it is a real cost and you may weigh it differently.

**Answered: path.** §2 is settled and the ADR is accepted. §3's default
widened to `assets/**`, `images/**` and `icons/**`, since there is no single
convention and defaulting to one would make the others a configuration step.

**One section has not been read.** §9 (how asset bytes reach the viewer) was
written after you last looked at this file. It is an implementation route
rather than a format decision — a same-origin `/__uidx/asset/…` on the server
that resolves against the manifest — so it is accepted with that noted rather
than held back. Worth a glance when you are next in here.

**Gate for the vector half.** format, lint, typecheck, build, **956 tests**
(up from 932), `uidx check` on the examples.

### ⬜ D11 — the pen tool, and `vectorPaths` becoming two-way

*Shipped 2026-08-22 · Phase 3b · backlog:
[D11](backlog.md#d11-the-pen-tool--draw-a-vector-on-the-canvas--l) ·
[ADR 0006 §8](decisions/0006-images-and-vector-artwork.md)*

**The goal.** You asked for vector content authored visually and saved to the
file as vector content. This is it: `P` draws instead of placing. Click for a
corner, press-and-pull for a smooth vertex, click the first vertex to close,
Enter to finish open, Escape to abandon.

**The thing to be sceptical about, and it is a format change.** `vectorPaths`
was marked one-way in the prop table on the grounds that converting a
`VectorNetwork` back to a `d` string is lossy. I measured it instead of
inheriting it: the round trip reaches a **fixed point after one pass**, and the
only real loss — an arc becoming cubics — happens on the way *in*, not out.
Everything a pen produces survives exactly. That measurement is ADR 0006 §8 and
it is what the whole story rests on; if it is wrong, this ships a format that
rewrites itself.

I put two independent guards on it. `VOUCHED_ONLY` in `from-scene.ts` means only
a vector gesture can originate a geometry write, so an unrelated edit to a
vector node cannot re-spell its path. And there are tests from both ends — the
schema's, which check that a file already holding the emitted spelling produces
*no patch at all*, and the pen's, which check that what it draws survives
parse-and-re-emit byte for byte.

**What to validate.**

1. **Draw a closed shape.** Press `P`, click three or four corners, click back
   on the first. Expect a filled `<Vector>` in the file whose `vectorPaths`
   reads as the shape you drew, and `x`/`y`/`width`/`height` hugging it.
2. **Draw an open curve.** Press-and-pull each vertex. Expect a *stroked*
   vector — an open path has no inside to fill, and a filled one would look
   like the tool had failed.
3. **The box hugs the ink, not the handles.** Pull a long handle and check the
   selection rectangle does not extend to where the handle reached. This is
   solved for rather than approximated, and it is the detail I would expect to
   have got subtly wrong.
4. **Save and re-save.** Draw something, then make an unrelated edit to it — a
   fill, a nudge, a rename. **The `vectorPaths` line must not change.** If it
   re-spells itself, the vouching gate has a hole and that is the bug worth
   finding.
5. **Escape and tool-switch abandon cleanly.** Half-draw a path and press
   Escape, then half-draw one and click another tool. Neither should leave an
   overlay behind or commit anything.
6. **`uidx fmt --yes` afterwards** should leave the drawn vectors alone.

**Known and deliberate.** Editing an *existing* path's vertices is **D12**, not
this — you can draw a new shape but not yet correct an imported one. The tool
puts itself away after one path (Figma keeps the pen armed); that is D1's rule
applied consistently, and a one-line preference if you would rather it stayed.
The placeholder triangle survives in `createSpec` as an unreachable fallback,
where the ADR expected it to go.

**Also fixed, found by looking at the result rather than the tests:** the
inspector still read "vector geometry is one-way — nothing on the canvas can
originate it". D11 had just made that false.

**Where it lives.** `packages/viewer/src/pen-model.ts` (all the arithmetic),
the `pen` state in `useCanvasControls.ts`, `commitPenPath` in `CanvasPane.vue`,
`vectorPaths`' `fromScene` in `packages/schema/src/prop-table.ts`, and
`VOUCHED_ONLY` in `from-scene.ts`. Tests: `pen-model.test.ts` (22),
`vector-writeback.test.ts` (8), eleven more in `canvas-edit.test.ts`.

**Verified live.** A closed triangle and an open S-curve, both drawn in the
browser, both rendering, both correct in the file. Escape abandoned. Gate green
at **996 tests**, up from 956.
### ⬜ D8's image half — raster images as asset references

*Shipped 2026-08-22 · Phase 3b · [ADR 0006](decisions/0006-images-and-vector-artwork.md)*

**The goal.** The other half of what you asked for: a photograph or a logo in a
design, referenced by path so a reviewer can read the change in a diff.

**What it is, in four moves.** `uidx.json` gains `assets` (defaulting to
`assets/**`, `images/**`, `icons/**`). An image is a fill —
`fills={[{ type: 'IMAGE', src: 'assets/hero.jpg', scaleMode: 'FILL' }]}`.
`toSceneGraph` gains a `resolveAsset` beside `resolveAlias`, turning the file's
`src` into the `imageHash` the renderer reads. And the server serves the bytes
on its own origin at `/__uidx/asset/…`, resolved once, server-side, against the
declared globs.

**What to validate.**

1. **An image draws.** Put a PNG under `assets/` and reference it. It should
   appear, cropped by `scaleMode` — try `FILL`, `FIT` and `TILE` on a
   non-square box, since a wrong mode is the sort of thing that looks nearly
   right.
2. **A missing one is named, not silent.** Reference a path that isn't there. A
   panel should name it on the canvas — an empty box is indistinguishable from a
   bug — and `uidx check` should fail the build.
3. **The three diagnostics say three different things.** `../outside.png`, a
   `https://` URL, and a real file in a folder `assets` doesn't cover should
   give UIDX301, UIDX301 and UIDX303 respectively, each with a fix in the
   message. This is the part I'd most like read for wording.
4. **The route cannot be talked out of its bounds.** `curl` the asset route with
   `..` in the path, and with a real file outside the globs (`uidx.json`
   itself). Expect 400 and 403. **The check runs server-side on purpose** — one
   that only ran in the browser would be a suggestion.
5. **Two pages using one logo.** Both should draw, and the bytes should be
   fetched once — identical bytes hash to one entry.

**Known and deliberate.** **Images are fills only.** Figma allows an image
stroke; this scene graph cannot represent one — `Stroke` carries a flat colour
and no image field, which `composeStrokes` already documents. Scanning strokes
would validate a path for something that can never draw. `imageTransform` (the
crop rectangle) is deferred per ADR §5, and there is no image-aware paint
control yet — an image paint shows read-only-with-a-reason, the C5 path.

**Two bugs the live pass caught that the tests did not**, both worth knowing
because neither was visible from unit tests:

- **`uidx check` resolved the manifest from `cwd`**, not from each page — so
  every image in a document checked from another directory reported as missing.
  A `src` is relative to the manifest above the file that names it.
- **The asset route never ran.** Middleware added after `createViteServer` sits
  behind Vite's own SPA fallback, so a PNG came back as `text/html` with status
  200. It is a plugin now, registered before the internal middlewares.

**Where it lives.** `packages/format/src/assets.ts` (the grammar and the
references), `packages/server/src/assets.ts` (the route's decisions) and
`document.ts` (`assets`, `documentAssets`, `assetProblem`),
`checkAssets` in the CLI, `resolveImagePaints` in `to-scene.ts`, and
`packages/viewer/src/asset-store.ts`. Tests: 11 + 13 + 6 + 8 across those.

**Verified live.** A generated PNG drawn on the canvas at `scaleMode: 'FILL'`;
the route returning `image/png` for a declared file, 400 for a `..` escape and
403 for an undeclared one; all three diagnostics from the real CLI. Gate green
at **1034 tests**, up from 996.

---

### ⬜ D12 — editing an existing path's vertices

*Shipped 2026-08-22 · Phase 3b · backlog:
[D12](backlog.md#d12-edit-an-existing-paths-vertices--m) ·
[ADR 0006 §8](decisions/0006-images-and-vector-artwork.md)*

**The goal.** D11 let you draw a path; this lets you correct one. Double-click a
`<Vector>` to reach its points — the same descent that steps into a frame, one
level further down — then drag a point, drag a handle, or press Delete on a
point. Escape leaves. **This closes Epic D.**

**The thing to be sceptical about.** Every edit here re-writes the whole
`vectorPaths` line, because a `d` is one string. So the question is not whether
the shape is right — you can see that — but whether the *text* stays still when
it should. Two claims to test:

- A path the pen drew is already canonical, so editing one point of it changes
  only the numbers for that point. Nothing else in the line moves.
- A path that came from an SVG is often *not* canonical, so its first edit does
  re-write the line. That is announced before you touch it rather than
  discovered in the diff afterwards, and the message is measured — it compares
  what the file holds against what the write-back would spell, so it stays
  silent when nothing would change.

**A decision I made that you may want to overturn.** **The node's box is not
refitted to the ink.** Drag a point outside the shape's bounds and `width`,
`height`, `x` and `y` stay exactly as they were; only the path moves. Figma
refits. I did not, and the reason is that a `d` is relative to the node's
origin, so refitting would move that origin and re-spell every *other* point in
the file as a side effect of nudging one — the churn the vouching gate exists to
prevent, arriving through the front door. It is also consistent with what this
repo already does: the renderer draws the network unscaled, and resizing a
`<Vector>` here already changes the box without touching the ink. If you would
rather it refitted, that is a real trade and I would take the instruction.

**What to validate.**

1. **Descend and leave.** Double-click a vector inside a frame: first click
   selects it, second opens its points. Escape closes them; the node should be
   draggable again straight afterwards.
2. **Drag a point.** Expect the shape to follow live, and **one** `set
   vectorPaths` in the diff on release — no `x`, no `width`, nothing else.
3. **Click a point without dragging.** Expect *no* patch. A look is not an edit.
4. **Drag a handle on a smooth point.** The far handle should mirror. Hold Alt
   and it should not. A point whose tangents disagree is a corner and its far
   handle should not move either way.
5. **Delete a point.** The point goes; the node stays. On a shape down to two
   points, Delete should refuse rather than leave a `<Vector>` with no geometry
   — removing the shape is D2's gesture on the node.
6. **The warning.** Open the points of a pen-drawn vector: expect **no** banner.
   Open one imported from an SVG that uses arcs: expect the arc sentence. Open
   one that is merely spelled compactly: expect the milder sentence.
7. **An icon with a counter.** A two-subpath path (a ring, an O) should show all
   its points, and editing one subpath must not lose the other or drop an
   `EVENODD` winding rule.
8. **`uidx fmt --yes` afterwards** should leave the edited vectors alone.

**Known and deliberate.** Arrow keys do nothing while points are open — nudging
the node would move the shape out from under the point you were aiming at, and
nudging the *point* is not built. A press that misses a point but lands on the
shape only deselects the point; a press outside the node leaves the mode. A
remote change to the same path while its points are open is not picked up unless
it forces a full rebuild.

**One thing the live pass turned up that is not mine to fix here.** The notice
banner is a layout row, so the warning shifts the whole canvas down as the mode
opens. Every notice has always done this, but D12 is the first to fire one at
the *start* of a pointer sequence rather than after one. It cost me a run of the
live pass — a cached canvas rect aimed 33px high and missed every point. A human
looks before aiming, so I do not think it is a defect; say if you disagree and it
becomes a shell change.

**Where it lives.** `packages/viewer/src/vertex-edit.ts` (all the arithmetic),
the `vertexEdit` state in `useCanvasControls.ts`, `worldPathOf` /
`commitVertexPath` / `announceRespelling` in `CanvasPane.vue`, and
`vertexEditing` in `App.vue`. Tests: `vertex-edit.test.ts` (32),
`vertex-roundtrip.test.ts` (6), eighteen more in `canvas-edit.test.ts`.

**Verified live.** Driven in a browser against three shapes: a plain triangle, a
`rotation={30}` square nested two frames deep, and a two-subpath ring with an
`EVENODD` rule. Point drags, a mirrored handle drag, Delete, and Escape all
correct in the file; the rotated case confirmed the world-to-local trip, which is
the piece I would most expect to have got wrong. Gate green at **1090 tests**, up
from 1034.

### ⬜ F3 — instances and overrides (the composition half)

*Shipped 2026-08-22 · Phase 5 · backlog:
[F3](backlog.md#f3-instances-and-overrides--l) · ADR 0004 §2*

**The goal.** A design system that composes: `<Instance name="save"
component="Button/Primary" />` places a component by its bare global name, from
any page of the document, and `overrides` changes one thing about one use of it
without forking the definition. `examples/sign-in.uidx` is the whole feature in
one file — two instances of the button defined in `primary-button.uidx`, one
overridden, the panel bound to a token from `core-tokens.uidx`.

**Read this first, because it is half a story.** **Authoring an override is not
built.** You can write `overrides={{ 'container/label': { characters: 'Save' }
}}` by hand and it renders; you cannot produce it by editing the canvas. An
instance's children are deliberately unselectable — that is D4's rule working,
not an oversight — and nothing yet turns "the author changed this generated
node" into "add a key to the instance that owns it".

It is written up as **F3b**, and two things kept me from just building it. The
first is a product call that is genuinely yours: **which properties may an
override carry?** Figma allows text, fills and visibility and refuses anything
structural; the alternative here is "everything the prop table maps". That
decides how much of the inspector goes live when a generated node is selected.
The second is that F3b has to change what "absent from the bimap" means —
today it is one line in `fromSceneChange` returning `[]`, and it is the whole of
D4's protection against computed geometry reaching the file. Making that absence
sometimes mean "patch the owning instance instead" is worth doing deliberately
rather than in passing.

*(An earlier draft of this entry said the hard part was that the patch lands in
a different file. That was wrong: the `overrides` map is on the `<Instance>`,
which is on the page you have open. It is the component definition that is
elsewhere, and editing that is the other gesture, not this one.)*

**The thing to be sceptical about.** An instance's subtree is generated, and D4
says generated content must never become a patch. The test is "absent from the
bimap", which was written before anything could produce a generated node — so
until this story it was a rule with nothing to break it. If it is wrong, editing
an instance's child writes garbage into the file at an address that does not
exist. I have tested it from both ends (a scene edit to a generated child
produces no patch; the same edit to the instance itself produces one) but it is
the claim worth attacking.

**A decision you may want to overturn.** **A page that uses instances rebuilds
its scene rather than reconciling it.** A page-shaped diff cannot see what
changed an instance — the definition may be on another page, and an edited
`overrides` map produces no scene property change at all — so any change
involving a component or an instance drops to a full rebuild. It costs the
incremental path on exactly those pages, and nothing at all on pages without
instances. The alternative is teaching the diff to expand a subtree it has no
resolver for, which I judged a story rather than a line.

**What to validate.**

1. **Open `examples/sign-in.uidx`.** Two buttons, the second reading "Not now".
   The definition is in another file and so is the token the panel's radius
   comes from.
2. **Edit the definition** (`primary-button.uidx` — change the fill or the
   radius) with sign-in open. Both instances should follow, without a save to
   sign-in itself.
3. **Edit an override by hand** and watch only that instance change.
4. **Misspell a component name** — expect UIDX401 from `uidx check`, naming the
   near miss. **Make two components instance each other** — expect UIDX403.
   Both come through the same code path a token alias uses, which is the part I
   am pleased about.
5. **The rail.** An instance's children appear beneath it, dimmed. Try to
   rename, drag, hide or select one: all four should refuse. The instance itself
   should do all four normally.
6. **Try to break the bimap rule.** Select an instance, edit it — expect a patch
   on the instance. There should be no way to get a patch that names a generated
   child; if you find one, that is the bug worth finding.
7. **`uidx fmt --yes`** should leave `sign-in.uidx` alone. (It rewrites the
   other three examples, but that is pre-existing — they were not canonical
   before this story either.)

**Known and deliberate.** An instance's `W`/`H` read as unset in the inspector
even when the component gives it a size: C7's dimmed fallback probes a bare
`INSTANCE` node rather than the resolved component, and giving an instance a
panel of its own is F7. There is no toolbar tool for placing an instance —
§3.3's creation whitelist is the five drawing elements — so instances are
written by hand or, once F10 lands, made from a selection.

**Two things fixed that pre-date this story.** `insertSubtree` dropped
`resolveAsset`, so a node inserted incrementally against an already-fetched
image drew nothing until the next rebuild. And `CanvasPane` recorded the
component index on every render rather than only where a graph is built, which
made two watchers order-dependent — that one is defensive: I could not make the
live pass reproduce it.

**Where it lives.** `Instance` in `packages/format/src/types.ts` and
`checkInstance` in `parse.ts`; instance edges in
`packages/server/src/symbols.ts`; `expandInstance` and `instanceProps` in
`packages/schema/src/to-scene.ts`; `touchesComposition` in `reconcile.ts`;
`layerRows`/`componentIndex` in `packages/viewer/src/layer-rows.ts`. Tests:
`format/test/instance.test.ts` (10), `server/test/instance-symbols.test.ts` (8),
`schema/test/instance.test.ts` (15), `viewer/test/instance-rows.test.ts` (14).

**Verified live.** Driven in a browser against a two-page scratch document and
against the repo's own `sign-in.uidx`: instances render, the override applies to
one use and not the other, a change to the definition on another page reaches
both, the rail's generated rows refuse every gesture, and clicking one leaves
the selection on the instance. Gate green at **1138 tests**, up from 1090.

### ⬜ F10 — make a component from a selection

*Shipped 2026-08-22 · Phase 5 · backlog:
[F10](backlog.md#f10-make-a-component-from-a-selection--s) ·
[ADR 0006 §7](decisions/0006-images-and-vector-artwork.md)*

**The goal.** The step between D8 and F3 that neither covered. Select something
you have drawn, press the diamond in the toolbar (or ⌘/ctrl+alt+K), name it, and
it becomes a `<Component>` on the page. With F3 already in, that closes most of
the workflow ADR 0006 §7 described: drop an SVG, get `<Vector>` nodes, make them
a component, use it.

**The decision I made that the story left open.** It asked whether this should
be one `insert-node` plus one `move-node`, or a single richer op. It is
**neither**: it is `insert-node` for a `<Component>` *already carrying a copy of
the node*, then `remove-node` for the original. The move-node shape cannot work
— `applyPatches` re-parses between ops and a `<Component>` with no child is a
UIDX104 error, so the intermediate document is rejected halfway. The cost of my
version is real and worth your eye: **the diff reads as a block added and a
block removed, not as a move.** If you want a pure block move in the diff, that
needs a new patch op, and I would rather you asked for it than have me invent
one.

**The detail the live pass found.** The first version stripped the node's `x`/`y`
and gave the component none, so making a component teleported the artwork to the
page origin. The position moves *up* now: the child loses it (a `<Component>`
hugs its single child, so a position there is a number the layout ignores) and
the component, which is a page child whose position is authored, takes it.

**What to validate.**

1. **Draw something and make it a component.** It should stay exactly where it
   was on the canvas, and the rail should show `Name` with your node inside it.
2. **The selection should follow** into the component rather than being lost —
   the same `moved` signal a rename or a reparent sends.
3. **Naming.** Try a name that is already a component, and one that is already a
   token (`radius#md`). Both should be refused before you can press the button,
   and the refusal should say which. Try one containing `#`; it should say why
   that is different. An empty field should be quiet but not confirmable.
4. **The button should grey out** for the page, for a `<Component>`, for a
   component's only child, and while nothing is selected.
5. **A node inside a frame** should work as well as a page child — and its
   former siblings should be untouched.
6. **Then use it.** Add `<Instance name="x" component="YourName" />` to the page
   by hand and check it renders. That last step has no gesture yet, which is the
   gap below.

**Known and deliberate.** **There is no way to place an instance from the UI.**
§3.3's creation whitelist is the five *drawing* elements, and an instance needs
a name rather than a rectangle to sweep — so it wants a picker, which is a small
story of its own (**F11**). Until it lands, the workflow's last step is a line
you type. Also: `x`/`y` move up, but nothing else does — a rotated node keeps its
rotation inside the component, which I think is right and is worth a second
opinion.

**Where it lives.** `componentFrom` and `isComponentNameFree` in
`packages/viewer/src/layer-moves.ts`, `NameComponentDialog.vue`, and the button
and ⌘/ctrl+alt+K in `EditToolbar.vue` / `App.vue`. Tests:
`viewer/test/make-component.test.ts` (19).

**Verified live.** Drew a check mark, made it `Icon/Check`, watched it stay put
and the selection follow; then hand-wrote an instance of it and watched both
render. Gate green at **1157 tests**, up from 1138.

### ⬜ F11 — placing an instance from the UI

*Shipped 2026-08-22 · Phase 5 · backlog:
[F11](backlog.md#f11-placing-an-instance-from-the-ui--s) ·
[ADR 0006 §7](decisions/0006-images-and-vector-artwork.md)*

**The goal.** The last step of the workflow, and the one that makes the previous
four worth having. Press the outlined diamond, pick a component from the list,
click the canvas: an `<Instance>` lands there. **With this, ADR 0006 §7's whole
sequence runs without touching the file** — drop an SVG (D8), correct its points
(D12), make a component (F10), place instances of it (F11).

**The design decision.** Placing is armed like a tool but is *not* one. §3.3's
creation whitelist is the five elements a person draws, and an instance is
chosen from a list rather than swept out with a pointer — so `placing` is a
sibling of `tool` rather than a value inside it, and widening "creatable" to
carry a component name was the thing I deliberately did not do. The two are
mutually exclusive: arming either disarms the other, and Escape or `V` puts both
away. Everything after the arming is D1's gesture unchanged.

**What to validate.**

1. **With no components in the document**, the button should be greyed out
   entirely. Open the picker on a document that has some and then filter to
   nothing — the two empty states say different things on purpose.
2. **Pick and click.** One click, one instance, at the point you clicked. The
   button should disarm itself afterwards, so the next stray click places
   nothing — D1's rule.
3. **Names.** Placing `Icon/Check` twice should give `check-1` and `check-2`,
   named after the component's last segment rather than after the element.
4. **Click inside a frame.** The instance should land in that frame, through the
   same `insertTargetFor` a drawn rectangle uses.
5. **Escape and `V`** should put an armed component away as surely as they put
   away an armed rectangle.
6. **Enter in the filter box** should take the only match; with nothing matching
   it should do nothing at all.

**Known and deliberate.** A click is the only gesture — sweeping a rectangle
does nothing different, because an instance has no size of its own to set. There
is no reordering or grouping in the picker beyond alphabetical, and no preview
of what you are about to place; both are worth having and neither is this story.

**Where it lives.** `PickComponentDialog.vue`, the `placing` prop through
`App.vue` → `EditToolbar.vue` / `CanvasPane.vue`, and the `Instance` branch of
`createNode`. Tests: seven more in `viewer/test/make-component.test.ts`.

**Verified live.** Drove the whole workflow in a browser on an empty-ish
document: made `Icon/Check` from a drawn vector, then placed two instances of it
by picking and clicking, and read the resulting file — which nothing had typed
into. Gate green at **1164 tests**, up from 1157.

### ⬜ F6 — a component declares its properties

*Shipped 2026-08-22 · Phase 5 · backlog:
[F6](backlog.md#f6-a-component-declares-its-properties--create-manage-remove--l)
· ADR 0004 §2*

**The goal.** The mechanism you chose over raw overrides. A component declares
what its consumers may change, a layer inside it binds to one, and the consumer
names `label` rather than `container/label` — so the component author can
restructure their insides and nothing downstream notices.

```jsx
<Component name="Button/Primary" status="stable"
  props={{ label:    { type: 'TEXT',    default: 'Click Me' },
           showIcon: { type: 'BOOLEAN', default: true } }}>
  <Frame name="container" layoutMode="HORIZONTAL">
    <Vector name="leading-icon" visible="{showIcon}" … />
    <Text   name="label"        characters="{label}" … />
  </Frame>
</Component>
```

`examples/primary-button.uidx` is exactly that now, so the gate exercises it.

**The decision you should check, because it is the one the story called its
own.** How a layer says "my text comes from property `label`" without inventing
a second binding syntax beside token aliases. The answer is that no sigil is
needed: **a token's global name always contains `#`, and a property name never
does.** `{radius#md}` is a token; `{label}` is a property. If you can find a way
for those two to collide, this is the thing to break.

**The other decision worth an eye.** Each type fills exactly one attribute —
TEXT→`characters`, BOOLEAN→`visible`, INSTANCE_SWAP→`component` — taken from the
SDK's own `ComponentPropertyReference.field`. That makes a mismatched binding a
diagnostic (UIDX404) rather than a rendering oddity, but it also means you
*cannot* bind a TEXT property to, say, a fill colour. Figma has the same
restriction; say if you want it looser.

**What to validate.**

1. **Open `examples/sign-in.uidx`** and edit `primary-button.uidx`'s
   `label` default. Both instances should follow, across files.
2. **Flip `showIcon`'s default to `false`.** The check icons should vanish from
   both buttons — a BOOLEAN reaching `visible`.
3. **The two mechanisms compose.** `sign-in.uidx`'s second instance overrides
   `container/label`, so it should keep saying "Not now" while the first follows
   the default. That is the escape hatch you asked to keep, sitting beside the
   new thing without fighting it.
4. **Misspell a binding** (`{labl}`) — expect UIDX401 naming the near miss, the
   same diagnostic a misspelt token gets. **Bind a TEXT property to `visible`** —
   expect UIDX404. **Bind `{label}` outside any component** — expect a message
   saying it is not inside one.
5. **Two components each declaring `label`** should mean two different things,
   and an inner component should shadow an outer one completely.
6. **Malformed declarations**: a missing default, a `'true'` string where a
   boolean belongs, a type that is not one of the three. All UIDX115, and *all
   reported at once* rather than one per save.
7. **`INSTANCE_SWAP`**: `component="{glyph}"` on a nested instance should swap
   which component is placed.

**The panel shipped too, and it is where the remaining decisions are.** Select a
`<Component>` and a "Component properties" section sits above the layer's own,
the way Figma stacks them. It adds, renames, retypes the default, and removes.

- **Rename carries every binding in one envelope** — the declaration plus a
  `set` for each layer that read the old name. A document holding a renamed
  property and a binding to its old name is one `uidx check` rejects, so the two
  cannot be separate saves.
- **Removing one bakes its default in wherever it was read.** This is the
  decision the story left open, and the one to push on: simply dropping the
  declaration would leave a dangling `{name}` — a UIDX401 and a layer that draws
  nothing — so removing a property would silently break the component that
  declared it. Baking the last default in leaves the component looking exactly
  as it did. If you would rather it left the bindings dangling and made you fix
  them, say so; I judged a silent break worse than a slightly opinionated write.
- **Each row says how many layers read it**, so a rename or a removal is not a
  surprise.
- **Its edits do not travel the panel's `commit` route**, and could not: `props`
  is structural, so no scene node carries it. It is a second `patches` emit on
  `PropertiesPane`, straight at the document the way the rail's edits go.

**Also to validate, on the panel.**

8. **Add** a property of each type; **rename** one and check the bound layer
   follows and no diagnostic appears; **remove** one and check the layer keeps
   the value it was showing.
9. **Remove the last one** — `props` should disappear entirely rather than
   leaving `props={{}}` behind.
10. **Try a duplicate name** when adding: the Add button should refuse before
    you can press it.

**Known and deliberate.** `VARIANT` is not one of the three types and never will
be: ADR 0005 gives a component's states their own grammar. An instance's
*values* are F7.

*Corrected after F7 shipped:* this entry said carrying an instance's values
through a rename was "the one line that changes" in the binding-site list. That
is true only for instances on the same page. C1's patch envelope is
page-addressed, so instances on other pages need one envelope each, and that is
not a one-line change. **The rename still does not carry them** — see the F7
entry below for what an author sees when it happens.

**A bug this found in F3, now fixed.** `collectReferences` read an
`<Instance>`'s `component` attribute as a literal name even when it held a
binding, so `component="{icon}"` reported a missing component called
`"{icon}"` — a name nobody wrote.

**Where it lives.** `packages/format/src/component-props.ts` (the format's
judgement), `checkComponentProps` in `parse.ts`, `checkPropertyBinding` in
`packages/server/src/symbols.ts`, `withProperties` / `declaredDefaults` in
`packages/schema/src/to-scene.ts`, and `component-prop-edits.ts` /
`ComponentPropsSection.vue` for the panel. Tests:
`format/test/component-props.test.ts` (10),
`server/test/property-bindings.test.ts` (9),
`schema/test/component-props.test.ts` (11),
`viewer/test/component-prop-edits.test.ts` (29).

**Verified live.** Changed both defaults in one file with another file open, and
watched two instances follow while an overridden one held its own value. Then
drove the panel through all four operations on a fresh component — add, retype
the default, rename (the bound layer followed, no diagnostic), remove (the
layer kept its value) — and read back a file that was valid at every step. Gate
green at **1224 tests**, up from 1164.


### ⬜ F7 — an instance shows its properties, and assigning one is an edit

*Shipped 2026-08-23 · Phase 5*

**The goal.** The consuming half of F6, and the half an author actually spends
time in. Select an `<Instance>` and the top of the inspector lists what its
component declares, with the control the type implies; filling one in is one
patch, and it lands on the page you have open rather than on the file that
defines the component. That last part is the whole reason you chose declared
properties over raw overrides, so it is the thing to push on hardest.

**What to validate.** `examples/sign-in.uidx` now uses properties rather than
the override it shipped with — copy the `examples/` directory somewhere
scratch, open `sign-in.uidx`, and select `cancel` in the rail (its address is
`panel#cancel`).

1. **The panel lists `label` and `showIcon`**, in the order `Button/Primary`
   declares them, above the geometry. A text field for TEXT, a checkbox for
   BOOLEAN.
2. **Type a new label.** The canvas should follow, `sign-in.uidx` should gain
   the value, and **`primary-button.uidx` should be untouched** — check its
   mtime if you want to be sure. That is the claim the mechanism exists to make.
3. **Press ↺ on a row.** The key should *disappear* from `props`, not be
   rewritten with the default's current value, and the row should go dim and
   show the definition's default. Then change that default in
   `primary-button.uidx` and watch the reset instance follow while a set one
   does not — that difference is the point, and it is what "unset" has to mean
   for a design system to be worth anything.
4. **Reset the last key** — `props` should disappear entirely rather than
   leaving `props={{}}`.
5. **The other instance should not move** when you edit this one.

**Two things arrive only by hand, and the panel names both.** Neither can be
produced by pressing anything, so reach for an editor:

6. **A value the component no longer declares** (`props={{ tone: 'quiet' }}`) —
   the panel should say "`Button/Primary` no longer declares tone" and offer to
   drop it in one click. `uidx check` should report **UIDX405** with a near-miss
   suggestion if there is one.
7. **A value of the wrong type** (`props={{ showIcon: 'yes' }}`) — this is the
   one I added beyond the story, and the decision to push on. The row itself
   reads *unset*, because that is exactly what the renderer does with the value;
   left at that, the panel would say "nothing chosen here" about a key the file
   plainly has. So it says the value is there, why nothing is using it, and
   offers to drop it. `uidx check` reports **UIDX406**. If you would rather the
   row showed the bad value in the field instead, say so — I judged that a field
   showing something the canvas is not drawing is the worse lie.
8. **A declaration's shape on an instance**
   (`props={{ label: { type: 'TEXT', default: 'Save' } }}`) — the mistake of
   copying the component's own line. It parses, so nothing else would notice;
   expect UIDX115.
9. **Point an instance at a component that does not exist** and give it a
   property value — expect *only* the missing-component diagnostic. Piling
   "declares no `tone`" on top of "there is no such component" tells you nothing
   you can act on.

**Known limitation, and it is visible on every instance you select.** The
Position section reads `W` and `H` as unset even when the component gives the
instance a size — C7's dimmed fallback probes a bare `INSTANCE` node in
`defaults.ts`, which has no size of its own. Pre-existing, not introduced here,
but F7 is the story that put a panel in front of it.

**Known and not built: renaming a component property does not carry its
instances' values.** F6's entry above said this was a one-line change; it is not,
and the correction is written into that entry. Rename `label` and every instance
that set it is left holding a key the component no longer declares — which the
panel names (case 6) and offers to drop, so the file is never silently wrong,
but you re-set the value by hand. Worth trying, so you can judge whether that is
tolerable before F8 builds on top of it.

**Where it lives.** `instanceProps` in
`packages/format/src/component-props.ts`, `checkComponentProps` in `parse.ts`
(`props` is now legal on `<Instance>`, checked as an assignment rather than a
declaration), `checkInstanceValues` in `packages/server/src/symbols.ts`,
`instanceValues` in `packages/schema/src/to-scene.ts`, and
`instance-prop-edits.ts` / `InstancePropsSection.vue` for the panel. Tests:
`format/test/component-props.test.ts` (+7),
`server/test/instance-values.test.ts` (7),
`schema/test/component-props.test.ts` (+6),
`viewer/test/instance-prop-edits.test.ts` (27).

**Verified live.** Drove the panel on `sign-in.uidx`: typed a label and watched
the canvas follow while `primary-button.uidx` stayed untouched; reset it and
watched the row dim back to the definition's `Click Me`; toggled `showIcon` and
watched the icon return. Then hand-wrote both bad values and confirmed the panel
names each and drops it in one click. Every new guard was run against the
unfixed code first and watched go red. Gate green at **1271 tests**, up from
1224.


### ⬜ F8 — variants: a component declares its states, side by side

*Shipped 2026-08-23 · Phase 5 · [ADR 0005](decisions/0005-variants.md)*

**The goal.** One component carries its states — off, on, small, large — rather
than four components pretending to be related. The axes are declared once, each
`<Variant>` assigns them, and **nothing anywhere is named `State=On`**: that
microformat, which is how Figma stores variant identity, survives only as a
*derived* address segment computed from checked attributes. An instance picks a
combination through the same `props` object F7 fills in.

**What to validate.** `examples/toggle.uidx` is new and exists for this — copy
`examples/` somewhere scratch and open `toggle.uidx`.

1. **The canvas draws a labelled set**, Figma's dashed purple outline with the
   component name above it. Two variants along the first axis (`state`), the
   `size=sm` one on a second row, and the `state=on, size=sm` cell empty
   because nobody designed it. That arrangement is **generated** — it is in no
   file and can never become a patch.
2. **The rail shows each variant** as `state=off, size=md`. Try to rename one
   (double-click) — nothing opens, because a variant has no name of its own.
   Try to drag one — it will not start. There is no eye icon on it either:
   `visible` is not a legal attribute on a `<Variant>` at all.
3. **Everything inside a variant is ordinary.** Select the `on` state's label,
   change its `fontSize` in the inspector, and watch that variant grow *and the
   set re-arrange around it*. This is the one thing the live pass found broken
   and fixed: the update path re-laid-out the set as a whole, which leaves every
   variant at a default 100×100 box. If the neighbour ever overlaps, that
   regressed.
4. **Select `digest` and use the `state` picker.** An axis draws as a picker
   rather than a text field, because its values are stated — which is the whole
   difference declaring a domain buys over Figma's inferred axes. Reset it (↺)
   and the instance follows the component's default combination again.
5. **Ask for a combination nobody designed** — set `digest` to `state=on` and
   `size=sm`. It draws nothing, and `uidx check` reports **UIDX407** naming the
   combination and listing the ones that exist. That is deliberate: sparseness
   is the component's decision, so the mistake is at the use site.

**The five parse-time diagnostics**, each of which should name its own fix. Hand-edit
for these:

6. A value outside a domain (**UIDX118**); an unassigned axis (**UIDX118**); an
   attribute that is not a declared axis, and a `name=` on a `<Variant>` (both
   **UIDX118**).
7. Two variants with the same combination (**UIDX119**) — check it talks about
   the *combination*, not about the derived name nobody wrote.
8. Delete the `state="off" size="md"` variant (**UIDX120**) — the message should
   tell you the exact tag to add, or to reorder the axes.
9. `variants` over a plain child, and a `<Variant>` under a component that
   declares none (both **UIDX121**).
10. `#`, `/`, `=` or `,` in an axis name or value (**UIDX117**), and an axis
    named the same as a `props` property (**UIDX117** — F7 assigns both through
    one object, so one namespace).

**Two decisions to push on.**

- **Order comes from the declaration, not from the tag.** Write one variant's
  axes in the other order (`size="md" state="off"`) and it is still the same
  variant with the same address. Without that, changing where you typed an
  attribute would be a rename.
- **The default combination is required**, and it is each axis's *first* value.
  A positional default is a choice you can see and reorder, which is exactly
  what Figma's inferred axes cannot offer — but it does mean reordering an axis
  changes which combination is the default. If you would rather it were declared
  explicitly, say so.

**Not built, and it is F9's.** No gesture creates a `<Variant>`, declares an axis
or adds a value to one — F8 renders and checks what a person writes. F9's *other*
half, an instance picking a variant, shipped here, because it turned out to be
one control in a panel F7 had already built.

*F9 has since shipped most of that, and found that adding or renaming an **axis**
is not buildable at all under the current patch invariant. See its entry below.*

**Deliberately not done: `Button/Primary` did not grow a hover state**, which is
what the story asked for. `primary-button.uidx` is the repo's canonical
addressing fixture and about twenty test files read its addresses, so giving it
a variant would have meant rewriting all of them to demonstrate a feature. If you
would rather the canonical example carried states, say so and I will do the
migration properly.

**Where it lives.** `packages/format/src/variants.ts` (the declaration, the
derived name, the coordinates), `checkVariants` / `checkVariantShape` in
`parse.ts`, `nodeTypeFor` / `layOutSets` / `variantFor` in
`packages/schema/src/to-scene.ts`, `arrangeVariants` in `variant-layout.ts`,
`hasAuthoredGeometry` in `authorship.ts`, `checkInstanceValues` in
`packages/server/src/symbols.ts`, and the `derived` flag through
`layer-rows.ts` / `LayersPane.vue`. Tests:
`format/test/variants.test.ts` (23), `schema/test/variants.test.ts` (22),
`server/test/instance-values.test.ts` (+6),
`viewer/test/instance-prop-edits.test.ts` (+7),
`viewer/test/layer-rows.test.ts` (+4), `viewer/test/layers-pane.test.ts` (+4).

**Verified live.** Opened `toggle.uidx` and read the set outline, the grid and
the empty sparse cell off the canvas; confirmed a variant row refuses rename and
drag while its children stay editable; drove both pickers on an instance and
watched the file and the canvas follow; grew a label inside one variant and
watched the set re-arrange (the bug this found). Every new guard was run against
the unfixed code first and watched go red. `uidx fmt` round-trips a variant file
to a fixed point. Gate green at **1337 tests**, up from 1271.


### ⬜ F9 — the editor manages a variant set

*Shipped 2026-08-23 · Phase 5 · [ADR 0005](decisions/0005-variants.md)*

**The goal.** Grow and shrink a component's states from the inspector rather
than by hand: add a state, remove one, widen or narrow an axis, rename a value.
The half of F9 that picks a variant on an instance already shipped inside F8.

**What to validate.** Copy `examples/` somewhere scratch, open `toggle.uidx`,
and select `Control/Toggle` — a "Variants" section sits above "Component
properties".

1. **The gaps.** `Not designed yet` offers `state=on, size=sm`, the one cell
   `toggle.uidx` deliberately leaves empty. Click it: a new state appears,
   copied from the **closest** existing one (the `state=on` row, not whatever
   was declared first), and the canvas grows a fourth cell in the grid.
2. **Add a value** to `state` — say `pressed`. Exactly one thing should change:
   the declaration. Two new gaps appear and *no* state is designed, because
   sparseness is legal. That two-step is deliberate; push back if you would
   rather adding a value scaffolded its combinations.
3. **Rename a value.** Click `on`, type `active`, Enter. The declaration, both
   variants and their whole subtrees, **and** every instance that said
   `state: 'on'` all move — including instances on *other pages*. Add a second
   page with an instance to see that: `uidx check` should stay clean.
4. **Two refusals**, each of which should tell you the next step rather than
   just failing: remove the `md` value while states use it, and remove the
   `state=off, size=md` state, which is the default combination.
5. **Watch for a banner claiming an edit was not applied.** There should be
   none. It appeared during the live pass and is fixed (below); if it comes
   back, that regressed.

**The decision to push on, because it is the one thing the story asked for that
is not here.** **Adding, removing or renaming an *axis* is not built, and is not
buildable** as things stand. `applyPatches` re-parses between ops so every
intermediate document must be valid, a `<Variant>`'s coordinates live on the
variant while their domain lives on the component, and no op spans two nodes —
so there is no ordering that works. Measured, not assumed: declaring the axis
first reports UIDX118 on every variant that lacks it, and writing the attribute
first reports UIDX118 for an axis nobody declared.

Two honest ways out, and I did not pick one:

- **Rewrite the whole `<Component>`** as `remove-node` + `insert-node`, which is
  the shape F10 already uses. Costs the hand-formatting and any comments inside
  that component, on every axis edit.
- **A multi-node atomic op in the patch format** — one envelope the patcher
  applies before validating. Cleanest result, and it weakens an invariant that
  has been load-bearing since spec §9.5.

Renaming a *value* is unaffected and does work: it widens the domain to hold
both spellings, moves each variant, and narrows again — three ops, each a
document that parses, ordered so some combination is still the default
throughout.

**F7's debt is closed as a side effect, and worth checking on its own.**
Renaming a component *property* now carries the instances that set it, across
pages. F6's note called the remaining work "the binding-site list"; the real
blocker was the envelope, which is page-addressed. The shell now tracks a
revision per page and sends one per file. Try it: open `primary-button.uidx` in
a folder that also holds `sign-in.uidx`, rename `label` to `caption`, and both
instances on the other page should follow. **Not atomic across files, and it
cannot be** — two pages do not share a revision — so a rename whose second
envelope goes stale leaves the document briefly disagreeing with itself.
`uidx check` names exactly that (UIDX405), which is why I judged it acceptable;
say so if you would rather it refused the whole rename instead.

**Three patcher bugs F8 left behind**, found by building this and invisible to
F8, which only ever *read* variant files: the child whitelist refused a
`<Variant>` inside a `<Component>`, the one-child rule refused the second state,
and the auto-namer invented a `name=` on a node whose name is derived.

**A real bug the live pass found, in F6's code.** The rename input committed on
`keydown.enter` *and* on `blur` — and Enter clears the rename, which unmounts
the input, which fires `blur`. Two identical envelopes; the second went stale
and the shell reported an edit that had landed as "not applied". Latent since
F6, where two `set`s of one attribute rebase cleanly and nobody notices. Both
panels now commit only from the row still being renamed.

**Where it lives.** `packages/viewer/src/variant-edits.ts` (every operation, and
the widen-move-narrow), `ComponentVariantsSection.vue` (the panel),
`rewriteInstanceProps` shared with `ComponentPropsSection.vue`'s rename,
`commitAcrossPages` and the per-page `revisions` map in `App.vue`, and the three
guards in `packages/format/src/patch.ts`. Tests:
`viewer/test/variant-edits.test.ts` (35),
`viewer/test/component-prop-edits.test.ts` (+6),
`format/test/variants.test.ts` (+6).

**Verified live.** Filled the empty cell and watched the canvas grow a fourth;
added `pressed` and watched two gaps open with nothing designed; hit both
refusals and read their sentences; renamed `on` to `active` and watched the
declaration, both variants and an instance on the *same* page follow, then did
it again on a two-page document and watched an instance on the *other* page
follow. Separately renamed a property across pages for the closed F7 debt.
`uidx check` clean after each. Every new guard was run against the unfixed code
first and watched go red. Gate green at **1384 tests**, up from 1337.


### ⬜ Instant edits and inverse-patch undo — the file stays the truth

*Shipped 2026-09-05 · [spec](superpowers/specs/2026-09-05-instant-edits-and-inverse-patch-undo-design.md) ·
[plan](superpowers/plans/2026-09-05-instant-edits-and-inverse-patch-undo.md) ·
commits `24a553a`, `611d01b`, `ed97c33`, `d7dd25f`, `9e02da2`, `0ac3cfb` …*

**The goal.** An eye toggle on the meridian atlas took about 7 s to show: the
server parsed the 63k-line file twice per patch, and the client rebuilt the
whole scene on every save because the diff could not resolve `modes` and
compared component definitions by node identity. Now the rail and canvas show a
property edit in the same tick from a predicted document, the server confirms
with one parse in about 1.6 s, the confirmation lands as a 0.3 s diff, and
⌘Z / ⇧⌘Z undo the author's edits, an outside editor's revision, or an LLM turn
by writing the inverse patch through the same channel. Three defects closed on
the way; the one that matters most to the write path is that an unvouched
geometry change can no longer overwrite an alias-bound size with a literal —
the incremental path had emitted 413 such writes on one atlas save.

**What to validate.**

- Open atlas, toggle any eye. The row and the canvas change before the status
  bar's revision moves; when it moves, nothing flickers and the status reads
  "1 change(s)", not "rebuilt".
- `git diff design-systems/meridian/atlas.uidx` after a toggle and a ⌘Z: the
  attribute goes in and comes back out; no other line moves. In particular no
  literal `width=` or `height=` appears on any `rule` node.
- Edit atlas in an editor (add `opacity={0.5}` to a frame), save: the canvas
  shows it; ⌘Z in the viewer removes it from the file. ⇧⌘Z puts it back.
- Ask the chat panel for an edit touching several nodes; when the reply
  finishes, one ⌘Z reverts the whole turn.
- Drag a node on the canvas: exactly one `node:patch` per gesture (watch the
  network panel), and the file gains only the dragged node's `x`/`y`.
- A Tokens edit: pages binding the token re-resolve without "rebuilt".

**Known limits, by design.** Structural ops (insert, remove, move) are not
predicted — they wait for the round trip as before. Undo reverses the top
entry whoever wrote it. Prose edits produce a history entry whose undo is a
no-op, labelled as such. The stack is per tab and lost on reload.

### ⬜ Viewer at scale — work proportional to the edit

*Shipped 2026-09-05 · [spec](superpowers/specs/2026-09-05-viewer-at-scale-design.md) ·
[plan](superpowers/plans/2026-09-05-viewer-at-scale.md)*

**The goal.** Every stage of an edit was proportional to the page: the server
re-parsed the whole 63k-line file, the wire carried the whole 15 MB document,
the client diffed the whole tree, the renderer re-recorded the whole picture,
and an LLM write went through the file and the watcher. Now the server
re-lowers one element, the wire carries the patches plus a hash, the client
applies them to the revision it holds, writers post patches to the session,
and the renderer re-records only the chunks the viewer marked.

**What to validate.**

- Toggle an eye on atlas: the status bar's revision moves within about half a
  second; the network panel shows a `file:changed` of a few hundred bytes with
  `patches` and no `doc`.
- Edit atlas in a text editor and save: the canvas follows, the message is a
  delta too (`base` set); edit only prose and save: the client sends
  `page:request` and gets the whole document once.
- Run `uidx apply design-systems/meridian atlas.uidx --ops <ops.json>` with the
  viewer open: the change lands on the canvas at once, and the file's revision
  moves by exactly one.
- With the canvas visible, toggle a node inside `doc`: the status text reads
  "N change(s)"; the profiler HUD (if enabled) shows a record time well under
  the whole-page record.
- Undo and redo still work for all of the above.

**Known limits.** Prose edits always fetch the whole document. A component
instanced from inside another component still rebuilds, as does changing what
an instance expands to (`component`, `props`, `overrides`) or a component's
`variants`. Hiding an instance, or the component root, is an in-place update. Pages on demand and a
layout worker are deferred (spec §5).

## Reviewed

*Nothing yet.*
