import { describe, expect, it } from 'vitest'
import { buildVariantName, parseVariantName } from '@open-pencil/scene-graph/variant-name'
import { parseOrThrow, resolve, variantName, type UidxNode } from '@uidx/format'
import {
  applyChanges,
  arrangeVariants,
  diffDocuments,
  fromSceneChange,
  toSceneGraph,
  variantFor,
  VARIANT_GAP,
  VARIANT_PADDING,
} from '../src/index.js'

/**
 * A component's states, rendered side by side (story F8, ADR 0005).
 *
 * The claims worth testing here are the ones only this package can make: that
 * the derived spelling is the SDK's own, that the set/component split appears
 * in the scene and nowhere in the file, and that the arrangement is generated —
 * which is to say that nothing about a `<Variant>` can ever be written back.
 */
const page = (id: string, body: string) =>
  `---\nid: ${id}\n---\n\n## Visual Contract\n\n<Page>\n${body}\n</Page>\n`

const variant = (attrs: string, w: number, label = 'Click') =>
  `    <Variant ${attrs}>
      <Frame name="container" layoutMode="HORIZONTAL" primaryAxisSizingMode="AUTO"
        counterAxisSizingMode="AUTO">
        <Rectangle name="box" width={${w}} height={20} />
        <Text name="label" characters="${label}" />
      </Frame>
    </Variant>`

const BUTTON = parseOrThrow(
  page(
    'button',
    `  <Component name="Button" status="stable" variants={{ state: ['default', 'hover'] }}>
${variant(`state="default"`, 60)}
${variant(`state="hover"`, 100, 'Hover')}
  </Component>`,
  ),
)

function componentIndex(...docs: readonly (typeof BUTTON)[]): Map<string, UidxNode> {
  const out = new Map<string, UidxNode>()
  for (const doc of docs) {
    for (const node of doc.tree.children) if (node.element === 'Component') out.set(node.name, node)
  }
  return out
}

function build(source: string, ...defining: readonly (typeof BUTTON)[]) {
  const doc = parseOrThrow(source)
  const index = componentIndex(doc, ...defining)
  return { doc, ...toSceneGraph(doc, { resolveComponent: (name) => index.get(name) }) }
}

describe('the scene a component with states builds', () => {
  it('is a set of components, which is the engine mechanism and not the file', () => {
    const { graph } = build(BUTTON.source)
    expect(graph.getNode('Button')!.type).toBe('COMPONENT_SET')
    expect(graph.getNode('Button#state=default')!.type).toBe('COMPONENT')
    expect(graph.getNode('Button#state=hover')!.type).toBe('COMPONENT')
    // Nobody wrote a <ComponentSet>, and nothing in the file says one.
    expect(BUTTON.source).not.toContain('ComponentSet')
  })

  it('keeps every node inside a variant an ordinary authored node', () => {
    // The decisive argument for full trees: selection, the rail and every span
    // patch apply verbatim because these are source spans like any other.
    const { addresses, graph } = build(BUTTON.source)
    expect(addresses.sceneIdOf('Button#state=hover/container/label')).toBe(
      'Button#state=hover/container/label',
    )
    expect(graph.getNode('Button#state=hover/container/label')!.text).toBe('Hover')
  })

  it('lays them out side by side, first axis along the row', () => {
    const { graph } = build(BUTTON.source)
    const a = graph.getNode('Button#state=default')!
    const b = graph.getNode('Button#state=hover')!
    expect(a.y).toBe(b.y)
    expect(b.x).toBeGreaterThan(a.x)
    // Each hugs its own content, which is what makes the arrangement measurable.
    expect(b.width).toBeGreaterThan(a.width)
  })

  it('sizes the set around them', () => {
    const { graph } = build(BUTTON.source)
    const set = graph.getNode('Button')!
    const hover = graph.getNode('Button#state=hover')!
    expect(set.width).toBeGreaterThanOrEqual(hover.x + hover.width)
    expect(set.height).toBeGreaterThanOrEqual(hover.height)
  })

  it('stacks a second axis into rows', () => {
    const { graph } = build(
      page(
        'two',
        `  <Component name="B" status="draft" variants={{ state: ['default', 'hover'], size: ['md', 'sm'] }}>
${variant(`state="default" size="md"`, 60)}
${variant(`state="hover" size="md"`, 60)}
${variant(`state="default" size="sm"`, 40)}
  </Component>`,
      ),
    )
    const md = graph.getNode('B#state=default, size=md')!
    const hoverMd = graph.getNode('B#state=hover, size=md')!
    const sm = graph.getNode('B#state=default, size=sm')!
    expect(hoverMd.y).toBe(md.y)
    expect(sm.y).toBeGreaterThan(md.y)
    expect(sm.x).toBe(md.x)
  })
})

