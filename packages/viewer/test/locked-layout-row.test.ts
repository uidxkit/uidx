import { enableAutoUnmount, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import LockedLayoutRow from '../src/LockedLayoutRow.vue'
import { lockedLayoutSummary } from '../src/override-state'

/**
 * An instance's inside is its component's business (ADR 0018 §1): direction,
 * gap, alignment, wrap and clipping read as one line, with a way to the
 * component instead of controls that would write nothing.
 */
enableAutoUnmount(afterEach)

const BUTTON1 = {
  layoutMode: 'HORIZONTAL',
  itemSpacing: 8,
  primaryAxisAlignItems: 'CENTER',
  counterAxisAlignItems: 'CENTER',
  layoutWrap: 'NO_WRAP',
}

describe('LockedLayoutRow', () => {
  it('renders the layout as one read-only line with a lock', () => {
    const wrapper = mount(LockedLayoutRow, { props: { layout: BUTTON1, component: 'Button1' } })
    expect(wrapper.get('.locked-summary').text()).toBe('Row · Gap 8 · center/center · No wrap')
    expect(wrapper.get('.locked-from').text()).toBe('— from Button1')
    expect(wrapper.find('[data-icon="lock"]').exists()).toBe(true)
    expect(wrapper.find('input, select, textarea').exists()).toBe(false)
    expect(wrapper.findAll('button')).toHaveLength(1)
  })

  it('emits openComponent with the component’s name', async () => {
    const wrapper = mount(LockedLayoutRow, { props: { layout: BUTTON1, component: 'Button1' } })
    await wrapper.get('button').trigger('click')
    expect(wrapper.emitted('openComponent')).toEqual([['Button1']])
  })
})

describe('lockedLayoutSummary', () => {
  it('names a column’s ends and leaves out wrap, which only a row has', () => {
    expect(
      lockedLayoutSummary({
        layoutMode: 'VERTICAL',
        itemSpacing: 4,
        primaryAxisAlignItems: 'MIN',
        counterAxisAlignItems: 'STRETCH',
      }),
    ).toBe('Column · Gap 4 · start/stretch')
  })

  it('fills what the component leaves unset with the engine’s defaults', () => {
    expect(lockedLayoutSummary({ layoutMode: 'HORIZONTAL' })).toBe(
      'Row · Gap 0 · start/start · No wrap',
    )
    expect(
      lockedLayoutSummary({
        layoutMode: 'HORIZONTAL',
        primaryAxisAlignItems: 'SPACE_BETWEEN',
        counterAxisAlignItems: 'MAX',
        layoutWrap: 'WRAP',
      }),
    ).toBe('Row · Gap 0 · space between/end · Wrap')
  })

  it('shows a token-bound gap by its name, the way a token pill does', () => {
    expect(lockedLayoutSummary({ ...BUTTON1, itemSpacing: '{space#sm}' })).toBe(
      'Row · Gap sm · center/center · No wrap',
    )
    expect(lockedLayoutSummary({ ...BUTTON1, itemSpacing: '0.5rem' })).toBe(
      'Row · Gap 0.5rem · center/center · No wrap',
    )
  })

  it('says only Free for a component that lays nothing out', () => {
    expect(lockedLayoutSummary({ layoutMode: 'NONE', itemSpacing: 8 })).toBe('Free')
    expect(lockedLayoutSummary({})).toBe('Free')
  })

  it('adds clipping when the component clips', () => {
    expect(lockedLayoutSummary({ ...BUTTON1, clipsContent: true })).toBe(
      'Row · Gap 8 · center/center · No wrap · Clips content',
    )
    expect(lockedLayoutSummary({ layoutMode: 'NONE', clipsContent: true })).toBe(
      'Free · Clips content',
    )
  })
})
