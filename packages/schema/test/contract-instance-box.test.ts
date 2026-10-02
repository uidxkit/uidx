import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseOrThrow, type UidxDocument, type UidxNode } from '@uidx/format'
import { contractJson } from '../src/design-system.js'
import {
  INSTANCE_BOX_PROPS,
  INSTANCE_CASCADE_PROPS,
  INSTANCE_PLACEMENT_PROPS,
  instanceRole,
} from '../src/instance-box.js'
import { buildPage } from './helpers/workspace-scene.js'

/**
 * What `uidx contract` says about an instance's outer box (ADR 0018 §6): the
 * role table and the CSS hooks once per document, and for each component the
 * node a use's box lands on and whether that node lays out. A generator that
 * has not read the ADR implements the same API from this alone.
 */
const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '../../..')

const read = (file: string): UidxDocument =>
  parseOrThrow(readFileSync(join(repo, file), 'utf8'), file)

const page = (id: string, body: string, regions = '') =>
  parseOrThrow(`---\nid: ${id}\n---\n\n## Visual Contract\n\n<Page>\n${body}\n</Page>\n${regions}`)

interface Entry {
  name: string
  box: { target: string; node?: string; component?: string; part?: string }
  laysOut: boolean | null
}

const entries = (doc: UidxDocument, components?: ReadonlyMap<string, UidxNode>): Entry[] =>
  contractJson(doc, components).components as Entry[]

const entry = (doc: UidxDocument, name: string, components?: ReadonlyMap<string, UidxNode>) =>
  entries(doc, components).find((component) => component.name === name)!

const componentsOf = (...docs: UidxDocument[]): Map<string, UidxNode> =>
  new Map(
    docs.flatMap((doc) =>
      doc.tree.children
        .filter((node) => node.element === 'Component')
        .map((node) => [node.name, node] as const),
    ),
  )

const button1 = () => read('packages/schema/test/fixtures/instance-box/button1.uidx')
const kinds = () => read('packages/schema/test/fixtures/instance-box/kinds.uidx')

describe('the role table and the hooks, once per document', () => {
  const table = contractJson(button1()).instanceBox as {
    version: number
    box: string[]
    cascade: string[]
    placement: string[]
    hooks: Record<string, string>
  }

  it('lists the outer box, the cascade and placement from the one table', () => {
    expect(table.version).toBe(1)
    expect(table.box).toEqual([...INSTANCE_BOX_PROPS])
    expect(table.cascade).toEqual(['textFills'])
    expect(table.placement).toEqual([...INSTANCE_PLACEMENT_PROPS])
  })

  it('names the custom property each box attribute and textFills is read through', () => {
    expect(table.hooks.fills).toBe('--uidx-fill')
    expect(table.hooks.strokes).toBe('--uidx-stroke')
    expect(table.hooks.dashPattern).toBe('--uidx-stroke-style')
    expect(table.hooks.strokeLeftWeight).toBe('--uidx-stroke-left-weight')
    expect(table.hooks.cornerRadius).toBe('--uidx-radius')
    expect(table.hooks.bottomRightRadius).toBe('--uidx-radius-bottom-right')
    expect(table.hooks.paddingTop).toBe('--uidx-padding-top')
    expect(table.hooks.opacity).toBe('--uidx-opacity')
    expect(table.hooks.effects).toBe('--uidx-shadow')
    expect(table.hooks.textFills).toBe('--uidx-text-color')
  })

  it('hooks every box attribute but the two with no CSS form, and nothing else', () => {
    const hooked = Object.keys(table.hooks)
    for (const prop of hooked) expect([prop, instanceRole(prop)]).not.toEqual([prop, 'locked'])
    expect(INSTANCE_BOX_PROPS.filter((prop) => !hooked.includes(prop))).toEqual([
      'strokeAlign',
      'cornerSmoothing',
    ])
    for (const prop of INSTANCE_CASCADE_PROPS) expect(hooked).toContain(prop)
    const names = Object.values(table.hooks)
    expect(new Set(names).size).toBe(names.length)
    for (const name of names) expect(name).toMatch(/^--uidx-[a-z-]+$/)
  })

  it('is plain data a generator can read', () => {
    const json = contractJson(button1())
    expect(JSON.parse(JSON.stringify(json))).toEqual(json)
  })
})

