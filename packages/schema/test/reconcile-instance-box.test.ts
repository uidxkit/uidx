import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseOrThrow, type UidxDocument, type UidxNode } from '@uidx/format'
import type { SceneNode } from '@open-pencil/scene-graph'
import {
  applyChanges,
  buildTokenIndex,
  diffDocuments,
  modelIndex,
  resolveTokenValues,
  TokenResolver,
  type SceneChange,
  type SceneResult,
} from '../src/index.js'
import { INSTANCE_BOX_PROPS, INSTANCE_CASCADE_PROPS } from '../src/instance-box.js'
import type { SceneOptions } from '../src/to-scene.js'
import { buildPage, dumpScene, repo } from './helpers/workspace-scene.js'

/**
 * An edit to a restyled instance, taken in place, draws what a rebuild draws
 * (ADR 0018 §6).
 *
 * The incremental path painted an instance's attributes onto its own node,
 * the wrapper, so a fill on a Button1 put a square red box behind the pill
 * until the next reload. `update-instance-root` recomputes the instance's node
 * and the frame that draws its box from the instance and its definition, as
 * the build does, and what an update cannot express rebuilds: a text colour,
 * a composition's box and size, and what a coloured slot fill holds. An
 * instance in a slot fill is drawn under the slot's id rather than its own
 * address (ADR 0007 §3), and its edits are found there through the bimap.
 *
 * Only a definition on the same page takes the incremental path (an instance
 * of one on another page rebuilds), so each page below places its uses beside
 * the definitions they draw.
 */

const read = (file: string): UidxDocument =>
  parseOrThrow(readFileSync(join(repo, file), 'utf8'), file)

/** A collection with two modes, for a token that resolves differently under a dark frame. */
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

/**
 * What the definitions below reach for: the design-system example's tokens,
 * Checkbox and Field, and the two-mode collection above.
 */
const LIBRARY = new Map([
  ...['tokens', 'checkbox', 'field'].map((name) => {
    const file = `examples/design-system/.uidx/${name}.uidx`
    return [file, read(file)] as const
  }),
  ['themed.uidx', parseOrThrow(THEMED, 'themed.uidx')] as const,
])

/** Button1's own page: a styles table, so its box is the derived `root`. */
const BUTTON1 = 'packages/schema/test/fixtures/instance-box/button1.uidx'
/** Chip lays itself out, Tag wraps one frame, and Badge's authored variants each wrap one. */
const KINDS = 'packages/schema/test/fixtures/instance-box/kinds.uidx'
/** A composition: CheckboxField holds one instance of Field and nothing else. */
const CHECKBOX_FIELD = 'examples/design-system/.uidx/checkbox-field.uidx'

/** One version of a page and every document it can reach. */
interface Version {
  doc: UidxDocument
  docs: Map<string, UidxDocument>
}

function version(file: string, source: string): Version {
  const doc = parseOrThrow(source, file)
  return { doc, docs: new Map([...LIBRARY, [file, doc]]) }
}

/**
 * `file`'s page with `uses` placed beside its definitions, and `edit` made
 * to its source first, for a change inside a definition.
 */
function beside(file: string, uses: string, edit: (source: string) => string = (s) => s): Version {
  const source = edit(readFileSync(join(repo, file), 'utf8'))
  if (!source.includes('</Page>')) throw new Error(`${file} has no page to place uses on`)
  return version(file, source.replace('</Page>', `${uses}\n</Page>`))
}

/** The options `buildPage` draws with, for the incremental path's side. */
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

interface Edited {
  /** What the diff said, null for a rebuild. */
  changes: SceneChange[] | null
  /** `before` drawn and then edited in place, or drawn afresh where the diff said to rebuild. */
  live: SceneResult
  rebuilt: SceneResult
}

/** `before` drawn, then edited to `after` the way the canvas takes a file's echo, beside `after` drawn afresh. */
function edited(before: Version, after: Version): Edited {
  const options = optionsFor(after.docs)
  const changes = diffDocuments(before.doc, after.doc, options.resolveAlias, options.tokens)
  const live = changes ? buildPage(before.docs, before.doc) : buildPage(after.docs, after.doc)
  if (changes) applyChanges(live, changes, options)
  return { changes, live, rebuilt: buildPage(after.docs, after.doc) }
}

/** The incremental path ran, and it drew every node as the rebuild did. */
function agrees(result: Edited): void {
  expect(result.changes).not.toBeNull()
  expect(dumpScene(result.live)).toEqual(dumpScene(result.rebuilt))
}

const node = (scene: SceneResult, id: string): SceneNode => {
  const found = scene.graph.getNode(id)
  if (!found) throw new Error(`no scene node ${id}`)
  return found
}

