# Figma tokens and variables as the reference for the UIDX editor's token system

**Researched 2026-08-25.** All claims carry a retrieval date and an availability status.
The authoritative enum source throughout is `@figma/plugin-typings@1.135.0`
(`plugin-api.d.ts`), retrieved from the npm registry on 2026-08-25 — not
training data, and not a summarised doc page.

> **Empirical probing did not happen.** A Figma plugin bridge is configured in this
> environment (`mcp__figma__*`, including `list_variables`, `bind_variable`,
> `get_bound_variables`, `get_tokens`), but `get_plugin_status` returned
> `{"connected": false}` on 2026-08-25. Every row in the binding matrix is
> therefore marked `verifiedBy: "docs"`. Rows flagged `unverified` are the ones
> worth probing first if the bridge comes up — they are listed in §12.

---

## 1. Executive summary

**Recommendation: keep the `.uidx` authored surface Figma-shaped, and make DTCG an
import/export format rather than the on-disk format.** This *refutes the working
hypothesis* ("the `.uidx` token model should be DTCG-native"), and it does so on
the strength of two accepted ADRs rather than taste. [ADR 0002](../decisions/0002-fidelity-to-figma-and-css.md)
fixes the rule that "when a capability can be spelled two ways, the Figma spelling
wins"; [ADR 0004 §2](../decisions/0004-global-document-namespace.md) already
considered and *explicitly rejected* DTCG's dotted `{radius.md}` in favour of
`{radius#md}`, "rather than a third separator borrowed from other token tools."
The existing `<Tokens>/<Collection>/<Variable>` grammar in
[core-tokens.uidx](../../examples/core-tokens.uidx) is a Figma-variables model
already. Going DTCG-native on disk would reverse both decisions to gain
portability that a serialiser gets for free.

What the hypothesis got right is the *other* half, and it should be built: adopt
DTCG's **type system** (explicit `$type`, units on dimensions, composite tokens)
and Figma's **mode/scope layer**, while keeping UIDX's addressing and spelling.
See §7 for the criteria table and the proposed syntax.

### The five facts to design around

1. **Figma has no composite tokens, and that is the gap worth closing.** As of
   2026-08-25 `VariableResolvedDataType` is exactly
   `BOOLEAN | COLOR | EASING | FLOAT | STRING | TIMING`. There is no typography,
   shadow, border, or gradient variable. Teams recover composites by falling back
   to *styles* — which is why Figma still ships two overlapping systems. UIDX has
   no styles concept and should not grow one; DTCG composite types are the
   replacement.
2. **Variables are unitless numbers, and it hurts in a specific place.** A `FLOAT`
   is just a number, so **percentage line heights cannot be tokenised at all**.
   A code-first file must carry units on dimension tokens or it will lose
   information CSS can express.
3. **Two different binding mechanisms already exist, and the newer one is the
   better model.** GA properties bind through a `boundVariables` *map* keyed by
   field name. The Config 2026 motion and shader surfaces bind by putting a
   `VariableAlias` **directly in the value slot** (`easing: MotionEasing | VariableAlias`,
   shader `properties[defId]`). UIDX's `cornerRadius="{radius#lg}"` is already the
   value-slot form — the same shape Figma is migrating toward. Do not add a
   side-table.
4. **Figma's read key is not always its write key.** Binding `cornerRadius` on a
   node with independent corners writes one field and reads back as
   `topLeftRadius`/`topRightRadius`/`bottomLeftRadius`/`bottomRightRadius`. Any
   bidirectional sync that assumes symmetry corrupts on the round-trip. UIDX must
   not reproduce this.
5. **Most of what Figma cannot bind is product choice, not physics.** Position,
   rotation, blend mode, text case, stroke dash, paint opacity, whole gradients —
   none is technically hard, and the engine already animates `TRANSLATION_X`,
   `ROTATION` and `SCALE_XY` via keyframes. A code-first tool has no reason to
   inherit the restrictions, and no reason at all to inherit the **plan-gated**
   ones (modes per collection, Enterprise-only REST variables).

---

## 2. Terminology map

| Term | What it actually is | Notes |
|---|---|---|
| **Figma variable** | A typed value in a collection, with one value per mode. Types: `BOOLEAN`, `COLOR`, `EASING`, `FLOAT`, `STRING`, `TIMING`. | The only Figma-native thing that aliases, themes by mode, and scopes. |
| **Figma collection** | "A set of variables and modes." Up to 5,000 variables per collection. | The unit of publishing and of mode-switching. |
| **Mode** | "A list of values for a variable in a collection, storing one value per variable." | Plan-gated (§3). Applied per-node and inherited down the tree. |
| **Alias** | A variable whose value is another variable of the same type. Serialised `{"type":"VARIABLE_ALIAS","id":"VariableID:1:3"}`. | This is what makes primitive → semantic layering possible. |
| **Scope** | A filter limiting which property fields a variable appears for in the picker. 22 values, none for booleans or motion. | A *UI affordance only* — it does not prevent binding via the API. |
| **Figma style** (color / text / effect / grid) | A named bundle of raw values. Supports gradients, multiple stacked paints, blend modes, images, and composite text. | The composite-token workaround. A style's paints can themselves reference variables. |
| **Figma's own word "token"** | Figma does **not** call variables tokens. Its help centre defines a design token as "a method for managing design properties and values across a design system", then says teams "can use two key Figma features to implement their tokens: styles and variables." | Tokens = the concept; variables + styles = the implementation. Worth mirroring in UIDX's own docs. |
| **Tokens Studio token** | A third-party plugin model with composite types (typography, boxShadow, border, composition), themes, token sets, math expressions, and Git remote storage. | Strictly a superset of variables in expressiveness; syncs *down* into variables and styles. |
| **DTCG token** | `$value` / `$type` / `$description`, `{group.token}` aliases, groups, atomic + composite types. | Draft — see §11 for the status caveat. |
| **"Token" in the configured MCP bridge** | An abstraction. `get_tokens` returns "Figma variables (COLOR/FLOAT/STRING), paint styles, text styles, and effect styles" in one list. | **Not a Figma-native concept.** The bridge flattens two different systems under one word. If UIDX ever exposes an MCP, do not repeat this — it hides whether a value can be moded or aliased. |

---

### 2.1 Plan gating

