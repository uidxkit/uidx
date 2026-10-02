import { describe, expect, it } from 'vitest'
import { parseOrThrow, type UidxDocument, type UidxNode } from '@uidx/format'
import type { SceneGraph } from '@open-pencil/scene-graph'
import { toSceneGraph } from '../src/index.js'
import { INSTANCE_BOX_PROPS, INSTANCE_CASCADE_PROPS } from '../src/instance-box.js'
import {
  buildPage,
  dumpScene,
  printPage,
  printScene,
  workspaces,
  type DumpedNode,
} from './helpers/workspace-scene.js'

/**
 * The regression guard for restyling an instance from outside (ADR 0018).
 *
 * Moving an instance's box attributes from its wrapper to the frame the
 * component draws touches the one code path every page goes through, so
 * every page the repo ships is snapshotted here, what it draws and what its
 * build warns, as it was before that change. Afterwards the example and tour
 * snapshots must not move at all, and the instance-box fixture may move only
 * at or under the instances that restyle themselves.
 */
const WORKSPACES = workspaces()

/** Every page to draw, with the documents it can reach. */
const PAGES = WORKSPACES.flatMap((workspace) =>
  workspace.pages
    .map((page) => ({ page, doc: workspace.docs.get(page)!, workspace }))
    .filter(({ doc }) => doc.tree.element !== 'Tokens'),
)

/**
 * A guard is only as good as what it reads. ADR 0018 sorts every attribute
 * an instance carries into placement, box, cascade or locked, and the render
 * change moves the box and stops drawing the locked — so a field missing from
 * the dump is a regression nobody would see. Each case sets one field on a
 * small page and expects the printed dump to change.
 */
describe('the dump sees every field a restyle could move', () => {
  /** A row holding a frame and a text, not laid out, so a field changes only itself. */
  const probe = ({ row = '', item = '', text = '', swapped = false } = {}): string => {
    const children = [
      `<Frame name="item" width={20} height={20} ${item} />`,
      `<Text name="text" characters="hi" fontSize={14} ${text} />`,
    ]
    const doc = parseOrThrow(
      `---\nid: probe\n---\n\n## Visual Contract\n\n<Page>\n  <Frame name="row" x={0} y={0} width={200} height={40} ${row}>\n    ${(swapped ? children.reverse() : children).join('\n    ')}\n  </Frame>\n</Page>\n`,
    )
    return printScene(dumpScene(toSceneGraph(doc)))
  }

  const CASES: [string, Parameters<typeof probe>[0]][] = [
    // box (§1), on whichever node it lands (§2)
    ['cornerSmoothing', { row: 'cornerSmoothing={0.6}' }],
    // locked (§1): the component's layout and stroke ends
    ['layoutMode', { row: 'layoutMode="HORIZONTAL"' }],
    ['layoutWrap', { row: 'layoutWrap="WRAP"' }],
    ['primaryAxisAlignItems', { row: 'primaryAxisAlignItems="CENTER"' }],
    ['counterAxisAlignItems', { row: 'counterAxisAlignItems="MAX"' }],
    ['counterAxisSpacing', { row: 'counterAxisSpacing={4}' }],
    ['counterAxisAlignContent', { row: 'counterAxisAlignContent="SPACE_BETWEEN"' }],
    ['itemReverseZIndex', { row: 'itemReverseZIndex={true}' }],
    ['strokesIncludedInLayout', { row: 'strokesIncludedInLayout={true}' }],
    ['clipsContent', { row: 'clipsContent={true}' }],
    ['strokeCap', { row: 'strokeCap="ROUND"' }],
    ['strokeJoin', { row: 'strokeJoin="ROUND"' }],
    ['strokeMiterLimit', { row: 'strokeMiterLimit={8}' }],
    // placement (§1): the instance's own node
    ['rotation', { row: 'rotation={30}' }],
    ['blendMode', { row: 'blendMode="MULTIPLY"' }],
    ['locked', { row: 'locked={true}' }],
    ['isMask', { item: 'isMask={true}' }],
    ['maskType', { item: 'maskType="LUMINANCE"' }],
    ['minWidth', { item: 'minWidth={10}' }],
    ['maxWidth', { item: 'maxWidth={300}' }],
    ['minHeight', { item: 'minHeight={10}' }],
    ['maxHeight', { item: 'maxHeight={300}' }],
    ['constraints', { item: `constraints={{ horizontal: 'MAX', vertical: 'MAX' }}` }],
    ['layoutPositioning', { item: 'layoutPositioning="ABSOLUTE"' }],
    ['layoutGrow', { item: 'layoutGrow={1}' }],
    ['layoutAlign', { item: 'layoutAlign="STRETCH"' }],
    // locked (§1): every text property, which the cascade rebuilds texts around
    ['fontFamily', { text: 'fontFamily="Roboto"' }],
    ['fontWeight', { text: 'fontWeight="BOLD"' }],
    ['italic', { text: 'italic={true}' }],
    ['lineHeight', { text: 'lineHeight={20}' }],
    ['letterSpacing', { text: 'letterSpacing={1}' }],
    ['textAlignHorizontal', { text: 'textAlignHorizontal="CENTER"' }],
    ['textAlignVertical', { text: 'textAlignVertical="BOTTOM"' }],
    ['textAutoResize', { text: 'textAutoResize="HEIGHT"' }],
    ['textDirection', { text: 'textDirection="RTL"' }],
    ['textCase', { text: 'textCase="UPPER"' }],
    ['textDecoration', { text: 'textDecoration="UNDERLINE"' }],
    ['textTruncation', { text: 'textTruncation="ENDING"' }],
    ['maxLines', { text: 'maxLines={2}' }],
    // the order children draw in
    ['child order', { swapped: true }],
  ]

  const plain = probe()
  for (const [field, change] of CASES) {
    it(field, () => {
      expect(probe(change)).not.toBe(plain)
    })
  }
})

