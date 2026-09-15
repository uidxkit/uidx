<script setup lang="ts">
import { LENGTH_PROPS, rootFontSizeOf } from '@uidx/format'
import { computed, onUnmounted, ref, shallowRef, watch } from 'vue'
import { createEditor } from '@open-pencil/core/editor'
import {
  getAbsolutePosition,
  getWorldHandles,
  getWorldMatrix,
  transformVectorNetwork,
  TransformMatrix,
  type VectorNetwork,
} from '@open-pencil/scene-graph'
import { vectorNetworkToSVGPaths } from '@open-pencil/core'
import { computeContentBounds, renderNodesToImage, renderNodesToSVG } from '@open-pencil/core/io'
import { getCanvasKit } from '@open-pencil/core/canvaskit'
import { addressOf, autoName, resolve } from '@uidx/format'
import {
  containerChainAt,
  dropTargetFor,
  insertTargetFor,
  reparentTo,
  type DropPlacement,
} from './drop-target'
import { firstFillFor, slotSceneIds } from './slot-edits'
import { flowSlotAt, type FlowChild, type FlowSlot } from './flow-reorder'
import { createAssetStore } from './asset-store'
import { bounds as penBounds, pathData, type PenVertex } from './pen-model'
import {
  networkOf,
  subpathsOf,
  type Subpath,
  type VertexOverlay,
  type VectorAction,
  type VectorEditInfo,
} from './vertex-edit'
import { drawingHint } from './graphics-tools'
import { resizeVectorPaths } from './vector-resize'
import type { Point, Rect } from './gesture-model'
import { importSvg, type SvgProblem } from './svg-import'
import { reorderFor } from './layer-moves'
import { positioningWrites } from './position-writes'
import { resolvePins, withStrokeEndpoints } from '@uidx/schema'
import { strokeEdit } from './stroke-edits'
import { declaredComponents, definitionsMoved, instancedComponents } from './definitions-moved'
import { authoredSizing, resizeWrites, sizingFlipFor } from './resize-writes'
import type { PinFrame } from './pin-writes'
import { provideEditor, useCanvas } from '@open-pencil/vue'
import {
  applyChanges,
  diffDocuments,
  createSpec,
  fromSceneChange,
  isCreatable,
  isPositionAuthored,
  scenePropFor,
  toSceneGraph,
  type CreatableElement,
  type SceneResult,
  type TokenIndex,
  type TokenResolver,
} from '@uidx/schema'
import type { Diagnostic, JsonValue, UidxDocument, UidxNode, UidxPatch } from '@uidx/format'

import { pageIdFor, rasterFormatFor, type ExportBounds, type ExportFormat } from './export-image'
import { seedFonts } from './fonts'
import { coverageForFont, fontGeneration, fontLibraryError, projectFonts } from './font-library'
import { collapseBurst, novelPatches } from './patch-burst'
import { useCanvasControls } from './useCanvasControls'
import { hoverTargetFor } from './hover-map'

const props = defineProps<{
  doc: UidxDocument | null
  /**
   * Which page of the document `doc` is (the pages rail).
   *
   * The canvas has always been handed one document and never asked which; a
   * save simply replaced it with a newer version of the same page. Now that the
   * author can open another page, "the document changed" and "the document is a
   * different document" are two things, and only this can tell them apart —
   * `diffDocuments` handed two unrelated pages would compute a remove and an
   * insert for every node on both of them.
   */
  page?: string | null
  diagnostics: Diagnostic[]
  /** Token address -> literal value, across every page of the document (G6). */
  tokens?: Map<string, JsonValue>
  /**
   * The shell's selection, as addresses.
   *
   * Selection used to travel one way — canvas to shell to rail — so clicking a
   * row highlighted it, filled the Inspector, updated the top bar, and drew
   * nothing on the canvas. This is the return leg.
   */
  selection?: string[]
  /** The creation tool the toolbar has armed, if any (D1). */
  tool?: string | null
  writable?: boolean
  /**
   * The component an `<Instance>` would be placed from, if the toolbar has one
   * armed (story F11).
   *
   * Held apart from `tool` because it is a *name*, not an element — §3.3's
   * creation whitelist is the five things a person draws, and an instance is
   * chosen rather than swept. It arms the same draw gesture all the same, so
   * the canvas needs no new mode: a click is the only sensible gesture for a
   * node with no size of its own.
   */
  placing?: string | null
  /**
   * Every `<Component>` in the document, by global name (F3).
   *
   * An `<Instance>`'s children are grown from a definition that may live on
   * another page entirely, and a name is global to the document (ADR 0004 §2) —
   * so this arrives the same way `tokens` does, and for the same reason.
   */
  components?: ReadonlyMap<string, UidxNode>
  /**
   * Mode-aware token resolution (G8).
   *
   * `tokens` above stays for the flat, default-mode view the panel wants;
   * this is what the scene build takes, because only a mode tuple can say what
   * a node under `modes={{ … }}` resolves to.
   */
  sceneTokens?: { resolver: TokenResolver; index: TokenIndex }
}>()

const resolveAlias = (address: string): JsonValue | undefined => props.tokens?.get(address)
const resolveComponent = (name: string): UidxNode | undefined => props.components?.get(name)

/**
 * Image bytes, fetched from the server and kept by path (ADR 0006 §9).
 *
 * The file names a path and the renderer wants a hash, so the store bridges
 * them: `resolveAsset` below is how `toSceneGraph` asks, and `entries()` is
 * what fills the graph's own `images` map.
 */
const assets = createAssetStore()
const resolveAsset = (src: string): string | undefined => assets.hashOf(src)

// Before mount, deliberately: `useCanvas` asks the font manager for Inter as
// soon as it mounts, and seeding after that is too late for the first paint.
void seedFonts()

const scene = shallowRef<SceneResult | null>(null)
const editor = createEditor({
  getViewportSize: () => ({ width: 900, height: 760 }),
})
provideEditor(editor)

/**
 * Two surfaces, one scene.
 *
 * The lower canvas draws the page and nothing else; the upper one draws what
 * sits over it — selection, hover, rulers, labels, guides — and takes the
 * pointer. They are split so the renderer can keep the page as a raster while
 * the camera moves: on a scene-only layer a pan or zoom is one image blit
 * (0ms on an 11k-node page, measured) followed by a crisp re-render once the
 * input goes quiet, where a single "full" layer replays the whole page's
 * display list every frame — 13ms in a small window, 40ms in a large one, and
 * a good deal more than that on every frame the overlays change. Both layers
 * share the editor's frame scheduler, so a `requestRender` still reaches each.
 */
const sceneEl = ref<HTMLCanvasElement | null>(null)
const canvasEl = ref<HTMLCanvasElement | null>(null)
const ready = ref(false)
let surfacesReady = 0
const onSurfaceReady = (): void => {
  surfacesReady += 1
  if (surfacesReady < 2) return
  ready.value = true
  void renderWithAssets(props.doc)
}
const sceneCanvas = useCanvas(sceneEl, editor, { layer: 'scene', onReady: onSurfaceReady })
const overlayCanvas = useCanvas(canvasEl, editor, { layer: 'overlays', onReady: onSurfaceReady })
/** Both layers at once, lower first — every caller here means the whole picture. */
const canvas = {
  renderNow: (): void => {
    sceneCanvas.renderNow()
    overlayCanvas.renderNow()
  },
}

/**
 * Only nodes the file declares may be deep-selected.
 *
 * "Absent from the bimap" is the test D4 settles on: a node the file never
 * declared has no source span, so the properties pane would offer controls no
 * patch could write back. Today everything in the graph came from the file;
 * instance children (F3) are what makes this load-bearing.
 */
const isAddressable = (id: string): boolean => scene.value?.addresses.addressOf(id) !== undefined

/**
 * Where a node sits in canvas space, for the gesture hit-tests.
 *
 * A node's `x`/`y` are relative to its parent, so a nested node's resize grips
 * are nowhere near where its own rect claims — and a rotated ancestor makes
 * the answer more than a sum of offsets, which is why this asks the scene
 * graph rather than walking parents by hand.
 */
const editorWithPlacement = Object.assign(editor, {
  absolutePositionOf: (id: string) => {
    const graph = editor.graph
    const node = graph?.getNode(id)
    return node && graph ? getAbsolutePosition(node, graph) : undefined
  },
  /**
   * The in-progress pen path (D11).
   *
   * Assigned to the state directly because the SDK ships no `setPenState`
   * action — unlike every other overlay — while the render pipeline reads
   * `state.penState` and `state.penCursorX/Y` all the same. The controller
   * already writes `state.panX` the same way.
   */
  setPenState: (pen: { cursorX?: number; cursorY?: number } | null) => {
    const state = editor.state as unknown as Record<string, unknown>
    state.penState = pen
    state.penCursorX = pen?.cursorX
    state.penCursorY = pen?.cursorY
  },

  /**
   * The path whose points are open for editing (D12).
   *
   * Assigned to the state for `setPenState`'s reason — the SDK has no action
   * for it — and read by the render pipeline as `overlays.nodeEditState`. It
   * does more than draw: the pipeline skips the node's ordinary draw and its
   * selection box while this is set, and re-renders the shape from these
   * vertices. That is what makes a vertex drag need no scene write to preview.
   */
  setVertexEditState: (state: VertexOverlay | null) => {
    ;(editor.state as unknown as Record<string, unknown>).nodeEditState = state
  },

  /**
   * Where the renderer draws the eight grips — the same `getWorldHandles`
   * the selection overlay itself maps through, so a press finds a grip
   * exactly where the eye does.
   */
  handlesOf: (id: string) => {
    const graph = editor.graph
    const node = graph?.getNode(id)
    return node && graph ? getWorldHandles(node, graph) : undefined
  },
})

const emit = defineEmits<{
  selection: [addresses: string[]]
  /** Committed edits, already filtered to authored intent by D4. */
  patches: [patches: UidxPatch[]]
  /**
   * A node that now answers to a different address, because a drop reparented
   * it. The shell holds the selection as addresses, so without this the author
   * loses the node the moment their own edit comes back (C10b, and the same
   * signal the rail emits for a rail drag or a rename).
   */
  moved: [oldAddress: string, newAddress: string]
  /**
   * Something the author should read, in the shell's own banner. D8 uses it to
   * say what an SVG import could not represent — reported, never dropped.
   */
  notice: [message: string]
  /**
   * The address whose points are open for editing, or null (D12).
   *
   * The shell binds Delete to removing the selected *node* (D2), and while the
   * points of that node are open the key means the point instead. Told rather
   * than inferred: the shell cannot see a mode that lives in the controller,
   * and a guess would be wrong in exactly the case that matters.
   */
  vertexEdit: [address: string | null]
  vectorInfo: [info: VectorEditInfo | null]
  drawingDone: []
}>()