/** The colour of a node's first paint, rounded to three places. */
const colourOf = (paints: readonly unknown[] | undefined) => {
  const color = (paints?.[0] as { color?: Record<string, number> } | undefined)?.color
  if (!color) return undefined
  return Object.fromEntries(
    Object.entries(color).map(([key, value]) => [key, Math.round(value * 1000) / 1000]),
  )
}
const fillOf = (scene: SceneResult, id: string) => colourOf(node(scene, id).fills)

const updatesTo = (changes: SceneChange[] | null, address: string): SceneChange[] =>
  (changes ?? []).filter((change) => change.kind === 'update' && change.address === address)

const solid = (r: number, g: number, b: number) =>
  `[{ type: 'SOLID', color: { r: ${r}, g: ${g}, b: ${b}, a: 1 } }]`
const RED = solid(1, 0, 0)
const GREEN = solid(0, 0.5, 0)
const GREY = solid(0.2, 0.2, 0.2)
const SHADOW = `[{ type: 'DROP_SHADOW', color: { r: 0, g: 0, b: 0, a: 0.25 }, offset: { x: 0, y: 2 }, radius: 4, spread: 0, visible: true }]`

const C = {
  red: { r: 1, g: 0, b: 0, a: 1 },
  grey: { r: 0.2, g: 0.2, b: 0.2, a: 1 },
  darkRed: { r: 0.5, g: 0, b: 0, a: 1 },
  blue: { r: 0, g: 0.333, b: 1, a: 1 },
  white: { r: 1, g: 1, b: 1, a: 1 },
  muted: { r: 0.443, g: 0.443, b: 0.478, a: 1 },
  danger: { r: 0.863, g: 0.149, b: 0.149, a: 1 },
}

/** A Button1 placed beside its definition, stating `attrs`. */
const button1 = (attrs = '', edit?: (source: string) => string) =>
  beside(
    BUTTON1,
    `  <Instance name="b" component="Button1" y={100} props={{ label: 'Go' }} ${attrs} />`,
    edit,
  )

describe('an edit to an instance’s box lands where a rebuild puts it', () => {
  it('a fill or a corner radius reaches the pill, and the wrapper stays bare', () => {
    const red = edited(button1('x={0}'), button1(`x={0} fills={${RED}}`))
    agrees(red)
    expect(fillOf(red.live, 'b#root')).toEqual(C.red)
    expect(node(red.live, 'b').fills).toEqual([])

    const rounded = edited(button1('x={0}'), button1('x={0} cornerRadius={4}'))
    agrees(rounded)
    expect(node(rounded.live, 'b#root').cornerRadius).toBe(4)
    expect(node(rounded.live, 'b').cornerRadius).toBe(0)
  })

  it('sends no scene update for an instance, and a move still lands through its root', () => {
    const result = edited(button1('x={0}'), button1('x={40}'))
    agrees(result)
    expect(updatesTo(result.changes, 'b')).toEqual([])
    expect(result.changes).toContainEqual(
      expect.objectContaining({ kind: 'update-instance-root', id: 'b' }),
    )
    expect(node(result.live, 'b').x).toBe(40)
  })

  it('clearing an override puts back the component’s value, or the engine’s', () => {
    // Button1 states fills and padding; it states no strokes, effects or
    // opacity, so those go back to what a fresh node has.
    const styled = `x={0} fills={${RED}} paddingLeft={40} strokes={${GREY}} strokeWeight={2} effects={${SHADOW}} opacity={0.5}`
    const result = edited(button1(styled), button1('x={0}'))
    agrees(result)
    const root = node(result.live, 'b#root')
    expect(colourOf(root.fills)).toEqual(C.blue)
    expect(root.paddingLeft).toBe(12)
    expect(root.strokes).toEqual([])
    expect(root.effects).toEqual([])
    expect(root.opacity).toBe(1)
  })
})

/**
 * A token resolves where the instance is drawn: under an enclosing frame's
 * modes and under its own, as the build binds it (ADR 0018 §5). An update
 * computed in the page's default modes drew a dark frame's button light red.
 */
