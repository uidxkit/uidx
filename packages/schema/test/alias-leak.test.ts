import { describe, expect, it } from 'vitest'
import { parseOrThrow } from '@uidx/format'
import { fromSceneChange, toSceneGraph } from '../src/index.js'

/**
 * The 413-patch leak (spec, "Current state"): a rule node binds its sizes to
 * tokens, the layout engine re-announces the resolved numbers, and the
 * comparison "file value !== scene value" is always true for an alias — so the
 * canvas wrote `width={1456}` over `{layout#doc-inner}` on every such node.
 */
const RULE = parseOrThrow(`---
id: leak
---

## Visual Contract

<Page>
  <Frame name="doc" layoutMode="VERTICAL">
    <Rectangle name="rule" width="{layout#doc-inner}" height="{stroke#hair}" />
  </Frame>
</Page>
`)

const resolveAlias = (address: string) => (address === 'layout#doc-inner' ? 1456 : 1)

describe('alias-bound attributes belong to the author, not the layout', () => {
  it('a reflow that re-announces resolved sizes writes nothing', () => {
    const scene = toSceneGraph(RULE, { resolveAlias })
    scene.graph.updateNode('doc#rule', { width: 1456, height: 1 })
    const patches = fromSceneChange(
      'doc#rule',
      { width: 1456, height: 1 },
      {
        doc: RULE,
        graph: scene.graph,
        addresses: scene.addresses,
      },
    )
    expect(patches).toEqual([])
  })

  it('a vouched write still replaces the binding with the typed value', () => {
    const scene = toSceneGraph(RULE, { resolveAlias })
    scene.graph.updateNode('doc#rule', { width: 300 })
    const patches = fromSceneChange(
      'doc#rule',
      { width: 300 },
      {
        doc: RULE,
        graph: scene.graph,
        addresses: scene.addresses,
        authored: new Set(['width']),
        authoredFor: 'doc#rule',
      },
    )
    expect(patches).toEqual([{ op: 'set', address: 'doc#rule', prop: 'width', value: 300 }])
  })
})
