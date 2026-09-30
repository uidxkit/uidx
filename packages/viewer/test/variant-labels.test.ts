import { describe, expect, it } from 'vitest'

import { variantCoordinates, variantHeaders } from '../src/variant-labels'

const cell = (name: string, x: number, y: number) => ({ name, x, y, width: 40, height: 20 })

describe('variantHeaders', () => {
  it('names each column by the first axis and each row by the rest', () => {
    const headers = variantHeaders([
      cell('size=sm, state=default', 10, 10),
      cell('size=md, state=default', 60, 10),
      cell('size=sm, state=hover', 10, 40),
      cell('size=md, state=hover', 60, 40),
    ])
    expect(headers.columns).toEqual([
      { text: 'size=sm', x: 10, y: 10 },
      { text: 'size=md', x: 60, y: 10 },
    ])
    expect(headers.rows).toEqual([
      { text: 'state=default', x: 10, y: 20 },
      { text: 'state=hover', x: 10, y: 50 },
    ])
  })

  it('labels a one-axis set by its columns alone', () => {
    const headers = variantHeaders([cell('state=default', 0, 0), cell('state=checked', 50, 0)])
    expect(headers.columns.map((c) => c.text)).toEqual(['state=default', 'state=checked'])
    expect(headers.rows).toEqual([])
  })

  it('says nothing for a lone cell or names that are not variant names', () => {
    expect(variantHeaders([cell('state=default', 0, 0)])).toEqual({ columns: [], rows: [] })
    expect(variantCoordinates('Primary')).toBeNull()
  })
})
