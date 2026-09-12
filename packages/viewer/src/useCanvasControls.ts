import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue'
import { isPositionAuthored, isSizeAuthored } from '@uidx/schema'
import {
  grabRadius,
  handleAt,
  nearestHandle,
  resizeCursor,
  rotateAbout,
  movedRect,
  nudged,
  resizedRect,
  rotationFor,
  type Handle,
  type HandlePoints,
  type Point,
  type Rect,
} from './gesture-model'
import { resizeWrites } from './resize-writes'
import type { FlowSlot } from './flow-reorder'
import {
  closesPath,
  overlay as penOverlay,
  vertexAt,
  type PenOverlay,
  type PenVertex,
} from './pen-model'
import {
  handleNear,
  handleVisibility,
  moveHandle,
  moveVertex,
  overlay as vertexOverlay,
  removeVertex,
  vertexNear,
  type HandleRef,
  type Subpath,
  type VertexOverlay,
  type VertexRef,
} from './vertex-edit'
import { isTypingTarget } from './tool-keys'
import { drawingBounds, graphicShape, isGraphicShape, simplifyPencil } from './graphics-tools'
import {
  insertVertex,
  pointStyle,
  segmentNear,
  type VectorAction,
  type VectorEditInfo,
} from './vertex-edit'

/**
 * Navigation and selection — and deliberately nothing that mutates the document.
 *
 * The SDK ships `useCanvasInput`, which would give this for free — but it also
 * enables dragging nodes, drawing and text editing. Until write-back exists
 * (Phase 3) those edits would live only in the scene graph: the file would not
 * change, and because `file:changed` is now reconciled by diffing *documents*,
 * nothing would ever correct the divergence. The canvas would quietly stop
 * matching the file it claims to render.
 *
 * So navigation is implemented against the editor's viewport API, which cannot
 * mutate the document. Swap this for `useCanvasInput` when the canvas is allowed
 * to write.
 *
 * The controller is split from the Vue wrapper so the behaviour can be tested
 * against fakes, without a DOM or a component instance.
 */

/** Roughly matches the feel of trackpad zoom in other design tools. */
export const ZOOM_SENSITIVITY = 0.0015
export const MIN_ZOOM = 0.02
export const MAX_ZOOM = 256
/** Pointer travel, in px, still treated as a click rather than a drag. */
export const CLICK_SLOP = 4
/** How far outside a corner the rotate grip reaches, in canvas units at 100%. */
export const ROTATE_ZONE = 16

/**
 * Figma's rotate cursor, as data.
 *
 * The zone is a small patch of empty space just outside a corner — invisible,
 * and so undiscoverable that the gesture may as well not exist without this.
 * There is no standard CSS cursor for rotation, so the glyph is drawn here and
 * carried inline.
 */
const ROTATE_CURSOR =
  'url("data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20">' +
      '<g fill="none" stroke="black" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M15 10 A5 5 0 1 1 10 5"/><path d="M10 1.5 L10 5 L13 5"/></g>' +
      '<g fill="none" stroke="white" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M15 10 A5 5 0 1 1 10 5"/><path d="M10 1.5 L10 5 L13 5"/></g>' +
      '</svg>',
  ) +
  '") 10 10, crosshair'

/** The slice of a scene node a gesture reads. */
export interface EditableNode extends Rect {
  id: string
  parentId?: string | null
  type?: string
  layoutMode?: string
  layoutPositioning?: string
  primaryAxisSizing?: string
  counterAxisSizing?: string
  textAutoResize?: string
  rotation?: number
}

export interface ViewportEditor {
  state: {
    panX: number
    panY: number
    zoom: number
    selectedIds: Set<string>
    /** The container the author has stepped into, if any (Figma's deep select). */
    enteredContainerId: string | null
  }
  setZoomAroundPoint(level: number, centerX: number, centerY: number): void
  zoomToFit(): void
  zoomToSelection(): void
  zoomTo100(): void
  screenToCanvas(sx: number, sy: number): { x: number; y: number }
  selectAtPoint(cx: number, cy: number): void
  select(ids: string[], additive?: boolean): void
  enterContainer(id: string): void
  exitContainer(): void
  clearSelection(): void
  setHoveredNode(id: string | null): void
  hitTestAtPoint(cx: number, cy: number, deep?: boolean): { id: string } | null
  requestRender(): void
  /**
   * A redraw of what is on screen, without declaring the scene changed.
   *
   * `requestRender` bumps the editor's `sceneVersion`, which is the key on
   * the renderer's cached picture of the whole page — right after a graph
   * write, ruinous after a pan. Calling it per wheel tick made an 11k-node
   * page re-record itself every frame (~300ms) instead of replaying the
   * picture (~10ms). Optional only because the fake editors in older tests
   * predate it; a controller falls back to a full render where it is absent.
   */
  requestRepaint?(): void

  /**
   * Outlines the container a drop would land in (C10b).
   *
   * The renderer already draws this from `state.dropTargetId`, so the gesture
   * only has to say which node. Optional like every other write-side call: a
   * host that cannot reparent never sets it, and the drag stays a move.
   */
  setDropTarget?(id: string | null): void

  /**
   * The sweep rectangle, while a creation tool is drawing one (D1).
   *
   * The SDK already draws this — it is the same overlay a marquee selection
   * uses — so the draw gesture gets its only affordance without the canvas
   * having to render anything of its own, and without a half-made node in the
   * scene graph to clean up if the gesture is abandoned.
   */
  setMarquee?(rect: Rect | null): void

  /**
   * The caret between two flowed siblings, while a reorder is in flight (D7).
   *
   * The renderer draws it already, so an honest "it will land here" costs
   * nothing — and it is the right affordance rather than a half-right one:
   * a flowed child cannot follow the pointer without writing geometry its
   * parent owns, which is the whole reason the drag is a reorder.
   */
  setLayoutInsertIndicator?(caret: FlowSlot['caret'] | null): void

  /**
   * The path the pen is part-way through drawing (D11).
   *
   * The renderer draws vertices, tangent handles and the rubber band from
   * `state.penState`, so the gesture only has to say what it has so far. The
   * SDK exposes no setter for it — unlike the other overlays — so the host
   * assigns the state field, the way the controller already does for pan.
   */
  setPenState?(state: PenOverlay | null): void

  /**
   * The path whose points are being edited, with the selected one called out
   * (D12).
   *
   * `state.nodeEditState` is the SDK's own overlay and it does the whole job:
   * it draws the vertices and their handles, it suppresses the node's ordinary
   * draw and its selection box, and it re-renders the shape from the vertices
   * given here rather than from the graph. That last part is why a vertex drag
   * writes nothing at all until it settles — the preview is the overlay, not a
   * scene mutation, so there is no `runPreviewUpdates` scope to keep honest.
   *
   * Assigned to the state directly, like `setPenState`, because the SDK ships
   * no action for it.
   */
  setVertexEditState?(state: VertexOverlay | null): void

  /**
   * Where a node sits in canvas space.
   *
   * A node's own `x`/`y` are relative to its parent, and the pointer is not —
   * so a nested node's grips are nowhere near where its rect claims. Only the
   * scene graph can answer this, because a rotated ancestor makes it more than
   * a sum of offsets.
   */
  absolutePositionOf?(id: string): { x: number; y: number } | undefined

  /**
   * The node's rotation in canvas space, ancestors included. A rotated node's
   * grips are not where its axis-aligned rect puts them.
   */
  /**
   * Where the eight grips are drawn, in canvas space — the scene graph's own
   * `getWorldHandles`, the same answer the renderer draws from, so hit-testing
   * and drawing cannot disagree whatever rotation or ancestor transform
   * applies. Dots computed from it sat exactly on the drawn grips; every
   * locally-derived model tried before it did not.
   */
  handlesOf?(id: string): HandlePoints | undefined

