import { defaultFor, isIdentityProp, mappingFor, NODE_TYPE } from '@uidx/schema'
import type { JsonValue, SceneElement, UidxNode } from '@uidx/format'
import type { Rect } from './gesture-model'

/**
 * What a settled resize commits (story C10a).
 *
 * A resize is not only four numbers. `commitResizePreview` in the SDK sends
 * `x`/`y`/`width`/`height` and nothing else, so a frame that hugs its content
 * gets a new width while its axis still reads `HUG` — and D4's filter, seeing
 * a dimension the node computes for itself, drops it. Measured on the C10a
 * spike: a hugging frame resized that way produces no patch at all.
 *
 * The fix is not to weaken the filter. Dragging a resize handle in Figma
 * *switches the axis to Fixed* — the author has just said this dimension is
 * theirs — so the gesture says so, and the write becomes something the file
 * can hold. Text that measures itself is pinned for the same reason.
 *
 * The extra props ride along in the same commit, and `patch-burst` gathers
 * them into one envelope, so a resize is still one revision and one gesture.
 */

/** The slice of a scene node this decision reads. */
export interface SizingNode {
  type?: string
  layoutMode?: string
  primaryAxisSizing?: string
  counterAxisSizing?: string
  textAutoResize?: string
}

export interface ResizeWrites extends Rect {
  primaryAxisSizing?: 'FIXED'
  counterAxisSizing?: 'FIXED'
  textAutoResize?: 'NONE'
}

/** An axis the node sizes for itself, whose number the file would otherwise refuse. */
const isComputed = (sizing: string | undefined): boolean => sizing === 'HUG' || sizing === 'FILL'

/**
 * The sizing a single typed dimension implies, and nothing else.
 *
 * `resizeWrites` answers for a handle drag, which sets both dimensions at
 * once. Typing one number into the panel must touch one axis: writing the
 * other would put a size in the file the author never chose, and it would be
 * whatever layout happened to have computed.
 */
export function sizingFlipFor(
  node: SizingNode,
  dimension: 'width' | 'height',
): {
  primaryAxisSizing?: 'FIXED'
  counterAxisSizing?: 'FIXED'
  textAutoResize?: 'NONE' | 'HEIGHT'
} {
  const writes: ReturnType<typeof sizingFlipFor> = {}
  const primaryIsWidth = node.layoutMode === 'HORIZONTAL'
  const isPrimary = dimension === 'width' ? primaryIsWidth : !primaryIsWidth
  const sizing = isPrimary ? node.primaryAxisSizing : node.counterAxisSizing
  if (isComputed(sizing)) {
    if (isPrimary) writes.primaryAxisSizing = 'FIXED'
    else writes.counterAxisSizing = 'FIXED'
  }
  if (node.type === 'TEXT') {
    const mode = node.textAutoResize
    // Figma's own split, and the echo-safe one: a width typed onto auto text
    // sets the wrap and the box keeps growing downward (`HEIGHT`); a height
    // fixes the box. `NONE` for a typed width would leave a height the file
    // never authored reading as fixed on the scene node, and the next reflow
    // would write the computed number into the file (the D4 geometry echo).
    if (mode === 'WIDTH_AND_HEIGHT') {
      writes.textAutoResize = dimension === 'width' ? 'HEIGHT' : 'NONE'
    } else if (mode === 'HEIGHT' && dimension === 'height') {
      writes.textAutoResize = 'NONE'
    }
  }
  return writes
}

/**
 * The sizing facts as the *file* states them, which is what a commit must ask.
 *
 * `sizingFlipFor` needs to know whether an axis hugs. Asking the scene node is
 * wrong, and wrong in a way that cost C7 its criterion: a panel edit previews
 * before it commits, the first preview applies the flip to the graph — where
 * `runPreviewUpdates` downgrades the event so it never reaches the file — and
 * every preview after it, and then the commit, ask a node that already reads
 * `FIXED` and are told there is nothing to flip. The width lands alone and the
 * file holds a size its own sizing mode contradicts.
 *
 * So the question goes to the document, which no preview can move. This is
 * E4's policy in a second place: the file is the source of truth, and a
 * gesture in flight is not.
 *
 * An unauthored prop still has an answer — the engine's, measured by
 * `defaultFor` (C7) rather than declared here. It matters most for `<Text>`:
 * a text that never mentions `textAutoResize` still measures itself, so a
 * typed width has to pin it exactly as an authored one would.
 */
export function authoredSizing(node: UidxNode): SizingNode {
  const element = node.element as SceneElement
  const stated = (prop: string): JsonValue | undefined =>
    node.attrs[prop]?.value ?? defaultFor(element, prop)

  // The file spells the axis modes AUTO/FIXED and the scene HUG/FIXED/FILL.
  // That mapping has one home — the prop table's own `toScene`, read back
  // through the field the mapping itself names — and this is a caller of it,
  // not a second copy. A prop the table calls identity (`textAutoResize`) has
  // no mapping precisely because the two vocabularies agree.
  const sceneValue = (prop: string): string | undefined => {
    const value = stated(prop)
    if (value === undefined) return undefined
    const mapping = mappingFor(prop)
    if (!mapping) return isIdentityProp(prop) && typeof value === 'string' ? value : undefined
    const field = mapping.sceneFields[0]
    if (!field) return undefined
    const out = mapping.toScene(value)[field]
    return typeof out === 'string' ? out : undefined
  }

  const layoutMode = stated('layoutMode')

  return {
    type: NODE_TYPE[element],
    layoutMode: typeof layoutMode === 'string' ? layoutMode : undefined,
    primaryAxisSizing: sceneValue('primaryAxisSizingMode'),
    counterAxisSizing: sceneValue('counterAxisSizingMode'),
    textAutoResize: sceneValue('textAutoResize'),
  }
}

export function resizeWrites(
  node: SizingNode,
  rect: Rect,
  options: { widthOnly?: boolean } = {},
): ResizeWrites {
  const writes: ResizeWrites = { ...rect }

  if (isComputed(node.primaryAxisSizing)) writes.primaryAxisSizing = 'FIXED'
  if (isComputed(node.counterAxisSizing)) writes.counterAxisSizing = 'FIXED'

  if (node.type === 'TEXT') {
    const mode = node.textAutoResize
    // A text box that grows downward keeps doing so while only its width is
    // dragged — that gesture sets the wrap, which is what the mode is for.
    const heightIsDerived = mode === 'WIDTH_AND_HEIGHT' || (mode === 'HEIGHT' && !options.widthOnly)
    if (heightIsDerived) writes.textAutoResize = 'NONE'
  }

  return writes
}
