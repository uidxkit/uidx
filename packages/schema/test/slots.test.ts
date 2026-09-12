import { describe, expect, it } from 'vitest'
import { parseOrThrow, type UidxNode } from '@uidx/format'
import { fromSceneChange, toSceneGraph } from '../src/index.js'

/**
 * A slot rendering, and — the part with teeth — a fill *linking* (story F5).
 *
 * The three claims that are new here, and that nothing before F5 could have
 * exercised: a fill replaces the default rather than merging with it; the
 * bimap's two maps stop being mirror images (ADR 0007 §3); and content under
 * an instance becomes writable for the first time, while the clones beside it
 * stay unwritable exactly as D4 requires.
 */
const page = (id: string, body: string) =>
  `---\nid: ${id}\n---\n\n## Visual Contract\n\n<Page>\n${body}\n</Page>\n`

const CARD = parseOrThrow(
  page(
    'card',
    `  <Component name="Card" status="stable">
    <Frame name="container" layoutMode="VERTICAL" itemSpacing={12}>
      <Text name="title" characters="Title" />
      <Slot name="body" layoutMode="VERTICAL" itemSpacing={8}>
        <Text name="placeholder" characters="Body goes here" />
      </Slot>
    </Frame>
  </Component>`,
  ),
)

function componentIndex(...docs: readonly (typeof CARD)[]): Map<string, UidxNode> {
  const out = new Map<string, UidxNode>()
  for (const doc of docs) {
    for (const node of doc.tree.children) if (node.element === 'Component') out.set(node.name, node)
  }
  return out
}

function build(source: string, ...defining: readonly (typeof CARD)[]) {
  const doc = parseOrThrow(source)
  const index = componentIndex(doc, ...defining)
  return { doc, ...toSceneGraph(doc, { resolveComponent: (name) => index.get(name) }) }
}

/** ADR 0007 §2's three states, one page each. */
const UNFILLED = page('home', `  <Instance name="card-1" component="Card" />`)
const EMPTY = page(
  'home',
  `  <Instance name="card-1" component="Card">\n    <Slot name="body" />\n  </Instance>`,
)
const FILLED = page(
  'home',
  `  <Instance name="card-1" component="Card">
    <Slot name="body">
      <Text name="figure" characters="$42,180" fontSize={32} />
      <Text name="delta" characters="+12% MoM" />
    </Slot>
  </Instance>`,
)

describe('the three states a consuming page can be in', () => {
  it('renders the default content when nothing fills the slot', () => {
    const { graph } = build(UNFILLED, CARD)
    expect(graph.getNode('card-1#container/body/placeholder')!.text).toBe('Body goes here')
  })

  it('renders nothing for a self-closing fill — explicitly empty', () => {
    const { graph } = build(EMPTY, CARD)
    expect(graph.getNode('card-1#container/body')).toBeDefined()
    expect(graph.getNode('card-1#container/body/placeholder')).toBeUndefined()
  })

  it('renders the fill and not the default — replacement, never a merge', () => {
    const { graph } = build(FILLED, CARD)
    expect(graph.getNode('card-1#container/body/figure')!.text).toBe('$42,180')
    expect(graph.getNode('card-1#container/body/delta')!.text).toBe('+12% MoM')
    expect(graph.getNode('card-1#container/body/placeholder')).toBeUndefined()
  })

  it("keeps the slot's own layout, which is the definition's to decide", () => {
    const { graph } = build(FILLED, CARD)
    expect(graph.getNode('card-1#container/body')).toMatchObject({ itemSpacing: 8 })
  })
})