describe('a token resolves in the modes the instance is drawn in', () => {
  const dark = (attrs: string, edit?: (source: string) => string) =>
    beside(
      BUTTON1,
      `  <Frame name="dark" x={0} y={100} width={300} height={80} modes={{ tone: 'dark' }}>
    <Instance name="b" component="Button1" ${attrs} />
  </Frame>`,
      edit,
    )

  it('a token on the box, under an enclosing frame’s modes', () => {
    const result = edited(dark(''), dark('fills="{tone#danger}"'))
    agrees(result)
    expect(fillOf(result.live, 'dark#b/root')).toEqual(C.darkRed)
  })

  it('a token on the box, under the instance’s own modes', () => {
    const own = (attrs: string) => button1(`x={0} modes={{ tone: 'dark' }} ${attrs}`.trimEnd())
    const result = edited(own(''), own('fills="{tone#danger}"'))
    agrees(result)
    expect(fillOf(result.live, 'b#root')).toEqual(C.darkRed)
  })

  it('a token a definition change writes, on a copy under a dark frame', () => {
    const result = edited(
      dark(''),
      dark('', (source) => source.replace('fontSize={14}', 'fontSize={14} fills="{tone#danger}"')),
    )
    agrees(result)
    expect(fillOf(result.live, 'dark#b/root/label')).toEqual(C.darkRed)
  })
})

describe('a change inside the definition keeps the use on top (ADR 0018 §3)', () => {
  it('a root padding change: the instance’s paddingLeft still wins', () => {
    const uses = (edit?: (source: string) => string) =>
      beside(
        BUTTON1,
        `  <Instance name="b" component="Button1" x={0} y={100} paddingLeft={40} />
  <Instance name="p" component="Button1" x={0} y={160} />`,
        edit,
      )
    const result = edited(
      uses(),
      uses((source) => source.replace('paddingLeft={12}', 'paddingLeft={16}')),
    )
    agrees(result)
    expect(node(result.live, 'b#root').paddingLeft).toBe(40)
    expect(node(result.live, 'p#root').paddingLeft).toBe(16)
  })

  it('a label fontSize edit under an instance with textFills keeps the colour', () => {
    const colour = 'x={0} textFills="{text#onAccent}"'
    const result = edited(
      button1(colour),
      button1(colour, (source) => source.replace('fontSize={14}', 'fontSize={18}')),
    )
    agrees(result)
    expect(result.changes).toContainEqual(
      expect.objectContaining({ kind: 'update-generated', id: 'b#root/label' }),
    )
    expect(fillOf(result.live, 'b#root/label')).toEqual(C.white)
    expect(node(result.live, 'b#root/label').fontSize).toBe(18)
  })
})

