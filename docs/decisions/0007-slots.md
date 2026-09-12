# ADR 0007 — Slots: a component declares a hole, a consumer fills it

Status: **accepted**, 2026-08-26. **Amended by
[ADR 0010](0010-a-slot-may-be-a-components-direct-child.md)**: §1's first
restriction — a `<Slot>` may not be a `<Component>`'s direct child — is
withdrawn. It rested on the one-child rule, which
[ADR 0008](0008-component-is-a-frame.md) §1 deleted. §1's second restriction,
and everything else below, stands.

Approved in conversation section by section. §6 is the one section that
defers rather than decides: `.fig` export has nothing to export a slot *to*,
and F2 is where that is measured instead of guessed.

## Context

An instance can change what is already there and cannot put anything new
inside. That is the oldest complaint about component instances in any tool,
and it is the reason a design system ends up with `Card/WithChart`,
`Card/WithTable` and `Card/WithList` — three components that differ in one
region and agree everywhere else.

Figma answered it in 2025 with **slots**: a declared region inside a main
component that an instance may freely add to, resize and rearrange without
detaching. UIDX needs the same capability, for the same reason, and F5 has
carried the story since Phase 5 was drawn.

### What Figma actually built (measured against the help centre article)

A Figma slot is **a frame wearing a component property**. Three facts follow
from that one, and each of them is mechanism showing through:

1. **A slot is not a node type.** Slots "inherit frame-like properties
   including auto layout, dimensions, fills, strokes, opacity, and effects"
   because underneath, a slot *is* a `FrameNode`. The slot-ness is a
   `SLOT`-typed entry in `componentPropertyDefinitions`, bound to that frame
   the same way a `TEXT` property binds to a text layer's characters.
2. **Making one is therefore a conversion, not a creation.** ⌘⇧S converts a
   selected frame; "Wrap in new slot" makes a frame around a selection and
   binds to it; "Create property → Slot" mints the property and leaves it
   attached to nothing. There is no slot object to insert, because there is
   no slot object.
3. **Unbinding is destructive and silent.** The article warns that removing a
   slot property "is a destructive action" — every instance's content in that
   region resets — and recommends testing in a branch. That is what a binding
   with no referential integrity costs.

This is ADR 0005's situation one feature over. There, variant identity lived
in a name microformat and the axes had no declaration; the answer was to
declare the thing directly and let the schema layer build the mechanism.
The same answer applies here.

### What the SDK holds (measured, 0.14.0)

- `NodeType` is eighteen values — `CANVAS | FRAME | RECTANGLE |
  ROUNDED_RECTANGLE | ELLIPSE | TEXT | LINE | STAR | POLYGON | VECTOR |
  BOOLEAN_OPERATION | GROUP | SECTION | COMPONENT | COMPONENT_SET |
  INSTANCE | CONNECTOR | SHAPE_WITH_TEXT`. **None of them is a slot.**
- The string "slot" occurs exactly once in `@open-pencil`, inside a React
  codegen *prompt* ("**Slots** — where child content is injected"). It is
  prose, not an API.
- `componentPropertyDefinitions` carries `VARIANT`, `TEXT`, `BOOLEAN` and
  `INSTANCE_SWAP`. There is no `SLOT` type to set even if we wanted one.

So the scene graph has no slot and the `.fig` format has no slot. Whatever a
slot *is* at render time, `toSceneGraph` decides — which is exactly where
ADR 0002 puts engine shapes.

### What the format already has that this leans on

- **The one-child rule and its generalisation** (ADR 0005 §1): a
  `<Component>` holds one scene child, or its `<Variant>`s.
- **`entity#path` addressing** (ADR 0003, 0004): `#` bounds the entity, `/`
  walks inside it.
- **The bimap is general.** `MutableAddressMap` is `link(address, sceneId)` —
  two maps, not one. Nothing has ever needed the two to differ, and nothing
  has ever required them to agree.
- **D4's test for "the SDK made this, do not write it"** is *absence from the
  bimap*, read in exactly one place: `isAddressable` in `CanvasPane.vue` is
  `scene.value?.addresses.addressOf(id) !== undefined`.
- **F6's contract thesis**: a consumer names `label`, not `container/label`,
  so the component author may restructure the insides freely.

## Decision

### 1. `<Slot>` is an element, not a property binding

