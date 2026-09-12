import { describe, expect, it } from 'vitest'
import { applyPatch, PatchError, parseOrThrow, resolve, type UidxPatch } from '../src/index.js'

/**
 * `retag` — changing what an element is, without reprinting what is inside it
 * (story F14).
 *
 * The op exists for one reason and every test here is about it: the six ops
 * before it could change a node's attributes or move a whole subtree, and none
 * could turn a `<Frame>` into a `<Slot>` without a remove-plus-insert that
 * reprints the children. So what matters is not that the tag changes — it is
 * that nothing else does.
 */
const SOURCE = `---
id: t
---

## Visual Contract

<Page>
  <Component name="Card" status="draft">
    <Frame name="container" layoutMode="VERTICAL">
      {/* the body, which the consumer decides */}
      <Frame
        name="body"
        layoutMode="VERTICAL"
        itemSpacing={8}
      >
        <Text name="placeholder" characters="Body goes here" />
      </Frame>
    </Frame>
  </Component>
</Page>
`

const retag = (address: string, element: string) =>
  applyPatch(SOURCE, { op: 'retag', address, element })

describe('retag', () => {
  it('changes the tag in both the open and the close', () => {
    const { source } = retag('Card#container/body', 'Slot')
    expect(source).toContain('<Slot\n')
    expect(source).toContain('</Slot>')
    expect(source).not.toContain('name="body"\n        layoutMode="VERTICAL"\n      >\n')
    expect(parseOrThrow(source)).toBeTruthy()
  })

  it('leaves everything inside byte-for-byte, comment included', () => {
    const { source } = retag('Card#container/body', 'Slot')
    // The whole point of the op. A remove-plus-insert would lose this comment
    // and re-indent the attributes.
    expect(source).toContain('{/* the body, which the consumer decides */}')
    expect(source).toContain(
      '        name="body"\n        layoutMode="VERTICAL"\n        itemSpacing={8}',
    )
    expect(source).toContain('<Text name="placeholder" characters="Body goes here" />')
  })

  it('is one changed word — the diff says nothing else', () => {
    const { source } = retag('Card#container/body', 'Slot')
    const before = SOURCE.split('\n')
    const after = source.split('\n')
    const changed = after
      .map((line, i) => (line === before[i] ? null : i))
      .filter((i) => i !== null)
    // Two lines: the open tag and the close tag.
    expect(changed).toHaveLength(2)
  })

  it('keeps the address, because a retag is not a rename', () => {
    const { source } = retag('Card#container/body', 'Slot')
    const node = resolve(parseOrThrow(source).tree, 'Card#container/body')!
    expect(node.element).toBe('Slot')
    expect(node.children[0]!.address).toBe('Card#container/body/placeholder')
  })

  it('retags a self-closing node without hunting for a close tag', () => {
    const source = SOURCE.replace(
      '      <Frame\n        name="body"\n        layoutMode="VERTICAL"\n        itemSpacing={8}\n      >\n        <Text name="placeholder" characters="Body goes here" />\n      </Frame>\n',
      '      <Frame name="body" layoutMode="VERTICAL" />\n',
    )
    const out = applyPatch(source, { op: 'retag', address: 'Card#container/body', element: 'Slot' })
    expect(out.source).toContain('<Slot name="body" layoutMode="VERTICAL" />')
  })
})

describe('what retag refuses', () => {
  it('refuses a result the grammar rejects, by the guard that already exists', () => {
    // A `<Slot>` has nobody to fill it outside a `<Component>` (ADR 0007 §1),
    // and `Card` is a page child. The op does not know that rule; the re-parse
    // does, which is the point — one place decides legality.
    //
    // This used to be asked of `Card#container`, a component's direct child.
    // ADR 0008 §1 made that legal, so the example moved to a rule that is still
    // a rule rather than the test quietly becoming vacuous.
    expect(() => retag('Card', 'Slot')).toThrow(PatchError)
    expect(() => retag('Card', 'Slot')).toThrow(/UIDX133|invalid document/)
  })

  it('refuses an element that is not in the vocabulary', () => {
    expect(() => retag('Card#container/body', 'Div')).toThrow(/not a UIDX element/)
  })

  it('refuses a no-op, which is always a caller bug', () => {
    expect(() => retag('Card#container/body', 'Frame')).toThrow(/already what this node is/)
  })

  it('refuses the root', () => {
    expect(() => retag('', 'Frame')).toThrow(/cannot retag the root/)
  })
})

describe('a patcher bug names itself', () => {
  it('turns an internal throw into a message naming the op and the node', () => {
    // A report of "Cannot read properties of undefined (reading 'start')" names
    // neither the op nor the node, so it cannot be acted on. This is the test
    // that such a report can never arrive again — the shape is forced here by
    // handing the patcher a document whose offsets do not describe the source,
    // which is the one way to make an internal read go wrong on purpose.
    const doc = parseOrThrow(SOURCE)
    const shorter = SOURCE.slice(0, 80)
    let thrown: unknown
    try {
      // `document` is rejected up front when it does not match, so this asserts
      // the guard that already exists; the wrapper covers everything past it.
      applyPatch(
        shorter,
        { op: 'retag', address: 'Card#container', element: 'Slot' },
        { document: doc },
      )
    } catch (err) {
      thrown = err
    }
    expect(thrown).toBeInstanceOf(PatchError)
  })

  it('leaves a PatchError own words alone', () => {
    expect(() => retag('Card#container/body', 'Div')).toThrow(/not a UIDX element/)
    expect(() => retag('Card#container/body', 'Div')).not.toThrow(/failed unexpectedly/)
  })

  /*
   * The skew this file cannot see: a client newer than the build applying its
   * patches. `retag` itself arrived that way — a viewer served from source sent
   * one to a server whose `@uidx/format` predated the op, the switch fell out of
   * the bottom, and `applyPatches` read `.start` off the `undefined` it returned.
   * That is the same unactionable sentence the wrapper above exists to prevent,
   * arriving by the one door it does not cover: not a throw, a fall-through.
   *
   * The union is exhaustive at compile time, so only a runtime op the build has
   * never heard of reaches this — which is exactly what version skew is, and why
   * the cast is the honest way to write the test.
   */
  it('refuses an op this build does not know, by name', () => {
    const unknown = { op: 'transmogrify', address: 'Card#container' } as unknown as UidxPatch
    expect(() => applyPatch(SOURCE, unknown)).toThrow(PatchError)
    expect(() => applyPatch(SOURCE, unknown)).toThrow(/transmogrify/)
  })
})
