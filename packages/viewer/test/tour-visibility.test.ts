import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { parseOrThrow } from '@uidx/format'

import TourCoach from '../src/TourCoach.vue'
import { componentIndex } from '../src/layer-rows'
import { goToStep, startTutorial, stopTutorial, tourRun } from '../src/tour'
import type { TourState } from '../src/tutorials'

/**
 * The coach against a panel that scrolls under a sticky header, with a colour
 * picker that can open over the next step: it waits for the picker to close
 * before moving on, scrolls the control out from under the header, stops
 * scrolling once the designer scrolls by hand, and rings only what shows.
 */

const FILL = 5
const RADIUS = 6
const OVERVIEW_2 = 10
// The Switch's two steps that both point at Layout.
const SWITCH_TRACK = 6
const SWITCH_PADDING = 7

const source = readFileSync(join(__dirname, 'fixtures/tour/button.uidx'), 'utf8')
/** The Button as Create made it, or with its colour picked. Corners still 6 either way. */
const button = (filled: boolean) =>
  parseOrThrow(
    (filled
      ? source
      : source.replace("color: '{color#accent}'", 'color: { r: 0.933, g: 0.941, b: 0.957, a: 1 }')
    ).replace('cornerRadius={999}', 'cornerRadius={6}'),
  )

let filled = false
const state = (): TourState => {
  const pages = new Map([['button.uidx', button(filled)]])
  return {
    view: 'page',
    file: 'button.uidx',
    pages,
    selection: ['Button'],
    components: componentIndex(pages.values()),
    models: undefined,
    query: () => null,
  }
}
const empty = (): TourState => ({
  view: 'page',
  file: null,
  pages: new Map(),
  selection: [],
  components: new Map(),
  models: undefined,
  query: () => null,
})

/*
 * A fake layout: each element's box comes from `data-box`, in the panel's
 * content coordinates for anything marked `data-scrolls`, so moving the
 * panel's scrollTop moves them the way a browser would. jsdom's window is
 * 1024x768; the inspector is its right-hand 280px, below a 48px app bar.
 */
const boxes: Record<string, [number, number, number, number]> = {
  panel: [744, 48, 280, 720],
  header: [744, 48, 280, 89],
  appearance: [744, 479, 280, 226],
  fill: [744, 705, 280, 99],
  // Flipped up above the Fill swatch, over Appearance.
  picker: [800, 469, 200, 285],
  // Opened inside Fill, below its swatch.
  'picker-in-fill': [800, 760, 200, 285],
  // Taller than the 631px the panel shows below its header. Placed after Fill
  // rather than above Appearance as in the editor: only its height matters.
  layout: [744, 1300, 280, 700],
  // The layers list: another panel that scrolls, on the left.
  layers: [0, 48, 240, 720],
  row: [0, 300, 240, 24],
}
let panel: HTMLElement

function fakeLayout(): void {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const element = this as HTMLElement
    const [x, raw, w, h] = boxes[element.dataset?.box ?? ''] ?? [0, 0, 0, 0]
    const y = element.closest('[data-scrolls]') ? raw - panel.scrollTop : raw
    return { left: x, top: y, width: w, height: h, right: x + w, bottom: y + h, x, y } as DOMRect
  })
}

/** The inspector: a scrolling aside, its sticky header, then Appearance, Fill and Layout. */
function inspector(): void {
  panel = document.createElement('aside')
  panel.dataset.box = 'panel'
  panel.style.overflowY = 'auto'
  const header = document.createElement('header')
  header.dataset.box = 'header'
  header.style.position = 'sticky'
  header.style.top = '0px'
  const content = document.createElement('div')
  content.dataset.scrolls = ''
  for (const [label, box] of [
    ['Appearance', 'appearance'],
    ['Fill', 'fill'],
    ['Layout', 'layout'],
  ]) {
    const section = document.createElement('div')
    section.className = 'section'
    section.setAttribute('aria-label', label!)
    section.dataset.box = box
    content.append(section)
  }
  panel.append(header, content)
  document.body.append(panel)
  // Fill centred, the way the step before left it: Appearance is under the header.
  panel.scrollTop = 400
}

