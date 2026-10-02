import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  applyPatches,
  parse,
  parseOrThrow,
  resolve,
  type JsonValue,
  type UidxDocument,
  type UidxNode,
  type UidxNodeSpec,
} from '@uidx/format'
import { toSceneGraph, type SceneResult } from '@uidx/schema'

import {
  buildPage,
  dumpScene,
  repo,
  type DumpedNode,
} from '../../schema/test/helpers/workspace-scene'
import { detachInstance } from '../src/detach'

/**
 * Detaching an instance restyled from outside (ADR 0018 §6): the copy is
 * plain layers that look the way the instance did. Its outer box goes onto
 * the node that drew it, beneath anything a state row set; its text colour
 * becomes the fills of each text it reached; the size it fixed goes with the
 * box; and its locked attributes, which never drew, are left behind.
 */

/** A one-paint solid list, as the file spells it and as it parses. */
const solid = (r: number, g: number, b: number) => ({
  source: `[{ type: 'SOLID', color: { r: ${r}, g: ${g}, b: ${b}, a: 1 } }]`,
  value: [{ type: 'SOLID', color: { r, g, b, a: 1 } }],
})
const BLUE = solid(0, 0.3333, 1)
const LIGHT_BLUE = solid(0.3678, 0.5744, 0.9875)
const RED = solid(1, 0, 0)
const GREEN = solid(0, 0.6, 0)
const GREY = solid(0.6, 0.6, 0.6)
const DARK = solid(0.2, 0.2, 0.2)
const WHITE = solid(1, 1, 1)

/**
 * A copy of the pill button on examples/design-system's page1: a styles
 * table, so the box a use styles is the derived `root` one level down.
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
    fills={${BLUE.source}}>
    <Text name="label" characters="{label}" fontSize={14} />
  </Component>
</Page>

<Styles>
  <Style state="hover" root:fills={${LIGHT_BLUE.source}} />
</Styles>

## Contract

<Props>
  <Prop name="label" type="string" sample="Button1">The words it shows.</Prop>
</Props>
`

/**
 * A state row that colours a text and dims the frame, and a frame with a
 * stroke weight, side weights and corner radii for a use to keep or replace.
 */
const TOGGLE = `---
id: toggle
---

## Visual Contract

<Page>
  <Component name="Toggle" status="draft"
    layoutMode="HORIZONTAL" primaryAxisSizingMode="AUTO" counterAxisSizingMode="AUTO"
    paddingLeft={8} paddingRight={8} fills={${BLUE.source}}
    strokes={${DARK.source}} strokeWeight={3} strokeBottomWeight={2}
    topLeftRadius={8} bottomRightRadius={8}>
    <Text name="label" characters="{label}" fontSize={14} fills={${DARK.source}} />
  </Component>
</Page>

<Styles>
  <Style state="disabled" label:fills={${GREY.source}} root:opacity={0.5} />
</Styles>

## Contract

<Props>
  <Prop name="label" type="string" sample="Toggle">The words it shows.</Prop>
  <Prop name="disabled" type="boolean" default={false} visual>Inert and dimmed.</Prop>
</Props>
`

/**
 * One component of each other shape (ADR 0018 §2): Tag only wraps a frame,
 * Card and Field lay themselves out, and BoxField composes one Field.
 */