describe('what an update cannot express rebuilds', () => {
  it('a textFills change, which reaches every text inside (ADR 0018 §4)', () => {
    const red = `textFills={${RED}}`
    expect(diffDocuments(button1('x={0}').doc, button1(`x={0} ${red}`).doc)).toBeNull()
    expect(
      diffDocuments(button1(`x={0} ${red}`).doc, button1(`x={0} textFills={${GREEN}}`).doc),
    ).toBeNull()
    expect(diffDocuments(button1(`x={0} ${red}`).doc, button1('x={0}').doc)).toBeNull()
  })

  /**
   * CheckboxField hands its use's box and size to the Field it holds, which
   * draws them on its own frame, `cf#field/root` — a level below the frame an
   * update reaches. An update left the pill there at 250 inside a 300-wide
   * field, and painted the fill on the field's wrapper.
   */
  describe('on a composition', () => {
    const field = (attrs: string, edit?: (source: string) => string) =>
      beside(
        CHECKBOX_FIELD,
        `  <Instance name="cf" component="CheckboxField" y={200} ${attrs} />`,
        edit,
      )

    it('a box change', () => {
      for (const styled of [
        'fills="{surface#danger}"',
        'paddingLeft={20}',
        'cornerRadius={4}',
        'opacity={0.5}',
      ]) {
        expect(diffDocuments(field('x={0}').doc, field(`x={0} ${styled}`).doc), styled).toBeNull()
        expect(diffDocuments(field(`x={0} ${styled}`).doc, field('x={0}').doc), styled).toBeNull()
      }
    })

    it('a size change, which it hands down too', () => {
      expect(diffDocuments(field('x={0}').doc, field('x={0} width={300}').doc)).toBeNull()
      expect(
        diffDocuments(field('x={0} width={250}').doc, field('x={0} width={300}').doc),
      ).toBeNull()
      expect(diffDocuments(field('x={0} width={300}').doc, field('x={0}').doc)).toBeNull()
    })

    it('a definition root change, which can make it stop being a composition', () => {
      const styled = 'x={0} fills="{surface#danger}"'
      expect(
        diffDocuments(
          field(styled).doc,
          field(styled, (source) =>
            source.replace(
              '<Component name="CheckboxField" status="stable">',
              '<Component name="CheckboxField" status="stable" layoutMode="VERTICAL">',
            ),
          ).doc,
        ),
      ).toBeNull()
    })

    it('but a move is still an update, and lands in place', () => {
      const result = edited(
        field('x={0} fills="{surface#danger}"'),
        field('x={40} fills="{surface#danger}"'),
      )
      agrees(result)
      expect(node(result.live, 'cf').x).toBe(40)
    })
  })

  /**
   * Fill content that states no fills takes the colour of the instance it is
   * written in (ADR 0018 §4), and so does every text of an instance placed
   * there. An update or an insert draws a node as the file states it, without
   * that colour.
   */
  describe('in the fill of an instance that hands down a text colour', () => {
    const CARD = (body: string, mark = '') => `---
id: card
---

## Visual Contract

<Page>
  <Component name="Card" status="draft" layoutMode="VERTICAL" primaryAxisSizingMode="AUTO" counterAxisSizingMode="AUTO">
    <Text name="title" characters="Title" fontSize={14} />
    <Slot name="body" layoutMode="VERTICAL" primaryAxisSizingMode="AUTO" counterAxisSizingMode="AUTO" />
  </Component>
  <Component name="Mark" status="draft" layoutMode="HORIZONTAL" primaryAxisSizingMode="AUTO" counterAxisSizingMode="AUTO">
    <Text name="label" characters="Hi" fontSize={12}${mark} />
  </Component>
${body}
</Page>
`
    const card = (colour: string, fill: string, mark = '') =>
      version(
        'card.uidx',
        CARD(
          `  <Instance name="c" component="Card" x={0} y={200}${colour}>
    <Slot name="body">
${fill}
    </Slot>
  </Instance>`,
          mark,
        ),
      )
    const COLOURED = ' textFills="{text#danger}"'
    const MARK = '      <Instance name="mark" component="Mark" />'
    const text = (name: string, own = '') =>
      `      <Text name="${name}" characters="T" fontSize={12}${own} />`

    it('a definition change reaching the copy of an instance placed there', () => {
      const muted = ' fills="{text#muted}"'
      expect(diffDocuments(card(COLOURED, MARK).doc, card(COLOURED, MARK, muted).doc)).toBeNull()
      // Without a colour to hand down, the copy updates in place.
      const plain = edited(card('', MARK), card('', MARK, muted))
      agrees(plain)
      expect(plain.changes).toContainEqual(
        expect.objectContaining({ kind: 'update-generated', id: 'c#body/mark/label' }),
      )
      expect(fillOf(plain.live, 'c#body/mark/label')).toEqual(C.muted)
    })

    it('a text there that stops stating its own fills', () => {
      const own = text('t', ' fills="{text#muted}"')
      expect(diffDocuments(card(COLOURED, own).doc, card(COLOURED, text('t')).doc)).toBeNull()
      agrees(edited(card('', own), card('', text('t'))))
    })

    it('a text added there', () => {
      const one = text('t')
      const two = `${one}\n${text('u')}`
      expect(diffDocuments(card(COLOURED, one).doc, card(COLOURED, two).doc)).toBeNull()
      agrees(edited(card('', one), card('', two)))
    })

    it('but an edit there that leaves every colour alone is still an update', () => {
      const result = edited(
        card(COLOURED, text('t', ' fills="{text#muted}"')),
        card(COLOURED, text('t', ' fills="{text#muted}" opacity={0.5}')),
      )
      agrees(result)
      expect(fillOf(result.live, 'c#body/t')).toEqual(C.muted)
      expect(fillOf(result.live, 'c#title')).toEqual(C.danger)
    })
  })

  it('a move of an instance that names no component, now that no update paints its node', () => {
    // The parser refuses such an instance, so these are made by hand: the
    // diff must not lose the move however the document came to be.
    const unnamed = (x: number): UidxDocument => {
      const doc = parseOrThrow(
        `---\nid: p\n---\n\n## Visual Contract\n\n<Page>\n  <Instance name="i" component="Gone" x={${x}} y={0} />\n</Page>\n`,
      )
      const tree = {
        ...doc.tree,
        children: doc.tree.children.map((child) => {
          const attrs = { ...child.attrs }
          delete attrs.component
          return { ...child, attrs }
        }),
      }
      return { ...doc, tree }
    }
    expect(diffDocuments(unnamed(0), unnamed(40))).toBeNull()
  })
})

/**
 * Fill content is the consuming page's own, so it links into the bimap and
 * takes edits, but it is drawn where the definition puts the slot, under ids
 * that follow that position rather than the file (ADR 0007 §3). Panel's slot
 * sits inside its `body` frame, so `p#content/btn` is drawn a level or two
 * further down. An edit addressed by the file missed the node it meant, and
 * the canvas kept the old look until a reload.
 *
 * Panel shares Button1's page and with it the styles table, so it is drawn
 * from a derived `root` as well: its slot sits at `p#root/body/content`.
 */
