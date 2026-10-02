---
name: uidx-authoring
description: The uidx node grammar — components with contracts and a styles table, instances, slots, repeats, auto-layout and token aliases.
---

# UIDX node grammar

Elements (scene): `Page Component Frame Text Rectangle Ellipse Vector Instance Variant Slot`. Unknown tags are a parse error by design — don't invent one.

**Containment**
- `Page` children: `Component Frame Text Rectangle Ellipse Vector Instance`. A `Component` is a page child **only** — it can never sit inside a `Frame` or any other node. A bare `Frame` on a page is standalone scenery, not part of the system. **A page-level `Component` carries its own `x`/`y` parking its variant grid beside the page content** — left unplaced it draws at the origin, underneath whatever else is there.
- Any node (`Frame`, etc.) children: `Frame Text Rectangle Ellipse Vector Instance Slot`.
- `Component` children: that same set, plus `Slot`, and a `Variant` only for an axis value that changes the anatomy (see below).
- `Instance` children: **only** `Slot`. An instance's other children are generated from its component, not authored.

**A component is an identity (ADRs 0012–0018).** One file per component: the tree draws its anatomy once, and everything else is declared beside it — never computed, never duplicated per state.

```
---
id: checkbox
---

Lets a user toggle one option.          ← intent: what it is for, in words

## Visual Contract

<Page>
  <Component name="Checkbox" status="stable" implements="hwc-checkbox"
    width={20} height={20} cornerRadius="{radius#sm}" fills="{surface#control}">
    <Vector name="check" part="checked-indicator" visible={false} width={12} height={12} ... />
  </Component>
</Page>

<Styles>
  <Style state="checked" root:fills="{surface#accent}" checked-indicator:visible={true} />
  <Style state="hover" root:strokes="{border#hover}" />
  <Style state="disabled" root:opacity="{opacity#disabled}" />
</Styles>

## Contract

<Props>
  <Prop name="checked" type="boolean" default={false} controllable visual>Whether the option is selected.</Prop>
  <Prop name="size" type="'sm' | 'md'" default="md" visual>Box size.</Prop>
  <Prop name="label" type="string" sample="Email me">Consumer text.</Prop>
</Props>
<Events><Event name="change" detail="{ checked: boolean }">Fires once per user toggle.</Event></Events>
<Accessibility role="checkbox" keyboard="Space toggles" />

## Behavior

- toggle: click or Space flips `checked`.
```

- **States and axes come from the contract.** A `visual` enum prop is an axis; a `visual` boolean prop is a state; `hover`, `focus`, `active` are the browser's and need no declaration. The canvas draws the whole set — never write one `<Variant>` per combination. Write a `<Variant size="sm">` tree only when a value changes the *anatomy*.
- **`<Styles>`** sits after `</Page>`. Each `<Style>` row's keys are axis values (`state="hover" size="sm"`); its other attributes are `part:prop` cells — `root` is the component frame, other names are declared parts or node names. Values are token aliases wherever a token exists. Most specific row wins; ties go to file order. Presence under a state is `part:visible={true}`, never a condition.
- **`## Contract`** (after the visual contract): `<Props>`, `<Events>`, `<Slots>`, `<States>` (only states the element produces itself, e.g. `invalid`), `<Parts>`, `<Form>`, `<Accessibility>`, `<Composes with="…" />`. Every declaration has words. Types are TypeScript-ish (`'a' | 'b'`, `boolean`, `Contact`, `Contact[]`). `sample` gives the canvas words to draw.
- **Bindings are lookups.** `characters="{label}"` binds a prop; `{item.name}` a model field; `{radius#md}` a token. No operators, no formulas.
- **`## Models`**: `<Model name="Contact">words <Field name="id" type="string" key sample={['a','b']}>words</Field>…</Model>`. A prop typed `Contact[]` is a list. Declare a model once per document.
- **Repeat** any layer over a list: `<Frame name="row" repeat="{items}" as="person">` then `{person.name}` inside; nested repeats make trees. A repeat on a `<Slot>` is the one consumers fill. The model's samples decide how many rows draw.
- **`## Behavior`**: one bullet per observable behaviour, `id: when X, the component does Y`, props and events in backticks. When two behaviours are legitimate, decide or name the prop that selects.
- **`## Examples`**: `<Example name="…"><Set at="root" state="checked" /></Example>` — sample scenes.
- `implements="hwc-…"` binds the component to a headless element; `part="…"` binds a layer to one of its parts, one node per part. `uidx check` audits every region against the others; `uidx codegen` renders HTML/CSS and React from them.

**Editing through tools.** Tree edits are `set_prop`/`insert_node`/…; the regions have their own ops: `set_style {keys, target, prop, value?}` writes one styles cell (omit `value` to clear it), `declare {contractKind, name, attrs?, description}` one contract entry (`remove: true` deletes), `set_model {name, description}`, `set_field {model, name, attrs?, description}`. Prose (intent, Behavior, Examples) is edited as text.

**Instances** name a component by its bare global name; `props` sets its contract props and its axis values together:
```
<Instance name="save" component="Button" props={{ label: 'Save', variant: 'secondary' }} />
```
A `<Slot>` fill (the one legal `Instance` child) supplies real content for a declared hole:
```
<Instance name="revenue" component="Card" props={{ heading: 'Revenue' }}>
  <Slot name="body">
    <Text name="figure" characters="$42,180" fontSize={32} fontWeight="BOLD" />
  </Slot>
</Instance>
```
Omit the `<Slot>` and the component's own default content shows instead.

