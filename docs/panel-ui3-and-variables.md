# Spec — Figma parity, third pass: the UI3 look, the assignment popup, and variables in the panel

**Status: ✅ built and live-verified 2026-08-24**, in the three stages §8
names. Deviations found while building are recorded in §10. This spec continues
[panel-figma-parity.md](panel-figma-parity.md) (shipped): that pass aligned
sections, naming and property assignment with Figma; this one aligns what the
panel *looks like* and pulls the deferred variable (token) UI into it. The
reference is a set of UI3 screenshots supplied 2026-08-23 — a Text layer's
panel, a Frame's panel, the property-assignment popup, and the color-variable
picker — read against the current panel side by side.

Three user decisions fixed the scope before design:

1. **Full token parity.** The assignment popup lists matching-type variables
   for every bindable field, and Fill/Stroke get the color-variable picker.
2. **Label-above layout.** Rows restructure to UI3's captions-over-controls,
   not the current label-left grid.
3. **Functional icons only.** Section headers render only icons with a real
   behavior behind them, drawn Figma's way. No dead placeholders.
4. **Pick + search only.** No variable creation and no library filter in the
   popup; variables are authored in token documents.

## 1. What "similar" decomposes into

| Screenshot fact | Today | Wanted |
|---|---|---|
| Labels are captions above controls | label left, control right | stacked: caption row, then a 2-col control row |
| Sections divided by full-width 1px lines, ~16px padding | boxed sections, 8px rhythm | separator + padding per UI3 |
| Section title row carries right-aligned icons | title + chevron + eye only | title left; functional icon cluster right |
| Linked input = full-width purple pill + two trailing icon buttons | pill + apply glyph + unlink inside the row | pill fills the row; ◎ (edit property) and unlink sit after it |
| Apply popup: search, property group with value previews, variable groups by collection | flat property menu | `AssignPopup.vue`, §3 |
| A number bound to a variable renders as a name pill in the box | `{radius#md} = 8 [detach]` text row | token pill, resolved value as tooltip, detach on hover |
| A fill bound to a color variable shows swatch + name | impossible (aliases are attribute-level) | paint-level aliases, §4 |
| Color picker has a Libraries view listing color variables | `ColorPickerDialog` is custom-only | Custom \| Libraries tabs |

## 2. Stage 1 — the UI3 look

Pure presentation: `theme.css`, `PropertiesPane.vue`, `PropertyField.vue`,
`PropertyLink.vue`, and the structured field components. No patch shape
changes, no new behavior. Every color stays a `theme.css` token — the file's
own rule.

### Layout

- **A field is a stack**: a caption line (`--text-dim`, `--ui-size`, ~4px
  below-gap), then its control(s). Paired fields (X|Y, W|H, Opacity|Corner
  radius, Line height|Letter spacing) share one caption row with two captions
  and one control row with two boxes — exactly the screenshots' geometry.
- The `.field` grid (label-col | value | controls) dissolves. Sections become
  a single-column flow of stacked field blocks; the 2-column split lives
  inside a block, `gap: 8px` between columns, `~10px` between blocks.
- Checkbox rows (Clip content) keep label beside the box — UI3 does too.
- Structured fields (paints, effects, constraints, padding) keep their own
  internal layouts, re-spaced to the same rhythm.

### Rhythm and chrome (`theme.css`)

- Section padding 16px horizontal, 12px vertical; sections separated by a
  full-width `1px solid var(--line)` rule, no rounded section boxes.
- Inputs: `--raised` fill, `--radius-lg: 5px`, height 28px (`--field-h`),
  border transparent → `--line` on hover → `--accent` focused. The current
  values are close; the deltas are radius, height and padding.
- Icon buttons in headers and rows: 24×24 hit target, 12px glyph,
  `--text-dim` at rest, `--raised` pill on hover.
- The rail width stays at `--rail-w: 240px` — UI3 sits at roughly this
  density — so the layout change is padding and stacking, not pane geometry.

### Section headers

Title left (white, 600). Right-aligned cluster, per section, functional only:

