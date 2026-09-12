import { describe, expect, it } from 'vitest'
import { parseOrThrow, type UidxDocument } from '@uidx/format'

import { departedPages, pageEntries } from '../src/page-list'

const screen = (id: string): UidxDocument =>
  parseOrThrow(`---
id: ${id}
---

## Visual Contract

<Page>
  <Frame name="screen" width={10} height={10} />
</Page>
`)

const tokens = (id: string): UidxDocument =>
  parseOrThrow(`---
id: ${id}
---

## Visual Contract

<Tokens>
  <Collection name="ui">
    <Variable name="app" type="COLOR" value={{ r: 0, g: 0, b: 0, a: 1 }} />
  </Collection>
</Tokens>
`)

describe('the document as a list of pages', () => {
  it('keeps the order the server sent, not an alphabetical one', () => {
    const files = ['tokens.uidx', 'home.uidx', 'components.uidx']
    const docs = new Map([
      ['home.uidx', screen('studio-home')],
      ['tokens.uidx', tokens('studio-tokens')],
      ['components.uidx', screen('studio-components')],
    ])

    expect(pageEntries(files, docs).map((page) => page.file)).toEqual(files)
  })

  it('names a page by its frontmatter id and keeps the path for the tooltip', () => {
    const docs = new Map([['screens/home.uidx', screen('studio-home')]])
    const [page] = pageEntries(['screens/home.uidx'], docs)

    expect(page?.label).toBe('studio-home')
    expect(page?.file).toBe('screens/home.uidx')
  })

  it('falls back to the filename for a page whose document has not arrived', () => {
    const [page] = pageEntries(['screens/token-detail.uidx'], new Map())

    expect(page?.label).toBe('token-detail')
    expect(page?.loaded).toBe(false)
  })

  it('marks a <Tokens> page unrenderable — it declares variables, not a scene', () => {
    const docs = new Map([
      ['tokens.uidx', tokens('studio-tokens')],
      ['home.uidx', screen('studio-home')],
    ])
    const listed = pageEntries(['tokens.uidx', 'home.uidx'], docs)

    expect(listed.find((page) => page.file === 'tokens.uidx')?.renderable).toBe(false)
    expect(listed.find((page) => page.file === 'home.uidx')?.renderable).toBe(true)
  })

  it('lists a page the server never announced, so nothing loaded goes missing', () => {
    // The single-file server sends no `document:opened` at all, and a page can
    // arrive over the socket that the opening announcement did not name.
    const docs = new Map([['home.uidx', screen('studio-home')]])

    expect(pageEntries([], docs).map((page) => page.file)).toEqual(['home.uidx'])
  })
})

describe('a page that has left the document', () => {
  it('names what the shell is holding that the document no longer announces', () => {
    expect(departedPages(['home.uidx'], ['home.uidx', 'about.uidx'])).toEqual(['about.uidx'])
  })

  it('names nothing while the announcement still covers everything held', () => {
    expect(departedPages(['home.uidx', 'about.uidx'], ['home.uidx'])).toEqual([])
  })

  /**
   * Without the prune, `pageEntries` appends the deleted page right back as an
   * unannounced-but-loaded row — so the rail goes on offering a page that is
   * gone from disk. This is the pair that has to hold together.
   */
  it('is gone from the rail once its document is dropped with it', () => {
    const docs = new Map([
      ['home.uidx', screen('home')],
      ['about.uidx', screen('about')],
    ])
    expect(pageEntries(['home.uidx'], docs).map((page) => page.file)).toEqual([
      'home.uidx',
      'about.uidx',
    ])

    for (const file of departedPages(['home.uidx'], docs.keys())) docs.delete(file)
    expect(pageEntries(['home.uidx'], docs).map((page) => page.file)).toEqual(['home.uidx'])
  })
})
