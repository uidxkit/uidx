import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { enableAutoUnmount, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import type { JsonValue } from '@uidx/format'
import OverrideMark from '../src/OverrideMark.vue'
import PaintStackField from '../src/PaintStackField.vue'
import PropertyField from '../src/PropertyField.vue'
import type { EditableProp } from '../src/editable'
import {
  inheritedText,
  overrideState,
  resetTitle,
  shadowNote,
  type OverrideState,
} from '../src/override-state'

/**
 * The mark an instance row wears beside its caption (ADR 0018 §7): nothing
 * while the component's value shows, a dot and ↺ once the use states one, and
 * a state chip when a state the instance's own props select wins the property.
 */
enableAutoUnmount(afterEach)

const mark = (props: Record<string, unknown> = {}) =>
  mount(OverrideMark, {
    props: {
      state: 'set' as OverrideState,
      component: 'Button1',
      inherited: '12',
      shadowedBy: null,
      label: 'Weight',
      writable: true,
      ...props,
    },
  })

/**
 * The declarations every rule naming `selector` carries in a component's
 * `<style>` block. jsdom applies no SFC styles, so a look the plan pins (a 6px
 * accent dot, the reset's shared look) is read where it is written.
 */
function declarations(file: string, selector: string): string[] {
  const source = readFileSync(join(__dirname, '../src', file), 'utf8')
  const style = source.slice(source.indexOf('<style')).replace(/\/\*[\s\S]*?\*\//g, '')
  const out: string[] = []
  for (const [, selectors, body] of style.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (!selectors!.split(',').some((s) => s.replace(/<style[^>]*>/, '').trim() === selector))
      continue
    out.push(
      ...body!
        .split(';')
        .map((d) => d.trim().replace(/\s+/g, ' '))
        .filter(Boolean),
    )
  }
  return out
}

describe('OverrideMark', () => {
  it('renders nothing while the use inherits the value', () => {
    const wrapper = mark({ state: 'inherited' })
    expect(wrapper.find('.override-mark').exists()).toBe(false)
    expect(wrapper.find('button').exists()).toBe(false)
  })

  it('shows a 6px accent dot and a reset for a value the use sets', () => {
    const wrapper = mark()
    expect(wrapper.get('.override-mark').attributes('data-override')).toBe('set')
    expect(wrapper.find('.override-dot').exists()).toBe(true)
    expect(wrapper.find('.state-chip').exists()).toBe(false)
    expect(wrapper.get('button.reset').text()).toBe('↺')
    const dot = declarations('OverrideMark.vue', '.override-dot')
    expect(dot).toContain('width: 6px')
    expect(dot).toContain('height: 6px')
    expect(dot).toContain('background: var(--accent)')
  })

  it('shows the winning state as a warn chip when a state row hides the value', () => {
    const wrapper = mark({ state: 'shadowed', shadowedBy: 'hover' })
    expect(wrapper.get('.override-mark').attributes('data-override')).toBe('shadowed')
    expect(wrapper.find('.override-dot').exists()).toBe(false)
    expect(wrapper.get('.state-chip').text()).toBe('hover')
    expect(wrapper.get('.state-chip').attributes('title')).toBe(shadowNote('hover'))
    // The use's value is still there, showing in every other state — so it
    // can still be reset.
    expect(wrapper.find('button.reset').exists()).toBe(true)
    expect(declarations('OverrideMark.vue', '.state-chip').join(';')).toContain('var(--warn)')
  })

  it('emits reset from ↺, titled with what the row goes back to', async () => {
    const wrapper = mark()
    const reset = wrapper.get('button.reset')
    expect(reset.attributes('title')).toBe('Reset to Button1 — 12')
    expect(reset.attributes('aria-label')).toBe('Reset Weight')
    await reset.trigger('click')
    expect(wrapper.emitted('reset')).toEqual([[]])
  })

  it('is disabled when the pane is not writable', async () => {
    const wrapper = mark({ writable: false })
    const reset = wrapper.get('button.reset')
    expect(reset.attributes('disabled')).toBeDefined()
    await reset.trigger('click')
    expect(wrapper.emitted('reset')).toBeUndefined()
  })

  it("wears InstancePropsSection's reset look, so the two ↺ read as one control", () => {
    for (const selector of ['.reset', '.reset:hover:not(:disabled)']) {
      const own = declarations('OverrideMark.vue', selector)
      expect(own.length, selector).toBeGreaterThan(0)
      expect(own, selector).toEqual(declarations('InstancePropsSection.vue', selector))
    }
  })
})

describe('override state', () => {
  it('reads a row as inherited, set, or hidden by a state', () => {
    expect(overrideState('own', null)).toBe('set')
    expect(overrideState('own', { state: 'checked' })).toBe('shadowed')
    // A state that sets what the use never touched is the section note's
    // business, not this row's: there is nothing of the use's to hide.
    expect(overrideState('component', { state: 'checked' })).toBe('inherited')
    expect(overrideState('component', null)).toBe('inherited')
    expect(overrideState('engine', null)).toBe('inherited')
  })

  it('words the reset title and the shadow note', () => {
    expect(resetTitle('Button1', '12')).toBe('Reset to Button1 — 12')
    expect(resetTitle('Button1', null)).toBe('Reset to Button1')
    expect(shadowNote('checked')).toBe(
      'The ‘checked’ state sets this; your value shows in the other states',
    )
  })

  it('shows the inherited value the way the row would', () => {
    expect(inheritedText(12)).toBe('12')
    expect(inheritedText('INSIDE')).toBe('INSIDE')
    expect(inheritedText('{space#lg}')).toBe('space#lg')
    expect(inheritedText([{ type: 'SOLID', color: { r: 0, g: 0.6, b: 1, a: 1 } }])).toBe('#0099ff')
    expect(inheritedText([{ type: 'SOLID', color: '{surface#danger}' }])).toBe('surface#danger')
    expect(inheritedText([{ type: 'GRADIENT_LINEAR', gradientStops: [] }] as JsonValue)).toBe(
      'Gradient',
    )
    expect(inheritedText([])).toBe('none')
    expect(inheritedText(null)).toBeNull()
  })
})

describe('PropertyField with an override', () => {
  const weight = (over: Partial<EditableProp> = {}): EditableProp => ({
    name: 'strokeWeight',
    label: 'Weight',
    group: 'stroke',
    control: 'number',
    options: null,
    value: 1,
    raw: '',
    boundTo: null,
    readonlyReason: null,
    authored: false,
    ...over,
  })
  const field = (props: Record<string, unknown> = {}) =>
    mount(PropertyField, {
      props: {
        field: weight(),
        resolvedValue: 1,
        heldValue: null,
        editable: true,
        ...props,
      },
    })
  const context = { component: 'Button1', inherited: '1', shadowedBy: null }

  it('shows the mark in its caption for a set row and forwards reset', async () => {
    const wrapper = field({
      field: weight({ value: 2, authored: true }),
      override: 'set',
      overrideContext: context,
    })
    const caption = wrapper.get('.field-caption')
    expect(caption.get('label').text()).toBe('Weight')
    expect(caption.find('.override-dot').exists()).toBe(true)
    expect(caption.get('button.reset').attributes('title')).toBe('Reset to Button1 — 1')
    await caption.get('button.reset').trigger('click')
    expect(wrapper.emitted('reset')).toEqual([['strokeWeight']])
  })

  it('shows the state chip in its caption for a shadowed row', () => {
    const wrapper = field({
      field: weight({ value: 2, authored: true }),
      override: 'shadowed',
      overrideContext: { ...context, shadowedBy: 'hover' },
    })
    expect(wrapper.get('.field-caption .state-chip').text()).toBe('hover')
  })

  it('dims an inherited value and draws no mark', () => {
    const wrapper = field({ override: 'inherited', overrideContext: context })
    expect(wrapper.find('.override-mark').exists()).toBe(false)
    expect(wrapper.get('[data-field="strokeWeight"]').attributes('data-origin')).toBe('component')
  })

  it('disables the reset with the field', () => {
    const wrapper = field({
      field: weight({ value: 2, authored: true }),
      editable: false,
      override: 'set',
      overrideContext: context,
    })
    expect(wrapper.get('button.reset').attributes('disabled')).toBeDefined()
  })

  it('renders exactly as before outside an instance', () => {
    const wrapper = field()
    expect(wrapper.get('.field-caption').element.tagName).toBe('LABEL')
    expect(wrapper.get('.field-caption').text()).toBe('Weight')
    expect(wrapper.find('.override-mark').exists()).toBe(false)
    expect(wrapper.get('[data-field="strokeWeight"]').attributes('data-origin')).toBeUndefined()
  })

  it('hands an inherited paint stack its origin, and the Text color modes through', () => {
    const paint = weight({
      name: 'textFills',
      label: 'Text color',
      group: 'fill',
      control: 'paint',
      value: null,
    })
    const inherited = field({ field: paint, override: 'inherited', overrideContext: context })
    expect(inherited.getComponent(PaintStackField).props('origin')).toBe('component')
    const own = field({
      field: paint,
      override: 'set',
      overrideContext: context,
      single: true,
      mixed: true,
    })
    expect(own.getComponent(PaintStackField).props('origin')).toBe('own')
    expect(own.getComponent(PaintStackField).props('single')).toBe(true)
    expect(own.getComponent(PaintStackField).props('mixed')).toBe(true)
    expect(field({ field: paint }).getComponent(PaintStackField).props('origin')).toBeUndefined()
  })

  it('keeps a token-bound Text color in its one-colour stack, not the generic pill', () => {
    // `editableProps` turns any whole-attribute alias into a number-shaped
    // token row; the pill's detach would then write a bare colour, which is
    // not a paint. Text color's token belongs to the stack.
    const bound = weight({
      name: 'textFills',
      label: 'Text color',
      group: 'fill',
      control: 'number',
      value: '{text#onAccent}',
      boundTo: 'text#onAccent',
      authored: true,
    })
    const wrapper = field({ field: bound, override: 'set', overrideContext: context, single: true })
    expect(wrapper.find('.token-pill').exists()).toBe(false)
    expect(wrapper.find('.field-caption').exists()).toBe(false)
    expect(wrapper.getComponent(PaintStackField).find('.paint-token').text()).toBe('onAccent')
  })
})
