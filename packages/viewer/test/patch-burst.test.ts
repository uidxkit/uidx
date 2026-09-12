import { describe, expect, it } from 'vitest'
import { collapseBurst, novelPatches } from '../src/patch-burst'
import type { UidxPatch } from '@uidx/format'

const set = (prop: string, value: number | string): UidxPatch => ({
  op: 'set',
  address: 'Button/Primary#container',
  prop,
  value,
})
const add = (prop: string, value: number | string): UidxPatch => ({
  op: 'add',
  address: 'Button/Primary#container',
  prop,
  value,
})

/**
 * One committed edit can cascade: flipping `primaryAxisSizingMode` to FIXED
 * makes the SDK pin the frame's current hug width, and the layout engine then
 * re-announces that same write on its next pass and again when the echo
 * settles. Measured from one click: a set, then the same `add width` three
 * times over ~75ms, each dispatched against a revision the previous one had
 * already advanced — so the later ones lose C3's check and the author gets a
 * stale banner for an edit they made once.
 */
describe('novelPatches', () => {
  it('drops a patch identical to one already in flight', () => {
    const pending = [add('width', 116)]
    expect(novelPatches(pending, [add('width', 116)])).toEqual([])
  })

  it('ignores op when comparing — the echo turns a pending add into a set', () => {
    const pending = [add('width', 116)]
    expect(novelPatches(pending, [set('width', 116)])).toEqual([])
  })

  it('passes a different value through', () => {
    const pending = [add('width', 116)]
    expect(novelPatches(pending, [set('width', 200)])).toEqual([set('width', 200)])
  })

  it('passes a different prop through', () => {
    const pending = [add('width', 116)]
    expect(novelPatches(pending, [add('height', 41)])).toEqual([add('height', 41)])
  })

  it('passes a different address through', () => {
    const pending = [add('width', 116)]
    const other: UidxPatch = {
      op: 'add',
      address: 'Button/Primary#container/label',
      prop: 'width',
      value: 116,
    }
    expect(novelPatches(pending, [other])).toEqual([other])
  })

  it('drops duplicates arriving within one call', () => {
    expect(novelPatches([], [add('width', 116), add('width', 116)])).toEqual([add('width', 116)])
  })

  it('passes structural ops through even when repeated — only property ops cascade', () => {
    const move: UidxPatch = { op: 'move-node', address: 'a', newParent: 'b', index: 0 }
    expect(novelPatches([move], [move])).toEqual([move])
  })

  it('compares object values structurally', () => {
    const a: UidxPatch = { op: 'set', address: 'n', prop: 'fills', value: [{ type: 'SOLID' }] }
    const b: UidxPatch = { op: 'set', address: 'n', prop: 'fills', value: [{ type: 'SOLID' }] }
    expect(novelPatches([a], [b])).toEqual([])
  })
})

/**
 * One envelope may only say one thing per property. A commit to a prop the
 * layout engine also touches can put two patches for the same address+prop in
 * one burst — measured as [add x=<scrubbed>, add x=<flow>] when scrubbing x on
 * a flowed child — and the server applies ops serially, so the second add
 * found the attribute the first had just created and refused the whole
 * envelope. The scene's final word is the burst's last patch.
 */
describe('collapseBurst', () => {
  const add = (prop: string, value: number): UidxPatch => ({
    op: 'add',
    address: 'Card#root/actions',
    prop,
    value,
  })
  const set = (prop: string, value: number): UidxPatch => ({
    op: 'set',
    address: 'Card#root/actions',
    prop,
    value,
  })

  it('keeps the last value for a property announced twice', () => {
    expect(collapseBurst([add('x', 25), add('x', 14)])).toEqual([add('x', 14)])
  })

  it('stays an add when a later set follows the add that introduced the prop', () => {
    expect(collapseBurst([add('x', 25), set('x', 14)])).toEqual([add('x', 14)])
  })

  it('keeps the last of two sets', () => {
    expect(collapseBurst([set('x', 25), set('x', 14)])).toEqual([set('x', 14)])
  })

  it('drops the pair entirely when an add is taken back by a remove', () => {
    const remove: UidxPatch = { op: 'remove', address: 'Card#root/actions', prop: 'x' }
    expect(collapseBurst([add('x', 25), remove])).toEqual([])
  })

  it('lets a remove win over the set it follows', () => {
    const remove: UidxPatch = { op: 'remove', address: 'Card#root/actions', prop: 'x' }
    expect(collapseBurst([set('x', 25), remove])).toEqual([remove])
  })

  it('leaves distinct properties and structural ops alone, in order', () => {
    const move: UidxPatch = { op: 'move-node', address: 'a', newParent: 'b', index: 0 }
    expect(collapseBurst([add('x', 1), move, add('y', 2)])).toEqual([
      add('x', 1),
      move,
      add('y', 2),
    ])
  })

  it('collapses per address, not per prop name alone', () => {
    const other: UidxPatch = { op: 'set', address: 'Card#root', prop: 'x', value: 9 }
    expect(collapseBurst([add('x', 1), other])).toEqual([add('x', 1), other])
  })
})
