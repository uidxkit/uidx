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
  <Prop name="item" model="{models#Contact}">The row to show.</Prop>
</Props>
<Events><Event name="change" detail="{ checked: boolean }">Fires once per user toggle.</Event></Events>
<States structural={['checked', 'indeterminate']} styling={['hover', 'focus', 'disabled']} />
<Parts>checked-indicator, indeterminate-indicator</Parts>
<Slots><Slot name="label">Consumer text; styled here, filled there.</Slot></Slots>
<Form participates submits="value while checked, nothing otherwise" />
<Accessibility role="checkbox" keyboard="Space toggles" />
<Composes with="Field" />
```

- `Prop`: `name`, `type` (a TypeScript-ish type string, or `model`), `default`,
  `controllable` (framework adapters add controlled/uncontrolled handling),
  `visual` (may drive appearance: an axis in ADR 0016 and a Figma variant
  property). Text content is the description and is required.
- `Event`: `name`, `detail`; description required.
- `States`: `structural` states mount or unmount parts; `styling` states only
  change appearance. Both are the headless root's states.
- `Parts`: the part names the headless root defines. Every one must be bound
  in the visual contract by `part="…"`.
- `Slot`: consumer-filled positions; `repeats`, `model` and `accepts` are
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
