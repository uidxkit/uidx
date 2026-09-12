import { describe, expect, it } from 'vitest'
import { applyPatches, parseOrThrow } from '@uidx/format'
import { resolveNodeTextDirection } from '@open-pencil/core/text'
import { applyChanges, diffDocuments, fromSceneChange, toSceneGraph } from '../src/index.js'

const source = `---
id: direction
---
## Visual Contract
<Page><Text name="label" characters="Hello שלום 123" fontFamily="Noto Sans Hebrew" /></Page>`

describe('text direction', () => {
  it('detects direction by default and honors explicit overrides', () => {
    for (const [text, direction, expected] of [
      ['שלום עולם', undefined, 'RTL'],
      ['مرحبا بالعالم', 'AUTO', 'RTL'],
      ['Hello שלום 123', 'AUTO', 'LTR'],
      ['Hello שלום 123', 'RTL', 'RTL'],
      ['שלום Hello 123', 'LTR', 'LTR'],
    ] as const) {
      const doc = parseOrThrow(
        source
          .replace('Hello שלום 123', text)
          .replace(
            'name="label"',
            `name="label"${direction ? ` textDirection="${direction}"` : ''}`,
          ),
      )
      const node = toSceneGraph(doc).graph.getNode('label')!
      expect(node.textDirection).toBe(direction ?? 'AUTO')
      expect(resolveNodeTextDirection(node)).toBe(expected)
    }
  })

  it('saves a direction edit without rewriting text or the font and restores Auto on undo', () => {
    const doc = parseOrThrow(source)
    const scene = toSceneGraph(doc)
    scene.graph.updateNode('label', { textDirection: 'RTL' })
    const patches = fromSceneChange('label', { textDirection: 'RTL' }, { doc, ...scene })
    expect(patches).toEqual([{ op: 'add', address: 'label', prop: 'textDirection', value: 'RTL' }])
    const saved = applyPatches(source, patches).source
    const reloaded = toSceneGraph(parseOrThrow(saved)).graph.getNode('label')!
    expect(reloaded.textDirection).toBe('RTL')
    expect(reloaded.text).toBe('Hello שלום 123')
    expect(reloaded.fontFamily).toBe('Noto Sans Hebrew')
    const changes = diffDocuments(parseOrThrow(saved), doc)!
    const current = toSceneGraph(parseOrThrow(saved))
    applyChanges(current, changes)
    expect(current.graph.getNode('label')!.textDirection).toBe('AUTO')
    expect(resolveNodeTextDirection(current.graph.getNode('label')!)).toBe('LTR')
  })

  it('updates direction on an existing scene node without losing its identity', () => {
    const before = parseOrThrow(source)
    const scene = toSceneGraph(before)
    const node = scene.graph.getNode('label')!
    const after = parseOrThrow(source.replace('name="label"', 'name="label" textDirection="RTL"'))
    applyChanges(scene, diffDocuments(before, after)!)
    expect(scene.graph.getNode('label')).toBe(node)
    expect(resolveNodeTextDirection(node)).toBe('RTL')
  })
})
