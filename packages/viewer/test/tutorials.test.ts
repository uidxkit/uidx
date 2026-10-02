import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { parseOrThrow, type UidxDocument } from '@uidx/format'
import { modelIndex } from '@uidx/schema'

import { componentIndex } from '../src/layer-rows'
import {
  finishTutorial,
  goToStep,
  startTutorial,
  stopTutorial,
  completedTutorials,
  tourRun,
} from '../src/tour'
import {
  awaitingDocument,
  snapshot,
  TUTORIALS,
  type TourState,
  type Tutorial,
} from '../src/tutorials'

/**
 * The tutorials' steps, judged against the files a designer actually ends up
 * with. The fixtures are what the three tours produced when walked through
 * the running editor, so a step that says "done" here says so for real work.
 */

const fixture = (name: string): UidxDocument =>
  parseOrThrow(readFileSync(join(__dirname, 'fixtures/tour', `${name}.uidx`), 'utf8'))

function stateOf(
  files: Record<string, UidxDocument>,
  overrides: Partial<TourState> = {},
): TourState {
  const pages = new Map(Object.entries(files))
  return {
    view: 'home',
    file: null,
    pages,
    selection: [],
    components: componentIndex(pages.values()),
    models: modelIndex(pages.values()),
    query: () => null,
    ...overrides,
  }
}

const tutorial = (id: string): Tutorial => TUTORIALS.find((candidate) => candidate.id === id)!
const step = (tour: Tutorial, id: string) => tour.steps.find((candidate) => candidate.id === id)!

const EMPTY = stateOf({})
const START = snapshot(EMPTY)

