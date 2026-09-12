# Spec — the properties panel as a real inspector

**Status: awaiting approval.** Nothing here is built. Decisions in
[Settled decisions](#settled-decisions) were agreed on 2026-08-17; the two
stories below are what implementation would follow.

## Why this exists

Story C5 shipped a working properties panel: controls are gated on the prop
table, a bound value shows as its token, edits round-trip, and the Phase 3 exit
criterion was demonstrated on the running app. But the story also said *"built
from the SDK's headless primitives (`NumberFieldRoot`, `FillRoot`,
`PropertySectionRoot`, `LayoutControlsRoot`)"*, and only `NumberFieldRoot` was
used. What shipped is a flat list of `label: control` rows derived from whatever
attributes the file happens to declare.

Three gaps follow, and only the first is cosmetic.

1. **No structure.** Twelve unsorted rows where Figma shows Position, Auto
   layout, Appearance, Typography. An inspector is scanned by section; a flat
   list has to be read.
2. **You can only edit what is already written.** A node with no `cornerRadius`
   attribute offers no way to set one. The panel can *change* a design but not
   *develop* one — "add a corner radius" is an operation available only by
   editing the file by hand.
3. **An explicit edit can be silently dropped.** D4 discards `width` on a node
   that hugs its content, because that value is normally computed. Right for a
   reflow burst, wrong for a designer typing a number — and typing a number is
   exactly what closing gap 2 unlocks. C5's own story says the author must
   "never make an edit that silently fails to persist".

## What "like Figma" decomposes into

