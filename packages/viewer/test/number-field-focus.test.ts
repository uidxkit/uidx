import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import SizeField from '../src/SizeField.vue'

enableAutoUnmount(afterEach)

/**
 * A click on a panel number opens its edit box, and the box must have the
 * caret: these fields render their own `<input>`, which the number-field
 * library does not focus. Unfocused, the digits a designer typed next went to
 * the layer tree, where Enter renames — a width of 20 became a layer named 20.
 */
describe('a panel number field', () => {
  it('puts the caret in its edit box, value selected, once it opens', async () => {
    const field = mount(SizeField, {
      attachTo: document.body,
      props: {
        dimension: 'width',
        value: 34,
        sizingMode: 'FIXED',
        sizingProp: 'counterAxisSizingMode',
        modes: null,
        editable: true,
      },
    })
    // Focus is what a click's pointerdown gives the box, and what Tab gives it.
    ;(field.get('[role=spinbutton]').element as HTMLElement).focus()
    await flushPromises()
    await new Promise((resolve) => setTimeout(resolve, 0))
    const input = field.get<HTMLInputElement>('input.number-input').element
    expect(document.activeElement).toBe(input)
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 2])
  })
})
