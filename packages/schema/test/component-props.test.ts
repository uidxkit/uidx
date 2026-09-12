import { describe, expect, it } from 'vitest'
import { parseOrThrow, type UidxNode } from '@uidx/format'
import { toSceneGraph } from '../src/index.js'

/**
 * A component rendering with its declared defaults (story F6).
 *
 * The claim worth testing is that this needed *no* new path through the mapping
 * layer. `scenePropFor` already substitutes `{target}` before the prop table
 * sees a value, so a component property is a resolver that knows the names in
 * scope — and "in scope" is the whole subtlety, since two components may each
 * declare `label` and mean different things.
 */
const page = (id: string, body: string) =>
  `---\nid: ${id}\n---\n\n## Visual Contract\n\n<Page>\n${body}\n</Page>\n`

const BUTTON = parseOrThrow(
  page(
    'button',
    `  <Component name="Button/Primary" status="stable"
    props={{
      label: { type: 'TEXT', default: 'Click me' },
      showIcon: { type: 'BOOLEAN', default: true },
    }}>
    <Frame name="container" layoutMode="HORIZONTAL">
      <Vector name="icon" visible="{showIcon}" width={16} height={16} />
      <Text name="label" characters="{label}" fontSize={14} />
    </Frame>
  </Component>`,
  ),
)

function componentIndex(...docs: readonly (typeof BUTTON)[]): Map<string, UidxNode> {
  const out = new Map<string, UidxNode>()
  for (const doc of docs) {
    if (doc.tree.element === 'Tokens') continue
    for (const node of doc.tree.children) {
      if (node.element === 'Component') out.set(node.name, node)
    }
  }
  return out
}

function build(source: string, ...defining: readonly (typeof BUTTON)[]) {
  const doc = parseOrThrow(source)
  const index = componentIndex(doc, ...defining)
  return toSceneGraph(doc, {
    resolveComponent: (name) => index.get(name),
    resolveAlias: (address) => (address === 'radius#md' ? 8 : undefined),
  })
}

describe('a component draws with its own defaults', () => {
  it('substitutes a TEXT property into the layer bound to it', () => {
    const { graph } = build(BUTTON.source)
    expect(graph.getNode('Button/Primary#container/label')!.text).toBe('Click me')
  })

  it('substitutes a BOOLEAN property as a real boolean', () => {
    const { graph } = build(BUTTON.source)
    expect(graph.getNode('Button/Primary#container/icon')!.visible).toBe(true)
  })

  it('leaves everything not bound alone', () => {
    const { graph } = build(BUTTON.source)
    expect(graph.getNode('Button/Primary#container/label')!.fontSize).toBe(14)
  })
})

describe("an instance draws with the definition's defaults", () => {
  const USES = page('home', `  <Instance name="save" component="Button/Primary" />`)

  it('resolves the binding inside the generated subtree', () => {
    const { graph } = build(USES, BUTTON)
    expect(graph.getNode('save#container/label')!.text).toBe('Click me')
    expect(graph.getNode('save#container/icon')!.visible).toBe(true)
  })

  it('still lets an override win, which is the escape hatch F3 shipped', () => {
    const { graph } = build(
      page(
        'home',
        `  <Instance name="save" component="Button/Primary"
    overrides={{ 'container/label': { characters: 'Save' } }} />`,
      ),
      BUTTON,
    )
    expect(graph.getNode('save#container/label')!.text).toBe('Save')
  })
})

describe('scope', () => {
  const OTHER = parseOrThrow(
    page(
      'other',
      `  <Component name="Other" status="draft" props={{ label: { type: 'TEXT', default: 'Elsewhere' } }}>
    <Frame name="root" layoutMode="VERTICAL">
      <Text name="t" characters="{label}" />
    </Frame>
  </Component>`,
    ),
  )

  it('gives two components their own meaning for one name', () => {
    const { graph } = build(
      page(
        'home',
        `  <Instance name="a" component="Button/Primary" />
  <Instance name="b" component="Other" />`,
      ),
      BUTTON,
      OTHER,
    )
    expect(graph.getNode('a#container/label')!.text).toBe('Click me')
    expect(graph.getNode('b#root/t')!.text).toBe('Elsewhere')
  })

  it('does not let a property leak out of the component that declares it', () => {
    // A page-level node binding `{label}` resolves to nothing; `uidx check`
    // reports it, and the renderer draws the engine default rather than the
    // literal text `{label}`.
    const { graph, warnings } = build(
      page('home', `  <Text name="loose" characters="{label}" />`),
      BUTTON,
    )
    expect(graph.getNode('loose')!.text).not.toBe('Click me')
    expect(warnings.join(' ')).toContain('label')
  })

  it('keeps tokens resolving inside a component, since they carry a #', () => {
    const bound = parseOrThrow(
      page(
        'bound',
        `  <Component name="Card" status="draft" props={{ label: { type: 'TEXT', default: 'Hi' } }}>
    <Frame name="root" cornerRadius="{radius#md}" layoutMode="VERTICAL">
      <Text name="t" characters="{label}" />
    </Frame>
  </Component>`,
      ),
    )
    const { graph } = build(bound.source)
    // `cornerRadius` maps to a scene field of the same name; the per-corner
    // ones are separate fields and stay at their defaults.
    expect(graph.getNode('Card#root')!.cornerRadius).toBe(8)
    expect(graph.getNode('Card#root/t')!.text).toBe('Hi')
  })

  it('lets an inner component shadow an outer one entirely', () => {
    const card = parseOrThrow(
      page(
        'card',
        `  <Component name="Card" status="draft" props={{ label: { type: 'TEXT', default: 'Outer' } }}>
    <Frame name="root" layoutMode="VERTICAL">
      <Instance name="action" component="Other" />
    </Frame>
  </Component>`,
      ),
    )
    const { graph } = build(page('home', `  <Instance name="c" component="Card" />`), card, OTHER)
    // `Other` declares its own `label`; `Card`'s does not reach inside it.
    expect(graph.getNode('c#root/action/root/t')!.text).toBe('Elsewhere')
  })
})