  /**
   * Everything below is what the canvas needs to *write* (story C10a), and all
   * of it is optional: absent, the controller offers navigation and selection
   * exactly as it did before write-back existed. That is not a courtesy to the
   * tests — it is the property this module was written to keep. A canvas that
   * can only do what was implemented for it cannot quietly stop matching the
   * file it renders.
   */
  graph?: {
    getNode(id: string): EditableNode | undefined
    updateNodePreview(id: string, changes: object): void
    runPreviewUpdates(fn: () => void): void
  }
  updateNode?(id: string, changes: object): void
  commitMove?(originals: Map<string, { x: number; y: number }>): void
  commitResize?(nodeId: string, original: Rect): void
  commitRotation?(nodeId: string, origRotation: number): void
}

/** A gesture in flight. Null between gestures. */
type Gesture =
  | { kind: 'move'; id: string; origin: Point; rect: Rect }
  | { kind: 'draw'; element: string; origin: Point }
  | { kind: 'reorder'; id: string; origin: Point }
  | { kind: 'resize'; id: string; handle: Handle; origin: Point; rect: Rect; rotation: number }
  | { kind: 'rotate'; id: string; centre: Point; origin: Point; rotation: number }

/**
 * The slice of the canvas element the controller touches.
 *
 * Handlers are typed as `EventListener` so a real `HTMLCanvasElement` satisfies
 * this without a cast at the call site; the controller casts once, internally.
 */
export interface CanvasLike {
  addEventListener(
    type: string,
    handler: EventListener,
    options?: boolean | AddEventListenerOptions,
  ): void
  removeEventListener(type: string, handler: EventListener): void
  getBoundingClientRect(): { left: number; top: number }
  /** Set so the pointer can say what a press would do. Absent in tests that don't care. */
  style?: { cursor: string }
  setPointerCapture?(id: number): void
  releasePointerCapture?(id: number): void
}

export interface KeyTarget {
  addEventListener(type: string, handler: EventListener): void
  removeEventListener(type: string, handler: EventListener): void
}

export interface CanvasController {
  zoom(): number
  /**
   * Re-runs the in-flight gesture's last preview, for after a remote document
   * has been applied to the graph. The file is the source of truth and its
   * changes land mid-drag too — but they land holding the file's values for the
   * dragged node, and without this the node sits snapped back to them until the
   * pointer next moves. A no-op between gestures.
   */
  reapplyPreview(): void
  /** Abandons a half-drawn pen path — for when the tool is put away (D11). */
  cancelPen(): void
  /** Steps back out of a node's points, without committing anything (D12). */
  cancelVertexEdit(): void
  editVector(id: string): boolean
  vectorAction(action: VectorAction): void
  finishDrawing(): void
  refreshVectorEdit(): void
  destroy(): void
}

