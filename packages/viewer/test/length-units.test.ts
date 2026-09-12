import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { applyPatches, parseOrThrow, type JsonValue, type UidxPatch } from '@uidx/format'
import { buildTokenIndex, toSceneGraph } from '@uidx/schema'
import PropertiesPane from '../src/PropertiesPane.vue'
import TokensPane from '../src/TokensPane.vue'
import { editCellPatch } from '../src/token-edits'
import { variableCandidates } from '../src/variable-binding'
import { type TokenRow } from '../src/tokens-view-model'

const page = (attrs = '', root = 16) =>
  parseOrThrow(
    `---\nid: unit-controls\n---\n## Visual Contract\n<Page rootFontSize={${root}}><Frame name="box" width={320} height={160} layoutMode="VERTICAL" paddingLeft={16} paddingRight={16} paddingTop={8} paddingBottom={8} cornerRadius={8} ${attrs} /></Page>`,
  )

describe('length unit controls', () => {
  it('switches px to rem without moving the shape, then edits the rem amount and switches back', async () => {
    let doc = page()
    const wrapper = mount(PropertiesPane, { props: { doc, selection: ['box'], writable: true } })
    const width = () => wrapper.get('.size-field[data-dimension="width"]')
    await width().get('select.length-unit').setValue('rem')
    expect(wrapper.emitted('commit')!.at(-1)).toEqual(['box', 'width', '20rem'])
    doc = parseOrThrow(
      applyPatches(doc.source, [{ op: 'set', address: 'box', prop: 'width', value: '20rem' }])
        .source,
    )
    await wrapper.setProps({ doc })
    expect(width().get('.scrub').text()).toBe('20')
    expect(toSceneGraph(doc).graph.getNode('box')!.width).toBe(320)
    await width().get('.scrub').trigger('dblclick')
    await width().get('input').setValue('22')
    await width().get('input').trigger('keydown', { key: 'Enter', code: 'Enter' })
    expect(wrapper.emitted('commit')!.at(-1)).toEqual(['box', 'width', '22rem'])
    doc = parseOrThrow(
      applyPatches(doc.source, [{ op: 'set', address: 'box', prop: 'width', value: '22rem' }])
        .source,
    )
    await wrapper.setProps({ doc })
    await width().get('select.length-unit').setValue('px')
    expect(wrapper.emitted('commit')!.at(-1)).toEqual(['box', 'width', 352])
    wrapper.unmount()
  })

  it('uses the page root size for position, gaps, and compound controls', async () => {
    const wrapper = mount(PropertiesPane, {
      props: { doc: page('x="2rem" itemSpacing="1rem"', 20), selection: ['box'], writable: true },
    })
    expect(wrapper.get('[data-field="x"] .scrub').text()).toBe('2')
    expect(wrapper.get('[data-field="itemSpacing"] .scrub').text()).toBe('1')
    await wrapper.get('.padding-box[data-axis="horizontal"] .length-unit').setValue('rem')
    expect(wrapper.emitted('commit')!.slice(-2)).toEqual([
      ['box', 'paddingLeft', '0.8rem'],
      ['box', 'paddingRight', '0.8rem'],
    ])
    await wrapper.get('.corner-box .length-unit').setValue('rem')
    expect(wrapper.emitted('commit')!.at(-1)).toEqual(['box', 'cornerRadius', '0.4rem'])
    expect(wrapper.find('[data-field="opacity"] .length-unit').exists()).toBe(false)
    expect(wrapper.find('[data-field="rotation"] .length-unit').exists()).toBe(false)
    wrapper.unmount()
  })

  it('expands equally measured padding that has different authored units', () => {
    const doc = parseOrThrow(page().source.replace('paddingLeft={16}', 'paddingLeft="1rem"'))
    const wrapper = mount(PropertiesPane, { props: { doc, selection: ['box'], writable: true } })
    expect(wrapper.get('.padding-field').attributes('data-expanded')).toBe('true')
    expect(wrapper.get('.padding-box[data-side="left"] .length-unit').element).toHaveProperty(
      'value',
      'rem',
    )
    wrapper.unmount()
  })

  it('shows authored units for nested positions and fractional pin offsets', async () => {
    const doc = parseOrThrow(
      `---\nid: pinned\n---\n## Visual Contract\n<Page rootFontSize={20}><Frame name="box" width={200} height={200}><Rectangle name="free" x="1.25rem" width="1rem" height="1rem" /><Rectangle name="pinned" width="1rem" height="1rem" constraints={{horizontal: "MAX", vertical: "MIN"}} right="0.125rem" /></Frame></Page>`,
    )
    const wrapper = mount(PropertiesPane, {
      props: { doc, selection: ['box#free'], writable: true },
    })
    expect(wrapper.get('[data-field="x"] .scrub').text()).toBe('1.25')
    expect(wrapper.get('[data-field="x"] .length-unit').element).toHaveProperty('value', 'rem')
    await wrapper.setProps({ selection: ['box#pinned'] })
    expect(wrapper.get('[data-field="right"] .scrub').text()).toBe('0.125')
    expect(wrapper.get('[data-field="right"] .length-unit').element).toHaveProperty('value', 'rem')
    wrapper.unmount()
  })

  it('keeps units disabled when the document is read-only', async () => {
    const wrapper = mount(PropertiesPane, {
      props: { doc: page(), selection: ['box'], writable: false },
    })
    expect(
      wrapper
        .findAll('.length-unit')
        .every((select) => select.attributes('disabled') !== undefined),
    ).toBe(true)
    wrapper.unmount()
  })

  it('does not turn an unspecified hugging dimension into zero when choosing a unit', () => {
    const doc = parseOrThrow(page().source.replace('width={320}', 'primaryAxisSizingMode="AUTO"'))
    const wrapper = mount(PropertiesPane, { props: { doc, selection: ['box'], writable: true } })
    expect(
      wrapper.get('.size-field[data-dimension="width"] .length-unit').attributes('disabled'),
    ).toBeDefined()
    wrapper.unmount()
  })

  it('edits the root font size through the ordinary document patch channel', async () => {
    const wrapper = mount(PropertiesPane, { props: { doc: page(), selection: [], writable: true } })
    await wrapper.get('#root-font-size').setValue(20)
    await wrapper.get('#root-font-size').trigger('change')
    expect((wrapper.emitted('patches')!.at(-1)![0] as UidxPatch[])[0]).toEqual({
      op: 'set',
      address: '',
      prop: 'rootFontSize',
      value: 20,
    })
    wrapper.unmount()
  })

  it('steps the root font size in whole pixels with the native spinner', async () => {
    const wrapper = mount(PropertiesPane, { props: { doc: page(), selection: [], writable: true } })
    const field = wrapper.get<HTMLInputElement>('#root-font-size')
    for (const [direction, expected] of [
      [1, 17],
      [-1, 16],
      [-1, 15],
    ] as const) {
      if (direction > 0) field.element.stepUp()
      else field.element.stepDown()
      expect(field.element.value).toBe(String(expected))
      await field.trigger('change')
      expect((wrapper.emitted('patches')!.at(-1)![0] as UidxPatch[])[0]).toMatchObject({
        prop: 'rootFontSize',
        value: expected,
      })
      await wrapper.setProps({ doc: page('', expected) })
    }
    wrapper.unmount()
  })

  it('detaches a relative token into its original unit', async () => {
    const doc = parseOrThrow(page().source.replace('width={320}', 'width="{size#card}"'))
    const wrapper = mount(PropertiesPane, {
      props: {
        doc,
        selection: ['box'],
        writable: true,
        tokens: new Map<string, JsonValue>([['size#card', '20rem']]),
      },
    })
    await wrapper.get('.size-field[data-dimension="width"] .token-detach').trigger('click')
    expect((wrapper.emitted('patches')!.at(-1)![0] as UidxPatch[])[0]).toMatchObject({
      prop: 'width',
      value: '20rem',
    })
    wrapper.unmount()
  })
})