/**
 * The reparent a drop here would be, as a scene id — or null for a plain move.
 *
 * Every rule is `dropTargetFor`'s, which is `moveFor`'s, which is the layers
 * rail's. This is only the translation either side of it: scene ids in,
 * addresses through the bimap, a scene id back out.
 */
function dropParentAt(draggedId: string, point: { x: number; y: number }): string | null {
  const built = scene.value
  const dragged = built?.addresses.addressOf(draggedId)
  if (!built || !current || dragged === undefined) return null
  const sceneChain = containerChainAt(built.graph, built.rootId, point, draggedId)

  /*
   * An unfilled slot is the one container whose scene id has no address: what
   * the pointer is over is a *clone* of the definition's `<Slot>` (ADR 0007
   * §2), so it is absent from the bimap and every address-shaped question about
   * it comes back undefined. Asked before the ordinary walk, because the walk
   * filters exactly those ids out — and highlighting the frame *behind* the
   * hole would aim the author at the wrong drop.
   */
  const holes = unfilledSlots.value
  for (const id of sceneChain) {
    if (!holes.has(id)) continue
    return firstFillFor(current, dragged, [id], holes) ? id : null
  }

  const chain = sceneChain
    .map((id) => built.addresses.addressOf(id))
    .filter((address): address is string => address !== undefined)
  const target = dropTargetFor(current, dragged, chain)
  return target ? (built.addresses.sceneIdOf(target.parent) ?? null) : null
}

/**
 * Every hole no consuming page has filled, by the scene id the canvas hit-tests.
 *
 * Recomputed with the document rather than per drag: a drop asks this on every
 * pointer move, and walking the tree each time would put the component index in
 * the gesture's hot path.
 */
const unfilledSlots = computed(() =>
  current && props.components ? slotSceneIds(current, props.components) : new Map(),
)

const vectorInfo = shallowRef<VectorEditInfo | null>(null)
const toolHint = computed(() => drawingHint(props.tool))

const controls = useCanvasControls(canvasEl, editorWithPlacement, {
  onChange: scheduleCameraReadout,
  isAddressable,
  dropTargetFor: dropParentAt,
  tool: () => props.tool ?? (props.placing ? 'Instance' : null),
  onCreate: createNode,
  flowSlotAt: slotUnder,
  onPenPath: commitPenPath,
  vertexPathOf: worldPathOf,
  onVertexPath: commitVertexPath,
  onVertexEdit: onVertexEdit,
  onVectorInfo: (info) => {
    vectorInfo.value = info
    emit('vectorInfo', info)
  },
  writable: () => props.writable !== false,
  onResize: resizeNode,
  onMove: moveNode,
  onRotate: rotateNode,
  /**
   * A settled reorder, as one `move-node` — the op the rail already ships.
   *
   * `reorderFor` is what decides whether there is anything to commit: a drag
   * that wandered and came back to its own slot is not an edit, and the rule
   * for that lives with the rest of the move rules rather than in the gesture.
   */
  onReorder: (childId, index) => {
    const built = scene.value
    const address = built?.addresses.addressOf(childId)
    if (!built || !current || address === undefined) return
    const patch = reorderFor(current, address, index)
    if (patch) emit('patches', [patch])
  },
  /**
   * The drop, as one `move-node` and nothing else.
   *
   * The scene graph is deliberately left alone: the patch goes to the file and
   * the echo reparents the node through `applyChanges`, so the canvas cannot
   * show a tree the file does not have. That is the same reason `LayersPane`
   * does not call `reorderChildWithUndo` — one gesture, one write, one source
   * of truth. The cost is that a canvas reparent has no scene undo entry,
   * which is exactly where a rail reparent stands today.
   */
  onReparent: (draggedId, parentSceneId) => {
    const built = scene.value
    const dragged = built?.addresses.addressOf(draggedId)
    if (!built || !current || dragged === undefined) return

    // The first fill: two ops rather than one, because the wrapper the node
    // moves into does not exist in the file yet (ADR 0007 §2).
    const filled = firstFillFor(current, dragged, [parentSceneId], unfilledSlots.value)
    if (filled) {
      emit('moved', dragged, filled.address)
      emit('patches', filled.patches)
      return
    }

    const parent = built.addresses.addressOf(parentSceneId)
    if (parent === undefined) return
    // The container the highlight named, asked of the document once more — the
    // patch is the document's arithmetic, never the pointer's.
    const target = reparentTo(current, dragged, parent, placeAfterDrop(draggedId, parentSceneId))
    if (!target) return
    // The node answers to a new address the moment the file comes back, and the
    // selection is held as addresses — so the shell is told, exactly as the rail
    // tells it, or the author loses the node they just dropped.
    emit('moved', dragged, target.address)
    emit('patches', target.patches)
  },
})

/**
 * The slot a drag through an auto-layout parent is over (story D7).
 *
 * The scene half of the question: which siblings there are, where they sit in
 * world space, and which way the parent runs. `flowSlotAt` does the arithmetic,
 * and `null` here is the old refusal preserved — a child with no siblings has
 * no slot to move to, so the drag stays the no-op it was.
 *
 * Siblings arrive with the dragged child already removed, which is what makes
 * "back where it started" come out as its own original index rather than an
 * off-by-one that depends on which way the drag went.
 */
function slotUnder(childId: string, point: { x: number; y: number }): FlowSlot | null {
  const graph = scene.value?.graph
  const child = graph?.getNode(childId)
  const parentId = child?.parentId
  const parent = graph && parentId ? graph.getNode(parentId) : undefined
  if (!graph || !child || !parent || parentId === undefined || parentId === null) return null
  if (parent.layoutMode !== 'HORIZONTAL' && parent.layoutMode !== 'VERTICAL') return null

  const siblings: FlowChild[] = []
  for (const id of parent.childIds) {
    if (id === childId) continue
    const node = graph.getNode(id)
    if (!node) continue
    const at = getAbsolutePosition(node, graph)
    siblings.push({ id, x: at.x, y: at.y, width: node.width, height: node.height })
  }
  if (siblings.length === 0) return null

  const home = getAbsolutePosition(parent, graph)
  return flowSlotAt(point, siblings, parent.layoutMode, {
    id: parentId,
    x: home.x,
    y: home.y,
    width: parent.width,
    height: parent.height,
  })
}

/**
 * A world point in `parentSceneId`'s own frame — or null when that parent lays
 * its children out and the position is not the author's to state (D4).
 *
 * Both halves are scene questions, which is why they are answered here rather
 * than in `drop-target.ts`. The offset is the distance between two world
 * origins, and whether it is the author's at all is `isPositionAuthored` — the
 * same predicate `fromSceneChange` applies after a change and the canvas
 * applies before a drag, asked here of the home the node is *about* to have.
 * Into an auto-layout frame there is nothing to write, and D4 would drop it.
 *
 * `child` is the node that will live there, because one already pinned to
 * `ABSOLUTE` keeps its position even inside a flow. A node being created has no
 * such history, so the default says nothing and the parent decides alone.
 */
function localTo(
  parentSceneId: string,
  world: { x: number; y: number },
  child: Parameters<typeof isPositionAuthored>[1] = {},
): { x: number; y: number } | null {
  const graph = scene.value?.graph
  const parent = graph?.getNode(parentSceneId)
  if (!graph || !parent) return null
  const lookup = { getNode: (id: string) => (id === parentSceneId ? parent : undefined) }
  if (!isPositionAuthored(lookup, { ...child, parentId: parentSceneId })) return null
  const home = getAbsolutePosition(parent, graph)
  return { x: world.x - home.x, y: world.y - home.y }
}

/**
 * Where a dropped node has to sit to stay where the pointer left it.
 *
 * Asking the scene node where it is is safe here, unlike the trap C7 hit: what
 * the preview moved is exactly what this wants to read. The gesture's own
 * output is the answer, not a stale authored fact the preview overwrote.
 *
 * That also settles which pointer position wins. The scene holds where the last
 * *preview* put the node, not where the pointer-up landed — and that is the one
 * to commit, because it is the position the author watched under the highlight
 * they were shown. Taking the position from one moment and the parent from
 * another is how a drop ends up meaning something nobody saw.
 */
function placeAfterDrop(draggedId: string, parentSceneId: string): DropPlacement {
  const graph = scene.value?.graph
  const node = graph?.getNode(draggedId)
  const parent = graph?.getNode(parentSceneId)
  if (!graph || !node) return null
  const local = localTo(parentSceneId, getAbsolutePosition(node, graph), node)
  if (!local) return null
  return {
    ...local,
    // The resolved sizes, for a pinned node landing in a plain box: its
    // offsets are re-measured from the new parent's edges, and only the graph
    // knows how big either actually is (a stretched width is nowhere in the
    // file). Without a parent to measure, `reparentTo` strips rather than
    // mis-measures.
    node: { width: node.width, height: node.height },
    ...(parent ? { parent: { width: parent.width, height: parent.height } } : {}),
  }
}

/**
 * A settled draw becomes one `insert-node` (story D1).
 *
 * The parent is decided the way a drop's is — the innermost container under the
 * pointer that will take this element — from the rect's *origin*, because that
 * is where the author started drawing and so what they were drawing inside.
 *
 * The name is computed here rather than left to the patcher, which would
 * happily do it: the address depends on the name, and the canvas has to know
 * where the new node will answer so it can select it when the file comes back.
 */
function createNode(
  element: string,
  at: { x: number; y: number },
  size: { width: number; height: number } | null,
): void {
  const built = scene.value
  const placing = element === 'Instance' ? (props.placing ?? null) : null
  if (!built || !current) return
  if (placing === null && !isCreatable(element)) return

  const chain = containerChainAt(built.graph, built.rootId, at, '')
    .map((id) => built.addresses.addressOf(id))
    .filter((address): address is string => address !== undefined)
  const parent = insertTargetFor(current, element, chain)
  if (parent === null) return

  const parentNode = resolve(current.tree, parent)
  const parentSceneId = built.addresses.sceneIdOf(parent)
  if (!parentNode || parentSceneId === undefined) return

  const where = localTo(parentSceneId, at)
  // An instance is named after what it is an instance of, not after its
  // element: two `Icon/Check`s read as `check-1` and `check-2` rather than as
  // `instance-1` and `instance-2`, which say nothing. The component's own name
  // may be grouped (`Icon/Check`), and only the last segment is the noun.
  const base = placing === null ? element : (placing.split('/').at(-1) ?? 'instance')
  const name = autoName(base, parentNode.children)
  const spec =
    placing === null
      ? createSpec(element as CreatableElement, name, { at: where, size })
      : {
          element: 'Instance' as const,
          attrs: {
            name,
            component: placing,
            ...(where ? { x: where.x, y: where.y } : {}),
          },
        }

  // Appended, because a drawn node goes on top and the last child paints last.
  emit('patches', [{ op: 'insert-node', parent, index: parentNode.children.length, node: spec }])
  // The node does not exist yet; its address does. `applySelection` skips what
  // the graph has not got, and runs again when the echo brings it.
  emit('selection', [addressOf(parent, name)])
}

