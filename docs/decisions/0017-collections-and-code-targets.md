# ADR 0017 — Collections, and code as a render target

Status: **accepted**, 2026-09-29. Part of ADR 0012.

## Context

A render prop bundles three things: the place items go, the data each item
receives, and the component that draws one. The headless layer already
separates them — a root owns selection and keyboard, items are projected
children — and the file has to declare them so every target renders the same
thing.

## Decision

### 1. Repeating slots

A slot may repeat, carry a model, and constrain what fills it:

```mdx
<Slots>
  <Slot name="item" repeats model="{models#Contact}" accepts="hwc-list-item">One filling per element of `items`.</Slot>
</Slots>
```

- `repeats` means one filling per element of the prop whose type is the
  model array.
- `model` is the parameter each filling receives.
- `accepts` names the headless root an item component must implement; the
  audit refuses a filling that does not.

### 2. `<Repeat>` in the visual contract

```mdx
<Repeat slot="item" count={3}>
  <Instance component="ContactItem" />
</Repeat>
```

A visual-only instruction, legal only on a slot declared `repeats`, whose one
child is an instance of an accepted component. The canvas expands it to
`count` clones, the n-th resolving `{item.*}` from the n-th samples. Figma
export renders instances with an instance-swap property. Code ignores
`count` and uses the contract.

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
  - a `repeats` slot becomes `items: T[]` plus `renderItem: (item: T, index)
    => ReactNode`, generic over the model's generated type, with `ItemComponent`
    accepted as sugar for a component whose `item` prop is that model; the key
    comes from the model's `key` field;
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
