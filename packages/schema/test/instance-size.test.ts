import { describe, expect, it } from 'vitest'
import { parseOrThrow, resolve, type UidxDocument, type UidxNode } from '@uidx/format'
import {
  applyChanges,
  diffDocuments,
  fromSceneChange,
  instanceDefinition,
  layOutEntity,
  toSceneGraph,
  wrappedFrameUpdate,
} from '../src/index.js'

/**
 * An instance that states a size is drawn at it.
 *
 * Found live on examples/design-system: a Button1 placed on a page and resized
 * on the canvas wrote `width={199} height={33}` into the `<Instance>`, and the
 * canvas went on drawing the button at its hug size. The numbers reached the
 * scene node beside the sizing the instance inherited from its component —
 * `HUG` on both axes — and layout replaced every hugging axis with the content
 * size. For a component with a styles table there was a second drop: the
 * instance's root is the derived variant, and the frame the author laid out
 * (`root`, the blue pill) sits one level down and was never told the size.
 *
 * The rule, per axis: an `<Instance>` that states its own width (or height)
 * is Fixed on that axis; one that does not follows its component.
 */
const page = (id: string, body: string, tail = '') =>
  `---\nid: ${id}\n---\n\n## Visual Contract\n\n<Page>\n${body}\n</Page>\n${tail}`

const BLUE = `[{ opacity: 1, visible: true, type: 'SOLID', color: { r: 0, g: 0.3333, b: 1, a: 1 } }]`
const HOVER = `
<Styles>
  <Style state="hover" root:fills={[{ opacity: 1, visible: true, type: 'SOLID', color: { r: 0.37, g: 0.57, b: 0.99, a: 1 } }]} />
</Styles>
`
const CONTRACT = `
## Contract

<Props>
  <Prop name="label" type="string" sample="Button1">The words it shows.</Prop>
</Props>
`

/** examples/design-system/.uidx/button1.uidx: a pill that hugs its label. */
const button = (
  styles: string,
  sizing = 'primaryAxisSizingMode="AUTO" counterAxisSizingMode="AUTO"',
) =>
  parseOrThrow(
    page(
      'button1',
      `  <Component name="Button1" status="draft"
    layoutMode="HORIZONTAL" ${sizing}
    primaryAxisAlignItems="CENTER" counterAxisAlignItems="CENTER"
    paddingLeft={12} paddingRight={12} paddingTop={8} paddingBottom={8} cornerRadius={999}
    fills={${BLUE}}>
    <Text name="label" characters="{label}" fontSize={14} />
  </Component>`,
      `${styles}${CONTRACT}`,
    ),
  )

const STYLED = button(HOVER)
const PLAIN = button('')
const FIXED = button(
  HOVER,
  'primaryAxisSizingMode="FIXED" counterAxisSizingMode="FIXED" width={120} height={40}',
)

function componentIndex(...docs: readonly UidxDocument[]): Map<string, UidxNode> {
  const out = new Map<string, UidxNode>()
  for (const doc of docs) {
    if (doc.tree.element === 'Tokens') continue
    for (const node of doc.tree.children) {
      if (node.element === 'Component') out.set(node.name, node)
    }
  }
  return out
}

function build(source: string, ...defining: readonly UidxDocument[]) {
  const doc = parseOrThrow(source)
  const index = componentIndex(doc, ...defining)
  return { doc, ...toSceneGraph(doc, { resolveComponent: (name) => index.get(name) }) }
}

/** examples/design-system/.uidx/page1.uidx, with the instance's own attributes swapped in. */
const placed = (attrs: string) =>
  page(
    'page1',
    `  <Instance name="button1-1" component="Button1" x={328} y={360} props={{ label: 'Click Me' }}${attrs} />`,
  )

const size = (graph: ReturnType<typeof build>['graph'], id: string) => {
  const node = graph.getNode(id)!
  return { width: node.width, height: node.height }
}

/** What the same instance hugs to when it states no size at all. */
const hugOf = (definition: UidxDocument) => size(build(placed(''), definition).graph, 'button1-1')

