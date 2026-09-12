import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { parseOrThrow } from '@uidx/format'
import { buildTokenIndex } from '@uidx/schema'
import type { UidxDocument } from '@uidx/format'

import HomePane from '../src/HomePane.vue'
import { homeModel, type PageCard } from '../src/home-model'
import { pageEntries } from '../src/page-list'

/**
 * The grid, with the renderer stubbed.
 *
 * CanvasKit cannot be driven under jsdom (spike S1), so what is tested here is
 * everything around the picture: which tiles exist, which ask to be drawn, what
 * a tile says when there is nothing to draw, and that a tile opens its page.
 * The render itself is one injected function, which is why it can be replaced.
 */

const screen = (id: string) =>
  parseOrThrow(`---
id: ${id}
---

## Visual Contract

<Page>
  <Frame name="screen" width={100} height={100} />
</Page>
`)

const TOKENS = parseOrThrow(`---
id: core-tokens
---

## Visual Contract

<Tokens>
  <Collection name="color" modes={['light', 'dark']}>
    <Variable name="bg" type="COLOR">
      <Mode name="light" value={{ r: 1, g: 1, b: 1, a: 1 }} />
      <Mode name="dark" value={{ r: 0, g: 0, b: 0, a: 1 }} />
    </Variable>
  </Collection>
</Tokens>
`)

const DOCS = new Map<string, UidxDocument>([
  ['tokens.uidx', TOKENS],
  ['home.uidx', screen('home')],
  ['studio.uidx', screen('studio')],
])
const FILES = ['tokens.uidx', 'home.uidx', 'studio.uidx']

const stubRender = () => vi.fn(async (_card: PageCard): Promise<string | null> => 'blob:shot')

function mountHome(render = stubRender()) {
  const model = homeModel({
    entries: pageEntries(FILES, DOCS),
    docs: DOCS,
    revisions: new Map([['home.uidx', 3]]),
    diagnostics: new Map(),
    tokens: buildTokenIndex([...DOCS.values()]),
  })
  const pane = mount(HomePane, {
    props: { model, render, stamps: new Map(), current: 'home.uidx', title: 'studio' },
  })
  return { pane, render }
}

