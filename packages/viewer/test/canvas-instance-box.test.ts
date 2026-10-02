import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { enableAutoUnmount, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import {
  applyPatches,
  parseOrThrow,
  resolve,
  type JsonValue,
  type UidxDocument,
  type UidxNode,
  type UidxPatch,
} from '@uidx/format'
import {
  applyChanges,
  buildTokenIndex,
  diffDocuments,
  instanceRole,
  layOutEntity,
  modelIndex,
  resolveTokenValues,
  toSceneGraph,
  TokenResolver,
  type SceneResult,
} from '@uidx/schema'
import { dumpScene, repo } from '../../schema/test/helpers/workspace-scene'
import { hoverNodeFor } from '../src/hover-map'
import { instanceBoxEdit } from '../src/instance-box-edits'
import PaddingField from '../src/PaddingField.vue'
import { collapseBurst } from '../src/patch-burst'
import PropertiesPane from '../src/PropertiesPane.vue'
import PropertyField from '../src/PropertyField.vue'
import type { InstanceScope } from '../src/resize-writes'
import { createWrappedFrame, type InstanceFraming } from '../src/wrapped-frame'

enableAutoUnmount(afterEach)

/**
 * An instance restyled from the panel, on the canvas (ADR 0018 §7).
 *
 * The node that draws a use's outer box is generated: for page1's Button1,
 * which has a styles table, it is the pill one level down, `button1-1#root`,
 * and the instance's own node is a transparent wrapper around it. A scrub
 * written to the instance's node painted that wrapper, a square box behind
 * the pill, and its commit went through the scene and painted it for good.
 *
 * So a scrub is drawn the way a resize is (`createWrappedFrame`): asked of
 * the build's own functions with the instance as the edit would leave the
 * file, and put back before another document lands. The commit is a patch
 * on the `<Instance>`, never a scene write. These drive what `CanvasPane`
 * does for such a prop on each pointer move, on release and when a document
 * lands, and look at the nodes the author is watching — and, last, the same
 * with the real panel sending them, wired as `App.vue` wires it.
 */
const page = (id: string, body: string) =>
  `---\nid: ${id}\n---\n\n## Visual Contract\n\n<Page>\n${body}\n</Page>\n`

/**
 * A collection with a light and a dark mode, which the example's tokens lack:
 * a box value's token resolves in the modes the instance is drawn in.
 */
const TONES = `---\nid: tones\n---\n\n## Visual Contract\n\n<Tokens>
  <Collection name="tone" modes={['light', 'dark']}>
    <Variable name="surface" type="COLOR">
      <Mode name="light" value={{ r: 1, g: 1, b: 1, a: 1 }} />
      <Mode name="dark" value={{ r: 0.071, g: 0.082, b: 0.11, a: 1 }} />
    </Variable>
    <Variable name="text" type="COLOR">
      <Mode name="light" value={{ r: 0.071, g: 0.082, b: 0.11, a: 1 }} />
      <Mode name="dark" value={{ r: 0.973, g: 0.976, b: 0.984, a: 1 }} />
    </Variable>
  </Collection>
</Tokens>\n`

/**
 * The components the uses below place: the design-system example's, named
 * rather than scanned (a scratch page there must not join), and the schema's
 * copy of page1's Button1 beside the shapes the examples lack (Chip lays
 * itself out).
 */
const LIBRARY = [
  ...[
    'examples/design-system/.uidx/tokens.uidx',
    'examples/design-system/.uidx/button.uidx',
    'examples/design-system/.uidx/checkbox.uidx',
    'examples/design-system/.uidx/checkbox-field.uidx',
    'examples/design-system/.uidx/field.uidx',
    'packages/schema/test/fixtures/instance-box/button1.uidx',
    'packages/schema/test/fixtures/instance-box/kinds.uidx',
  ].map((file) => parseOrThrow(readFileSync(join(repo, file), 'utf8'), file)),
  parseOrThrow(TONES, 'tones.uidx'),
]

/** Every token at its first mode, as the shell hands them to the panel and the canvas. */
const LITERALS = resolveTokenValues(LIBRARY)

const BUTTON1_SOURCE = LIBRARY.find((doc) => doc.source.includes('name="Button1"'))!.source

const INSTANCE = `<Instance name="button1-1" component="Button1" x={328} y={360} width={199} height={33} props={{ label: 'Click Me' }} />`

/**
 * page1, with a use of every other shape beside it: Button, a composition, a
 * component that lays itself out, and a use in a slot fill, which is drawn
 * where the definition puts the slot.
 */
const PAGE = page(
  'page1',
  `  ${INSTANCE}
  <Instance name="go" component="Button" x={0} y={0} props={{ label: 'Go' }} />
  <Instance name="cf" component="CheckboxField" x={0} y={100} />
  <Instance name="chip" component="Chip" x={0} y={200} props={{ label: 'Chip' }} />
  <Instance name="p" component="Panel" x={0} y={300}>
    <Slot name="body">
      <Instance name="b" component="Button1" props={{ label: 'Inside' }} />
    </Slot>
  </Instance>
  <Component name="Panel" status="draft" layoutMode="VERTICAL"
    primaryAxisSizingMode="AUTO" counterAxisSizingMode="AUTO">
    <Frame name="frame" layoutMode="VERTICAL" primaryAxisSizingMode="AUTO" counterAxisSizingMode="AUTO">
      <Slot name="body" />
    </Frame>
  </Component>`,
)

/** Button1 defined beside its use, as page1 could hold it: the echo then updates the scene in place. */
const LOCAL = BUTTON1_SOURCE.replace('</Page>', `  ${INSTANCE}\n</Page>`)

/** A use that states its fill already: red. */
const STATED = page(
  'page1',
  `  <Instance name="b" component="Button1" props={{ label: 'Go' }} fills={[{ type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 } }]} />`,
)

/** A use filling a slot its component does not have: in the file, and drawn nowhere. */
const STRAY = page(
  'page1',
  `  <Instance name="p" component="Panel" x={0} y={0}>
    <Slot name="nowhere">
      <Instance name="b" component="Button1" props={{ label: 'Stray' }} />
    </Slot>
  </Instance>
  <Component name="Panel" status="draft" layoutMode="VERTICAL"
    primaryAxisSizingMode="AUTO" counterAxisSizingMode="AUTO">
    <Slot name="body" />
  </Component>`,
)

/**
 * A component that draws its look on a frame inside a frame of its own that
 * only wraps it, with a styles table, as Shoelace's Button draws on `base`:
 * the box goes through to that frame (ADR 0018 §2).
 */
const SHELLED = `${page(
  'page1',
  `  <Instance name="s" component="Shell" x={0} y={0} />
  <Component name="Shell" status="draft"
    layoutMode="HORIZONTAL" primaryAxisSizingMode="AUTO" counterAxisSizingMode="AUTO">
    <Frame name="base" layoutMode="HORIZONTAL" primaryAxisSizingMode="AUTO" counterAxisSizingMode="AUTO"
      paddingLeft={12} fills={[{ type: 'SOLID', color: { r: 0.2, g: 0.2, b: 0.2, a: 1 } }]}>
      <Text name="label" characters="Go" fontSize={14} />
    </Frame>
  </Component>`,
)}
<Styles>
  <Style state="hover" base:fills={[{ type: 'SOLID', color: { r: 0, g: 0.6, b: 0, a: 1 } }]} />
</Styles>
`

/** Button1 hugging its label: a padding change shows as the pill's width. */
const HUG = page(
  'page1',
  `  <Instance name="h" component="Button1" x={0} y={0} props={{ label: 'Click Me' }} />`,
)

const solid = (r: number, g: number, b: number): JsonValue => [
  { type: 'SOLID', color: { r, g, b, a: 1 } },
]
const RED = solid(1, 0, 0)
const GREEN = solid(0, 0.6, 0)
const GREY = solid(0.2, 0.2, 0.2)
const shadow = (radius: number): JsonValue => [
  {
    type: 'DROP_SHADOW',
    color: { r: 0, g: 0, b: 0, a: 0.25 },
    offset: { x: 0, y: 2 },
    radius,
    spread: 0,
    visible: true,
  },
]

/** The colour of a paint list's first paint, rounded to three places. */
const colour = (value: unknown): Record<string, number> | undefined => {
  const color = (Array.isArray(value) ? value[0] : undefined)?.color as
    Record<string, number> | undefined
  if (!color) return undefined
  return Object.fromEntries(
    Object.entries(color).map(([key, entry]) => [key, Math.round(entry * 1000) / 1000]),
  )
}

function componentsOf(docs: readonly UidxDocument[]): Map<string, UidxNode> {
  const out = new Map<string, UidxNode>()
  for (const doc of docs)
    for (const child of doc.tree.children)
      if (child.element === 'Component') out.set(child.name, child)
  return out
}

/** The editor's `updateNode`: the write, then layout for what it moved. */
function update(scene: SceneResult, id: string, fields: Record<string, unknown>): void {
  scene.graph.updateNode(id, fields as never)
  layOutEntity(scene.graph, id.split('#')[0]!, scene.pins)
}

/**
 * The page open on the canvas, with the use at `address` selected. `moved`
 * collects the nodes the wrapped frame wrote, and `held` is the scrub in
 * flight (`CanvasPane`'s `panelPreview`).
 */
function open(source = PAGE, address = 'button1-1') {
  const library = componentsOf(LIBRARY)
  const index = buildTokenIndex(LIBRARY)
  const opened = {
    doc: parseOrThrow(source, 'page1.uidx'),
    address,
    scene: null as unknown as SceneResult,
    scope: null as unknown as InstanceScope,
    held: undefined as { address: string; framing: InstanceFraming } | undefined,
    moved: [] as string[],
    frame: null as unknown as ReturnType<typeof createWrappedFrame>,
  }
  // What `CanvasPane` builds and previews with: the shell's components, the
  // page's own first, and every token with its modes.
  opened.scope = {
    resolveAlias: (at) => LITERALS.get(at),
    resolveComponent: (name) => componentsOf([opened.doc]).get(name) ?? library.get(name),
    tokens: { resolver: new TokenResolver(index), index },
    models: modelIndex(LIBRARY),
  }
  opened.scene = toSceneGraph(opened.doc, opened.scope)
  opened.frame = createWrappedFrame({
    graph: () => opened.scene.graph,
    scope: () => opened.scope,
    saved: (at) => resolve(opened.doc.tree, at),
    tree: () => opened.doc.tree,
    update: (id, props) => {
      opened.moved.push(id)
      update(opened.scene, id, props)
    },
    textTargets: (id) => opened.scene.textTargets.get(id),
  })
  return opened
}

type Opened = ReturnType<typeof open>

/** Where a use is drawn (`drawnId`): its address, or for slot content where the definition puts it. */
const sceneIdOf = (opened: Opened, address = opened.address): string =>
  opened.scene.addresses.sceneIdOf(address) ?? address

/**
 * `CanvasPane.restyleInstance`, which `applyProp` hands a row of an
 * instance's outer box or its text colour, from the panel's `preview` and
 * `commit` alike: the scrub accrues into the framing the wrapped frame draws,
 * and a release draws it, lets the hold and the frame go, and sends the patch
 * — even for a use the canvas does not draw, since the file is what it is for.
 */
function restyle(
  opened: Opened,
  prop: string,
  value: JsonValue,
  mode: 'preview' | 'commit',
  address = opened.address,
): UidxPatch[] {
  const { doc, scene, frame, scope } = opened
  const instance = resolve(doc.tree, address)!
  const id = sceneIdOf(opened, address)
  const drawn = scene.graph.getNode(id) !== undefined
  if (!drawn && mode === 'preview') return []
  const held = opened.held?.address === address ? opened.held.framing : undefined
  const framing: InstanceFraming = {
    size: {},
    removals: [],
    box: { ...held?.box, [prop]: value },
  }
  opened.held = mode === 'preview' ? { address, framing } : undefined
  if (drawn) {
    scene.graph.runPreviewUpdates(() => frame.draw(instance, framing, id))
    if (mode === 'commit') frame.settle()
  }
  if (mode === 'preview') return []
  return instanceBoxEdit(doc, address, prop, value, { scope })?.patches ?? []
}

/**
 * `CanvasPane.render` for a document that lands: the scrub's frame goes back
 * first, so the diff meets the scene the file drew; the change is applied in
 * place, or the page rebuilt when the diff cannot say it; and the scrub still
 * in flight is drawn again over it, or let go if its node went with the
 * change (`reapplyLocalEdits`).
 */
function land(opened: Opened, next: UidxDocument): void {
  opened.frame.release()
  const prev = opened.doc
  // The shell's components are already the new document's when it lands.
  opened.doc = next
  const changes = diffDocuments(prev, next, opened.scope.resolveAlias, opened.scope.tokens)
  if (changes) applyChanges(opened.scene, changes, opened.scope)
  else opened.scene = toSceneGraph(next, opened.scope)
  const held = opened.held
  if (!held) return
  const saved = resolve(next.tree, held.address)
  const id = sceneIdOf(opened, held.address)
  if (saved && opened.scene.graph.getNode(id))
    opened.scene.graph.runPreviewUpdates(() => opened.frame.draw(saved, held.framing, id))
  else opened.held = undefined
}

const patched = (doc: UidxDocument, patches: readonly UidxPatch[]): UidxDocument =>
  parseOrThrow(applyPatches(doc.source, [...patches]).source, 'page1.uidx')

/** The page as a fresh build of `doc` draws it. */
const rebuilt = (opened: Opened, doc: UidxDocument): ReturnType<typeof dumpScene> =>
  dumpScene(toSceneGraph(doc, opened.scope))

const node = (opened: Opened, id: string) => opened.scene.graph.getNode(id)!

describe('scrubbing the outer box of an instance whose component wraps a frame', () => {
  it('draws the fill on the pill, button1-1#root, and leaves the wrapper alone', () => {
    const opened = open()
    const wrapper = { ...node(opened, 'button1-1') }
    restyle(opened, 'fills', RED, 'preview')
    expect(opened.moved).toEqual(['button1-1#root'])
    expect(colour(node(opened, 'button1-1#root').fills)).toEqual({ r: 1, g: 0, b: 0, a: 1 })
    const after = node(opened, 'button1-1')
    for (const field of ['fills', 'strokes', 'effects', 'opacity', 'paddingLeft'] as const)
      expect(after[field], field).toEqual(wrapper[field])
  })

  it('previews each step from the last, so a value scrubbed back is drawn back', () => {
    const opened = open()
    const before = dumpScene(opened.scene)
    restyle(opened, 'paddingLeft', 40, 'preview')
    expect(node(opened, 'button1-1#root').paddingLeft).toBe(40)
    restyle(opened, 'paddingLeft', 12, 'preview')
    expect(dumpScene(opened.scene)).toEqual(before)
  })

  it('accrues the sides a compound control scrubs together, and commits each', () => {
    const opened = open()
    restyle(opened, 'paddingLeft', 30, 'preview')
    restyle(opened, 'paddingRight', 30, 'preview')
    expect(node(opened, 'button1-1#root')).toMatchObject({ paddingLeft: 30, paddingRight: 30 })
    const patches = [
      ...restyle(opened, 'paddingLeft', 30, 'commit'),
      ...restyle(opened, 'paddingRight', 30, 'commit'),
    ]
    expect(patches).toEqual([
      { op: 'add', address: 'button1-1', prop: 'paddingLeft', value: 30 },
      { op: 'add', address: 'button1-1', prop: 'paddingRight', value: 30 },
    ])
    expect(dumpScene(opened.scene)).toEqual(rebuilt(opened, patched(opened.doc, patches)))
  })

  it('lets a scrub on one instance go when another is scrubbed', () => {
    const opened = open()
    const before = dumpScene(opened.scene)
    const pill = (dump: ReturnType<typeof dumpScene>) =>
      dump.filter((entry) => entry.id.startsWith('button1-1'))
    restyle(opened, 'fills', RED, 'preview')
    restyle(opened, 'fills', GREEN, 'preview', 'go')
    expect(pill(dumpScene(opened.scene))).toEqual(pill(before))
    expect(colour(node(opened, 'go#root').fills)).toEqual({ r: 0, g: 0.6, b: 0, a: 1 })
  })

  it('draws nothing for a binding, which the box does not take', () => {
    const opened = open()
    const before = dumpScene(opened.scene)
    restyle(opened, 'fills', '{label}', 'preview')
    expect(opened.moved).toEqual([])
    expect(dumpScene(opened.scene)).toEqual(before)
  })

  it.each([
    ['button1-1', 'fills', GREEN, RED],
    ['button1-1', 'fills', GREEN, '{surface#danger}'],
    ['button1-1', 'paddingLeft', 20, 40],
    ['button1-1', 'cornerRadius', 8, 4],
    ['button1-1', 'opacity', 0.8, 0.5],
    ['button1-1', 'effects', shadow(8), shadow(4)],
    ['go', 'strokeWeight', 2, 3],
    ['go', 'strokes', GREEN, GREY],
  ] as const)(
    '%s: a %s scrub ends, at release, as a rebuild of the patched file draws it',
    (address, prop, step, value) => {
      const opened = open(PAGE, address)
      restyle(opened, prop, step, 'preview')
      restyle(opened, prop, value, 'preview')
      const patches = restyle(opened, prop, value, 'commit')
      expect(patches).toEqual([{ op: 'add', address, prop, value }])
      expect(dumpScene(opened.scene)).toEqual(rebuilt(opened, patched(opened.doc, patches)))
    },
  )

  it('commits a patch on the <Instance> and writes nothing to the scene', () => {
    const opened = open()
    const written: string[] = []
    opened.scene.graph.emitter.on('node:updated', (id: string) => written.push(id))
    restyle(opened, 'fills', GREEN, 'preview')
    restyle(opened, 'textFills', GREEN, 'preview')
    const patches = [
      ...restyle(opened, 'fills', RED, 'commit'),
      ...restyle(opened, 'textFills', RED, 'commit'),
    ]
    expect(patches).toEqual([
      { op: 'add', address: 'button1-1', prop: 'fills', value: RED },
      { op: 'add', address: 'button1-1', prop: 'textFills', value: RED },
    ])
    // A scene write is what `CanvasPane` turns into patches (`recordSceneWrite`).
    expect(written).toEqual([])
    // And nothing is left drawn away from the file for a document to put back.
    const moved = opened.moved.length
    opened.frame.release()
    expect(opened.moved.length).toBe(moved)
  })

  it('rewrites a value the use states with a set', () => {
    const opened = open(STATED, 'b')
    expect(restyle(opened, 'fills', GREEN, 'commit')).toEqual([
      { op: 'set', address: 'b', prop: 'fills', value: GREEN },
    ])
  })

  it('lets the scrub go at release, even when the file already says the value', () => {
    const opened = open(STATED, 'b')
    restyle(opened, 'fills', GREEN, 'preview')
    expect(restyle(opened, 'fills', RED, 'commit')).toEqual([])
    expect(opened.held).toBeUndefined()
    expect(dumpScene(opened.scene)).toEqual(rebuilt(opened, opened.doc))
  })

  it('writes a release on a use the canvas does not draw, and holds nothing for it', () => {
    // Content for a slot its component does not have is in the file, not on the canvas.
    const opened = open(STRAY, 'p#nowhere/b')
    expect(opened.scene.graph.getNode(sceneIdOf(opened))).toBeUndefined()
    restyle(opened, 'fills', GREEN, 'preview')
    expect(opened.held).toBeUndefined()
    expect(restyle(opened, 'fills', RED, 'commit')).toEqual([
      { op: 'add', address: 'p#nowhere/b', prop: 'fills', value: RED },
    ])
  })

  it('agrees with a rebuild when the echo updates the scene in place', () => {
    const opened = open(LOCAL)
    restyle(opened, 'fills', GREEN, 'preview')
    const patches = restyle(opened, 'fills', RED, 'commit')
    const next = patched(opened.doc, patches)
    const changes = diffDocuments(opened.doc, next, opened.scope.resolveAlias, opened.scope.tokens)
    expect(changes?.map((change) => change.kind)).toEqual(['update-instance-root'])
    land(opened, next)
    expect(dumpScene(opened.scene)).toEqual(rebuilt(opened, next))
  })

  it('puts the pill back when another document lands mid-scrub, and draws the scrub over it', () => {
    const opened = open(LOCAL)
    const before = node(opened, 'button1-1#root').fills
    restyle(opened, 'fills', RED, 'preview')
    restyle(opened, 'paddingLeft', 40, 'preview')
    // `render` lets the frame go before the diff…
    opened.frame.release()
    expect(node(opened, 'button1-1#root').fills).toEqual(before)
    expect(node(opened, 'button1-1#root').paddingLeft).toBe(12)
    // …and `reapplyLocalEdits` draws the scrub again over the new document.
    const moved = parseOrThrow(opened.doc.source.replace('x={328}', 'x={300}'), 'page1.uidx')
    land(opened, moved)
    const expected = patched(moved, [
      { op: 'add', address: 'button1-1', prop: 'fills', value: RED },
      { op: 'add', address: 'button1-1', prop: 'paddingLeft', value: 40 },
    ])
    expect(dumpScene(opened.scene)).toEqual(rebuilt(opened, expected))
  })
})

describe('scrubbing an instance’s text colour', () => {
  it('draws it on exactly the texts the use’s colour reaches', () => {
    const opened = open(PAGE, 'cf')
    const targets = opened.scene.textTargets.get('cf')!
    expect(targets.length).toBeGreaterThan(1)
    restyle(opened, 'textFills', RED, 'preview')
    expect(opened.moved).toEqual(targets)
    for (const id of targets)
      expect(colour(node(opened, id).fills), id).toEqual({ r: 1, g: 0, b: 0, a: 1 })
  })

  it('ends, at release, as a rebuild of the patched file draws it', () => {
    const opened = open(PAGE, 'cf')
    restyle(opened, 'textFills', GREEN, 'preview')
    const patches = restyle(opened, 'textFills', '{text#danger}', 'commit')
    expect(patches).toEqual([
      { op: 'add', address: 'cf', prop: 'textFills', value: '{text#danger}' },
    ])
    expect(dumpScene(opened.scene)).toEqual(rebuilt(opened, patched(opened.doc, patches)))
  })

  it('puts the texts back when another document lands mid-scrub', () => {
    const opened = open()
    const before = dumpScene(opened.scene)
    restyle(opened, 'textFills', RED, 'preview')
    expect(colour(node(opened, 'button1-1#root/label').fills)).toEqual({ r: 1, g: 0, b: 0, a: 1 })
    opened.frame.release()
    expect(dumpScene(opened.scene)).toEqual(before)
  })
})

describe('the other shapes a component takes', () => {
  it('a composition: draws the box on the frame of the instance it holds', () => {
    const opened = open(PAGE, 'cf')
    restyle(opened, 'fills', RED, 'preview')
    expect(opened.moved).toEqual(['cf#field/root'])
    const patches = restyle(opened, 'fills', RED, 'commit')
    expect(dumpScene(opened.scene)).toEqual(rebuilt(opened, patched(opened.doc, patches)))
  })

  it('a component that lays itself out: draws on the instance itself, still never as a write', () => {
    const opened = open(PAGE, 'chip')
    const written: string[] = []
    opened.scene.graph.emitter.on('node:updated', (id: string) => written.push(id))
    restyle(opened, 'fills', RED, 'preview')
    expect(opened.moved).toEqual(['chip'])
    expect(colour(node(opened, 'chip').fills)).toEqual({ r: 1, g: 0, b: 0, a: 1 })
    const patches = restyle(opened, 'fills', RED, 'commit')
    expect(written).toEqual([])
    expect(dumpScene(opened.scene)).toEqual(rebuilt(opened, patched(opened.doc, patches)))
  })

  it('a component that draws its look inside a frame that only wraps it: draws on that frame', () => {
    const opened = open(SHELLED, 's')
    restyle(opened, 'fills', RED, 'preview')
    restyle(opened, 'paddingLeft', 30, 'preview')
    expect([...new Set(opened.moved)]).toEqual(['s#root/base'])
    expect(colour(node(opened, 's#root/base').fills)).toEqual({ r: 1, g: 0, b: 0, a: 1 })
    expect(node(opened, 's#root/base').paddingLeft).toBe(30)
    for (const id of ['s', 's#root']) expect(node(opened, id).fills, id).toEqual([])
    const patches = [
      ...restyle(opened, 'fills', RED, 'commit'),
      ...restyle(opened, 'paddingLeft', 30, 'commit'),
    ]
    expect(patches).toEqual([
      { op: 'add', address: 's', prop: 'fills', value: RED },
      { op: 'add', address: 's', prop: 'paddingLeft', value: 30 },
    ])
    expect(dumpScene(opened.scene)).toEqual(rebuilt(opened, patched(opened.doc, patches)))
  })

  it('a use inside a slot fill: patched at its address, drawn where the definition puts it', () => {
    const opened = open(PAGE, 'p#body/b')
    expect(sceneIdOf(opened)).toBe('p#frame/body/b')
    restyle(opened, 'fills', RED, 'preview')
    expect(opened.moved).toEqual(['p#frame/body/b/root'])
    const patches = restyle(opened, 'fills', RED, 'commit')
    expect(patches).toEqual([{ op: 'add', address: 'p#body/b', prop: 'fills', value: RED }])
    expect(dumpScene(opened.scene)).toEqual(rebuilt(opened, patched(opened.doc, patches)))
  })
})

describe('hovering a row of an instance’s panel', () => {
  const at = (opened: Opened, prop: string): string =>
    hoverNodeFor(prop, sceneIdOf(opened), resolve(opened.doc.tree, opened.address), opened.scope)

  it('lights the pill for a padding or corner row, not the wrapper around it', () => {
    const opened = open()
    expect(at(opened, 'paddingLeft')).toBe('button1-1#root')
    expect(at(opened, 'topLeftRadius')).toBe('button1-1#root')
    // Where the use sits and how big it is are its own node's.
    expect(at(opened, 'width')).toBe('button1-1')
    expect(at(opened, 'x')).toBe('button1-1')
  })

  it('lights the frame a composition’s instance draws, and the instance of a component that lays itself out', () => {
    expect(at(open(PAGE, 'cf'), 'paddingLeft')).toBe('cf#field/root')
    expect(at(open(PAGE, 'chip'), 'paddingLeft')).toBe('chip')
    expect(at(open(PAGE, 'p#body/b'), 'paddingTop')).toBe('p#frame/body/b/root')
    expect(at(open(SHELLED, 's'), 'paddingLeft')).toBe('s#root/base')
  })

  it('lights the node itself for anything that is not an instance', () => {
    const opened = open(PAGE, 'p')
    const frame = resolve(opened.doc.tree, 'Panel#frame')!
    expect(hoverNodeFor('paddingLeft', 'Panel#frame', frame, opened.scope)).toBe('Panel#frame')
    expect(hoverNodeFor('paddingLeft', 'button1-1', null, opened.scope)).toBe('button1-1')
  })
})

describe('a token on the box, scrubbed where the instance is drawn', () => {
  // ADR 0018 §5: a box value's token resolves in the consuming scope, the
  // instance's own `modes` included, as the build and the echo resolve it.
  // A scrub resolved in the first mode drew white, then the echo drew dark.
  it.each([
    [
      'its own modes',
      `  <Instance name="u" component="Button1" modes={{ tone: 'dark' }} props={{ label: 'Go' }} />`,
      'u',
    ],
    [
      'an enclosing frame’s modes',
      `  <Frame name="f" modes={{ tone: 'dark' }} width={300} height={100}>
    <Instance name="u" component="Button1" props={{ label: 'Go' }} />
  </Frame>`,
      'f#u',
    ],
  ])('draws in %s, as the file will draw it', (_, body, address) => {
    const opened = open(page('page1', body), address)
    restyle(opened, 'fills', '{tone#surface}', 'preview')
    restyle(opened, 'textFills', '{tone#text}', 'preview')
    const next = patched(opened.doc, [
      { op: 'add', address, prop: 'fills', value: '{tone#surface}' },
      { op: 'add', address, prop: 'textFills', value: '{tone#text}' },
    ])
    const box = `${address}${address.includes('#') ? '/' : '#'}root`
    expect(colour(node(opened, box).fills)).toEqual({ r: 0.071, g: 0.082, b: 0.11, a: 1 })
    expect(dumpScene(opened.scene)).toEqual(rebuilt(opened, next))
  })
})

/**
 * The panel and the canvas wired as `App.vue` wires them: a scrub's `preview`
 * and its `commit` go to the canvas (`applyProp`, which hands a row of an
 * instance's outer box to `restyle`), and `patches` go to the file. What the
 * canvas writes in one tick travels as one envelope, as its burst does.
 * `send` applies each envelope and lands the file that comes back, on the
 * canvas and in the panel.
 */
function shell(opened: Opened) {
  const envelopes: UidxPatch[][] = []
  let burst: UidxPatch[] = []
  const applyProp = (
    address: string,
    prop: string,
    value: JsonValue,
    mode: 'preview' | 'commit',
  ) => {
    // The only rows scrubbed here, and the ones `applyProp` hands an instance's restyle.
    expect(['box', 'cascade']).toContain(instanceRole(prop))
    burst.push(...restyle(opened, prop, value, mode, address))
  }
  const components = componentsOf([...LIBRARY, opened.doc])
  const wrapper = mount(PropertiesPane, {
    props: {
      doc: opened.doc,
      selection: [opened.address],
      tokens: LITERALS,
      components,
      writable: true,
      onPreview: (address: string, prop: string, value: JsonValue) =>
        applyProp(address, prop, value, 'preview'),
      onCommit: (address: string, prop: string, value: JsonValue) =>
        applyProp(address, prop, value, 'commit'),
      onPatches: (patches: UidxPatch[]) => envelopes.push(patches),
    },
  })
  /** A document landing, from the file: the canvas draws it, and the panel reads it. */
  const arrive = async (next: UidxDocument): Promise<void> => {
    land(opened, next)
    await wrapper.setProps({ doc: next })
  }
  const send = async (): Promise<void> => {
    if (burst.length) envelopes.push(collapseBurst(burst))
    burst = []
    for (const patches of envelopes.splice(0)) await arrive(patched(opened.doc, patches))
  }
  return { wrapper, send, arrive }
}

describe('a scrub released from the panel, then handed back', () => {
  const stated = (opened: Opened, prop: string) =>
    resolve(opened.doc.tree, opened.address)!.attrs[prop]

  /** Scrubs both sides of the padding axis in the panel to 34, and lets go. */
  function scrubPadding(wrapper: ReturnType<typeof shell>['wrapper']): void {
    const padding = wrapper.getComponent(PaddingField)
    for (const value of [20, 28, 34])
      padding.vm.$emit('preview', [
        { prop: 'paddingLeft', value },
        { prop: 'paddingRight', value },
      ])
    padding.vm.$emit('commit', [
      { prop: 'paddingLeft', value: 34 },
      { prop: 'paddingRight', value: 34 },
    ])
  }

  /** The pill grew with the scrub, and the file and the canvas agree on it. */
  async function released(opened: Opened, send: () => Promise<void>, own: number): Promise<void> {
    await send()
    expect(stated(opened, 'paddingLeft')?.value).toBe(34)
    expect(opened.held).toBeUndefined()
    expect(node(opened, 'h#root').width).toBe(own + 44)
    expect(dumpScene(opened.scene)).toEqual(rebuilt(opened, opened.doc))
  }

  it('↺ on Padding draws the pill at its own width again', async () => {
    const opened = open(HUG, 'h')
    const before = dumpScene(opened.scene)
    const own = node(opened, 'h#root').width
    const { wrapper, send } = shell(opened)
    scrubPadding(wrapper)
    await released(opened, send, own)
    await wrapper.get('[data-field="instance-padding"] button.reset').trigger('click')
    await send()
    expect(stated(opened, 'paddingLeft')).toBeUndefined()
    expect(dumpScene(opened.scene)).toEqual(before)
  })

  it('Reset all draws it so', async () => {
    const opened = open(HUG, 'h')
    const before = dumpScene(opened.scene)
    const own = node(opened, 'h#root').width
    const { wrapper, send } = shell(opened)
    scrubPadding(wrapper)
    await released(opened, send, own)
    await wrapper.get('[data-field="overrides"] button.reset-all').trigger('click')
    await send()
    expect(stated(opened, 'paddingRight')).toBeUndefined()
    expect(dumpScene(opened.scene)).toEqual(before)
  })

  it('undo draws it so', async () => {
    const opened = open(HUG, 'h')
    const before = dumpScene(opened.scene)
    const own = node(opened, 'h#root').width
    const original = opened.doc.source
    const { wrapper, send, arrive } = shell(opened)
    scrubPadding(wrapper)
    await released(opened, send, own)
    // Undo writes the inverse, and the file comes back as it was.
    await arrive(parseOrThrow(original, 'page1.uidx'))
    expect(dumpScene(opened.scene)).toEqual(before)
  })

  it('↺ on Fill draws the component’s blue again', async () => {
    const opened = open(HUG, 'h')
    const before = dumpScene(opened.scene)
    const { wrapper, send } = shell(opened)
    const fill = wrapper
      .findAllComponents(PropertyField)
      .find((f) => f.props('field').name === 'fills')!
    fill.vm.$emit('preview', 'fills', GREEN)
    fill.vm.$emit('preview', 'fills', RED)
    fill.vm.$emit('commit', 'fills', RED)
    await send()
    expect(stated(opened, 'fills')?.value).toEqual(RED)
    expect(opened.held).toBeUndefined()
    expect(colour(node(opened, 'h#root').fills)).toEqual({ r: 1, g: 0, b: 0, a: 1 })
    await wrapper.get('.section[aria-label="Fill"] .section-head button.reset').trigger('click')
    await send()
    expect(stated(opened, 'fills')).toBeUndefined()
    expect(dumpScene(opened.scene)).toEqual(before)
  })
})
