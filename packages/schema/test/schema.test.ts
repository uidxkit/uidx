import { describe, expect, it } from 'vitest'
import { parseOrThrow } from '@uidx/format'

import {
  fromSceneChange,
  IDENTITY_PROPS,
  mappingFor,
  PROP_TABLE,
  toSceneGraph,
} from '../src/index.js'

const BUTTON =
  '---\nid: primary-button\n---\n\n## Core Intent\n\nThe primary CTA must draw immediate focus to drive conversions.\n\n## Anti-Patterns\n\n- NEVER use more than one per view context.\n\n## Visual Contract\n\n<Page>\n  <Component\n    name="Button/Primary"\n    status="stable"\n    props={{\n      label: { type: \'TEXT\', default: \'Click Me\' },\n      showIcon: { type: \'BOOLEAN\', default: true },\n    }}\n  >\n    <Frame\n      name="container"\n      layoutMode="HORIZONTAL"\n      primaryAxisSizingMode="AUTO"\n      counterAxisSizingMode="AUTO"\n      primaryAxisAlignItems="CENTER"\n      counterAxisAlignItems="CENTER"\n      itemSpacing={8}\n      paddingLeft={16} paddingRight={16}\n      paddingTop={12} paddingBottom={12}\n      cornerRadius={8}\n      fills={[{ type: \'SOLID\', color: { r: 0.1, g: 0.4, b: 0.9, a: 1 } }]}\n    >\n      <Vector\n        name="leading-icon"\n        width={16}\n        height={16}\n        visible="{showIcon}"\n        vectorPaths={[{ windingRule: \'NONZERO\', data: \'M3 8 L7 12 L13 4 L11 2 L7 8 L5 6 Z\' }]}\n        fills={[{ type: \'SOLID\', color: { r: 1, g: 1, b: 1, a: 1 } }]}\n      />\n      <Text\n        name="label"\n        characters="{label}"\n        fontSize={14}\n        fontWeight="BOLD"\n        textAutoResize="WIDTH_AND_HEIGHT"\n        fills={[{ type: \'SOLID\', color: { r: 1, g: 1, b: 1, a: 1 } }]}\n      />\n    </Frame>\n  </Component>\n</Page>\n'

const build = () => {
  const doc = parseOrThrow(BUTTON)
  const scene = toSceneGraph(doc)
  return { doc, ...scene }
}

