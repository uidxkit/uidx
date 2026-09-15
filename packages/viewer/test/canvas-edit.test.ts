import { describe, expect, it } from 'vitest'
import type { Subpath, VertexOverlay } from '../src/vertex-edit'
import {
  createCanvasController,
  type CanvasLike,
  type EditableNode,
  type KeyTarget,
  type ViewportEditor,
} from '../src/useCanvasControls'
import { ROTATE_HANDLE_STEM } from '../src/gesture-model'

class FakeTarget implements CanvasLike, KeyTarget {
  handlers = new Map<string, ((event: never) => void)[]>()
  addEventListener(type: string, handler: (event: never) => void): void {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), handler])
  }
  removeEventListener(type: string, handler: (event: never) => void): void {
    this.handlers.set(
      type,
      (this.handlers.get(type) ?? []).filter((h) => h !== handler),
    )
  }
  style = { cursor: '' }
  getBoundingClientRect() {
    return { left: 0, top: 0 }
  }
  fire(type: string, event: Record<string, unknown> = {}): void {
    for (const handler of this.handlers.get(type) ?? []) {
      handler({ preventDefault() {}, ...event } as never)
    }
  }
}

/**
 * `box` sits inside `page`, which lays nothing out — so its position is the
 * author's. `flowed` sits inside `stack`, which does — so its position is not.
 */
function harness(
  over: Partial<Record<string, Partial<EditableNode>>> = {},
  /** With `hooks`, the host commits moves and rotations, as `CanvasPane` does. */
  options: { hooks?: boolean } = {},
) {
  const nodes: Record<string, EditableNode> = {
    page: { id: 'page', x: 0, y: 0, width: 1000, height: 1000, layoutMode: 'NONE' },
    box: {
      id: 'box',
      parentId: 'page',
      x: 100,
      y: 100,
      width: 200,
      height: 100,
      type: 'RECTANGLE',
      rotation: 0,
    },
    stack: {
      id: 'stack',
      parentId: 'page',
      x: 500,
      y: 0,
      width: 100,
      height: 100,
      layoutMode: 'VERTICAL',
      primaryAxisSizing: 'HUG',
      counterAxisSizing: 'HUG',
    },
    flowed: { id: 'flowed', parentId: 'stack', x: 500, y: 0, width: 100, height: 40 },
    // A `<Vector>` whose path is a right-angled triangle, in canvas
    // coordinates: (700,100) (760,100) (760,160), closed.
    vector: {
      id: 'vector',
      parentId: 'page',
      x: 700,
      y: 100,
      width: 60,
      height: 60,
      type: 'VECTOR',
      rotation: 0,
    },
    // A second vector, curved, so there are tangent handles to grab. Its middle
    // point is smooth: `in` and `out` are exact opposites.
    curve: {
      id: 'curve',
      parentId: 'page',
      x: 700,
      y: 300,
      width: 80,
      height: 40,
      type: 'VECTOR',
      rotation: 0,
    },
    // A nested node whose coordinates are relative to a parent well away from
    // the origin — the case that told absolute and local space apart.
    outer: { id: 'outer', parentId: 'page', x: 400, y: 300, width: 300, height: 200 },
    inner: {
      id: 'inner',
      parentId: 'outer',
      x: 10,
      y: 20,
      width: 100,
      height: 50,
      type: 'RECTANGLE',
      rotation: 0,
    },
  }

  /** Local coordinates are relative to the parent; the pointer is not. */
  const absoluteOf = (id: string): { x: number; y: number } | undefined => {
    let node = nodes[id]
    if (!node) return undefined
    let x = node.x
    let y = node.y
    while (node.parentId && nodes[node.parentId] && node.parentId !== 'page') {
      node = nodes[node.parentId]!
      x += node.x
      y += node.y
    }
    return { x, y }
  }
  for (const [id, patch] of Object.entries(over)) Object.assign(nodes[id]!, patch)

  /**
   * The editor's `updateNode` runs layout for the node it touched; the graph's
   * `updateNodePreview` does not. Modelled here so a gesture that previews
   * without layout is visible as a child left where layout would not put it.
   */
  const runLayout = (id: string): void => {
    const node = nodes[id]
    if (!node || (node.layoutMode !== 'VERTICAL' && node.layoutMode !== 'HORIZONTAL')) return
    let offset = 0
    for (const child of Object.values(nodes)) {
      if (child.parentId !== id) continue
      child.x = node.x
      child.y = node.y + offset
      offset += child.height
    }
  }

  let previewing = false
  const previews: Array<{ id: string; changes: Record<string, unknown> }> = []
  const commits: Array<{ id: string; changes: Record<string, unknown> }> = []
  const moveCommits: Array<Map<string, { x: number; y: number }>> = []
  const resizeCommits: string[] = []
  const rotateCommits: Array<{ id: string; original: number }> = []

  let hit: { id: string } | null = { id: 'box' }

  /** Every highlight the controller asked the renderer for, in order. */
  const dropTargets: Array<string | null> = []
  /** Every marquee it asked for — the draw gesture's only affordance. */
  const marquees: Array<{ x: number; y: number; width: number; height: number } | null> = []

  const editor: ViewportEditor = {
    state: { panX: 0, panY: 0, zoom: 1, selectedIds: new Set<string>(), enteredContainerId: null },
    setZoomAroundPoint() {},
    zoomToFit() {},
    zoomToSelection() {},
    zoomTo100() {},
    screenToCanvas: (sx: number, sy: number) => ({ x: sx, y: sy }),
    selectAtPoint() {},
    select(ids: string[]) {
      this.state.selectedIds = new Set(ids)
    },
    enterContainer() {},
    exitContainer() {},
    clearSelection() {
      this.state.selectedIds = new Set()
    },
    setHoveredNode() {},
    setDropTarget: (id) => dropTargets.push(id),
    setMarquee: (rect) => marquees.push(rect),
    setLayoutInsertIndicator: (caret) => carets.push(caret),
    setPenState: (state) => penStates.push(state),
    setVertexEditState: (state) => vertexStates.push(state),
    hitTestAtPoint: () => hit,
    requestRender() {},
    absolutePositionOf: absoluteOf,
    graph: {
      getNode: (id: string) => nodes[id],
      updateNodePreview(id, changes) {
        previews.push({ id, changes: changes as Record<string, unknown> })
        Object.assign(nodes[id]!, changes)
      },
      runPreviewUpdates(fn) {
        // The real one downgrades `node:updated` so no patch is emitted; the
        // write itself is the same call.
        previewing = true
        try {
          fn()
        } finally {
          previewing = false
        }
      },
    },
    updateNode(id, changes) {
      const record = previewing ? previews : commits
      record.push({ id, changes: changes as Record<string, unknown> })
      Object.assign(nodes[id]!, changes)
      runLayout(id)
    },
    commitMove: (originals) => moveCommits.push(originals),
    commitResize: (id) => resizeCommits.push(id),
    commitRotation: (id, original) => rotateCommits.push({ id, original }),
  }

  const canvas = new FakeTarget()
  const keys = new FakeTarget()

  /**
   * Stands in for the document question `CanvasPane` asks: `stack` takes a drop
   * while the pointer is inside it, and nothing else ever does. Position-aware
   * on purpose — a controller that asked at the press rather than at the
   * pointer would pass a fixed answer and never be caught.
   */
  const dropTargetFor = (draggedId: string, point: { x: number; y: number }): string | null => {
    const stack = nodes.stack!
    const inside =
      point.x >= stack.x &&
      point.x <= stack.x + stack.width &&
      point.y >= stack.y &&
      point.y <= stack.y + stack.height
    if (!inside || draggedId === 'stack') return null
    // Null for a node already inside `stack`, because the real `dropTargetFor`
    // answers null there: a drop back into your own parent is a move.
    return nodes[draggedId]?.parentId === 'stack' ? null : 'stack'
  }

  const reparents: Array<{ id: string; parentId: string }> = []
  const reorders: Array<{ id: string; index: number }> = []
  const penPaths: Array<{ vertices: unknown[]; closed: boolean }> = []
  /** Every in-progress pen overlay the controller handed the renderer. */
  const penStates: Array<{ vertices: { x: number; y: number }[] } | null> = []
  /** Every vertex-editing overlay it handed the renderer (D12). */
  const vertexStates: Array<VertexOverlay | null> = []
  /** Every settled vertex edit, as the whole path in canvas coordinates. */
  const vertexPaths: Array<{ id: string; subpaths: Subpath[] }> = []
  /** Entering (an id) and leaving (null) vertex editing, in order. */
  const vertexEdits: Array<string | null> = []

  /**
   * Stands in for what `CanvasPane` reads out of the scene graph: only the
   * `<Vector>` has a path, and it is handed over in canvas coordinates.
   */
  const paths: Record<string, Subpath[]> = {
    vector: [
      {
        closed: true,
        vertices: [
          { x: 700, y: 100, in: { x: 0, y: 0 }, out: { x: 0, y: 0 } },
          { x: 760, y: 100, in: { x: 0, y: 0 }, out: { x: 0, y: 0 } },
          { x: 760, y: 160, in: { x: 0, y: 0 }, out: { x: 0, y: 0 } },
        ],
      },
    ],
    curve: [
      {
        closed: false,
        vertices: [
          { x: 700, y: 300, in: { x: 0, y: 0 }, out: { x: 10, y: 0 } },
          { x: 740, y: 300, in: { x: -20, y: 0 }, out: { x: 20, y: 0 } },
          { x: 780, y: 300, in: { x: -10, y: 0 }, out: { x: 0, y: 0 } },
        ],
      },
    ],
  }
  const vertexPathOf = (id: string) =>
    paths[id] ? { windingRule: 'NONZERO', subpaths: paths[id]! } : null
  /** Every caret the controller asked the renderer for. */
  const carets: Array<{ index: number } | null> = []
  /**
   * Stands in for what `CanvasPane` computes from the graph: `stack` runs down
   * the page in 40px rows, so the slot is how many midpoints the pointer passed.
   */
  const flowSlotAt = (childId: string, point: { x: number; y: number }) => {
    if (nodes[childId]?.parentId !== 'stack') return null
    const index = Math.max(0, Math.min(3, Math.round((point.y - nodes.stack!.y) / 40)))
    return {
      index,
      caret: {
        parentId: 'stack',
        index,
        x: 500,
        y: index * 40,
        length: 100,
        direction: 'HORIZONTAL' as const,
      },
    }
  }
  const creations: Array<{ element: string; at: unknown; size: unknown }> = []
  /** Every settled move the host was handed, when it is the one committing. */
  const moves: Array<{ id: string; at: { x: number; y: number } }> = []
  /** Every rotation frame the host was handed, when it is the one committing. */
  const rotations: Array<{
    id: string
    rotation: number
    mode: 'preview' | 'commit' | 'cancel'
    at: { x: number; y: number }
  }> = []
  /** The tool the toolbar has armed, as the controller reads it: a live getter. */
  let tool: string | null = null
  const controller = createCanvasController(canvas, editor, {
    keyTarget: keys,
    ...(options.hooks
      ? {
          onMove: (id: string, at: { x: number; y: number }) => moves.push({ id, at }),
          onRotate: (
            id: string,
            rotation: number,
            mode: 'preview' | 'commit' | 'cancel',
            at: { x: number; y: number },
          ) => rotations.push({ id, rotation, mode, at }),
        }
      : {}),
    dropTargetFor,
    onReparent: (id, parentId) => reparents.push({ id, parentId }),
    tool: () => tool,
    onCreate: (element, at, size) => creations.push({ element, at, size }),
    flowSlotAt,
    onReorder: (id, index) => reorders.push({ id, index }),
    onPenPath: (vertices, closed) => penPaths.push({ vertices, closed }),
    vertexPathOf,
    onVertexPath: (id, subpaths) => vertexPaths.push({ id, subpaths }),
    onVertexEdit: (id) => vertexEdits.push(id),
  })

  const drag = (
    from: [number, number],
    to: [number, number],
    mods: Record<string, unknown> = {},
  ) => {
    canvas.fire('pointerdown', {
      button: 0,
      clientX: from[0],
      clientY: from[1],
      pointerId: 1,
      ...mods,
    })
    canvas.fire('pointermove', { clientX: to[0], clientY: to[1], pointerId: 1, ...mods })
    canvas.fire('pointerup', { button: 0, clientX: to[0], clientY: to[1], pointerId: 1, ...mods })
  }

  return {
    editor,
    canvas,
    keys,
    nodes,
    controller,
    previews,
    commits,
    moveCommits,
    resizeCommits,
    rotateCommits,
    reparents,
    reorders,
    carets,
    penPaths,
    penStates,
    vertexStates,
    vertexPaths,
    vertexEdits,
    dropTargets,
    creations,
    marquees,
    moves,
    rotations,
    arm: (next: string | null) => (tool = next),
    drag,
    select: (id: string) => {
      editor.state.selectedIds = new Set([id])
    },
    setHit: (id: string | null) => {
      hit = id ? { id } : null
    },
  }
}