describe('an instance that states a size is drawn at it', () => {
  it('even when its component hugs and has a styles table (page1, found live)', () => {
    const { graph } = build(placed(' width={199} height={33}'), STYLED)
    expect(size(graph, 'button1-1')).toEqual({ width: 199, height: 33 })
    // The pill: the frame the author laid out, one level under the derived variant.
    expect(size(graph, 'button1-1#root')).toEqual({ width: 199, height: 33 })
  })

  it('when its component hugs and has no styles table', () => {
    const { graph } = build(placed(' width={199} height={33}'), PLAIN)
    expect(size(graph, 'button1-1')).toEqual({ width: 199, height: 33 })
  })

  it('on the axis it states, and hugs on the other', () => {
    const hug = hugOf(STYLED)
    const { graph } = build(placed(' width={199}'), STYLED)
    expect(size(graph, 'button1-1')).toEqual({ width: 199, height: hug.height })
    expect(size(graph, 'button1-1#root')).toEqual({ width: 199, height: hug.height })
  })

  it('when its component is fixed-size and has a styles table', () => {
    const { graph } = build(placed(' width={200} height={60}'), FIXED)
    expect(size(graph, 'button1-1')).toEqual({ width: 200, height: 60 })
    expect(size(graph, 'button1-1#root')).toEqual({ width: 200, height: 60 })
  })

  it('and still hugs when it states none', () => {
    const hug = hugOf(STYLED)
    expect(hug.width).toBeLessThan(199)
    const { graph } = build(placed(''), STYLED)
    expect(size(graph, 'button1-1#root')).toEqual(hug)
    expect(graph.getNode('button1-1')!.counterAxisSizing).toBe('HUG')
    expect(graph.getNode('button1-1')!.primaryAxisSizing).toBe('HUG')
  })

  it('unless it states the axis’s sizing mode itself, which still wins', () => {
    // PLAIN's own layout is HORIZONTAL, so the primary axis is the width.
    const hug = hugOf(PLAIN)
    const { graph } = build(placed(' width={199} primaryAxisSizingMode="AUTO"'), PLAIN)
    expect(size(graph, 'button1-1').width).toBe(hug.width)
  })
})

describe('a stated size beside an authored fill', () => {
  /** A 520-wide card with 8 padding: 504 for whatever it holds. */
  const card = (child: string, mode = 'VERTICAL') =>
    page(
      'card',
      `  <Frame name="card" x={0} y={0} width={520} height={200} layoutMode="${mode}" primaryAxisSizingMode="FIXED" counterAxisSizingMode="FIXED" paddingTop={8} paddingRight={8} paddingBottom={8} paddingLeft={8}>
${child}
  </Frame>`,
    )

  it('keeps the stretch on the axis it fills, and fixes the other', () => {
    const { graph } = build(
      card(
        `    <Instance name="b" component="Button1" layoutAlign="STRETCH" props={{ label: 'Go' }} width={50} height={60} />`,
      ),
      STYLED,
    )
    // A stale width must not undo an authored stretch: the card's width wins.
    expect(size(graph, 'card#b')).toEqual({ width: 504, height: 60 })
    expect(size(graph, 'card#b/root')).toEqual({ width: 504, height: 60 })
  })

  it('keeps the grow on the axis it grows along', () => {
    const { graph } = build(
      card(
        `    <Frame name="fixed" width={100} height={20} />\n    <Instance name="b" component="Button1" layoutGrow={1} props={{ label: 'Go' }} width={50} height={60} />`,
        'HORIZONTAL',
      ),
      STYLED,
    )
    expect(size(graph, 'card#b')).toEqual({ width: 404, height: 60 })
    expect(size(graph, 'card#b/root')).toEqual({ width: 404, height: 60 })
  })
})

