# ADR 0011 — A pinned child states its offset, not its coordinate

Status: **accepted**, 2026-08-29. Approved in conversation, section by section.
Its design is
[2026-08-29-pins-and-constraints-design.md](../superpowers/specs/2026-08-29-pins-and-constraints-design.md).

## Context

A child should be able to sit relative to its parent — pinned to the right
edge, stretched between two edges, centred — and stay there when the parent's
size changes. Nothing in UIDX does that today.

### What Figma actually does

Constraints are a property of the child, and they apply inside a parent that is
**not** an auto-layout frame — or on an auto-layout child that has escaped the
flow with `layoutPositioning: 'ABSOLUTE'`. Two independent axes, five values
each. On a parent resize by Δ: `MIN` holds the left offset, `MAX` holds the
right one (`x += Δ`), `CENTER` holds the distance from the parent's centre
(`x += Δ/2`), `STRETCH` holds both offsets (`w += Δ`), and `SCALE` scales `x`
and `w` by the size ratio. The default is `MIN`/`MIN`. It recurses: a child
that grew re-applies constraints to its own children.

The part that matters here is the storage model. **Figma keeps absolute
`x/y/w/h` and treats the constraint as behaviour applied at the instant of a
resize.** The right-edge offset is never recorded — it is recovered from the
parent's current size, used, and thrown away.

### What the SDK holds (measured, 0.14.0)

`SceneNode` carries `horizontalConstraint` and `verticalConstraint`, and
`ConstraintType` is the five Figma values. They are written and read by
`figma-api/accessors/layout.js` and **consulted by nothing**: the layout pass
honours auto layout and min/max sizing only (`applyMinMaxConstraints` in
`layout/yoga-helpers.js` is about `minWidth`/`maxWidth`, not about pinning).
There is no constraint solver in the engine.

### What this repo already has (measured)

- `constraints={{ horizontal, vertical }}` is a mapped property
  (`prop-table.ts`), splitting to the two scene fields. It round-trips.
- The panel edits it — two selects in `ConstraintsField.vue`, shipped by C8.
- Nothing applies it. The resize gesture computes a new rect for the dragged
  node and commits its `x/y/width/height` plus sizing flips
  (`resize-writes.ts`); descendants never move.

So the vocabulary is here and inert. The decision is not whether to add
constraints — it is what the file is allowed to state about a pinned child.

## Decision

### 1. The offset is authored; the coordinate is derived

Reproducing Figma's storage model would mean that every parent resize rewrites
its children's coordinates into the file. That is derived geometry accumulating
in the file, which is exactly what D4's write-back filter exists to prevent, and
it would make a card resize a diff proportional to its child count.

So the offset is **stated**, not implied, and the coordinate on the pinned axis
becomes something the renderer computes.

### 2. `constraints` declares the pin; four new props state the offsets

`x` and `y` keep their Figma meaning and are already the `MIN` offsets, so
nothing existing moves. Four new props carry the offsets `x`/`y` cannot:

| `horizontal` | authored | derived | rejected |
|---|---|---|---|
| `MIN` (default) | `x`, `width` | — | `right`, `centerX` |
| `MAX` | `right`, `width` | `x` | `x`, `centerX` |
| `STRETCH` | `x`, `right` | `width` | `width`, `centerX` |
| `CENTER` | `centerX` (default `0`), `width` | `x` | `x`, `right` |

`vertical` is the mirror, with `y` / `bottom` / `centerY`. A missing offset
defaults to `0`; a rejected one is a `uidx check` error.

ADR 0002's "the Figma spelling wins" does not bite here: Figma has **no**
spelling for these, because it never stores an offset. CSS does — `inset` names
`left`/`right`/`top`/`bottom` — so CSS supplies the names, which is the other
half of ADR 0002. The asymmetry (`x` and `right`, not `left` and `right`) is
deliberate: two spellings for one number would be worse than an odd-looking
pair.

The four are **authored-only props with no scene field**, the same species as
`STRUCTURAL_PROPS`. They are consumed on the way in and never handed to the
engine, so nothing can echo them back into the file.

### 3. `SCALE` is out of v1

`SCALE` is a ratio, not an offset. Expressing it needs either fractional
geometry or a remembered reference size, and both turn `x`/`width` into a
number-or-string union across the schema, the patcher and the inspector. It
stays in the vocabulary so a future `.fig` import loses nothing, `uidx check`
rejects it with a message pointing at `STRETCH`, and the panel does not offer
it.

**This is a recorded gap, not a closed question.** `SCALE` is one instance of a
larger one: UIDX has no way to state *any* geometry as a proportion of
something else — not a scaled pin, not `width="50%"`, not a ratio-locked box.
All of them need the same thing, fractional geometry, and all of them pay the
same price, so they should be decided together in one story rather than
smuggled in one at a time. Story **H5** in the design carries it.

### 4. Resolution lives in `@uidx/schema`, not in a patch on the engine

The arithmetic is ours because the engine has none. It goes beside
`to-scene.ts`, not into `patches/@open-pencil__core.patch`: ADR 0002 already
names this layer as where engine gaps are absorbed, the existing patch is
sixty-five lines of renderer bug-fix rather than a feature, and a schema pass
also serves `uidx check` and the `.fig` writer, which a layout-pass patch would
not.

