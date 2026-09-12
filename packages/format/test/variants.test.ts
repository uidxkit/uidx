import { describe, expect, it } from 'vitest'
import {
  applyPatches,
  CODES,
  componentVariants,
  defaultCombination,
  hasVariants,
  parse,
  parseOrThrow,
  resolve,
  variantName,
} from '../src/index.js'

/**
 * A component's states, declared once (story F8, ADR 0005).
 *
 * The model being replaced is Figma's, where a variant's identity lives in its
 * *name* (`State=Hover`) and the axes are inferred from parsing every child. So
 * the cases that matter most here are the ones that model cannot express: a
 * domain to check a value against, and an axis name that is checked rather than
 * minted by a typo.
 */
const page = (body: string) => `---\nid: t\n---\n\n## Visual Contract\n\n<Page>\n${body}\n</Page>\n`

const codes = (source: string): string[] => parse(source).diagnostics.map((d) => d.code)

/**
 * The one diagnostic with this code. Found by code rather than by position:
 * `parse` sorts by source offset, so a `<Variant>` whose coordinates are wrong
 * is *also* reported as leaving the default combination missing — both true,
 * both actionable, and the component tag comes first in the file.
 */
const only = (source: string, code: string) => {
  const found = parse(source).diagnostics.filter((d) => d.code === code)
  expect(found).toHaveLength(1)
  return found[0]!
}

const component = (variants: string, body: string) =>
  page(`  <Component name="Button" status="draft"${variants ? ` variants={${variants}}` : ''}>
${body}
  </Component>`)

const STATE = `{ state: ['default', 'hover', 'pressed'] }`

const variant = (attrs: string, label = 'Click') =>
  `    <Variant ${attrs}>
      <Frame name="container" layoutMode="HORIZONTAL"><Text name="label" characters="${label}" /></Frame>
    </Variant>`

const BUTTON = component(
  STATE,
  [variant(`state="default"`), variant(`state="hover"`, 'Hover')].join('\n'),
)

describe('declaring axes', () => {
  it('reads a well-formed declaration, in order', () => {
    const doc = parseOrThrow(
      component(
        `{ state: ['default', 'hover'], size: ['md', 'sm'] }`,
        [
          variant(`state="default" size="md"`),
          variant(`state="hover" size="md"`),
          variant(`state="default" size="sm"`),
        ].join('\n'),
      ),
    )
    const { axes, problems } = componentVariants(resolve(doc.tree, 'Button')!)
    expect(problems).toEqual([])
    expect([...axes]).toEqual([
      ['state', ['default', 'hover']],
      ['size', ['md', 'sm']],
    ])
  })

  it('is absent, and that is the ordinary component', () => {
    const doc = parseOrThrow(component('', `    <Frame name="container" layoutMode="VERTICAL" />`))
    const button = resolve(doc.tree, 'Button')!
    expect(hasVariants(button)).toBe(false)
    expect(componentVariants(button)).toEqual({ axes: new Map(), problems: [] })
  })

  it('refuses anything that is not a map of axes to string lists', () => {
    expect(codes(component(`['state']`, variant(`state="default"`)))).toContain(CODES.BAD_VARIANTS)
    expect(codes(component(`{ state: 'default' }`, variant(`state="default"`)))).toContain(
      CODES.BAD_VARIANTS,
    )
    expect(codes(component(`{ state: [] }`, variant(`state="default"`)))).toContain(
      CODES.BAD_VARIANTS,
    )
    expect(codes(component(`{ state: ['default', 2] }`, variant(`state="default"`)))).toContain(
      CODES.BAD_VARIANTS,
    )
  })

  it('refuses the four characters that already have jobs', () => {
    // `#` bounds an entity and `/` walks inside one; `=` and `,` are the derived
    // spelling's own separators, which the SDK reads back.
    for (const bad of ['#', '/', '=', ',']) {
      expect(codes(component(`{ 'st${bad}ate': ['a'] }`, variant(`state="default"`)))).toContain(
        CODES.BAD_VARIANTS,
      )
      expect(
        codes(component(`{ state: ['de${bad}fault'] }`, variant(`state="default"`))),
      ).toContain(CODES.BAD_VARIANTS)
    }
  })

  it('refuses a value listed twice, which would make one combination two', () => {
    expect(codes(component(`{ state: ['a', 'a'] }`, variant(`state="a"`)))).toContain(
      CODES.BAD_VARIANTS,
    )
  })

  it('refuses an axis that collides with a component property', () => {
    // F7 assigns both through one `props` object, so a collision would mean
    // whichever the resolver happened to reach first.
    const source = page(`  <Component name="Button" status="draft"
    props={{ state: { type: 'TEXT', default: 'x' } }}
    variants={{ state: ['default'] }}>
${variant(`state="default"`)}
  </Component>`)
    expect(codes(source)).toContain(CODES.BAD_VARIANTS)
  })

  it('belongs to <Component> and nowhere else', () => {
    expect(codes(page(`  <Frame name="f" variants={{ state: ['a'] }} />`))).toEqual([
      CODES.METADATA_ATTR_MISPLACED,
    ])
  })
})

