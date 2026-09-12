import type { Pin } from './pins.js'

/**
 * Typed structurally rather than against `SceneNode`, so the canvas controller
 * can ask these questions of its own fakes — the controller is tested without
 * a renderer (spike S1), and a predicate it cannot call from a test is a
 * predicate it will end up duplicating.
 */
export interface GeometryNode {
  type?: string
  parentId?: string | null
  layoutMode?: string
  layoutPositioning?: string
  primaryAxisSizing?: string
  counterAxisSizing?: string
  textAutoResize?: string
  /** Fills the parent's primary axis (Figma's "fill container" along the flow). */
  layoutGrow?: number
  /**
   * `STRETCH` fills the parent's counter axis.
   *
   * The scene graph's spelling, not the file's: `prop-table.ts` renames the
   * authored `layoutAlign` to `layoutAlignSelf` on the way in, and these
   * predicates are handed scene nodes.
   */
  layoutAlignSelf?: string
}

export interface NodeLookup {
  getNode(id: string): GeometryNode | undefined
}

/**
 * Whose decision a node's geometry is (story D4, extracted for C10).
 *
 * `fromSceneChange` asks this *after* a change arrives, to decide whether the
 * number is one the author chose or one the layout engine computed. The canvas
 * asks the same question *before* a gesture, to decide whether the gesture has
 * anywhere to write — a drag the file cannot record is one the canvas should
 * not offer.
 *
 * Both callers must ask the same question, so the question lives here and only
 * here. Two copies of this judgement would drift into a canvas that offers a
 * gesture the filter then silently discards, which is precisely the failure
 * these predicates exist to prevent.
 *
 * Position and size are decided by different things:
 *
 * - **Position is the parent's business.** A child of an auto-layout frame is
 *   placed by it; a child of a plain frame or of `<Page>` sits where somebody
 *   put it. `layoutPositioning: 'ABSOLUTE'` is Figma's escape from a parent's
 *   flow, and a node that has taken it is positioned by hand again.
 * - **Size is the node's own business.** A frame set to hug measures its
 *   content, a frame set to fill is stretched by its parent, and a text node
 *   that auto-resizes is sized by its glyphs.
 */

/**
 * The axis a dimension falls on for this node's layout mode, and therefore
 * what actually computed the value. The mapping is the SDK's own, from
 * `layout/effective-generated-text.js`.
 */
function axisSizing(node: GeometryNode, prop: 'width' | 'height'): string | undefined {
  const primary =
    (node.layoutMode === 'HORIZONTAL' && prop === 'width') ||
    (node.layoutMode === 'VERTICAL' && prop === 'height')
  return (primary ? node.primaryAxisSizing : node.counterAxisSizing) as string | undefined
}

/** Text sized by its glyphs on this axis (spec §3.3's `textAutoResize`). */
function textSizesItself(node: GeometryNode, prop: 'width' | 'height'): boolean {
  if (node.type !== 'TEXT') return false
  const mode = node.textAutoResize
  if (mode === 'WIDTH_AND_HEIGHT') return true
  return mode === 'HEIGHT' && prop === 'height'
}

/**
 * Whether the *parent* computes this dimension, because the node was told to
 * fill it (story D4, found by the F5 live pass).
 *
 * `axisSizing` above asks about the node's **own** `layoutMode` — the axis it
 * lays its children out on. `layoutGrow` and `layoutAlign` are the other
 * direction entirely: they say how this node behaves in its *parent's* flow, so
 * the axis they name is the parent's. Reading one against the other is how a
 * frame carrying `layoutGrow={1}` came to look hand-sized, and how a reflow
 * wrote a computed height into a file that had never stated one.
 *
 * Needs the graph, which is why it is separate rather than folded into
 * `axisSizing`; callers without one get the node's own answer and nothing worse
 * than the behaviour they had before.
 */
