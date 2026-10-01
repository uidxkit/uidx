import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'

import TourCoach from '../src/TourCoach.vue'
import TutorialList from '../src/TutorialList.vue'
import { completedTutorials, startTutorial, stopTutorial, tourRun } from '../src/tour'
import type { TourState } from '../src/tutorials'

/**
 * The coach, driven with a state the test controls: the card says the step,
 * moves on by itself once the step is done, and the designer can always skip
 * or close it.
 */

let view: TourState['view'] = 'page'
const state = (): TourState => ({
  view,
  file: null,
  pages: new Map(),
  selection: [],
  components: new Map(),
  models: undefined,
  query: () => null,
})

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  view = 'page'
  stopTutorial()
})
afterEach(() => {
  stopTutorial()
  vi.useRealTimers()
})

const card = (wrapper: ReturnType<typeof mount>) => wrapper.find('.tour-card')

describe('TourCoach', () => {
  it('shows the step, its count, and Next on a step that is only read', () => {
    startTutorial('button', state())
    const wrapper = mount(TourCoach, { props: { state }, attachTo: document.body })
    expect(card(wrapper).attributes('data-step')).toBe('intro')
    expect(card(wrapper).text()).toContain('1 / 15')
    expect(card(wrapper).text()).toContain('Build a Button')
    expect(wrapper.find('.tour-waiting').exists()).toBe(false)
    wrapper.unmount()
  })

  it('waits on a step, then ticks it and moves on when the editor shows it done', async () => {
    startTutorial('button', state())
    const wrapper = mount(TourCoach, { props: { state }, attachTo: document.body })
    await wrapper.find('button.primary').trigger('click')
    await nextTick()
    expect(card(wrapper).attributes('data-step')).toBe('overview')
    expect(wrapper.find('.tour-waiting').exists()).toBe(true)
    expect(wrapper.text()).toContain('Skip step')

    view = 'home'
    vi.advanceTimersByTime(300)
    await nextTick()
    expect(card(wrapper).attributes('data-done')).toBeDefined()
    vi.advanceTimersByTime(1000)
    await nextTick()
    expect(card(wrapper).attributes('data-step')).toBe('new-page')
    wrapper.unmount()
  })

  it('passes over a step already done on arrival', async () => {
    view = 'home'
    startTutorial('button', state())
    const wrapper = mount(TourCoach, { props: { state }, attachTo: document.body })
    await wrapper.find('button.primary').trigger('click')
    await nextTick()
    expect(tourRun.value?.index).toBe(1)
    vi.advanceTimersByTime(300)
    await nextTick()
    expect(tourRun.value?.index).toBe(2)
    wrapper.unmount()
  })

  it('Skip step moves on without the step done; Back returns; × closes', async () => {
    startTutorial('button', state())
    const wrapper = mount(TourCoach, { props: { state }, attachTo: document.body })
    await wrapper.find('button.primary').trigger('click')
    const skip = wrapper.findAll('button').find((b) => b.text() === 'Skip step')!
    await skip.trigger('click')
    expect(tourRun.value?.index).toBe(2)
    const back = wrapper.findAll('button').find((b) => b.text() === 'Back')!
    await back.trigger('click')
    expect(tourRun.value?.index).toBe(1)
    await wrapper.find('[aria-label="Close tutorial"]').trigger('click')
    expect(tourRun.value).toBeNull()
    wrapper.unmount()
  })
})

describe('where the card goes', () => {
  it('beside the control, but never over a popup the step opened', async () => {
    const boxes: Record<string, [number, number, number, number]> = {
      overview: [0, 70, 200, 20],
      popup: [200, 0, 400, 768],
    }
    const target = document.createElement('button')
    target.dataset.tour = 'overview'
    target.dataset.box = 'overview'
    document.body.append(target)
    const spy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element,
    ) {
      const [x, y, w, h] = boxes[(this as HTMLElement).dataset?.box ?? ''] ?? [0, 0, 0, 0]
      return { left: x, top: y, width: w, height: h, right: x + w, bottom: y + h, x, y } as DOMRect
    })
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(320)
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(180)

    startTutorial('button', state())
    const wrapper = mount(TourCoach, { props: { state }, attachTo: document.body })
    await wrapper.find('button.primary').trigger('click')
    vi.advanceTimersByTime(300)
    await nextTick()
    // No popup: right of the control.
    expect(card(wrapper).attributes('style')).toContain('left: 214px')

    const popup = document.createElement('div')
    popup.className = 'assign-popup'
    popup.dataset.box = 'popup'
    document.body.append(popup)
    vi.advanceTimersByTime(300)
    await nextTick()
    // Right, below, above and bottom-centre all cross the popup: a clear corner.
    expect(card(wrapper).attributes('style')).toContain(`left: ${window.innerWidth - 332}px`)

    wrapper.unmount()
    target.remove()
    popup.remove()
    spy.mockRestore()
    vi.restoreAllMocks()
  })
})

describe('TutorialList', () => {
  it('lists each tutorial, ticks the finished ones, and starts one on click', async () => {
    completedTutorials.value = ['switch']
    const wrapper = mount(TutorialList)
    const cards = wrapper.findAll('[data-tutorial]')
    expect(cards.map((c) => c.attributes('data-tutorial'))).toEqual(['button', 'switch', 'list'])
    expect(cards[1]!.text()).toContain('✓')
    expect(cards[0]!.text()).not.toContain('✓')
    await cards[2]!.trigger('click')
    expect(wrapper.emitted('start')).toEqual([['list']])
    completedTutorials.value = []
  })
})