describe('the tutorials', () => {
  it('offers the three, each step with words, and ids unique within a tutorial', () => {
    expect(TUTORIALS.map((t) => t.id)).toEqual(['button', 'switch', 'list'])
    for (const tour of TUTORIALS) {
      expect(new Set(tour.steps.map((s) => s.id)).size).toBe(tour.steps.length)
      for (const s of tour.steps) expect(s.title && s.body).toBeTruthy()
      // The last step is read, not waited on: it is where Finish lives.
      expect(tour.steps.at(-1)!.done).toBeUndefined()
    }
  })

  it('remembers what existed at the start, so only what the designer made counts', () => {
    const button = tutorial('button')
    const made = stateOf(
      { 'button.uidx': fixture('button') },
      { view: 'page', file: 'button.uidx' },
    )
    expect(step(button, 'create').done!(made, START)).toBe(true)
    // A Button already there before the run is not the one this run made.
    expect(step(button, 'create').done!(made, snapshot(made))).toBe(false)
  })

  it('button: each styling step is done in the finished file, and not before', () => {
    const button = tutorial('button')
    const starter = stateOf(
      {
        'button.uidx': parseOrThrow(
          fixture('button')
            .source.replace(
              "color: '{color#accent}'",
              'color: { r: 0.933, g: 0.941, b: 0.957, a: 1 }',
            )
            .replace('cornerRadius={999}', 'cornerRadius={6}')
            .replace(/<Styles>[\s\S]*<\/Styles>/, ''),
        ),
      },
      { view: 'page', file: 'button.uidx' },
    )
    const finished = stateOf(
      { 'button.uidx': fixture('button') },
      { view: 'page', file: 'button.uidx' },
    )
    for (const id of ['fill', 'radius', 'hover', 'hover-style']) {
      expect(step(button, id).done!(starter, START), id).toBe(false)
      expect(step(button, id).done!(finished, START), id).toBe(true)
    }
  })

  it('button: placing it on a new page and giving it words', () => {
    const button = tutorial('button')
    const files = { 'button.uidx': fixture('button'), 'screen.uidx': fixture('screen') }
    const onScreen = stateOf(files, { view: 'page', file: 'screen.uidx' })
    expect(step(button, 'screen').done!(onScreen, START)).toBe(true)
    expect(step(button, 'place').done!(onScreen, START)).toBe(true)
    expect(step(button, 'words').done!(onScreen, START)).toBe(true)
    // The Button's own page is not "a page to use it on".
    const onOwn = stateOf(files, { view: 'page', file: 'button.uidx' })
    expect(step(button, 'screen').done!(onOwn, START)).toBe(false)
  })

  it('switch: track, knob, checked prop and its look all read from the file', () => {
    const tour = tutorial('switch')
    const done = stateOf(
      { 'switch.uidx': fixture('switch') },
      { view: 'page', file: 'switch.uidx' },
    )
    for (const id of [
      'remove-label',
      'track',
      'padding',
      'start',
      'knob',
      'knob-size',
      'checked',
      'visual',
      'on-style',
    ])
      expect(step(tour, id).done!(done, START), id).toBe(true)
  })

  it('list: model, field, items, column, repeat and the binding', () => {
    const tour = tutorial('list')
    const done = stateOf(
      { 'people.uidx': fixture('people') },
      { view: 'page', file: 'people.uidx' },
    )
    for (const id of ['model', 'field', 'items', 'design', 'column', 'repeat', 'bind'])
      expect(step(tour, id).done!(done, START), id).toBe(true)
    // Bound to the component's own prop, not the row: not done yet.
    const unbound = stateOf(
      {
        'people.uidx': parseOrThrow(
          fixture('people').source.replace('characters="{item.name}"', 'characters="{label}"'),
        ),
      },
      { view: 'page', file: 'people.uidx' },
    )
    expect(step(tour, 'bind').done!(unbound, START)).toBe(false)
    expect(step(tour, 'repeat').done!(unbound, START)).toBe(true)
  })

  it('nothing is done in an editor still waiting for its pages', () => {
    // A reload: the canvas already names the page, but no page has arrived. A
    // step that is only "not the starter" would pass for want of a component.
    const arriving = stateOf({}, { view: 'page', file: 'button.uidx' })
    for (const tour of TUTORIALS)
      for (const s of tour.steps)
        if (s.done) expect(s.done(arriving, START), `${tour.id}:${s.id}`).toBe(false)
  })

  it('a run that began with pages, or has made one, waits for them after a reload', () => {
    const button = tutorial('button')
    const at = (id: string) => button.steps.findIndex((s) => s.id === id)
    const made = stateOf({ 'button.uidx': fixture('button') })
    const begunWith = { tutorial: button, index: at('overview'), memory: snapshot(made) }
    expect(awaitingDocument(EMPTY, begunWith)).toBe(true)
    expect(awaitingDocument(made, begunWith)).toBe(false)
    // Begun on an empty document: nothing to wait for until Create has made a page.
    expect(awaitingDocument(EMPTY, { tutorial: button, index: at('create'), memory: START })).toBe(
      false,
    )
    const after = { tutorial: button, index: at('overview-2'), memory: START }
    expect(awaitingDocument(EMPTY, after)).toBe(true)
    expect(awaitingDocument(made, after)).toBe(false)
  })

  it('the Overview step reads the face; the Contract step reads the tab', () => {
    const button = tutorial('button')
    expect(step(button, 'overview').done!(EMPTY, START)).toBe(true)
    expect(step(button, 'overview').done!({ ...EMPTY, view: 'page' }, START)).toBe(false)
    const pressed = {
      ...EMPTY,
      query: (s: string) => (s.includes('aria-pressed') ? ({} as Element) : null),
    }
    expect(step(button, 'contract').done!(pressed, START)).toBe(true)
    expect(step(button, 'contract').done!(EMPTY, START)).toBe(false)
  })
})

describe('a tutorial run', () => {
  beforeEach(() => {
    stopTutorial()
    localStorage.clear()
    completedTutorials.value = []
  })

  it('starts at the first step, moves, and is kept across a reload', () => {
    startTutorial('button', EMPTY)
    expect(tourRun.value?.tutorial.id).toBe('button')
    expect(tourRun.value?.index).toBe(0)
    goToStep(3)
    expect(tourRun.value?.index).toBe(3)
    const saved = JSON.parse(localStorage.getItem('uidx.tour.run')!)
    expect(saved).toMatchObject({ id: 'button', index: 3 })
    goToStep(-4)
    expect(tourRun.value?.index).toBe(0)
  })

  it('moving past the last step finishes it and ticks the tutorial', () => {
    startTutorial('switch', EMPTY)
    goToStep(tutorial('switch').steps.length)
    expect(tourRun.value).toBeNull()
    expect(completedTutorials.value).toEqual(['switch'])
    expect(localStorage.getItem('uidx.tour.run')).toBeNull()
    expect(JSON.parse(localStorage.getItem('uidx.tour.completed')!)).toEqual(['switch'])
  })

  it('stopping forgets the run without ticking it', () => {
    startTutorial('list', EMPTY)
    stopTutorial()
    expect(tourRun.value).toBeNull()
    expect(completedTutorials.value).toEqual([])
    finishTutorial()
    expect(completedTutorials.value).toEqual([])
  })

  it('an unknown tutorial does not start', () => {
    startTutorial('nope', EMPTY)
    expect(tourRun.value).toBeNull()
  })
})
