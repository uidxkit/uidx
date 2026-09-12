import { parse } from '@uidx/format'
import { describe, expect, it } from 'vitest'

import { buildIndex } from '../src/index/build.js'
import { renderDocMap } from '../src/index/doc-map.js'
import { docsFixture } from './fixtures/docs.js'

const index = () => buildIndex('doc', docsFixture())

const LONELY = `---
id: lonely
---

## Visual Contract

<Page>
  <Component name="Orphan">
    <Frame name="body" />
  </Component>
</Page>
`

describe('renderDocMap', () => {
  it('lists every component with the props a caller must pass', () => {
    expect(renderDocMap(index())).toContain('Card(heading: TEXT) slots: body [stable]')
  })

  // Was "used 1×". A count says reuse is possible; the names say what an edit
  // is about to move, which is the question actually asked before changing a
  // component.
  it('names the pages that use each component, so reuse is the obvious path', () => {
    expect(renderDocMap(index())).toMatch(/Card.*used by home\.uidx/)
  })

  it('says so plainly when nothing uses a component', () => {
    const lonely = new Map([['lonely.uidx', parse(LONELY).doc!]])
    expect(renderDocMap(buildIndex('doc', lonely))).toMatch(/Orphan\(\).*— unused/)
  })

  // `## Visual Contract` is the delimiter the parser splits on, so `headings`
  // holds the prose sections and not the structural one — which is the set
  // worth naming anyway.
  it("lists a page's own sections, so one can be addressed without reading for it", () => {
    expect(renderDocMap(index())).toContain('sections: Core Intent')
  })

  it('says which nodes bind a variable — the question a token scale exists for', () => {
    expect(renderDocMap(index())).toContain('radius#md: FLOAT — bound by home.uidx')
  })

  it('lists pages with their top-level nodes', () => {
    const map = renderDocMap(index())
    expect(map).toContain('home.uidx')
    expect(map).toContain('hero')
  })

  it('lists token variables by address', () => {
    expect(renderDocMap(index())).toContain('radius#md: FLOAT')
  })

  it('never includes node bodies or attribute values', () => {
    expect(renderDocMap(index())).not.toContain('600')
  })

  it('stays within the character budget, and says what it withheld', () => {
    const map = renderDocMap(index(), { maxChars: 200 })
    expect(map.length).toBeLessThanOrEqual(260)
    expect(map).toMatch(/not shown/)
  })
})

describe('when the budget is tight', () => {
  // The old loop kept COMPONENTS whole and dropped PAGES and TOKENS entirely,
  // so a large document's token scale became invisible under exactly the
  // pressure that makes knowing about it matter.
  it('trims every section rather than dropping the last ones whole', () => {
    const map = renderDocMap(index(), { maxChars: 320 })
    expect(map).toContain('COMPONENTS')
    expect(map).toContain('PAGES')
    expect(map).toContain('TOKENS')
    expect(map).toContain('more, not shown')
  })

  it('says how much of a section it withheld, so the gap is visible', () => {
    expect(renderDocMap(index(), { maxChars: 90 })).toMatch(/\(\d+ more, not shown\)/)
  })

  it('leaves every section whole when they all fit', () => {
    expect(renderDocMap(index())).not.toContain('not shown')
  })
})
