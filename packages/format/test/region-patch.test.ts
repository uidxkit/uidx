import { describe, expect, it } from 'vitest'
import {
  applyPatches,
  inversePatches,
  parseOrThrow,
  regionBody,
  type UidxPatch,
} from '../src/index.js'

/**
 * The prose regions written whole: `## Behavior` and `## Examples` land in
 * canonical order, are replaced and removed without touching their
 * neighbours, are checked by the parser, and invert to what they held; the
 * intent above the visual contract is rewritten the same way.
 */
const VISUAL = `---
id: box
---

A box.

## Visual Contract

<Page>
  <Component name="Box" status="draft" width={20} height={20} />
</Page>
`
const CONTRACT = `
## Contract

<Props>
  <Prop name="tone" type="'a' | 'b'" default="a" visual>Tone.</Prop>
</Props>
`
const EXAMPLES = `
## Examples

<Example name="b">
  <Set at="tone" value="b" />
</Example>
`

const apply = (source: string, patch: UidxPatch) => applyPatches(source, [patch]).source

describe('the region op', () => {
  it('creates Behavior after the contract and before the examples', () => {
    const source = VISUAL + CONTRACT + EXAMPLES
    const next = apply(source, { op: 'region', name: 'Behavior', body: '- press: fires once.' })
    expect(next).toBe(VISUAL + CONTRACT + '\n## Behavior\n\n- press: fires once.\n' + EXAMPLES)
    expect(parseOrThrow(next).spec!.behavior!.map((rule) => [rule.id, rule.text])).toEqual([
      ['press', 'fires once.'],
    ])
  })

  it('creates a region at the end when nothing follows it', () => {
    const next = apply(VISUAL + CONTRACT, {
      op: 'region',
      name: 'Examples',
      body: '<Example name="b">\n  <Set at="tone" value="b" />\n</Example>',
    })
    expect(next).toBe(VISUAL + CONTRACT + EXAMPLES)
  })

  it('replaces and removes a region, leaving its neighbours as they were', () => {
    const source = VISUAL + CONTRACT + '\n## Behavior\n\n- press: fires once.\n' + EXAMPLES
    const replaced = apply(source, {
      op: 'region',
      name: 'Behavior',
      body: '- press: fires once.\n- focus: a ring shows.',
    })
    expect(regionBody(parseOrThrow(replaced), 'Behavior')).toBe(
      '- press: fires once.\n- focus: a ring shows.',
    )
    expect(replaced.endsWith(EXAMPLES)).toBe(true)
    expect(apply(source, { op: 'region', name: 'Behavior' })).toBe(VISUAL + CONTRACT + EXAMPLES)
    expect(apply(VISUAL + CONTRACT + EXAMPLES, { op: 'region', name: 'Examples' })).toBe(
      VISUAL + CONTRACT,
    )
  })

  it('refuses a body the parser cannot read, and a removal of nothing', () => {
    expect(() => apply(VISUAL, { op: 'region', name: 'Behavior', body: 'not a list' })).toThrow(
      /Behavior region is a bullet list/,
    )
    expect(() => apply(VISUAL, { op: 'region', name: 'Behavior' })).toThrow(/no ## Behavior/)
  })

  it('inverts to what the region held, or to its absence', () => {
    const source = VISUAL + CONTRACT + '\n## Behavior\n\n- press: fires once.\n' + EXAMPLES
    for (const patch of [
      { op: 'region', name: 'Behavior', body: '- other: words.' },
      { op: 'region', name: 'Behavior' },
      { op: 'region', name: 'Examples' },
    ] as UidxPatch[]) {
      const back = inversePatches(parseOrThrow(source), [patch])
      expect(applyPatches(apply(source, patch), back).source).toBe(source)
    }
    const fresh = VISUAL + CONTRACT
    const add: UidxPatch = { op: 'region', name: 'Behavior', body: '- a: b.' }
    expect(applyPatches(apply(fresh, add), inversePatches(parseOrThrow(fresh), [add])).source).toBe(
      fresh,
    )
  })
})

describe('the intent op', () => {
  it('rewrites the prose above the visual contract and inverts', () => {
    const next = apply(VISUAL, { op: 'intent', text: 'A box for content.\n\nUse it sparingly.' })
    expect(next).toContain('---\n\nA box for content.\n\nUse it sparingly.\n\n## Visual Contract')
    expect(parseOrThrow(next).intent.raw.trim()).toBe('A box for content.\n\nUse it sparingly.')
    const back = inversePatches(parseOrThrow(VISUAL), [{ op: 'intent', text: 'x' }])
    expect(applyPatches(apply(VISUAL, { op: 'intent', text: 'x' }), back).source).toBe(VISUAL)
    expect(apply(VISUAL, { op: 'intent', text: '' })).toContain('---\n\n## Visual Contract')
  })
})
