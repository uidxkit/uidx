import {
  defaultFor,
  instanceFills,
  instanceSceneProps,
  isIdentityProp,
  mappingFor,
  NODE_TYPE,
  type InstanceFills,
} from '@uidx/schema'
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

/** What `instanceSizing` resolves a component with — the scene build's own resolvers. */
export type InstanceScope = Parameters<typeof instanceSceneProps>[1]

/** `SizingNode` for an `<Instance>`, with what it fills and the values a cancel puts back. */
export interface InstanceSizing extends SizingNode {
  layoutGrow?: number
  layoutAlignSelf?: string
  /** The dimensions the instance tells its parent to compute (`releasedFills`). */
  fills: InstanceFills
}

/**
 * The sizing facts for an `<Instance>`, which states none of them itself.
 *
 * `authoredSizing` asks the file, and on an instance the file is silent: the
 * layout and both modes come from the component — for one with a styles
 * table, from the derived variant that wraps it — and `defaultFor` has no
 * answer for an element the sizing rows do not apply to. So it answered
 * "nothing hugs", a resize flipped nothing, and the preview was laid out
 * against the component's hug and snapped back on every frame.
 *
 * Asked here the way the build answers it, from the same document — never from
 * the scene node, for `authoredSizing`'s reason. `parentLayout` is the layout
 * the instance sits in, which says which axis an authored stretch fills.
 */
export function instanceSizing(
  node: UidxNode,
  scope: InstanceScope,
  parentLayout?: Parameters<typeof instanceSceneProps>[2],
): InstanceSizing {
  const placed = instanceSceneProps(node, scope, parentLayout)
  return {
    type: NODE_TYPE.Instance,
    layoutMode: placed.layoutMode,
    primaryAxisSizing: placed.primaryAxisSizing,
    counterAxisSizing: placed.counterAxisSizing,
    layoutGrow: placed.layoutGrow,
    layoutAlignSelf: placed.layoutAlignSelf,
    fills: instanceFills(node, parentLayout),
  }
}

/** Which of the box's four numbers a resize changed. */
export interface ResizedBox {
  x: boolean
  y: boolean
  width: boolean
  height: boolean
}

/**
 * What a resize changed, measured against the box it started from.
 *
 * `widthOnly` is the controller's word for an east or west handle. A north or
 * south handle has no word of its own, but needs none: it leaves the width
 * exactly where it was. The origin is its own question — on a rotated box a
 * side handle moves both `x` and `y` to hold the far edge still, and a top
 * handle moves `x` — so it never decides which dimension was resized.
 *
 * Up to half a pixel is no change: a commit rounds the box its previews did
 * not, and rounding moves a number by at most that — an instance centred in
 * a column sits at x 89.5 and commits at 90.
 */
export function resizedBox(from: Rect, rect: Rect, widthOnly: boolean): ResizedBox {
  const moved = (a: number, b: number): boolean => Math.abs(a - b) > 0.5
  return {
    x: moved(from.x, rect.x),
    y: moved(from.y, rect.y),
    width: widthOnly || moved(from.width, rect.width),
    height: !widthOnly && moved(from.height, rect.height),
  }
}

/**
 * What a resize writes on an `<Instance>`: the dimensions the handle moved,
 * the origin if it moved, and nothing at all on the dimension it left.
 *
 * A frame's resize sends the whole rect, because a frame states its own modes
 * and the flip says what the rect means. An instance states only its size — a
 * stated width *is* Fixed — so a height written by an east-handle drag would
 * fix an axis nobody touched, at whatever the hug happened to measure. That is
 * Figma's rule too: resizing an instance switches only the axis you dragged.
 *
 * The flips ride along for the canvas, which lays the preview out against
 * them; they never reach the file (`fromSceneChange` keeps them off an
 * `<Instance>`).
 */
export function instanceResizeWrites(
  node: SizingNode,
  rect: Rect,
  moved: ResizedBox,
): Partial<Rect> & Pick<ResizeWrites, 'primaryAxisSizing' | 'counterAxisSizing'> {
  const flip = (dimension: 'width' | 'height') => {
    const { primaryAxisSizing, counterAxisSizing } = sizingFlipFor(node, dimension)
    return {
      ...(primaryAxisSizing ? { primaryAxisSizing } : {}),
      ...(counterAxisSizing ? { counterAxisSizing } : {}),
    }
  }
  return {
    ...(moved.x ? { x: rect.x } : {}),
    ...(moved.y ? { y: rect.y } : {}),
    ...(moved.width ? { width: rect.width, ...flip('width') } : {}),
    ...(moved.height ? { height: rect.height, ...flip('height') } : {}),
  }
}

/** What letting go of an instance's fills takes: the canvas's fields and the file's removals. */
export interface FillRelease {
  fields: { layoutGrow?: number; layoutAlignSelf?: 'AUTO' }
  removals: Array<'layoutGrow' | 'layoutAlign'>
}

/**
 * The fills an instance gives up on the dimensions a size is chosen for.
 *
 * The build lets a fill the instance authors outrank a size it states — a
 * width left over from before a stretch must not undo the stretch — so a
 * size chosen by hand on a filled dimension drew while the gesture lasted and
 * was gone once the file came back. Figma turns Fill into Fixed when its
 * handle is dragged, and so does this: the fill leaves the file in the same
 * commit (`fields` keeps the preview honest meanwhile).
 */
export function releasedFills(
  fills: InstanceFills,
  dimensions: ReadonlyArray<'width' | 'height'>,
): FillRelease {
  const release: FillRelease = { fields: {}, removals: [] }
  for (const dimension of dimensions) {
    const fill = fills[dimension]
    if (fill === 'layoutGrow') release.fields.layoutGrow = 0
    else if (fill === 'layoutAlign') release.fields.layoutAlignSelf = 'AUTO'
    else continue
    release.removals.push(fill)
  }
  return release
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
