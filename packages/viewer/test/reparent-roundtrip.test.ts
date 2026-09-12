import { describe, expect, it } from 'vitest'
import { applyPatches, parseOrThrow } from '@uidx/format'
import { toSceneGraph } from '@uidx/schema'

import { containerChainAt, dropTargetFor } from '../src/drop-target'

/**
 * C10b end to end, with the renderer left out — the graph, the hit test and
 * the patcher are all headless, and only the pointer had to be invented.
 *
 * `left` and `right` sit side by side on the page; `kid` starts in `left`.
 * Dragging it across is the gesture, and the assertion is about the *file*:
 * one structural change, and nothing about geometry beside it.
 */
const SRC = `---
id: rt
---

## Visual Contract

<Page>
  <Frame name="left" x={0} y={0} width={200} height={200} layoutMode="NONE" />
  <Frame name="right" x={300} y={0} width={200} height={200} layoutMode="NONE" />
</Page>
`

const WITH_KID = SRC.replace(
  '<Frame name="left" x={0} y={0} width={200} height={200} layoutMode="NONE" />',
  `<Frame name="left" x={0} y={0} width={200} height={200} layoutMode="NONE">
    <Rectangle name="kid" x={10} y={10} width={50} height={50} />
  </Frame>`,
)

/**
 * What the drop over `point` decides, against a freshly built scene.
 *
 * `keepAt` stands in for what `CanvasPane.placeAfterDrop` works out from the
 * graph — the node's world origin less the new parent's.
 */
function dropAt(point: { x: number; y: number }, keepAt: { x: number; y: number } | null = null) {
  const doc = parseOrThrow(WITH_KID)
  const scene = toSceneGraph(doc)
  const dragged = scene.addresses.sceneIdOf('left#kid')!
  const chain = containerChainAt(scene.graph, scene.rootId, point, dragged)
    .map((id) => scene.addresses.addressOf(id))
    .filter((address): address is string => address !== undefined)
  return { doc, target: dropTargetFor(doc, 'left#kid', chain, keepAt) }
}

describe('a canvas drop into another frame', () => {
  it('reaches the file as one move-node, and nothing else', () => {
    // Inside `right`, which spans x 300–500.
    const { doc, target } = dropAt({ x: 350, y: 100 })
    expect(target).toMatchObject({
      parent: 'right',
      address: 'right#kid',
      patches: [{ op: 'move-node', address: 'left#kid', newParent: 'right', index: 0 }],
    })

    const { source } = applyPatches(WITH_KID, target!.patches, { document: doc })
    const patched = parseOrThrow(source)
    // The move carries the node's own attributes across untouched: a canvas
    // drop must not slip the old parent's arithmetic into the diff beside the
    // change that invalidated it.
    expect(source).toContain('<Rectangle name="kid" x={10} y={10} width={50} height={50} />')
    expect(patched.tree.children.find((c) => c.name === 'left')?.children).toHaveLength(0)
    expect(
      patched.tree.children.find((c) => c.name === 'right')?.children.map((c) => c.address),
    ).toEqual(['right#kid'])
  })

  it('promotes the node to the page when the drop lands on empty canvas', () => {
    const { target } = dropAt({ x: 250, y: 400 })
    expect(target).toMatchObject({ parent: '', address: 'kid' })
  })

  it('says nothing at all when the pointer never left the node’s own frame', () => {
    expect(dropAt({ x: 100, y: 150 }).target).toBeNull()
  })
})

/**
 * The envelope that keeps a dropped node under the pointer. `x`/`y` are
 * relative to the parent, so a bare reparent re-reads them against a different
 * origin and the node jumps by the distance between the two frames.
 */
describe('a drop that keeps the node where the pointer left it', () => {
  it('applies the move and the position writes as one envelope', () => {
    // `kid` sat at (10, 10) inside `left` at (0, 0) — world (10, 10). Dropped
    // over `right`, which starts at x 300, staying put means x = 60 - 300.
    const { doc, target } = dropAt({ x: 350, y: 100 }, { x: 50, y: 100 })
    expect(target!.patches.map((p) => p.op)).toEqual(['move-node', 'set', 'set'])

    const { source } = applyPatches(WITH_KID, target!.patches, { document: doc })
    const kid = parseOrThrow(source).tree.children.find((c) => c.name === 'right')!.children[0]!
    expect(kid.address).toBe('right#kid')
    expect(kid.attrs.x?.value).toBe(50)
    expect(kid.attrs.y?.value).toBe(100)
  })

  it('adds the attributes where the file never stated a position', () => {
    const bare = SRC.replace(
      '<Frame name="left" x={0} y={0} width={200} height={200} layoutMode="NONE" />',
      `<Frame name="left" x={0} y={0} width={200} height={200} layoutMode="NONE">
    <Rectangle name="kid" width={50} height={50} />
  </Frame>`,
    )
    const doc = parseOrThrow(bare)
    const target = dropTargetFor(doc, 'left#kid', ['right'], { x: 7, y: 8 })
    expect(target!.patches.map((p) => p.op)).toEqual(['move-node', 'add', 'add'])
    const { source } = applyPatches(bare, target!.patches, { document: doc })
    const kid = parseOrThrow(source).tree.children.find((c) => c.name === 'right')!.children[0]!
    expect([kid.attrs.x?.value, kid.attrs.y?.value]).toEqual([7, 8])
  })

  it('writes no position when the host says the new parent places its children', () => {
    const { target } = dropAt({ x: 350, y: 100 }, null)
    expect(target!.patches).toHaveLength(1)
  })
})
