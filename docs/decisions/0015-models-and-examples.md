# ADR 0015 — Models declare inputs; examples are sample scenes

Status: **accepted**, 2026-09-29. Part of ADR 0012.

## Context

A list renders items, and each item design needs to know what an item
contains. React solves this with a render prop; the design tools have no data
at all. The file needs a written contract for the data a component receives,
and sample values so the canvas and Figma have something to draw.

## Decision

### 1. A model is a view model, declared, never computed

```mdx
## Models

<Model name="Contact">
  One row of the contacts list. Every value is display-ready.
  <Field name="id" type="string" key>Stable identity, used for keys and selection.</Field>
  <Field name="name" type="string" sample={['Ada Lovelace', 'Grace Hopper']}>Display name.</Field>
  <Field name="initials" type="string" sample={['AL', 'GH']}>Shown when no avatar is supplied. Supplied, not derived.</Field>
  <Field name="email" type="string" optional sample={['ada@example.com', null]}>Omitted when unknown.</Field>
</Model>
```

- A model is the declared type of what a component **receives**. It is not
  state, and nothing in it is computed by the component. A derived value is a
  field, supplied by the consumer's adapter.
- Types are primitives, string enums, `image`, `date`, arrays, and references
  to other models. No methods.
- Every field carries a description; the audit refuses one without.
- `sample` is a value or a list of values. A list gives a repeat varied rows;
  a `null` entry shows the absent-optional layout. Required fields must have
  a sample.
- Exactly one `key` field per model used by a repeating slot.
- Models live in the file that uses them or on a shared models page, and are
  referenced as `{models#Contact}`, the alias syntax tokens already use.

### 2. Bindings are lookups

A prop declared with `model="{models#Contact}"` makes `{item.name}` a legal
alias inside the component's visual contract, resolving to the prop's field.
In the canvas it resolves to the model's sample (the n-th sample inside a
repeat); in code to `item.name`; in Figma to a text or image property. Only
`{prop.field}` and `{prop.field.field}` are allowed — no operators, no
transforms. `{item.name | initials}` is a formula and is not permitted.

An absent optional field leaves its bound part empty; a text part collapses.
That is a rendering rule, not a condition in the file.

### 3. Examples are sample scenes

```mdx
## Examples

<Example name="second-selected">
  <Set slot="item" count={3} />
  <Set at="item[1]" state="selected" />
  <Set at="item[2].status" value="offline" />
</Example>
```

An example sets counts, states and sample overrides by index. The canvas and
Figma render each example as a scene. Code ignores examples, with one
exception the emitters may use: an example is exactly a Storybook story or a
visual regression fixture, and may be emitted as one.

## Consequences

- The consumer owns one adapter per model, and that adapter is the only place
  derivation happens. An agent building a feature reads the model and writes
  the mapping; the design system never sees application data.
- Removing or retyping a field is a breaking change for every component bound
  to the model; the audit lists them.
