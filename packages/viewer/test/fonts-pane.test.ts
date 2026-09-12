import { computed, shallowRef } from 'vue'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import FontsPane from '../src/FontsPane.vue'
import {
  fontsInFileKey,
  importGoogleFont,
  projectFonts,
  refreshFontLibrary,
} from '../src/font-library'

vi.mock('../src/font-library', () => ({
  fontsInFileKey: Symbol('fonts'),
  projectFonts: shallowRef([]),
  refreshFontLibrary: vi.fn(),
  importGoogleFont: vi.fn(),
  removeFont: vi.fn(),
  uploadFont: vi.fn(),
}))
enableAutoUnmount(afterEach)
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = vi.fn()
})
beforeEach(() => {
  vi.clearAllMocks()
  projectFonts.value = [
    {
      id: 'test',
      family: 'Lora',
      style: 'Regular',
      weight: 400,
      italic: false,
      source: 'google',
      file: 'test.ttf',
    },
  ]
})
const mounted = (picking = false) =>
  mount(FontsPane, {
    attachTo: document.body,
    props: { selected: 'Inter', picking },
    global: { provide: { [fontsInFileKey as symbol]: computed(() => ['Missing Face', 'Inter']) } },
  })

describe('font library dialog', () => {
  it('renders a workspace page without a modal or close button', async () => {
    const wrapper = mounted()
    await flushPromises()
    expect(wrapper.find('main.font-page').exists()).toBe(true)
    expect(wrapper.find('dialog').exists()).toBe(false)
    expect(wrapper.find('[aria-label="Close fonts"]').exists()).toBe(false)
  })
  it('searches and filters font families, showing missing fonts in this file', async () => {
    const wrapper = mounted()
    await flushPromises()
    expect(refreshFontLibrary).toHaveBeenCalled()
    await wrapper.get('[aria-label="Filter fonts"]').setValue('file')
    expect(wrapper.findAll('.font-option').map((option) => option.text())).toEqual([
      'InterBundled · 4 styles',
      'Missing FaceMissing · import this font',
    ])
    await wrapper.get('[aria-label="Search fonts"]').setValue('absent')
    expect(wrapper.text()).toContain('No matching fonts')
  })
  it('previews without applying and applies only an available family on selection', async () => {
    const wrapper = mounted(true)
    await flushPromises()
    const lora = wrapper.findAll('.font-option').find((option) => option.text().startsWith('Lora'))!
    await lora.trigger('mouseenter')
    expect(wrapper.emitted('select')).toBeUndefined()
    await lora.trigger('click')
    expect(wrapper.emitted('select')).toEqual([['Lora']])
    expect(wrapper.emitted('close')).toHaveLength(1)
  })
  it('imports the requested Google style and announces success', async () => {
    vi.mocked(importGoogleFont).mockResolvedValue(projectFonts.value[0]!)
    const wrapper = mounted(true)
    await flushPromises()
    await wrapper.findAll('nav button')[1]!.trigger('click')
    await wrapper.get('input[list="google-families"]').setValue('Lora')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(importGoogleFont).toHaveBeenCalledWith('Lora', 400, false)
    expect(wrapper.text()).toContain('Lora Regular is ready to use.')
  })
  it('shows import errors and closes on Escape', async () => {
    vi.mocked(importGoogleFont).mockRejectedValue(new Error('Font unavailable'))
    const wrapper = mounted(true)
    await flushPromises()
    await wrapper.findAll('nav button')[1]!.trigger('click')
    await wrapper.get('input[list="google-families"]').setValue('Unknown')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toBe('Font unavailable')
    await wrapper.get('dialog').trigger('cancel')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })
})