describe('drag to move', () => {
  it('previews continuously and commits once when the gesture settles', () => {
    const h = harness()
    h.select('box')
    h.drag([150, 150], [190, 170])
    expect(h.previews.length).toBeGreaterThan(0)
    expect(h.moveCommits).toHaveLength(1)
    expect(h.nodes.box).toMatchObject({ x: 140, y: 120 })
  })

  it('writes nothing for a press that never travelled', () => {
    const h = harness()
    h.select('box')
    h.drag([150, 150], [151, 150])
    expect(h.moveCommits).toHaveLength(0)
    expect(h.commits).toHaveLength(0)
  })

  it('restores move and resize previews when the pointer is cancelled', () => {
    for (const [x, y] of [
      [150, 150],
      [300, 200],
    ]) {
      const h = harness()
      h.select('box')
      h.canvas.fire('pointerdown', { button: 0, clientX: x, clientY: y, pointerId: 1 })
      h.canvas.fire('pointermove', { clientX: x! + 40, clientY: y! + 20, pointerId: 1 })
      expect(h.previews.length).toBeGreaterThan(0)
      h.canvas.fire('pointercancel', { pointerId: 1 })
      expect(h.nodes.box).toMatchObject({ x: 100, y: 100, width: 200, height: 100 })
      expect(h.commits).toHaveLength(0)
      expect(h.moveCommits).toHaveLength(0)
      expect(h.resizeCommits).toHaveLength(0)
      h.controller.reapplyPreview()
      expect(h.nodes.box).toMatchObject({ x: 100, y: 100, width: 200, height: 100 })
      h.controller.destroy()
    }
  })

  it('never writes a position for a node its parent places', () => {
    const h = harness()
    h.select('flowed')
    h.setHit('flowed')
    h.drag([520, 20], [560, 60])
    expect(h.moveCommits).toHaveLength(0)
    expect(h.commits).toHaveLength(0)
  })

  it('moves a node that has escaped its parent’s flow', () => {
    const h = harness({ flowed: { layoutPositioning: 'ABSOLUTE' } })
    h.select('flowed')
    h.setHit('flowed')
    h.drag([520, 20], [560, 60])
    expect(h.moveCommits).toHaveLength(1)
  })

  /**
   * #19: the preview has already put the node at its settled position, and a
   * graph write that changes nothing raises no event — so a settle routed
   * through `updateNode` alone never reached the file. The host records it.
   */
  it('hands the settled origin to the host when the host commits', () => {
    const h = harness({}, { hooks: true })
    h.select('box')
    h.drag([150, 150], [190, 170])
    expect(h.moves).toEqual([{ id: 'box', at: { x: 140, y: 120 } }])
    expect(h.commits).toHaveLength(0)
    // Undo still sees one entry.
    expect(h.moveCommits).toHaveLength(1)
  })

  it('rounds what it hands over, so a drag at zoom does not settle on fractions', () => {
    const h = harness({}, { hooks: true })
    h.editor.state.zoom = 3
    h.editor.screenToCanvas = (sx, sy) => ({ x: sx / 3, y: sy / 3 })
    h.select('box')
    h.drag([450, 450], [490, 470])
    expect(h.moves.at(-1)!.at).toEqual({ x: 113, y: 107 })
  })
})

