import { largeDocument } from './large-document.js'
import { describe, expect, it } from 'vitest'
import {
  applyPatches,
  applyPatchesIncremental,
  assertOffsetInvariant,
  parseOrThrow,
  PatchError,
  type UidxNode,
  type UidxPatch,
} from '../src/index.js'

const PAGE = `---
id: demo
---

## Core Intent

Some prose that the tree never touches.

## Visual Contract

<Page>
  <Component name="Chip" status="draft" variants={{ tone: ['quiet', 'loud'] }}>
    <Variant tone="quiet">
      <Frame name="root" layoutMode="HORIZONTAL" itemSpacing={4}>
        <Text name="label" characters="Hi" fontSize={12} />
        <Slot name="icon" />
      </Frame>
    </Variant>
    <Variant tone="loud">
      <Frame name="root" layoutMode="HORIZONTAL" itemSpacing={8}>
        <Text name="label" characters="HI" fontSize={14} />
      </Frame>
    </Variant>
  </Component>
  <Frame name="doc" layoutMode="VERTICAL">
    <Frame name="section" width={100} height={40}>
      <Rectangle name="rule" width={90} height={1} />
      <Rectangle name="cover" width={10} height={10} visible={true} />
    </Frame>
    <Instance name="chip" component="Chip" props={{ tone: 'loud' }} />
  </Frame>
</Page>
`

const TOKENS = `---
id: tokens
---

## Visual Contract

<Tokens>
  <Collection name="space" modes={['comfy', 'compact']}>
    <Variable name="sm" type="FLOAT">
      <Mode name="comfy" value={8} />
      <Mode name="compact" value={4} />
    </Variable>
  </Collection>
</Tokens>
`

/** Everything the tree records, so offsets and spans are compared too. */
const shape = (node: UidxNode): unknown => ({
  element: node.element,
  name: node.name,
  address: node.address,
  loc: node.loc,
  openTagLoc: node.openTagLoc,
  selfClosing: node.selfClosing,
  indent: node.indent,
  attrs: Object.fromEntries(
    Object.entries(node.attrs).map(([k, a]) => [
      k,
      { raw: a.raw, value: a.value, loc: a.loc, valueLoc: a.valueLoc },
    ]),
  ),
  children: node.children.map(shape),
})

function agrees(source: string, patches: UidxPatch[], expectFast = true): void {
  const doc = parseOrThrow(source)
  const result = applyPatchesIncremental(doc, patches)
  const full = parseOrThrow(applyPatches(source, patches).source)
  expect(result.doc.source).toBe(full.source)
  expect(result.doc.sourceHash).toBe(full.sourceHash)
  expect(shape(result.doc.tree)).toEqual(shape(full.tree))
  assertOffsetInvariant(result.doc)
  if (expectFast) expect(result.fellBack).toBe(false)
  // The input was not mutated.
  expect(shape(doc.tree)).toEqual(shape(parseOrThrow(source).tree))
}

describe('applyPatchesIncremental agrees with a full parse (spec §1)', () => {
  it('set on an inner node', () => {
    agrees(PAGE, [{ op: 'set', address: 'doc#section/cover', prop: 'visible', value: false }])
  })
  it('add and remove on inner nodes, in one batch', () => {
    agrees(PAGE, [
      { op: 'add', address: 'doc#section/rule', prop: 'opacity', value: 0.5 },
      { op: 'remove', address: 'doc#section/cover', prop: 'visible' },
    ])
  })
  it('a value that changes length shifts everything after it', () => {
    agrees(PAGE, [
      {
        op: 'set',
        address: 'Chip#tone=quiet/root/label',
        prop: 'characters',
        value: 'A much longer label',
      },
    ])
  })
  it('re-lowers the node for an attribute, the shaped parent for a rename', () => {
    const doc = parseOrThrow(PAGE)
    const result = applyPatchesIncremental(doc, [
      { op: 'set', address: 'Chip#tone=loud/root/label', prop: 'fontSize', value: 20 },
    ])
    expect(result.fellBack).toBe(false)
    // An attribute cannot change the variant's shape, so only the node is re-lowered.
    expect(result.changed).toEqual(['Chip#tone=loud/root/label'])
    agrees(PAGE, [{ op: 'set', address: 'Chip#tone=loud/root/label', prop: 'fontSize', value: 20 }])
    // A rename of the variant's only child re-lowers the variant, whose arity check reads it.
    const renamed = applyPatchesIncremental(doc, [
      { op: 'set', address: 'Chip#tone=loud/root', prop: 'name', value: 'box' },
    ])
    expect(renamed.changed).toEqual(['Chip#tone=loud'])
  })
  it('insert-node, remove-node and move-node', () => {
    agrees(PAGE, [
      {
        op: 'insert-node',
        parent: 'doc#section',
        index: 1,
        node: { element: 'Rectangle', attrs: { name: 'added', width: 3 } },
      },
    ])
    agrees(PAGE, [{ op: 'remove-node', address: 'doc#section/rule' }])
    agrees(PAGE, [{ op: 'move-node', address: 'doc#section/cover', newParent: 'doc', index: 0 }])
  })
  it('a rename', () => {
    agrees(PAGE, [{ op: 'set', address: 'doc#section/cover', prop: 'name', value: 'lid' }])
  })
  it('set-mode on a variable re-lowers the variable', () => {
    agrees(TOKENS, [{ op: 'set-mode', address: 'space#sm', mode: 'compact', value: 2 }])
  })
  it('a change on the root falls back to a full parse', () => {
    agrees(PAGE, [{ op: 'add', address: '', prop: 'modes', value: { space: 'compact' } }], false)
  })
  it('a rename onto a sibling name is refused like the full parse refuses it', () => {
    const doc = parseOrThrow(PAGE)
    expect(() =>
      applyPatchesIncremental(doc, [
        { op: 'set', address: 'doc#section/cover', prop: 'name', value: 'rule' },
      ]),
    ).toThrow(PatchError)
  })
  it('a no-op batch returns the same document', () => {
    const doc = parseOrThrow(PAGE)
    const result = applyPatchesIncremental(doc, [
      { op: 'set', address: 'doc#section/cover', prop: 'visible', value: true },
    ])
    expect(result.doc).toBe(doc)
    expect(result.changed).toEqual([])
  })
})