describe('fill content is edited where the definition draws it (ADR 0007 §3)', () => {
  const PANEL = `  <Component name="Panel" status="draft">
    <Frame name="body" layoutMode="VERTICAL" primaryAxisSizingMode="AUTO" counterAxisSizingMode="AUTO" paddingLeft={8}>
      <Slot name="content" layoutMode="VERTICAL" primaryAxisSizingMode="AUTO" counterAxisSizingMode="AUTO">
        <Text name="empty" characters="Nothing yet" fontSize={12} />
      </Slot>
    </Frame>
  </Component>`
  /** Panel beside Button1, and a use of it whose slot holds `fill`, or no fill at all. */
  const panel = (fill: string | null, edit?: (source: string) => string) =>
    beside(
      BUTTON1,
      fill === null
        ? `${PANEL}\n  <Instance name="p" component="Panel" x={0} y={200} />`
        : `${PANEL}
  <Instance name="p" component="Panel" x={0} y={200}>
    <Slot name="content">
${fill}
    </Slot>
  </Instance>`,
      edit,
    )
  const button = (attrs = '') =>
    `      <Instance name="btn" component="Button1" props={{ label: 'Go' }} ${attrs} />`
  const text = (name: string, own = '') =>
    `      <Text name="${name}" characters="T" fontSize={12}${own} />`
  /** Where the scene draws a fill node: not at its address, or this would prove nothing. */
  const drawn = (scene: SceneResult, address: string): string => {
    const id = scene.addresses.sceneIdOf(address)
    expect(id).toBeDefined()
    expect(id).not.toBe(address)
    return id!
  }

  it('a box edit on an instance there reaches its pill, and the wrapper stays bare', () => {
    const plain = panel(button())
    for (const styled of [
      `fills={${RED}}`,
      'cornerRadius={4}',
      'paddingLeft={40}',
      `strokes={${GREY}} strokeWeight={2}`,
      'opacity={0.5}',
      'width={199}',
      'visible={false}',
    ]) {
      const restyled = panel(button(styled))
      for (const result of [edited(plain, restyled), edited(restyled, plain)]) {
        agrees(result)
        expect(result.changes).toContainEqual(
          expect.objectContaining({ kind: 'update-instance-root', id: 'p#content/btn' }),
        )
      }
    }
    const red = edited(plain, panel(button(`fills={${RED}}`)))
    const id = drawn(red.live, 'p#content/btn')
    expect(fillOf(red.live, `${id}/root`)).toEqual(C.red)
    expect(node(red.live, id).fills).toEqual([])
  })

  it('an edit to a node of its own there, and a definition change reaching a copy there', () => {
    agrees(edited(panel(text('t')), panel(text('t', ' opacity={0.5}'))))

    const grown = edited(
      panel(button()),
      panel(button(), (source) => source.replace('fontSize={14}', 'fontSize={18}')),
    )
    agrees(grown)
    expect(grown.changes).toContainEqual(
      expect.objectContaining({ kind: 'update-generated', relative: 'root/label' }),
    )
    expect(node(grown.live, `${drawn(grown.live, 'p#content/btn')}/root/label`).fontSize).toBe(18)
  })

  it('content added there, taken away and reordered, and the next edit to it lands too', () => {
    const one = text('t')
    const two = `${text('t')}\n${text('u')}`
    const swapped = `${text('u')}\n${text('t')}`
    const framed = `${text('t')}
      <Frame name="f" layoutMode="HORIZONTAL" primaryAxisSizingMode="AUTO" counterAxisSizingMode="AUTO">
  ${text('x')}
      </Frame>`
    for (const [from, to] of [
      [one, two],
      [two, one],
      [two, swapped],
      [one, framed],
      [framed, one],
    ] as const) {
      const result = edited(panel(from), panel(to))
      agrees(result)
      // What a gesture on the canvas writes back through: each node links
      // where it is drawn, as the build links it.
      for (const address of ['p#content/t', 'p#content/u', 'p#content/f', 'p#content/f/x']) {
        const id = result.rebuilt.addresses.sceneIdOf(address)
        expect(result.live.addresses.sceneIdOf(address), address).toBe(id)
        if (id) expect(result.live.addresses.addressOf(id), id).toBe(address)
      }
    }
    // Inserted, then edited in place.
    agrees(edited(panel(two), panel(`${text('t')}\n${text('u', ' opacity={0.5}')}`)))
  })

  it('a pin there is kept against the node it places (ADR 0011)', () => {
    // Board's slot states a size and no layout, so it places what it holds
    // where that says: here, 8 or 24 from its right edge.
    const board = (right: number) =>
      beside(
        BUTTON1,
        `  <Component name="Board" status="draft">
    <Frame name="body" width={200} height={100}>
      <Slot name="area" width={200} height={100} />
    </Frame>
  </Component>
  <Instance name="b" component="Board" x={0} y={200}>
    <Slot name="area">
      <Text name="t" characters="T" fontSize={12} width={40} right={${right}} constraints={{ horizontal: 'MAX' }} />
    </Slot>
  </Instance>`,
      )
    const result = edited(board(8), board(24))
    agrees(result)
    const id = drawn(result.live, 'b#area/t')
    expect(result.live.pins.pinOf(id)?.right).toBe(24)
    expect(node(result.live, id).x).toBe(136) // 200 − 24 − 40
  })

  it('emptying the fill, or filling an empty one, is an edit in place', () => {
    const emptied = panel('')
    agrees(edited(panel(text('t')), emptied))
    agrees(edited(emptied, panel(text('t'))))
  })

  it('a fill written or taken away rebuilds: it swaps the default content for its own', () => {
    expect(diffDocuments(panel(null).doc, panel(text('t')).doc)).toBeNull()
    expect(diffDocuments(panel(text('t')).doc, panel(null).doc)).toBeNull()
  })

  /**
   * Inside a component, fill content is copied into every instance of it, at
   * ids that follow the slot's place in the held instance's own definition,
   * and the bimap holds one of them under the component's address. Neither
   * the copies nor the component's own node can be found from the file.
   */
  it('inside a component, an edit to the fill of an instance it holds rebuilds', () => {
    const wrap = (own = '') =>
      beside(
        BUTTON1,
        `${PANEL}
  <Component name="Wrap" status="draft">
    <Instance name="inner" component="Panel">
      <Slot name="content">
        <Text name="t" characters="T" fontSize={12}${own} />
      </Slot>
    </Instance>
  </Component>
  <Instance name="w" component="Wrap" x={0} y={300} />`,
      )
    expect(diffDocuments(wrap().doc, wrap(' opacity={0.5}').doc)).toBeNull()
  })
})

