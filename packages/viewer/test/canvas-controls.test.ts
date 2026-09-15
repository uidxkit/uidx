import { describe, expect, it } from 'vitest'
import {
  CLICK_SLOP,
  createCanvasController,
  MAX_ZOOM,
  MIN_ZOOM,
  type CanvasLike,
  type KeyTarget,
  type ViewportEditor,
} from '../src/useCanvasControls'

/** Records listeners so tests can fire events and assert cleanup. */
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
  getBoundingClientRect() {
    return { left: 100, top: 50 }
  }
  fire(type: string, event: Record<string, unknown> = {}): void {
    for (const handler of this.handlers.get(type) ?? []) {
      handler({ preventDefault() {}, ...event } as never)
    }
  }
  get count(): number {
    return [...this.handlers.values()].reduce((n, list) => n + list.length, 0)
  }
}

const click = (
  h: ReturnType<typeof harness>,
  from: [number, number],
  to: [number, number],
  modifiers: { metaKey?: boolean; ctrlKey?: boolean } = {},
) => {
  h.canvas.fire('pointerdown', { button: 0, clientX: from[0], clientY: from[1], pointerId: 1 })
  h.canvas.fire('pointerup', {
    button: 0,
    clientX: to[0],
    clientY: to[1],
    pointerId: 1,
    ...modifiers,
  })
}

function harness(options: { zoom?: number; isAddressable?: (id: string) => boolean } = {}) {
  const zoom = options.zoom ?? 1
  const zoomCalls: { level: number; x: number; y: number }[] = []
  let fits = 0
  let renders = 0
  let repaints = 0

  let selections = 0
  let hundreds = 0
  const selectCalls: { x: number; y: number }[] = []
  const hovered: (string | null)[] = []
  let cleared = 0
  const emitted: string[][] = []

  /**
   * A tiny tree, so the container gestures have somewhere to descend:
   *
   *   Card  ->  Card#inner  ->  Card#inner/leaf
   *
   * A shallow hit returns the child of whatever container has been entered,
   * which is exactly how the SDK scopes `hitTestAtPoint`.
   */
  const CHAIN = ['Card', 'Card#inner', 'Card#inner/leaf']
  /** Set to null to model a click on empty canvas. */
  let hit: { id: string } | null = { id: CHAIN[0]! }

  const editor: ViewportEditor = {
    state: { panX: 0, panY: 0, zoom, selectedIds: new Set<string>(), enteredContainerId: null },
    setZoomAroundPoint(level: number, x: number, y: number) {
      zoomCalls.push({ level, x, y })
      this.state.zoom = level
    },
    zoomToFit() {
      fits++
    },
    zoomToSelection() {
      selections++
    },
    zoomTo100() {
      hundreds++
    },
    // Identity transform keeps the arithmetic under test about pointer handling
    // rather than about coordinate conversion.
    screenToCanvas: (sx: number, sy: number) => ({ x: sx, y: sy }),
    selectAtPoint(cx: number, cy: number) {
      selectCalls.push({ x: cx, y: cy })
      this.state.selectedIds = new Set(hit ? [hit.id] : [])
    },
    select(ids: string[]) {
      selectCalls.push({ x: 0, y: 0 })
      this.state.selectedIds = new Set(ids)
    },
    enterContainer(id: string) {
      this.state.enteredContainerId = id
    },
    exitContainer() {
      const at = CHAIN.indexOf(this.state.enteredContainerId ?? '')
      this.state.enteredContainerId = at > 0 ? CHAIN[at - 1]! : null
    },
    clearSelection() {
      cleared++
      this.state.selectedIds = new Set()
    },
    setHoveredNode: (id: string | null) => hovered.push(id),
    hitTestAtPoint(_cx: number, _cy: number, deep?: boolean) {
      if (!hit) return null
      if (deep) return { id: CHAIN.at(-1)! }
      const entered = this.state.enteredContainerId
      if (entered === null) return { id: CHAIN[0]! }
      const at = CHAIN.indexOf(entered)
      // Entering the last container finds itself again — nothing deeper.
      return { id: CHAIN[Math.min(at + 1, CHAIN.length - 1)]! }
    },
    requestRender() {
      renders++
    },
    requestRepaint() {
      repaints++
    },
  }

  const canvas = new FakeTarget()
  const keys = new FakeTarget()
  const controller = createCanvasController(canvas, editor, {
    keyTarget: keys,
    onSelectionChange: (ids) => emitted.push(ids),
    isAddressable: options.isAddressable,
  })
  return {
    editor,
    canvas,
    keys,
    controller,
    zoomCalls,
    selectCalls,
    hovered,
    emitted,
    cleared: () => cleared,
    setHit: (next: { id: string } | null) => (hit = next),
    chain: CHAIN,
    fits: () => fits,
    selections: () => selections,
    hundreds: () => hundreds,
    renders: () => renders,
    repaints: () => repaints,
  }
}