describe('toSceneGraph', () => {
  it('builds the tree with UIDX addresses as scene ids', () => {
    const { graph, addresses } = build()
    expect(graph.getNode('Button/Primary')?.type).toBe('COMPONENT')
    expect(graph.getNode('Button/Primary#container')?.type).toBe('FRAME')
    expect(graph.getNode('Button/Primary#container/label')?.type).toBe('TEXT')

    // Every entity and every node inside one is the identity function now; the
    // bimap's single exception moved onto <Page> (ADR 0003).
    expect(addresses.addressOf('Button/Primary')).toBe('Button/Primary')
    expect(addresses.addressOf('Button/Primary#container/label')).toBe(
      'Button/Primary#container/label',
    )
  })

  it('maps <Page> onto the page the editor actually shows', () => {
    const { graph, rootId, addresses } = build()
    const pages = graph.getPages()
    expect(pages).toHaveLength(1)
    // The file's <Page> *is* the graph's page — not a node built underneath it.
    expect(rootId).toBe(pages[0]!.id)
    expect(addresses.sceneIdOf('')).toBe(pages[0]!.id)
    expect(addresses.addressOf(pages[0]!.id)).toBe('')
    expect(pages[0]!.childIds).toContain('Button/Primary')
  })

  it('applies the renames', () => {
    const { graph } = build()
    const frame = graph.getNode('Button/Primary#container')!
    expect(frame.primaryAxisAlign).toBe('CENTER')
    expect(frame.counterAxisAlign).toBe('CENTER')
    expect(graph.getNode('Button/Primary#container/label')!.text).toBe('Click Me')
  })

  it('converts named font weights to numbers', () => {
    expect(build().graph.getNode('Button/Primary#container/label')!.fontWeight).toBe(700)
  })

  it('fills out the Fill shape scene-graph requires', () => {
    const fill = build().graph.getNode('Button/Primary#container')!.fills[0]!
    expect(fill).toMatchObject({
      type: 'SOLID',
      color: { r: 0.1, g: 0.4, b: 0.9, a: 1 },
      opacity: 1,
      visible: true,
    })
  })

  it('makes the root Component hug its content instead of clipping it', () => {
    const root = build().graph.getNode('Button/Primary')!
    // Left to its defaults a COMPONENT is a fixed 100x100 frame, so the button
    // rendered cropped. It must wrap its child instead.
    expect(root.layoutMode).toBe('VERTICAL')
    expect(root.primaryAxisSizing).toBe('HUG')
    expect(root.counterAxisSizing).toBe('HUG')
    expect(root.clipsContent).toBe(false)
  })

  it('lets an explicit size on <Component> win over hugging', () => {
    // Anchored on the one attribute rather than on the whole open tag: the
    // canonical example is a moving target, and a fixture surgery that matches
    // a whole tag becomes a silent no-op the next time a story reformats it.
    // (That is exactly what F6 did to this test.)
    const doc = parseOrThrow(
      BUTTON.replace('status="stable"', 'status="stable" width={200} height={60}'),
    )
    const root = toSceneGraph(doc).graph.getNode('Button/Primary')!
    expect(root.width).toBe(200)
    expect(root.height).toBe(60)
    expect(root.layoutMode).toBe('NONE')
  })

  it('runs the layout pass so auto-layout frames hug their content', () => {
    const { graph } = build()
    const container = graph.getNode('Button/Primary#container')!
    // A FRAME defaults to 100x100. Hugging an 16px icon + gap + label + 32px of
    // horizontal padding has to come out wider than that; if layout never ran
    // the frame would still read exactly 100.
    expect(container.width).toBeGreaterThan(100)
    expect(container.width).toBe(
      graph.getNode('Button/Primary#container/leading-icon')!.width +
        container.itemSpacing +
        graph.getNode('Button/Primary#container/label')!.width +
        container.paddingLeft +
        container.paddingRight,
    )
  })

  it('sizes the root Component to its laid-out child', () => {
    const { graph } = build()
    expect(graph.getNode('Button/Primary')!.width).toBe(
      graph.getNode('Button/Primary#container')!.width,
    )
  })

  it('passes identity props straight through', () => {
    const icon = build().graph.getNode('Button/Primary#container/leading-icon')!
    expect(icon.width).toBe(16)
    expect(icon.visible).toBe(true)
    expect(build().graph.getNode('Button/Primary#container')!.paddingLeft).toBe(16)
  })
})

describe('strokes (ADR 0002 — Figma Paint shape in the file)', () => {
  const withStroke = (extra: string) =>
    BUTTON.replace(
      'cornerRadius={8}',
      `cornerRadius={8}\n    strokes={[{ type: 'SOLID', color: { r: 0, g: 0, b: 0, a: 1 } }]}\n    ${extra}`,
    )

  it('composes engine Strokes from Paints plus node-level weight and align', () => {
    const doc = parseOrThrow(withStroke('strokeWeight={2}\n    strokeAlign="OUTSIDE"'))
    const stroke = toSceneGraph(doc).graph.getNode('Button/Primary#container')!.strokes[0]!
    expect(stroke).toEqual({
      color: { r: 0, g: 0, b: 0, a: 1 },
      weight: 2,
      align: 'OUTSIDE',
      opacity: 1,
      visible: true,
    })
  })

  it('defaults to INSIDE, matching Figma and the CSS border model', () => {
    const doc = parseOrThrow(withStroke('strokeWeight={2}'))
    expect(toSceneGraph(doc).graph.getNode('Button/Primary#container')!.strokes[0]!.align).toBe(
      'INSIDE',
    )
  })

  it('drops the Figma-only `type` key, which Stroke has no field for', () => {
    const doc = parseOrThrow(withStroke('strokeWeight={2}'))
    const stroke = toSceneGraph(doc).graph.getNode('Button/Primary#container')!.strokes[0]!
    expect(Object.hasOwn(stroke, 'type')).toBe(false)
  })

  it('follows a token alias on strokeWeight and strokeAlign', () => {
    const doc = parseOrThrow(
      withStroke('strokeWeight="{stage#hairline}"\n    strokeAlign="{stage#align}"'),
    )
    const bound = new Map<string, number | string>([
      ['stage#hairline', 4],
      ['stage#align', 'OUTSIDE'],
    ])
    const stroke = toSceneGraph(doc, { resolveAlias: (a) => bound.get(a) }).graph.getNode(
      'Button/Primary#container',
    )!.strokes[0]!
    expect(stroke.weight).toBe(4)
    expect(stroke.align).toBe('OUTSIDE')
  })

  it('still sets the per-side weights that drive layout', () => {
    const doc = parseOrThrow(withStroke('strokeWeight={3}'))
    const frame = toSceneGraph(doc).graph.getNode('Button/Primary#container')!
    expect(frame.borderTopWeight).toBe(3)
    expect(frame.borderLeftWeight).toBe(3)
  })

  it('reads weight and align back off the stroke', () => {
    const doc = parseOrThrow(withStroke('strokeWeight={2}\n    strokeAlign="CENTER"'))
    const ctx = { doc, ...toSceneGraph(doc) }
    expect(
      mappingFor('strokeAlign')!.fromScene(ctx.graph.getNode('Button/Primary#container')!),
    ).toBe('CENTER')
    expect(
      mappingFor('strokeWeight')!.fromScene(ctx.graph.getNode('Button/Primary#container')!),
    ).toBe(2)
  })
})