const KINDS = `---
id: kinds
---

## Visual Contract

<Page>
  <Component name="Tag" status="draft">
    <Frame name="box" layoutMode="HORIZONTAL" primaryAxisSizingMode="AUTO" counterAxisSizingMode="AUTO"
      paddingLeft={6} paddingRight={6} cornerRadius={4} fills={${WHITE.source}}>
      <Text name="label" characters="{label}" fontSize={12} fills={${DARK.source}} />
    </Frame>
  </Component>
  <Component name="Card" status="draft"
    layoutMode="VERTICAL" primaryAxisSizingMode="AUTO" counterAxisSizingMode="AUTO" itemSpacing={8}>
    <Text name="title" characters="{label}" fontSize={16} fills={${DARK.source}} />
    <Vector name="mark" width={6} height={6} fills={${BLUE.source}}
      vectorPaths={[{ windingRule: 'NONZERO', data: 'M3 0 L6 3 L3 6 L0 3 Z' }]} />
    <Instance name="action" component="Button1" props={{ label: 'Go' }} />
    <Instance name="stop" component="Button1" props={{ label: 'Stop' }} textFills={${WHITE.source}} />
    <Slot name="footer">
      <Text name="hint" characters="Hint" fontSize={12} />
    </Slot>
  </Component>
  <Component name="Field" status="draft"
    layoutMode="HORIZONTAL" primaryAxisSizingMode="AUTO" counterAxisSizingMode="AUTO" itemSpacing={8}>
    <Slot name="control" />
    <Text name="label" characters="{label}" fontSize={14} fills={${DARK.source}} />
  </Component>
  <Component name="Box" status="draft" width={20} height={20} cornerRadius={4} fills={${WHITE.source}} />
  <Component name="BoxField" status="draft">
    <Instance name="field" component="Field" props={{ label: '{label}' }}
      fills={${GREY.source}} textFills={${GREEN.source}}>
      <Slot name="control">
        <Instance name="box" component="Box" />
      </Slot>
    </Instance>
  </Component>
</Page>

## Contract

<Props>
  <Prop name="label" type="string" sample="Label">The words it shows.</Prop>
</Props>
`

/**
 * The Shoelace example's shape: the look on a frame inside a frame of the
 * component's own that only wraps it, so the box goes through to it (ADR
 * 0018 §2), and a state row that dims the wrapper.
 */
const SHELL = `---
id: shell
---

## Visual Contract

<Page>
  <Component name="Shell" status="draft"
    layoutMode="HORIZONTAL" primaryAxisSizingMode="AUTO" counterAxisSizingMode="AUTO">
    <Frame name="base" layoutMode="HORIZONTAL" primaryAxisSizingMode="AUTO" counterAxisSizingMode="AUTO"
      paddingLeft={12} paddingRight={12} cornerRadius={6} fills={${DARK.source}}>
      <Text name="label" characters="{label}" fontSize={14} fills={${WHITE.source}} />
    </Frame>
  </Component>
</Page>

<Styles>
  <Style state="disabled" root:opacity={0.45} />
</Styles>

## Contract

<Props>
  <Prop name="label" type="string" sample="Shell">The words it shows.</Prop>
  <Prop name="disabled" type="boolean" default={false} visual>Inert and dimmed.</Prop>
</Props>
`

