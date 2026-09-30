import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { applyPatches, parseOrThrow, resolve } from '@uidx/format'
import ContractSection from '../src/ContractSection.vue'
import PropertiesPane from '../src/PropertiesPane.vue'
import {
  bindPart,
  contractIssues,
  contractView,
  setImplements,
  setPart,
  setRepeatCount,
  setRepeatSlot,
} from '../src/contract-edits'
import { parseHeadless, type HeadlessLibrary } from '../src/headless'

/**
 * Binding the visual tree to its code render from the inspector (ADR 0013 §3,
 * ADR 0017 §2).
 *
 * The claims: a component picks its element from the library's roots, a part
 * is bound from either end and lands as one `part` attribute, a bound part
 * moves rather than doubles, a repeat picks a declared repeating slot, and
 * every write is a patch the shell applies unchanged.
 */
const LIBRARY = parseHeadless('vendor/custom-elements.json', {
  modules: [
    {
      declarations: [
        {
          tagName: 'hwc-checkbox',
          attributes: [{ name: 'checked' }],
          events: [{ name: 'change' }],
        },
        { tagName: 'hwc-checkbox-checked-indicator' },
        { tagName: 'hwc-checkbox-indeterminate-indicator' },
        { tagName: 'hwc-field', slots: [{ name: '' }, { name: 'control' }] },
        { tagName: 'hwc-field-label' },
        { tagName: 'hwc-text-input' },
        { tagName: 'hwc-text-input-leading-icon' },
        { tagName: 'hwc-text', cssParts: [{ name: 'glyph' }] },
      ],
    },
  ],
})

const page = (id: string, body: string, regions = '') =>
  `---\nid: ${id}\n---\n\n## Visual Contract\n\n<Page>\n${body}\n</Page>\n${regions}`

const CHECKBOX = page(
  'checkbox',
  `  <Component name="Checkbox" status="stable" implements="hwc-checkbox" width={20} height={20}>
    <Vector name="check" part="checked-indicator" visible={false} width={12} height={12}
      vectorPaths={[{ windingRule: 'NONZERO', data: 'M2 6 L5 9 L10 3' }]} />
    <Vector name="dash" visible={false} width={12} height={12}
      vectorPaths={[{ windingRule: 'NONZERO', data: 'M2 5 H10' }]} />
    <Frame name="ring" width={20} height={20} />
  </Component>`,
  `
## Contract

<Props>
  <Prop name="checked" type="boolean" default={false} visual>Whether the option is selected.</Prop>
</Props>
<Events>
  <Event name="change" detail="{ checked: boolean }">Fires on toggle.</Event>
</Events>
<Parts>
  <Part name="checked-indicator">The mark while checked.</Part>
  <Part name="indeterminate-indicator">The mark while mixed.</Part>
</Parts>
`,
)

const LIST = page(
  'list',
  `  <Component name="List" status="draft" implements="hwc-field" layoutMode="VERTICAL">
    <Repeat slot="option" count={3}>
      <Instance name="row" component="Row" />
    </Repeat>
    <Slot name="empty" />
  </Component>`,
  `
## Contract

<Props>
  <Prop name="items" type="Item[]">Rows.</Prop>
</Props>
<Slots>
  <Slot name="option" repeats of="items" accepts="hwc-row">One per item.</Slot>
  <Slot name="empty">While empty.</Slot>
</Slots>

## Models

<Model name="Item">
  A row.
  <Field name="id" type="string" key sample="a">Identity.</Field>
</Model>
`,
)

const bare = page('bare', `  <Frame name="loose" width={10} height={10} />`)

describe('the headless library, as parsed', () => {
  it('finds roots and their parts from <root>-<part> tags and cssParts, longest root first', () => {
    expect(LIBRARY.roots.map((root) => root.tag)).toEqual([
      'hwc-checkbox',
      'hwc-field',
      'hwc-text',
      'hwc-text-input',
    ])
    expect(LIBRARY.elements.get('hwc-checkbox')!.parts).toEqual([
      { name: 'checked-indicator', kind: 'element' },
      { name: 'indeterminate-indicator', kind: 'element' },
    ])
    expect(LIBRARY.elements.get('hwc-text-input')!.parts).toEqual([
      { name: 'leading-icon', kind: 'element' },
    ])
    expect(LIBRARY.elements.get('hwc-text')!.parts).toEqual([{ name: 'glyph', kind: 'shadow' }])
    expect(LIBRARY.elements.get('hwc-field')!.slots).toEqual(['', 'control'])
  })
})

