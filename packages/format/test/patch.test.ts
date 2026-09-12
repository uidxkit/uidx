import { describe, expect, it } from 'vitest'
import {
  applyPatch,
  applyPatches,
  emitDocument,
  parse,
  parseOrThrow,
  PatchError,
  resolve,
} from '../src/index.js'
import { BUTTON, diffLines, MINIMAL } from './fixtures.js'

describe('property patches', () => {
  it('one changed prop is a one-line diff', () => {
    const { source } = applyPatch(BUTTON, {
      op: 'set',
      address: 'Button/Primary#container',
      prop: 'cornerRadius',
      value: 12,
    })
    expect(diffLines(BUTTON, source)).toEqual([
      '-      cornerRadius={8}',
      '+      cornerRadius={12}',
    ])
  })

  it('leaves every other byte untouched', () => {
    const { source, changedRange } = applyPatch(BUTTON, {
      op: 'set',
      address: 'Button/Primary#container/label',
      prop: 'fontSize',
      value: 16,
    })
    expect(source.slice(0, changedRange.start)).toBe(BUTTON.slice(0, changedRange.start))
    expect(source.slice(changedRange.start + 4)).toBe(BUTTON.slice(changedRange.end))
  })

  it('rewrites a string prop without disturbing quoting', () => {
    const { source } = applyPatch(BUTTON, {
      op: 'set',
      address: 'Button/Primary#container/label',
      prop: 'characters',
      value: 'Save changes',
    })
    expect(source).toContain('characters="Save changes"')
    expect(diffLines(BUTTON, source)).toHaveLength(2)
  })

  it('replaces a whole multi-line JSON value span', () => {
    const { source } = applyPatch(BUTTON, {
      op: 'set',
      address: 'Button/Primary#container',
      prop: 'fills',
      value: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0, a: 1 } }],
    })
    expect(source).toContain("fills={[{ type: 'SOLID', color: { r: 0, g: 0, b: 0, a: 1 } }]}")
    const doc = parseOrThrow(source)
    expect(resolve(doc.tree, 'Button/Primary#container')!.attrs.fills!.value).toEqual([
      { type: 'SOLID', color: { r: 0, g: 0, b: 0, a: 1 } },
    ])
  })

  it('rounds geometry to 3dp and colour channels to 4dp', () => {
    const geometry = applyPatch(BUTTON, {
      op: 'set',
      address: 'Button/Primary#container',
      prop: 'itemSpacing',
      value: 8.123456,
    }).source
    expect(geometry).toContain('itemSpacing={8.123}')

    const color = applyPatch(BUTTON, {
      op: 'set',
      address: 'Button/Primary#container',
      prop: 'fills',
      value: [{ type: 'SOLID', color: { r: 0.123456, g: 0, b: 0, a: 1 } }],
    }).source
    expect(color).toContain('r: 0.1235')
  })

  it('adds a prop on its own line when attributes are multi-line', () => {
    const { source } = applyPatch(BUTTON, {
      op: 'add',
      address: 'Button/Primary#container',
      prop: 'opacity',
      value: 0.5,
    })
    expect(diffLines(BUTTON, source)).toEqual(['+      opacity={0.5}'])
  })

  // These two cover single-line tag handling, so they carry their own fixture
  // rather than depending on how the shared example happens to be formatted.
  const INLINE = MINIMAL.replace(
    '<Text name="a" characters="A" />',
    '<Vector name="a" width={16} height={16} visible={true} />',
  )

  it('adds a prop inline when the tag is single-line', () => {
    const { source } = applyPatch(INLINE, {
      op: 'add',
      address: 'minimal#root/a',
      prop: 'opacity',
      value: 0.5,
    })
    expect(source).toContain(
      '<Vector name="a" width={16} height={16} visible={true} opacity={0.5} />',
    )
    expect(diffLines(INLINE, source)).toHaveLength(2)
  })

  it('removes a prop together with its leading whitespace', () => {
    const { source } = applyPatch(INLINE, {
      op: 'remove',
      address: 'minimal#root/a',
      prop: 'visible',
    })
    expect(source).toContain('<Vector name="a" width={16} height={16} />')
  })

  it('refuses set on a missing prop and add on an existing one', () => {
    expect(() =>
      applyPatch(BUTTON, {
        op: 'set',
        address: 'Button/Primary#container',
        prop: 'nope',
        value: 1,
      }),
    ).toThrow(PatchError)
    expect(() =>
      applyPatch(BUTTON, {
        op: 'add',
        address: 'Button/Primary#container',
        prop: 'cornerRadius',
        value: 1,
      }),
    ).toThrow(PatchError)
  })

  it('rejects an unknown address', () => {
    expect(() => applyPatch(BUTTON, { op: 'set', address: 'ghost', prop: 'x', value: 1 })).toThrow(
      /no node at address/,
    )
  })
})

