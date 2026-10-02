import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseOrThrow, resolve, type UidxDocument, type UidxNode } from '@uidx/format'
import {
  boxValue,
  buildTokenIndex,
  instanceBase,
  instanceDefinition,
  instancePreview,
  layOutEntity,
  modelIndex,
  resolveTokenValues,
  TokenResolver,
  type SceneResult,
} from '../src/index.js'
import type { SceneOptions } from '../src/to-scene.js'
import { buildPage, dumpScene, repo } from './helpers/workspace-scene.js'

/**
 * What the properties panel reads for a selected instance, and how it previews
 * an edit (ADR 0018 §7): the component's own value for each row of the outer
 * box, dimmed until the use changes it, and a preview that draws the change
 * through the build's own functions, so the canvas shows exactly what the
 * commit will.
 */
const page = (id: string, body: string, regions = '') =>
  `---\nid: ${id}\n---\n\n## Visual Contract\n\n<Page>\n${body}\n</Page>\n${regions}`

/**
 * The components the uses below place: the design-system example's, named
 * rather than scanned (a scratch page there must not join), and the
 * instance-box fixture's Button1, Chip, Tag and Badge.
 */
const LIBRARY = [
  'examples/design-system/.uidx/tokens.uidx',
  'examples/design-system/.uidx/button.uidx',
  'examples/design-system/.uidx/checkbox.uidx',
  'examples/design-system/.uidx/checkbox-field.uidx',
  'examples/design-system/.uidx/field.uidx',
  'examples/design-system/.uidx/contact-list.uidx',
  'examples/design-system/.uidx/contact-option.uidx',
  'packages/schema/test/fixtures/instance-box/button1.uidx',
  'packages/schema/test/fixtures/instance-box/kinds.uidx',
].map((file) => [file, parseOrThrow(readFileSync(join(repo, file), 'utf8'), file)] as const)

const solid = (r: number, g: number, b: number) =>
  `[{ type: 'SOLID', color: { r: ${r}, g: ${g}, b: ${b}, a: 1 } }]`
const RED = solid(1, 0, 0)
const GREEN = solid(0, 0.5, 0)
const GREY = solid(0.2, 0.2, 0.2)
const SHADOW = `[{ type: 'DROP_SHADOW', color: { r: 0, g: 0, b: 0, a: 0.25 }, offset: { x: 0, y: 2 }, radius: 4, spread: 0, visible: true }]`

/** Button1's blue, exactly as the fixture writes it. */
const BLUE_PAINTS = [
  { opacity: 1, visible: true, type: 'SOLID', color: { r: 0, g: 0.3333, b: 1, a: 1 } },
]
/** What a text that states no fills draws in: the engine's own black. */
const ENGINE_TEXT = [
  { type: 'SOLID', color: { r: 0, g: 0, b: 0, a: 1 }, opacity: 1, visible: true },
]
const paints = (r: number, g: number, b: number) => [{ type: 'SOLID', color: { r, g, b, a: 1 } }]

const CONTRACT = `
## Contract

<Props>
  <Prop name="label" type="string" sample="Button1">The words it shows.</Prop>
</Props>
`

/** Button1's pill under another name, with `styles` as its table. */
const pill = (name: string, styles: string) =>
  page(
    name.toLowerCase(),
    `  <Component name="${name}" status="draft"
    layoutMode="HORIZONTAL" primaryAxisSizingMode="AUTO" counterAxisSizingMode="AUTO"
    primaryAxisAlignItems="CENTER" counterAxisAlignItems="CENTER"
    paddingLeft={12} paddingRight={12} paddingTop={8} paddingBottom={8} cornerRadius={999}
    fills={${solid(0, 0.3333, 1)}}>
    <Text name="label" characters="{label}" fontSize={14} />
  </Component>`,
    `\n<Styles>\n${styles}\n</Styles>\n${CONTRACT}`,
  )

/** A pill whose hover row colours its label. */
const TINTED = pill(
  'Tinted',
  `  <Style state="hover" root:fills={${solid(0.37, 0.57, 0.99)}} label:fills={${solid(0.1, 0.1, 0.1)}} />`,
)
/** A pill whose hover row rounds it with the shorthand. */
const ROUNDED = pill('Rounded', `  <Style state="hover" root:cornerRadius={2} />`)
/** A label and a caption, whose hover row colours only the label. */
const CAPTIONED = page(
  'captioned',
  `  <Component name="Captioned" status="draft" layoutMode="HORIZONTAL" primaryAxisSizingMode="AUTO" counterAxisSizingMode="AUTO">
    <Text name="label" characters="{label}" fontSize={14} />
    <Text name="caption" characters="Caption" fontSize={12} fills="{text#default}" />
  </Component>`,
  `\n<Styles>\n  <Style state="hover" label:fills={${solid(0.1, 0.1, 0.1)}} />\n</Styles>\n${CONTRACT}`,
)

