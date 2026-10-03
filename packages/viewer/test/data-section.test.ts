import { afterEach, describe, expect, it } from 'vitest'
import { enableAutoUnmount, mount } from '@vue/test-utils'
import { applyPatches, parseOrThrow, resolve, type UidxPatch } from '@uidx/format'
import { modelIndex } from '@uidx/schema'
import DataSection from '../src/DataSection.vue'

enableAutoUnmount(afterEach)
const source = `---
id: team
---

## Visual Contract

<Page>
  <Component name="Team">
    <Frame name="row" repeat="{people}">
      <Text name="name" characters="Placeholder" />
    </Frame>
  </Component>
</Page>

## Contract

<Props>
  <Prop name="people" type="Person[]">The team.</Prop>
</Props>

## Models

<Model name="Person">
  One person.
  <Field name="name" type="string" sample={['Ada', 'Grace']}>Name.</Field>
  <Field name="active" type="boolean" sample={[true, false]}>Active.</Field>
</Model>
`
const doc = parseOrThrow(source)
const models = modelIndex([doc])
const show = (address = 'Team', writable = true) =>
  mount(DataSection, {
    props: {
      doc,
      node: resolve(doc.tree, address),
      models,
      selectionCount: 1,
      previewIndex: 0,
      writable,
    },
  })

describe('connecting visual layers to models', () => {
  it('shows existing component models and opens their sample data', async () => {
    const panel = show()
    const model = panel.get('[data-model="Person"]')
    expect(model.text()).toContain('List of items · people')
    await model.get('button').trigger('click')
    expect(panel.emitted('openModel')).toEqual([['Person']])
    await panel.get('.text-layer').trigger('click')
    expect(panel.emitted('select')).toEqual([['Team#row/name']])
  })

  it('adds a typed model input without changing the visual tree', async () => {
    const panel = show()
    await panel.get('button.action').trigger('click')
    await panel.get('.model-popup [data-model="Person"]').trigger('click')
    const patches = panel.emitted('patches')![0]![0] as UidxPatch[]
    const after = parseOrThrow(applyPatches(source, patches).source)
    expect(resolve(after.tree, 'Team')!.spec!.contract!.props).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'person', type: 'Person' }),
        expect.objectContaining({ name: 'people', type: 'Person[]' }),
      ]),
    )
    expect(resolve(after.tree, 'Team#row/name')!.attrs.characters!.value).toBe('Placeholder')
    await panel.setProps({ doc: after, node: resolve(after.tree, 'Team') })
    await panel.get('button.action').trigger('click')
    await panel.get('.model-popup [data-model="Person"]').trigger('click')
    expect(panel.emitted('patches')).toHaveLength(1)
  })

  it('writes field aliases that survive serialization instead of writing sample text', async () => {
    const panel = show('Team#row/name')
    expect(panel.text()).toContain('Inside row, repeated for each Person.')
    await panel.get('[aria-label="Text content field"]').setValue('item.name')
    await panel.get('[aria-label="Visibility field"]').setValue('item.active')
    const patches = panel.emitted('patches')!.flatMap((entry) => entry[0] as UidxPatch[])
    const after = parseOrThrow(applyPatches(source, patches).source)
    const text = resolve(after.tree, 'Team#row/name')!
    expect(text.attrs.characters!.value).toBe('{item.name}')
    expect(text.attrs.visible!.value).toBe('{item.active}')
  })

  it('keeps browsing available offline and disables edits', async () => {
    const panel = show('Team#row/name', false)
    expect(panel.get('[aria-label="Text content field"]').attributes('disabled')).toBeDefined()
    expect(panel.get('[aria-label="Visibility field"]').attributes('disabled')).toBeDefined()
    await panel.get('.intro button').trigger('click')
    expect(panel.emitted('openModel')).toEqual([['']])
    expect(panel.emitted('patches')).toBeUndefined()
  })
})