describe('PROP_TABLE round-trips', () => {
  const cases: Record<string, unknown[]> = {
    primaryAxisAlignItems: ['MIN', 'CENTER', 'MAX'],
    counterAxisAlignItems: ['MIN', 'CENTER', 'MAX'],
    primaryAxisSizingMode: ['AUTO', 'FIXED'],
    counterAxisSizingMode: ['AUTO', 'FIXED'],
    layoutAlign: ['INHERIT', 'STRETCH'],
    strokeTopWeight: [0, 2],
    strokeRightWeight: [0, 2],
    strokeBottomWeight: [0, 2],
    strokeLeftWeight: [0, 2],
    characters: ['', 'hello', 'multi word'],
    fontWeight: ['THIN', 'REGULAR', 'BOLD', 'BLACK'],
    strokeWeight: [0, 1, 2.5],
    constraints: [{ horizontal: 'MIN', vertical: 'MAX' }],
  }

  for (const mapping of PROP_TABLE) {
    for (const value of cases[mapping.uidx] ?? []) {
      it(`${mapping.uidx} = ${JSON.stringify(value)}`, () => {
        const scene = mapping.toScene(value as never)
        expect(mapping.fromScene(scene)).toEqual(value)
      })
    }
  }

  it('turns vectorPaths into real geometry', () => {
    const net = build().graph.getNode('Button/Primary#container/leading-icon')!.vectorNetwork
    expect(net).not.toBeNull()
    expect(net!.vertices.length).toBeGreaterThan(2)
    expect(net!.segments.length).toBeGreaterThan(2)
  })

  it('never writes vector geometry back (one-way by design)', () => {
    expect(mappingFor('vectorPaths')!.fromScene({})).toBeUndefined()
  })

  /**
   * Props whose `toScene` deliberately contributes nothing on its own, so the
   * naive `fromScene(toScene(v))` identity does not apply. Each has dedicated
   * tests elsewhere in this file; listing them here keeps the exemption
   * deliberate rather than letting a missing case pass unnoticed.
   */
  const NOT_DIRECTLY_ROUND_TRIPPED: Record<string, string> = {
    vectorPaths: 'one-way: a VectorNetwork cannot be turned back into an SVG `d`',
    strokeAlign: 'composed into Stroke.align by composeStrokes, needs sibling attrs',
    strokeStartCap:
      'composed into VectorNetwork by withStrokeEndpoints; covered in stroke-endpoints.test.ts',
    strokeEndCap:
      'composed into VectorNetwork by withStrokeEndpoints; covered in stroke-endpoints.test.ts',
  }

  it('covers every mapping in the table', () => {
    for (const mapping of PROP_TABLE) {
      if (NOT_DIRECTLY_ROUND_TRIPPED[mapping.uidx]) continue
      expect(cases[mapping.uidx], `no round-trip case for ${mapping.uidx}`).toBeDefined()
    }
  })

  it('has no prop mapped twice', () => {
    const names = [...PROP_TABLE.map((m) => m.uidx), ...IDENTITY_PROPS]
    expect(new Set(names).size).toBe(names.length)
  })

  it('never maps a UIDX prop to a SceneNode field that does not exist', () => {
    // Guards against typos and against a field disappearing on SDK upgrade:
    // every target field must be present on a freshly created node.
    const { graph } = build()
    const probe = graph.getNode('Button/Primary#container')! as unknown as Record<string, unknown>
    const fields = [...PROP_TABLE.flatMap((m) => m.sceneFields), ...IDENTITY_PROPS]
    for (const field of fields) {
      expect(Object.hasOwn(probe, field), `SceneNode has no field "${field}"`).toBe(true)
    }
  })

  it('declines to collapse uneven stroke weights', () => {
    const m = mappingFor('strokeWeight')!
    expect(
      m.fromScene({
        borderTopWeight: 1,
        borderRightWeight: 2,
        borderBottomWeight: 1,
        borderLeftWeight: 1,
      }),
    ).toBeUndefined()
  })
})

