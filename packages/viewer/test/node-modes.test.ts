import { describe, expect, it } from 'vitest'
import { parseOrThrow } from '@uidx/format'
import { clearNodeMode, setNodeMode } from '../src/variable-binding'

const page = (frame: string) =>
  parseOrThrow(`---\nid: p\n---\n\n## Visual Contract\n\n<Page>\n  ${frame}\n</Page>\n`)

const BARE = page(`<Frame name="f" />`)
const ONE = page(`<Frame name="f" modes={{ density: 'compact' }} />`)
const TWO = page(`<Frame name="f" modes={{ density: 'compact', theme: 'dark' }} />`)

describe('mode patches (G8)', () => {
  it('adds a modes attribute when the node has none', () => {
    expect(setNodeMode(BARE, 'f', 'theme', 'dark')).toEqual([
      { op: 'add', address: 'f', prop: 'modes', value: { theme: 'dark' } },
    ])
  })

  it('merges into an existing modes attribute', () => {
    expect(setNodeMode(ONE, 'f', 'theme', 'dark')).toEqual([
      { op: 'set', address: 'f', prop: 'modes', value: { density: 'compact', theme: 'dark' } },
    ])
  })

  it('removes only the named collection', () => {
    expect(clearNodeMode(TWO, 'f', 'theme')).toEqual([
      { op: 'set', address: 'f', prop: 'modes', value: { density: 'compact' } },
    ])
  })

  // Auto is the absence of the attribute, not a mode called Auto.
  it('removes the attribute when the last entry goes', () => {
    expect(clearNodeMode(ONE, 'f', 'density')).toEqual([
      { op: 'remove', address: 'f', prop: 'modes' },
    ])
  })

  it('returns null when the node has no modes to clear', () => {
    expect(clearNodeMode(BARE, 'f', 'theme')).toBeNull()
  })

  it('returns null for an unknown address', () => {
    expect(setNodeMode(BARE, 'nope', 'theme', 'dark')).toBeNull()
    expect(clearNodeMode(ONE, 'nope', 'density')).toBeNull()
  })
})