**Restyle an instance from outside** (ADR 0018). An instance is a black box with a styleable outer box: write the look on the `<Instance>` itself, with a token wherever one exists.
```
<Instance name="cancel" component="Button" props={{ label: 'Cancel plan', variant: 'secondary' }}
  cornerRadius="{radius#full}" paddingLeft="{space#lg}" paddingRight="{space#lg}" textFills="{text#danger}" />
```
- **The box:** `fills`; `strokes` with `strokeWeight`, `strokeAlign`, `dashPattern` and the side weights; `cornerRadius` or the four corners, and `cornerSmoothing`; `opacity`; `effects`; `paddingTop/Right/Bottom/Left`. It lands on the frame that draws the component's look — its own frame, a styles table's `root`, or, through a frame that only wraps another, the part inside, as the Shoelace example's Button takes it on `base` — beneath the component's state rows: a hover row still wins. Over a shadow-DOM library, generated code reads only what the design states on that node, so where it states none (the Shoelace Checkbox, Switch and Input) a look its uses vary belongs in a visual prop.
- **`textFills`** colours every text inside, nested instances' texts too. It takes a `fills` value and `TEXT_FILL` tokens, and goes only on an `<Instance>`: a `Text`'s colour is its own `fills`.
- **The inside is the component's.** Besides where it sits (`x`, `y`, `width`, …), its `props`, `modes` and slot fills, an instance carries only the box and `textFills`: `layoutMode`, `itemSpacing`, alignment, text and vector props on one draw nothing (UIDX154). Never edit an instance's inner layers, reach in with `overrides`, or copy or rebuild a component to change its colour.
- **A look many uses share** (destructive, compact, on a dark surface) is a `visual` prop plus `<Styles>` rows on the component, not the same restyle on every use.
- Values are literals or tokens; a `{prop}` binding is dropped (UIDX155). `fills={[]}` means none, and removing the attribute resets it.

**Older files** may declare `props={{ label: { type: 'TEXT', … } }}` and `variants={{ … }}` with one full `<Variant>` per combination. They still parse; don't write new ones that way — `uidx check` reports a variant tree that differs only in token values as derivable.

**Auto-layout** applies to `Frame`/`Component`/`Slot` only — **never `Variant`**, which keeps a one-child rule; put the layout on the variant's single child `Frame`. Props: `layoutMode="NONE"|"HORIZONTAL"|"VERTICAL"|"GRID"`, `itemSpacing={n}`, `paddingTop/Right/Bottom/Left={n}`, `primaryAxisSizingMode`/`counterAxisSizingMode`="FIXED"|"AUTO". Alignment is **two different enums**: `primaryAxisAlignItems`="MIN"|"CENTER"|"MAX"|"SPACE_BETWEEN"; `counterAxisAlignItems`="MIN"|"CENTER"|"MAX"|"STRETCH"|"BASELINE" (no `SPACE_BETWEEN`). Real row: `layoutMode="HORIZONTAL" primaryAxisSizingMode="AUTO" counterAxisSizingMode="AUTO" counterAxisAlignItems="CENTER" itemSpacing={10}`.

**Text draws only what Inter can.** uidx renders offline with the bundled Inter faces — a character they have no glyph for makes the renderer draw *nothing for the whole text node*, silently. Stick to characters Inter covers: `Ø` not `⌀`, `×` not `✕`, words over exotic symbols; `– — • ✓ ← →` and curly quotes are all fine.

**Padding eats width.** A child's `width` is measured against its parent's width *minus* the parent's left and right padding. A section inside `<Frame width={1440} paddingLeft={72} paddingRight={72}>` has 1296 to live in, not 1440 — give it 1296, or give it no `width` at all and let the parent size it. Setting a child to its parent's full width is the single most common way to make a page whose text runs past its container, and it is invisible in a scaled-down render.

**Token aliases**: any value may be `"{collection#name}"`, e.g. `cornerRadius="{radius#md}"`. The `#` is the tell — a token alias has one, a prop binding never does (`{label}`). Bind the *numbers and colours* that have names — a page that declares a `space` scale and then types `itemSpacing={16}` has a scale it is not using. **Never bind one into `characters`**: an alias is substituted for its value, so `characters="{radius#pill}"` puts the number 999 where a string belongs and the page stops rendering entirely. To document a token's value, type it: `characters="999 (radius#pill)"`.

**Addresses**: `#` bounds an entity from the nodes inside it; after the `#`, `/` walks deeper into that entity's tree.

`/` is legal *inside a name* at the top level only — that is how Figma groups a component set. Deeper names may not contain one (the parser refuses it), so past the `#` every `/` is the walk.
```
""                          the page
"Control/Checkbox"          a top-level entity (Component or Instance); its "/" is part of the name
"Control/Checkbox#state=unchecked, interaction=default, size=md"
                            a Variant inside that entity; the name's "/" is untouched by the "#"
"doc#states/heading/title"  "doc" then three levels down — these "/" walk the tree
```