describe('a sized instance under re-layout', () => {
  it('writes nothing back when its rect is re-announced (the geometry echo)', () => {
    // Before the fix this wrote `set width 92` and `set height 36` — a reflow
    // silently erasing the resize from the file.
    const { doc, graph, addresses } = build(placed(' width={199} height={33}'), STYLED)
    const node = graph.getNode('button1-1')!
    const patches = fromSceneChange(
      'button1-1',
      { x: node.x, y: node.y, width: node.width, height: node.height },
      { doc, graph, addresses },
    )
    expect(patches).toEqual([])
  })

  it('never gains a sizing mode the file does not state, vouched or not', () => {
    // An instance's sizing modes are relative to a layout it does not author —
    // for Button1 the derived variant's VERTICAL, not the HORIZONTAL the author
    // wrote — so the file gets the dimensions and nothing else.
    const { doc, graph, addresses } = build(placed(' width={199} height={33}'), STYLED)
    const changes = {
      width: 240,
      height: 33,
      primaryAxisSizing: 'FIXED',
      counterAxisSizing: 'FIXED',
    } as const
    graph.updateNode('button1-1', changes)
    for (const authored of [
      undefined,
      new Set(['width', 'height', 'primaryAxisSizingMode', 'counterAxisSizingMode']),
    ]) {
      const patches = fromSceneChange('button1-1', changes, {
        doc,
        graph,
        addresses,
        ...(authored ? { authored, authoredFor: 'button1-1' } : {}),
      })
      expect(patches.map((p) => (p as { prop: string }).prop)).toEqual(['width'])
    }
  })

  it('keeps a sizing mode the file already states current', () => {
    const { doc, graph, addresses } = build(
      placed(' width={199} height={33} primaryAxisSizingMode="FIXED"'),
      STYLED,
    )
    graph.updateNode('button1-1', { primaryAxisSizing: 'HUG' })
    const patches = fromSceneChange(
      'button1-1',
      { primaryAxisSizing: 'HUG' },
      {
        doc,
        graph,
        addresses,
        authored: new Set(['primaryAxisSizingMode']),
        authoredFor: 'button1-1',
      },
    )
    expect(patches).toEqual([
      expect.objectContaining({ op: 'set', prop: 'primaryAxisSizingMode', value: 'AUTO' }),
    ])
  })
})

/**
 * The incremental path must draw what a rebuild draws. A stated size beside a
 * fill is where the two came apart: whether an axis is Fixed depends on the
 * fill, the parent's direction and `layoutPositioning`, and layout overwrites
 * a filled axis in place — so an update that re-sent only what changed in the
 * file left the stretched width standing on an axis that had just become
 * Fixed at 50.
 */
