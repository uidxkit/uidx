import { describe, expect, it } from 'vitest'
import { ICON_PATHS, OPTION_ICON, PROP_ICON } from '../src/field-icons'

describe('field icons', () => {
  it('every referenced icon has path data', () => {
    for (const name of Object.values(PROP_ICON)) {
      expect(ICON_PATHS[name!], String(name)).toBeTruthy()
    }
    for (const name of Object.values(OPTION_ICON)) {
      expect(ICON_PATHS[name], name).toBeTruthy()
    }
  })

  it('covers the spec inventory', () => {
    for (const prop of [
      'rotation',
      'opacity',
      'cornerRadius',
      'itemSpacing',
      'counterAxisSpacing',
      'strokeWeight',
      'paddingLeft',
      'paddingRight',
      'paddingTop',
      'paddingBottom',
    ]) {
      expect(PROP_ICON[prop], prop).toBeTruthy()
    }
    for (const key of [
      'layoutMode:NONE',
      'layoutMode:HORIZONTAL',
      'layoutMode:VERTICAL',
      'layoutMode:GRID',
      'layoutWrap:WRAP',
      'layoutWrap:NO_WRAP',
      'textAlignHorizontal:LEFT',
      'textAlignHorizontal:CENTER',
      'textAlignHorizontal:RIGHT',
      'textAlignHorizontal:JUSTIFIED',
      'textAlignVertical:TOP',
      'textAlignVertical:CENTER',
      'textAlignVertical:BOTTOM',
      'textAutoResize:NONE',
      'textAutoResize:HEIGHT',
      'textAutoResize:WIDTH_AND_HEIGHT',
      'textAutoResize:TRUNCATE',
      'strokeAlign:INSIDE',
      'strokeAlign:CENTER',
      'strokeAlign:OUTSIDE',
      'layoutPositioning:AUTO',
      'layoutPositioning:ABSOLUTE',
      'textDecoration:NONE',
      'textDecoration:UNDERLINE',
      'textDecoration:STRIKETHROUGH',
      'textCase:ORIGINAL',
      'textCase:UPPER',
      'textCase:LOWER',
      'textCase:TITLE',
    ]) {
      expect(OPTION_ICON[key], key).toBeTruthy()
    }
  })

  it('carries the popup and header glyphs the UI3 pass added', () => {
    for (const name of ['search', 'close', 'plus', 'variable', 'variables-grid'] as const) {
      expect(ICON_PATHS[name], name).toBeTruthy()
    }
  })
})