/**
 * Components whose look is on a frame inside a frame of their own that only
 * wraps it, as the Shoelace example draws on its `base` parts: the box goes
 * through the wrapper (ADR 0018 §2), a level or two down. Shell has a styles
 * table, as Shoelace's Button does, so its box is under the derived `root`;
 * Plaque has none; Sleeve is a bare component around one frame, with a table.
 */
const HUG = 'layoutMode="HORIZONTAL" primaryAxisSizingMode="AUTO" counterAxisSizingMode="AUTO"'
const WRAPPED: Record<string, string> = {
  Shell: `  <Component name="Shell" status="draft" ${HUG}>
    <Frame name="base" ${HUG} paddingLeft={12} paddingRight={12} cornerRadius={6} fills={${GREY}} strokes={${GREY}} strokeWeight={1}>
      <Text name="label" characters="Go" fontSize={14} />
    </Frame>
  </Component>`,
  Plaque: `  <Component name="Plaque" status="draft" ${HUG}>
    <Frame name="base" ${HUG} paddingLeft={12} paddingRight={12} cornerRadius={6} fills={${GREY}}>
      <Text name="label" characters="Go" fontSize={14} />
    </Frame>
  </Component>`,
  Sleeve: `  <Component name="Sleeve" status="draft">
    <Frame name="box" ${HUG} paddingLeft={4} cornerRadius={8} fills={${GREY}}>
      <Text name="label" characters="Go" fontSize={14} />
    </Frame>
  </Component>`,
}
/** Shell's styles table: a state row on the frame inside, and one that dims the wrapper. */
const SHELL_ROWS = `
<Styles>
  <Style state="hover" base:fills={${GREEN}} />
  <Style state="disabled" root:opacity={0.45} />
</Styles>

## Contract

<Props>
  <Prop name="disabled" type="boolean" default={false} visual>Inert.</Prop>
</Props>
`
/**
 * One wrapper component on a page of its own, since a styles table belongs to
 * its page's component, with `rows` as its table and `uses` beside it, so they
 * take the incremental path; `edit` changes the page first.
 */
function wrapper(
  name: string,
  rows: string,
  uses: string,
  edit: (source: string) => string = (s) => s,
): Version {
  const source = edit(
    `---\nid: ${name.toLowerCase()}\n---\n\n## Visual Contract\n\n<Page>\n${WRAPPED[name]}\n${uses}\n</Page>\n${rows}`,
  )
  return version(`${name.toLowerCase()}.uidx`, source)
}