describe('a sized instance edited in place lands where a rebuild would', () => {
  /** A styled pill defined on the same page, so its instances take the incremental path. */
  const PILL = `  <Component name="Pill" status="draft" layoutMode="HORIZONTAL" primaryAxisSizingMode="AUTO" counterAxisSizingMode="AUTO" paddingLeft={12} paddingRight={12} paddingTop={8} paddingBottom={8}>
    <Text name="label" characters="Go" />
  </Component>`
  const PILL_HOVER = `
<Styles>
  <Style state="hover" root:opacity={0.5} />
</Styles>
`
  /** A 520x200 card with 8 padding: 504 across for whatever it holds, 184 down. */
  const card = (child: string, mode = 'VERTICAL', definition = PILL) =>
    page(
      'card',
      `${definition}
  <Frame name="card" x={0} y={0} width={520} height={200} layoutMode="${mode}" primaryAxisSizingMode="FIXED" counterAxisSizingMode="FIXED" paddingTop={8} paddingRight={8} paddingBottom={8} paddingLeft={8}>
    ${child}
  </Frame>`,
      definition ? PILL_HOVER : '',
    )
  /** The same pill on a page of its own, which the card's page only names. */
  const LIBRARY = parseOrThrow(page('pill', PILL, PILL_HOVER))

  /** `before` built, edited to `after` the way the canvas edits it, beside `after` built afresh. */
  function edited(before: string, after: string, ...defining: readonly UidxDocument[]) {
    const live = build(before, ...defining)
    const next = parseOrThrow(after)
    const index = componentIndex(next, ...defining)
    const changes = diffDocuments(live.doc, next)
    // Null is the rebuild, which is right by construction.
    if (changes === null)
      return { live: build(after, ...defining), rebuilt: build(after, ...defining) }
    applyChanges(live, changes, { resolveComponent: (name) => index.get(name) })
    return { live, rebuilt: build(after, ...defining) }
  }
  const boxes = (scene: ReturnType<typeof build>, ids: readonly string[]) =>
    ids.map((id) => ({ id, ...size(scene.graph, id) }))
  const same = (result: ReturnType<typeof edited>, ids: readonly string[]) =>
    expect(boxes(result.live, ids)).toEqual(boxes(result.rebuilt, ids))
  const IDS = ['card#b', 'card#b/root']

  const STRETCHED = `<Instance name="b" component="Pill" layoutAlign="STRETCH" width={50} height={60} />`
  const UNSTRETCHED = `<Instance name="b" component="Pill" width={50} height={60} />`
  const ABSOLUTE = `<Instance name="b" component="Pill" layoutAlign="STRETCH" layoutPositioning="ABSOLUTE" width={50} height={60} />`

  it('when its stretch is taken away, leaving the width it states', () => {
    const result = edited(card(STRETCHED), card(UNSTRETCHED))
    expect(size(result.live.graph, 'card#b').width).toBe(50)
    same(result, IDS)
    same(edited(card(UNSTRETCHED), card(STRETCHED)), IDS)
  })

  it('when it leaves the flow, and comes back to it', () => {
    const result = edited(card(STRETCHED), card(ABSOLUTE))
    expect(size(result.live.graph, 'card#b').width).toBe(50)
    same(result, IDS)
    same(edited(card(ABSOLUTE), card(STRETCHED)), IDS)
  })

  it('when its parent turns from a column into a row under a stretch', () => {
    // The stretch filled the width in the column and fills the height in the row.
    same(edited(card(STRETCHED), card(STRETCHED, 'HORIZONTAL')), IDS)
    same(edited(card(STRETCHED, 'HORIZONTAL'), card(STRETCHED)), IDS)
    // Defined on another page, so the edit reaches the card alone.
    const crossed = edited(
      card(STRETCHED, 'VERTICAL', ''),
      card(STRETCHED, 'HORIZONTAL', ''),
      LIBRARY,
    )
    expect(size(crossed.rebuilt.graph, 'card#b')).toEqual({ width: 50, height: 184 })
    same(crossed, IDS)
  })

  it('when its parent turns from a row into a column under a grow', () => {
    const GROWN = `<Frame name="f" width={100} height={20} />
    <Instance name="b" component="Pill" layoutGrow={1} width={50} height={60} />`
    same(edited(card(GROWN, 'HORIZONTAL'), card(GROWN)), IDS)
    same(edited(card(GROWN, 'HORIZONTAL', ''), card(GROWN, 'VERTICAL', ''), LIBRARY), IDS)
  })

  it('without keeping the sizing the canvas flipped to show a resize live', () => {
    // An older canvas drew an east-handle drag on a stretched instance by
    // fixing the width on the scene node only, and the file took the width
    // alone — which the stretch outranks. The echo must draw the file.
    const before = parseOrThrow(
      card(`<Instance name="b" component="Pill" layoutAlign="STRETCH" />`),
    )
    const after = card(`<Instance name="b" component="Pill" layoutAlign="STRETCH" width={300} />`)
    const live = build(before.source)
    live.graph.updateNode('card#b', { width: 300, counterAxisSizing: 'FIXED' })
    layOutEntity(live.graph, 'card#b', live.pins)
    expect(size(live.graph, 'card#b').width).toBe(300)
    const next = parseOrThrow(after)
    const index = componentIndex(next)
    const changes = diffDocuments(live.doc, next)
    expect(changes).not.toBeNull()
    applyChanges(live, changes!, { resolveComponent: (name) => index.get(name) })
    const rebuilt = build(after)
    expect(boxes(live, IDS)).toEqual(boxes(rebuilt, IDS))
    expect(live.graph.getNode('card#b')!.counterAxisSizing).toBe(
      rebuilt.graph.getNode('card#b')!.counterAxisSizing,
    )
  })
})

/**
 * A component whose one child is a repeat is a wrapper around many rows, not
 * around one frame. A size on its instance belongs to the wrapper: handing it
 * to the repeated frame drew every row at the instance's full height, three
 * 200-tall rows overflowing a 200-tall instance.
 */
