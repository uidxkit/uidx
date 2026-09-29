# ADR 0016 — Variants are renders: axes from the contract, a styles table, authored trees only for structure

Status: **accepted**, 2026-09-29. Part of ADR 0012. **Amends
[ADR 0005](0005-variants.md)**: the declared-axes-and-full-trees model stays
as the *output* the canvas and Figma see; §1's "one `<Variant>` per
combination" is no longer how appearance variants are written.

## Context

ADR 0005 writes one full tree per combination. For a button with three
emphases, three sizes, an icon-only flag and five states that is ninety trees
differing only in token values — the Figma grid of cells this model exists to
replace. Only combinations that change anatomy are decisions a designer makes;
everything else is a computation over identity, props and theme.

## Decision

### 1. Axes come from the contract

A component's variant space is its `visual` enum props (ADR 0013 §2) plus the
states its headless root declares. A `variants={{ … }}` attribute is no longer
needed; when both are present they must agree.

### 2. Appearance variants: a styles table

Written once, after the root of the visual contract, keyed by prop values and
states, referencing tokens only:

```mdx
<Styles>
  <Style emphasis="primary"   root.fills="{surface#accent}" label.fills="{text#onAccent}" />
  <Style emphasis="secondary" root.fills="{surface#raised}" root.strokes="{border#default}" />
  <Style size="sm" root.height={28} label.font="{type#labelSm}" />
  <Style state="hover" emphasis="primary" root.fills="{surface#accentHover}" />
  <Style state="checked" checked-indicator.visible={true} />
  <Style state="disabled" root.opacity="{opacity#disabled}" />
</Styles>
```

- A row's keys are axis assignments; its other attributes are `part.prop`
  pairs. `root` is the component's own frame; other names are declared parts.
- Resolution is by specificity: the base tree, then rows matching one key,
  then rows matching more. Equal specificity resolves in file order.
- Values are tokens, or literals where the prop has no token type (`visible`,
  `height`). No new parts and no new props may be introduced by a row.
- Presence of a part under a state is `part.visible={true}` in a row, which
  is what replaces a `when` attribute.

### 3. Structural variants: an authored tree

When an axis value changes the anatomy, a `<Variant>` tree is written for
that value only, exactly as ADR 0005 shapes it:

```mdx
<Variant iconOnly={true}>
  <Frame part="root" width="{size#control}" height="{size#control}"><Icon slot="icon" /></Frame>
</Variant>
```

The other axes still apply their style rows on top of it. A variant tree may
omit declared parts only when the contract says that axis value has none.

### 4. Derivation

The canvas and the Figma export expand the axes into full trees at scene
build time: one component set, one tree per combination, named
`state=hover, size=sm` as ADR 0005 §3 spells it. Derived trees are synthetic:
they carry no source span, the bimap does not link them, and a gesture on one
produces no patch. Code targets never expand; they emit one component whose
CSS is keyed by attributes and states.

### 5. Audit

- Every axis value has at least one style row or one variant tree.
- A `<Variant>` tree that differs from the base only in token values is
  reported as derivable, with the rows that would replace it.
- Style rows name existing parts and props only, and only tokens where a
  token type exists.

## Consequences

- Existing files with full `<Variant>` trees remain valid; the audit
  suggests, never rewrites.
- `arrangeVariants`, `variantFor` and the `.fig` export are unchanged: they
  see the derived set exactly as they saw an authored one.
- The state axis is named `state` and its first value `default`, which is
  also the default combination ADR 0005 §2 requires.
