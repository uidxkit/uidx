import { describe, expect, it } from 'vitest'
import { applyPatches, parseOrThrow, resolve, type UidxNode } from '@uidx/format'
import {
  applyChanges,
  diffDocuments,
  fromSceneChange,
  layOutEntity,
  toSceneGraph,
  type SceneResult,
} from '@uidx/schema'
import type { Rect } from '../src/gesture-model'
import { collapseBurst } from '../src/patch-burst'
import {
  instanceResizeWrites,
  instanceSizing,
  releasedFills,
  resizedBox,
  sizingFlipFor,
} from '../src/resize-writes'
import { createWrappedFrame, type InstanceFraming } from '../src/wrapped-frame'

/**
 * A resize drawn live on an `<Instance>` of a component with a styles table.
 *
 * Found in the browser on page1: Button1 hugs, has padding, a pill radius and
 * a hover row, so `deriveVariants` wraps it — the instance's root is a
 * transparent variant wrapper and the pill is the frame inside it,
 * `button1-1#root`. Dragging the west handle moved the selection box to 266
 * wide while the pill stayed 160 and only slid with the wrapper; on release
 * the file's echo rebuilt the scene and the pill jumped to 266. The frame
 * takes the instance's size from `pinnedFrame`, which only a build or a
 * reconcile ran, so nothing drew it until the file came back.
 *
 * These drive what `CanvasPane` does on each pointer move or keystroke — the
 * frame drawn for the file the gesture would write, the instance's own
 * writes, then layout — and look at the frame the author is watching.
 */
const COMPONENT = (attrs = '') => `  <Component name="Button1" status="draft"
    layoutMode="HORIZONTAL" primaryAxisSizingMode="AUTO" counterAxisSizingMode="AUTO"
    primaryAxisAlignItems="CENTER" counterAxisAlignItems="CENTER"
    paddingLeft={12} paddingRight={12} paddingTop={8} paddingBottom={8} cornerRadius={999}${attrs}
    fills={[{ opacity: 1, visible: true, type: 'SOLID', color: { r: 0, g: 0.3333, b: 1, a: 1 } }]}>
    <Text name="label" characters="{label}" fontSize={14} />
  </Component>`

const STYLES = `
<Styles>
  <Style state="hover" root:fills={[{ opacity: 1, visible: true, type: 'SOLID', color: { r: 0.37, g: 0.57, b: 0.99, a: 1 } }]} />
</Styles>
`

const CONTRACT = `
## Contract

<Props>
  <Prop name="label" type="string" sample="Button1">The words it shows.</Prop>
</Props>
`

const BUTTON1 = (attrs = '', styles = true) => `---
id: button1
---

## Visual Contract

<Page>
${COMPONENT(attrs)}
</Page>
${styles ? STYLES : ''}${CONTRACT}`

const INSTANCE = (size = ' width={160} height={33}') =>
  `<Instance name="button1-1" component="Button1" x={328} y={360}${size} props={{ label: 'Click Me' }} />`

const PAGE = (size?: string) => `---
id: page1
---

## Visual Contract

<Page>
  ${INSTANCE(size)}
</Page>
`

/** Button1 defined beside its instance: the echo then updates the scene in place. */
const LOCAL = `---
id: page1
---

## Visual Contract

<Page>
${COMPONENT()}
  ${INSTANCE()}
</Page>
${STYLES}${CONTRACT}`

/** A 520-wide column with 8 padding, where a stretched instance is 504 wide. */
const CARD = `---
id: card
---

## Visual Contract

<Page>
  <Frame name="card" x={0} y={0} width={520} height={200} layoutMode="VERTICAL" primaryAxisSizingMode="FIXED" counterAxisSizingMode="FIXED" paddingTop={8} paddingRight={8} paddingBottom={8} paddingLeft={8}>
    <Instance name="b" component="Button1" layoutAlign="STRETCH" props={{ label: 'Go' }} />
  </Frame>
</Page>
`

const ID = 'button1-1'

/** The pill: the frame the derived variant wraps, one level under the instance. */
const frameOf = (id: string) => `${id}${id.includes('#') ? '/' : '#'}root`
const labelOf = (id: string) => `${frameOf(id)}/label`

function open(page = PAGE(), button = BUTTON1(), id = ID) {
  const doc = parseOrThrow(page)
  const definitions = new Map<string, UidxNode>([
    ['Button1', parseOrThrow(button).tree.children[0]!],
  ])
  for (const node of doc.tree.children)
    if (node.element === 'Component') definitions.set(node.name, node)
  const scope = { resolveComponent: (name: string) => definitions.get(name) }
  const scene = toSceneGraph(doc, scope)
  const saved = resolve(doc.tree, id)!
  const node = scene.graph.getNode(id)!
  const from: Rect = { x: node.x, y: node.y, width: node.width, height: node.height }
  const parentLayout = scene.graph.getNode(node.parentId!)!.layoutMode
  // What `CanvasPane` hands it: the graph, the build's scope, the file, and
  // the editor's write.
  const frame = createWrappedFrame({
    graph: () => scene.graph,
    scope: () => scope,
    saved: (address) => resolve(doc.tree, address),
    update: (at, props) => update(scene, at, props),
  })
  return { id, doc, scene, saved, scope, from, parentLayout, frame }
}

