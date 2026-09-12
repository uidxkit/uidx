# ADR 0002 — The authored surface tracks Figma and CSS, not the scene graph

Status: **accepted**, 2026-08-15.

## Decision

The `.uidx` authored surface stays as close as possible to **Figma's Plugin API
vocabulary** and to **CSS's expressive range**, measured by what a designer or
developer can actually create. Where `@open-pencil/scene-graph` disagrees, the
difference is absorbed by `PROP_TABLE` in `@uidx/schema` and never surfaces in
the file.

Two corollaries:

1. When a capability can be spelled two ways, the Figma spelling wins — even if
   the engine-native one maps more directly.
2. Defaults follow what is conventionally used in Figma and CSS, not what the
   engine happens to default to.

## Consequences

**`FILL` sizing stays out of the vocabulary.** `SceneNode` supports
`LayoutSizing: 'FILL'`, and adding Figma's newer axis-absolute
`layoutSizingHorizontal` / `layoutSizingVertical` would expose it directly. But
Figma's own `primaryAxisSizingMode` / `counterAxisSizingMode` pair only has
`AUTO`/`FIXED`, and a child that fills its parent is expressed with `layoutGrow`
— which is both the Figma way and the direct analogue of CSS `flex-grow`. That
is enough. Question closed.

**`strokeAlign` is a node-level property in the file.** OpenPencil stores
alignment per stroke (`Stroke.align`), but Figma exposes it as a node-level
`strokeAlign`, and CSS authors think in terms of one border treatment per box.
So `.uidx` writes:

```jsx
strokes={[{ type: 'SOLID', color: { r: 0, g: 0, b: 0, a: 1 } }]}
strokeWeight={2}
strokeAlign="INSIDE"
```

and the schema layer folds `weight` and `align` into each `Stroke`. `INSIDE` is
the default, matching both Figma's `strokeAlign` getter and the CSS `border`
model, where a border sits inside the border box.

**Strokes are authored as Figma `Paint`s.** Figma's `strokes` is `Paint[]` —
the same shape as `fills`, carrying `type` and `color` and nothing about
geometry. OpenPencil's `Stroke` is a different record that folds in `weight`,
`align`, `cap`, `join` and `dashPattern`. The file uses the Figma shape; the
schema layer composes the engine shape from it.

## Rationale

UIDX exists to be interoperable with `.fig` tooling and legible to people with
Figma muscle memory (spec §3.3). A format that leaks engine-shaped names buys
implementation convenience at the cost of the thing it was built for. The prop
table is the designated place for that ugliness to live (spec §10), and it is
small enough — roughly sixty rows — that keeping it honest is cheap.

## Applying this to future decisions

Do not add a property whose only justification is that the scene graph stores it
that way. Ask instead: how would a Figma user name this, and what would CSS let
them express? If the answer needs a conversion, write the conversion.
