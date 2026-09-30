import { describe, expect, it } from 'vitest'
import { applyPatches, parseOrThrow, resolve } from '@uidx/format'
import { newRepeatFor, repeatTargetFor } from '../src/repeat-edits'

/**
 * Wrapping an instance in a `<Repeat>` from the toolbar (ADR 0017 §2). The
 * tool is offered on exactly one shape of selection, the gesture leaves a
 * valid file after each op, and the repeat is selected by its derived name.
 */
const page = (body: string, regions = '') =>
  `---\nid: list\n---\n\n## Visual Contract\n\n<Page>\n${body}\n</Page>\n${regions}`

const CONTRACT = `
## Contract

<Props>
  <Prop name="items" type="Item[]">Rows.</Prop>
</Props>
<Slots>
  <Slot name="option" repeats of="items" accepts="x-row">One per item.</Slot>
  <Slot name="empty">While empty.</Slot>
</Slots>
`
const LIST = page(
  `  <Component name="List" status="draft" implements="x-list" layoutMode="VERTICAL">
    <Instance name="row" component="Row" />
    <Slot name="empty" />
  </Component>`,
  CONTRACT,
)

describe('where a repeat may go', () => {
  it('offers the first open repeating slot for an instance inside a component', () => {
    const doc = parseOrThrow(LIST)
    expect(repeatTargetFor(doc, ['List#row'])).toMatchObject({ slot: 'option' })
    expect(repeatTargetFor(doc, ['List#empty'])).toBeNull()
    expect(repeatTargetFor(doc, ['List'])).toBeNull()
    expect(repeatTargetFor(doc, ['List#row', 'List#empty'])).toBeNull()
  })

  it('declines when every repeating slot is provided, or the instance is already repeated', () => {
    const provided = parseOrThrow(
      page(
        `  <Component name="List" status="draft" implements="x-list" layoutMode="VERTICAL">
    <Repeat slot="option" count={2}><Instance name="row" component="Row" /></Repeat>
    <Instance name="other" component="Row" />
    <Slot name="empty" />
  </Component>`,
        CONTRACT,
      ),
    )
    expect(repeatTargetFor(provided, ['List#other'])).toBeNull()
    expect(repeatTargetFor(provided, ['List#repeat(option)/row'])).toBeNull()
    const noSlot = parseOrThrow(
      page(
        `  <Component name="List" status="draft"><Instance name="row" component="Row" /></Component>`,
      ),
    )
    expect(repeatTargetFor(noSlot, ['List#row'])).toBeNull()
  })
})

describe('the gesture', () => {
  it('wraps the instance in place and names the repeat by its slot', () => {
    const doc = parseOrThrow(LIST)
    const made = newRepeatFor(doc, ['List#row'])!
    expect(made.address).toBe('List#repeat(option)')
    expect(made.patches.map((p) => p.op)).toEqual(['remove-node', 'insert-node'])
    const next = parseOrThrow(applyPatches(LIST, made.patches).source)
    const repeat = resolve(next.tree, 'List#repeat(option)')!
    expect(repeat.element).toBe('Repeat')
    expect(repeat.attrs.count?.value).toBe(3)
    expect(repeat.children.map((c) => [c.element, c.name])).toEqual([['Instance', 'row']])
    // Still first: the wrapper took the instance's place, the slot stays after it.
    expect(resolve(next.tree, 'List')!.children.map((c) => c.name)).toEqual([
      'repeat(option)',
      'empty',
    ])
    expect(applyPatches(LIST, made.patches).source).toContain(
      '<Repeat\n      slot="option"\n      count={3}\n    >',
    )
  })
})
