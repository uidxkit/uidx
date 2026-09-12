import { describe, expect, it } from 'vitest'
import { parseOrThrow } from '@uidx/format'
import { detachVariable } from '../src/variable-binding'

const DOC = parseOrThrow(
  `---\nid: p\n---\n\n## Visual Contract\n\n<Page>\n  <Frame name="f" cornerRadius="{radius#md}" />\n</Page>\n`,
)

describe('detach writes the literal (G8)', () => {
  it('replaces the alias with the value it resolved to', () => {
    expect(detachVariable(DOC, 'f', 'cornerRadius', 8)).toEqual([
      { op: 'set', address: 'f', prop: 'cornerRadius', value: 8 },
    ])
  })

  // A detach that blanks the property loses the design. Figma's own equivalent
  // — dragging an auto-layout handle — silently drops the binding, and that is
  // the behaviour the review named as fatal for bidirectional sync.
  it('never removes the property', () => {
    const patches = detachVariable(DOC, 'f', 'cornerRadius', 8)!
    expect(patches.some((p) => p.op === 'remove')).toBe(false)
  })

  it('keeps a colour object whole when adding a literal override', () => {
    const white = { r: 1, g: 1, b: 1, a: 1 }
    expect(detachVariable(DOC, 'f', 'fills', white)).toEqual([
      { op: 'add', address: 'f', prop: 'fills', value: white },
    ])
  })

  it('refuses when the token resolved to nothing', () => {
    expect(detachVariable(DOC, 'f', 'cornerRadius', undefined)).toBeNull()
  })

  it('refuses an unknown address', () => {
    expect(detachVariable(DOC, 'nope', 'cornerRadius', 8)).toBeNull()
  })
})
