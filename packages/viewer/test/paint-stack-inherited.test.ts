import { enableAutoUnmount, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import type { JsonValue } from '@uidx/format'
import AssignPopup from '../src/AssignPopup.vue'
import ColorPickerDialog from '../src/ColorPickerDialog.vue'
import PaintStackField from '../src/PaintStackField.vue'
import type { EditableProp } from '../src/editable'

/**
 * The paint stack on an instance (ADR 0018 §7): the component's paints show
 * dimmed until the use changes them, and the first change writes the whole
 * stack — the instance owns a copy from then on, never a patch on the
 * component's. Text color is the same control held to one colour.
 */
enableAutoUnmount(afterEach)

const BLUE = { r: 0.05, g: 0.6, b: 1, a: 1 }
const GREY = { r: 0.2, g: 0.2, b: 0.2, a: 1 }
const RED = { r: 1, g: 0, b: 0, a: 1 }
const WHITE = { r: 1, g: 1, b: 1, a: 1 }

const paintField = (name: string, value: JsonValue, over: Partial<EditableProp> = {}) => ({
  name,
  label: name === 'textFills' ? 'Text color' : 'Fill',
  group: 'fill' as const,
  control: 'paint' as const,
  options: null,
  value,
  raw: '',
  boundTo: null,
  readonlyReason: null,
  authored: false,
  ...over,
})

const stack = (value: JsonValue, props: Record<string, unknown> = {}, name = 'fills') =>
  mount(PaintStackField, {
    props: { field: paintField(name, value), editable: true, swatches: [], ...props },
  })

/** Button1's two paints, as the instance inherits them. */
const BASE = { type: 'SOLID', color: BLUE }
const TINT = { type: 'SOLID', color: GREY, opacity: 0.5 }
const inheritedPair = [BASE, TINT]

describe('an inherited paint stack', () => {
  it('is marked as the component’s, so it draws dimmed', () => {
    expect(
      stack(inheritedPair, { origin: 'component' }).get('.paints').attributes('data-origin'),
    ).toBe('component')
    expect(stack(inheritedPair, { origin: 'own' }).get('.paints').attributes('data-origin')).toBe(
      'own',
    )
    // Outside an instance nothing changes.
    expect(stack(inheritedPair).get('.paints').attributes('data-origin')).toBeUndefined()
  })

  it('writes the whole resulting stack on any edit (copy-on-write)', async () => {
    const wrapper = stack(inheritedPair, { origin: 'component' })
    const rows = wrapper.findAll('.paint-row')
    // `setValue` fires the input's `change`, which is what the stack listens to.
    await rows[1]!.get('.paint-hex').setValue('#ff0000')
    await rows[0]!.get('.paint-opacity').setValue('40%')
    await rows[1]!.get('.paint-eye').trigger('click')
    expect(wrapper.emitted('commit')).toEqual([
      ['fills', [BASE, { ...TINT, color: RED }]],
      ['fills', [{ ...BASE, opacity: 0.4 }, TINT]],
      ['fills', [BASE, { ...TINT, visible: false }]],
    ])
  })

  it('previews the whole resulting stack while a colour is being chosen', async () => {
    const wrapper = stack(inheritedPair, { origin: 'component' })
    await wrapper.findAll('.paint-swatch')[0]!.trigger('click')
    wrapper.getComponent(ColorPickerDialog).vm.$emit('preview', RED, 1)
    expect(wrapper.emitted('preview')).toEqual([['fills', [{ ...BASE, color: RED }, TINT]]])
  })

  it('emits an explicit none when the last paint is removed', async () => {
    const wrapper = stack([{ type: 'SOLID', color: BLUE }], { origin: 'component' })
    await wrapper.get('.paint-remove').trigger('click')
    expect(wrapper.emitted('commit')).toEqual([['fills', []]])
  })
})

describe('a mixed stack', () => {
  it('renders one Mixed row with a split swatch', () => {
    const wrapper = stack([{ type: 'SOLID', color: BLUE }], { mixed: true })
    const rows = wrapper.findAll('.paint-row')
    expect(rows).toHaveLength(1)
    expect(rows[0]!.text()).toContain('Mixed')
    expect(rows[0]!.get('.paint-swatch').attributes('data-split')).toBe('true')
    expect(rows[0]!.find('.paint-hex').exists()).toBe(false)
    expect(rows[0]!.find('.paint-remove').exists()).toBe(false)
  })

  it('replaces the mix with the one colour chosen', async () => {
    const wrapper = stack([{ type: 'SOLID', color: BLUE }], { mixed: true })
    await wrapper.get('.paint-swatch').trigger('click')
    wrapper.getComponent(ColorPickerDialog).vm.$emit('commit', RED, 1)
    expect(wrapper.emitted('commit')).toEqual([['fills', [{ type: 'SOLID', color: RED }]]])
  })
})

describe('a single-colour stack (Text color)', () => {
  const text = (value: JsonValue, props: Record<string, unknown> = {}) =>
    stack(value, { single: true, ...props }, 'textFills')
  const tokens = new Map<string, JsonValue>([['text#onAccent', WHITE]])

  it('shows a whole-attribute token as its one row', () => {
    const wrapper = text('{text#onAccent}', { tokens })
    const rows = wrapper.findAll('.paint-row')
    expect(rows).toHaveLength(1)
    expect(rows[0]!.get('.paint-token').text()).toBe('onAccent')
  })

  it('offers no eye and no remove — reset is how it goes back', () => {
    const literal = text([{ type: 'SOLID', color: WHITE }])
    expect(literal.find('.paint-eye').exists()).toBe(false)
    expect(literal.find('.paint-remove').exists()).toBe(false)
    const token = text('{text#onAccent}', { tokens })
    expect(token.find('.paint-eye').exists()).toBe(false)
    expect(token.find('.paint-remove').exists()).toBe(false)
  })

  it('writes a picked token as the whole attribute, not a paint around it', async () => {
    const wrapper = text([{ type: 'SOLID', color: WHITE }])
    await wrapper.get('.paint-variables').trigger('click')
    wrapper.getComponent(AssignPopup).vm.$emit('variable', 'text#onAccent')
    expect(wrapper.emitted('commit')).toEqual([['textFills', '{text#onAccent}']])
  })

  it('writes a token picked inside the colour dialog the same way', async () => {
    const wrapper = text([{ type: 'SOLID', color: WHITE }])
    await wrapper.get('.paint-swatch').trigger('click')
    wrapper.getComponent(ColorPickerDialog).vm.$emit('pick', 'text#onAccent')
    expect(wrapper.emitted('commit')).toEqual([['textFills', '{text#onAccent}']])
  })

  it('detaches a token to one literal SOLID paint', async () => {
    const wrapper = text('{text#onAccent}', { tokens })
    await wrapper.get('.paint-detach').trigger('click')
    expect(wrapper.emitted('commit')).toEqual([['textFills', [{ type: 'SOLID', color: WHITE }]]])
  })

  it('turns a token into one literal SOLID paint when a colour is chosen over it', async () => {
    const wrapper = text('{text#onAccent}', { tokens })
    await wrapper.get('.paint-swatch').trigger('click')
    wrapper.getComponent(ColorPickerDialog).vm.$emit('commit', RED, 1)
    expect(wrapper.emitted('commit')).toEqual([['textFills', [{ type: 'SOLID', color: RED }]]])
  })

  it('needs no + — an empty value still offers its one row to pick from', async () => {
    const wrapper = text(null)
    const rows = wrapper.findAll('.paint-row')
    expect(rows).toHaveLength(1)
    expect(rows[0]!.text()).toContain('None')
    await rows[0]!.get('.paint-swatch').trigger('click')
    wrapper.getComponent(ColorPickerDialog).vm.$emit('commit', RED, 1)
    expect(wrapper.emitted('commit')).toEqual([['textFills', [{ type: 'SOLID', color: RED }]]])
  })

  it('writes a token picked over a mix as the whole attribute', async () => {
    const wrapper = text(null, { mixed: true })
    await wrapper.get('.paint-variables').trigger('click')
    wrapper.getComponent(AssignPopup).vm.$emit('variable', 'text#onAccent')
    expect(wrapper.emitted('commit')).toEqual([['textFills', '{text#onAccent}']])
  })
})
