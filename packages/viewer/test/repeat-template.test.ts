import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { parseOrThrow, resolve } from '@uidx/format'
import { modelIndex } from '@uidx/schema'
import RepeatSection from '../src/RepeatSection.vue'
import InstancePropsSection from '../src/InstancePropsSection.vue'

/**
 * Repeat, kept simple (ADR 0017 §2): a switch on any layer, then a model.
 * The layer is drawn once per item of the model; inside it, texts and
 * component properties are bound to the item's fields by picking them, the
 * way tokens are applied. Nothing is passed to a component until bound.
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
const at = (address: string, doc = TEAM) =>
  mount(RepeatSection, {
    props: { doc, node: resolve(doc.tree, address)!, components, models, writable: true },
    attachTo: document.body,
  })
const choose = async (wrapper: ReturnType<typeof at>, model: string) => {
  await wrapper.find('[role="switch"]').trigger('click')
  await wrapper.find(`.model-popup [data-model="${model}"]`).trigger('click')
}

describe('repeating a layer: a switch, then a model', () => {
  it('shows the model and how many items it holds for a repeated layer', () => {
    const row = at('Team#row')
    expect(row.find('[role="switch"]').attributes('aria-checked')).toBe('true')
    expect(row.find('[data-field="model"]').text()).toContain('Person')
    expect(row.find('[data-field="model"]').text()).toContain('3 items')
    row.unmount()
  })

  it('lists every model with its item count and fields when switched on', async () => {
    const footer = at('Team#footer')
    expect(footer.find('[role="switch"]').attributes('aria-checked')).toBe('false')
    await footer.find('[role="switch"]').trigger('click')
    const rows = footer.findAll('.model-popup [data-model]')
    expect(rows.map((row) => row.attributes('data-model'))).toEqual(['Person', 'Tag'])
    expect(rows[0]!.text()).toContain('id · name · tags')
    expect(rows[0]!.text()).toContain('3 items')
    footer.unmount()
  })

  it('repeats over the list of that model the component already has', async () => {
    const footer = at('Team#footer')
    await choose(footer, 'Person')
    expect(footer.emitted('patches')).toEqual([
      [[{ op: 'add', address: 'Team#footer', prop: 'repeat', value: '{items}' }]],
    ])
    footer.unmount()
  })

  it("inside a repeated layer, takes the item's own list of that model, and names the item after it", async () => {
    const extra = at('Team#row/extra')
    await choose(extra, 'Tag')
    expect(extra.emitted('patches')).toEqual([
      [
        [
          { op: 'add', address: 'Team#row/extra', prop: 'repeat', value: '{item.tags}' },
          { op: 'add', address: 'Team#row/extra', prop: 'as', value: 'tag' },
        ],
      ],
    ])
    extra.unmount()
  })

  it('adds a list of the model to the component when it has none, in the same edit', async () => {
    const BARE = parseOrThrow(`---
id: bare
---

## Visual Contract

<Page>
  <Component name="Bare" status="draft"><Frame name="cell" /></Component>
</Page>

## Contract

<Props>
  <Prop name="item" type="Person">One person.</Prop>
</Props>
`)
    const cell = at('Bare#cell', BARE)
    await choose(cell, 'Person')
    expect(cell.emitted('patches')).toEqual([
      [
        [
          {
            op: 'contract',
            kind: 'prop',
            name: 'people',
            declaration: {
              attrs: { type: 'Person[]' },
              description: 'The Person items to repeat.',
            },
          },
          { op: 'add', address: 'Bare#cell', prop: 'repeat', value: '{people}' },
          // `item` is the component's own prop, so the row's item is `person`.
          { op: 'add', address: 'Bare#cell', prop: 'as', value: 'person' },
        ],
      ],
    ])
    cell.unmount()
  })

  it('stops repeating when switched off', async () => {
    const row = at('Team#row')
    await row.find('[role="switch"]').trigger('click')
    expect(row.emitted('patches')).toEqual([
      [[{ op: 'remove', address: 'Team#row', prop: 'repeat' }]],
    ])
    row.unmount()
  })

  it('says, on a layer inside a repeated one, which it is part of', async () => {
    const title = at('Team#row/name')
    expect(title.find('[data-field="inside-repeat"]').text()).toBe(
      'Inside row, repeated for each Person.',
    )
    await title.find('[data-field="inside-repeat"] button').trigger('click')
    expect(title.emitted('select')).toEqual([['Team#row']])
    title.unmount()
  })
})

describe('binding a component inside a repeat, like a token', () => {
  const props = (address: string) => {
    const instance = resolve(TEAM.tree, address)!
    return mount(InstancePropsSection, {
      props: {
        doc: TEAM,
        instance,
        definition: components.get('Chip'),
        components,
        models,
        writable: true,
      },
      attachTo: document.body,
    })
  }

  it('leaves the prop unbound until the designer picks the item', async () => {
    const chip = props('Team#row/chip')
    const row = chip.find('[data-data="person"]')
    expect(row.attributes('data-source')).toBe('bind')
    expect(row.find('.bind').text()).toContain('Not bound')
    await row.find('.bind').trigger('click')
    expect(chip.findAll('.bind-popup [data-alias]').map((o) => o.attributes('data-alias'))).toEqual(
      ['item'],
    )
    await chip.find('.bind-popup [data-alias="item"]').trigger('click')
    expect(chip.emitted('patches')).toEqual([
      [[{ op: 'add', address: 'Team#row/chip', prop: 'props', value: { person: '{item}' } }]],
    ])
    chip.unmount()
  })
})

describe("binding a component's text property to a field of the item", () => {
  const PILL = parseOrThrow(`---
id: pill
---

## Visual Contract

<Page>
  <Component name="Pill" status="draft" props={{ label: { type: 'TEXT', default: 'Tag' } }}>
    <Text name="t" characters="{label}" />
  </Component>
  <Component name="Crew" status="draft">
    <Frame name="row" repeat="{items}">
      <Instance name="pill" component="Pill" />
      <Instance name="bound" component="Pill" props={{ label: '{item.name}' }} />
    </Frame>
  </Component>
</Page>

## Contract

<Props>
  <Prop name="items" type="Person[]">People.</Prop>
</Props>
`)
  const all = new Map([
    ...components,
    ['Pill', resolve(PILL.tree, 'Pill')!],
    ['Crew', resolve(PILL.tree, 'Crew')!],
  ])
  const pill = (address: string) =>
    mount(InstancePropsSection, {
      props: {
        doc: PILL,
        instance: resolve(PILL.tree, address)!,
        definition: all.get('Pill'),
        components: all,
        models,
        writable: true,
      },
      attachTo: document.body,
    })

  it('offers the text fields of the item from the row', async () => {
    const wrapper = pill('Crew#row/pill')
    const row = wrapper.find('[data-prop="label"]')
    await row.find('.bind-glyph').trigger('click')
    expect(
      wrapper.findAll('.bind-popup [data-alias]').map((option) => option.attributes('data-alias')),
    ).toEqual(['item.id', 'item.name'])
    await wrapper.find('.bind-popup [data-alias="item.name"]').trigger('click')
    expect(wrapper.emitted('patches')).toEqual([
      [[{ op: 'add', address: 'Crew#row/pill', prop: 'props', value: { label: '{item.name}' } }]],
    ])
    wrapper.unmount()
  })

  it('shows a bound text property as its binding', () => {
    const wrapper = pill('Crew#row/bound')
    expect(wrapper.find('[data-prop="label"] .bound-name').text()).toBe('item.name')
    expect(wrapper.find('[data-prop="label"] input.text').exists()).toBe(false)
    wrapper.unmount()
  })
})