/**
 * #15: Figma selects on press. Until this landed nothing happened while the
 * button was down, and a click that wobbled past the slop moved the thing it
 * had only meant to select.
 */
describe('select on press', () => {
  it('selects the node under the press before the button comes back up', () => {
    const h = harness()
    h.canvas.fire('pointerdown', { button: 0, clientX: 150, clientY: 150, pointerId: 1 })
    expect([...h.editor.state.selectedIds]).toEqual(['box'])
    expect(h.commits).toHaveLength(0)
    expect(h.previews).toHaveLength(0)
  })

  it('keeps a wobbly click a click', () => {
    const h = harness()
    h.drag([150, 150], [154, 153])
    expect([...h.editor.state.selectedIds]).toEqual(['box'])
    expect(h.moveCommits).toHaveLength(0)
    expect(h.nodes.box).toMatchObject({ x: 100, y: 100 })
  })

  it('still moves once the press has clearly travelled', () => {
    const h = harness()
    h.drag([150, 150], [170, 150])
    expect([...h.editor.state.selectedIds]).toEqual(['box'])
    expect(h.moveCommits).toHaveLength(1)
    expect(h.nodes.box).toMatchObject({ x: 120, y: 100 })
  })
})

/**
 * The pen is the first modal gesture here: every other one begins and ends with
 * a single press, and this one spans as many as the author needs.
 */
describe('the pen', () => {
  /** Click without travelling — a corner vertex. */
  const click = (h: ReturnType<typeof harness>, x: number, y: number) => {
    h.canvas.fire('pointerdown', { button: 0, clientX: x, clientY: y, pointerId: 1 })
    h.canvas.fire('pointerup', { button: 0, clientX: x, clientY: y, pointerId: 1 })
  }
  /** Press and pull — a smooth vertex whose handles follow the drag. */
  const pull = (h: ReturnType<typeof harness>, x: number, y: number, tx: number, ty: number) => {
    h.canvas.fire('pointerdown', { button: 0, clientX: x, clientY: y, pointerId: 1 })
    h.canvas.fire('pointermove', { clientX: tx, clientY: ty, pointerId: 1 })
    h.canvas.fire('pointerup', { button: 0, clientX: tx, clientY: ty, pointerId: 1 })
  }

  it('gathers a vertex per click and finishes open on Enter', () => {
    const h = harness()
    h.arm('Vector')
    click(h, 10, 10)
    click(h, 40, 10)
    click(h, 40, 40)
    h.keys.fire('keydown', { key: 'Enter', code: 'Enter' })
    expect(h.penPaths).toHaveLength(1)
    expect(h.penPaths[0]!.closed).toBe(false)
    expect(h.penPaths[0]!.vertices).toMatchObject([
      { x: 10, y: 10 },
      { x: 40, y: 10 },
      { x: 40, y: 40 },
    ])
  })

  it('closes when the last click lands back on the first vertex', () => {
    const h = harness()
    h.arm('Vector')
    click(h, 10, 10)
    click(h, 40, 10)
    click(h, 40, 40)
    click(h, 12, 12)
    expect(h.penPaths).toHaveLength(1)
    expect(h.penPaths[0]!.closed).toBe(true)
    // The closing click is not a fourth vertex — it names the first one.
    expect(h.penPaths[0]!.vertices).toHaveLength(3)
  })

  it('pulls handles out of a vertex the press drags from', () => {
    const h = harness()
    h.arm('Vector')
    pull(h, 10, 10, 30, 10)
    click(h, 60, 40)
    h.keys.fire('keydown', { key: 'Enter', code: 'Enter' })
    expect(h.penPaths[0]!.vertices).toMatchObject([
      // The vertex stays where the press landed; only its handles followed.
      { x: 10, y: 10, out: { x: 20, y: 0 }, in: { x: -20, y: 0 } },
      { x: 60, y: 40, out: { x: 0, y: 0 } },
    ])
  })

  it('throws the path away on Escape', () => {
    const h = harness()
    h.arm('Vector')
    click(h, 10, 10)
    click(h, 40, 10)
    h.keys.fire('keydown', { key: 'Escape', code: 'Escape' })
    expect(h.penPaths).toHaveLength(0)
    expect(h.penStates.at(-1)).toBeNull()
  })

  it('shows the path as it goes, and clears the overlay when it finishes', () => {
    const h = harness()
    h.arm('Vector')
    click(h, 10, 10)
    click(h, 40, 10)
    h.canvas.fire('pointermove', { clientX: 60, clientY: 30, pointerId: 1 })
    const live = h.penStates.at(-1)!
    expect(live.vertices).toHaveLength(2)
    expect(live).toMatchObject({ cursorX: 60, cursorY: 30 })
    h.keys.fire('keydown', { key: 'Enter', code: 'Enter' })
    expect(h.penStates.at(-1)).toBeNull()
  })

  it('says when the pointer is over the closing target', () => {
    const h = harness()
    h.arm('Vector')
    click(h, 10, 10)
    click(h, 40, 10)
    h.canvas.fire('pointermove', { clientX: 12, clientY: 12, pointerId: 1 })
    expect(h.penStates.at(-1)).toMatchObject({ closingToFirst: true })
    h.canvas.fire('pointermove', { clientX: 90, clientY: 90, pointerId: 1 })
    expect(h.penStates.at(-1)).toMatchObject({ closingToFirst: false })
  })

  it('never sweeps a rect or touches an existing node while it draws', () => {
    const h = harness()
    h.select('box')
    h.arm('Vector')
    // Straight over `box` and its grips, which without the pen would resize it.
    pull(h, 300, 200, 350, 220)
    click(h, 400, 260)
    h.keys.fire('keydown', { key: 'Enter', code: 'Enter' })
    expect(h.creations).toHaveLength(0)
    expect(h.resizeCommits).toHaveLength(0)
    expect(h.moveCommits).toHaveLength(0)
    expect(h.penPaths).toHaveLength(1)
  })

  it('refuses to finish a path of one point, which is not a shape', () => {
    const h = harness()
    h.arm('Vector')
    click(h, 10, 10)
    h.keys.fire('keydown', { key: 'Enter', code: 'Enter' })
    expect(h.penPaths).toHaveLength(0)
  })

  it('is put away when the tool is', () => {
    const h = harness()
    h.arm('Vector')
    click(h, 10, 10)
    click(h, 40, 10)
    h.controller.cancelPen()
    expect(h.penPaths).toHaveLength(0)
    expect(h.penStates.at(-1)).toBeNull()
  })

  it('leaves the other tools sweeping as they were', () => {
    const h = harness()
    h.arm('Rectangle')
    h.drag([200, 300], [280, 340])
    expect(h.penPaths).toHaveLength(0)
    expect(h.creations).toHaveLength(1)
  })
})

