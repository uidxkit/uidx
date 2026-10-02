import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseOrThrow, type UidxDocument } from '@uidx/format'
import type { SceneNode } from '@open-pencil/scene-graph'
import { fromSceneChange, type ChangeContext, type SceneResult } from '../src/index.js'
import { buildPage, repo } from './helpers/workspace-scene.js'

/**
 * The canvas never writes a use's outer box back on its own (ADR 0018).
 *
 * The box is drawn on the node that draws the component's box — for most
 * components a frame one level down, which has no address — so the
 * instance's own node holds its placement and nothing else: no fills, no
 * effects, opacity 1, padding 0. A change announced on that node outside a
 * gesture reads, against the file, as the use's box being cleared:
 * `fills={[]}` over `fills="{surface#danger}"`. Where the component lays
 * itself out the node does draw the box, but resolved — a token's colour, or
 * the component's own value where the use states none — and writing that
 * back would unbind the token or copy the component's look into the use.
 *
 * Text colour is the same seam one level in. Slot-fill text is the
 * consumer's own, linked and patchable, but one that states no fills draws
 * the colour the instance hands down (§4), and that colour is the
 * instance's to change, not the text's.
 *
 * In both cases a gesture that vouches for the prop still writes it.
 */

/** Tokens, Field, and the instance-box fixture's Button1 and Chip, by name. */
const LIBRARY = [
  'examples/design-system/.uidx/tokens.uidx',
  'examples/design-system/.uidx/field.uidx',
  'packages/schema/test/fixtures/instance-box/button1.uidx',
  'packages/schema/test/fixtures/instance-box/kinds.uidx',
].map((file) => [file, parseOrThrow(readFileSync(join(repo, file), 'utf8'), file)] as const)

interface Built extends SceneResult {
  doc: UidxDocument
}

/** `body` on a page of its own, drawn as the canvas draws it. */
function scene(body: string): Built {
  const doc = parseOrThrow(
    `---\nid: use\n---\n\n## Visual Contract\n\n<Page>\n${body}\n</Page>\n`,
    'use.uidx',
  )
  const docs = new Map<string, UidxDocument>([...LIBRARY, ['use.uidx', doc]])
  return { doc, ...buildPage(docs, doc) }
}

/**
 * `fields` as the scene node at `id` holds them: what a write to the node
 * re-announces, since `updateNode` emits every key it is handed.
 */
function held(built: Built, id: string, fields: readonly (keyof SceneNode)[]): Partial<SceneNode> {
  const node = built.graph.getNode(id)
  if (!node) throw new Error(`no scene node ${id}`)
  return Object.fromEntries(fields.map((field) => [field, node[field]]))
}

/** The patches `changes` on `id` become, asked as CanvasPane's `recordSceneWrite` asks. */
function written(
  built: Built,
  id: string,
  changes: Partial<SceneNode>,
  context: Partial<ChangeContext> = {},
) {
  return fromSceneChange(id, changes, {
    doc: built.doc,
    graph: built.graph,
    addresses: built.addresses,
    pins: built.pins,
    ...context,
  })
}

/** `cascaded` for a build: whether a text is one some use's colour reaches. */
function cascadedIn(built: Built): (sceneId: string) => boolean {
  const texts = new Set([...built.textTargets.values()].flat())
  return (sceneId) => texts.has(sceneId)
}

/** A vouch for `props` on `id`, as a panel edit gives one. */
const vouched = (id: string, ...props: string[]): Partial<ChangeContext> => ({
  authored: new Set(props),
  authoredFor: id,
})

const solid = (r: number, g: number, b: number) =>
  `[{ type: 'SOLID', color: { r: ${r}, g: ${g}, b: ${b}, a: 1 } }]`
const RED = solid(1, 0, 0)
const SHADOW = `[{ type: 'DROP_SHADOW', color: { r: 0, g: 0, b: 0, a: 0.25 }, offset: { x: 0, y: 2 }, radius: 4, spread: 0, visible: true }]`

/** A paint as the scene holds one once a gesture has put it there. */
const paint = (r: number, g: number, b: number) => [
  { type: 'SOLID' as const, color: { r, g, b, a: 1 }, opacity: 1, visible: true },
]