describe('a variant', () => {
  it('is named by its coordinates, and that is its address segment', () => {
    const doc = parseOrThrow(BUTTON)
    expect(doc.tree.children[0]!.children.map((v) => v.address)).toEqual([
      'Button#state=default',
      'Button#state=hover',
    ])
    expect(resolve(doc.tree, 'Button#state=hover/container/label')!.attrs.characters!.value).toBe(
      'Hover',
    )
  })

  it('orders its name by the declaration, not by how it was typed', () => {
    // Two variants writing their axes in different orders must derive the same
    // spelling for the same combination, or a rename would be an accident of
    // typing order.
    const doc = parseOrThrow(
      component(
        `{ state: ['default', 'hover'], size: ['md'] }`,
        [variant(`size="md" state="default"`), variant(`state="hover" size="md"`)].join('\n'),
      ),
    )
    expect(doc.tree.children[0]!.children.map((v) => v.name)).toEqual([
      'state=default, size=md',
      'state=hover, size=md',
    ])
  })

  it('spells a combination the way the SDK does', () => {
    expect(
      variantName(
        new Map([
          ['state', 'hover'],
          ['size', 'sm'],
        ]),
      ),
    ).toBe('state=hover, size=sm')
  })

  it('refuses a value outside the axis domain', () => {
    const source = component(STATE, variant(`state="nope"`))
    expect(only(source, CODES.BAD_VARIANT).message).toContain('"default" | "hover" | "pressed"')
    // And says the second true thing: a variant with no valid coordinates
    // covers no combination, so this component now has no default.
    expect(codes(source)).toContain(CODES.MISSING_DEFAULT_VARIANT)
  })

  it('refuses an unassigned axis', () => {
    const source = component(`{ state: ['default'], size: ['md'] }`, variant(`state="default"`))
    expect(only(source, CODES.BAD_VARIANT).message).toContain('"size" is missing')
  })

  it('refuses an attribute that is not a declared axis', () => {
    // `<Variant>` is exempt from the §3.3 whitelist, so without this an
    // attribute nobody declared would be spelled correctly and do nothing.
    const source = component(STATE, variant(`state="default" tone="quiet"`))
    expect(only(source, CODES.BAD_VARIANT).message).toContain('not a declared axis')
  })

  it('refuses a name of its own', () => {
    const source = component(STATE, variant(`state="default" name="hover"`))
    expect(only(source, CODES.BAD_VARIANT).message).toContain('named by its coordinates')
  })

  it('refuses two variants covering the same combination', () => {
    const source = component(
      STATE,
      [variant(`state="default"`), variant(`state="default"`)].join('\n'),
    )
    // Said in terms of what the author wrote, not the derived name they did not.
    expect(only(source, CODES.DUPLICATE_VARIANT).message).toContain('already covers')
  })

  it('holds exactly one child', () => {
    const two = component(
      STATE,
      `    <Variant state="default">
      <Frame name="a" layoutMode="VERTICAL" />
      <Frame name="b" layoutMode="VERTICAL" />
    </Variant>`,
    )
    expect(codes(two)).toContain(CODES.COMPONENT_ARITY)
  })

  it('is legal only inside a component that declares axes', () => {
    const bare = component('', variant(`state="default"`))
    expect(codes(bare)).toContain(CODES.VARIANT_SHAPE)
    // And nowhere else at all.
    expect(
      codes(page(`  <Frame name="f" layoutMode="VERTICAL">\n${variant(`state="a"`)}\n  </Frame>`)),
    ).toContain(CODES.ELEMENT_NOT_ALLOWED_HERE)
  })
})

