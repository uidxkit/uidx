# Inspector finish — Figma-grade affordances

2026-08-20. Follows C8 (structured controls). Backlog story: **C9**.
Direction set in conversation with reference screenshots of Figma's own
panel: *"It should be professional and designers should love to work with
it."* This story finishes the inspector; the two stories after it are named
at the end so the sequence is on record.

## The problem

C8 made every property editable, but three gaps separate the panel from the
tool in the reference screenshots:

1. **The colour picker is a native OS input.** Figma's is a dialog: an SV
   area, hue and alpha sliders, an eyedropper, hex plus opacity, and the
   document's own colours as swatches. Colour is the control designers touch
   most; the native input reads as a placeholder.
2. **Number fields are boxes, not instruments.** In Figma every numeric
   field carries an icon or letter that is itself a drag handle, the wheel
   adjusts the value under the cursor, and modifier keys change the step.
   Ours scrub on the value text only, and only where `NumberFieldRoot` is
   wired.
3. **The panel and the canvas do not talk while hovering.** Figma highlights
   the exact gap or padding band on the canvas the moment the cursor rests
   on its control (the pink band in the reference shot). The SDK renders
   these overlays natively — `editor.setAutoLayoutHover` with kinds
   `'spacing' | 'spacing-value' | 'padding' | 'padding-value'` and a `side`,
   plus `setHoveredNode` for whole-node outlines — and nothing calls them
   from the panel.

Research grounding: Figma's help documents the picker's full inventory
(SV area, hue slider, opacity slider, eyedropper, format dropdown across
HEX/RGB/CSS/HSL/HSB, per-file swatches and libraries, blend mode per fill);
the reference screenshots document the field iconography (X/Y/W/H letters,
rotation angle, opacity grid, corner radius bracket, padding and gap
glyphs), the 9-dot alignment matrix, the flow segmented icons, and the
Hug/Fixed sizing dropdowns attached to W/H.

## Scope — what C9 ships

### 1. The colour picker dialog

A popover dialog replacing the native input, opened from any paint or effect
swatch:

- **SV area** — a saturation/value square for the current hue, rendered with
  CSS gradients over the hue colour; a pointer-tracked thumb. Dragging
  previews continuously and commits on release.
- **Hue slider** and **alpha slider** — horizontal tracks (the alpha track
  over a checkerboard), same preview/commit discipline.
- **Hex field** and **opacity %** — commit on change; invalid hex refuses
  red without writing.
- **Eyedropper** — the browser `EyeDropper` API where present (Chromium);
  the button simply absent where not. Picked colour commits at once.
- **Document swatches** — the distinct solid colours currently in the open
  document ("on this page"), computed from the parsed document, one click
  to commit. No libraries tab — cross-document colour is Epic G/F territory
  (tokens already bind through `{collection#token}`).
- All colour math (`rgb ⇄ hsv`, hex, swatch collection) lives in
  `paint-edit.ts` — pure, tested. The dialog itself is one component
  (`ColorPickerDialog.vue`) used by both `PaintStackField` and
  `EffectListField`.
- **Format dropdown, gradients tab, blend mode per paint: out**, named.
  Hex + opacity is the v1 surface; the dialog's layout leaves room.

### 2. Number fields become instruments

- **Every numeric field gets an icon slot** — X/Y/W/H keep their letters;
  rotation, opacity, corner radius, padding sides, gap, stroke weight,
  blur/spread get small inline SVG glyphs (drawn once in a `field-icons.ts`
  module as functional components; `currentColor` so the theme owns them).
- **The icon is a drag handle** — pointer-drag on it scrubs, exactly like
  the value text (`NumberFieldRoot.actions.startScrub` already provides
  this; the icon joins the existing wiring).
- **Wheel adjusts the hovered field** — one step per wheel notch, `Shift`
  ×10, `Alt` ×0.1, matching Figma. Preview per tick with a debounced commit
  on rest (~400ms), so a scroll burst is one patch — C4's discipline, and
  the wheel handler's step math is pure (`wheelStep` in a testable module).
