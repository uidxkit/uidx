import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { applyPatches, parseOrThrow, resolve, type JsonValue, type UidxNode } from '@uidx/format'
import { instanceBase, instanceDefinition, toSceneGraph } from '@uidx/schema'
import { editableProps, parentOf } from '../src/editable'
import {
  instanceBoxEdit,
  OVERRIDE_PROPS,
  overrideCount,
  resetAllPatches,
  resetPatches,
  sectionResetProps,
} from '../src/instance-box-edits'
import { asPaints, setPaintColor } from '../src/paint-edit'

/**
 * Restyling an instance from the panel (ADR 0018 §7). Every edit is a patch
 * on the `<Instance>` — the node that draws the value is generated and has no
 * address — and a preview drawn by the build's own functions, so the canvas
 * shows during a scrub what the patch's echo will draw.
 */
const page = (id: string, body: string) =>
  `---\nid: ${id}\n---\n\n## Visual Contract\n\n<Page>\n${body}\n</Page>\n`

/** The schema's copy of the design-system example's Button1: its box is the derived `root`. */
const BUTTON1 = parseOrThrow(
  readFileSync(join(__dirname, '../../schema/test/fixtures/instance-box/button1.uidx'), 'utf8'),
  'button1.uidx',
)

const solid = (r: number, g: number, b: number, a = 1) => ({
  type: 'SOLID',
  color: { r, g, b, a },
})
const WHITE = solid(1, 1, 1)
const SEE_THROUGH_BLUE = solid(0, 0, 1, 0.5)
const RED = [solid(1, 0, 0)]
const GREEN = { r: 0, g: 0.6, b: 0, a: 1 }

/**
 * A component that lays itself out, under a two-paint stack; one holding a
 * slot; and one holding its slot inside a frame, so what fills it is drawn
 * under that frame, away from the address the file gives it.
 */
const LOCAL = parseOrThrow(
  page(
    'local',
    `  <Component name="Duo" status="draft" layoutMode="HORIZONTAL"
    primaryAxisSizingMode="AUTO" counterAxisSizingMode="AUTO" paddingLeft={8}
    fills={${JSON.stringify([WHITE, SEE_THROUGH_BLUE])}}>
    <Text name="label" characters="Duo" fontSize={12} />
  </Component>
  <Component name="Well" status="draft" layoutMode="VERTICAL"
    primaryAxisSizingMode="AUTO" counterAxisSizingMode="AUTO">
    <Slot name="body" />
  </Component>
  <Component name="Panel" status="draft" layoutMode="VERTICAL"
    primaryAxisSizingMode="AUTO" counterAxisSizingMode="AUTO">
    <Frame name="frame" layoutMode="VERTICAL" primaryAxisSizingMode="AUTO" counterAxisSizingMode="AUTO">
      <Slot name="body" />
    </Frame>
  </Component>`,
  ),
  'local.uidx',
)

/** The one token a use below names, as the consuming page resolves it. */
const TOKENS = new Map<string, JsonValue>([['color#danger', { r: 1, g: 0, b: 0, a: 1 }]])

/** A page holding `body`, with the scope a use on it is written in. */
function use(body: string) {
  const doc = parseOrThrow(page('use', body), 'use.uidx')
  const components = new Map<string, UidxNode>()
  for (const source of [BUTTON1, LOCAL, doc])
    for (const child of source.tree.children)
      if (child.element === 'Component') components.set(child.name, child)
  const scope = {
    resolveAlias: (address: string) => TOKENS.get(address),
    resolveComponent: (name: string) => components.get(name),
  }
  return { doc, scope }
}

/** The colour of a paint list's first paint, rounded to three places. */
const colour = (value: unknown): Record<string, number> | undefined => {
  const color = (Array.isArray(value) ? value[0] : undefined)?.color as
    Record<string, number> | undefined
  if (!color) return undefined
  return Object.fromEntries(
    Object.entries(color).map(([key, entry]) => [key, Math.round(entry * 1000) / 1000]),
  )
}

const PLAIN = `  <Instance name="b" component="Button1" props={{ label: 'Go' }} />`