describe('viewport panning', () => {
  it('pans on a plain wheel, without zooming', () => {
    const h = harness()
    h.canvas.fire('wheel', { deltaX: 30, deltaY: 50 })
    expect(h.editor.state).toMatchObject({ panX: -30, panY: -50, zoom: 1 })
    expect(h.zoomCalls).toHaveLength(0)
  })

  /**
   * A viewport change is a repaint, never a render. `requestRender` bumps the
   * editor's scene version and so discards the renderer's cached scene
   * picture; on an 11k-node page every wheel tick then re-recorded the whole
   * page (~300ms) instead of replaying it (~10ms). The same holds for the
   * hover pass on a plain pointer move: the scene did not change, only what
   * is drawn over it.
   */
  it('asks for a repaint, not a render, on pan, zoom and hover', () => {
    const h = harness()
    h.canvas.fire('wheel', { deltaX: 30, deltaY: 50 })
    h.canvas.fire('wheel', { deltaY: -100, ctrlKey: true, clientX: 300, clientY: 250 })
    h.canvas.fire('pointerdown', { button: 1, clientX: 10, clientY: 10, pointerId: 1 })
    h.canvas.fire('pointermove', { clientX: 35, clientY: 30, pointerId: 1 })
    h.canvas.fire('pointerup', { button: 1, clientX: 35, clientY: 30, pointerId: 1 })
    h.canvas.fire('pointermove', { clientX: 40, clientY: 40, pointerId: 1 })
    expect(h.repaints()).toBe(4)
    expect(h.renders()).toBe(0)
  })

  it('falls back to a render for an editor without `requestRepaint`', () => {
    const h = harness()
    delete (h.editor as { requestRepaint?: () => void }).requestRepaint
    h.canvas.fire('wheel', { deltaX: 30, deltaY: 50 })
    expect(h.renders()).toBe(1)
  })

  it('ignores a drag that starts with the left button', () => {
    const h = harness()
    h.canvas.fire('pointerdown', { button: 0, clientX: 0, clientY: 0, pointerId: 1 })
    h.canvas.fire('pointermove', { clientX: 40, clientY: 40, pointerId: 1 })
    expect(h.editor.state).toMatchObject({ panX: 0, panY: 0 })
  })

  it('pans on a middle-button drag', () => {
    const h = harness()
    h.canvas.fire('pointerdown', { button: 1, clientX: 10, clientY: 10, pointerId: 1 })
    h.canvas.fire('pointermove', { clientX: 35, clientY: 30, pointerId: 1 })
    expect(h.editor.state).toMatchObject({ panX: 25, panY: 20 })
  })

  it('pans on a left drag while space is held', () => {
    const h = harness()
    h.keys.fire('keydown', { code: 'Space' })
    h.canvas.fire('pointerdown', { button: 0, clientX: 0, clientY: 0, pointerId: 1 })
    h.canvas.fire('pointermove', { clientX: 15, clientY: 5, pointerId: 1 })
    expect(h.editor.state).toMatchObject({ panX: 15, panY: 5 })
  })

  it('stops panning when space is released', () => {
    const h = harness()
    h.keys.fire('keydown', { code: 'Space' })
    h.keys.fire('keyup', { code: 'Space' })
    h.canvas.fire('pointerdown', { button: 0, clientX: 0, clientY: 0, pointerId: 1 })
    h.canvas.fire('pointermove', { clientX: 15, clientY: 5, pointerId: 1 })
    expect(h.editor.state).toMatchObject({ panX: 0, panY: 0 })
  })

  it('stops tracking after pointerup', () => {
    const h = harness()
    h.canvas.fire('pointerdown', { button: 1, clientX: 0, clientY: 0, pointerId: 1 })
    h.canvas.fire('pointermove', { clientX: 10, clientY: 0, pointerId: 1 })
    h.canvas.fire('pointerup', { pointerId: 1 })
    h.canvas.fire('pointermove', { clientX: 999, clientY: 999, pointerId: 1 })
    expect(h.editor.state.panX).toBe(10)
  })
})