export function createCanvasController(
  canvas: CanvasLike,
  editor: ViewportEditor,
  options: {
    keyTarget?: KeyTarget
    onChange?: () => void
    onSelectionChange?: (ids: string[]) => void
    /**
     * Whether a scene id corresponds to something the file declares.
     *
     * Deep select can otherwise land on generated content — instance children,
     * once F3 lands — and selecting one would offer properties no patch can
     * write back. Absent means "everything is addressable", which is true today.
     */
    isAddressable?: (id: string) => boolean
    onEnteredChange?: (id: string | null) => void

    /**
     * The container a drop at this point would reparent into, or null for
     * "this is a plain move" (C10b).
     *
     * Scene ids in, a scene id out: the question is a *document* one — the
     * rail's `moveFor` decides it, through `drop-target.ts` — and the
     * controller has no document. Asking the host keeps the one rulebook where
     * the rail already reads it, and keeps this module the same
     * document-unaware state machine it was.
     */
    dropTargetFor?: (draggedId: string, point: Point) => string | null

    /**
     * A settled drop. The host emits the `move-node`; the graph is left alone
     * until the file answers, exactly as a rail drag does — a scene reparent
     * here would be the double-write the rail was built to avoid.
     */
    onReparent?: (draggedId: string, parentId: string) => void

    /**
     * The creation tool the toolbar has armed, or null for selecting (D1).
     *
     * A getter rather than a value, because the toolbar changes it between
     * gestures and the controller is built once. Absent means the canvas can
     * only select and edit, which is exactly where it stood before D1 —
     * the same property every other write-side hook here keeps.
     */
    tool?: () => string | null

    /**
     * A settled draw: where the node goes, and how big the author drew it.
     *
     * `size` is null for a click, which means "put one here at whatever size it
     * comes with" rather than a node of nothing. `at` is the sweep's top-left
     * either way, so the host always knows where — which is also what decides
     * the parent.
     */
    onCreate?: (element: string, at: Point, size: { width: number; height: number } | null) => void

    /**
     * The slot a drag through an auto-layout parent is over (D7), or null when
     * this child cannot be reordered.
     *
     * Its presence is what turns the old refusal into a gesture: absent, a
     * flowed child is undraggable exactly as it was before D7.
     */
    flowSlotAt?: (childId: string, point: Point) => FlowSlot | null

    /** A settled reorder, as an index among the siblings without this child. */
    onReorder?: (childId: string, index: number) => void

    /**
     * A finished pen path (D11), in canvas coordinates.
     *
     * Absent, `P` falls back to the sweep every other tool uses — the same
     * "a canvas can only do what was implemented for it" property every hook
     * here keeps.
     */
    onPenPath?: (vertices: PenVertex[], closed: boolean, name?: string) => void

    /**
     * The path a node holds, in canvas coordinates, or null for a node that
     * has none (D12).
     *
     * Canvas coordinates rather than the node's own, because the pointer is in
     * them and because a nested or rotated node makes the conversion a matrix
     * the controller cannot build. The host has the scene graph and the SDK's
     * `getWorldMatrix`, so it converts on the way out and back on the way in —
     * the same division `absolutePositionOf` and `handlesOf` already keep.
     *
     * Absent, a double-click descends into containers exactly as it did before
     * D12 and a `<Vector>` is a leaf like any other.
     */
    vertexPathOf?: (id: string) => { subpaths: Subpath[]; windingRule: string } | null

    /** A settled vertex or handle drag: the whole path, in canvas coordinates. */
    onVertexPath?: (id: string, subpaths: Subpath[]) => void

    /**
     * Vertex editing opened on a node, or closed (null).
     *
     * The host needs both ends: opening is when it warns that the first edit
     * will re-spell the path (ADR 0006 §8), and closing is what lets the shell
     * give Delete back to the node it was taking from.
     */
    onVertexEdit?: (id: string | null) => void
    onVectorInfo?: (info: VectorEditInfo | null) => void
    writable?: () => boolean
    onResize?: (
      id: string,
      rect: Rect,
      mode: 'preview' | 'commit' | 'cancel',
      widthOnly: boolean,
    ) => void
  } = {},
): CanvasController {
  const keyTarget = options.keyTarget ?? (globalThis as unknown as KeyTarget)
  /** The viewport moved, or the hover changed: nothing in the scene did. */
  const repaint = (): void => {
    if (editor.requestRepaint) editor.requestRepaint()
    else editor.requestRender()
  }
  const notify = (): void => {
    repaint()
    options.onChange?.()
  }

  let panning = false
  let lastX = 0
  let lastY = 0
  let spaceHeld = false
  /** Where a left press started, so a drag is not mistaken for a click. */
  let pressAt: { x: number; y: number } | null = null

  const emitSelection = (): void => {
    options.onSelectionChange?.([...editor.state.selectedIds])
    options.onEnteredChange?.(editor.state.enteredContainerId)
  }

  /** Canvas coordinates for a pointer event. */
  const toCanvas = (event: { clientX: number; clientY: number }) => {
    const rect = canvas.getBoundingClientRect()
    return editor.screenToCanvas(event.clientX - rect.left, event.clientY - rect.top)
  }

  const onWheel = (event: WheelEvent): void => {
    // Without this the page scrolls and pinch-zooms the whole document.
    event.preventDefault?.()

    // Browsers report trackpad pinch as a wheel event with ctrlKey set; cmd is
    // included so the mouse-wheel gesture matches the platform convention.
    if (event.ctrlKey || event.metaKey) {
      const rect = canvas.getBoundingClientRect()
      const next = clamp(
        editor.state.zoom * Math.exp(-event.deltaY * ZOOM_SENSITIVITY),
        MIN_ZOOM,
        MAX_ZOOM,
      )
      editor.setZoomAroundPoint(next, event.clientX - rect.left, event.clientY - rect.top)
    } else {
      editor.state.panX -= event.deltaX
      editor.state.panY -= event.deltaY
    }
    notify()
  }

  const onPointerDown = (event: PointerEvent): void => {
    // Middle button, or space held — the two conventions people already have.
    if (event.button === 1 || spaceHeld) {
      panning = true
      lastX = event.clientX
      lastY = event.clientY
      canvas.setPointerCapture?.(event.pointerId)
      event.preventDefault?.()
      return
    }
    if (event.button !== 0) return
    pressAt = { x: event.clientX, y: event.clientY }

    // What this press could become, decided now while the pointer is still
    // where it landed. Nothing is written until it travels.
    armed = null
    const point = toCanvas(event)

    /*
     * An armed tool takes the press outright — it does not pick, and it does
     * not find a grip. Drawing over a selected node's own handles is the
     * ordinary way to make a shape inside it, so a tool that deferred to the
     * grips would be unusable exactly where it is most wanted.
     *
     * The gesture starts here rather than after the click slop, because a
     * click with a tool armed is itself a creation ("put one here"), not a
     * selection that happened not to travel.
     */
    /*
     * Vertex editing is the innermost mode, so it takes the press before any
     * of them. Nothing else can be running underneath it: entering closes the
     * pen and arming a tool leaves it.
     */
    if (vertexEdit) {
      const target = vertexTargetAt(point)
      if (target) {
        vertexEdit.selected = 'handle' in target ? target.handle : target.vertex
        vertexEdit.drag = target
        vertexEdit.moved = false
        canvas.setPointerCapture?.(event.pointerId)
        showVertexEdit()
        notify()
        return
      }
      // A press on the shape itself is a miss, not a way out — an author who
      // lands 10px off a point should not be dropped out of the mode. Outside
      // the node is a way out, which is what stops the mode being a trap for
      // anyone who does not know Escape.
      const node = editor.graph?.getNode(vertexEdit.id)
      if (node && within(screenRectOf(node), point)) {
        vertexEdit.selected = null
        showVertexEdit()
        notify()
        return
      }
      leaveVertexEdit()
      // Falls through: the press goes on to select whatever it landed on.
    }

    if (options.tool?.() === 'Pencil' && options.onPenPath && options.writable?.() !== false) {
      pencil = [point]
      showPencil()
      canvas.setPointerCapture?.(event.pointerId)
      return
    }

    if (penArmed()) {
      if (pen && closesPath(pen.vertices, point, editor.state.zoom)) {
        finishPen(true)
        return
      }
      pen ??= { vertices: [], pulling: false }
      pen.vertices.push(vertexAt(point, null))
      pen.pulling = true
      showPen(point)
      canvas.setPointerCapture?.(event.pointerId)
      notify()
      return
    }

    const tool = options.tool?.()
    if (tool && options.writable?.() !== false) {
      gesture = { kind: 'draw', element: tool, origin: point }
      canvas.setPointerCapture?.(event.pointerId)
      return
    }

    const selected = soleSelection()
    if (selected) {
      const handle = canResize(selected) ? gripAt(selected, point) : null
      if (handle) {
        armed = { point, id: selected.id, handle, rotate: false }
        canvas.setPointerCapture?.(event.pointerId)
        return
      }
      if (nearRotateGrip(selected, point)) {
        armed = { point, id: selected.id, handle: null, rotate: true }
        canvas.setPointerCapture?.(event.pointerId)
        return
      }
    }
    const hit = pick(point.x, point.y, isDeep(event))
    if (hit && editor.graph?.getNode(hit.id)) {
      armed = { point, id: hit.id, handle: null, rotate: false }
      canvas.setPointerCapture?.(event.pointerId)
    }
  }

  const onPointerMove = (event: PointerEvent): void => {
    if (panning) {
      editor.state.panX += event.clientX - lastX
      editor.state.panY += event.clientY - lastY
      lastX = event.clientX
      lastY = event.clientY
      notify()
      return
    }
    if (pencil) {
      const point = toCanvas(event)
      const last = pencil[pencil.length - 1]!
      if (Math.hypot(point.x - last.x, point.y - last.y) * editor.state.zoom >= 2)
        pencil.push(point)
      showPencil()
      return
    }
    if (vertexEdit?.drag) {
      const point = toCanvas(event)
      const drag = vertexEdit.drag
      vertexEdit.subpaths =
        'handle' in drag
          ? moveHandle(vertexEdit.subpaths, drag.handle, point, {
              // Alt breaks a smooth point, which is Figma's modifier for it.
              independent: event.altKey === true,
            })
          : moveVertex(vertexEdit.subpaths, drag.vertex, point)
      vertexEdit.moved = true
      showVertexEdit()
      notify()
      return
    }
    if (pen) {
      const point = toCanvas(event)
      if (pen.pulling) {
        // The vertex stays where it was placed; the drag only pulls its
        // handles, which is what makes a press-and-pull draw a curve.
        const anchor = pen.vertices[pen.vertices.length - 1]!
        pen.vertices[pen.vertices.length - 1] = vertexAt({ x: anchor.x, y: anchor.y }, point)
        showPen(point)
      } else {
        showPen(point, closesPath(pen.vertices, point, editor.state.zoom))
      }
      notify()
      return
    }
    if (gesture) {
      advance(toCanvas(event), event)
      return
    }
    // A press only becomes a gesture once it has out-travelled a click.
    if (armed && pressAt) {
      const travelled = Math.hypot(event.clientX - pressAt.x, event.clientY - pressAt.y)
      if (travelled > CLICK_SLOP) {
        startGesture(toCanvas(event))
        if (gesture) {
          advance(toCanvas(event), event)
          return
        }
        // Nothing to write here — drop the arming so the press stays a click.
        armed = null
      }
    }
    if (vertexEdit) {
      // The points are the only thing a press can take here, so they are the
      // only thing the hover should speak about — a node highlight underneath
      // an open edit would offer a selection the press will not make.
      updateCursor(toCanvas(event))
      repaint()
      return
    }
    // Hover feedback, so it is obvious what a click would hit — which means it
    // has to honour the same modifier the click will.
    const point = toCanvas(event)
    const hit = pick(point.x, point.y, isDeep(event))
    editor.setHoveredNode(hit?.id ?? null)
    updateCursor(point)
    repaint()
  }

  /**
   * Cmd (macOS) or Ctrl elsewhere: Figma's deep select, which reaches straight
   * past containers to the leaf under the cursor.
   */
  const isDeep = (event: { metaKey?: boolean; ctrlKey?: boolean }): boolean =>
    event.metaKey === true || event.ctrlKey === true

  /**
   * The node a gesture should act on.
   *
   * Deep hits are filtered to nodes the file actually knows about: the SDK can
   * return generated content — instance children, once F3 lands — and selecting
   * one would offer an author properties no patch can write back (see D4).
   */
  const pick = (x: number, y: number, deep: boolean): { id: string } | null => {
    const hit = editor.hitTestAtPoint(x, y, deep)
    if (!hit) return null
    if (deep && options.isAddressable && !options.isAddressable(hit.id)) {
      return editor.hitTestAtPoint(x, y, false)
    }
    return hit
  }

  /* ---------------------------------------------------------------- edits */

  /** In flight, or null. A gesture only starts once the press has travelled. */
  let gesture: Gesture | null = null

  /** The last pointer state `advance` saw, so the preview can be re-run. */
  let lastAdvance: { point: Point; shiftKey: boolean; altKey: boolean } | null = null
  /** The press that may yet become a gesture: where it landed, and on what. */
  let armed: { point: Point; id: string; handle: Handle | null; rotate: boolean } | null = null
  /**
   * The container the move in flight would drop into, or null. Recomputed on
   * every pointer move rather than cached from the press, because the answer
   * is a fact about where the pointer *is*.
   */
  let dropTarget: string | null = null
  /** The slot the reorder in flight would land in, or null before it has moved. */
  let slot: number | null = null

  /**
   * The path the pen is building, or null.
   *
   * Held apart from `gesture` because it is the first modal gesture here: every
   * other one begins and ends inside a single press, and this one spans as many
   * presses as the author needs. `pulling` is true only while the press that
   * placed the newest vertex is still down and dragging its handles out.
   */
  let pen: { vertices: PenVertex[]; pulling: boolean } | null = null

  /** Whether `P` should draw rather than sweep. */
  const penArmed = (): boolean =>
    options.tool?.() === 'Vector' &&
    options.onPenPath !== undefined &&
    options.writable?.() !== false
  let pencil: Point[] | null = null
  const showPencil = (): void => {
    editor.setPenState?.(
      pencil
        ? penOverlay(
            pencil.map((p) => vertexAt(p, null)),
            null,
          )
        : null,
    )
    notify()
  }
  const finishPencil = (keep: boolean, end?: Point): void => {
    const points = pencil
    pencil = null
    editor.setPenState?.(null)
    if (keep && points && options.writable?.() !== false) {
      if (end && Math.hypot(end.x - points.at(-1)!.x, end.y - points.at(-1)!.y) > 0)
        points.push(end)
      const vertices = simplifyPencil(points, 1 / Math.max(editor.state.zoom, 0.01))
      if (vertices.length >= 2) options.onPenPath?.(vertices, false, 'Pencil')
    }
    notify()
  }

  /**
   * The path whose points are being edited, or null (D12).
   *
   * Modal like `pen`, and for the same reason: it outlives the press that
   * opened it. Unlike the pen it holds an *existing* node's geometry, so the
   * two never overlap — a tool is armed for one and no tool is armed for the
   * other — but they are held apart all the same, because they end differently.
   * The pen commits a node and this one commits a property.
   *
   * `subpaths` is the live model: every drag rewrites it and nothing else does.
   * The scene graph is not touched until the drag settles, and even then only
   * through the vouched write the file needs — the overlay is the preview.
   */
  let vertexEdit: {
    id: string
    subpaths: Subpath[]
    windingRule: string
    selected: VertexRef | null
    drag: { vertex: VertexRef } | { handle: HandleRef } | null
    /** Whether the drag in flight has actually moved anything worth writing. */
    moved: boolean
  } | null = null

  const showVertexEdit = (): void => {
    if (!vertexEdit) {
      editor.setVertexEditState?.(null)
      options.onVectorInfo?.(null)
      return
    }
    options.onVectorInfo?.({
      id: vertexEdit.id,
      points: vertexEdit.subpaths.reduce((sum, p) => sum + p.vertices.length, 0),
      paths: vertexEdit.subpaths.length,
      selected: vertexEdit.selected !== null,
      closed: vertexEdit.selected
        ? vertexEdit.subpaths[vertexEdit.selected.subpath]!.closed
        : vertexEdit.subpaths.length === 1
          ? vertexEdit.subpaths[0]!.closed
          : null,
      canDelete:
        !!vertexEdit.selected && removeVertex(vertexEdit.subpaths, vertexEdit.selected) !== null,
    })
    editor.setVertexEditState?.(
      vertexOverlay(
        vertexEdit.id,
        vertexEdit.subpaths,
        vertexEdit.selected,
        vertexEdit.windingRule,
      ),
    )
  }

  /**
   * Step into a node's points, if it has any.
   *
   * Returns whether it took the gesture, so the double-click handler can fall
   * through to its container descent for everything else. Selecting the node is
   * part of entering: the inspector and the rail should be showing the thing
   * whose points are on screen.
   */
  const enterVertexEdit = (id: string): boolean => {
    if (
      !options.onVertexPath ||
      options.writable?.() === false ||
      (options.isAddressable && !options.isAddressable(id))
    )
      return false
    const path = options.vertexPathOf?.(id)
    if (!path || path.subpaths.length === 0) return false
    if (pen) finishPen(false, false)
    if (pencil) finishPencil(false)
    vertexEdit = { id, ...path, selected: null, drag: null, moved: false }
    if (!editor.state.selectedIds.has(id)) editor.select([id])
    options.onVertexEdit?.(id)
    emitSelection()
    showVertexEdit()
    notify()
    return true
  }

  const leaveVertexEdit = (): void => {
    if (!vertexEdit) return
    vertexEdit = null
    editor.setVertexEditState?.(null)
    options.onVertexEdit?.(null)
    options.onVectorInfo?.(null)
    notify()
  }

  /** One settled edit, handed over as the whole path. The host makes the patch. */
  const commitVertexEdit = (): void => {
    if (!vertexEdit || options.writable?.() === false) return
    options.onVertexPath?.(vertexEdit.id, vertexEdit.subpaths)
  }

  /**
   * What a press inside vertex editing lands on.
   *
   * Handles before vertices, which is the opposite of the obvious order and is
   * what makes a short tangent reachable: a handle whose grip sits inside its
   * own vertex's grab radius would otherwise be unclickable at any zoom the
   * author is actually working at. The reason it is safe to put them first is
   * that `handleAt` ignores zero-length tangents — so a corner point, whose
   * handles sit exactly on top of it, is never shadowed by them — and only
   * tests the handles the overlay is drawing.
   */
  const vertexTargetAt = (point: Point): { vertex: VertexRef } | { handle: HandleRef } | null => {
    if (!vertexEdit) return null
    const zoom = editor.state.zoom
    const visible = handleVisibility(vertexEdit.subpaths, vertexEdit.selected)
    const handle = handleNear(vertexEdit.subpaths, point, zoom, visible)
    if (handle) return { handle }
    const vertex = vertexNear(vertexEdit.subpaths, point, zoom)
    return vertex ? { vertex } : null
  }

  const showPen = (cursor: Point | null, closing = false): void => {
    if (!pen) {
      editor.setPenState?.(null)
      return
    }
    editor.setPenState?.(penOverlay(pen.vertices, cursor, { closing, dragging: pen.pulling }))
  }

  /**
   * Hand the path over, or throw it away.
   *
   * A single point is not a shape — the file would hold a `<Vector>` that draws
   * nothing — so finishing one discards it rather than writing it.
   */
  const finishPen = (closed: boolean, keep = true): void => {
    const path = pen
    pen = null
    pressAt = null
    armed = null
    editor.setPenState?.(null)
    if (keep && path && path.vertices.length >= 2 && options.writable?.() !== false)
      options.onPenPath?.(path.vertices, closed)
    notify()
  }

  /**
   * Delete on a chosen point (D12).
   *
   * Refused rather than committed when it would leave no path at all —
   * `removeVertex` answers that — because a `<Vector>` with no geometry draws
   * nothing, and removing the shape is D2's gesture on the node rather than
   * this one on its last point. The selection is dropped either way: the index
   * it named is not the point it named any more.
   */
  const removeSelectedVertex = (): void => {
    if (!vertexEdit?.selected) return
    const next = removeVertex(vertexEdit.subpaths, vertexEdit.selected)
    if (!next) return
    vertexEdit.subpaths = next
    vertexEdit.selected = null
    showVertexEdit()
    commitVertexEdit()
    notify()
  }

  const vectorAction = (action: VectorAction): void => {
    if (!vertexEdit || options.writable?.() === false) return
    if (action === 'delete') {
      removeSelectedVertex()
      return
    }
    const ref = vertexEdit.selected
    let next: Subpath[] | null = null
    if (action === 'toggle-closed') {
      const at = ref?.subpath ?? (vertexEdit.subpaths.length === 1 ? 0 : -1)
      if (at < 0) return
      next = vertexEdit.subpaths.map((p, i) => (i === at ? { ...p, closed: !p.closed } : p))
    } else if (ref) {
      if (action === 'insert') {
        // An open path's last point inserts into its preceding segment.
        const chain = vertexEdit.subpaths[ref.subpath]!
        const edge =
          !chain.closed && ref.index === chain.vertices.length - 1
            ? { ...ref, index: ref.index - 1 }
            : ref
        next = insertVertex(vertexEdit.subpaths, edge)
        if (next) vertexEdit.selected = { ...edge, index: edge.index + 1 }
      } else next = pointStyle(vertexEdit.subpaths, ref, action === 'smooth')
    }
    if (!next) return
    vertexEdit.subpaths = next
    showVertexEdit()
    commitVertexEdit()
    notify()
  }

  /** Highlights the container a drop would land in, and only when it changes. */
  const showDropTarget = (id: string | null): void => {
    if (id === dropTarget) return
    dropTarget = id
    editor.setDropTarget?.(id)
  }

  /** The node's rect in its own coordinates — what a write has to be expressed in. */
  const rectOf = (node: EditableNode): Rect => ({
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
  })

  /**
   * The node's rect in canvas coordinates — what the pointer has to be tested
   * against. Falls back to the local rect when nothing can place the node,
   * which is correct for a node whose parent is the origin.
   */
  const screenRectOf = (node: EditableNode): Rect => {
    const at = editor.absolutePositionOf?.(node.id)
    return at ? { ...rectOf(node), x: at.x, y: at.y } : rectOf(node)
  }

  /**
   * How far the node is turned on screen, which its grips follow.
   *
   * `node.rotation` directly — NOT `getAbsoluteRotation`, whose convention is
   * inverted (it reported 292.933 for a node whose rotation is 67.067). v1
   * documents cannot author rotated ancestors, so the node's own angle is the
   * screen angle.
   */
  const screenRotationOf = (node: EditableNode): number => node.rotation ?? 0

  /** The grip under a point: where the renderer drew it, or derived as a fallback. */
  const gripAt = (node: EditableNode, point: Point): Handle | null => {
    const drawn = editor.handlesOf?.(node.id)
    if (drawn) return nearestHandle(drawn, point, grabRadius(editor.state.zoom))
    return handleAt(screenRectOf(node), point, editor.state.zoom, screenRotationOf(node))
  }

  /**
   * Just outside a corner is Figma's rotate grip. Measured from the drawn
   * corners where the graph can say, so the zone turns with the node; the
   * rect-derived fallback covers a host that cannot.
   */
  const nearRotateGrip = (node: EditableNode, point: Point): boolean => {
    const drawn = editor.handlesOf?.(node.id)
    if (!drawn) return inRotateZone(screenRectOf(node), point, screenRotationOf(node))
    const reach = ROTATE_ZONE / Math.max(editor.state.zoom, 0.01)
    const grab = grabRadius(editor.state.zoom)
    const centre = { x: (drawn.nw.x + drawn.se.x) / 2, y: (drawn.nw.y + drawn.se.y) / 2 }
    for (const corner of ['nw', 'ne', 'se', 'sw'] as const) {
      const at = drawn[corner]
      const distance = Math.hypot(point.x - at.x, point.y - at.y)
      if (distance <= grab || distance > reach) continue
      // Outside the box: further from the centre than the corner itself.
      const outward =
        Math.hypot(point.x - centre.x, point.y - centre.y) >
        Math.hypot(at.x - centre.x, at.y - centre.y)
      if (outward) return true
    }
    return false
  }

  /** Whether this node's position is the author's to write (D4, via `authorship.ts`). */
  const canMove = (node: EditableNode): boolean =>
    editor.graph !== undefined && isPositionAuthored(editor.graph, node)

  /**
   * Whether a grip may write. A resize says what it means — flipping a hugged
   * axis to fixed — so a hugging frame is resizable; what is not resizable is
   * a node with no size of its own to claim.
   */
  const canResize = (node: EditableNode): boolean =>
    node.width > 0 || node.height > 0 || isSizeAuthored(node, 'width')

  /** The one selected node, when there is exactly one and the graph is writable. */
  const soleSelection = (): EditableNode | null => {
    if (!editor.graph || !editor.updateNode) return null
    const ids = [...editor.state.selectedIds]
    if (ids.length !== 1) return null
    return editor.graph.getNode(ids[0]!) ?? null
  }

  /** Whether a canvas-space point is inside a canvas-space rect. */
  const within = (rect: Rect, point: Point): boolean =>
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height

  /**
   * Just outside a corner is Figma's rotate grip. Inside the box it would
   * fight the move gesture, so the zone sits beyond the bounds only.
   */
  const inRotateZone = (rect: Rect, point: Point, rotation = 0): boolean => {
    const reach = ROTATE_ZONE / Math.max(editor.state.zoom, 0.01)
    const centre = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
    const local = rotateAbout(point, centre, -rotation)
    const outside =
      local.x < rect.x ||
      local.x > rect.x + rect.width ||
      local.y < rect.y ||
      local.y > rect.y + rect.height
    if (!outside) return false
    const nearX = Math.min(Math.abs(local.x - rect.x), Math.abs(local.x - rect.x - rect.width))
    const nearY = Math.min(Math.abs(local.y - rect.y), Math.abs(local.y - rect.y - rect.height))
    return nearX <= reach && nearY <= reach
  }

  /**
   * Show the gesture without writing anything — C4's preview half.
   *
   * Through `editor.updateNode` rather than the graph's own preview write,
   * because only the editor's version runs layout for the node it touched.
   * Without that a dragged node follows the pointer while its parent's flow
   * stands still, and everything snaps into place on release — the jump this
   * routes around. `runPreviewUpdates` is what keeps it a preview: it
   * downgrades the event so no patch is emitted, the same way the panel's own
   * scrub preview does.
   */
  const preview = (id: string, changes: object): void => {
    editor.graph?.runPreviewUpdates(() => editor.updateNode?.(id, changes))
    notify()
  }

  const startGesture = (point: Point): void => {
    if (options.writable?.() === false) return
    if (!armed || !editor.graph) return
    const node = editor.graph.getNode(armed.id)
    if (!node) return
    if (armed.handle) {
      gesture = {
        kind: 'resize',
        id: node.id,
        handle: armed.handle,
        origin: armed.point,
        rect: rectOf(node),
        rotation: screenRotationOf(node),
      }
    } else if (armed.rotate) {
      // The visual centre: midpoint of the drawn diagonal, since the node's
      // rect origin is the rotation pivot and the axis-aligned centre is not
      // where a turned node's middle sits.
      const drawn = editor.handlesOf?.(node.id)
      const screen = screenRectOf(node)
      const centre = drawn
        ? { x: (drawn.nw.x + drawn.se.x) / 2, y: (drawn.nw.y + drawn.se.y) / 2 }
        : { x: screen.x + screen.width / 2, y: screen.y + screen.height / 2 }
      gesture = {
        kind: 'rotate',
        id: node.id,
        centre,
        origin: armed.point,
        rotation: node.rotation ?? 0,
      }
    } else {
      /*
       * A child its parent lays out cannot be *moved* — its x/y are the
       * layout's (D4), and C10a refused the drag outright for it. D7 gives the
       * gesture a different meaning rather than no meaning: the drag names an
       * index. Absent a host that can answer that, the refusal stands.
       */
      const flowed = !canMove(node)
      if (flowed && !options.flowSlotAt) return
      // Dragging an unselected node takes it, the way Figma does.
      if (!editor.state.selectedIds.has(node.id)) {
        editor.select([node.id])
        emitSelection()
      }
      gesture = flowed
        ? { kind: 'reorder', id: node.id, origin: armed.point }
        : { kind: 'move', id: node.id, origin: armed.point, rect: rectOf(node) }
    }
    void point
  }

  const advance = (point: Point, event: { shiftKey?: boolean; altKey?: boolean }): void => {
    if (!gesture) return
    lastAdvance = { point, shiftKey: event.shiftKey === true, altKey: event.altKey === true }
    const delta = { x: point.x - gesture.origin.x, y: point.y - gesture.origin.y }
    if (gesture.kind === 'draw') {
      if (isGraphicShape(gesture.element)) {
        const shape = graphicShape(gesture.element, gesture.origin, point, event)
        const vertices = shape.closed ? [...shape.vertices, shape.vertices[0]!] : shape.vertices
        editor.setPenState?.(penOverlay(vertices, null))
      } else editor.setMarquee?.(drawingBounds(gesture.origin, point, event))
      notify()
      return
    }
    if (gesture.kind === 'reorder') {
      const next = options.flowSlotAt?.(gesture.id, point) ?? null
      slot = next?.index ?? null
      editor.setLayoutInsertIndicator?.(next?.caret ?? null)
      notify()
      return
    }
    if (gesture.kind === 'move') {
      const next = movedRect(gesture.rect, delta, event.shiftKey === true)
      // The node follows the pointer either way — a drop is not a leap of
      // faith, and the highlight says which frame will take it.
      showDropTarget(options.dropTargetFor?.(gesture.id, point) ?? null)
      preview(gesture.id, { x: next.x, y: next.y })
    } else if (gesture.kind === 'resize') {
      const next = resizedRect(
        gesture.rect,
        gesture.handle,
        delta,
        { constrain: event.shiftKey === true, fromCentre: event.altKey === true },
        gesture.rotation,
      )
      if (options.onResize)
        options.onResize(
          gesture.id,
          next,
          'preview',
          gesture.handle === 'e' || gesture.handle === 'w',
        )
      else preview(gesture.id, next)
    } else {
      const rotation = rotationFor(
        gesture.centre,
        gesture.origin,
        point,
        gesture.rotation,
        event.shiftKey === true,
      )
      preview(gesture.id, { rotation })
    }
  }

  /**
   * One commit per settled gesture, through the SDK's own helper so undo sees
   * it as one entry. The writes reach the file the way a panel edit does —
   * `node:updated`, `fromSceneChange`, `patch-burst` — with nothing new in the
   * patch path.
   */
  const settle = (point: Point, event: { shiftKey?: boolean; altKey?: boolean }): void => {
    const active = gesture
    gesture = null
    lastAdvance = null

    if (active?.kind === 'reorder') {
      editor.setLayoutInsertIndicator?.(null)
      // Null only when the press never travelled far enough to name a slot.
      // Whether the slot is the one it started in is the host's to say, so the
      // "changed nothing" rule lives with the rest of the move rules.
      if (slot !== null) options.onReorder?.(active.id, slot)
      slot = null
      notify()
      return
    }

    if (active?.kind === 'draw') {
      editor.setMarquee?.(null)
      editor.setPenState?.(null)
      if (isGraphicShape(active.element) && options.onPenPath) {
        const travelled =
          Math.hypot(point.x - active.origin.x, point.y - active.origin.y) * editor.state.zoom >
          CLICK_SLOP
        if (!travelled && (active.element === 'Line' || active.element === 'Arrow')) {
          notify()
          return
        }
        const end = travelled
          ? point
          : {
              x: active.origin.x + 100,
              y:
                active.origin.y +
                (active.element === 'Line' || active.element === 'Arrow' ? 0 : 100),
            }
        const shape = graphicShape(active.element, active.origin, end, event)
        if (options.writable?.() !== false)
          options.onPenPath(shape.vertices, shape.closed, active.element)
        notify()
        return
      }
      const swept = drawingBounds(active.origin, point, event)
      // A sweep too small to have been meant is a click: "put one here", at
      // whatever size the element comes with, rather than a node of nothing.
      const drawn =
        swept.width * editor.state.zoom > CLICK_SLOP &&
        swept.height * editor.state.zoom > CLICK_SLOP
      // A click keeps its own point, not the sweep's corner: they are the same
      // point, but saying so makes the click case independent of the arithmetic.
      const at = drawn ? { x: swept.x, y: swept.y } : active.origin
      options.onCreate?.(
        active.element,
        at,
        drawn ? { width: swept.width, height: swept.height } : null,
      )
      notify()
      return
    }

    if (!active || !editor.graph || !editor.updateNode) {
      showDropTarget(null)
      return
    }
    const node = editor.graph.getNode(active.id)
    if (!node) {
      showDropTarget(null)
      return
    }
    const delta = { x: point.x - active.origin.x, y: point.y - active.origin.y }

    if (active.kind === 'move') {
      /*
       * A drop inside another frame is a reparent, and *only* a reparent.
       *
       * The position write is deliberately skipped: `x`/`y` are relative to
       * the parent, and a `set x` alongside a `move-node` puts the old
       * parent's arithmetic in the diff next to the change that invalidated
       * it. One structural change is what the file should read as, and what
       * the rail already produces for the same gesture.
       *
       * Nothing touches the scene graph here either. The host emits the patch
       * and the file's echo reparents the node, so the canvas cannot show a
       * tree the file does not have — the property the rail was built for.
       */
      const landing = dropTarget
      if (landing) {
        options.onReparent?.(active.id, landing)
      } else {
        const next = movedRect(active.rect, delta, event.shiftKey === true)
        // Rounded: a drag at zoom lands on fractions like 64.825 nobody chose,
        // and the file keeps them forever. Figma rounds the settle; so do we.
        editor.updateNode(active.id, { x: Math.round(next.x), y: Math.round(next.y) })
        editor.commitMove?.(new Map([[active.id, { x: active.rect.x, y: active.rect.y }]]))
      }
    } else if (active.kind === 'resize') {
      const next = resizedRect(
        active.rect,
        active.handle,
        delta,
        { constrain: event.shiftKey === true, fromCentre: event.altKey === true },
        active.rotation,
      )
      const widthOnly = active.handle === 'e' || active.handle === 'w'
      const settled = {
        x: Math.round(next.x),
        y: Math.round(next.y),
        width: Math.round(next.width),
        height: Math.round(next.height),
      }
      if (options.onResize) options.onResize(active.id, settled, 'commit', widthOnly)
      else editor.updateNode(active.id, resizeWrites(node, settled, { widthOnly }))
      editor.commitResize?.(active.id, active.rect)
    } else {
      const rotation = rotationFor(
        active.centre,
        active.origin,
        point,
        active.rotation,
        event.shiftKey === true,
      )
      editor.updateNode(active.id, { rotation })
      editor.commitRotation?.(active.id, active.rotation)
    }
    showDropTarget(null)
    notify()
  }

  /**
   * What a press here would do, shown as a cursor.
   *
   * This is the only affordance the gestures have: the grips are drawn by the
   * renderer and the rotate zone is not drawn at all, so without it an author
   * has to guess where the invisible targets are.
   */
  const updateCursor = (point: Point): void => {
    const style = canvas.style
    if (!style) return
    // The points are the only targets inside vertex editing, and they are
    // small — so the cursor is the affordance that says a press would take one
    // rather than miss it.
    if (vertexEdit) {
      style.cursor = vertexTargetAt(point) ? 'pointer' : 'default'
      return
    }
    // An armed tool is the only thing this canvas will do, so it is the only
    // thing the cursor should offer.
    if (options.tool?.()) {
      style.cursor = 'crosshair'
      return
    }
    const selected = soleSelection()
    if (selected) {
      const handle = canResize(selected) ? gripAt(selected, point) : null
      if (handle) {
        // The arrows point along the axis the grip actually resizes — an edge
        // drag only counts that component, so a cursor that lies about the
        // direction makes the gesture feel broken-slow.
        style.cursor = resizeCursor(handle, screenRotationOf(selected))
        return
      }
      if (nearRotateGrip(selected, point)) {
        style.cursor = ROTATE_CURSOR
        return
      }
    }
    const hit = pick(point.x, point.y, false)
    const node = hit ? editor.graph?.getNode(hit.id) : undefined
    // A flowed child is draggable again since D7 — as a reorder rather than a
    // move, but the hand that grabs it is the same one, so the cursor says so.
    // Asked rather than assumed: the affordance is offered exactly where a
    // press would do something, which is the rule the rotate zone established.
    const draggable =
      node !== undefined && (canMove(node) || options.flowSlotAt?.(node.id, point) != null)
    style.cursor = draggable ? 'move' : 'default'
  }

  /** Arrow keys move the selection, sharing the drag's arithmetic and its commit. */
  const nudge = (event: KeyboardEvent): boolean => {
    if (isTypingTarget(event) || options.writable?.() === false) return false
    // Arrows move the selection, and inside vertex editing the thing under the
    // author's attention is a point rather than the node — so nudging the node
    // would move the whole shape out from under the point they were aiming at.
    // Nudging the *point* is not built; declining is the honest half of that.
    if (vertexEdit) return false
    const node = soleSelection()
    if (!node || !canMove(node)) return false
    const next = nudged({ x: node.x, y: node.y }, event.key, event.shiftKey === true)
    if (!next) return false
    event.preventDefault?.()
    editor.updateNode?.(node.id, next)
    editor.commitMove?.(new Map([[node.id, { x: node.x, y: node.y }]]))
    notify()
    return true
  }

  const endPan = (event: PointerEvent): void => {
    if (panning) {
      panning = false
      canvas.releasePointerCapture?.(event.pointerId)
      pressAt = null
      return
    }
    if (pencil) {
      finishPencil(true, toCanvas(event))
      canvas.releasePointerCapture?.(event.pointerId)
      pressAt = null
      return
    }
    // Every release inside the mode is the mode's, drag or not: falling through
    // would let a press that merely missed a point re-select a node underneath
    // the points on screen.
    if (vertexEdit) {
      const moved = vertexEdit.drag !== null && vertexEdit.moved
      vertexEdit.drag = null
      vertexEdit.moved = false
      canvas.releasePointerCapture?.(event.pointerId)
      pressAt = null
      // A press that only picked a point is a selection, not an edit. Without
      // this every click on a vertex would write the path back unchanged —
      // which is a patch, a revision and a diff for having looked at a point.
      if (moved) commitVertexEdit()
      return
    }
    if (pen) {
      pen.pulling = false
      canvas.releasePointerCapture?.(event.pointerId)
      // Left where the pointer is so the rubber band keeps following it.
      showPen(toCanvas(event))
      pressAt = null
      return
    }
    if (gesture) {
      settle(toCanvas(event), event)
      armed = null
      pressAt = null
      canvas.releasePointerCapture?.(event.pointerId)
      return
    }
    armed = null

    // Select on release rather than press, and only when the pointer barely
    // moved — otherwise the tail of a pan would also change the selection.
    if (!pressAt) return
    const travelled = Math.hypot(event.clientX - pressAt.x, event.clientY - pressAt.y)
    pressAt = null
    if (travelled > CLICK_SLOP) return

    const point = toCanvas(event)
    const hit = pick(point.x, point.y, isDeep(event))
    if (hit) editor.select([hit.id])
    else {
      // Clicking empty space steps back out rather than only deselecting, which
      // is what makes double-click-in / click-out feel symmetrical.
      editor.clearSelection()
      if (editor.state.enteredContainerId) editor.exitContainer()
    }
    emitSelection()
    notify()
  }

  /**
   * Figma's descend gesture: enter the container under the cursor, then select
   * the child inside it. Repeating goes one level deeper each time, which is why
   * it is `enterContainer` on the *hit* rather than a jump to the leaf — that is
   * what cmd-click is for.
   */
  const onDoubleClick = (event: MouseEvent): void => {
    if (options.tool?.() || options.writable?.() === false) return
    const point = toCanvas(event as unknown as PointerEvent)
    if (vertexEdit) {
      if (vertexNear(vertexEdit.subpaths, point, editor.state.zoom)) return
      const edge = segmentNear(vertexEdit.subpaths, point, editor.state.zoom)
      const next = edge ? insertVertex(vertexEdit.subpaths, edge, edge.t) : null
      if (next && edge) {
        vertexEdit.subpaths = next
        vertexEdit.selected = { subpath: edge.subpath, index: edge.index + 1 }
        showVertexEdit()
        commitVertexEdit()
        notify()
      }
      return
    }
    const outer = pick(point.x, point.y, false)
    if (!outer) return

    // The level below a path is its points (D12), so the same descent that
    // steps into a frame steps into a vector's geometry. A vector inside an
    // unentered frame therefore takes two double-clicks — one to reach the
    // node, one to reach its points — which is the descent behaving as it
    // always has rather than a special case bolted beside it.
    if (enterVertexEdit(outer.id)) return

    editor.enterContainer(outer.id)
    const inner = pick(point.x, point.y, false)
    // Entering a leaf finds the same node again; leave it selected rather than
    // stepping into something with nothing inside it.
    if (inner && inner.id !== outer.id) editor.select([inner.id])
    else {
      editor.exitContainer()
      editor.select([outer.id])
    }
    emitSelection()
    notify()
  }

  /**
   * Figma's zoom shortcuts, per ADR 0002.
   *
   * Double-click is deliberately unbound: in Figma it is a selection gesture
   * (deep select), and binding a viewport reset to it means an ordinary click
   * that lands twice throws away where the author was looking. Cmd+0 is left
   * alone too — that is the browser's own zoom reset, not ours to take.
   *
   * `event.code` rather than `event.key`, because shift+1 is "!" on a US layout
   * and something else again elsewhere.
   */
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.defaultPrevented || isTypingTarget(event)) return
    if (
      (event.target as HTMLElement | null)?.tagName === 'BUTTON' &&
      (event.code === 'Enter' || event.code === 'Space')
    )
      return
    if (event.code === 'Space') {
      spaceHeld = true
      event.preventDefault?.()
    }
    if (pencil && event.code === 'Escape') {
      event.preventDefault?.()
      finishPencil(false)
      return
    }
    if (event.code === 'Escape' && gesture?.kind === 'draw') {
      gesture = null
      pressAt = null
      editor.setMarquee?.(null)
      editor.setPenState?.(null)
      notify()
      return
    }
    if (
      (event.code === 'Enter' || event.code === 'NumpadEnter') &&
      !pen &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey
    ) {
      if (vertexEdit) {
        event.preventDefault?.()
        leaveVertexEdit()
        return
      }
      const selected = soleSelection()
      if (!options.tool?.() && selected && enterVertexEdit(selected.id)) {
        event.preventDefault?.()
        return
      }
    }
    // The pen owns both keys while it is drawing: Escape must not step out of a
    // container underneath an unfinished path, and Enter means nothing else.
    if (pen && (event.code === 'Enter' || event.code === 'NumpadEnter')) {
      event.preventDefault?.()
      finishPen(false)
      return
    }
    if (pen && event.code === 'Escape') {
      event.preventDefault?.()
      finishPen(false, false)
      return
    }
    /*
     * Vertex editing owns Escape and the delete keys while it is open, for the
     * reason the pen owns Escape and Enter: the keys mean something narrower
     * inside the mode than outside it. Delete especially — the shell binds it
     * to removing the selected *node* (D2), and the selected node here is the
     * one whose point the author is asking to remove.
     */
    if (vertexEdit && event.code === 'Escape') {
      event.preventDefault?.()
      leaveVertexEdit()
      return
    }
    if (vertexEdit && (event.code === 'Delete' || event.code === 'Backspace')) {
      event.preventDefault?.()
      removeSelectedVertex()
      return
    }
    if (event.code === 'Escape') {
      // Steps out one level before clearing, so Escape undoes a double-click
      // rather than throwing away the whole descent at once.
      if (editor.state.enteredContainerId) editor.exitContainer()
      else editor.clearSelection()
      emitSelection()
      notify()
      return
    }
    if (!event.metaKey && !event.ctrlKey && !event.altKey && nudge(event)) return
    if (!event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return

    switch (event.code) {
      case 'Digit0':
        event.preventDefault?.()
        editor.zoomTo100()
        break
      case 'Digit1':
        event.preventDefault?.()
        editor.zoomToFit()
        break
      case 'Digit2':
        event.preventDefault?.()
        editor.zoomToSelection()
        break
      default:
        return
    }
    notify()
  }
  const onKeyUp = (event: KeyboardEvent): void => {
    if (event.code === 'Space') spaceHeld = false
  }

  const listeners: [string, EventListener][] = [
    ['wheel', onWheel as EventListener],
    ['pointerdown', onPointerDown as EventListener],
    ['pointermove', onPointerMove as EventListener],
    ['pointerup', endPan as EventListener],
    [
      'pointercancel',
      ((event: PointerEvent) => {
        if (pencil) finishPencil(false)
        if (pen) finishPen(false, false)
        if (vertexEdit) leaveVertexEdit()
        if (gesture?.kind === 'move') preview(gesture.id, { x: gesture.rect.x, y: gesture.rect.y })
        else if (gesture?.kind === 'resize') {
          if (options.onResize)
            options.onResize(
              gesture.id,
              gesture.rect,
              'cancel',
              gesture.handle === 'e' || gesture.handle === 'w',
            )
          else preview(gesture.id, gesture.rect)
        } else if (gesture?.kind === 'rotate') preview(gesture.id, { rotation: gesture.rotation })
        gesture = null
        lastAdvance = null
        slot = null
        armed = null
        pressAt = null
        panning = false
        canvas.releasePointerCapture?.(event.pointerId)
        showDropTarget(null)
        editor.setLayoutInsertIndicator?.(null)
        editor.setMarquee?.(null)
        editor.setPenState?.(null)
        notify()
      }) as EventListener,
    ],
    ['dblclick', onDoubleClick as EventListener],
  ]
  for (const [type, handler] of listeners) {
    // `passive: false` matters: the wheel handler calls preventDefault to stop
    // the page scrolling and pinch-zooming underneath the canvas.
    canvas.addEventListener(type, handler, type === 'wheel' ? { passive: false } : undefined)
  }
  const keyDown = onKeyDown as EventListener
  const keyUp = onKeyUp as EventListener
  keyTarget.addEventListener('keydown', keyDown)
  keyTarget.addEventListener('keyup', keyUp)

  return {
    zoom: () => editor.state.zoom,
    reapplyPreview() {
      if (gesture && lastAdvance) advance(lastAdvance.point, lastAdvance)
    },
    refreshVectorEdit() {
      if (!vertexEdit || vertexEdit.drag) return
      const path = options.vertexPathOf?.(vertexEdit.id)
      if (!path) {
        leaveVertexEdit()
        return
      }
      vertexEdit.subpaths = path.subpaths
      vertexEdit.windingRule = path.windingRule
      const ref = vertexEdit.selected
      if (ref && !path.subpaths[ref.subpath]?.vertices[ref.index]) vertexEdit.selected = null
      showVertexEdit()
      notify()
    },
    editVector: enterVertexEdit,
    vectorAction,
    finishDrawing() {
      if (pen) finishPen(false)
      else if (pencil) finishPencil(true)
      else leaveVertexEdit()
    },
    cancelPen() {
      if (pencil) finishPencil(false)
      if (gesture?.kind === 'draw') {
        gesture = null
        pressAt = null
        editor.setMarquee?.(null)
        editor.setPenState?.(null)
      }
      if (pen) finishPen(false, false)
    },
    cancelVertexEdit() {
      leaveVertexEdit()
    },
    destroy() {
      for (const [type, handler] of listeners) canvas.removeEventListener(type, handler)
      keyTarget.removeEventListener('keydown', keyDown)
      keyTarget.removeEventListener('keyup', keyUp)
    },
  }
}

