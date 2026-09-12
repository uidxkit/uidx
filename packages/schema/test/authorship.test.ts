import { describe, expect, it } from 'vitest'
import { parseOrThrow } from '@uidx/format'
import { isDerivedSize, isPositionAuthored, isSizeAuthored, toSceneGraph } from '../src/index.js'

const SRC = `---
id: auth
---

## Visual Contract

<Component name="auth" status="draft">
  <Frame name="root" layoutMode="NONE">
    <Frame name="stack" layoutMode="VERTICAL"
      primaryAxisSizingMode="AUTO" counterAxisSizingMode="AUTO">
      <Rectangle name="flowed" width={40} height={40} />
      <Rectangle name="escaped" width={40} height={40} layoutPositioning="ABSOLUTE" />
    </Frame>
    <Rectangle name="loose" width={40} height={40} />
    <Text name="label" characters="hi" textAutoResize="WIDTH_AND_HEIGHT" />
    <Text name="wrapped" characters="hi" textAutoResize="HEIGHT" />
  </Frame>
</Component>
`

const scene = toSceneGraph(parseOrThrow(SRC))
const node = (address: string) => scene.graph.getNode(scene.addresses.sceneIdOf(address)!)!

describe('isPositionAuthored', () => {
  it('is true for a child of a plain frame — somebody put it there', () => {
    expect(isPositionAuthored(scene.graph, node('auth#root/loose'))).toBe(true)
  })

  it('is false for a child an auto-layout parent places', () => {
    expect(isPositionAuthored(scene.graph, node('auth#root/stack/flowed'))).toBe(false)
  })

  it('is true again once the child escapes the flow', () => {
    expect(isPositionAuthored(scene.graph, node('auth#root/stack/escaped'))).toBe(true)
  })
})

describe('isSizeAuthored', () => {
  it('is true on both axes for a plain rectangle', () => {
    expect(isSizeAuthored(node('auth#root/loose'), 'width')).toBe(true)
    expect(isSizeAuthored(node('auth#root/loose'), 'height')).toBe(true)
  })

  it('is false on an axis the frame hugs', () => {
    expect(isSizeAuthored(node('auth#root/stack'), 'width')).toBe(false)
    expect(isSizeAuthored(node('auth#root/stack'), 'height')).toBe(false)
  })

  it('is false on both axes for text that sizes itself', () => {
    expect(isSizeAuthored(node('auth#root/label'), 'width')).toBe(false)
    expect(isSizeAuthored(node('auth#root/label'), 'height')).toBe(false)
  })

  it('is false only on the height a wrapping text measures', () => {
    expect(isSizeAuthored(node('auth#root/wrapped'), 'width')).toBe(true)
    expect(isSizeAuthored(node('auth#root/wrapped'), 'height')).toBe(false)
  })
})

describe('a size the parent computes (found by the F5 live pass)', () => {
  const graph = {
    getNode: (id: string) =>
      ({
        'flow-v': { layoutMode: 'VERTICAL' },
        'flow-h': { layoutMode: 'HORIZONTAL' },
        plain: { layoutMode: 'NONE' },
      })[id],
  }
  const child = (parentId: string, extra: Record<string, unknown> = {}) => ({
    parentId,
    ...extra,
  })

  it('treats layoutGrow as the parent’s primary axis, not the node’s own', () => {
    // The bug: `axisSizing` reads the *node's* layoutMode, and layoutGrow
    // speaks about the parent's. A frame with no layoutMode of its own looked
    // hand-sized, so a reflow wrote its computed height into the file.
    const node = child('flow-v', { layoutGrow: 1 })
    expect(isDerivedSize(node, 'height', graph)).toBe(true)
    expect(isDerivedSize(node, 'width', graph)).toBe(false)
  })

  it('turns with the parent’s axis', () => {
    const node = child('flow-h', { layoutGrow: 1 })
    expect(isDerivedSize(node, 'width', graph)).toBe(true)
    expect(isDerivedSize(node, 'height', graph)).toBe(false)
  })

  it('reads layoutAlignSelf STRETCH as the counter axis — the scene spelling', () => {
    const node = child('flow-v', { layoutAlignSelf: 'STRETCH' })
    expect(isDerivedSize(node, 'width', graph)).toBe(true)
    expect(isDerivedSize(node, 'height', graph)).toBe(false)
  })

  it('lets an absolutely positioned child keep its own size', () => {
    const node = child('flow-v', { layoutGrow: 1, layoutPositioning: 'ABSOLUTE' })
    expect(isDerivedSize(node, 'height', graph)).toBe(false)
  })

  it('says nothing about a child of a parent with no flow', () => {
    expect(isDerivedSize(child('plain', { layoutGrow: 1 }), 'height', graph)).toBe(false)
  })

  it('answers as it always did when the caller has no graph', () => {
    expect(isDerivedSize(child('flow-v', { layoutGrow: 1 }), 'height')).toBe(false)
  })
})