describe('viewport zooming', () => {
  it('zooms around the cursor with ctrl held', () => {
    const h = harness()
    h.canvas.fire('wheel', { deltaY: -100, ctrlKey: true, clientX: 300, clientY: 250 })
    expect(h.zoomCalls).toHaveLength(1)
    // Cursor position is translated into canvas-local coordinates.
    expect(h.zoomCalls[0]).toMatchObject({ x: 200, y: 200 })
    expect(h.zoomCalls[0]!.level).toBeGreaterThan(1)
  })

  it('treats cmd like ctrl', () => {
    const h = harness()
    h.canvas.fire('wheel', { deltaY: -100, metaKey: true, clientX: 100, clientY: 50 })
    expect(h.zoomCalls).toHaveLength(1)
  })

  it('zooms out on a positive delta', () => {
    const h = harness()
    h.canvas.fire('wheel', { deltaY: 100, ctrlKey: true, clientX: 100, clientY: 50 })
    expect(h.zoomCalls[0]!.level).toBeLessThan(1)
  })

  it('clamps rather than letting zoom run away', () => {
    const tiny = harness({ zoom: MIN_ZOOM })
    tiny.canvas.fire('wheel', { deltaY: 100_000, ctrlKey: true, clientX: 0, clientY: 0 })
    expect(tiny.zoomCalls[0]!.level).toBe(MIN_ZOOM)

    const huge = harness({ zoom: MAX_ZOOM })
    huge.canvas.fire('wheel', { deltaY: -100_000, ctrlKey: true, clientX: 0, clientY: 0 })
    expect(huge.zoomCalls[0]!.level).toBe(MAX_ZOOM)
  })

  it("uses Figma's zoom shortcuts (ADR 0002)", () => {
    const h = harness()
    h.keys.fire('keydown', { code: 'Digit1', shiftKey: true })
    h.keys.fire('keydown', { code: 'Digit2', shiftKey: true })
    h.keys.fire('keydown', { code: 'Digit0', shiftKey: true })
    expect({ fit: h.fits(), selection: h.selections(), hundred: h.hundreds() }).toEqual({
      fit: 1,
      selection: 1,
      hundred: 1,
    })
  })

  it('leaves double-click alone', () => {
    // In Figma double-click selects; binding a viewport reset to it throws away
    // the author's position on a mis-click.
    const h = harness()
    h.canvas.fire('dblclick')
    expect(h.fits()).toBe(0)
  })

  it("does not hijack the browser's own cmd+0", () => {
    const h = harness()
    h.keys.fire('keydown', { code: 'Digit0', metaKey: true })
    h.keys.fire('keydown', { code: 'Digit1', ctrlKey: true })
    expect(h.fits() + h.hundreds()).toBe(0)
  })

  it('ignores an unshifted digit', () => {
    const h = harness()
    h.keys.fire('keydown', { code: 'Digit1' })
    expect(h.fits()).toBe(0)
  })
})

