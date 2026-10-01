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
    // Items first: the model's content, one row per item.
    expect(card.find('[role="tab"][aria-selected="true"]').text()).toContain('Items')
    expect(
      card.findAll('.items tbody input').map((input) => (input.element as HTMLInputElement).value),
    ).toEqual(['a', 'b'])
    // A model a contract names stays until the prop is retyped.
    expect(card.find('[aria-label="Remove model Contact"]').attributes('disabled')).toBeDefined()
  })

  it('writes a description, a field change, a new field, and a removal for the declaring page', async () => {
    const pane = mountPane()
    const card = pane.find('[data-model="Contact"]')
    await card.find('input[aria-label="Description"]').setValue('One row.')
    await card.find('input[aria-label="id of item 2"]').setValue('y')
    await card.find('[data-tab="fields"]').trigger('click')
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
            attrs: { type: 'string', key: true, sample: ['a', 'y'] },
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

  it('stays on Fields when the first field is added, so it can be named', async () => {
    const empty = new Map([
      [
        'p.uidx',
        parseOrThrow(`---
id: p
---

## Visual Contract

<Page>
  <Component name="People" width={20} height={20} />
</Page>

## Models

<Model name="Person">
  One person.
</Model>
`),
      ],
    ])
    const wrapper = mount(ModelsPane, {
      props: {
        cards: modelsViewModel(empty, 'p.uidx'),
        undeclared: undeclaredModels(empty),
        pages: pagesForModels(empty, 'p.uidx'),
        writable: true,
      },
    })
    const card = () => wrapper.get('[data-model="Person"]')
    expect(card().get('[data-tab="fields"]').attributes('aria-selected')).toBe('true')
    await card().get('button.add').trigger('click')
    expect(wrapper.emitted('edit')).toHaveLength(1)
    // The shell answers with the field; the card must not flip to Items under the designer.
    const withField = new Map([
      [
        'p.uidx',
        parseOrThrow(
          empty
            .get('p.uidx')!
            .source.replace(
              '  One person.\n',
              '  One person.\n  <Field name="field" type="string">Describe the field.</Field>\n',
            ),
        ),
      ],
    ])
    await wrapper.setProps({ cards: modelsViewModel(withField, 'p.uidx') })
    expect(card().get('[data-tab="fields"]').attributes('aria-selected')).toBe('true')
    expect(card().find('input[aria-label="Field name"]').exists()).toBe(true)
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
    await pane.find('[data-model="Contact"] [data-tab="fields"]').trigger('click')
    await pane.find('[data-field="id"] input[aria-label="Field name"]').setValue('uid')
    expect(pane.emitted('renameField')).toEqual([['Contact', 'id', 'uid']])
    expect(pane.emitted('edit')).toBeUndefined()
  })
})

describe("managing a model's items", () => {
  const PEOPLE = parseOrThrow(`---
id: people
---

## Visual Contract

<Page>
</Page>

## Models

<Model name="Person">
  One person.
  <Field name="id" type="string" key sample={['ada', 'grace']}>Id.</Field>
  <Field name="name" type="string" sample={['Ada', 'Grace']}>Name.</Field>
  <Field name="age" type="number" sample={36}>Age.</Field>
  <Field name="active" type="boolean" sample={[true, false]}>On the team.</Field>
</Model>
`)
  const people = new Map([['people.uidx', PEOPLE]])
  const pane = () =>
    mount(ModelsPane, {
      props: {
        cards: modelsViewModel(people, 'people.uidx'),
        undeclared: [],
        pages: pagesForModels(people, 'people.uidx'),
        writable: true,
      },
    })
  const field = (name: string, sample: unknown, extra: Record<string, unknown> = {}) => ({
    op: 'field',
    model: 'Person',
    name,
    declaration: {
      attrs: { type: extra.type ?? 'string', ...extra, sample },
      description: expect.any(String),
    },
  })

  it('shows one row per item, a single value shared by every item', () => {
    const rows = pane()
      .findAll('.items tbody tr')
      .map((row) =>
        row.findAll('input').map((input) => {
          const element = input.element as HTMLInputElement
          return element.type === 'checkbox' ? element.checked : element.value
        }),
      )
    expect(rows).toEqual([
      ['ada', 'Ada', '36', true],
      ['grace', 'Grace', '36', false],
    ])
  })

  it("edits one cell as its field's list, by the field's type", async () => {
    const wrapper = pane()
    await wrapper.find('input[aria-label="age of item 2"]').setValue('42')
    expect(wrapper.emitted('edit')![0]![1]).toEqual([field('age', [36, 42], { type: 'number' })])
  })

  it('adds an item with a fresh key and blank cells, and removes one', async () => {
    const wrapper = pane()
    await wrapper.find('[data-model="Person"] button.add').trigger('click')
    expect(wrapper.emitted('edit')![0]![1]).toEqual([
      field('id', ['ada', 'grace', 'person-3'], { key: true }),
      field('name', ['Ada', 'Grace', '']),
      field('age', [36, 36, 0], { type: 'number' }),
      field('active', [true, false, false], { type: 'boolean' }),
    ])
    await wrapper.find('[aria-label="Remove item 1"]').trigger('click')
    expect(wrapper.emitted('edit')![1]![1]).toEqual([
      field('id', ['grace'], { key: true }),
      field('name', ['Grace']),
      field('age', [36], { type: 'number' }),
      field('active', [false], { type: 'boolean' }),
    ])
  })
})
