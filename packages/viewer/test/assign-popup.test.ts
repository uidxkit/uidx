import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import AssignPopup from '../src/AssignPopup.vue'
import type { VariableCandidate } from '../src/variable-binding'

const VARIABLES: VariableCandidate[] = [
  { address: 'radius#md', collection: 'radius', name: 'md', type: 'FLOAT', value: 8, preview: '8' },
  {
    address: 'radius#lg',
    collection: 'radius',
    name: 'lg',
    type: 'FLOAT',
    value: 16,
    preview: '16',
  },
  { address: 'space#sm', collection: 'space', name: 'sm', type: 'FLOAT', value: 4, preview: '4' },
]

const CANDIDATES = [
  { name: 'Label', declaration: { type: 'TEXT', default: 'Accept terms' } },
  { name: 'Description', declaration: { type: 'TEXT', default: 'You agree' } },
]

function popup(overrides = {}) {
  return mount(AssignPopup, {
    props: {
      candidates: CANDIDATES,
      componentName: 'Checkbox Field',
      variables: VARIABLES,
      boundTo: null,
      icon: 'prop-text' as const,
      ...overrides,
    },
  })
}

describe('assign popup', () => {
  it('groups properties under the component and variables by collection', () => {
    const wrapper = popup()
    expect(wrapper.text()).toContain('Properties in Checkbox Field')
    expect(wrapper.findAll('.popup-collection').map((c) => c.text())).toEqual(['radius', 'space'])
    expect(wrapper.findAll('[data-variable]')).toHaveLength(3)
  })

  it('previews a property default and a variable value', () => {
    const wrapper = popup()
    expect(wrapper.text()).toContain('Accept terms')
    expect(wrapper.find('[data-variable="radius#md"]').text()).toContain('8')
  })

  it('filters both groups as the query types', async () => {
    const wrapper = popup()
    await wrapper.find('input').setValue('md')
    expect(wrapper.findAll('[data-variable]')).toHaveLength(1)
    expect(wrapper.findAll('.popup-row:not(.variable-row)')).toHaveLength(0)
  })

  it('emits the choice and highlights the current binding', async () => {
    const wrapper = popup({ boundTo: 'radius#md' })
    expect(wrapper.find('[data-variable="radius#md"]').classes()).toContain('current')
    await wrapper.find('[data-variable="radius#lg"]').trigger('click')
    expect(wrapper.emitted('variable')![0]).toEqual(['radius#lg'])
    await wrapper.find('.popup-row:not(.variable-row)').trigger('click')
    expect(wrapper.emitted('property')![0]).toEqual(['Label'])
    await wrapper.find('.popup-create').trigger('click')
    expect(wrapper.emitted('create')).toBeTruthy()
  })

  /**
   * Each property row carries its own ⚙ — Figma's placement for "edit this
   * property". The stop on its click is what keeps the ⚙ from also picking
   * the row it sits in: an edit must not move the binding.
   */
  it('offers editing a property from its row, without picking it', async () => {
    const wrapper = popup()
    await wrapper.find('.popup-row .row-edit').trigger('click')
    expect(wrapper.emitted('edit')![0]).toEqual(['Label'])
    expect(wrapper.emitted('property')).toBeUndefined()
  })

  it('hides the property group entirely when candidates are null', () => {
    const wrapper = popup({ candidates: null })
    expect(wrapper.text()).not.toContain('Properties in')
    expect(wrapper.find('.popup-create').exists()).toBe(false)
  })
})
