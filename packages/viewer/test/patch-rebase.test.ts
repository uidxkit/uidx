import { describe, expect, it } from 'vitest'
import { parseOrThrow, type UidxPatch } from '@uidx/format'
import { rebasePatches } from '../src/patch-rebase'

/**
 * E4's question, answered per patch: can an edit written against `base` be
 * trusted against `next`? The active author wins for the property they edited
 * (the file-as-source-of-truth policy), so a value changed underneath is *not*
 * a refusal — only a target that is gone, or that a different kind of node now
 * occupies, is.
 */

const doc = (body: string) =>
  parseOrThrow(`---
id: card
---

## Visual Contract

<Page>
${body}
</Page>
`)

const BASE = doc(`  <Component name="Card" status="draft">
    <Frame name="root" x={10} y={20} width={120} height={40}>
      <Text name="label" characters="Hi" fontSize={14} />
    </Frame>
  </Component>`)

const SET_X: UidxPatch = { op: 'set', address: 'Card#root', prop: 'x', value: 300 }

describe('rebasePatches', () => {
  it('passes patches through when the external edit touched something else', () => {
    const next = doc(`  <Component name="Card" status="draft">
    <Frame name="root" x={10} y={20} width={120} height={40}>
      <Text name="label" characters="Hi" fontSize={22} />
    </Frame>
  </Component>`)
    expect(rebasePatches([SET_X], BASE, next)).toEqual([SET_X])
  })

  it('lets the active edit win even when the same property changed underneath', () => {
    const next = doc(`  <Component name="Card" status="draft">
    <Frame name="root" x={99} y={20} width={120} height={40}>
      <Text name="label" characters="Hi" fontSize={14} />
    </Frame>
  </Component>`)
    expect(rebasePatches([SET_X], BASE, next)).toEqual([SET_X])
  })

  it('refuses when the target no longer resolves', () => {
    const next = doc(`  <Component name="Card" status="draft">
    <Frame name="renamed" x={10} y={20} width={120} height={40} />
  </Component>`)
    expect(rebasePatches([SET_X], BASE, next)).toBeNull()
  })

  it('refuses when a different kind of node now sits at the address', () => {
    const next = doc(`  <Component name="Card" status="draft">
    <Frame name="root" x={10} y={20} width={120} height={40}>
      <Rectangle name="label" width={10} height={10} />
    </Frame>
  </Component>`)
    const patch: UidxPatch = {
      op: 'set',
      address: 'Card#root/label',
      prop: 'fontSize',
      value: 18,
    }
    expect(rebasePatches([patch], BASE, next)).toBeNull()
  })

  it('checks an insertion against its parent', () => {
    const insert: UidxPatch = {
      op: 'insert-node',
      parent: 'Card#root',
      index: 0,
      node: { element: 'Rectangle', attrs: { name: 'chip', width: 8, height: 8 } },
    }
    expect(rebasePatches([insert], BASE, BASE)).toEqual([insert])

    const gone = doc(`  <Component name="Card" status="draft">
    <Frame name="renamed" x={10} y={20} width={120} height={40} />
  </Component>`)
    expect(rebasePatches([insert], BASE, gone)).toBeNull()
  })

  it('checks a move against both the node and its destination', () => {
    const move: UidxPatch = {
      op: 'move-node',
      address: 'Card#root/label',
      newParent: 'Card#root',
      index: 0,
    }
    expect(rebasePatches([move], BASE, BASE)).toEqual([move])

    const noDestination = doc(`  <Component name="Card" status="draft">
    <Frame name="other">
      <Text name="label" characters="Hi" fontSize={14} />
    </Frame>
  </Component>`)
    expect(rebasePatches([move], BASE, noDestination)).toBeNull()
  })

  /**
   * The add/set distinction describes the file, and the file moved. A patch
   * that was an `add` against base collides ("already has attribute") if the
   * change also introduced that attribute — the op has to follow the file.
   */
  it('turns an add into a set when the file gained the attribute underneath', () => {
    const next = doc(`  <Component name="Card" status="draft">
    <Frame name="root" x={10} y={20} width={120} height={40} opacity={0.4}>
      <Text name="label" characters="Hi" fontSize={14} />
    </Frame>
  </Component>`)
    const add: UidxPatch = { op: 'add', address: 'Card#root', prop: 'opacity', value: 0.8 }
    expect(rebasePatches([add], BASE, next)).toEqual([
      { op: 'set', address: 'Card#root', prop: 'opacity', value: 0.8 },
    ])
  })

  it('turns a set into an add when the file lost the attribute underneath', () => {
    const next = doc(`  <Component name="Card" status="draft">
    <Frame name="root" y={20} width={120} height={40}>
      <Text name="label" characters="Hi" fontSize={14} />
    </Frame>
  </Component>`)
    expect(rebasePatches([SET_X], BASE, next)).toEqual([
      { op: 'add', address: 'Card#root', prop: 'x', value: 300 },
    ])
  })

  it('drops a remove whose attribute is already gone', () => {
    const next = doc(`  <Component name="Card" status="draft">
    <Frame name="root" y={20} width={120} height={40}>
      <Text name="label" characters="Hi" fontSize={14} />
    </Frame>
  </Component>`)
    const remove: UidxPatch = { op: 'remove', address: 'Card#root', prop: 'x' }
    expect(rebasePatches([remove, SET_X], BASE, next)).toEqual([
      { op: 'add', address: 'Card#root', prop: 'x', value: 300 },
    ])
  })

  it('refuses the whole batch when any one patch cannot be trusted', () => {
    const gone: UidxPatch = { op: 'set', address: 'Card#ghost', prop: 'x', value: 1 }
    expect(rebasePatches([SET_X, gone], BASE, BASE)).toBeNull()
  })
})

