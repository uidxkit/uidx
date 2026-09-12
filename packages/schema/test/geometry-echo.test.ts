import { describe, expect, it } from 'vitest'
import { parseOrThrow, type UidxPatch } from '@uidx/format'
import { computeAllLayouts } from '@open-pencil/core/layout'

import { applyChanges, diffDocuments, fromSceneChange, toSceneGraph } from '../src/index.js'

/**
 * The geometry-echo bug, reproduced at the seam it escaped through.
 *
 * A `<Text>` with no authored width/height is auto-sized — that is what
 * `createSpec` writes for a clicked text, and what the file means by staying
 * silent. But the scene-graph's own default is `textAutoResize: 'NONE'`, so
 * unless the schema says otherwise the built node reads as a fixed 100×100
 * box, and D4's derived-size filter — which asks the *scene node* — answers
 * "authored".
 *
 * Yoga then re-announces every flowed child's full rect on every layout pass
 * (`updateChildFromYoga` writes x/y/width/height wholesale, and `updateNode`
 * emits the keys it was handed, changed or not). Any pass outside CanvasPane's
 * applying-remote window — the re-layout a panel commit runs, the echo after a
 * round-trip — hands `fromSceneChange` a width/height for a text node nobody
 * touched, and the filter waves it through: `add width={100} height={100}`,
 * the scene defaults, written into the file. Observed live on
 * examples/bound-card.uidx (2026-08-23).
 */
const SRC = `---
id: echo
---

## Visual Contract

<Page>
  <Component name="Card" status="draft">
    <Frame
      name="container"
      layoutMode="VERTICAL"
      primaryAxisSizingMode="AUTO"
      counterAxisSizingMode="AUTO"
      paddingLeft={24} paddingRight={24}
      paddingTop={24} paddingBottom={24}
      fills={[{ type: 'SOLID', color: { r: 0.1, g: 0.4, b: 0.9, a: 1 } }]}
    >
      <Text name="title" characters="Bound to tokens" fontSize={16} fontWeight="BOLD" />
    </Frame>
  </Component>
</Page>
`

/** CanvasPane's watchGraph, unvouched — the state between panel writes. */
function collectEcho(
  scene: ReturnType<typeof toSceneGraph>,
  doc: ReturnType<typeof parseOrThrow>,
  run: () => void,
): UidxPatch[] {
  const emitted: UidxPatch[] = []
  const off = scene.graph.emitter.on(
    'node:updated',
    (sceneId: string, changes: Record<string, unknown>) => {
      emitted.push(
        ...fromSceneChange(sceneId, changes as never, {
          doc,
          graph: scene.graph,
          addresses: scene.addresses,
        }),
      )
    },
  )
  try {
    run()
  } finally {
    off()
  }
  return emitted
}

describe('an auto-sized <Text> under re-layout', () => {
  it('emits no patches when a layout pass moves nothing', () => {
    const doc = parseOrThrow(SRC)
    const scene = toSceneGraph(doc)

    // The pass a panel commit triggers (editor.updateNode -> runLayoutForNode):
    // the entity laid out again, the document not having moved.
    const echo = collectEcho(scene, doc, () => {
      for (const entity of scene.graph.getNode(scene.rootId)?.childIds ?? []) {
        computeAllLayouts(scene.graph, entity)
      }
    })

    expect(echo).toEqual([])
  })

  it('emits no patches for siblings of a reconciled fills change', () => {
    const doc = parseOrThrow(SRC)
    const scene = toSceneGraph(doc)

    // The round trip: the server wrote an unrelated fills edit on the parent,
    // the viewer reloads and reconciles. The text's geometry is nobody's edit.
    const next = parseOrThrow(SRC.replace('r: 0.1, g: 0.4, b: 0.9', 'r: 0.9, g: 0.1, b: 0.1'))
    const changes = diffDocuments(doc, next)
    expect(changes).not.toBeNull()

    const echo = collectEcho(scene, next, () => {
      applyChanges(scene, changes!)
    })

    const offTarget = echo.filter((p) => 'address' in p && p.address !== 'Card#container')
    expect(offTarget).toEqual([])
  })
})