describe('relative token editor', () => {
  const tokens = parseOrThrow(
    `---\nid: tokens\n---\n## Visual Contract\n<Tokens><Collection name="space"><Variable name="gap" type="FLOAT" value={16} /></Collection></Tokens>`,
  )
  const index = buildTokenIndex([tokens])
  const row: TokenRow = {
    address: 'space#gap',
    name: 'gap',
    type: 'FLOAT',
    category: 'spacing',
    scopes: ['ALL_SCOPES'],
    description: '',
    deprecated: false,
    cells: [{ mode: 'default', authored: 16, resolved: 16, chain: [] }],
    file: 'tokens.uidx',
    dependents: 0,
  }

  it('selects rem, persists the token, and accepts a typed rem value', async () => {
    const wrapper = mount(TokensPane, {
      props: {
        groups: [{ name: 'space', modes: ['default'], file: 'tokens.uidx', rows: [row] }],
        selection: [],
        canCreateCollections: true,
        aliasOptionsFor: () => [],
      },
    })
    const cell = wrapper.get('[data-address="space#gap"]')
    await cell.get('.value-trigger').trigger('click')
    await cell.get('.length-unit').setValue('rem')
    await cell.get('input').trigger('keydown', { key: 'Enter', code: 'Enter' })
    const edit = wrapper.emitted('edit')![0]![0] as {
      row: TokenRow
      mode: string
      value: JsonValue
    }
    expect(edit.value).toBe('1rem')
    const result = editCellPatch({ ...edit, index })
    if ('refused' in result) throw new Error(result.refused)
    const reopened = parseOrThrow(applyPatches(tokens.source, result.patches).source)
    expect(buildTokenIndex([reopened]).entries.get('space#gap')!.valuesByMode).toEqual({
      default: '1rem',
    })
    await cell.get('.value-trigger').trigger('click')
    await cell.get('input').setValue('1.5rem')
    await cell.get('input').trigger('keydown', { key: 'Enter', code: 'Enter' })
    expect((wrapper.emitted('edit')!.at(-1)![0] as { value: JsonValue }).value).toBe('1.5rem')
    wrapper.unmount()
  })

  it('offers relative tokens for lengths and excludes them from opacity', () => {
    const values = new Map<string, JsonValue>([['space#gap', '1rem']])
    expect(variableCandidates(values, index, 'FLOAT', 'paddingTop')).toHaveLength(1)
    expect(variableCandidates(values, index, 'FLOAT', 'opacity')).toHaveLength(0)
  })

  it('keeps the selected token unit while editing its number and converts an active draft', async () => {
    const relativeRow: TokenRow = {
      ...row,
      cells: [{ mode: 'default', authored: '1rem', resolved: '1rem', chain: [] }],
    }
    const wrapper = mount(TokensPane, {
      props: {
        groups: [{ name: 'space', modes: ['default'], file: 'tokens.uidx', rows: [relativeRow] }],
        selection: [],
        rootFontSize: 20,
        canCreateCollections: true,
        aliasOptionsFor: () => [],
      },
    })
    const cell = wrapper.get('[data-address="space#gap"]')
    await cell.get('.value-trigger').trigger('click')
    expect(cell.get('input').element.value).toBe('1')
    await cell.get('input').setValue('2')
    expect(cell.get('.length-unit').element).toHaveProperty('value', 'rem')
    await cell.get('input').trigger('keydown', { key: 'Enter', code: 'Enter' })
    expect((wrapper.emitted('edit')!.at(-1)![0] as { value: JsonValue }).value).toBe('2rem')
    await cell.get('.value-trigger').trigger('click')
    await cell.get('input').setValue('2')
    await cell
      .get('.value-editor')
      .trigger('focusout', { relatedTarget: cell.get('select').element })
    await cell.get('.length-unit').setValue('px')
    expect(cell.get('input').element.value).toBe('40')
    await cell.get('input').trigger('keydown', { key: 'Enter', code: 'Enter' })
    expect((wrapper.emitted('edit')!.at(-1)![0] as { value: JsonValue }).value).toBe(40)
    wrapper.unmount()
  })
})