describe('structural patches', () => {
  it('inserts a node as a cleanly indented block', () => {
    const { source } = applyPatch(MINIMAL, {
      op: 'insert-node',
      parent: 'minimal#root',
      index: 1,
      node: { element: 'Rectangle', attrs: { name: 'divider', width: 1 } },
    })
    expect(diffLines(MINIMAL, source)).toEqual([
      '+      <Rectangle',
      '+        name="divider"',
      '+        width={1}',
      '+      />',
    ])
    expect(resolve(parseOrThrow(source).tree, 'minimal#root')!.children.map((c) => c.name)).toEqual(
      ['a', 'divider', 'b'],
    )
  })

  it('auto-names a node when the spec omits one', () => {
    const { source } = applyPatch(MINIMAL, {
      op: 'insert-node',
      parent: 'minimal#root',
      index: 2,
      node: { element: 'Ellipse', attrs: {} },
    })
    expect(source).toContain('<Ellipse name="ellipse-1" />')
  })

  it('bumps the auto-name until siblings are unique', () => {
    const once = applyPatch(MINIMAL, {
      op: 'insert-node',
      parent: 'minimal#root',
      index: 2,
      node: { element: 'Ellipse', attrs: {} },
    }).source
    const twice = applyPatch(once, {
      op: 'insert-node',
      parent: 'minimal#root',
      index: 3,
      node: { element: 'Ellipse', attrs: {} },
    }).source
    expect(twice).toContain('name="ellipse-1"')
    expect(twice).toContain('name="ellipse-2"')
  })

  it('expands a self-closing parent into open/close form', () => {
    const source = MINIMAL.replace(
      /<Frame name="root" layoutMode="VERTICAL">[\s\S]*?<\/Frame>/,
      '<Frame name="root" layoutMode="VERTICAL" />',
    )
    const { source: out } = applyPatch(source, {
      op: 'insert-node',
      parent: 'minimal#root',
      index: 0,
      node: { element: 'Text', attrs: { name: 'only', characters: 'hi' } },
    })
    expect(out).toContain('<Frame name="root" layoutMode="VERTICAL">')
    expect(out).toContain('</Frame>')
    expect(resolve(parseOrThrow(out).tree, 'minimal#root')!.children.map((c) => c.name)).toEqual([
      'only',
    ])
  })

  /**
   * D1 made this reachable from the UI: draw a frame, then draw inside it. A
   * created frame is self-closing and its attributes are one per line, and
   * `>` spliced onto the last attribute's line is not the shape `emitTree`
   * produces — so `uidx fmt` would immediately rewrite a file the editor had
   * just written, which is exactly the churn spec §9.5 forbids.
   */
  it('puts the expanded tag closer where canonical style has it, on a multi-line parent', () => {
    const source = MINIMAL.replace(
      /<Frame name="root" layoutMode="VERTICAL">[\s\S]*?<\/Frame>/,
      ['<Frame', '      name="root"', '      layoutMode="VERTICAL"', '    />'].join('\n'),
    )
    const { source: out } = applyPatch(source, {
      op: 'insert-node',
      parent: 'minimal#root',
      index: 0,
      node: { element: 'Text', attrs: { name: 'only', characters: 'hi' } },
    })
    expect(out).toContain('\n      layoutMode="VERTICAL"\n    >\n')
    // And what it produced is what a full re-emit would produce.
    const parsed = parseOrThrow(out)
    expect(emitDocument(parsed)).toBe(emitDocument(parseOrThrow(emitDocument(parsed))))
    expect(resolve(parsed.tree, 'minimal#root')!.children.map((c) => c.name)).toEqual(['only'])
  })

  it('removes a node and its leading line', () => {
    const { source } = applyPatch(MINIMAL, { op: 'remove-node', address: 'minimal#root/a' })
    expect(diffLines(MINIMAL, source)).toEqual(['-      <Text name="a" characters="A" />'])
  })

  it("removes a component's last child, which ADR 0008 §1 permits", () => {
    // The guard that used to stand here was the one-child rule: a `<Component>`
    // with no children is a document that parses now, so refusing to make one
    // was the patcher enforcing a grammar the parser had already dropped.
    const { source } = applyPatch(MINIMAL, { op: 'remove-node', address: 'minimal#root' })
    expect(parse(source).diagnostics).toEqual([])
  })

  it('guards the root itself', () => {
    expect(() => applyPatch(MINIMAL, { op: 'remove-node', address: '' })).toThrow(
      /cannot remove the root/,
    )
  })

  it('reorders as a pure block move', () => {
    const { source } = applyPatch(MINIMAL, {
      op: 'move-node',
      address: 'minimal#root/b',
      newParent: 'minimal#root',
      index: 0,
    })
    expect(resolve(parseOrThrow(source).tree, 'minimal#root')!.children.map((c) => c.name)).toEqual(
      ['b', 'a'],
    )
    const diff = diffLines(MINIMAL, source)
    expect(diff.filter((l) => l.startsWith('-'))).toEqual([
      '-      <Text name="b" characters="B" />',
    ])
    expect(diff.filter((l) => l.startsWith('+'))).toEqual([
      '+      <Text name="b" characters="B" />',
    ])
  })

  it('preserves the moved subtree byte-for-byte modulo indentation', () => {
    const nested = `---
id: t
---

## Visual Contract

<Component name="t" status="draft">
  <Frame name="root">
    <Frame name="box">
      <Text
        name="deep"
        characters="keep   me"
        fontSize={11}
      />
    </Frame>
    <Frame name="target" />
  </Frame>
</Component>
`
    const { source } = applyPatch(nested, {
      op: 'move-node',
      address: 't#root/box/deep',
      newParent: 't#root/target',
      index: 0,
    })
    const doc = parseOrThrow(source)
    const moved = resolve(doc.tree, 't#root/target/deep')!
    expect(moved.attrs.characters!.value).toBe('keep   me')
    // Inner formatting survives; only the block's indent shifts.
    expect(source).toContain(
      '      <Text\n        name="deep"\n        characters="keep   me"\n        fontSize={11}\n      />',
    )
  })

  it('refuses to move a node into its own descendant', () => {
    expect(() =>
      applyPatch(MINIMAL, {
        op: 'move-node',
        address: 'minimal#root',
        newParent: 'minimal#root',
        index: 0,
      }),
    ).toThrow(/into itself or its own descendant/)
  })

  it('refuses a move that would duplicate a sibling name', () => {
    const source = `---
id: t
---

## Visual Contract

<Component name="t" status="draft">
  <Frame name="root">
    <Frame name="x">
      <Text name="dup" characters="1" />
    </Frame>
    <Text name="dup" characters="2" />
  </Frame>
</Component>
`
    expect(() =>
      applyPatch(source, {
        op: 'move-node',
        address: 't#root/x/dup',
        newParent: 't#root',
        index: 0,
      }),
    ).toThrow(/duplicate a sibling name/)
  })
})