function isStretchedByParent(
  graph: NodeLookup,
  node: GeometryNode,
  prop: 'width' | 'height',
): boolean {
  // Figma's escape from the flow: an absolutely positioned child is sized by
  // hand again, exactly as it is positioned by hand again.
  if (node.layoutPositioning === 'ABSOLUTE') return false
  if (!node.parentId) return false
  const parent = graph.getNode(node.parentId)
  if (!parent) return false
  const primary =
    (parent.layoutMode === 'HORIZONTAL' && prop === 'width') ||
    (parent.layoutMode === 'VERTICAL' && prop === 'height')
  if (parent.layoutMode !== 'HORIZONTAL' && parent.layoutMode !== 'VERTICAL') return false
  return primary ? node.layoutGrow === 1 : node.layoutAlignSelf === 'STRETCH'
}

/**
 * Whether this dimension is computed rather than chosen.
 *
 * `graph` is optional so the canvas's own guard keeps working unchanged, but a
 * caller that has one gets the whole answer: a node can be sized by what it
 * contains (hug), by what it was set to (fill), by its glyphs (text) — or by a
 * parent it was told to fill, which is the case that needs the graph.
 */
export function isDerivedSize(
  node: GeometryNode,
  prop: 'width' | 'height',
  graph?: NodeLookup,
): boolean {
  if (textSizesItself(node, prop)) return true
  if (graph && isStretchedByParent(graph, node, prop)) return true
  const sizing = axisSizing(node, prop)
  return sizing === 'HUG' || sizing === 'FILL'
}

/** Whether this node's `x`/`y` are computed by its parent rather than chosen. */
export function isDerivedPosition(graph: NodeLookup, node: GeometryNode): boolean {
  if (node.layoutPositioning === 'ABSOLUTE') return false
  if (!node.parentId) return false
  const parent = graph.getNode(node.parentId)
  if (!parent) return false
  return parent.layoutMode === 'HORIZONTAL' || parent.layoutMode === 'VERTICAL'
}

/** The positive form the canvas asks: may a gesture write this node's position? */
export function isPositionAuthored(graph: NodeLookup, node: GeometryNode): boolean {
  return !isDerivedPosition(graph, node)
}

/** The positive form the canvas asks: may a gesture write this dimension? */
export function isSizeAuthored(node: GeometryNode, prop: 'width' | 'height'): boolean {
  return !isDerivedSize(node, prop)
}

/**
 * Whether the pin computes this number (ADR 0011 §5).
 *
 * A *second* question beside `isDerivedPosition`, not a wider version of it.
 * That predicate asks whether the node is placed by its parent's flow, and a
 * pinned child is not: it is positioned by hand through an offset instead of a
 * coordinate, and a gesture may still move it. Widening it would have made a
 * pinned child look flowed to `canMove`, which would then refuse to drag the
 * very nodes pins exist to make draggable.
 *
 * Takes the pin rather than looking it up, because the pin comes from the
 * *document* — the offsets have no scene field to read, and C7 already paid
 * for asking a node that a gesture in flight had already moved.
 */
export function isPinnedAxis(pin: Pin | undefined, prop: 'x' | 'y' | 'width' | 'height'): boolean {
  if (!pin) return false
  const axis = prop === 'x' || prop === 'width' ? pin.horizontal : pin.vertical
  // A size is the pin's only under STRETCH; a coordinate is the pin's under
  // every constraint that measures from somewhere other than the near edge.
  if (prop === 'width' || prop === 'height') return axis === 'STRETCH'
  return axis === 'MAX' || axis === 'STRETCH' || axis === 'CENTER'
}

/**
 * Whether anything about this element's geometry is the author's to write
 * (story F8, ADR 0005 §5 — D4's one new predicate).
 *
 * A `<Variant>` is the only element that answers no outright. Its position is
 * computed by `arrangeVariants` and its size by hugging its one child, so every
 * number the scene holds for it was generated — and it has no legal attribute
 * beyond its coordinates anyway, so a patch carrying one would produce a file
 * `uidx check` rejects (UIDX118).
 *
 * Keyed on the element rather than on the scene node, because the scene cannot
 * tell the difference: a variant is a `COMPONENT` there, exactly as a plain
 * component is. That is the set/component mechanism ADR 0002 puts in this
 * layer, and this is the one place it has to be seen through.
 */
export function hasAuthoredGeometry(element: string): boolean {
  return element !== 'Variant'
}
