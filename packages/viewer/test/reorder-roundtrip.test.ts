import { describe, expect, it } from 'vitest'
import { applyPatch, parseOrThrow, resolve } from '@uidx/format'
import { getAbsolutePosition } from '@open-pencil/scene-graph'
import { toSceneGraph } from '@uidx/schema'

import { flowSlotAt, type FlowChild } from '../src/flow-reorder'
import { reorderFor } from '../src/layer-moves'

/**
 * D7 end to end without a renderer: a pointer inside a laid-out frame becomes
 * an index, the index becomes one `move-node`, and the file's child order
 * changes with nothing else beside it.
 *
 * The layout is real — `toSceneGraph` runs Yoga — so the sibling rects these
 * assertions rest on are the ones the author would actually be pointing at.
 */
const SRC = `---
id: rt
---

## Visual Contract

<Page>
  <Frame name="stack" x={0} y={0} width={200} height={400}
    layoutMode="VERTICAL" primaryAxisSizingMode="FIXED" counterAxisSizingMode="FIXED"
    itemSpacing={0}>
    <Rectangle name="a" width={100} height={40} />
    <Rectangle name="b" width={100} height={40} />
    <Rectangle name="c" width={100} height={40} />
  </Frame>
</Page>
`

/** What a drag of `name` to `point` decides, against a freshly laid-out scene. */
function dragTo(name: string, point: { x: number; y: number }) {
  const doc = parseOrThrow(SRC)
  const scene = toSceneGraph(doc)
  const parentId = scene.addresses.sceneIdOf('stack')!
  const parent = scene.graph.getNode(parentId)!
  const draggedId = scene.addresses.sceneIdOf(`stack#${name}`)!

  const siblings: FlowChild[] = []
  for (const id of parent.childIds) {
    if (id === draggedId) continue
    const node = scene.graph.getNode(id)!
    const at = getAbsolutePosition(node, scene.graph)
    siblings.push({ id, x: at.x, y: at.y, width: node.width, height: node.height })
  }
  const home = getAbsolutePosition(parent, scene.graph)
  const slot = flowSlotAt(point, siblings, 'VERTICAL', {
    id: parentId,
    x: home.x,
    y: home.y,
    width: parent.width,
    height: parent.height,
  })
  return { doc, slot, patch: reorderFor(doc, `stack#${name}`, slot.index) }
}

const order = (source: string) =>
  resolve(parseOrThrow(source).tree, 'stack')!.children.map((c) => c.name)

describe('dragging a flowed child down the stack', () => {
  it('reaches the file as one move-node, and reorders it', () => {
    /*
     * Rows sit at y 0-40, 40-80, 80-120, and they stay there for the length of
     * the drag: the gesture only previews, so the scene still holds `a` in its
     * old slot while the pointer moves. The slots are therefore the gaps as
     * they currently look, which is what the author is actually pointing at —
     * past `c`'s midpoint at y 100 is the last slot.
     */
    const { doc, slot, patch } = dragTo('a', { x: 50, y: 110 })
    expect(slot.index).toBe(2)
    expect(patch).toEqual({ op: 'move-node', address: 'stack#a', newParent: 'stack', index: 2 })

    const { source } = applyPatch(SRC, patch!, { document: doc })
    expect(order(source)).toEqual(['b', 'c', 'a'])
    // One structural change and nothing else: the layout owns these positions,
    // so a geometry write beside the move would be exactly what D4 refuses.
    expect(source).not.toMatch(/name="a"[\s\S]{0,80}\bx=\{/)
  })

  it('reorders upward too, with the index counted the same way', () => {
    const { patch, doc } = dragTo('c', { x: 50, y: 10 })
    expect(patch).toMatchObject({ index: 0 })
    expect(order(applyPatch(SRC, patch!, { document: doc }).source)).toEqual(['c', 'a', 'b'])
  })

  /**
   * The case that makes the "count siblings with the dragged child removed"
   * convention worth having: the answer for "still where it was" is the child's
   * own original index, whichever direction the drag came from. Counting
   * against the displayed list instead is the classic reorder off-by-one.
   */
  it('commits nothing when the drag lands back where it started', () => {
    expect(dragTo('b', { x: 50, y: 50 }).patch).toBeNull()
    expect(dragTo('a', { x: 50, y: 10 }).patch).toBeNull()
    expect(dragTo('c', { x: 50, y: 100 }).patch).toBeNull()
  })

  it('clamps a drag that leaves the frame rather than inventing a slot', () => {
    expect(dragTo('a', { x: 50, y: 9999 }).slot.index).toBe(2)
    expect(dragTo('c', { x: 50, y: -9999 }).slot.index).toBe(0)
  })
})
