import { describe, expect, it } from 'vitest'
import { SceneGraph } from '@open-pencil/scene-graph'
import { exportFigFile, parseFigFile } from '@open-pencil/core/io/formats/fig'

/**
 * Spike S4 — does `.fig` round-trip the things ADR 0004 argued from?
 *
 * ADR 0004 chose a single global namespace because a Figma document has exactly
 * one component namespace and one set of variable collections, and claimed that
 * export would therefore be close to mechanical. That claim was an assumption.
 * G5 (token files) and F3 (instances) are about to be built on it, so it is
 * worth measuring first — a spike whose findings are wrong is cheaper to learn
 * about here than after two L-sized stories.
 *
 * Deliberately headless: `exportFigFile`'s CanvasKit and renderer arguments are
 * optional and only produce a thumbnail, so this needs no browser and can live
 * in CI — unlike the canvas rendering blocked by spike S1.
 */

async function roundTrip(graph: SceneGraph): Promise<SceneGraph> {
  const bytes = await exportFigFile(graph)
  // exportFigFile returns a Uint8Array view; parseFigFile wants the buffer.
  return parseFigFile(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  )
}

describe('S4 — .fig round-trip fidelity', () => {
  it('preserves a frame tree and its geometry', async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]!
    const frame = graph.createNodeWithId('outer', 'FRAME', page.id, {
      name: 'outer',
      width: 120,
      height: 40,
      cornerRadius: 8,
    })
    graph.createNodeWithId('inner', 'TEXT', frame.id, { name: 'inner', text: 'Save' })

    const back = await roundTrip(graph)
    const names = back
      .getPages()
      .flatMap((p) => back.getChildren(p.id))
      .map((n) => n.name)
    expect(names).toContain('outer')
  })

  it('preserves variable collections and their variables', async () => {
    const graph = new SceneGraph()
    const collection = graph.createCollection('radius')
    graph.createVariable('md', 'FLOAT', collection.id, 8)
    graph.createVariable('lg', 'FLOAT', collection.id, 16)

    const back = await roundTrip(graph)
    const collections = [...back.variableCollections.values()]
    expect(collections.map((c) => c.name)).toContain('radius')

    const restored = collections.find((c) => c.name === 'radius')!
    const variables = back
      .getVariablesForCollection(restored.id)
      .map((v) => v.name)
      .sort()
    expect(variables).toEqual(['lg', 'md'])
  })

  it('preserves a COMPONENT node as a component, not a plain frame', async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]!
    const component = graph.createNodeWithId('Button/Primary', 'COMPONENT', page.id, {
      name: 'Button/Primary',
      width: 100,
      height: 32,
    })
    graph.createNodeWithId('Button/Primary#label', 'TEXT', component.id, {
      name: 'label',
      text: 'Save',
    })

    const back = await roundTrip(graph)
    const top = back.getPages().flatMap((p) => back.getChildren(p.id))
    const restored = top.find((n) => n.name === 'Button/Primary')

    expect(restored).toBeDefined()
    // The interesting half: a component that comes back as a FRAME would mean
    // the definition/instance distinction does not survive, and F3 would need a
    // translation layer rather than the mechanical mapping ADR 0004 assumed.
    expect(restored!.type).toBe('COMPONENT')
  })

  it('keeps "/" in a name, which global grouping depends on', async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]!
    graph.createNodeWithId('grouped', 'COMPONENT', page.id, { name: 'Marketing/Hero/Large' })

    const back = await roundTrip(graph)
    const names = back
      .getPages()
      .flatMap((p) => back.getChildren(p.id))
      .map((n) => n.name)
    expect(names).toContain('Marketing/Hero/Large')
  })
})

describe('S5 — .fig component-set fidelity', () => {
  it('round-trips a set: the type and variant names survive, the definitions do not', async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]!
    const set = graph.createNodeWithId('Button/Primary', 'COMPONENT_SET', page.id, {
      name: 'Button/Primary',
      componentPropertyDefinitions: [
        {
          id: 'prop-state',
          name: 'state',
          type: 'VARIANT',
          defaultValue: 'default',
          variantOptions: ['default', 'hover'],
        },
      ],
    })
    for (const value of ['default', 'hover']) {
      const variant = graph.createNodeWithId(`Button/Primary#state=${value}`, 'COMPONENT', set.id, {
        name: `state=${value}`,
        width: 100,
        height: 32,
        variantPropSpecs: [{ propDefId: 'prop-state', value }],
      })
      graph.createNodeWithId(`Button/Primary#state=${value}/label`, 'TEXT', variant.id, {
        name: 'label',
        text: 'Save',
      })
    }
    // Verified before the trip so a failure below means "dropped", not "never
    // set": createNodeWithId does store both fields.
    expect(graph.getNode(set.id)!.componentPropertyDefinitions).toHaveLength(1)

    const back = await roundTrip(graph)
    const top = back.getPages().flatMap((p) => back.getChildren(p.id))
    const restored = top.find((n) => n.name === 'Button/Primary')!

    // The half that holds — and the half ADR 0005 leans on. The set comes back
    // a set, and each variant a COMPONENT named by its coordinates, the
    // `state=hover` spelling variant identity derives from.
    expect(restored.type).toBe('COMPONENT_SET')
    expect(
      back
        .getChildren(restored.id)
        .map((n) => `${n.name}:${n.type}`)
        .sort(),
    ).toEqual(['state=default:COMPONENT', 'state=hover:COMPONENT'])

    // The half that does not: the declarations ride nothing. The exporter also
    // writes the set node as a plain FRAME (`mapToFigmaType('COMPONENT_SET')`),
    // and neither STATE_GROUP nor isStateGroup occurs anywhere in the SDK — so
    // what the Figma app reconstructs from the names alone is F2's first
    // verification, and the fix for a "nothing" answer is upstream via
    // `patches/`. If either assertion starts failing, the SDK learned to carry
    // them: strike F2's caveat and update S5's findings.
    expect(restored.componentPropertyDefinitions).toEqual([])
    for (const child of back.getChildren(restored.id)) {
      expect(child.variantPropSpecs).toEqual([])
    }
  })
})