describe('fromSceneChange', () => {
  it('turns a real edit into one set patch', () => {
    const ctx = build()
    ctx.graph.updateNode('Button/Primary#container', { paddingLeft: 24 })
    expect(fromSceneChange('Button/Primary#container', { paddingLeft: 24 }, ctx)).toEqual([
      { op: 'set', address: 'Button/Primary#container', prop: 'paddingLeft', value: 24 },
    ])
  })

  it('drops layout-derived geometry on auto-layout children', () => {
    const ctx = build()
    // Exactly the reflow burst Phase 0 observed.
    const patches = fromSceneChange(
      'Button/Primary#container/label',
      { x: 15.5, y: 0, width: 100, height: 100 },
      ctx,
    )
    expect(patches).toEqual([])
  })

  it('never writes a pinned coordinate back to the file', () => {
    // The reflow after a parent resize announces the child's new x. Under a
    // MAX pin that number is the pass's, not the author's, and writing it
    // would put a coordinate in a file whose own constraint says the
    // coordinate is computed — UIDX134's error, arrived at by accident.
    const source = [
      '---',
      'id: card',
      '---',
      '',
      '## Visual Contract',
      '',
      '<Page>',
      '  <Component name="Card">',
      '    <Frame name="body" width={320} height={200}>',
      `      <Text name="a" width={40} right={16} constraints={{ horizontal: 'MAX' }} />`,
      '    </Frame>',
      '  </Component>',
      '</Page>',
      '',
    ].join('\n')
    const doc = parseOrThrow(source)
    const scene = toSceneGraph(doc)
    const ctx = { doc, graph: scene.graph, addresses: scene.addresses, pins: scene.pins }
    expect(fromSceneChange('Card#body/a', { x: 344 }, ctx)).toEqual([])
  })

  it('never writes a stretched width back either', () => {
    const source = [
      '---',
      'id: card',
      '---',
      '',
      '## Visual Contract',
      '',
      '<Page>',
      '  <Component name="Card">',
      '    <Frame name="body" width={320} height={200}>',
      `      <Frame name="rule" x={16} right={16} height={2} constraints={{ horizontal: 'STRETCH' }} />`,
      '    </Frame>',
      '  </Component>',
      '</Page>',
      '',
    ].join('\n')
    const doc = parseOrThrow(source)
    const scene = toSceneGraph(doc)
    const ctx = { doc, graph: scene.graph, addresses: scene.addresses, pins: scene.pins }
    expect(fromSceneChange('Card#body/rule', { width: 368 }, ctx)).toEqual([])
  })

  it('still writes the axis a pin leaves alone', () => {
    // A horizontal pin says nothing about y. Refusing both would be the
    // whole-node answer this predicate deliberately is not.
    const source = [
      '---',
      'id: card',
      '---',
      '',
      '## Visual Contract',
      '',
      '<Page>',
      '  <Component name="Card">',
      '    <Frame name="body" width={320} height={200}>',
      `      <Text name="a" width={40} y={8} right={16} constraints={{ horizontal: 'MAX' }} />`,
      '    </Frame>',
      '  </Component>',
      '</Page>',
      '',
    ].join('\n')
    const doc = parseOrThrow(source)
    const scene = toSceneGraph(doc)
    const ctx = { doc, graph: scene.graph, addresses: scene.addresses, pins: scene.pins }
    // The value comes off the scene node, as every other case here does.
    ctx.graph.updateNode('Card#body/a', { y: 12 })
    expect(fromSceneChange('Card#body/a', { y: 12 }, ctx)).toEqual([
      { op: 'set', address: 'Card#body/a', prop: 'y', value: 12 },
    ])
  })

  it('turns a drag on a pinned axis into the offset it means', () => {
    // A drag settles as `updateNode({x, y})` — the coordinate language. On a
    // MAX-pinned node the file cannot hold x, so H1 dropped it and the drag
    // half-worked: y landed, x snapped back. The filter now converts: the
    // settled box against the parent's edge IS a new `right`, so that is what
    // reaches the file.
    const source = [
      '---',
      'id: card',
      '---',
      '',
      '## Visual Contract',
      '',
      '<Page>',
      '  <Component name="Card">',
      '    <Frame name="body" width={320} height={200}>',
      `      <Text name="a" width={40} height={20} right={16} y={8} constraints={{ horizontal: 'MAX' }} />`,
      '    </Frame>',
      '  </Component>',
      '</Page>',
      '',
    ].join('\n')
    const doc = parseOrThrow(source)
    const scene = toSceneGraph(doc)
    const ctx = { doc, graph: scene.graph, addresses: scene.addresses, pins: scene.pins }
    // The gesture moved the node to x=200 (and its y along with it).
    scene.graph.updateNode('Card#body/a', { x: 200, y: 30 })
    const patches = fromSceneChange('Card#body/a', { x: 200, y: 30 }, ctx)
    // 320 − 200 − 40 = 80. The y axis is unpinned and stays a plain write.
    expect(patches).toContainEqual({ op: 'set', address: 'Card#body/a', prop: 'right', value: 80 })
    expect(patches).toContainEqual({ op: 'set', address: 'Card#body/a', prop: 'y', value: 30 })
    expect(patches.some((p) => 'prop' in p && p.prop === 'x')).toBe(false)
  })

  it('keeps both offsets honest when a stretched node is dragged', () => {
    const source = [
      '---',
      'id: card',
      '---',
      '',
      '## Visual Contract',
      '',
      '<Page>',
      '  <Component name="Card">',
      '    <Frame name="body" width={320} height={200}>',
      `      <Frame name="rule" x={16} right={16} height={2} constraints={{ horizontal: 'STRETCH' }} />`,
      '    </Frame>',
      '  </Component>',
      '</Page>',
      '',
    ].join('\n')
    const doc = parseOrThrow(source)
    const scene = toSceneGraph(doc)
    const ctx = { doc, graph: scene.graph, addresses: scene.addresses, pins: scene.pins }
    // Drag right by 10: width unchanged (288), both offsets shift.
    scene.graph.updateNode('Card#body/rule', { x: 26 })
    const patches = fromSceneChange('Card#body/rule', { x: 26 }, ctx)
    expect(patches).toContainEqual({ op: 'set', address: 'Card#body/rule', prop: 'x', value: 26 })
    expect(patches).toContainEqual({
      op: 'set',
      address: 'Card#body/rule',
      prop: 'right',
      value: 6,
    })
    expect(patches.some((p) => 'prop' in p && p.prop === 'width')).toBe(false)
  })

  it('stays quiet when the announced geometry is just the pin resolving', () => {
    // The resolve pass puts the node exactly where the offsets say, so the
    // conversion round-trips to the stored numbers and no patch leaves. This
    // is what lets the filter convert without a vouch: a reflow is a no-op by
    // arithmetic, not by provenance.
    const source = [
      '---',
      'id: card',
      '---',
      '',
      '## Visual Contract',
      '',
      '<Page>',
      '  <Component name="Card">',
      '    <Frame name="body" width={320} height={200}>',
      `      <Text name="a" width={40} height={20} right={16} y={8} constraints={{ horizontal: 'MAX' }} />`,
      '    </Frame>',
      '  </Component>',
      '</Page>',
      '',
    ].join('\n')
    const doc = parseOrThrow(source)
    const scene = toSceneGraph(doc)
    const ctx = { doc, graph: scene.graph, addresses: scene.addresses, pins: scene.pins }
    // The build already resolved x to 264; the reflow announces it unchanged.
    expect(fromSceneChange('Card#body/a', { x: 264 }, ctx)).toEqual([])
  })

  it('still writes back geometry the author wrote explicitly', () => {
    const ctx = build()
    ctx.graph.updateNode('Button/Primary#container/leading-icon', { width: 24 })
    expect(fromSceneChange('Button/Primary#container/leading-icon', { width: 24 }, ctx)).toEqual([
      { op: 'set', address: 'Button/Primary#container/leading-icon', prop: 'width', value: 24 },
    ])
  })

  it('ignores nodes that are not in the bimap', () => {
    const ctx = build()
    expect(fromSceneChange('0:7', { width: 10 }, ctx)).toEqual([])
  })

  it('emits nothing when the value already matches the file', () => {
    const ctx = build()
    expect(fromSceneChange('Button/Primary#container', { paddingLeft: 16 }, ctx)).toEqual([])
  })

  it('maps renamed props back to UIDX names', () => {
    const ctx = build()
    ctx.graph.updateNode('Button/Primary#container/label', { text: 'Save' })
    expect(fromSceneChange('Button/Primary#container/label', { text: 'Save' }, ctx)).toEqual([
      { op: 'set', address: 'Button/Primary#container/label', prop: 'characters', value: 'Save' },
    ])
  })
})

