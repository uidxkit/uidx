import { describe, expect, it } from 'vitest'
import { parseOrThrow, type UidxNode } from '@uidx/format'
import { toSceneGraph } from '../src/index.js'

/**
 * An instance's size reaching the component's own frame.
 *
 * A `<Component>` that declares no geometry is given a hugging vertical layout
 * (`componentSizing`), and a component *with states* must keep a frame inside
 * each `<Variant>` because a variant may not carry auto-layout. Both shapes put
 * a wrapper between the instance and the frame that actually holds the
 * component's layout — and a wrapper the author never wrote must not change how
 * the thing behaves.
 *
 * Measured before this was fixed, on two structurally identical trees stretched
 * into the same 520-wide card: as a plain frame the root and its divider both
 * came out 504, and as an instance the box came out 504 while the divider inside
 * stayed 122 — the component's own hug width. The stretch reached the instance
 * and stopped there.
 */
const page = (id: string, body: string) =>
  `---\nid: ${id}\n---\n\n## Visual Contract\n\n<Page>\n${body}\n</Page>\n`

/** A component whose root hugs: its width is whatever holds it. */
const HUGGING = parseOrThrow(
  page(
    'hugging',
    `  <Component name="Row/Hug" status="draft">
    <Frame name="root" layoutMode="VERTICAL" primaryAxisSizingMode="AUTO" counterAxisSizingMode="AUTO" itemSpacing={4}>
      <Text name="label" characters="hi" fontSize={12} />
      <Rectangle name="divider" layoutAlign="STRETCH" height={2} />
    </Frame>
  </Component>`,
  ),
)

/** The same, with a root pinned to 288 — an explicit width must still win. */
const PINNED = parseOrThrow(
  page(
    'pinned',
    `  <Component name="Row/Pinned" status="draft">
    <Frame name="root" layoutMode="VERTICAL" counterAxisSizingMode="FIXED" width={288} itemSpacing={4}>
      <Text name="label" characters="hi" fontSize={12} />
      <Rectangle name="divider" layoutAlign="STRETCH" height={2} />
    </Frame>
  </Component>`,
  ),
)

/** A component with states, whose layout lives on the frame inside each variant. */
const VARIED = parseOrThrow(
  page(
    'varied',
    `  <Component name="Row/Varied" status="draft" variants={{ tone: ['plain', 'loud'] }}>
    <Variant tone="plain">
      <Frame name="root" layoutMode="VERTICAL" primaryAxisSizingMode="AUTO" counterAxisSizingMode="AUTO" itemSpacing={4}>
        <Text name="label" characters="hi" fontSize={12} />
        <Rectangle name="divider" layoutAlign="STRETCH" height={2} />
      </Frame>
    </Variant>
    <Variant tone="loud">
      <Frame name="root" layoutMode="VERTICAL" primaryAxisSizingMode="AUTO" counterAxisSizingMode="AUTO" itemSpacing={4}>
        <Text name="label" characters="HI" fontSize={12} />
        <Rectangle name="divider" layoutAlign="STRETCH" height={2} />
      </Frame>
    </Variant>
  </Component>`,
  ),
)

function componentIndex(...docs: readonly (typeof HUGGING)[]): Map<string, UidxNode> {
  const out = new Map<string, UidxNode>()
  for (const doc of docs) {
    if (doc.tree.element === 'Tokens') continue
    for (const node of doc.tree.children) {
      if (node.element === 'Component') out.set(node.name, node)
    }
  }
  return out
}

function build(source: string, ...defining: readonly (typeof HUGGING)[]) {
  const doc = parseOrThrow(source)
  const index = componentIndex(doc, ...defining)
  return toSceneGraph(doc, { resolveComponent: (name) => index.get(name) }).graph
}

/** A 520-wide card with 8 padding: 504 for whatever it holds. */
const card = (child: string, mode = 'VERTICAL') =>
  page(
    'card',
    `  <Frame name="card" x={0} y={0} width={520} height={200} layoutMode="${mode}" primaryAxisSizingMode="FIXED" counterAxisSizingMode="FIXED" paddingTop={8} paddingRight={8} paddingBottom={8} paddingLeft={8}>
${child}
  </Frame>`,
  )

describe('an instance carries its size to the component’s frame', () => {
  it('fills, and its children fill with it', () => {
    const graph = build(
      card(`    <Instance name="row" layoutAlign="STRETCH" component="Row/Hug" />`),
      HUGGING,
    )
    expect(graph.getNode('card#row')!.width).toBe(504)
    expect(graph.getNode('card#row/root')!.width).toBe(504)
    // The one that was wrong: the divider is the component's, and it must run
    // the width the instance was placed at, not the width the component hugs to.
    expect(graph.getNode('card#row/root/divider')!.width).toBe(504)
  })

  it('leaves an unstretched instance hugging', () => {
    const graph = build(card(`    <Instance name="row" component="Row/Hug" />`), HUGGING)
    const root = graph.getNode('card#row/root')!
    expect(root.width).toBeLessThan(504)
    expect(graph.getNode('card#row/root/divider')!.width).toBe(root.width)
  })

  it('keeps a pinned width, because an explicit width beats stretch', () => {
    const graph = build(
      card(`    <Instance name="row" layoutAlign="STRETCH" component="Row/Pinned" />`),
      PINNED,
    )
    expect(graph.getNode('card#row/root')!.width).toBe(288)
    expect(graph.getNode('card#row/root/divider')!.width).toBe(288)
  })

  it('reaches through a variant’s frame too', () => {
    const graph = build(
      card(
        `    <Instance name="row" layoutAlign="STRETCH" component="Row/Varied" props={{ tone: 'loud' }} />`,
      ),
      VARIED,
    )
    expect(graph.getNode('card#row/root')!.width).toBe(504)
    expect(graph.getNode('card#row/root/divider')!.width).toBe(504)
  })

  it('leaves a frame that lays nothing out at the size it declares', () => {
    // Caught as a regression: a dial is a frame with no layoutMode holding
    // absolutely placed art. To the layout engine that is a leaf, and filling a
    // leaf makes it skip the explicit size the author gave it — the dial drifted
    // off the centre of its card. A frame that lays nothing out is left alone.
    const DIAL = parseOrThrow(
      page(
        'dial',
        `  <Component name="Dial" status="draft">
    <Frame name="canvas" width={140} height={140}>
      <Ellipse name="ring" x={0} y={0} width={140} height={140} />
    </Frame>
  </Component>`,
      ),
    )
    const graph = build(
      card(`    <Instance name="dial" layoutAlign="STRETCH" component="Dial" />`),
      DIAL,
    )
    expect(graph.getNode('card#dial/canvas')!.width).toBe(140)
  })

  it('grows the same way it stretches', () => {
    // A horizontal card, 504 inside, holding a fixed 100 and a growing instance:
    // the leftover 404 is the instance's, and the frame inside must take it too,
    // or the instance is a wide box with a small drawing sitting in it.
    const graph = build(
      card(
        `    <Frame name="fixed" width={100} height={20} />\n    <Instance name="row" layoutGrow={1} component="Row/Hug" />`,
        'HORIZONTAL',
      ),
      HUGGING,
    )
    expect(graph.getNode('card#row')!.width).toBe(404)
    expect(graph.getNode('card#row/root')!.width).toBe(404)
    expect(graph.getNode('card#row/root/divider')!.width).toBe(404)
  })
})
