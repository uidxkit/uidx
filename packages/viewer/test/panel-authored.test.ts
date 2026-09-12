import { describe, expect, it } from 'vitest'
import { parseOrThrow } from '@uidx/format'
import { fromSceneChange, toSceneGraph } from '@uidx/schema'

/**
 * C7's D4 criterion: a panel edit carries authorship a reflow burst does not,
 * so the derived-geometry filter must not discard it. Without this, typing a
 * width into a hugging frame is silently dropped — the precise failure the
 * inspector exists to prevent.
 */
const SRC = `---
id: authored
---

## Visual Contract

<Component name="a" status="draft">
  <Frame name="root" layoutMode="VERTICAL"
    primaryAxisSizingMode="AUTO" counterAxisSizingMode="AUTO">
    <Rectangle name="kid" width={40} height={40} />
    <Text name="label" characters="hi" textAutoResize="WIDTH_AND_HEIGHT" />
  </Frame>
</Component>
`

function panelEdit(prop: string, changes: Record<string, unknown>) {
  const doc = parseOrThrow(SRC)
  const scene = toSceneGraph(doc)
  const id = scene.addresses.sceneIdOf('a#root')!
  scene.graph.updateNode(id, changes as never)
  return fromSceneChange(id, changes as never, {
    doc,
    graph: scene.graph,
    addresses: scene.addresses,
    authored: new Set([prop]),
    authoredFor: id,
  })
}

describe('a panel edit says it was authored', () => {
  /**
   * The signal names one node, not one gesture. Editing a frame reflows its
   * parent and its children, and those arrive as their own changes in the
   * same burst — if the signal were global they would ride through D4's
   * filter and write computed geometry into the file, which is the failure
   * D4 exists to prevent.
   */
  it('does not vouch for the siblings the edit reflows', () => {
    const doc = parseOrThrow(SRC)
    const scene = toSceneGraph(doc)
    const edited = scene.addresses.sceneIdOf('a#root')!
    // A text that measures itself: its width is derived and unauthored, so
    // D4 drops it unless something vouches.
    const reflowed = scene.addresses.sceneIdOf('a#root/label')!
    scene.graph.updateNode(reflowed, { width: 999 } as never)
    // The same authored set the edit carries, but this change is a different node.
    const patches = fromSceneChange(reflowed, { width: 999 } as never, {
      doc,
      graph: scene.graph,
      addresses: scene.addresses,
      authored: new Set(['width']),
      authoredFor: edited,
    })
    expect(patches.map((p) => (p as { prop: string }).prop)).not.toContain('width')
  })

  it('keeps a width typed into a hugging frame', () => {
    const patches = panelEdit('width', { width: 300 })
    const byProp = Object.fromEntries(
      patches.map((p) => [(p as { prop: string }).prop, (p as { value: unknown }).value]),
    )
    expect(byProp.width).toBe(300)
  })

  it('still drops the reflow that follows, which claims no authorship', () => {
    const doc = parseOrThrow(SRC)
    const scene = toSceneGraph(doc)
    const id = scene.addresses.sceneIdOf('a#root')!
    scene.graph.updateNode(id, { height: 999 } as never)
    const patches = fromSceneChange(id, { height: 999 } as never, {
      doc,
      graph: scene.graph,
      addresses: scene.addresses,
    })
    expect(patches).toEqual([])
  })
})
