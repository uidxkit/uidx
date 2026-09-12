import { describe, expect, it } from 'vitest'
import { parseOrThrow } from '@uidx/format'
import { fromSceneChange, toSceneGraph } from '@uidx/schema'
import {
  createCanvasController,
  type CanvasLike,
  type EditableNode,
  type ViewportEditor,
} from '../src/useCanvasControls'

/**
 * A settled canvas gesture on a pinned child, end to end.
 *
 * Another session diagnosed this exactly: `settle` commits raw scene geometry
 * (`updateNode(id, { x, y })`), the filter dropped any geometry prop the pin
 * owns, and so a drag previewed and then evaporated — measured live as a
 * MAX-pinned child whose Y moved and whose X snapped back. Its sketch proposed
 * a new controller seam (`onGeometry`) so the host could convert.
 *
 * The seam turned out to be unnecessary, which is why these tests look
 * different from that sketch. The controller's raw commit is *already* the
 * right report — the settled box — and `fromSceneChange` is a place every
 * scene write passes anyway, so the conversion lives there (`pinWrites`, ADR
 * 0011). No vouch distinguishes gesture from reflow: the resolve pass puts a
 * node exactly where its offsets say, so converting a reflow round-trips to
 * the stored numbers and emits nothing.
 *
 * So the two halves under test here: the controller commits the box the
 * gesture settled on, and the filter turns exactly that commit into offsets.
 */