describe('dragging a child its parent lays out', () => {
  it('reorders it instead of moving it', () => {
    const h = harness()
    h.select('flowed')
    h.setHit('flowed')
    h.drag([520, 20], [520, 120])
    expect(h.reorders).toEqual([{ id: 'flowed', index: 3 }])
    // The index is the whole edit. A position beside it would be geometry the
    // layout owns, which is the thing D4 refuses.
    expect(h.moveCommits).toHaveLength(0)
    expect(h.commits).toHaveLength(0)
  })

  it('shows the insertion caret while it goes, and clears it on release', () => {
    const h = harness()
    h.select('flowed')
    h.setHit('flowed')
    h.canvas.fire('pointerdown', { button: 0, clientX: 520, clientY: 20, pointerId: 1 })
    h.canvas.fire('pointermove', { clientX: 520, clientY: 85, pointerId: 1 })
    expect(h.carets.at(-1)).toMatchObject({ index: 2 })
    h.canvas.fire('pointerup', { button: 0, clientX: 520, clientY: 85, pointerId: 1 })
    expect(h.carets.at(-1)).toBeNull()
  })

  it('commits nothing for a press that never travelled', () => {
    const h = harness()
    h.select('flowed')
    h.setHit('flowed')
    h.drag([520, 20], [521, 20])
    expect(h.reorders).toHaveLength(0)
  })

  it('leaves a child that escaped the flow to the move gesture', () => {
    const h = harness({ flowed: { layoutPositioning: 'ABSOLUTE' } })
    h.select('flowed')
    h.setHit('flowed')
    h.drag([520, 20], [560, 60])
    expect(h.reorders).toHaveLength(0)
    expect(h.moveCommits).toHaveLength(1)
  })

  it('offers the drag in the cursor, where it used to offer nothing', () => {
    const h = harness()
    h.setHit('flowed')
    h.canvas.fire('pointermove', { clientX: 520, clientY: 20, pointerId: 1 })
    expect(h.canvas.style.cursor).toBe('move')
  })
})

describe('draw to create', () => {
  it('reports the swept rect when a tool is armed', () => {
    const h = harness()
    h.arm('Rectangle')
    h.drag([200, 300], [280, 340])
    expect(h.creations).toEqual([
      { element: 'Rectangle', at: { x: 200, y: 300 }, size: { width: 80, height: 40 } },
    ])
  })

  it('normalises a rect swept up and to the left', () => {
    const h = harness()
    h.arm('Frame')
    h.drag([280, 340], [200, 300])
    expect(h.creations[0]).toMatchObject({
      at: { x: 200, y: 300 },
      size: { width: 80, height: 40 },
    })
  })

  it('reports a click as a placement with no size of its own', () => {
    const h = harness()
    h.arm('Text')
    // Inside `box`, which would otherwise be selected — an armed tool draws
    // rather than picks, the way Figma does.
    h.canvas.fire('pointerdown', { button: 0, clientX: 150, clientY: 150, pointerId: 1 })
    h.canvas.fire('pointerup', { button: 0, clientX: 150, clientY: 150, pointerId: 1 })
    expect(h.creations).toEqual([{ element: 'Text', at: { x: 150, y: 150 }, size: null }])
    expect(h.editor.state.selectedIds.size).toBe(0)
  })

  it('shows the marquee while sweeping and clears it on release', () => {
    const h = harness()
    h.arm('Ellipse')
    h.canvas.fire('pointerdown', { button: 0, clientX: 200, clientY: 300, pointerId: 1 })
    h.canvas.fire('pointermove', { clientX: 260, clientY: 350, pointerId: 1 })
    expect(h.marquees.at(-1)).toEqual({ x: 200, y: 300, width: 60, height: 50 })
    h.canvas.fire('pointerup', { button: 0, clientX: 260, clientY: 350, pointerId: 1 })
    expect(h.marquees.at(-1)).toBeNull()
  })

  it('never moves or resizes an existing node while a tool is armed', () => {
    const h = harness()
    h.select('box')
    h.arm('Rectangle')
    // Straight across the south-east grip, which would resize with no tool.
    h.drag([300, 200], [350, 220])
    expect(h.commits).toHaveLength(0)
    expect(h.moveCommits).toHaveLength(0)
    expect(h.resizeCommits).toHaveLength(0)
    expect(h.creations).toHaveLength(1)
  })

  it('goes back to selecting when the tool is put away', () => {
    const h = harness()
    h.arm('Rectangle')
    h.arm(null)
    h.select('box')
    h.drag([150, 150], [190, 170])
    expect(h.creations).toHaveLength(0)
    expect(h.moveCommits).toHaveLength(1)
  })

  it('wears a crosshair so it is obvious the canvas will draw', () => {
    const h = harness()
    h.arm('Rectangle')
    h.canvas.fire('pointermove', { clientX: 150, clientY: 150, pointerId: 1 })
    expect(h.canvas.style.cursor).toBe('crosshair')
  })
})

