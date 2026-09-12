import { parse, resolve, type UidxDocument } from '@uidx/format'
import { describe, expect, it } from 'vitest'

import { budgetFor } from '../src/index/budget.js'
import { renderOutline, renderSignature } from '../src/index/outline.js'

const SRC = `---
id: page
---

## Visual Contract

<Page>
  <Frame name="hero" width={600} height={200} layoutMode="VERTICAL">
    <Text name="headline" characters="Welcome to the thing" fontSize={32} />
    <Frame name="inner" width={100} height={50}>
      <Text name="deep" characters="deeper" fontSize={12} />
    </Frame>
  </Frame>
  <Instance name="card" component="Card" x={0} y={0} />
</Page>
`

const doc = (): UidxDocument => {
  const r = parse(SRC)
  if (!r.doc) throw new Error(r.diagnostics.map((d) => d.message).join('; '))
  return r.doc
}

describe('renderSignature', () => {
  it('names the element, the name and the address on one line', () => {
    const d = doc()
    const line = renderSignature(resolve(d.tree, 'hero#headline')!)
    expect(line).toContain('Text')
    expect(line).toContain('headline')
    expect(line).toContain('hero#headline')
  })

  it('carries the identifying prop of an instance, so the model knows what it is', () => {
    const d = doc()
    expect(renderSignature(resolve(d.tree, 'card')!)).toContain('Card')
  })

  it('does not carry a node body', () => {
    const d = doc()
    expect(renderSignature(resolve(d.tree, 'hero#headline')!)).not.toContain('Welcome to the thing')
  })
})

describe('renderOutline', () => {
  it('shows the shape of a subtree, one line per node', () => {
    const d = doc()
    const out = renderOutline(d, d.tree)
    expect(out).toContain('hero')
    expect(out).toContain('hero#headline')
    expect(out).toContain('hero#inner/deep')
  })

  it('indents to show nesting', () => {
    const d = doc()
    const lines = renderOutline(d, d.tree).split('\n')
    const hero = lines.find((l) => l.includes('hero') && !l.includes('#'))!
    const headline = lines.find((l) => l.includes('hero#headline'))!
    expect(headline.length - headline.trimStart().length).toBeGreaterThan(
      hero.length - hero.trimStart().length,
    )
  })

  it('stops at the requested depth and says what it did not show', () => {
    const d = doc()
    const out = renderOutline(d, d.tree, { maxDepth: 1 })
    expect(out).toContain('hero')
    expect(out).not.toContain('hero#inner/deep')
    expect(out).toMatch(/deeper|more|omitted|not shown/i)
  })

  it('stays within the character budget and says it truncated', () => {
    const d = doc()
    const out = renderOutline(d, d.tree, { maxChars: 120 })
    expect(out.length).toBeLessThanOrEqual(200)
    expect(out).toMatch(/omitted|truncated/i)
  })

  it('never exceeds maxChars, even once the trailer explaining the cut is added', () => {
    // A tight budget where the "N node(s) omitted..." trailer's own length is
    // a meaningful fraction of the whole allowance — exactly the case a loose
    // "give it some slack" assertion (the test above) cannot catch. Regression
    // for the trailer being appended after the maxChars check instead of
    // inside it, which let a real page's outline come out 67 chars over its
    // promised budget even though this same 120-char toy case looked fine.
    const d = doc()
    const out = renderOutline(d, d.tree, { maxChars: 120 })
    expect(out.length).toBeLessThanOrEqual(120)
    expect(out).toMatch(/omitted|truncated/i)
  })

  it('truncates a long characters value with an ellipsis rather than embedding it whole', () => {
    const src = `---
id: page
---

## Visual Contract

<Page>
  <Text name="blurb" characters="This description is deliberately much longer than the shorten threshold so truncation is unambiguous" />
</Page>
`
    const r = parse(src)
    if (!r.doc) throw new Error(r.diagnostics.map((d) => d.message).join('; '))
    const line = renderSignature(resolve(r.doc.tree, 'blurb')!)
    expect(line).toContain('characters=This description…')
    expect(line).not.toContain('deliberately much longer')
  })

  it('never drops a sibling without a trace, even when an earlier sibling has a huge subtree', () => {
    // The adversarial shape that exposes depth-first budget starvation: one
    // enormous first child (many leaves) followed by several tiny siblings.
    // A depth-first walk that stops the instant the budget runs out spends
    // the whole budget on the first child's subtree and never even reaches
    // the later siblings' own lines -- their names disappear completely,
    // not just their children. This must fail against that algorithm and
    // pass once admission is breadth-first.
    const leaves = Array.from(
      { length: 60 },
      (_, i) => `    <Frame name="leaf-${i}" width={10} height={10} />`,
    ).join('\n')
    const src = `---
id: page
---

## Visual Contract

<Page>
  <Frame name="big" width={100} height={100} layoutMode="VERTICAL">
${leaves}
  </Frame>
  <Frame name="second" width={10} height={10} />
  <Frame name="third" width={10} height={10} />
  <Frame name="fourth" width={10} height={10} />
</Page>
`
    const r = parse(src)
    if (!r.doc) throw new Error(r.diagnostics.map((d) => d.message).join('; '))

    // Enough budget for the four top-level siblings' own lines, nowhere near
    // enough for "big"'s 60 leaves too -- a depth-first walk would still be
    // deep inside "big" when this budget runs out.
    const out = renderOutline(r.doc, r.doc.tree, { maxChars: 300 })

    expect(out).toContain('big')
    expect(out).toContain('second')
    expect(out).toContain('third')
    expect(out).toContain('fourth')
    expect(out).toMatch(/omitted/i)
  })
})

describe('outlining a large, deeply nested document', () => {
  const SECTIONS = [
    'cover',
    'overview',
    'anatomy',
    'properties',
    'states',
    'measurements',
    'in-context',
    'guidance',
    'accessibility',
    'content',
    'related',
    'changelog',
  ]
  const source = `---
id: large-outline
---

## Visual Contract

<Page>
    <Frame name="doc">${SECTIONS.map(
      (section) =>
        `<Frame name="${section}">${Array.from({ length: 60 }, (_, i) => {
          let node = `<Text name="label" characters="A long descriptive label for outline budgeting and readable node signatures" width={200} height={24} />`
          for (let level = 0; level < 7; level++)
            node = `<Frame name="level-${level}" width={300}>${node}</Frame>`
          return `<Frame name="item-${i}">${node}</Frame>`
        }).join('')}</Frame>`,
    ).join('')}</Frame>
  </Page>`

  it('fits the outline budget and names every top-level section', () => {
    expect(source.length).toBeGreaterThan(200_000)
    const result = parse(source)
    if (!result.doc) throw new Error(result.diagnostics.map((d) => d.message).join('; '))
    const budget = budgetFor(16_384)
    const out = renderOutline(result.doc, result.doc.tree, { maxChars: budget.outlineChars })
    expect(out.length).toBeLessThanOrEqual(budget.outlineChars)
    for (const section of SECTIONS) expect(out).toContain(section)
    expect(out).toMatch(/omitted/i)
  })
})
