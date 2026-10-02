import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseOrThrow, resolve, type UidxDocument, type UidxNode } from '@uidx/format'
import type { SceneNode } from '@open-pencil/scene-graph'
import {
  buildTokenIndex,
  modelIndex,
  resolveTokenValues,
  TokenResolver,
  type SceneResult,
} from '../src/index.js'
import { deriveVariants } from '../src/design-system.js'
import { generatedChildProps, type SceneOptions } from '../src/to-scene.js'
import { buildPage, repo } from './helpers/workspace-scene.js'

/**
 * An instance restyled from outside (ADR 0018), as every scene target draws
 * it: the box lands on the node that draws the component's box, beneath the
 * component's state rows, merged attribute by attribute; the inside stays the
 * component's; and `textFills` recolours every text the use draws, the way CSS
 * `color` inherits.
 */
const page = (id: string, body: string, regions = '') =>
  `---\nid: ${id}\n---\n\n## Visual Contract\n\n<Page>\n${body}\n</Page>\n${regions}`

/**
 * The components the uses below place: the design-system example's, by name
 * rather than by scanning its folder (a scratch page there must not join), and
 * the instance-box fixture's Button1, Chip, Tag and Badge.
 */
const LIBRARY = [
  'examples/design-system/.uidx/tokens.uidx',
  'examples/design-system/.uidx/button.uidx',
  'examples/design-system/.uidx/checkbox.uidx',
  'examples/design-system/.uidx/checkbox-field.uidx',
  'examples/design-system/.uidx/field.uidx',
  'packages/schema/test/fixtures/instance-box/button1.uidx',
  'packages/schema/test/fixtures/instance-box/kinds.uidx',
].map((file) => [file, parseOrThrow(readFileSync(join(repo, file), 'utf8'), file)] as const)

const BUTTON1 = 'packages/schema/test/fixtures/instance-box/button1.uidx'

const CONTRACT = `
## Contract

<Props>
  <Prop name="label" type="string" sample="Button1">The words it shows.</Prop>
</Props>
`

const solid = (r: number, g: number, b: number) =>
  `[{ type: 'SOLID', color: { r: ${r}, g: ${g}, b: ${b}, a: 1 } }]`
const RED = solid(1, 0, 0)
const GREEN = solid(0, 0.5, 0)
const GREY = solid(0.2, 0.2, 0.2)

/** Button1's pill, under another name, with `extra` on its root and `styles` as its table. */
const pill = (name: string, styles: string, extra = '') =>
  page(
    name.toLowerCase(),
    `  <Component name="${name}" status="draft"
    layoutMode="HORIZONTAL" primaryAxisSizingMode="AUTO" counterAxisSizingMode="AUTO"
    primaryAxisAlignItems="CENTER" counterAxisAlignItems="CENTER"
    paddingLeft={12} paddingRight={12} paddingTop={8} paddingBottom={8} cornerRadius={999}
    fills={${solid(0, 0.3333, 1)}} ${extra}>
    <Text name="label" characters="{label}" fontSize={14} />
  </Component>`,
    `${styles}${CONTRACT}`,
  )