const HOME = `---
id: home
---

## Visual Contract

<Page>
  <Instance name="styled" component="Button1" x={10} y={20} props={{ label: 'Delete' }}
    fills="{surface#danger}" strokes={${DARK.source}} strokeWeight={2} cornerRadius={4}
    paddingLeft={24} opacity={0.8} textFills="{text#onAccent}" />
  <Instance name="hovered" component="Button1" y={60} props={{ label: 'Hover', state: 'hover' }}
    fills={${RED.source}} />
  <Instance name="locked" component="Button1" y={100}
    layoutMode="VERTICAL" itemSpacing={4} clipsContent={true} fontSize={20} strokeCap="ROUND" />
  <Instance name="bound" component="Button1" y={140}
    fills="{label}" paddingLeft="{label}" textFills="{label}" />
  <Instance name="sized" component="Button1" y={180} width={199} height={33} fills={${RED.source}} />
  <Instance name="keyed" component="Button1" y={220} textFills={${RED.source}}
    overrides={{ 'root/label': { fills: ${GREEN.source} } }} />
  <Instance name="stroked" component="Toggle" y={260} strokes={${RED.source}} />
  <Instance name="squared" component="Toggle" y={300} cornerRadius={2} strokeWeight={1} />
  <Instance name="enabled" component="Toggle" y={340} textFills={${RED.source}} opacity={0.8} />
  <Instance name="disabled" component="Toggle" y={380} props={{ disabled: true }}
    textFills={${RED.source}} opacity={0.8} />
  <Instance name="tag" component="Tag" y={420} width={120} fills={${RED.source}} paddingLeft={20}
    textFills={${GREEN.source}} />
  <Instance name="card" component="Card" y={460} fills={${WHITE.source}} textFills={${RED.source}}
    overrides={{ title: { fills: ${GREEN.source} }, mark: { opacity: 0.5 } }} />
  <Instance name="filled" component="Card" y={640} textFills={${RED.source}}>
    <Slot name="footer">
      <Text name="note" characters="Inherits" fontSize={12} />
      <Text name="own" characters="Keeps its own" fontSize={12} fills={${GREY.source}} />
      <Frame name="row" layoutMode="HORIZONTAL">
        <Text name="deep" characters="Inherits too" fontSize={12} />
      </Frame>
      <Instance name="plain" component="Tag" />
      <Instance name="mine" component="Tag" textFills={${BLUE.source}} />
    </Slot>
  </Instance>
  <Instance name="composed" component="BoxField" y={820} width={300}
    fills={${RED.source}} paddingLeft={16} textFills={${BLUE.source}} />
  <Instance name="quiet" component="BoxField" y={880} />
  <Frame name="column" y={940} width={400} layoutMode="VERTICAL" primaryAxisSizingMode="AUTO" counterAxisSizingMode="FIXED">
    <Instance name="stretched" component="Button1" layoutAlign="STRETCH" width={199} />
  </Frame>
  <Instance name="shelled" component="Shell" x={10} y={1000} props={{ label: 'Go' }}
    fills={${RED.source}} paddingLeft={30} width={199} textFills={${GREEN.source}} />
  <Instance name="dimmed" component="Shell" y={1040} props={{ label: 'Off', disabled: true }}
    fills={${RED.source}} opacity={0.8} />
</Page>
`

const pages = new Map<string, UidxDocument>([
  ['button1.uidx', parseOrThrow(BUTTON1)],
  ['toggle.uidx', parseOrThrow(TOGGLE)],
  ['kinds.uidx', parseOrThrow(KINDS)],
  ['shell.uidx', parseOrThrow(SHELL)],
  ['home.uidx', parseOrThrow(HOME)],
])
const home = pages.get('home.uidx')!

/** `address` on the home page detached: the page re-parsed, the copy, and what the parser said. */
function detached(address: string) {
  const plan = detachInstance(pages, home, address)
  if (!plan) throw new Error(`nothing to detach at "${address}"`)
  // `applyPatches` refuses a patch that would leave the file invalid, which
  // is what a `textFills` written on a frame did (UIDX114).
  const result = parse(applyPatches(HOME, plan.patches).source)
  if (!result.doc) throw new Error(result.diagnostics.map((d) => d.message).join('; '))
  const copy = resolve(result.doc.tree, address)!
  return { next: result.doc, copy, diagnostics: result.diagnostics, plan }
}

/** A node's attributes, as values. */
const valuesOf = (node: UidxNode): Record<string, JsonValue> =>
  Object.fromEntries(Object.entries(node.attrs).map(([key, attr]) => [key, attr.value]))

/** The attributes of the node at `address`, as values. */
const at = (doc: UidxDocument, address: string): Record<string, JsonValue> => {
  const node = resolve(doc.tree, address)
  if (!node) throw new Error(`no node at "${address}"`)
  return valuesOf(node)
}

const components = new Map<string, UidxNode>()
for (const doc of pages.values())
  for (const node of doc.tree.children)
    if (node.element === 'Component') components.set(node.name, node)

const sceneOf = (doc: UidxDocument): SceneResult =>
  toSceneGraph(doc, { resolveComponent: (name) => components.get(name) })