describe('invariants after every patch (spec §9.5)', () => {
  const patches = [
    { op: 'set', address: 'Button/Primary#container', prop: 'cornerRadius', value: 12 },
    { op: 'add', address: 'Button/Primary#container', prop: 'opacity', value: 0.5 },
    { op: 'remove', address: 'Button/Primary#container/leading-icon', prop: 'visible' },
    {
      op: 'insert-node',
      parent: 'Button/Primary#container',
      index: 1,
      node: { element: 'Rectangle', attrs: { name: 'sep' } },
    },
    {
      op: 'move-node',
      address: 'Button/Primary#container/label',
      newParent: 'Button/Primary#container',
      index: 0,
    },
    { op: 'remove-node', address: 'Button/Primary#container/leading-icon' },
  ] as const

  for (const patch of patches) {
    it(`${patch.op} leaves the file parseable with unique sibling names`, () => {
      const { source } = applyPatch(BUTTON, patch)
      const doc = parseOrThrow(source)
      const walk = (node: typeof doc.tree): void => {
        const names = node.children.map((c) => c.name)
        expect(new Set(names).size).toBe(names.length)
        node.children.forEach(walk)
      }
      walk(doc.tree)
    })
  }

  it('applies a create -> restyle -> reorder -> delete sequence', () => {
    const { source } = applyPatches(BUTTON, [
      {
        op: 'insert-node',
        parent: 'Button/Primary#container',
        index: 2,
        node: { element: 'Rectangle', attrs: { name: 'badge', width: 8, height: 8 } },
      },
      { op: 'set', address: 'Button/Primary#container/badge', prop: 'width', value: 10 },
      {
        op: 'move-node',
        address: 'Button/Primary#container/badge',
        newParent: 'Button/Primary#container',
        index: 0,
      },
      { op: 'remove-node', address: 'Button/Primary#container/leading-icon' },
    ])
    const doc = parseOrThrow(source)
    expect(resolve(doc.tree, 'Button/Primary#container')!.children.map((c) => c.name)).toEqual([
      'badge',
      'label',
    ])
    expect(resolve(doc.tree, 'Button/Primary#container/badge')!.attrs.width!.value).toBe(10)
  })
})