describe('an instance’s outer box never echoes into the file (ADR 0018 §1)', () => {
  it('writes nothing for an unvouched fills: [] on an instance that states fills', () => {
    const built = scene(`  <Instance name="b" component="Button1" fills="{surface#danger}" />`)
    // The wrapper holds no paint: the use's colour is drawn on b#root.
    const changes = held(built, 'b', ['fills'])
    expect(changes).toEqual({ fills: [] })
    expect(written(built, 'b', changes)).toEqual([])
  })

  it('adds no explicit none to an instance that states no fills', () => {
    const built = scene(`  <Instance name="b" component="Button1" />`)
    expect(written(built, 'b', held(built, 'b', ['fills']))).toEqual([])
  })

  it.each([
    ['opacity', 'opacity={0.5}', ['opacity']],
    ['effects', `effects={${SHADOW}}`, ['effects']],
    ['padding', 'paddingLeft={24} paddingTop={2}', ['paddingLeft', 'paddingTop', 'paddingRight']],
    [
      'strokes',
      `strokes={${RED}} strokeWeight={2}`,
      ['strokes', 'borderTopWeight', 'borderRightWeight', 'borderBottomWeight', 'borderLeftWeight'],
    ],
    ['corner radius', 'cornerRadius={4}', ['cornerRadius', 'topLeftRadius', 'cornerSmoothing']],
  ] as const)('treats %s the same', (_, attrs, fields) => {
    const built = scene(`  <Instance name="b" component="Button1" ${attrs} />`)
    expect(written(built, 'b', held(built, 'b', fields))).toEqual([])
  })

  it('holds back a component that lays itself out too, whose own node draws the box', () => {
    const built = scene(
      `  <Instance name="c" component="Chip" props={{ label: 'Chip' }} fills="{surface#accent}" />`,
    )
    // The node draws the token's colour and the component's padding; the file
    // names the token and states no padding.
    expect(built.graph.getNode('c')!.fills).toHaveLength(1)
    expect(built.graph.getNode('c')!.paddingLeft).toBe(8)
    expect(written(built, 'c', held(built, 'c', ['fills', 'paddingLeft']))).toEqual([])
  })

  it('still writes placement', () => {
    const built = scene(`  <Instance name="b" component="Button1" x={0} y={0} fills={${RED}} />`)
    built.graph.updateNode('b', { x: 40 })
    expect(written(built, 'b', { x: 40, ...held(built, 'b', ['fills']) })).toEqual([
      { op: 'set', address: 'b', prop: 'x', value: 40 },
    ])
  })

  it('still writes a vouched change', () => {
    const built = scene(`  <Instance name="b" component="Button1" fills={${RED}} />`)
    const green = paint(0, 0.5, 0)
    built.graph.updateNode('b', { fills: green })
    expect(written(built, 'b', { fills: green }, vouched('b', 'fills'))).toEqual([
      { op: 'set', address: 'b', prop: 'fills', value: green },
    ])
  })

  it('takes a vouch only for the props it names, on the node it names', () => {
    const built = scene(`  <Instance name="b" component="Button1" fills={${RED}} opacity={0.5} />
  <Instance name="other" component="Button1" y={60} fills={${RED}} />`)
    const green = paint(0, 0.5, 0)
    built.graph.updateNode('b', { fills: green })
    built.graph.updateNode('other', { fills: green })
    expect(
      written(
        built,
        'b',
        { fills: green, ...held(built, 'b', ['opacity']) },
        vouched('b', 'fills'),
      ),
    ).toEqual([{ op: 'set', address: 'b', prop: 'fills', value: green }])
    expect(written(built, 'other', { fills: green }, vouched('b', 'fills'))).toEqual([])
  })
})

describe('a text keeps the colour it inherits out of the file (ADR 0018 §4)', () => {
  const FIELD = `  <Instance name="f" component="Field" props={{ label: 'Status' }} textFills={${RED}}>
    <Slot name="control">
      <Text name="bare" characters="Inherits" fontSize={12} />
      <Text name="own" characters="Keeps" fontSize={12} fills={${solid(0, 0, 1)}} />
    </Slot>
  </Instance>`
  const BARE = 'f#root/control/bare'
  const OWN = 'f#root/control/own'

  it('does not write a slot-fill text’s cascaded fills back', () => {
    const built = scene(FIELD)
    // Authored, so it may be patched — and drawn in the instance's colour.
    expect(built.addresses.addressOf(BARE)).toBe('f#control/bare')
    expect(cascadedIn(built)(BARE)).toBe(true)
    expect(built.graph.getNode(BARE)!.fills[0]!.color).toEqual({ r: 1, g: 0, b: 0, a: 1 })
    expect(
      written(built, BARE, held(built, BARE, ['fills']), { cascaded: cascadedIn(built) }),
    ).toEqual([])
  })

  it('does not write one back while no use states a colour yet', () => {
    const built = scene(FIELD.replace(` textFills={${RED}}`, ''))
    expect(cascadedIn(built)(BARE)).toBe(true)
    expect(
      written(built, BARE, held(built, BARE, ['fills']), { cascaded: cascadedIn(built) }),
    ).toEqual([])
  })

  it('still writes fills a gesture gives the text', () => {
    const built = scene(FIELD)
    const green = paint(0, 0.5, 0)
    built.graph.updateNode(BARE, { fills: green })
    expect(
      written(
        built,
        BARE,
        { fills: green },
        { cascaded: cascadedIn(built), ...vouched(BARE, 'fills') },
      ),
    ).toEqual([{ op: 'add', address: 'f#control/bare', prop: 'fills', value: green }])
  })

  it('keeps fills a text states current, as on any node', () => {
    const built = scene(FIELD)
    const green = paint(0, 0.5, 0)
    built.graph.updateNode(OWN, { fills: green })
    // Even told every text is cascaded: one that states its fills keeps them.
    expect(written(built, OWN, { fills: green }, { cascaded: () => true })).toEqual([
      { op: 'set', address: 'f#control/own', prop: 'fills', value: green },
    ])
  })
})