describe('a box found through a wrapper: an edit lands where a rebuild puts it', () => {
  const use = (name: string, attrs: string) =>
    `  <Instance name="u" component="${name}" x={0} y={100} ${attrs} />`
  const CASES: [string, string, string][] = [
    ['Shell', SHELL_ROWS, 'u#root/base'],
    ['Plaque', '', 'u#base'],
    [
      'Sleeve',
      `\n<Styles>\n  <Style state="hover" box:fills={${GREEN}} />\n</Styles>\n`,
      'u#root/box',
    ],
  ]

  for (const [name, rows, box] of CASES) {
    describe(name, () => {
      it('a fill and padding reach the frame inside, and the wrappers stay bare', () => {
        const result = edited(
          wrapper(name, rows, use(name, '')),
          wrapper(name, rows, use(name, `fills={${RED}} paddingLeft={40} width={199}`)),
        )
        agrees(result)
        expect(fillOf(result.live, box)).toEqual(C.red)
        expect(node(result.live, box).paddingLeft).toBe(40)
        expect(node(result.live, box).width).toBe(199)
        expect(node(result.live, 'u').fills).toEqual([])
        expect(updatesTo(result.changes, 'u')).toEqual([])
      })

      it('clearing them puts the component’s values back', () => {
        agrees(
          edited(
            wrapper(name, rows, use(name, `fills={${RED}} paddingLeft={40} width={199}`)),
            wrapper(name, rows, use(name, '')),
          ),
        )
      })

      it('a change to that frame in the definition keeps the use’s value on top', () => {
        const uses = `${use(name, 'paddingLeft={40}')}\n  <Instance name="p" component="${name}" x={0} y={160} />`
        const result = edited(
          wrapper(name, rows, uses),
          wrapper(name, rows, uses, (source) =>
            source.replace(/paddingLeft=\{(4|12)\}/, 'paddingLeft={20}'),
          ),
        )
        agrees(result)
        expect(node(result.live, box).paddingLeft).toBe(40)
        expect(node(result.live, box.replace(/^u/, 'p')).paddingLeft).toBe(20)
      })

      it('a wrapper that starts to paint takes the box back, by a rebuild', () => {
        const painted = (source: string) =>
          source.replace(
            `<Component name="${name}" status="draft"`,
            `<Component name="${name}" status="draft" fills={${GREEN}}`,
          )
        const result = edited(
          wrapper(name, rows, use(name, `fills={${RED}}`)),
          wrapper(name, rows, use(name, `fills={${RED}}`), painted),
        )
        expect(result.changes).toBeNull()
        expect(dumpScene(result.live)).toEqual(dumpScene(result.rebuilt))
        expect(fillOf(result.rebuilt, box)).toEqual(C.grey)
      })
    })
  }

  it('a state row on the wrapper still sits above the use, and the box stays inside', () => {
    const result = edited(
      wrapper('Shell', SHELL_ROWS, use('Shell', 'props={{ disabled: true }}')),
      wrapper('Shell', SHELL_ROWS, use('Shell', `props={{ disabled: true }} opacity={0.8}`)),
    )
    agrees(result)
    expect(node(result.live, 'u#root').opacity).toBe(0.45)
    expect(node(result.live, 'u#root/base').opacity).toBe(0.8)
  })
})

/**
 * Every box attribute, written and then removed, on each shape a component
 * comes in. Each edit must take the incremental path — the composition and
 * colour cases above are the only ones that rebuild — and land as a rebuild
 * draws it, node for node.
 */
describe('every box edit on every component shape lands where a rebuild puts it', () => {
  const SHAPES: Record<string, { file: string; use: (attrs: string) => string }> = {
    /** A styles table: the box is the derived `root`, a level down. */
    Button1: {
      file: BUTTON1,
      use: (attrs) =>
        `  <Instance name="u" component="Button1" x={0} y={100} props={{ label: 'Go' }} ${attrs} />`,
    },
    /** Lays itself out: the box is the instance's own node. */
    Chip: {
      file: KINDS,
      use: (attrs) =>
        `  <Instance name="u" component="Chip" x={0} y={100} props={{ label: 'Chip' }} ${attrs} />`,
    },
    /** A bare component around one laid-out frame: the box is that frame. */
    Tag: {
      file: KINDS,
      use: (attrs) =>
        `  <Instance name="u" component="Tag" x={0} y={100} props={{ label: 'Tag' }} ${attrs} />`,
    },
    /** Authored variants: the box is the chosen variant's frame. */
    Badge: {
      file: KINDS,
      use: (attrs) =>
        `  <Instance name="u" component="Badge" x={0} y={100} props={{ tone: 'warn' }} ${attrs} />`,
    },
  }

  const EDITS = [
    `fills={${RED}}`,
    'fills={[]}',
    'fills="{surface#danger}"',
    `strokes={${GREY}}`,
    `strokes={${GREY}} strokeWeight={2}`,
    'strokeWeight={3}',
    'strokeBottomWeight={4}',
    `strokes={${GREY}} dashPattern={[4, 2]} strokeAlign="OUTSIDE"`,
    'cornerRadius={4}',
    'topLeftRadius={6}',
    'cornerSmoothing={0.6}',
    'opacity={0.5}',
    `effects={${SHADOW}}`,
    'paddingLeft={40} paddingTop={2}',
    'width={199} paddingLeft={40}',
  ]

  for (const [shape, { file, use }] of Object.entries(SHAPES)) {
    describe(shape, () => {
      const plain = beside(file, use(''))
      for (const styled of EDITS) {
        it(styled, () => {
          const restyled = beside(file, use(styled))
          for (const result of [edited(plain, restyled), edited(restyled, plain)]) {
            agrees(result)
            expect(updatesTo(result.changes, 'u')).toEqual([])
          }
        })
      }

      it('one fill for another', () => {
        agrees(edited(beside(file, use(`fills={${RED}}`)), beside(file, use(`fills={${GREEN}}`))))
      })
    })
  }
})

