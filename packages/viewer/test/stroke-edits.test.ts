import { describe, it, expect } from 'vitest'
import { applyPatches, parseOrThrow, resolve, type JsonValue } from '@uidx/format'
import { toSceneGraph } from '@uidx/schema'
import { strokeEdit } from '../src/stroke-edits'

const source = `---
id: stroke-edit
---
## Visual Contract
<Page><Vector name="line" width={100} height={1} strokeWeight={12} strokeAlign="CENTER"
 strokeStartCap="CIRCLE_FILLED" strokeEndCap="NONE"
 strokes={[{type: 'SOLID', color: '{colors#blue}'}]}
 vectorPaths={[{windingRule: 'NONZERO', data: 'M0 0L100 0'}]} /></Page>`
const resolveAlias = () => ({ r: 0, g: 0, b: 1, a: 1 })

describe('stroke property edits', () => {
  it('updates visible weight in previews and saves only strokeWeight, preserving paint aliases', () => {
    const doc = parseOrThrow(source)
    const node = resolve(doc.tree, 'line')!
    const edit = strokeEdit(node, 'strokeWeight', 6, resolveAlias)!
    expect(edit.fields.strokes?.[0]?.weight).toBe(6)
    expect(edit.patches).toEqual([{ op: 'set', address: 'line', prop: 'strokeWeight', value: 6 }])
    const saved = applyPatches(doc.source, edit.patches).source
    expect(saved).toContain("color: '{colors#blue}'")
    expect(saved).not.toContain('strokeTopWeight')
    const reloaded = toSceneGraph(parseOrThrow(saved), { resolveAlias }).graph.getNode('line')!
    expect(reloaded.strokes[0]?.weight).toBe(6)
    expect(reloaded.vectorNetwork?.vertices[0]?.strokeCap).toBe('CIRCLE_FILLED')
  })

  it('composes color, position, cap, join, and dashes into the actual rendered stroke', () => {
    const node = resolve(parseOrThrow(source).tree, 'line')!
    const cases: Array<[string, JsonValue, object]> = [
      ['strokeAlign', 'OUTSIDE', { align: 'OUTSIDE' }],
      ['strokeCap', 'SQUARE', { cap: 'SQUARE' }],
      ['strokeJoin', 'BEVEL', { join: 'BEVEL' }],
      ['dashPattern', [12, 8], { dashPattern: [12, 8] }],
      [
        'strokes',
        [{ type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 }, opacity: 0.5 }],
        { color: { r: 1, g: 0, b: 0, a: 1 }, opacity: 0.5 },
      ],
    ]
    for (const [prop, value, expected] of cases) {
      const edit = strokeEdit(node, prop, value, resolveAlias)!
      expect(edit.fields.strokes?.[0]).toMatchObject({ weight: 12, ...expected })
      expect(edit.patches).toHaveLength(1)
      expect(edit.patches[0]).toMatchObject({ prop, value })
    }
  })

  it('changes one endpoint without rewriting the path or adding the other cap', () => {
    const node = resolve(parseOrThrow(source).tree, 'line')!
    const edit = strokeEdit(node, 'strokeEndCap', 'ARROW_LINES', resolveAlias)!
    expect(edit.fields.vectorNetwork?.vertices.map((v) => v.strokeCap)).toEqual([
      'CIRCLE_FILLED',
      'ARROW_LINES',
    ])
    expect(edit.patches).toEqual([
      { op: 'set', address: 'line', prop: 'strokeEndCap', value: 'ARROW_LINES' },
    ])
  })
})
