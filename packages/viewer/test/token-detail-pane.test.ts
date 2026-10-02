import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { Dependent } from '@uidx/schema'

import TokenDetailPane from '../src/TokenDetailPane.vue'
import type { TokenRow } from '../src/tokens-view-model'

const ROW: TokenRow = {
  address: 'palette#blue-500',
  name: 'blue-500',
  type: 'COLOR',
  category: 'color',
  scopes: ['ALL_FILLS'],
  description: 'Brand ground.',
  deprecated: false,
  cells: [
    {
      mode: 'default',
      authored: { r: 0.1, g: 0.4, b: 0.9, a: 1 },
      chain: [],
      resolved: { r: 0.1, g: 0.4, b: 0.9, a: 1 },
    },
  ],
  file: 'core.uidx',
  dependents: 3,
}

const DEPS: Dependent[] = [
  { file: 'core.uidx', address: 'semantic#brand', prop: 'value', kind: 'mode', mode: 'light' },
  { file: 'home.uidx', address: 'hero', prop: 'fills', kind: 'scene' },
  { file: 'sign-in.uidx', address: 'panel', prop: 'fills', kind: 'scene' },
]

const mounted = (over: Partial<Record<string, unknown>> = {}) =>
  mount(TokenDetailPane, {
    props: {
      row: ROW,
      dependents: DEPS,
      deleteWarnings: [DEPS[1]!],
      deleteBlocked: null,
      ...over,
    },
  })

describe('TokenDetailPane', () => {
  it('edits the description, clearing it to no attribute', async () => {
    const pane = mounted()
    const text = pane.find('textarea[aria-label="Token description"]')
    expect((text.element as HTMLTextAreaElement).value).toBe('Brand ground.')
    await text.setValue('The brand colour, for primary actions.')
    await text.setValue('  ')
    expect(pane.emitted('attr')).toEqual([
      ['description', 'The brand colour, for primary actions.'],
      ['description', null],
    ])
  })

  it("offers its type's scopes, and unticking the last goes back to everywhere", async () => {
    const pane = mounted()
    const labels = pane.findAll('.scope').map((s) => s.text())
    expect(labels).toContain('Text fill')
    expect(labels).not.toContain('Corner radius')
    expect((pane.find('[data-scope="ALL_FILLS"] input').element as HTMLInputElement).checked).toBe(
      true,
    )
    await pane.find('[data-scope="STROKE_COLOR"] input').setValue(true)
    await pane.find('[data-scope="ALL_FILLS"] input').setValue(false)
    expect(pane.emitted('attr')).toEqual([
      ['scopes', ['ALL_FILLS', 'STROKE_COLOR']],
      ['scopes', null],
    ])
    const toggle = mounted({ row: { ...ROW, type: 'BOOLEAN', scopes: ['ALL_SCOPES'] } })
    expect(toggle.find('.scopes').exists()).toBe(false)
  })

  it('shows the record and the dependents as jump links', async () => {
    const pane = mounted()
    expect(pane.text()).toContain('blue-500')
    expect(pane.text()).toContain('Color')
    expect(pane.text()).toContain('core.uidx')
    const rows = pane.findAll('.dependent')
    expect(rows).toHaveLength(3)
    await rows[1]!.trigger('click')
    expect(pane.emitted('jump')![0]).toEqual([DEPS[1]])
  })

  it('labels rename and delete with their blast radius', () => {
    const pane = mounted()
    expect(pane.text()).toContain('Rename (updates 3 references in 3 files)')
    expect(pane.text()).toContain('Delete (inlines value into 3 dependents)')
  })

  it('renames through a confirm that lists the dependents', async () => {
    const pane = mounted()
    await pane.find('button.rename').trigger('click')
    expect(pane.findAll('.confirm .dependent-name')).toHaveLength(3)
    await pane.find('.confirm input').setValue('azure-500')
    await pane.find('.confirm button.go').trigger('click')
    expect(pane.emitted('rename')![0]).toEqual(['azure-500'])
  })

  it('deletes through a confirm that warns where mode variance flattens', async () => {
    const pane = mounted()
    await pane.find('button.delete').trigger('click')
    const confirm = pane.find('.confirm')
    expect(confirm.text()).toContain('hero')
    expect(confirm.findAll('.flatten-warning')).toHaveLength(1)
    await confirm.find('button.go').trigger('click')
    expect(pane.emitted('delete')).toHaveLength(1)
  })

  it('disables delete when the chain is broken, and says why', () => {
    const pane = mounted({ deleteBlocked: 'palette#blue-500 does not resolve to a literal' })
    const remove = pane.find('button.delete')
    expect(remove.attributes('disabled')).toBeDefined()
    expect(pane.text()).toContain('does not resolve')
  })

  it('deprecates without ceremony', async () => {
    const pane = mounted()
    await pane.find('button.deprecate').trigger('click')
    expect(pane.emitted('deprecate')![0]).toEqual([true])
  })
})