### 5. Derivation is per axis, and it is a second question

A pin is per-axis: horizontal `MAX` derives `x` and leaves `y` the author's.
The first draft of this section widened `isDerivedPosition` to take the prop.
Mapping the call sites while planning showed that to be the wrong shape, and
the reason is worth recording.

`isDerivedPosition` asks **"is this node placed by its parent's flow?"** That
question is whole-node and its answer does not change: a pinned child is not
flowed — it is positioned by hand, through an offset instead of a coordinate,
and a gesture may still move it. Widening it would have made a pinned child
look flowed to `useCanvasControls`' `canMove`, which would have refused to
drag the very nodes this ADR exists to make draggable.

So the pin gets its own predicate beside it in `authorship.ts`:

```ts
isPinnedAxis(pin: Pin | undefined, prop: 'x' | 'y' | 'width' | 'height'): boolean
```

— "does the pin compute this number?" The two are asked together where both
matter (`from-scene.ts`'s filter) and separately where only one does.

**The pin is read from the document, never from the scene node.** The offset
props have no scene field by §2, so the scene could not answer; and C7 already
paid for asking a node a gesture had just moved. `from-scene.ts` has the
document node in hand, which is the right source anyway (E4).

The blast radius is therefore one caller, not three: `from-scene.ts`. The
canvas guard and the panel's read-only reason keep their current answers,
because "flowed" is still exactly what they meant.

### 6. The panel speaks CSS's language, everywhere

Added 2026-08-30, from review. The Position section first showed an editable X
beside the authored Right, and the review read that as two conflicting numbers
for one position — because it was: `x` *is* the left offset (§2), so X-and-Right
was one language wearing two names.

The section now shows exactly the edges the pin holds — Left, Right, Top,
Bottom, Center — and the near edges wear CSS's names unconditionally. The
review's follow-up settled the two would-be exceptions: `left`/`top` name a
distance from a containing block, which is what `x`/`y` are against a page
too, and CSS shows `left`/`top` as inert on static-flow items, which is our
read-only row under an auto-layout parent. One language, no X/Y anywhere.

The *file* keeps the `x`/`y` spellings. Labels are the display layer's job,
and ADR 0002's "the Figma spelling wins" governs the authored surface, not
the panel — whose display names already follow their own parity table.

Two behaviours follow. Clicking the widget matches Figma's documented
contract — a plain click is one constraint, Shift adds the second — and a
gesture converts: a settled drag, resize, or cross-parent drop says what it
means in offsets (`pinWrites`, now in the schema beside its inverse), with a
pin stripped when the node lands somewhere no pin is legal, since constraints
belong to the frame you are in.

### 7. Where a pin is legal

Figma's rule: a child of a frame with no `layoutMode`, or an auto-layout child
carrying `layoutPositioning="ABSOLUTE"`. Not on a direct child of `<Page>` —
there is no box to pin to.

## Consequences

**A parent resize is a one-line diff.** The children reflow on screen and
nothing about them is committed. This is the point of the whole decision.

**Instances and slots get this for free.** Because resolution runs at render
time from the file, an `<Instance>` or a filled `<Slot>` rendered at a size its
component never declared lays its pinned children out correctly with no
further work. F3b and F5 inherit it rather than repeating it.

**`.fig` export is close to free.** The scene node the resolve pass hands the
engine carries resolved absolute `x/y/w/h` *and* the two constraint fields —
Figma's own storage model exactly — so `exportFigFile` writes a native
constraint. The work is an assertion, not new code.

**The pass must run wherever layout runs.** `toSceneGraph` and the editor's
`runLayoutForNode` are both layout sites, and a missed one shows a stale child
during a preview. One sanctioned entry point, `layoutWithPins()`, is the
mitigation.

**No migration.** A file with no `constraints` means `MIN`/`MIN`, which is
exactly today's behaviour.

## Not yet measured

Two claims about Figma below are from documentation and recollection, not from
measurement, and each is cheap to check before implementation:

1. Whether a child's constraints resolve against the parent's **frame box** or
   its **padding box**. This ADR assumes the frame box.
2. `SCALE`'s exact rounding. Out of v1, so it only matters if §3 is revisited.

## Measured since

**An absolutely positioned child does not grow a hugging parent** — measured in
the SDK on 2026-08-29, before H1's first task, because `STRETCH` inside a
hugging parent is circular if it does. A `VERTICAL` frame hugging on both axes
around a 40x20 child stayed 40x20 after a 300x200 `ABSOLUTE` child was added to
it. This is the engine's own answer through Yoga's `configureAbsoluteChild`,
which is the answer that governs the resolve pass; Figma's behaviour is assumed
to match and matters only for `.fig` parity (H4).

## Applying this to future decisions

When a value can be *computed* from something the file already states, state
the relationship and compute the value — do not let the tool maintain a
coordinate on the author's behalf. The file is the source of truth (E4), and a
number the tool keeps rewriting is not a fact the author stated.
