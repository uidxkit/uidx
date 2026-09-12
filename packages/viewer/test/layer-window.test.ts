import { describe, expect, it } from 'vitest'

import { OVERSCAN, ROW_HEIGHT, rowWindow, scrollTopFor } from '../src/layer-window'

describe('rowWindow', () => {
  it('covers the viewport plus the overscan on each side', () => {
    // 10 rows tall, scrolled 100 rows down.
    const w = rowWindow(1000, 100 * ROW_HEIGHT, 10 * ROW_HEIGHT)
    expect(w).toEqual({ start: 100 - OVERSCAN, end: 110 + OVERSCAN })
  })

  it('rounds outward on a partial row', () => {
    const w = rowWindow(1000, 100 * ROW_HEIGHT + 5, 10 * ROW_HEIGHT - 5, ROW_HEIGHT, 0)
    // Row 100 is partly visible at the top; row 109 ends exactly at the bottom.
    expect(w).toEqual({ start: 100, end: 110 })
  })

  it('clamps to the ends of the list', () => {
    expect(rowWindow(1000, 0, 10 * ROW_HEIGHT)).toEqual({ start: 0, end: 10 + OVERSCAN })
    expect(rowWindow(1000, 995 * ROW_HEIGHT, 10 * ROW_HEIGHT)).toEqual({
      start: 995 - OVERSCAN,
      end: 1000,
    })
    expect(rowWindow(5, 0, 10 * ROW_HEIGHT)).toEqual({ start: 0, end: 5 })
  })

  it('renders everything until the viewport has been measured', () => {
    expect(rowWindow(300, 0, 0)).toEqual({ start: 0, end: 300 })
  })

  it('is empty for an empty list', () => {
    expect(rowWindow(0, 0, 240)).toEqual({ start: 0, end: 0 })
  })

  it('tolerates a negative scroll offset from rubber-banding', () => {
    expect(rowWindow(100, -50, 240, ROW_HEIGHT, 0)).toEqual({ start: 0, end: 10 })
  })
})

describe('scrollTopFor', () => {
  const height = 10 * ROW_HEIGHT

  it('leaves a visible row where it is', () => {
    expect(scrollTopFor(105, 100 * ROW_HEIGHT, height)).toBe(100 * ROW_HEIGHT)
  })

  it('scrolls up just enough for a row above the viewport', () => {
    expect(scrollTopFor(40, 100 * ROW_HEIGHT, height)).toBe(40 * ROW_HEIGHT)
  })

  it('scrolls down just enough for a row below the viewport', () => {
    expect(scrollTopFor(200, 100 * ROW_HEIGHT, height)).toBe(201 * ROW_HEIGHT - height)
  })

  it('only ever scrolls up when the viewport is unmeasured', () => {
    expect(scrollTopFor(200, 100 * ROW_HEIGHT, 0)).toBe(100 * ROW_HEIGHT)
    expect(scrollTopFor(40, 100 * ROW_HEIGHT, 0)).toBe(40 * ROW_HEIGHT)
  })
})
