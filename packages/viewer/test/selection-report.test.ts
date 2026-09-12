import { describe, expect, it } from 'vitest'

import { selectionReport } from '../src/selection-report'

describe('selectionReport', () => {
  it('wraps the current selection as a selection:changed message', () => {
    expect(selectionReport('home.uidx', ['home#hero'])).toEqual({
      type: 'selection:changed',
      file: 'home.uidx',
      addresses: ['home#hero'],
    })
  })

  it('reports an emptied selection too — clearing is news', () => {
    expect(selectionReport('home.uidx', [])).toEqual({
      type: 'selection:changed',
      file: 'home.uidx',
      addresses: [],
    })
  })

  it('reports nothing before a page is open', () => {
    expect(selectionReport(null, ['home#hero'])).toBeNull()
  })
})
