import { describe, expect, it } from 'vitest'
import { parseOrThrow, type UidxDocument } from '@uidx/format'

import { designDiff, designDiffMarkdown } from '../src/design-diff.js'

/**
 * A component's outer box is part of what its uses rely on (ADR 0018): a use
 * styles the node the box lands on, and pads it only if it lays out. Neither
 * change breaks a use, which still builds, but a reviewer should hear that a
 * restyled use now paints a different node, or that its padding stopped
 * doing anything.
 */
const page = (id: string, body: string): UidxDocument =>
  parseOrThrow(`---\nid: ${id}\n---\n\n## Visual Contract\n\n<Page>\n${body}\n</Page>\n`)

const pages = (...docs: UidxDocument[]) =>
  new Map(docs.map((doc) => [`${doc.frontmatter.id}.uidx`, doc]))

const card = (frame: string) =>
  page(
    'card',
    `  <Component name="Card">
    ${frame}
      <Text name="title" characters="Title" />
    </Frame>
  </Component>`,
  )

const lines = (before: Map<string, UidxDocument>, after: Map<string, UidxDocument>) =>
  designDiff(before, after).map((c) => `${c.breaking ? 'BREAKING ' : ''}${c.subject}: ${c.change}`)

describe('designDiff on the outer box', () => {
  it('reports a box that stops laying out as information, not a break', () => {
    const before = pages(card(`<Frame name="body" layoutMode="VERTICAL" paddingLeft={8}>`))
    const after = pages(card(`<Frame name="body" width={200} height={80}>`))
    const changes = designDiff(before, after)
    expect(changes).toEqual([
      {
        breaking: false,
        subject: 'Card',
        change: 'outer box no longer lays out, so padding on an instance does nothing',
      },
    ])
    expect(designDiffMarkdown(changes)).not.toContain('breaking')
  })

  it('says nothing when the box starts laying out, or keeps its place and layout', () => {
    const free = pages(card(`<Frame name="body" width={200} height={80}>`))
    const vertical = pages(card(`<Frame name="body" layoutMode="VERTICAL" paddingLeft={8}>`))
    const horizontal = pages(card(`<Frame name="body" layoutMode="HORIZONTAL" itemSpacing={4}>`))
    expect(lines(free, vertical)).toEqual([])
    expect(lines(vertical, horizontal)).toEqual([])
  })

  it('says nothing when a component drops a column the build would give it anyway', () => {
    const label = (attrs: string) =>
      pages(
        page(
          'label',
          `  <Component name="Label"${attrs}>\n    <Text name="words" characters="Hi" />\n  </Component>`,
        ),
      )
    const bare = label('')
    expect(
      lines(
        label(' layoutMode="VERTICAL" primaryAxisSizingMode="AUTO" counterAxisSizingMode="AUTO"'),
        bare,
      ),
    ).toEqual([])
    // A size with no layout is what stops the column.
    expect(lines(bare, label(' width={80} height={20}'))).toEqual([
      'Label: outer box no longer lays out, so padding on an instance does nothing',
    ])
  })

  it('reports a box that moves to another node', () => {
    const wrapped = pages(card(`<Frame name="body" layoutMode="VERTICAL">`))
    const own = pages(
      page(
        'card',
        `  <Component name="Card" layoutMode="VERTICAL">
    <Text name="title" characters="Title" />
    <Text name="subtitle" characters="Subtitle" />
  </Component>`,
      ),
    )
    expect(lines(wrapped, own)).toEqual([
      'Card: outer box moved from frame "body" to the component itself',
    ])
    expect(lines(own, wrapped)).toEqual([
      'Card: outer box moved from the component itself to frame "body"',
    ])
  })

  it('follows a composition to the component it holds, on another page', () => {
    const inner = (layout: string) =>
      page(
        'inner',
        `  <Component name="Inner" ${layout}>
    <Text name="words" characters="Hi" />
    <Text name="more" characters="There" />
  </Component>`,
      )
    const outer = page(
      'outer',
      `  <Component name="Outer">\n    <Instance name="inner" component="Inner" />\n  </Component>`,
    )
    expect(
      lines(
        pages(inner('layoutMode="HORIZONTAL"'), outer),
        pages(inner('width={40} height={20}'), outer),
      ),
    ).toEqual([
      'Inner: outer box no longer lays out, so padding on an instance does nothing',
      'Outer: outer box no longer lays out, so padding on an instance does nothing',
    ])
  })

  it('treats a styles table’s root as the component’s own frame, not a move', () => {
    const plain = pages(
      page(
        'pill',
        `  <Component name="Pill" layoutMode="HORIZONTAL" paddingLeft={12}>
    <Text name="label" characters="Go" />
  </Component>`,
      ),
    )
    const styled = pages(
      parseOrThrow(`---
id: pill
---

## Visual Contract

<Page>
  <Component name="Pill" layoutMode="HORIZONTAL" paddingLeft={12}>
    <Text name="label" characters="Go" />
  </Component>
</Page>

<Styles>
  <Style state="hover" root:opacity={0.8} />
</Styles>
`),
    )
    expect(lines(plain, styled)).toEqual([])
    expect(lines(styled, plain)).toEqual([])
  })
})
