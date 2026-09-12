import { describe, expect, it } from 'vitest'
import { parseOrThrow } from '@uidx/format'
import { toSceneGraph } from '../src/index.js'

/**
 * The pin pass through a real build — the arithmetic is `pins.test.ts`'s job,
 * and this is about the walk: what a child resolves against, and what has to
 * have happened before it is asked.
 */

const CARD = (width: number, children: string): string =>
  [
    '---',
    'id: card',
    '---',
    '',
    '## Visual Contract',
    '',
    '<Page>',
    '  <Component name="Card">',
    `    <Frame name="body" width={${width}} height={200}>`,
    children,
    '    </Frame>',
    '  </Component>',
    '</Page>',
    '',
  ].join('\n')

const build = (source: string) => toSceneGraph(parseOrThrow(source)).graph

describe('resolvePins, through a real build', () => {
  it('places a MAX-pinned child from the far edge', () => {
    const graph = build(
      CARD(
        320,
        `      <Text name="a" width={40} right={16} constraints={{ horizontal: 'MAX' }} />`,
      ),
    )
    expect(graph.getNode('Card#body/a')?.x).toBe(264)
  })

  it('moves that child when the parent is wider, with nothing else changed', () => {
    const graph = build(
      CARD(
        400,
        `      <Text name="a" width={40} right={16} constraints={{ horizontal: 'MAX' }} />`,
      ),
    )
    expect(graph.getNode('Card#body/a')?.x).toBe(344)
  })

  it('stretches a child between both edges', () => {
    const graph = build(
      CARD(
        320,
        `      <Frame name="rule" x={16} right={16} height={2} constraints={{ horizontal: 'STRETCH' }} />`,
      ),
    )
    const rule = graph.getNode('Card#body/rule')
    expect(rule?.x).toBe(16)
    expect(rule?.width).toBe(288)
  })

  it('resolves a nested pin against a parent that was itself resolved', () => {
    // The rule stretches to 288; the dot pins 8 from the rule's right edge, so
    // it lands at 288 − 8 − 4 = 276 within the rule. This is what top-down
    // buys, and the case that breaks if the walk is bottom-up.
    const graph = build(
      CARD(
        320,
        [
          `      <Frame name="rule" x={16} right={16} height={20} constraints={{ horizontal: 'STRETCH' }}>`,
          `        <Frame name="dot" width={4} height={4} right={8} constraints={{ horizontal: 'MAX' }} />`,
          '      </Frame>',
        ].join('\n'),
      ),
    )
    expect(graph.getNode('Card#body/rule')?.width).toBe(288)
    expect(graph.getNode('Card#body/rule/dot')?.x).toBe(276)
  })

  it('reflows a stretched frame’s own auto-layout children', () => {
    // The bar stretches to 288 and centres its child, so the child's x has to
    // reflect the resolved width rather than the authored one: (288 − 20) / 2.
    const graph = build(
      CARD(
        320,
        [
          `      <Frame name="bar" x={16} right={16} height={40} constraints={{ horizontal: 'STRETCH' }}`,
          `        layoutMode="HORIZONTAL" primaryAxisAlignItems="CENTER" counterAxisAlignItems="CENTER">`,
          '        <Frame name="pip" width={20} height={20} />',
          '      </Frame>',
        ].join('\n'),
      ),
    )
    expect(graph.getNode('Card#body/bar')?.width).toBe(288)
    expect(graph.getNode('Card#body/bar/pip')?.x).toBe(134)
  })

  it('centres a child on the parent, and takes centerX as a delta', () => {
    const graph = build(
      CARD(
        320,
        `      <Text name="a" width={40} centerX={10} constraints={{ horizontal: 'CENTER' }} />`,
      ),
    )
    expect(graph.getNode('Card#body/a')?.x).toBe(150) // (320 − 40) / 2 + 10
  })

  it('resolves a pin under a hugging parent, which is why absolute children do not grow it', () => {
    // Measured before H1 and recorded in ADR 0011: an ABSOLUTE child does not
    // contribute to a hug. Without that, a STRETCH child inside a hugging
    // parent would be circular — it would grow the parent it measures against.
    const source = [
      '---',
      'id: card',
      '---',
      '',
      '## Visual Contract',
      '',
      '<Page>',
      '  <Component name="Card">',
      '    <Frame name="body" layoutMode="VERTICAL" primaryAxisSizingMode="AUTO" counterAxisSizingMode="AUTO">',
      '      <Frame name="content" width={120} height={40} />',
      `      <Frame name="badge" width={10} height={10} right={4} layoutPositioning="ABSOLUTE" constraints={{ horizontal: 'MAX' }} />`,
      '    </Frame>',
      '  </Component>',
      '</Page>',
      '',
    ].join('\n')
    const graph = build(source)
    expect(graph.getNode('Card#body')?.width).toBe(120)
    expect(graph.getNode('Card#body/badge')?.x).toBe(106) // 120 − 4 − 10
  })

  it('leaves an unpinned child exactly where every file written before H1 put it', () => {
    const graph = build(CARD(320, `      <Text name="a" x={16} y={24} width={40} />`))
    expect(graph.getNode('Card#body/a')?.x).toBe(16)
    expect(graph.getNode('Card#body/a')?.y).toBe(24)
  })
})