/** A pill with a stroke of its own, weight 3. */
const STROKED = pill(
  'Stroked',
  `\n<Styles>\n  <Style state="hover" root:fills={${solid(0.37, 0.57, 0.99)}} />\n</Styles>\n`,
  `strokes={${GREY}} strokeWeight={3}`,
)
/** A pill whose hover row colours its label. */
const TINTED = pill(
  'Tinted',
  `\n<Styles>\n  <Style state="hover" root:fills={${solid(0.37, 0.57, 0.99)}} label:fills={${solid(0.1, 0.1, 0.1)}} />\n</Styles>\n`,
)
/** A pill with no styles table: it lays itself out, so its box is the instance's own node. */
const PLAIN = pill('Plain', '')
/** A card that lays itself out around a title and two Button1s, one stating its own text colour. */
const CARD = page(
  'card',
  `  <Component name="Card" layoutMode="VERTICAL" primaryAxisSizingMode="AUTO" counterAxisSizingMode="AUTO">
    <Text name="title" characters="Title" fontSize={14} />
    <Vector name="mark" width={6} height={6} fills={${GREY}}
      vectorPaths={[{ windingRule: 'NONZERO', data: 'M0 0 L6 0 L6 6 Z' }]} />
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

/** The design-system tokens, plus a collection with two modes, for the alias-scope cases. */
const THEMED = `---
id: themed
---

## Visual Contract

<Tokens>
  <Collection name="tone" modes={['light', 'dark']}>
    <Variable name="danger" type="COLOR">
      <Mode name="light" value={{ r: 1, g: 0, b: 0, a: 1 }} />
      <Mode name="dark" value={{ r: 0.5, g: 0, b: 0, a: 1 }} />
    </Variable>
  </Collection>
</Tokens>
`

interface Built extends SceneResult {
  doc: UidxDocument
  docs: Map<string, UidxDocument>
}

/** `body` on a page of its own, drawn with the library and any `local` documents. */
function scene(body: string, ...local: string[]): Built {
  const doc = parseOrThrow(page('use', body), 'use.uidx')
  const docs = new Map<string, UidxDocument>(LIBRARY)
  local.forEach((source, index) => docs.set(`local-${index}.uidx`, parseOrThrow(source)))
  docs.set('use.uidx', doc)
  return { doc, docs, ...buildPage(docs, doc) }
}

/** The options `buildPage` draws with, for a caller of the incremental path. */
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

const node = (built: Built, id: string): SceneNode => {
  const found = built.graph.getNode(id)
  if (!found) throw new Error(`no scene node ${id}`)
  return found
}

/** The colour of a node's first paint, rounded to three places. */
const colour = (paints: readonly unknown[] | undefined): Record<string, number> | undefined => {
  const color = (paints?.[0] as { color?: Record<string, number> } | undefined)?.color
  if (!color) return undefined
  return Object.fromEntries(
    Object.entries(color).map(([key, value]) => [key, Math.round(value * 1000) / 1000]),
  )
}
const fillOf = (built: Built, id: string) => colour(node(built, id).fills)

const C = {
  red: { r: 1, g: 0, b: 0, a: 1 },
  green: { r: 0, g: 0.5, b: 0, a: 1 },
  grey: { r: 0.2, g: 0.2, b: 0.2, a: 1 },
  blue: { r: 0, g: 0.333, b: 1, a: 1 },
  hover: { r: 0.368, g: 0.574, b: 0.988, a: 1 },
  danger: { r: 0.863, g: 0.149, b: 0.149, a: 1 },
  accent: { r: 0.051, g: 0.6, b: 1, a: 1 },
  white: { r: 1, g: 1, b: 1, a: 1 },
  muted: { r: 0.443, g: 0.443, b: 0.478, a: 1 },
  black: { r: 0, g: 0, b: 0, a: 1 },
  tint: { r: 0.1, g: 0.1, b: 0.1, a: 1 },
}

const SHADOW = `[{ type: 'DROP_SHADOW', color: { r: 0, g: 0, b: 0, a: 0.25 }, offset: { x: 0, y: 2 }, radius: 4, spread: 0, visible: true }]`

describe('the box lands on the node that draws it (ADR 0018 §2)', () => {
  it('a styled component: on its derived root, never on the wrapper', () => {
    const built = scene(
      `  <Instance name="b" component="Button1" fills={${RED}} strokes={${GREY}} strokeWeight={2}
    cornerRadius={4} effects={${SHADOW}} opacity={0.5} />`,
    )
    const root = node(built, 'b#root')
    expect(colour(root.fills)).toEqual(C.red)
    expect(colour(root.strokes)).toEqual(C.grey)
    expect(root.strokes[0]!.weight).toBe(2)
    expect(root.cornerRadius).toBe(4)
    expect(root.effects).toHaveLength(1)
    expect(root.opacity).toBe(0.5)

    const wrapper = node(built, 'b')
    expect(wrapper.fills).toEqual([])
    expect(wrapper.strokes).toEqual([])
    expect(wrapper.effects).toEqual([])
    expect(wrapper.opacity).toBe(1)
    expect(wrapper.cornerRadius).toBe(0)
  })

  it('a component that lays itself out: on the instance’s own node', () => {
    const built = scene(
      `  <Instance name="c" component="Chip" props={{ label: 'Chip' }} fills={${RED}} paddingLeft={20} />`,
    )
    expect(fillOf(built, 'c')).toEqual(C.red)
    expect(node(built, 'c').paddingLeft).toBe(20)
  })

  it('a bare component around one frame: on that frame', () => {
    const built = scene(
      `  <Instance name="t" component="Tag" props={{ label: 'Tag' }} fills={${RED}} paddingLeft={20} />`,
    )
    expect(fillOf(built, 't#box')).toEqual(C.red)
    expect(node(built, 't#box').paddingLeft).toBe(20)
    expect(node(built, 't').fills).toEqual([])
    expect(node(built, 't').paddingLeft).toBe(0)
  })

  it('a composition: on the frame of the instance it holds, at the size it states', () => {
    const built = scene(
      `  <Instance name="cf" component="CheckboxField" width={300} fills={${RED}} paddingLeft={20} />`,
    )
    expect(fillOf(built, 'cf#field/root')).toEqual(C.red)
    expect(node(built, 'cf#field/root').paddingLeft).toBe(20)
    for (const id of ['cf', 'cf#field']) {
      expect(node(built, id).fills).toEqual([])
      expect(node(built, id).paddingLeft).toBe(0)
    }
    expect(node(built, 'cf').width).toBe(300)
    expect(node(built, 'cf#field').width).toBe(300)
    expect(node(built, 'cf#field/root').width).toBe(300)
  })

  it('a composition: the consumer’s value beats what the definition wrote on the instance', () => {
    const built = scene(
      `  <Instance name="plain" component="Boxed" x={0} y={0} />
  <Instance name="red" component="Boxed" x={0} y={100} fills={${RED}} />`,
      BOXED,
    )
    expect(fillOf(built, 'plain#field/root')).toEqual(C.green)
    expect(fillOf(built, 'red#field/root')).toEqual(C.red)
    // What the consumer leaves alone, the definition still decides.
    expect(node(built, 'red#field/root').paddingLeft).toBe(4)
  })

  it('an authored variant set: on the chosen variant’s frame', () => {
    const built = scene(
      `  <Instance name="badge" component="Badge" props={{ tone: 'warn' }} fills={${RED}} />`,
    )
    expect(fillOf(built, 'badge#badge')).toEqual(C.red)
    expect(node(built, 'badge').fills).toEqual([])
  })
})

/**
 * The Shoelace example draws each look on a part inside a frame of the
 * component's own, as the library's shadow tree does. Its own library: its
 * Button is not the design-system example's.
 */
const SHOELACE = ['tokens', 'button', 'checkbox'].map((name) => {
  const file = `examples/shoelace/.uidx/${name}.uidx`
  return [file, parseOrThrow(readFileSync(join(repo, file), 'utf8'), file)] as const
})

/** `body` on a page of its own, drawn with the Shoelace example's components. */
function shoelace(body: string): Built {
  const doc = parseOrThrow(page('use', body), 'use.uidx')
  const docs = new Map<string, UidxDocument>(SHOELACE)
  docs.set('use.uidx', doc)
  return { doc, docs, ...buildPage(docs, doc) }
}

const HUG = 'layoutMode="HORIZONTAL" primaryAxisSizingMode="AUTO" counterAxisSizingMode="AUTO"'
/** A frame that lays itself out around one painted frame, as Shoelace's Button does, without a styles table. */
const PLAQUE = page(
  'plaque',
  `  <Component name="Plaque" status="draft" ${HUG}>
    <Frame name="base" ${HUG} paddingLeft={12} paddingRight={12} cornerRadius={6} fills={${GREY}}>
      <Text name="label" characters="{label}" fontSize={14} />
    </Frame>
  </Component>`,
  CONTRACT,
)
/** A bare component around one painted frame, with a styles table. */
const SLEEVE = page(
  'sleeve',
  `  <Component name="Sleeve" status="draft">
    <Frame name="box" ${HUG} paddingLeft={4} cornerRadius={8} fills={${GREY}}>
      <Text name="label" characters="{label}" fontSize={14} />
    </Frame>
  </Component>`,
  `\n<Styles>\n  <Style state="hover" box:fills={${GREEN}} />\n</Styles>\n${CONTRACT}`,
)
/** A bare component around one instance, with a styles table: a composition through its root. */
const DUO = page(
  'duo',
  `  <Component name="Duo" status="draft">
    <Instance name="field" component="Field" props={{ label: 'Duo' }} />
  </Component>`,
  `\n<Styles>\n  <Style state="hover" root:opacity={0.9} />\n</Styles>\n${CONTRACT}`,
)

const SL = {
  accent: { r: 0.145, g: 0.388, b: 0.922, a: 1 },
  hover: { r: 0.114, g: 0.306, b: 0.847, a: 1 },
}

describe('the box goes through a frame that only wraps another (ADR 0018 §2)', () => {
  it('Shoelace’s Button: on its base part, never on the root around it', () => {
    const built = shoelace(
      `  <Instance name="b" component="Button" props={{ label: 'Go' }} fills={${RED}} strokes={${GREY}}
    strokeWeight={2} cornerRadius={12} paddingLeft={30} effects={${SHADOW}} opacity={0.5} />`,
    )
    expect(built.warnings).toEqual([])
    const base = node(built, 'b#root/base')
    expect(colour(base.fills)).toEqual(C.red)
    expect(colour(base.strokes)).toEqual(C.grey)
    expect(base.strokes[0]!.weight).toBe(2)
    expect(base.cornerRadius).toBe(12)
    expect(base.paddingLeft).toBe(30)
    expect(base.effects).toHaveLength(1)
    expect(base.opacity).toBe(0.5)
    for (const id of ['b', 'b#root']) {
      const wrapper = node(built, id)
      expect(wrapper.fills, id).toEqual([])
      expect(wrapper.strokes, id).toEqual([])
      expect(wrapper.effects, id).toEqual([])
      expect(wrapper.paddingLeft, id).toBe(0)
      expect(wrapper.opacity, id).toBe(1)
    }
  })

  it('pads the part that lays out, which the root around it hugs', () => {
    const plain = shoelace(`  <Instance name="b" component="Button" props={{ label: 'Go' }} />`)
    const padded = shoelace(
      `  <Instance name="b" component="Button" props={{ label: 'Go' }} paddingLeft={30} />`,
    )
    const grown = node(padded, 'b#root/base').width - node(plain, 'b#root/base').width
    expect(grown).toBeCloseTo(30 - 16)
    expect(node(padded, 'b#root').width).toBeCloseTo(node(padded, 'b#root/base').width)
    expect(node(padded, 'b#root/base').x).toBe(0)
  })

  it('takes a stated size on the same part, so size and look land together', () => {
    const built = shoelace(
      `  <Instance name="b" component="Button" props={{ label: 'Go' }} width={199} height={40} fills={${RED}} />`,
    )
    const base = node(built, 'b#root/base')
    expect([base.width, base.height]).toEqual([199, 40])
    expect(base.primaryAxisSizing).toBe('FIXED')
    expect(base.counterAxisSizing).toBe('FIXED')
    expect(colour(base.fills)).toEqual(C.red)
    expect(node(built, 'b#root').width).toBe(199)
  })

  it('still sits beneath state: hover keeps its fill, and disabled dims the root as before', () => {
    const hovered = shoelace(
      `  <Instance name="b" component="Button" props={{ label: 'Go', state: 'hover' }} fills={${RED}} />`,
    )
    expect(fillOf(hovered, 'b#root/base')).toEqual(SL.hover)
    const disabled = shoelace(
      `  <Instance name="b" component="Button" props={{ label: 'Go', disabled: true }} fills={${RED}} opacity={0.8} />`,
    )
    expect(fillOf(disabled, 'b#root/base')).toEqual(C.red)
    expect(node(disabled, 'b#root/base').opacity).toBe(0.8)
    expect(node(disabled, 'b#root').opacity).toBe(0.45)
  })

  it('a component that lays itself out around one frame: on that frame', () => {
    const built = scene(
      `  <Instance name="p" component="Plaque" props={{ label: 'Go' }} fills={${RED}} paddingLeft={20} />`,
      PLAQUE,
    )
    expect(fillOf(built, 'p#base')).toEqual(C.red)
    expect(node(built, 'p#base').paddingLeft).toBe(20)
    expect(node(built, 'p').fills).toEqual([])
    expect(node(built, 'p').paddingLeft).toBe(0)
  })

  it('a bare component with a styles table: through its root to the frame it wraps', () => {
    const built = scene(
      `  <Instance name="s" component="Sleeve" props={{ label: 'Go' }} fills={${RED}} paddingLeft={20} />
  <Instance name="h" component="Sleeve" props={{ label: 'Go', state: 'hover' }} y={100} fills={${RED}} />`,
      SLEEVE,
    )
    expect(fillOf(built, 's#root/box')).toEqual(C.red)
    expect(node(built, 's#root/box').paddingLeft).toBe(20)
    expect(node(built, 's#root').fills).toEqual([])
    expect(node(built, 's').width).toBe(node(built, 's#root/box').width)
    expect(fillOf(built, 'h#root/box')).toEqual(C.green)
  })

  it('a composition through a root its styles table derives: on the instance it holds', () => {
    const built = scene(
      `  <Instance name="d" component="Duo" fills={${RED}} paddingLeft={20} width={300} />`,
      DUO,
    )
    expect(fillOf(built, 'd#root/field/root')).toEqual(C.red)
    expect(node(built, 'd#root/field/root').paddingLeft).toBe(20)
    expect(node(built, 'd#root/field').width).toBe(300)
    for (const id of ['d', 'd#root', 'd#root/field']) expect(node(built, id).fills, id).toEqual([])
  })

  it('the incremental path computes what the build drew there', () => {
    const built = shoelace(
      `  <Instance name="b" component="Button" props={{ label: 'Go' }} fills={${RED}} paddingLeft={30} width={199} />`,
    )
    const instance = resolve(built.doc.tree, 'b')!
    const definition = deriveVariants(resolve(built.docs.get(SHOELACE[1]![0])!.tree, 'Button')!)
    const variant = definition.children[0]!
    const options = optionsFor(built.docs)
    const parentLayout = built.graph.getNode(built.rootId)!.layoutMode
    const at = (relative: string) =>
      generatedChildProps(
        instance,
        definition,
        relative
          .split('/')
          .reduce<UidxNode>((n, name) => n.children.find((c) => c.name === name)!, variant),
        relative,
        options,
        parentLayout,
      )
    const base = at('root/base')
    expect(colour(base.fills)).toEqual(C.red)
    expect(base.paddingLeft).toBe(30)
    expect(base.width).toBe(199)
    expect(base.primaryAxisSizing).toBe('FIXED')
    const root = at('root')
    expect(root.fills ?? []).toEqual([])
    expect(root.width).toBeUndefined()
  })
})

describe('the use sits beneath state (ADR 0018 §3)', () => {
  it('a hover row wins in hover, and the use shows at rest', () => {
    const built = scene(
      `  <Instance name="hover" component="Button1" x={0} y={0} props={{ state: 'hover' }} fills={${RED}} />
  <Instance name="rest" component="Button1" x={0} y={60} fills={${RED}} />`,
    )
    expect(fillOf(built, 'hover#root')).toEqual(C.hover)
    expect(fillOf(built, 'rest#root')).toEqual(C.red)
  })

  it('an enum row is the resting look the use replaces, and its state row still wins', () => {
    const built = scene(
      `  <Instance name="rest" component="Button" x={0} y={0}
    props={{ label: 'Remove', variant: 'destructive' }} fills={${RED}} />
  <Instance name="hover" component="Button" x={0} y={60}
    props={{ label: 'Remove', variant: 'destructive', state: 'hover' }} fills={${RED}} />`,
    )
    expect(fillOf(built, 'rest#root')).toEqual(C.red)
    expect(fillOf(built, 'hover#root')).toEqual(C.danger)
  })

  it('a visual boolean is a state: checked keeps the accent', () => {
    const built = scene(
      `  <Instance name="on" component="Checkbox" x={0} y={0} props={{ checked: true }} fills={${RED}} />
  <Instance name="off" component="Checkbox" x={0} y={40} fills={${RED}} />`,
    )
    expect(fillOf(built, 'on#root')).toEqual(C.accent)
    expect(fillOf(built, 'off#root')).toEqual(C.red)
  })
})

describe('the box merges attribute by attribute (ADR 0018 §5)', () => {
  it('a stroke colour keeps the component’s weight', () => {
    const built = scene(`  <Instance name="s" component="Stroked" strokes={${RED}} />`, STROKED)
    const strokes = node(built, 's#root').strokes
    expect(colour(strokes)).toEqual(C.red)
    expect(strokes[0]!.weight).toBe(3)
  })

  it('a weight alone strokes with the component’s paints', () => {
    const built = scene(`  <Instance name="s" component="Stroked" strokeWeight={5} />`, STROKED)
    const strokes = node(built, 's#root').strokes
    expect(colour(strokes)).toEqual(C.grey)
    expect(strokes[0]!.weight).toBe(5)
  })

  it('cornerRadius drops the component’s corner radii', () => {
    const built = scene(
      `  <Instance name="badge" component="Badge" props={{ tone: 'info' }} cornerRadius={2} />`,
    )
    const frame = node(built, 'badge#badge')
    expect(frame.cornerRadius).toBe(2)
    expect(frame.topLeftRadius).not.toBe(8)
    expect(frame.bottomRightRadius).not.toBe(8)
  })

  it('an empty paint list is an explicit none', () => {
    const built = scene(`  <Instance name="b" component="Button1" fills={[]} />`)
    expect(node(built, 'b#root').fills).toEqual([])
  })
})

describe('padding pads the frame that lays out', () => {
  it('lands on the root, which grows by the difference while it hugs', () => {
    const plain = scene(`  <Instance name="b" component="Button1" />`)
    const padded = scene(`  <Instance name="b" component="Button1" paddingLeft={40} />`)
    expect(node(padded, 'b#root').paddingLeft).toBe(40)
    expect(node(padded, 'b').paddingLeft).toBe(0)
    expect(node(padded, 'b#root').width).toBe(node(plain, 'b#root').width + 28)
  })

  it('at a stated width, the content gives way instead', () => {
    const plain = scene(`  <Instance name="b" component="Button1" width={199} />`)
    const padded = scene(`  <Instance name="b" component="Button1" width={199} paddingLeft={40} />`)
    expect(node(padded, 'b#root').width).toBe(199)
    expect(node(padded, 'b#root/label').x).toBe(node(plain, 'b#root/label').x + 14)
  })
})

describe('the inside stays the component’s (ADR 0018 §1)', () => {
  it('ignores layout on an instance, with a warning', () => {
    const built = scene(
      `  <Instance name="p" component="Plain" x={0} y={0} layoutMode="VERTICAL" itemSpacing={50} />
  <Instance name="b" component="Button1" x={0} y={60} itemSpacing={50} />`,
      PLAIN,
    )
    expect(node(built, 'p').layoutMode).toBe('HORIZONTAL')
    expect(node(built, 'p').itemSpacing).toBe(0)
    expect(node(built, 'b').itemSpacing).toBe(0)
    expect(node(built, 'b#root').itemSpacing).toBe(0)
    expect(built.warnings).toContain(
      "p: layoutMode on an instance is ignored — Plain's inside is its own (ADR 0018)",
    )
    expect(built.warnings).toContain(
      "p: itemSpacing on an instance is ignored — Plain's inside is its own (ADR 0018)",
    )
    expect(built.warnings).toContain(
      "b: itemSpacing on an instance is ignored — Button1's inside is its own (ADR 0018)",
    )
  })

  it('reads textFills as the use’s, not as an unknown property', () => {
    const built = scene(`  <Instance name="b" component="Button1" textFills={${RED}} />`)
    expect(built.warnings).toEqual([])
  })
})

describe('aliases bind where the use is written (ADR 0018 §5)', () => {
  it('under an enclosing frame’s modes, and under the instance’s own', () => {
    const built = scene(
      `  <Instance name="light" component="Button1" x={0} y={0} fills="{tone#danger}" />
  <Frame name="dark" x={0} y={60} width={200} height={60} modes={{ tone: 'dark' }}>
    <Instance name="inside" component="Button1" fills="{tone#danger}" />
  </Frame>
  <Instance name="own" component="Button1" x={0} y={140} modes={{ tone: 'dark' }} fills="{tone#danger}" />`,
      THEMED,
    )
    expect(fillOf(built, 'light#root')).toEqual(C.red)
    expect(fillOf(built, 'dark#inside/root')).toEqual({ r: 0.5, g: 0, b: 0, a: 1 })
    expect(fillOf(built, 'own#root')).toEqual({ r: 0.5, g: 0, b: 0, a: 1 })
  })

  it('drops a binding with a warning, so the component’s colour shows', () => {
    const built = scene(`  <Instance name="b" component="Button1" fills="{label}" />`)
    expect(fillOf(built, 'b#root')).toEqual(C.blue)
    expect(built.warnings.some((warning) => /^b: fills binds "\{label\}"/.test(warning))).toBe(true)
  })
})

describe('text colour cascades (ADR 0018 §4)', () => {
  it('recolours the label', () => {
    const built = scene(`  <Instance name="b" component="Button1" textFills="{text#onAccent}" />`)
    expect(fillOf(built, 'b#root/label')).toEqual(C.white)
  })

  it('loses to a state row that colours the label, in that state only', () => {
    const built = scene(
      `  <Instance name="hover" component="Tinted" x={0} y={0} props={{ state: 'hover' }} textFills={${RED}} />
  <Instance name="rest" component="Tinted" x={0} y={60} textFills={${RED}} />`,
      TINTED,
    )
    expect(fillOf(built, 'hover#root/label')).toEqual(C.tint)
    expect(fillOf(built, 'rest#root/label')).toEqual(C.red)
  })

  it('loses to the overrides map', () => {
    const built = scene(
      `  <Instance name="b" component="Button1" textFills={${RED}}
    overrides={{ 'root/label': { fills: ${GREEN} } }} />`,
    )
    expect(fillOf(built, 'b#root/label')).toEqual(C.green)
  })

  it('reaches the texts of nested instances, where the nearest stated colour wins', () => {
    const built = scene(`  <Instance name="c" component="Card" textFills={${RED}} />`, CARD)
    expect(fillOf(built, 'c#title')).toEqual(C.red)
    expect(fillOf(built, 'c#cta/root/label')).toEqual(C.red)
    expect(fillOf(built, 'c#own/root/label')).toEqual(C.green)
  })

  it('leaves vectors their colour', () => {
    const built = scene(`  <Instance name="c" component="Card" textFills={${RED}} />`, CARD)
    expect(fillOf(built, 'c#mark')).toEqual(C.grey)
  })

  it('recolours slot-fill text that states no fills, and keeps fills it states', () => {
    const built = scene(
      `  <Instance name="f" component="Field" props={{ label: 'Status' }} textFills={${RED}}>
    <Slot name="control">
      <Text name="bare" characters="Inherits" fontSize={12} />
      <Text name="own" characters="Keeps" fontSize={12} fills="{text#muted}" />
    </Slot>
  </Instance>`,
    )
    expect(fillOf(built, 'f#root/text/label')).toEqual(C.red)
    expect(fillOf(built, 'f#root/control/bare')).toEqual(C.red)
    expect(fillOf(built, 'f#root/control/own')).toEqual(C.muted)
  })

  it('carries a composition’s colour through the instance it holds', () => {
    const built = scene(`  <Instance name="cf" component="CheckboxField" textFills={${RED}} />`)
    expect(fillOf(built, 'cf#field/root/text/label')).toEqual(C.red)
    expect(fillOf(built, 'cf#field/root/text/description')).toEqual(C.red)
    // The checkbox draws vectors, not text: its marks keep their colour.
    expect(fillOf(built, 'cf#field/root/control/box/root/check')).toEqual(C.white)
  })
})

describe('size and look land together', () => {
  it('a stated size and a fill both reach the root', () => {
    const built = scene(
      `  <Instance name="b" component="Button1" width={199} height={33} fills={${RED}} />`,
    )
    const root = node(built, 'b#root')
    expect({ width: root.width, height: root.height }).toEqual({ width: 199, height: 33 })
    expect(colour(root.fills)).toEqual(C.red)
  })
})

describe('the texts a use’s colour reaches (SceneResult.textTargets)', () => {
  it('lists them for an instance that states no colour yet', () => {
    const built = scene(`  <Instance name="b" component="Button1" />`)
    expect(built.textTargets.get('b')).toEqual(['b#root/label'])
  })

  it('leaves out a text a state row colours', () => {
    const built = scene(
      `  <Instance name="t" component="Tinted" props={{ state: 'hover' }} />`,
      TINTED,
    )
    expect(built.textTargets.get('t')).toEqual([])
  })

  it('stops at a nested instance that states its own colour', () => {
    const built = scene(`  <Instance name="c" component="Card" />`, CARD)
    expect(built.textTargets.get('c')).toEqual(['c#title', 'c#cta/root/label'])
  })

  it('follows slot-fill text that states no fills, and gives a filled instance its own list', () => {
    const built = scene(
      `  <Instance name="f" component="Field" props={{ label: 'Status' }}>
    <Slot name="control">
      <Instance name="tag" component="Tag" props={{ label: 'Tag' }} />
      <Text name="bare" characters="Inherits" fontSize={12} />
      <Text name="own" characters="Keeps" fontSize={12} fills="{text#muted}" />
    </Slot>
  </Instance>`,
    )
    expect([...built.textTargets.get('f')!].sort()).toEqual(
      [
        'f#root/control/bare',
        'f#root/control/tag/box/label',
        'f#root/text/description',
        'f#root/text/error',
        'f#root/text/label',
      ].sort(),
    )
    expect(built.textTargets.get('f#root/control/tag')).toEqual(['f#root/control/tag/box/label'])
  })

  it('reaches through a composition into the instance it holds', () => {
    const built = scene(`  <Instance name="cf" component="CheckboxField" />`)
    expect([...built.textTargets.get('cf')!].sort()).toEqual([
      'cf#field/root/text/description',
      'cf#field/root/text/error',
      'cf#field/root/text/label',
    ])
  })
})

/**
 * The incremental path updates a generated node in place with
 * `generatedChildProps`, so it has to compute what the build's clone did:
 * otherwise an edit and a reload disagree (ADR 0018 §6).
 */
describe('the incremental path computes what the build drew', () => {
  /** Keys a build and an update both decide; layout owns the geometry. */
  const drawn = (props: Partial<SceneNode>, live: SceneNode) => {
    const keys = Object.keys(props).filter(
      (key) => !['x', 'y', 'width', 'height', 'name'].includes(key),
    ) as (keyof SceneNode)[]
    expect(keys.length).toBeGreaterThan(0)
    return {
      update: Object.fromEntries(keys.map((key) => [key, props[key]])),
      build: Object.fromEntries(keys.map((key) => [key, live[key]])),
    }
  }

  const BODY = `  <Instance name="b" component="Button1" fills={${RED}} strokes={${GREY}} strokeWeight={2}
    cornerRadius={4} paddingLeft={24} opacity={0.5} textFills="{text#onAccent}" />`

  const incremental = (relative: string) => {
    const built = scene(BODY)
    const instance = resolve(built.doc.tree, 'b')!
    const definition = deriveVariants(resolve(built.docs.get(BUTTON1)!.tree, 'Button1')!)
    const variant = definition.children[0]!
    const source = relative
      .split('/')
      .reduce<UidxNode>((at, name) => at.children.find((child) => child.name === name)!, variant)
    const props = generatedChildProps(
      instance,
      definition,
      source,
      relative,
      optionsFor(built.docs),
      built.graph.getNode(built.rootId)!.layoutMode,
    )
    return { built, props }
  }

  it('for the box frame', () => {
    const { built, props } = incremental('root')
    const { update, build } = drawn(props, node(built, 'b#root'))
    expect(update).toEqual(build)
    expect(colour(props.fills)).toEqual(C.red)
  })

  it('for a coloured text', () => {
    const { built, props } = incremental('root/label')
    const { update, build } = drawn(props, node(built, 'b#root/label'))
    expect(update).toEqual(build)
    expect(colour(props.fills)).toEqual(C.white)
  })

  it('for the instance’s own node, which keeps only its placement', () => {
    const built = scene(BODY)
    const wrapper = node(built, 'b')
    expect(wrapper.fills).toEqual([])
    expect(wrapper.paddingLeft).toBe(0)
  })
})