/** A card that lays itself out around a title and two Button1s, one stating its own text colour. */
const CARD = page(
  'card',
  `  <Component name="Card" layoutMode="VERTICAL" primaryAxisSizingMode="AUTO" counterAxisSizingMode="AUTO">
    <Text name="title" characters="Title" fontSize={14} />
    <Instance name="cta" component="Button1" props={{ label: 'Go' }} />
    <Instance name="own" component="Button1" props={{ label: 'Mine' }} textFills={${GREEN}} />
  </Component>`,
)
/** A composition, as CheckboxField is, whose definition styles the instance it holds. */
const BOXED = page(
  'boxed',
  `  <Component name="Boxed">
    <Instance name="field" component="Field" props={{ label: 'Boxed' }} fills={${GREEN}} paddingLeft={4} />
  </Component>`,
)
/** A composition whose definition colours the texts of the instance it holds. */
const QUIET = page(
  'quiet',
  `  <Component name="Quiet">
    <Instance name="field" component="Field" props={{ label: 'Quiet' }} textFills="{text#muted}" />
  </Component>`,
)
/** A composition that passes its own prop through to the instance it holds. */
const TOGGLE = page(
  'toggle',
  `  <Component name="Toggle">
    <Instance name="box" component="Checkbox" props={{ checked: '{checked}' }} />
  </Component>`,
  `
## Contract

<Props>
  <Prop name="checked" type="boolean" default={false}>Whether it is on.</Prop>
</Props>
`,
)
/** A tip whose warning is hidden until something shows it. */
const HINT = page(
  'hint',
  `  <Component name="Hint" layoutMode="VERTICAL" primaryAxisSizingMode="AUTO" counterAxisSizingMode="AUTO">
    <Text name="tip" characters="Tip" fontSize={12} fills="{text#default}" />
    <Text name="warning" characters="Careful" fontSize={12} visible={false} fills="{text#danger}" />
  </Component>`,
)
/** Two texts and no layout: drawn as the hugging column every bare component is. */
const STACK = page(
  'stack',
  `  <Component name="Stack">
    <Text name="a" characters="A" fontSize={12} />
    <Text name="b" characters="B" fontSize={12} />
  </Component>`,
)
/** A frame around one slot, and no text of its own. */
const WELL = page(
  'well',
  `  <Component name="Well">
    <Frame name="frame" layoutMode="VERTICAL" primaryAxisSizingMode="AUTO" counterAxisSizingMode="AUTO" paddingLeft={8}>
      <Slot name="body" />
    </Frame>
  </Component>`,
)

const HUG = 'layoutMode="HORIZONTAL" primaryAxisSizingMode="AUTO" counterAxisSizingMode="AUTO"'
/**
 * The Shoelace example's shape: the look on a frame inside a frame of the
 * component's own that only wraps it, with a styles table.
 */
const SHELL = page(
  'shell',
  `  <Component name="Shell" status="draft" ${HUG}>
    <Frame name="base" ${HUG} itemSpacing={4} paddingLeft={12} cornerRadius={6} fills={${GREY}} strokeWeight={1}>
      <Text name="label" characters="{label}" fontSize={14} fills="{text#default}" />
    </Frame>
  </Component>`,
  `\n<Styles>\n  <Style state="hover" base:fills={${GREEN}} />\n</Styles>\n${CONTRACT}`,
)
/** The same without a styles table: it lays itself out around the one frame. */
const PLAQUE = page(
  'plaque',
  `  <Component name="Plaque" status="draft" ${HUG}>
    <Frame name="base" ${HUG} paddingLeft={12} fills={${GREY}}>
      <Text name="label" characters="{label}" fontSize={14} />
    </Frame>
  </Component>`,
  CONTRACT,
)
/** A composition through the root its styles table derives, whose definition colours the held texts. */
const DUO = page(
  'duo',
  `  <Component name="Duo" status="draft">
    <Instance name="field" component="Field" props={{ label: 'Duo' }} fills={${GREEN}} textFills="{text#muted}" />
  </Component>`,
  `\n<Styles>\n  <Style state="hover" root:opacity={0.9} />\n</Styles>\n${CONTRACT}`,
)