describe('the validating parse is returned, not thrown away', () => {
  const container = (source: string) =>
    resolve(parseOrThrow(source).tree, 'Button/Primary#container')!

  it('applyPatch hands back the document for the patched source', () => {
    const result = applyPatch(BUTTON, {
      op: 'set',
      address: 'Button/Primary#container',
      prop: 'cornerRadius',
      value: 9,
    })
    expect(result.document).toBeDefined()
    expect(result.document!.source).toBe(result.source)
    expect(
      resolve(result.document!.tree, 'Button/Primary#container')!.attrs.cornerRadius!.value,
    ).toBe(9)
    expect(container(BUTTON).attrs.cornerRadius!.value).toBe(8)
  })

  it('applyPatch returns no document when validation is off', () => {
    const result = applyPatch(
      BUTTON,
      { op: 'set', address: 'Button/Primary#container', prop: 'cornerRadius', value: 9 },
      { validate: false },
    )
    expect(result.document).toBeUndefined()
  })

  it('applyPatches returns the document of the final source', () => {
    const result = applyPatches(BUTTON, [
      { op: 'set', address: 'Button/Primary#container', prop: 'cornerRadius', value: 9 },
      { op: 'add', address: 'Button/Primary#container', prop: 'visible', value: false },
    ])
    expect(result.document!.source).toBe(result.source)
    expect(resolve(result.document!.tree, 'Button/Primary#container')!.attrs.visible!.value).toBe(
      false,
    )
  })
})
