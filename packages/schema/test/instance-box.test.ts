import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseOrThrow, resolve, type JsonValue, type UidxNode } from '@uidx/format'
import { deriveVariants } from '../src/design-system.js'
import { KNOWN_PROPS } from '../src/known-props.js'
import {
  INSTANCE_BOX_PROPS,
  INSTANCE_BOX_SHORTHANDS,
  INSTANCE_CASCADE_PROPS,
  INSTANCE_LOCKED_PROPS,
  INSTANCE_PLACEMENT_PROPS,
  INSTANCE_STRUCTURAL_PROPS,
  boxLayer,
  boxTargetOf,
  boxValue,
  instanceRole,
  layered,
  withTextFills,
} from '../src/instance-box.js'

/**
 * The vocabulary of ADR 0018: which attributes of an `<Instance>` style its
 * outer box, which node that box is, and the attribute-level merge that lays a
 * use's box over its component without disturbing what a state row set.
 */
const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '../../..')

const page = (id: string, body: string, regions = '') =>
  `---\nid: ${id}\n---\n\n## Visual Contract\n\n<Page>\n${body}\n</Page>\n${regions}`

const nodeIn = (source: string, address: string): UidxNode =>
  resolve(parseOrThrow(source).tree, address)!

const example = (file: string, name: string): UidxNode =>
  nodeIn(readFileSync(join(repo, file), 'utf8'), name)

const button1 = () => example('packages/schema/test/fixtures/instance-box/button1.uidx', 'Button1')

const RED = { r: 1, g: 0, b: 0, a: 1 }
const TOKENS: Record<string, JsonValue> = {
  'color#danger': RED,
  'surface#danger': [{ type: 'SOLID', color: RED }],
  'space#lg': 24,
  'text#onAccent': { r: 1, g: 1, b: 1, a: 1 },
}
const resolveAlias = (address: string): JsonValue | undefined => TOKENS[address]

/** One `<Instance>` on a page of its own, with `attrs` written as in the file. */
const instance = (attrs: string): UidxNode =>
  nodeIn(page('use', `  <Instance name="delete" component="Button1" ${attrs} />`), 'delete')

