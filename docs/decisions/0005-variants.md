# ADR 0005 — Variants: one component, declared axes, full trees

Status: **accepted**, 2026-08-22.

## Context

Figma models a component's states — default, hover, pressed, disabled — as a
**component set**: a special container node holding one full component per
state. Three things about that model are mechanism showing through:

1. **A set is a different node type than a component.** Giving an existing
   component its first variant is a structural promotion ("combine as
   variants") that changes what the thing *is*, and un-combining is surgery.
2. **Variant identity lives in a name microformat.** A variant component is
   named `State=Hover, Size=Small`, and the set's axes are inferred from
   parsing every child's name. A typo in one name silently mints a new axis
   value.
3. **The axes have no declaration.** There is no place that states the domain
   `state ∈ {default, hover, pressed, disabled}` — it is the union of whatever
   the names currently say, so there is nothing to validate against.

UIDX needs variants — a design system without component states is not one —
and it needs them to export to Figma, because export is a first-class goal
(ADR 0004). But the file format and the editor can be simpler than the
mechanism Figma exposes, so long as the *model* stays Figma's underneath:
axes with string values, one full tree per combination, an instance picking a
combination.

F6 deferred `VARIANT`-typed component properties with the note "variants need
a grammar of their own first". This is that grammar.

### What the SDK holds (measured, 0.14.0)

- `NodeType` includes `COMPONENT_SET`; a `SceneNode` carries
  `componentPropertyDefinitions` (`type: 'VARIANT'` with `variantOptions`),
  `variantPropSpecs` (`{ propDefId, value }` on each variant component), and
  `componentPropertyValues` on an instance.
- `@open-pencil/scene-graph/variant-name` exports `parseVariantName` /
  `buildVariantName`, whose one canonical spelling is
  `state=hover, size=sm`.
- The editor API is complete: `createComponentSetFromComponents`,
  `findVariantByValues`, `getDefaultVariantForComponentSet`,
  `switchInstanceVariant`, `collectVariantOptions`, and
  `getComponentSetVariantConflicts` all exist on `createComponentActions`.
- `.fig` round-trip (spike S5, `fig-roundtrip.test.ts`): a `COMPONENT_SET`
  survives as a `COMPONENT_SET` and its children as named `COMPONENT`s, but
  `componentPropertyDefinitions` and `variantPropSpecs` come back empty, and
  the exporter writes the set node as a plain `FRAME` — neither `STATE_GROUP`
  nor an `isStateGroup` flag appears anywhere in the SDK. What the Figma app
  makes of an exported set therefore rests on the child names until F2
  verifies it in Figma itself.

## Decision

### 1. A component with variants is still one `<Component>`

There is no `<ComponentSet>` element and no promotion. A component that has
variants declares them and holds one `<Variant>` per combination; a component
that does not is exactly what it is today. The entity, its name, its `status`
and its consumers are unchanged by gaining or losing variants.

```mdx
<Component name="Button/Primary" status="stable"
  variants={{ state: ['default', 'hover', 'pressed', 'disabled'] }}>
  <Variant state="default">
    <Frame name="container" ...>
      <Text name="label" characters="Click Me" />
    </Frame>
  </Variant>
  <Variant state="hover">
    <Frame name="container" ...>
      <Text name="label" characters="Click Me" />
    </Frame>
  </Variant>
</Component>
```

The one-child rule generalises rather than breaks: a `<Component>` holds
exactly one scene child, or — when `variants` is declared — one or more
`<Variant>` children, each holding exactly one scene child. Declaring
`variants` over plain children is an error; a `<Variant>` outside a component
that declares `variants` is an error; mixing the two shapes is an error.

### 2. Axes are declared once; a variant assigns them as attributes

`variants` is an ordered object: each key is an **axis**, each value the
axis's string domain. The first value of each axis is its default, and the
default combination must exist as a `<Variant>`. A `<Variant>`'s attributes
are exactly the declared axes — every axis assigned, every value from its
domain, every combination unique, and nothing else legal on the element. The
§3.3 scene-property whitelist does not apply to `<Variant>`, the same
carve-out the token tree has: an axis assignment is no more an unknown scene
property than `value` on a `<Variable>` is.

Combinations beyond the default may be sparse — a `size=lg, state=disabled`
nobody designed is a combination that does not exist, not an obligation. An
instance asking for a missing combination is a `uidx check` error at the use
site.

Axis names and values may not contain `#`, `/`, `=` or `,` — the four
characters §3 below gives jobs to. Axis names share one namespace with F6's
component property names, because F7 assigns both through one `props` object;
a collision is a duplicate-declaration error against both locations, G4's
rule restated.

There is deliberately **no name microformat anywhere in the authored
surface**. `State=Hover` as identity-in-a-string is the thing being removed;
it survives only as a *derived* spelling (§3), generated and checked, never
hand-maintained.

### 3. The variant's address segment is derived from its coordinates

A `<Variant>` carries no `name`. Its name — and therefore its address segment
— is derived from its coordinates in declared axis order, in the SDK's own
`buildVariantName` spelling:

```
Button/Primary                                the component
Button/Primary#state=hover                    one of its variants
Button/Primary#state=hover/container/label    a node inside that variant
Button/Primary#state=hover, size=sm           with a second axis
```

This drops into the existing address law with no new algebra: the variant is
a depth-1 child, so `addressOf` joins it with `#` and everything beneath it
with `/`, exactly as today. Because the segment is derived, changing a
variant's coordinates *is* a rename, and rides the same remap machinery
(`remapAddress`) renames already ride.

The derivation lives in `@uidx/format`, which owns names and addresses; a
drift test in `@uidx/schema` pins it to the SDK's `buildVariantName`, the
package that can see both.

**Override keys never name a variant.** An instance override is written
against the tree of whichever variant is active — `'container/label'`, not
`'state=hover/container/label'` — and re-applies by path when the variant
switches. That is Figma's own behaviour (overrides survive switching when
names match), and it keeps ADR 0003's rationale 2 intact: a consuming file
never embeds more of the producing file's structure than it must.

