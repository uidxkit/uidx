import { describe, expect, it } from 'vitest'
import { applyPatches, parseOrThrow } from '@uidx/format'
import {
  addModel,
  fieldWith,
  freshFieldName,
  modelsViewModel,
  newField,
  pagesForModels,
  parseSample,
  printSample,
  removeModel,
  setField,
  setModelDescription,
  undeclaredModels,
} from '../src/model-edits'

/**
 * The Models face (ADR 0015 §1): models gathered from every page, each with
 * the page that declares it and the components that receive it; writes are
 * `model` and `field` ops for the declaring page.
 */
const page = (id: string, body: string, regions = '') => `---
id: ${id}
---

## Visual Contract

<Page>
${body}
</Page>
${regions}`

const ROW = page(
  'contact-option',
  `  <Component name="ContactOption" status="draft" width={20} height={20} />`,
  `
## Contract

<Props>
  <Prop name="item" type="Contact">The person.</Prop>
</Props>

## Models

<Model name="Contact">
  One person.
  <Field name="id" type="string" key sample={['a', 'b']}>Identity.</Field>
  <Field name="name" type="string" sample={['Ada', 'Grace']}>Name.</Field>
</Model>
`,
)
const LIST = page(
  'contact-list',
  `  <Component name="ContactList" status="draft" width={20} height={20} />`,
  `
## Contract

<Props>
  <Prop name="items" type="Contact[]">Rows.</Prop>
  <Prop name="tags" type="Tag[]">Labels.</Prop>
</Props>
`,
)
const TOKENS = `---
id: tokens
---

## Visual Contract

<Tokens>
  <Collection name="space">
    <Variable name="xs" type="FLOAT" value={4} />
  </Collection>
</Tokens>
`
const pages = new Map([
  ['contact-list.uidx', parseOrThrow(LIST)],
  ['contact-option.uidx', parseOrThrow(ROW)],
  ['tokens.uidx', parseOrThrow(TOKENS)],
])

describe('the models view', () => {
  it('lists every model with its page and who receives it, the open page first', () => {
    const cards = modelsViewModel(pages, 'contact-list.uidx')
    expect(cards).toHaveLength(1)
    expect(cards[0]).toMatchObject({
      name: 'Contact',
      file: 'contact-option.uidx',
      description: 'One person.',
      onPage: false,
      usedBy: [
        { component: 'ContactList', file: 'contact-list.uidx', prop: 'items', list: true },
        { component: 'ContactOption', file: 'contact-option.uidx', prop: 'item', list: false },
      ],
    })
    expect(cards[0]!.fields.map((field) => field.name)).toEqual(['id', 'name'])
    expect(modelsViewModel(pages, 'contact-option.uidx')[0]!.onPage).toBe(true)
  })

  it('names the models a contract types that no page declares', () => {
    expect(undeclaredModels(pages)).toEqual([{ name: 'Tag', file: 'contact-list.uidx' }])
  })

  it('offers every non-token page for a new model, the open one first and a models page marked', () => {
    const withShared = new Map(pages)
    withShared.set('models.uidx', parseOrThrow(page('models', '')))
    expect(pagesForModels(withShared, 'contact-list.uidx')).toEqual([
      { file: 'contact-list.uidx', label: 'contact-list', suggested: false },
      { file: 'models.uidx', label: 'models', suggested: true },
      { file: 'contact-option.uidx', label: 'contact-option', suggested: false },
    ])
  })
})

describe('the writes', () => {
  it('declare, describe and remove a model, and refuse a name that is not one', () => {
    expect(addModel('Tag')).toEqual([
      { op: 'model', name: 'Tag', declaration: { description: 'Describe what one Tag carries.' } },
    ])
    expect(addModel('not a name')).toEqual([])
    expect(setModelDescription('Contact', ' One row. ')).toEqual([
      { op: 'model', name: 'Contact', declaration: { description: 'One row.' } },
    ])
    expect(removeModel('Contact')).toEqual([{ op: 'model', name: 'Contact' }])
  })

  it('write a field with one thing changed, and a fresh one', () => {
    const contact = pages.get('contact-option.uidx')!.spec!.models![0]!
    const name = contact.fields[1]!
    expect(setField('Contact', 'name', fieldWith(name, { optional: true }))).toEqual([
      {
        op: 'field',
        model: 'Contact',
        name: 'name',
        declaration: {
          attrs: { type: 'string', optional: true, sample: ['Ada', 'Grace'] },
          description: 'Name.',
        },
      },
    ])
    expect(fieldWith(name, { sample: undefined }).attrs).toEqual({ type: 'string' })
    expect(setField('Contact', 'bad name', fieldWith(name, {}))).toEqual([])
    expect(freshFieldName(contact)).toBe('field')
    expect(freshFieldName({ fields: [{ name: 'field' }, { name: 'field-2' }] })).toBe('field-3')
    const after = applyPatches(ROW, newField(contact)).source
    expect(after).toContain('<Field name="field" type="string">Describe the field.</Field>')
  })

  it('reads a sample as JSON where it parses and as text otherwise, and prints it back', () => {
    expect(parseSample('["Ada", "Grace"]')).toEqual(['Ada', 'Grace'])
    expect(parseSample('3')).toBe(3)
    expect(parseSample('null')).toBeNull()
    expect(parseSample('Ada')).toBe('Ada')
    expect(parseSample('  ')).toBeUndefined()
    expect(printSample(['Ada', null])).toBe('["Ada",null]')
    expect(printSample('Ada')).toBe('Ada')
    expect(printSample(undefined)).toBe('')
  })
})
