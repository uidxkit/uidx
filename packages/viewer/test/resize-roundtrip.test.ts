import { describe, expect, it } from 'vitest'
import { applyPatches, parseOrThrow, resolve, type UidxNode, type UidxPatch } from '@uidx/format'
import {
  applyChanges,
  diffDocuments,
  fromSceneChange,
  layOutEntity,
  toSceneGraph,
} from '@uidx/schema'
import type { Rect } from '../src/gesture-model'
import { collapseBurst } from '../src/patch-burst'
import {
  instanceResizeWrites,
  instanceSizing,
  releasedFills,
  resizedBox,
  resizeWrites,
} from '../src/resize-writes'

/**
 * The C10a spike found that a hugging frame resized on canvas produced no
 * patch at all: the SDK commits x/y/width/height, the axis still reads HUG,
 * and D4's filter drops a dimension the node computes for itself.
 *
 * This is that case, end to end. It fails if `resize-writes.ts` stops sending
 * the sizing flip — which is the whole reason that module exists.
 */
const SRC = `---
id: rt
---

## Visual Contract

<Component name="rt" status="draft">
  <Frame name="root" layoutMode="NONE">
    <Frame name="hugger" layoutMode="VERTICAL"
      primaryAxisSizingMode="AUTO" counterAxisSizingMode="AUTO">
      <Rectangle name="kid" width={40} height={40} />
    </Frame>
  </Frame>
</Component>
`

function resizeAndCollect(rect: { x: number; y: number; width: number; height: number }) {
  const doc = parseOrThrow(SRC)
  const scene = toSceneGraph(doc)
  const sceneId = scene.addresses.sceneIdOf('rt#root/hugger')!
  const node = scene.graph.getNode(sceneId)!
  const writes = resizeWrites(node, rect)
  scene.graph.updateNode(sceneId, writes as never)
  return fromSceneChange(sceneId, writes as never, {
    doc,
    graph: scene.graph,
    addresses: scene.addresses,
  })
}

describe('a canvas resize of a hugging frame', () => {
  it('reaches the file, sizing flip and all', () => {
    const patches = resizeAndCollect({ x: 0, y: 0, width: 300, height: 150 })
    const byProp = Object.fromEntries(
      patches.map((p) => [(p as { prop: string }).prop, (p as { value: unknown }).value]),
    )
    expect(byProp.width).toBe(300)
    expect(byProp.height).toBe(150)
    expect(byProp.primaryAxisSizingMode).toBe('FIXED')
    expect(byProp.counterAxisSizingMode).toBe('FIXED')
  })

  it('is one gesture, so its writes are few enough to be one envelope', () => {
    expect(resizeAndCollect({ x: 0, y: 0, width: 300, height: 150 }).length).toBeLessThanOrEqual(6)
  })
})

/**
 * The same gesture on an `<Instance>` of a component that hugs (page1's
 * Button1, found live): the file got `width={199} height={33}` and the canvas
 * kept drawing the button at its hug size, while the drag itself snapped back
 * on every frame.
 *
 * An instance states its size and nothing about how it is decided — a stated
 * width is Fixed — so the file takes the box alone, and only on the axes the
 * handle moved. The sizing flip is still needed, but on the canvas: without
 * it the preview is laid out against the component's hug and snaps back.
 */
const BUTTON1 = `---
id: button1
---

## Visual Contract

<Page>
  <Component name="Button1" status="draft"
    layoutMode="HORIZONTAL" primaryAxisSizingMode="AUTO" counterAxisSizingMode="AUTO"
    primaryAxisAlignItems="CENTER" counterAxisAlignItems="CENTER"
    paddingLeft={12} paddingRight={12} paddingTop={8} paddingBottom={8} cornerRadius={999}
    fills={[{ opacity: 1, visible: true, type: 'SOLID', color: { r: 0, g: 0.3333, b: 1, a: 1 } }]}>
    <Text name="label" characters="{label}" fontSize={14} />
  </Component>
</Page>

<Styles>
  <Style state="hover" root:fills={[{ opacity: 1, visible: true, type: 'SOLID', color: { r: 0.37, g: 0.57, b: 0.99, a: 1 } }]} />
</Styles>

## Contract

<Props>
  <Prop name="label" type="string" sample="Button1">The words it shows.</Prop>
</Props>
`

const PAGE1 = `---
id: page1
---

## Visual Contract

<Page>
  <Instance name="button1-1" component="Button1" x={328} y={360} props={{ label: 'Click Me' }} />
</Page>
`

const definitions = new Map([['Button1', parseOrThrow(BUTTON1).tree.children[0]!]])
const options = { resolveComponent: (name: string) => definitions.get(name) }

