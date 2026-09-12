import { describe, expect, it } from 'vitest'
import { parseOrThrow, type UidxNode } from '@uidx/format'
import { fromSceneChange, toSceneGraph } from '../src/index.js'

/**
 * An `<Instance>` becoming a subtree (story F3).
 *
 * The three things worth testing are not "does it build" but: whether the
 * generated children are *unwritable* (D4's rule, which until now had nothing
 * to exercise it), whether an override reaches the right one, and whether a
 * document that names itself takes the renderer down.
 */
const page = (id: string, body: string) =>
  `---\nid: ${id}\n---\n\n## Visual Contract\n\n<Page>\n${body}\n</Page>\n`

const BUTTON = parseOrThrow(
  page(
    'button',
    `  <Component name="Button/Primary" status="stable">
    <Frame name="container" layoutMode="HORIZONTAL" itemSpacing={8}>
      <Text name="label" characters="Click" fontSize={14} />
    </Frame>
  </Component>`,
  ),
)

/** Every `<Component>` across a set of pages, by its global name (ADR 0004 §2). */
function componentIndex(...docs: readonly (typeof BUTTON)[]): Map<string, UidxNode> {
  const out = new Map<string, UidxNode>()
  for (const doc of docs) {
    if (doc.tree.element === 'Tokens') continue
    for (const node of doc.tree.children) {
      if (node.element === 'Component') out.set(node.name, node)
    }
  }
  return out
}

function build(source: string, ...defining: readonly (typeof BUTTON)[]) {
  const doc = parseOrThrow(source)
  const index = componentIndex(doc, ...defining)
  return { doc, ...toSceneGraph(doc, { resolveComponent: (name) => index.get(name) }) }
}

const USES = page('home', `  <Instance name="save" component="Button/Primary" x={10} y={20} />`)

describe('an instance becomes the component', () => {
  it("grows the component's children beneath it", () => {
    const { graph } = build(USES, BUTTON)
    expect(graph.getNode('save')!.type).toBe('INSTANCE')
    expect(graph.getNode('save#container')!.type).toBe('FRAME')
    expect(graph.getNode('save#container/label')!.type).toBe('TEXT')
    expect(graph.getNode('save#container/label')!.text).toBe('Click')
  })

  it("carries the definition's own properties, with the use's laid over", () => {
    const { graph } = build(USES, BUTTON)
    const instance = graph.getNode('save')!
    // Position is the use's; the hugging layout is the definition's.
    expect(instance).toMatchObject({ x: 10, y: 20, name: 'save' })
    expect(instance.layoutMode).toBe('VERTICAL')
    expect(graph.getNode('save#container')!.itemSpacing).toBe(8)
  })

  it('gives two uses of one component two independent subtrees', () => {
    const { graph } = build(
      page(
        'home',
        `  <Instance name="save" component="Button/Primary" />
  <Instance name="cancel" component="Button/Primary" />`,
      ),
      BUTTON,
    )
    expect(graph.getNode('save#container/label')).toBeDefined()
    expect(graph.getNode('cancel#container/label')).toBeDefined()
  })

  it('renders an instance whose component resolves to nothing, and says so', () => {
    // The renderer draws what it can; naming the missing component properly is
    // `uidx check`'s job, in the same band as an unresolved token alias.
    const { graph, warnings } = build(page('home', `  <Instance name="save" component="Nope" />`))
    expect(graph.getNode('save')!.type).toBe('INSTANCE')
    expect(warnings.join(' ')).toContain('"Nope"')
  })
})

describe("the generated children are not the author's to edit", () => {
  it('leaves them out of the bimap, which is what makes them unwritable', () => {
    const { addresses } = build(USES, BUTTON)
    // The instance itself is authored — it is a line in the file.
    expect(addresses.addressOf('save')).toBe('save')
    // Its children are not.
    expect(addresses.addressOf('save#container')).toBeUndefined()
    expect(addresses.addressOf('save#container/label')).toBeUndefined()
    expect(addresses.sceneIdOf('save#container')).toBeUndefined()
  })

  it('drops a scene edit to one of them rather than writing a patch', () => {
    // D4 wrote this rule where the events arrive and had nothing to exercise
    // it until instances existed. This is that test.
    const { doc, graph, addresses } = build(USES, BUTTON)
    graph.updateNode('save#container/label', { characters: 'Save' } as never)
    expect(
      fromSceneChange('save#container/label', { characters: 'Save' } as never, {
        doc,
        graph,
        addresses,
      }),
    ).toEqual([])
  })

  it('still writes an edit to the instance itself', () => {
    const { doc, graph, addresses } = build(USES, BUTTON)
    graph.updateNode('save', { x: 40 } as never)
    expect(fromSceneChange('save', { x: 40 } as never, { doc, graph, addresses })).toEqual([
      { op: 'set', address: 'save', prop: 'x', value: 40 },
    ])
  })
})