describe('detaching an instance with an outer box', () => {
  it('puts the box on the frame that draws it, and where it sits on the copy', () => {
    const { copy, next, diagnostics } = detached('styled')
    // Button1's styles table wraps its pill in a variant: the copy is the pill.
    expect(copy.element).toBe('Frame')
    expect(valuesOf(copy)).toMatchObject({
      x: 10,
      y: 20,
      layoutMode: 'HORIZONTAL',
      fills: '{surface#danger}',
      strokes: DARK.value,
      strokeWeight: 2,
      cornerRadius: 4,
      opacity: 0.8,
      paddingLeft: 24,
      paddingRight: 12,
      paddingTop: 8,
      paddingBottom: 8,
    })
    for (const gone of ['component', 'props', 'textFills']) expect(copy.attrs[gone]).toBeUndefined()
    expect(at(next, 'styled#label')).toMatchObject({
      characters: 'Delete',
      fills: '{text#onAccent}',
    })
    expect(diagnostics.map((d) => d.code)).not.toContain('UIDX114')
  })

  it('leaves the wrapper of a frame-wrapping component unpainted', () => {
    const { copy, next } = detached('tag')
    for (const prop of ['fills', 'paddingLeft', 'textFills'])
      expect(copy.attrs[prop]).toBeUndefined()
    expect(valuesOf(copy)).toMatchObject({ y: 420 })
    expect(at(next, 'tag#box')).toMatchObject({
      fills: RED.value,
      paddingLeft: 20,
      paddingRight: 6,
      cornerRadius: 4,
    })
    expect(at(next, 'tag#box/label').fills).toEqual(GREEN.value)
  })

  it('keeps what a state row set over the value the use states', () => {
    // The hover row's fill sits above the use's (ADR 0018 §3); at rest the use's would show.
    const { copy } = detached('hovered')
    expect(copy.attrs.fills!.value).toEqual(LIGHT_BLUE.value)
    expect(copy.attrs.state).toBeUndefined()

    const dimmed = detached('disabled')
    expect(dimmed.copy.attrs.opacity!.value).toBe(0.5)
    expect(at(dimmed.next, 'disabled#label').fills).toEqual(GREY.value)

    const enabled = detached('enabled')
    expect(enabled.copy.attrs.opacity!.value).toBe(0.8)
    expect(at(enabled.next, 'enabled#label').fills).toEqual(RED.value)
  })

  it('merges the box one attribute at a time', () => {
    // Strokes alone keep the component's weights.
    const stroked = detached('stroked').copy
    expect(valuesOf(stroked)).toMatchObject({
      strokes: RED.value,
      strokeWeight: 3,
      strokeBottomWeight: 2,
    })
    // A shorthand replaces its longhands, as in CSS (ADR 0018 §5).
    const squared = detached('squared').copy
    expect(valuesOf(squared)).toMatchObject({
      cornerRadius: 2,
      strokeWeight: 1,
      strokes: DARK.value,
    })
    for (const longhand of ['topLeftRadius', 'bottomRightRadius', 'strokeBottomWeight'])
      expect(squared.attrs[longhand]).toBeUndefined()
  })

  it('leaves behind what an instance may not style', () => {
    const locked = detached('locked').copy
    expect(locked.attrs.layoutMode!.value).toBe('HORIZONTAL')
    for (const gone of ['itemSpacing', 'clipsContent', 'fontSize', 'strokeCap'])
      expect(locked.attrs[gone]).toBeUndefined()

    // A binding draws nothing on an instance, so the component's own value shows.
    const { copy, next } = detached('bound')
    expect(valuesOf(copy)).toMatchObject({ fills: BLUE.value, paddingLeft: 12 })
    expect(at(next, 'bound#label').fills).toBeUndefined()
  })
})