/**
 * A finished pen path becomes one `<Vector>` (story D11).
 *
 * The geometry reaches the file the way every other creation does — one
 * `insert-node`, into the container the gesture started over — so nothing new
 * appears in the patch path. What is new is that the path itself is authored
 * rather than imported, which ADR 0006 §8 measured as safe: what a pen
 * produces (lines and cubics) survives the write-back conversion untouched.
 *
 * The node's box is the ink's tight bounds, not the control polygon's, and the
 * path is re-expressed relative to that origin — a `d` is relative to the node
 * that holds it, so the same vertices are written twice from two origins rather
 * than translated after the fact.
 */
function commitPenPath(vertices: PenVertex[], closed: boolean, nameBase = 'Vector'): void {
  const built = scene.value
  if (!built || !current || vertices.length < 2) return

  const box = penBounds(vertices, closed)
  const chain = containerChainAt(built.graph, built.rootId, box, '')
    .map((id) => built.addresses.addressOf(id))
    .filter((address): address is string => address !== undefined)
  const parent = insertTargetFor(current, 'Vector', chain)
  if (parent === null) return

  const parentNode = resolve(current.tree, parent)
  const parentSceneId = built.addresses.sceneIdOf(parent)
  if (!parentNode || parentSceneId === undefined) return

  const parentScene = built.graph.getNode(parentSceneId)
  const inverse = parentScene
    ? TransformMatrix.invert(getWorldMatrix(parentScene, built.graph))
    : null
  if (!inverse) return
  const localNetwork = transformVectorNetwork(
    inverse,
    networkOf([{ vertices, closed }]) as unknown as VectorNetwork,
  )
  const localVertices = subpathsOf(localNetwork)[0]?.vertices
  if (!localVertices) return
  const localBox = penBounds(localVertices, closed)
  const positioned = localTo(parentSceneId, box) !== null
  const name = autoName(nameBase, parentNode.children)
  const spec = createSpec('Vector', name, {
    at: positioned ? { x: localBox.x, y: localBox.y } : null,
    size: { width: Math.max(1, localBox.width), height: Math.max(1, localBox.height) },
    path: { data: pathData(localVertices, closed, localBox), windingRule: 'NONZERO' },
  })

  if (!closed) {
    spec.attrs!.strokeWeight = 2
    spec.attrs!.strokeCap = 'ROUND'
    spec.attrs!.strokeJoin = 'ROUND'
    spec.attrs!.strokeAlign = 'CENTER'
    if (nameBase === 'Line' || nameBase === 'Arrow') {
      spec.attrs!.strokeCap = 'NONE'
      spec.attrs!.strokeStartCap = 'NONE'
      spec.attrs!.strokeEndCap = nameBase === 'Arrow' ? 'ARROW_LINES' : 'NONE'
    }
  }
  emit('patches', [{ op: 'insert-node', parent, index: parentNode.children.length, node: spec }])
  emit('selection', [addressOf(parent, name)])
}

/* ------------------------------------------------- editing a path (D12) */

/**
 * How a node's own geometry sits on the canvas.
 *
 * A `vectorNetwork` is in the node's local space and the pointer is in the
 * canvas's, and between them can be a nested parent and a rotation — so this
 * is a matrix, not an offset. `getWorldMatrix` is the same answer the SDK's own
 * vertex overlay maps through (`drawNodeEditOverlay` inverts it to get back),
 * which is what keeps a grabbed point under the finger that grabbed it.
 */
function finishDrawing(): void {
  controls.finishDrawing()
  emit('drawingDone')
}

function editVector(address: string): boolean {
  const id = scene.value?.addresses.sceneIdOf(address)
  return id !== undefined && controls.editVector(id)
}

watch(
  () => props.selection,
  (selection) => {
    if (vectorInfo.value && (selection?.length !== 1 || selection[0] !== vectorInfo.value.id))
      controls.cancelVertexEdit()
  },
)
watch(
  () => props.writable,
  (writable) => {
    if (writable === false) {
      controls.cancelPen()
      controls.cancelVertexEdit()
    }
  },
)

function worldMatrixOf(id: string): number[] | null {
  const graph = editor.graph
  const node = graph?.getNode(id)
  return node && graph ? getWorldMatrix(node, graph) : null
}

/** The winding rule the file gave this path, which only its region carries. */
function windingRuleOf(network: VectorNetwork | null | undefined): string {
  return network?.regions?.[0]?.windingRule ?? 'NONZERO'
}

/**
 * The chains this node's path spells, in canvas coordinates — or null for a
 * node that holds no geometry, which is every node but a drawn `<Vector>`.
 *
 * Returning null is how the double-click gesture learns there is nothing to
 * descend into, so it falls back to stepping into a container.
 */
function worldPathOf(id: string): { subpaths: Subpath[]; windingRule: string } | null {
  const network = editor.graph?.getNode(id)?.vectorNetwork
  const world = worldMatrixOf(id)
  if (!network || !world || network.segments.length === 0) return null
  const subpaths = subpathsOf(transformVectorNetwork(world, network))
  return subpaths.length ? { subpaths, windingRule: windingRuleOf(network) } : null
}

/**
 * One settled vertex or handle drag, as one `set vectorPaths`.
 *
 * Through the scene rather than straight to the file, and vouched — the same
 * shape `applyProp` uses for a panel edit, and the one ADR 0006 §8 requires:
 * `vectorPaths` is in `VOUCHED_ONLY`, so a write nobody claimed is dropped
 * rather than re-spelling a path that was only touched for some other reason.
 * The `d` is therefore spelled by `vectorNetworkToSVGPaths`, the function the
 * fixed point was measured through, and not by anything in this repo.
 *
 * Point edits retain the node's local origin and layout box. Resizing that
 * box, from either the inspector or the canvas, scales the saved geometry.
 */
function commitVertexPath(id: string, subpaths: Subpath[]): void {
  const address = scene.value?.addresses.addressOf(id)
  const node = editor.graph?.getNode(id)
  const world = worldMatrixOf(id)
  if (address === undefined || !node || !world) return
  const inverse = TransformMatrix.invert(world)
  if (!inverse) return

  // `WindingRule` is a two-value union the pure module carries as a string,
  // because it has no business importing the SDK's types to pass one through.
  const built = networkOf(subpaths, windingRuleOf(node.vectorNetwork)) as unknown as VectorNetwork
  authoredWrite = { address, props: new Set(['vectorPaths']) }
  try {
    const saved = current ? resolve(current.tree, address) : null
    editor.updateNode(address, {
      vectorNetwork: withStrokeEndpoints(
        transformVectorNetwork(inverse, built),
        {
          strokeStartCap: saved?.attrs.strokeStartCap?.value,
          strokeEndCap: saved?.attrs.strokeEndCap?.value,
        },
        resolveAlias,
      ),
    })
  } finally {
    authoredWrite = null
  }
  canvas.renderNow()
}

/** Opening a node's points, or closing them. */
function onVertexEdit(id: string | null): void {
  const address = id === null ? null : (scene.value?.addresses.addressOf(id) ?? null)
  emit('vertexEdit', address)
  if (id !== null) announceRespelling(id)
}

/**
 * Say, before the first edit, that saving will re-write the path's text.
 *
 * ADR 0006 §8 requires this and says why: the round trip through
 * `parseSVGPath` reaches a fixed point after one pass, but the *first* pass
 * normalises — a `Z` after a curve becomes an explicit line home, `Q` and `S`
 * become `C`, and an arc becomes cubics. The first three are exact and the
 * last one is not, which is why an arc gets a different sentence.
 *
 * Measured rather than guessed at, and measured through the speller that will
 * do the writing: what the file holds now, against what an untouched
 * write-back would spell for it. A path the pen drew is already a fixed point,
 * so it says nothing at all — which is what keeps the message meaningful when
 * it does appear.
 *
 * On entry rather than on the edit, because "before" is the whole point: an
 * author who does not want the reformat can press Escape and has lost nothing.
 */
function announceRespelling(id: string): void {
  const address = scene.value?.addresses.addressOf(id)
  const network = editor.graph?.getNode(id)?.vectorNetwork
  const node = address !== undefined && current ? resolve(current.tree, address) : null
  const held = node?.attrs.vectorPaths?.value
  if (!network || !Array.isArray(held)) return
  const data = (held[0] as { data?: unknown } | undefined)?.data
  if (typeof data !== 'string') return

  const wouldWrite = vectorNetworkToSVGPaths(network)[0]
  if (wouldWrite === undefined || wouldWrite === data) return

  const name = node?.name ?? 'this path'
  // An `A` is the only lossy command, and the only letter here it can be:
  // a `d` holds command letters and numbers, and no other command spells one.
  emit(
    'notice',
    /[Aa]/.test(data)
      ? `${name} is drawn with arcs, which this format cannot hold. Editing a point replaces them with curves along the same shape.`
      : `${name}'s path is written in a shorter form than this editor spells. Editing a point rewrites the text without changing the shape.`,
  )
}

/* --------------------------------------------------------- SVG import (D8) */

/**
 * Dropping an SVG on the canvas writes `<Vector>` nodes where it landed.
 *
 * The direction that works is file → scene: `importSvg` reads the `d` strings
 * the SVG already holds, so nothing round-trips through a `VectorNetwork` and
 * arcs stay arcs. What it lands is an ordinary `insert-node`, so the whole
 * patch path — D4's filter, C3's revision guard, E4's rebase — applies without
 * knowing an importer exists.
 */
