import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { parseOrThrow } from '@uidx/format'
import ModelsPane from '../src/ModelsPane.vue'
import { modelsViewModel, pagesForModels, undeclaredModels } from '../src/model-edits'

/**
 * The Models face edits a model in place and declares a new one on a chosen
 * page; every gesture is patches for one file, which the shell dispatches.
 */
const ROW = `---
id: contact-option
---

## Visual Contract

<Page>
  <Component name="ContactOption" status="draft" width={20} height={20} />
</Page>

## Contract

<Props>
  <Prop name="item" type="Contact">The person.</Prop>
  <Prop name="tags" type="Tag[]">Labels.</Prop>
</Props>

## Models

<Model name="Contact">
  One person.
  <Field name="id" type="string" key sample={['a', 'b']}>Identity.</Field>
</Model>
`
const pages = new Map([['contact-option.uidx', parseOrThrow(ROW)]])

const mountPane = (writable = true) =>
  mount(ModelsPane, {
    props: {
      cards: modelsViewModel(pages, 'contact-option.uidx'),
      undeclared: undeclaredModels(pages),
      pages: pagesForModels(pages, 'contact-option.uidx'),
      writable,
    },
  })

describe('the Models pane', () => {
  it('shows each model with its page, its users, and its fields', () => {
    const pane = mountPane()
    const card = pane.find('[data-model="Contact"]')
    expect(card.exists()).toBe(true)
    expect(card.find('h2').text()).toBe('Contact')
    expect(card.find('.where').text()).toBe('this page')
    expect(card.findAll('.uses .chip').map((chip) => chip.text())).toEqual(['ContactOption.item'])
    expect(card.find('[data-field="id"] input[aria-label="Sample"]').element).toHaveProperty(
      'value',
      '["a","b"]',
    )
    // A model a contract names stays until the prop is retyped.
    expect(card.find('[aria-label="Remove model Contact"]').attributes('disabled')).toBeDefined()
  })

  it('writes a description, a field change, a new field, and a removal for the declaring page', async () => {
    const pane = mountPane()
    const card = pane.find('[data-model="Contact"]')
    await card.find('input[aria-label="Description"]').setValue('One row.')
    await card.find('[data-field="id"] input[aria-label="Sample"]').setValue('["x", "y", "z"]')
    await card.find('[data-field="id"] input[aria-label="Optional"]').setValue(true)
    await card.find('button.add').trigger('click')
    await card.find('[aria-label="Remove field id"]').trigger('click')
    const edits = pane.emitted('edit')!
    expect(edits.map(([file]) => file)).toEqual(Array(5).fill('contact-option.uidx'))
    expect(edits.map(([, patches]) => patches)).toEqual([
      [{ op: 'model', name: 'Contact', declaration: { description: 'One row.' } }],
      [
        {
          op: 'field',
          model: 'Contact',
          name: 'id',
          declaration: {
            attrs: { type: 'string', key: true, sample: ['x', 'y', 'z'] },
            description: 'Identity.',
          },
        },
      ],
      [
        {
          op: 'field',
          model: 'Contact',
          name: 'id',
          declaration: {
            attrs: { type: 'string', key: true, optional: true, sample: ['a', 'b'] },
            description: 'Identity.',
          },
        },
      ],
      [
        {
          op: 'field',
          model: 'Contact',
          name: 'field',
          declaration: { attrs: { type: 'string' }, description: 'Describe the field.' },
        },
      ],
      [{ op: 'field', model: 'Contact', name: 'id' }],
    ])
  })

  it('declares a new model on the chosen page, and one a contract already names', async () => {
    const pane = mountPane()
    await pane.find('input[aria-label="Model name"]').setValue('Person')
    await pane.find('button.add.root').trigger('click')
    await pane.find('.undeclared .chip').trigger('click')
    expect(pane.emitted('edit')).toEqual([
      [
        'contact-option.uidx',
        [
          {
            op: 'model',
            name: 'Person',
            declaration: { description: 'Describe what one Person carries.' },
          },
        ],
      ],
      [
        'contact-option.uidx',
        [
          {
            op: 'model',
            name: 'Tag',
            declaration: { description: 'Describe what one Tag carries.' },
          },
        ],
      ],
    ])
  })

  it('jumps to a page or a component from a card, and goes read-only with the socket', async () => {
    const pane = mountPane()
    await pane.find('[data-model="Contact"] .uses .chip').trigger('click')
    expect(pane.emitted('open')).toEqual([['contact-option.uidx', 'ContactOption']])
    const frozen = mountPane(false)
    expect(frozen.find('input[aria-label="Description"]').attributes('disabled')).toBeDefined()
    expect(frozen.find('button.add.root').attributes('disabled')).toBeDefined()
  })
})

describe('renaming from the Models face', () => {
  it('asks the shell to rename a model or a field, carrying their readers', async () => {
    const pane = mountPane()
    const card = pane.find('[data-model="Contact"]')
    await card.find('button[aria-label="Rename model Contact"]').trigger('click')
    const field = pane.find('input[aria-label="Rename model Contact"]')
    await field.setValue('Person')
    await field.trigger('keydown', { key: 'Enter' })
    expect(pane.emitted('renameModel')).toEqual([['Contact', 'Person']])
    await pane.find('[data-field="id"] input[aria-label="Field name"]').setValue('uid')
    expect(pane.emitted('renameField')).toEqual([['Contact', 'id', 'uid']])
    expect(pane.emitted('edit')).toBeUndefined()
  })
})