const LOCAL = [
  TINTED,
  ROUNDED,
  CAPTIONED,
  CARD,
  BOXED,
  QUIET,
  TOGGLE,
  HINT,
  STACK,
  WELL,
  SHELL,
  PLAQUE,
  DUO,
]

interface Built extends SceneResult {
  doc: UidxDocument
  docs: Map<string, UidxDocument>
}

/** `body` on a page of its own, drawn with the library and the local components. */
function scene(body: string): Built {
  const doc = parseOrThrow(page('use', body), 'use.uidx')
  const docs = new Map<string, UidxDocument>(LIBRARY)
  LOCAL.forEach((source, index) => docs.set(`local-${index}.uidx`, parseOrThrow(source)))
  docs.set('use.uidx', doc)
  return { doc, docs, ...buildPage(docs, doc) }
}

/** The options `buildPage` draws with: the scope a use on the page itself is written in. */
function optionsFor(docs: ReadonlyMap<string, UidxDocument>): SceneOptions {
  const all = [...docs.values()]
  const index = buildTokenIndex(all)
  const literals = resolveTokenValues(all)
  const components = new Map<string, UidxNode>()
  for (const doc of all)
    for (const child of doc.tree.children)
      if (child.element === 'Component') components.set(child.name, child)
  return {
    resolveAlias: (address) => literals.get(address),
    resolveComponent: (name) => components.get(name),
    tokens: { resolver: new TokenResolver(index), index },
    models: modelIndex(all),
  }
}

/** What the panel reads for the use at `address` on a page holding `body`. */
function baseOf(body: string, address = 'b') {
  const built = scene(body)
  const options = optionsFor(built.docs)
  const instance = resolve(built.doc.tree, address)!
  return instanceBase(instance, instanceDefinition(instance, options), options)
}