| | Figma / Open Pencil | Today | Wanted |
|---|---|---|---|
| Grouping | Collapsible sections | Flat list | `PropertySectionRoot` |
| Unset properties | Always shown | Hidden | Shown, marked unset |
| Paired fields | X/Y and W/H on a row | One per row | `PropertyGridRoot`, 2 columns |
| Enums | Segmented control or select | Free-text input | `SegmentedControlRoot` / select |
| Applicability | Text props only on text | Whatever is authored | Driven by element type |
| Colour | Swatch → picker | Read-only text | Deferred — see [Out of scope](#out-of-scope) |

## The core problem: the prop table does not know enough

The panel is meant to be *generated from* `PROP_TABLE`. It cannot be, because the
table carries only a name and a scene-field mapping. It knows nothing about which
**group** a property belongs to, which **elements** it applies to, what **values**
are legal, or what **range and granularity** a number has.

Today the control kind is guessed from the authored value's runtime type. That is
why `layoutMode` gets a free-text box — a field where typing `HORIZONTALL`
produces a file that passes `uidx check` and renders wrong.

**The metadata goes in `@uidx/schema`, not the viewer.** A second list of
property names in `@uidx/viewer` would drift from the schema package the first
time a property is added, and the drift would be silent: the panel would simply
stop offering something. The vocabulary already has one home — `prop-table.ts`
and `docs/property-vocabulary.md` — and this belongs beside it.

```ts
// packages/schema/src/prop-ui.ts
export type PropGroup =
  | 'position' | 'layout' | 'layout-child'
  | 'appearance' | 'fill' | 'stroke' | 'text' | 'effects'

export interface PropUi {
  group: PropGroup
  /** Elements this applies to. Omitted means every scene element. */
  appliesTo?: readonly SceneElement[]
  control: 'number' | 'boolean' | 'enum' | 'text' | 'opaque'
  /** Legal values, for `enum`. */
  options?: readonly string[]
  min?: number
  max?: number
  /** Scrub and arrow-key granularity. */
  step?: number
  /** Renders on one row with this sibling — x/y, width/height. */
  pairs?: string
  /** What the engine falls back to, shown on an unset row. */
  fallback?: JsonValue
}
```

Two drift tests. One asserts every `PropUi` key exists in `IDENTITY_PROPS` or
`PROP_TABLE`. The other runs the direction that actually rots: every mapped prop
must have a `PropUi` entry **or an explicit opt-out**, so adding a property to
the vocabulary without deciding where it belongs fails the build rather than
quietly vanishing from the panel. `known-props.test.ts` already pins the table to
the scene vocabulary; this is the same idea one layer up.

### Enum domains

Taken from `@open-pencil/scene-graph`'s own type aliases, not from memory.

| Prop | Values | Source |
|---|---|---|
| `layoutMode` | `NONE` `HORIZONTAL` `VERTICAL` `GRID` | `LayoutMode` |
| `layoutWrap` | `NO_WRAP` `WRAP` | `LayoutWrap` |
| `layoutPositioning` | `AUTO` `ABSOLUTE` | `SceneNode.layoutPositioning` |
| `primaryAxisAlignItems` | `MIN` `CENTER` `MAX` `SPACE_BETWEEN` | `LayoutAlign` |
| `counterAxisAlignItems` | `MIN` `CENTER` `MAX` `STRETCH` `BASELINE` | `LayoutCounterAlign` |
| `primaryAxisSizingMode` | `FIXED` `AUTO` | UIDX spelling of `LayoutSizing` |
| `counterAxisSizingMode` | `FIXED` `AUTO` | as above |
| `strokeAlign` | `INSIDE` `CENTER` `OUTSIDE` | `Stroke.align` |
| `textAutoResize` | `NONE` `HEIGHT` `WIDTH_AND_HEIGHT` `TRUNCATE` | `TextAutoResize` |
| `textAlignVertical` | `TOP` `CENTER` `BOTTOM` | `TextAlignVertical` |
| `textDirection` | `AUTO` `LTR` `RTL` | `TextDirection` |
| `textCase` | `ORIGINAL` `UPPER` `LOWER` `TITLE` | `TextCase` |
| `textDecoration` | `NONE` `UNDERLINE` `STRIKETHROUGH` | `TextDecoration` |
| `blendMode` | 17 values | `BlendMode` |
| `maskType` | `ALPHA` `VECTOR` `LUMINANCE` | `MaskType` |
| `fontWeight` | `THIN` … `BLACK` | `FONT_WEIGHTS` in `prop-table.ts` |
| `textAlignHorizontal` | `LEFT` `CENTER` `RIGHT` `JUSTIFIED` | Figma; **verify against the engine before use** |

**`LayoutSizing` is `FIXED | HUG | FILL`, but UIDX writes `AUTO | FIXED`.**
ADR 0002 chose Figma's spelling and A2 flagged that `FILL` has no UIDX
expression. The panel must not offer `FILL` until the format can write it. That
is a format decision and a separate story, not something the panel resolves.

### Sections and order

*Superseded by [panel-figma-parity.md](panel-figma-parity.md) §2, which moved
the dimensions into Layout, dissolved "Layout child" into it, and put Text
first on a `<Text>`. What that spec left standing:* a section with no
applicable property for the selected element is not rendered at all, and the
order is Figma's rather than the table's.

## Settled decisions

### Unset properties are shown, dimmed, and writing one is deliberate

The tension is real. UIDX's premise is a minimal, review-friendly diff; Figma has
no file to keep clean. Showing every applicable property invites writing
attributes that were fine as defaults, and a `<Frame>` carrying twenty explicit
properties nobody chose is worse than one carrying four.

The resolution mirrors the one already taken for token detaching: **show it, make
writing it a deliberate act.** An unset row renders dimmed with the default it
currently resolves to, and nothing reaches the file until the author changes it.
A change to an unset property becomes an `add` patch — which the patcher already
supports and `fromSceneChange` already emits.

### An explicit edit bypasses D4's derived-geometry filter

D4 asks "did a human author this?" and answers with a heuristic: geometry on a
node whose parent lays it out, or whose own axis hugs, was computed. The
heuristic exists because a reflow burst carries no authorship information.

A panel edit does carry it, so `fromSceneChange` gains an explicit signal:

```ts
fromSceneChange(sceneId, changes, ctx, { authored: new Set(['width']) })
```

Without this, typing a width into a hugging frame is silently discarded — the
precise failure C5's story exists to prevent. **It also mirrors Figma:** setting
an explicit size on a hugging axis flips that axis to `FIXED`, which is what the
SDK does internally (`layout/apply.js` flips `HUG` → `FIXED` when a node is
sized). One gesture, two patches, and a diff that reads as what the designer did.

This is only reachable once unset geometry can be set, so it belongs to C7.

## C6 — an inspector with structure

**No change to what gets written.** Every property the panel offers today it
still offers; it is grouped, paired and given real controls. That makes this
independently shippable and independently reviewable.

- `prop-ui.ts` in `@uidx/schema` with grouping, applicability, control kind, enum
  domains, ranges and pairing, plus both drift tests
- Sections via `PropertySectionRoot` / `PropertySectionHeader` /
  `PropertySectionContent`, collapsible, open state remembered per section
- Paired rows via `PropertyGridRoot` (X/Y, W/H)
- `SegmentedControlRoot` for short enums (alignment, sizing, wrap); a select for
  long ones (`blendMode`, `fontWeight`)
- Applicability by element: a `<Text>` shows the Text section, a `<Rectangle>` does not
- `editable.ts` reads its control kind from `prop-ui` instead of guessing from
  the runtime type of the authored value

**Done when:** selecting a `<Text>` and a `<Frame>` shows different sections;
`layoutMode` is a control with exactly four options and no way to type a fifth;
X and Y sit on one row; collapsing a section survives re-selecting the node; and
the file written by any edit is byte-identical to what C5 would have written.

## C7 — unset properties

- Every applicable property renders, dimmed when unset, showing its `fallback`
- Changing an unset property emits an `add` patch
- `fromSceneChange` accepts `authored`, and skips the derived check for it
- Setting a size on a hugging axis also writes `FIXED` for that axis
- A row that is set can be cleared back to unset, emitting `remove`

**Done when:** setting `cornerRadius` on a frame that never declared one adds
exactly one attribute and one line to the diff; typing a width into a hugging
frame persists *and* flips the sizing mode, in one review-legible change; and
clearing a property removes its attribute rather than writing a default.

## Out of scope

Each is a story of its own, named here so it is deferred rather than forgotten.

- **Paint and colour editing.** `FillRoot`, `FillSwatch` and `ColorPickerRoot`
  exist and a solid fill's colour is the most-wanted control — but a paint is an
  array of objects with gradients, images and per-paint opacity, and an editor
  that writes a malformed paint is worse than a read-only row.
- **Multi-select.** Needs a mixed-value model; `NumberFieldRoot` has one and
  nothing else here does. Selecting several nodes continues to show no editor
  rather than silently editing the first.
- **`FILL` sizing** — blocked on a format story, per ADR 0002 and A2.
- **Effects editing.**
- **Renaming from the panel** — it moves every address beneath it, so it is a
  structural op and belongs with Epic D.

## How this gets verified

The rendering path still cannot be tested headlessly (spike S1), so the split is
the one that worked for C5: put the judgement in pure modules and test those
properly, keep the `.vue` thin, and drive the real app for the rest.

- **Unit** (`@uidx/schema`) — applicability per element; section membership and
  order; enum domains matching the engine's own type aliases; both drift tests
- **Unit** (`@uidx/schema`) — `fromSceneChange` honours `authored`; an explicit
  width on a hugging frame survives and flips the sizing mode *(C7)*
- **Component** (`@vue/test-utils`, no canvas) — sections render, collapse and
  remember; an enum renders with exactly its legal options; a `<Rectangle>` shows
  no Text section; an unset row is marked and emits nothing until changed,
  then emits a commit *(C7)*
- **Live** — in the running app: confirm a `<Text>` and a `<Frame>` show
  different sections; scrub a paired field and confirm one write; set a property
  that was not in the file and confirm the diff is one added attribute *(C7)*

## Effect on the plan

Not a Phase 3 regression — C5's acceptance criteria were met and the exit
criterion was demonstrated. These are two new stories in Phase 3 that supersede
C5's "headless primitives" bullet and close both deferrals C5 recorded (enums,
and the panel being limited to authored props).

They sit before Epic D, because D1's creation toolbar will want the same section
machinery for a node that has just been drawn and declares almost nothing —
which is exactly the unset-property case.

Sizing: **C6 — M**, mostly the prop-ui table; the Vue work is mechanical once it
exists. **C7 — M**, mostly the authorship path through `fromSceneChange`.
