import { describe, expect, it } from 'vitest'
import { parseOrThrow } from '@uidx/format'
import { applyChanges, diffDocuments, toSceneGraph } from '../src/index.js'

/**
 * Which node carries which pin, and whether that survives an edit.
 *
 * The index exists because the scene node cannot answer: the offsets are
 * authored-only props with no scene field (ADR 0011 §2), and an instance's
 * generated children have no address to look up either. A stale entry is a
 * silently wrong filter rather than a crash, which is why the upkeep is tested
 * rather than assumed.
 */

const CARD = (child: string): string =>
  [
    '---',
    'id: card',
    '---',
    '',
    '## Visual Contract',
    '',
    '<Page>',
    '  <Component name="Card">',
    '    <Frame name="body" width={320} height={200}>',
    child,
    '    </Frame>',
    '  </Component>',
    '</Page>',
    '',
  ].join('\n')

const PINNED = (right: number): string =>
  CARD(`      <Text name="a" width={40} right={${right}} constraints={{ horizontal: 'MAX' }} />`)

describe('the pin index', () => {
  it('records the pin of an authored node, keyed by scene id', () => {
    const scene = toSceneGraph(parseOrThrow(PINNED(16)))
    expect(scene.pins.pinOf('Card#body/a')).toEqual({
      horizontal: 'MAX',
      vertical: 'MIN',
      right: 16,
    })
  })

  it('holds nothing for an unpinned node', () => {
    const scene = toSceneGraph(parseOrThrow(CARD(`      <Text name="a" x={16} />`)))
    expect(scene.pins.pinOf('Card#body/a')).toBeUndefined()
  })

  it('follows an edited offset rather than going stale', () => {
    // The offsets map to no scene property, so `diffProps` sees nothing here.
    // Without a change of its own, this edit would leave the index holding 16
    // and the canvas would not reflow at all.
    const before = parseOrThrow(PINNED(16))
    const after = parseOrThrow(PINNED(40))
    const scene = toSceneGraph(before)
    const changes = diffDocuments(before, after)
    expect(changes).not.toBeNull()
    applyChanges(scene, changes!)
    expect(scene.pins.pinOf('Card#body/a')?.right).toBe(40)
  })

  it('re-resolves the node when only the offset changed', () => {
    const before = parseOrThrow(PINNED(16))
    const after = parseOrThrow(PINNED(40))
    const scene = toSceneGraph(before)
    expect(scene.graph.getNode('Card#body/a')?.x).toBe(264)
    applyChanges(scene, diffDocuments(before, after)!)
    expect(scene.graph.getNode('Card#body/a')?.x).toBe(240) // 320 − 40 − 40
  })

  it('forgets a pin taken off a node', () => {
    const before = parseOrThrow(PINNED(16))
    const after = parseOrThrow(CARD(`      <Text name="a" width={40} x={8} />`))
    const scene = toSceneGraph(before)
    applyChanges(scene, diffDocuments(before, after)!)
    expect(scene.pins.pinOf('Card#body/a')).toBeUndefined()
  })

  it('forgets a node that leaves the document', () => {
    const before = parseOrThrow(PINNED(16))
    const after = parseOrThrow(CARD(`      <Text name="b" x={0} />`))
    const scene = toSceneGraph(before)
    applyChanges(scene, diffDocuments(before, after)!)
    expect(scene.pins.pinOf('Card#body/a')).toBeUndefined()
  })

  it('records a pin on a node that arrives after the build', () => {
    const before = parseOrThrow(CARD(`      <Text name="a" x={8} />`))
    const after = parseOrThrow(
      CARD(
        [
          `      <Text name="a" x={8} />`,
          `      <Text name="b" width={40} right={12} constraints={{ horizontal: 'MAX' }} />`,
        ].join('\n'),
      ),
    )
    const scene = toSceneGraph(before)
    applyChanges(scene, diffDocuments(before, after)!)
    expect(scene.pins.pinOf('Card#body/b')?.right).toBe(12)
    expect(scene.graph.getNode('Card#body/b')?.x).toBe(268) // 320 − 12 − 40
  })
})