type Opened = ReturnType<typeof open>

/** The SDK editor's `updateNode`: the write, then layout for what it moved. */
function update(scene: SceneResult, id: string, fields: Record<string, unknown>): void {
  scene.graph.updateNode(id, fields as never)
  layOutEntity(scene.graph, id.split('#')[0]!, scene.pins)
}

interface Write {
  fields: Record<string, unknown>
  removals: readonly string[]
}

/** `CanvasPane.resizeNode` for an instance: one frame of the gesture. */
function resize(
  opened: Opened,
  rect: Rect,
  mode: 'preview' | 'commit' | 'cancel',
  widthOnly = false,
): Write {
  const { id, scene, saved, scope, from, parentLayout, frame } = opened
  const sizing = instanceSizing(saved, scope, parentLayout)
  const moved =
    mode === 'cancel'
      ? { x: true, y: true, width: true, height: true }
      : resizedBox(from, rect, widthOnly)
  const released =
    mode !== 'cancel'
      ? releasedFills(
          sizing.fills,
          (['width', 'height'] as const).filter((dimension) => moved[dimension]),
        )
      : null
  const fields: Record<string, unknown> = {
    ...instanceResizeWrites(sizing, rect, moved),
    ...released?.fields,
  }
  const framing: InstanceFraming | null =
    mode !== 'cancel'
      ? {
          size: {
            ...(moved.width ? { width: rect.width } : {}),
            ...(moved.height ? { height: rect.height } : {}),
          },
          removals: released?.removals ?? [],
        }
      : null
  if (mode === 'cancel') {
    const before: Record<string, unknown> = { ...sizing }
    for (const key of ['primaryAxisSizing', 'counterAxisSizing', 'layoutGrow', 'layoutAlignSelf']) {
      if (before[key] !== undefined) fields[key] = before[key]
    }
  }
  if (mode !== 'commit') {
    scene.graph.runPreviewUpdates(() => {
      frame.draw(saved, framing)
      update(scene, id, fields)
    })
  } else {
    scene.graph.runPreviewUpdates(() => frame.draw(saved, framing))
    frame.settle()
    update(scene, id, fields)
  }
  return { fields, removals: released?.removals ?? [] }
}

/** `CanvasPane.applyProp` for a width or height typed into the panel. */
function typed(
  opened: Opened,
  prop: 'width' | 'height',
  value: number,
  mode: 'preview' | 'commit',
): Write {
  const { id, scene, saved, scope, parentLayout, frame } = opened
  const placed = instanceSizing(saved, scope, parentLayout)
  const released = releasedFills(placed.fills, [prop])
  const fields = { [prop]: value, ...sizingFlipFor(placed, prop), ...released.fields }
  const framing = { size: { [prop]: value }, removals: released.removals }
  if (mode === 'preview') {
    scene.graph.runPreviewUpdates(() => {
      frame.draw(saved, framing)
      update(scene, id, fields)
    })
  } else {
    scene.graph.runPreviewUpdates(() => frame.draw(saved, framing))
    frame.settle()
    update(scene, id, fields)
  }
  return { fields, removals: released.removals }
}

const node = (opened: Opened, at: string) => opened.scene.graph.getNode(at)!

/** Where the label's centre sits across the pill, and down it. */
function labelCentre(opened: Opened): { x: number; y: number } {
  const label = node(opened, labelOf(opened.id))
  return { x: label.x + label.width / 2, y: label.y + label.height / 2 }
}

/** The drawn geometry of the instance, its frame and the label, for comparing two scenes. */
function drawn(scene: SceneResult, id = ID) {
  const pick = (at: string) => {
    const found = scene.graph.getNode(at)!
    return {
      x: found.x,
      y: found.y,
      width: found.width,
      height: found.height,
      primaryAxisSizing: found.primaryAxisSizing,
      counterAxisSizing: found.counterAxisSizing,
      layoutAlignSelf: found.layoutAlignSelf,
      layoutGrow: found.layoutGrow,
    }
  }
  return { instance: pick(id), frame: pick(frameOf(id)), label: pick(labelOf(id)) }
}