### 4. An instance picks a variant through `props`

Variant axes are assigned exactly where F7 assigns TEXT and BOOLEAN
properties — one surface, one spelling:

```jsx
<Instance name="save" component="Button/Primary"
  props={{ state: 'hover', label: 'Save' }} />
```

An unset axis falls back to its default, so
`<Instance component="Button/Primary" />` renders the default combination
with nothing said. Assigning is a one-attribute edit to the consuming page;
resetting to the default is `remove` on that key. F6's "VARIANT is out of
scope" carve-out is lifted by this ADR: the declaration is the `variants`
attribute, not a property row, so F6's grammar is untouched.

### 5. Variant arrangement is generated, never authored

The viewer lays a component's variants out itself — the first axis varies
along a row, further axes stack rows — inside a labelled set outline, the way
Figma draws the dashed purple frame. Those positions are scenery, not
decisions: they never appear in the file, never become patches (D4's law,
extended with one predicate: a `<Variant>` has no legal geometry at all), and
export computes the same arrangement so the `.fig` opens looking like the
canvas. One layout function, in `@uidx/schema`, used by both.

This deletes a whole class of Figma busywork — dragging variants around
inside the purple frame produces diffs in Figma and produces nothing here —
at the cost of one freedom nobody asked to keep.

## Rationale

**Full trees, because the write path already works on them.** Every node of
every variant is an authored source span, so the bimap, span patching,
selection, the layers rail and `fromSceneChange` apply verbatim — editing the
hover variant's fill is an ordinary one-line patch to an ordinary node. This
is the decisive argument; see the delta model under Rejected alternatives for
what any compression of those trees would break.

