import { shallowRef } from 'vue'
import { DOMWrapper, enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import FontFamilyField from '../src/FontFamilyField.vue'
import { openFontsKey, projectFonts, refreshFontLibrary } from '../src/font-library'

vi.mock('../src/font-library', () => ({
  openFontsKey: Symbol('open-fonts'),
  projectFonts: shallowRef([]),
  refreshFontLibrary: vi.fn(),
}))
enableAutoUnmount(afterEach)
beforeEach(() => {
  vi.resetAllMocks()
  HTMLElement.prototype.scrollIntoView = vi.fn()
  projectFonts.value = [400, 700].map((weight) => ({
    id: `lora-${weight}`,
    family: 'Lora',
    style: weight === 400 ? 'Regular' : 'Bold',
    weight,
    italic: false,
    source: 'google',
    file: `${weight}.ttf`,
  }))
})
const popup = () => new DOMWrapper(document.querySelector<HTMLElement>('[role="dialog"]')!)
const mounted = (props = {}, manage = vi.fn()) =>
  mount(FontFamilyField, {
    attachTo: document.body,
    props: { modelValue: 'Inter', ...props },
    global: { provide: { [openFontsKey as symbol]: manage } },
  })
async function open(wrapper: ReturnType<typeof mounted>) {
  await wrapper.get('button').trigger('click')
  await flushPromises()
  return popup()
}

describe('font family picker', () => {
  it('lists each available family once and commits a click without opening the manager', async () => {
    const manage = vi.fn()
    const wrapper = mounted({}, manage)
    const picker = await open(wrapper)
    expect(document.activeElement).toBe(picker.get('input').element)
    expect(picker.find('form').exists()).toBe(false)
    expect(picker.findAll('[role="option"]').map((row) => row.text())).toEqual([
      '✓InterBundled',
      'Lora',
    ])
    expect(picker.get('[aria-selected="true"]').text()).toContain('Inter')
    await picker.get('input').setValue(' loRA ')
    await picker.get('[role="option"]').trigger('click')
    expect(wrapper.emitted('commit')).toEqual([['Lora']])
    expect(wrapper.get('button').attributes('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(wrapper.get('button').element)
    expect(manage).not.toHaveBeenCalled()
  })

  it('supports arrow-key selection and clears search before Escape dismisses', async () => {
    const wrapper = mounted()
    await wrapper.get('button').trigger('keydown', { key: 'ArrowDown' })
    await flushPromises()
    const picker = popup()
    const search = picker.get('input')
    await search.trigger('keydown', { key: 'ArrowDown' })
    expect(picker.get('.active').text()).toBe('Lora')
    await search.trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('commit')).toEqual([['Lora']])
    const reopened = await open(wrapper)
    await reopened.get('input').setValue('absent')
    expect(reopened.get('[role="status"]').text()).toBe('No matching fonts')
    await reopened.get('input').trigger('keydown', { key: 'Escape' })
    expect(reopened.findAll('[role="option"]')).toHaveLength(2)
    await reopened.get('input').trigger('keydown', { key: 'Escape' })
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(wrapper.get('button').element)
  })

  it('dismisses on an outside pointer or the same trigger without committing', async () => {
    const wrapper = mounted()
    await open(wrapper)
    await wrapper.get('button').trigger('pointerdown')
    ;(wrapper.get('button').element as HTMLButtonElement).focus()
    await flushPromises()
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    await wrapper.get('button').trigger('click')
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    await open(wrapper)
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    await flushPromises()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(wrapper.emitted('commit')).toBeUndefined()
  })

  it('opens the Fonts page from Manage fonts and prevents unavailable font choices', async () => {
    const manage = vi.fn()
    const wrapper = mounted({ modelValue: 'Missing face' }, manage)
    const picker = await open(wrapper)
    expect(picker.get('[aria-selected="true"]').attributes('disabled')).toBeDefined()
    await picker.get('[aria-selected="true"]').trigger('click')
    expect(wrapper.emitted('commit')).toBeUndefined()
    await picker.get('.manage').trigger('click')
    expect(manage).toHaveBeenCalledOnce()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it('keeps cached fonts available when refresh fails and allows retry', async () => {
    vi.mocked(refreshFontLibrary).mockRejectedValueOnce(new Error('Offline'))
    const wrapper = mounted()
    const picker = await open(wrapper)
    expect(picker.get('[role="alert"]').text()).toContain('Could not refresh fonts.')
    expect(picker.findAll('[role="option"]')).toHaveLength(2)
    await picker.get('[role="alert"] button').trigger('click')
    await flushPromises()
    expect(picker.find('[role="alert"]').exists()).toBe(false)
  })

  it('fits above a field near the viewport bottom and respects disabled fields', async () => {
    const wrapper = mounted()
    vi.spyOn(wrapper.get('button').element, 'getBoundingClientRect').mockReturnValue({
      top: window.innerHeight - 40,
      bottom: window.innerHeight - 12,
      left: 0,
      right: 90,
      width: 90,
      height: 28,
      x: 0,
      y: window.innerHeight - 40,
      toJSON: () => ({}),
    })
    const picker = await open(wrapper)
    const style = (picker.element as HTMLElement).style
    expect(style.width).toBe('240px')
    expect(style.left).toBe('8px')
    expect(style.bottom).toBe('44px')
    await wrapper.setProps({ disabled: true })
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    await wrapper.get('button').trigger('click')
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })
})