function picker(box: 'picker' | 'picker-in-fill'): HTMLElement {
  const element = document.createElement('div')
  element.className = 'picker-dialog'
  element.dataset.box = box
  if (box === 'picker-in-fill') document.querySelector('[aria-label="Fill"]')!.append(element)
  else document.querySelector('[data-scrolls]')!.append(element)
  return element
}

const topOf = (label: string) =>
  document.querySelector(`[aria-label="${label}"]`)!.getBoundingClientRect().top
const appearanceTop = () => topOf('Appearance')

/** A wheel and the scroll it makes: the designer moving the panel by hand. */
function scrollByHand(to: number): void {
  panel.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 100 }))
  panel.scrollTop = to
  panel.dispatchEvent(new Event('scroll'))
}

async function wait(ms: number): Promise<void> {
  vi.advanceTimersByTime(ms)
  await nextTick()
}

let wrapper: ReturnType<typeof mount> | null = null
function coach(): ReturnType<typeof mount> {
  wrapper = mount(TourCoach, { props: { state }, attachTo: document.body })
  return wrapper
}
const card = () => wrapper!.find('.tour-card')

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  filled = false
  stopTutorial()
  inspector()
  fakeLayout()
})
afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  stopTutorial()
  document.body.innerHTML = ''
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('a popup open when the step is done', () => {
  it('holds the step, says what to close, and moves on once it closes', async () => {
    startTutorial('button', empty())
    goToStep(FILL)
    coach()
    const open = picker('picker-in-fill')
    // The first colour is committed with the picker still open.
    filled = true
    await wait(300)
    expect(card().attributes('data-done')).toBeDefined()
    expect(card().text()).toContain('close the color picker to continue')
    await wait(2000)
    expect(tourRun.value?.index).toBe(FILL)

    open.remove()
    await wait(300)
    // Reopened before the tick ran out: the wait starts again.
    const again = picker('picker-in-fill')
    await wait(2000)
    expect(tourRun.value?.index).toBe(FILL)

    again.remove()
    await wait(1300)
    expect(tourRun.value?.index).toBe(RADIUS)
  })

  it('a step already done on arrival waits for the popup too', async () => {
    filled = true
    startTutorial('button', empty())
    goToStep(FILL)
    const open = picker('picker-in-fill')
    coach()
    await wait(2000)
    expect(tourRun.value?.index).toBe(FILL)
    expect(card().attributes('data-done')).toBeDefined()
    open.remove()
    await wait(600)
    expect(tourRun.value?.index).toBe(RADIUS)
  })

  it('Next still moves on', async () => {
    filled = true
    startTutorial('button', empty())
    goToStep(FILL)
    picker('picker-in-fill')
    coach()
    await wait(300)
    await wrapper!.find('button.primary').trigger('click')
    expect(tourRun.value?.index).toBe(RADIUS)
  })

  it('a reload waits for the pages before judging a step', async () => {
    // Begun with the Button's page. A reload opens on the Overview until the
    // document arrives and the address bar's page opens: "Go to the Overview"
    // must not pass in that moment.
    startTutorial('button', state())
    goToStep(OVERVIEW_2)
    let now: TourState = { ...empty(), view: 'home' }
    wrapper = mount(TourCoach, { props: { state: () => now }, attachTo: document.body })
    await wait(2000)
    expect(tourRun.value?.index).toBe(OVERVIEW_2)
    expect(card().attributes('data-done')).toBeUndefined()
    now = state()
    await wait(2000)
    expect(tourRun.value?.index).toBe(OVERVIEW_2)
  })

  it('a popup opened just before the wait runs out still holds the step', async () => {
    startTutorial('button', empty())
    goToStep(FILL)
    coach()
    await wait(10)
    // A token picked from the token list, which closes as you pick.
    filled = true
    // The check at 250ms starts the 900ms wait; the last check before it ends is at 1000ms.
    await wait(1000)
    expect(card().attributes('data-done')).toBeDefined()
    const open = picker('picker-in-fill')
    await wait(200)
    expect(tourRun.value?.index).toBe(FILL)
    expect(card().text()).toContain('close the color picker to continue')

    open.remove()
    await wait(1300)
    expect(tourRun.value?.index).toBe(RADIUS)
  })

  it('a reload waits for the pages in a run begun on an empty project, once it has made one', async () => {
    // Nothing to wait for at the start; by the second Overview the Button's
    // page exists, so a reload showing none has not got it yet.
    startTutorial('button', empty())
    goToStep(OVERVIEW_2)
    let now: TourState = { ...empty(), view: 'home' }
    wrapper = mount(TourCoach, { props: { state: () => now }, attachTo: document.body })
    await wait(2000)
    expect(tourRun.value?.index).toBe(OVERVIEW_2)
    expect(card().attributes('data-done')).toBeUndefined()
    now = state()
    await wait(2000)
    expect(tourRun.value?.index).toBe(OVERVIEW_2)
  })
})

