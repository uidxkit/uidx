import { describe, expect, it } from 'vitest'
import { SceneGraph } from '@open-pencil/scene-graph'
import { exportFigFile, parseFigFile } from '@open-pencil/core/io/formats/fig'
import { parseOrThrow } from '@uidx/format'
import {
  applyTokens,
  resolveTokenValues,
  scenePropFor,
  toSceneGraph,
  tokenAddresses,
} from '../src/index.js'

const TOKENS = parseOrThrow(`---
id: core
---

## Visual Contract

<Tokens>
  <Collection name="palette">
    <Variable name="blue" type="COLOR" value={{ r: 0.1, g: 0.4, b: 0.9, a: 1 }} />
  </Collection>
  <Collection name="radius">
    <Variable name="md" type="FLOAT" value={8} />
  </Collection>
  <Collection name="semantic">
    <Variable name="brand" type="COLOR" value="{palette#blue}" />
  </Collection>
</Tokens>
`)

describe('applyTokens', () => {
  it('registers a collection per <Collection>', () => {
    const graph = new SceneGraph()
    applyTokens(graph, TOKENS)
    expect([...graph.variableCollections.values()].map((c) => c.name).sort()).toEqual([
      'palette',
      'radius',
      'semantic',
    ])
  })

  it('infers each variable type from its authored value', () => {
    const graph = new SceneGraph()
    const { byAddress } = applyTokens(graph, TOKENS)
    expect(byAddress.get('radius#md')!.type).toBe('FLOAT')
    expect(byAddress.get('palette#blue')!.type).toBe('COLOR')
  })

  it('binds an alias to the variable it names, and takes its type', () => {
    const graph = new SceneGraph()
    const { byAddress, unresolved } = applyTokens(graph, TOKENS)
    expect(unresolved).toEqual([])

    const brand = byAddress.get('semantic#brand')!
    const blue = byAddress.get('palette#blue')!
    // An alias has no type of its own — it takes its target's.
    expect(brand.type).toBe('COLOR')
    expect(Object.values(brand.valuesByMode)[0]).toEqual({ aliasId: blue.id })
  })

  it('resolves a forward reference, so declaration order does not matter', () => {
    const forward = parseOrThrow(`---
id: forward
---

## Visual Contract

<Tokens>
  <Collection name="semantic">
    <Variable name="brand" type="COLOR" value="{palette#blue}" />
  </Collection>
  <Collection name="palette">
    <Variable name="blue" type="COLOR" value={{ r: 0, g: 0, b: 1, a: 1 }} />
  </Collection>
</Tokens>
`)
    const graph = new SceneGraph()
    const { byAddress, unresolved } = applyTokens(graph, forward)
    expect(unresolved).toEqual([])
    expect(Object.values(byAddress.get('semantic#brand')!.valuesByMode)[0]).toEqual({
      aliasId: byAddress.get('palette#blue')!.id,
    })
  })

  it('reports an alias with no target rather than inventing one', () => {
    const dangling = parseOrThrow(`---
id: dangling
---

## Visual Contract

<Tokens>
  <Collection name="c">
    <Variable name="a" type="FLOAT" value="{c#missing}" />
  </Collection>
</Tokens>
`)
    expect(applyTokens(new SceneGraph(), dangling).unresolved).toEqual(['c#missing'])
  })

  it('refuses a page document, and toSceneGraph refuses a token one', () => {
    const page = parseOrThrow(`---
id: page
---

## Visual Contract

<Page>
  <Component name="C" status="draft">
    <Frame name="root" cornerRadius={4} />
  </Component>
</Page>
`)
    expect(() => applyTokens(new SceneGraph(), page)).toThrow(/expects a <Tokens> document/)
    expect(() => toSceneGraph(TOKENS)).toThrow(/not a scene/)
  })

  it('lists every variable address it declares', () => {
    expect(tokenAddresses(TOKENS)).toEqual(['palette#blue', 'radius#md', 'semantic#brand'])
  })

  /**
   * The point of building tokens on Figma's variable vocabulary rather than a
   * bespoke tree (ADR 0002). Spike S4 established that collections survive a
   * `.fig` round-trip; this checks that what `applyTokens` produces is the thing
   * that survives.
   */
  it('round-trips through .fig', async () => {
    const graph = new SceneGraph()
    applyTokens(graph, TOKENS)

    const bytes = await exportFigFile(graph)
    const back = await parseFigFile(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    )

    const collections = [...back.variableCollections.values()]
    expect(collections.map((c) => c.name).sort()).toEqual(['palette', 'radius', 'semantic'])

    const radius = collections.find((c) => c.name === 'radius')!
    expect(back.getVariablesForCollection(radius.id).map((v) => v.name)).toEqual(['md'])
  })
})

