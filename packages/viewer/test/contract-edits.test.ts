import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { applyPatches, parseOrThrow, resolve } from '@uidx/format'
import { defaultVariantAddress, derivedDocument } from '@uidx/schema'
import ContractSection from '../src/ContractSection.vue'
import PropertiesPane from '../src/PropertiesPane.vue'
import {
  bindPart,
  contractIssues,
  contractType,
  contractView,
  scaffoldFromLibrary,
  setImplements,
  setPart,
  setRepeat,
  setRepeatAs,
  setRepeatCount,
} from '../src/contract-edits'
import { parseHeadless, type HeadlessLibrary } from '../src/headless'

/**
 * Binding the visual tree to its code render from the inspector (ADR 0013 §3,
 * ADR 0017 §2).
 *
 * The claims: a component picks its element from the library's roots, a part
 * is bound from either end and lands as one `part` attribute, a bound part
 * moves rather than doubles, a repeat picks a list the contract can place, and
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
<Styles>
  <Style state="checked" checked-indicator:visible={true} />
</Styles>

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
    <Slot name="option" repeat="{items}" count={3}>
      <Instance name="row" component="Row" />
    </Slot>
    <Slot name="empty" />
  </Component>`,
  `
## Contract

<Props>
  <Prop name="items" type="Item[]">Rows.</Prop>
</Props>
<Slots>
  <Slot name="option" accepts="hwc-row">One per item.</Slot>
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

  it('for a repeating slot: what it walks, its item and rows; and the component lists it', () => {
    const doc = parseOrThrow(LIST)
    const view = contractView(doc, resolve(doc.tree, 'List#option'), LIBRARY)
    if (view.kind !== 'slot') throw new Error(view.kind)
    expect(view).toMatchObject({
      declared: { accepts: 'hwc-row' },
      repeat: { list: 'items', as: 'item', count: 3, defaultCount: 3, model: 'Item' },
      lists: ['items'],
    })
    const row = contractView(doc, resolve(doc.tree, 'List#option/row'), LIBRARY)
    if (row.kind !== 'instance') throw new Error(row.kind)
    expect(row).toMatchObject({ repeat: null, lists: ['items'] })
    const component = contractView(doc, resolve(doc.tree, 'List'), LIBRARY)
    if (component.kind !== 'component') throw new Error(component.kind)
    expect(component.slots).toEqual([
      {
        name: 'option',
        provided: { address: 'List#option', repeat: { list: 'items', count: 3 } },
      },
      { name: 'empty', provided: { address: 'List#empty', repeat: null } },
      { name: 'control', provided: null },
    ])
  })

  it('for the default state on the canvas: the base layer it draws', () => {
    // The canvas selects the twin; the tab shows and writes the authored node.
    const doc = parseOrThrow(CHECKBOX)
    const drawn = derivedDocument(doc).tree
    const check = resolve(drawn, defaultVariantAddress(doc, 'Checkbox#check')!)!
    expect(contractView(doc, check, LIBRARY)).toMatchObject({
      kind: 'part',
      node: { address: 'Checkbox#check' },
      partValue: 'checked-indicator',
    })
    const root = resolve(drawn, defaultVariantAddress(doc, 'Checkbox')!)!
    expect(contractView(doc, root, LIBRARY).kind).toBe('component')
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

  it('repeats any layer over a list, names its item, and counts whole rows only', () => {
    const list = parseOrThrow(LIST)
    const slot = resolve(list.tree, 'List#option')!
    const row = resolve(list.tree, 'List#option/row')!
    expect(setRepeat(row, 'items')).toEqual([
      { op: 'add', address: 'List#option/row', prop: 'repeat', value: '{items}' },
    ])
    expect(setRepeat(slot, '{people}')).toEqual([
      { op: 'set', address: 'List#option', prop: 'repeat', value: '{people}' },
    ])
    expect(setRepeatAs(slot, 'person')).toEqual([
      { op: 'add', address: 'List#option', prop: 'as', value: 'person' },
    ])
    expect(setRepeatAs(slot, 'item')).toEqual([])
    expect(setRepeatAs(slot, 'not a name')).toEqual([])
    expect(setRepeatCount(slot, 5)).toEqual([
      { op: 'set', address: 'List#option', prop: 'count', value: 5 },
    ])
    expect(setRepeatCount(slot, -1)).toEqual([])
    expect(setRepeatCount(slot, 2.5)).toEqual([])
    expect(setRepeatCount(slot, null)).toEqual([
      { op: 'remove', address: 'List#option', prop: 'count' },
    ])
    expect(applyPatches(LIST, setRepeatCount(slot, 5)).source).toContain(
      '<Slot name="option" repeat="{items}" count={5}>',
    )
    // Clearing the repeat takes the count with it: the parser refuses one alone.
    expect(setRepeat(slot, null)).toEqual([
      { op: 'remove', address: 'List#option', prop: 'count' },
      { op: 'remove', address: 'List#option', prop: 'repeat' },
    ])
    expect(applyPatches(LIST, setRepeat(slot, null)).source).toContain('<Slot name="option">')
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

  it('edits a repeat from the layer it rides on', async () => {
    const section = mountFor(LIST, 'List#option')
    await section.find('[data-field="count"] input').setValue('4')
    expect(section.emitted('patches')).toEqual([
      [[{ op: 'set', address: 'List#option', prop: 'count', value: 4 }]],
    ])
    const over = section.find('[data-field="repeat"] select')
    expect(over.findAll('option').map((o) => o.text().trim())).toEqual(['Once', '{items}'])
    await over.setValue('')
    expect(section.emitted('patches')!.at(-1)).toEqual([
      [
        { op: 'remove', address: 'List#option', prop: 'count' },
        { op: 'remove', address: 'List#option', prop: 'repeat' },
      ],
    ])
    // An instance below shows the same rows, unset.
    const instance = mountFor(LIST, 'List#option/row')
    expect(instance.find('[data-field="repeat"]').attributes('data-set')).toBe('false')
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
    expect(mountFor(LIST, 'List#option/row').text()).toContain('An instance renders')
  })
})

describe('choosing a library', () => {
  it('offers the dependencies that ship one, or a path, and asks the shell to write it', async () => {
    const doc = parseOrThrow(bare)
    const section = mount(ContractSection, {
      props: {
        doc,
        node: null,
        library: null,
        candidates: [{ package: '@acme/kit', path: 'node_modules/@acme/kit/custom-elements.json' }],
        writable: true,
      },
    })
    const pick = section.find('[data-field="choose-library"] select')
    expect(pick.findAll('option').map((o) => o.text().trim())).toEqual(['Choose…', '@acme/kit'])
    await pick.setValue('node_modules/@acme/kit/custom-elements.json')
    expect(section.emitted('chooseLibrary')).toEqual([
      ['node_modules/@acme/kit/custom-elements.json'],
    ])
    await section
      .find('[data-field="choose-library"] input')
      .setValue('../lib/custom-elements.json')
    await section.find('[data-field="choose-library"] button').trigger('click')
    expect(section.emitted('chooseLibrary')![1]).toEqual(['../lib/custom-elements.json'])
  })

  it('says which tag uidx.json binds a component to', () => {
    const doc = parseOrThrow(CHECKBOX)
    const bound = parseHeadless('lib.json', { modules: [] }, { Checkbox: { tag: 'sl-checkbox' } })
    const section = mount(ContractSection, {
      props: { doc, node: resolve(doc.tree, 'Checkbox'), library: bound, writable: true },
    })
    expect(section.find('[data-field="bound"]').text()).toContain('sl-checkbox')
  })
})

describe('editing the contract from the tab (ADR 0013 §2)', () => {
  it('scaffolds only what the contract lacks: a fully declared contract gets nothing', () => {
    const doc = parseOrThrow(CHECKBOX)
    const element = LIBRARY.elements.get('hwc-checkbox')!
    expect(scaffoldFromLibrary(resolve(doc.tree, 'Checkbox')!, element)).toEqual([])
    // Without its <Parts>, the two parts the element offers are declared with placeholders.
    const undescribed = parseOrThrow(CHECKBOX.replace(/<Parts>[\s\S]*?<\/Parts>\n/, ''))
    const patches = scaffoldFromLibrary(resolve(undescribed.tree, 'Checkbox')!, element)
    expect(patches.map((p) => (p.op === 'contract' ? `${p.kind}:${p.name}` : p.op))).toEqual([
      'part:checked-indicator',
      'part:indeterminate-indicator',
    ])
    const next = applyPatches(undescribed.source, patches).source
    expect(parseOrThrow(next).spec!.contract!.parts.map((p) => [p.name, p.description])).toEqual([
      ['checked-indicator', 'Describe the part "checked-indicator".'],
      ['indeterminate-indicator', 'Describe the part "indeterminate-indicator".'],
    ])
  })

  it("maps a manifest type to the contract's, booleans as visual states", () => {
    expect(contractType('boolean')).toBe('boolean')
    expect(contractType('"a" | "b"')).toBe("'a' | 'b'")
    expect(contractType('string')).toBe('string')
    expect(contractType(undefined)).toBe('string')
    const doc = parseOrThrow(bare)
    const element = parseHeadless('lib.json', {
      modules: [
        {
          declarations: [
            {
              tagName: 'x-switch',
              attributes: [
                { name: 'on', type: { text: 'boolean' }, description: 'Whether it is on.' },
                { name: 'tone', type: { text: '"cool" | "warm"' } },
              ],
              events: [{ name: 'toggle' }],
              slots: [{ name: '' }, { name: 'label' }],
            },
          ],
        },
      ],
    }).elements.get('x-switch')!
    const component = { ...resolve(doc.tree, 'loose')!, element: 'Component' as const }
    const patches = scaffoldFromLibrary(component, element)
    expect(patches).toEqual([
      {
        op: 'contract',
        kind: 'prop',
        name: 'on',
        declaration: {
          attrs: { type: 'boolean', default: false, visual: true },
          description: 'Whether it is on.',
        },
      },
      {
        op: 'contract',
        kind: 'prop',
        name: 'tone',
        declaration: {
          attrs: { type: "'cool' | 'warm'" },
          description: 'Describe the prop "tone".',
        },
      },
      {
        op: 'contract',
        kind: 'event',
        name: 'toggle',
        declaration: { attrs: {}, description: 'Describe the event "toggle".' },
      },
      {
        op: 'contract',
        kind: 'slot',
        name: 'label',
        declaration: { attrs: {}, description: 'Describe the slot "label".' },
      },
    ])
  })

  it('opens a declaration into a form, rewrites it, adds one, and removes one', async () => {
    const doc = parseOrThrow(CHECKBOX)
    const section = mount(ContractSection, {
      props: { doc, node: resolve(doc.tree, 'Checkbox'), library: LIBRARY, writable: true },
    })
    expect(section.find('[data-prop="checked"] .pill').text()).toBe('state')
    await section.find('[data-prop="checked"] .name').trigger('click')
    const form = section.find('[data-editor="prop:checked"]')
    expect(form.exists()).toBe(true)
    await form.findAll('input.text')[0]!.setValue('Whether it is on.')
    expect(section.emitted('patches')![0]).toEqual([
      [
        {
          op: 'contract',
          kind: 'prop',
          name: 'checked',
          declaration: {
            attrs: { type: 'boolean', default: false, visual: true },
            description: 'Whether it is on.',
          },
        },
      ],
    ])
    await section.find('[data-field="add-declaration"] input').setValue('size')
    await section.find('[data-field="add-declaration"] button').trigger('click')
    expect(section.emitted('patches')![1]).toEqual([
      [
        {
          op: 'contract',
          kind: 'prop',
          name: 'size',
          declaration: { attrs: { type: 'string' }, description: 'Describe the prop "size".' },
        },
      ],
    ])
    await section.find('[aria-label="Remove prop checked"]').trigger('click')
    expect(section.emitted('patches')![2]).toEqual([
      [{ op: 'contract', kind: 'prop', name: 'checked' }],
    ])
    expect(section.find('[data-part="checked-indicator"]').exists()).toBe(true)
  })

  it('fills from the library on request', async () => {
    const doc = parseOrThrow(CHECKBOX.replace(/<Parts>[\s\S]*?<\/Parts>\n/, ''))
    const section = mount(ContractSection, {
      props: { doc, node: resolve(doc.tree, 'Checkbox'), library: LIBRARY, writable: true },
    })
    await section.find('.fill').trigger('click')
    const sent = section.emitted('patches')![0]![0] as { kind: string; name: string }[]
    expect(sent.map((p) => `${p.kind}:${p.name}`)).toEqual([
      'part:checked-indicator',
      'part:indeterminate-indicator',
    ])
  })
})

describe('generating code from the tab', () => {
  it('offers the configured folder and asks the shell to generate', async () => {
    const doc = parseOrThrow(CHECKBOX)
    const section = mount(ContractSection, {
      props: {
        doc,
        node: resolve(doc.tree, 'Checkbox'),
        library: LIBRARY,
        codegen: { out: '../generated', running: false, notice: 'Wrote 3 files to ../generated' },
        writable: true,
      },
    })
    const button = section.find('[data-field="generate"] button')
    expect(button.text()).toBe('Generate → ../generated')
    await button.trigger('click')
    expect(section.emitted('generateCode')).toEqual([[]])
    expect(section.find('[data-field="generate-notice"]').text()).toBe(
      'Wrote 3 files to ../generated',
    )
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