describe('every attribute of an instance has one role (ADR 0018 §1)', () => {
  const DOCUMENTED: Record<string, readonly string[]> = {
    structural: ['component', 'props', 'overrides', 'modes', 'name'],
    placement: [
      'x',
      'y',
      'right',
      'bottom',
      'centerX',
      'centerY',
      'rotation',
      'constraints',
      'layoutPositioning',
      'layoutGrow',
      'layoutAlign',
      'width',
      'height',
      'minWidth',
      'maxWidth',
      'minHeight',
      'maxHeight',
      'visible',
      'locked',
      'blendMode',
      'isMask',
      'maskType',
    ],
    box: [
      'fills',
      'strokes',
      'strokeWeight',
      'strokeAlign',
      'dashPattern',
      'strokeTopWeight',
      'strokeRightWeight',
      'strokeBottomWeight',
      'strokeLeftWeight',
      'cornerRadius',
      'topLeftRadius',
      'topRightRadius',
      'bottomRightRadius',
      'bottomLeftRadius',
      'cornerSmoothing',
      'opacity',
      'effects',
      'paddingTop',
      'paddingRight',
      'paddingBottom',
      'paddingLeft',
    ],
    cascade: ['textFills'],
    locked: [
      'layoutMode',
      'layoutWrap',
      'itemSpacing',
      'counterAxisSpacing',
      'primaryAxisAlignItems',
      'counterAxisAlignItems',
      'counterAxisAlignContent',
      'itemReverseZIndex',
      'clipsContent',
      'strokesIncludedInLayout',
      'strokeCap',
      'strokeStartCap',
      'strokeEndCap',
      'strokeJoin',
      'strokeMiterLimit',
      'characters',
      'fontSize',
      'fontFamily',
      'lineHeight',
      'vectorPaths',
      'arcData',
    ],
  }

  it('puts each documented attribute in its role', () => {
    for (const [role, props] of Object.entries(DOCUMENTED))
      for (const prop of props) expect([prop, instanceRole(prop)]).toEqual([prop, role])
  })

  it('places the sizing modes, which are honoured when written by hand', () => {
    expect(instanceRole('primaryAxisSizingMode')).toBe('placement')
    expect(instanceRole('counterAxisSizingMode')).toBe('placement')
  })

  it('reads what binds a use into its surroundings as structure, not as a look', () => {
    for (const prop of ['repeat', 'as', 'part']) expect(instanceRole(prop)).toBe('structural')
  })

  it('locks anything it does not know', () => {
    expect(instanceRole('borderRadius')).toBe('locked')
  })

  const SETS = {
    structural: INSTANCE_STRUCTURAL_PROPS,
    placement: INSTANCE_PLACEMENT_PROPS,
    box: INSTANCE_BOX_PROPS,
    cascade: INSTANCE_CASCADE_PROPS,
    locked: INSTANCE_LOCKED_PROPS,
  }

  it('keeps the five sets pairwise disjoint', () => {
    const seen = new Map<string, string>()
    for (const [role, props] of Object.entries(SETS))
      for (const prop of props) {
        expect([prop, seen.get(prop)]).toEqual([prop, undefined])
        seen.set(prop, role)
      }
  })

  it('covers exactly the known vocabulary', () => {
    const all = Object.values(SETS).flat()
    expect([...all].sort()).toEqual([...KNOWN_PROPS].sort())
  })

  it('locks the inside: layout, stroke ends and joins, text and vectors', () => {
    expect([...INSTANCE_LOCKED_PROPS]).toEqual([
      'clipsContent',
      'strokeCap',
      'strokeStartCap',
      'strokeEndCap',
      'strokeJoin',
      'strokeMiterLimit',
      'strokesIncludedInLayout',
      'layoutMode',
      'layoutWrap',
      'itemSpacing',
      'counterAxisSpacing',
      'counterAxisAlignContent',
      'itemReverseZIndex',
      'primaryAxisAlignItems',
      'counterAxisAlignItems',
      'fontSize',
      'fontFamily',
      'italic',
      'fontWeight',
      'characters',
      'textAutoResize',
      'textDirection',
      'textAlignHorizontal',
      'textAlignVertical',
      'textCase',
      'textDecoration',
      'textTruncation',
      'maxLines',
      'letterSpacing',
      'lineHeight',
      'vectorPaths',
      'arcData',
    ])
  })

  it('names the longhands each shorthand replaces', () => {
    expect(INSTANCE_BOX_SHORTHANDS).toEqual({
      cornerRadius: ['topLeftRadius', 'topRightRadius', 'bottomRightRadius', 'bottomLeftRadius'],
      strokeWeight: [
        'strokeTopWeight',
        'strokeRightWeight',
        'strokeBottomWeight',
        'strokeLeftWeight',
      ],
    })
    for (const longhands of Object.values(INSTANCE_BOX_SHORTHANDS))
      for (const prop of longhands) expect(instanceRole(prop)).toBe('box')
  })
})

describe('the box lands where the stated size does (ADR 0018 §2)', () => {
  it('is the derived root of a component with a styles table', () => {
    const set = deriveVariants(button1())
    const resting = set.children[0]!
    const target = boxTargetOf(resting)
    expect(target.kind).toBe('frame')
    expect(target.kind === 'frame' && target.node).toBe(resting.children[0])
    expect(resting.children[0]!.name).toBe('root')
  })

  it('is the frame a bare component wraps', () => {
    const card = nodeIn(
      page(
        'card',
        `  <Component name="Card">
    <Frame name="body" layoutMode="VERTICAL" paddingLeft={8}>
      <Text name="title" characters="Title" />
    </Frame>
  </Component>`,
      ),
      'Card',
    )
    const target = boxTargetOf(card)
    expect(target.kind).toBe('frame')
    expect(target.kind === 'frame' && target.node.name).toBe('body')
  })

  it('is the instance a composition holds', () => {
    const field = example('examples/design-system/.uidx/checkbox-field.uidx', 'CheckboxField')
    const target = boxTargetOf(field)
    expect(target.kind).toBe('instance')
    expect(target.kind === 'instance' && target.node).toBe(field.children[0])
    expect(field.children[0]!.name).toBe('field')
  })

  it('is the instance itself for a component that lays itself out', () => {
    expect(boxTargetOf(button1())).toEqual({ kind: 'self' })
  })

  it('is the instance itself when the one child repeats, or is not a frame', () => {
    const list = nodeIn(
      page(
        'list',
        `  <Component name="Rows">
    <Frame name="row" repeat="{items}" layoutMode="HORIZONTAL" />
  </Component>`,
      ),
      'Rows',
    )
    const caption = nodeIn(
      page(
        'caption',
        `  <Component name="Caption">\n    <Text name="words" characters="Hi" />\n  </Component>`,
      ),
      'Caption',
    )
    expect(boxTargetOf(list)).toEqual({ kind: 'self' })
    expect(boxTargetOf(caption)).toEqual({ kind: 'self' })
  })
})

