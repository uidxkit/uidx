import { describe, expect, it } from 'vitest'
import { emitTree, parseOrThrow } from '@uidx/format'

import { CREATABLE_ELEMENTS, createSpec, isCreatable } from '../src/create'
import { defaultFor } from '../src/defaults'

describe('what the toolbar offers', () => {
  it('is exactly the elements a person can draw', () => {
    expect([...CREATABLE_ELEMENTS]).toEqual(['Frame', 'Text', 'Rectangle', 'Ellipse', 'Vector'])
  })

  it('does not offer Component, which is a declaration rather than a shape', () => {
    expect(isCreatable('Component')).toBe(false)
    expect(isCreatable('Page')).toBe(false)
  })
})

const drawn = { at: { x: 10, y: 20 }, size: { width: 80, height: 40 } }
const clicked = { at: { x: 10, y: 20 }, size: null }

describe('createSpec', () => {
  it('states what the author decided and nothing else', () => {
    const spec = createSpec('Rectangle', 'rectangle-1', drawn)
    expect(Object.keys(spec.attrs).filter((k) => k !== 'fills')).toEqual([
      'name',
      'x',
      'y',
      'width',
      'height',
    ])
  })

  it('leaves the size to the engine when the author only clicked', () => {
    const spec = createSpec('Rectangle', 'rectangle-1', clicked)
    expect(spec.attrs.width).toBeUndefined()
    expect(spec.attrs.height).toBeUndefined()
    // Not an omission: the engine already answers, and C7 shows it dimmed.
    expect(defaultFor('Rectangle', 'width')).toBe(100)
  })

  it('writes no position where the parent lays its children out', () => {
    const spec = createSpec('Frame', 'frame-1', { at: null, size: { width: 8, height: 8 } })
    expect(spec.attrs.x).toBeUndefined()
    expect(spec.attrs.y).toBeUndefined()
  })

  /**
   * The one thing the engine will not supply. A bare Frame, Rectangle, Ellipse
   * and Vector all resolve `fills` to `[]`, so a node created without one draws
   * nothing at all — and a tool that appears to do nothing is worse than none.
   */
  it('gives every shape a fill, because the engine gives none', () => {
    for (const element of CREATABLE_ELEMENTS) {
      if (element === 'Text') continue
      expect(defaultFor(element, 'fills')).toEqual([])
      expect(createSpec(element, 'n', drawn).attrs.fills).toBeDefined()
    }
  })

  it('leaves text its fill, which the engine does supply', () => {
    expect(createSpec('Text', 'text-1', drawn).attrs.fills).toBeUndefined()
    expect(defaultFor('Text', 'fills')).not.toEqual([])
  })

  it('gives a dragged text a fixed box and a clicked one a hug, the way Figma does', () => {
    // The dragged case needs no attribute: it authors a size, and a size the
    // file states is already a fixed box (`textSizing` in to-scene). The
    // engine's default for a text that authors nothing is the hug itself —
    // which is why `defaultFor`, probing a bare `<Text>`, reports it.
    expect(createSpec('Text', 'text-1', drawn).attrs.textAutoResize).toBeUndefined()
    expect(defaultFor('Text', 'textAutoResize')).toBe('WIDTH_AND_HEIGHT')
    expect(createSpec('Text', 'text-1', clicked).attrs.textAutoResize).toBe('WIDTH_AND_HEIGHT')
    expect(createSpec('Text', 'text-1', clicked).attrs.characters).toBe('Text')
  })

  it('gives a vector a visible path, since one with none renders nothing', () => {
    expect(createSpec('Vector', 'vector-1', drawn).attrs.vectorPaths).toEqual([
      { windingRule: 'NONZERO', data: 'M0 40 L40 0 L80 40 Z' },
    ])
  })

  it('emits as a document that parses back to what was asked for', () => {
    for (const element of CREATABLE_ELEMENTS) {
      const spec = createSpec(element, `${element.toLowerCase()}-1`, drawn)
      const source = `---\nid: p\n---\n\n## Visual Contract\n\n<Page>\n${emitTree(spec, '  ')}\n</Page>\n`
      const node = parseOrThrow(source).tree.children[0]!
      expect(node.element).toBe(element)
      expect(node.name).toBe(`${element.toLowerCase()}-1`)
    }
  })
})
