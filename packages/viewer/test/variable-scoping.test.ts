import { describe, expect, it } from 'vitest'
import { parseOrThrow } from '@uidx/format'
import { buildTokenIndex, defaultTuple, TokenResolver } from '@uidx/schema'
import { variableCandidates } from '../src/variable-binding'

const DOC = parseOrThrow(`---
id: t
---

## Visual Contract

<Tokens>
  <Collection name="radius">
    <Variable name="lg" type="FLOAT" value={16} scopes={['CORNER_RADIUS']} />
  </Collection>
  <Collection name="space">
    <Variable name="sm" type="FLOAT" value={4} scopes={['SPACING']} />
  </Collection>
  <Collection name="any">
    <Variable name="loose" type="FLOAT" value={2} />
  </Collection>
</Tokens>
`)

const index = buildTokenIndex([DOC])
const tokens = new Map(new TokenResolver(index).resolve(defaultTuple(index)))
const addresses = (prop: string | null) =>
  variableCandidates(tokens, index, 'FLOAT', prop)
    .map((c) => c.address)
    .sort()

describe('scope-filtered candidates (G8)', () => {
  it('hides a variable scoped away from this property', () => {
    expect(addresses('cornerRadius')).toEqual(['any#loose', 'radius#lg'])
  })

  it('separates padding from gap', () => {
    expect(addresses('paddingLeft')).toEqual(['any#loose', 'space#sm'])
    expect(addresses('itemSpacing')).toEqual(['any#loose'])
  })

  it('shows an unscoped variable everywhere, since absent means ALL_SCOPES', () => {
    expect(addresses('fontSize')).toContain('any#loose')
  })

  it('falls back to type-only filtering when the prop has no scope entry', () => {
    expect(addresses('somethingNew')).toEqual(['any#loose', 'radius#lg', 'space#sm'])
  })

  it('filters by type alone when no prop is given', () => {
    expect(addresses(null)).toHaveLength(3)
  })
})
