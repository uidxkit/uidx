import type { UidxElement } from '@uidx/format'

/**
 * Inline SVG path data, one per element.
 *
 * Inline rather than an icon font or a sprite fetched at runtime, because G7
 * forbids network calls — the same rule that made the canvas vendor CanvasKit's
 * wasm. Every path is drawn in a 12x12 box to match `--icon`.
 */
export const LAYER_ICONS: Record<UidxElement, string> = {
  Page: 'M2 1h5l3 3v7H2z',
  Component: 'M6 1l2.5 2.5L6 6 3.5 3.5zM6 6l2.5 2.5L6 11 3.5 8.5z',
  Frame: 'M3 1v10M9 1v10M1 3h10M1 9h10',
  Text: 'M2 2h8M6 2v8M4 10h4',
  Rectangle: 'M2 2h8v8H2z',
  Ellipse: 'M6 2a4 4 0 110 8 4 4 0 010-8z',
  Vector: 'M2 9C2 2 10 10 10 3M1 8h2v2H1zM9 2h2v2H9z',
  // A single diamond where `Component` is two, and outlined where that is
  // filled — Figma's own distinction between a definition and a use (F3).
  Instance: 'M6 1.5l4.5 4.5L6 10.5 1.5 6z',
  // One of a component's states (F8). The component's own two diamonds with a
  // single one beside them, outlined: it is a component in the engine's
  // vocabulary but not a thing anyone points a `component=` at.
  Variant: 'M3 2l2 2-2 2zM7 1.5l3 3-3 3-3-3z',
  // A declared hole (F5): a dashed-looking frame with its middle cut out, so
  // it reads as "somewhere content goes" rather than as content. Drawn as an
  // outline, since a slot paints nothing of its own.
  Slot: 'M2 2h3M7 2h3M10 2v3M10 7v3M10 10H7M5 10H2M2 10V7M2 5V2',
  Tokens: 'M2 3h8M2 6h8M2 9h5',
  Collection: 'M2 2h8v3H2zM2 7h8v3H2z',
  Variable: 'M4 2v8M8 2v8M2 5h8',
  // One column of a collection's table (G8): a single upright bar where
  // `Variable` is the whole grid it belongs to.
  Mode: 'M5 2h2v8H5zM2 2v8M10 2v8',
}

/** Elements drawn as outlines rather than filled shapes. */
export const STROKE_ICONS: ReadonlySet<UidxElement> = new Set([
  'Vector',
  'Frame',
  'Instance',
  'Slot',
  'Variant',
  'Text',
  'Rectangle',
  'Ellipse',
  'Tokens',
  'Variable',
])