describe('the address and the scene id stop being the same string', () => {
  it('gives the fill an address that follows the file (ADR 0007 §3)', () => {
    const { addresses } = build(FILLED, CARD)
    expect(addresses.sceneIdOf('card-1#body')).toBe('card-1#container/body')
    expect(addresses.sceneIdOf('card-1#body/figure')).toBe('card-1#container/body/figure')
    expect(addresses.addressOf('card-1#container/body/figure')).toBe('card-1#body/figure')
  })

  it('leaves every generated clone unwritable, exactly as D4 requires', () => {
    const { addresses } = build(FILLED, CARD)
    // The definition's own children: absent from the bimap, so nothing may
    // write to them — and now they sit *beside* fill nodes that may be written.
    expect(addresses.addressOf('card-1#container')).toBeUndefined()
    expect(addresses.addressOf('card-1#container/title')).toBeUndefined()
    expect(addresses.addressOf('card-1#container/body/figure')).toBe('card-1#body/figure')
  })

  it('turns an edit to a fill into a patch against the consuming page', () => {
    const { doc, graph, addresses } = build(FILLED, CARD)
    graph.updateNode('card-1#container/body/figure', { fontSize: 40 })
    expect(
      fromSceneChange(
        'card-1#container/body/figure',
        { fontSize: 40 },
        { doc, graph, addresses, authored: new Set(['fontSize']) },
      ),
    ).toEqual([{ op: 'set', address: 'card-1#body/figure', prop: 'fontSize', value: 40 }])
  })

  it('refuses an edit to a clone beside it, in the same graph', () => {
    const { doc, graph, addresses } = build(FILLED, CARD)
    graph.updateNode('card-1#container/title', { fontSize: 40 })
    expect(
      fromSceneChange(
        'card-1#container/title',
        { fontSize: 40 },
        { doc, graph, addresses, authored: new Set(['fontSize']) },
      ),
    ).toEqual([])
  })

  it('drops the whole fill when its address is unlinked', () => {
    const { addresses } = build(FILLED, CARD)
    addresses.unlink('card-1#body')
    expect(addresses.sceneIdOf('card-1#body')).toBeUndefined()
    expect(addresses.sceneIdOf('card-1#body/figure')).toBeUndefined()
    expect(addresses.addressOf('card-1#container/body/figure')).toBeUndefined()
  })
})

describe('a fill resolves in the consuming page, not the definition', () => {
  const THEMED = parseOrThrow(
    page(
      'themed',
      `  <Component name="Panel" status="stable" props={{ label: { type: 'TEXT', default: 'Panel' } }}>
    <Frame name="root" layoutMode="VERTICAL">
      <Text name="head" characters="{label}" />
      <Slot name="body" />
    </Frame>
  </Component>`,
    ),
  )

  it("does not read the component's properties from inside a fill", () => {
    const { graph, warnings } = build(
      page(
        'home',
        `  <Instance name="p1" component="Panel" props={{ label: 'Revenue' }}>
    <Slot name="body"><Text name="t" characters="{label}" /></Slot>
  </Instance>`,
      ),
      THEMED,
    )
    // The definition's own text sees the property; the fill's does not — a
    // bare `{label}` in the consuming page is a mistake, and is reported.
    expect(graph.getNode('p1#root/head')!.text).toBe('Revenue')
    expect(warnings.join()).toMatch(/label/)
  })
})

describe('slots and the shapes around them', () => {
  const OUTER = parseOrThrow(
    page(
      'outer',
      `  <Component name="Outer" status="stable">
    <Frame name="wrap" layoutMode="VERTICAL"><Slot name="hole" /></Frame>
  </Component>`,
    ),
  )

  it('expands an instance that sits inside a fill', () => {
    const { graph } = build(
      page(
        'home',
        `  <Instance name="o1" component="Outer">
    <Slot name="hole"><Instance name="inner" component="Card" /></Slot>
  </Instance>`,
      ),
      OUTER,
      CARD,
    )
    expect(graph.getNode('o1#wrap/hole/inner/container/title')!.text).toBe('Title')
  })

  it('terminates on a cycle that runs through a fill', () => {
    const SELF = parseOrThrow(
      page(
        'self',
        `  <Component name="Loop" status="draft">
    <Frame name="w" layoutMode="VERTICAL"><Slot name="hole" /></Frame>
  </Component>`,
      ),
    )
    const { warnings } = build(
      page(
        'home',
        `  <Instance name="l1" component="Loop">
    <Slot name="hole"><Instance name="again" component="Loop" /></Slot>
  </Instance>`,
      ),
      SELF,
    )
    // No stack overflow, and the chain is named.
    expect(warnings.join()).toMatch(/instance of itself/)
  })

  it('picks the chosen variant’s slot, and fills it by name', () => {
    const SIZED = parseOrThrow(
      page(
        'sized',
        `  <Component name="Sized" status="stable" variants={{ size: ['sm', 'lg'] }}>
    <Variant size="sm"><Frame name="r" layoutMode="VERTICAL"><Slot name="body" /></Frame></Variant>
    <Variant size="lg"><Frame name="r" layoutMode="VERTICAL" itemSpacing={20}><Slot name="body" /></Frame></Variant>
  </Component>`,
      ),
    )
    const { graph } = build(
      page(
        'home',
        `  <Instance name="s1" component="Sized" props={{ size: 'lg' }}>
    <Slot name="body"><Text name="t" characters="in the large one" /></Slot>
  </Instance>`,
      ),
      SIZED,
    )
    expect(graph.getNode('s1#r/body/t')!.text).toBe('in the large one')
    expect(graph.getNode('s1#r')).toMatchObject({ itemSpacing: 20 })
  })
})