describe('drag to reparent', () => {
  it('emits a reparent rather than a position write when the drop lands in another frame', () => {
    const h = harness()
    h.select('box')
    h.drag([150, 150], [550, 50])
    expect(h.reparents).toEqual([{ id: 'box', parentId: 'stack' }])
    // The drop is one structural change. A position write beside it would put
    // computed geometry in the diff next to the move that caused it.
    expect(h.moveCommits).toHaveLength(0)
    expect(h.commits).toHaveLength(0)
  })

  it('still writes the position when the drop lands where the node already lives', () => {
    const h = harness()
    h.select('box')
    h.drag([150, 150], [190, 170])
    expect(h.reparents).toHaveLength(0)
    expect(h.moveCommits).toHaveLength(1)
  })

  it('follows the pointer while it goes, so the drop is not a leap of faith', () => {
    const h = harness()
    h.select('box')
    h.canvas.fire('pointerdown', { button: 0, clientX: 150, clientY: 150, pointerId: 1 })
    h.canvas.fire('pointermove', { clientX: 550, clientY: 50, pointerId: 1 })
    expect(h.nodes.box).toMatchObject({ x: 500, y: 0 })
    expect(h.commits).toHaveLength(0)
  })

  it('highlights the container under the pointer, and lets go on release', () => {
    const h = harness()
    h.select('box')
    h.canvas.fire('pointerdown', { button: 0, clientX: 150, clientY: 150, pointerId: 1 })
    h.canvas.fire('pointermove', { clientX: 550, clientY: 50, pointerId: 1 })
    expect(h.dropTargets.at(-1)).toBe('stack')
    h.canvas.fire('pointerup', { button: 0, clientX: 550, clientY: 50, pointerId: 1 })
    expect(h.dropTargets.at(-1)).toBeNull()
  })

  it('drops the highlight again when the pointer leaves the container', () => {
    const h = harness()
    h.select('box')
    h.canvas.fire('pointerdown', { button: 0, clientX: 150, clientY: 150, pointerId: 1 })
    h.canvas.fire('pointermove', { clientX: 550, clientY: 50, pointerId: 1 })
    h.canvas.fire('pointermove', { clientX: 200, clientY: 200, pointerId: 1 })
    expect(h.dropTargets.at(-1)).toBeNull()
  })

  it('asks nothing of a resize, which cannot change a node’s parent', () => {
    const h = harness()
    h.select('box')
    // The south-east grip, dragged into `stack`.
    h.drag([300, 200], [550, 50])
    expect(h.reparents).toHaveLength(0)
    expect(h.resizeCommits).toEqual(['box'])
  })
})

describe('drag a handle to resize', () => {
  it('commits the new rect from the south-east grip', () => {
    const h = harness()
    h.select('box')
    h.drag([300, 200], [350, 220])
    expect(h.resizeCommits).toEqual(['box'])
    expect(h.nodes.box).toMatchObject({ x: 100, y: 100, width: 250, height: 120 })
  })

  it('flips a hugged axis to fixed, so the file can hold the resize', () => {
    const h = harness()
    h.select('stack')
    h.setHit('stack')
    h.drag([600, 100], [660, 140])
    const committed = h.commits.at(-1)!.changes
    expect(committed.primaryAxisSizing).toBe('FIXED')
    expect(committed.counterAxisSizing).toBe('FIXED')
  })
})

describe('rotate', () => {
  it('commits a rotation when the corner zone is dragged', () => {
    const h = harness()
    h.select('box')
    // Outside the south-east corner, in the rotate zone.
    h.drag([312, 212], [312, 260])
    expect(h.rotateCommits).toHaveLength(1)
    expect(typeof h.commits.at(-1)!.changes.rotation).toBe('number')
  })

  /** `box` spans (100,100)–(300,200): its top-centre grip is at (200, 100). */
  const KNOB: [number, number] = [200, 100 - ROTATE_HANDLE_STEM]

  it('offers a knob above the top-centre grip, and says so in the cursor (#16)', () => {
    const h = harness()
    h.select('box')
    h.canvas.fire('pointermove', { clientX: KNOB[0], clientY: KNOB[1], pointerId: 1 })
    expect(h.canvas.style.cursor).toContain('url(')
    // Past the knob there is nothing: the empty space above a box is not a
    // rotate target, which is what made the old gesture undiscoverable.
    h.setHit(null)
    h.canvas.fire('pointermove', {
      clientX: 200,
      clientY: 100 - 2 * ROTATE_HANDLE_STEM,
      pointerId: 1,
    })
    expect(h.canvas.style.cursor).toBe('default')
  })

  it('rotates from the knob, about the centre of the box', () => {
    const h = harness()
    h.select('box')
    h.drag(KNOB, [260, 100])
    expect(h.rotateCommits).toHaveLength(1)
    const rotation = h.commits.at(-1)!.changes.rotation as number
    // From straight up to up-and-right about (200, 150): a clockwise turn.
    expect(rotation).toBeGreaterThan(40)
    expect(rotation).toBeLessThan(60)
  })

  it('settles the angle to two decimals, as Figma keeps them', () => {
    const h = harness()
    h.select('box')
    h.drag(KNOB, [260, 100])
    const rotation = h.commits.at(-1)!.changes.rotation as number
    expect(rotation).toBe(Math.round(rotation * 100) / 100)
  })

  it('hands every frame, the settle and the pointer to the host when the host commits', () => {
    const h = harness({}, { hooks: true })
    h.select('box')
    h.drag(KNOB, [260, 100])
    expect(h.rotations.map((r) => r.mode)).toEqual(['preview', 'commit'])
    expect(h.rotations.at(-1)!.at).toEqual({ x: 260, y: 100 })
    // The settle is the last preview, rounded to what the file keeps.
    expect(h.rotations.at(-1)!.rotation).toBe(Math.round(h.rotations[0]!.rotation * 100) / 100)
    expect(h.commits).toHaveLength(0)
    expect(h.previews).toHaveLength(0)
    expect(h.rotateCommits).toHaveLength(1)
  })

  it('tells the host to put the angle back when the pointer is cancelled', () => {
    const h = harness({}, { hooks: true })
    h.select('box')
    h.canvas.fire('pointerdown', { button: 0, clientX: KNOB[0], clientY: KNOB[1], pointerId: 1 })
    h.canvas.fire('pointermove', { clientX: 260, clientY: 100, pointerId: 1 })
    h.canvas.fire('pointercancel', { pointerId: 1 })
    expect(h.rotations.map((r) => r.mode)).toEqual(['preview', 'cancel'])
    expect(h.rotations.at(-1)!.rotation).toBe(0)
  })
})

describe('arrow-key nudge', () => {
  it('moves the selection one pixel and commits', () => {
    const h = harness()
    h.select('box')
    h.keys.fire('keydown', { key: 'ArrowRight', code: 'ArrowRight' })
    expect(h.nodes.box).toMatchObject({ x: 101, y: 100 })
    expect(h.moveCommits).toHaveLength(1)
  })

  it('moves ten with shift', () => {
    const h = harness()
    h.select('box')
    h.keys.fire('keydown', { key: 'ArrowDown', code: 'ArrowDown', shiftKey: true })
    expect(h.nodes.box).toMatchObject({ x: 100, y: 110 })
  })

  it('hands the nudge to the host when the host commits, like a drag', () => {
    const h = harness({}, { hooks: true })
    h.select('box')
    h.keys.fire('keydown', { key: 'ArrowRight', code: 'ArrowRight' })
    expect(h.moves).toEqual([{ id: 'box', at: { x: 101, y: 100 } }])
    expect(h.commits).toHaveLength(0)
    expect(h.moveCommits).toHaveLength(1)
  })

  it('leaves the caret alone when the press came from a text field', () => {
    const h = harness()
    h.select('box')
    h.keys.fire('keydown', {
      key: 'ArrowRight',
      code: 'ArrowRight',
      target: { tagName: 'INPUT', isContentEditable: false },
    })
    expect(h.moveCommits).toHaveLength(0)
    expect(h.nodes.box).toMatchObject({ x: 100 })
  })

  it('nudges from a press that landed on the page itself', () => {
    const h = harness()
    h.select('box')
    h.keys.fire('keydown', {
      key: 'ArrowRight',
      code: 'ArrowRight',
      target: { tagName: 'BODY', isContentEditable: false },
    })
    expect(h.moveCommits).toHaveLength(1)
  })

  it('refuses to nudge a node its parent places', () => {
    const h = harness()
    h.select('flowed')
    h.keys.fire('keydown', { key: 'ArrowRight', code: 'ArrowRight' })
    expect(h.moveCommits).toHaveLength(0)
  })
})

