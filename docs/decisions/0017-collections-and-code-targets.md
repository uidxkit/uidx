# ADR 0017 — Collections, and code as a render target

Status: **accepted**, 2026-09-29. Part of ADR 0012.

## Context

A render prop bundles three things: the place items go, the data each item
receives, and the component that draws one. The headless layer already
separates them — a root owns selection and keyboard, items are projected
children — and the file has to declare them so every target renders the same
thing.

## Decision

### 1. Lists in the contract

A list is a prop whose type is a model's name with `[]`; the model is written
once, on the prop's type, and its element type is what each row receives:

```mdx
<Props>
  <Prop name="items" type="Contact[]">The people to choose from, in order.</Prop>
</Props>
<Slots>
  <Slot name="item" accepts="hwc-list-item">One filling per element of `items`.</Slot>
</Slots>
```

`accepts` on a slot names the headless root an item component must
implement; the audit refuses a filling that does not. Whether a slot repeats
is not the contract's to say: the tree says it, below.

### 2. `repeat` on any layer

```mdx
<Frame name="row" repeat="{items}" as="person">
  <Text name="name" characters="{person.name}" />
  <Frame name="tags" repeat="{person.tags}" as="tag">
    <Text name="tag-name" characters="{tag.label}" />
  </Frame>
</Frame>
```

Repeating is per layer, the way Vue's `v-for`, Angular's `@for` and Plasmic's
"repeat this element" are: `repeat="{list}"` on any layer of a component —
frame, text, vector, instance or slot — draws that layer once per item of the
list, and the layer's parent is the outer structure (the column of a list,
the row of a tree). The list is a list prop of the contract (`{items}`) or a
list field of an enclosing item (`{person.tags}`), so nesting a repeat inside
a repeat is a tree. `as` names the item for the bindings below (`item` unless
said), and `{as.field}` bindings resolve against the list's model, whose
`key` field keys the rows. The model decides how many rows the canvas draws:
its longest sample list, three when it has none. The tree says only what
repeats — there is no count to keep in step with the samples.

A repeat on a `<Slot>` is the one consumers fill: code renders it as a render
prop named after the slot (`renderItem(item, index)`), with the slot's
placeholder as the default content, and `accepts` on the declared slot
constrains what a consumer passes. A repeat on any other layer is the
component's own, rendered in place. The toolbar's Repeat tool writes
`repeat="{…}"` on the selected layer with the nearest list it can place — an
enclosing item's list field before the contract's own lists, so a layer
inside a row walks the row — and names a nested item after its list
(`child` for `{item.children}`), since `item` would hide the outer item; the
Repeat section of the Design tab (and the Contract tab, which shows the
same section) edits the list and `as` from the layer, names a first item so
it hides no prop or outer item, lists what in the template reads the item,
and can declare a new list prop of a model in place. The canvas
expands a repeat to one row per sample, the n-th resolving `{as.*}` from the
n-th samples: the first row is the layer itself, selected and edited like any
other, and the rows after it (`row-2`, `row-3`) are generated echoes that
follow it. Figma export renders instances with an instance-swap property.
Code uses the contract.

An instance inside a repeat receives the item only when the use binds it:
`props={{ item: '{item}' }}`, or a field of it (`{child.owner}`), exactly
as a token is applied. Nothing is inferred from types — an unbound instance
draws its own preview sample on every row, and code passes nothing — so what
the file says is all that happens.

> **Amended 2026-10-01.** This replaces the inference first written here (a
> prop typed by the item's model received it automatically). Inference made
> results depend on type matching a designer never sees; explicit binding
> keeps the canvas, the code and the file in step.

The editor keeps the designer's side to choices, not syntax. On any layer
inside a component, the Repeat section is a switch and a model picker
("Person · 5 items"): picking a model reuses a list of it the layer can
reach — an enclosing item's list field, then a list prop — or declares one
named after the model (`people: Person[]`) in the same edit, and names the
item so it hides nothing. Inside, the bind button on a text's content and on
a component's properties lists the item and its fields of the right type.
A model's content is managed on the Models face as items — rows of a table,
stored as each field's sample list (ADR 0015 §2).

### 3. Code targets

A new package, `@uidx/codegen`, renders identities to code. It reads the
parsed document, never MDX, and is a pure function of the file: same input,
same bytes.

- **HTML/CSS**: one stylesheet per component. Tokens become CSS custom
  properties; the base tree becomes rules on the root and part elements;
  style rows become rules keyed by `[prop="value"]` attributes and by states
  (`[checked]`, `[disabled]`, `:hover`, `:focus-visible`). Plus one markup
  fragment per component showing its anatomy with sample content.
- **React**: one component per identity, wrapping the headless root with props
  typed from the contract and events as `on*` callbacks. Slots are the
  contract's answer to render props:
  - a plain slot becomes a `ReactNode` prop of the slot's name (`label`,
    `description`), and a slot named `default` becomes `children`;
  - a slot that repeats becomes its list prop, required, plus a render prop
    named after the slot — `renderItem: (item: T, index) => ReactNode` —
    typed by the model, with the slot's placeholder as the default; a repeat
    on any other layer becomes a `map` in place; the key comes from the
    model's `key` field;
  - a part the library exposes as a shadow part (`cssParts` in its
    manifest, rather than a `<root>-<part>` element) is styled through
    `::part(name)` and never filled: the library draws it, and the design's
    own drawing under that node serves the canvas and Figma. That is how such
    a library works, not a finding, so conformance says nothing about it. The
    inspector marks such parts so the author knows which kind they bound.
  - `uidx.json`'s `codegen` names the output folder and the targets, which
    the Project section of the Connect tab sets; the command line and the
    Code tab's "Write code" button write the same files there.
  - parts with their own element are emitted as compound sub-components
    (`Field.Label`) so a consumer may compose below the pattern level.
  Emitted as readable source.
- **Contract JSON**: `uidx contract <page>` prints `doc.spec` for generators
  that do not parse MDX.
- **Conformance**: with `--manifest custom-elements.json`, each `implements`
  tag is checked against the manifest (ADR 0013 §4).

### 4. Cross-target conformance

The example package holds fixtures rendered by every target. Golden files are
committed; a change in output with no change in input fails CI.

## Consequences

- `examples/design-system` is a workspace package that vendors the built
  `@hwc/components` until it is published, and shows Checkbox, Field,
  CheckboxField, Button and a radio group with a model, end to end.
- Figma export of repeats and derived sets is measured, not assumed; ADR 0007
  §6's deferral stands until F2.
