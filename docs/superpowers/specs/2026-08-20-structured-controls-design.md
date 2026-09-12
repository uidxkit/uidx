# Structured controls — fills, strokes, effects, constraints, dashes

2026-08-20. Follows the C6 inspector work; approved in conversation the same
day. Backlog story: **C8**.

## The problem

C6 gave every scalar prop a real control and left five props read-only with a
reason attached: `fills`, `strokes`, `effects`, `constraints`, `dashPattern`.
The reason was principled — an editor that writes a malformed paint is worse
than a read-only row — but the effect is that the most-touched visual
decision in any design, colour, is the one thing the inspector cannot touch.
The field report that closed C6 said it plainly: some properties have no
controller.

This story gives those five real controls, Figma's own, in the dark theme the
viewer already has. Two stay read-only permanently and are named at the end.

## What makes this safe now

Every one of these props is **one attribute carrying one JSON value**. The
editors never construct patches of their own: they edit a copy of the value
and commit the whole thing through the same `set`/`add` path every scalar
control already uses. Malformed-paint risk is confined to a pure module with
exhaustive tests, and the patch-burst batching from the C6 field-report fix
already guarantees a gesture's writes travel as one atomic envelope.

## Scope

| Prop | Control | Depth |
|---|---|---|
| `fills`, `strokes` | Figma's paint stack | Solid paints fully editable: swatch → colour-picker popover, hex field, alpha, visibility eye, remove, `+` to add. Gradient and image paints render as labelled read-only rows in the stack |
| `effects` | Figma's effects list | Per effect: type select (`DROP_SHADOW`, `INNER_SHADOW`, `LAYER_BLUR`, `BACKGROUND_BLUR`, `FOREGROUND_BLUR`), X/Y offset, blur radius, spread, colour swatch, eye, remove, `+` |
| `constraints` | Two selects | Horizontal and vertical anchors, domain `MIN / CENTER / MAX / STRETCH / SCALE` — read from the scene graph's `ConstraintType`, not from memory |
| `dashPattern` | Dash field | Comma-separated numbers ⇄ the array, Figma's own affordance |
| `vectorPaths`, `arcData` | **stay read-only** | Figma itself has no panel editor for path data — that is canvas vector mode, a different epic. The read-only reason text stays |

**Empty states pull one slice of C7 forward, for these three props only:**
`fills`, `strokes` and `effects` sections render on applicable elements even
when the file never declared the prop, with Figma's `+`; clicking it emits an
`add` carrying the first paint or effect. Everything else about unset
properties remains C7's.

## Vocabulary — `prop-ui.ts`

`control: 'opaque'` retires for the five and becomes real kinds:

- `fills`, `strokes` → `'paint'`
- `effects` → `'effects'`
- `constraints` → `'constraints'`
- `dashPattern` → `'dashes'`

`vectorPaths` and `arcData` keep `'opaque'`. The drift tests in
`prop-ui.test.ts` are untouched — the table's keys do not change, only what
some entries say.

## Pure layer — `paint-edit.ts`

A new pure module in `packages/viewer/src`, the working agreement's home for
judgement. Every function takes the current value and returns the next whole
value; nothing here knows about Vue, patches or the canvas.

- `setPaintColor(paints, index, color)` / `setPaintOpacity(paints, index, o)`
- `addSolidPaint(paints | undefined)` — also the `+`'s first-paint shape
- `removePaint(paints, index)`, `togglePaintVisible(paints, index)`
- `setEffectField(effects, index, field, value)` — offset, radius, spread, colour
- `addEffect(effects | undefined, type)`, `removeEffect`, `toggleEffectVisible`
- `parseDashPattern(text)` / `formatDashPattern(value)` — a parse failure
  returns `null` and the field refuses, red, the way rename refusal works
- Colour conversion: file colours are `{ r, g, b, a }` floats 0–1; hex and
  the picker's colour type convert at this layer's edge, in one place

The virtual unset field lives beside it: `editable.ts` gains the rule that
`fills`/`strokes`/`effects` on an applicable element always yield a field —
carrying `value: null` and `authored: false` — so `sectionsFor` places the
section and the component renders the `+`. An unauthored field's first write
is an `add`; every later write is a `set`. `PropertiesPane.vue` already knows
which is which from the document.

## Components

- **`PaintStackField.vue`** — one row per paint. Solid rows: `FillSwatch`
  inside a `ColorPickerRoot` popover (hex via `ColorInputRoot`, alpha via
  `ChannelSlider`), visibility eye, remove ×. Non-solid rows: swatch, a label
  (`Linear gradient`, `Image`), eye and × still work — visibility and removal
  are type-agnostic. `+` appends `addSolidPaint`.
- **`EffectListField.vue`** — one row per effect, expanded Figma-style:
  type select on the row, then X / Y / Blur / Spread as compact prefixed
  number boxes (the C6 paired-box look), colour swatch with the same popover,
  eye, ×.
- **`ConstraintsField.vue`** — two labelled selects, one row.
- **`DashPatternField.vue`** — one text input, parse-on-commit, refuses
  invalid input without writing.
- **`PropertyField.vue`** — four new `v-else-if` branches dispatching to the
  above; existing branches untouched. All styling from `theme.css` tokens; no
  component may contain a raw colour.

## Write discipline

C4's rule, unchanged: continuous gestures preview, discrete acts commit.

- Dragging inside the colour picker emits `preview` per movement — the canvas
  repaints, nothing is written. Closing the popover (or committing the hex
  field) emits **one** `commit` carrying the whole new value.
- Eye toggles, add, remove, select changes, dash-field commits: immediate
  single commits.
- Every commit is the entire prop value. One gesture, one patch, one line in
  the diff — the same sentence C1 shipped under.

## Out of scope

- Gradient and image paint *editing* — the rows render read-only.
- Reordering paints or effects — Figma drags them; ours append and remove.
- `strokesIncludedInLayout`, per-side stroke weights — already scalar, done.
- Everything else C7 owns: unset scalars, `fallback` display, the D4
  `authored` signal.

## How this gets verified

The split that worked for C5 and C6: `paint-edit.ts` and the virtual-field
rule are pure-tested exhaustively (including hostile input — a paint missing
`color`, a dash string of garbage). Component tests assert the **commit
payload shapes**: toggling paint 0's eye emits `set fills` with `visible:
false` and every other field byte-identical; `+` on a bare rectangle emits
`add fills` with exactly one solid paint. The rendering itself is verified by
hand in the running viewer (spike S1 still holds), including one
round-trip check that an edited fill re-parses to the value the panel shows.

**Done when:** a fill's colour can be changed from the panel and lands as a
one-line diff of the `fills` attribute; a bare rectangle gains its first fill
from the `+`; an effect's blur scrubs live and commits once; constraints and
dashes write through their controls; and `vectorPaths` still says why it
does not.