describe('resolving tokens at render time (G6)', () => {
  const values = () => resolveTokenValues([TOKENS])

  it('flattens an alias chain down to its literal', () => {
    const map = values()
    expect(map.get('radius#md')).toBe(8)
    // `semantic#brand` aliases `palette#blue`; a consumer gets the colour.
    expect(map.get('semantic#brand')).toEqual({ r: 0.1, g: 0.4, b: 0.9, a: 1 })
  })

  it('leaves a cycle unresolved rather than looping', () => {
    const looped = parseOrThrow(`---
id: looped
---

## Visual Contract

<Tokens>
  <Collection name="c">
    <Variable name="a" type="FLOAT" value="{c#b}" />
    <Variable name="b" type="FLOAT" value="{c#a}" />
    <Variable name="fine" type="FLOAT" value={2} />
  </Collection>
</Tokens>
`)
    const map = resolveTokenValues([looped])
    expect(map.has('c#a')).toBe(false)
    expect(map.has('c#b')).toBe(false)
    // A bad chain does not poison the rest of the file.
    expect(map.get('c#fine')).toBe(2)
  })

  it('substitutes a bound value into the scene node', () => {
    const page = parseOrThrow(`---
id: card
---

## Visual Contract

<Page>
  <Component name="Card" status="draft">
    <Frame name="root" cornerRadius="{radius#md}" width={10} height={10} />
  </Component>
</Page>
`)
    const map = values()
    const { graph, warnings } = toSceneGraph(page, { resolveAlias: (a) => map.get(a) })

    expect(graph.getNode('Card#root')!.cornerRadius).toBe(8)
    expect(warnings).toEqual([])
  })

  it('falls back to the engine default when a token is missing, and says so', () => {
    const page = parseOrThrow(`---
id: card
---

## Visual Contract

<Page>
  <Component name="Card" status="draft">
    <Frame name="root" cornerRadius="{radius#nope}" width={10} height={10} />
  </Component>
</Page>
`)
    const { graph, warnings } = toSceneGraph(page, { resolveAlias: () => undefined })

    // Drawing the literal string `"{radius#nope}"` would be worse than this.
    expect(graph.getNode('Card#root')!.cornerRadius).not.toBe('{radius#nope}')
    expect(warnings.join()).toMatch(/unresolved token "radius#nope"/)
  })

  it('resolves a color alias inside a fill paint', () => {
    const map = values()
    const warnings: string[] = []
    const fields = scenePropFor('fills', [{ type: 'SOLID', color: '{palette#blue}' }], {
      warnings,
      resolveAlias: (a) => map.get(a),
    })
    expect(warnings).toEqual([])
    expect(JSON.stringify(fields)).not.toContain('palette#blue')
    expect(JSON.stringify(fields)).toContain('0.4') // blue's g channel made it through
  })

  it('drops only the unresolvable paint, and says so', () => {
    const warnings: string[] = []
    const fields = scenePropFor(
      'fills',
      [
        { type: 'SOLID', color: '{palette#nope}' },
        { type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 } },
      ],
      { warnings, resolveAlias: () => undefined },
    )
    expect(warnings.join()).toMatch(/unresolved token "palette#nope"/)
    // The literal red paint still draws.
    expect(JSON.stringify(fields)).toContain('"r":1')
    expect(JSON.stringify(fields)).not.toContain('palette#nope')
  })

  it('resolves a stroke paint alias through the graph', () => {
    const page = parseOrThrow(`---
id: stroked
---

## Visual Contract

<Page>
  <Component name="Card" status="draft">
    <Frame name="root" width={10} height={10}
      strokes={[{ type: 'SOLID', color: "{palette#blue}" }]} strokeWeight={2} />
  </Component>
</Page>
`)
    const map = values()
    const { graph, warnings } = toSceneGraph(page, { resolveAlias: (a) => map.get(a) })
    expect(warnings).toEqual([])
    const strokes = graph.getNode('Card#root')!.strokes as { color: { g: number } }[]
    expect(strokes[0]!.color.g).toBeCloseTo(0.4)
  })

  // `overridesFor` resolves `strokes` twice on the way to a scene node: once
  // in the per-attr loop (the path `scenePropFor` also serves for a
  // single-prop panel write) and once more, right before `composeStrokes`,
  // whose result always wins. Without care, one bad stroke alias reports
  // twice — this pins it at exactly once, matching fills/effects.
  it('reports an unresolvable stroke alias exactly once', () => {
    const page = parseOrThrow(`---
id: stroked
---

## Visual Contract

<Page>
  <Component name="Card" status="draft">
    <Frame name="root" width={10} height={10}
      strokes={[{ type: 'SOLID', color: "{palette#nope}" }]} strokeWeight={2} />
  </Component>
</Page>
`)
    const { warnings } = toSceneGraph(page, { resolveAlias: () => undefined })
    expect(warnings.filter((w) => /unresolved token "palette#nope"/.test(w))).toHaveLength(1)
  })

  // The whole-attribute alias form (`strokes="{missing#tok}"`, as opposed to
  // a per-entry `color` alias inside the array) is only ever caught by the
  // attribute-level branch in the per-attr loop, not by the second
  // `composeStrokes` pass — so the loop's scratch-array suppression for
  // strokes must not swallow this warning too.
  it('reports an unresolvable whole-attribute stroke alias exactly once', () => {
    const page = parseOrThrow(`---
id: stroked
---

## Visual Contract

<Page>
  <Component name="Card" status="draft">
    <Frame name="root" width={10} height={10}
      strokes="{missing#tok}" strokeWeight={2} />
  </Component>
</Page>
`)
    const { warnings } = toSceneGraph(page, { resolveAlias: () => undefined })
    expect(warnings.filter((w) => /unresolved token "missing#tok"/.test(w))).toHaveLength(1)
  })

  it('resolves a color alias inside an effect', () => {
    const map = values()
    const warnings: string[] = []
    const fields = scenePropFor('effects', [{ type: 'DROP_SHADOW', color: '{palette#blue}' }], {
      warnings,
      resolveAlias: (a) => map.get(a),
    })
    expect(warnings).toEqual([])
    expect(JSON.stringify(fields)).not.toContain('palette#blue')
    expect(JSON.stringify(fields)).toContain('0.4') // blue's g channel made it through
  })
})