/** The patches a commit writes and the file they make, as `CanvasPane` sends them. */
function commit(opened: Opened, write: Write) {
  const { id, doc, scene } = opened
  const patches = collapseBurst([
    ...fromSceneChange(id, write.fields as never, {
      doc,
      graph: scene.graph,
      addresses: scene.addresses,
      authored: new Set(
        Object.keys(write.fields).filter((key) => ['x', 'y', 'width', 'height'].includes(key)),
      ),
      authoredFor: id,
    }),
    ...write.removals.map((prop) => ({ op: 'remove' as const, address: id, prop })),
  ])
  const next = parseOrThrow(applyPatches(doc.source, patches).source)
  return { patches, next, rebuilt: toSceneGraph(next, opened.scope) }
}

const box = (patches: ReturnType<typeof commit>['patches']) =>
  patches.map((p) => [p.op, (p as { prop: string }).prop, (p as { value?: unknown }).value])

describe('dragging a handle of an instance whose component is wrapped in a variant', () => {
  it('draws the pill at the dragged width on every move, not only after the echo', () => {
    const opened = open()
    expect(node(opened, frameOf(ID)).width).toBe(160)
    const { from } = opened
    for (const width of [200, 240, 266]) {
      resize(opened, { ...from, x: from.x - (width - from.width), width }, 'preview', true)
      expect(node(opened, ID).width).toBe(width)
      expect(node(opened, frameOf(ID))).toMatchObject({ x: 0, width, height: 33 })
    }
  })

  it('re-centres the label in the pill while the drag lasts', () => {
    const opened = open()
    const { from } = opened
    resize(opened, { ...from, x: from.x - 106, width: 266 }, 'preview', true)
    expect(labelCentre(opened).x).toBeCloseTo(133, 0)
  })

  it('puts the pill back, label and all, when the gesture is abandoned', () => {
    const opened = open()
    const before = drawn(opened.scene)
    const { from } = opened
    resize(opened, { ...from, x: from.x - 106, width: 266 }, 'preview', true)
    resize(opened, from, 'cancel', true)
    expect(drawn(opened.scene)).toEqual(before)
  })

  it('draws a top or bottom handle live too, on the height alone', () => {
    const opened = open()
    const { from } = opened
    resize(opened, { ...from, height: 60 }, 'preview')
    expect(node(opened, frameOf(ID))).toMatchObject({ width: 160, height: 60 })
    expect(labelCentre(opened).y).toBeCloseTo(30, 0)
  })

  it('lets a dimension go again when a corner drag brings it back', () => {
    const opened = open(PAGE(''))
    const before = drawn(opened.scene)
    const { from } = opened
    resize(opened, { ...from, width: 266, height: 60 }, 'preview')
    resize(opened, { ...from, width: 266 }, 'preview')
    expect(node(opened, frameOf(ID))).toMatchObject({ width: 266, height: before.frame.height })
    expect(labelCentre(opened).y).toBeCloseTo(before.frame.height / 2, 0)
  })

  it('ends, at release, exactly where the file’s echo draws it', () => {
    const opened = open()
    const { from } = opened
    resize(opened, { ...from, x: from.x - 50, width: 210 }, 'preview', true)
    const settled = { ...from, x: from.x - 106, width: 266 }
    resize(opened, settled, 'preview', true)
    const { patches, rebuilt } = commit(opened, resize(opened, settled, 'commit', true))
    // Still the box alone, on the axis the handle moved.
    expect(box(patches)).toEqual([
      ['set', 'x', settled.x],
      ['set', 'width', 266],
    ])
    expect(drawn(opened.scene)).toEqual(drawn(rebuilt))
  })

  it('agrees with a rebuild when the echo updates the scene in place', () => {
    const opened = open(LOCAL)
    const { from } = opened
    const settled = { ...from, x: from.x - 106, width: 266 }
    resize(opened, settled, 'preview', true)
    const { next, rebuilt } = commit(opened, resize(opened, settled, 'commit', true))
    const changes = diffDocuments(opened.doc, next)
    expect(changes?.map((change) => change.kind)).toContain('update-instance-root')
    applyChanges(opened.scene, changes!, opened.scope)
    expect(drawn(opened.scene)).toEqual(drawn(rebuilt))
  })

  it('puts the pill back when another document lands mid-drag, and draws it again over it', () => {
    const opened = open()
    const before = drawn(opened.scene)
    const { from } = opened
    const rect = { ...from, x: from.x - 106, width: 266 }
    resize(opened, rect, 'preview', true)
    // `render` lets the frame go before the diff, then `reapplyLocalEdits`
    // runs the gesture's last frame again.
    opened.frame.release()
    expect(drawn(opened.scene).frame.width).toBe(before.frame.width)
    resize(opened, rect, 'preview', true)
    expect(node(opened, frameOf(ID)).width).toBe(266)
    expect(labelCentre(opened).x).toBeCloseTo(133, 0)
  })
})