describe('what the tab shows', () => {
  it('for a component: its element, every declared part with its layer, and the contract', () => {
    const doc = parseOrThrow(CHECKBOX)
    const view = contractView(doc, resolve(doc.tree, 'Checkbox'), LIBRARY)
    if (view.kind !== 'component') throw new Error(view.kind)
    expect(view.implementsValue).toBe('hwc-checkbox')
    expect(view.rootOptions.map((o) => o.tag)).toEqual(LIBRARY.roots.map((r) => r.tag))
    expect(view.parts).toEqual([
      {
        name: 'checked-indicator',
        declaredBy: 'both',
        kind: 'element',
        boundTo: { address: 'Checkbox#check', name: 'check', element: 'Vector' },
      },
      { name: 'indeterminate-indicator', declaredBy: 'both', kind: 'element', boundTo: null },
    ])
    // Bound layers leave the candidate list; instances never enter it.
    expect(view.candidates.map((c) => c.name)).toEqual(['dash', 'ring'])
    expect(contractIssues(view)).toBe(1)
  })

  it('keeps an element the library lacks as a choice, marked', () => {
    const doc = parseOrThrow(CHECKBOX.replace('hwc-checkbox"', 'x-box"'))
    const view = contractView(doc, resolve(doc.tree, 'Checkbox'), LIBRARY)
    if (view.kind !== 'component') throw new Error(view.kind)
    expect(view.rootOptions[0]).toEqual({ tag: 'x-box', known: false })
    // The contract still declares the parts, so they remain bindable.
    expect(view.parts.map((p) => p.declaredBy)).toEqual(['contract', 'contract'])
  })

  it('for a layer: the parts it may draw, naming who holds the others', () => {
    const doc = parseOrThrow(CHECKBOX)
    const view = contractView(doc, resolve(doc.tree, 'Checkbox#dash'), LIBRARY)
    if (view.kind !== 'part') throw new Error(view.kind)
    expect(view.partValue).toBeNull()
    expect(view.options).toEqual([
      { name: 'checked-indicator', takenBy: 'check', kind: 'element' },
      { name: 'indeterminate-indicator', takenBy: null, kind: 'element' },
    ])
  })

  it('for a repeat: the declared repeating slots, and what it multiplies', () => {
    const doc = parseOrThrow(LIST)
    const view = contractView(doc, resolve(doc.tree, 'List#repeat(option)'), LIBRARY)
    if (view.kind !== 'repeat') throw new Error(view.kind)
    expect(view).toMatchObject({
      slotValue: 'option',
      count: 3,
      slotOptions: ['option'],
      child: { name: 'row', component: 'Row' },
    })
    const component = contractView(doc, resolve(doc.tree, 'List'), LIBRARY)
    if (component.kind !== 'component') throw new Error(component.kind)
    expect(component.slots).toEqual([
      {
        name: 'option',
        repeats: true,
        provided: { kind: 'repeat', address: 'List#repeat(option)', count: 3 },
      },
      { name: 'empty', repeats: false, provided: { kind: 'slot', address: 'List#empty' } },
      { name: 'control', repeats: false, provided: null },
    ])
  })

  it('for a layer outside any component, and for a page: nothing to bind', () => {
    const doc = parseOrThrow(bare)
    expect(contractView(doc, resolve(doc.tree, 'loose'), LIBRARY).kind).toBe('other')
    expect(contractView(doc, null, LIBRARY).kind).toBe('page')
  })
})

describe('a shadow part in the tab', () => {
  it('is offered like any other, and marked so the author knows it cannot be filled', () => {
    const doc = parseOrThrow(
      page(
        'glyph',
        `  <Component name="Glyph" status="draft" implements="hwc-text">
    <Frame name="mark" width={8} height={8} />
  </Component>`,
      ),
    )
    const view = contractView(doc, resolve(doc.tree, 'Glyph'), LIBRARY)
    if (view.kind !== 'component') throw new Error(view.kind)
    expect(view.parts).toEqual([
      { name: 'glyph', declaredBy: 'library', kind: 'shadow', boundTo: null },
    ])
    const section = mount(ContractSection, {
      props: { doc, node: resolve(doc.tree, 'Glyph'), library: LIBRARY, writable: true },
    })
    expect(section.find('[data-part="glyph"] .pill').text()).toBe('shadow')
    const layer = mount(ContractSection, {
      props: { doc, node: resolve(doc.tree, 'Glyph#mark'), library: LIBRARY, writable: true },
    })
    expect(
      layer
        .find('[data-field="part"] select')
        .findAll('option')
        .map((o) => o.text().trim()),
    ).toEqual(['Nothing — design only', 'glyph · shadow'])
  })
})