describe('instanceBoxEdit', () => {
  it('writes fills as an add on the instance, and previews them on b#root', () => {
    const { doc, scope } = use(PLAIN)
    const edit = instanceBoxEdit(doc, 'b', 'fills', RED, { scope })!
    expect(edit.patches).toEqual([{ op: 'add', address: 'b', prop: 'fills', value: RED }])
    // The frame the component wraps draws the box; the wrapper around it does not.
    expect(edit.preview.map((update) => update.id)).toEqual(['b#root'])
    expect(colour(edit.preview[0]!.props.fills)).toEqual({ r: 1, g: 0, b: 0, a: 1 })
  })

  it('rewrites a value the use already states with a set', () => {
    const { doc, scope } = use(
      `  <Instance name="b" component="Button1" props={{ label: 'Go' }} paddingLeft={24} />`,
    )
    const edit = instanceBoxEdit(doc, 'b', 'paddingLeft', 40, { scope })!
    expect(edit.patches).toEqual([{ op: 'set', address: 'b', prop: 'paddingLeft', value: 40 }])
    expect(edit.preview).toEqual([
      expect.objectContaining({
        id: 'b#root',
        props: expect.objectContaining({ paddingLeft: 40 }),
      }),
    ])
  })

  it('resets with a remove, and previews the component’s value back', () => {
    const { doc, scope } = use(
      `  <Instance name="b" component="Button1" props={{ label: 'Go' }} fills={[{ type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 } }]} />`,
    )
    const edit = instanceBoxEdit(doc, 'b', 'fills', undefined, { scope })!
    expect(edit.patches).toEqual([{ op: 'remove', address: 'b', prop: 'fills' }])
    expect(edit.preview.map((update) => update.id)).toEqual(['b#root'])
    expect(colour(edit.preview[0]!.props.fills)).toEqual({ r: 0, g: 0.333, b: 1, a: 1 })
    expect(edit.next.attrs.fills).toBeUndefined()
  })

  it('writes nothing for a value the file already holds, or a reset of one it does not', () => {
    const { doc, scope } = use(
      `  <Instance name="b" component="Button1" props={{ label: 'Go' }} paddingLeft={24} />`,
    )
    expect(instanceBoxEdit(doc, 'b', 'paddingLeft', 24, { scope })!.patches).toEqual([])
    expect(instanceBoxEdit(doc, 'b', 'fills', undefined, { scope })!.patches).toEqual([])
  })

  it('binds a token in the consuming page’s scope for the preview, and writes it as written', () => {
    const { doc, scope } = use(PLAIN)
    const edit = instanceBoxEdit(doc, 'b', 'fills', '{color#danger}', { scope })!
    expect(edit.patches).toEqual([
      { op: 'add', address: 'b', prop: 'fills', value: '{color#danger}' },
    ])
    expect(colour(edit.preview[0]!.props.fills)).toEqual({ r: 1, g: 0, b: 0, a: 1 })
  })

  it('copy-on-write: editing one paint of an inherited two-paint stack writes both', () => {
    const { doc, scope } = use(`  <Instance name="d" component="Duo" />`)
    const instance = resolve(doc.tree, 'd')!
    const base = instanceBase(instance, instanceDefinition(instance, scope), scope)
    const fills = editableProps(instance, parentOf(doc.tree, 'd'), base).find(
      (field) => field.name === 'fills',
    )!
    expect(fills.origin).toBe('component')
    // What the paint stack emits for a recoloured first paint: the whole stack.
    const next = setPaintColor(asPaints(fills.value)!, 0, GREEN)
    const edit = instanceBoxEdit(doc, 'd', 'fills', next, { scope })!
    expect(edit.patches).toEqual([
      {
        op: 'add',
        address: 'd',
        prop: 'fills',
        value: [{ ...WHITE, color: GREEN }, SEE_THROUGH_BLUE],
      },
    ])
    // Duo lays itself out, so its box is the instance's own node.
    expect(edit.preview.map((update) => update.id)).toEqual(['d'])
  })

  it('previews a text colour on exactly the texts it reaches', () => {
    const { doc, scope } = use(PLAIN)
    const targets = toSceneGraph(doc, scope).textTargets.get('b')!
    expect(targets).toEqual(['b#root/label'])
    const edit = instanceBoxEdit(doc, 'b', 'textFills', RED, { scope, textTargets: targets })!
    expect(edit.patches).toEqual([{ op: 'add', address: 'b', prop: 'textFills', value: RED }])
    expect(edit.preview.map((update) => update.id)).toEqual(targets)
    expect(colour(edit.preview[0]!.props.fills)).toEqual({ r: 1, g: 0, b: 0, a: 1 })
  })

  it('previews each step of a scrub from the last, so a value scrubbed back is drawn back', () => {
    const { doc, scope } = use(PLAIN)
    const first = instanceBoxEdit(doc, 'b', 'paddingLeft', 40, { scope })!
    expect(first.preview[0]).toMatchObject({ id: 'b#root', props: { paddingLeft: 40 } })
    // Back to Button1's own 12: against the file nothing moved, but the scene
    // still draws 40.
    expect(instanceBoxEdit(doc, 'b', 'paddingLeft', 12, { scope })!.preview).toEqual([])
    const back = instanceBoxEdit(doc, 'b', 'paddingLeft', 12, { scope, drawn: first.next })!
    expect(back.preview[0]).toMatchObject({ id: 'b#root', props: { paddingLeft: 12 } })
    // The patch is still the file's business: an add, since the file states none.
    expect(back.patches).toEqual([{ op: 'add', address: 'b', prop: 'paddingLeft', value: 12 }])
  })

  it('accrues the props a compound control writes in one step', () => {
    const { doc, scope } = use(PLAIN)
    const left = instanceBoxEdit(doc, 'b', 'paddingLeft', 30, { scope })!
    const right = instanceBoxEdit(doc, 'b', 'paddingRight', 30, { scope, drawn: left.next })!
    expect(right.next.attrs.paddingLeft?.value).toBe(30)
    expect(right.next.attrs.paddingRight?.value).toBe(30)
    // Only what this step changed moves: the left side is already drawn.
    expect(right.preview).toEqual([
      expect.objectContaining({
        id: 'b#root',
        props: expect.not.objectContaining({ paddingLeft: expect.anything() }),
      }),
    ])
    expect(right.patches).toEqual([{ op: 'add', address: 'b', prop: 'paddingRight', value: 30 }])
  })

  it('is not the route for anything but the outer box and the text colour', () => {
    const { doc, scope } = use(PLAIN)
    for (const prop of ['x', 'width', 'visible', 'component', 'props', 'layoutMode', 'fontSize'])
      expect(instanceBoxEdit(doc, 'b', prop, 1, { scope }), prop).toBeNull()
  })

  it('is null for an address that is not an instance', () => {
    const { doc, scope } = use(`${PLAIN}\n  <Frame name="f" />`)
    expect(instanceBoxEdit(doc, 'f', 'fills', RED, { scope })).toBeNull()
    expect(instanceBoxEdit(doc, 'ghost', 'fills', RED, { scope })).toBeNull()
  })

  it('still patches without a definition, and previews nothing', () => {
    const { doc, scope } = use(`  <Instance name="b" component="Nowhere" />`)
    const edit = instanceBoxEdit(doc, 'b', 'fills', RED, { scope })!
    expect(edit.patches).toEqual([{ op: 'add', address: 'b', prop: 'fills', value: RED }])
    expect(edit.preview).toEqual([])
  })

  /**
   * The promise the preview makes: the built scene with the preview laid on
   * it is, where the edit lands, the scene a rebuild of the patched file draws.
   */
  it('previews what a rebuild of the patched file draws', () => {
    const { doc, scope } = use(PLAIN)
    for (const [prop, value] of [
      ['fills', RED],
      ['textFills', RED],
      ['cornerRadius', 4],
      ['strokes', [solid(0.2, 0.2, 0.2)]],
    ] as const) {
      const live = toSceneGraph(doc, scope)
      const edit = instanceBoxEdit(doc, 'b', prop, value as JsonValue, {
        scope,
        textTargets: live.textTargets.get('b'),
      })!
      for (const update of edit.preview) live.graph.updateNode(update.id, update.props)
      const patched = parseOrThrow(applyPatches(doc.source, edit.patches).source)
      const rebuilt = toSceneGraph(patched, scope)
      for (const id of ['b', 'b#root', 'b#root/label']) {
        const now = live.graph.getNode(id)!
        const then = rebuilt.graph.getNode(id)!
        for (const field of ['fills', 'strokes', 'cornerRadius'] as const)
          expect(now[field], `${prop}: ${id}.${field}`).toEqual(then[field])
      }
    }
  })
})

