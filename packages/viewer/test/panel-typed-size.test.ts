import { describe, expect, it } from 'vitest'
import { parseOrThrow, resolve } from '@uidx/format'
import { fromSceneChange, toSceneGraph } from '@uidx/schema'
import { authoredSizing, sizingFlipFor } from '../src/resize-writes'

/**
 * C7's hug-flip criterion, at the altitude the gesture actually runs.
 *
 * `sizingFlipFor` has always been right when asked directly, and its own unit
 * tests always passed. The criterion still failed in the browser, because a
 * typed number previews on every keystroke before it commits, and the panel
 * asked the *scene node*: the first preview flipped the node to `FIXED` in a
 * `runPreviewUpdates` block that by design writes nothing to the file, and the
 * commit then asked a node that no longer hugged. The width landed alone and
 * the file held `width={240}` beside `primaryAxisSizingMode="AUTO"`.
 *
 * These tests drive preview-then-commit, which is the only sequence that can
 * catch it.
 */
const SRC = `---
id: typed
---

## Visual Contract

<Component name="typed" status="draft">
  <Frame name="root" layoutMode="NONE">
    <Frame name="hugger" layoutMode="HORIZONTAL"
      primaryAxisSizingMode="AUTO" counterAxisSizingMode="AUTO">
      <Rectangle name="kid" width={40} height={40} />
    </Frame>
    <Text name="loose" characters="hi" />
    <Text name="measured" characters="hi" textAutoResize="WIDTH_AND_HEIGHT" />
  </Frame>
</Component>
`

function open(address: string) {
  const doc = parseOrThrow(SRC)
  const scene = toSceneGraph(doc)
  const sceneId = scene.addresses.sceneIdOf(address)!
  const docNode = resolve(doc.tree, address)!
  return { doc, scene, sceneId, docNode }
}

/** What `applyProp` builds for one keystroke or one commit. */
function sizedWrite(
  source: Parameters<typeof sizingFlipFor>[0],
  width: number,
): Record<string, unknown> {
  return { width, ...sizingFlipFor(source, 'width') }
}

describe('a width typed into a hugging frame', () => {
  it('still flips the axis on commit, after previews have moved the scene node', () => {
    const { scene, sceneId, docNode } = open('typed#root/hugger')

    // Three keystrokes: 2, 24, 240. Each previews into the graph, and a
    // preview writes nothing to the file — but it does change the node.
    for (const width of [2, 24, 240]) {
      scene.graph.updateNode(sceneId, sizedWrite(authoredSizing(docNode), width) as never)
    }
    expect(scene.graph.getNode(sceneId)!.primaryAxisSizing).toBe('FIXED')

    // The commit is the write that reaches the file, and it must still say so.
    const commit = sizedWrite(authoredSizing(docNode), 240)
    expect(commit).toEqual({ width: 240, primaryAxisSizing: 'FIXED' })
  })

  /**
   * The defect itself, pinned so it cannot come back by someone reaching for
   * the scene node again — it is right there in `applyProp` and it reads like
   * the obvious source.
   */
  it('is asked of the document, because the scene node has already been moved', () => {
    const { scene, sceneId, docNode } = open('typed#root/hugger')

    scene.graph.updateNode(sceneId, sizedWrite(authoredSizing(docNode), 2) as never)

    const fromScene = sizingFlipFor(scene.graph.getNode(sceneId)!, 'width')
    const fromDoc = sizingFlipFor(authoredSizing(docNode), 'width')
    expect(fromScene).toEqual({})
    expect(fromDoc).toEqual({ primaryAxisSizing: 'FIXED' })
  })

  it('reaches the file as one added attribute beside the width', () => {
    const { doc, scene, sceneId, docNode } = open('typed#root/hugger')

    const commit = sizedWrite(authoredSizing(docNode), 240)
    scene.graph.updateNode(sceneId, commit as never)
    const patches = fromSceneChange(sceneId, commit as never, {
      doc,
      graph: scene.graph,
      addresses: scene.addresses,
      // The panel vouches by uidx name, as `applyProp` does.
      authored: new Set(['width', 'primaryAxisSizingMode']),
      authoredFor: sceneId,
    })

    // The diff a reviewer reads: one attribute added, one changed, nothing else.
    const written = patches.filter((p) => p.op === 'add' || p.op === 'set')
    expect(written).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ op: 'add', prop: 'width', value: 240 }),
        expect.objectContaining({ op: 'set', prop: 'primaryAxisSizingMode', value: 'FIXED' }),
      ]),
    )
    expect(written.map((p) => p.prop).sort()).toEqual(['primaryAxisSizingMode', 'width'])
  })
})

describe('authoredSizing reads the file, and the engine where the file is silent', () => {
  it('takes the axis the file states', () => {
    const { docNode } = open('typed#root/hugger')
    expect(authoredSizing(docNode)).toMatchObject({
      type: 'FRAME',
      layoutMode: 'HORIZONTAL',
      primaryAxisSizing: 'HUG',
      counterAxisSizing: 'HUG',
    })
  })

  /**
   * A text that states it measures itself is pinned by a typed width — to
   * `HEIGHT`, Figma's own split: the width sets the wrap and the box keeps
   * growing downward. `NONE` here would leave a height the file never
   * authored reading as fixed on the scene node, which is the shape the D4
   * geometry echo writes computed numbers into.
   */
  it('pins a text the file says measures itself', () => {
    const { docNode } = open('typed#root/measured')
    const sizing = authoredSizing(docNode)
    expect(sizing.type).toBe('TEXT')
    expect(sizing.textAutoResize).toBe('WIDTH_AND_HEIGHT')
    expect(sizingFlipFor(sizing, 'width')).toEqual({ textAutoResize: 'HEIGHT' })
  })

  /**
   * A text the file says nothing about measures itself too — its silence *is*
   * the hug (`textSizing` in to-scene, the geometry-echo fix), so a typed
   * width pins it exactly as an authored `WIDTH_AND_HEIGHT` would. The point
   * of reading the answer from `defaultFor` is that it follows what
   * `toSceneGraph` actually builds rather than a table here that would drift
   * away from it.
   */
  it('pins a text whose silence means it measures itself', () => {
    const { docNode } = open('typed#root/loose')
    const sizing = authoredSizing(docNode)
    expect(sizing.textAutoResize).toBe('WIDTH_AND_HEIGHT')
    expect(sizingFlipFor(sizing, 'width')).toEqual({ textAutoResize: 'HEIGHT' })
  })

  /**
   * The case where the file is silent and the answer is still "it hugs": a
   * `<Component>` with no layout of its own is wrapped in a hugging auto-layout
   * so its bounds are its content (`componentSizing` in `to-scene.ts`). Reading
   * only the attributes present would miss it and write a width the wrapper
   * immediately recomputes away.
   *
   * That wrapper is `VERTICAL`, so a *width* is its counter axis — which is
   * also why the flip has to come from the mapping rather than from the name
   * of the prop the panel happened to edit.
   */
  it('flips a component that hugs by default, which the file never states', () => {
    const doc = parseOrThrow(SRC)
    const docNode = resolve(doc.tree, 'typed')!
    expect(docNode.attrs.primaryAxisSizingMode).toBeUndefined()
    expect(authoredSizing(docNode)).toMatchObject({
      type: 'COMPONENT',
      layoutMode: 'VERTICAL',
      counterAxisSizing: 'HUG',
    })
    expect(sizingFlipFor(authoredSizing(docNode), 'width')).toEqual({
      counterAxisSizing: 'FIXED',
    })
  })
})