describe('a sized instance of a component around one repeated frame', () => {
  const ROWS = (attrs: string) => `---
id: rows
---

## Visual Contract

<Page>
  <Component name="Rows" status="draft">
    <Frame name="row" repeat="{people}" as="person" layoutMode="HORIZONTAL" primaryAxisSizingMode="AUTO" counterAxisSizingMode="AUTO" paddingTop={4} paddingBottom={4}>
      <Text name="name" characters="{person.name}" fontSize={14} />
    </Frame>
  </Component>
  <Instance name="r" component="Rows" x={0} y={0}${attrs} />
</Page>

## Contract

<Props>
  <Prop name="people" type="Person[]">Rows.</Prop>
</Props>

## Models

<Model name="Person">
  One person.
  <Field name="id" type="string" key sample={['a', 'b', 'c']}>Identity.</Field>
  <Field name="name" type="string" sample={['Ada', 'Grace', 'Linus']}>Display name.</Field>
</Model>
`
  const rows = (scene: ReturnType<typeof build>) =>
    scene.graph.getNode('r')!.childIds.map((id) => {
      const node = scene.graph.getNode(id)!
      return { id, height: node.height, y: node.y }
    })

  it('keeps each row at its own height', () => {
    const unsized = rows(build(ROWS('')))
    const sized = build(ROWS(' height={200}'))
    expect(sized.graph.getNode('r')!.height).toBe(200)
    expect(rows(sized)).toEqual(unsized)
  })

  it('and an edit in place agrees with the rebuild', () => {
    const live = build(ROWS(''))
    const next = parseOrThrow(ROWS(' height={200}'))
    const index = componentIndex(next)
    applyChanges(live, diffDocuments(live.doc, next)!, {
      resolveComponent: (name) => index.get(name),
    })
    expect(rows(live)).toEqual(rows(build(ROWS(' height={200}'))))
  })
})

/**
 * The canvas draws a resize before the file states it, so it asks the echo's
 * question early: what the frame inside an instance is given when the
 * instance goes from one size to another. It is the update `applyChanges`
 * makes once the file says so, or the pill would move twice.
 */
describe('the frame a size reaches, asked before the file states it', () => {
  /** One instance in two versions, and what the frame inside it is given between them. */
  const framed = (definition: UidxDocument, from: string, to: string) => {
    const index = componentIndex(definition)
    const scope = { resolveComponent: (name: string) => index.get(name) }
    const prev = resolve(parseOrThrow(placed(from)).tree, 'button1-1')!
    const next = resolve(parseOrThrow(placed(to)).tree, 'button1-1')!
    const found = instanceDefinition(next, scope)!
    return wrappedFrameUpdate(
      'button1-1',
      { instance: prev, definition: found },
      { instance: next, definition: found },
      scope,
    )
  }

  it('finds the definition as the build does, its styles table expanded', () => {
    const index = componentIndex(STYLED)
    const instance = resolve(parseOrThrow(placed('')).tree, 'button1-1')!
    const found = instanceDefinition(instance, { resolveComponent: (name) => index.get(name) })
    expect(found?.children.map((child) => child.element)).toEqual(['Variant', 'Variant'])
  })

  it('is the pill, at the new width, for an instance that already states one', () => {
    expect(framed(STYLED, ' width={160} height={33}', ' width={266} height={33}')).toEqual({
      id: 'button1-1#root',
      props: { width: 266 },
    })
  })

  it('fixes the pill and lets its stretch go when the instance first states a size', () => {
    expect(framed(STYLED, '', ' width={266}')).toMatchObject({
      id: 'button1-1#root',
      props: { width: 266, primaryAxisSizing: 'FIXED', layoutAlignSelf: 'AUTO' },
    })
  })

  it('gives the stretch and the hug back when the size goes again', () => {
    expect(framed(STYLED, ' width={266}', '')).toMatchObject({
      id: 'button1-1#root',
      props: { primaryAxisSizing: 'HUG', layoutAlignSelf: 'STRETCH' },
    })
  })

  it('is nothing for a component that lays itself out, whose root the instance is', () => {
    expect(framed(PLAIN, ' width={160}', ' width={266}')).toBeNull()
  })
})
