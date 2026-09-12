import { describe, expect, it } from 'vitest'
import { cornerModel, cornerWrites, paddingModel, paddingWrites } from '../src/edit-models'

describe('paddingModel', () => {
  it('collapses each axis when its pair agrees', () => {
    expect(paddingModel({ top: 16, right: 20, bottom: 16, left: 20 })).toEqual({
      horizontal: 20,
      vertical: 16,
    })
  })

  it('refuses to collapse an axis whose sides differ', () => {
    expect(paddingModel({ top: 16, right: 20, bottom: 8, left: 20 })).toEqual({
      horizontal: 20,
      vertical: null,
    })
    expect(paddingModel({ top: 16, right: 4, bottom: 16, left: 20 })).toEqual({
      horizontal: null,
      vertical: 16,
    })
  })
})

describe('paddingWrites', () => {
  it('names both props one collapsed axis stands for', () => {
    expect(paddingWrites('horizontal', 12)).toEqual([
      { prop: 'paddingLeft', value: 12 },
      { prop: 'paddingRight', value: 12 },
    ])
    expect(paddingWrites('vertical', 6)).toEqual([
      { prop: 'paddingTop', value: 6 },
      { prop: 'paddingBottom', value: 6 },
    ])
  })
})

describe('cornerModel', () => {
  it('collapses to one field when all four corners agree', () => {
    expect(cornerModel({ top: 8, right: 8, bottom: 8, left: 8 })).toEqual({ uniform: 8 })
  })

  it('refuses to collapse a mixed set', () => {
    expect(cornerModel({ top: 8, right: 8, bottom: 8, left: 0 })).toEqual({ uniform: null })
  })
})

describe('cornerWrites', () => {
  it('names the four corner props', () => {
    expect(cornerWrites(8)).toEqual([
      { prop: 'topLeftRadius', value: 8 },
      { prop: 'topRightRadius', value: 8 },
      { prop: 'bottomRightRadius', value: 8 },
      { prop: 'bottomLeftRadius', value: 8 },
    ])
  })
})
