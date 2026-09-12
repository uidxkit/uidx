# Pins — a child positioned relative to its parent

2026-08-29. Approved in conversation, section by section. The format decision
it rests on is
[ADR 0011](../../decisions/0011-pins-a-child-states-its-offset.md). Proposed
backlog epic: **H**.

## The problem

A child cannot be positioned relative to its parent. Put an icon 16px from a
card's right edge, widen the card, and the icon stays where it was — because
the file records `x`, the card's width is the only thing that changed, and
nothing connects the two.

The vocabulary for saying otherwise is already here and inert. `constraints`
is a mapped property, the panel has edited it since C8, and the scene graph
stores `horizontalConstraint`/`verticalConstraint` — which its layout pass
never reads. The work is not adding constraints. It is making them mean
something, and deciding what the file states so that a parent resize does not
rewrite its children.

ADR 0011 answers that: **the offset is authored, the coordinate on the pinned
axis is derived.**

## 1. The authored surface

`constraints` is unchanged — Figma's enum, already mapped, already
round-tripping. What changes is that a child's authored numbers are the
offsets from the edges its constraint names, and four new props state the two
`x`/`y` cannot.

```jsx
<Frame name="card" width={320} height={200}>
  <Text  name="title"   x={16} y={16} />
  <Vector name="close"  right={16} y={16}
         constraints={{ horizontal: 'MAX' }} />
  <Frame name="rule"    x={16} right={16} bottom={48}
         constraints={{ horizontal: 'STRETCH', vertical: 'MAX' }} />
  <Text  name="caption" centerX={0} bottom={16}
         constraints={{ horizontal: 'CENTER', vertical: 'MAX' }} />
</Frame>
```

The per-axis legality table, the `MIN`/`MIN` default, the `0` default for a
missing offset, the rejection of `SCALE` and the rule for where a pin is legal
are all ADR 0011 §2, §3 and §6. They are not restated here.

### Where the new props live

`right`, `bottom`, `centerX` and `centerY` are known props with **no scene
field** — the species `STRUCTURAL_PROPS` already models in
`known-props.ts:25`. A new `PIN_PROPS` list beside it, folded into
`KNOWN_PROPS`, keeps them out of `PROP_TABLE` and therefore out of both
`to-scene`'s prop application and `from-scene`'s reverse index. That absence
is load-bearing: a prop with no scene field cannot be echoed back from a
reflow.

`prop-ui.ts` gains entries for the four in the `position` group, so the
inspector can render them, and `constraints` keeps its row.

## 2. Resolution — `resolvePins` in `@uidx/schema`

A new module beside `to-scene.ts`. It walks top-down and, for each pinned
child, against its parent's **resolved** width `W`:

```
MIN      x = x                     w = width
MAX      w = width                 x = W − right − w
STRETCH  x = x                     w = W − x − right
CENTER   w = width                 x = (W − w) / 2 + centerX
```

Vertical is the mirror. Three properties of the walk matter:

**Top-down, with a scoped layout call under any node whose size changed.** A
`STRETCH` child that just got wider must reflow its own auto-layout children,
and its resolved size is what its *own* pinned children resolve against.

**A pinned child does not contribute to a hugging parent's measurement**,
matching Figma's treatment of absolute children (ADR 0011, "Not yet measured"
§2 — verify before building). This is what keeps `STRETCH` inside a hugging
parent from being circular, and it means pins work under a hugging parent
rather than requiring a fixed one.

**Rotation is not involved.** `x/y/width/height` are the unrotated box, which
is the box Figma resolves constraints against.

### Where it is called

Every site that runs layout, or a preview shows a stale child:

- `toSceneGraph` — `layOutEntity`'s `computeAllLayouts` (`to-scene.ts:311`)
  and the per-child calls in `layOutSets` (`to-scene.ts:450`).
- The viewer's edit paths, which reach layout through the editor's
  `updateNode` → `runLayoutForNode` (`CanvasPane.vue`, `applyProp` and the
  gesture commits).

To make "did you remember to re-resolve?" have one answer instead of three,
`@uidx/schema` exports **`layoutWithPins(graph, id)`** — layout then resolve —
and that becomes the sanctioned entry point in this repo. Under
`runPreviewUpdates` its writes are downgraded transitively along with Yoga's
own, so a scrub still emits nothing and release still emits exactly one patch.

