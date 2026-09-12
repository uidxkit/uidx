import { describe, expect, it } from 'vitest'
import { parseOrThrow } from '@uidx/format'
import { fromSceneChange, toSceneGraph } from '@uidx/schema'
import { resizeWrites } from '../src/resize-writes'

/**
 * The C10a spike found that a hugging frame resized on canvas produced no
 * patch at all: the SDK commits x/y/width/height, the axis still reads HUG,
 * and D4's filter drops a dimension the node computes for itself.
 *
 * This is that case, end to end. It fails if `resize-writes.ts` stops sending
 * the sizing flip — which is the whole reason that module exists.
 */
const SRC = `---
id: rt
---

## Visual Contract

<Component name="rt" status="draft">
  <Frame name="root" layoutMode="NONE">
    <Frame name="hugger" layoutMode="VERTICAL"
      primaryAxisSizingMode="AUTO" counterAxisSizingMode="AUTO">
      <Rectangle name="kid" width={40} height={40} />
    </Frame>
  </Frame>
</Component>
`

function resizeAndCollect(rect: { x: number; y: number; width: number; height: number }) {
  const doc = parseOrThrow(SRC)
  const scene = toSceneGraph(doc)
  const sceneId = scene.addresses.sceneIdOf('rt#root/hugger')!
  const node = scene.graph.getNode(sceneId)!
  const writes = resizeWrites(node, rect)
  scene.graph.updateNode(sceneId, writes as never)
  return fromSceneChange(sceneId, writes as never, {
    doc,
    graph: scene.graph,
    addresses: scene.addresses,
  })
}

describe('a canvas resize of a hugging frame', () => {
  it('reaches the file, sizing flip and all', () => {
    const patches = resizeAndCollect({ x: 0, y: 0, width: 300, height: 150 })
    const byProp = Object.fromEntries(
      patches.map((p) => [(p as { prop: string }).prop, (p as { value: unknown }).value]),
    )
    expect(byProp.width).toBe(300)
    expect(byProp.height).toBe(150)
    expect(byProp.primaryAxisSizingMode).toBe('FIXED')
    expect(byProp.counterAxisSizingMode).toBe('FIXED')
  })

  it('is one gesture, so its writes are few enough to be one envelope', () => {
    expect(resizeAndCollect({ x: 0, y: 0, width: 300, height: 150 }).length).toBeLessThanOrEqual(6)
  })
})