describe('bringing the control into view', () => {
  it('scrolls a section out from under the sticky header', async () => {
    startTutorial('button', empty())
    goToStep(RADIUS)
    coach()
    await wait(300)
    expect(panel.scrollTop).toBeLessThan(400)
    expect(appearanceTop()).toBeGreaterThanOrEqual(137)
  })

  it('tries again when the layout moves it, until the designer scrolls by hand', async () => {
    startTutorial('button', empty())
    goToStep(RADIUS)
    coach()
    await wait(300)
    const settled = panel.scrollTop
    expect(settled).toBeLessThan(400)

    // Something else moved the panel: scrolled back into view.
    panel.scrollTop = 400
    await wait(300)
    expect(panel.scrollTop).toBe(settled)

    // The designer's own wheel: left where they put it for this visit.
    document
      .querySelector('[aria-label="Fill"]')!
      .dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 100 }))
    panel.scrollTop = 400
    panel.dispatchEvent(new Event('scroll'))
    await wait(1000)
    expect(panel.scrollTop).toBe(400)
  })

  it('aligns a section taller than the panel to its top, below the header, and leaves it there', async () => {
    startTutorial('switch', empty())
    goToStep(SWITCH_TRACK)
    coach()
    await wait(300)
    expect(topOf('Layout')).toBe(137)
    const settled = panel.scrollTop
    await wait(1000)
    expect(panel.scrollTop).toBe(settled)
  })

  it('scrolls again after Next and Back, though the next step points at the same section', async () => {
    startTutorial('switch', empty())
    goToStep(SWITCH_TRACK)
    coach()
    await wait(300)
    scrollByHand(400)
    await wait(600)
    expect(panel.scrollTop).toBe(400)

    goToStep(SWITCH_PADDING)
    await wait(300)
    expect(topOf('Layout')).toBe(137)

    scrollByHand(400)
    await wait(600)
    expect(panel.scrollTop).toBe(400)
    goToStep(SWITCH_TRACK)
    await wait(300)
    expect(topOf('Layout')).toBe(137)
  })

  it('a wheel over another panel is not the designer scrolling this one', async () => {
    const layers = document.createElement('div')
    layers.dataset.box = 'layers'
    layers.style.overflowY = 'auto'
    const row = document.createElement('div')
    row.dataset.box = 'row'
    layers.append(row)
    document.body.append(layers)
    startTutorial('button', empty())
    goToStep(RADIUS)
    coach()
    await wait(300)
    const settled = panel.scrollTop

    row.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 100 }))
    layers.dispatchEvent(new Event('scroll'))
    // Then the layout moves Appearance away: still the coach's to bring back.
    panel.scrollTop = 400
    await wait(300)
    expect(panel.scrollTop).toBe(settled)
  })

  it('a press on the panel’s scrollbar is the designer scrolling; on a list inside it, not', async () => {
    startTutorial('button', empty())
    goToStep(RADIUS)
    coach()
    await wait(300)
    const settled = panel.scrollTop
    const list = document.createElement('div')
    list.style.overflowY = 'auto'
    document.querySelector('[aria-label="Fill"]')!.append(list)
    list.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    panel.scrollTop = 400
    await wait(300)
    expect(panel.scrollTop).toBe(settled)

    panel.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    panel.scrollTop = 400
    panel.dispatchEvent(new Event('scroll'))
    await wait(1000)
    expect(panel.scrollTop).toBe(400)
  })

  it('a field scrolling its own text, as you type, is not the panel scrolling', async () => {
    startTutorial('button', empty())
    goToStep(RADIUS)
    coach()
    // Settled, and long enough after the coach's own scroll not to be taken for it.
    await wait(700)
    const settled = panel.scrollTop
    const field = document.createElement('input')
    document.querySelector('[aria-label="Appearance"]')!.append(field)
    field.dispatchEvent(new KeyboardEvent('keydown', { key: '9', bubbles: true }))
    field.dispatchEvent(new Event('scroll'))
    await wait(400)

    panel.scrollTop = 400
    await wait(300)
    expect(panel.scrollTop).toBe(settled)
  })

  it('a key that scrolls the panel is the designer scrolling; the coach’s own scroll is not', async () => {
    startTutorial('button', empty())
    goToStep(RADIUS)
    coach()
    await wait(300)
    // Typing in a field, then the layout moves and the coach scrolls back. Its
    // own scroll reports itself like any other, and is not mistaken for the key's.
    panel.dispatchEvent(new KeyboardEvent('keydown', { key: '9', bubbles: true }))
    panel.scrollTop = 400
    await wait(250)
    panel.dispatchEvent(new Event('scroll'))
    panel.scrollTop = 400
    await wait(300)
    expect(panel.scrollTop).toBeLessThan(400)

    await wait(500)
    panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true }))
    panel.scrollTop = 400
    panel.dispatchEvent(new Event('scroll'))
    await wait(1000)
    expect(panel.scrollTop).toBe(400)
  })
})

