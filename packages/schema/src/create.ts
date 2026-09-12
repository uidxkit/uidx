import type { JsonValue, UidxNodeSpec } from '@uidx/format'

/**
 * What a new node is made of (story D1).
 *
 * Here rather than in the viewer for the reason the backlog gives: the file is
 * the artifact, and what a created node looks like in it is a property of the
 * format, not of whichever surface happened to make it. A toolbar, an agent
 * and a future `uidx new` should all produce the same seven lines.
 *
 * The rule for what gets written is "what the author decided, and what the
 * engine will not give them". Measured against `defaults.ts`, a bare Frame,
 * Rectangle, Ellipse and Vector all resolve `fills` to `[]` — so a node created
 * without one is a node that draws nothing, and a creation tool that appears to
 * do nothing is worse than no tool. Everything else the engine already answers
 * (100x100, `layoutMode: NONE`, a black fill on text) is left unwritten, so the
 * diff says only what the gesture meant and the inspector shows the rest dimmed
 * the way C7 intends.
 */

/** The §3.3 elements a person can draw. Deliberately not `Component`. */
export const CREATABLE_ELEMENTS = ['Frame', 'Text', 'Rectangle', 'Ellipse', 'Vector'] as const
export type CreatableElement = (typeof CREATABLE_ELEMENTS)[number]

export function isCreatable(element: string): element is CreatableElement {
  return (CREATABLE_ELEMENTS as readonly string[]).includes(element)
}

/**
 * What a gesture can *make*, which is one more than what it can draw (F5).
 *
 * A `<Slot>` is inserted rather than swept: ADR 0007 rejected a canvas
 * indicator for an empty one, so there is nothing to drag out and "New slot"
 * places it beside the selection instead. Keeping it out of
 * `CREATABLE_ELEMENTS` keeps that list what it says it is — the toolbar's
 * shape row — while everything downstream of the spec is shared machinery.
 */
export const INSERTABLE_ELEMENTS = [...CREATABLE_ELEMENTS, 'Slot'] as const
export type InsertableElement = (typeof INSERTABLE_ELEMENTS)[number]

export interface Placement {
  /**
   * Where the author put it, in the new parent's coordinates — or null when
   * the parent lays its children out and the position is not theirs to state
   * (D4). The caller answers this with `isPositionAuthored`, the same
   * predicate a drag and a drop already ask.
   */
  at: { x: number; y: number } | null
  /**
   * The rect the author swept, or null for a click — which takes the engine's
   * own size rather than inventing one, so nothing is written that the author
   * did not decide.
   */
  size: { width: number; height: number } | null

  /**
   * Geometry the caller already has, for a `<Vector>` that was drawn rather
   * than placed (D11). Absent, a vector falls back to the placeholder below.
   */
  path?: { data: string; windingRule: 'NONZERO' | 'EVENODD' }
}

/** Figma's placeholder grey, the one thing a new shape needs to be visible. */
const PLACEHOLDER_FILL: JsonValue = [{ type: 'SOLID', color: { r: 0.85, g: 0.85, b: 0.85, a: 1 } }]

/** What an open path is painted with, since it has no inside to fill. */
const PLACEHOLDER_STROKE: JsonValue = [{ type: 'SOLID', color: { r: 0.1, g: 0.1, b: 0.1, a: 1 } }]

/** A white ground, which is what a frame is for. */
const FRAME_FILL: JsonValue = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 } }]

/**
 * A triangle across the node's box.
 *
 * A `<Vector>` with no `vectorPaths` renders nothing at all, so a vector placed
 * with no geometry would be an invisible node. Since D11 the pen supplies real
 * geometry through `Placement.path` and this is the fallback rather than the
 * normal case — it stays because `createSpec` has to be total, and a caller
 * that has no path still needs something that draws.
 */
function placeholderPath(width: number, height: number): JsonValue {
  return [
    {
      windingRule: 'NONZERO',
      data: `M0 ${height} L${width / 2} 0 L${width} ${height} Z`,
    },
  ]
}

/** The engine's own size, for the one default that has to be stated up front. */
const ENGINE_SIZE = 100

/**
 * The node a creation gesture makes.
 *
 * `name` is the caller's because the address depends on it and the caller has
 * to know where the new node will answer — `autoName` from `@uidx/format` is
 * what produces it, the same function the patcher would have used.
 */
export function createSpec(
  element: InsertableElement,
  name: string,
  placement: Placement,
): UidxNodeSpec {
  const { at, size } = placement
  const attrs: Record<string, JsonValue> = { name }
  if (at) {
    attrs.x = at.x
    attrs.y = at.y
  }
  if (size) {
    attrs.width = size.width
    attrs.height = size.height
  }

  switch (element) {
    case 'Text':
      attrs.characters = 'Text'
      // Figma's own split: a dragged text is a fixed box, a clicked one hugs
      // its characters. `NONE` is already the engine's answer for the dragged
      // case, so only the hug has to be said.
      if (!size) attrs.textAutoResize = 'WIDTH_AND_HEIGHT'
      break
    case 'Frame':
      attrs.fills = FRAME_FILL
      break
    // A slot is a hole, not a surface: it paints nothing of its own, and what
    // makes it visible is the default content the author puts in it. Vertical
    // by default so the first thing dropped in flows rather than stacking at
    // the origin — the same courtesy a new frame gets from `FRAME_FILL`.
    case 'Slot':
      attrs.layoutMode = 'VERTICAL'
      break
    case 'Vector': {
      const drawn = placement.path
      // An open path has no inside to fill, so it is stroked — the same split
      // Figma makes, and the difference between a drawn line appearing and
      // appearing to have failed.
      if (drawn && !drawn.data.trimEnd().endsWith('Z')) attrs.strokes = PLACEHOLDER_STROKE
      else attrs.fills = PLACEHOLDER_FILL
      attrs.vectorPaths = drawn
        ? [{ windingRule: drawn.windingRule, data: drawn.data }]
        : placeholderPath(size?.width ?? ENGINE_SIZE, size?.height ?? ENGINE_SIZE)
      break
    }
    default:
      attrs.fills = PLACEHOLDER_FILL
  }

  return { element, attrs }
}
