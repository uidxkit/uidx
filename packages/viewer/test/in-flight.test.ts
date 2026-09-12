import { describe, expect, it } from 'vitest'
import { createInFlight } from '../src/in-flight'

describe('createInFlight (spec §4)', () => {
  it('holds batches in dispatch order until settled', () => {
    const flight = createInFlight()
    flight.push('p1', [{ op: 'set', address: 'a', prop: 'visible', value: false }])
    flight.push('p2', [{ op: 'set', address: 'a', prop: 'visible', value: true }])
    expect(flight.size).toBe(2)
    expect(flight.patches().map((p) => (p as { value: unknown }).value)).toEqual([false, true])
    expect(flight.settle('p1')).toBe(true)
    expect(flight.settle('p1')).toBe(false)
    expect(flight.patches()).toHaveLength(1)
    expect(flight.has('p2')).toBe(true)
    expect(flight.has('p1')).toBe(false)
  })

  it('bumps a version on every change so a computed can depend on it', () => {
    const flight = createInFlight()
    const v0 = flight.version
    flight.push('p1', [{ op: 'set', address: 'a', prop: 'visible', value: false }])
    expect(flight.version).toBeGreaterThan(v0)
    const v1 = flight.version
    flight.settle('p1')
    expect(flight.version).toBeGreaterThan(v1)
    const v2 = flight.version
    flight.settle('never')
    expect(flight.version).toBe(v2)
  })
})
