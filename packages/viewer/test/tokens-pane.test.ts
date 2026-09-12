import { enableAutoUnmount, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

enableAutoUnmount(afterEach)

import TokensPane from '../src/TokensPane.vue'
import type { CollectionGroup, TokenRow } from '../src/tokens-view-model'

const BLUE: TokenRow = {
  address: 'palette#blue-500',
  name: 'blue-500',
  type: 'COLOR',
  category: 'color',
  scopes: ['ALL_SCOPES'],
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
  dependents: 2,
}

const BRAND: TokenRow = {
  address: 'semantic#brand',
  name: 'brand',
  type: 'COLOR',
  category: 'color',
  scopes: ['ALL_FILLS'],
  description: '',
  deprecated: false,
  cells: [
    {
      mode: 'light',
      authored: '{palette#blue-500}',
      chain: ['palette#blue-500'],
      resolved: { r: 0.1, g: 0.4, b: 0.9, a: 1 },
    },
    {
      mode: 'dark',
      authored: '{palette#missing}',
      chain: ['palette#missing'],
      resolved: null,
      broken: 'no token at palette#missing',
    },
  ],
  file: 'core.uidx',
  dependents: 0,
}

const STALE: TokenRow = {
  ...BLUE,
  address: 'palette#stale',
  name: 'stale',
  deprecated: true,
  dependents: 0,
}

const RADIUS: TokenRow = {
  address: 'radius#md',
  name: 'md',
  type: 'FLOAT',
  category: 'radius',
  scopes: ['CORNER_RADIUS'],
  description: '',
  deprecated: false,
  cells: [{ mode: 'default', authored: 8, chain: [], resolved: 8 }],
  file: 'core.uidx',
  dependents: 0,
}

const GROUPS: CollectionGroup[] = [
  { name: 'palette', modes: ['default'], file: 'core.uidx', rows: [BLUE, STALE] },
  { name: 'semantic', modes: ['light', 'dark'], file: 'core.uidx', rows: [BRAND] },
  { name: 'radius', modes: ['default'], file: 'core.uidx', rows: [RADIUS] },
]

const mounted = (selection: string[] = [], attach = false) =>
  mount(TokensPane, {
    attachTo: attach ? document.body : undefined,
    global: { stubs: { teleport: true } },
    props: {
      groups: GROUPS,
      selection,
      canCreateCollections: true,
      aliasOptionsFor: (type: string, self: string) =>
        (type === 'FLOAT'
          ? [
              { address: 'spacing#sm', name: 'sm' },
              { address: 'radius#md', name: 'md' },
            ]
          : [{ address: 'palette#blue-500', name: 'blue-500' }]
        )
          .filter((option) => option.address !== self)
          .map((option) => ({
            ...option,
            collection: option.address.split('#')[0]!,
            type: type === 'FLOAT' ? ('FLOAT' as const) : ('COLOR' as const),
            value: type === 'FLOAT' ? 8 : BLUE.cells[0]!.resolved!,
            preview: type === 'FLOAT' ? '8' : '#1a66e6',
          })),
    },
  })

describe('TokensPane', () => {
  it('renders collections with their mode columns and rows', () => {
    const pane = mounted()
    expect(pane.text()).toContain('palette')
    expect(pane.text()).toContain('semantic')
    expect(pane.text()).toContain('light')
    expect(pane.text()).toContain('dark')
    expect(pane.text()).toContain('blue-500')
  })

  it('shows a color literal as a swatch with its value', () => {
    const pane = mounted()
    const swatch = pane.find('[data-address="palette#blue-500"] .swatch')
    expect(swatch.exists()).toBe(true)
    expect(swatch.attributes('style')).toContain('rgb')
  })

  it('shows a compact alias name, its full chain on hover, and the calculated value', () => {
    const pane = mounted()
    const cell = pane.find('[data-address="semantic#brand"][data-mode="light"]')
    expect(cell.find('.binding-trigger').text()).toBe('blue-500')
    expect(cell.find('.binding-trigger').attributes('title')).toContain('palette#blue-500')
    expect(cell.find('.swatch').exists()).toBe(true)
  })

  it('shows a broken alias as a finding, never a blank', () => {
    const pane = mounted()
    const cell = pane.find('[data-address="semantic#brand"][data-mode="dark"]')
    expect(cell.find('.finding').exists()).toBe(true)
    expect(cell.text()).toContain('no token at palette#missing')
  })

  it('strikes a deprecated row and badges it', () => {
    const pane = mounted()
    const row = pane.find('tr[data-row="palette#stale"]')
    expect(row.classes()).toContain('deprecated')
    expect(row.text()).toContain('deprecated')
  })

  it('opens details only from the trailing button and marks the selected row', async () => {
    const pane = mounted(['palette#blue-500'])
    expect(pane.find('tr[data-row="palette#blue-500"]').classes()).toContain('selected')
    await pane.find('tr[data-row="semantic#brand"]').trigger('click')
    await pane.find('tr[data-row="semantic#brand"] .token-name').trigger('click')
    expect(pane.emitted('select')).toBeUndefined()
    await pane.find('tr[data-row="semantic#brand"] .token-details-button').trigger('click')
    expect(pane.emitted('select')![0]).toEqual(['semantic#brand'])
  })

  it('opens a compact number editor on one click, and Enter emits the edit', async () => {
    const pane = mounted()
    const cell = pane.find('[data-address="radius#md"][data-mode="default"]')
    await cell.find('.value-trigger').trigger('click')
    const input = cell.find('input')
    expect(input.exists()).toBe(true)
    await input.setValue('12')
    await input.trigger('keydown', { key: 'Enter' })
    expect(pane.emitted('edit')![0]).toEqual([{ row: RADIUS, mode: 'default', value: 12 }])
  })

  it('opens the canvas picker with compatible token previews and binds the chosen token', async () => {
    const pane = mounted()
    const cell = pane.find('[data-address="radius#md"][data-mode="default"]')
    await cell.find('.choose-token').trigger('click')
    expect(pane.findAll('[data-variable]').map((o) => o.attributes('data-variable'))).toEqual([
      'spacing#sm',
    ])
    expect(pane.find('[data-variable="spacing#sm"]').text()).toContain('8')
    await pane.find('input[aria-label="search bindings"]').setValue('sm')
    await pane.find('[data-variable="spacing#sm"]').trigger('click')
    expect(pane.emitted('edit')![0]).toEqual([
      { row: RADIUS, mode: 'default', value: '{spacing#sm}' },
    ])
    expect(pane.emitted('select')).toBeUndefined()
  })

  it('Escape abandons the editor without emitting', async () => {
    const pane = mounted()
    const cell = pane.find('[data-address="radius#md"][data-mode="default"]')
    await cell.find('.value-trigger').trigger('click')
    await cell.find('input').trigger('keydown', { key: 'Escape' })
    expect(cell.find('input').exists()).toBe(false)
    expect(pane.emitted('edit')).toBeUndefined()
  })

  it('emits add-token with its collection', async () => {
    const pane = mounted()
    await pane.find('.collection button.add').trigger('click')
    expect(pane.emitted('add-token')![0]).toEqual(['palette'])
  })

  it('offers explicit collection removal without selecting a token', async () => {
    const pane = mounted()
    await pane.find('[aria-label="Remove collection palette"]').trigger('click')
    expect(pane.emitted('remove-collection')).toEqual([['palette']])
    expect(pane.emitted('select')).toBeUndefined()
    await pane.setProps({ canCreateCollections: false })
    expect(pane.find('.remove-collection').exists()).toBe(false)
  })

  it('clears a deleted collection filter so the remaining collections stay accessible', async () => {
    const pane = mounted()
    await pane.find('[aria-label="Filter by collection"]').setValue('palette')
    await pane.setProps({ groups: GROUPS.filter((group) => group.name !== 'palette') })
    expect(pane.findAll('.collection')).toHaveLength(2)
    expect(
      (pane.find('[aria-label="Filter by collection"]').element as HTMLSelectElement).value,
    ).toBe('all')
  })

  it('emits add-collection from the root action', async () => {
    const pane = mounted()
    await pane.find('button.add.root').trigger('click')
    expect(pane.emitted('add-collection')).toHaveLength(1)
  })
})

describe('token library navigation', () => {
  it('reveals a confirmed new collection through active filters and focuses its first action', async () => {
    const pane = mounted([], true)
    const scroll = vi.fn()
    Object.defineProperty(pane.find('.tokens-pane').element, 'scrollTo', { value: scroll })
    await pane.find('input[type="search"]').setValue('blue')
    await pane.find('[data-type-filter="color"]').trigger('click')
    await pane.find('[aria-label="Filter by collection"]').setValue('palette')
    await pane.find('[aria-label="Filter by tier"]').setValue('primitive')
    const created: CollectionGroup = {
      name: 'elevation',
      file: 'core.uidx',
      modes: ['default'],
      rows: [],
    }
    await pane.setProps({ groups: [...GROUPS, created] })
    // Receiving another client's collection does not navigate this client.
    expect(scroll).not.toHaveBeenCalled()
    expect(pane.find('[data-collection="elevation"]').exists()).toBe(false)

    await pane.vm.revealCollection('elevation')

    const section = pane.find('[data-collection="elevation"]')
    expect(section.classes()).toContain('just-created')
    expect(section.find('[role="status"]').text()).toBe('Collection created')
    expect(section.find('button').text()).toBe('+ Add first token')
    expect(document.activeElement).toBe(section.find('button').element)
    expect(scroll).toHaveBeenCalledOnce()
    expect(pane.findAll('.collection')).toHaveLength(4)
    expect((pane.find('input[type="search"]').element as HTMLInputElement).value).toBe('')
    expect(pane.find('button.add.root').exists()).toBe(true)
  })

  it('does not announce or focus a collection that is no longer in the document', async () => {
    const pane = mounted()
    const scroll = vi.fn()
    Object.defineProperty(pane.find('.tokens-pane').element, 'scrollTo', { value: scroll })
    await pane.vm.revealCollection('removed')
    expect(scroll).not.toHaveBeenCalled()
    expect(pane.find('.just-created').exists()).toBe(false)
  })

  it('combines search, visual type, collection, and tier filters and clears them', async () => {
    const pane = mounted()
    await pane.setProps({
      groups: GROUPS.map((group) => ({
        ...group,
        tier: group.name === 'semantic' ? 'semantic' : 'primitive',
      })),
    })
    await pane.find('[data-tier="semantic"].tier-card').trigger('click')
    expect(pane.findAll('tr[data-row]').map((row) => row.attributes('data-row'))).toEqual([
      'semantic#brand',
    ])
    await pane.find('[data-type-filter="color"]').trigger('click')
    await pane.find('input[aria-label="Search tokens"]').setValue('blue-500')
    expect(pane.find('tr[data-row="semantic#brand"]').exists()).toBe(true)
    await pane.find('select[aria-label="Filter by collection"]').setValue('radius')
    expect(pane.text()).toContain('No matching tokens')
    await pane.find('.clear-filters').trigger('click')
    expect(pane.findAll('tr[data-row]')).toHaveLength(4)
  })

  it('can filter unassigned tiers without suggesting that names declare a tier', async () => {
    const pane = mounted()
    await pane.find('select[aria-label="Filter by tier"]').setValue('unassigned')
    expect(pane.findAll('tr[data-row]')).toHaveLength(4)
    expect(pane.findAll('.tier-badge').every((badge) => badge.text() === 'No tier assigned')).toBe(
      true,
    )
  })

  it('changes a binding through the picker in the selected mode', async () => {
    const pane = mounted()
    const cell = pane.find('[data-address="semantic#brand"][data-mode="dark"]')
    await cell.find('.binding-trigger').trigger('click')
    await pane.find('[data-variable="palette#blue-500"]').trigger('click')
    expect(pane.emitted('edit')![0]).toEqual([
      { row: BRAND, mode: 'dark', value: '{palette#blue-500}' },
    ])
    expect(pane.emitted('select')).toBeUndefined()
  })

  it('keeps empty collections available for token creation', async () => {
    const pane = mounted()
    await pane.setProps({
      groups: [
        { name: 'empty', file: 'core.uidx', modes: ['default'], tier: 'semantic', rows: [] },
      ],
    })
    expect(pane.text()).toContain('This collection is ready for its first token.')
    await pane.find('.collection button.add').trigger('click')
    expect(pane.emitted('add-token')![0]).toEqual(['empty'])
  })
})

describe('unitless values', () => {
  it('does not offer pixel or rem units for font weight or opacity', async () => {
    const pane = mounted()
    const weight: TokenRow = {
      ...RADIUS,
      category: 'typography',
      scopes: ['FONT_WEIGHT'],
      cells: [{ mode: 'default', authored: 400, resolved: 400, chain: [] }],
    }
    await pane.setProps({
      groups: [{ name: 'radius', file: 'core.uidx', modes: ['default'], rows: [weight] }],
    })
    const cell = pane.find('[data-address="radius#md"]')
    expect(cell.find('select').exists()).toBe(false)
    await cell.find('.value-trigger').trigger('click')
    expect(cell.find('select').exists()).toBe(false)
    await cell.find('input').setValue('700')
    await cell.find('input').trigger('keydown', { key: 'Enter' })
    expect(pane.emitted('edit')![0]).toEqual([{ row: weight, mode: 'default', value: 700 }])
    await pane.setProps({
      groups: [
        {
          name: 'radius',
          file: 'core.uidx',
          modes: ['default'],
          rows: [{ ...weight, category: 'opacity', scopes: ['OPACITY'] }],
        },
      ],
    })
    expect(pane.find('[data-address="radius#md"] select').exists()).toBe(false)
  })
})

describe('stable value editing', () => {
  it('does not open the detail pane when clicking or editing a value', async () => {
    const pane = mounted()
    const cell = pane.find('[data-address="radius#md"]')
    await cell.trigger('click')
    expect(pane.emitted('select')).toBeUndefined()
    await cell.find('.value-trigger').trigger('click')
    expect(cell.find('input').exists()).toBe(true)
  })
})

describe('compact value controls', () => {
  it('commits a number on blur and does not emit again on unchanged focus/blur', async () => {
    const pane = mounted()
    const cell = pane.find('[data-address="radius#md"]')
    await cell.find('.value-trigger').trigger('click')
    await cell.find('input').setValue('12')
    await cell.find('.value-editor').trigger('focusout', { relatedTarget: null })
    expect(pane.emitted('edit')![0]).toEqual([{ row: RADIUS, mode: 'default', value: 12 }])
    await cell.find('.value-trigger').trigger('click')
    await cell.find('.value-editor').trigger('focusout', { relatedTarget: null })
    expect(pane.emitted('edit')).toHaveLength(1)
  })

  it('detaches using the resolved value of this mode, never a value from another mode', async () => {
    const pane = mounted()
    const light = pane.find('[data-address="semantic#brand"][data-mode="light"]')
    const dark = pane.find('[data-address="semantic#brand"][data-mode="dark"]')
    expect(dark.find('.detach-token').attributes('disabled')).toBeDefined()
    await light.find('.detach-token').trigger('click')
    expect(pane.emitted('edit')![0]).toEqual([
      { row: BRAND, mode: 'light', value: BRAND.cells[0]!.resolved },
    ])
  })

  it('keeps invalid numeric input editable and explains it without writing', async () => {
    const pane = mounted()
    const cell = pane.find('[data-address="radius#md"]')
    await cell.find('.value-trigger').trigger('click')
    await cell.find('input').setValue('oops')
    await cell.find('.save-value').trigger('click')
    expect(cell.find('input').attributes('aria-invalid')).toBe('true')
    expect(cell.find('[role="alert"]').text()).toContain('valid number')
    expect(pane.emitted('edit')).toBeUndefined()
  })

  it('allows empty strings and preserves intentional whitespace', async () => {
    const pane = mounted()
    const row: TokenRow = {
      ...RADIUS,
      type: 'STRING',
      category: 'text',
      scopes: ['TEXT_CONTENT'],
      cells: [{ mode: 'default', authored: 'hello', resolved: 'hello', chain: [] }],
    }
    await pane.setProps({
      groups: [{ name: 'radius', modes: ['default'], file: 'core.uidx', rows: [row] }],
    })
    const cell = pane.find('[data-address="radius#md"]')
    await cell.find('.value-trigger').trigger('click')
    await cell.find('input').setValue('')
    await cell.find('.save-value').trigger('click')
    expect(pane.emitted('edit')![0]).toEqual([{ row, mode: 'default', value: '' }])
    await cell.find('.value-trigger').trigger('click')
    await cell.find('input').setValue('  hello  ')
    await cell.find('.save-value').trigger('click')
    expect(pane.emitted('edit')![1]).toEqual([{ row, mode: 'default', value: '  hello  ' }])
  })

  it('opens a boolean alias in the picker instead of toggling and detaching it', async () => {
    const pane = mounted()
    const row: TokenRow = {
      ...RADIUS,
      type: 'BOOLEAN',
      category: 'toggle',
      scopes: ['ALL_SCOPES'],
      cells: [{ mode: 'default', authored: '{flags#on}', resolved: true, chain: ['flags#on'] }],
    }
    await pane.setProps({
      groups: [{ name: 'radius', modes: ['default'], file: 'core.uidx', rows: [row] }],
    })
    await pane.find('[data-address="radius#md"] .binding-trigger').trigger('click')
    expect(pane.find('.assign-popup').exists()).toBe(true)
    expect(pane.emitted('edit')).toBeUndefined()
  })
})
