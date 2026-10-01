import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { applyPatches, parseOrThrow, resolve } from '@uidx/format'
import { fromSceneChange, layOutEntity, toSceneGraph } from '@uidx/schema'
import { collapseBurst } from '../src/patch-burst'
import { authoredSizing, instanceSizing, releasedFills, sizingFlipFor } from '../src/resize-writes'
import PropertiesPane from '../src/PropertiesPane.vue'

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

/**
 * The same typed width on an `<Instance>`, which the file states no sizing for
 * at all: `authoredSizing` answered "nothing hugs", the flip never happened,
 * and the number previewed as nothing while the component's hug held. The
 * instance is asked as the build answers it (`instanceSizing`), and the file
 * still takes the width alone — a stated width *is* Fixed on an instance.
 */
const BUTTON1 = parseOrThrow(`---
id: button1
---

## Visual Contract

<Page>
  <Component name="Button1" status="draft"
    layoutMode="HORIZONTAL" primaryAxisSizingMode="AUTO" counterAxisSizingMode="AUTO"
    paddingLeft={12} paddingRight={12} paddingTop={8} paddingBottom={8}>
    <Text name="label" characters="{label}" fontSize={14} />
  </Component>
</Page>

<Styles>
  <Style state="hover" root:opacity={0.8} />
</Styles>

## Contract

<Props>
  <Prop name="label" type="string" sample="Button1">The words it shows.</Prop>
</Props>
`)
const components = new Map([['Button1', BUTTON1.tree.children[0]!]])
const scope = { resolveComponent: (name: string) => components.get(name) }
const PAGE = (attrs = '') => `---
id: page1
---

## Visual Contract

<Page>
  <Instance name="button1-1" component="Button1" x={10} y={10} props={{ label: 'Click Me' }}${attrs} />
</Page>
`

describe('a width typed into an instance', () => {
  it('previews at the width instead of the component’s hug', () => {
    const doc = parseOrThrow(PAGE())
    const scene = toSceneGraph(doc, scope)
    const docNode = resolve(doc.tree, 'button1-1')!
    const write = { width: 160, ...sizingFlipFor(instanceSizing(docNode, scope), 'width') }
    expect(write).toEqual({ width: 160, counterAxisSizing: 'FIXED' })
    scene.graph.updateNode('button1-1', write as never)
    layOutEntity(scene.graph, 'button1-1', scene.pins)
    expect(scene.graph.getNode('button1-1')!.width).toBe(160)
  })

  it('lands as the width alone, even if the flip were vouched, and renders at it', () => {
    const doc = parseOrThrow(PAGE())
    const scene = toSceneGraph(doc, scope)
    const docNode = resolve(doc.tree, 'button1-1')!
    const write = { width: 160, ...sizingFlipFor(instanceSizing(docNode, scope), 'width') }
    scene.graph.updateNode('button1-1', write as never)
    const patches = fromSceneChange('button1-1', write as never, {
      doc,
      graph: scene.graph,
      addresses: scene.addresses,
      authored: new Set(['width', 'counterAxisSizingMode']),
      authoredFor: 'button1-1',
    })
    expect(patches).toEqual([{ op: 'add', address: 'button1-1', prop: 'width', value: 160 }])

    const echoed = toSceneGraph(parseOrThrow(applyPatches(doc.source, patches).source), scope)
    expect(echoed.graph.getNode('button1-1')!.width).toBe(160)
    expect(echoed.graph.getNode('button1-1#root')!.width).toBe(160)
  })
})

describe('a width typed into an instance that stretches across its parent', () => {
  // The build lets the stretch outrank a stated width, so a width typed on
  // its own landed in the file and drew nothing. Typing the size turns Fill
  // into Fixed, as a drag does: the stretch goes in the same commit.
  const CARD = `---
id: page1
---

## Visual Contract

<Page>
  <Frame name="card" x={0} y={0} width={520} height={200} layoutMode="VERTICAL" primaryAxisSizingMode="FIXED" counterAxisSizingMode="FIXED">
    <Instance name="b" component="Button1" layoutAlign="STRETCH" props={{ label: 'Go' }} />
  </Frame>
</Page>
`

  it('lets the stretch go, and renders at the width', () => {
    const doc = parseOrThrow(CARD)
    const scene = toSceneGraph(doc, scope)
    const sizing = instanceSizing(resolve(doc.tree, 'card#b')!, scope, 'VERTICAL')
    const released = releasedFills(sizing.fills, ['width'])
    const write = { width: 160, ...sizingFlipFor(sizing, 'width'), ...released.fields }
    scene.graph.updateNode('card#b', write as never)
    layOutEntity(scene.graph, 'card#b', scene.pins)
    expect(scene.graph.getNode('card#b')!.width).toBe(160)

    const patches = collapseBurst([
      ...fromSceneChange('card#b', write as never, {
        doc,
        graph: scene.graph,
        addresses: scene.addresses,
        authored: new Set(['width']),
        authoredFor: 'card#b',
      }),
      ...released.removals.map((prop) => ({ op: 'remove' as const, address: 'card#b', prop })),
    ])
    expect(patches).toEqual([
      { op: 'add', address: 'card#b', prop: 'width', value: 160 },
      { op: 'remove', address: 'card#b', prop: 'layoutAlign' },
    ])
    const echoed = toSceneGraph(parseOrThrow(applyPatches(doc.source, patches).source), scope)
    expect(echoed.graph.getNode('card#b')!.width).toBe(160)
  })
})

describe('the Fixed/Hug choice on an instance', () => {
  const pane = (attrs: string) =>
    mount(PropertiesPane, {
      props: {
        doc: parseOrThrow(PAGE(attrs)),
        selection: ['button1-1'],
        writable: true,
        pinFrame: {
          box: { x: 10, y: 10, width: 199, height: 36 },
          parent: { width: 0, height: 0 },
        },
      },
    })
  const box = (wrapper: ReturnType<typeof pane>, dimension: 'width' | 'height') =>
    wrapper.get(`.size-field[data-dimension="${dimension}"]`)

  it('is offered, and reads Fixed where the instance states the size and Hug where it does not', () => {
    const wrapper = pane(' width={199}')
    const dimensions = wrapper.findComponent({ name: 'DimensionsField' })
    expect(dimensions.props('modes')).toEqual([
      { value: 'FIXED', label: 'Fixed' },
      { value: 'AUTO', label: 'Hug' },
    ])
    expect((box(wrapper, 'width').get('select.size-mode').element as HTMLSelectElement).value).toBe(
      'FIXED',
    )
    expect(
      (box(wrapper, 'height').get('select.size-mode').element as HTMLSelectElement).value,
    ).toBe('AUTO')
  })

  it('takes the size out of the file for Hug — the reset to the component', async () => {
    const wrapper = pane(' width={199}')
    await box(wrapper, 'width').get('select.size-mode').setValue('AUTO')
    expect(wrapper.emitted('patches')).toEqual([
      [[{ op: 'remove', address: 'button1-1', prop: 'width' }]],
    ])
  })

  it('states the size the canvas draws for Fixed', async () => {
    const wrapper = pane(' width={199}')
    await box(wrapper, 'height').get('select.size-mode').setValue('FIXED')
    expect(wrapper.emitted('commit')).toEqual([['button1-1', 'height', 36]])
  })
})
