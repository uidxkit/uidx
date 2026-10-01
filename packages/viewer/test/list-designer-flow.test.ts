import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { parseOrThrow, resolve } from '@uidx/format'
import { modelIndex } from '@uidx/schema'
import ContractSection from '../src/ContractSection.vue'
import PropertiesPane from '../src/PropertiesPane.vue'

/**
 * Building a list and its item components from the panels (ADR 0017): a
 * model is a type a designer picks, a model's fields are what a text binds to,
 * and a slot drawn in the tree is declared where it is looked at.
 */
const ROW = parseOrThrow(`---
id: row
---

## Visual Contract

<Page>
  <Component name="Row" status="draft" layoutMode="HORIZONTAL">
    <Text name="name" characters="Name" />
  </Component>
</Page>

## Contract

<Props>
  <Prop name="item" type="Person">One person.</Prop>
</Props>

## Models

<Model name="Person">
  One person.
  <Field name="id" type="string" key sample={['a']}>Id.</Field>
  <Field name="name" type="string" sample={['Ada']}>Name.</Field>
</Model>
`)
const LIST = parseOrThrow(`---
id: list
---

## Visual Contract

<Page>
  <Component name="List" status="draft" layoutMode="VERTICAL">
    <Slot name="item" repeat="{items}" />
  </Component>
</Page>

## Contract

<Props>
  <Prop name="items" type="Person[]">People.</Prop>
</Props>
`)
const models = modelIndex([ROW, LIST])

describe('the list designer flow', () => {
  it('offers models as property types, one of them or a list', async () => {
    const tab = mount(ContractSection, {
      props: { doc: LIST, node: resolve(LIST.tree, 'List'), library: null, models, writable: true },
    })
    const select = tab.get('select[aria-label="Type to add"]')
    expect(select.findAll('option').map((o) => o.text())).toContain('list of Person')
    await tab.get('input[aria-label="Name to add"]').setValue('people')
    await select.setValue('Person[]')
    await tab.get('button[aria-label="Add declaration"]').trigger('click')
    const sent = tab.emitted('patches')![0]![0] as { declaration: { attrs: { type: string } } }[]
    expect(sent[0]!.declaration.attrs.type).toBe('Person[]')
  })

  it('binds a text to a model field from the link pill, `item.name`, not only a prop', async () => {
    const pane = mount(PropertiesPane, {
      attachTo: document.body,
      props: { doc: ROW, selection: ['Row#name'], writable: true, models },
    })
    await pane.get('.section-link [data-popup-trigger]').trigger('click')
    const row = pane
      .findAll('.assign-popup .popup-row')
      .find((r) => r.text().includes('item.name'))!
    await row.trigger('click')
    expect(pane.emitted('patches')!.at(-1)![0]).toEqual([
      { op: 'set', address: 'Row#name', prop: 'characters', value: '{item.name}' },
    ])
    pane.unmount()
  })

  it('declares a slot the tree draws but the contract lacks, from the slot', async () => {
    const tab = mount(ContractSection, {
      props: {
        doc: LIST,
        node: resolve(LIST.tree, 'List#item'),
        library: null,
        models,
        writable: true,
      },
    })
    await tab
      .findAll('button')
      .find((b) => b.text() === 'Declare slot')!
      .trigger('click')
    const sent = tab.emitted('patches')![0]![0] as { op: string; kind: string; name: string }[]
    expect(sent[0]).toMatchObject({ op: 'contract', kind: 'slot', name: 'item' })
  })
})