/**
 * A frame that only holds another draws nothing of its own: it hugs what it
 * holds, pads nothing and paints nothing, so the box a person sees is the one
 * inside. The Shoelace example's Button is the case that matters: the look is
 * on its `base` part, inside a frame of the component's own.
 */
describe('the box goes through a frame that only wraps another (ADR 0018 §2)', () => {
  const shoelace = (name: string) =>
    example(`examples/shoelace/.uidx/${name.toLowerCase()}.uidx`, name)

  /** A component of one page, with `attrs` on it and `body` inside. */
  const component = (attrs: string, body: string, regions = '') =>
    nodeIn(
      page('shape', `  <Component name="Shape" ${attrs}>\n${body}\n  </Component>`, regions),
      'Shape',
    )

  const HUG = 'layoutMode="HORIZONTAL" primaryAxisSizingMode="AUTO" counterAxisSizingMode="AUTO"'
  const BASE = `    <Frame name="base" ${HUG} paddingLeft={12} fills="{surface#accent}">
      <Text name="label" characters="Go" />
    </Frame>`

  it('is the Shoelace Button’s base part, through the root its styles table derives', () => {
    const variants = deriveVariants(shoelace('Button')).children
    expect(variants.length).toBeGreaterThan(1)
    for (const variant of variants) {
      const target = boxTargetOf(variant)
      expect(target.kind, variant.name).toBe('frame')
      expect(target.kind === 'frame' && target.node.attrs.part?.value, variant.name).toBe('base')
      expect(target.kind === 'frame' && target.path, variant.name).toEqual(['root', 'base'])
    }
  })

  it('is the base that holds a Shoelace Checkbox or Switch, and an Input’s own root', () => {
    for (const name of ['Checkbox', 'Switch']) {
      const target = boxTargetOf(deriveVariants(shoelace(name)).children[0]!)
      expect(target.kind === 'frame' && target.path, name).toEqual(['root', 'base'])
    }
    // An Input's root is 280 wide whatever it holds, so it is the box.
    const input = boxTargetOf(deriveVariants(shoelace('Input')).children[0]!)
    expect(input.kind === 'frame' && input.path).toEqual(['root'])
  })

  it('is the frame a component that lays itself out only wraps', () => {
    const target = boxTargetOf(component(HUG, BASE))
    expect(target.kind).toBe('frame')
    expect(target.kind === 'frame' && target.node.name).toBe('base')
    expect(target.kind === 'frame' && target.path).toEqual(['base'])
  })

  it('is the instance a frame that only wraps it holds', () => {
    const target = boxTargetOf(component(HUG, '    <Instance name="inner" component="Button1" />'))
    expect(target.kind).toBe('instance')
    expect(target.kind === 'instance' && target.path).toEqual(['inner'])
  })

  it.each([
    ['pads', `${HUG} paddingLeft={4}`, BASE],
    ['paints a fill', `${HUG} fills="{surface#raised}"`, BASE],
    ['paints a stroke', `${HUG} strokes="{border#default}"`, BASE],
    [
      'casts a shadow',
      `${HUG} effects={[{ type: 'DROP_SHADOW', color: { r: 0, g: 0, b: 0, a: 0.2 }, offset: { x: 0, y: 1 }, radius: 2, spread: 0 }]}`,
      BASE,
    ],
    ['is translucent', `${HUG} opacity={0.5}`, BASE],
    ['clips', `${HUG} clipsContent={true}`, BASE],
    [
      'has a fixed width',
      'layoutMode="HORIZONTAL" primaryAxisSizingMode="FIXED" counterAxisSizingMode="AUTO" width={200}',
      BASE,
    ],
    ['has a minimum width', `${HUG} minWidth={200}`, BASE],
    ['lays nothing out', 'width={120} height={40}', BASE],
    ['holds two', HUG, `${BASE}\n    <Frame name="extra" ${HUG} />`],
    ['holds a text', HUG, '    <Text name="label" characters="Go" />'],
    ['holds a repeat', HUG, `    <Frame name="row" repeat="{items}" ${HUG} />`],
    [
      'holds a frame placed absolutely',
      HUG,
      BASE.replace('<Frame name="base"', '<Frame name="base" layoutPositioning="ABSOLUTE"'),
    ],
    [
      'holds a hidden frame',
      HUG,
      BASE.replace('<Frame name="base"', '<Frame name="base" visible={false}'),
    ],
  ])('stops at a wrapper that %s', (_, attrs, body) => {
    expect(boxTargetOf(component(attrs, body))).toEqual({ kind: 'self' })
  })

  it('keeps going while each wrapper is bare, and stops at the first that is not', () => {
    const nested = component(
      HUG,
      `    <Frame name="outer" ${HUG}>
      <Frame name="inner" ${HUG} fills="{surface#raised}">
        <Frame name="core" ${HUG} fills="{surface#accent}" />
      </Frame>
    </Frame>`,
    )
    const target = boxTargetOf(nested)
    expect(target.kind === 'frame' && target.path).toEqual(['outer', 'inner'])
  })

  it('is not moved by what a state row paints on the wrapper, since a state sits above the use', () => {
    const shell = component(
      HUG,
      BASE,
      `\n<Styles>\n  <Style state="hover" root:fills="{surface#raised}" root:opacity={0.5} />\n</Styles>\n\n## Contract\n\n<Props>\n  <Prop name="label" type="string" sample="Go">Words.</Prop>\n</Props>\n`,
    )
    for (const variant of deriveVariants(shell).children) {
      const target = boxTargetOf(variant)
      expect(target.kind === 'frame' && target.path, variant.name).toEqual(['root', 'base'])
    }
  })

  it('is the frame a bare component wraps, through the root its styles table derives', () => {
    const sleeve = component(
      'status="draft"',
      BASE,
      `\n<Styles>\n  <Style state="hover" base:fills="{surface#raised}" />\n</Styles>\n\n## Contract\n\n<Props>\n  <Prop name="label" type="string" sample="Go">Words.</Prop>\n</Props>\n`,
    )
    for (const variant of deriveVariants(sleeve).children) {
      const target = boxTargetOf(variant)
      expect(target.kind === 'frame' && target.path, variant.name).toEqual(['root', 'base'])
    }
  })
})