describe('every page draws as it did', () => {
  for (const { page, doc, workspace } of PAGES) {
    it(page, () => {
      expect(printPage(buildPage(workspace.docs, doc))).toMatchSnapshot()
    })
  }
})

/** What a use may restyle from outside: its box, and the colour of the texts inside. */
const OUTER = new Set([...INSTANCE_BOX_PROPS, ...INSTANCE_CASCADE_PROPS])

const restyles = (node: UidxNode): boolean =>
  node.element === 'Instance' && Object.keys(node.attrs).some((prop) => OUTER.has(prop))

/** `node` with every instance at or under it stripped of its box and `textFills`. */
function unstyled(node: UidxNode): UidxNode {
  const attrs = restyles(node)
    ? Object.fromEntries(Object.entries(node.attrs).filter(([prop]) => !OUTER.has(prop)))
    : node.attrs
  return { ...node, attrs, children: node.children.map(unstyled) }
}

const unstyledDocument = (doc: UidxDocument): UidxDocument => ({ ...doc, tree: unstyled(doc.tree) })

/** The addresses of the instances on `tree` that restyle themselves. */
function restyled(tree: UidxNode): string[] {
  const out = restyles(tree) ? [tree.address] : []
  for (const child of tree.children) out.push(...restyled(child))
  return out
}

/** True when `id` is one of `roots` or sits somewhere under one. */
function within(graph: SceneGraph, roots: ReadonlySet<string>, id: string): boolean {
  for (let at: string | null | undefined = id; at; at = graph.getNode(at)?.parentId)
    if (roots.has(at)) return true
  return false
}

/**
 * A page built as written and again with every box and `textFills` attribute
 * removed from every `<Instance>` in reach, components included.
 *
 * `roots` are the scene ids of the instances on the page that state one. The
 * set is deliberately narrow — the linked instances of the page itself — so a
 * restyled instance it cannot see (inside another file's definition, or an
 * echo row of a repeat) shows up as a difference and fails the check, rather
 * than widening what is allowed to change.
 */
function compare(page: string) {
  const { doc, workspace } = PAGES.find((entry) => entry.page === page)!
  const bare = new Map([...workspace.docs].map(([file, each]) => [file, unstyledDocument(each)]))
  const written = buildPage(workspace.docs, doc)
  const plain = buildPage(bare, bare.get(page)!)
  const roots = new Set(
    restyled(doc.tree)
      .map((address) => written.addresses.sceneIdOf(address))
      .filter((id): id is string => id !== undefined),
  )
  const before = dumpScene(written)
  const after = dumpScene(plain)
  /** The nodes at or under any of `among`, in either build: a node may exist in only one. */
  const split = (among: ReadonlySet<string>) => {
    const affected = (node: DumpedNode) =>
      within(written.graph, among, node.id) || within(plain.graph, among, node.id)
    return {
      inside: { written: before.filter(affected), plain: after.filter(affected) },
      outside: {
        written: before.filter((node) => !affected(node)),
        plain: after.filter((node) => !affected(node)),
      },
    }
  }
  return {
    roots,
    outside: split(roots).outside,
    /** What draws at or under one restyled instance, as written and plain. */
    under: (root: string) => split(new Set([root])).inside,
  }
}

describe('only instances that restyle their outer box change (ADR 0018)', () => {
  for (const { page } of PAGES) {
    it(page, () => {
      const { outside } = compare(page)
      expect(outside.plain).toEqual(outside.written)
    })
  }

  /**
   * Every instance the fixture restyles, each of which must draw differently
   * underneath, one by one — but for those a state row masks (`MASKED`).
   * Pooled, a single restyle that still showed would hide another that had
   * silently stopped doing anything.
   */
  const OVERRIDES = 'packages/schema/test/fixtures/instance-box/overrides.uidx'
  const RESTYLED = [
    'badge',
    'checked',
    'chip',
    'destructive',
    'field',
    'hovered',
    'labelled',
    'labelled#root/control/chip',
    'labelled#root/control/tag',
    'sized',
    'styled',
    'tag',
    'wide',
  ]

  /**
   * The two whose fills a state row sets in the state they ask for: Button1
   * hovered and Checkbox checked. The row sits above the use (ADR 0018 §3),
   * so in that state the use's fill shows nowhere — not on the frame, and not
   * on the wrapper either.
   */
  const MASKED = ['checked', 'hovered']

  describe('is not vacuous: each instance the fixture restyles draws differently underneath', () => {
    const fixture = compare(OVERRIDES)

    it('restyles exactly these', () => {
      expect([...fixture.roots].sort()).toEqual(RESTYLED)
    })

    for (const root of RESTYLED) {
      if (MASKED.includes(root)) continue
      it(root, () => {
        const { written, plain } = fixture.under(root)
        expect(written.length).toBeGreaterThan(0)
        expect(plain).not.toEqual(written)
      })
    }
  })

  describe('a use that a state row masks draws exactly as without it', () => {
    const fixture = compare(OVERRIDES)

    for (const root of MASKED) {
      it(root, () => {
        const { written, plain } = fixture.under(root)
        expect(written.length).toBeGreaterThan(0)
        expect(plain).toEqual(written)
      })
    }
  })
})
