# Spec — Figma parity: sections, naming, and property assignment

**Status: ✅ built and live-verified 2026-08-23**, in the three stages §7
names. Deviations found while building are recorded in §9. This spec continues
[properties-panel.md](properties-panel.md) (C6/C7, shipped) and F12 (the
apply/unlink controls, shipped): those built the machinery, this aligns its
shape, wording and placement with Figma, because the panel's users are Figma
users and every divergence costs them a search.

Sources: Figma Help —
[Explore component properties](https://help.figma.com/hc/en-us/articles/5579474826519-Explore-component-properties),
[the right sidebar](https://help.figma.com/hc/en-us/articles/360039832014-Design-prototype-and-explore-layer-properties-in-the-right-sidebar),
[auto layout flows](https://help.figma.com/hc/en-us/articles/31289464393751)
— read 2026-08-23, current UI3.

## 1. The organizing principle

The relation between sections and property assignment is not incidental in
Figma — it is a rule, stated in their own docs:

> Boolean property: **the Appearance section**.
> Text property: **top of the right sidebar, in the Text section**.
> Instance swap property: **top of the right sidebar**.

**Each property type fills exactly one input, and the assignment affordance
lives on that input, in that input's fixed section.** The type is never chosen
in the apply flow — clicking apply on the Content field can only produce a text
property, because Content is what a text property fills. The purple pill then
*replaces* the input; clicking the pill switches to another property of the
same type; a detach control beside it removes the link.

UIDX already encodes the same rule as data — `PROPERTY_FIELD` maps
TEXT→`characters`, BOOLEAN→`visible`, INSTANCE_SWAP→`component` — and F12 built
apply/switch/remove on top of it. What is *not* aligned is placement and
naming: Content sits in the seventh section instead of the first, `visible` is
a mid-section checkbox row, and the instance-swap affordance does not exist at
all. Sections carry raw prop names (`itemSpacing`, `strokeAlign`,
`counterAxisAlignContent`) that a Figma user has never read.

## 2. Sections — target structure and order

Figma UI3's order, restricted to the UIDX vocabulary. A section with nothing
applicable to the selected element does not render (already true). Collapse
state stays per-section (already true).

### Any layer

| # | Section | Fields (display name ← authored name) |
|---|---|---|
| 1 | *Selection header* | element chip, name — already built |
| 2 | *Component context* | Variants / Properties (on a Component), Instance properties (on an Instance) — already built, already on top |
| 3 | **Position** | X ← `x`, Y ← `y` (paired) · Rotation ← `rotation` · Position ← `layoutPositioning` (Auto / Absolute) · Constraints ← `constraints` |
| 4 | **Layout** | W ← `width`, H ← `height` (paired, with the Fixed/Hug resizing dropdowns already built) · Min W / Max W / Min H / Max H · **auto-layout flow, when on:** Flow ← `layoutMode` · Wrap ← `layoutWrap` · alignment matrix (built) · Gap ← `itemSpacing` · Vertical gap ← `counterAxisSpacing` · padding (built, icons) · Clip content ← `clipsContent` · Align content ← `counterAxisAlignContent` · First on top ← `itemReverseZIndex` · **as a child:** Grow ← `layoutGrow` · Align self ← `layoutAlign` |
| 5 | **Appearance** | Visible ← `visible` (first row — the boolean-property anchor) · Opacity ← `opacity` · Corner radius ← `cornerRadius` + per-corner (icons built) · Corner smoothing ← `cornerSmoothing` · Blend mode ← `blendMode` · Use as mask ← `isMask` · Mask type ← `maskType` · Lock ← `locked` |
| 6 | **Fill** | the paint stack (built) |
| 7 | **Stroke** | paint stack · Weight ← `strokeWeight` + per-side (icons built) · Position ← `strokeAlign` (Inside / Center / Outside) · Cap ← `strokeCap` · Join ← `strokeJoin` · Miter angle ← `strokeMiterLimit` · Dashes ← `dashPattern` · Included in layout ← `strokesIncludedInLayout` |
| 8 | **Effects** | the effect list (built) |

Three structural moves, all from UI3:

- **W/H and min/max move from Position to Layout.** UI3 splits "where it is"
  from "how it sizes"; Position keeps X/Y/rotation/constraints, Layout owns
  dimensions and everything auto-layout. This dissolves today's separate
  "Auto layout" and "Layout child" sections into one **Layout** section, which
  is also where Figma puts them.
- **`strokesIncludedInLayout` moves from Stroke to Layout.** Figma houses it
  in the auto-layout settings ("Inside stroke: included / excluded from
  layout") — it is a layout fact about a stroke, not a stroke fact.
- **The boolean anchor is the Appearance header**, not a row. This spec first
  said a first row labeled "Visible"; that row does not exist — C9 moved
  visibility to the header eye and suppresses the redundant row — so the apply
  control lives beside the eye. See §9.

`vectorPaths` and `arcData` stay where they are, read-only — Figma shows
neither, and they are edited on canvas (D11/D12).

### A Text layer

**The Text section renders first, above Position** — Figma's own words are
"the Text section at the top of the right sidebar", and the Content field is
the reason: it is the layer's payload, and the text-property anchor.

| Order inside Text | Display name ← authored name |
|---|---|
| 1 | **Content** ← `characters` (shipped in F12) |
| 2 | Font ← `fontFamily` |
| 3 | Weight ← `fontWeight` · Italic ← `italic` |
| 4 | Size ← `fontSize` |
| 5 | Line height ← `lineHeight` · Letter spacing ← `letterSpacing` |
| 6 | alignment (icons built) ← `textAlignHorizontal` / `textAlignVertical` |
| 7 | Resizing ← `textAutoResize` (Fixed size / Auto height / Auto width — row 9's `textTruncation` is the truncate surface, so `TRUNCATE` is read here but never written) |
| 8 | Case ← `textCase` · Decoration ← `textDecoration` |
| 9 | Max lines ← `maxLines` · Truncate ← `textTruncation` |

### A nested Instance

**A new instance header row at the top of the panel**: the component picker
(the swap control — today reachable only through the layers-rail flows) as an
inspector row, carrying the apply affordance for INSTANCE_SWAP. Bound, it is
the purple pill (`component="{icon}"`); the pill switches, the unlink control
writes back the property's default component name. This is the one property
type F12 left without a UI, and it completes the type↔input↔section triangle:

| Type | Input | Section |
|---|---|---|
| TEXT | Content | Text, top of panel |
| BOOLEAN | Visible | Appearance |
| INSTANCE_SWAP | the component picker | top of panel |

## 3. Naming — the rules, not just the table

1. **The file never changes.** Display names live in `PropUi.label`
   (built in F12 for Content); the authored name stays the patch key, the
   file's spelling, and the `data-prop` hook. A label is presentation.
2. **Enum options get display labels too.** The file keeps UIDX's canonical
   spellings (ADR 0002); the control shows Figma's word. A general
   Title-case prettifier (`SPACE_BETWEEN` → "Space between") covers most,
   with explicit overrides where Figma's word differs from the value's:
   `textAutoResize` NONE → "Fixed size", HEIGHT → "Auto height",
   WIDTH_AND_HEIGHT → "Auto width", TRUNCATE → "Truncate";
   `strokeAlign` shown as Position with Inside / Center / Outside.
   Options already rendered as icons (alignment, flow, resizing) keep icons.
3. **Labels stay always-visible.** Figma hides most field labels behind the
   "Property labels" toggle; UIDX shows them. That is a deliberate divergence
   — it matches Figma-with-labels-on, and a file-first tool's audience reads.

## 4. Assignment flows — deltas from what F12 shipped

Shipped and staying: apply icon on hover, menu listing same-type properties
with **Create property…**, purple pill with switch + unlink, unlink writes the
declared default, create-and-bind in one envelope, the type never being a
choice when a field opened the dialog.

New in this spec:

- **Instance swap apply** on the new instance header row. The helper layer
  needs nothing: `PROPERTY_FIELD` already maps INSTANCE_SWAP→`component`,
  `bindCandidates`/`bindProperty`/`unbindProperty` already accept it, and
  `component` already travels the structural patch route. The work is the
  header row itself.
- **Content moves to the top** with its section, per §2.
- **Visible moves to the head of Appearance**, per §2.
- **Pill everywhere reads type-glyph + name** (shipped) — no resolved value
  for property pills, resolved value stays on token pills (F12's decision,
  unchanged).

## 5. Out of scope, named so it is deferred rather than forgotten

- **Variables/tokens in the apply menu** — Figma's menu is "Apply
  variable/property"; UIDX's is property-only until G5's token UI story.
- **Variant properties in the apply flow** — ADR 0005 gives variants their own
  grammar; they never appear in these menus (F6's standing decision).
- **Slots, exposed nested instances, preferred instances, rich text** — F5 and
  later.
- **`FILL` sizing** — blocked on the format story (ADR 0002 / A2).
- **Multi-edit across variants** — needs multi-select first.

## 6. Known deviations from Figma, accepted

- ~~Visibility is a labeled first row, not an eye on the section header.~~
  **Wrong, and it made the boolean flow unreachable — see §9.** The eye C9
  built stays on the header, and the apply control sits beside it.
- Numeric `Grow` / enum `Align self` instead of Figma's Fill-container
  resizing dropdowns — those encode `FILL`, which the format cannot write yet.
- `Lock` stays in Appearance (Figma has it in the layers panel only).
- No "Apply variable" button in the create dialog (no variables yet).

## 7. Implementation shape

| Piece | Where | What |
|---|---|---|
| Labels + regrouping | `packages/schema/src/prop-ui.ts` | `label` on every field per §2/§3; `optionLabels` (or a prettifier + overrides); group moves (`width`… → `layout`; kill `layout-child`; `strokesIncludedInLayout` → `layout`); `SECTION_ORDER` becomes element-aware (Text first for `<Text>`) |
| Drift test | `packages/schema` | every `PROP_UI` entry has a `label` or is on an explicit exempt list; enum option labels cover every option |
| Section order per element | `packages/viewer/src/editable.ts` | `sectionsFor` consults the element-aware order |
| Option labels in controls | `PropertyField.vue` | segmented/select options render the display label, commit the canonical value |
| Instance header row | `PropertiesPane.vue` (+ small component) | picker + apply/pill/unlink for `component`, reusing F12's menu and the existing `PickComponentDialog` for choosing a literal component |
| Visible-first, Appearance | `prop-ui.ts` ordering | field order within a group becomes explicit rather than declaration order |

Order of work, each independently shippable and testable:

1. **Naming** — labels + option labels + drift test. Pure presentation, no
   behavioral risk, biggest daily win.
2. **Regrouping** — Layout absorbs dimensions and child fields; Text section
   first on text layers; Visible first in Appearance.
3. **Instance swap header** — the new row and its apply flow.

## 8. Verification

- **Unit** (`@uidx/schema`) — label coverage drift test; element-aware section
  order (Text first for Text, absent for Frame); option-label round trip
  (label shown ⇔ canonical committed).
- **Component** (`@vue/test-utils`) — a `<Text>` renders Text before Position;
  W/H rows live under Layout; Visible is Appearance's first row and carries
  the apply affordance; the instance header offers, applies, switches and
  unlinks an INSTANCE_SWAP property; every emitted patch still keys on the
  authored name.
- **Live** — against `examples/` (on a scratch copy, per the standing
  verification rule): the three apply flows produce exactly the file edits
  F12's helpers already test, and a Figma-side-by-side eyeball of section
  order and wording.

## 9. What changed while building it

- **`layoutPositioning` stayed beside X/Y**, not after Rotation as §2's table
  had it. The table it lives in already argued that placement — it is the
  toggle that *unlocks* x/y, and Figma puts it there — and an existing test
  pinned it. The spec's ordering was the newer and worse of the two claims.
- **`counterAxisAlignContent` takes no option override.** §3 wanted Figma's
  "Auto" for `SPACE_BETWEEN`, but this domain's other value *is* `AUTO`, and
  the no-collisions test caught the two reading alike. Both prettify instead:
  "Auto" and "Space between". Reading unlike Figma beats reading ambiguously.
- **The link controls were extracted to `PropertyLink.vue`** before the
  instance row was written. §7 said "reusing F12's menu"; the only honest way
  to reuse it was to lift it out of `PropertyField`, so the three inputs are
  one control rather than three lookalikes.
- **Icons still beat labels.** §3 kept icon-rendered options as icons, which
  means `textAutoResize`, alignment and flow show no option text at all — the
  labels are their tooltips. Worth knowing when reading a screenshot.
- **`visible` has no row to hang the apply control on**, and the spec missed
  it. §2 asked for "Visible as Appearance's first row"; C9 had already moved
  the node's visibility to the header eye and `genericFields` suppresses the
  `visible` row outright, so ordering it first changed nothing and the boolean
  flow had no reachable control at all. Of the three property types, only text
  could be assigned — which is exactly what it looked like from the outside.
  The control now sits beside the eye, which is also what Figma's docs say
  ("Boolean property: the Appearance section"), and the eye is disabled while
  a property drives visibility so a stray click cannot silently detach it.
- **The apply glyph is dimmed at rest rather than invisible.** Figma reveals
  it on hover, and copying that hid the feature: nothing suggested the row was
  bindable, so nobody hovered. Only the three bindable inputs ever carry it,
  so at rest it reads as a hint rather than clutter.

## 10. Every Figma section, and what uidx does with it

Reviewed against Figma's own enumeration of the Design tab
([the right sidebar](https://help.figma.com/hc/en-us/articles/360039832014-Design-prototype-and-explore-layer-properties-in-the-right-sidebar))
and UI3's rendered order.

| # | Figma section | uidx | Note |
|---|---|---|---|
| — | Instance (swap + properties) | swap row + `InstancePropsSection` | above the sections, Figma's placement |
| — | Properties (main component) | `ComponentPropsSection` | |
| 1 | **Text** *(Text only)* | `text` | **Content and nothing else** |
| 2 | **Position** | `position` | X/Y, Position, Rotation, Constraints |
| 3 | **Layout** | `layout` | W/H, min/max, auto layout, child participation |
| 4 | **Appearance** | `appearance` | opacity, radii, blend, mask, the visibility eye |
| 5 | **Typography** *(Text only)* | `typography` | font, size, spacing, alignment, case |
| 6 | **Fill** | `fill` | |
| 7 | **Stroke** | `stroke` | |
| 8 | **Effects** | `effects` | |
| 9 | Layout grid *(Frames)* | — | `layoutGrids` is deferred by the vocabulary ("useful for pages, marginal for components") |
| 10 | Export | — | `exportSettings` belongs with `.fig` export |
| 11 | Selection colors | — | needs multi-select, which is out of scope |

The three uidx does not render have no properties in the v1 vocabulary at all,
each deferred deliberately in `docs/property-vocabulary.md` — so the alignment
is complete for everything the format can express.

## 11. Corrections after seeing it beside Figma

- **Text and Typography are two sections, not one.** §2 folded the type
  settings in with Content under a "Text" heading. Figma keeps Content alone at
  the top and puts font, size and spacing in **Typography**, below Appearance —
  which is what makes the top of the panel read as the layer's content rather
  than a wall of type controls.
- **Applying belongs to the section title, not the row.** §4 put an apply icon
  on every bindable row. One glyph per section says the same thing once, and it
  is where Figma's own docs point ("Boolean property: the Appearance section").
  A row carries controls only once it is *linked*, and then they are the pill's
  own change and remove.
- **A linked row goes full width.** Squeezed into the value column beside a
  90px label, `showIcon` rendered as "showTa…". The pill takes the whole row
  and the label goes, because the pill already carries the property's name and
  a glyph for the input it fills. Figma's pill is full width for this reason.
- **The pill trails its section.** §2 led Appearance with Visible; Figma puts
  the pill *after* Opacity and Corner radius. `visible` is last in the
  Appearance order now, and the row exists only while a property drives it.
- **`.field` needed a third column.** It is a two-column grid, so the apply
  button was a third child and wrapped onto a second grid line under the label
  — the row looked broken. There is an `auto` third column now, which collapses
  on the rows that have no controls.