async function onDrop(event: DragEvent): Promise<void> {
  event.preventDefault()
  const file = [...(event.dataTransfer?.files ?? [])].find(
    (f) => f.type === 'image/svg+xml' || f.name.toLowerCase().endsWith('.svg'),
  )
  if (!file) return

  const built = scene.value
  if (!built || !current) return
  const at = toCanvasPoint(event)

  const chain = containerChainAt(built.graph, built.rootId, at, '')
    .map((id) => built.addresses.addressOf(id))
    .filter((address): address is string => address !== undefined)

  const imported = importSvg(await file.text(), 'svg')
  if (!imported.node) {
    emit('notice', `${file.name} had nothing this format can draw.`)
    return
  }

  const element = imported.node.element
  const parent = insertTargetFor(current, element, chain)
  const parentNode = parent === null ? null : resolve(current.tree, parent)
  const parentSceneId = parent === null ? undefined : built.addresses.sceneIdOf(parent)
  if (parent === null || !parentNode || parentSceneId === undefined) {
    emit('notice', `Nowhere here will take a <${element}> from ${file.name}.`)
    return
  }

  // Named from the file, so the layer rail reads like the folder the author
  // dragged from; `autoName` only steps in when that name is taken.
  const wanted = baseName(file.name)
  const name = parentNode.children.some((c) => c.name === wanted)
    ? autoName(element, parentNode.children)
    : wanted
  const where = localTo(parentSceneId, at)
  const node = {
    ...imported.node,
    attrs: {
      ...imported.node.attrs,
      name,
      ...(where ? { x: where.x, y: where.y } : {}),
      ...(element === 'Vector' ? { width: imported.size.width, height: imported.size.height } : {}),
    },
  }

  emit('patches', [{ op: 'insert-node', parent, index: parentNode.children.length, node }])
  emit('selection', [addressOf(parent, name)])
  if (imported.problems.length) emit('notice', problemMessage(file.name, imported.problems))
}

