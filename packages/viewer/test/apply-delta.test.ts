import { describe, expect, it } from 'vitest'
import { applyPatches, applyPatchesIncremental, parseOrThrow } from '@uidx/format'
import { applyDelta } from '../src/apply-delta'

const SRC = `---
id: p
---

## Visual Contract

<Page>
  <Frame name="doc">
    <Rectangle name="cover" width={10} />
  </Frame>
</Page>
`

describe('applyDelta (spec §2)', () => {
  const held = parseOrThrow(SRC)
  const patches = [{ op: 'set' as const, address: 'doc#cover', prop: 'width', value: 20 }]
  const next = parseOrThrow(applyPatches(SRC, patches).source)

  it('applies a delta against the held revision and checks the hash', () => {
    const doc = applyDelta(held, 3, { patches, base: 3, sourceHash: next.sourceHash })
    expect(doc?.sourceHash).toBe(next.sourceHash)
    expect(doc?.tree.children[0]!.children[0]!.attrs.width!.value).toBe(20)
  })

  it('takes a whole document as is', () => {
    expect(applyDelta(undefined, undefined, { doc: next, sourceHash: next.sourceHash })).toBe(next)
  })

  it('returns null for a different base, a hash mismatch, no held document, or an empty prose-only delta', () => {
    expect(applyDelta(held, 2, { patches, base: 3, sourceHash: next.sourceHash })).toBeNull()
    expect(applyDelta(held, 3, { patches, base: 3, sourceHash: 'nope' })).toBeNull()
    expect(applyDelta(undefined, 3, { patches, base: 3, sourceHash: next.sourceHash })).toBeNull()
    expect(applyDelta(held, 3, { patches: [], base: 3, sourceHash: 'prose-moved' })).toBeNull()
  })

  it('returns null for a patch that will not apply', () => {
    expect(
      applyDelta(held, 3, {
        patches: [{ op: 'set', address: 'doc#gone', prop: 'width', value: 1 }],
        base: 3,
        sourceHash: 'x',
      }),
    ).toBeNull()
  })
})

describe('a confirmation that matches the prediction', () => {
  it('is the same document object, so nothing downstream re-runs', () => {
    const held = parseOrThrow(SRC)
    const patches = [{ op: 'set' as const, address: 'doc#cover', prop: 'width', value: 20 }]
    // What the shell predicts, and what the server answers for the same edit.
    const predicted = applyPatchesIncremental(held, patches).doc
    const server = parseOrThrow(applyPatches(SRC, patches).source)
    expect(predicted.sourceHash).toBe(server.sourceHash)
    expect(predicted.source).toBe(server.source)
    // The delta path would rebuild an equal-but-different document; the shell
    // adopts the prediction instead, which is why the canvas does no work.
    const viaDelta = applyDelta(held, 3, { patches, base: 3, sourceHash: server.sourceHash })
    expect(viaDelta).not.toBe(predicted)
    expect(viaDelta!.sourceHash).toBe(predicted.sourceHash)
  })
})
