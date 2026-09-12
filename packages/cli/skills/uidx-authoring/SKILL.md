---
name: uidx-authoring
description: The uidx node grammar — components, variants, instances, slots, auto-layout and token aliases.
---

# UIDX node grammar

Elements (scene): `Page Component Frame Text Rectangle Ellipse Vector Instance Variant Slot`. Unknown tags are a parse error by design — don't invent one.

**Containment**
- `Page` children: `Component Frame Text Rectangle Ellipse Vector Instance`. A `Component` is a page child **only** — it can never sit inside a `Frame` or any other node. A bare `Frame` on a page is standalone scenery, not part of the system. **A page-level `Component` carries its own `x`/`y` parking its variant grid beside the page content** — left unplaced it draws at the origin, underneath whatever else is there.
- Any node (`Frame`, etc.) children: `Frame Text Rectangle Ellipse Vector Instance Slot`.
- `Component` children: that same set, plus `Variant` (legal only if the component declares `variants`) and `Slot`.
- `Instance` children: **only** `Slot`. An instance's other children are generated from its component, not authored.

**Component props** — declared on `<Component props={{...}}>`, each entry one of three types bound to one scene field: `TEXT`→`characters`, `BOOLEAN`→`visible`, `INSTANCE_SWAP`→`component`. For example:
```
<Component name="Control/Checkbox" status="draft"
  props={{
    label: { type: 'TEXT', default: 'Email me product updates' },
    showLabel: { type: 'BOOLEAN', default: true },
  }}
  variants={{
    state: ['unchecked', 'checked', 'indeterminate'],
    interaction: ['default', 'hover', 'focus', 'active', 'disabled', 'invalid'],
    size: ['md', 'sm', 'lg'],
  }}>
```
Inside, a node binds a prop by bare name in braces: `characters="{label}"`, `visible="{showLabel}"`.

**Variants** — one `<Variant>` per cell, keyed by every axis, no `name` of its own (its axis values are its address):
```
<Variant state="unchecked" interaction="default" size="md"> ... </Variant>
```

**Instances** name a component by its bare global name and set variant coordinates and prop values together in one `props` map:
```
<Instance name="sample" component="Control/Checkbox"
  props={{ state: 'checked', interaction: 'default', size: 'md', label: 'Product updates' }} />
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

## One complete component

A toggle component skeleton: Two axes declared once; each `<Variant>` assigns both and carries a single child `Frame` holding the layout; the `<Instance>` sets variant coordinates and prop values in the same `props` map.

```
<Component
  name="Control/Toggle"
  status="draft"
  props={{ label: { type: 'TEXT', default: 'Notifications' } }}
  variants={{ state: ['off', 'on'], size: ['md', 'sm'] }}
>
  <Variant state="off" size="md">
    <Frame name="row" layoutMode="HORIZONTAL" primaryAxisSizingMode="AUTO"
      counterAxisSizingMode="AUTO" counterAxisAlignItems="CENTER" itemSpacing={10}>
      <Frame name="track" layoutMode="HORIZONTAL" width={40} height={24} cornerRadius={12}
        paddingLeft={3} paddingRight={3} paddingTop={3} paddingBottom={3}
        fills={[{ type: 'SOLID', color: { r: 0.8, g: 0.81, b: 0.84, a: 1 } }]}>
        <Ellipse name="knob" width={18} height={18} />
      </Frame>
      <Text name="label" characters="{label}" fontSize={14} />
    </Frame>
  </Variant>
  <Variant state="on" size="md"> ... </Variant>
</Component>

<Instance name="notify" component="Control/Toggle" props={{ state: 'on' }} />
<Instance name="digest" component="Control/Toggle" props={{ label: 'Weekly digest' }} />
```

Note what is *not* there: no `name` on a `<Variant>`, no auto-layout on a `<Variant>`, no `State=On` anywhere, and no second component for the second state.