## 3. Write-back — a second predicate beside `isDerivedPosition`

Per ADR 0011 §5, the pin does **not** widen `isDerivedPosition`. That predicate
asks "is this node placed by its parent's flow?", and a pinned child is not —
it is positioned by hand through an offset, and a gesture may still move it.
Widening it would make a pinned child look flowed to `canMove` and refuse the
drag.

So `authorship.ts` gains a neighbour:

```ts
export function isPinnedAxis(
  pin: Pin | undefined,
  prop: 'x' | 'y' | 'width' | 'height',
): boolean
```

`x` is pinned under horizontal `MAX`, `STRETCH` or `CENTER`; `width` under
horizontal `STRETCH`; `y` and `height` mirror it. The pin comes from the
**document**, never from the scene node — the offset props have no scene field
to read, and C7 already paid for asking a node a gesture had just moved.

| Caller | What changes |
|---|---|
| `from-scene.ts:98` | asks both; a pinned `x` or `width` produces no patch. **The only caller H1 touches** |
| `useCanvasControls.ts:854` (`canMove`) | untouched — "flowed" is still exactly what it meant |
| `editable.ts:137` | untouched in H1; the panel's pin rows are H2 |

## 4. `pinWrites` — one conversion, three callers

A pure module in `packages/viewer/src`, in the shape `position-writes.ts` and
`resize-writes.ts` already established: a gesture says everything it means.
Given the node's pin, its settled rect and the parent's width, it returns the
props the file should hold and the attributes to remove.

```
MIN      x                        MAX      right   = W − x − w
STRETCH  x, right = W − x − w     CENTER   centerX = x + w/2 − W/2
```

Its three callers are the panel's X/Y fields, the canvas drag, and the pin
widget's conversion. A fourth would be a future `.fig` importer, which needs
exactly this arithmetic to turn absolute geometry plus a constraint into an
offset — one more reason it is a module and not three inlined expressions.

Like `positioningWrites`, it returns removals as well as fields: switching an
axis from `MIN` to `MAX` writes `right` **and** removes `x`, in one envelope,
so the child does not jump and the file never holds both.

## 5. The inspector and the canvas

**X and Y stay editable, always** — Figma's behaviour and the friendlier one.
On a `MAX`-pinned child you can still type an X; the write goes through
`pinWrites` and lands on `right`. Alongside them the Position section shows
the authored offset itself — Right / Bottom / Center X — so the number the
file holds is visible and directly editable rather than only inferable from an
X you typed.

**The two constraint selects become Figma's 9-point widget**, modelled on
`AlignmentMatrix.vue`, which already solves this exact problem: one click, two
props, one envelope, one line-pair in the diff. `ConstraintsField.vue` is
replaced rather than extended.

**Canvas gestures keep their guards and change their writes.** Dragging a
`MAX`-pinned icon writes `right`; dragging the edge of a `STRETCH` divider
writes `x` or `right` and never `width`.

**A parent resize commits only the parent.** Children reflow live during the
drag — that falls out of `layoutWithPins` running on the preview — and the
commit is the parent's own `width`/`height` and nothing else. Resizing a card
with eight pinned children produces a one-line diff.

## 6. Diagnostics

Three new codes, continuing from UIDX133:

| Code | Condition |
|---|---|
| `UIDX134` | the constraint and the geometry disagree — `right` under `MIN`, `x` under `MAX`, `width` under `STRETCH`, and the rest of ADR 0011 §2's "rejected" column. A *missing* offset is not an error; it defaults to `0` |
| `UIDX135` | a pin where none can apply — a child flowed by an auto-layout parent without `layoutPositioning="ABSOLUTE"`, or a direct child of `<Page>` |
| `UIDX136` | `SCALE`, with the message pointing at `STRETCH` |

## 7. Figma parity

Free, or nearly. The scene node handed to the engine carries resolved absolute
`x/y/w/h` and the two constraint fields — Figma's own storage model — so
`exportFigFile` already writes a native constraint. The deliverable is an
assertion in `fig-roundtrip.test.ts`: a pinned child survives the round trip
with its constraint enums intact and its geometry unchanged.

The reverse direction (an importer computing offsets from absolute geometry) is
`pinWrites` inverted, and there is no importer today. Out of scope.

