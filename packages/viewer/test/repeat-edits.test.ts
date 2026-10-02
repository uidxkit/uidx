import { describe, expect, it } from 'vitest'
import { applyPatches, parseOrThrow, resolve } from '@uidx/format'
import { newRepeatFor, repeatTargetFor } from '../src/repeat-edits'

/**
 * Repeating a layer from the toolbar (ADR 0017 §2). The tool is offered on
 * exactly one shape of selection, and the gesture is one attribute: the
 * layer stays where it is and keeps its address.
 */
const page = (body: string, regions = '') =>
  `---\nid: list\n---\n\n## Visual Contract\n\n<Page>\n${body}\n</Page>\n${regions}`

const CONTRACT = `
## Contract

<Props>
  <Prop name="items" type="Item[]">Rows.</Prop>
</Props>
<Slots>
  <Slot name="option" accepts="x-row">One per item.</Slot>
  <Slot name="empty">While empty.</Slot>
</Slots>

## Models

<Model name="Item">
  A row.
  <Field name="id" type="string" key sample={['a', 'b']}>Identity.</Field>
  <Field name="tags" type="Tag[]">Labels.</Field>
</Model>

<Model name="Tag">
  A label.
  <Field name="id" type="string" key sample="t">Identity.</Field>
</Model>
`
const LIST = page(
  `  <Component name="List" status="draft" implements="x-list" layoutMode="VERTICAL">
    <Instance name="row" component="Row" />
    <Slot name="empty" />
    <Frame name="group" width={10} height={10} />
  </Component>`,
  CONTRACT,
)

describe('where a repeat may go', () => {
  it('offers the first list prop for any layer inside a component', () => {
    const doc = parseOrThrow(LIST)
    expect(repeatTargetFor(doc, ['List#row'])).toMatchObject({ list: 'items' })
    expect(repeatTargetFor(doc, ['List#empty'])).toMatchObject({ list: 'items' })
    expect(repeatTargetFor(doc, ['List#group'])).toMatchObject({ list: 'items' })
    expect(repeatTargetFor(doc, ['List'])).toBeNull()
    expect(repeatTargetFor(doc, ['List#row', 'List#empty'])).toBeNull()
  })

  it('declines a layer already repeating, and one whose contract has no list', () => {
    const repeated = parseOrThrow(
      page(
        `  <Component name="List" status="draft" implements="x-list" layoutMode="VERTICAL">
    <Frame name="group" repeat="{items}" width={10} height={10}>
      <Frame name="tag" width={4} height={4} />
    </Frame>
  </Component>`,
        CONTRACT,
      ),
    )
    expect(repeatTargetFor(repeated, ['List#group'])).toBeNull()
    // Inside a repeat the item's own lists come first: a nested layer walks the item.
    expect(repeatTargetFor(repeated, ['List#group/tag'])).toMatchObject({
      list: 'item.tags',
      as: 'tag',
    })
    const noList = parseOrThrow(
      page(
        `  <Component name="List" status="draft"><Instance name="row" component="Row" /></Component>`,
      ),
    )
    expect(repeatTargetFor(noList, ['List#row'])).toBeNull()
    expect(repeatTargetFor(parseOrThrow(page(`  <Frame name="loose" />`)), ['loose'])).toBeNull()
  })
})

describe('the gesture', () => {
  it('writes repeat="{items}" on the layer and leaves it where it was', () => {
    const doc = parseOrThrow(LIST)
    const made = newRepeatFor(doc, ['List#row'])!
    expect(made).toEqual({
      patches: [{ op: 'add', address: 'List#row', prop: 'repeat', value: '{items}' }],
      address: 'List#row',
    })
    const after = applyPatches(LIST, made.patches).source
    expect(after).toContain('<Instance name="row" component="Row" repeat="{items}" />')
    const next = parseOrThrow(after)
    expect(resolve(next.tree, 'List')!.children.map((c) => c.name)).toEqual([
      'row',
      'empty',
      'group',
    ])
  })
})