```mdx
<Component name="Card" status="stable" props={{ heading: { type: 'TEXT', default: 'Title' } }}>
  <Frame name="container" layoutMode="VERTICAL" itemSpacing={12} padding={16}>
    <Text name="title" characters="{heading}" />
    <Slot name="body" layoutMode="VERTICAL" itemSpacing={8} layoutGrow={1}>
      <Text name="placeholder" characters="Body goes here" opacity={0.4} />
    </Slot>
  </Frame>
</Component>
```

A slot is a first-class element with a `name`, its own layout, and its
children as **default content**. It lowers to a `FRAME` in the scene graph —
the same "the authored surface says one thing, the engine needs another" move
`nodeTypeFor` already makes when a `<Component variants>` becomes a
`COMPONENT_SET`.

`PROPERTY_TYPES` does **not** grow a fourth entry, and this is not a
stylistic preference: slot content is a *tree*, and `props` is a flat JSON5
object of scalars. A `SLOT` property would be a property whose value could
never be written in the place properties are written.

**Two restrictions, both taken from Figma because the reason survives
translation:**

- **A `<Slot>` may not be a `<Component>`'s direct child.** Figma forbids
  binding a slot property to a component's top layer. A component that is
  nothing but a hole declares no contract — it is `<Frame>` with extra
  ceremony. The one-child rule already says a component holds one scene
  child; this says that child is not a slot.

  > Withdrawn by ADR 0010. The last sentence is the load-bearing one, and ADR
  > 0008 §1 deleted the rule it leans on. A component *is* the frame now — it
  > carries its own fills, size and strokes — so a slot inside one leaves a
  > contract behind rather than emptying it. Figma's rule re-points too: the
  > top layer it will not bind a slot to is the `<Component>` itself.
- **Slot names are unique within a component**, the way sibling names already
  are. The name is the entire contract (§2), so two of them cannot collide.

A `<Slot>` is legal inside a `<Frame>`, inside a `<Variant>`, and inside a
`<Slot>`'s own default content. It is not legal on a `<Page>`: a hole outside
a component has nobody to fill it.

### 2. The fill is authored in the consuming page, keyed by slot name

```mdx
<Instance name="card-1" component="Card" props={{ heading: 'Revenue' }}>
  <Slot name="body">
    <Text name="figure" characters="$42,180" fontSize={32} />
    <Text name="delta" characters="+12% MoM" />
  </Slot>
</Instance>
```

`<Instance>` joins `CONTAINER_ELEMENTS` with `<Slot>` as its **only** legal
child. Until now an `<Instance>` had no authored children at all; this is the
one thing it may hold, and it may hold at most one per declared slot name.

The same element does both jobs, and its **position decides which**:

| Inside a `<Component>` | Inside an `<Instance>` |
|---|---|
| Declares the hole | Fills it |
| Carries layout, sizing, padding, fills, effects | Carries `name`, and nothing else |
| Children are the default content | Children are the content |