/** The file's name without its extension, as a node name. */
function baseName(fileName: string): string {
  return fileName.replace(/\.svg$/i, '').replace(/[#/]/g, '-') || 'svg'
}

/**
 * What the import could not carry, in the author's terms.
 *
 * Said rather than swallowed: a logo that quietly lost its gradient is worse
 * than one the author was told about, and they are the only one who can decide
 * whether it still passes.
 */
function problemMessage(fileName: string, problems: readonly SvgProblem[]): string {
  const parts = problems.map((p) => (p.count > 1 ? `${p.detail} (×${p.count})` : p.detail))
  return `${fileName} imported, but this format cannot hold ${parts.join(', ')}.`
}

/** Canvas coordinates for a drag event, the same mapping the gestures use. */
function toCanvasPoint(event: DragEvent): { x: number; y: number } {
  const el = canvasEl.value
  if (!el) return { x: 0, y: 0 }
  const box = el.getBoundingClientRect()
  return editor.screenToCanvas(event.clientX - box.left, event.clientY - box.top)
}

/**
 * True while an incoming document is being applied to the graph.
 *
 * `applyChanges` and `replaceGraph` mutate nodes, and mutation emits
 * `node:updated` — the same event a user's edit emits. Without this flag the
 * server's own `file:changed` would be translated straight back into patches and
 * posted to the server, which answers with another `file:changed`. The loop is
 * not theoretical; it is what happens the first time you wire these together.
 */
let applyingRemote = false

// Scene ids are addresses (ADR 0003), so this is nearly an identity mapping —
// the root is the one node whose id is the frontmatter id rather than ''.
watch(controls.selection, (ids) => {
  const map = scene.value?.addresses
  emit(
    'selection',
    ids.map((id) => map?.addressOf(id) ?? id),
  )
})

/** True once anything has drawn, so the overlay never claims a state that never existed. */
const hasRendered = ref(false)

/** Keep the zoom control in sync with both gestures and programmatic fitting. */
const cameraZoom = ref(1)
function fitCanvas(): void {
  editor.zoomToFit()
  scheduleCameraReadout()
}
function chooseZoom(event: Event): void {
  const level = Number((event.target as HTMLSelectElement).value)
  const canvas = canvasEl.value
  if (!canvas || !Number.isFinite(level) || level <= 0) return
  editor.setZoomAroundPoint(level, canvas.clientWidth / 2, canvas.clientHeight / 2)
  scheduleCameraReadout()
}

/** Coalesce trackpad readouts to one DOM update per animation frame. */
let readoutFrame = 0
function scheduleCameraReadout(): void {
  if (typeof requestAnimationFrame !== 'function') {
    cameraZoom.value = editor.state.zoom
    return
  }
  if (readoutFrame) return
  readoutFrame = requestAnimationFrame(() => {
    readoutFrame = 0
    cameraZoom.value = editor.state.zoom
  })
}
onUnmounted(() => {
  if (readoutFrame) cancelAnimationFrame(readoutFrame)
})

/** The document the current scene graph was built from. */
let current: UidxDocument | null = null

/**
 * Which page that document was, or `undefined` before anything has drawn.
 *
 * The third state is what keeps the first render from reading as a page change:
 * a first draw already fits the camera by `hasRendered`, and calling it a switch
 * would be claiming the author navigated somewhere they were already.
 */
let renderedPage: string | null | undefined = undefined

/**
 * Applies a new document to the canvas.
 *
 * Incrementally where possible: a full `replaceGraph` would destroy and rebuild
 * every node, dropping selection and undo history, and the accompanying
 * `zoomToFit` would throw the author back to a fit view on every save. Zooming
 * into a detail and saving should not move the camera.
 *
 * Falls back to a rebuild when the diff cannot express the change (currently a
 * changed component id) and on the first render, when there is nothing to
 * diff against.
 */
/**
 * Whatever this document references, in the graph before it is built.
 *
 * Loading first and rendering after is what makes an image appear on the first
 * paint rather than one frame later — and a document whose assets have not
 * changed resolves immediately, because the store already holds them.
 */
async function renderWithAssets(doc: UidxDocument | null, rebuild = false): Promise<void> {
  if (!doc) return
  const loaded = await assets.load(doc)
  // A newly-arrived image changes what every node using it draws, and the
  // diff cannot see that — the document did not move, the bytes did.
  render(doc, rebuild || loaded)
  // The graph has settled, so anything measuring it can measure again. The
  // shell's `pinFrame` needs this: the watcher that recomputes it cannot know
  // when this function finishes, because this is async and its own doc watch
  // is not — which is exactly how a pinned child's X came to sit one edit
  // behind the file (H2's live pass).
  graphRevision.value += 1
  // Shown on the canvas rather than in the shell's banner, because the two are
  // different kinds of message: the banner is for something that just happened
  // (an import, a refused patch) and clears itself, and this is a state the
  // document is *in* until someone puts the file there. The glyph panel below
  // it says the same kind of thing for the same reason.
  missingAssets.value = assets.missing()
}

/** Referenced images that are not on disk — a state, not an event. */
const missingAssets = ref<string[]>([])

/**
 * Bumped whenever the graph on screen has been rebuilt or re-applied.
 *
 * The shell measures the graph — `exportBounds`, and H2's `pinFrame` — and had
 * no way to know when there was something new to measure. `flush: 'post'` does
 * not answer it: the render is asynchronous (it awaits assets) while the watch
 * that starts it is not, so the shell's post-flush callback can run a long
 * while before the graph it reads has moved.
 */
const graphRevision = ref(0)

/**
 * Bumped per preview frame of an in-flight gesture.
 *
 * Separate from `graphRevision` on purpose: the shell re-measures `pinFrame`
 * on either — one `getNode` read, cheap at pointer-move rate, and what makes
 * the panel's rows follow a drag live — but recomputes `exportBounds` only on
 * the settled one, because that walks the selection's descendants and nobody
 * needs a pixel count sixty times a second.
 */
const previewRevision = ref(0)

/**
 * Re-measures estimated text when the SDK settles a font demand.
 *
 * `measureTextNode` answers null the first time it is asked about a text node:
 * asking is what *raises* the font demand, and an answer only exists once that
 * demand settles. The first build can therefore size both free text and text
 * inside auto layout by estimate, positioning siblings from that guess.
 *
 * The SDK invalidates text pictures and repaints when a demand settles, but
 * does not re-run this document's layout. Refresh it here so the first later
 * edit (including root font size) does not unexpectedly move pixel-based text.
 *
 * Driven by the settle callback rather than by a timer, because the wait is for
 * a font to resolve and that has no bounded duration — a slow fetch, a cold
 * cache or a fallback lookup all take as long as they take. A frame-counted
 * retry would give up at exactly the moment it was most needed.
 *
 * Self-terminating without a counter: a demand settles once, and the rebuild it
 * triggers only measures by estimate again if the face resolved as unavailable
 * — in which case nothing further settles and nothing further fires.
 */
let lastBuildEstimated = false

type SettleHook = (...args: unknown[]) => void
type SettleHost = { onFontResolutionSettled?: SettleHook | null }

/** The wrappers installed on the renderers, so a re-loaded surface is re-hooked. */
const settleHooks = new WeakSet<SettleHook>()

function watchFontSettle(): void {
  // `loadFonts` assigns `onFontResolutionSettled` wholesale every time it runs
  // — including when the surface is recreated — so this checks for its own
  // wrapper rather than remembering that it once installed one. Every layer
  // has a renderer of its own, each resolving fonts for itself, so each is
  // hooked; the rebuild is idempotent, so two settles cost one rebuild.
  for (const renderer of editor.canvasRenderers as unknown as SettleHost[]) {
    const inner = renderer.onFontResolutionSettled
    if (inner && settleHooks.has(inner)) continue
    const hook: SettleHook = (...args) => {
      inner?.(...args)
      if (!lastBuildEstimated) return
      // The document as it is *now*, not the one that was estimated: a save or a
      // page switch may have landed since, and that build is already correct.
      void renderWithAssets(props.doc, true)
    }
    settleHooks.add(hook)
    renderer.onFontResolutionSettled = hook
  }
}

function render(doc: UidxDocument | null, rebuild = false): void {
  if (!doc || !ready.value) return

  // Another page is not a change to this one: nothing on it survives, so there
  // is nothing for the diff to express and the camera has no reason to stay
  // where it was.
  const pageChanged = renderedPage !== undefined && props.page !== renderedPage
  renderedPage = props.page ?? null

  // A document is the new baseline: what was in flight is now either in it or
  // refused, and either way `fromSceneChange`'s own comparison takes over.
  burst = []
  pending = []

  applyingRemote = true
  try {
    // Demands capture the callback when layout asks for a font. Hook before
    // building so even the first cold-load request has a layout refresh.
    watchFontSettle()
    if (pageChanged) rebuild = true
    // The diff is handed the token index so an alias inside a `modes` subtree
    // resolves as the page would (G8); it answers null itself when a `modes`
    // attribute moved, and the rebuild below is the fallback.
    if (
      !rebuild &&
      current &&
      scene.value &&
      !definitionsMoved(renderedWith, props.components, foreign.value)
    ) {
      const changes = diffDocuments(current, doc, resolveAlias, props.sceneTokens)
      if (changes) {
        const applied = applyChanges(scene.value, changes, {
          resolveAlias,
          resolveAsset,
          resolveComponent,
          tokens: props.sceneTokens,
        })
        // The renderer re-records only the chunks holding these (viewer-at-scale
        // spec §4); an unexplained version bump re-records the whole page.
        markDirty(applied.touched)
        current = doc
        // This render accounted for the index as it stands — including any
        // same-page definition the diff just pushed into its copies — so the
        // components watch below has nothing further to rebuild for.
        renderedWith = props.components
        cameraZoom.value = editor.state.zoom
        canvas.renderNow()
        // A rename or a reparent reaches here as a remove plus an insert, and
        // the shell remapped its selection to the new addresses before this
        // round-trip — while the graph still held the old ids, so the earlier
        // apply matched nothing and cleared. The ids the selection names exist
        // only now, which is why this path needs the re-apply even more than
        // the rebuild below does.
        applySelection(props.selection ?? [])
        return
      }
    }

    // A rebuild replaces every node, so the ids an open vertex edit is holding
    // stop existing — and the overlay would keep drawing a path against a node
    // the graph no longer has. The incremental path leaves the nodes in place,
    // so it does not need this.
    controls.cancelVertexEdit()

    // Recorded here and *only* here, because this is the branch that actually
    // consults the component index — the incremental path above re-uses a graph
    // built from whatever the index was then. Setting it on every render made
    // the two watchers order-dependent: a save touching a definition and the
    // rendered page in one tick let the incremental render mark the new index
    // as already drawn, and the rebuild that the definition needed never ran.
    renderedWith = props.components

    const next = toSceneGraph(doc, {
      resolveAlias,
      resolveAsset,
      resolveComponent,
      tokens: props.sceneTokens,
    })
    // Text the fonts could not measure yet is a build that will be wrong until
    // it is done again, once the demand this build just raised settles.
    lastBuildEstimated = next.unmeasuredText > 0
    // The graph owns the byte store the renderer reads; the asset store owns
    // what was fetched. A fresh graph starts empty, so it is refilled here.
    for (const asset of assets.entries()) next.graph.images.set(asset.hash, asset.bytes)
    scene.value = next
    current = doc
    watchGraph(next)
    editor.replaceGraph(next.graph)
    // B7's invariant: fit on first load, and otherwise only when the author
    // asks (shift+1). A rebuild triggered by a save — because the diff could
    // not express the change, or because a token moved — is not the author
    // asking to be taken somewhere, and refitting there throws away wherever
    // they had navigated to. `replaceGraph` leaves pan and zoom untouched, so
    // simply not fitting is what holds the camera still.
    //
    // Opening another page *is* the author asking to be taken somewhere, and
    // the camera they left on the last page frames nothing on this one.
    if (!hasRendered.value || pageChanged) editor.zoomToFit()
    cameraZoom.value = editor.state.zoom
    canvas.renderNow()
    hasRendered.value = true
    // `replaceGraph` drops the editor's selection, and a rebuild is not the
    // author deselecting anything — the shell still holds what they picked.
    applySelection(props.selection ?? [])
  } finally {
    applyingRemote = false
    // The file's new state is on the canvas — including the file's values for
    // whatever the author is mid-edit on. Their hand goes back on top: the one
    // node a gesture holds, or the one property a panel scrub holds, and
    // nothing else. Runs after the flag drops, which is safe because previews
    // emit `node:previewUpdated` and `watchGraph` never listens to that.
    reapplyLocalEdits()
  }
}

/**
 * The panel scrub in flight, so a remote document landing mid-scrub does not
 * leave the canvas showing the file's value while the field shows the author's.
 * The properties pane holds its own copy for the field; this is the canvas half.
 */
let panelPreview: { address: string; fields: object } | null = null

/** Re-applies the in-flight gesture and panel scrub over a fresh document. */
function reapplyLocalEdits(): void {
  controls.reapplyPreview()
  controls.refreshVectorEdit()
  if (!panelPreview) return
  const graph = scene.value?.graph
  const held = panelPreview
  if (graph?.getNode(held.address)) {
    graph.runPreviewUpdates(() => editor.updateNode(held.address, held.fields))
    canvas.renderNow()
  } else {
    // Nothing left to be editing: the node went with the change.
    panelPreview = null
  }
}

/**
 * Puts the shell's selection on the canvas.
 *
 * Addresses are scene ids (ADR 0003), but they go through the bimap rather than
 * being used directly: a row can name something the graph does not have — a
 * node from a document that has not rendered yet — and the page is not a thing
 * the canvas selects, so the root maps to nothing rather than to an outline
 * around everything.
 *
 * The equality check is what keeps this from fighting the canvas. A canvas
 * click already travels out to the shell and comes straight back here as a prop
 * change; re-selecting the same ids would be harmless but would repaint on
 * every click, and the guard says plainly that this is a one-way sync.
 */
function applySelection(addresses: readonly string[]): void {
  const graph = scene.value
  if (!graph || !ready.value) return

  const ids = addresses
    .map((address) => graph.addresses.sceneIdOf(address))
    .filter((id): id is string => id !== undefined && id !== graph.rootId)

  const selected = editor.state.selectedIds
  if (ids.length === selected.size && ids.every((id) => selected.has(id))) return

  if (ids.length) editor.select(ids)
  else editor.clearSelection()
  canvas.renderNow()
}

watch(
  () => props.selection,
  (addresses) => applySelection(addresses ?? []),
)

// Putting the pen away mid-path abandons it. Without this the overlay would
// outlive the tool that owns it, and the next Enter would commit a shape the
// author had already walked away from.
watch(
  () => props.tool,
  (tool) => {
    controls.cancelPen()
    // Arming anything at all leaves a path's points: the next press belongs to
    // the tool, and an overlay outlining points nothing can take is a lie.
    if (tool !== null) controls.cancelVertexEdit()
  },
)

/**
 * Set for the duration of one panel write, so the change it emits can say it
 * was authored — and for which node. One edit reflows the parent and the
 * children, and those arrive in the same burst; vouching for them would write
 * computed geometry into the file, which is what D4 exists to prevent.
 * Null between writes, which is when an unattributed reflow arrives.
 */
let authoredWrite: { address: string; props: ReadonlySet<string> } | null = null

/** Detaches the listener from the previous graph, if any. */
let unwatchGraph: (() => void) | null = null

/**
 * Turns committed scene mutations into patches (stories C4 and D4).
 *
 * `node:updated` only — never `node:previewUpdated`. That one distinction is the
 * whole of gesture batching: the SDK already emits a preview per pointer move
 * and a single update on release, so a five-second scrub produces one patch and
 * one line in the diff without any state machine here (measured in Phase 0 as
 * ten previews and zero commits during a scrub).
 *
 * `fromSceneChange` is what keeps the reflow burst out. One committed edit to an
 * auto-layout frame updates every child too, and those carry computed geometry
 * nobody typed.
 */
/**
 * One gesture's writes, gathered into one dispatch.
 *
 * A committed edit can cascade: flipping a sizing mode makes the SDK pin the
 * frame's current hug size, and the layout engine re-announces that same
 * write on its next pass and again when the echo settles — measured as one
 * click emitting the same `add width` three times over ~75ms, each dispatched
 * against a revision the previous one had already advanced, so the later ones
 * lost C3's check and the author got a stale banner for a single edit.
 *
 * Two pieces: patches emitted in one microtask travel as one envelope, so the
 * set and the size it pins apply atomically under one revision check; and
 * `pending` remembers what is already in flight so the later re-announcements
 * are recognised as noise (`novelPatches`). A new document — the echo, or a
 * rollback's re-render — resets both in `render`, because from then on the
 * file itself answers the question.
 */
let burst: UidxPatch[] = []
let pending: UidxPatch[] = []

function flushBurst(): void {
  if (!burst.length) return
  // Collapsed so the envelope says one thing per property: a commit plus the
  // layout's same-tick write-back must not travel as two patches racing over
  // one attribute (the double-`add` the server refuses whole).
  const batch = collapseBurst(burst)
  burst = []
  if (!batch.length) return
  pending.push(...batch)
  emit('patches', batch)
}

/**
 * Tells every renderer which nodes moved, so a scene-version bump re-records
 * only their chunks (viewer-at-scale spec §4). The patched SDK exposes
 * `markDirty`; an unpatched build simply re-records the page as before.
 */
function markDirty(ids: readonly string[], moveOnly = false): void {
  if (!ids.length) return
  const renderers = editor.canvasRenderers as unknown as {
    markDirty?(id: string, moveOnly?: boolean): void
  }[]
  for (const renderer of renderers) {
    if (!renderer.markDirty) continue
    for (const id of ids) renderer.markDirty(id, moveOnly)
  }
}

/**
 * A layout pass moves far more nodes than an edit changes: hiding one cell of
 * the states grid reflows every section below it. A node that only moved keeps
 * its own picture — the renderer records those in the node's own space — so
 * telling it apart from a real change is what stops a one-cell edit from
 * re-recording the page.
 */
const isMoveOnly = (changes: Record<string, unknown>): boolean => {
  const keys = Object.keys(changes)
  return keys.length > 0 && keys.every((key) => key === 'x' || key === 'y')
}

/**
 * Explicit commits must include fields that already equal their preview. The
 * graph suppresses unchanged scalar events, but the file has not seen them.
 */
function recordSceneWrite(sceneId: string, changes: Record<string, unknown>): void {
  const built = scene.value
  if (applyingRemote || !current || !built) return
  const patches = fromSceneChange(sceneId, changes, {
    doc: current,
    graph: built.graph,
    addresses: built.addresses,
    pins: built.pins,
    ...(authoredWrite ? { authored: authoredWrite.props, authoredFor: authoredWrite.address } : {}),
  })
  const novel = novelPatches([...pending, ...burst], patches)
  if (!novel.length) return
  if (!burst.length) queueMicrotask(flushBurst)
  burst.push(...novel)
}

function watchGraph(next: SceneResult): void {
  unwatchGraph?.()
  const handler = (sceneId: string, changes: Record<string, unknown>): void => {
    // Every committed mutation, remote or authored, dirties its chunk.
    markDirty([sceneId], isMoveOnly(changes))
    recordSceneWrite(sceneId, changes)
  }
  // nanoevents hands back the unbind function rather than offering `off`.
  const offUpdated = next.graph.emitter.on('node:updated', handler)
  // Previews never become patches — that is the whole batching design — but
  // the panel wants to watch the box move, and so do pinned children: without
  // this, resizing a card left them at the old parent's edges until the echo
  // snapped them over, which read as the layout breaking mid-drag. The event
  // fires inside the preview scope, so the resolve's own writes are downgraded
  // with everything else; and even if one escaped, a resolve round-trips to
  // the stored offsets and the filter emits nothing — the tested invariant.
  // The guard stops the resolve's own preview events from recursing.
  let resolvingPreview = false
  const offPreview = next.graph.emitter.on(
    'node:previewUpdated',
    (sceneId: string, changes: Record<string, unknown> = {}) => {
      markDirty([sceneId], isMoveOnly(changes))
      previewRevision.value += 1
      if (resolvingPreview) return
      resolvingPreview = true
      try {
        resolvePins(next.graph, sceneId, next.pins)
      } finally {
        resolvingPreview = false
      }
    },
  )
  unwatchGraph = () => {
    offUpdated()
    offPreview()
  }
}

/**
 * Applies one property edit from the properties pane.
 *
 * Both modes go through the editor's `updateNode`, not the graph's: the
 * editor's version also runs layout for the node (`runLayoutForNode`), where
 * the graph's does not. Skipping that left a layout-affecting edit — padding,
 * item spacing, a sizing mode, text that changes an auto-layout frame's hugged
 * size — visually inert. On commit the frame sat still until the server's
 * `file:changed` echo came back and `applyChanges` ran layout on the
 * reconciled document, then jumped moments later; on preview it never
 * reflowed at all, so a scrub moved the number and not the frame.
 *
 * `runPreviewUpdates` is what makes it safe to run layout on every pointer
 * move. Inside that scope the graph downgrades every `updateNode` to
 * `updateNodePreview`, which repaints and emits `node:previewUpdated` instead
 * of `node:updated` — and the downgrade is transitive, so the reflow's own
 * writes (Yoga applies computed geometry through `updateNode` too) are
 * downgraded with it. `watchGraph` listens for `node:updated` alone, so the
 * whole scrub still emits nothing and release still emits exactly one patch.
 *
 * Nothing here is throttled, because the pass is already scoped rather than
 * global: `runLayoutForNode` walks the edited node's subtree and then only
 * those ancestors that lay out their children, never the whole document. A
 * twelve-move scrub of `paddingLeft` on the example button measured 2-4ms on
 * the gesture's first frame — Yoga building its tree, the text measured — and
 * 0.4-0.9ms per frame after, well inside a frame's budget.
 */
function vectorSizeFields(
  address: string,
  width: number,
  height: number,
): Record<string, unknown> | null {
  const saved = current ? resolve(current.tree, address) : null
  if (saved?.element !== 'Vector' || !saved.attrs.vectorPaths) return null
  const dimension = (prop: 'width' | 'height'): number => {
    const value = saved.attrs[prop]?.value ?? 100
    const fields = scenePropFor(prop, value, {
      resolveAlias,
      at: address,
      rootFontSize: rootFontSizeOf(current),
    })
    return typeof fields?.[prop] === 'number' ? (fields[prop] as number) : 100
  }
  const paths = resizeVectorPaths(
    saved.attrs.vectorPaths.value,
    { width: dimension('width'), height: dimension('height') },
    { width, height },
  )
  const fields = paths
    ? scenePropFor('vectorPaths', paths, {
        resolveAlias,
        at: address,
        rootFontSize: rootFontSizeOf(current),
      })
    : null
  if (fields?.vectorNetwork)
    fields.vectorNetwork = withStrokeEndpoints(
      fields.vectorNetwork,
      {
        strokeStartCap: saved.attrs.strokeStartCap?.value,
        strokeEndCap: saved.attrs.strokeEndCap?.value,
      },
      resolveAlias,
    )
  return fields
}

function resizeNode(
  id: string,
  rect: Rect,
  mode: 'preview' | 'commit' | 'cancel',
  widthOnly: boolean,
): void {
  const node = editor.graph.getNode(id)
  const saved = current ? resolve(current.tree, id) : null
  if (!node || !saved || props.writable === false) return
  const geometry = vectorSizeFields(id, rect.width, rect.height)
  const sizing = authoredSizing(saved)
  const fields: Record<string, unknown> = {
    ...resizeWrites(sizing, rect, { widthOnly }),
    ...geometry,
  }
  if (mode === 'cancel') {
    // The preview may have pinned an automatic size. Restore the saved modes
    // as well as the original box when the browser interrupts the gesture.
    for (const key of ['primaryAxisSizing', 'counterAxisSizing', 'textAutoResize'] as const) {
      if (sizing[key] !== undefined) fields[key] = sizing[key]
    }
  }
  authoredWrite = {
    address: id,
    props: new Set([
      'x',
      'y',
      'width',
      'height',
      'primaryAxisSizingMode',
      'counterAxisSizingMode',
      'textAutoResize',
      ...(geometry ? ['vectorPaths'] : []),
    ]),
  }
  try {
    if (mode !== 'commit') editor.graph.runPreviewUpdates(() => editor.updateNode(id, fields))
    else {
      editor.updateNode(id, fields)
      recordSceneWrite(id, fields)
    }
  } finally {
    authoredWrite = null
  }
  canvas.renderNow()
}

/**
 * A settled drag or arrow nudge (C10a), written the way a panel edit is.
 *
 * The gesture's preview has already put the node at `at`, and the patched
 * graph raises no `node:updated` for a write that changes nothing — so a
 * settle routed through `editor.updateNode` alone never reached
 * `recordSceneWrite`, and a drag showed on the canvas, in the panel, and
 * nowhere in the file. Recorded explicitly, like a resize, and vouched as
 * the author's: taking a node somewhere *is* choosing its position.
 */
function moveNode(id: string, at: Point): void {
  if (props.writable === false) return
  const fields = { x: at.x, y: at.y }
  authoredWrite = { address: id, props: new Set(['x', 'y']) }
  try {
    editor.updateNode(id, fields)
    recordSceneWrite(id, fields)
  } finally {
    authoredWrite = null
  }
  canvas.renderNow()
}

/** The angle under the pointer while a rotation is in flight, in pane px. */
const rotationReadout = ref<{ x: number; y: number; degrees: number } | null>(null)

const formatDegrees = (degrees: number): string => `${Math.round(degrees * 10) / 10}°`

/** Canvas units to pane px — the camera the SDK's own overlays map through. */
const toPane = (point: Point): Point => ({
  x: point.x * editor.state.zoom + editor.state.panX,
  y: point.y * editor.state.zoom + editor.state.panY,
})

/**
 * A rotation in flight, settled, or abandoned — `resizeNode`'s three modes,
 * for `moveNode`'s reason: the settle has to be recorded by hand. The preview
 * frames also carry the readout beside the pointer, the way the size pill
 * follows a resize. The grip itself is the renderer's: `drawBoundsHandles`
 * paints one on a stem above the selection, and the controller's hit-test
 * (`rotationHandlePoint`) is measured to land on it.
 */
function rotateNode(
  id: string,
  rotation: number,
  mode: 'preview' | 'commit' | 'cancel',
  at: Point,
): void {
  if (props.writable === false) return
  const fields = { rotation }
  if (mode !== 'commit') {
    editor.graph.runPreviewUpdates(() => editor.updateNode(id, fields))
    rotationReadout.value = mode === 'preview' ? { ...toPane(at), degrees: rotation } : null
    canvas.renderNow()
    return
  }
  rotationReadout.value = null
  authoredWrite = { address: id, props: new Set(['rotation']) }
  try {
    editor.updateNode(id, fields)
    recordSceneWrite(id, fields)
  } finally {
    authoredWrite = null
  }
  canvas.renderNow()
}

function applyProp(
  address: string,
  prop: string,
  value: JsonValue,
  mode: 'preview' | 'commit',
): void {
  if (props.writable === false) return
  const graph = scene.value?.graph
  if (!graph || !graph.getNode(address)) return
  const saved = current ? resolve(current.tree, address) : null
  const stroke = saved
    ? strokeEdit(saved, prop, value, resolveAlias, rootFontSizeOf(current))
    : null
  if (stroke) {
    panelPreview = mode === 'preview' ? { address, fields: stroke.fields } : null
    graph.runPreviewUpdates(() => editor.updateNode(address, stroke.fields))
    if (mode === 'commit' && stroke.patches.length) emit('patches', stroke.patches)
    canvas.renderNow()
    return
  }
  const fields = scenePropFor(prop, value, {
    resolveAlias,
    at: address,
    rootFontSize: rootFontSizeOf(current),
  })
  if (!fields) return

  /*
   * A size typed onto an axis the node hugs also flips that axis to Fixed —
   * the same thing a resize handle does (C10a's `resize-writes.ts`), and what
   * Figma does. Without it the number would be a size the layout immediately
   * recomputes away.
   *
   * The question goes to the *document*, never to the scene node. A typed
   * number previews on every keystroke, and the first preview would apply the
   * flip to the graph — where `runPreviewUpdates` downgrades the event, so it
   * never reaches the file but does change the node. Every preview after it,
   * and the commit that matters, would then ask a node already reading `FIXED`
   * and be told there was nothing to flip. That is exactly how C7 shipped a
   * width the file's own sizing mode contradicted.
   */
  const node = graph.getNode(address)
  const docNode = current ? resolve(current.tree, address) : null
  let sized =
    docNode && (prop === 'width' || prop === 'height')
      ? { ...fields, ...sizingFlipFor(authoredSizing(docNode), prop) }
      : fields

  /*
   * The absolute-position toggle says everything it means, like a resize does:
   * ABSOLUTE pins the node's current x/y in the same commit so it does not
   * land at 0,0 on the next load; AUTO hands position back to the layout and
   * takes the pinned numbers out of the file with it (`position-writes.ts`).
   */
  let removals: ('x' | 'y')[] = []
  if (node && prop === 'layoutPositioning' && (value === 'ABSOLUTE' || value === 'AUTO')) {
    const writes = positioningWrites({ x: node.x, y: node.y }, value, docNode)
    sized = writes.fields
    removals = writes.removals
  }

  const vectorGeometry =
    node && (prop === 'width' || prop === 'height')
      ? vectorSizeFields(
          address,
          prop === 'width' ? (fields.width ?? node.width) : node.width,
          prop === 'height' ? (fields.height ?? node.height) : node.height,
        )
      : null
  if (vectorGeometry) sized = { ...sized, ...vectorGeometry }

  // The panel knows this was a person, which D4's heuristic cannot see.
  authoredWrite = {
    address,
    // Named as the file names them: `fromSceneChange` vouches by uidx prop,
    // and the scene calls these `primaryAxisSizing`. The pin's x/y are the
    // author's too — taking Absolute *is* choosing this position.
    props: new Set([
      prop,
      ...(vectorGeometry ? ['vectorPaths'] : []),
      ...Object.keys(sized)
        .filter((key) => key.endsWith('Sizing'))
        .map((key) => `${key}Mode`),
      ...(prop === 'layoutPositioning' ? ['x', 'y'] : []),
    ]),
  }
  // Remembered so a remote document landing mid-scrub can be re-covered by the
  // value under the author's finger; a commit ends the scrub and lets go. A
  // compound control previews several props per step, so the fields accrue.
  panelPreview =
    mode === 'preview'
      ? {
          address,
          fields: panelPreview?.address === address ? { ...panelPreview.fields, ...sized } : sized,
        }
      : null
  try {
    if (mode === 'preview') graph.runPreviewUpdates(() => editor.updateNode(address, sized))
    else {
      editor.updateNode(address, sized)
      recordSceneWrite(address, sized)
    }
  } finally {
    authoredWrite = null
  }
  // The authored unit must survive even if conversion left the canvas unchanged.
  // Put it last so collapseBurst replaces the scene's measured value in this edit.
  if (mode === 'commit' && LENGTH_PROPS.has(prop) && saved && saved.attrs[prop]?.value !== value) {
    if (!burst.length) queueMicrotask(flushBurst)
    burst.push({ op: saved.attrs[prop] ? 'set' : 'add', address, prop, value })
  }
  // The removals ride in the flip's own envelope: `collapseBurst` folds them
  // over any tracked write the re-layout announced for the same attributes.
  if (mode === 'commit' && removals.length) {
    if (!burst.length) queueMicrotask(flushBurst)
    burst.push(...removals.map((p) => ({ op: 'remove' as const, address, prop: p })))
  }
  canvas.renderNow()
}

/**
 * The panel's cursor, drawn on the canvas. Figma answers a hovered padding
 * field by tinting that band on the frame; the SDK already draws every one of
 * these overlays, so this only has to say which one and on what.
 */
function applyHover(address: string, prop: string | null): void {
  const id = scene.value?.addresses.sceneIdOf(address)
  const target = prop ? hoverTargetFor(prop) : null
  if (!id || !target) {
    editor.setAutoLayoutHover(null)
    editor.setHoveredNode(null)
  } else if (target.kind === 'node') {
    editor.setAutoLayoutHover(null)
    editor.setHoveredNode(id)
  } else {
    editor.setHoveredNode(null)
    editor.setAutoLayoutHover(
      target.kind === 'padding-value'
        ? { nodeId: id, kind: 'padding-value', side: target.side }
        : { nodeId: id, kind: target.kind },
    )
  }
  canvas.renderNow()
}

/**
 * The scene node an address names, or nothing.
 *
 * Nothing is the ordinary answer while a save is in flight: the panel holds an
 * address from the document it was handed, and the graph is rebuilt from the
 * next one. An export asked for a node that has gone is a question with no
 * answer, not an error.
 */
function sceneIdFor(address: string): string | null {
  return scene.value?.addresses.sceneIdOf(address) ?? null
}

/**
 * How large the file will be, in the units the exporter measures.
 *
 * The panel cannot work this out: `width` and `height` are the box a node
 * declares, and this is the box it occupies — an outside stroke, a drop shadow
 * and every descendant push past the declaration, and all three end up in the
 * PNG. Recomputed by the shell whenever the selection or the document moves.
 */
/**
 * The node's resolved box, and the box it is pinned inside (H2, ADR 0011).
 *
 * The panel can work out neither. A pinned node's `x` is the resolve pass's
 * answer and appears in no attribute, and the parent's size is whatever layout
 * settled on — so the panel would have to hold a scene graph to ask. Measured
 * here for the same reason `exportBounds` is, and recomputed by the shell
 * whenever the selection or the document moves.
 */
function pinFrame(address: string): PinFrame | null {
  const graph = editor.graph
  const id = sceneIdFor(address)
  const node = id ? graph?.getNode(id) : undefined
  const parentId = node?.parentId
  const parent = parentId ? graph?.getNode(parentId) : undefined
  if (!node || !parent) return null
  return {
    box: { x: node.x, y: node.y, width: node.width, height: node.height },
    parent: { width: parent.width, height: parent.height },
  }
}

function exportBounds(address: string): ExportBounds | null {
  const graph = editor.graph
  const id = sceneIdFor(address)
  return graph && id ? computeContentBounds(graph, [id]) : null
}

/**
 * Render one node and hand back the bytes — a string for SVG, bytes for the
 * two raster formats.
 *
 * `renderNodesToImage` allocates its own raster surface, so this does not
 * disturb the surface on screen. `prepareForExport` is what makes the file
 * match the canvas: the renderer keeps only the glyphs and images the current
 * viewport demanded, and a node scrolled out of view — or never scrolled into
 * it — would otherwise render with fallback type and missing fills. It returns
 * the release for what it loaded, which runs even if the render throws.
 */
async function exportNode(
  address: string,
  format: ExportFormat,
  scale: number,
): Promise<Uint8Array | string | null> {
  const graph = editor.graph
  const id = sceneIdFor(address)
  if (!graph || !id) return null
  const pageId = pageIdFor(graph, id)
  if (!pageId) return null

  const raster = rasterFormatFor(format)
  if (!raster) return renderNodesToSVG(graph, pageId, [id])

  const renderer = editor.renderer
  if (!renderer) return null
  // The same memoised instance `useCanvas` built the renderer with — this
  // resolves immediately and allocates no second copy of CanvasKit.
  const ck = await getCanvasKit()
  const release = await renderer.prepareForExport(graph, pageId, [id])
  try {
    return renderNodesToImage(ck, renderer, graph, pageId, [id], { scale, format: raster })
  } finally {
    release()
  }
}

/**
 * Artwork this page may paint with has moved on disk (ADR 0006 §9).
 *
 * Two steps, and the second is why this is a method rather than a watcher: the
 * store is a cache with no expiry, so it has to be told to forget the path, and
 * then the page has to be rebuilt — `diffDocuments` cannot see this at all,
 * because the document did not move, the bytes did. That is the same reason
 * `renderWithAssets` takes a `rebuild` flag for a newly-arrived image.
 *
 * Returns without rendering when this surface never held the file, which is the
 * common case: the shell announces every change to the document's artwork, and
 * the open page paints with at most a few of them.
 */
function invalidateAsset(src: string): void {
  if (!assets.invalidate(src)) return
  void renderWithAssets(props.doc, true)
}

defineExpose({
  editVector,
  vectorAction: (action: VectorAction) => controls.vectorAction(action),
  finishDrawing,
  applyProp,
  applyHover,
  exportBounds,
  exportNode,
  graphRevision,
  invalidateAsset,
  pinFrame,
  previewRevision,
})

watch(
  () => props.doc,
  (doc) => void renderWithAssets(doc),
)

/**
 * The component index that the graph on screen was built from (F3).
 *
 * An instance's subtree comes from a definition that may live on another page,
 * so a page this canvas never renders can change what it draws — the same shape
 * of problem D8's asset bytes have, where "the document did not move, the
 * bytes did". `diffDocuments` cannot see it either, because it is handed two
 * versions of *this* page.
 */
let renderedWith: ReadonlyMap<string, UidxNode> | undefined
/** The components this page instances — the only definitions whose content matters here. */
const instanced = computed(() => instancedComponents(props.doc))
/**
 * Of those, the ones declared on *other* pages. A definition declared here
 * arrives in the same document the diff reads, and the diff updates every
 * instance copy itself (`update-generated`), so only a foreign definition
 * moving is a reason to rebuild. This is also what keeps the confirmation of
 * a same-page component edit from rebuilding: the doc watch runs before the
 * new component index reaches this pane's props, so comparing the whole index
 * here read "Atlas changed" a tick after the diff had already drawn it.
 */
const foreign = computed(
  () => new Set([...instanced.value].filter((name) => !declaredComponents(props.doc).has(name))),
)

// After the `doc` watch, deliberately: a save to *this* page updates both, and
// Vue flushes in creation order — so the render above has already happened and
// recorded the index it used, which is what makes this a no-op rather than a
// second pass over the same document.
watch(
  () => props.components,
  (next) => {
    if (!definitionsMoved(renderedWith, next, foreign.value)) {
      renderedWith = next
      return
    }
    void renderWithAssets(props.doc, true)
  },
)

/** Importing a face changes text metrics even when the document did not change. */
watch(fontGeneration, () => {
  void renderWithAssets(props.doc, true)
})

const unrenderable = computed<{ address: string; characters: string[] }[]>(() => {
  void fontGeneration.value
  void graphRevision.value
  const out: { address: string; characters: string[] }[] = []
  // The resolved scene includes component instances, aliases and active modes.
  for (const node of scene.value?.graph.getAllNodes() ?? []) {
    if (node.type !== 'TEXT') continue
    const missing = coverageForFont(node.fontFamily)?.missing(node.text) ?? []
    if (missing.length)
      out.push({
        address: scene.value?.addresses.addressOf(node.id) ?? node.name,
        characters: missing,
      })
  }
  return out
})

const missingFonts = computed(() => {
  void graphRevision.value
  const missing = new Set<string>()
  for (const node of scene.value?.graph.getAllNodes() ?? []) {
    if (node.type !== 'TEXT') continue
    const family = node.fontFamily
    const bundled =
      family.toLowerCase() === 'inter' &&
      !node.italic &&
      [400, 500, 600, 700].includes(node.fontWeight)
    if (
      !bundled &&
      !projectFonts.value.some(
        (font) =>
          font.family.toLowerCase() === family.toLowerCase() &&
          font.weight === node.fontWeight &&
          font.italic === node.italic,
      )
    )
      missing.add(`${family} ${node.fontWeight}${node.italic ? ' Italic' : ''}`)
  }
  return [...missing]
})

/**
 * A token change alters what to draw without touching this page's document, so
 * the diff would see nothing to do. Rebuilding is the honest response: the
 * values every node resolved against have moved.
 *
 * Compared by value rather than by reference. `tokens` is a computed over every
 * page of the document, and the viewer re-derives it on each `file:changed` —
 * so it is a fresh Map after every save even when not one token moved. Watching
 * the reference meant an edit to any page took the rebuild path, which drops
 * selection and undo history and, before the guard above, refit the camera.
 * That is the whole of the reported "canvas jumps back into place".
 */
function tokenSignature(tokens: Map<string, JsonValue> | undefined): string {
  if (!tokens || tokens.size === 0) return ''
  return JSON.stringify([...tokens].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)))
}