class FakeTarget implements CanvasLike {
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

/** The card from `pins-demo/pinned-card.uidx`, at the sizes the file states. */
const PARENT = { width: 320, height: 200 }

function harness() {
  const nodes: Record<string, EditableNode> = {
    page: { id: 'page', x: 0, y: 0, width: 1000, height: 1000, layoutMode: 'NONE' },
    // The card. Absolute-positioning its children, so their coordinates are
    // theirs to write and `canMove` says yes.
    body: {
      id: 'body',
      parentId: 'page',
      x: 0,
      y: 0,
      ...PARENT,
      layoutMode: 'NONE',
    },
    // `{ horizontal: 'MAX', vertical: 'MIN' }` — right = 320 − 183 − 100 = 37.
    close: {
      id: 'close',
      parentId: 'body',
      x: 183,
      y: 16,
      width: 100,
      height: 100,
      type: 'FRAME',
      rotation: 0,
    },
    // `{ horizontal: 'STRETCH' }` — x = 16, right = 320 − 16 − 288 = 16.
    rule: {
      id: 'rule',
      parentId: 'body',
      x: 16,
      y: 52,
      width: 288,
      height: 1,
      type: 'FRAME',
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

  let previewing = false
  const commits: Array<{ id: string; changes: Record<string, unknown> }> = []
  let hit: { id: string } | null = null

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
    setDropTarget() {},
    setMarquee() {},
    setLayoutInsertIndicator() {},
    setPenState() {},
    setVertexEditState() {},
    hitTestAtPoint: () => hit,
    requestRender() {},
    absolutePositionOf: absoluteOf,
    graph: {
      getNode: (id: string) => nodes[id],
      updateNodePreview(id, changes) {
        Object.assign(nodes[id]!, changes)
      },
      runPreviewUpdates(fn) {
        previewing = true
        try {
          fn()
        } finally {
          previewing = false
        }
      },
    },
    updateNode(id, changes) {
      if (!previewing) commits.push({ id, changes: changes as Record<string, unknown> })
      Object.assign(nodes[id]!, changes)
    },
    commitMove() {},
    commitResize() {},
    commitRotation() {},
  }

  const canvas = new FakeTarget()
  const controller = createCanvasController(canvas, editor, {} as never)

  const drag = (from: [number, number], to: [number, number]) => {
    canvas.fire('pointerdown', { button: 0, clientX: from[0], clientY: from[1], pointerId: 1 })
    canvas.fire('pointermove', { clientX: to[0], clientY: to[1], pointerId: 1 })
    canvas.fire('pointerup', { button: 0, clientX: to[0], clientY: to[1], pointerId: 1 })
  }

  return {
    nodes,
    commits,
    controller,
    drag,
    select: (id: string) => {
      editor.state.selectedIds = new Set([id])
      hit = { id }
    },
  }
}

describe('a settled drag on a MAX-pinned child', () => {
  it('reaches the file as right and y, never as x', () => {
    const h = harness()
    h.select('close')
    // From inside the box, 20 right and 10 down: 183,16 → 203,26.
    h.drag([233, 66], [253, 76])
    expect(h.commits).toHaveLength(1)

    // The exact commit, through the real filter against a real build.
    const doc = parseOrThrow(PINNED_CARD)
    const scene = toSceneGraph(doc)
    const ctx = { doc, graph: scene.graph, addresses: scene.addresses, pins: scene.pins }
    scene.graph.updateNode('Card#body/close', h.commits[0]!.changes)
    const patches = fromSceneChange('Card#body/close', h.commits[0]!.changes, ctx)
    // 320 − 203 − 100 = 17, and the MIN axis keeps stating y.
    expect(patches).toContainEqual({
      op: 'set',
      address: 'Card#body/close',
      prop: 'right',
      value: 17,
    })
    expect(patches).toContainEqual({ op: 'add', address: 'Card#body/close', prop: 'y', value: 26 })
    expect(patches.some((p) => 'prop' in p && p.prop === 'x')).toBe(false)
  })
})

describe('a settled resize on a STRETCH-pinned child', () => {
  it('reaches the file as both offsets, never as width', () => {
    const h = harness()
    h.select('rule')
    // The east grip, pulled 88 left: width 288 → 200.
    h.drag([304, 52], [216, 52])
    expect(h.commits).toHaveLength(1)
    expect(h.commits[0]!.changes).toMatchObject({ width: 200 })

    const doc = parseOrThrow(PINNED_CARD)
    const scene = toSceneGraph(doc)
    const ctx = { doc, graph: scene.graph, addresses: scene.addresses, pins: scene.pins }
    scene.graph.updateNode('Card#body/rule', { x: 16, width: 200 })
    const patches = fromSceneChange('Card#body/rule', { x: 16, width: 200 }, ctx)
    // right = 320 − 16 − 200 = 104; the width itself never lands.
    expect(patches).toContainEqual({
      op: 'set',
      address: 'Card#body/rule',
      prop: 'right',
      value: 104,
    })
    expect(patches.some((p) => 'prop' in p && p.prop === 'width')).toBe(false)
  })
})

/** The card the harness mirrors, as a file the schema can actually build. */
const PINNED_CARD = [
  '---',
  'id: pinned-card',
  '---',
  '',
  '## Visual Contract',
  '',
  '<Page>',
  '  <Component name="Card">',
  '    <Frame name="body" width={320} height={200}>',
  '      <Frame name="close" width={100} height={100} right={37} constraints={{ horizontal: \'MAX\' }} />',
  '      <Frame name="rule" x={16} right={16} y={52} height={1} constraints={{ horizontal: \'STRETCH\' }} />',
  '    </Frame>',
  '  </Component>',
  '</Page>',
  '',
].join('\n')

/**
 * The harness's own guard. If these two stop passing, the tests above are
 * failing because nothing was dragged rather than because nothing was
 * reported — and a red that means "the fixture broke" is worse than no test.
 *
 * They also state the defect exactly: the gesture *does* settle, and what it
 * commits is a raw coordinate the file cannot hold on a pinned axis.
 */
describe('the gesture itself', () => {
  it('settles, and commits raw scene geometry today', () => {
    const h = harness()
    h.select('close')
    h.drag([233, 66], [253, 76])

    expect(h.commits).toHaveLength(1)
    expect(h.commits[0]).toMatchObject({ id: 'close', changes: { x: 203, y: 26 } })
  })

  it('settles a resize, and commits a raw width today', () => {
    const h = harness()
    h.select('rule')
    h.drag([304, 52], [216, 52])

    expect(h.commits).toHaveLength(1)
    expect(h.commits[0]!.changes).toMatchObject({ width: 200 })
  })
})
