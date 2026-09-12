import { describe, expect, it } from 'vitest'
import {
  applyPatches,
  inversePatches,
  parseOrThrow,
  type UidxNode,
  type UidxPatch,
} from '../src/index.js'

const SRC = `---
id: p
---

## Visual Contract

<Page>
  <Frame name="doc">
    <Rectangle name="cover" width={10} visible={true} />
    <Rectangle name="other" width={10} />
    <Frame name="group">
      <Text name="label" characters="Hi" />
    </Frame>
  </Frame>
</Page>
`

/** Element, attribute values and children — what "the same tree" means here. */
const shape = (node: UidxNode): unknown => [
  node.element,
  Object.fromEntries(Object.entries(node.attrs).map(([k, a]) => [k, a.value])),
  node.children.map(shape),
]

function roundTrips(patches: UidxPatch[]): void {
  const doc = parseOrThrow(SRC)
  const inverse = inversePatches(doc, patches)
  const forward = applyPatches(SRC, patches)
  const back = applyPatches(forward.source, inverse)
  expect(shape(back.document!.tree)).toEqual(shape(doc.tree))
}

describe('inversePatches (spec §5)', () => {
  it('set → set old', () => {
    expect(
      inversePatches(parseOrThrow(SRC), [
        { op: 'set', address: 'doc#cover', prop: 'width', value: 20 },
      ]),
    ).toEqual([{ op: 'set', address: 'doc#cover', prop: 'width', value: 10 }])
  })

  it('add → remove, remove → add old', () => {
    const doc = parseOrThrow(SRC)
    expect(
      inversePatches(doc, [{ op: 'add', address: 'doc#other', prop: 'visible', value: false }]),
    ).toEqual([{ op: 'remove', address: 'doc#other', prop: 'visible' }])
    expect(inversePatches(doc, [{ op: 'remove', address: 'doc#cover', prop: 'visible' }])).toEqual([
      { op: 'add', address: 'doc#cover', prop: 'visible', value: true },
    ])
  })

  it('two edits to one property invert newest first against the running value', () => {
    expect(
      inversePatches(parseOrThrow(SRC), [
        { op: 'set', address: 'doc#cover', prop: 'width', value: 20 },
        { op: 'set', address: 'doc#cover', prop: 'width', value: 30 },
      ]),
    ).toEqual([
      { op: 'set', address: 'doc#cover', prop: 'width', value: 20 },
      { op: 'set', address: 'doc#cover', prop: 'width', value: 10 },
    ])
  })

  it('round-trips attribute batches', () => {
    roundTrips([
      { op: 'set', address: 'doc#cover', prop: 'width', value: 20 },
      { op: 'add', address: 'doc#other', prop: 'visible', value: false },
      { op: 'remove', address: 'doc#cover', prop: 'visible' },
    ])
  })

  it('round-trips remove-node', () => {
    roundTrips([{ op: 'remove-node', address: 'doc#group' }])
  })

  it('round-trips insert-node', () => {
    roundTrips([
      {
        op: 'insert-node',
        parent: 'doc',
        index: 1,
        node: { element: 'Rectangle', attrs: { name: 'added', width: 5 } },
      },
    ])
  })

  it('round-trips move-node', () => {
    roundTrips([{ op: 'move-node', address: 'doc#cover', newParent: 'doc#group', index: 0 }])
  })

  it('refuses an insert without a name', () => {
    expect(() =>
      inversePatches(parseOrThrow(SRC), [
        { op: 'insert-node', parent: 'doc', index: 0, node: { element: 'Rectangle', attrs: {} } },
      ]),
    ).toThrow(/name/)
  })
})