/**
 * Story D4 — the address space covers authored source spans only.
 *
 * Position and size are decided by different things, and this file used to test
 * both against "is the parent an auto-layout frame?". That is the right question
 * for position and the wrong one for size, so a text node measured by its own
 * glyphs had its `width` and `height` written into the file whenever anything
 * near it moved.
 */
describe('authored geometry versus computed geometry (D4)', () => {
  const PAGE = `---
id: geometry
---

## Visual Contract

<Page>
  <Component name="Card" status="draft">
    <Frame name="root" width={200} height={100}>
      <Text name="label" characters="Hi" textAutoResize="WIDTH_AND_HEIGHT" />
    </Frame>
  </Component>
  <Frame name="loose" x={10} y={20} width={50} height={50} />
  <Frame name="hugger" layoutMode="VERTICAL" primaryAxisSizingMode="AUTO"
    counterAxisSizingMode="AUTO">
    <Text name="t" characters="x" textAutoResize="WIDTH_AND_HEIGHT" />
  </Frame>
  <Frame name="row" layoutMode="HORIZONTAL">
    <Frame name="pinned" layoutPositioning="ABSOLUTE" x={4} y={6} width={8} height={8} />
    <Frame name="tracked" x={30} y={40} width={8} height={8} />
  </Frame>
</Page>
`

  const scene = () => {
    const doc = parseOrThrow(PAGE)
    return { doc, ...toSceneGraph(doc) }
  }

  const move = (ctx: ReturnType<typeof scene>, id: string, to: { x: number; y: number }) => {
    ctx.graph.updateNode(id, to)
    return fromSceneChange(id, to, ctx)
  }

  it('writes back a page child that the author dragged', () => {
    // ADR 0003: a child of <Page> sits where somebody put it.
    expect(move(scene(), 'loose', { x: 33, y: 44 })).toEqual([
      { op: 'set', address: 'loose', prop: 'x', value: 33 },
      { op: 'set', address: 'loose', prop: 'y', value: 44 },
    ])
  })

  it('adds the position to a page child that never declared one', () => {
    expect(move(scene(), 'Card', { x: 33, y: 44 })).toEqual([
      { op: 'add', address: 'Card', prop: 'x', value: 33 },
      { op: 'add', address: 'Card', prop: 'y', value: 44 },
    ])
  })

  it('drops a text node’s measured size but keeps its authored position', () => {
    // Inside a plain frame, so the position is absolute and authored — but the
    // box is sized by the glyphs, and nobody typed those numbers. This is the
    // case the old single test could not express.
    const ctx = scene()
    ctx.graph.updateNode('Card#root/label', { x: 5, y: 5, width: 22, height: 14 })
    expect(fromSceneChange('Card#root/label', { x: 5, y: 5, width: 22, height: 14 }, ctx)).toEqual([
      { op: 'add', address: 'Card#root/label', prop: 'x', value: 5 },
      { op: 'add', address: 'Card#root/label', prop: 'y', value: 5 },
    ])
  })

  it('drops the remeasured size of a frame that hugs its content', () => {
    const ctx = scene()
    ctx.graph.updateNode('hugger', { width: 31, height: 17 })
    expect(fromSceneChange('hugger', { width: 31, height: 17 }, ctx)).toEqual([])
  })

  it('drops the position of a child its parent lays out', () => {
    expect(move(scene(), 'Card#root', { x: 7, y: 9 })).toEqual([])
  })

  /**
   * `layoutPositioning: 'ABSOLUTE'` is Figma's own escape from a parent's flow.
   * A node that has taken it is placed by hand again, so the auto-layout parent
   * is no longer the thing deciding where it sits.
   */
  it('keeps the position of an absolutely positioned child of an auto-layout frame', () => {
    expect(move(scene(), 'row#pinned', { x: 12, y: 14 })).toEqual([
      { op: 'set', address: 'row#pinned', prop: 'x', value: 12 },
      { op: 'set', address: 'row#pinned', prop: 'y', value: 14 },
    ])
  })

  /**
   * A flowed child can carry x/y from an earlier life — a pin since released,
   * a hand-written file. The layout owns its position now, so an unvouched
   * change is the engine talking, and "keep the existing attribute current"
   * must not apply: measured live, the reflow after an absolute-position flip
   * wrote its computed x over the released pin, one revision behind the flip.
   */
  it('drops an unvouched position even where the file already records one', () => {
    expect(move(scene(), 'row#tracked', { x: 2, y: 0 })).toEqual([])
  })

  it('still writes a vouched position on a flowed child — the pin says so', () => {
    const ctx = scene()
    ctx.graph.updateNode('row#tracked', { x: 2 })
    const patches = fromSceneChange(
      'row#tracked',
      { x: 2 },
      { ...ctx, authored: new Set(['x']), authoredFor: 'row#tracked' },
    )
    expect(patches).toEqual([{ op: 'set', address: 'row#tracked', prop: 'x', value: 2 }])
  })
})

