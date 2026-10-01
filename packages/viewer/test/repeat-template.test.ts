import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { parseOrThrow, resolve } from '@uidx/format'
import { modelIndex } from '@uidx/schema'
import RepeatSection from '../src/RepeatSection.vue'
import { repeatView } from '../src/repeat-view'

/**
 * Repeat on any layer, as a template (ADR 0017 §2): a repeated frame is drawn
 * once per item; inside it texts bind to the item, a nested component
 * receives it, and a list field of the item repeats again — a nested repeat.
 */
const CHIP = parseOrThrow(`---
id: chip
---

## Visual Contract

<Page>
  <Component name="Chip" status="draft"><Text name="t" characters="{person.name}" /></Component>
</Page>

## Contract

<Props>
  <Prop name="person" type="Person">Who.</Prop>
</Props>

## Models

<Model name="Person">
  One person.
  <Field name="id" type="string" key sample={['a', 'b', 'c']}>Id.</Field>
  <Field name="name" type="string" sample={['Ada', 'Grace', 'Linus']}>Name.</Field>
  <Field name="tags" type="Tag[]">Labels.</Field>
</Model>

<Model name="Tag">
  A label.
  <Field name="id" type="string" key sample={['x', 'y']}>Id.</Field>
  <Field name="label" type="string" sample={['math', 'navy']}>Text.</Field>
</Model>
`)
const TEAM = parseOrThrow(`---
id: team
---

## Visual Contract

<Page>
  <Component name="Team" status="draft" layoutMode="VERTICAL">
    <Frame name="row" repeat="{items}" layoutMode="HORIZONTAL">
      <Text name="name" characters="{item.name}" />
      <Instance name="chip" component="Chip" />
      <Frame name="tags" repeat="{item.tags}" as="tag">
        <Text name="label" characters="{tag.label}" />
      </Frame>
      <Frame name="extra" />
    </Frame>
    <Frame name="footer" />
  </Component>
</Page>

## Contract

<Props>
  <Prop name="items" type="Person[]">People.</Prop>
</Props>
`)
const models = modelIndex([CHIP, TEAM])
const components = new Map([
  ['Chip', resolve(CHIP.tree, 'Chip')!],
  ['Team', resolve(TEAM.tree, 'Team')!],
])
const at = (address: string) =>
  mount(RepeatSection, {
    props: { doc: TEAM, node: resolve(TEAM.tree, address)!, components, models, writable: true },
  })

describe('a repeated layer is a template', () => {
  it('lists what in the template reads the item: texts, nested components, nested repeats', () => {
    const view = repeatView(TEAM, resolve(TEAM.tree, 'Team#row')!, components, models)!
    expect(view.own).toMatchObject({ list: 'items', as: 'item', model: 'Person', rows: 3 })
    expect(view.uses.map((use) => `${use.name}: ${use.detail}`)).toEqual([
      'name: characters ← item.name',
      'chip: Chip receives item as person',
      'tags: repeats over item.tags',
    ])
    expect(view.scope!.fields.map((field) => `${field.path}: ${field.type}`)).toEqual([
      'item.id: string',
      'item.name: string',
      'item.tags: Tag[]',
    ])
  })

  it('shows a layer inside the template which repeat it is part of, and what it can bind to', () => {
    const wrapper = at('Team#row/extra')
    expect(wrapper.find('[data-field="inside-repeat"]').text()).toContain(
      'Part of row, drawn for each item (Person) of items',
    )
    expect(wrapper.find('[role="radio"][aria-checked="true"]').text()).toBe('Once')
    expect(wrapper.find('[data-field="template"]').text()).toContain('From the item item')
    expect(wrapper.find('[data-field="template"]').text()).toContain(
      'To nest, repeat this layer over item.tags',
    )
  })

  it("offers the item's own lists first for a nested repeat, and chooses the nearest", async () => {
    const tags = at('Team#row/tags')
    const groups = tags.findAll('[data-field="list"] optgroup').map((g) => g.attributes('label'))
    expect(groups).toEqual(['From the item it is inside', 'Properties of Team'])
    expect(tags.find('[data-field="list"] optgroup option').text().trim()).toBe('item.tags · Tag[]')
    expect(tags.find('[data-field="inside-repeat"]').text()).toContain('Part of row')

    const extra = at('Team#row/extra')
    await extra.findAll('[role="radio"]')[1]!.trigger('click')
    expect(extra.emitted('patches')).toEqual([
      [
        [
          { op: 'add', address: 'Team#row/extra', prop: 'repeat', value: '{item.tags}' },
          // Named after the list, since `item` would hide the row's own item.
          { op: 'add', address: 'Team#row/extra', prop: 'as', value: 'tag' },
        ],
      ],
    ])
  })

  it("repeats a layer outside any repeat over the component's list", async () => {
    const footer = at('Team#footer')
    expect(footer.find('[data-field="inside-repeat"]').exists()).toBe(false)
    await footer.findAll('[role="radio"]')[1]!.trigger('click')
    expect(footer.emitted('patches')).toEqual([
      [[{ op: 'add', address: 'Team#footer', prop: 'repeat', value: '{items}' }]],
    ])
  })

  it('selects what reads the item from the template list', async () => {
    const row = at('Team#row')
    await row.findAll('[data-field="template"] .link')[1]!.trigger('click')
    expect(row.emitted('select')).toEqual([['Team#row/chip']])
  })

  it('creates a list when the component has none to repeat over', async () => {
    const BARE = parseOrThrow(`---
id: bare
---

## Visual Contract

<Page>
  <Component name="Bare" status="draft"><Frame name="cell" /></Component>
</Page>
`)
    const wrapper = mount(RepeatSection, {
      props: { doc: BARE, node: resolve(BARE.tree, 'Bare#cell')!, models, writable: true },
    })
    await wrapper.findAll('[role="radio"]')[1]!.trigger('click')
    expect(wrapper.find('[data-field="new-list"]').text()).toContain('New list property of Bare')
  })
})

it('names the item so it does not hide a prop of the component', async () => {
  const ROW = parseOrThrow(`---
id: prow
---

## Visual Contract

<Page>
  <Component name="PRow" status="draft"><Frame name="who" /></Component>
</Page>

## Contract

<Props>
  <Prop name="item" type="Person">The person.</Prop>
  <Prop name="people" type="Person[]">Others.</Prop>
</Props>
`)
  const wrapper = mount(RepeatSection, {
    props: { doc: ROW, node: resolve(ROW.tree, 'PRow#who')!, models, writable: true },
  })
  await wrapper.findAll('[role="radio"]')[1]!.trigger('click')
  expect(wrapper.emitted('patches')).toEqual([
    [
      [
        { op: 'add', address: 'PRow#who', prop: 'repeat', value: '{people}' },
        { op: 'add', address: 'PRow#who', prop: 'as', value: 'person' },
      ],
    ],
  ])
})
