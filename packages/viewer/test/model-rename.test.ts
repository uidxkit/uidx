import { describe, expect, it } from 'vitest'
import { applyPatches, parseOrThrow, resolve } from '@uidx/format'

import { renameField, renameModel } from '../src/model-rename'

/**
 * Renaming a model or a field carries what names it: prop and field types on
 * every page, and the `{item.field}` bindings inside the components that
 * receive the model.
 */
const MODELS = `---
id: models
---

## Visual Contract

<Page>
</Page>

## Models

<Model name="Contact">
  A person.
  <Field name="id" type="string" key sample={['a', 'b']}>Identity.</Field>
  <Field name="name" type="string" sample={['Ada', 'Grace']}>Name.</Field>
</Model>

<Model name="Team">
  A group.
  <Field name="lead" type="Contact">Who leads.</Field>
</Model>
`
const LIST = `---
id: list
---

## Visual Contract

<Page>
  <Component name="List" status="draft">
    <Frame name="row" repeat="{people}" as="person" width={10} height={10}>
      <Text name="label" characters="{person.name}" />
    </Frame>
  </Component>
</Page>

## Contract

<Props>
  <Prop name="people" type="Contact[]">Rows.</Prop>
</Props>
`
const pages = () =>
  new Map([
    ['models.uidx', parseOrThrow(MODELS)],
    ['list.uidx', parseOrThrow(LIST)],
  ])

describe('renaming a model', () => {
  it('retypes props and fields that name it, on every page', () => {
    const plan = renameModel(pages(), 'Contact', 'Person')
    if ('refused' in plan) throw new Error(plan.refused)
    const models = parseOrThrow(applyPatches(MODELS, plan.byFile.get('models.uidx')!).source)
    expect(models.spec!.models!.map((m) => m.name)).toEqual(['Person', 'Team'])
    expect(models.spec!.models![1]!.fields[0]!.type).toBe('Person')
    const list = parseOrThrow(applyPatches(LIST, plan.byFile.get('list.uidx')!).source)
    expect(list.spec!.contract!.props[0]!.type).toBe('Person[]')
    expect(renameModel(pages(), 'Contact', 'Team')).toEqual({
      refused: 'there is already a model called Team',
    })
  })
})

describe('renaming a field', () => {
  it('keeps its place and carries the bindings a repeat reads it by', () => {
    const plan = renameField(pages(), 'Contact', 'name', 'fullName')
    if ('refused' in plan) throw new Error(plan.refused)
    const models = parseOrThrow(applyPatches(MODELS, plan.byFile.get('models.uidx')!).source)
    expect(models.spec!.models![0]!.fields.map((f) => f.name)).toEqual(['id', 'fullName'])
    const list = parseOrThrow(applyPatches(LIST, plan.byFile.get('list.uidx')!).source)
    expect(resolve(list.tree, 'List#row/label')!.attrs.characters!.value).toBe('{person.fullName}')
  })
})
