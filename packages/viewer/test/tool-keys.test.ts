import { describe, expect, it } from 'vitest'

import { isDeleteKey, isTypingTarget, toolFor } from '../src/tool-keys'

const press = (code: string, over: Record<string, unknown> = {}) => ({ code, ...over })
const inField = { target: { tagName: 'INPUT', isContentEditable: false } }

describe('toolFor', () => {
  it('arms each shape on the letter Figma uses', () => {
    expect(toolFor(press('KeyF'))).toBe('Frame')
    expect(toolFor(press('KeyR'))).toBe('Rectangle')
    expect(toolFor(press('KeyO'))).toBe('Ellipse')
    expect(toolFor(press('KeyT'))).toBe('Text')
    expect(toolFor(press('KeyP'))).toBe('Vector')
    expect(toolFor(press('KeyP', { shiftKey: true }))).toBe('Pencil')
    expect(toolFor(press('KeyL'))).toBe('Line')
    expect(toolFor(press('KeyL', { shiftKey: true }))).toBe('Arrow')
  })

  /**
   * Three answers, not two. `null` means the toolbar handled it and went back
   * to selecting; `undefined` means the key was never the toolbar's, and
   * whatever else is listening should still see it.
   */
  it('disarms on V and Escape, and says so distinctly from ignoring a key', () => {
    expect(toolFor(press('KeyV'))).toBeNull()
    expect(toolFor(press('Escape'))).toBeNull()
    expect(toolFor(press('KeyZ'))).toBeUndefined()
    expect(toolFor(press('Digit1'))).toBeUndefined()
  })

  it('leaves a modified keystroke to the platform', () => {
    expect(toolFor(press('KeyR', { metaKey: true }))).toBeUndefined()
    expect(toolFor(press('KeyR', { ctrlKey: true }))).toBeUndefined()
  })

  it('leaves the author alone while they are typing', () => {
    expect(toolFor(press('KeyR', inField))).toBeUndefined()
    expect(toolFor(press('Escape', inField))).toBeUndefined()
  })
})

describe('isDeleteKey', () => {
  it('takes both keys people reach for', () => {
    expect(isDeleteKey(press('Delete'))).toBe(true)
    expect(isDeleteKey(press('Backspace'))).toBe(true)
    expect(isDeleteKey(press('KeyX'))).toBe(false)
  })

  it('never fires while the author is typing — that is a caret, not a node', () => {
    expect(isDeleteKey(press('Backspace', inField))).toBe(false)
    expect(isDeleteKey(press('Backspace', { target: { isContentEditable: true } }))).toBe(false)
  })
})

describe('isTypingTarget', () => {
  it('covers the three form tags and contenteditable', () => {
    for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT']) {
      expect(isTypingTarget({ target: { tagName } })).toBe(true)
    }
    expect(isTypingTarget({ target: { isContentEditable: true } })).toBe(true)
    expect(isTypingTarget({ target: { tagName: 'BODY' } })).toBe(false)
    expect(isTypingTarget({})).toBe(false)
  })
})