describe('viewport lifecycle', () => {
  it('requests a redraw for every change', () => {
    const h = harness()
    h.canvas.fire('wheel', { deltaX: 10, deltaY: 0 })
    h.keys.fire('keydown', { code: 'Digit1', shiftKey: true })
    expect(h.repaints()).toBe(2)
  })

  it('touches only session state, never the document', () => {
    // The whole reason this exists instead of useCanvasInput: until write-back
    // lands, the canvas must not be able to change the scene. Pan, zoom, hover
    // and selection are all view state — none of them is in the .uidx file.
    const h = harness()
    h.canvas.fire('wheel', { deltaX: 10, deltaY: 10 })
    h.canvas.fire('pointerdown', { button: 1, clientX: 0, clientY: 0, pointerId: 1 })
    h.canvas.fire('pointermove', { clientX: 50, clientY: 50, pointerId: 1 })
    h.canvas.fire('pointerup', { clientX: 50, clientY: 50, pointerId: 1 })
    expect(Object.keys(h.editor.state).sort()).toEqual([
      'enteredContainerId',
      'panX',
      'panY',
      'selectedIds',
      'zoom',
    ])
  })

  it('has no document-mutating capability to reach for', () => {
    // Structural guarantee rather than a behavioural one: the controller is
    // handed an editor surface with no way to create, update or delete a node.
    const h = harness()
    const surface = Object.keys(h.editor)
    expect(surface.some((key) => /^(create|update|delete|insert|move|remove)/i.test(key))).toBe(
      false,
    )
  })

  it('removes every listener on destroy', () => {
    const h = harness()
    expect(h.canvas.count + h.keys.count).toBeGreaterThan(0)
    h.controller.destroy()
    expect(h.canvas.count + h.keys.count).toBe(0)
  })
})

describe('selection', () => {
  it('selects the node under a click', () => {
    const h = harness()
    click(h, [200, 150], [200, 150])
    expect(h.selectCalls).toHaveLength(1)
    // Shallow: the top-level entity, not whatever leaf sits under the cursor.
    expect(h.emitted.at(-1)).toEqual(['Card'])
  })

  it('selects on press, before the button comes back up', () => {
    const h = harness()
    h.canvas.fire('pointerdown', { button: 0, clientX: 200, clientY: 150, pointerId: 1 })
    expect(h.selectCalls).toHaveLength(1)
    expect(h.emitted.at(-1)).toEqual(['Card'])
  })

  it('does not select again on a release that travelled — that was a drag', () => {
    const h = harness()
    click(h, [200, 150], [200 + CLICK_SLOP + 10, 150])
    // The press took it; the release, having travelled, changes nothing.
    expect(h.selectCalls).toHaveLength(1)
  })

  it('leaves the selection alone when the release lands on what the press took', () => {
    const h = harness()
    click(h, [200, 150], [200, 150])
    click(h, [200, 150], [200, 150])
    expect(h.selectCalls).toHaveLength(1)
  })

  it('tolerates a tiny wobble', () => {
    const h = harness()
    click(h, [200, 150], [201, 151])
    expect(h.selectCalls).toHaveLength(1)
  })

  it('emits an empty selection when the click hits nothing', () => {
    const h = harness()
    h.setHit(null)
    click(h, [200, 150], [200, 150])
    expect(h.emitted.at(-1)).toEqual([])
  })

  it('does not select at the end of a space-drag pan', () => {
    const h = harness()
    h.keys.fire('keydown', { code: 'Space' })
    h.canvas.fire('pointerdown', { button: 0, clientX: 0, clientY: 0, pointerId: 1 })
    h.canvas.fire('pointermove', { clientX: 50, clientY: 50, pointerId: 1 })
    h.canvas.fire('pointerup', { clientX: 50, clientY: 50, pointerId: 1 })
    expect(h.selectCalls).toHaveLength(0)
  })

  it('clears the selection on escape', () => {
    const h = harness()
    click(h, [200, 150], [200, 150])
    h.keys.fire('keydown', { code: 'Escape' })
    expect(h.cleared()).toBe(1)
    expect(h.emitted.at(-1)).toEqual([])
  })

  it('tracks hover so it is obvious what a click would hit', () => {
    const h = harness()
    h.canvas.fire('pointermove', { clientX: 200, clientY: 150, pointerId: 1 })
    expect(h.hovered.at(-1)).toBe('Card')
    h.setHit(null)
    h.canvas.fire('pointermove', { clientX: 0, clientY: 0, pointerId: 1 })
    expect(h.hovered.at(-1)).toBeNull()
  })

  it('does not hover-test while panning', () => {
    const h = harness()
    h.canvas.fire('pointerdown', { button: 1, clientX: 0, clientY: 0, pointerId: 1 })
    h.canvas.fire('pointermove', { clientX: 30, clientY: 30, pointerId: 1 })
    expect(h.hovered).toHaveLength(0)
  })
})