let lastTokens = tokenSignature(props.tokens)

watch(
  () => props.tokens,
  (next) => {
    const signature = tokenSignature(next)
    if (signature === lastTokens) return
    lastTokens = signature
    void renderWithAssets(props.doc, true)
  },
)
onUnmounted(() => unwatchGraph?.())
</script>

<template>
  <main class="canvas-pane">
    <p v-if="!ready" class="loading-status" role="status">Loading canvas…</p>
    <div v-else class="viewport-tools" role="group" aria-label="Canvas view">
      <details
        class="canvas-help"
        @keydown.esc="($event.currentTarget as HTMLDetailsElement).open = false"
      >
        <summary title="Canvas shortcuts" aria-label="Canvas shortcuts">?</summary>
        <div class="help-popover">
          <strong>Move around the canvas</strong>
          <dl>
            <div>
              <dt>Pan</dt>
              <dd>Scroll / Space + drag</dd>
            </div>
            <div>
              <dt>Zoom</dt>
              <dd>⌘ / Ctrl + scroll</dd>
            </div>
            <div>
              <dt>Fit canvas</dt>
              <dd>Shift + 1</dd>
            </div>
            <div>
              <dt>Fit selection</dt>
              <dd>Shift + 2</dd>
            </div>
            <div>
              <dt>Enter group</dt>
              <dd>Double-click</dd>
            </div>
            <div>
              <dt>Select nested layer</dt>
              <dd>⌘ / Ctrl + click</dd>
            </div>
            <div>
              <dt>Step out</dt>
              <dd>Esc</dd>
            </div>
          </dl>
        </div>
      </details>
      <span class="view-divider" aria-hidden="true" />
      <button type="button" title="Fit canvas — Shift+1" aria-label="Fit canvas" @click="fitCanvas">
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M6 2.5H2.5V6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10"
            fill="none"
            stroke="currentColor"
            stroke-width="1.3"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </button>
      <select :value="cameraZoom" aria-label="Canvas zoom" title="Canvas zoom" @change="chooseZoom">
        <option :value="cameraZoom" hidden>{{ Math.round(cameraZoom * 100) }}%</option>
        <option v-for="level in [0.25, 0.5, 0.75, 1, 1.5, 2, 4]" :key="level" :value="level">
          {{ level * 100 }}%
        </option>
      </select>
    </div>
    <div v-if="controls.entered.value" class="entered-context">
      <span :title="controls.entered.value">{{ controls.entered.value }}</span
      ><kbd>Esc to exit</kbd>
    </div>
    <div class="canvas-dock">
      <slot name="tools" />
    </div>
    <div v-if="toolHint || vectorInfo" class="drawing-guide" role="status">
      <span v-if="vectorInfo"
        >Editing vector · {{ vectorInfo.points }} points · Drag points or handles. Double-click a
        path to add a point.</span
      >
      <span v-else>{{ toolHint }}</span>
      <button
        v-if="vectorInfo || tool === 'Vector'"
        type="button"
        :disabled="writable === false"
        @click="finishDrawing"
      >
        Done
      </button>
    </div>
    <canvas ref="sceneEl" class="surface" aria-hidden="true" />
    <canvas ref="canvasEl" class="surface" @dragover.prevent @drop="onDrop" />

    <div
      v-if="rotationReadout"
      class="rotation-readout"
      role="status"
      :style="{ left: `${rotationReadout.x}px`, top: `${rotationReadout.y}px` }"
    >
      {{ formatDegrees(rotationReadout.degrees) }}
    </div>

    <!-- Dimmed over the last good render, never instead of it (spec §11). -->
    <div v-if="diagnostics.length" class="overlay">
      <h3>{{ diagnostics.length }} problem{{ diagnostics.length === 1 ? '' : 's' }}</h3>
      <ul>
        <li v-for="(d, i) in diagnostics" :key="i">
          <span class="where">{{ d.line }}:{{ d.column }}</span>
          <span class="code">{{ d.code }}</span>
          {{ d.message }}
        </li>
      </ul>
      <p class="hint">
        {{ hasRendered ? 'showing the last valid render' : 'nothing has rendered yet' }} — fix the
        file and it recovers on its own
      </p>
    </div>

    <!--
      Not the error overlay: the file is valid and the rest of the canvas is
      correct. This is the one thing the canvas cannot show, so it is said in
      words rather than left as an empty box.
    -->
    <div class="cannot-draw">
      <!--
        Named rather than left as an empty box: a rectangle with a missing image
        draws nothing at all, and nothing is indistinguishable from a bug.
      -->
      <div v-if="missingAssets.length" class="missing-glyphs" role="status">
        <h3>
          {{ missingAssets.length }} image{{ missingAssets.length === 1 ? '' : 's' }} will not draw
        </h3>
        <ul>
          <li v-for="src in missingAssets" :key="src">
            <span class="where">{{ src }}</span>
          </li>
        </ul>
        <p class="hint">
          Nothing is at that path. A `src` is relative to the folder holding uidx.json, and has to
          sit under one of its "assets" globs — `uidx check` fails the build on both.
        </p>
      </div>

      <div v-if="missingFonts.length || fontLibraryError" class="missing-glyphs" role="status">
        <h3 v-if="missingFonts.length">Missing fonts: {{ missingFonts.join(', ') }}</h3>
        <p v-if="fontLibraryError">{{ fontLibraryError }}</p>
        <p class="hint">Open the Fonts tab to import the fonts used by this page.</p>
      </div>
      <div v-else-if="unrenderable.length" class="missing-glyphs" role="status">
        <h3>
          {{ unrenderable.length }} text node{{ unrenderable.length === 1 ? '' : 's' }} will not
          draw
        </h3>
        <ul>
          <li v-for="entry in unrenderable" :key="entry.address">
            <span class="where">{{ entry.address }}</span>
            <span class="chars">{{ entry.characters.join(' ') }}</span>
          </li>
        </ul>
        <p class="hint">
          The selected fonts have no glyph for these characters. Import a font that supports this
          language in the Fonts tab, then apply it to these text layers.
        </p>
      </div>
    </div>
  </main>