Plan limits are product decisions and UIDX need not inherit any of them.
Source: [Figma plans comparison](https://help.figma.com/hc/en-us/articles/360040328273), retrieved 2026-08-25.

| Capability | Gating |
|---|---|
| Variables at all | Not on Starter |
| Modes per collection | Professional: "Up to 10 modes per collection"; Organization: "Up to 20 modes per collection"; Enterprise: "Unlimited modes with extended collections" |
| Who can create modes | Education, Professional, Organization, Enterprise |
| Extended collections | **Enterprise only** |
| REST Variables API | **Enterprise only.** "To use this API, you must have a Full seat in an Enterprise org; guests cannot use the API." `file_variables:read` for GET, `file_variables:write` for POST |
| Dev Mode | Professional, Organization, Enterprise |
| Variables/expressions/conditionals in prototypes | Professional, Organization, Enterprise |
| Shaders (Config 2026) | Paid plans only; not on Education, Government or Starter |
| Motion authoring | Full seats on all plans; publishing animated components and AI generation require paid plans |

The mode limit is the one that distorts architecture: teams split a theme across
collections purely to dodge a counting limit, then lose the ability to switch
them together. **UIDX should have no mode limit.**

---

## 3. UI walkthrough — managing tokens in Figma

Exact labels as published on help.figma.com, retrieved 2026-08-25.

### The Variables view
Opened from the **Variables** tab in the left navigation bar, which expands to an
edge-to-edge view for managing variables, modes and collections.

- **Create a variable**: **+ Create variable** inside a collection, pick a type,
  name it, give it a value. Duplicate with `Shift+Enter`; delete via right-click.
- **Create a collection**: **More options** > **Create collection**.
- **Rename / delete / reorder collections**: **More options** > **Rename collection**,
  and **More options** > **Reorder collections** (drag, or **Sort A to Z**).
  Deleting a collection deletes every variable in it, recoverable only by
  immediate undo or version history.
- **Grouping**: select variables, right-click **New group with selection**.
  Groups nest by dragging. The help centre documents groups as the mechanism;
  it does **not** document `/` in a variable name as creating a group the way
  component names work — treat slash-grouping for variables as *unverified*.

### The edit-variable modal
Reached by **Edit variable** to the right of a variable row, or right-click >
**Edit variable** on a multi-selection.

- **Scope tab** — checkboxes per supported property; **Show in all** makes it
  available everywhere. Scoping exists for number, color and string variables.
  Scoping a number variable to corner radius means it stops appearing anywhere else.
- **Code syntax** — "one name per platform, including Web, Android, and iOS",
  surfaced in Dev Mode snippets (CSS, SwiftUI, Compose).
- **Description** — "Add a description to explain how the variable should be used."
- **Hide from publishing** — a checkbox. Per the typings, a variable is only
  publishable if *both* it and its collection are visible: "both must be true
  for a given variable to be publishable."

### Aliasing
Right-click a variable's value > **Create alias**, then choose a target from the
**Libraries** tab. Only same-type targets.

### Modes
- **New variable mode** next to the column headers. Figma copies the first
  column's values into the new one.
- Reorder by dragging or right-click **Move column right/left**. The leftmost
  column is the default mode.
- **Applying a mode to a layer**: select the layer, then — per the current help
  article — "From the **Appearance** section of the right sidebar, click
  **Apply variable mode**." For a page, deselect everything and use the **Page**
  section's **Apply variable mode**.
  *Correction to the brief: this control lives in **Appearance**, not a "Layer" section.*
- **Inheritance**: objects default to **Auto**, meaning they take the parent's
  mode; if the parent is also Auto, resolution walks up the tree and finally
  falls back to the collection's default mode. The Plugin API mirrors this
  exactly with `explicitVariableModes` (what this node itself sets) versus
  `resolvedVariableModes` (what it ends up with), plus
  `setExplicitVariableModeForCollection` / `clearExplicitVariableModeForCollection`.
  **That two-property split is the right model for UIDX to copy** — it makes
  "is this node's mode authored or inherited?" answerable without walking.

### Extending a collection (Enterprise)
Right-click a parent collection > **Extend collection**; bring modes across with
right-click > **Import mode**. An extended collection "is tied to its parent
collection and will inherit updates made to any variables that have not been
explicitly overridden"; overridden values are highlighted in blue. You **cannot**
add variables or modes, or change descriptions and scopes, from an extended
collection. The typings expose this as `ExtendedVariableCollection` with
`variableOverrides[variableId][modeId]`, `parentVariableCollectionId`, and modes
that each carry a `parentModeId`. Accepting library updates in consuming files
**removes previously set modes**, which must then be reapplied.

### Applying a variable to a property
Method varies by field — an inconsistency worth noting, because it is a
usability complaint in its own right:

| Field group | How you bind |
|---|---|
| Font size, gap, layout guide count, width/height, max dimensions | field dropdown > **Apply variable**; or press `=` to open the picker |
| Corner radius, effects, layout guide settings, padding | **Apply variable** button, or `Shift`-click the field |
| Opacity, letter spacing, line height, paragraph settings, stroke weight | `Shift`-click the field, or right-click > **Apply variable** |
| Layer visibility | right-click the visibility icon |
| Fills / strokes | **Apply styles and variables** |
| Text content | **Apply variable** in the Text section |
| Font family / weight / style | field dropdown > **Apply variable** |
| Animation delay / duration | **Apply variable** next to the field |

In the picker, **color variables show as square swatches and color styles as
circles** — the only visual cue distinguishing the two systems. There is a search
field and a library filter.

**Detaching**: for color, string and boolean, hover the variable in the sidebar
and click the **Detach variable** icon. For numbers, press Delete/Backspace in
the field or use the same icon. **Dragging the on-canvas auto-layout handles
silently detaches** an applied padding or gap variable.

**Inferred variables**: where a property holds a raw value, Figma can suggest a
variable whose value matches *and* whose scope fits. The API exposes this as
`inferredVariables`, and it only resolves when exactly one variable matches —
"where there are two variables set to a value of 100 with the default scope, a
value cannot be inferred as there are two matches." Dev Mode shows the same
suggestions to developers.

### Local versus library
Local collections appear in the Variables view and are editable. Published
collections arrive read-only through the **Libraries** tab of the picker, and are
imported by key (`importVariableByKeyAsync`). `Variable.remote` distinguishes the
two. Variables changed through the REST API "must be published before they can
be utilized in other files."

### Multi-select and mixed values
**Not established from a primary source.** The help centre documents multi-select
for *editing variables in the Variables view* (right-click > **Edit variables**),
but does not document what binding a property does across a mixed multi-selection
on canvas. Marked **unverified** — see §12.

---

## 4. Known friction in Figma's variables UI and model

Do not copy these.

1. **No composite tokens.** Confirmed structurally: no composite member in
   `VariableResolvedDataType`. Teams keep two parallel systems (variables *and*
   styles) purely to express one shadow or one text ramp.
   *Note: at least one 2026 third-party blog claims "composite/array types" shipped
   in a 2025 update. The current typings contradict it. Treated as false.*
2. **No gradient tokens.** The precise state: individual **gradient stops** accept
   color variables (`VariableBindableColorStopField = 'color'`), but no
   gradient-typed variable exists, so a gradient cannot be tokenised as a unit.
   The forum request ("are we going to see the option of adding gradient styles to
   Figma variables anytime soon?", opened 2025-03-17, replies through 2025-09-25)
   was closed **with no official response and no workaround offered**.
3. **Bulk editing is painful.** Recurring feature requests for bulk rename;
   multiple community plugins exist solely to do find-and-replace on variable
   names. One user describes binding variables to "78 text styles × 5 properties
   = 390 times opening dropdowns", and reassigning scope as "a pain".
4. **Mode limits are commercial.** A long-running thread ("All plans should offer
   more than 4 variable modes") drove Pro from 4 to 10 and Org to 20. Architecture
   still bends around the count.
5. **Inconsistent binding gestures.** Four different affordances (`=`,
   `Shift`-click, right-click, a dedicated button) depending on which field you
   are on. Discoverability suffers.
6. **Deleted and renamed library variables do not clean up.** Deleted variables
   stay bound in consuming files as ghosts that cannot be removed from the
   property; renaming a collection can leave both old and new names in the
   Appearance dropdown. This is the single strongest argument for UIDX resolving
   tokens **by address at load time with a hard diagnostic**, which
   `resolveTokenValues` and `uidx check` already do.
7. **Modes are lost on library update.** Accepting an extended-collection update
   removes previously applied modes, which must be reapplied by hand.
8. **Silent detach.** On-canvas auto-layout manipulation drops a binding with no
   warning — the exact failure mode a bidirectional editor must avoid.
9. **No scopes for booleans or motion.** `VariableScope` has no boolean, `EASING`
   or `TIMING` member, so those variables can never be filtered in a picker.
10. **Percentage line heights cannot be tokenised**, because variables are unitless.

---

## 5. Binding matrix

Machine-readable twin: [`figma-binding-matrix.json`](figma-binding-matrix.json).
`Verified` is `docs` throughout — the plugin bridge was offline (see the note at
the top). Field and enum names are verbatim from `@figma/plugin-typings@1.135.0`.

**Legend for `Bind method`:** `node` = `node.setBoundVariable(field, variable)`;
`paint` = `figma.variables.setBoundVariableForPaint(paint, 'color', variable)`;
`effect` = `figma.variables.setBoundVariableForEffect(effect, field, variable)`;
`grid` = `figma.variables.setBoundVariableForLayoutGrid(grid, field, variable)`;
`slot` = assign a `VariableAlias` directly into the value slot (no helper).

| UI label | Section | Node types | Var type | Scopes | `boundVariables` key | Bind method | Granularity | Notes | Avail. |
|---|---|---|---|---|---|---|---|---|---|
| Fill | Fill | Frame, Component, Instance, shapes, Text, Section | COLOR | `ALL_FILLS`, `FRAME_FILL`, `SHAPE_FILL`, `TEXT_FILL` | `fills[]` + `SolidPaint.boundVariables.color` | paint | per-paint | Paint field is `'color'` **only** — paint opacity is not bindable | GA |
| Gradient stop color | Fill | shapes, Frame, Text | COLOR | `ALL_FILLS` etc. | `ColorStop.boundVariables.color` | write paints array | per-stop | Stops bind; **the gradient as a whole does not** | GA |
| Fill (text range) | Fill | Text | COLOR | `TEXT_FILL` | `textRangeFills[]` | range fills | per range | Separate key from `fills` | GA |
| Stroke | Stroke | Frame, Component, Instance, shapes, Text | COLOR | `STROKE_COLOR` | `strokes[]` | paint | per-paint | Same mechanism as Fill | GA |
| Stroke weight | Stroke | as above | FLOAT | `STROKE_FLOAT` | `strokeWeight` | node | uniform | `Shift`-click or right-click to bind | GA |
| Stroke weight per side | Stroke | Frame, Component, Instance, Rectangle | FLOAT | `STROKE_FLOAT` | `strokeTopWeight`, `strokeRightWeight`, `strokeBottomWeight`, `strokeLeftWeight` | node | per-side | | GA |
| Effect color | Effects | most visual nodes | COLOR | `EFFECT_COLOR` | `effects[]` → `Effect.boundVariables.color` | effect | per-effect | **Shadows only** | GA |
| Effect blur / radius | Effects | most visual nodes | FLOAT | `EFFECT_FLOAT` | `Effect.boundVariables.radius` | effect | per-effect | The **only** field a blur can bind | GA |
| Effect spread | Effects | Rect, Ellipse, clipped Frames | FLOAT | `EFFECT_FLOAT` | `Effect.boundVariables.spread` | effect | per-effect | Shadows only | GA |
| Effect offset X / Y | Effects | most visual nodes | FLOAT | `EFFECT_FLOAT` | `Effect.boundVariables.offsetX`, `.offsetY` | effect | per-axis | Shadows only | GA |
| Width | Layout | Frame, Component, Instance, shapes, Text | FLOAT | `WIDTH_HEIGHT` | `width` | node | single | `=` opens the picker | GA |
| Height | Layout | as above | FLOAT | `WIDTH_HEIGHT` | `height` | node | single | | GA |
| Min/Max width, Min/Max height | Layout | Frame, Component, Instance, Text | FLOAT | `WIDTH_HEIGHT` | `minWidth`, `maxWidth`, `minHeight`, `maxHeight` | node | per-constraint | Four independent fields | GA |
| Padding | Auto layout | Frame, Component, Instance | FLOAT | `GAP` *(no padding-specific scope exists)* | `paddingTop`, `paddingRight`, `paddingBottom`, `paddingLeft` | node | per-side | **On-canvas handles silently detach** | GA |
| Gap between items | Auto layout | Frame, Component, Instance | FLOAT | `GAP` | `itemSpacing` | node | single | Same detach quirk | GA |
| Counter-axis gap | Auto layout | Frame, Component, Instance | FLOAT | `GAP` | `counterAxisSpacing` | node | single | Only when wrapping | GA |
| Grid row / column gap | Auto layout (grid) | Frame, Component, Instance | FLOAT | `GAP` | `gridRowGap`, `gridColumnGap` | node | per-axis | Grid auto layout, not layout guides | GA |
| Corner radius | Appearance | Frame, Rect, Component, Instance, Star, Polygon, Vector | FLOAT | `CORNER_RADIUS` | `cornerRadius` **or** `topLeftRadius`/`topRightRadius`/`bottomLeftRadius`/`bottomRightRadius` | node | per-corner | **Write key ≠ read key** on independent-corner nodes | GA |
| Opacity | Appearance | most nodes | FLOAT | `OPACITY` | `opacity` | node | layer-level | Layer opacity only | GA |
| Visibility | Layer | all scene nodes | BOOLEAN, STRING | *(none — booleans have no scopes)* | `visible` | node | single | Right-click the eye icon; a `"true"`/`"false"` string also works | GA |
| Layout grid count / size / offset / gutter | Layout guides | Frame, Component, Instance | FLOAT | `ALL_SCOPES` only | `layoutGrids[]` → `sectionSize`, `count`, `offset`, `gutterSize` | grid | per-grid, per-field | No guide-specific scope | GA |
| Font family | Typography | Text | STRING | `FONT_FAMILY` | `fontFamily` | node | per text range | Array on nodes, single alias on TextStyle | GA |
| Font style | Typography | Text | STRING | `FONT_STYLE` | `fontStyle` | node | per range | | GA |
| Font weight | Typography | Text | FLOAT | `FONT_WEIGHT` | `fontWeight` | node | per range | Dev Mode prints the number, not the variable | GA |
| Font size | Typography | Text | FLOAT | `FONT_SIZE` | `fontSize` | node | per range | | GA |
| Line height | Typography | Text | FLOAT | `LINE_HEIGHT` | `lineHeight` | node | per range | **Percentages impossible** — variables are unitless | GA |
| Letter spacing | Typography | Text | FLOAT | `LETTER_SPACING` | `letterSpacing` | node | per range | Same unitless caveat | GA |
| Paragraph spacing | Typography | Text | FLOAT | `PARAGRAPH_SPACING` | `paragraphSpacing` | node | per range | | GA |
| Paragraph indent | Typography | Text | FLOAT | `PARAGRAPH_INDENT` | `paragraphIndent` | node | per range | | GA |
| Text content | Text | Text | STRING, FLOAT | `TEXT_CONTENT` | `characters` | node | whole node | `TEXT_CONTENT` is a scope for **both** string and float | GA |
| Component property value | Component / instance | Instance | BOOLEAN, STRING, FLOAT | *(none)* | `componentProperties.<name>` (field `'value'`) | set properties | per property | Drives variant switching under a mode change | GA |
| Component property default | Component properties | Component, ComponentSet | BOOLEAN, STRING, FLOAT | *(none)* | `componentPropertyDefinitions.<name>` (field `'defaultValue'`) | definition API | per property | Distinct field from `'value'` | GA |
| Color style paints | *(Styles)* | PaintStyle | COLOR | `ALL_FILLS` | `PaintStyle.boundVariables.paints[]` | assign bound paints | per paint | How teams get gradients that still theme | GA |
| Text style fields | *(Styles)* | TextStyle | STRING, FLOAT | all typography scopes | `TextStyle.boundVariables.<field>` | `textStyle.setBoundVariable` | one alias per field | TextStyle has its own overload; single alias, not array | GA |
| Effect style effects | *(Styles)* | EffectStyle | COLOR, FLOAT | `EFFECT_*` | `EffectStyle.boundVariables.effects[]` | assign bound effects | per effect | | GA |
| Grid style layout grids | *(Styles)* | GridStyle | FLOAT | `ALL_SCOPES` | `GridStyle.boundVariables.layoutGrids[]` | assign bound grids | per grid | | GA |
| Animation duration / delay | Motion | nodes with an animation style | **TIMING** | *(none)* | — `AnimationStyleConfiguration.props[key]` | slot | per prop | **ms vs s discrepancy** between help centre and typings | Open beta 2026-06-24; API 2026-08-05 |
| Keyframe easing | Motion | nodes with keyframe tracks | **EASING** | *(none)* | — `ManualKeyframe.easing` | slot | per keyframe | Resolves to a `MotionEasing` (curve **or** spring) | Open beta 2026-06-24; API 2026-08-05 |
| Shader parameter | Fill / Effects | nodes with `ShaderPaint` / `ShaderEffect` | FLOAT, COLOR, BOOLEAN, STRING | *(none)* | — `properties[defId]` | slot | per property id | Keyed by definition **id**, not name | Open beta 2026-06-24; paid plans |

### Two mechanisms, not one

Everything above the Motion rows binds through a `boundVariables` **map** keyed by
field name. The three bottom rows bind by placing a `VariableAlias` **in the value
slot itself** — `readonly easing: MotionEasing | VariableAlias`, and for shaders
"a value can always be a variable binding via the standard `VariableAlias` form."

That second form is what `.uidx` already does with `cornerRadius="{radius#lg}"`.
The newer Figma surfaces converged on the shape UIDX picked. This is the single
most reassuring finding in the review, and it means **UIDX should not add a
`boundVariables` side-table to mirror Figma's older mechanism** — the side-table
is Figma's legacy, and it is the direct cause of the write-key/read-key asymmetry
in the corner-radius row.

---

## 6. Not bindable today — constraint or product choice

| Property | Constraint or choice? | Evidence | Designer workaround | Should UIDX support it? |
|---|---|---|---|---|
| X / Y position | **Choice** | Absent from `VariableBindableNodeField`, yet `TRANSLATION_X` / `TRANSLATION_Y` are animatable keyframe fields — the engine varies them fine | Auto layout padding/gap | **Yes.** Nothing technical blocks it |
| Rotation | **Choice** | Absent from bindable fields; `ROTATION` is a keyframe field | A variant per angle | Yes, v2 |
| Constraints | **Choice** | Absent from every `VariableBindable*` union | Per-breakpoint components | No — not a token concern |
| Blend mode | **Choice** | Plain enum on `Paint`/`Effect`, no binding | Styles | No — low value |
| **Whole gradient** | **Choice** | No gradient member in `VariableResolvedDataType`; only `ColorStop.color` binds | Color styles whose paints reference variables | **Yes** — DTCG has a composite `gradient` type |
| Paint opacity | **Choice** | `VariableBindablePaintField = 'color'` | Bake alpha into the color, or bind layer opacity | **Yes** — trivial and frequently wanted |
| Image / video / pattern paints | **Partly constraint** | Only `SolidPaint` and `ColorStop` carry `boundVariables` | Component swap | An asset token (path reference) in v2 |
| Text decoration / case / align | **Choice** | `textCase` exists on `TextStyle` but is absent from `VariableBindableTextField` | Text styles | **Yes** — cheap string tokens |
| Effect visibility / blend mode | **Choice** | `VariableBindableEffectField` is `color \| radius \| spread \| offsetX \| offsetY` | Duplicate effect sets | Falls out free from a composite shadow token |
| Blur spread / offsets | **Real constraint** | `BlurEffectBase.boundVariables` permits `'radius'` alone — a blur has no spread or offset | n/a | Match Figma |
| Instance swap | **Unverified** | `INSTANCE_SWAP` and `SLOT` exist as `ComponentPropertyType`s and property `'value'` is bindable, but no source confirms an instance-swap value accepts a variable. `componentPropertyReferences` is a *different* mechanism | Boolean props toggling pre-placed instances | Decide after probing |
| Stroke align / dash pattern | **Choice** | Absent from every bindable union | Styles | **Yes** — DTCG has a `strokeStyle` composite |

The pattern is unmistakable: with one genuine exception (blur has no spread to
bind), every gap is a product decision about what Figma chose to expose. A
code-first tool writing to a text file has none of the surface-area constraints
that motivated those decisions.

---

## 7. Token model decision for UIDX

### 7.1 Criteria table

Scored against the brief's criteria. **A** = Figma-variables-style (typed
primitives, collections, modes, aliasing, scoping). **B** = DTCG-native on disk.
**C** = hybrid: UIDX/Figma-shaped authored surface, DTCG type system inside it,
DTCG as an export/import format. **TS** = Tokens Studio, as a third reference.

| Criterion | A — Figma-style | B — DTCG-native | C — **hybrid (recommended)** | TS |
|---|---|---|---|---|
| Composite tokens (typography, shadow, border, gradient) | ✗ none | ✓ six composite types | ✓ adopts DTCG's composites | ✓ |
| Dimensions with units | ✗ unitless floats; % line height impossible | ✓ | ✓ | ✓ |
| Motion (duration, easing) | ~ `TIMING`/`EASING`, beta, no springs in any standard | ✓ `duration`, `cubicBezier` — but **no spring** | ✓ DTCG types + an extension for springs | ~ |
| Aliasing | ✓ same-type only | ✓ `{group.token}` and JSON Pointers | ✓ keeps `{collection#variable}` | ✓ |
| Theming / modes | ✓ **best in class** — modes are the whole point | ✗ **not in the spec**; every tool invents it | ✓ Figma's mode model, no plan limit | ✓ themes + sets |
| Scoping | ✓ 22 scopes (gaps: no boolean, no padding, no motion) | ✗ absent | ✓ Figma's scopes plus the missing ones | ✗ |
| Readability / diff-friendliness in a code-first file | ✓ `cornerRadius="{radius#lg}"` is one short line | ✗ verbose JSON; `$value`/`$type` per token | ✓ | ✗ JSON |
| Round-trip safety under bidirectional sync | ~ Figma's own read/write asymmetry is a hazard | ✓ pure data | ✓ value-slot aliases round-trip cleanly | ~ |
| Export to Style Dictionary | ~ needs a translator | ✓ native | ✓ via serialiser | ✓ |
| Import from Figma (REST / `.fig`) | ✓ 1:1 | ~ lossy on modes and scopes | ✓ 1:1 in, DTCG out | ✓ |
| Designer familiarity | ✓ identical vocabulary | ✗ unfamiliar | ✓ | ~ |
| Implementation effort (OpenPencil/Vue) | ✓ **already built** | ✗ rewrite + ADR reversal | ~ additive | n/a |
| Consistency with accepted UIDX ADRs | ✓ ADR 0002, ADR 0004 | ✗ **reverses ADR 0004 §2** | ✓ | ✗ |

### 7.2 Recommendation

> **Superseded 2026-08-25 by the decisions in [§14](#14-decisions-taken-2026-08-25).**
> Kept here as the research position and its reasoning. The decision taken was
> "pure Figma-style" (§7.1 column A) plus a Styles concept, not the hybrid below.

**Adopt C.** Concretely, that means:

- **Keep** `<Tokens>` / `<Collection>` / `<Variable>`, the `{collection#variable}`
  alias spelling, and value-slot binding. These are ADR-backed and already shipped.
- **Add** an explicit `type` attribute using **DTCG type names**, replacing today's
  inference in `variableTypeOf`. Inference cannot distinguish a `dimension` from a
  `number` from a `duration`, and cannot express a composite at all.
- **Add** modes, scopes, descriptions and composite types.
- **Treat DTCG as a serialisation target**, not the file format: `uidx tokens export
  --format dtcg` produces Style-Dictionary-ready JSON; `uidx tokens import` accepts
  DTCG, Tokens Studio JSON, or a Figma REST `variables/local` payload.

The hypothesis was right that the *type system* should be DTCG and the *mode/scope
layer* should be Figma's. It was wrong that the on-disk format should be DTCG —
that would reverse ADR 0004 §2's explicit rejection of dotted addressing and cost
the file its readability, for portability a serialiser already provides.

Two caveats to record:

- **DTCG is a draft.** The current Format Module (2025.10, published 2026-07-30)
  carries the warning "Do not attempt to implement this version of the
  specification", and it has recently grown `$extends` and `$root`. Pin a snapshot
  and treat the mapping as a compatibility layer, not a dependency.
- **DTCG has no modes and no scopes.** Export must encode them — one file per mode
  is the conventional lowering, with `$extensions` carrying scope metadata.

### 7.3 Proposed file syntax

Single-mode collections stay exactly as they are today, so
[core-tokens.uidx](../../examples/core-tokens.uidx) keeps parsing unchanged:

```jsx
<Collection name="radius">
  <Variable name="sm" type="dimension" value="4px" />
  <Variable name="md" type="dimension" value="8px" />
</Collection>
```

Modes are declared on the collection and keyed in the value:

```jsx
<Collection name="semantic" modes={['light', 'dark']} defaultMode="light">
  <Variable
    name="surface/default"
    type="color"
    value={{ light: '{palette#white}', dark: '{palette#gray-900}' }}
    scopes={['FRAME_FILL', 'SHAPE_FILL']}
    description="Page and card background. Never for text." />
</Collection>
```

Composite tokens — the capability Figma lacks — reuse the same shape, with
sub-values that may themselves be aliases:

```jsx
<Variable name="shadow/card" type="shadow" value={{
  color: '{palette#black-a20}', offsetX: '0px', offsetY: '2px',
  blur: '8px', spread: '0px'
}} />

<Variable name="text/body" type="typography" value={{
  fontFamily: '{font#sans}', fontSize: '16px',
  fontWeight: 400, lineHeight: '1.5'
}} />
```

`lineHeight: '1.5'` is precisely the value Figma cannot hold.

**Binding stays value-slot**, unchanged and already implemented:

```jsx
<Frame cornerRadius="{radius#lg}" fills={[{ type: 'SOLID', color: '{semantic#surface/default}' }]} />
<Text textStyle="{text#body}" />
```

**Mode selection per subtree** mirrors Figma's explicit/resolved split. The
attribute is the *explicit* mode; resolution walks up to the collection default:

```jsx
<Frame name="dark-panel" modes={{ semantic: 'dark' }}>
  <!-- descendants resolve semantic#* in dark unless they set their own -->
</Frame>
```

**Local versus shared** needs no new mechanism. Per ADR 0004, every `.uidx` file
claimed by `uidx.json` shares one namespace, so a token document *is* the shared
set; cross-document reuse is the reserved library form
`design-system:radius#lg`. A collection that should not be consumed outside its
own page is the one case needing a marker — `<Collection name="…" local>` — which
is also the natural spelling of Figma's *hide from publishing*.

---

## 8. Proposed structure for three-tier tokens

| Tier | Collection | Modes | Scopes | Naming | Published? |
|---|---|---|---|---|---|
| **Primitive** | `palette`, `size`, `font` | none (one mode) | `ALL_SCOPES` | `blue-500`, `space-4`, `sans` — describes the value, never the use | shared, but rarely bound directly |
| **Semantic** | `semantic` | `light` / `dark`, plus brand or density modes | tightly scoped: `surface/*` → fills; `text/*` → `TEXT_FILL`; `space/*` → spacing | `surface/default`, `text/muted`, `border/subtle` — describes the *role* | shared; this is the layer designers bind |
| **Component** | one per component, e.g. `checkbox` | inherits by aliasing semantic; own modes only when the component genuinely varies | scoped to the fields the component uses | `checkbox#box-size`, `checkbox#border-rest` | `local` unless another system consumes it |

Rules that fall out of the research:

1. **Only semantic tokens carry modes.** A primitive with modes is a semantic
   token that has not admitted it. Figma's own guidance and the alias mechanism
   both push this way, and `core-tokens.uidx` already models it —
   `brand` aliases `palette#blue-500` precisely so "changing the blue must change
   the brand."
2. **Scope narrowly at the semantic tier, not at the primitive tier.** Scoping is
   what makes a picker usable; Figma's docs say it directly — it "reduces the
   guesswork when deciding which variables to use."
3. **One collection per mode axis.** Theme and density are separate axes and
   belong in separate collections, so a node can set one without disturbing the
   other. Figma forces this too, since a node sets at most one mode per collection.
4. **Component tokens are `local` by default**, which keeps the shared namespace
   to the two tiers designers actually bind — and sidesteps ADR 0004's
   duplicate-name hazard across systems in one workspace.

---

## 9. Prioritized bindable-property list for UIDX

Priorities also appear per-row in the JSON under `uidx.priority`.

### v1 — must have
Fill color · stroke color · stroke weight (uniform and per-side) · corner radius
(uniform and per-corner) · width · height · padding per side · gap ·
counter-axis gap · layer opacity · visibility · font family · font style ·
font weight · font size · line height · letter spacing · text content ·
effect color · effect radius · effect spread · effect offset X/Y

*Reasoning:* this is the set a design system actually binds on every component,
and it is almost exactly the set the panel already exposes — `variable-binding.ts`
maps `number → FLOAT`, `text → STRING`, `boolean → BOOLEAN` today, with
paint-level color aliases shipped in the 2026-08-24 panel pass. v1 is mostly
*typing and scoping* what already binds, not new binding machinery.

### v1 additions Figma does not have
Per-paint opacity · composite `typography`, `shadow`, `border`, `gradient` tokens ·
units on dimension tokens (so `1.5` and `150%` line heights work)

*Reasoning:* each closes a documented Figma pain point (§4) at low cost, and the
composites are what let UIDX drop the styles/variables split entirely rather than
reproducing Figma's two overlapping systems.

### v2
Min/max width and height · gradient stop colors · text range fills · grid row and
column gap · layout grid fields · paragraph spacing and indent · component
property values and defaults · X/Y position · rotation · text case, decoration and
align · stroke align and dash · duration and easing tokens

*Reasoning:* real but lower-frequency. Position and rotation are here rather than
in v1 because they are meaningful mainly for motion and absolute layout, both of
which land later. Motion tokens should wait until Figma's beta settles — including
the millisecond-versus-second question in §11.

### Deliberately unsupported
Figma **styles** in any form (paint, text, effect, grid styles) · shader
parameters · blend mode binding · constraints binding · prototype-only variable
mechanics (set-variable actions, conditionals, expressions)

*Reasoning:* styles exist in Figma only because variables cannot express
composites; UIDX's composite tokens make them redundant, and shipping both would
recreate the exact confusion §2 documents. Shaders are out of scope for a UI
design system. Prototype logic is a different product.

---

## 10. Panel and sync recommendations

### 10.1 Follow Figma exactly
The panel work shipped and live-verified on 2026-08-24
([panel-ui3-and-variables.md](../panel-ui3-and-variables.md)) already matches
Figma on the affordances that matter, and those choices are confirmed by this
research:

- **The bound-value pill.** A bound number renders as a name pill with the
  resolved value as a tooltip and detach on hover. Keep it. Figma's equivalent
  cue — square swatches for variables versus circles for styles — is the *only*
  thing distinguishing its two systems; UIDX has one system and one cue, which
  is strictly better.
- **Pick + search only in the popup**, with variables grouped by collection.
  Correct, and now further justified: Figma's own picker is criticised for
  discoverability, and creating variables inline is what produces the
  duplicate-token sprawl teams complain about.
- **Scope-filtered candidate lists.** `variableCandidates` currently filters by
  type alone. Add scope filtering — it is the single highest-value borrowing from
  Figma, and per Figma's docs it exists precisely to reduce guesswork.

### 10.2 Diverge deliberately

| Figma behaviour | UIDX should instead | Why |
|---|---|---|
| Four different bind gestures (`=`, `Shift`-click, right-click, button) | **One** gesture on every bindable field | §4.5 — the inconsistency is a documented complaint |
| On-canvas drag silently detaches a binding | Dragging a bound field either **keeps the binding and warns**, or requires an explicit detach | §4.8 — silent data loss is fatal to bidirectional sync |
| No scopes for booleans or motion | Scope **every** type | §4.9 — an unexplained hole in the enum |
| `GAP` doubles as the padding scope | Separate `SPACING` (padding) from `GAP` | The enum has no padding scope; the picker is worse for it |
| No bulk edit | Multi-select in the token view with bulk rename, retype, rescope | §4.3 — the most-requested missing feature |
| Deleted tokens linger as unremovable ghosts | `uidx check` **fails** on a dangling alias; the panel shows the address struck through with "define or detach" | §4.6 — already half-built via `resolveTokenValues`, which drops unresolvable chains |
| Modes lost on library update | Modes are file state; nothing can silently drop them | §4.7 |

### 10.3 What the editor must write back

Per the existing rule — recorded in `variable-binding.ts` and confirmed by the
project memory that alias-carrying panel writes must be structural — every
binding change is a **patch**, never a scene-graph commit, because the commit
route reflows `"{radius#md}"` as a string where a number is expected.

| Editor action | File write |
|---|---|
| Bind a property | `{op: 'add'\|'set', address, prop, value: "{collection#variable}"}` — exactly today's `bindVariable` |
| Detach | `set` the prop to the **resolved literal**, not to nothing; a detach that blanks the value loses the design |
| Bind a sub-value (paint color, shadow color) | patch the enclosing structured value with the alias in the leaf slot — never a separate side-table |
| Set a mode on a subtree | `set` the node's `modes` attribute — explicit only; never write the inherited value onto descendants |
| Clear a mode | `remove` the `modes` entry so the node returns to inheriting |
| Edit a token's value | patch the `<Variable>` node in the token document, not the consumers |

### 10.4 Identity and ordering concerns

1. **Rename is the dangerous edit.** Tokens are addressed by
   `collection#variable`, so a rename invalidates every reference — the exact
   failure ADR 0001 rejected for nodes and ADR 0004 rejected one level up. A
   panel rename must rewrite every consuming reference in the document in the
   same patch batch, and `uidx check` must fail if any survive.
2. **Deletion must be refused while referenced**, or offered as
   "delete and inline the literal into all consumers." Figma's ghost-variable
   behaviour (§4.6) is the counter-example.
3. **Order does not matter, and must keep not mattering.** `applyTokens` already
   resolves aliases in a second pass specifically so "a semantic token pointing at
   a primitive" works regardless of declaration order. Modes and composites must
   preserve that property.
4. **Cycles resolve to *unset*, not to a crash.** `resolveTokenValues` already
   drops non-terminating chains and leaves diagnosis to `uidx check`. Keep it.
5. **Type changes propagate.** Once `type` is explicit, changing a primitive's
   type must be checked against every alias that inherits it — today
   `applyTokens` retypes aliases from their target silently.
6. **Copy/paste between documents.** Figma duplicates unpublished variables into
   a new collection and remaps when names match, prompting via a toast. UIDX
   should do the same but resolve by **address**, and say in the diagnostic which
   tokens were copied rather than only toasting.

---

## 11. Changes in the last 12 months, and beta items that could move

| Date | Change | Status |
|---|---|---|
| 2026-06-23/24 | **Config 2026.** Figma Motion (timeline, keyframes, springs), shaders as a new material, Dev Mode timeline inspection with CSS/JSON/React export | **Open beta.** Motion authoring: full seats all plans; publishing animated components and AI generation need paid plans. Shaders: paid plans only, excluded on Education/Government/Starter |
| 2026-06-23 | Plugin API motion surface: `figma.motion.figmaAnimationStyles()`, `physicalSpringToNormalized()`, `applyAnimationStyle()`, `applyManualKeyframeTrack()`, `setTimelineDuration()`; properties `animationStyles`, `animations`, `manualKeyframeTracks`, `timelines`. Shader surface: `figma.listAvailableShaders()`, `figma.importShaderById()`, `ShaderEffect`, `ShaderPaint` | Version 1, Update 130 |
| 2026-07-29 | `figma.motion.playheadPosition` (seconds) | Version 1, Update 132 |
| 2026-08-05 | **`EASING` and `TIMING` added to `VariableResolvedDataType`.** Easing variables hold `MotionEasing`; timing variables hold numbers | Version 1, Update 133 — the newest variable-model change |
| 2026-07-30 | DTCG Format Module draft 2025.10 published, now with `$extends` and `$root` | Draft; carries "Do not attempt to implement this version" |
| Ongoing | Mode limits raised: Professional 4 → 10, Organization → 20, Enterprise unlimited via extended collections | GA |

### Items that could change the picture

- **Timing units are contradictory in current sources.** help.figma.com describes
  timing variables in milliseconds ("`500ms`"); the Update 133 note and the
  typings describe timing values as numbers in **seconds**, and
  `playheadPosition` is documented in seconds. One of the two is stale. **Do not
  encode either assumption** — this is the top empirical probe in §12.
- **The REST Variables API has not caught up with motion.** Its documented
  `resolvedType` enum is `BOOLEAN | FLOAT | STRING | COLOR` — no `EASING`, no
  `TIMING`. Whether motion variables are readable over REST is unverified, and it
  matters for any Figma → UIDX import path.
- **No `VariableScope` values exist for `EASING`, `TIMING` or booleans.** If Figma
  adds them, the scope enum grows and any hard-coded copy of it drifts.
- **Shader property binding is documented only in the typings' prose**
  ("a value can always be a variable binding via the standard `VariableAlias`
  form") and not in a help article. Beta-fragile.
- **Gradient tokens** remain the loudest unanswered request. If Figma ships a
  composite variable type, the §7 gap analysis narrows considerably — though the
  recommendation would not change, since UIDX would already have them.

---

## 12. Open questions for you

**Decisions I need from you**

1. **Does the recommendation in §7 stand?** It refutes your working hypothesis on
   the on-disk format — DTCG as an export target rather than the file format —
   because going DTCG-native reverses [ADR 0004 §2](../decisions/0004-global-document-namespace.md).
   If you want DTCG on disk anyway, that ADR needs amending first, and I would
   want to know what it buys that a serialiser does not.
2. **Explicit `type` on `<Variable>`, replacing inference?** `variableTypeOf`
   infers today. Inference cannot separate `dimension` from `number` from
   `duration`, and cannot express composites at all. Making `type` explicit is a
   breaking change to existing token files (mechanically migratable).
3. **Units on dimension tokens: `"8px"` or `8`?** Units are what make percentage
   line heights expressible — the concrete thing Figma cannot do. The cost is that
   values stop being bare numbers in the file.
4. **Do component-tier tokens live in each component's own `.uidx` file, or in one
   token document?** §8 assumes the former with `local`; ADR 0004's single global
   namespace makes either workable.
5. **Is motion in scope at all for v1/v2?** I placed duration and easing in v2
   behind Figma's beta. If UIDX motion is further off, they drop out entirely.

**Empirical probes blocked by the offline bridge** — worth running if you open the
Figma desktop plugin. I did not mutate anything, and would ask before touching a
file that is not clearly a scratch file.

6. **Timing units** — milliseconds or seconds? (§11, the highest-value probe.)
7. **Multi-select binding** across layers, and how mixed values present. Nothing
   in the help centre documents this (§3).
8. **Instance-swap binding** — can a component property of type `INSTANCE_SWAP`
   or `SLOT` take a variable? (Matrix row marked unverified.)
9. **Slash-grouping in variable names** — does `radius/sm` create a group the way
   component names do, or are groups strictly the right-click construct?
10. **Which scope actually gates the padding picker**, given the enum has no
    padding member and only `GAP` is close.
11. **Corner-radius round-trip** — confirm that writing `cornerRadius` and reading
    back the four per-corner keys behaves as documented, since it is the sharpest
    sync hazard in the matrix.

---

## 13. Sources

All retrieved **2026-08-25**.

**Primary — API**
- `@figma/plugin-typings@1.135.0`, `plugin-api.d.ts` — https://www.npmjs.com/package/@figma/plugin-typings — authoritative for `VariableResolvedDataType`, `VariableScope`, `VariableBindableNodeField`, `VariableBindableTextField`, `VariableBindablePaintField`, `VariableBindableColorStopField`, `VariableBindableEffectField`, `VariableBindableLayoutGridField`, `VariableBindableComponentPropertyField`, `ExtendedVariableCollection`, `MotionEasing`, `KeyframePropertyFieldName`, `ShaderPropertyValue`
- Plugin API — `boundVariables` — https://developers.figma.com/docs/plugins/api/properties/nodes-boundvariables/
- Plugin API — `setBoundVariable` — https://developers.figma.com/docs/plugins/api/properties/nodes-setboundvariable/
- Plugin API — `VariableScope` — https://developers.figma.com/docs/plugins/api/VariableScope/
- Plugin API updates index — https://developers.figma.com/docs/plugins/updates/
- Version 1, Update 133 (2026-08-05, `EASING`/`TIMING`) — https://developers.figma.com/docs/plugins/updates/2026/08/05/version-1-update-133/
- REST Variables API — https://developers.figma.com/docs/rest-api/variables/
- REST Variables endpoints — https://developers.figma.com/docs/rest-api/variables-endpoints/
- Figma MCP server — https://developers.figma.com/docs/figma-mcp-server/

**Primary — help centre**
- Guide to variables in Figma — https://help.figma.com/hc/en-us/articles/15339657135383-Guide-to-variables-in-Figma
- Overview of variables, collections, and modes — https://help.figma.com/hc/en-us/articles/14506821864087
- Create and manage variables and collections — https://help.figma.com/hc/en-us/articles/15145852043927
- Apply variables to designs — https://help.figma.com/hc/en-us/articles/15343107263511
- Modes for variables — https://help.figma.com/hc/en-us/articles/15343816063383
- Extend a variable collection — https://help.figma.com/hc/en-us/articles/36346281624471
- The difference between variables and styles — https://help.figma.com/hc/en-us/articles/15871097384471
- Variables in Dev Mode — https://help.figma.com/hc/en-us/articles/27882809912471
- Update 1: Tokens, variables, and styles — https://help.figma.com/hc/en-us/articles/18490793776023
- What's new from Config 2026 — https://help.figma.com/hc/en-us/articles/39582753756695-What-s-new-from-Config-2026
- Plans comparison (plan gating) — https://help.figma.com/hc/en-us/articles/360040328273

**Primary — other standards**
- DTCG Format Module, draft 2025.10 (published 2026-07-30) — https://www.designtokens.org/tr/drafts/format/
- Tokens Studio documentation — https://docs.tokens.studio/

**Corroboration — forum and community (used only for pain points, never for API facts)**
- Gradients in Figma variables (2025-03-17 → 2025-09-25, closed unanswered) — https://forum.figma.com/share-your-feedback-26/gradients-in-figma-variables-38653
- All plans should offer more than 4 variable modes — https://forum.figma.com/suggest-a-feature-11/launched-all-plans-should-offer-more-than-4-variable-modes-13979
- Bulk rename multiple variables at once — https://forum.figma.com/suggest-a-feature-11/bulk-rename-multiple-variables-at-once-36104
- Editing multiple variables in one batch — https://forum.figma.com/ask-the-community-7/editing-multiple-variables-in-one-batch-34297
- Deleted collections and modes don't disappear — https://forum.figma.com/ask-the-community-7/variables-deleted-collections-and-modes-don-t-disappear-24008
- Renaming collections broke references to variables — https://forum.figma.com/report-a-problem-6/renaming-collections-broke-references-to-variables-16434
- Figma typography variables (unitless / % line-height limitation) — https://frontendmasters.com/blog/figma-typography-variables/

**Rejected source.** A 2026 third-party post claiming Figma shipped "composite/array
types" for variables in a 2025 update is contradicted by `plugin-typings@1.135.0`
and is not relied on anywhere in this report.

**UIDX repo context consulted** (read only, nothing modified):
[ADR 0002](../decisions/0002-fidelity-to-figma-and-css.md),
[ADR 0004](../decisions/0004-global-document-namespace.md),
[panel-ui3-and-variables.md](../panel-ui3-and-variables.md),
`examples/core-tokens.uidx`, `examples/bound-card.uidx`,
`packages/format/src/alias.ts`, `packages/schema/src/tokens.ts`,
`packages/viewer/src/variable-binding.ts`.

---

## 14. Decisions taken (2026-08-25)

Recorded after review. **These supersede the recommendation in §7.2**, which is
kept above as the research position and the reasoning behind it.

| # | Decision | Rationale given |
|---|---|---|
| 1 | **Pure Figma-style token model.** Not the §7 hybrid, and not DTCG-native. | Export to Figma must be easy; a model that *is* Figma's needs no mapping. Consistent with ADR 0002 ("the Figma spelling wins"). |
| 2 | **Tokens, variables, collections and components are global across all files**, in design-system scope. | Matches Figma. Already satisfied by [ADR 0004 §2](../decisions/0004-global-document-namespace.md) — no change required. |
| 3 | **Explicit `type` on `<Variable>`, using Figma's own enum names** — `COLOR`, `FLOAT`, `STRING`, `BOOLEAN` (later `EASING`, `TIMING`). Replaces inference in `variableTypeOf`. | Figma never infers: type is chosen at creation, and the API is `createVariable(name, collection, resolvedType)`. A straight copy on export, no mapping table. |
| 4 | **Add a Styles concept alongside tokens**, mirroring Figma's color/text/effect/grid styles, whose paints and fields may themselves reference variables. **No composite tokens.** | Faithfulness to Figma, for export. Accepts the two-system cost documented in §2 and §4.1. |
| 5 | **Dimension values accept both spellings**; a bare number means px. | Units where needed, existing files unchanged. **See the conflict below.** |
| 6 | **Component-tier tokens live in one shared token document**, not per-component files. | Closest to Figma, where every variable sits in the file's collections. |
| 7 | **Motion tokens (`TIMING`, `EASING`) are v2**, behind Figma's open beta. | The beta is unsettled and the ms-vs-seconds contradiction (§11) is unresolved. |

### Consequences that change earlier sections

- **§7.3's proposed syntax is withdrawn** in its composite-token and DTCG-type-name
  parts. What survives: `<Tokens>`/`<Collection>`/`<Variable>`, the
  `{collection#variable}` alias, value-slot binding, modes on collections, scopes,
  descriptions.
- **§9's "v1 additions Figma does not have" is withdrawn.** Composite typography,
  shadow, border and gradient tokens are out. Per-paint opacity and units survive.
- **§9's "deliberately unsupported: Figma styles" is reversed.** Styles are now in
  scope, and the editor needs a panel for them.
- **§8's three-tier structure still holds**, with the component tier relocated to
  the shared token document per decision 6.

### Open conflict: units versus Figma export

Decision 5 and decision 1 pull against each other, and it is worth stating plainly
before a spec is written.

Figma variables are **unitless numbers**. A UIDX dimension token holding `"1.5em"`
or `"150%"` therefore has **no representable form as a Figma variable** — this is
the same limitation §1 fact 2 and §4.10 describe from the other side. So a token
file that uses units cannot round-trip to Figma losslessly, which is the goal
decision 1 was chosen to serve.

Three ways out, none yet chosen:

1. **Restrict units to px-equivalents for any token intended for export**, and have
   `uidx check` warn when a non-px unit is used in an exportable collection. Keeps
   export lossless; costs the % line-height capability precisely where Figma users
   would want it.
2. **Export lossily with a diagnostic** — resolve `1.5em` against its context to a
   px number on the way out, and report every token that was flattened. Keeps
   authoring expressive; the Figma file is then not a faithful mirror.
3. **Refuse non-px units entirely** and match Figma exactly. Simplest, and drops
   the one concrete capability the report identified Figma as lacking.

This needs settling in the spec, not before it.