describe('where each component puts a use’s outer box (ADR 0018 §2)', () => {
  it('is the derived root of a component with a styles table', () => {
    expect(entry(button1(), 'Button1')).toMatchObject({
      box: { target: 'frame', node: 'root' },
      laysOut: true,
    })
  })

  it('is the instance a composition holds, laying out as its component does', () => {
    const field = read('examples/design-system/.uidx/field.uidx')
    const composition = read('examples/design-system/.uidx/checkbox-field.uidx')
    expect(entry(composition, 'CheckboxField', componentsOf(field, composition))).toMatchObject({
      box: { target: 'instance', node: 'field', component: 'Field' },
      laysOut: true,
    })
  })

  it('cannot say whether a composition lays out without the component it holds', () => {
    const composition = read('examples/design-system/.uidx/checkbox-field.uidx')
    expect(entry(composition, 'CheckboxField')).toMatchObject({
      box: { target: 'instance', node: 'field', component: 'Field' },
      laysOut: null,
    })
  })

  it('follows a composition to a component on the same page', () => {
    const doc = page(
      'pair',
      `  <Component name="Inner" layoutMode="VERTICAL" paddingLeft={4}>
    <Text name="words" characters="Hi" />
  </Component>
  <Component name="Outer">
    <Instance name="inner" component="Inner" />
  </Component>`,
    )
    expect(entry(doc, 'Outer')).toMatchObject({
      box: { target: 'instance', node: 'inner', component: 'Inner' },
      laysOut: true,
    })
  })

  it('is the component itself when it lays itself out', () => {
    expect(entry(kinds(), 'Chip')).toMatchObject({ box: { target: 'self' }, laysOut: true })
    expect(entry(kinds(), 'Chip').box).toEqual({ target: 'self' })
  })

  it('is the frame a bare component wraps, and the frame of the resting authored variant', () => {
    expect(entry(kinds(), 'Tag')).toMatchObject({
      box: { target: 'frame', node: 'box' },
      laysOut: true,
    })
    expect(entry(kinds(), 'Badge')).toMatchObject({
      box: { target: 'frame', node: 'badge' },
      laysOut: true,
    })
  })

  it('is the part a frame of the component’s own only wraps, as Shoelace’s Button draws on base', () => {
    for (const name of ['Button', 'Checkbox', 'Switch'])
      expect(entry(read(`examples/shoelace/.uidx/${name.toLowerCase()}.uidx`), name)).toEqual(
        expect.objectContaining({
          box: { target: 'frame', node: 'base', part: 'base' },
          laysOut: true,
        }),
      )
    // A frame with a width of its own is the box, whatever it holds.
    expect(entry(read('examples/shoelace/.uidx/input.uidx'), 'Input')).toMatchObject({
      box: { target: 'frame', node: 'root' },
      laysOut: true,
    })
  })

  it('names the part only where the box node binds one', () => {
    expect(entry(kinds(), 'Tag').box).toEqual({ target: 'frame', node: 'box' })
  })

  it('says when the box does not lay out, so an instance’s padding would do nothing', () => {
    const doc = page(
      'dot',
      `  <Component name="Dot" width={8} height={8} cornerRadius={4} fills="{surface#accent}">
    <Vector name="mark" width={4} height={4}
      vectorPaths={[{ windingRule: 'NONZERO', data: 'M0 0 L4 4' }]} />
    <Vector name="other" width={4} height={4}
      vectorPaths={[{ windingRule: 'NONZERO', data: 'M4 0 L0 4' }]} />
  </Component>
  <Component name="Free">
    <Frame name="box" layoutMode="NONE" width={20} height={20} />
  </Component>`,
    )
    expect(entry(doc, 'Dot')).toMatchObject({ box: { target: 'self' }, laysOut: false })
    expect(entry(doc, 'Free')).toMatchObject({
      box: { target: 'frame', node: 'box' },
      laysOut: false,
    })
  })

  it('lays out for a component that declares no geometry, which the build draws as a column', () => {
    const doc = page(
      'bare',
      `  <Component name="Label">
    <Text name="words" characters="Label" />
  </Component>
  <Component name="Pair">
    <Text name="first" characters="A" />
    <Text name="second" characters="B" />
  </Component>
  <Component name="Wide" width={80}>
    <Text name="words" characters="Wide" />
  </Component>
  <Component name="Loose" layoutMode="NONE">
    <Text name="words" characters="Loose" />
  </Component>`,
    )
    expect(entry(doc, 'Label')).toMatchObject({ box: { target: 'self' }, laysOut: true })
    expect(entry(doc, 'Pair')).toMatchObject({ box: { target: 'self' }, laysOut: true })
    // A size, or a layout of NONE, says it places its children itself.
    expect(entry(doc, 'Wide')).toMatchObject({ box: { target: 'self' }, laysOut: false })
    expect(entry(doc, 'Loose')).toMatchObject({ box: { target: 'self' }, laysOut: false })
  })

  it('gives up on a composition that holds itself rather than looping', () => {
    const doc = page(
      'loop',
      `  <Component name="Ouroboros">\n    <Instance name="tail" component="Ouroboros" />\n  </Component>`,
    )
    expect(entry(doc, 'Ouroboros')).toMatchObject({
      box: { target: 'instance', node: 'tail', component: 'Ouroboros' },
      laysOut: null,
    })
  })
})