/**
 * A use inside a slot fill is drawn at the definition's position, not at the
 * address the file gives it (ADR 0007 §3): Panel's slot sits inside its
 * frame, so the `b` written as `p#body/b` is drawn as `p#frame/body/b`. The
 * patch names the address; the preview has to name the scene's nodes.
 */
describe('instanceBoxEdit on a use inside a slot fill', () => {
  const SLOTTED = `  <Instance name="p" component="Panel">
    <Slot name="body">
      <Instance name="b" component="Button1" props={{ label: 'Go' }} />
    </Slot>
  </Instance>`

  it('patches the address and previews under the scene id', () => {
    const { doc, scope } = use(SLOTTED)
    const live = toSceneGraph(doc, scope)
    const sceneId = live.addresses.sceneIdOf('p#body/b')!
    expect(sceneId).toBe('p#frame/body/b')
    const edit = instanceBoxEdit(doc, 'p#body/b', 'fills', RED, { scope, sceneId })!
    expect(edit.patches).toEqual([{ op: 'add', address: 'p#body/b', prop: 'fills', value: RED }])
    expect(edit.preview.map((update) => update.id)).toEqual(['p#frame/body/b/root'])
    // The next step of the gesture previews from where this one drew.
    expect(edit.next.address).toBe(sceneId)
    const next = instanceBoxEdit(doc, 'p#body/b', 'fills', undefined, {
      scope,
      sceneId,
      drawn: edit.next,
    })!
    expect(next.preview.map((update) => update.id)).toEqual(['p#frame/body/b/root'])
  })

  it('previews what a rebuild of the patched file draws', () => {
    const { doc, scope } = use(SLOTTED)
    for (const [prop, value] of [
      ['fills', RED],
      ['textFills', RED],
      ['cornerRadius', 4],
    ] as const) {
      const live = toSceneGraph(doc, scope)
      const sceneId = live.addresses.sceneIdOf('p#body/b')!
      const edit = instanceBoxEdit(doc, 'p#body/b', prop, value as JsonValue, {
        scope,
        sceneId,
        textTargets: live.textTargets.get(sceneId),
      })!
      expect(edit.preview.length, prop).toBeGreaterThan(0)
      for (const update of edit.preview) {
        expect(live.graph.getNode(update.id), `${prop}: ${update.id}`).toBeDefined()
        live.graph.updateNode(update.id, update.props)
      }
      const rebuilt = toSceneGraph(
        parseOrThrow(applyPatches(doc.source, edit.patches).source),
        scope,
      )
      for (const id of [sceneId, `${sceneId}/root`, `${sceneId}/root/label`]) {
        const now = live.graph.getNode(id)!
        const then = rebuilt.graph.getNode(id)!
        for (const field of ['fills', 'strokes', 'cornerRadius'] as const)
          expect(now[field], `${prop}: ${id}.${field}`).toEqual(then[field])
      }
    }
  })
})