/**
 * Figma's selection model (story G7).
 *
 * Until this landed a click could only ever reach the outermost entity, which
 * made the properties pane unable to describe anything nested and left
 * double-click deliberately unbound waiting for exactly this.
 */
describe('deep selection', () => {
  const dbl = (h: ReturnType<typeof harness>, at: [number, number] = [200, 150]) =>
    h.canvas.fire('dblclick', { clientX: at[0], clientY: at[1] })

  it('descends one level per double-click', () => {
    const h = harness()
    dbl(h)
    expect(h.emitted.at(-1)).toEqual(['Card#inner'])
    dbl(h)
    expect(h.emitted.at(-1)).toEqual(['Card#inner/leaf'])
  })

  it('stays put rather than entering something with nothing inside it', () => {
    const h = harness()
    dbl(h)
    dbl(h)
    const depth = h.editor.state.enteredContainerId
    // The leaf has no children; a third descent must not pretend otherwise.
    dbl(h)
    expect(h.emitted.at(-1)).toEqual(['Card#inner/leaf'])
    expect(h.editor.state.enteredContainerId).toBe(depth)
  })

  it('cmd-click reaches the leaf in one gesture', () => {
    const h = harness()
    click(h, [200, 150], [200, 150], { metaKey: true })
    expect(h.emitted.at(-1)).toEqual(['Card#inner/leaf'])
    // Deep select does not change where the author is standing.
    expect(h.editor.state.enteredContainerId).toBeNull()
  })

  it('ctrl-click does the same, for people not on a Mac', () => {
    const h = harness()
    click(h, [200, 150], [200, 150], { ctrlKey: true })
    expect(h.emitted.at(-1)).toEqual(['Card#inner/leaf'])
  })

  it('hover previews what the modifier would hit, not what a plain click would', () => {
    const h = harness()
    h.canvas.fire('pointermove', { clientX: 200, clientY: 150, pointerId: 1 })
    expect(h.hovered.at(-1)).toBe('Card')
    h.canvas.fire('pointermove', { clientX: 200, clientY: 150, pointerId: 1, metaKey: true })
    expect(h.hovered.at(-1)).toBe('Card#inner/leaf')
  })

  it('escape steps out one level before it clears', () => {
    const h = harness()
    dbl(h)
    dbl(h)
    expect(h.editor.state.enteredContainerId).toBe('Card#inner')

    h.keys.fire('keydown', { code: 'Escape' })
    expect(h.editor.state.enteredContainerId).toBe('Card')
    h.keys.fire('keydown', { code: 'Escape' })
    expect(h.editor.state.enteredContainerId).toBeNull()

    // Only once there is nowhere left to step out to does it deselect.
    const before = h.cleared()
    h.keys.fire('keydown', { code: 'Escape' })
    expect(h.cleared()).toBe(before + 1)
  })

  it('clicking empty space steps back out too', () => {
    const h = harness()
    dbl(h)
    expect(h.editor.state.enteredContainerId).toBe('Card')

    h.setHit(null)
    click(h, [10, 10], [10, 10])
    expect(h.editor.state.enteredContainerId).toBeNull()
    expect(h.emitted.at(-1)).toEqual([])
  })

  it('refuses to deep-select something the file does not declare', () => {
    // What instance children will be once F3 lands: present in the scene, absent
    // from the bimap, and impossible to write a patch for (see D4).
    const h = harness({ isAddressable: (id: string) => id !== 'Card#inner/leaf' })
    click(h, [200, 150], [200, 150], { metaKey: true })
    expect(h.emitted.at(-1)).toEqual(['Card'])
  })
})
