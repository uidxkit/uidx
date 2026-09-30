# ADR 0013 — The component contract region

Status: **accepted**, 2026-09-29. Part of ADR 0012.

## Context

Code needs a component's public surface — props, events, states, slots,
parts, form participation, accessibility — and needs it to be the same on
every render. Today that surface exists twice: in `@hwc/components` as a
generated `custom-elements.json` plus a prose `SPEC.md`, and implicitly in a
`.uidx` component's `props` attribute. Neither is authoritative, and neither
is visible to the audit.

## Decision

### 1. Regions after the visual contract

A `.uidx` file may carry, after `## Visual Contract`, at most one each of
`## Contract`, `## Behavior`, `## Models` and `## Examples`, in any order. The
visual contract region ends at the next depth-2 heading. Everything the
parser recognised there before is unchanged; the new regions are parsed into
`doc.spec`. Files without them are unchanged.

### 2. Contract elements

`## Contract` holds elements that are not scene nodes:

```mdx
<Props>
  <Prop name="checked" type="boolean" default={false} controllable visual>Whether the option is selected.</Prop>
  <Prop name="item" type="Contact">The row to show.</Prop>
</Props>
<Events><Event name="change" detail="{ checked: boolean }">Fires once per user toggle.</Event></Events>
<States><State name="invalid">The element failed its own validation.</State></States>
<Parts><Part name="checked-indicator">The mark drawn while checked.</Part></Parts>
<Slots><Slot name="label">Consumer text; styled here, filled there.</Slot></Slots>
<Form participates submits="value while checked, nothing otherwise" />
<Accessibility role="checkbox" keyboard="Space toggles" />
<Composes with="Field" />
```

- `Prop`: `name`, `type` (a TypeScript-ish type string; a name that matches a
  `<Model>` on any page means the prop receives that model, `Contact[]` a list
  of them — ADR 0015 §2), `default`, `sample` (a demonstration value for the
  canvas and generated markup, in the sense of ADR 0015 §1 — a required text
  prop has no default and still needs words to draw; it changes nothing in
  generated code), `controllable` (framework adapters add
  controlled/uncontrolled handling), `visual` (drawn in the variant set: an
  enum prop is an axis, a boolean prop is a state — ADR 0016 §1). Text content
  is the description and is required.
- `Event`: `name`, `detail`; description required.
- `States`: only the states the element produces itself — `invalid` after
  validation, `open` on a disclosure that manages itself — as `<State name>`
  with a description. A boolean prop marked `visual` is a state already, and
  the browser's `hover`, `focus` and `active` need no declaration; most
  contracts have no `<States>` at all.
- `Parts`: optional descriptions of the headless root's parts, as `<Part
  name>`. The tree's `part="…"` bindings are the declaration; a part described
  here must be bound.
- `Slot`: consumer-filled positions; `repeats`, `of` and `accepts` are
  ADR 0017 §1. A slot named here must be a `<Slot name="…">` in the visual
  contract.
- `Form`, `Accessibility`, `Composes`: declarations copied into `SPEC.md` and
  read by the audit.

Boolean attributes (`controllable`, `visual`, `key`, `optional`,
`participates`, `repeats`) may be written bare in these regions; the
shorthand rule of the visual contract does not apply here.

### 3. Binding the visual contract to the contract

- `<Component implements="hwc-checkbox">` names the headless root. The
  component's own frame is the root's host element.
- `part="…"` on any scene node binds it to a declared part. One node per part.
- `<Slot name="…">` (ADR 0007) is the position of a declared slot.
- Only `visual` props may appear as styles-table keys (ADR 0016).
- The bindings are edited from the inspector's **Contract** tab as well as by
  hand. `uidx.json` may name the headless library's `custom-elements.json`
  (`"headless"`); the tab then offers its elements as the choices for
  `implements`, and each root's parts — the `<root>-<part>` elements, plus any
  `cssParts` — together with the contract's own `<Parts>` as the choices for
  `part`. A part is bound from the component's list or from the layer's row,
  the way Figma declares a property on the component and applies it from the
  layer; binding it from a new layer unbinds the old one, since one node per
  part is the rule. A `<Repeat>` chooses among the contract's repeating slots.
  The tab never edits the contract's prose; it shows it beside the bindings.

### 4. Declaration in uidx, implementation in code

The contract says what a component is. The headless element implements it.
A conformance check compares the element's `custom-elements.json` entry for
the `implements` tag with the uidx contract: attributes ⊆ props by name,
events by name, part tags by part name. `uidx codegen --manifest` runs it
and fails on a mismatch. The uidx file is authoritative; the code is proven to
conform.

### 5. Relation to `props={{ … }}`

The `props` attribute (story F6) stays for files that have it. When a
`## Contract` is present, its `Prop` elements are the declaration and the
audit reports a `props` attribute beside them as redundant. A `Prop` with a
primitive type and a default resolves as a component property inside the
visual contract exactly as a `props` entry does.

## Consequences

- `doc.spec.contract` is available to `uidx contract <page>`, which prints it
  as JSON for generators that do not parse MDX.
- Removing or renaming a `Prop`, `Event` or `Slot` is a breaking change for
  the component and is called out by the audit's contract diff.
- `SPEC.md` in the headless repository becomes a rendered view of this region
  once the two are linked; until then the conformance check keeps them equal.