describe('a use is laid over its component attribute by attribute (ADR 0018 §3, §5)', () => {
  const card = nodeIn(
    page(
      'card',
      `  <Component name="Card" strokes="{border#default}" strokeWeight={3} strokeTopWeight={1}
    cornerRadius={8} topLeftRadius={2} fills="{surface#base}">
    <Text name="title" characters="Title" />
  </Component>`,
    ),
    'Card',
  )

  it('keeps the component stroke weight under a new stroke paint', () => {
    const out = layered(card, boxLayer(instance(`strokes="{surface#danger}"`), resolveAlias, []))
    expect(out.attrs.strokes!.value).toEqual([{ type: 'SOLID', color: RED }])
    expect(out.attrs.strokeWeight).toBe(card.attrs.strokeWeight)
  })

  it('drops the corner radii a shorthand replaces, and the side weights', () => {
    const out = layered(
      card,
      boxLayer(instance(`cornerRadius={4} strokeWeight={2}`), resolveAlias, []),
    )
    expect(out.attrs.cornerRadius!.value).toBe(4)
    expect(out.attrs.topLeftRadius).toBeUndefined()
    expect(out.attrs.strokeWeight!.value).toBe(2)
    expect(out.attrs.strokeTopWeight).toBeUndefined()
  })

  it('leaves the component untouched, and returns it as is for an empty layer', () => {
    layered(card, boxLayer(instance(`cornerRadius={4}`), resolveAlias, []))
    expect(card.attrs.topLeftRadius!.value).toBe(2)
    expect(layered(card, {})).toBe(card)
  })

  const STATEFUL = page(
    'stateful',
    `  <Component name="Pill" layoutMode="HORIZONTAL" cornerRadius={8} fills="{surface#base}">
    <Text name="label" characters="{label}" />
  </Component>`,
    `
<Styles>
  <Style state="hover" root:fills="{surface#hover}" root:topLeftRadius={0} />
  <Style state="focus" root:cornerRadius={2} />
</Styles>

## Contract

<Props>
  <Prop name="label" type="string" sample="Pill">The words.</Prop>
</Props>
`,
  )
  const pill = deriveVariants(nodeIn(STATEFUL, 'Pill'))
  const rootIn = (state: string): UidxNode =>
    pill.children.find((variant) => variant.attrs.state?.value === state)!.children[0]!

  it('keeps a value a state row set, whatever the use says', () => {
    const hover = rootIn('hover')
    const out = layered(hover, boxLayer(instance(`fills="{surface#danger}"`), resolveAlias, []))
    expect(out.attrs.fills).toBe(hover.attrs.fills)
    expect(out.attrs.fills!.stateRow).toBe('hover')
  })

  it('lays the use over the resting look of the same component', () => {
    const resting = rootIn('default')
    const out = layered(resting, boxLayer(instance(`fills="{surface#danger}"`), resolveAlias, []))
    expect(out.attrs.fills!.value).toEqual([{ type: 'SOLID', color: RED }])
  })

  it('keeps a stamped corner under a shorthand, and a stamped shorthand over a corner', () => {
    const hover = layered(rootIn('hover'), boxLayer(instance(`cornerRadius={4}`), resolveAlias, []))
    expect(hover.attrs.cornerRadius!.value).toBe(4)
    expect(hover.attrs.topLeftRadius).toMatchObject({ value: 0, stateRow: 'hover' })
    // The focus row's radius sits above the use, so a corner the use states
    // would only undo it on one side.
    const focus = layered(
      rootIn('focus'),
      boxLayer(instance(`topLeftRadius={9}`), resolveAlias, []),
    )
    expect(focus.attrs.cornerRadius).toMatchObject({ value: 2, stateRow: 'focus' })
    expect(focus.attrs.topLeftRadius).toBeUndefined()
  })
})