## 8. Testing, in build order

1. `resolvePins` — each constraint on each axis; nested pins; a pin under a
   hugging parent; a `STRETCH` child reflowing its own auto-layout children.
2. `from-scene` emits **nothing** for a derived `x` or `width`. This is the
   regression that matters most — it is D4's whole point, and the failure is
   silent.
3. `pinWrites` as a unit, including the removals.
4. The widget's convert-without-jumping envelope, and a drag on a pinned child.
5. The three diagnostics, positive and negative.
6. The `.fig` assertion, and a pinned example under `check:examples`.
7. A budget assertion — see below.

### The one performance risk, and its test

The pass itself is not a cost. It is a single top-down walk with no cycles and
no iteration to a fixed point: every child resolves against a parent size that
is already final, so it is O(nodes) arithmetic on a Yoga pass that already
runs, inside a scope (`runLayoutForNode`'s subtree plus the ancestors that lay
out children) that is already narrow. The measured baseline it rides on is
2-4ms on a gesture's first frame and 0.4-0.9ms per frame after, recorded in
`CanvasPane.vue`'s `applyProp` header.

**The mistake that would make it expensive is re-running layout for the whole
subtree after each pinned node resolves**, which is quadratic in the child
count. The pass must re-layout only under a node whose size actually changed.
Deep `STRETCH` chains cost one scoped pass per level, which is depth-bounded
and fine; stretched text is the one genuinely expensive case, bounded by the
engine's own measurement cache (`cacheKey = Math.round(constraintW)` in
`layout.js`), so a drag re-measures once per distinct integer width rather
than once per frame.

So H1 ends with a budget assertion: a page of ~50 pinned children including
stretched text, `layoutWithPins` timed, asserted under a frame. This repo
already treats performance as something measured and written down rather than
assumed — the numbers above exist because someone measured them — and the
assertion is what makes a future refactor that reintroduces the quadratic
re-layout fail a test instead of shipping.

## 9. Proposed stories

| Story | What | Size |
|---|---|---|
| **H1** | The format and the resolve pass — `PIN_PROPS`, `resolvePins`, `layoutWithPins`, per-axis `authorship.ts` and its three callers, the three diagnostics. A hand-authored pinned file renders and checks | L |
| **H2** | The inspector — the offset rows, X/Y through `pinWrites`, the 9-point widget replacing `ConstraintsField.vue` | M |
| **H3** | Canvas gestures — drag and resize of a pinned child write offsets; a parent resize commits only the parent | M |
| **H4** | Figma parity — the `.fig` round-trip assertion and the pinned example | S |
| **H5** | Fractional geometry — the one story that unblocks `SCALE`, `width="50%"` and ratio-locked boxes together | M, later |

H1 carries the risk and everything else depends on it. H2 and H3 are
independent of each other. H5 is deliberately not in this epic's critical
path — see below.

### H5 — the known gap

`SCALE` is out of v1 (ADR 0011 §3), and it is not the only casualty. UIDX
cannot state any geometry as a proportion of something else: not a scaled pin,
not `width="50%"`, not a box that keeps its aspect ratio. Every one of them
needs fractional geometry, and every one of them pays the same price — `x`,
`y`, `width` and `height` becoming number-or-string through the schema, the
patcher, the inspector's number fields and the scrub gestures.

Paying that price once, deliberately, for all of them is a story. Paying it
three times, incidentally, is how a format acquires two ways to say everything.
So `SCALE` waits for H5 rather than being special-cased into H1, and `UIDX136`
exists so that a file asking for it gets a real answer instead of silence.

## Risks

**A missed layout site.** Mitigated by `layoutWithPins` being the only
sanctioned entry point; worth an eslint `no-restricted-imports` rule on
`computeAllLayouts` outside `@uidx/schema` if it slips once.

**The pin has to reach `from-scene.ts` from the document**, not from the scene
node, and the pin index that makes that cheap has to stay current across a
reconcile. It rides the same path as the address bimap (`MutableAddressMap`),
which is the precedent — but a stale pin index is a silently wrong filter, so
it wants its own test.

**Three unmeasured Figma claims**, listed in ADR 0011's "Not yet measured".
The hug-measurement one carries real weight and should be settled first — a
half-hour in Figma, before H1 starts.
