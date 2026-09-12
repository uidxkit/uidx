import { describe, expect, it } from 'vitest'
import { parseOrThrow } from '@uidx/format'

import { fromSceneChange } from '../src/from-scene'
import { toSceneGraph } from '../src/to-scene'

/**
 * ADR 0006 §8 made `vectorPaths` two-way. These pin the two properties the
 * decision rests on: the round trip settles rather than drifting, and nothing
 * but a vector gesture can originate a geometry write.
 */
const doc = (path: string) =>
  parseOrThrow(`---
id: vp
---

## Visual Contract

<Page>
  <Vector name="mark" width={24} height={24}
    vectorPaths={[{ windingRule: 'NONZERO', data: '${path}' }]} />
</Page>
`)

/** What the write-back path would emit for this node, vouched or not. */
function writes(path: string, options: { vouched: boolean; changes?: object } = { vouched: true }) {
  const parsed = doc(path)
  const scene = toSceneGraph(parsed)
  const id = scene.addresses.sceneIdOf('mark')!
  return fromSceneChange(id, (options.changes ?? { vectorNetwork: {} }) as never, {
    doc: parsed,
    graph: scene.graph,
    addresses: scene.addresses,
    ...(options.vouched ? { authored: new Set(['vectorPaths']), authoredFor: id } : {}),
  })
}

const emitted = (path: string) => {
  const patch = writes(path)[0] as unknown as { value?: { data: string }[] } | undefined
  return patch?.value?.[0]?.data
}

describe('a vouched geometry write', () => {
  it('reaches the file', () => {
    expect(writes('M0 0 L10 0 L10 10 Z')).toHaveLength(1)
  })

  /**
   * The property the decision rests on: one normalising pass, then the text is
   * a fixed point. Drift here would mean a file that rewrites itself on every
   * edit, which is what the old one-way note was afraid of.
   */
  it('settles after one pass rather than drifting', () => {
    for (const path of [
      'M0 0 L10 0 L10 10 Z',
      'M0 0 C 5 0, 10 5, 10 10',
      'M0 0 Q 5 10, 10 0',
      'M0 0 C 2 0, 4 2, 4 4 S 8 8, 10 10',
      'M0 0 L10 0 A 5 5 0 0 1 10 10 Z',
      'M0 0 L5 0 Z M10 10 L15 10 Z',
    ]) {
      const once = emitted(path)!
      expect(once, path).toBeDefined()
      // The fixed point, stated as strongly as it can be: a file already
      // holding the emitted spelling has *nothing to write*. `fromSceneChange`
      // compares before it emits, so no patch means the two agree exactly.
      expect(writes(once), `${path} -> ${once}`).toEqual([])
    }
  })

  it('has nothing to say about a path already spelled the way it emits', () => {
    // Which is what a pen produces from the first stroke: lines and cubics.
    expect(writes('M0 0L10 0C15 0 20 5 20 10L0 10L0 0Z')).toEqual([])
  })

  it('converts an arc on the way in — the one lossy step, and it is inbound', () => {
    const out = emitted('M0 0 L10 0 A 5 5 0 0 1 10 10 Z')!
    expect(out).not.toContain('A')
    expect(out).toContain('C')
  })

  it('reports the winding rule a closed path resolved to', () => {
    const patch = writes('M0 0 L10 0 L10 10 Z')[0] as unknown as {
      value: { windingRule: string }[]
    }
    expect(patch.value[0]!.windingRule).toBe('NONZERO')
  })
})

/**
 * Without this gate, any edit to a vector node — a fill, a rename, a nudge —
 * would carry the path's re-spelling with it, and a diff would show geometry
 * churn from a change that never touched the geometry.
 */
describe('an unvouched change', () => {
  it('never writes geometry, even when the network is in the changes', () => {
    expect(writes('M0 0 L10 0 L10 10 Z', { vouched: false })).toEqual([])
  })

  it('still lets other props through on the same node', () => {
    const out = writes('M0 0 L10 0 L10 10 Z', { vouched: false, changes: { opacity: 0.5 } })
    expect(out.map((p) => (p as { prop: string }).prop)).toEqual(['opacity'])
  })

  it('does not smuggle geometry in beside a vouched neighbour', () => {
    // Vouching for `opacity` must not vouch for the path.
    const parsed = doc('M0 0 L10 0 L10 10 Z')
    const scene = toSceneGraph(parsed)
    const id = scene.addresses.sceneIdOf('mark')!
    const out = fromSceneChange(id, { opacity: 0.5, vectorNetwork: {} } as never, {
      doc: parsed,
      graph: scene.graph,
      addresses: scene.addresses,
      authored: new Set(['opacity']),
      authoredFor: id,
    })
    expect(out.map((p) => (p as { prop: string }).prop)).toEqual(['opacity'])
  })
})

describe('compound icon geometry', () => {
  it('keeps closed regions, independent fill rules, and open details after an edit and reload', () => {
    const parsed = parseOrThrow(`---
id: compound
---
## Visual Contract
<Page><Vector name="icon" vectorPaths={[
  { windingRule: 'NONZERO', data: 'M0 0L10 0L10 10Z' },
  { windingRule: 'EVENODD', data: 'M20 0L30 0L30 10Z' },
  { windingRule: 'NONZERO', data: 'M2 5L8 5' }
]} /></Page>`)
    const scene = toSceneGraph(parsed)
    const node = scene.graph.getNode('icon')!
    expect(node.vectorNetwork!.segments).toHaveLength(7)
    const patches = fromSceneChange(
      'icon',
      { vectorNetwork: node.vectorNetwork },
      {
        doc: parsed,
        graph: scene.graph,
        addresses: scene.addresses,
        authored: new Set(['vectorPaths']),
        authoredFor: 'icon',
      },
    )
    const patch = patches[0]
    if (!patch || !('value' in patch)) throw new Error('Expected a vectorPaths write')
    const paths = patch.value as Array<{ data: string; windingRule: string }>
    expect(paths).toHaveLength(3)
    expect(paths.map((p) => p.windingRule)).toEqual(['NONZERO', 'EVENODD', 'NONZERO'])
    expect(paths[2]!.data).toContain('M2 5L8 5')
  })
})