describe('the ring', () => {
  const ringBox = () => {
    const style = wrapper!.find('.tour-ring').attributes('style') ?? ''
    const px = (name: string) => Number(new RegExp(`${name}: (-?[\\d.]+)px`).exec(style)?.[1])
    return { left: px('left'), top: px('top'), right: px('left') + px('width') }
  }

  it('rings only the part that shows, inside the window, and follows a scroll at once', async () => {
    startTutorial('button', empty())
    goToStep(RADIUS)
    coach()
    await wait(300)
    const before = ringBox().top
    // Scrolled by hand so Appearance's head is back under the header.
    scrollByHand(400)
    // Within a frame, not the next 250ms check: from the header's foot down.
    await wait(20)
    const ring = ringBox()
    expect(before).not.toBe(137)
    expect(ring.top).toBe(137)
    expect(ring.left).toBeGreaterThanOrEqual(744)
    expect(ring.right).toBeLessThanOrEqual(window.innerWidth)
  })

  it('is hidden while a popup covers the control, and says what to close', async () => {
    startTutorial('button', empty())
    goToStep(RADIUS)
    coach()
    await wait(300)
    expect(wrapper!.find('.tour-ring').exists()).toBe(true)
    const open = picker('picker')
    await wait(300)
    expect(wrapper!.find('.tour-ring').exists()).toBe(false)
    expect(card().text()).toContain('color picker')
    open.remove()
    await wait(300)
    expect(wrapper!.find('.tour-ring').exists()).toBe(true)
  })

  it('stays on a control whose own popup is open inside it', async () => {
    startTutorial('button', empty())
    goToStep(FILL)
    coach()
    picker('picker-in-fill')
    await wait(300)
    expect(wrapper!.find('.tour-ring').exists()).toBe(true)
  })
})