This is what makes F5's "a slot's layout belongs to the definition" a grammar
rule rather than a convention, and it is the same carve-out `<Variant>` has
for owning no geometry (ADR 0005, D4's extra predicate). A card decides how
its body sits; the consumer decides only what the body *is*. That is the
whole difference between a slot and "an instance you may add children to".

**Keying by name, not by path**, is F6's thesis one level in. The consumer
writes `body`, never `container/body`, so moving the slot inside the
definition is invisible downstream — ADR 0004's "names are the contract,
structure is not", applied to structure itself.

**Three states, three spellings:**

| In the consuming page | Renders |
|---|---|
| no `<Slot name="body">` at all | the definition's default content |
| `<Slot name="body" />` | nothing — explicitly empty |
| `<Slot name="body">…</Slot>` | the authored children |

Removing the element is Figma's "Reset slot"; the self-closing form is its
"Delete contents". Filling **replaces** the default outright rather than
merging with it: a half-replaced placeholder is not a state anyone can reason
about, and a merge would need a rule for ordering authored children among
default ones that no one would remember.

### 3. The scene id follows the definition; the address follows the file

For `card-1` above, with `Card`'s slot sitting at `container/body`:

```
address                   scene id                       writable
card-1                    card-1                         ✅ authored
card-1#container          card-1#container               ❌ generated
card-1#container/title    card-1#container/title         ❌ generated
card-1#body               card-1#container/body          ✅ authored
card-1#body/figure        card-1#container/body/figure   ✅ authored
```

The tree under one instance is now **mixed** — generated clones that D4
refuses to write, and authored fill that it must — and this is the first time
that has been true. It needs no new predicate. `expandInstance` links the
fill nodes and leaves the clones unlinked, so `isAddressable`,
`fromSceneChange`, selection and the layers rail all get the right answer
from the test they already make.

**The address cannot follow the definition.** `parse` is per-file and cannot
see `Card`'s structure; an address of `card-1#container/body/figure` would
have to be minted by the symbol table rather than by the parser, which would
put address arithmetic in two places. That is what forces id and address
apart, and the bimap being two maps rather than one is what makes the split
free.

**The scene id cannot follow the file.** `card-1#body/figure` as an id would
have a scene parent — `card-1#container/body` — that does not prefix it,
breaking "every other part of the viewer reads an id as a path", and it would
collide outright with a definition whose own root child happened to be named
`body`.

A patch to `card-1#body/figure` therefore lands in the **consuming** page,
while the identical gesture on `Card`'s own `container/title` lands in the
defining page. C1's page-addressed envelope is what makes that expressible,
and F5 named this as the update story's whole point: re-laying-out a slot is
a patch to the definition that every instance follows, and swapping one
instance's content is a patch that no other instance sees.

### 4. Slots inside variants, and instances inside slots

A `<Slot>` may sit inside a `<Variant>`. Because the fill is keyed by name,
switching variant re-applies the fill to whichever variant declares that
name — which is exactly what ADR 0005 §3 already does for overrides, for the
same reason, with no machinery added. A slot declared in one variant and not
another is legal and sparse in the same way a missing combination is: the
fill has nowhere to go in that state, and `uidx check` says so at the use
site.

An `<Instance>` inside a fill is legal, and may fill its own slots. Recursion
rides `expandInstance`'s existing `seen` chain, which is what stops a
mid-edit cyclic document from taking the renderer down.

A `<Slot>` inside a *fill* is not legal. Declaring a hole in a consuming page
means nothing — there is no consumer below.

**An `overrides` key pointing inside a filled slot is an error.** The fill is
authored; it is edited directly, by the ordinary patch path, and an override
would be a second way to say the same thing with an unstated winner. Keys
into an *unfilled* slot's default content are fine, and behave as any other
override does.

### 5. Deleting a slot is an error, not a silent reset

Figma calls removing a slot property "a destructive action" and tells you to
test it in a branch, because instances lose their content with no warning at
the site that lost it. Here the fill sites are text in files, and the symbol
table already resolves `component=` across pages — so removing a `<Slot>`
from a definition is a `uidx check` error at **every** fill site, listed by
page and address.

The branch test Figma recommends is a command here. That is the strongest
single argument for the whole model: a declared hole with a checked name has
referential integrity, and a bound property does not.

### 6. `.fig` export flattens, and reports it — deferred to F2

There is nothing to export to. The SDK has no slot node, `NodeType` has
eighteen values and none is a slot, and `componentPropertyDefinitions` has no
`SLOT` type. So F2 exports a `<Slot>` as an ordinary `FRAME` and a filled
slot as that frame's children: **the rendering is faithful, the hole is
not.** An exported card looks right in Figma and is no longer flexible there.

Export reports the loss rather than dropping it quietly, and S4's round-trip
test is where it is measured. Whether Figma's own slots can be reconstructed
on import — they exist in the app, just not in this SDK — is F2's question
and possibly an upstream patch, exactly as S5 left the component-set
definitions.

## Rationale

**Declaring the hole, because the binding is the mechanism.** Everything
uncomfortable about Figma's slots traces to the same root: the slot-ness is a
property attached to a frame rather than a thing the frame *is*. That is why
creating one is a conversion, why the property can exist unattached, and why
removing it silently resets every instance. A `<Slot>` element has none of
those states because it has no indirection to lose. This is ADR 0005's
argument verbatim, and it lands the same way: the mechanism still gets built,
in the schema layer, at render time.

**One element on both sides, because the restriction is then structural.**
"The fill may not change the layout" is a rule that has to be enforced
somewhere. As a whitelist of forbidden attributes it is a list to maintain
and to keep in sync with `KNOWN_PROPS`. As "a `<Slot>` in this position takes
no scene properties" it is one grammar rule, checked where every other
grammar rule is checked, and it reads correctly to a person: the definition
built the shelf, the consumer puts things on it.

**Name-keyed, because the alternative embeds the definition's structure in
the consumer.** Path-keyed fill (`overrides`-style) would mean moving a slot
one level deeper in the definition breaks every consuming page. ADR 0003's
rationale 2 — a consuming file never embeds more of the producing file's
structure than it must — has been the deciding argument three times now, and
this is the fourth.

**Id and address diverging, because both constraints are real and neither
bends.** The parser cannot see across files; the viewer reads ids as paths.
The bimap has been a two-map structure since it was written, so the thing
that resolves the tension costs nothing.

## What this changes elsewhere

| Where | Effect |
|---|---|
| `types.ts` | `Slot` joins `ELEMENTS`, `CONTAINER_ELEMENTS`, `NODE_CHILD_ELEMENTS` and `SceneElement`. `Instance` joins `CONTAINER_ELEMENTS`, with a new `INSTANCE_CHILD_ELEMENTS = { Slot }`. `Slot` is absent from `PAGE_CHILD_ELEMENTS` and from `COMPONENT_CHILD_ELEMENTS`. |
| `parse.ts` | Slot-name uniqueness per component; fill-side `<Slot>` takes `name` only; at most one fill per name per instance. |
| `to-scene.ts` | `NODE_TYPE.Slot = 'FRAME'`. `expandInstance` clones the definition, substitutes the fill at each slot, and **links** the fill nodes into the bimap under their file addresses. |
| D4 | The rule is unchanged and now has a second exercise: a subtree under an `<Instance>` where some nodes are linked and some are not. |
| F3 | The last bullet's gap — an instance's generated children being absent from `doc.tree` — is answered for fill children, which are in `doc.tree` already because they are authored. Generated children remain out. |
| F6 / F7 | Untouched. `props` stays scalars, `PROPERTY_TYPES` stays three. |
| F2 | §6: `<Slot>` → `FRAME`, filled content → its children, the distinction reported as lost. |
| ADR 0005 | Unchanged. Slots inside variants re-apply by name the way overrides re-apply by path. |

## Rejected alternatives

**A `SLOT` entry in `PROPERTY_TYPES`, mirroring Figma.** Faithful to the
reference and impossible to spell: `props` is a flat object of scalars and
slot content is a tree, so the property's value could never be written where
properties are written. Every fix for that — a magic sentinel value, a second
`props`-shaped attribute, children tagged by property name — reintroduces the
element this ADR ships, wearing a property's name.

**A `<Fill slot="body">` wrapper, distinct from `<Slot>`.** Two words in the
whitelist to say one thing, justified only by the two positions doing
different jobs — which the position already says, and which the grammar can
enforce either way. Rejected as ceremony.

**`slot="body"` as an attribute on each fill child.** Flattest, no wrapper
node, no address segment. It repeats the slot name on every child, gives a
multi-child fill no grouping to select or reorder as a unit, and leaves
"explicitly empty" with no spelling at all — §2's three states collapse to
two.

**Fill children absent from the bimap, like the generated ones.** Keeps D4
untouched and costs the feature its point: F5's own text says the fill has
addresses, can be selected, and shows in the rail as ordinary rows, and that
is what distinguishes a slot from a comment in the file.

**Content contracts — `min`/`max` layer counts, preferred instances, "only
allow preferred instances".** Figma's own note is that layer limits "are
designed to guide rather than restrict": exceeding one shows an orange
warning and changes nothing. A grammar entry, a checker rule, a panel control
and an export mapping, in exchange for a warning nobody must heed. It is the
natural second story if slots are used enough to want it, and there is no
cost to adding it later — a `<Slot>` with no `max` is a `<Slot>` with no
limit.

**An empty-slot indicator on canvas** (Figma's pink box). Cut with the
contracts, and it has one consequence worth writing down: an unfilled slot
with no default renders nothing and cannot be clicked. So the insert gesture
must leave the new slot selected, and the layers rail must show a `<Slot>`
row whether or not it draws anything — which it can, because the rail reads
`doc.tree` rather than the scene graph (D3).