describe('detaching an instance whose box is found through a wrapper', () => {
  it('copies the wrapper bare and puts the box and size on the frame inside', () => {
    const { copy, next, diagnostics } = detached('shelled')
    expect(copy.element).toBe('Frame')
    expect(valuesOf(copy)).toMatchObject({ x: 10, y: 1000, layoutMode: 'HORIZONTAL' })
    for (const gone of ['fills', 'paddingLeft', 'textFills', 'component'])
      expect(copy.attrs[gone], gone).toBeUndefined()
    expect(at(next, 'shelled#base')).toMatchObject({
      fills: RED.value,
      paddingLeft: 30,
      paddingRight: 12,
      cornerRadius: 6,
      width: 199,
      primaryAxisSizingMode: 'FIXED',
    })
    expect(at(next, 'shelled#base/label').fills).toEqual(GREEN.value)
    expect(diagnostics.map((d) => d.code)).not.toContain('UIDX114')
  })

  it('keeps what a state row set on the wrapper, and the use’s box inside it', () => {
    const { copy, next } = detached('dimmed')
    expect(copy.attrs.opacity!.value).toBe(0.45)
    expect(at(next, 'dimmed#base')).toMatchObject({ fills: RED.value, opacity: 0.8 })
  })

  it('draws as the instance did', () => {
    const before = sceneOf(home).graph
    const after = sceneOf(detached('shelled').next).graph
    const base = after.getNode('shelled#base')!
    const drawn = before.getNode('shelled#root/base')!
    expect(base.fills).toEqual(drawn.fills)
    expect([base.width, base.height, base.paddingLeft]).toEqual([
      drawn.width,
      drawn.height,
      drawn.paddingLeft,
    ])
    expect(after.getNode('shelled')!.width).toBe(before.getNode('shelled#root')!.width)
  })
})

describe('the text colour of a detached instance', () => {
  it('becomes the fills of every text the component draws', () => {
    const { next } = detached('card')
    // An override still wins (ADR 0018 §4), and a vector keeps its colour.
    expect(at(next, 'card#title').fills).toEqual(GREEN.value)
    expect(at(next, 'card#footer/hint').fills).toEqual(RED.value)
    expect(at(next, 'card#mark')).toMatchObject({ fills: BLUE.value, opacity: 0.5 })
    // An instance inside takes it as its own, unless it states one.
    expect(at(next, 'card#action').textFills).toEqual(RED.value)
    expect(at(next, 'card#stop').textFills).toEqual(WHITE.value)
  })

  it('reaches slot content that states no fills of its own', () => {
    const { next, diagnostics } = detached('filled')
    expect(at(next, 'filled#title').fills).toEqual(RED.value)
    expect(at(next, 'filled#footer/note').fills).toEqual(RED.value)
    expect(at(next, 'filled#footer/own').fills).toEqual(GREY.value)
    expect(at(next, 'filled#footer/row/deep').fills).toEqual(RED.value)
    expect(at(next, 'filled#footer/plain').textFills).toEqual(RED.value)
    expect(at(next, 'filled#footer/mine').textFills).toEqual(BLUE.value)
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([])
  })

  it('comes from an enclosing instance when the use states none', () => {
    // `plain` sits in what `filled` put in Card's footer, so `filled`'s
    // colour reached Tag's label over the label's own fills.
    const plain = detached('filled#footer/plain')
    expect(at(plain.next, 'filled#footer/plain/box/label').fills).toEqual(RED.value)
    // The nearest colour wins.
    const mine = detached('filled#footer/mine')
    expect(at(mine.next, 'filled#footer/mine/box/label').fills).toEqual(BLUE.value)
  })

  it('yields to an override keyed as the build keys it', () => {
    // A styles table puts the pill at `root`, so that is where the key points.
    const { next } = detached('keyed')
    expect(at(next, 'keyed#label').fills).toEqual(GREEN.value)
  })

  it('is never written on a frame', () => {
    for (const address of ['styled', 'tag', 'card', 'filled', 'composed', 'enabled']) {
      const insert = detached(address).plan.patches.find((patch) => patch.op === 'insert-node')!
      const carriers: string[] = []
      const walk = (spec: UidxNodeSpec): void => {
        if ('textFills' in spec.attrs) carriers.push(spec.element)
        for (const child of spec.children ?? []) walk(child)
      }
      if (insert.op === 'insert-node') walk(insert.node)
      expect(carriers.filter((element) => element !== 'Instance')).toEqual([])
    }
  })
})

