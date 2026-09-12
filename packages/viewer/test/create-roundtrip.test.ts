import { describe, expect, it } from 'vitest'
import { applyPatch, autoName, emitDocument, parseOrThrow, resolve } from '@uidx/format'
import { createSpec, toSceneGraph, type CreatableElement } from '@uidx/schema'

import { containerChainAt, insertTargetFor } from '../src/drop-target'

/**
 * D1 end to end, with the renderer left out: a point on the canvas becomes a
 * parent, a name, a spec and an `insert-node` that lands in the file.
 *
 * The assertion that matters most is the last one — D1 asks that the output
 * match `uidx fmt` style, and the way to check that without a second opinion
 * is that re-emitting the patched document is a no-op.
 */
/**
 * Canonical to start with, deliberately: the assertion below is that patching
 * a canonical file leaves it canonical, and a hand-written fixture would fail
 * that on its own formatting rather than on anything a create did.
 */
const SRC = emitDocument(
  parseOrThrow(`---
id: rt
---

## Visual Contract

<Page>
  <Frame name="board" x={0} y={0} width={400} height={300} layoutMode="NONE" />
</Page>
`),
)

/** What a draw at `at` of `size` produces, against a freshly built scene. */
function drawAt(
  element: CreatableElement,
  at: { x: number; y: number },
  size: { width: number; height: number } | null,
) {
  const doc = parseOrThrow(SRC)
  const scene = toSceneGraph(doc)
  const chain = containerChainAt(scene.graph, scene.rootId, at, '')
    .map((id) => scene.addresses.addressOf(id))
    .filter((address): address is string => address !== undefined)
  const parent = insertTargetFor(doc, element, chain)!
  const parentNode = resolve(doc.tree, parent)!
  const name = autoName(element, parentNode.children)
  const spec = createSpec(element, name, {
    // `board` lays nothing out, so the position is the author's; the offset is
    // the frame's own origin, which is (0, 0) here.
    at,
    size,
  })
  const patch = {
    op: 'insert-node' as const,
    parent,
    index: parentNode.children.length,
    node: spec,
  }
  return { doc, parent, name, patch, source: applyPatch(SRC, patch, { document: doc }).source }
}

describe('drawing a shape inside a frame', () => {
  it('lands in the frame the pointer was over, auto-named', () => {
    const { parent, name, source } = drawAt(
      'Rectangle',
      { x: 40, y: 30 },
      { width: 80, height: 60 },
    )
    expect(parent).toBe('board')
    expect(name).toBe('rectangle-1')
    const board = parseOrThrow(source).tree.children[0]!
    expect(board.children.map((c) => c.address)).toEqual(['board#rectangle-1'])
  })

  it('draws on the page when the pointer is over empty canvas', () => {
    expect(drawAt('Frame', { x: 900, y: 900 }, { width: 50, height: 50 }).parent).toBe('')
  })

  it('numbers the next one up rather than colliding', () => {
    const first = drawAt('Rectangle', { x: 40, y: 30 }, { width: 10, height: 10 })
    const doc = parseOrThrow(first.source)
    const board = resolve(doc.tree, 'board')!
    expect(autoName('Rectangle', board.children)).toBe('rectangle-2')
  })

  /**
   * The whole point of putting the defaults in `@uidx/schema`: what reaches the
   * file is canonical, so `uidx fmt` has nothing to say about it.
   *
   * The assertion is against the *patched source*, not against a re-emit of a
   * re-emit — that compares `emitDocument` with itself and passes whatever the
   * patcher wrote. It passed exactly that way while `insert-node` was leaving
   * `>` spliced onto the last attribute's line, which a real `uidx fmt` run
   * then rewrote.
   */
  it('writes canonical source, so `uidx fmt` would not touch it', () => {
    for (const element of ['Frame', 'Text', 'Rectangle', 'Ellipse', 'Vector'] as const) {
      const { source } = drawAt(element, { x: 40, y: 30 }, { width: 80, height: 60 })
      expect(emitDocument(parseOrThrow(source))).toBe(source)
      // And the node itself survives the round trip with what it was given.
      const made = resolve(parseOrThrow(source).tree, `board#${element.toLowerCase()}-1`)!
      expect([made.attrs.x?.value, made.attrs.y?.value]).toEqual([40, 30])
    }
  })

  /**
   * Draw a frame, then draw inside it — the two-step that turns a self-closing
   * tag into an open/close pair. `uidx fmt` on the live scratch file is what
   * found this, after a test that only compared `emitDocument` to itself said
   * it was fine.
   */
  it('stays canonical when a created frame is then drawn inside', () => {
    const outer = drawAt('Frame', { x: 40, y: 30 }, { width: 200, height: 150 })
    const doc = parseOrThrow(outer.source)
    const parent = resolve(doc.tree, 'board#frame-1')!
    const { source } = applyPatch(
      outer.source,
      {
        op: 'insert-node',
        parent: parent.address,
        index: 0,
        node: createSpec('Rectangle', 'rectangle-1', {
          at: { x: 10, y: 10 },
          size: { width: 40, height: 40 },
        }),
      },
      { document: doc },
    )
    expect(emitDocument(parseOrThrow(source))).toBe(source)
  })

  it('gives a clicked node no size of its own, letting the engine answer', () => {
    const { source } = drawAt('Ellipse', { x: 40, y: 30 }, null)
    const made = resolve(parseOrThrow(source).tree, 'board#ellipse-1')!
    expect(made.attrs.width).toBeUndefined()
    expect(made.attrs.height).toBeUndefined()
  })

  it('renders what it made — the created node reaches the scene graph', () => {
    const { source } = drawAt('Rectangle', { x: 40, y: 30 }, { width: 80, height: 60 })
    const scene = toSceneGraph(parseOrThrow(source))
    const id = scene.addresses.sceneIdOf('board#rectangle-1')!
    const node = scene.graph.getNode(id)!
    expect([node.width, node.height]).toEqual([80, 60])
    // The fill is the reason a created node is visible at all.
    expect(node.fills.length).toBeGreaterThan(0)
  })
})