function openPage(source = PAGE1) {
  const doc = parseOrThrow(source)
  const scene = toSceneGraph(doc, options)
  const saved = resolve(doc.tree, 'button1-1')!
  const node = scene.graph.getNode('button1-1')!
  const from = { x: node.x, y: node.y, width: node.width, height: node.height }
  return { doc, scene, saved, from }
}

/** `resizeNode` for an instance: the writes, previewed and then committed the way CanvasPane does. */
function resizeInstance(rect: Rect, widthOnly = false, source = PAGE1) {
  const { doc, scene, saved, from } = openPage(source)
  const sizing = instanceSizing(saved, options)
  const writes = instanceResizeWrites(sizing, rect, resizedBox(from, rect, widthOnly))
  // Previewed first: the node must stay where the drag put it once laid out.
  scene.graph.updateNode('button1-1', writes as never)
  layOutEntity(scene.graph, 'button1-1', scene.pins)
  const previewed = scene.graph.getNode('button1-1')!
  const patches = fromSceneChange('button1-1', writes as never, {
    doc,
    graph: scene.graph,
    addresses: scene.addresses,
    authored: new Set(
      Object.keys(writes).filter((key) => ['x', 'y', 'width', 'height'].includes(key)),
    ),
    authoredFor: 'button1-1',
  })
  // The echo: the file the patches make, built again from scratch.
  const echoed = toSceneGraph(parseOrThrow(applyPatches(doc.source, patches).source), options)
  return { patches, previewed, echoed, from }
}

const props = (patches: readonly UidxPatch[]) =>
  Object.fromEntries(
    patches.map((p) => [(p as { prop: string }).prop, (p as { value: unknown }).value]),
  )

describe('a canvas resize of an instance of a hugging component', () => {
  it('reads the sizing from the component, which hugs, rather than from the silent file', () => {
    const { saved } = openPage()
    expect(instanceSizing(saved, options)).toMatchObject({
      type: 'INSTANCE',
      primaryAxisSizing: 'HUG',
      counterAxisSizing: 'HUG',
    })
  })

  it('writes the box and no sizing mode, and draws at it once the file echoes back', () => {
    const { patches, echoed } = resizeInstance({ x: 328, y: 360, width: 199, height: 33 })
    expect(props(patches)).toEqual({ width: 199, height: 33 })
    expect(echoed.graph.getNode('button1-1')).toMatchObject({ width: 199, height: 33 })
    expect(echoed.graph.getNode('button1-1#root')).toMatchObject({ width: 199, height: 33 })
  })

  it('holds the dragged size in the preview instead of snapping back to the hug', () => {
    const { previewed } = resizeInstance({ x: 328, y: 360, width: 199, height: 33 })
    expect(previewed).toMatchObject({ width: 199, height: 33 })
  })

  it('writes only the width from a side handle, so the height keeps hugging', () => {
    const { patches, echoed, from } = resizeInstance(
      { x: 328, y: 360, width: 199, height: 36 },
      true,
    )
    expect(props(patches)).toEqual({ width: 199 })
    expect(echoed.graph.getNode('button1-1')).toMatchObject({ width: 199, height: from.height })
  })

  it('writes only the height from a top or bottom handle', () => {
    const { from } = openPage()
    const { patches, echoed } = resizeInstance({ ...from, y: 350, height: from.height + 10 })
    expect(props(patches)).toEqual({ y: 350, height: from.height + 10 })
    expect(echoed.graph.getNode('button1-1')).toMatchObject({
      width: from.width,
      height: from.height + 10,
    })
  })

  it('resizes an instance that already states its size, still writing only the box', () => {
    const sized = PAGE1.replace(' />', ' width={199} height={33} />')
    const { patches, echoed } = resizeInstance(
      { x: 328, y: 360, width: 240, height: 33 },
      true,
      sized,
    )
    expect(props(patches)).toEqual({ width: 240 })
    expect(echoed.graph.getNode('button1-1#root')).toMatchObject({ width: 240, height: 33 })
  })
})

/**
 * A drag on the dimension an instance fills — `layoutAlign="STRETCH"` across
 * its parent, `layoutGrow` along it. The build lets the fill outrank a stated
 * size (a width left over from before the stretch must not undo it), so a
 * drag that wrote the width alone drew 300 while it lasted and 504 once the
 * file came back. Figma's answer is the one taken: sizing a filled dimension
 * by hand turns it from Fill to Fixed, so the fill goes in the same commit.
 */