describe('the box layer is bound where the instance is written (ADR 0018 §5)', () => {
  it('takes the box attributes only', () => {
    const layer = boxLayer(
      instance(
        `x={10} props={{ label: 'Delete' }} layoutMode="VERTICAL" textFills="{text#onAccent}" opacity={0.5} paddingRight="{space#lg}"`,
      ),
      resolveAlias,
      [],
    )
    expect(Object.keys(layer).sort()).toEqual(['opacity', 'paddingRight'])
    expect(layer.paddingRight!.value).toBe(24)
  })

  it('turns a whole colour token on a paint list into one solid paint', () => {
    const layer = boxLayer(instance(`fills="{color#danger}"`), resolveAlias, [])
    expect(layer.fills!.value).toEqual([{ type: 'SOLID', color: RED }])
  })

  it('binds a token inside a paint, and keeps the rest of the paint', () => {
    const layer = boxLayer(
      instance(`strokes={[{ type: 'SOLID', color: '{color#danger}', opacity: 0.5 }]}`),
      resolveAlias,
      [],
    )
    expect(layer.strokes!.value).toEqual([{ type: 'SOLID', color: RED, opacity: 0.5 }])
  })

  it('drops a component-property binding, with a warning naming the instance', () => {
    const warnings: string[] = []
    const layer = boxLayer(
      instance(`paddingLeft="{label}" fills={[{ type: 'SOLID', color: '{item.tone}' }]}`),
      resolveAlias,
      warnings,
    )
    expect(layer).toEqual({})
    expect(warnings).toHaveLength(2)
    expect(warnings[0]).toMatch(/^delete: paddingLeft binds "\{label\}"/)
    expect(warnings[1]).toMatch(/^delete: fills binds "\{item\.tone\}"/)
  })

  it('drops an unresolved token, as the scene build does', () => {
    const warnings: string[] = []
    const layer = boxLayer(instance(`cornerRadius="{radius#missing}"`), resolveAlias, warnings)
    expect(layer).toEqual({})
    expect(warnings).toEqual(['delete: unresolved token "radius#missing"'])
  })

  // `[]` is the use's explicit "none" (ADR 0018 §5). A list emptied by tokens
  // that did not resolve must not become one, or a missing text colour would
  // wipe every label the cascade reaches.
  it('drops a paint list none of whose tokens resolve, so the component paints as before', () => {
    const warnings: string[] = []
    const use = instance(
      `fills={[{ type: 'SOLID', color: '{color#missing}' }]} textFills={[{ type: 'SOLID', color: '{text#missing}' }]}`,
    )
    expect(boxValue(use, 'fills', resolveAlias, warnings)).toBeUndefined()
    expect(boxValue(use, 'textFills', resolveAlias, warnings)).toBeUndefined()
    expect(warnings).toEqual([
      'delete: unresolved token "color#missing"',
      'delete: unresolved token "text#missing"',
    ])
  })

  it('keeps the paints that resolve, and an explicit none', () => {
    const use = instance(
      `fills={[{ type: 'SOLID', color: '{color#missing}' }, { type: 'SOLID', color: '{color#danger}' }]} strokes={[]}`,
    )
    expect(boxValue(use, 'fills', resolveAlias, [])).toEqual([{ type: 'SOLID', color: RED }])
    expect(boxValue(use, 'strokes', resolveAlias, [])).toEqual([])
  })

  it('drops a dash pattern with an unresolved length rather than shifting its dashes and gaps', () => {
    const warnings: string[] = []
    const dashed = (pattern: string) => instance(`dashPattern={${pattern}}`)
    expect(
      boxValue(dashed(`['{space#nope}', 4]`), 'dashPattern', resolveAlias, warnings),
    ).toBeUndefined()
    expect(warnings).toEqual(['delete: unresolved token "space#nope"'])
    expect(boxValue(dashed(`['{space#lg}', 4]`), 'dashPattern', resolveAlias, [])).toEqual([24, 4])
  })

  it('binds text colour the same way, one attribute at a time', () => {
    const use = instance(`textFills="{text#onAccent}" opacity="{label}"`)
    expect(boxValue(use, 'textFills', resolveAlias, [])).toEqual([
      { type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 } },
    ])
    expect(boxValue(use, 'opacity', resolveAlias, [])).toBeUndefined()
    expect(boxValue(use, 'fills', resolveAlias, [])).toBeUndefined()
  })
})

