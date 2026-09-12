import { describe, expect, it } from 'vitest'
import { parseOrThrow } from '@uidx/format'
import { estimateTextSize, getTextMeasurer, setTextMeasurer } from '@open-pencil/core/layout'
import type { SceneNode } from '@open-pencil/scene-graph'

import { applyChanges, diffDocuments, toSceneGraph } from '../src/index.js'

/**
 * Auto-sized text that no auto-layout parent ever measures.
 *
 * Yoga is the only thing in the SDK that measures a `<Text>`, and
 * `computeLayoutsBottomUp` runs it only where `layoutMode !== 'NONE'`. So a
 * label positioned by hand inside a plain frame — the shape every screen mockup
 * in `design/` is built from — kept the scene graph's constructed default: a
 * 100×100 square. The glyphs still drew at their own size, because the renderer
 * measures independently of the node's box, which is what made this so quiet:
 * the page looked right and the node was a square. Selection drew a square, the
 * hit target was a square, and any `textAlign*` other than the default centred
 * the glyphs inside a box that was not theirs.
 *
 * Figma has no such rule — an auto-width text is its glyph box wherever it
 * lives — so this is the schema layer's difference to absorb.
 */
const FREE = `---
id: free-text
---

## Visual Contract

<Page>
  <Frame name="screen" width={400} height={300}>
    <Text name="label" x={20} y={20} characters="DOCUMENT" fontSize={12} />
  </Frame>
</Page>
`

/** What the SDK would measure, computed without reference to the built node. */
function estimateOf(
  props: Partial<SceneNode>,
  maxWidth?: number,
): { width: number; height: number } {
  return estimateTextSize(props as SceneNode, maxWidth)
}

describe('text that no auto-layout parent measures', () => {
  it('hugs its glyphs rather than keeping the engine default square', () => {
    const { graph } = toSceneGraph(parseOrThrow(FREE))
    const label = graph.getNode('screen#label')

    const expected = estimateOf({ text: 'DOCUMENT', fontSize: 12 })
    expect(expected.width).not.toBe(100)
    expect(label?.width).toBe(expected.width)
    expect(label?.height).toBe(expected.height)
  })

  it('keeps the authored width when only the height is derived', () => {
    const src = FREE.replace('characters="DOCUMENT"', 'width={80} characters="DOCUMENT"')
    const { graph } = toSceneGraph(parseOrThrow(src))
    const label = graph.getNode('screen#label')

    // A width alone is Figma's wrap-and-grow-downward mode, so the width is the
    // author's and only the height is measured — at that width.
    expect(label?.textAutoResize).toBe('HEIGHT')
    expect(label?.width).toBe(80)
    expect(label?.height).toBe(estimateOf({ text: 'DOCUMENT', fontSize: 12 }, 80).height)
  })

  it('leaves a text that authored both dimensions alone', () => {
    const src = FREE.replace(
      'characters="DOCUMENT"',
      'width={140} height={40} textAutoResize="NONE" characters="DOCUMENT"',
    )
    const { graph } = toSceneGraph(parseOrThrow(src))
    const label = graph.getNode('screen#label')

    expect(label?.width).toBe(140)
    expect(label?.height).toBe(40)
  })

  it('re-measures when the incremental path changes what the text says', () => {
    const before = parseOrThrow(FREE)
    const scene = toSceneGraph(before)
    const after = parseOrThrow(FREE.replace('DOCUMENT', 'A much longer label'))

    const changes = diffDocuments(before, after)
    expect(changes).not.toBeNull()
    applyChanges(scene, changes!)

    const label = scene.graph.getNode('screen#label')
    expect(label?.width).toBe(estimateOf({ text: 'A much longer label', fontSize: 12 }).width)
  })

  it('still lets the flow size a text its parent does lay out', () => {
    const src = FREE.replace('name="screen"', 'name="screen" layoutMode="VERTICAL"')
    const { graph } = toSceneGraph(parseOrThrow(src))
    const label = graph.getNode('screen#label')

    expect(label?.width).toBe(estimateOf({ text: 'DOCUMENT', fontSize: 12 }).width)
  })
})