/**
 * C10b sends a reparent as one ordered envelope: the move, then the position
 * writes that keep the node where the pointer left it. Those name an address
 * the *envelope itself* creates, so validating each patch against `next`
 * independently refuses every one of them — the node is not there yet.
 */
describe('an envelope whose later patches name what an earlier one creates', () => {
  const DROP: UidxPatch[] = [
    { op: 'move-node', address: 'Card#root/label', newParent: 'loose', index: 0 },
    { op: 'add', address: 'loose#label', prop: 'x', value: 12 },
    { op: 'add', address: 'loose#label', prop: 'y', value: 34 },
  ]
  const WITH_LOOSE = `  <Component name="Card" status="draft">
    <Frame name="root" x={10} y={20} width={120} height={40}>
      <Text name="label" characters="Hi" fontSize={14} />
    </Frame>
  </Component>
  <Frame name="loose" />`

  it('trusts a target the move itself will produce', () => {
    const next = doc(WITH_LOOSE.replace('fontSize={14}', 'fontSize={22}'))
    expect(rebasePatches(DROP, doc(WITH_LOOSE), next)).toEqual(DROP)
  })

  it('still refuses the whole envelope when the moved node has gone', () => {
    const next = doc(`  <Component name="Card" status="draft">
    <Frame name="root" x={10} y={20} width={120} height={40} />
  </Component>
  <Frame name="loose" />`)
    expect(rebasePatches(DROP, doc(WITH_LOOSE), next)).toBeNull()
  })

  it('still refuses it when the destination has gone', () => {
    const next = doc(`  <Component name="Card" status="draft">
    <Frame name="root" x={10} y={20} width={120} height={40}>
      <Text name="label" characters="Hi" fontSize={14} />
    </Frame>
  </Component>`)
    expect(rebasePatches(DROP, doc(WITH_LOOSE), next)).toBeNull()
  })

  it('follows the file for add-versus-set, reading through the pending move', () => {
    // `label` gained an `x` externally, so the drop's `add` has to become a
    // `set` — decided against the node at the address it has *now*.
    const next = doc(WITH_LOOSE.replace('characters="Hi"', 'characters="Hi" x={7}'))
    const out = rebasePatches(DROP, doc(WITH_LOOSE), next)
    expect(out?.map((p) => p.op)).toEqual(['move-node', 'set', 'add'])
  })
})