describe('what an instance inherits (instanceBase)', () => {
  it('Button1: the values of the frame its box lands on, as the component writes them', () => {
    const base = baseOf(`  <Instance name="b" component="Button1" />`)!
    expect(base.target).toEqual({ kind: 'frame', id: 'b#root' })
    expect(base.values.fills).toEqual(BLUE_PAINTS)
    expect(base.values.cornerRadius).toBe(999)
    expect(base.values.paddingLeft).toBe(12)
    expect(base.values.paddingTop).toBe(8)
    // What the component does not state is left out: an engine default never shows.
    expect(base.values).not.toHaveProperty('strokes')
    expect(base.values).not.toHaveProperty('opacity')
    expect(base.stateWins.size).toBe(0)
  })

  it('keeps a token-bound value as its alias', () => {
    const base = baseOf(`  <Instance name="b" component="Button" />`)!
    expect(base.values).toMatchObject({
      fills: '{surface#accent}',
      strokes: '{surface#accent}',
      strokeWeight: 1,
      cornerRadius: '{radius#md}',
      paddingLeft: '{space#md}',
      paddingTop: '{space#sm}',
    })
  })

  it('reads the combination the use asks for, enum rows being its resting look', () => {
    const base = baseOf(
      `  <Instance name="b" component="Button" props={{ variant: 'secondary', size: 'small' }} />`,
    )!
    expect(base.values).toMatchObject({
      fills: '{surface#raised}',
      strokes: '{border#default}',
      paddingLeft: '{space#sm}',
    })
    expect(base.stateWins.size).toBe(0)
  })

  it('says which properties a state the use selects sets', () => {
    const checked = baseOf(
      `  <Instance name="b" component="Checkbox" props={{ checked: true }} />`,
    )!
    expect(checked.stateWins.get('fills')).toBe('checked')
    expect(checked.stateWins.get('strokes')).toBe('checked')
    expect(checked.values.fills).toBe('{surface#accent}')

    const unchecked = baseOf(`  <Instance name="b" component="Checkbox" />`)!
    expect(unchecked.stateWins.size).toBe(0)
    expect(unchecked.values.fills).toBe('{surface#control}')

    const hover = baseOf(`  <Instance name="b" component="Button1" props={{ state: 'hover' }} />`)!
    expect(hover.stateWins.get('fills')).toBe('hover')
    expect(hover.stateWins.has('cornerRadius')).toBe(false)
  })

  it('counts each corner a state’s cornerRadius masks', () => {
    const base = baseOf(`  <Instance name="b" component="Rounded" props={{ state: 'hover' }} />`)!
    for (const prop of [
      'cornerRadius',
      'topLeftRadius',
      'topRightRadius',
      'bottomRightRadius',
      'bottomLeftRadius',
    ])
      expect(base.stateWins.get(prop)).toBe('hover')
    expect(base.values.cornerRadius).toBe(2)
  })

  it('a component that lays itself out: the instance’s own node', () => {
    const base = baseOf(`  <Instance name="c" component="Chip" props={{ label: 'Chip' }} />`, 'c')!
    expect(base.target).toEqual({ kind: 'self', id: 'c' })
    expect(base.values).toMatchObject({
      fills: '{surface#raised}',
      cornerRadius: 6,
      paddingLeft: 8,
    })
    expect(base.layout).toEqual({
      layoutMode: 'HORIZONTAL',
      itemSpacing: 4,
      counterAxisAlignItems: 'CENTER',
    })
  })

  it('a bare component around one frame, and an authored variant: that frame', () => {
    const tag = baseOf(`  <Instance name="t" component="Tag" props={{ label: 'Tag' }} />`, 't')!
    expect(tag.target).toEqual({ kind: 'frame', id: 't#box' })
    expect(tag.values).toMatchObject({ fills: '{surface#raised}', strokeWeight: 1, paddingLeft: 6 })

    const badge = baseOf(
      `  <Instance name="badge" component="Badge" props={{ tone: 'warn' }} />`,
      'badge',
    )!
    expect(badge.target).toEqual({ kind: 'frame', id: 'badge#badge' })
    expect(badge.values).toMatchObject({ fills: '{surface#danger}', topLeftRadius: 8 })
  })

  it('a composition: the box node of the instance it holds, under what the definition wrote there', () => {
    const field = baseOf(`  <Instance name="cf" component="CheckboxField" />`, 'cf')!
    expect(field.target).toEqual({ kind: 'instance', id: 'cf#field/root' })
    // Field's frame states no outer box of its own.
    expect(field.values).toEqual({})
    expect(field.layout).toEqual({
      layoutMode: 'HORIZONTAL',
      itemSpacing: '{space#sm}',
      counterAxisAlignItems: 'MIN',
    })

    const boxed = baseOf(`  <Instance name="bx" component="Boxed" />`, 'bx')!
    expect(boxed.target).toEqual({ kind: 'instance', id: 'bx#field/root' })
    expect(boxed.values).toEqual({ fills: paints(0, 0.5, 0), paddingLeft: 4 })
  })

  it('a frame found through a wrapper: that frame, whose values and state it reads', () => {
    const shell = baseOf(`  <Instance name="b" component="Shell" />`)!
    expect(shell.target).toEqual({ kind: 'frame', id: 'b#root/base' })
    expect(shell.values).toEqual({
      fills: paints(0.2, 0.2, 0.2),
      cornerRadius: 6,
      paddingLeft: 12,
      strokeWeight: 1,
    })
    expect(shell.layout).toEqual({ layoutMode: 'HORIZONTAL', itemSpacing: 4 })
    const hover = baseOf(`  <Instance name="b" component="Shell" props={{ state: 'hover' }} />`)!
    expect(hover.stateWins.get('fills')).toBe('hover')

    const plaque = baseOf(`  <Instance name="p" component="Plaque" />`, 'p')!
    expect(plaque.target).toEqual({ kind: 'frame', id: 'p#base' })
    expect(plaque.values).toEqual({ fills: paints(0.2, 0.2, 0.2), paddingLeft: 12 })
  })

  it('a composition found through a wrapper: the box node of the instance it holds', () => {
    const duo = baseOf(`  <Instance name="d" component="Duo" />`, 'd')!
    expect(duo.target).toEqual({ kind: 'instance', id: 'd#root/field/root' })
    expect(duo.values).toEqual({ fills: paints(0, 0.5, 0) })
    expect(duo.text).toBe('{text#muted}')
  })

  it('a composition passes the state its props select through to the instance it holds', () => {
    const on = baseOf(
      `  <Instance name="tg" component="Toggle" props={{ checked: true }} />`,
      'tg',
    )!
    expect(on.target).toEqual({ kind: 'instance', id: 'tg#box/root' })
    expect(on.stateWins.get('fills')).toBe('checked')
    const off = baseOf(`  <Instance name="tg" component="Toggle" />`, 'tg')!
    expect(off.stateWins.size).toBe(0)
  })

  it('reads the layout the box node draws with, for the locked row', () => {
    expect(baseOf(`  <Instance name="b" component="Button1" />`)!.layout).toEqual({
      layoutMode: 'HORIZONTAL',
      primaryAxisAlignItems: 'CENTER',
      counterAxisAlignItems: 'CENTER',
    })
    // A component that says nothing about layout is drawn as a hugging column.
    expect(baseOf(`  <Instance name="s" component="Stack" />`, 's')!.layout).toEqual({
      layoutMode: 'VERTICAL',
    })
  })

  describe('the text colour', () => {
    it('is one colour when every text the use reaches shows it', () => {
      expect(baseOf(`  <Instance name="b" component="Button" />`)!.text).toBe('{text#onAccent}')
      expect(
        baseOf(`  <Instance name="b" component="Button" props={{ variant: 'secondary' }} />`)!.text,
      ).toBe('{text#default}')
      // A label that states no fills draws in the engine's black.
      expect(baseOf(`  <Instance name="b" component="Button1" />`)!.text).toEqual(ENGINE_TEXT)
    })

    it('is mixed when they differ, through a composition too', () => {
      expect(baseOf(`  <Instance name="b" component="Field" />`)!.text).toBe('mixed')
      expect(baseOf(`  <Instance name="cf" component="CheckboxField" />`, 'cf')!.text).toBe('mixed')
    })

    it('is null when nothing the use draws is a text it reaches', () => {
      expect(baseOf(`  <Instance name="b" component="Checkbox" />`)!.text).toBeNull()
    })

    it('is what a state colours the texts, where it colours every one, and the state says so', () => {
      const hover = baseOf(
        `  <Instance name="t" component="Tinted" props={{ state: 'hover' }} />`,
        't',
      )!
      // The use's colour reaches no text in hover, and the label still draws:
      // in the hover row's colour, as `values` keeps the hover row's fill.
      expect(hover.text).toEqual(paints(0.1, 0.1, 0.1))
      expect(hover.stateWins.get('textFills')).toBe('hover')
      const rest = baseOf(`  <Instance name="t" component="Tinted" />`, 't')!
      expect(rest.text).toEqual(ENGINE_TEXT)
      expect(rest.stateWins.has('textFills')).toBe(false)
    })

    it('leaves out a text a state colours while the use still reaches another', () => {
      const hover = baseOf(
        `  <Instance name="c" component="Captioned" props={{ state: 'hover' }} />`,
        'c',
      )!
      expect(hover.text).toBe('{text#default}')
      expect(hover.stateWins.get('textFills')).toBe('hover')
    })

    it('leaves out a text the overrides map colours, over a state too', () => {
      const overridden = baseOf(
        `  <Instance name="t" component="Tinted" props={{ state: 'hover' }} overrides={{ 'root/label': { fills: ${RED} } }} />`,
        't',
      )!
      expect(overridden.text).toBeNull()
      expect(overridden.stateWins.has('textFills')).toBe(false)
    })

    it('is the colour a composition’s definition hands the instance it holds', () => {
      expect(baseOf(`  <Instance name="q" component="Quiet" />`, 'q')!.text).toBe('{text#muted}')
    })

    it('is decided by the texts that show', () => {
      expect(baseOf(`  <Instance name="h" component="Hint" />`, 'h')!.text).toBe('{text#default}')
    })

    it('reaches slot content that states no fills, and nothing that states its own', () => {
      const bare = baseOf(
        `  <Instance name="w" component="Well"><Slot name="body"><Text name="t" characters="Hi" fontSize={12} /></Slot></Instance>`,
        'w',
      )!
      expect(bare.text).toEqual(ENGINE_TEXT)
      const own = baseOf(
        `  <Instance name="w" component="Well"><Slot name="body"><Text name="t" characters="Hi" fontSize={12} fills="{text#muted}" /></Slot></Instance>`,
        'w',
      )!
      expect(own.text).toBeNull()
      const coloured = baseOf(
        `  <Instance name="w" component="Well"><Slot name="body"><Instance name="b" component="Button1" textFills={${RED}} /></Slot></Instance>`,
        'w',
      )!
      expect(coloured.text).toBeNull()
    })

    it('is the colour an enclosing use hands down, when the scope carries one', () => {
      const built = scene(`  <Instance name="b" component="Field" />`)
      const options = { ...optionsFor(built.docs), textFills: paints(0, 0.5, 0) }
      const instance = resolve(built.doc.tree, 'b')!
      const base = instanceBase(instance, instanceDefinition(instance, options), options)!
      expect(base.text).toEqual(paints(0, 0.5, 0))
    })
  })

  it('is null without a definition', () => {
    const built = scene(`  <Instance name="b" component="Nowhere" />`)
    const options = optionsFor(built.docs)
    const instance = resolve(built.doc.tree, 'b')!
    expect(instanceBase(instance, undefined, options)).toBeNull()
    expect(instanceBase(instance, instanceDefinition(instance, options), options)).toBeNull()
  })
})