describe('the two shapes stay apart', () => {
  it('refuses variants declared over a plain child', () => {
    const mixed = component(STATE, `    <Frame name="container" layoutMode="VERTICAL" />`)
    expect(codes(mixed)).toContain(CODES.VARIANT_SHAPE)
  })

  it('refuses a component that declares variants and holds none', () => {
    const empty = page(`  <Component name="Button" status="draft" variants={${STATE}}></Component>`)
    expect(codes(empty)).toContain(CODES.VARIANT_SHAPE)
  })

  it('requires the default combination, and says which one it is', () => {
    const source = component(STATE, variant(`state="hover"`))
    expect(only(source, CODES.MISSING_DEFAULT_VARIANT).message).toContain(
      '<Variant state="default">',
    )
  })

  it('lets the rest be sparse, which is the point of declaring the domain', () => {
    // `state=pressed` is a combination nobody designed, not an obligation.
    expect(codes(BUTTON)).toEqual([])
  })

  it('lets a component without variants hold several children (ADR 0008 §1)', () => {
    // The one-child rule was never shared with `<Variant>`, it only looked
    // shared: a component is a frame and holds what a frame holds, while a
    // variant is one state's tree that `arrangeVariants` measures as one box.
    const two = component(
      '',
      `    <Frame name="a" layoutMode="VERTICAL" />\n    <Frame name="b" layoutMode="VERTICAL" />`,
    )
    expect(codes(two)).toEqual([])
  })

  it('says the default is each axis first value', () => {
    expect([
      ...defaultCombination(
        new Map([
          ['state', ['default', 'hover']],
          ['size', ['md', 'sm']],
        ]),
      ),
    ]).toEqual([
      ['state', 'default'],
      ['size', 'md'],
    ])
  })
})

/**
 * Patching a component that has states (story F9, found by building it).
 *
 * Three of the patcher's structural guards predate `<Variant>` and were wrong
 * about it: the child whitelist, the one-child rule, and the auto-namer. Each
 * refused or corrupted an ordinary F9 edit, and none of F8's own tests could
 * have caught them — F8 only ever read variant files, never wrote one.
 */
describe('the patcher and a component with states', () => {
  // A sparse third value, so an insert has a legal combination to land on —
  // adding a value and designing it are two steps (F9's own decision).
  const CHIP = component(
    `{ state: ['off', 'on', 'pressed'] }`,
    [variant(`state="off"`), variant(`state="on"`, 'On')].join('\n'),
  )

  const insert = (attrs: Record<string, string>) =>
    applyPatches(CHIP, [
      {
        op: 'insert-node',
        parent: 'Button',
        index: 2,
        node: {
          element: 'Variant',
          attrs,
          children: [{ element: 'Frame', attrs: { name: 'container', layoutMode: 'VERTICAL' } }],
        },
      },
    ]).source

  it('inserts a <Variant> into a <Component>, which is not a second plain child', () => {
    const doc = parseOrThrow(insert({ state: 'pressed' }))
    expect(resolve(doc.tree, 'Button')!.children.map((v) => v.name)).toEqual([
      'state=off',
      'state=on',
      'state=pressed',
    ])
  })

  it('does not invent a name for it, because its coordinates are its name', () => {
    // The inserted tag alone: the document is full of legitimate `name=`.
    const line = insert({ state: 'pressed' })
      .split('\n')
      .find((l) => l.includes('<Variant state="pressed"'))
    expect(line).toBeDefined()
    expect(line).not.toContain('name=')
  })

  it('takes a second plain child, which ADR 0008 §1 permits', () => {
    // v1 capped this because a component was a wrapper around a frame. It is
    // the frame now, so a second child is what a second child is anywhere else.
    const plain = page(
      `  <Component name="Button" status="draft"><Frame name="a" layoutMode="VERTICAL" /></Component>`,
    )
    const out = applyPatches(plain, [
      {
        op: 'insert-node',
        parent: 'Button',
        index: 1,
        node: { element: 'Frame', attrs: { name: 'b' } },
      },
    ]).source
    expect(resolve(parseOrThrow(out).tree, 'Button')!.children.map((c) => c.name)).toEqual([
      'a',
      'b',
    ])
  })

  it('refuses a second child inside a <Variant>', () => {
    expect(() =>
      applyPatches(CHIP, [
        {
          op: 'insert-node',
          parent: 'Button#state=off',
          index: 1,
          node: { element: 'Frame', attrs: { name: 'b' } },
        },
      ]),
    ).toThrow(/only one child/)
  })

  it('removes one state of several, and refuses the last one', () => {
    const out = applyPatches(CHIP, [{ op: 'remove-node', address: 'Button#state=on' }]).source
    expect(resolve(parseOrThrow(out).tree, 'Button')!.children.map((v) => v.name)).toEqual([
      'state=off',
    ])
    // The last state is still refused, but by the parser rather than by an
    // arity guard in the patcher: a component that *declares* `variants` and
    // holds none is an invalid document, and `applyPatch` re-parses before it
    // writes. One rule, in the place that owns it.
    expect(() => applyPatches(out, [{ op: 'remove-node', address: 'Button#state=off' }])).toThrow(
      /invalid document/,
    )
  })

  it('refuses to empty a <Variant>', () => {
    expect(() =>
      applyPatches(CHIP, [{ op: 'remove-node', address: 'Button#state=off/container' }]),
    ).toThrow(/sole child/)
  })
})