/**
 * The scene-regression fixture's own restyles, each as the fixture writes it
 * — its tokens, its stated size, its slot fill — moved beside its definition
 * so an edit can take the incremental path. The box comes and goes in place
 * and draws what a rebuild draws. A text colour, and a composition's box,
 * rebuild instead (ADR 0018 §6).
 */
describe('each restyle on the regression fixture lands where a rebuild puts it', () => {
  const FIXTURE = 'packages/schema/test/fixtures/instance-box/overrides.uidx'
  /** Where each component the fixture places is defined. */
  const DEFINED: Record<string, string> = {
    Button1: BUTTON1,
    Chip: KINDS,
    Tag: KINDS,
    Badge: KINDS,
    Button: 'examples/design-system/.uidx/button.uidx',
    Checkbox: 'examples/design-system/.uidx/checkbox.uidx',
    CheckboxField: CHECKBOX_FIELD,
    Field: 'examples/design-system/.uidx/field.uidx',
  }
  /** CheckboxField holds one Field and nothing else, so it hands its box down (ADR 0018 §2). */
  const COMPOSITIONS = new Set(['CheckboxField'])
  const OUTER = new Set<string>([...INSTANCE_BOX_PROPS, ...INSTANCE_CASCADE_PROPS])

  const source = readFileSync(join(repo, FIXTURE), 'utf8')
  const uses = parseOrThrow(source, FIXTURE).tree.children.filter(
    (use) => use.element === 'Instance' && Object.keys(use.attrs).some((prop) => OUTER.has(prop)),
  )

  /** The use as the fixture writes it, less the attributes `dropped` picks. */
  const written = (use: UidxNode, dropped: (prop: string) => boolean): string => {
    let text = source.slice(use.loc.start, use.loc.end)
    const spans = Object.values(use.attrs)
      .filter((attr) => dropped(attr.name))
      .map((attr) => attr.loc)
      .sort((a, b) => b.start - a.start)
    for (const span of spans)
      text = text.slice(0, span.start - use.loc.start) + text.slice(span.end - use.loc.start)
    return text
  }

  it('restyles every component shape it places', () => {
    expect(uses.map((use) => use.name)).toEqual([
      'styled',
      'hovered',
      'destructive',
      'checked',
      'field',
      'sized',
      'wide',
      'chip',
      'tag',
      'badge',
      'labelled',
    ])
  })

  for (const use of uses) {
    const component = String(use.attrs.component?.value)
    it(`${use.name}, a ${component}`, () => {
      const file = DEFINED[component]!
      const placed = (text: string): Version => {
        const at = beside(file, `  ${text}`)
        // A slot fill there places Chip and Tag, which live with the other kinds.
        return file === KINDS ? at : { ...at, docs: new Map([...at.docs, [KINDS, read(KINDS)]]) }
      }
      const plain = placed(written(use, (prop) => OUTER.has(prop)))
      const boxed = placed(written(use, (prop) => prop === 'textFills'))
      for (const result of [edited(plain, boxed), edited(boxed, plain)]) {
        if (COMPOSITIONS.has(component)) {
          expect(result.changes).toBeNull()
          continue
        }
        agrees(result)
        expect(updatesTo(result.changes, use.name)).toEqual([])
      }
      if (use.attrs.textFills === undefined) return
      const coloured = placed(written(use, () => false))
      expect(diffDocuments(boxed.doc, coloured.doc)).toBeNull()
      expect(diffDocuments(coloured.doc, boxed.doc)).toBeNull()
    })
  }
})
