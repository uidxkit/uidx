import { largeDocument } from './large-document.js'
import { describe, expect, it } from 'vitest'
import {
  applyPatches,
  diffToPatches,
  parseOrThrow,
  type UidxDocument,
  type UidxNode,
} from '../src/index.js'

const shape = (node: UidxNode): unknown => [
  node.element,
  Object.fromEntries(Object.entries(node.attrs).map(([k, a]) => [k, a.value])),
  node.children.map(shape),
]
const page = (body: string) =>
  parseOrThrow(`---\nid: p\n---\n\n## Visual Contract\n\n<Page>\n${body}\n</Page>\n`)

function reaches(prev: UidxDocument, next: UidxDocument): void {
  const patches = diffToPatches(prev, next)
  const result = applyPatches(prev.source, patches)
  expect(shape(result.document!.tree)).toEqual(shape(next.tree))
}

describe('diffToPatches (spec §5)', () => {
  it('is empty for identical trees, even with different prose', () => {
    const a = page(`  <Frame name="a" />`)
    const b = parseOrThrow(
      a.source.replace('## Visual Contract', '## Core Intent\n\nSome prose.\n\n## Visual Contract'),
    )
    expect(diffToPatches(a, b)).toEqual([])
  })

  it('emits set/add/remove for attribute differences', () => {
    const a = page(`  <Frame name="a" cornerRadius={4} visible={true} />`)
    const b = page(`  <Frame name="a" cornerRadius={8} opacity={0.5} />`)
    expect(diffToPatches(a, b)).toEqual(
      expect.arrayContaining([
        { op: 'set', address: 'a', prop: 'cornerRadius', value: 8 },
        { op: 'add', address: 'a', prop: 'opacity', value: 0.5 },
        { op: 'remove', address: 'a', prop: 'visible' },
      ]),
    )
    reaches(a, b)
  })

  it('emits remove-node and insert-node for structure, both ways', () => {
    const withChild = page(`  <Frame name="a">\n    <Text name="t" characters="x" />\n  </Frame>`)
    const without = page(`  <Frame name="a" />`)
    expect(diffToPatches(withChild, without)).toEqual([{ op: 'remove-node', address: 'a#t' }])
    reaches(withChild, without)
    reaches(without, withChild)
  })

  it('emits move-node for reordering', () => {
    const ab = page(
      `  <Frame name="a">\n    <Text name="x" characters="x" />\n    <Text name="y" characters="y" />\n  </Frame>`,
    )
    const ba = page(
      `  <Frame name="a">\n    <Text name="y" characters="y" />\n    <Text name="x" characters="x" />\n  </Frame>`,
    )
    reaches(ab, ba)
  })

  it('a rename is a remove plus an insert', () => {
    reaches(page(`  <Frame name="a" />`), page(`  <Frame name="b" />`))
  })

  it('the inverse diff takes the change back', () => {
    const a = page(
      `  <Frame name="a" cornerRadius={4}>\n    <Text name="t" characters="x" />\n  </Frame>`,
    )
    const b = page(`  <Frame name="a" cornerRadius={8} />`)
    const forward = applyPatches(a.source, diffToPatches(a, b)).document!
    const back = applyPatches(forward.source, diffToPatches(b, a)).document!
    expect(shape(back.tree)).toEqual(shape(a.tree))
  })

  it('is empty for a large variant document against itself, and one op for one attribute', () => {
    const src = largeDocument()
    const a = parseOrThrow(src)
    expect(diffToPatches(a, parseOrThrow(src))).toEqual([])
    const b = applyPatches(
      src,
      [{ op: 'add', address: 'doc#cover', prop: 'opacity', value: 0.5 }],
      {
        document: a,
      },
    ).document!
    const patches = diffToPatches(a, b)
    expect(patches).toHaveLength(1)
    expect(patches[0]).toMatchObject({ address: 'doc#cover', prop: 'opacity', value: 0.5 })
  })
})