describe('the writes', () => {
  const doc = parseOrThrow(CHECKBOX)
  const component = resolve(doc.tree, 'Checkbox')!

  it('sets, changes and clears implements', () => {
    expect(setImplements(component, 'hwc-field')).toEqual([
      { op: 'set', address: 'Checkbox', prop: 'implements', value: 'hwc-field' },
    ])
    expect(setImplements(component, null)).toEqual([
      { op: 'remove', address: 'Checkbox', prop: 'implements' },
    ])
    const fresh = resolve(parseOrThrow(bare).tree, 'loose')!
    expect(setImplements(fresh, 'x')).toEqual([
      { op: 'add', address: 'loose', prop: 'implements', value: 'x' },
    ])
  })

  it('binds a part from the component, moving it off the layer that held it', () => {
    const patches = bindPart(doc, component, 'checked-indicator', 'Checkbox#dash')
    expect(patches).toEqual([
      { op: 'remove', address: 'Checkbox#check', prop: 'part' },
      { op: 'add', address: 'Checkbox#dash', prop: 'part', value: 'checked-indicator' },
    ])
    const after = parseOrThrow(applyPatches(CHECKBOX, patches).source)
    expect(resolve(after.tree, 'Checkbox#dash')!.attrs.part?.value).toBe('checked-indicator')
    expect(resolve(after.tree, 'Checkbox#check')!.attrs.part).toBeUndefined()
  })

  it('binds a part from the layer, and clears it', () => {
    const dash = resolve(doc.tree, 'Checkbox#dash')!
    expect(setPart(dash, 'indeterminate-indicator')).toEqual([
      { op: 'add', address: 'Checkbox#dash', prop: 'part', value: 'indeterminate-indicator' },
    ])
    expect(setPart(resolve(doc.tree, 'Checkbox#check')!, null)).toEqual([
      { op: 'remove', address: 'Checkbox#check', prop: 'part' },
    ])
  })

  it('moves a repeat to another slot and says where it will be, and counts whole rows only', () => {
    const list = parseOrThrow(LIST)
    const repeat = resolve(list.tree, 'List#repeat(option)')!
    expect(setRepeatSlot(repeat, 'items')).toEqual({
      patches: [{ op: 'set', address: 'List#repeat(option)', prop: 'slot', value: 'items' }],
      nextAddress: 'List#repeat(items)',
    })
    expect(setRepeatCount(repeat, 5)).toEqual([
      { op: 'set', address: 'List#repeat(option)', prop: 'count', value: 5 },
    ])
    expect(setRepeatCount(repeat, -1)).toEqual([])
    expect(setRepeatCount(repeat, 2.5)).toEqual([])
    const after = applyPatches(LIST, setRepeatCount(repeat, 5)).source
    expect(after).toContain('<Repeat slot="option" count={5}>')
  })
})

