import { parse } from '@uidx/format'
import { describe, expect, it } from 'vitest'

import type { Architecture } from '../src/plan/architecture.js'
import { renderDesignSection, spliceDesignSection } from '../src/plan/design-md.js'

const ARCHITECTURE: Architecture = {
  taskId: 't',
  summary: 'A Switch: immediate on/off, no indeterminate state.',
  components: [
    {
      name: 'Control/Switch',
      props: [{ name: 'label', type: 'TEXT' }],
      axes: [{ name: 'checked', values: ['off', 'on'] }],
    },
  ],
  tokens: [
    { collection: 'space', tier: 'primitive', usedFor: 'gaps and padding', status: 'exists' },
    { collection: 'switch-color', tier: 'component', usedFor: 'track fills', status: 'declare' },
  ],
  sections: [{ name: 'cover', holds: 'title' }],
  constraints: ['the thumb must be at least as tall as the track'],
  appearance: ['the thumb is a lighter disc drawn on top of the track, resting flush at the ends'],
}

const PAGE = `---
id: home
---

## Core Intent

What this is.

## Visual Contract

<Page>
  <Frame name="hero" width={100} height={50} />
</Page>
`

/**
 * Google Labs' DESIGN.md convention, folded into where uidx already keeps
 * prose. Every content line is model-authored — this only assembles, so a
 * design system accumulates the research its components were built from.
 */
describe('renderDesignSection', () => {
  it('assembles the model-authored decisions under the DESIGN.md-shaped headings', () => {
    const section = renderDesignSection(ARCHITECTURE, ARCHITECTURE.components[0])
    expect(section).toContain('## Design')
    expect(section).toContain('### Axes and props')
    expect(section).toContain('- checked: off | on')
    expect(section).toContain('- label (TEXT) — prop')
    expect(section).toContain('### Appearance')
    expect(section).toContain('- the thumb is a lighter disc drawn on top of the track')
    expect(section).toContain('### Constraints')
    expect(section).toContain('### Tokens')
    expect(section).toContain('- space (primitive) — gaps and padding')
    expect(section).toContain('- switch-color (component) — track fills — declared by this page')
  })

  it('says why it exists, so a later task knows to read it first', () => {
    expect(renderDesignSection(ARCHITECTURE)).toContain('read this before touching the component')
  })

  it('omits headings it has nothing to put under', () => {
    const bare = { ...ARCHITECTURE, appearance: [], constraints: [], tokens: [] }
    const section = renderDesignSection(bare)
    expect(section).not.toContain('### Appearance')
    expect(section).not.toContain('### Constraints')
    expect(section).not.toContain('### Tokens')
  })
})

describe('spliceDesignSection', () => {
  it('inserts ahead of the Visual Contract and the page still parses', () => {
    const spliced = spliceDesignSection(PAGE, renderDesignSection(ARCHITECTURE))
    expect(spliced.indexOf('## Design')).toBeGreaterThan(spliced.indexOf('## Core Intent'))
    expect(spliced.indexOf('## Design')).toBeLessThan(spliced.indexOf('## Visual Contract'))
    const parsed = parse(spliced)
    expect(parsed.doc).toBeTruthy()
    expect(spliced).toContain('<Frame name="hero"')
  })

  it('replaces an existing Design section rather than stacking a second', () => {
    const once = spliceDesignSection(PAGE, renderDesignSection(ARCHITECTURE))
    const twice = spliceDesignSection(once, '## Design\n\nrewritten.')
    expect(twice.match(/^## Design$/gm)).toHaveLength(1)
    expect(twice).toContain('rewritten.')
    expect(twice).not.toContain('### Appearance')
    expect(twice).toContain('## Visual Contract')
    expect(parse(twice).doc).toBeTruthy()
  })

  it('keeps the contract byte-for-byte', () => {
    const spliced = spliceDesignSection(PAGE, '## Design\n\nx.')
    const contract = (s: string) => s.slice(s.indexOf('## Visual Contract'))
    expect(contract(spliced)).toBe(contract(PAGE))
  })
})