**One entity kind, because promotion is the sharpest edge being removed.** In
Figma, giving a component its first variant changes the node's type and
re-homes it; here it is a diff that wraps the child in
`<Variant state="default">` and adds an attribute — the name, the consumers
and the instances are untouched. A reference `component="Button/Primary"`
resolves to a component in both worlds, and whether it has variants is the
component's own business. ADR 0002 asks how a Figma *user* names the thing:
they say "the button's hover state", one component with states — the set/
component split is the Plugin API's mechanism, and the schema layer is the
designated place for mechanism (it builds the `COMPONENT_SET` at render and
export time).

**Declared axes, because a domain you can state is a domain you can check.**
The declaration is what the panel control, the export definitions and the
diagnostics are generated from — and cross-checking it against the variants
present turns drift into an error against both locations instead of a
silently minted axis value.

## What this changes elsewhere

| Where | Effect |
|---|---|
| Grammar tables (`types.ts`) | `Variant` joins `ELEMENTS` and `CONTAINER_ELEMENTS`; legal only directly under a `<Component>` that declares `variants`. `variants` joins the component's metadata-shaped attrs, not `KNOWN_PROPS`. |
| F6 | The "VARIANT is out of scope" bullet is resolved: axes are declared by `variants`, not by property definitions, so F6 ships TEXT / BOOLEAN / INSTANCE_SWAP unchanged and never grows a VARIANT row. |
| F7 | `props` accepts axis keys alongside property names; the panel renders an axis as the enum control its domain implies. One namespace, collisions reported against both declarations. |
| F3 | Override keys are unchanged in shape and gain the "never name a variant" rule above. |
| F2 | Export maps `<Component variants>` → `COMPONENT_SET` + definitions, `<Variant>` → child `COMPONENT` named by `buildVariantName`, instance `props` → `componentPropertyValues` with `componentId` resolved by `findVariantByValues`. The S5 gaps — dropped definitions, no `STATE_GROUP` — are F2's first verification, upstream via `patches/` if real Figma needs them. |
| D4 | One new predicate: nothing about a `<Variant>`'s geometry is authored. |

## Rejected alternatives

**A `<ComponentSet>` entity element, mirroring the Plugin API.** Faithful to
the node vocabulary and rejected on ADR 0002's own test, which is about how
people name things, not how the API stores them. It would put two entity
kinds behind every `component=` reference, make gaining-a-first-variant a
change of element and of what consumers point at, and preserve in the format
the exact promotion ceremony this ADR exists to delete. The `COMPONENT_SET`
node still exists — in the scene graph and the `.fig`, built by the schema
layer, which is where ADR 0002 says engine shapes live.

**The name microformat** (`<Variant name="state=hover">`, or Figma's own
`State=Hover` children). Identity in a string that must be parsed to be
checked, where a typo mints an axis value and a rename is a rewrite. The
spelling is kept — as the *derived* address segment and export name, where it
is generated from checked attributes and cannot drift.

**A base tree plus per-variant deltas.** The smallest possible file and the
strongest protection against variants drifting apart — and it breaks the
system's one load-bearing rule. A non-base variant's nodes would be generated
at render time with no authored source span, so "the address space covers
authored source spans only" (D4), the bimap, and every patch path fail at
once: editing the hover variant on canvas would need a delta-inference layer,
which is reprinting by another name. Structural divergence (an icon that
exists only when `state=hover`) would force the delta grammar to grow
insert/remove — a patch format living inside the file format. What the delta
model actually wants is already elsewhere: tokens (G5) absorb cross-variant
repetition of values, and side-by-side rendering is what makes structural
drift visible.

**Inferred axes, Figma's way.** No declaration to keep in sync — and nothing
to check against, no stated order for the panel, and a default that is a
positional accident. Inference also makes the axis domain a *consequence* of
the variants present, so deleting the last `state=pressed` variant silently
deletes the value from every instance's picker. Declaring is one line.