describe('a node nested inside an offset parent', () => {
  it('finds its handles where the pointer actually sees them', () => {
    const h = harness()
    h.select('inner')
    h.setHit('inner')
    // `inner` is local (10, 20) inside `outer` at (400, 300), so its south-east
    // grip is at absolute (510, 370) — not at (110, 70).
    h.drag([510, 370], [560, 390])
    expect(h.resizeCommits).toEqual(['inner'])
  })

  it('writes the resize in the node’s own coordinates, not the pointer’s', () => {
    const h = harness()
    h.select('inner')
    h.setHit('inner')
    h.drag([510, 370], [560, 390])
    expect(h.commits.at(-1)!.changes).toMatchObject({ x: 10, y: 20, width: 150, height: 70 })
  })

  it('rotates about its own centre on screen', () => {
    const h = harness()
    h.select('inner')
    h.setHit('inner')
    // Just outside the absolute south-east corner (510, 370).
    h.drag([518, 378], [518, 420])
    expect(h.rotateCommits).toHaveLength(1)
  })

  it('moves by the drag delta, in local coordinates', () => {
    const h = harness()
    h.select('inner')
    h.setHit('inner')
    h.drag([450, 340], [480, 360])
    expect(h.moveCommits).toHaveLength(1)
    expect(h.nodes.inner).toMatchObject({ x: 40, y: 40 })
  })
})

describe('a gesture in flight', () => {
  it('reflows the parent as it goes, so nothing jumps when it settles', () => {
    const h = harness()
    h.select('stack')
    h.setHit('stack')
    // The north-west grip moves the stack's origin, so its child has to be
    // laid out during the drag, not only when the pointer is released.
    h.canvas.fire('pointerdown', { button: 0, clientX: 500, clientY: 0, pointerId: 1 })
    h.canvas.fire('pointermove', { clientX: 460, clientY: -20, pointerId: 1 })
    const duringDrag = { x: h.nodes.flowed!.x, y: h.nodes.flowed!.y }
    // Released without moving further: where the child sits must not change.
    h.canvas.fire('pointerup', { button: 0, clientX: 460, clientY: -20, pointerId: 1 })
    expect(duringDrag).toEqual({ x: h.nodes.flowed!.x, y: h.nodes.flowed!.y })
  })

  it('shows a moved node where its own layout puts it, mid-drag', () => {
    const h = harness()
    h.select('box')
    h.canvas.fire('pointerdown', { button: 0, clientX: 150, clientY: 150, pointerId: 1 })
    h.canvas.fire('pointermove', { clientX: 190, clientY: 170, pointerId: 1 })
    // The preview has to reach the node through the path that runs layout.
    expect(h.nodes.box).toMatchObject({ x: 140, y: 120 })
    expect(h.commits).toHaveLength(0)
  })
})

describe('the cursor says what a press would do', () => {
  const hoverAt = (h: ReturnType<typeof harness>, x: number, y: number) => {
    h.canvas.fire('pointermove', { clientX: x, clientY: y, pointerId: 1 })
    return h.canvas.style.cursor
  }

  it('shows a resize cursor over each grip, matching its diagonal', () => {
    const h = harness()
    h.select('box')
    expect(hoverAt(h, 100, 100)).toBe('nwse-resize')
    expect(hoverAt(h, 300, 100)).toBe('nesw-resize')
    expect(hoverAt(h, 200, 100)).toBe('ns-resize')
    expect(hoverAt(h, 100, 150)).toBe('ew-resize')
  })

  it('turns the resize arrows with the node', () => {
    const h = harness({ box: { rotation: 90 } })
    h.select('box')
    // The east grip of the quarter-turned box hangs at (50, 300), its axis
    // pointing down the screen — so the arrows point down the screen too.
    expect(hoverAt(h, 50, 300)).toBe('ns-resize')
  })

  it('shows a rotate cursor just outside a corner, which is the only way to find it', () => {
    const h = harness()
    h.select('box')
    expect(hoverAt(h, 308, 208)).toContain('url(')
  })

  it('shows a move cursor over a node that can be moved', () => {
    const h = harness()
    h.select('box')
    expect(hoverAt(h, 200, 150)).toBe('move')
  })

  /**
   * This assertion is inverted from what C10a shipped, deliberately. Then, a
   * node its parent placed could not be dragged at all and the cursor said so.
   * D7 gives that drag a meaning — a reorder — so the affordance is correct
   * again. The rule did not change: offer the hand exactly where a press would
   * do something.
   */
  it('offers the move cursor over a node its parent places, now that D7 reorders it', () => {
    const h = harness()
    h.select('flowed')
    h.setHit('flowed')
    expect(hoverAt(h, 520, 20)).toBe('move')
  })

  it('goes back to default over empty canvas', () => {
    const h = harness()
    h.select('box')
    h.setHit(null)
    expect(hoverAt(h, 900, 900)).toBe('default')
  })
})

describe('a rotated node', () => {
  /**
   * Origin-pivot, the renderer's own transform: the box (100,100,200x100)
   * turned a quarter clockwise hangs downward — its ne grip lands at
   * (100, 300), its e grip at (50, 300), and the unrotated ne corner
   * (300, 100) holds nothing.
   */
  it('offers its grips where rotation puts them, not where the rect claims', () => {
    const h = harness({ box: { rotation: 90 } })
    h.select('box')
    h.drag([100, 300], [100, 330])
    expect(h.resizeCommits).toEqual(['box'])
  })

  it('no longer finds a grip where the unrotated rect had one', () => {
    const h = harness({ box: { rotation: 90 } })
    h.select('box')
    h.drag([300, 100], [330, 120])
    expect(h.resizeCommits).toHaveLength(0)
  })

  it('grows along its own axis, so the drag follows the node', () => {
    const h = harness({ box: { rotation: 90 } })
    h.select('box')
    // The east grip of the hanging box sits at (50, 300); a screen-down drag
    // travels along the node's width.
    h.drag([50, 300], [50, 350])
    expect(h.nodes.box!.width).toBeCloseTo(250, 5)
    expect(h.nodes.box!.height).toBeCloseTo(100, 5)
  })
})

/**
 * The file is the source of truth, and it can change mid-drag. The remote
 * apply overwrites the dragged node with the file's values; re-applying the
 * gesture puts the author's hand back in charge of the node they are holding —
 * and only that node.
 */
describe('a remote document landing mid-gesture', () => {
  it('re-applies the drag preview over the file’s values', () => {
    const h = harness()
    h.select('box')
    h.canvas.fire('pointerdown', { button: 0, clientX: 150, clientY: 150, pointerId: 1 })
    h.canvas.fire('pointermove', { clientX: 190, clientY: 170, pointerId: 1 })
    expect(h.nodes.box).toMatchObject({ x: 140, y: 120 })

    // An external save put the node back where the file has it.
    Object.assign(h.nodes.box!, { x: 100, y: 100 })
    h.controller.reapplyPreview()
    expect(h.nodes.box).toMatchObject({ x: 140, y: 120 })

    // Release still commits where the author dragged to, not where the file was.
    h.canvas.fire('pointerup', { button: 0, clientX: 190, clientY: 170, pointerId: 1 })
    expect(h.commits.at(-1)).toMatchObject({ id: 'box', changes: { x: 140, y: 120 } })
  })

  it('does nothing between gestures', () => {
    const h = harness()
    h.controller.reapplyPreview()
    expect(h.previews).toEqual([])
  })

  it('does nothing once the gesture has settled', () => {
    const h = harness()
    h.select('box')
    h.drag([150, 150], [190, 170])
    const writes = h.previews.length
    h.controller.reapplyPreview()
    expect(h.previews).toHaveLength(writes)
  })
})