describe('the dashboard', () => {
  it('offers page creation when connected and opens the created page', async () => {
    const { pane } = mountHome()
    expect(pane.get('.new-page').attributes('disabled')).toBeDefined()
    await pane.setProps({ connected: true })
    await pane.get('.new-page').trigger('click')
    const dialog = pane.findComponent({ name: 'NewPageDialog' })
    expect(dialog.exists()).toBe(true)
    dialog.vm.$emit('created', 'new-page.uidx')
    await pane.vm.$nextTick()
    expect(pane.emitted('open')).toEqual([['new-page.uidx']])
    expect(pane.find('dialog').exists()).toBe(false)
    pane.unmount()
  })

  it('explains the empty state and still offers creation with no pages', async () => {
    const { pane } = mountHome()
    await pane.setProps({
      connected: true,
      model: homeModel({
        entries: [],
        docs: new Map(),
        revisions: new Map(),
        diagnostics: new Map(),
        tokens: buildTokenIndex([]),
      }),
    })
    expect(pane.text()).toContain('No pages yet')
    expect(pane.get('.new-page').attributes('disabled')).toBeUndefined()
    pane.unmount()
  })

  it('shows a tile for every page of the document', () => {
    const tiles = mountHome().pane.findAll('[role="option"]')

    expect(tiles.map((tile) => tile.attributes('data-file'))).toEqual(FILES)
  })

  it('draws only the pages that are scenes', async () => {
    const { render } = mountHome()
    await Promise.resolve()

    // jsdom has no IntersectionObserver, so every tile paints on mount — which is
    // what makes this assertion about *which* pages, not about laziness.
    expect(render.mock.calls.map(([card]) => card.file)).toEqual(['home.uidx', 'studio.uidx'])
  })

  it('says why a token page has no picture instead of showing an empty well', () => {
    const tile = mountHome().pane.get('[data-file="tokens.uidx"]')

    expect(tile.text()).toContain('variables, not a scene')
    expect(tile.attributes('data-kind')).toBe('tokens')
  })

  it('shows a page that will not parse as broken rather than drawing it', async () => {
    const model = homeModel({
      entries: pageEntries(FILES, DOCS),
      docs: DOCS,
      revisions: new Map(),
      diagnostics: new Map([
        [
          'studio.uidx',
          [{ code: 'E1', severity: 'error', message: 'no', loc: { start: 0, end: 1 } }],
        ],
      ] as never),
      tokens: buildTokenIndex([...DOCS.values()]),
    })
    const pane = mount(HomePane, {
      props: {
        model,
        render: vi.fn(async (_card: PageCard): Promise<string | null> => null),
        stamps: new Map(),
        current: null,
        title: 'studio',
      },
    })

    const tile = pane.get('[data-file="studio.uidx"]')
    expect(tile.text()).toContain('does not parse')
    expect(tile.text()).toContain('1')
  })

  it('marks the page the canvas has open behind it', () => {
    const tiles = mountHome().pane.findAll('[role="option"]')

    expect(tiles.map((tile) => tile.attributes('aria-selected'))).toEqual([
      'false',
      'true',
      'false',
    ])
  })

  it('asks for a page when its tile is clicked', async () => {
    const { pane } = mountHome()

    await pane.get('[data-file="studio.uidx"]').trigger('click')

    expect(pane.emitted('open')).toEqual([['studio.uidx']])
  })

  it('opens a tile from the keyboard', async () => {
    const { pane } = mountHome()

    await pane.get('[data-file="studio.uidx"]').trigger('keydown.enter')

    expect(pane.emitted('open')).toEqual([['studio.uidx']])
  })

  it('reports only counts derived from the file', () => {
    const text = mountHome().pane.get('.kpis').text()

    // 3 pages, 2 of them drawable; 1 variable in 1 collection; nothing broken.
    expect(text).toContain('3')
    expect(text).toContain('2 drawable')
    expect(text).toContain('1 collections')
    expect(text).toContain('all pages parse')
  })

  it('lists each collection with its modes', () => {
    const collections = mountHome().pane.findAll('.collection')

    expect(collections).toHaveLength(1)
    expect(collections[0]!.text()).toContain('color')
    expect(collections[0]!.text()).toContain('light')
    expect(collections[0]!.text()).toContain('dark')
  })

  it('redraws a page when its revision moves, and not otherwise', async () => {
    const render = stubRender()
    const build = (revision: number) =>
      homeModel({
        entries: pageEntries(FILES, DOCS),
        docs: DOCS,
        revisions: new Map([['home.uidx', revision]]),
        diagnostics: new Map(),
        tokens: buildTokenIndex([...DOCS.values()]),
      })

    const pane = mount(HomePane, {
      props: { model: build(3), render, stamps: new Map(), current: null, title: 'studio' },
    })
    await Promise.resolve()
    const first = render.mock.calls.length

    // A recount that leaves every revision alone must not redraw anything: that
    // is a raster per page for a save that did not touch them.
    await pane.setProps({ model: build(3) })
    expect(render.mock.calls).toHaveLength(first)

    await pane.setProps({ model: build(4) })
    await Promise.resolve()
    expect(render.mock.calls.filter(([card]) => card.file === 'home.uidx')).toHaveLength(2)
  })

  it('draws a page that arrives after its tile is already on screen', async () => {
    // The bug this is here for: the dashboard renders the moment
    // `document:opened` names the pages, which is *before* their documents have
    // come over the socket. Every tile mounts as `pending`, finds nothing to
    // draw, and — with the draw driven by a one-shot trigger rather than a
    // condition — never asks again. The dashboard then sits at empty wells for
    // the whole session, and the larger the document the longer the window in
    // which that happens.
    const render = stubRender()
    const build = (docs: Map<string, UidxDocument>) =>
      homeModel({
        entries: pageEntries(FILES, docs),
        docs,
        revisions: new Map([...docs.keys()].map((file) => [file, 1])),
        diagnostics: new Map(),
        tokens: buildTokenIndex([...docs.values()]),
      })

    // What the shell has at `document:opened`: the page list, and no documents.
    const pane = mount(HomePane, {
      props: { model: build(new Map()), render, stamps: new Map(), current: null, title: 'studio' },
    })
    await Promise.resolve()
    expect(render).not.toHaveBeenCalled()
    expect(pane.get('[data-file="home.uidx"]').text()).toContain('loading')

    // The pages arrive.
    await pane.setProps({ model: build(DOCS) })
    await Promise.resolve()

    expect(render.mock.calls.map(([card]) => card.file)).toEqual(['home.uidx', 'studio.uidx'])
  })

  it('draws a page once, however many times it is recounted', async () => {
    const render = stubRender()
    const model = homeModel({
      entries: pageEntries(FILES, DOCS),
      docs: DOCS,
      revisions: new Map([['home.uidx', 7]]),
      diagnostics: new Map(),
      tokens: buildTokenIndex([...DOCS.values()]),
    })
    const pane = mount(HomePane, {
      props: { model, render, stamps: new Map(), current: null, title: 'studio' },
    })
    await Promise.resolve()

    // A fresh model object with identical contents — what every unrelated save
    // in the document produces.
    await pane.setProps({ model: { ...model, cards: [...model.cards] } })
    await Promise.resolve()

    expect(render.mock.calls.filter(([card]) => card.file === 'home.uidx')).toHaveLength(1)
  })

  it('says a page could not be drawn rather than calling it empty', async () => {
    const render = vi.fn(async (_card: PageCard): Promise<string | null> => {
      throw new Error('scene would not build')
    })
    const model = homeModel({
      entries: pageEntries(FILES, DOCS),
      docs: DOCS,
      revisions: new Map(),
      diagnostics: new Map(),
      tokens: buildTokenIndex([...DOCS.values()]),
    })
    const pane = mount(HomePane, {
      props: { model, render, stamps: new Map(), current: null, title: 'studio' },
    })
    await Promise.resolve()
    await Promise.resolve()
    await pane.vm.$nextTick()

    expect(pane.get('[data-file="home.uidx"]').text()).toContain('could not be drawn')
  })

  it('redraws when something the page draws through moves, with its own revision unchanged', async () => {
    // The bug this is here for, and it is the whole point of the stamp: a page
    // draws through components and artwork that live in *other* files. Editing
    // one of those changes what this page looks like and moves no revision
    // anywhere near it, so a tile watching only `card.revision` keeps showing
    // the old picture for the rest of the session.
    const render = stubRender()
    const model = homeModel({
      entries: pageEntries(FILES, DOCS),
      docs: DOCS,
      revisions: new Map([['home.uidx', 5]]),
      diagnostics: new Map(),
      tokens: buildTokenIndex([...DOCS.values()]),
    })
    const mount1 = (stamp: string) =>
      new Map([
        ['home.uidx', stamp],
        ['studio.uidx', '0:0'],
      ])

    const pane = mount(HomePane, {
      props: { model, render, stamps: mount1('0:0'), current: null, title: 'studio' },
    })
    await Promise.resolve()
    const first = render.mock.calls.filter(([card]) => card.file === 'home.uidx').length

    // Same model, same revision — only the stamp moved.
    await pane.setProps({ stamps: mount1('0:1') })
    await Promise.resolve()

    expect(render.mock.calls.filter(([card]) => card.file === 'home.uidx')).toHaveLength(first + 1)
    // And the page whose stamp did not move is left alone: artwork churn must
    // not cost a raster to every tile in the document.
    expect(render.mock.calls.filter(([card]) => card.file === 'studio.uidx')).toHaveLength(1)
  })
})
