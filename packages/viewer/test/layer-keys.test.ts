import { describe, expect, it } from 'vitest'

import { keyIntent } from '../src/layer-keys'
import type { LayerRow } from '../src/layer-rows'

/**
 * A small tree, already flattened to the shape `visibleRows` would produce:
 *
 * '' (page)
 *   Button/Primary (component, expanded)
 *     Button/Primary#container (frame, expanded, has children)
 *       Button/Primary#container/icon (leaf)
 *       Button/Primary#container/label (leaf)
 *     Button/Primary#footer (frame, collapsed, has children — its child is
 *       not in this list because visibleRows would already have hidden it)
 */
function row(address: string, depth: number, hasChildren: boolean): LayerRow {
  return {
    address,
    name: address || 'page',
    element: hasChildren ? 'Frame' : 'Text',
    depth,
    hasChildren,
    visible: true,
    declaresVisible: false,
    derived: false,
    generated: false,
  }
}

const ROWS: LayerRow[] = [
  row('', 0, true),
  row('Button/Primary', 1, true),
  row('Button/Primary#container', 2, true),
  row('Button/Primary#container/icon', 3, false),
  row('Button/Primary#container/label', 3, false),
  row('Button/Primary#footer', 2, true),
]

describe('keyIntent', () => {
  describe('ArrowDown / ArrowUp', () => {
    it('moves to the next visible row', () => {
      expect(keyIntent(ROWS, 'Button/Primary', false, 'ArrowDown')).toEqual({
        kind: 'move',
        address: 'Button/Primary#container',
      })
    })

    it('moves to the previous visible row', () => {
      expect(keyIntent(ROWS, 'Button/Primary#container', false, 'ArrowUp')).toEqual({
        kind: 'move',
        address: 'Button/Primary',
      })
    })

    it('stays put on ArrowDown at the last visible row', () => {
      expect(keyIntent(ROWS, 'Button/Primary#footer', false, 'ArrowDown')).toBeNull()
    })

    it('stays put on ArrowUp at the first visible row', () => {
      expect(keyIntent(ROWS, '', false, 'ArrowUp')).toBeNull()
    })
  })

  describe('ArrowRight', () => {
    it('does nothing on a leaf', () => {
      expect(keyIntent(ROWS, 'Button/Primary#container/icon', false, 'ArrowRight')).toBeNull()
    })

    it('expands a collapsed row with children', () => {
      expect(keyIntent(ROWS, 'Button/Primary#footer', false, 'ArrowRight')).toEqual({
        kind: 'expand',
      })
    })

    it('descends to the first child of an already-expanded row', () => {
      expect(keyIntent(ROWS, 'Button/Primary#container', true, 'ArrowRight')).toEqual({
        kind: 'move',
        address: 'Button/Primary#container/icon',
      })
    })
  })

  describe('ArrowLeft', () => {
    it('does nothing at the root', () => {
      expect(keyIntent(ROWS, '', false, 'ArrowLeft')).toBeNull()
    })

    it('collapses an expanded row with children', () => {
      expect(keyIntent(ROWS, 'Button/Primary#container', true, 'ArrowLeft')).toEqual({
        kind: 'collapse',
      })
    })

    it('climbs to the parent from a collapsed row', () => {
      expect(keyIntent(ROWS, 'Button/Primary#footer', false, 'ArrowLeft')).toEqual({
        kind: 'move',
        address: 'Button/Primary',
      })
    })

    it('climbs to the parent from a leaf', () => {
      expect(keyIntent(ROWS, 'Button/Primary#container/icon', false, 'ArrowLeft')).toEqual({
        kind: 'move',
        address: 'Button/Primary#container',
      })
    })
  })

  describe('Home / End', () => {
    it('Home moves to the first visible row', () => {
      expect(keyIntent(ROWS, 'Button/Primary#container/label', false, 'Home')).toEqual({
        kind: 'move',
        address: '',
      })
    })

    it('End moves to the last visible row', () => {
      expect(keyIntent(ROWS, '', false, 'End')).toEqual({
        kind: 'move',
        address: 'Button/Primary#footer',
      })
    })
  })

  describe('Enter', () => {
    it('opens the rename on the focused row', () => {
      expect(keyIntent(ROWS, 'Button/Primary#container', false, 'Enter')).toEqual({
        kind: 'rename',
      })
    })
  })

  it('returns null for a key with no binding', () => {
    expect(keyIntent(ROWS, 'Button/Primary', false, 'Tab')).toBeNull()
  })

  it('returns null when the focused address is not among the rows', () => {
    expect(keyIntent(ROWS, 'nowhere', false, 'ArrowDown')).toBeNull()
  })
})