describe('overrides', () => {
  it('change the node the key names, and nothing else', () => {
    const { graph } = build(
      page(
        'home',
        `  <Instance name="save" component="Button/Primary"
    overrides={{ 'container/label': { characters: 'Save' } }} />
  <Instance name="other" component="Button/Primary" />`,
      ),
      BUTTON,
    )
    expect(graph.getNode('save#container/label')!.text).toBe('Save')
    // The definition is untouched, and so is every other use of it.
    expect(graph.getNode('other#container/label')!.text).toBe('Click')
  })

  it('leave the properties they do not mention alone', () => {
    const { graph } = build(
      page(
        'home',
        `  <Instance name="save" component="Button/Primary"
    overrides={{ 'container/label': { characters: 'Save' } }} />`,
      ),
      BUTTON,
    )
    expect(graph.getNode('save#container/label')!.fontSize).toBe(14)
  })

  it('reach a node one level down as readily as the root child', () => {
    const { graph } = build(
      page(
        'home',
        `  <Instance name="save" component="Button/Primary"
    overrides={{ container: { itemSpacing: 2 } }} />`,
      ),
      BUTTON,
    )
    expect(graph.getNode('save#container')!.itemSpacing).toBe(2)
  })

  it('resolve a token the same way an authored value does', () => {
    // An override goes through `scenePropFor`, so it is spelled exactly like
    // the property it replaces — nothing here knows what a token is.
    const doc = parseOrThrow(
      page(
        'home',
        `  <Instance name="save" component="Button/Primary"
    overrides={{ container: { itemSpacing: '{space#lg}' } }} />`,
      ),
    )
    const index = componentIndex(BUTTON)
    const built = toSceneGraph(doc, {
      resolveComponent: (name) => index.get(name),
      resolveAlias: (address) => (address === 'space#lg' ? 24 : undefined),
    })
    expect(built.graph.getNode('save#container')!.itemSpacing).toBe(24)
  })

  it('name a key that matches nothing without taking anything else down', () => {
    const { graph, warnings } = build(
      page(
        'home',
        `  <Instance name="save" component="Button/Primary"
    overrides={{ 'container/missing': { characters: 'Save' } }} />`,
      ),
      BUTTON,
    )
    expect(graph.getNode('save#container/label')!.text).toBe('Click')
    expect(warnings).toEqual([])
  })
})

describe('a component that holds an instance', () => {
  const CARD = parseOrThrow(
    page(
      'card',
      `  <Component name="Card" status="draft">
    <Frame name="root" layoutMode="VERTICAL">
      <Instance name="action" component="Button/Primary" />
    </Frame>
  </Component>`,
    ),
  )

  it('expands the nested instance too', () => {
    const { graph } = build(page('home', `  <Instance name="c" component="Card" />`), CARD, BUTTON)
    expect(graph.getNode('c#root/action')!.type).toBe('INSTANCE')
    expect(graph.getNode('c#root/action/container/label')!.text).toBe('Click')
  })

  it('leaves the whole generated subtree unwritable, however deep', () => {
    const { addresses } = build(
      page('home', `  <Instance name="c" component="Card" />`),
      CARD,
      BUTTON,
    )
    expect(addresses.addressOf('c#root/action')).toBeUndefined()
    expect(addresses.addressOf('c#root/action/container/label')).toBeUndefined()
  })

  it('refuses to recurse for ever on a document that names itself', () => {
    // `uidx check` reports this properly. The renderer's job is to survive it:
    // a file is briefly cyclic while somebody is typing, and a stack overflow
    // in the viewer is one keystroke away without this.
    const loop = parseOrThrow(
      page(
        'loop',
        `  <Component name="A" status="draft">
    <Frame name="root" layoutMode="VERTICAL">
      <Instance name="me" component="A" />
    </Frame>
  </Component>
  <Instance name="use" component="A" />`,
      ),
    )
    const index = componentIndex(loop)
    const built = toSceneGraph(loop, { resolveComponent: (name) => index.get(name) })
    expect(built.graph.getNode('use#root/me')!.type).toBe('INSTANCE')
    // One level in, then it stops rather than going round again.
    expect(built.graph.getNode('use#root/me/root')).toBeUndefined()
    expect(built.warnings.join(' ')).toContain('instance of itself')
  })
})
