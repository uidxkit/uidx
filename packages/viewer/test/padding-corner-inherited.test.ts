import { enableAutoUnmount, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import CornerField from '../src/CornerField.vue'
import PaddingField from '../src/PaddingField.vue'

/**
 * Padding and corners on an instance (ADR 0018 §7): a side or corner the use
 * has not set shows the component's value dimmed. Dimmed is not read-only —
 * editing one is how an override starts.
 */
enableAutoUnmount(afterEach)

const BUTTON1_PADDING = { top: 8, right: 12, bottom: 8, left: 12 }
const ALL_PADDING = ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft']
const LONGHANDS = ['topLeftRadius', 'topRightRadius', 'bottomRightRadius', 'bottomLeftRadius']
/** Nothing set: the shorthand is unset too, since it covers every corner. */
const ALL_CORNERS = ['cornerRadius', ...LONGHANDS]

const padding = (values = BUTTON1_PADDING, inherited?: string[]) =>
  mount(PaddingField, { props: { values, editable: true, inherited } })
const corners = (values = { top: 999, right: 999, bottom: 999, left: 999 }, inherited?: string[]) =>
  mount(CornerField, {
    props: { corners: values, perCorner: false, smoothing: 0.6, editable: true, inherited },
  })

const origin = (wrapper: ReturnType<typeof mount>, selector: string) =>
  wrapper.get(selector).attributes('data-origin')

describe('PaddingField', () => {
  it('dims an axis whose two sides are both inherited', () => {
    const wrapper = padding(BUTTON1_PADDING, ALL_PADDING)
    expect(origin(wrapper, '.padding-box[data-axis="horizontal"]')).toBe('component')
    expect(origin(wrapper, '.padding-box[data-axis="vertical"]')).toBe('component')
  })

  it('keeps an axis bright once the use sets either of its sides', () => {
    const wrapper = padding(BUTTON1_PADDING, ['paddingTop', 'paddingBottom', 'paddingRight'])
    expect(origin(wrapper, '.padding-box[data-axis="horizontal"]')).toBeUndefined()
    expect(origin(wrapper, '.padding-box[data-axis="vertical"]')).toBe('component')
  })

  it('dims exactly the listed sides once expanded', () => {
    const wrapper = padding({ ...BUTTON1_PADDING, right: 24 }, ['paddingTop', 'paddingLeft'])
    expect(wrapper.get('.padding-field').attributes('data-expanded')).toBe('true')
    expect(origin(wrapper, '.padding-box[data-side="top"]')).toBe('component')
    expect(origin(wrapper, '.padding-box[data-side="left"]')).toBe('component')
    expect(origin(wrapper, '.padding-box[data-side="right"]')).toBeUndefined()
    expect(origin(wrapper, '.padding-box[data-side="bottom"]')).toBeUndefined()
  })

  it('still edits a dimmed side', async () => {
    const wrapper = padding(BUTTON1_PADDING, ALL_PADDING)
    const box = wrapper.get('.padding-box[data-axis="horizontal"]')
    await box.get('.scrub').trigger('dblclick')
    await box.get('input').setValue('24')
    await box.get('input').trigger('blur')
    expect(wrapper.emitted('commit')!.at(-1)).toEqual([
      [
        { prop: 'paddingLeft', value: 24 },
        { prop: 'paddingRight', value: 24 },
      ],
    ])
  })

  it('looks as before outside an instance', () => {
    const wrapper = padding()
    for (const box of wrapper.findAll('.padding-box')) {
      expect(box.attributes('data-origin')).toBeUndefined()
    }
  })
})

describe('CornerField', () => {
  it('dims the one radius when all four corners are inherited', () => {
    expect(origin(corners(undefined, ALL_CORNERS), '.corner-box')).toBe('component')
    const oneSet = ALL_CORNERS.filter((prop) => prop !== 'topLeftRadius')
    expect(origin(corners(undefined, oneSet), '.corner-box')).toBeUndefined()
  })

  // `cornerRadius` is what the one box writes, and it covers every corner, so
  // a use that states it has set them all though no longhand is written.
  it('keeps the one radius bright once the use states the shorthand', () => {
    const wrapper = corners({ top: 4, right: 4, bottom: 4, left: 4 }, [
      ...LONGHANDS,
      'cornerSmoothing',
    ])
    expect(origin(wrapper, '.corner-box')).toBeUndefined()
  })

  it('keeps every corner bright under a stated shorthand once expanded', async () => {
    const wrapper = corners({ top: 4, right: 4, bottom: 4, left: 4 }, [
      ...LONGHANDS,
      'cornerSmoothing',
    ])
    await wrapper.get('.corner-expand').trigger('click')
    expect(wrapper.findAll('.corner-box[data-corner]')).toHaveLength(4)
    for (const box of wrapper.findAll('.corner-box[data-corner]')) {
      expect(box.attributes('data-origin')).toBeUndefined()
    }
    expect(origin(wrapper, '.corner-smoothing')).toBe('component')
  })

  it('dims exactly the listed corners, and smoothing, once expanded', () => {
    const wrapper = corners({ top: 4, right: 999, bottom: 999, left: 999 }, [
      'cornerRadius',
      'topRightRadius',
      'bottomRightRadius',
      'bottomLeftRadius',
      'cornerSmoothing',
    ])
    expect(wrapper.get('.corner-field').attributes('data-expanded')).toBe('true')
    expect(origin(wrapper, '.corner-box[data-corner="top"]')).toBeUndefined()
    expect(origin(wrapper, '.corner-box[data-corner="right"]')).toBe('component')
    expect(origin(wrapper, '.corner-box[data-corner="bottom"]')).toBe('component')
    expect(origin(wrapper, '.corner-box[data-corner="left"]')).toBe('component')
    expect(origin(wrapper, '.corner-smoothing')).toBe('component')
  })

  it('looks as before outside an instance', () => {
    const wrapper = corners({ top: 4, right: 999, bottom: 999, left: 999 })
    for (const box of wrapper.findAll('.corner-box, .corner-smoothing')) {
      expect(box.attributes('data-origin')).toBeUndefined()
    }
  })
})