describe('a detached composition', () => {
  it('hands its box, colour and size to the instance it holds', () => {
    const { copy, next, diagnostics } = detached('composed')
    for (const prop of ['fills', 'paddingLeft', 'textFills'])
      expect(copy.attrs[prop]).toBeUndefined()
    const field = resolve(next.tree, 'composed#field')!
    expect(field.element).toBe('Instance')
    // The use's values beat the ones the definition wrote on `field`.
    expect(valuesOf(field)).toMatchObject({
      component: 'Field',
      props: { label: 'Label' },
      fills: RED.value,
      paddingLeft: 16,
      textFills: BLUE.value,
      width: 300,
    })
    // What the composition puts in Field's slot stays a fill.
    const control = field.children.find((child) => child.name === 'control')!
    expect(control.element).toBe('Slot')
    expect(control.children.map((child) => [child.element, child.name])).toEqual([
      ['Instance', 'box'],
    ])
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([])
  })

  it('keeps what the definition wrote on the held instance when the use states nothing', () => {
    const { next } = detached('quiet')
    expect(at(next, 'quiet#field')).toMatchObject({ fills: GREY.value, textFills: GREEN.value })
  })
})

describe('the size of a detached instance', () => {
  const before = sceneOf(home).graph
  const widthOf = (scene: SceneResult, id: string) => scene.graph.getNode(id)!.width

  it('pins the frame its box lands on, as the build does', () => {
    const sized = detached('sized')
    expect(valuesOf(sized.copy)).toMatchObject({
      width: 199,
      height: 33,
      primaryAxisSizingMode: 'FIXED',
      counterAxisSizingMode: 'FIXED',
    })
    const pill = sceneOf(sized.next).graph.getNode('sized')!
    const drawn = before.getNode('sized#root')!
    expect([pill.width, pill.height]).toEqual([drawn.width, drawn.height])
    expect([pill.width, pill.height]).toEqual([199, 33])

    const tag = detached('tag')
    expect(at(tag.next, 'tag#box')).toMatchObject({ width: 120, primaryAxisSizingMode: 'FIXED' })
    expect(widthOf(sceneOf(tag.next), 'tag#box')).toBe(before.getNode('tag#box')!.width)
  })

  it('passes it to the instance a composition holds', () => {
    const { next } = detached('composed')
    expect(widthOf(sceneOf(next), 'composed#field')).toBe(before.getNode('composed#field')!.width)
    expect(before.getNode('composed#field')!.width).toBe(300)
  })

  it('leaves a dimension the use fills to its parent', () => {
    const { copy, next } = detached('column#stretched')
    expect(copy.attrs.primaryAxisSizingMode!.value).toBe('AUTO')
    expect(widthOf(sceneOf(next), 'column#stretched')).toBe(
      before.getNode('column#stretched/root')!.width,
    )
  })
})

