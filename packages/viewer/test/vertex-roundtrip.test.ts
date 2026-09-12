import { describe, expect, it } from 'vitest'
import { applyPatches, parseOrThrow, resolve } from '@uidx/format'
import { fromSceneChange, toSceneGraph } from '@uidx/schema'
import {
  getWorldMatrix,
  transformVectorNetwork,
  TransformMatrix,
  type VectorNetwork,
} from '@open-pencil/scene-graph'
import { moveVertex, networkOf, subpathsOf, type Subpath } from '../src/vertex-edit'

/**
 * D12, end to end: a point dragged on the canvas reaches the file as one
 * `set vectorPaths`, and the file it lands in still says the shape the author
 * left on screen.
 *
 * This is the test the unit tests structurally cannot be. `vertex-edit.test.ts`
 * proves the arithmetic and `canvas-edit.test.ts` proves the gesture, and both
 * would stay green if the write were dropped on the floor by D4's filter — the
 * vouch is what carries `vectorPaths` past it (ADR 0006 §8), and nothing but a
 * real `fromSceneChange` can show that it does.
 */
const SRC = `---
id: rt
---

## Visual Contract

<Component name="rt" status="draft">
  <Frame name="root" layoutMode="NONE">
    <Vector
      name="mark"
      x={20}
      y={30}
      width={60}
      height={60}
      vectorPaths={[{ windingRule: 'NONZERO', data: 'M0 0L60 0L60 60L0 0Z' }]}
    />
  </Frame>
</Component>
`

const ADDRESS = 'rt#root/mark'

/** Everything `CanvasPane` does between the gesture and the patch. */
function edit(
  source: string,
  gesture: (subpaths: Subpath[]) => Subpath[],
  options: { vouch?: boolean } = {},
) {
  const doc = parseOrThrow(source)
  const scene = toSceneGraph(doc)
  const sceneId = scene.addresses.sceneIdOf(ADDRESS)!
  const node = scene.graph.getNode(sceneId)!
  const world = getWorldMatrix(node, scene.graph)
  const inverse = TransformMatrix.invert(world)!

  // Out to canvas space, edited there — which is where the pointer is — and
  // back to the node's own space, which is what the file holds.
  const before = subpathsOf(transformVectorNetwork(world, node.vectorNetwork!))
  const built = networkOf(gesture(before), 'NONZERO') as unknown as VectorNetwork
  const changes = { vectorNetwork: transformVectorNetwork(inverse, built) }
  scene.graph.updateNode(sceneId, changes as never)

  const patches = fromSceneChange(sceneId, changes as never, {
    doc,
    graph: scene.graph,
    addresses: scene.addresses,
    ...(options.vouch === false
      ? {}
      : { authored: new Set(['vectorPaths']), authoredFor: ADDRESS }),
  })
  return { source, patches, before }
}

/** The `d` a document holds for the mark. */
const dataOf = (source: string): string => {
  const held = resolve(parseOrThrow(source).tree, ADDRESS)!.attrs.vectorPaths!.value
  return (held as { data: string }[])[0]!.data
}

