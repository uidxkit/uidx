import { describe, expect, it } from 'vitest'
import { parseOrThrow, type UidxDocument } from '@uidx/format'
import { modelIndex, toSceneGraph } from '../src/index.js'

/**
 * Injecting an item component into a list (ADR 0017 §2): a consumer fills
 * the list's repeated slot with a component of its own, and the canvas draws
 * that component once per item, each showing its own item — without the list
 * being touched. Before, only the first row took the fill (the echoes kept
 * the default), and the filled component received no item at all.
 */
const page = (id: string, body: string, rest = '') =>
  parseOrThrow(`---\nid: ${id}\n---\n\n## Visual Contract\n\n<Page>\n${body}\n</Page>\n${rest}`)

const ROW = page(
  'row',
  `  <Component name="Row" status="draft" layoutMode="HORIZONTAL">
    <Text name="name" characters="{item.name}" />
  </Component>`,
  `
## Contract

<Props>
  <Prop name="item" type="Person">One person.</Prop>
</Props>

## Models

<Model name="Person">
  One person.
  <Field name="id" type="string" key sample={['a', 'b', 'c']}>Id.</Field>
  <Field name="name" type="string" sample={['Ada', 'Grace', 'Linus']}>Name.</Field>
</Model>
`,
)
// Declared on its own page, naming a model another page holds.
const CARD = page(
  'card',
  `  <Component name="Card" status="draft" layoutMode="VERTICAL">
    <Text name="title" characters="{item.name}" fontSize={20} />
  </Component>`,
  `
## Contract

<Props>
  <Prop name="item" type="Person">One person.</Prop>
</Props>
`,
)
const LIST = page(
  'list',
  `  <Component name="List" status="draft" layoutMode="VERTICAL">
    <Slot name="item" repeat="{items}">
      <Instance name="row" component="Row" />
    </Slot>
  </Component>`,
  `
## Contract

<Props>
  <Prop name="items" type="Person[]">People.</Prop>
</Props>
`,
)
const TEAM = page(
  'team',
  `  <Instance name="plain" component="List" />
  <Instance name="cards" component="List">
    <Slot name="item">
      <Instance name="card" component="Card" />
    </Slot>
  </Instance>`,
)

function texts(doc: UidxDocument) {
  const docs = [ROW, CARD, LIST, TEAM]
  const components = new Map(
    docs.flatMap((d) =>
      d.tree.children.filter((c) => c.element === 'Component').map((c) => [c.name, c] as const),
    ),
  )
  const scene = toSceneGraph(doc, {
    resolveComponent: (name) => components.get(name),
    models: modelIndex(docs),
  })
  const out: [string, string, number][] = []
  for (const node of (
    scene.graph as unknown as {
      nodes: Map<string, { id: string; type: string; text?: string; fontSize?: number }>
    }
  ).nodes.values())
    if (node.type === 'TEXT') out.push([node.id, node.text ?? '', node.fontSize ?? 0])
  return { out, addresses: scene.addresses }
}

describe('a list filled with another item component', () => {
  it('draws the injected component once per item, each with its own item', () => {
    const { out } = texts(TEAM)
    const plain = out.filter(([id]) => id.startsWith('plain'))
    const cards = out.filter(([id]) => id.startsWith('cards'))
    expect(plain.map(([, text]) => text)).toEqual(['Ada', 'Grace', 'Linus'])
    expect(cards.map(([, text, size]) => [text, size])).toEqual([
      ['Ada', 20],
      ['Grace', 20],
      ['Linus', 20],
    ])
  })

  it('links only the first copy to the file; the rest are echoes', () => {
    const { addresses } = texts(TEAM)
    expect(addresses.sceneIdOf('cards#item/card')).toBe('cards#item/card')
    expect(addresses.addressOf('cards#item-2/card')).toBeUndefined()
  })
})
