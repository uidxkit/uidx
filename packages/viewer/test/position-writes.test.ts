import { describe, expect, it } from 'vitest'
import { parseOrThrow } from '@uidx/format'
import { positioningWrites } from '../src/position-writes'

/**
 * What flipping the absolute-position toggle commits (Figma parity).
 *
 * ABSOLUTE pins the node where it sits — x/y ride along in the same commit,
 * so the file records the position the author sees and the node does not jump
 * on the next load. AUTO hands position back to the layout, and the pinned
 * numbers leave the file with it: computed geometry must not linger as if
 * somebody chose it.
 */

const DOC = parseOrThrow(`---
id: card
---

## Visual Contract

<Page>
  <Component name="Card" status="draft">
    <Frame name="root" layoutMode="VERTICAL" width={480} height={320}>
      <Rectangle name="flowed" width={120} height={80} />
      <Rectangle name="pinned" layoutPositioning="ABSOLUTE" x={25} y={30}
        width={120} height={80} />
    </Frame>
  </Component>
</Page>
`)

const nodeAt = (address: string) => {
  const walk = (n: (typeof DOC)['tree']): (typeof DOC)['tree'] | null => {
    if (n.address === address) return n
    for (const c of n.children) {
      const hit = walk(c)
      if (hit) return hit
    }
    return null
  }
  return walk(DOC.tree)
}

describe('positioningWrites', () => {
  it('pins the current position when flipping to ABSOLUTE', () => {
    const result = positioningWrites({ x: 14, y: 26 }, 'ABSOLUTE', nodeAt('Card#root/flowed'))
    expect(result.fields).toEqual({ layoutPositioning: 'ABSOLUTE', x: 14, y: 26 })
    expect(result.removals).toEqual([])
  })

  it('removes the pinned numbers when flipping back to AUTO', () => {
    const result = positioningWrites({ x: 25, y: 30 }, 'AUTO', nodeAt('Card#root/pinned'))
    expect(result.fields).toEqual({ layoutPositioning: 'AUTO' })
    expect(result.removals).toEqual(['x', 'y'])
  })

  it('removes only what the file actually holds', () => {
    const result = positioningWrites({ x: 0, y: 0 }, 'AUTO', nodeAt('Card#root/flowed'))
    expect(result.removals).toEqual([])
  })

  it('survives a node the document no longer has', () => {
    const result = positioningWrites({ x: 5, y: 6 }, 'AUTO', null)
    expect(result.fields).toEqual({ layoutPositioning: 'AUTO' })
    expect(result.removals).toEqual([])
  })
})