/** The use at `id` in a page holding `body`, with the scene a build drew for it. */
function use(body: string, id: string) {
  const built = scene(body)
  const options = optionsFor(built.docs)
  const instance = resolve(built.doc.tree, id)!
  return { built, options, instance, definition: instanceDefinition(instance, options) }
}

/** The preview of the use at `id` going from `from` to `to`, with no outer colour. */
function preview(from: string, to: string, id: string) {
  const drawn = use(from, id)
  const next = use(to, id)
  return instancePreview(
    drawn.instance,
    next.instance,
    next.definition,
    drawn.options,
    undefined,
    drawn.built.textTargets.get(id),
  )
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

describe('previewing a box edit (instancePreview)', () => {
  it('draws new fills on b#root and none on the instance’s own node', () => {
    const updates = preview(
      `  <Instance name="b" component="Button1" />`,
      `  <Instance name="b" component="Button1" fills={${RED}} />`,
      'b',
    )!
    expect(updates.map((update) => update.id)).toEqual(['b#root'])
    expect(colour(updates[0]!.props.fills)).toEqual({ r: 1, g: 0, b: 0, a: 1 })
  })

  it('draws on the instance itself for a component that lays itself out', () => {
    const updates = preview(
      `  <Instance name="c" component="Chip" props={{ label: 'Chip' }} />`,
      `  <Instance name="c" component="Chip" props={{ label: 'Chip' }} fills={${RED}} />`,
      'c',
    )!
    expect(updates.map((update) => update.id)).toEqual(['c'])
    expect(colour(updates[0]!.props.fills)).toEqual({ r: 1, g: 0, b: 0, a: 1 })
  })

  it('recolours exactly the texts the use’s colour reaches, nested ones included', () => {
    const drawn = use(`  <Instance name="c" component="Card" />`, 'c')
    const next = use(`  <Instance name="c" component="Card" textFills={${RED}} />`, 'c')
    const targets = drawn.built.textTargets.get('c')!
    expect(targets).toEqual(['c#title', 'c#cta/root/label'])
    const updates = instancePreview(
      drawn.instance,
      next.instance,
      next.definition,
      drawn.options,
      undefined,
      targets,
    )!
    expect(updates.map((update) => update.id)).toEqual(targets)
    for (const update of updates)
      expect(colour(update.props.fills)).toEqual({ r: 1, g: 0, b: 0, a: 1 })
  })

  it('moves nothing when nothing changed', () => {
    const body = `  <Instance name="b" component="Button1" fills={${RED}} textFills={${GREEN}} />`
    expect(preview(body, body, 'b')).toEqual([])
  })

  it('is null without a definition', () => {
    const drawn = use(`  <Instance name="b" component="Nowhere" />`, 'b')
    expect(
      instancePreview(drawn.instance, drawn.instance, undefined, drawn.options, undefined, []),
    ).toBeNull()
  })

  /**
   * The preview's promise: the scene with the preview laid on it, laid out
   * again, is the scene a rebuild of the edited file draws — every node of
   * the instance, every field the dump compares.
   */
  describe('equals the rebuild of the edited file', () => {
    /**
     * The page holding `from`, with the preview to `to` applied and laid out,
     * beside the page holding `to` built fresh, both cut to the nodes at or
     * under `id`. `entity` is the top-level node to lay out again; `scope`
     * adds what an enclosing use hands down.
     */
    const previewed = (
      from: string,
      to: string,
      id: string,
      { entity = id, scope = {} }: { entity?: string; scope?: Partial<SceneOptions> } = {},
    ) => {
      const live = scene(from)
      const rebuilt = scene(to)
      const options = { ...optionsFor(live.docs), ...scope }
      const at = (doc: UidxDocument): UidxNode => {
        const node = resolve(doc.tree, live.addresses.addressOf(id) ?? id)!
        return { ...node, address: id }
      }
      const next = at(rebuilt.doc)
      const within = ({ id: node }: { id: string }) =>
        node === id || node.startsWith(`${id}#`) || node.startsWith(`${id}/`)
      const target = dumpScene(rebuilt).filter(within)
      // Each case is an edit the scene shows, so a preview that moved nothing fails.
      expect(target.length).toBeGreaterThan(1)
      expect(dumpScene(live).filter(within)).not.toEqual(target)
      const updates = instancePreview(
        at(live.doc),
        next,
        instanceDefinition(next, options),
        options,
        live.graph.getNode(live.graph.getNode(id)!.parentId!)?.layoutMode,
        live.textTargets.get(id),
      )
      expect(updates).not.toBeNull()
      for (const update of updates!) live.graph.updateNode(update.id, update.props)
      layOutEntity(live.graph, entity, live.pins)
      return { updates: updates!, live: dumpScene(live).filter(within), rebuilt: target }
    }

    const STYLED = `fills={${RED}} strokes={${GREY}} strokeWeight={2} cornerRadius={4} paddingLeft={24} opacity={0.5} effects={${SHADOW}}`

    it('setting and clearing every kind of box value on Button1', () => {
      const plain = `  <Instance name="b" component="Button1" />`
      const styled = `  <Instance name="b" component="Button1" ${STYLED} />`
      for (const [from, to] of [
        [plain, styled],
        [styled, plain],
      ]) {
        const { live, rebuilt, updates } = previewed(from!, to!, 'b')
        expect(updates.length).toBeGreaterThan(0)
        expect(live).toEqual(rebuilt)
      }
    })

    it('a weight alone, over the component’s own strokes', () => {
      const { live, rebuilt } = previewed(
        `  <Instance name="b" component="Button" />`,
        `  <Instance name="b" component="Button" strokeWeight={3} strokeBottomWeight={6} />`,
        'b',
      )
      expect(live).toEqual(rebuilt)
    })

    it('set and cleared on a component that lays itself out', () => {
      const plain = `  <Instance name="c" component="Chip" props={{ label: 'Chip' }} />`
      const styled = `  <Instance name="c" component="Chip" props={{ label: 'Chip' }} ${STYLED} />`
      for (const [from, to] of [
        [plain, styled],
        [styled, plain],
      ]) {
        const { live, rebuilt, updates } = previewed(from!, to!, 'c')
        expect(updates.map((update) => update.id)).toEqual(['c'])
        expect(live).toEqual(rebuilt)
      }
    })

    it('a shorthand over an authored variant’s corners', () => {
      const { live, rebuilt } = previewed(
        `  <Instance name="badge" component="Badge" props={{ tone: 'info' }} />`,
        `  <Instance name="badge" component="Badge" props={{ tone: 'info' }} cornerRadius={2} strokeWeight={4} />`,
        'badge',
      )
      expect(live).toEqual(rebuilt)
    })

    it('a frame found through a wrapper, and the instance a wrapper holds', () => {
      // The size lands with the box on a frame, and on the held instance's
      // own node for a composition, which hands it on.
      for (const [name, moves] of [
        ['Shell', ['b#root/base']],
        ['Plaque', ['b#base']],
        ['Duo', ['b#root/field', 'b#root/field/root']],
      ] as const) {
        const plain = `  <Instance name="b" component="${name}" />`
        const styled = `  <Instance name="b" component="${name}" ${STYLED} width={199} />`
        for (const [from, to] of [
          [plain, styled],
          [styled, plain],
        ]) {
          const { live, rebuilt, updates } = previewed(from!, to!, 'b')
          expect(
            updates.map((update) => update.id).filter((at) => at !== 'b'),
            name,
          ).toEqual(moves)
          expect(live, name).toEqual(rebuilt)
        }
      }
    })

    it('a composition’s box, drawn by the instance it holds', () => {
      const { live, rebuilt, updates } = previewed(
        `  <Instance name="cf" component="CheckboxField" />`,
        `  <Instance name="cf" component="CheckboxField" fills={${RED}} paddingLeft={20} cornerRadius={6} />`,
        'cf',
      )
      expect(updates.map((update) => update.id)).toEqual(['cf#field/root'])
      expect(live).toEqual(rebuilt)
    })

    it('a text colour set and cleared through nested instances', () => {
      const plain = `  <Instance name="c" component="Card" />`
      const coloured = `  <Instance name="c" component="Card" textFills={${RED}} />`
      const set = previewed(plain, coloured, 'c')
      expect(set.live).toEqual(set.rebuilt)
      const back = previewed(coloured, plain, 'c')
      expect(back.updates.map((update) => update.id)).toEqual(['c#title', 'c#cta/root/label'])
      expect(back.live).toEqual(back.rebuilt)
    })

    it('a text colour, which leaves a text the overrides map colours', () => {
      const card = (more: string) =>
        `  <Instance name="c" component="Card" overrides={{ title: { fills: ${GREEN} } }}${more} />`
      const coloured = previewed(card(''), card(` textFills={${RED}}`), 'c')
      expect(coloured.updates.map((update) => update.id)).toEqual(['c#cta/root/label'])
      expect(coloured.live).toEqual(coloured.rebuilt)

      const button = (more: string) =>
        `  <Instance name="b" component="Button1" overrides={{ 'root/label': { fills: ${GREEN} } }}${more} />`
      const styled = previewed(button(''), button(` strokes={${GREY}} textFills={${RED}}`), 'b')
      expect(styled.updates.map((update) => update.id)).toEqual(['b#root'])
      expect(styled.live).toEqual(styled.rebuilt)
    })

    it('a text colour cleared from a composition, back to each text’s own', () => {
      const { live, rebuilt } = previewed(
        `  <Instance name="cf" component="CheckboxField" textFills={${RED}} />`,
        `  <Instance name="cf" component="CheckboxField" />`,
        'cf',
      )
      expect(live).toEqual(rebuilt)
    })

    it('a text colour cleared from a composition whose definition colours its texts', () => {
      const { live, rebuilt } = previewed(
        `  <Instance name="q" component="Quiet" textFills={${RED}} />`,
        `  <Instance name="q" component="Quiet" />`,
        'q',
      )
      expect(live).toEqual(rebuilt)
    })

    it('a text colour cleared from slot content, which keeps fills it states', () => {
      const fill = `<Slot name="control">
      <Text name="bare" characters="Inherits" fontSize={12} />
      <Text name="own" characters="Keeps" fontSize={12} fills="{text#muted}" />
      <Instance name="tag" component="Tag" props={{ label: 'Tag' }} />
    </Slot>`
      const { live, rebuilt } = previewed(
        `  <Instance name="f" component="Field" props={{ label: 'Status' }} textFills={${RED}}>${fill}</Instance>`,
        `  <Instance name="f" component="Field" props={{ label: 'Status' }}>${fill}</Instance>`,
        'f',
      )
      expect(live).toEqual(rebuilt)
    })

    it('a text colour cleared from every row a repeat draws', () => {
      const { live, rebuilt, updates } = previewed(
        `  <Instance name="cl" component="ContactList" textFills={${RED}} />`,
        `  <Instance name="cl" component="ContactList" />`,
        'cl',
      )
      expect(updates.some((update) => update.id.includes('/option-2/'))).toBe(true)
      expect(live).toEqual(rebuilt)
    })

    it('a text colour cleared, back to the one an enclosing use hands down', () => {
      const body = (own: string) =>
        `  <Instance name="outer" component="Well" textFills={${GREEN}}>
    <Slot name="body"><Instance name="b" component="Button1"${own} /></Slot>
  </Instance>`
      const outer = scene(body(''))
      const green = boxValue(
        resolve(outer.doc.tree, 'outer')!,
        'textFills',
        optionsFor(outer.docs).resolveAlias,
        [],
      )
      const { live, rebuilt } = previewed(
        body(` textFills={${RED}}`),
        body(''),
        'outer#frame/body/b',
        {
          entity: 'outer',
          scope: { textFills: green },
        },
      )
      expect(live.length).toBeGreaterThan(1)
      expect(live).toEqual(rebuilt)
    })

    it('a stretch let go, which fixes the axis at the size the use states', () => {
      const column = (more: string) =>
        `  <Frame name="col" x={0} y={0} width={300} height={200} layoutMode="VERTICAL">
    <Instance name="b" component="Button1" width={50}${more} />
  </Frame>`
      const { live, rebuilt } = previewed(column(' layoutAlign="STRETCH"'), column(''), 'col#b', {
        entity: 'col',
      })
      expect(live).toEqual(rebuilt)
    })

    it('every override reset at once, the stated size with them', () => {
      for (const [from, id] of [
        [
          `  <Instance name="b" component="Button1" width={199} height={33} ${STYLED} textFills={${GREEN}} />`,
          'b',
        ],
        [
          `  <Instance name="cf" component="CheckboxField" width={300} fills={${RED}} textFills={${GREEN}} />`,
          'cf',
        ],
      ] as const) {
        const component = id === 'b' ? 'Button1' : 'CheckboxField'
        const { live, rebuilt } = previewed(
          from,
          `  <Instance name="${id}" component="${component}" />`,
          id,
        )
        expect(live).toEqual(rebuilt)
      }
    })
  })
})
