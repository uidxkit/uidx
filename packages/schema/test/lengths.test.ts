import { describe, expect, it } from 'vitest'
import { applyPatches, parseOrThrow, type UidxPatch } from '@uidx/format'
import { SceneGraph } from '@open-pencil/scene-graph'
import {
  applyChanges,
  applyTokens,
  buildTokenIndex,
  diffDocuments,
  fromSceneChange,
  scenePropFor,
  toSceneGraph,
  TokenResolver,
} from '../src/index.js'

const source = (body: string, root = 20) =>
  `---\nid: units\n---\n## Visual Contract\n<Page rootFontSize={${root}}>${body}</Page>`

describe('relative lengths through the scene', () => {
  it('resolves dimensions, position, typography, spacing, corners and stroke geometry', () => {
    const doc = parseOrThrow(
      source(
        `<Frame name="box" x="2rem" y="1rem" width="20rem" height="10rem" paddingLeft="1rem" paddingTop="0.5rem" itemSpacing="0.25rem" cornerRadius="0.5rem" strokeWeight="0.1rem" dashPattern={['0.2rem', '2px']} strokes={[{ type: 'SOLID', color: { r: 0, g: 0, b: 0, a: 1 } }]}><Text name="label" characters="Hello" fontSize="1rem" lineHeight="1.5rem" letterSpacing="0.025rem" /></Frame>`,
      ),
    )
    const scene = toSceneGraph(doc)
    expect(scene.warnings).toEqual([])
    expect(scene.graph.getNode('box')).toMatchObject({
      x: 40,
      y: 20,
      width: 400,
      height: 200,
      paddingLeft: 20,
      paddingTop: 10,
      itemSpacing: 5,
      cornerRadius: 10,
      strokes: [{ weight: 2, dashPattern: [4, 2] }],
    })
    expect(scene.graph.getNode('box#label')).toMatchObject({
      fontSize: 20,
      lineHeight: 30,
      letterSpacing: 0.5,
    })
  })

  it('resolves nested effect distances', () => {
    expect(
      scenePropFor(
        'effects',
        [
          {
            type: 'DROP_SHADOW',
            offset: { x: '-0.5rem', y: '1rem' },
            radius: '2rem',
            spread: '4px',
          },
        ],
        { rootFontSize: 20 },
      ),
    ).toEqual({
      effects: [{ type: 'DROP_SHADOW', offset: { x: -10, y: 20 }, radius: 40, spread: 4 }],
    })
  })

  it('resolves relative tokens inside stroke dash patterns', () => {
    const doc = parseOrThrow(
      source(
        '<Rectangle name="box" dashPattern={["{space#dash}", "0.1rem"]} strokes={[{type: "SOLID", color: {r: 0, g: 0, b: 0, a: 1}}]} />',
      ),
    )
    const scene = toSceneGraph(doc, { resolveAlias: () => '0.5rem' })
    expect(scene.graph.getNode('box')!.strokes[0]!.dashPattern).toEqual([10, 2])
  })

  it('exports FLOAT lengths as pixels while preserving declared STRING values', () => {
    const doc = parseOrThrow(
      `---\nid: tokens\n---\n## Visual Contract\n<Tokens rootFontSize={20}><Collection name="sizes"><Variable name="card" type="FLOAT" value="2rem" /><Variable name="label" type="STRING" value="2rem" /></Collection></Tokens>`,
    )
    const { byAddress } = applyTokens(new SceneGraph(), doc)
    expect(Object.values(byAddress.get('sizes#card')!.valuesByMode)).toEqual([40])
    expect(Object.values(byAddress.get('sizes#label')!.valuesByMode)).toEqual(['2rem'])
  })

  it('keeps incremental edits equivalent to a full rebuild with a custom root size', () => {
    const doc = parseOrThrow(source('<Frame name="box" width="10rem" height="4rem" />'))
    const scene = toSceneGraph(doc)
    const next = parseOrThrow(
      applyPatches(doc.source, [
        { op: 'set', address: 'box', prop: 'width', value: '12rem' },
        {
          op: 'insert-node',
          parent: 'box',
          index: 0,
          node: { element: 'Rectangle', attrs: { name: 'child', width: '2rem', height: '1rem' } },
        },
      ]).source,
    )
    applyChanges(scene, diffDocuments(doc, next)!)
    expect(scene.graph.getNode('box')!.width).toBe(240)
    expect(scene.graph.getNode('box#child')!.width).toBe(40)
    const changedRoot = parseOrThrow(next.source.replace('rootFontSize={20}', 'rootFontSize={24}'))
    expect(diffDocuments(next, changedRoot)).toBeNull()
    expect(toSceneGraph(changedRoot).graph.getNode('box')!.width).toBe(288)
  })

  it('preserves rem in canvas move/resize writes and ignores an unchanged layout echo', () => {
    const doc = parseOrThrow(
      source('<Rectangle name="box" x="1rem" width="10rem" height="4rem" />'),
    )
    const scene = toSceneGraph(doc)
    const ctx = { doc, graph: scene.graph, addresses: scene.addresses }
    expect(fromSceneChange('box', { x: 20, width: 200 }, ctx)).toEqual([])
    scene.graph.updateNode('box', { x: 25, width: 250 })
    const patches = fromSceneChange('box', { x: 25, width: 250 }, ctx)
    expect(patches).toEqual([
      { op: 'set', address: 'box', prop: 'x', value: '1.25rem' },
      { op: 'set', address: 'box', prop: 'width', value: '12.5rem' },
    ])
    const reopened = parseOrThrow(applyPatches(doc.source, patches).source)
    expect(toSceneGraph(reopened).graph.getNode('box')).toMatchObject({ x: 25, width: 250 })
  })

  it('preserves fractional rem offsets on pinned children', () => {
    const doc = parseOrThrow(
      source(
        '<Frame name="box" width="10rem" height="10rem"><Rectangle name="child" width="1rem" height="1rem" constraints={{horizontal: "MAX", vertical: "MAX"}} right="0.125rem" bottom="0.125rem" /></Frame>',
      ),
    )
    const scene = toSceneGraph(doc)
    const ctx = { doc, graph: scene.graph, addresses: scene.addresses, pins: scene.pins }
    expect(scene.graph.getNode('box#child')).toMatchObject({ x: 177.5, y: 177.5 })
    expect(fromSceneChange('box#child', { x: 177.5, y: 177.5 }, ctx)).toEqual([])
    scene.graph.updateNode('box#child', { x: 176.25 })
    expect(fromSceneChange('box#child', { x: 176.25 }, ctx)).toEqual([
      { op: 'set', address: 'box#child', prop: 'right', value: '0.1875rem' },
    ])
  })

  it('keeps token-bound pins attached during parent reflow', () => {
    const doc = parseOrThrow(
      source(
        '<Frame name="box" width={200} height={200}><Rectangle name="child" width={20} height={20} constraints={{horizontal: "MAX", vertical: "MIN"}} right="{space#gap}" /></Frame>',
      ),
    )
    const scene = toSceneGraph(doc, { resolveAlias: () => '0.125rem' })
    const ctx = { doc, graph: scene.graph, addresses: scene.addresses, pins: scene.pins }
    expect(fromSceneChange('box#child', { x: 177.5 }, ctx)).toEqual([])
    scene.graph.updateNode('box', { width: 220 })
    scene.graph.updateNode('box#child', { x: 197.5 })
    expect(fromSceneChange('box#child', { x: 197.5 }, ctx)).toEqual([])
  })

  it('resolves aliases and modes as lengths on components and instances', () => {
    const tokens = parseOrThrow(
      `---\nid: spacing\n---\n## Visual Contract\n<Tokens><Collection name="space" modes={['compact', 'comfortable']}><Variable name="gap" type="FLOAT"><Mode name="compact" value="0.5rem" /><Mode name="comfortable" value="1rem" /></Variable><Variable name="alias" type="FLOAT"><Mode name="compact" value="{space#gap}" /><Mode name="comfortable" value="{space#gap}" /></Variable></Collection></Tokens>`,
    )
    const index = buildTokenIndex([tokens])
    const doc = parseOrThrow(
      source(
        '<Component name="Card" width="10rem" height="4rem" paddingLeft="{space#alias}"><Rectangle name="child" width="1rem" /></Component><Instance name="sample" component="Card" modes={{space: "comfortable"}} />',
      ),
    )
    const scene = toSceneGraph(doc, {
      resolveComponent: (name) => doc.tree.children.find((n) => n.name === name),
      tokens: { index, resolver: new TokenResolver(index) },
    })
    expect(scene.graph.getNode('Card')!.paddingLeft).toBe(10)
    expect(scene.graph.getNode('sample')!.paddingLeft).toBe(20)
    expect(scene.graph.getNode('sample')!.width).toBe(200)
    const patches: UidxPatch[] = [{ op: 'set', address: 'Card', prop: 'width', value: '12rem' }]
    const next = parseOrThrow(applyPatches(doc.source, patches).source)
    applyChanges(scene, diffDocuments(doc, next)!, {
      tokens: { index, resolver: new TokenResolver(index) },
    })
    expect(scene.graph.getNode('sample')!.width).toBe(240)
  })
})