describe('the Contract section', () => {
  const mountFor = (
    source: string,
    address: string | null,
    writable = true,
    library: HeadlessLibrary | null = LIBRARY,
  ) => {
    const doc = parseOrThrow(source)
    return mount(ContractSection, {
      props: { doc, node: address ? resolve(doc.tree, address) : null, library, writable },
    })
  }

  it('offers the library roots for implements and emits the write', async () => {
    const section = mountFor(CHECKBOX, 'Checkbox')
    const pick = section.find('[data-field="implements"] select')
    expect(pick.findAll('option').map((o) => o.text())).toEqual([
      'None',
      'hwc-checkbox',
      'hwc-field',
      'hwc-text',
      'hwc-text-input',
    ])
    await pick.setValue('hwc-field')
    expect(section.emitted('patches')).toEqual([
      [[{ op: 'set', address: 'Checkbox', prop: 'implements', value: 'hwc-field' }]],
    ])
  })

  it('falls back to a text field when the document has no library', async () => {
    const section = mountFor(CHECKBOX, 'Checkbox', true, null)
    const text = section.find('[data-field="implements"] input')
    expect(text.exists()).toBe(true)
    expect(section.text()).toContain('No headless library')
    await text.setValue('hwc-toggle')
    expect(section.emitted('patches')).toEqual([
      [[{ op: 'set', address: 'Checkbox', prop: 'implements', value: 'hwc-toggle' }]],
    ])
  })

  it('lists parts with their layer, binds an unbound one, and selects a bound one', async () => {
    const section = mountFor(CHECKBOX, 'Checkbox')
    expect(section.text()).toContain('1 of 2 bound')
    const bound = section.find('[data-part="checked-indicator"] .layer')
    expect(bound.text()).toBe('check')
    await bound.trigger('click')
    expect(section.emitted('select')).toEqual([['Checkbox#check']])

    const unbound = section.find('[data-part="indeterminate-indicator"] select')
    expect(unbound.findAll('option').map((o) => o.text().trim())).toEqual([
      'Bind a layer…',
      'dash',
      'ring',
    ])
    await unbound.setValue('Checkbox#dash')
    expect(section.emitted('patches')).toEqual([
      [[{ op: 'add', address: 'Checkbox#dash', prop: 'part', value: 'indeterminate-indicator' }]],
    ])

    await section.find('[data-part="checked-indicator"] .reset').trigger('click')
    expect(section.emitted('patches')![1]).toEqual([
      [{ op: 'remove', address: 'Checkbox#check', prop: 'part' }],
    ])
  })

  it("binds from the layer's side, with taken parts named and disabled", async () => {
    const section = mountFor(CHECKBOX, 'Checkbox#dash')
    const pick = section.find('[data-field="part"] select')
    const options = pick.findAll('option')
    expect(options.map((o) => o.text().trim())).toEqual([
      'Nothing — design only',
      'checked-indicator · bound to check',
      'indeterminate-indicator',
    ])
    expect(options[1]!.attributes('disabled')).toBeDefined()
    await pick.setValue('indeterminate-indicator')
    expect(section.emitted('patches')).toEqual([
      [[{ op: 'add', address: 'Checkbox#dash', prop: 'part', value: 'indeterminate-indicator' }]],
    ])
  })

  it('edits a repeat and reselects it at its new address', async () => {
    const section = mountFor(LIST, 'List#repeat(option)')
    await section.find('[data-field="count"] input').setValue('4')
    expect(section.emitted('patches')).toEqual([
      [[{ op: 'set', address: 'List#repeat(option)', prop: 'count', value: 4 }]],
    ])
    const slot = section.find('[data-field="slot"] select')
    expect(slot.findAll('option').map((o) => o.text().trim())).toEqual(['option'])
  })

  it('goes read-only with the socket', () => {
    const section = mountFor(CHECKBOX, 'Checkbox', false)
    expect(section.find('[data-field="implements"] select').attributes('disabled')).toBeDefined()
    expect(
      section.find('[data-part="indeterminate-indicator"] select').attributes('disabled'),
    ).toBeDefined()
  })

  it('explains a layer outside a component and an instance', () => {
    expect(mountFor(bare, 'loose').text()).toContain('Only layers inside a component')
    expect(mountFor(LIST, 'List#repeat(option)/row').text()).toContain('An instance renders')
  })
})

describe('the inspector tabs', () => {
  it('switches between Design and Contract, and counts parts to bind on the tab', async () => {
    const doc = parseOrThrow(CHECKBOX)
    const pane = mount(PropertiesPane, {
      props: { doc, selection: ['Checkbox'], writable: true, headless: LIBRARY },
    })
    const tabs = pane.findAll('.face-toggle button')
    expect(tabs.map((t) => t.text().replace(/\s+/g, ' '))).toEqual(['Design', 'Contract 1'])
    expect(tabs[0]!.attributes('aria-pressed')).toBe('true')
    expect(pane.find('.contract').exists()).toBe(false)
    await tabs[1]!.trigger('click')
    expect(pane.find('.contract').exists()).toBe(true)
    expect(pane.find('[data-field="implements"] select').exists()).toBe(true)
    await pane.find('[data-part="checked-indicator"] .layer').trigger('click')
    expect(pane.emitted('select')).toEqual([['Checkbox#check']])
  })
})
