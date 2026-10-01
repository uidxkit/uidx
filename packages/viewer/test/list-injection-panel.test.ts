import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { parseOrThrow, resolve, type UidxDocument } from '@uidx/format'
import { modelIndex } from '@uidx/schema'
import InstancePropsSection from '../src/InstancePropsSection.vue'
import PreviewDataSection from '../src/PreviewDataSection.vue'
import PropertiesPane from '../src/PropertiesPane.vue'
import { pickPatches, slotCards } from '../src/slot-content'

/**
 * Injecting item components into a list from the instance inspector (ADR
 * 0017 §2): the slot reads as a card that says it repeats, its picker puts
 * the components that receive the row's item first, a choice that cannot
 * receive it is called out, and the injected content says where it is drawn.
 */
const page = (id: string, body: string, rest = '') =>
  parseOrThrow(`---\nid: ${id}\n---\n\n## Visual Contract\n\n<Page>\n${body}\n</Page>\n${rest}`)

const ROW = page(
  'row',
  `  <Component name="Row" status="draft"><Text name="name" characters="{item.name}" /></Component>`,
  `
## Contract

<Props>
  <Prop name="item" type="Person">One person.</Prop>
</Props>

## Models

<Model name="Person">
  One person.
  <Field name="id" type="string" key sample={['a', 'b', 'c', 'd']}>Id.</Field>
  <Field name="name" type="string" sample={['Ada', 'Grace', 'Linus', 'Margaret']}>Name.</Field>
</Model>
`,
)
const CARD = parseOrThrow(`---
id: card
---

A roomy card for one person, with their role under the name.

## Visual Contract

<Page>
  <Component name="Card" status="draft"><Text name="name" characters="{item.name}" /></Component>
</Page>

## Contract

<Props>
  <Prop name="item" type="Person">One person.</Prop>
</Props>
`)
const BADGE = page(
  'badge',
  `  <Component name="Badge" status="draft"><Text name="t" characters="New" /></Component>`,
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
const DOCS = [ROW, CARD, BADGE, LIST]
const models = modelIndex(DOCS)
const pages = new Map<string, UidxDocument>(DOCS.map((doc, i) => [`page-${i}`, doc]))
const components = new Map(
  DOCS.flatMap((doc) =>
    doc.tree.children.filter((c) => c.element === 'Component').map((c) => [c.name, c] as const),
  ),
)
const definition = components.get('List')!

function team(body: string) {
  return page('team', body)
}

function section(doc: UidxDocument, address: string, previewIndex = 0) {
  const instance = resolve(doc.tree, address)!
  const named = instance.attrs.component?.value as string
  return mount(InstancePropsSection, {
    props: {
      doc,
      instance,
      definition: components.get(named),
      components,
      models,
      pages,
      previewIndex,
      writable: true,
    },
  })
}

describe('the slot model', () => {
  it('reads a repeated slot: its list, model, sample count and default', () => {
    const doc = team(`  <Instance name="people" component="List" />`)
    const [card] = slotCards(resolve(doc.tree, 'people')!, definition, components, models, pages)
    expect(card!.repeat).toEqual({ list: 'items', model: 'Person', count: 4 })
    expect(card!.content).toEqual({ kind: 'default', label: 'Row', component: 'Row' })
    expect(card!.suggested.map((c) => [c.name, c.receives])).toEqual([
      ['Card', 'item'],
      ['Row', 'item'],
    ])
    expect(card!.others.map((c) => c.name)).toEqual(['Badge'])
    expect(card!.suggested[0]!.note).toBe(
      'A roomy card for one person, with their role under the name.',
    )
    expect(card!.warning).toBeNull()
  })

  it('warns when the injected component cannot receive the item', () => {
    const doc = team(`  <Instance name="people" component="List">
    <Slot name="item"><Instance name="badge" component="Badge" /></Slot>
  </Instance>`)
    const [card] = slotCards(resolve(doc.tree, 'people')!, definition, components, models, pages)
    expect(card!.warning).toBe('Badge has no Person property, so every row draws the same thing.')
  })

  it('empties a slot explicitly, and the default removes the fill', () => {
    const doc = team(`  <Instance name="people" component="List">
    <Slot name="item"><Instance name="card" component="Card" /></Slot>
  </Instance>`)
    const instance = resolve(doc.tree, 'people')!
    const [card] = slotCards(instance, definition, components, models, pages)
    expect(pickPatches(instance, card!, { kind: 'empty' })).toEqual([
      { op: 'remove-node', address: 'people#item' },
      {
        op: 'insert-node',
        parent: 'people',
        index: 0,
        node: { element: 'Slot', attrs: { name: 'item' }, children: [] },
      },
    ])
    expect(pickPatches(instance, card!, { kind: 'default' })).toEqual([
      { op: 'remove-node', address: 'people#item' },
    ])
  })
})

describe('the instance inspector', () => {
  it('shows the component card, the data it draws, and the slot as a repeating card', () => {
    const doc = team(`  <Instance name="people" component="List" />`)
    const wrapper = section(doc, 'people')
    expect(wrapper.find('.card-name').text()).toBe('List')
    const data = wrapper.find('[data-data="items"]')
    expect(data.attributes('data-source')).toBe('samples')
    expect(data.text()).toContain('4 sample rows')
    const slot = wrapper.find('[data-slot="item"]')
    expect(slot.find('.repeat-badge').text()).toBe('Repeats for each of items')
    expect(slot.find('.slot-label').text()).toBe('Row')
    expect(slot.find('.default-tag').exists()).toBe(true)
  })

  it('opens the model a data row is typed by', async () => {
    const doc = team(`  <Instance name="people" component="List" />`)
    const wrapper = section(doc, 'people')
    await wrapper.find('[data-data="items"] .type-chip').trigger('click')
    expect(wrapper.emitted('openModel')).toEqual([['Person']])
  })

  it('groups the picker: what receives the item, then the rest, then basics', async () => {
    const doc = team(`  <Instance name="people" component="List" />`)
    const wrapper = section(doc, 'people')
    await wrapper.find('[data-slot="item"] .slot-trigger').trigger('click')
    const headings = wrapper.findAll('.popup-heading').map((h) => h.text())
    expect(headings[0]).toContain('Receives a Person')
    expect(headings[1]).toContain('Other components')
    expect(headings[2]).toBe('Basic')
    await wrapper.find('[data-choice="Card"]').trigger('click')
    expect(wrapper.emitted('patches')![0]![0]).toMatchObject([
      {
        op: 'insert-node',
        parent: 'people',
        node: {
          element: 'Slot',
          attrs: { name: 'item' },
          children: [{ element: 'Instance', attrs: { name: 'card', component: 'Card' } }],
        },
      },
    ])
  })

  it('filters the picker as the designer types', async () => {
    const doc = team(`  <Instance name="people" component="List" />`)
    const wrapper = section(doc, 'people')
    await wrapper.find('[data-slot="item"] .slot-trigger').trigger('click')
    await wrapper.find('.slot-popup input').setValue('car')
    expect(wrapper.findAll('[data-choice]').map((c) => c.attributes('data-choice'))).toEqual([
      'Card',
      ':default',
    ])
  })

  it('says where injected content is drawn, and that each copy receives its own item', async () => {
    const doc = team(`  <Instance name="people" component="List">
    <Slot name="item"><Instance name="card" component="Card" /></Slot>
  </Instance>`)
    const wrapper = section(doc, 'people#item/card')
    const context = wrapper.find('[data-field="fill-context"]')
    expect(context.text()).toContain('Fills people › item')
    expect(context.text()).toContain('drawn for each of its items')
    const item = wrapper.find('[data-data="item"]')
    expect(item.attributes('data-source')).toBe('item')
    expect(item.text()).toContain('Each item of people')
    await context.find('.context-link').trigger('click')
    expect(wrapper.emitted('select')).toEqual([['people']])
  })

  it('previews a lone item component one sample at a time', async () => {
    const doc = team(`  <Instance name="solo" component="Card" />`)
    const wrapper = section(doc, 'solo', 1)
    const row = wrapper.find('[data-data="item"]')
    expect(row.find('.step-label').text()).toBe('Grace')
    await row.find('[aria-label="Next item"]').trigger('click')
    await row.find('[aria-label="Previous item"]').trigger('click')
    expect(wrapper.emitted('preview')).toEqual([[2], [0]])
  })

  it('offers to go to the component', async () => {
    const doc = team(`  <Instance name="people" component="List" />`)
    const wrapper = section(doc, 'people')
    await wrapper.find('[aria-label="Go to List"]').trigger('click')
    expect(wrapper.emitted('openComponent')).toEqual([['List']])
  })
})

describe('previewing an item component on its own page', () => {
  it('steps through the samples, wrapping around', async () => {
    const wrapper = mount(PreviewDataSection, {
      props: { component: components.get('Card')!, models, index: 3 },
    })
    expect(wrapper.find('.label').text()).toBe('Margaret')
    expect(wrapper.find('.count').text()).toBe('4/4')
    await wrapper.find('[aria-label="Next item"]').trigger('click')
    expect(wrapper.emitted('preview')).toEqual([[0]])
  })

  it('is absent for a component with no model to preview', () => {
    const wrapper = mount(PreviewDataSection, {
      props: { component: components.get('Badge')!, models, index: 0 },
    })
    expect(wrapper.find('.preview-data').exists()).toBe(false)
  })
})

describe('selecting the hole itself', () => {
  it('offers the slot card for an emptied fill, so it can be filled again', async () => {
    const doc = team(`  <Instance name="people" component="List">
    <Slot name="item" />
  </Instance>`)
    const wrapper = mount(PropertiesPane, {
      props: { doc, selection: ['people#item'], components, models, pages, writable: true },
    })
    const card = wrapper.find('[data-slot="item"]')
    expect(card.attributes('data-content')).toBe('empty')
    await card.find('.slot-trigger').trigger('click')
    await card.find('[data-choice="Card"]').trigger('click')
    expect(wrapper.emitted('patches')).toEqual([
      [
        [
          {
            op: 'insert-node',
            parent: 'people#item',
            index: 0,
            node: { element: 'Instance', attrs: { name: 'card', component: 'Card' } },
          },
        ],
      ],
    ])
  })
})
