import { describe, expect, it } from 'vitest'
import type { UidxPatch } from '@uidx/format'
import { createUndoStack } from '../src/undo-stack'

const set = (value: boolean): UidxPatch => ({ op: 'set', address: 'a', prop: 'visible', value })

describe('createUndoStack (spec §5)', () => {
  it('undo returns the top entry and moves it to redo; redo brings it back', () => {
    const stack = createUndoStack()
    stack.pushAuthor('p.uidx', [set(false)], [set(true)], 'Hide a')
    expect(stack.canUndo).toBe(true)
    const entry = stack.undo()!
    expect(entry.files.get('p.uidx')!.inverse).toEqual([set(true)])
    expect(stack.canUndo).toBe(false)
    expect(stack.canRedo).toBe(true)
    expect(stack.redo()!.files.get('p.uidx')!.forward).toEqual([set(false)])
    expect(stack.canRedo).toBe(false)
    expect(stack.undo()).not.toBeNull()
    expect(stack.undo()).toBeNull()
  })

  it('a new entry clears redo', () => {
    const stack = createUndoStack()
    stack.pushAuthor('p.uidx', [set(false)], [set(true)], 'one')
    stack.undo()
    stack.pushExternal('p.uidx', [set(false)], [set(true)], 'h1')
    expect(stack.canRedo).toBe(false)
  })

  it('external entries are labelled, carry their hash, and say when there is nothing to undo', () => {
    const stack = createUndoStack()
    stack.pushExternal('p.uidx', [set(false)], [set(true)], 'h1')
    stack.pushExternal('q.uidx', [], [], 'h2')
    expect(stack.entries[0]).toMatchObject({ origin: 'external', hashes: ['h1'] })
    expect(stack.entries[1]!.label).toMatch(/nothing to undo/)
  })

  it('attributeTurn merges the run of external entries a turn wrote into one entry', () => {
    const stack = createUndoStack()
    stack.pushAuthor('p.uidx', [set(false)], [set(true)], 'mine')
    stack.pushExternal('p.uidx', [set(true)], [set(false)], 'h1')
    stack.pushExternal('q.uidx', [set(false)], [set(true)], 'h2')
    stack.pushExternal('p.uidx', [set(false)], [set(true)], 'h9') // somebody else's
    stack.attributeTurn('t1', ['h1', 'h2'])
    expect(stack.entries.map((e) => e.origin)).toEqual(['author', { turn: 't1' }, 'external'])
    const turn = stack.entries[1]!
    expect([...turn.files.keys()].sort()).toEqual(['p.uidx', 'q.uidx'])
    expect(turn.hashes).toEqual(['h1', 'h2'])
  })

  it('a turn entry with two revisions on one file appends forward and prepends inverse', () => {
    const stack = createUndoStack()
    stack.pushExternal('p.uidx', [set(true)], [set(false)], 'h1')
    stack.pushExternal('p.uidx', [set(false)], [set(true)], 'h2')
    stack.attributeTurn('t1', ['h1', 'h2'])
    const entry = stack.undo()!
    expect(entry.files.get('p.uidx')!.forward).toEqual([set(true), set(false)])
    expect(entry.files.get('p.uidx')!.inverse).toEqual([set(true), set(false)])
  })

  it('attributeTurn with no matching entries changes nothing', () => {
    const stack = createUndoStack()
    stack.pushExternal('p.uidx', [set(true)], [set(false)], 'h1')
    const v = stack.version
    stack.attributeTurn('t1', ['zzz'])
    expect(stack.version).toBe(v)
    expect(stack.entries).toHaveLength(1)
  })
})
