import { describe, expect, it } from 'vitest'

import { isClientMessage } from '../src/protocol.js'

describe('isClientMessage', () => {
  it('accepts a selection:changed report', () => {
    expect(
      isClientMessage({
        type: 'selection:changed',
        file: 'home.uidx',
        addresses: ['home#hero'],
      }),
    ).toBe(true)
  })

  it('refuses a selection report without addresses', () => {
    expect(isClientMessage({ type: 'selection:changed', file: 'home.uidx' })).toBe(false)
  })

  it('refuses a selection report without a file', () => {
    expect(isClientMessage({ type: 'selection:changed', addresses: [] })).toBe(false)
  })

  it('still accepts a node:patch', () => {
    expect(
      isClientMessage({
        type: 'node:patch',
        patchId: 'p1',
        file: 'home.uidx',
        baseRevision: 1,
        patches: [],
      }),
    ).toBe(true)
  })
})