describe('a canvas resize of an instance on the dimension it fills', () => {
  /** A 520x200 column with 8 padding: a stretch there is 504 wide. */
  const CARD = (child: string, definition = '') => `---
id: card
---

## Visual Contract

<Page>
${definition}
  <Frame name="card" x={0} y={0} width={520} height={200} layoutMode="VERTICAL" primaryAxisSizingMode="FIXED" counterAxisSizingMode="FIXED" paddingTop={8} paddingRight={8} paddingBottom={8} paddingLeft={8}>
    ${child}
  </Frame>
</Page>
${definition ? '\n<Styles>\n  <Style state="hover" root:opacity={0.5} />\n</Styles>\n' : ''}`
  const STRETCHED = `<Instance name="b" component="Button1" layoutAlign="STRETCH" props={{ label: 'Go' }} />`
  /** Button1 itself, defined on the card's own page — the echo then updates in place. */
  const LOCAL = BUTTON1.slice(BUTTON1.indexOf('<Component'), BUTTON1.indexOf('</Page>'))

  /** `resizeNode` for an instance, committed: the writes, the patches and the file's echo. */
  function drag(source: string, rect: (from: Rect) => Rect, widthOnly: boolean) {
    const doc = parseOrThrow(source)
    const local = new Map<string, UidxNode>(definitions)
    for (const node of doc.tree.children)
      if (node.element === 'Component') local.set(node.name, node)
    const scope = { resolveComponent: (name: string) => local.get(name) }
    const scene = toSceneGraph(doc, scope)
    const node = scene.graph.getNode('card#b')!
    const from = { x: node.x, y: node.y, width: node.width, height: node.height }
    const to = rect(from)
    const parentLayout = scene.graph.getNode(node.parentId!)!.layoutMode
    const sizing = instanceSizing(resolve(doc.tree, 'card#b')!, scope, parentLayout)
    const moved = resizedBox(from, to, widthOnly)
    const released = releasedFills(
      sizing.fills,
      (['width', 'height'] as const).filter((dimension) => moved[dimension]),
    )
    const writes = { ...instanceResizeWrites(sizing, to, moved), ...released.fields }
    scene.graph.updateNode('card#b', writes as never)
    layOutEntity(scene.graph, 'card#b', scene.pins)
    const previewed = { ...scene.graph.getNode('card#b')! }
    const patches = collapseBurst([
      ...fromSceneChange('card#b', writes as never, {
        doc,
        graph: scene.graph,
        addresses: scene.addresses,
        authored: new Set(Object.keys(writes).filter((key) => key in to)),
        authoredFor: 'card#b',
      }),
      ...released.removals.map((prop) => ({ op: 'remove' as const, address: 'card#b', prop })),
    ])
    const next = parseOrThrow(applyPatches(doc.source, patches).source)
    const rebuilt = toSceneGraph(next, scope)
    // The echo the canvas actually takes when it can: the change applied in place.
    const changes = diffDocuments(doc, next)
    if (changes) applyChanges(scene, changes, scope)
    return { patches, previewed, rebuilt, live: changes ? scene : rebuilt, next }
  }

  it('lets the stretch go with the width, and draws at the drag once the file echoes', () => {
    const { patches, previewed, rebuilt, next } = drag(
      CARD(STRETCHED),
      (from) => ({ ...from, width: 300 }),
      true,
    )
    expect(previewed.width).toBe(300)
    expect(patches).toEqual([
      { op: 'add', address: 'card#b', prop: 'width', value: 300 },
      { op: 'remove', address: 'card#b', prop: 'layoutAlign' },
    ])
    expect(resolve(next.tree, 'card#b')!.attrs.layoutAlign).toBeUndefined()
    expect(rebuilt.graph.getNode('card#b')).toMatchObject({ width: 300 })
    expect(rebuilt.graph.getNode('card#b/root')).toMatchObject({ width: 300 })
  })

  it('keeps the stretch when the drag sizes the other dimension only', () => {
    const { patches, rebuilt } = drag(
      CARD(STRETCHED),
      (from) => ({ ...from, height: from.height + 20 }),
      false,
    )
    expect(patches.map((p) => (p as { prop: string }).prop)).toEqual(['height'])
    expect(rebuilt.graph.getNode('card#b')).toMatchObject({ width: 504 })
  })

  it('lets a grow go the same way along the parent’s flow', () => {
    const { patches, rebuilt } = drag(
      CARD(STRETCHED.replace('layoutAlign="STRETCH"', 'layoutGrow={1}')),
      (from) => ({ ...from, height: 80 }),
      false,
    )
    expect(patches).toContainEqual({ op: 'remove', address: 'card#b', prop: 'layoutGrow' })
    expect(rebuilt.graph.getNode('card#b')).toMatchObject({ height: 80 })
  })

  it('agrees with a rebuild when the component is on the same page and the echo updates in place', () => {
    const { live, rebuilt } = drag(
      CARD(STRETCHED, LOCAL),
      (from) => ({ ...from, width: 300 }),
      true,
    )
    for (const id of ['card#b', 'card#b/root']) {
      expect(live.graph.getNode(id)!.width).toBe(300)
      expect(live.graph.getNode(id)!.width).toBe(rebuilt.graph.getNode(id)!.width)
    }
  })
})
