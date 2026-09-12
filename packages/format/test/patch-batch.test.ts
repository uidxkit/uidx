import { largeDocument } from './large-document.js'
import { describe, expect, it, vi } from 'vitest'
import * as parseModule from '../src/parse.js'
import {
  applyPatch,
  applyPatches,
  parseOrThrow,
  type UidxNode,
  type UidxPatch,
} from '../src/index.js'

// Pass-through mock of the patcher's own import, so the validating parse
// inside `applyPatch` is counted — `vi.spyOn` on the package namespace never
// sees an intra-package call.
vi.mock('../src/parse.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/parse.js')>()
  return { ...actual, parse: vi.fn(actual.parse) }
})
describe('attribute batches parse once (spec §2)', () => {
  const TWO = `---
id: two
---

## Visual Contract

<Page>
  <Frame name="a" cornerRadius={4}>
    <Rectangle name="r1" width={10} />
    <Rectangle name="r2" width={10} />
  </Frame>
</Page>
`
  const countParses = (): { calls: () => number; restore: () => void } => {
    const spy = vi.mocked(parseModule.parse)
    spy.mockClear()
    return { calls: () => spy.mock.calls.length, restore: () => spy.mockClear() }
  }

  it('applies many attribute ops on distinct nodes with a single validating parse', () => {
    const doc = parseOrThrow(TWO)
    const parses = countParses()
    const result = applyPatches(
      TWO,
      [
        { op: 'set', address: 'a', prop: 'cornerRadius', value: 8 },
        { op: 'set', address: 'a#r1', prop: 'width', value: 20 },
        { op: 'add', address: 'a#r2', prop: 'visible', value: false },
      ],
      { document: doc },
    )
    const calls = parses.calls()
    parses.restore()
    expect(calls).toBe(1)
    expect(result.source).toContain('cornerRadius={8}')
    expect(result.source).toContain('name="r1" width={20}')
    expect(result.source).toContain('name="r2" width={10} visible={false}')
    expect(result.document!.source).toBe(result.source)
  })

  it('matches the sequential path byte for byte', () => {
    const doc = parseOrThrow(TWO)
    const patches: UidxPatch[] = [
      { op: 'set', address: 'a#r2', prop: 'width', value: 1 },
      { op: 'remove', address: 'a', prop: 'cornerRadius' },
      { op: 'add', address: 'a#r1', prop: 'height', value: 2 },
    ]
    const batched = applyPatches(TWO, patches, { document: doc }).source
    const sequential = patches.reduce((src, p) => applyPatch(src, p).source, TWO)
    expect(batched).toBe(sequential)
  })

  it('falls back to the re-parsing path when two ops touch one node', () => {
    const doc = parseOrThrow(TWO)
    const parses = countParses()
    applyPatches(
      TWO,
      [
        { op: 'set', address: 'a#r1', prop: 'width', value: 20 },
        { op: 'add', address: 'a#r1', prop: 'height', value: 5 },
      ],
      { document: doc },
    )
    const calls = parses.calls()
    parses.restore()
    expect(calls).toBe(2)
  })

  it('falls back when a structural op is in the batch', () => {
    const doc = parseOrThrow(TWO)
    const parses = countParses()
    applyPatches(
      TWO,
      [
        { op: 'set', address: 'a#r1', prop: 'width', value: 20 },
        { op: 'remove-node', address: 'a#r2' },
      ],
      { document: doc },
    )
    const calls = parses.calls()
    parses.restore()
    expect(calls).toBe(2)
  })

  it('a 400-op batch on a large variant document is one parse', () => {
    const src = largeDocument()
    const doc = parseOrThrow(src)
    const patches: UidxPatch[] = []
    const walk = (node: UidxNode): void => {
      if (patches.length >= 400) return
      if (node.attrs.width && typeof node.attrs.width.value === 'number') {
        patches.push({
          op: 'set',
          address: node.address,
          prop: 'width',
          value: node.attrs.width.value + 1,
        })
      }
      node.children.forEach(walk)
    }
    walk(doc.tree)
    expect(patches.length).toBeGreaterThan(100)
    const parses = countParses()
    const result = applyPatches(src, patches, { document: doc })
    const calls = parses.calls()
    parses.restore()
    expect(calls).toBe(1)
    expect(result.document).toBeDefined()
  })
})
