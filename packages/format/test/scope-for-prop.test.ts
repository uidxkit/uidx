import { describe, expect, it } from 'vitest'
import { VARIABLE_SCOPES } from '../src/types.js'
import { scopesForProp, SCOPE_FOR_PROP } from '../src/scope-for-prop.js'

describe('SCOPE_FOR_PROP (G8)', () => {
  it('maps corner radius to CORNER_RADIUS, every corner', () => {
    for (const prop of ['cornerRadius', 'topLeftRadius', 'bottomRightRadius']) {
      expect(scopesForProp(prop)).toContain('CORNER_RADIUS')
    }
  })

  // The one divergence from Figma, and the reason for it: Figma filters padding
  // with GAP, which leaves a padding scale and a gap scale indistinguishable.
  it('separates padding from gap, which Figma does not', () => {
    expect(scopesForProp('paddingLeft')).toContain('SPACING')
    expect(scopesForProp('itemSpacing')).toContain('GAP')
    expect(scopesForProp('paddingLeft')).not.toContain('GAP')
    expect(scopesForProp('itemSpacing')).not.toContain('SPACING')
  })

  it('returns null for a prop with no entry, so it is under-filtered not unbindable', () => {
    expect(scopesForProp('somethingNew')).toBeNull()
  })

  it('names only scopes the format blesses', () => {
    for (const scopes of Object.values(SCOPE_FOR_PROP)) {
      for (const scope of scopes) expect(VARIABLE_SCOPES).toContain(scope)
    }
  })
})
