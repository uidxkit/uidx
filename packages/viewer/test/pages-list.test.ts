import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { parseOrThrow } from '@uidx/format'

import PagesList from '../src/PagesList.vue'
import { pageEntries } from '../src/page-list'

const screen = (id: string) =>
  parseOrThrow(`---
id: ${id}
---

## Visual Contract

<Page>
  <Frame name="screen" width={10} height={10} />
</Page>
`)

const TOKENS = parseOrThrow(`---
id: studio-tokens
---

## Visual Contract

<Tokens>
  <Collection name="ui">
    <Variable name="app" type="COLOR" value={{ r: 0, g: 0, b: 0, a: 1 }} />
  </Collection>
</Tokens>
`)

const DOCS = new Map([
  ['tokens.uidx', TOKENS],
  ['home.uidx', screen('studio-home')],
  ['studio.uidx', screen('studio-studio')],
])

const mountList = (open: string | null = 'home.uidx') =>
  mount(PagesList, {
    props: { entries: pageEntries(['tokens.uidx', 'home.uidx', 'studio.uidx'], DOCS), open },
  })

describe('the pages rail', () => {
  it('lists every page of the document in the order the server sent', () => {
    const rows = mountList().findAll('[role="option"]')

    expect(rows.map((row) => row.text())).toEqual(['studio-tokens', 'studio-home', 'studio-studio'])
  })

  it('marks the page the canvas is drawing', () => {
    const rows = mountList().findAll('[role="option"]')

    expect(rows.map((row) => row.attributes('aria-selected'))).toEqual(['false', 'true', 'false'])
  })

  it('asks for a page when its row is clicked', async () => {
    const list = mountList()
    await list.findAll('[role="option"]')[2]!.trigger('click')

    expect(list.emitted('open')).toEqual([['studio.uidx']])
  })

  it('stays quiet when the open page is clicked again', async () => {
    // Re-opening is a full rebuild of the scene and a camera refit, which is a
    // lot to spend on a click that changes nothing.
    const list = mountList()
    await list.findAll('[role="option"]')[1]!.trigger('click')

    expect(list.emitted('open')).toBeUndefined()
  })

  it('opens the focused row on Enter', async () => {
    const list = mountList()
    await list.findAll('[role="option"]')[0]!.trigger('keydown', { key: 'Enter' })

    expect(list.emitted('open')).toEqual([['tokens.uidx']])
  })

  it('says which pages declare variables rather than a scene', () => {
    const rows = mountList().findAll('[role="option"]')

    expect(rows.map((row) => row.attributes('data-renderable'))).toEqual(['false', 'true', 'true'])
  })

  it('renders nothing at all for a document of one page', () => {
    // A single-file server has nothing to switch between, and a rail with one
    // permanently-selected row in it is furniture.
    const list = mount(PagesList, {
      props: {
        entries: pageEntries([], new Map([['home.uidx', screen('studio-home')]])),
        open: null,
      },
    })

    expect(list.find('[role="listbox"]').exists()).toBe(false)
  })
})