- Applies to scalar number fields and the effect X/Y/blur/spread boxes,
  which move from bare text inputs onto `NumberFieldRoot` so they scrub,
  wheel and nudge like everything else (closes C8's known nit).

### 3. Panel-hover → canvas feedback

Hovering a control tells the canvas what the control governs:

- `itemSpacing` / `counterAxisSpacing` → `setAutoLayoutHover(kind:
  'spacing-value')` on the selected frame — the gap bands light up.
- `paddingLeft/Right/Top/Bottom` → `kind: 'padding-value'` with the matching
  `side`.
- Alignment and flow controls → `kind: 'children'`.
- Any other geometry field (X/Y/W/H, rotation, radius) → `setHoveredNode` on
  the selected node, so the outline answers the cursor.
- Leaving the control clears the overlay. The mapping from prop name to
  overlay call is a pure table (`hover-map.ts`), tested; the wiring is a
  `mouseenter`/`mouseleave` pair travelling `PropertyField → PropertiesPane
  → App → CanvasPane`, mirroring the preview path.

### 4. Icons, not words — everywhere one exists

A global rule, not a per-control nicety: **every control that Figma draws
as an icon renders as an icon here, with a tooltip naming the property and
the value** (`title`, plus `aria-label` for the screen reader). The glyphs
live in one `field-icons.ts` module — small inline SVG functional
components, `currentColor` throughout so the theme owns them — and a
segmented item whose value has a glyph renders the glyph with the word in
its tooltip. Words survive only where no honest glyph exists (enum values
like blend modes stay a select).

Concretely, icon segments replace text segments for: `layoutMode` (flow:
freeform / vertical / horizontal / grid), `layoutWrap`,
`textAlignHorizontal` / `textAlignVertical`, `textAutoResize`,
`strokeAlign`, `layoutAlign`, `layoutPositioning`. Field glyphs cover
rotation, opacity, corner radius, gap, padding (per side and combined),
stroke weight, blur and spread — beside the X/Y/W/H letters C6 shipped.

### 5. The Auto layout section, rebuilt to the reference

The section stops being a list of one-prop rows and takes Figma's exact
arrangement:

- **Flow** — the icon segmented row (above).
- **Resizing** — `W` and `H` boxes with the `Hug`/`Fixed` state rendered
  inside them (`W 1000 ∨`, `H 896 Hug`), replacing the separate
  `primaryAxisSizingMode` / `counterAxisSizingMode` rows; the dropdown
  writes the mode prop, the number writes the size. `FILL` stays excluded
  (ADR 0002, A2).
- **Alignment + Gap side by side** — the 9-dot 3×3 matrix
  (`AlignmentMatrix.vue`) collapsing `primaryAxisAlignItems` ×
  `counterAxisAlignItems` into one click that writes both props in one
  envelope (patch-burst), with `SPACE_BETWEEN` as Figma's distributed
  variant; beside it the gap field with its glyph, wheel and scrub
  (`itemSpacing`; `counterAxisSpacing` appears when `layoutWrap` is WRAP,
  exactly when it means something).
- **Padding as Figma draws it** — two fields, horizontal and vertical, when
  the sides agree, each writing its pair in one envelope; the corner toggle
  expands to the four independent sides when they differ or when asked.
  Pure logic (`paddingModel` — collapse/expand decisions and what each
  field writes) lives beside the other judgement and is tested without Vue.
- **Clip content** — the checkbox row, as is.

Section headers keep their chevrons; Fill/Stroke/Effects headers gain the
`+` on the header row (Figma's placement) instead of beside the label.

### 6. The Appearance section, rebuilt to the reference

Same treatment as Auto layout:

- **Opacity** — grid glyph, percent display, scrub/wheel (maps 0–100% to the
  0–1 prop).
- **Corner radius** — bracket glyph, one field when the four corners agree,
  and Figma's expand toggle to the four independent corners
  (`topLeftRadius` …), each with its corner glyph; `cornerSmoothing`
  appears as a 0–100% field only in the expanded state, as Figma places it.
  Pure `cornerModel` logic beside `paddingModel`, one envelope per gesture.
- **Visible** — the eye on the Appearance section header, Figma's
  placement, instead of a checkbox row.
- **Blend mode** — droplet glyph beside the select; the select keeps words
  (seventeen modes have no honest glyphs).
- `locked`, `isMask`, `maskType` keep checkbox/select rows — Figma puts
  these in menus, not the panel, so there is no reference layout to match.

## Appendix — the full property-to-control inventory

The audit the direction asked for: every prop the panel shows, its control
in Figma, and its C9 treatment. Sections in panel order. *(glyph)* means an
icon from `field-icons.ts` with a tooltip; every number field also scrubs
on its glyph and answers the wheel.

| Prop | Figma's control | C9 |
|---|---|---|
| `x`, `y` | letter-prefixed fields | as C6, + wheel |
| `width`, `height` | letter fields, sizing dropdown inside | letters + `Hug`/`Fixed` inside (frames) |
| `minWidth` … `maxHeight` | under the W/H dropdowns | glyph fields (dropdown integration later) |
| `rotation` | angle glyph field; flip buttons | glyph field; flips need a transform op — out, named |
| `constraints` | visual anchor widget | two selects (C8); the widget is a nice-to-have, named |
| `layoutMode` | Flow icon segments | icon segments |
| `layoutWrap` | wrap icon segment | icon segments |
| `primaryAxisSizingMode`, `counterAxisSizingMode` | inside W/H | inside W/H (§5) |
| `primaryAxisAlignItems` × `counterAxisAlignItems` | 9-dot matrix | `AlignmentMatrix.vue` (§5) |
| `counterAxisAlignContent` | part of wrap alignment | select, shown only when WRAP |
| `itemSpacing`, `counterAxisSpacing` | gap glyph fields | glyph fields (§5), counter only when WRAP |
| `paddingLeft/Right/Top/Bottom` | paired H/V + expand | `paddingModel` (§5) |
| `itemReverseZIndex` | menu toggle | checkbox row |
| `clipsContent` | checkbox | checkbox row |
| `layoutPositioning` | ignore-auto-layout icon | icon segments |
| `layoutGrow`, `layoutAlign` | child sizing controls | glyph field / icon segments |
| `opacity` | grid glyph, % | §6 |
| `blendMode` | droplet + menu | droplet + select (§6) |
| `cornerRadius` + per-corner + `cornerSmoothing` | bracket glyph + expand | `cornerModel` (§6) |
| `visible` | eye on header | eye on Appearance header (§6) |
| `locked`, `isMask`, `maskType` | menus | checkbox/select rows |
| `fills`, `strokes` | paint stack + picker dialog | C8 stack + §1 dialog |
| `strokeWeight`, per-side weights | weight glyph + per-side selector | glyph fields; per-side selector later, named |
| `strokeAlign` | dropdown | icon segments |
| `strokeCap`, `strokeJoin` | advanced stroke settings | selects |
| `strokeMiterLimit`, `strokesIncludedInLayout` | advanced stroke settings | glyph field / checkbox |
| `dashPattern` | dash field | C8 field, glyph added |
| `effects` | effects list + dialog | C8 list + §1 dialog; numbers onto NumberFieldRoot (§2) |
| `characters` | canvas + panel text box | text field |
| `fontSize`, `lineHeight`, `letterSpacing` | glyph fields | glyph fields |
| `fontFamily` | searchable font menu | text field (font enumeration is its own story, named) |
| `fontWeight` | style select | select |
| `italic` | style select / toggle | icon toggle |
| `textAlignHorizontal/Vertical` | icon segments | icon segments |
| `textAutoResize` | icon segments | icon segments |
| `textCase`, `textDecoration` | type-settings icon toggles | icon segments |
| `textTruncation`, `maxLines` | type settings | select / glyph field |
| `vectorPaths`, `arcData` | edited on canvas (vector mode) | read-only, with reason — C10+ territory |

## Out of scope, named

- Gradient and image paint editing; per-paint blend modes.
- Colour format dropdown (RGB/HSL/HSB read-outs).
- Libraries/cross-document swatches.
- Selection colors, Layout guide, Export sections (Figma features with no
  uidx counterpart yet).
- Rotation flips (need a transform op in the format), the constraints
  anchor widget, the per-side stroke selector, font family enumeration —
  each named in the inventory where it falls short of Figma.
- Multi-select editing (C5's surviving deferral).

## After C9 — the agreed sequence

1. **C10 — canvas manipulation.** Dragging moves, handles resize, directly
   on the canvas, writing through `fromSceneChange` under D4's rules. The
   SDK's selection/snap overlays (`setSnapGuides`, `rotationPreview`) are
   already rendered; the story is enabling the input path
   (`useCanvasInput`-equivalent) and keeping one-gesture-one-patch.
2. **D1 / D2 — create and delete.** The creation toolbar (frame, rectangle,
   ellipse, text, vector) and delete-on-selection, closing Phase 3b.

## How this gets verified

The C5/C6/C8 split: colour math, wheel stepping, swatch collection and the
hover map are pure-tested; dialog/matrix/field components are tested through
the mounted pane asserting commit payload shapes and hover event emissions;
the canvas overlay calls and the picker's feel are verified by hand in the
running viewer.

**Done when:** a designer can open the picker from any swatch, drag in the
SV area and watch the canvas recolour live, release and see one one-line
diff; scroll any number field and get one patch per pause; rest the cursor
on the padding control and see that band light up on the canvas; set
alignment from the matrix in one click; read W/H with their sizing state
and padding as two paired fields the way the reference screenshots show;
and hover any icon control and get a tooltip that names what it does.