describe('INSTANCE_SWAP', () => {
  const ICONS = parseOrThrow(
    page(
      'icons',
      `  <Component name="Icon/Check" status="draft">
    <Frame name="root" layoutMode="VERTICAL"><Text name="g" characters="check" /></Frame>
  </Component>
  <Component name="Icon/Cross" status="draft">
    <Frame name="root" layoutMode="VERTICAL"><Text name="g" characters="cross" /></Frame>
  </Component>`,
    ),
  )

  const SWAPPER = parseOrThrow(
    page(
      'swapper',
      `  <Component name="Tile" status="draft"
    props={{ glyph: { type: 'INSTANCE_SWAP', default: 'Icon/Check' } }}>
    <Frame name="root" layoutMode="VERTICAL">
      <Instance name="mark" component="{glyph}" />
    </Frame>
  </Component>`,
    ),
  )

  it('resolves the component name a property stands for', () => {
    // `component` is a structural prop, so `scenePropFor` never substitutes the
    // alias — `componentFor` is the only place that can, and this is the test
    // that says so.
    const { graph } = build(
      page('home', `  <Instance name="t" component="Tile" />`),
      SWAPPER,
      ICONS,
    )
    expect(graph.getNode('t#root/mark/root/g')!.text).toBe('check')
  })

  it('says so when the name it stands for resolves to nothing', () => {
    const broken = parseOrThrow(
      page(
        'broken',
        `  <Component name="Tile" status="draft"
    props={{ glyph: { type: 'INSTANCE_SWAP', default: 'Icon/Missing' } }}>
    <Frame name="root" layoutMode="VERTICAL">
      <Instance name="mark" component="{glyph}" />
    </Frame>
  </Component>`,
      ),
    )
    const { warnings } = build(broken.source, ICONS)
    expect(warnings.join(' ')).toContain('Icon/Missing')
  })
})

describe('an instance assigns them (F7)', () => {
  const uses = (props: string) =>
    page('home', `  <Instance name="save" component="Button/Primary" props={${props}} />`)

  it("lays its own values over the definition's defaults", () => {
    const { graph } = build(uses(`{ label: 'Save' }`), BUTTON)
    expect(graph.getNode('save#container/label')!.text).toBe('Save')
    // The one it did not set still shows the default.
    expect(graph.getNode('save#container/icon')!.visible).toBe(true)
  })

  it('sets a BOOLEAN as a boolean', () => {
    const { graph } = build(uses(`{ showIcon: false }`), BUTTON)
    expect(graph.getNode('save#container/icon')!.visible).toBe(false)
  })

  it('leaves other uses of the same component alone', () => {
    const { graph } = build(
      page(
        'home',
        `  <Instance name="save" component="Button/Primary" props={{ label: 'Save' }} />
  <Instance name="other" component="Button/Primary" />`,
      ),
      BUTTON,
    )
    expect(graph.getNode('save#container/label')!.text).toBe('Save')
    expect(graph.getNode('other#container/label')!.text).toBe('Click me')
  })

  it('ignores a value for a property the component does not declare', () => {
    // `uidx check` names it; the renderer draws what it can rather than
    // applying a value nothing consumes.
    const { graph } = build(uses(`{ nope: 'x', label: 'Save' }`), BUTTON)
    expect(graph.getNode('save#container/label')!.text).toBe('Save')
  })

  it("ignores a value the declaration's type contradicts, and keeps the default", () => {
    const { graph } = build(uses(`{ showIcon: 'yes' }`), BUTTON)
    expect(graph.getNode('save#container/icon')!.visible).toBe(true)
  })

  it('reaches a nested instance inside a component', () => {
    const card = parseOrThrow(
      page(
        'card',
        `  <Component name="Card" status="draft">
    <Frame name="root" layoutMode="VERTICAL">
      <Instance name="action" component="Button/Primary" props={{ label: 'Inner' }} />
    </Frame>
  </Component>`,
      ),
    )
    const { graph } = build(page('home', `  <Instance name="c" component="Card" />`), card, BUTTON)
    expect(graph.getNode('c#root/action/container/label')!.text).toBe('Inner')
  })
})