describe('the derived name', () => {
  it('is exactly the spelling the SDK builds', () => {
    // The drift test ADR 0005 §3 asks for. `@uidx/format` owns names and cannot
    // depend on the SDK, so this is the package that can see both.
    const coordinates: [string, string][] = [
      ['state', 'hover'],
      ['size', 'sm'],
    ]
    expect(variantName(new Map(coordinates))).toBe(
      buildVariantName(Object.fromEntries(coordinates)),
    )
  })

  it('is exactly the spelling the SDK reads back', () => {
    const name = variantName(
      new Map([
        ['state', 'hover'],
        ['size', 'sm'],
      ]),
    )
    expect(parseVariantName(name)).toEqual({ state: 'hover', size: 'sm' })
  })
})

describe('nothing about a variant is authored (D4)', () => {
  /**
   * Announces a change the way the engine does: the graph already holds the new
   * value and `changes` only names which fields moved. Writing the value into
   * the node first is what keeps these guards from passing vacuously — a
   * `fromSceneChange` for a field that did not actually change returns `[]`
   * whatever the predicates say.
   */
  const announce = (source: string, id: string, changes: Record<string, unknown>) => {
    const built = build(source)
    built.graph.updateNode(id, changes)
    return fromSceneChange(id, changes, {
      doc: built.doc,
      graph: built.graph,
      addresses: built.addresses,
    })
  }

  it('drops a change to a variant, even one the geometry rules would allow', () => {
    // Its position is `arrangeVariants` and its size is hugging its child, so
    // every number the scene holds for it was generated.
    expect(announce(BUTTON.source, 'Button#state=hover', { x: 999, y: 12 })).toEqual([])
    expect(announce(BUTTON.source, 'Button#state=hover', { opacity: 0.5 })).toEqual([])
  })

  it('still writes a change to an ordinary node inside one', () => {
    expect(announce(BUTTON.source, 'Button#state=hover/container/box', { width: 120 })).toEqual([
      { op: 'set', address: 'Button#state=hover/container/box', prop: 'width', value: 120 },
    ])
  })
})

describe('an instance picks a combination', () => {
  const uses = (props = '') => page('home', `  <Instance name="save" component="Button"${props} />`)

  it('renders the default when it says nothing', () => {
    const { graph } = build(uses(), BUTTON)
    expect(graph.getNode('save#container/label')!.text).toBe('Click')
  })

  it('renders the combination it asks for', () => {
    const { graph } = build(uses(` props={{ state: 'hover' }}`), BUTTON)
    expect(graph.getNode('save#container/label')!.text).toBe('Hover')
  })

  it('names the variant nowhere in the address it grows', () => {
    // ADR 0005 §3: an override key is `'container/label'`, never
    // `'state=hover/container/label'`, so switching state re-applies by path.
    const { graph } = build(uses(` props={{ state: 'hover' }}`), BUTTON)
    expect(graph.getNode('save#state=hover/container/label')).toBeUndefined()
  })

  it('re-applies an override across the switch, which is why the key omits it', () => {
    const overridden = ` overrides={{ 'container/label': { characters: 'Save' } }}`
    for (const state of ['default', 'hover']) {
      const { graph } = build(uses(` props={{ state: '${state}' }}${overridden}`), BUTTON)
      expect(graph.getNode('save#container/label')!.text).toBe('Save')
    }
  })

  it('falls back to the default for a value outside the domain', () => {
    const { graph } = build(uses(` props={{ state: 'nope' }}`), BUTTON)
    expect(graph.getNode('save#container/label')!.text).toBe('Click')
  })

  it('warns and draws nothing for a combination nobody designed', () => {
    // Sparseness is the point of declaring the domain, so a missing combination
    // is an ordinary state here; `uidx check` reports it at the use site.
    const sparse = parseOrThrow(
      page(
        'sparse',
        `  <Component name="B" status="draft" variants={{ state: ['default'], size: ['md', 'sm'] }}>
${variant(`state="default" size="md"`, 60)}
  </Component>`,
      ),
    )
    const { graph, warnings } = build(
      page('home', `  <Instance name="i" component="B" props={{ size: 'sm' }} />`),
      sparse,
    )
    expect(warnings.join(' ')).toContain('no variant for the combination')
    expect(graph.getNode('i#container')).toBeUndefined()
  })

  it('picks the variant for a node, or nothing for a component without states', () => {
    const button = resolve(BUTTON.tree, 'Button')!
    expect(variantFor(button, null)!.name).toBe('state=default')
    const plain = parseOrThrow(
      page('p', `  <Component name="P" status="draft"><Frame name="f" /></Component>`),
    )
    expect(variantFor(resolve(plain.tree, 'P')!, null)).toBeUndefined()
  })
})

