import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import { mount } from '@vue/test-utils'
import ErrorBoundary from '../src/ErrorBoundary.vue'

/** Throws on render when told to — stands in for the SDK blowing up. */
const Bomb = defineComponent({
  props: { armed: { type: Boolean, default: true } },
  setup(props) {
    return () => {
      if (props.armed) throw new Error('canvaskit exploded')
      return h('div', { class: 'ok' }, 'rendered')
    }
  },
})

const Sibling = defineComponent({
  setup: () => () => h('div', { class: 'sibling' }, 'intent pane'),
})

describe('ErrorBoundary', () => {
  it('renders its slot when nothing goes wrong', () => {
    const wrapper = mount(ErrorBoundary, {
      props: { pane: 'Canvas' },
      slots: { default: () => h(Bomb, { armed: false }) },
    })
    expect(wrapper.find('.ok').exists()).toBe(true)
    expect(wrapper.find('.boundary').exists()).toBe(false)
  })

  it('catches a throw and shows a fallback instead of collapsing', async () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const wrapper = mount(ErrorBoundary, {
      props: { pane: 'Canvas' },
      slots: { default: () => h(Bomb) },
    })
    // The fallback appears on the tick after the throw: errorCaptured runs
    // during the failed render, and the boundary re-renders in response.
    await nextTick()
    expect(wrapper.find('.boundary').exists()).toBe(true)
    expect(wrapper.text()).toContain('Canvas failed to render')
    expect(wrapper.text()).toContain('canvaskit exploded')
    spy.mockRestore()
  })

  it('keeps sibling panes alive — the point of spec §11', async () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const App = defineComponent({
      setup: () => () =>
        h('div', [h(Sibling), h(ErrorBoundary, { pane: 'Canvas' }, { default: () => h(Bomb) })]),
    })
    const wrapper = mount(App)
    await nextTick()
    expect(wrapper.find('.boundary').exists()).toBe(true)
    // The whole reason this component exists: a dead canvas must not take the
    // component's documented intent down with it.
    expect(wrapper.find('.sibling').exists()).toBe(true)
    expect(wrapper.text()).toContain('intent pane')
    spy.mockRestore()
  })

  it('does not let the error escape to an outer boundary', async () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const outerSaw = ref(false)
    const Outer = defineComponent({
      errorCaptured() {
        outerSaw.value = true
        return false
      },
      setup: () => () => h(ErrorBoundary, { pane: 'Canvas' }, { default: () => h(Bomb) }),
    })
    mount(Outer)
    await nextTick()
    expect(outerSaw.value).toBe(false)
    spy.mockRestore()
  })

  it('recovers when retried after the cause is gone', async () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const armed = ref(true)
    const wrapper = mount(ErrorBoundary, {
      props: { pane: 'Canvas' },
      slots: { default: () => h(Bomb, { armed: armed.value }) },
    })
    await nextTick()
    expect(wrapper.find('.boundary').exists()).toBe(true)

    armed.value = false
    await wrapper.find('button').trigger('click')
    await nextTick()

    expect(wrapper.find('.ok').exists()).toBe(true)
    expect(wrapper.find('.boundary').exists()).toBe(false)
    spy.mockRestore()
  })
})