</template>

<style scoped>
.canvas-pane {
  position: relative;
  background: var(--canvas-bg);
  container-type: inline-size;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
.surface {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
}
.loading-status {
  position: absolute;
  top: 32px;
  left: 32px;
  z-index: 1;
  color: var(--text-dim);
}
.rotation-readout {
  position: absolute;
  z-index: 4;
  transform: translate(14px, 14px);
  padding: 2px 6px;
  border-radius: var(--radius);
  background: var(--accent);
  color: #fff;
  font-size: var(--ui-size);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  pointer-events: none;
}
.viewport-tools {
  position: absolute;
  top: 32px;
  right: 16px;
  z-index: 5;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--panel);
  box-shadow: var(--shadow-sm);
}
.viewport-tools button,
.viewport-tools summary {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: none;
  color: var(--text-dim);
  font: inherit;
  cursor: pointer;
}
.viewport-tools summary {
  font-size: 13px;
  font-weight: 600;
  list-style: none;
}
.viewport-tools summary::-webkit-details-marker {
  display: none;
}
.viewport-tools button:hover,
.viewport-tools summary:hover {
  background: var(--raised);
  color: var(--text);
}
.viewport-tools select {
  width: 70px;
  height: 28px;
  padding: 0 4px;
  border: 0;
  border-radius: 6px;
  background: var(--panel);
  color: var(--text);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
}
.viewport-tools :is(button, summary, select):focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
.view-divider {
  width: 1px;
  height: 16px;
  margin: 0 3px;
  background: var(--line);
}
.help-popover {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  width: 286px;
  max-width: calc(100cqw - 32px);
  padding: 16px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--panel);
  box-shadow: var(--shadow-float);
}
.help-popover strong {
  font-weight: 600;
}
.help-popover dl {
  display: grid;
  gap: 12px;
  margin: 16px 0 0;
}
.help-popover dl > div {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}
.help-popover dt {
  color: var(--text-dim);
}
.help-popover dd {
  margin: 0;
  text-align: right;
}
.entered-context {
  position: absolute;
  top: 80px;
  left: 32px;
  right: 16px;
  width: fit-content;
  max-width: calc(100% - 48px);
  z-index: 1;
  display: flex;
  gap: 12px;
  padding: 6px 10px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--panel);
  color: var(--bound);
  pointer-events: none;
}
.entered-context span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.entered-context kbd {
  flex: none;
  color: var(--text-dim);
  font: inherit;
}
.canvas-dock {
  position: absolute;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  width: max-content;
  max-width: calc(100% - 32px);
  z-index: 6;
}
.overlay {
  position: absolute;
  inset: 0;
  z-index: 2;
  padding: 20px;
  overflow: auto;
  background: var(--overlay);
  color: var(--danger);
  font-family: var(--ui-font);
  font-size: 12px;
}
.overlay h3 {
  margin: 0 0 12px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
.overlay ul {
  list-style: none;
  padding: 0;
  margin: 0 0 14px;
}
.overlay li {
  padding: 4px 0;
  word-break: break-word;
}
.where {
  color: var(--text-faint);
  margin-right: 8px;
}
.code {
  color: var(--danger);
  font-weight: 700;
  margin-right: 8px;
}
.hint {
  color: var(--text-faint);
  margin: 0;
}

/*
 * Anchored to a corner rather than covering the canvas: the render is correct
 * apart from these nodes, so hiding it would overstate the problem.
 */
/*
 * Two of these can be on screen at once — missing images and missing glyphs —
 * so `.cannot-draw` stacks them instead of each claiming the same corner.
 */
.cannot-draw {
  position: absolute;
  right: 12px;
  bottom: 88px;
  display: flex;
  flex-direction: column;
  gap: var(--gap);
  align-items: flex-end;
  max-width: 60%;
}
.missing-glyphs {
  z-index: 2;
  max-width: 420px;
  max-height: 45%;
  overflow: auto;
  padding: 12px 14px;
  border: 1px solid color-mix(in srgb, var(--warn) 34%, transparent);
  border-radius: 6px;
  background: var(--overlay);
  color: var(--warn);
  font-family: var(--ui-font);
  font-size: 11px;
}
.missing-glyphs h3 {
  margin: 0 0 8px;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
.missing-glyphs ul {
  list-style: none;
  padding: 0;
  margin: 0 0 10px;
}
.missing-glyphs li {
  padding: 3px 0;
  word-break: break-word;
}
/*
 * Brighter than the label around it: these are the characters that will not
 * draw, and they are what the author is here to read.
 */
.missing-glyphs .chars {
  color: color-mix(in srgb, var(--warn) 40%, var(--text));
  letter-spacing: 0.25em;
}
</style>

<style scoped>
.drawing-guide {
  position: absolute;
  top: 84px;
  bottom: auto;
  left: 50%;
  transform: translateX(-50%);
  z-index: 4;
  display: flex;
  align-items: center;
  gap: 16px;
  max-width: calc(100% - 32px);
  width: max-content;
  padding: 10px 12px;
  background: var(--panel);
  color: var(--text-dim);
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow);
  font-size: var(--ui-size);
}
.drawing-guide button {
  border: 0;
  border-radius: var(--radius);
  background: var(--accent);
  color: var(--text);
  padding: 5px 12px;
  cursor: pointer;
  font: inherit;
}
</style>