describe('a hugging instance that states no size yet', () => {
  it('draws the pill at the drag, label centred', () => {
    const opened = open(PAGE(''))
    const { from } = opened
    resize(opened, { ...from, width: from.width + 100 }, 'preview', true)
    expect(node(opened, frameOf(ID)).width).toBe(from.width + 100)
    expect(labelCentre(opened).x).toBeCloseTo((from.width + 100) / 2, 0)
  })

  it('goes back to hugging on cancel, stretch and all', () => {
    const opened = open(PAGE(''))
    const before = drawn(opened.scene)
    const { from } = opened
    resize(opened, { ...from, width: from.width + 100 }, 'preview', true)
    resize(opened, from, 'cancel', true)
    expect(drawn(opened.scene)).toEqual(before)
  })
})

describe('a fixed-size component wrapped in a variant', () => {
  const FIXED = BUTTON1(' width={120} height={40}').replace(
    'primaryAxisSizingMode="AUTO" counterAxisSizingMode="AUTO"',
    'primaryAxisSizingMode="FIXED" counterAxisSizingMode="FIXED"',
  )

  it('draws the pill at the drag rather than at the component’s own width, and back', () => {
    const opened = open(PAGE(''), FIXED)
    const before = drawn(opened.scene)
    const { from } = opened
    expect(from.width).toBe(120)
    resize(opened, { ...from, width: 200 }, 'preview', true)
    expect(node(opened, frameOf(ID)).width).toBe(200)
    expect(labelCentre(opened).x).toBeCloseTo(100, 0)
    resize(opened, from, 'cancel', true)
    expect(drawn(opened.scene)).toEqual(before)
  })
})

describe('an instance stretched across its parent', () => {
  const id = 'card#b'

  it('draws the pill at the drag once the stretch lets go, and stretches it again on cancel', () => {
    const opened = open(CARD, BUTTON1(), id)
    const before = drawn(opened.scene, id)
    expect(before.frame.width).toBe(504)
    const { from } = opened
    resize(opened, { ...from, width: 300 }, 'preview', true)
    expect(node(opened, id).width).toBe(300)
    expect(node(opened, frameOf(id))).toMatchObject({ width: 300, layoutAlignSelf: 'AUTO' })
    expect(labelCentre(opened).x).toBeCloseTo(150, 0)
    resize(opened, from, 'cancel', true)
    expect(drawn(opened.scene, id)).toEqual(before)
  })

  it('ends where the echo draws it, the stretch gone from the file', () => {
    const opened = open(CARD, BUTTON1(), id)
    const { from } = opened
    resize(opened, { ...from, width: 300 }, 'preview', true)
    const { patches, rebuilt } = commit(
      opened,
      resize(opened, { ...from, width: 300 }, 'commit', true),
    )
    expect(box(patches)).toEqual([
      ['add', 'width', 300],
      ['remove', 'layoutAlign', undefined],
    ])
    expect(drawn(opened.scene, id)).toEqual(drawn(rebuilt, id))
  })
})

describe('a hugging component with no styles table', () => {
  /** No wrapper: the instance's root is the pill itself, which the preview always sized. */
  it('draws the instance at the drag, label centred', () => {
    const opened = open(PAGE(), BUTTON1('', false))
    const { from } = opened
    expect(opened.scene.graph.getNode(frameOf(ID))).toBeUndefined()
    resize(opened, { ...from, x: from.x - 106, width: 266 }, 'preview', true)
    expect(node(opened, ID).width).toBe(266)
    const label = node(opened, 'button1-1#label')
    expect(label.x + label.width / 2).toBeCloseTo(133, 0)
  })
})

describe('a width typed into the panel for an instance', () => {
  it('draws the pill at each keystroke’s width', () => {
    const opened = open()
    for (const width of [2, 26, 266]) typed(opened, 'width', width, 'preview')
    expect(node(opened, frameOf(ID)).width).toBe(266)
    expect(labelCentre(opened).x).toBeCloseTo(133, 0)
  })

  it('commits the number alone and draws what the echo draws', () => {
    const opened = open()
    for (const width of [2, 26, 266]) typed(opened, 'width', width, 'preview')
    const { patches, rebuilt } = commit(opened, typed(opened, 'width', 266, 'commit'))
    expect(box(patches)).toEqual([['set', 'width', 266]])
    expect(drawn(opened.scene)).toEqual(drawn(rebuilt))
  })

  it('draws a typed height on a stretched instance, which keeps its stretch', () => {
    const id = 'card#b'
    const opened = open(CARD, BUTTON1(), id)
    typed(opened, 'height', 50, 'preview')
    expect(node(opened, frameOf(id))).toMatchObject({ width: 504, height: 50 })
  })
})