describe('a rebuild of a detached copy', () => {
  /**
   * The scene-regression fixture page (ADR 0018's every shape, restyled) and
   * the components it places: its own, and the design-system example's
   * library, file by file, so a scratch page in the example never joins.
   */
  const FILES = [
    'examples/design-system/.uidx/tokens.uidx',
    'examples/design-system/.uidx/button.uidx',
    'examples/design-system/.uidx/checkbox.uidx',
    'examples/design-system/.uidx/checkbox-field.uidx',
    'examples/design-system/.uidx/field.uidx',
    'packages/schema/test/fixtures/instance-box/button1.uidx',
    'packages/schema/test/fixtures/instance-box/kinds.uidx',
    'packages/schema/test/fixtures/instance-box/overrides.uidx',
  ]
  const PAGE = FILES.at(-1)!
  const docs = new Map(
    FILES.map(
      (file) => [file, parseOrThrow(readFileSync(join(repo, file), 'utf8'), file)] as const,
    ),
  )
  const page = docs.get(PAGE)!
  const byId = (nodes: DumpedNode[]) => new Map(nodes.map((node) => [node.id, node]))
  const built = buildPage(docs, page)
  const before = byId(dumpScene(built))

  /** What a node draws, as the dump records it: its paint, its box and its words. */
  const DRAWN = [
    'type',
    'visible',
    'fills',
    'strokes',
    'borderTopWeight',
    'borderRightWeight',
    'borderBottomWeight',
    'borderLeftWeight',
    'independentStrokeWeights',
    'dashPattern',
    'effects',
    'opacity',
    'cornerRadius',
    'topLeftRadius',
    'topRightRadius',
    'bottomRightRadius',
    'bottomLeftRadius',
    'independentCorners',
    'cornerSmoothing',
    'paddingTop',
    'paddingRight',
    'paddingBottom',
    'paddingLeft',
    'characters',
    'fontSize',
  ] as const
  const drawn = (node: DumpedNode) =>
    Object.fromEntries(DRAWN.map((key) => [key, node[key as keyof DumpedNode]]))

  /** Every instance the page writes, placed on it or put in another's slot. */
  const uses: string[] = []
  const collect = (node: UidxNode): void => {
    for (const child of node.children) {
      if (child.element === 'Instance') uses.push(child.address)
      collect(child)
    }
  }
  collect(page.tree)

  /** Whether scene node `id` is `root` or drawn inside it. */
  const under = (id: string, root: string): boolean =>
    id === root || id.startsWith(`${root}${root.includes('#') ? '/' : '#'}`)

  it.each(uses)('draws %s as the instance did', (address) => {
    const plan = detachInstance(docs, page, address)!
    const next = parseOrThrow(applyPatches(page.source, plan.patches).source, PAGE)
    const rebuilt = buildPage(new Map([...docs, [PAGE, next]]), next)
    const after = byId(dumpScene(rebuilt))
    // Slot content is drawn where the slot sits in the component, so its
    // scene id is not its address; the copy keeps the instance's.
    const name = built.addresses.sceneIdOf(address)!
    expect(rebuilt.addresses.sceneIdOf(address)).toBe(name)

    // A variant's frame is the copy itself (the frame the build drew one
    // level down): the instance's own node was a wrapper with no look.
    const wrapped = before.get(name)!.childIds
    const frame = wrapped.length === 1 && !after.has(wrapped[0]!) ? wrapped[0] : undefined
    const copyOf = (id: string): string =>
      frame === undefined || !under(id, frame)
        ? id
        : id === frame
          ? name
          : `${name}${name.includes('#') ? '/' : '#'}${id.slice(frame.length + 1)}`

    const drew = [...before.keys()].filter((id) => under(id, name))
    const mine = drew.filter((id) => !(frame !== undefined && id === name))
    expect([...after.keys()].filter((id) => under(id, name)).sort()).toEqual(
      mine.map(copyOf).sort(),
    )
    for (const id of mine) {
      // The instance's own node is the one that stops being an instance.
      const expected = { ...drawn(before.get(id)!), ...(id === name ? { type: 'FRAME' } : {}) }
      expect(drawn(after.get(copyOf(id))!), id).toEqual(expected)
    }
    if (frame !== undefined) {
      const wrapper = before.get(name)!
      expect([wrapper.fills, wrapper.strokes, wrapper.effects, wrapper.opacity]).toEqual([
        [],
        [],
        [],
        1,
      ])
    }
  })
})