describe('a canvas vertex drag', () => {
  it('reaches the file as one `set vectorPaths` and nothing else', () => {
    // The world matrix is a translation to (20,30) here, so the middle point
    // sits at (80,30) on canvas and is dragged ten to the right.
    const { patches } = edit(SRC, (subpaths) =>
      moveVertex(subpaths, { subpath: 0, index: 1 }, { x: 90, y: 30 }),
    )
    expect(patches).toEqual([
      {
        op: 'set',
        address: ADDRESS,
        prop: 'vectorPaths',
        value: [{ windingRule: 'NONZERO', data: 'M0 0L70 0L60 60L0 0Z' }],
      },
    ])
  })

  it('is dropped when nothing vouched for it, which is what stops the churn', () => {
    // The same scene write, unclaimed. `vectorPaths` is in `VOUCHED_ONLY`, so
    // an unattributed geometry change — a reflow, a remote apply — never
    // re-spells a path nobody asked to touch.
    const { patches } = edit(
      SRC,
      (subpaths) => moveVertex(subpaths, { subpath: 0, index: 1 }, { x: 90, y: 30 }),
      { vouch: false },
    )
    expect(patches).toEqual([])
  })

  it('lands in the file, and the file still says the edited shape', () => {
    const { source, patches } = edit(SRC, (subpaths) =>
      moveVertex(subpaths, { subpath: 0, index: 1 }, { x: 90, y: 30 }),
    )
    const patched = applyPatches(source, patches).source
    expect(dataOf(patched)).toBe('M0 0L70 0L60 60L0 0Z')

    // And the round trip is a fixed point: opening the patched file and
    // committing the same edit again writes exactly the same text (ADR 0006
    // §8). Without that, every edit would move the file a little further.
    const again = edit(patched, (subpaths) => subpaths)
    expect(applyPatches(patched, again.patches).source).toBe(patched)
  })

  it('leaves the node where it was — the box is not refitted to the ink', () => {
    const { source, patches } = edit(SRC, (subpaths) =>
      // Well outside the declared 60x60 box, up and to the left of its origin.
      moveVertex(subpaths, { subpath: 0, index: 0 }, { x: -40, y: -40 }),
    )
    expect(patches.map((p) => (p as { prop: string }).prop)).toEqual(['vectorPaths'])
    const patched = applyPatches(source, patches).source
    const node = resolve(parseOrThrow(patched).tree, ADDRESS)!
    expect(node.attrs.x!.value).toBe(20)
    expect(node.attrs.y!.value).toBe(30)
    expect(node.attrs.width!.value).toBe(60)
    // The path is what moved, and it is spelled relative to that same origin.
    expect(dataOf(patched)).toBe('M-60 -70L60 0L60 60L-60 -70Z')
  })

  it("comes back into the node's own frame when the node is turned", () => {
    // The riskiest arithmetic in D12, and the one a live pass confirmed: the
    // model is in canvas coordinates and the file is in the node's, and a
    // rotation makes the trip between them a matrix rather than an offset.
    // A point dragged straight down the screen therefore lands on a diagonal
    // in the file — which is the shape staying where the author put it.
    const turned = SRC.replace('width={60}', 'rotation={30}\n      width={60}')
    const { source, patches } = edit(turned, (subpaths) => {
      const at = subpaths[0]!.vertices[1]!
      return moveVertex(subpaths, { subpath: 0, index: 1 }, { x: at.x, y: at.y + 40 })
    })
    const patched = applyPatches(source, patches).source
    const moved = /L([-\d.]+) ([-\d.]+)/.exec(dataOf(patched))!
    // 40 straight down on screen is 40 along a -30° axis in the node's frame.
    expect(Number(moved[1])).toBeCloseTo(60 + 40 * Math.sin((30 * Math.PI) / 180), 1)
    expect(Number(moved[2])).toBeCloseTo(40 * Math.cos((30 * Math.PI) / 180), 1)

    // And the node is untouched: only its path moved.
    const node = resolve(parseOrThrow(patched).tree, ADDRESS)!
    expect(node.attrs.rotation!.value).toBe(30)
    expect(node.attrs.x!.value).toBe(20)
  })

  it('re-spells an arc once, and only once', () => {
    // ADR 0006 §8's one lossy step, in the file rather than in a measurement:
    // the arc is gone the first time the path is written, and what replaces it
    // survives the next write untouched.
    const arced = SRC.replace("data: 'M0 0L60 0L60 60L0 0Z'", "data: 'M0 0A30 30 0 0 1 60 60'")
    const { source, patches } = edit(arced, (subpaths) => subpaths)
    const once = applyPatches(source, patches).source
    expect(dataOf(once)).not.toMatch(/[Aa]/)
    expect(dataOf(once)).toMatch(/^M0 0C/)

    const twice = edit(once, (subpaths) => subpaths)
    expect(applyPatches(once, twice.patches).source).toBe(once)
  })
})