describe('resetting overrides', () => {
  const STYLED = `  <Instance name="b" component="Button1" x={10} y={20} props={{ label: 'Go' }}
    modes={{ density: 'compact' }} layoutPositioning="ABSOLUTE" layoutMode="VERTICAL"
    fills={[{ type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 } }]} textFills="{color#danger}"
    width={199} height={33} paddingLeft={24} cornerRadius={4} />`

  it('resetPatches removes each listed prop the instance states, and nothing it does not', () => {
    const instance = resolve(use(STYLED).doc.tree, 'b')!
    expect(resetPatches(instance, ['fills', 'strokes', 'layoutMode'])).toEqual([
      { op: 'remove', address: 'b', prop: 'fills' },
      { op: 'remove', address: 'b', prop: 'layoutMode' },
    ])
    expect(resetPatches(instance, [])).toEqual([])
  })

  it('a section resets the overrides its rows show', () => {
    expect(sectionResetProps('stroke')).toEqual([
      'strokes',
      'strokeWeight',
      'strokeAlign',
      'dashPattern',
      'strokeTopWeight',
      'strokeRightWeight',
      'strokeBottomWeight',
      'strokeLeftWeight',
    ])
    expect(sectionResetProps('fill')).toEqual(['fills'])
    expect(sectionResetProps('textColor')).toEqual(['textFills'])
    expect(sectionResetProps('effects')).toEqual(['effects'])
    expect(sectionResetProps('appearance')).toEqual([
      'cornerRadius',
      'topLeftRadius',
      'topRightRadius',
      'bottomRightRadius',
      'bottomLeftRadius',
      'cornerSmoothing',
      'opacity',
    ])
    // Layout's are the stated size and the padding: never min/max, never position.
    expect(sectionResetProps('layout')).toEqual([
      'paddingTop',
      'paddingRight',
      'paddingBottom',
      'paddingLeft',
      'width',
      'height',
    ])
    expect(sectionResetProps('position')).toEqual([])
    expect(sectionResetProps('typography')).toEqual([])
  })

  it('resetting the stroke section removes every stroke prop the instance states', () => {
    const { doc } = use(`  <Instance name="b" component="Button1" props={{ label: 'Go' }}
    strokes={[{ type: 'SOLID', color: { r: 0, g: 0, b: 0, a: 1 } }]} strokeWeight={2}
    strokeAlign="OUTSIDE" dashPattern={[4, 2]} strokeTopWeight={1} strokeRightWeight={2}
    strokeBottomWeight={3} strokeLeftWeight={4} fills={[{ type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 } }]} />`)
    const patches = resetPatches(resolve(doc.tree, 'b')!, sectionResetProps('stroke'))
    expect(patches.map((patch) => patch.op === 'remove' && patch.prop)).toEqual([
      'strokes',
      'strokeWeight',
      'strokeAlign',
      'dashPattern',
      'strokeTopWeight',
      'strokeRightWeight',
      'strokeBottomWeight',
      'strokeLeftWeight',
    ])
  })

  it('reset all takes the box, the text colour and the stated size, in one list', () => {
    const instance = resolve(use(STYLED).doc.tree, 'b')!
    const patches = resetAllPatches(instance)
    expect(patches).toEqual(
      ['fills', 'cornerRadius', 'paddingLeft', 'textFills', 'width', 'height'].map((prop) => ({
        op: 'remove',
        address: 'b',
        prop,
      })),
    )
  })

  it('reset all never touches position, flow, props, modes, slot fills or the locked inside', () => {
    const instance = resolve(use(STYLED).doc.tree, 'b')!
    const touched = resetAllPatches(instance).map((patch) => patch.op === 'remove' && patch.prop)
    for (const prop of ['x', 'y', 'props', 'modes', 'layoutPositioning', 'layoutMode', 'component'])
      expect(touched, prop).not.toContain(prop)
    for (const prop of touched) expect(OVERRIDE_PROPS).toContain(prop)

    const { doc } =
      use(`  <Instance name="w" component="Well" fills={[{ type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 } }]}>
    <Slot name="body">
      <Text name="note" characters="Kept" fontSize={12} />
    </Slot>
  </Instance>`)
    expect(resetAllPatches(resolve(doc.tree, 'w')!)).toEqual([
      { op: 'remove', address: 'w', prop: 'fills' },
    ])
  })

  it('counts the overrides a use states', () => {
    expect(overrideCount(resolve(use(STYLED).doc.tree, 'b')!)).toBe(6)
    expect(overrideCount(resolve(use(PLAIN).doc.tree, 'b')!)).toBe(0)
  })
})
