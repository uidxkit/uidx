import { describe, expect, it } from 'vitest'

import { buildIndex } from '../src/index/build.js'
import { packContext } from '../src/index/pack.js'
import { docsFixture } from './fixtures/docs.js'

const docs = docsFixture()
const index = buildIndex('doc', docs)

describe('packContext', () => {
  it('always opens with the doc map', () => {
    const pack = packContext(index, docs, { file: null, selection: [] })
    expect(pack.text).toContain('COMPONENTS')
  })

  it('puts the selected node source in front of everything else', () => {
    const pack = packContext(index, docs, { file: 'home.uidx', selection: ['hero'] })
    const selected = pack.text.indexOf('SELECTED')
    const map = pack.text.indexOf('COMPONENTS')
    expect(selected).toBeGreaterThan(-1)
    expect(selected).toBeLessThan(map)
    expect(pack.text).toContain('name="hero"')
  })

  it('includes the source of the ancestors of the selection, not just the node', () => {
    const nested = packContext(index, docs, { file: 'home.uidx', selection: ['hero#headline'] })
    expect(nested.text).toContain('name="headline"')
    expect(nested.text).toContain('CURRENT PAGE')
    expect(nested.text).toContain('within: hero <Frame>')

    // A top-level node has no ancestors between it and the page root, so it
    // must not get a breadcrumb line at all — this is what stops the test
    // above from passing against an implementation that emits one always.
    const topLevel = packContext(index, docs, { file: 'home.uidx', selection: ['hero'] })
    expect(topLevel.text).not.toContain('within:')
  })

  it('caps the selected block to its own budget and leaves the doc map intact', () => {
    const pack = packContext(
      index,
      docs,
      { file: 'components.uidx', selection: ['Card'] },
      { maxChars: 300 },
    )
    expect(pack.text).toContain('(node source truncated)')
    expect(pack.text).toContain('COMPONENTS')
  })

  it('says a file is not loaded rather than pretending nothing is selected there', () => {
    const pack = packContext(index, docs, { file: 'missing.uidx', selection: ['hero'] })
    expect(pack.text).toContain('missing.uidx')
    expect(pack.text).toContain('not loaded')
    expect(pack.text).not.toContain('nothing selected')
  })

  it('names the definition of a component the selection instantiates', () => {
    const pack = packContext(index, docs, { file: 'home.uidx', selection: ['revenue'] })
    expect(pack.text).toContain('components.uidx')
    expect(pack.files).toContain('components.uidx')
  })

  it('reports which files it drew on, so the caller can checkpoint them', () => {
    const pack = packContext(index, docs, { file: 'home.uidx', selection: [] })
    expect(pack.files).toEqual(['home.uidx'])
  })

  it('says there is no selection rather than pretending there is one', () => {
    const pack = packContext(index, docs, { file: 'home.uidx', selection: [] })
    expect(pack.text).toContain('nothing selected')
  })

  it('honours a small budget without dropping the doc map, which is the orientation', () => {
    const pack = packContext(
      index,
      docs,
      { file: 'home.uidx', selection: ['hero'] },
      {
        maxChars: 900,
      },
    )
    expect(pack.text.length).toBeLessThanOrEqual(1_100)
    expect(pack.text).toContain('COMPONENTS')
  })
})

// The reported failure, and the fixture happens to reproduce its exact shape:
// `components.uidx` is a page whose whole content is one `<Component name="Card">`,
// which is precisely how `bound-card.uidx` holds `Card/Basic`. A designer on
// that page asked what was on it and was answered about a different file.
describe('packContext, on the page the designer is looking at', () => {
  const onComponentsPage = () =>
    packContext(index, docs, { file: 'components.uidx', selection: [] }).text

  it("quotes the page's own intent, so a page is more than its filename", () => {
    expect(onComponentsPage()).toContain('intent: Shared surfaces.')
  })

  it('describes each top-level node instead of naming it bare', () => {
    const text = onComponentsPage()
    // What it used to say was `Card <Component>` and nothing else — thinner
    // than the COMPONENTS row for the very same component further down.
    expect(text).toContain('defines <Component> Card @Card (1) status=stable')
  })

  it('marks the current page in the doc map, so the two entries agree', () => {
    expect(onComponentsPage()).toContain(
      'components.uidx (5 nodes): Card<Component>  ← the page you are on',
    )
  })

  it('marks no row at all when the designer is on no page', () => {
    expect(packContext(index, docs, { file: null, selection: [] }).text).not.toContain(
      'the page you are on',
    )
  })

  // A page cannot hold a `<Component>` anywhere but at its root, so one there
  // is always a definition. A model told only `<Component> Card/Basic` called
  // it "a draft instance of Card/Basic" on a page holding no instance at all.
  it('says a component on the page is defined there, not used there', () => {
    expect(onComponentsPage()).toContain('defines <Component> Card')
    // And says it of nothing else: a Frame is scenery, not a definition.
    const home = packContext(index, docs, { file: 'home.uidx', selection: [] }).text
    expect(home).not.toContain('defines')
  })

  it('leaves the intent line off a page that has no prose, rather than saying nothing', () => {
    const text = packContext(index, docs, { file: 'home.uidx', selection: [] }).text
    expect(text).toContain('CURRENT PAGE home.uidx')
    expect(text).not.toContain('intent:')
    expect(text).toContain('<Frame> hero @hero (1)')
  })
})
