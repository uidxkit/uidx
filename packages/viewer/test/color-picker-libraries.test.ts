import { describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ColorPickerDialog from '../src/ColorPickerDialog.vue'
import type { VariableCandidate } from '../src/variable-binding'

/**
 * Swapping a bound colour from the keyboard: the Libraries tab's search takes
 * the caret when it opens — the letters typed next once went to the canvas as
 * tool keys — and Enter picks the first match.
 */
const swatch = (r: number, g: number, b: number) => ({ r, g, b, a: 1 })
const LIBRARIES: VariableCandidate[] = [
  {
    address: 'color#border',
    collection: 'color',
    name: 'border',
    type: 'COLOR',
    value: swatch(0.8, 0.8, 0.8),
    preview: '#cccccc',
  },
  {
    address: 'color#accent',
    collection: 'color',
    name: 'accent',
    type: 'COLOR',
    value: swatch(0, 0, 1),
    preview: '#0000ff',
  },
]

describe('the colour picker’s Libraries tab', () => {
  it('focuses its search and picks the first match on Enter', async () => {
    const dialog = mount(ColorPickerDialog, {
      attachTo: document.body,
      props: {
        color: swatch(0.8, 0.8, 0.8),
        opacity: 1,
        swatches: [],
        editable: true,
        libraries: LIBRARIES,
        currentToken: 'color#border',
      },
    })
    await flushPromises()
    const search = dialog.get('input[aria-label="search color variables"]')
    expect(document.activeElement).toBe(search.element)
    await search.setValue('acc')
    await search.trigger('keydown', { key: 'Enter' })
    expect(dialog.emitted('pick')).toEqual([['color#accent']])
    dialog.unmount()
  })
})