describe('text colour reaches a text unless a state row set it (ADR 0018 §4)', () => {
  const WHITE = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 } }]
  const card = nodeIn(
    page(
      'card',
      `  <Component name="Card" layoutMode="VERTICAL">
    <Text name="title" characters="Title" fills="{text#default}" />
  </Component>`,
    ),
    'Card',
  )

  it('replaces the fills of a text', () => {
    const title = card.children[0]!
    const out = withTextFills(title, WHITE)
    expect(out.attrs.fills!.value).toEqual(WHITE)
    expect(title.attrs.fills!.value).toBe('{text#default}')
  })

  it('leaves anything that is not a text, and a text when there is no colour', () => {
    expect(withTextFills(card, WHITE)).toBe(card)
    expect(withTextFills(card.children[0]!, undefined)).toBe(card.children[0])
  })

  it('leaves a text whose fills a state row set', () => {
    const chip = deriveVariants(
      nodeIn(
        page(
          'chip',
          `  <Component name="Chip" layoutMode="HORIZONTAL">
    <Text name="label" characters="{label}" fills="{text#default}" />
  </Component>`,
          `
<Styles>
  <Style state="disabled" label:fills="{text#muted}" />
</Styles>

## Contract

<Props>
  <Prop name="label" type="string" sample="Chip">The words.</Prop>
  <Prop name="disabled" type="boolean" default={false} visual>Inert.</Prop>
</Props>
`,
        ),
        'Chip',
      ),
    )
    const label = (state: string): UidxNode =>
      chip.children.find((variant) => variant.attrs.state?.value === state)!.children[0]!
        .children[0]!
    expect(withTextFills(label('disabled'), WHITE)).toBe(label('disabled'))
    expect(withTextFills(label('default'), WHITE).attrs.fills!.value).toEqual(WHITE)
  })
})