describe('whether the box lays out, as the canvas draws it', () => {
  /**
   * One of each shape a box can take, each holding content a use's padding
   * would move: a component that is its own box — bare, laid out, sized, or
   * with a layout of NONE — and an authored variant that is its own box; a
   * wrapped frame with a layout and one without; and a styles table's root,
   * which hugs what it holds as its bare component does.
   */
  const LIBRARY = page(
    'shapes',
    `  <Component name="Bare">
    <Text name="words" characters="Bare" />
  </Component>
  <Component name="Toned" variants={{ tone: ['info', 'warn'] }}>
    <Variant tone="info"><Text name="words" characters="Info" /></Variant>
    <Variant tone="warn"><Text name="words" characters="Warn" /></Variant>
  </Component>
  <Component name="Row" layoutMode="HORIZONTAL">
    <Text name="words" characters="Row" />
  </Component>
  <Component name="Sized" width={80} height={40}>
    <Text name="words" characters="Sized" />
  </Component>
  <Component name="Loose" layoutMode="NONE">
    <Text name="words" characters="Loose" />
  </Component>
  <Component name="Wrapped">
    <Frame name="box" layoutMode="VERTICAL">
      <Text name="words" characters="Wrapped" />
    </Frame>
  </Component>
  <Component name="Placed">
    <Frame name="box" width={80} height={40}>
      <Text name="words" characters="Placed" />
    </Frame>
  </Component>`,
  )
  const STYLED = page(
    'styled',
    `  <Component name="Styled">
    <Text name="words" characters="Styled" />
  </Component>`,
    `\n<Styles>\n  <Style state="hover" root:opacity={0.5} />\n</Styles>\n`,
  )

  it('pads the content exactly where the contract says the box lays out', () => {
    const shapes = entries(LIBRARY).concat(entries(STYLED))
    const uses = page(
      'uses',
      shapes
        .map(
          ({ name }, row) =>
            `  <Instance name="plain${name}" component="${name}" x={0} y={${row * 200}} />\n` +
            `  <Instance name="padded${name}" component="${name}" x={200} y={${row * 200}} paddingLeft={20} />`,
        )
        .join('\n'),
    )
    const docs = new Map([
      ['shapes.uidx', LIBRARY],
      ['styled.uidx', STYLED],
      ['uses.uidx', uses],
    ])
    const scene = buildPage(docs, uses)
    // The content's offset inside the node the box lands on.
    const inset = (instance: string, box: Entry['box']): number => {
      const id = box.target === 'self' ? instance : `${instance}#${box.node}`
      const content = scene.graph.getNode(id)!.childIds[0]!
      return scene.graph.getNode(content)!.x
    }
    const padded = shapes.map(({ name, box }) => [
      name,
      inset(`padded${name}`, box) !== inset(`plain${name}`, box),
    ])
    expect(padded).toEqual(shapes.map(({ name, laysOut }) => [name, laysOut]))
    expect(Object.fromEntries(padded)).toEqual({
      Bare: true,
      Toned: true,
      Row: true,
      Sized: false,
      Loose: false,
      Wrapped: true,
      Placed: false,
      Styled: true,
    })
  })
})