describe('the arrangement itself', () => {
  const box = (name: string, coordinates: [string, string][], width: number, height: number) => ({
    name,
    coordinates: new Map(coordinates),
    width,
    height,
  })

  it('gives a column the width of its widest cell', () => {
    const axes = new Map([['state', ['a', 'b']]])
    const { placements, width } = arrangeVariants(axes, [
      box('a', [['state', 'a']], 100, 40),
      box('b', [['state', 'b']], 60, 40),
    ])
    expect(placements[0]).toEqual({ name: 'a', x: VARIANT_PADDING, y: VARIANT_PADDING })
    expect(placements[1]!.x).toBe(VARIANT_PADDING + 100 + VARIANT_GAP)
    expect(width).toBe(VARIANT_PADDING * 2 + 100 + VARIANT_GAP + 60)
  })

  it('places a variant whose coordinates it does not recognise, rather than dropping it', () => {
    // Unreachable through `parse`, but the renderer is handed mid-edit files,
    // and a variant that vanishes while its rail row stays is worse to look at.
    const { placements } = arrangeVariants(new Map([['state', ['a']]]), [
      box('a', [['state', 'a']], 50, 20),
      box('?', [['state', 'zzz']], 50, 20),
    ])
    expect(placements.map((p) => p.name)).toEqual(['a', '?'])
    expect(placements[1]!.x).toBeGreaterThan(placements[0]!.x)
  })

  it('is padding alone when there is nothing to arrange', () => {
    expect(arrangeVariants(new Map(), [])).toEqual({
      placements: [],
      width: VARIANT_PADDING * 2,
      height: VARIANT_PADDING * 2,
    })
  })
})

describe('the update path keeps the arrangement (F8)', () => {
  const wider = BUTTON.source.replace('width={100} height={20}', 'width={220} height={20}')

  it('re-arranges after an incremental change inside a variant', () => {
    // `computeAllLayouts` on the set alone leaves every variant at its default
    // 100x100 box, so the update path has to take the same per-variant route
    // the build path does. Without it a live edit resizes one variant and
    // leaves it overlapping its neighbour.
    const built = build(BUTTON.source)
    const next = parseOrThrow(wider)
    const changes = diffDocuments(built.doc, next)
    expect(changes).not.toBeNull()
    applyChanges(built, changes!)

    const hover = built.graph.getNode('Button#state=hover')!
    const set = built.graph.getNode('Button')!
    expect(hover.width).toBeGreaterThan(200)
    expect(set.width).toBeGreaterThanOrEqual(hover.x + hover.width)
  })

  it('agrees with a full rebuild, which is the point of sharing the pass', () => {
    const built = build(BUTTON.source)
    applyChanges(built, diffDocuments(built.doc, parseOrThrow(wider))!)
    const rebuilt = build(wider)
    for (const id of ['Button', 'Button#state=default', 'Button#state=hover']) {
      const a = built.graph.getNode(id)!
      const b = rebuilt.graph.getNode(id)!
      expect([a.x, a.y, a.width, a.height]).toEqual([b.x, b.y, b.width, b.height])
    }
  })

  it('carries the axes into the scene, where the export will want them', () => {
    const { graph } = build(BUTTON.source)
    expect(graph.getNode('Button')!.componentPropertyDefinitions).toEqual([
      {
        id: 'state',
        name: 'state',
        type: 'VARIANT',
        defaultValue: 'default',
        variantOptions: ['default', 'hover'],
      },
    ])
    expect(graph.getNode('Button#state=hover')!.variantPropSpecs).toEqual([
      { propDefId: 'state', value: 'hover' },
    ])
  })
})