| Section | Icons (right to left order as drawn) |
|---|---|
| Text | apply-property glyph (the TEXT anchor — already on the header from the last pass, restyled) |
| Position | none (Figma's focus icon maps to nothing here) |
| Appearance | eye (built) · apply-property glyph (the BOOLEAN anchor, built — restyled into the cluster) |
| Fill / Stroke | variables-grid (opens the Libraries picker for the first solid paint) · + (add paint, exists in the stack header today — consolidated here) |
| Effects | + (add effect) |

**Number fields get Figma's own affordance, not a header glyph**: a
variables-grid glyph at the input's right edge, revealed on row hover,
opening the popup targeted at that field. Hover-reveal is right here where
it was wrong for the three property anchors (last spec §9): the anchors are
three rare hints, while every number input is variable-bindable — always-on
glyphs on X, Y, W, H, rotation, opacity, radius, gaps and paddings would be
a wall of clutter, and Figma's visibility is exactly what was asked for.

### The linked row

- The pill fills the row's whole width (already true), keeps type glyph +
  name.
- After it: **◎ "edit property"** — opens the existing `PropertyDialog` on
  that property (rename / default, F6's machinery) — and **unlink**. Both
  outside the pill, right-aligned, icon buttons.
- **Clicking the pill opens the assignment popup** (switch), replacing the
  separate apply glyph on linked rows. Unlinked property-anchor inputs keep
  the last pass's rule: the dimmed-at-rest glyph on the section header, no
  glyph on the row.
- Token-bound rows get the same anatomy with the token pill (§4) and detach
  in the unlink slot; ◎ does not render (there is no property to edit).

## 3. Stage 2 — the assignment popup

One new component, `AssignPopup.vue`, replacing the menu half of
`PropertyLink.vue` (the pill and buttons stay). Every surface that binds —
field apply glyphs, section-header glyphs, pill clicks, and stage 3's
Libraries tab rows — opens this popup, so the gesture is one control
everywhere, which is the same argument that extracted `PropertyLink` in the
last pass.

### Anatomy, top to bottom

1. **Search field** — autofocused, magnifier glyph, × clears. Filters both
   groups by substring on the name, case-insensitive. Esc closes (clears
   first if non-empty, Figma's order).
2. **"Properties in \<Component\>"** — the enclosing component's same-type
   properties (exactly `bindCandidates`' answer today). Each row: purple type
   glyph, name (ellipsized), right-aligned `--text-faint` value preview — the
   declaration's default, truncated. Current binding highlighted. The group
   renders only inside a component (`candidates !== null`), and keeps
   **Create property…** at its tail.
3. **"Variables"** — one sub-heading per collection (collection name in
   `--text-faint` caps-ish caption style), rows beneath: type glyph (`#` for
   FLOAT, `T` for STRING, the boolean glyph, a swatch for COLOR), variable
   name, right-aligned resolved value (number as-is, string truncated, color
   as hex). Variables come from every loaded token document — ADR 0004 makes
   the namespace global, so the heading is "Variables", not Figma's
   "Variables from this file".

### Typing rule

The popup never offers what the input cannot take:

| Input | Properties offered | Variables offered |
|---|---|---|
| number fields | — (no number property type) | FLOAT |
| Content | TEXT | STRING |
| the Appearance eye (`visible`) | BOOLEAN | BOOLEAN |
| instance swap row | INSTANCE_SWAP | none |
| a solid paint's color | — | COLOR |

`variableTypeOf` already answers the variable side; `propertyTypeForField`
the property side. A field with neither renders no apply affordance at all —
unchanged.

### Choosing

- A property row → the existing `bindProperty` / rebind flow, unchanged
  envelope.
- A variable row → commit `"{collection#variable}"` as the attribute value
  through the normal commit path (attribute-level aliases already render,
  resolve and patch today), or as the paint's `color` (stage 3).
- Unlink/detach stays outside the popup, on the row — Figma's placement.

### Placement

Anchored below its opener and right-aligned to the pane's content edge, the
popup spans the pane's content width. `--panel` surface, `--radius-lg`,
`--shadow` (`z-index` above the dialogs' scrim is not needed — it never
coexists with one). One open popup at a time; opening another closes the
first; outside click closes.

## 4. Stage 3 — variables end to end

### Paint-level aliases (`@uidx/schema`)

`fills` / `strokes` accept an alias string in a paint's `color`:

```
fills={[{ type: 'SOLID', color: "{palette#blue-500}" }]}
```

- `scenePropFor` resolves aliases *inside* paint objects (fills, strokes, and
  effect colors share the treatment) before `normalizeFills` /
  `composeStrokes` map them. An unresolved paint alias warns with the same
  wording as an attribute alias and drops that paint, not the node's whole
  attribute — the renderer draws what it can.
- `uidx check` reports unresolved paint aliases through the same warnings
  channel (it already surfaces `scenePropFor` warnings; the new resolution
  path feeds it, so this is coverage to assert, not code to add).
- `from-scene` / reconcile must not clobber a paint alias when an unrelated
  sibling attribute changes — the same authorship rule attribute-level
  bindings already obey; a drift test pins it.

### Token pills in the panel

- A bound number/text row renders a **token pill**: `--raised` fill, `#` (or
  `T`) glyph, token name (`collection#name` shortened to the variable name,
  full address in the tooltip beside the resolved value). Detach is the
  trailing icon button; clicking the pill opens the popup to switch. Typing
  is unavailable while bound — Figma's rule; detach first.
- The purple property pill and the grey token pill are deliberately
  different colors and the same shape — the two kinds of binding read alike
  as *bindings* and differently as *kinds*, which is Figma's own scheme.

### The color-variable picker

- `PaintStackField`: a solid paint whose `color` is an alias renders resolved
  swatch + variable name (like `color/shadcn/bg-card` in the reference) in
  place of the hex; its row's detach affordance writes the resolved literal
  back.
- `ColorPickerDialog` gains **Custom | Libraries** tabs. Custom is today's
  picker, unchanged. Libraries lists COLOR variables grouped by collection —
  swatch, name, current one highlighted, search on top — and picking writes
  the alias into that paint's `color`. It shares the row rendering with
  `AssignPopup`'s variable rows (one sub-component, two hosts).
- The tokens map (`App.vue`'s `resolveTokenValues` output, `JsonValue`-typed)
  plumbs down to `PaintStackField` / `ColorPickerDialog`; the pane's
  number-typed `resolvedValue` stays as-is for scrubbing.

## 5. New glyphs

Added to `field-icons.ts` in the existing 12×12 stroke style: `search`,
`close` (×), `plus`, `variable` (the `#` in a rounded box), and
`variables-grid` (Figma's four-dots apply-variable glyph). The Libraries tab
is a text tab, no icon. The existing `apply-property` concentric-circles
glyph doubles as ◎ edit-property, matching the reference.

## 6. Out of scope, named

- **Creating variables from the popup** (the `+`) and the **All libraries
  filter** — user decision; variables are authored in token files.
- **Text styles** (the `Ag` popup) — no style entity exists in the format.
- **Variable modes** (the half-moon) — collections are single-mode.
- **Gradient/image paint variables** — solid `color` only, matching what
  `Stroke` can draw anyway.
- **Number-field property binding** — there is still no FLOAT property type;
  the popup's property group is empty for numbers, so only variables show.
- **Selection colors, Export, Layout guide** — sections whose features the
  vocabulary defers; unchanged from the last spec's §10.

## 7. Known deviations from Figma, accepted

- Headings say "Variables", not "Variables from this file" — the namespace
  is global (ADR 0004), and claiming file-scope would be false.
- The Typography header carries no variables-grid: Figma's opens a style
  picker, and no style entity exists. Number fields' own hover glyphs (§2)
  carry the binding ability there.
- The three property anchors keep dimmed-at-rest glyphs on their section
  headers (last spec's §9 finding — invisible-until-hover hid the feature);
  only the per-number-field variable glyphs are hover-revealed, Figma's way.
- Field labels stay always-visible (standing decision: matches
  Figma-with-labels-on).

## 8. Implementation shape

| Piece | Where | What |
|---|---|---|
| Rhythm + chrome | `theme.css` | radius/height/padding/section tokens per §2 |
| Label-above layout | `PropertiesPane.vue`, `PropertyField.vue` | field blocks, paired captions, separators, header clusters |
| Pill row anatomy | `PropertyLink.vue` | pill click → popup; ◎ edit; menu removed |
| The popup | `AssignPopup.vue` (new) + a `VariableRow` sub-component | §3 anatomy; owns search + grouping; document knowledge stays in callers |
| Variable candidates | `component-prop-edits.ts` or a new `variable-candidates.ts` | `(tokens, type) → rows` with resolved previews |
| Paint aliases | `packages/schema/src/to-scene.ts` (+ tests) | resolve aliases inside paints/effect colors; warning parity |
| Authorship drift test | `packages/schema` | sibling edit preserves a paint alias |
| Token pills | `PropertyField.vue` | replace the `= value [detach]` row |
| Color picker tabs | `ColorPickerDialog.vue`, `PaintStackField.vue` | Custom \| Libraries; alias-aware swatch rows |
| Tokens plumbing | `App.vue` → `PropertiesPane.vue` → paint fields | pass the `JsonValue` tokens map down |

Order of work, each independently shippable:

1. **The UI3 look** — layout + chrome, no behavior. Biggest visible win,
   establishes the geometry the popup anchors into.
2. **The popup** — replaces the property menu, adds variables for the
   attribute-level cases the format already supports (numbers, Content,
   visible).
3. **Variables in paints** — schema aliases, token pills in the paint stack,
   the Libraries picker.

## 9. Verification

- **Unit** (`@uidx/schema`) — paint-alias resolution (resolves, warns
  unresolved, drops only the paint); authorship preservation on sibling
  edits; popup candidate filtering by type (FLOAT to numbers, STRING to
  Content, BOOLEAN to visible, COLOR to paints, none to instance swap).
- **Component** (`@vue/test-utils`) — the popup searches, groups by
  collection, previews values, highlights the current binding, and commits
  the right alias string / `bindProperty` envelope; a token-bound number
  renders the pill and detaches to the resolved literal; the Libraries tab
  lists color variables and writes a paint alias; every emitted patch still
  keys on the authored name.
- **Live** — against `examples/` on a scratch copy (standing rule): bind
  `cornerRadius` to `radius#md` from the popup, a fill to `palette#blue-500`
  from Libraries, Content to a STRING variable; confirm the file diffs read
  as the alias strings and the canvas redraws; a Figma-side-by-side eyeball
  of the restyled panel against the reference screenshots, checking the
  §1 table line by line.

## 10. What changed while building it

- **Paint-alias writes route as patches, not commits.** §4 wired the Libraries
  pick through the paint stack's ordinary commit, and the commit route goes
  through the scene graph — which resolves aliases (§4's own schema change), so
  the file received the resolved literal, or nothing when the colors matched.
  Live verification caught it; component tests could not, because they assert
  the pane's emits and the loss happened downstream in `fromSceneChange`. A
  fills/strokes commit that carries a paint alias — or lands on an attr that
  does — now emits a structural patch, the same rule `bindVariable` states for
  attribute-level aliases. Effects stay on the scene route: `asEffects` rejects
  string colors, so no effects write can carry one.
- **The popup's own trigger is passed explicitly where pairs share ancestors.**
  §3's outside-click rule exempted "the opener"; the first implementation
  exempted *any* opener, which left two popups open at once, and the corrected
  ancestor-climb was still wrong for the number glyphs inside X|Y pairs (both
  halves share the climbed ancestor). `AssignPopup` takes an optional `trigger`
  element; the number fields pass theirs, the single-trigger surfaces keep the
  climb.
- **The eye stills for a variable-driven `visible` too.** §2 said only that the
  pill trails the section; the property-era guard tested `boundTo` for a bare
  name and would have left the eye live — one click silently detaching the
  variable — while suppressing the row that showed it. Any binding stills the
  eye now, and the row stays while bound.
- **`layoutPositioning` shows no caption.** Label-above layout made the X/Y
  pair's "Position" caption and the row's own "Position" label read as a stutter;
  Figma shows the Auto/Absolute control uncaptioned, so the visible label went
  (the aria-label stays).
- **`editProperty` wants the component's address**, and §2's ◎ flow first
  passed the field's — the climb through `enclosingComponent` is the working
  form. The plan's `AssignPopup` placement also split a `v-if` chain in
  `PropertyField`; it renders after the whole chain instead, same conditions.
- **A known, pre-existing echo bakes scene-default geometry into files.**
  During live verification, an auto-sized text sibling gained
  `width={100} height={100}` after unrelated patch round-trips — machinery this
  spec never touched (reconcile → relayout → canvas patch derivation). Filed
  separately rather than fixed here.
- **Fill/Stroke headers carry only the `+`, not the variables-grid glyph** §2's
  table asked for. The Libraries picker is reachable through the swatch —
  every solid paint's dialog opens on it when the paint is bound — so the
  header glyph would be a second door to the same room. Dropped to keep the
  final fix wave small; add it if the swatch route proves too hidden.