describe("editing a path's vertices (D12)", () => {
  /** The descent gesture, which for a `<Vector>` reaches its points. */
  const enter = (h: ReturnType<typeof harness>): void => {
    h.setHit('vector')
    h.canvas.fire('dblclick', { clientX: 730, clientY: 130 })
  }

  const press = (h: ReturnType<typeof harness>, x: number, y: number): void => {
    h.canvas.fire('pointerdown', { button: 0, clientX: x, clientY: y, pointerId: 1 })
  }
  const release = (h: ReturnType<typeof harness>, x: number, y: number): void => {
    h.canvas.fire('pointerup', { button: 0, clientX: x, clientY: y, pointerId: 1 })
  }
  const dragPoint = (
    h: ReturnType<typeof harness>,
    from: [number, number],
    to: [number, number],
    mods: Record<string, unknown> = {},
  ): void => {
    press(h, from[0], from[1])
    h.canvas.fire('pointermove', { clientX: to[0], clientY: to[1], pointerId: 1, ...mods })
    release(h, to[0], to[1])
  }

  it('double-click on a vector opens its points, and selects the node', () => {
    const h = harness()
    enter(h)
    expect(h.vertexEdits).toEqual(['vector'])
    expect(h.vertexStates.at(-1)!.vertices).toHaveLength(3)
    expect([...h.editor.state.selectedIds]).toEqual(['vector'])
  })

  it('leaves a node without a path to the container descent', () => {
    const h = harness()
    h.setHit('box')
    h.canvas.fire('dblclick', { clientX: 150, clientY: 150 })
    expect(h.vertexEdits).toHaveLength(0)
    expect(h.vertexStates).toHaveLength(0)
  })

  it('calls out the point a press picks, and writes nothing for picking it', () => {
    const h = harness()
    enter(h)
    press(h, 700, 100)
    release(h, 700, 100)
    expect(h.vertexStates.at(-1)!.selectedVertexIndices).toEqual(new Set([0]))
    // A click on a point is a selection. Committing here would put a patch, a
    // revision and a diff line in the file for having looked at a vertex.
    expect(h.vertexPaths).toHaveLength(0)
  })

  it('drags a point, and commits the whole path once when it settles', () => {
    const h = harness()
    enter(h)
    dragPoint(h, [700, 100], [680, 90])
    expect(h.vertexPaths).toHaveLength(1)
    expect(h.vertexPaths[0]!.id).toBe('vector')
    expect(h.vertexPaths[0]!.subpaths[0]!.vertices[0]).toMatchObject({ x: 680, y: 90 })
    // The other two are where they were: one drag moves one point.
    expect(h.vertexPaths[0]!.subpaths[0]!.vertices[1]).toMatchObject({ x: 760, y: 100 })
  })

  it('shows the drag as it goes, without touching the scene graph', () => {
    const h = harness()
    enter(h)
    press(h, 700, 100)
    h.canvas.fire('pointermove', { clientX: 690, clientY: 95, pointerId: 1 })
    expect(h.vertexStates.at(-1)!.vertices[0]).toMatchObject({ x: 690, y: 95 })
    // The overlay is the preview: the SDK re-renders the shape from it, so
    // there is nothing to preview into the graph and nothing to undo.
    expect(h.previews).toHaveLength(0)
    expect(h.commits).toHaveLength(0)
    release(h, 690, 95)
  })

  /** The curved vector, whose middle point is smooth and has handles. */
  const enterCurve = (h: ReturnType<typeof harness>): void => {
    h.setHit('curve')
    h.canvas.fire('dblclick', { clientX: 740, clientY: 300 })
  }

  it('drags a handle, and mirrors the far one on a smooth point', () => {
    const h = harness()
    enterCurve(h)
    // Pick the middle point, so its handles are the ones the overlay draws.
    press(h, 740, 300)
    release(h, 740, 300)
    // Its `out` grip is drawn at (760,300) — the vertex plus its tangent.
    dragPoint(h, [760, 300], [760, 320])
    const edited = h.vertexPaths.at(-1)!.subpaths[0]!.vertices[1]!
    expect(edited.out).toEqual({ x: 20, y: 20 })
    expect(edited.in).toEqual({ x: -20, y: -20 })
  })

  it('breaks the mirror when the drag holds Alt', () => {
    const h = harness()
    enterCurve(h)
    press(h, 740, 300)
    release(h, 740, 300)
    dragPoint(h, [760, 300], [760, 320], { altKey: true })
    const edited = h.vertexPaths.at(-1)!.subpaths[0]!.vertices[1]!
    expect(edited.out).toEqual({ x: 20, y: 20 })
    expect(edited.in).toEqual({ x: -20, y: 0 })
  })

  it('will not grab a handle the overlay is not drawing', () => {
    const h = harness()
    enterCurve(h)
    // Nothing is picked, so no handles are drawn — a press where the middle
    // point's grip *would* be must find nothing rather than drag an invisible
    // one. (710,300) is clear of every vertex at this zoom.
    dragPoint(h, [760, 300], [760, 320])
    expect(h.vertexPaths).toHaveLength(0)
  })

  it('removes the selected point on Delete, and commits once', () => {
    const h = harness()
    enter(h)
    press(h, 760, 160)
    release(h, 760, 160)
    h.keys.fire('keydown', { key: 'Delete', code: 'Delete' })
    expect(h.vertexPaths).toHaveLength(1)
    // Three points less one is two, which is still a path; the chain only goes
    // when taking a point would leave it with one.
    expect(h.vertexPaths[0]!.subpaths[0]!.vertices.map((v) => v.x)).toEqual([700, 760])
    expect(h.vertexStates.at(-1)!.selectedVertexIndices).toEqual(new Set())
  })

  it('does nothing on Delete with no point picked', () => {
    const h = harness()
    enter(h)
    h.keys.fire('keydown', { key: 'Delete', code: 'Delete' })
    expect(h.vertexPaths).toHaveLength(0)
  })

  it('leaves on Escape, and clears the overlay', () => {
    const h = harness()
    enter(h)
    h.keys.fire('keydown', { key: 'Escape', code: 'Escape' })
    expect(h.vertexEdits).toEqual(['vector', null])
    expect(h.vertexStates.at(-1)).toBeNull()
  })

  it('does not step out of a container on the Escape that leaves', () => {
    const h = harness()
    h.editor.state.enteredContainerId = 'page'
    enter(h)
    h.keys.fire('keydown', { key: 'Escape', code: 'Escape' })
    // One Escape does one thing: it closed the points and left the descent
    // where it was, the same way the pen's Escape does.
    expect(h.editor.state.enteredContainerId).toBe('page')
  })

  it('stays open when a press misses a point but lands on the shape', () => {
    const h = harness()
    enter(h)
    press(h, 730, 130)
    release(h, 730, 130)
    expect(h.vertexEdits).toEqual(['vector'])
    expect(h.vertexStates.at(-1)!.selectedVertexIndices).toEqual(new Set())
  })

  it('leaves when a press lands outside the node', () => {
    const h = harness()
    enter(h)
    press(h, 150, 150)
    release(h, 150, 150)
    expect(h.vertexEdits).toEqual(['vector', null])
  })

  it('refuses to arrow the node around while its points are open', () => {
    const h = harness()
    enter(h)
    h.keys.fire('keydown', { key: 'ArrowRight', code: 'ArrowRight' })
    expect(h.moveCommits).toHaveLength(0)
    expect(h.nodes.vector).toMatchObject({ x: 700 })
  })

  it('is closed by the host putting it away', () => {
    const h = harness()
    enter(h)
    h.controller.cancelVertexEdit()
    expect(h.vertexEdits).toEqual(['vector', null])
    expect(h.vertexStates.at(-1)).toBeNull()
  })

  it('never resizes or moves the node it is editing', () => {
    const h = harness()
    h.select('vector')
    enter(h)
    // Straight across the node's own resize grips, which outside the mode
    // would take the press and resize it.
    dragPoint(h, [700, 100], [640, 60])
    expect(h.resizeCommits).toHaveLength(0)
    expect(h.moveCommits).toHaveLength(0)
    expect(h.vertexPaths).toHaveLength(1)
  })
})

