import { describe, expect, it } from 'vitest'
import { parseOrThrow } from '@uidx/format'

import { toSceneGraph } from '../src/to-scene'

const doc = (fills: string) =>
  parseOrThrow(`---
id: img
---

## Visual Contract

<Page>
  <Rectangle name="hero" width={40} height={20} fills={${fills}} />
</Page>
`)

const build = (fills: string, resolveAsset?: (src: string) => string | undefined) => {
  const parsed = doc(fills)
  const scene = toSceneGraph(parsed, { ...(resolveAsset ? { resolveAsset } : {}) })
  const node = scene.graph.getNode(scene.addresses.sceneIdOf('hero')!)!
  return { fills: node.fills as unknown as Record<string, unknown>[], warnings: scene.warnings }
}

/**
 * The file says `src` because a path is what a person can read in a diff; the
 * renderer wants `imageHash` because a byte store is keyed by one. ADR 0006 §1.
 */
describe('an image paint reaching the scene', () => {
  it('becomes the hash and scale mode the renderer reads', () => {
    const { fills } = build(
      `[{ type: 'IMAGE', src: 'assets/a.png', scaleMode: 'FIT' }]`,
      () => 'h1',
    )
    expect(fills[0]).toMatchObject({ type: 'IMAGE', imageHash: 'h1', imageScaleMode: 'FIT' })
  })

  it('leaves the authored spelling behind entirely', () => {
    const { fills } = build(`[{ type: 'IMAGE', src: 'assets/a.png' }]`, () => 'h1')
    // `src` is the file's word for it; the scene has no use for a path.
    expect(fills[0]!.src).toBeUndefined()
    expect(fills[0]!.scaleMode).toBeUndefined()
  })

  it('defaults the scale mode to FILL, which is what covering means', () => {
    const { fills } = build(`[{ type: 'IMAGE', src: 'a.png' }]`, () => 'h1')
    expect(fills[0]!.imageScaleMode).toBe('FILL')
  })

  /**
   * Keeping its place matters: dropping the paint would renumber a stack the
   * author is looking at, and substituting a colour would put one in the design
   * that nobody chose.
   */
  it('keeps its place in the stack when nothing resolved it, and says so', () => {
    const { fills, warnings } = build(
      `[
        { type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 } },
        { type: 'IMAGE', src: 'assets/gone.png' },
      ]`,
      () => undefined,
    )
    expect(fills).toHaveLength(2)
    expect(fills[1]!.imageHash).toBeUndefined()
    expect(warnings.join(' ')).toMatch(/assets\/gone\.png/)
  })

  it('leaves solids and gradients alone', () => {
    const { fills, warnings } = build(
      `[{ type: 'SOLID', color: { r: 0, g: 0, b: 1, a: 1 } }]`,
      () => 'h1',
    )
    expect(fills[0]).toMatchObject({ type: 'SOLID' })
    expect(warnings).toEqual([])
  })

  /**
   * Not a gap in this mapping — a gap in the scene graph. `Stroke` carries a
   * flat colour and no image field, which `composeStrokes` documents. Scanning
   * strokes would validate a path that can never draw.
   */
  it('leaves strokes alone, because an image stroke cannot be represented', () => {
    const parsed = parseOrThrow(
      `---\nid: i\n---\n\n## Visual Contract\n\n<Page>\n  <Rectangle name="r" strokes={[{ type: 'IMAGE', src: 'a.png' }]} />\n</Page>\n`,
    )
    const scene = toSceneGraph(parsed, { resolveAsset: () => 'h2' })
    const node = scene.graph.getNode(scene.addresses.sceneIdOf('r')!)!
    expect((node.strokes as unknown as Record<string, unknown>[])[0]?.imageHash).toBeUndefined()
  })
})