export interface CanvasControls {
  zoom: Ref<number>
  /** Scene ids of the current selection. Ids are UIDX addresses (ADR 0003). */
  selection: Ref<string[]>
  /** The container stepped into, if any — surfaced so the UI can offer a way out. */
  entered: Ref<string | null>
  /** Re-runs the in-flight gesture's preview after a remote document applies. */
  reapplyPreview(): void
  /** Abandons a half-drawn pen path (D11). */
  cancelPen(): void
  /** Steps back out of a node's points (D12). */
  cancelVertexEdit(): void
  editVector(id: string): boolean
  vectorAction(action: VectorAction): void
  finishDrawing(): void
  refreshVectorEdit(): void
}

/** Vue lifecycle wrapper around the controller. */
export function useCanvasControls(
  canvasRef: Ref<HTMLCanvasElement | null>,
  editor: ViewportEditor,
  hooks: {
    onChange?: () => void
    isAddressable?: (id: string) => boolean
    dropTargetFor?: (draggedId: string, point: Point) => string | null
    onReparent?: (draggedId: string, parentId: string) => void

    /**
     * The creation tool the toolbar has armed, or null for selecting (D1).
     *
     * A getter rather than a value, because the toolbar changes it between
     * gestures and the controller is built once. Absent means the canvas can
     * only select and edit, which is exactly where it stood before D1 —
     * the same property every other write-side hook here keeps.
     */
    tool?: () => string | null

    /**
     * A settled draw: where the node goes, and how big the author drew it.
     *
     * `size` is null for a click, which means "put one here at whatever size it
     * comes with" rather than a node of nothing. `at` is the sweep's top-left
     * either way, so the host always knows where — which is also what decides
     * the parent.
     */
    onCreate?: (element: string, at: Point, size: { width: number; height: number } | null) => void

    /**
     * The slot a drag through an auto-layout parent is over (D7), or null when
     * this child cannot be reordered.
     *
     * Its presence is what turns the old refusal into a gesture: absent, a
     * flowed child is undraggable exactly as it was before D7.
     */
    flowSlotAt?: (childId: string, point: Point) => FlowSlot | null

    /** A settled reorder, as an index among the siblings without this child. */
    onReorder?: (childId: string, index: number) => void

    /**
     * A finished pen path (D11), in canvas coordinates.
     *
     * Absent, `P` falls back to the sweep every other tool uses — the same
     * "a canvas can only do what was implemented for it" property every hook
     * here keeps.
     */
    onPenPath?: (vertices: PenVertex[], closed: boolean, name?: string) => void

    /**
     * The path a node holds, in canvas coordinates, or null for a node that
     * has none (D12).
     *
     * Canvas coordinates rather than the node's own, because the pointer is in
     * them and because a nested or rotated node makes the conversion a matrix
     * the controller cannot build. The host has the scene graph and the SDK's
     * `getWorldMatrix`, so it converts on the way out and back on the way in —
     * the same division `absolutePositionOf` and `handlesOf` already keep.
     *
     * Absent, a double-click descends into containers exactly as it did before
     * D12 and a `<Vector>` is a leaf like any other.
     */
    vertexPathOf?: (id: string) => { subpaths: Subpath[]; windingRule: string } | null

    /** A settled vertex or handle drag: the whole path, in canvas coordinates. */
    onVertexPath?: (id: string, subpaths: Subpath[]) => void

    /**
     * Vertex editing opened on a node, or closed (null).
     *
     * The host needs both ends: opening is when it warns that the first edit
     * will re-spell the path (ADR 0006 §8), and closing is what lets the shell
     * give Delete back to the node it was taking from.
     */
    onVertexEdit?: (id: string | null) => void
    onVectorInfo?: (info: VectorEditInfo | null) => void
    writable?: () => boolean
    onResize?: (
      id: string,
      rect: Rect,
      mode: 'preview' | 'commit' | 'cancel',
      widthOnly: boolean,
    ) => void
  } = {},
): CanvasControls {
  const zoom = ref(editor.state.zoom)
  const selection = ref<string[]>([])
  const entered = ref<string | null>(null)
  let controller: CanvasController | null = null

  onMounted(() => {
    if (!canvasRef.value) return
    controller = createCanvasController(canvasRef.value, editor, {
      // Spread first: the wrapper's own `onChange` keeps the zoom ref in step
      // and must not be the one overwritten.
      ...hooks,
      onChange: () => {
        zoom.value = editor.state.zoom
        hooks.onChange?.()
      },
      onSelectionChange: (ids) => (selection.value = ids),
      onEnteredChange: (id) => (entered.value = id),
    })
  })

  onBeforeUnmount(() => controller?.destroy())

  return {
    zoom,
    selection,
    entered,
    reapplyPreview: () => controller?.reapplyPreview(),
    cancelPen: () => controller?.cancelPen(),
    cancelVertexEdit: () => controller?.cancelVertexEdit(),
    refreshVectorEdit: () => controller?.refreshVectorEdit(),
    editVector: (id) => controller?.editVector(id) ?? false,
    vectorAction: (action) => controller?.vectorAction(action),
    finishDrawing: () => controller?.finishDrawing(),
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