/**
 * The measurer is not available on demand — it has to be asked twice.
 *
 * `measureTextNode` returns null the first time it is asked about a text node:
 * the SDK raises a *font demand* for that node's face and answers only once the
 * demand settles. So the first build of a document necessarily falls back to
 * `estimateTextSize`, which is a character count times 0.6 of the font size —
 * close enough to look right, wrong enough to move every hug frame built from
 * it.
 *
 * That was invisible while nothing rebuilt: the estimate simply *was* the
 * layout. Opening a second page made it visible, because a page switch rebuilds
 * and the second build gets real metrics — so the whole page reflowed the first
 * time the author switched pages, and reloading "fixed" it because a reload is
 * a fresh first build.
 *
 * A build therefore has to say when it could only estimate, so the canvas knows
 * to come back once the fonts have settled.
 */
describe('a build that could only estimate', () => {
  it('tracks estimated text inside auto layout before the first root-size rebuild', () => {
    const doc = parseOrThrow(
      `---\nid: welcome\n---\n## Visual Contract\n<Page rootFontSize={16}><Frame name="Welcome" width={640} height={240} layoutMode="VERTICAL" paddingTop={40} itemSpacing={16}><Text name="heading" characters="Welcome to uidx" fontSize={32} /><Text name="description" characters="Your project's design workspace." fontSize={16} /></Frame></Page>`,
    )
    let ready = false
    const measure = (node: SceneNode) =>
      ready ? { width: (node.text.length * node.fontSize) / 2, height: node.fontSize } : null
    setTextMeasurer(measure)
    try {
      const first = toSceneGraph(doc)
      expect(first.unmeasuredText).toBe(2)
      expect(getTextMeasurer()).toBe(measure)
      const estimatedY = first.graph.getNode('Welcome#description')!.y
      ready = true
      const settled = toSceneGraph(doc)
      expect(settled.unmeasuredText).toBe(0)
      const settledY = settled.graph.getNode('Welcome#description')!.y
      expect(settledY).toBe(88)
      expect(settledY).toBeLessThan(estimatedY)
      const edited = toSceneGraph(
        parseOrThrow(doc.source.replace('rootFontSize={16}', 'rootFontSize={17}')),
      )
      expect(edited.graph.getNode('Welcome#description')!.y).toBe(settledY)
    } finally {
      setTextMeasurer(null)
    }
  })

  it('also tracks flow text before a canvas measurer is installed', () => {
    const doc = parseOrThrow(FREE.replace('name="screen"', 'name="screen" layoutMode="VERTICAL"'))
    expect(toSceneGraph(doc).unmeasuredText).toBe(1)
    expect(getTextMeasurer()).toBeNull()
  })

  it('says how many texts it had to guess at', () => {
    const scene = toSceneGraph(parseOrThrow(FREE))

    // No measurer is installed in a headless test, which is the same answer the
    // browser gives on a first build: fall back, and say so.
    expect(scene.unmeasuredText).toBe(1)
  })

  it('reports none once the measurer answers', () => {
    setTextMeasurer(() => ({ width: 65, height: 12 }))
    try {
      const scene = toSceneGraph(parseOrThrow(FREE))

      expect(scene.unmeasuredText).toBe(0)
      expect(scene.graph.getNode('screen#label')?.width).toBe(65)
    } finally {
      setTextMeasurer(null)
    }
  })

  it('counts a text the measurer declines, not every text on the page', () => {
    // The demand is raised per node, so readiness is per node too: a page can
    // come back with one face settled and another still pending.
    setTextMeasurer((node) => (node.text === 'DOCUMENT' ? null : { width: 40, height: 12 }))
    try {
      const src = FREE.replace(
        '<Text name="label"',
        '<Text name="other" x={20} y={60} characters="Other" fontSize={12} />\n    <Text name="label"',
      )
      const scene = toSceneGraph(parseOrThrow(src))

      expect(scene.unmeasuredText).toBe(1)
    } finally {
      setTextMeasurer(null)
    }
  })
})
