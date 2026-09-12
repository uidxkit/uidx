import { describe, expect, it } from 'vitest'
import { parseOrThrow } from '@uidx/format'
import { toSceneGraph } from '../src/to-scene.js'
import { buildTokenIndex } from '../src/token-index.js'
import { TokenResolver } from '../src/resolve-modes.js'

const TOKENS = parseOrThrow(`---
id: t
---

## Visual Contract

<Tokens>
  <Collection name="density" modes={['comfy', 'compact']}>
    <Variable name="pad" type="FLOAT">
      <Mode name="comfy" value={16} />
      <Mode name="compact" value={4} />
    </Variable>
  </Collection>
</Tokens>
`)

const page = (body: string) =>
  parseOrThrow(`---\nid: p\n---\n\n## Visual Contract\n\n<Page>\n${body}\n</Page>\n`)

const tokensFor = () => {
  const index = buildTokenIndex([TOKENS])
  return { index, resolver: new TokenResolver(index) }
}

describe('mode inheritance down the descent (G8)', () => {
  it('resolves a child under its ancestor’s mode, and stops at a re-override', () => {
    const doc =
      page(`  <Frame name="outer" modes={{ density: 'compact' }} cornerRadius="{density#pad}">
    <Frame name="inherits" cornerRadius="{density#pad}" />
    <Frame name="overrides" modes={{ density: 'comfy' }} cornerRadius="{density#pad}" />
  </Frame>`)
    const { graph } = toSceneGraph(doc, { tokens: tokensFor() })

    expect(graph.getNode('outer')!.cornerRadius).toBe(4)
    expect(graph.getNode('outer#inherits')!.cornerRadius).toBe(4)
    expect(graph.getNode('outer#overrides')!.cornerRadius).toBe(16)
  })

  it('uses the leftmost mode when nothing selects one', () => {
    const doc = page(`  <Frame name="plain" cornerRadius="{density#pad}" />`)
    const { graph } = toSceneGraph(doc, { tokens: tokensFor() })
    expect(graph.getNode('plain')!.cornerRadius).toBe(16)
  })

  it('resolves once per distinct tuple across a 1,000-node page', () => {
    const frames = Array.from({ length: 1000 }, (_, i) =>
      i === 500
        ? `  <Frame name="f${i}" modes={{ density: 'compact' }} cornerRadius="{density#pad}" />`
        : `  <Frame name="f${i}" cornerRadius="{density#pad}" />`,
    ).join('\n')
    const { resolver, index } = tokensFor()
    toSceneGraph(page(frames), { tokens: { resolver, index } })
    // The default tuple and the one compact frame's. Not 1,000.
    expect(resolver.misses).toBe(2)
  })

  // A ceiling, not a benchmark. The property that matters is the miss count
  // above; this only catches a change that makes resolution catastrophically
  // slow, at a threshold loose enough that CI's worst day still clears it.
  it('stays well inside a smoke-test ceiling', () => {
    const frames = Array.from(
      { length: 1000 },
      (_, i) => `  <Frame name="g${i}" cornerRadius="{density#pad}" />`,
    ).join('\n')
    const doc = page(frames)
    const started = performance.now()
    toSceneGraph(doc, { tokens: tokensFor() })
    expect(performance.now() - started).toBeLessThan(4000)
  })

  it('leaves the flat resolveAlias path untouched when no index is given', () => {
    const doc = page(`  <Frame name="plain" cornerRadius="{density#pad}" />`)
    const { graph } = toSceneGraph(doc, { resolveAlias: () => 99 })
    expect(graph.getNode('plain')!.cornerRadius).toBe(99)
  })
})
