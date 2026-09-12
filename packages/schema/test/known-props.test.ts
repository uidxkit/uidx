import { describe, expect, it } from 'vitest'
import {
  IDENTITY_PROPS,
  KNOWN_PROPS,
  PIN_PROPS,
  PROP_TABLE,
  STRUCTURAL_PROPS,
  isKnownProp,
} from '../src/index.js'

/**
 * `known-props.ts` is a hand-maintained copy of the vocabulary, kept free of
 * SDK imports so the CLI can use it. That copy is only safe because this test
 * fails the moment it drifts from the real table.
 */
describe('KNOWN_PROPS', () => {
  const actual = new Set([
    ...IDENTITY_PROPS,
    ...PROP_TABLE.map((m) => m.uidx),
    // `<Instance>`'s two decide what is built rather than being set on a node,
    // so they are known to the lint and absent from the table by design (F3).
    ...STRUCTURAL_PROPS,
    // The pin offsets are consumed by `resolvePins` and never handed to the
    // engine (ADR 0011 §2). A prop with no scene field cannot be echoed back
    // into the file by a reflow, which is the whole point of keeping them out.
    ...PIN_PROPS,
  ])

  it('lists exactly what the prop table supports, plus the structural two', () => {
    expect([...KNOWN_PROPS].sort()).toEqual([...actual].sort())
  })

  it('keeps the structural props out of the prop table', () => {
    const mapped = new Set(PROP_TABLE.map((m) => m.uidx))
    for (const prop of STRUCTURAL_PROPS) expect(mapped.has(prop)).toBe(false)
  })

  it('keeps the pin offsets out of the prop table', () => {
    const mapped = new Set(PROP_TABLE.map((m) => m.uidx))
    for (const prop of PIN_PROPS) expect(mapped.has(prop)).toBe(false)
    expect([...PIN_PROPS]).toEqual(['right', 'bottom', 'centerX', 'centerY'])
  })

  it('has no duplicates', () => {
    expect(new Set(KNOWN_PROPS).size).toBe(KNOWN_PROPS.length)
  })

  it('answers lookups', () => {
    expect(isKnownProp('cornerRadius')).toBe(true)
    expect(isKnownProp('strokeAlign')).toBe(true)
    expect(isKnownProp('borderRadius')).toBe(false)
  })
})