describe('the attribute fast path (no parse at all)', () => {
  it('set, add and remove on plain attributes, on one-line and multi-line tags', () => {
    agrees(PAGE, [{ op: 'set', address: 'doc#section/cover', prop: 'visible', value: false }])
    agrees(PAGE, [{ op: 'add', address: 'doc#section/cover', prop: 'opacity', value: 0.5 }])
    agrees(PAGE, [{ op: 'remove', address: 'doc#section/cover', prop: 'visible' }])
    agrees(PAGE, [{ op: 'set', address: 'Chip#tone=quiet/root', prop: 'itemSpacing', value: 12 }])
    agrees(PAGE, [{ op: 'add', address: 'Chip#tone=quiet/root', prop: 'cornerRadius', value: 3 }])
    agrees(PAGE, [
      {
        op: 'add',
        address: 'doc#section/rule',
        prop: 'fills',
        value: [{ type: 'SOLID', color: '#fff' }],
      },
    ])
  })
  it('a batch mixing plain attributes and a name change agrees too', () => {
    agrees(PAGE, [
      { op: 'set', address: 'doc#section/cover', prop: 'visible', value: false },
      { op: 'set', address: 'doc#section/rule', prop: 'name', value: 'line' },
      { op: 'add', address: 'doc#section', prop: 'opacity', value: 0.9 },
    ])
  })
  it('a multi-line tag keeps its later attributes in place', () => {
    const MULTI = PAGE.replace(
      '<Rectangle name="cover" width={10} height={10} visible={true} />',
      '<Rectangle\n        name="cover"\n        width={10}\n        height={10}\n        visible={true}\n      />',
    )
    agrees(MULTI, [{ op: 'add', address: 'doc#section/cover', prop: 'opacity', value: 0.5 }])
    agrees(MULTI, [{ op: 'remove', address: 'doc#section/cover', prop: 'visible' }])
    agrees(MULTI, [{ op: 'set', address: 'doc#section/cover', prop: 'visible', value: false }])
  })
})

describe('on a large variant document', () => {
  const src = largeDocument()
  it('an attribute op inside a variant is fast and agrees with the full parse', () => {
    const doc = parseOrThrow(src)
    const patches: UidxPatch[] = [
      {
        op: 'add',
        address: 'Atlas#station=approach, land=mesh/atlas',
        prop: 'visible',
        value: false,
      },
    ]
    const t = performance.now()
    const result = applyPatchesIncremental(doc, patches)
    const ms = performance.now() - t
    expect(result.fellBack).toBe(false)
    const t2 = performance.now()
    const full = parseOrThrow(applyPatches(src, patches, { document: doc }).source)
    const fullMs = performance.now() - t2
    // Relative, not absolute: the suite runs files in parallel and a loaded
    // machine stretches both numbers alike. Measured alone: 2 ms vs 1.1 s.
    expect(ms).toBeLessThan(fullMs / 10)
    expect(result.doc.sourceHash).toBe(full.sourceHash)
    expect(shape(result.doc.tree)).toEqual(shape(full.tree))
    console.log('atlas incremental ms', Math.round(ms), 'full parse ms', Math.round(fullMs))
  })
})