describe('a release inside vertex editing belongs to the mode', () => {
  it('does not re-select a node when a press misses a point', () => {
    const h = harness()
    h.setHit('vector')
    h.canvas.fire('dblclick', { clientX: 730, clientY: 130 })
    // The hit-test would answer `box` for this release; falling through to the
    // ordinary click path would take the selection off the node being edited.
    h.setHit('box')
    h.canvas.fire('pointerdown', { button: 0, clientX: 730, clientY: 130, pointerId: 1 })
    h.canvas.fire('pointerup', { button: 0, clientX: 730, clientY: 130, pointerId: 1 })
    expect([...h.editor.state.selectedIds]).toEqual(['vector'])
    expect(h.vertexEdits).toEqual(['vector'])
  })
})

describe('graphics authoring', () => {
  it('requires a real drag to create a line or arrow, including at different zoom levels', () => {
    for (const tool of ['Line', 'Arrow']) {
      const h = harness()
      h.arm(tool)
      h.drag([200, 200], [200, 200])
      h.drag([200, 200], [201, 201])
      expect(h.penPaths).toHaveLength(0)
      expect(h.penStates.at(-1)).toBeNull()
      h.editor.state.zoom = 0.1
      h.drag([200, 200], [220, 200])
      expect(h.penPaths).toHaveLength(0)
      h.editor.state.zoom = 1
      h.drag([200, 200], [300, 200])
      expect(h.penPaths).toHaveLength(1)
      expect(h.penPaths[0]!.vertices).toHaveLength(2)
      h.controller.destroy()
    }
  })

  it('commits freehand ink only on release and simplifies collinear samples', () => {
    const h = harness()
    h.arm('Pencil')
    h.canvas.fire('pointerdown', { button: 0, clientX: 10, clientY: 20 })
    for (let x = 12; x <= 100; x += 2) h.canvas.fire('pointermove', { clientX: x, clientY: 20 })
    expect(h.penPaths).toHaveLength(0)
    expect(h.penStates.at(-1)?.vertices.length).toBeGreaterThan(2)
    h.canvas.fire('pointerup', { clientX: 110, clientY: 20 })
    expect(h.penPaths).toHaveLength(1)
    expect(h.penPaths[0]).toMatchObject({
      closed: false,
      vertices: [
        { x: 10, y: 20 },
        { x: 110, y: 20 },
      ],
    })
    expect(h.penStates.at(-1)).toBeNull()
    h.controller.destroy()
  })

  it('cancels freehand ink with Escape, pointer cancellation, and tool changes', () => {
    for (const cancel of ['key', 'pointer', 'tool']) {
      const h = harness()
      h.arm('Pencil')
      h.canvas.fire('pointerdown', { button: 0, clientX: 10, clientY: 20 })
      h.canvas.fire('pointermove', { clientX: 100, clientY: 120 })
      if (cancel === 'key') h.keys.fire('keydown', { code: 'Escape' })
      else if (cancel === 'pointer') h.canvas.fire('pointercancel', { clientX: 100, clientY: 120 })
      else h.controller.cancelPen()
      h.canvas.fire('pointerup', { clientX: 100, clientY: 120 })
      expect(h.penPaths).toHaveLength(0)
      expect(h.penStates.at(-1)).toBeNull()
      h.controller.destroy()
    }
  })

  it('draws horizontal lines and shape presets as editable vectors', () => {
    const h = harness()
    h.arm('Line')
    h.drag([200, 200], [350, 200])
    expect(h.penPaths[0]).toMatchObject({
      closed: false,
      vertices: [
        { x: 200, y: 200 },
        { x: 350, y: 200 },
      ],
    })
    h.arm('Star')
    h.drag([200, 200], [300, 300])
    expect(h.penPaths[1]?.vertices).toHaveLength(10)
    expect(h.penPaths[1]?.closed).toBe(true)
    expect(h.creations).toHaveLength(0)
    h.controller.destroy()
  })

  it('opens vector points with Enter and closes them with Enter', () => {
    const h = harness()
    h.select('vector')
    h.keys.fire('keydown', { code: 'Enter' })
    expect(h.vertexEdits).toEqual(['vector'])
    h.keys.fire('keydown', { code: 'Enter' })
    expect(h.vertexEdits).toEqual(['vector', null])
    h.controller.destroy()
  })

  it('exposes point editing to the inspector and adds points by double-clicking a segment', () => {
    const h = harness()
    expect(h.controller.editVector('vector')).toBe(true)
    h.canvas.fire('dblclick', { clientX: 730, clientY: 100 })
    expect(h.vertexPaths.at(-1)?.subpaths[0]?.vertices).toHaveLength(4)
    expect(h.vertexPaths.at(-1)?.subpaths[0]?.vertices[1]?.x).toBeCloseTo(730, 2)
    h.controller.vectorAction('smooth')
    expect(h.vertexPaths.at(-1)?.subpaths[0]?.vertices[1]?.out.x).toBeGreaterThan(0)
    h.controller.vectorAction('corner')
    expect(h.vertexPaths.at(-1)?.subpaths[0]?.vertices[1]?.out).toEqual({ x: 0, y: 0 })
    h.controller.vectorAction('toggle-closed')
    expect(h.vertexPaths.at(-1)?.subpaths[0]?.closed).toBe(false)
    h.controller.vectorAction('delete')
    expect(h.vertexPaths.at(-1)?.subpaths[0]?.vertices).toHaveLength(3)
    h.controller.destroy()
  })

  it('does not delete a point or leave vector mode while typing in the inspector', () => {
    const h = harness()
    h.controller.editVector('vector')
    h.canvas.fire('pointerdown', { button: 0, clientX: 700, clientY: 100 })
    h.canvas.fire('pointerup', { clientX: 700, clientY: 100 })
    for (const code of ['Backspace', 'Delete', 'Enter', 'Escape'])
      h.keys.fire('keydown', { code, target: { tagName: 'INPUT' } })
    expect(h.vertexPaths).toHaveLength(0)
    expect(h.vertexEdits).toEqual(['vector'])
    h.controller.destroy()
  })
})