/**
 * The capability ADR 0003 exists for. Until it landed, a page held exactly one
 * thing and a shallow click could only ever select that one thing.
 */
describe('a page with several entities', () => {
  const MULTI = parseOrThrow(`---
id: buttons
---

## Visual Contract

<Page>
  <Component name="Button/Primary" status="stable">
    <Frame name="box" layoutMode="HORIZONTAL" primaryAxisSizingMode="AUTO"
      counterAxisSizingMode="AUTO" paddingLeft={16} paddingRight={16}>
      <Text name="label" characters="Save" />
    </Frame>
  </Component>
  <Component name="Button/Ghost" status="draft">
    <Frame name="box" layoutMode="HORIZONTAL" primaryAxisSizingMode="AUTO"
      counterAxisSizingMode="AUTO" paddingLeft={4} paddingRight={4}>
      <Text name="label" characters="Cancel" />
    </Frame>
  </Component>
  <Frame name="scratch" width={40} height={40} />
</Page>
`)

  it('puts every entity on the page', () => {
    const { graph, rootId } = toSceneGraph(MULTI)
    expect(graph.getNode(rootId)!.childIds).toEqual(['Button/Primary', 'Button/Ghost', 'scratch'])
  })

  it('keeps same-named nodes in different entities apart', () => {
    const { graph } = toSceneGraph(MULTI)
    // Both components contain a "box/label". The entity segment is the only
    // thing separating them, which is what makes `#` load-bearing.
    expect(graph.getNode('Button/Primary#box/label')!.text).toBe('Save')
    expect(graph.getNode('Button/Ghost#box/label')!.text).toBe('Cancel')
  })

  it('lays out each entity independently', () => {
    const { graph } = toSceneGraph(MULTI)
    const primary = graph.getNode('Button/Primary#box')!
    const ghost = graph.getNode('Button/Ghost#box')!
    // Each hugs its own label plus its own padding. A single computeAllLayouts
    // rooted at the page would have left the second entity at its default 100.
    expect(primary.width).toBe(graph.getNode('Button/Primary#box/label')!.width + 32)
    expect(ghost.width).toBe(graph.getNode('Button/Ghost#box/label')!.width + 8)
  })

  it('leaves a bare <Frame> on the page as scenery, not a hugging component', () => {
    const { graph } = toSceneGraph(MULTI)
    const scratch = graph.getNode('scratch')!
    expect(scratch.type).toBe('FRAME')
    expect(scratch.width).toBe(40)
    expect(scratch.layoutMode).toBe('NONE')
  })
})

describe('component metadata (ADR 0003 §3)', () => {
  it('never reaches the scene node, and never warns', () => {
    const doc = parseOrThrow(`---
id: meta
---

## Visual Contract

<Page>
  <Component name="Boxed" status="stable" version="1.2.0">
    <Frame name="root" width={10} height={10} />
  </Component>
</Page>
`)
    const { graph, warnings } = toSceneGraph(doc)
    const node = graph.getNode('Boxed')! as unknown as Record<string, unknown>

    expect(node.status).toBeUndefined()
    expect(node.version).toBeUndefined()
    // It is absent from KNOWN_PROPS by design, so the unknown-prop passthrough
    // must skip it rather than warn about it.
    expect(warnings).toEqual([])
  })
})
