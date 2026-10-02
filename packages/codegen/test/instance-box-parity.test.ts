import { describe, expect, it } from 'vitest'
import { parseOrThrow, type JsonValue, type UidxDocument, type UidxNode } from '@uidx/format'
import {
  buildTokenIndex,
  modelIndex,
  resolveTokenValues,
  toSceneGraph,
  TokenResolver,
  type SceneResult,
} from '@uidx/schema'
import { cssLength, cssNumber, cssPaint } from '../src/css.js'
import { generate } from '../src/index.js'
import { CHECKBOX } from './fixtures.js'

/**
 * ADR 0018 §6: every target renders the same use. The canvas lays a use's
 * box over the node that draws its component's box, beneath the component's
 * state rows, and hands its text colour to every text inside. The HTML target
 * says the same through the `--uidx-*` hooks its stylesheets read. These tests
 * put the two side by side, property by property: the scene a use builds, and
 * the style a browser computes for the markup the HTML target writes. Each
 * scene value is written as CSS by the converters the stylesheets use
 * (`cssPaint`, `cssLength`, `cssNumber`). The React target hands the same
 * hooks to the same stylesheets, so what holds here holds there too.
 */

/** The theme the uses below draw with. */
const THEME = parseOrThrow(`---
id: theme
---

## Visual Contract

<Tokens>
  <Collection name="surface">
    <Variable name="control" type="COLOR" value={{ r: 1, g: 1, b: 1, a: 1 }} />
    <Variable name="accent" type="COLOR" value={{ r: 0, g: 0.5, b: 1, a: 1 }} />
    <Variable name="danger" type="COLOR" value={{ r: 0.863, g: 0.149, b: 0.149, a: 1 }} />
  </Collection>
  <Collection name="text">
    <Variable name="onAccent" type="COLOR" value={{ r: 1, g: 1, b: 1, a: 1 }} />
    <Variable name="muted" type="COLOR" value={{ r: 0.4, g: 0.4, b: 0.4, a: 1 }} />
  </Collection>
  <Collection name="radius">
    <Variable name="sm" type="FLOAT" value={4} />
  </Collection>
</Tokens>
`)

/** Button1, as the design-system example draws it: a pill with a hover row. */
const BUTTON1 = parseOrThrow(`---
id: button1
---

## Visual Contract

<Page>
  <Component name="Button1" status="draft"
    layoutMode="HORIZONTAL" primaryAxisSizingMode="AUTO" counterAxisSizingMode="AUTO"
    primaryAxisAlignItems="CENTER" counterAxisAlignItems="CENTER"
    paddingLeft={12} paddingRight={12} paddingTop={8} paddingBottom={8} cornerRadius={999}
    fills={[{ opacity: 1, visible: true, type: 'SOLID', color: { r: 0, g: 0.3333, b: 1, a: 1 } }]}>
    <Text name="label" characters="{label}" fontSize={14} />
  </Component>
</Page>

<Styles>
  <Style state="hover" root:fills={[{ opacity: 1, visible: true, type: 'SOLID', color: { r: 0.3678, g: 0.5744, b: 0.9875, a: 1 } }]} />
</Styles>

## Contract

<Props>
  <Prop name="label" type="string" sample="Button1">The words it shows.</Prop>
</Props>
`)

/** A component of one page, holding whatever `body` holds. */
function page(id: string, name: string, body: string, attrs = 'layoutMode="VERTICAL"') {
  return parseOrThrow(`---
id: ${id}
---

## Visual Contract

<Page>
  <Component name="${name}" status="draft" ${attrs}>
${body}
  </Component>
</Page>

## Contract

<Props>
  <Prop name="title" type="string" sample="Hi">Words.</Prop>
</Props>
`)
}

const RED = `[{ type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 } }]`
const GREEN = `[{ type: 'SOLID', color: { r: 0, g: 0.5, b: 0, a: 1 } }]`

/*
 * Codegen writes a use only where a component holds one, so each use below
 * sits in a component of its own page, and the canvas draws that page.
 */

/** ADR 0018 §5's restyled Button1, less the stroke. */
const TOOLBAR = page(
  'toolbar',
  'Toolbar',
  `    <Instance name="delete" component="Button1" props={{ label: 'Delete' }}
      fills="{surface#danger}" cornerRadius={4} paddingLeft={20} textFills="{text#onAccent}" opacity={0.8} />`,
  'layoutMode="HORIZONTAL"',
)
const CONSENT = page(
  'consent',
  'Consent',
  `    <Instance name="on" component="Checkbox" props={{ checked: true }} fills={${RED}} />
    <Instance name="off" component="Checkbox" fills={${RED}} />`,
)
/** A card around its own title and two Button1s, the second stating a text colour of its own. */
const CARD = page(
  'card',
  'Card',
  `    <Text name="title" characters="Title" fontSize={14} />
    <Instance name="cta" component="Button1" props={{ label: 'Go' }} />
    <Instance name="own" component="Button1" props={{ label: 'Mine' }} textFills={${GREEN}} />`,
)
const SHELF = page(
  'shelf',
  'Shelf',
  `    <Instance name="card" component="Card" textFills="{text#onAccent}" />`,
)
/** A heading over a slot. */
const WELL = page(
  'well',
  'Well',
  `    <Text name="heading" characters="{title}" fontSize={14} />
    <Slot name="body" />`,
)
/** A Well that hands down a colour, filled with a text that states fills of its own and one that does not. */
const PANEL = page(
  'panel',
  'Panel',
  `    <Instance name="well" component="Well" props={{ title: 'Heading' }} textFills="{text#onAccent}">
      <Slot name="body">
        <Text name="own" characters="Own" fontSize={12} fills="{text#muted}" />
        <Text name="bare" characters="Bare" fontSize={12} />
      </Slot>
    </Instance>`,
)

/** A frame that lays itself out around one painted frame, as Shoelace's Button draws on `base`. */
const PLAQUE = page(
  'plaque',
  'Plaque',
  `    <Frame name="base" layoutMode="HORIZONTAL" primaryAxisSizingMode="AUTO" counterAxisSizingMode="AUTO"
      paddingLeft={6} paddingRight={6} cornerRadius={2} fills="{surface#control}">
      <Text name="words" characters="{title}" fontSize={12} />
    </Frame>`,
  'layoutMode="HORIZONTAL" primaryAxisSizingMode="AUTO" counterAxisSizingMode="AUTO"',
)
const DESK = page(
  'desk',
  'Desk',
  `    <Instance name="sign" component="Plaque" props={{ title: 'Sign' }}
      fills="{surface#danger}" paddingLeft={20} opacity={0.8} />`,
)

/** Every component page, by file stem. */
const PAGES: Record<string, UidxDocument> = {
  plaque: PLAQUE,
  desk: DESK,
  button1: BUTTON1,
  checkbox: CHECKBOX,
  toolbar: TOOLBAR,
  consent: CONSENT,
  card: CARD,
  shelf: SHELF,
  well: WELL,
  panel: PANEL,
}

/* ------------------------------------------------------------ the canvas */

type SceneNode = NonNullable<ReturnType<SceneResult['graph']['getNode']>>

/** `doc` drawn as the canvas draws it: tokens with their modes, components and models from every page. */
function draw(doc: UidxDocument): SceneResult {
  const docs = [THEME, ...Object.values(PAGES)]
  const index = buildTokenIndex(docs)
  const literals = resolveTokenValues(docs)
  const components = new Map<string, UidxNode>()
  for (const each of docs)
    for (const child of each.tree.children)
      if (child.element === 'Component') components.set(child.name, child)
  return toSceneGraph(doc, {
    resolveAlias: (address) => literals.get(address),
    resolveComponent: (name) => components.get(name),
    tokens: { resolver: new TokenResolver(index), index },
    models: modelIndex(docs),
  })
}

function nodeOf(scene: SceneResult, id: string): SceneNode {
  const found = scene.graph.getNode(id)
  if (!found) throw new Error(`no scene node ${id}`)
  return found
}

/** A paint list's colour as CSS writes it: the first visible solid paint. */
const paint = (paints: SceneNode['fills']): string | null =>
  cssPaint(paints as unknown as JsonValue)

type Corner = 'topLeftRadius' | 'topRightRadius' | 'bottomRightRadius' | 'bottomLeftRadius'

/** A corner as the canvas draws it: its own radius when the corners are independent, else the uniform one. */
const corner = (node: SceneNode, key: Corner): number =>
  node.independentCorners ? node[key] : node.cornerRadius

/**
 * The box properties a use can set that CSS can say, by their CSS names, each
 * read off a scene node and written as CSS by the converters the stylesheets
 * use.
 */
const BOX: Record<string, (node: SceneNode) => string | null> = {
  'background-color': (node) => paint(node.fills),
  'border-top-left-radius': (node) => cssLength(corner(node, 'topLeftRadius')),
  'border-top-right-radius': (node) => cssLength(corner(node, 'topRightRadius')),
  'border-bottom-right-radius': (node) => cssLength(corner(node, 'bottomRightRadius')),
  'border-bottom-left-radius': (node) => cssLength(corner(node, 'bottomLeftRadius')),
  'padding-top': (node) => cssLength(node.paddingTop),
  'padding-right': (node) => cssLength(node.paddingRight),
  'padding-bottom': (node) => cssLength(node.paddingBottom),
  'padding-left': (node) => cssLength(node.paddingLeft),
  opacity: (node) => cssNumber(node.opacity),
}

/* ------------------------------------------------- what a browser computes */

/*
 * Just enough of a browser to read the generated output: the markup as
 * elements, the stylesheets as rules, and the cascade between them. That
 * means selector specificity, inline style above every rule, and custom
 * properties inherited and substituted where they are declared, with
 * `initial` as no value at all. It reads the selectors and values codegen
 * writes, and throws on any it does not know rather than guess.
 */

/** One element of the markup, as far as a selector reads it. */
interface MarkupElement {
  tag: string
  attrs: Map<string, string>
  parent: MarkupElement | null
  children: MarkupElement[]
}

interface Rule {
  selector: string
  declarations: [string, string][]
  /** Ids, then classes, attributes and pseudo-classes, then types: how rules rank. */
  specificity: [number, number, number]
}

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"' }

/** The generated markup as elements under a document root, which is what `:root` matches. */
function parseMarkup(html: string): MarkupElement {
  const root: MarkupElement = { tag: 'html', attrs: new Map(), parent: null, children: [] }
  let open = root
  for (const [, closing, tag, attrs, selfClosing] of html.matchAll(
    /<(\/?)([a-z][\w-]*)([^>]*?)(\/?)>/gi,
  )) {
    if (closing) {
      open = open.parent ?? root
      continue
    }
    const element: MarkupElement = {
      tag: tag!.toLowerCase(),
      attrs: new Map(),
      parent: open,
      children: [],
    }
    for (const [, name, value = ''] of (attrs ?? '').matchAll(/([\w-]+)(?:="([^"]*)")?/g))
      element.attrs.set(
        name!,
        value.replace(/&(amp|lt|gt|quot);/g, (entity) => ENTITIES[entity]!),
      )
    open.children.push(element)
    if (!selfClosing) open = element
  }
  return root
}

/** Every element under `root`, in document order. */
const descendants = (root: MarkupElement): MarkupElement[] =>
  root.children.flatMap((child) => [child, ...descendants(child)])

function find(root: MarkupElement, test: (element: MarkupElement) => boolean): MarkupElement {
  const found = descendants(root).find(test)
  if (!found) throw new Error('no such element in the markup')
  return found
}

const hasClass = (name: string) => (element: MarkupElement) =>
  (element.attrs.get('class') ?? '').split(/\s+/).includes(name)
const isNode = (name: string) => (element: MarkupElement) => element.attrs.get('data-node') === name

/** The simple selectors of one compound: `hwc-checkbox[checked]` is `hwc-checkbox` and `[checked]`. */
function simpleSelectors(compound: string): string[] {
  const parts = compound.match(/^[a-z*][\w-]*|\.[\w-]+|\[[^\]]*\]|::?[\w-]+(?:\([^)]*\))?/gi) ?? []
  if (parts.join('') !== compound)
    throw new Error(`a selector this reader does not know: ${compound}`)
  return parts
}

function specificity(selector: string): [number, number, number] {
  let attributes = 0
  let types = 0
  for (const step of selector.split(/\s+/)) {
    if (step === '>') continue
    for (const part of simpleSelectors(step)) {
      if (/^(\.|\[|:[^:])/.test(part)) attributes++
      else if (part !== '*') types++
    }
  }
  return [0, attributes, types]
}

/** Every rule of a stylesheet, in source order. */
function parseRules(css: string): Rule[] {
  const rules: Rule[] = []
  const uncommented = css.replace(/\/\*[\s\S]*?\*\//g, '')
  for (const [, selectors, body] of uncommented.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const declarations = [...body!.matchAll(/([\w-]+)\s*:\s*([^;]+);/g)].map(
      ([, prop, value]): [string, string] => [prop!, value!.trim()],
    )
    for (const selector of selectors!.split(',').map((each) => each.trim()))
      rules.push({ selector, declarations, specificity: specificity(selector) })
  }
  return rules
}

/** Whether `element` matches one compound. Nothing here is hovered, focused or in a custom state. */
function matchesCompound(element: MarkupElement, compound: string): boolean {
  return simpleSelectors(compound).every((part) => {
    if (part === '*') return true
    if (part.startsWith('.')) return hasClass(part.slice(1))(element)
    if (part.startsWith('[')) {
      const [, name, value] = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(part) ?? []
      if (name === undefined)
        throw new Error(`an attribute selector this reader does not know: ${part}`)
      return element.attrs.has(name) && (value === undefined || element.attrs.get(name) === value)
    }
    if (part === ':root') return element.parent === null
    // A state (`:hover`, `:state(x)`) or a shadow part (`::part(x)`).
    if (part.startsWith(':')) return false
    return element.tag === part.toLowerCase()
  })
}

/** Whether `element` matches `selector`, its steps read right to left as a browser reads them. */
function matches(element: MarkupElement, selector: string): boolean {
  const steps = selector.split(/\s+/)
  const from = (at: MarkupElement | null, index: number): boolean => {
    if (!at || !matchesCompound(at, steps[index]!)) return false
    if (index === 0) return true
    if (steps[index - 1] === '>') return from(at.parent, index - 2)
    for (let up = at.parent; up; up = up.parent) if (from(up, index - 1)) return true
    return false
  }
  return from(element, steps.length - 1)
}

const bySpecificity = (a: Rule, b: Rule): number =>
  a.specificity[0] - b.specificity[0] ||
  a.specificity[1] - b.specificity[1] ||
  a.specificity[2] - b.specificity[2]

/** What applies to `element`: its matching rules by specificity, then source order, and its inline style over them all. */
function cascade(element: MarkupElement, rules: readonly Rule[]): Map<string, string> {
  const out = new Map<string, string>()
  // `sort` is stable, so equal specificity keeps source order.
  const applying = rules.filter((rule) => matches(element, rule.selector)).sort(bySpecificity)
  for (const rule of applying) for (const [prop, value] of rule.declarations) out.set(prop, value)
  for (const entry of (element.attrs.get('style') ?? '').split(';')) {
    const at = entry.indexOf(':')
    if (at > 0) out.set(entry.slice(0, at).trim(), entry.slice(at + 1).trim())
  }
  return out
}

/**
 * `value` with each `var(--name, fallback)` replaced: by the property when it
 * has a value, else by the fallback. Null when it has neither, which makes a
 * declaration invalid where it is computed.
 */
function substitute(value: string, env: ReadonlyMap<string, string>, depth = 0): string | null {
  const at = value.indexOf('var(')
  if (at < 0) return value
  if (depth > 32) return null
  let end = at + 4
  for (let open = 1; open > 0; end++) {
    if (end >= value.length) throw new Error(`an unclosed var() in ${value}`)
    if (value[end] === '(') open++
    else if (value[end] === ')') open--
  }
  const inner = value.slice(at + 4, end - 1)
  const comma = inner.indexOf(',')
  const name = (comma < 0 ? inner : inner.slice(0, comma)).trim()
  const replacement = env.get(name) ?? (comma < 0 ? undefined : inner.slice(comma + 1).trim())
  if (replacement === undefined) return null
  return substitute(value.slice(0, at) + replacement + value.slice(end), env, depth + 1)
}

/**
 * The custom properties `element` sees: its parent's, then the ones it
 * declares, each substituted on the element that declares it. So a hook set
 * to a token carries the token's value down to the elements below.
 */
function customProperties(element: MarkupElement, rules: readonly Rule[]): Map<string, string> {
  const env = new Map(element.parent ? customProperties(element.parent, rules) : [])
  const own = [...cascade(element, rules)].filter(([prop]) => prop.startsWith('--'))
  for (const [prop, value] of own) {
    if (value === 'initial') env.delete(prop)
    else env.set(prop, value)
  }
  for (const [prop] of own) {
    const raw = env.get(prop)
    const value = raw === undefined ? null : substitute(raw, env)
    if (value === null) env.delete(prop)
    else env.set(prop, value)
  }
  return env
}

/** The properties compared here that an element takes from its parent when it sets none. */
const INHERITED = new Set(['color'])

/**
 * `prop` on `element` as a browser computes it, or null when nothing sets it.
 * Tokens are stored unitless and the stylesheets scale them with `calc(…)`,
 * which a browser computes to the length.
 */
function computed(element: MarkupElement, prop: string, rules: readonly Rule[]): string | null {
  const declared = cascade(element, rules).get(prop)
  const value =
    declared === undefined ? null : substitute(declared, customProperties(element, rules))
  if (value !== null) return value.replace(/calc\((-?[\d.]+) \* 1px\)/g, '$1px')
  return INHERITED.has(prop) && element.parent ? computed(element.parent, prop, rules) : null
}

/* ------------------------------------------------------------------ the uses */

const { files } = generate({
  pages: Object.entries(PAGES).map(([file, doc]) => ({ file: `${file}.uidx`, doc })),
  tokens: [THEME],
  targets: ['html'],
})
/** Every stylesheet a page holding these components loads, tokens first. */
const RULES = parseRules(
  [...files]
    .filter(([path]) => path.endsWith('.css'))
    .map(([, css]) => css)
    .join('\n'),
)
const markupOf = (stem: string) => parseMarkup(files.get(`html/${stem}.html`)!)

/** The box `element` draws in a browser and the one `node` draws on the canvas, side by side. */
function boxes(element: MarkupElement, node: SceneNode) {
  return {
    browser: Object.fromEntries(
      Object.keys(BOX).map((prop) => [prop, computed(element, prop, RULES)]),
    ),
    canvas: Object.fromEntries(Object.entries(BOX).map(([prop, read]) => [prop, read(node)])),
  }
}

describe('a restyled Button1: the box and the label (ADR 0018 §1, §2)', () => {
  const scene = draw(TOOLBAR)
  const button = find(markupOf('toolbar'), hasClass('button1'))

  it('draws without a warning', () => {
    expect(scene.warnings).toEqual([])
  })

  it('draws on the box element what the canvas draws on the box frame, property by property', () => {
    const { browser, canvas } = boxes(button, nodeOf(scene, 'Toolbar#delete/root'))
    expect(browser).toEqual(canvas)
    // What the use states, and the component's own values where it is silent.
    expect(canvas).toMatchObject({
      'background-color': 'rgb(220 38 38)',
      'border-top-left-radius': '4px',
      'border-bottom-right-radius': '4px',
      'padding-left': '20px',
      'padding-right': '12px',
      'padding-top': '8px',
      opacity: '0.8',
    })
  })

  it('draws nothing on the wrapper, which the markup has no element for', () => {
    const wrapper = nodeOf(scene, 'Toolbar#delete')
    expect(paint(wrapper.fills)).toBeNull()
    expect(wrapper.opacity).toBe(1)
    expect(hasClass('toolbar')(button.parent!)).toBe(true)
  })

  it('colours the label as the canvas does', () => {
    const label = nodeOf(scene, 'Toolbar#delete/root/label')
    expect(computed(find(button, isNode('label')), 'color', RULES)).toBe(paint(label.fills))
    expect(paint(label.fills)).toBe('rgb(255 255 255)')
  })
})

describe('a checked Checkbox the use fills (ADR 0018 §3)', () => {
  const scene = draw(CONSENT)
  const rule = (selector: string) => RULES.find((each) => each.selector === selector)!
  const fillOf = (selector: string) =>
    rule(selector).declarations.find(([prop]) => prop === 'background-color')?.[1]

  it('shows the row’s fill on the canvas, where the state sits above the use', () => {
    expect(scene.warnings).toEqual([])
    expect(paint(nodeOf(scene, 'Consent#on/root').fills)).toBe('rgb(0 128 255)')
    expect(paint(nodeOf(scene, 'Consent#off/root').fills)).toBe('rgb(255 0 0)')
  })

  it('keeps the [checked] rule literal, while the resting rule reads the hook', () => {
    expect(fillOf('hwc-checkbox[checked]')).toBe('var(--surface-accent)')
    expect(fillOf('hwc-checkbox')).toBe('var(--uidx-fill, var(--surface-control))')
  })

  it('computes the canvas’s fill in either state', () => {
    const [on, off] = descendants(markupOf('consent')).filter((each) => each.tag === 'hwc-checkbox')
    // The headless element reflects the `checked` the use passes. The
    // fragment shows the anatomy rather than the state, so it is set here.
    on!.attrs.set('checked', '')
    expect(computed(on!, 'background-color', RULES)).toBe(
      paint(nodeOf(scene, 'Consent#on/root').fills),
    )
    expect(computed(off!, 'background-color', RULES)).toBe(
      paint(nodeOf(scene, 'Consent#off/root').fills),
    )
  })
})

describe('text colour handed down into a nested instance (ADR 0018 §4)', () => {
  const scene = draw(SHELF)
  const card = find(markupOf('shelf'), hasClass('card'))
  const [cta, own] = descendants(card).filter(hasClass('button1'))
  const colourOf = (element: MarkupElement, name: string) =>
    computed(find(element, isNode(name)), 'color', RULES)

  it('reaches the card’s own text and the texts of the Button1 it holds, as CSS color inherits', () => {
    expect(scene.warnings).toEqual([])
    const title = nodeOf(scene, 'Shelf#card/title')
    const label = nodeOf(scene, 'Shelf#card/cta/root/label')
    expect(colourOf(card, 'title')).toBe(paint(title.fills))
    expect(colourOf(cta!, 'label')).toBe(paint(label.fills))
    expect(paint(label.fills)).toBe('rgb(255 255 255)')
  })

  it('gives way to a nested instance that states its own: the nearest wins', () => {
    const label = nodeOf(scene, 'Shelf#card/own/root/label')
    expect(colourOf(own!, 'label')).toBe(paint(label.fills))
    expect(paint(label.fills)).toBe('rgb(0 128 0)')
  })

  it('is never reset by a component root, so it inherits through every component', () => {
    const resets = RULES.filter((each) =>
      each.declarations.some(([prop]) => prop === '--uidx-text-color'),
    )
    expect(resets).toEqual([])
  })
})

describe('text colour handed down into slot content (ADR 0018 §4)', () => {
  const scene = draw(PANEL)
  const well = find(markupOf('panel'), hasClass('well'))
  const colourOf = (name: string) => computed(find(well, isNode(name)), 'color', RULES)

  it('reaches the component’s own text as CSS color inherits', () => {
    expect(scene.warnings).toEqual([])
    const heading = nodeOf(scene, 'Panel#well/heading')
    expect(colourOf('heading')).toBe(paint(heading.fills))
    expect(paint(heading.fills)).toBe('rgb(255 255 255)')
  })

  it('on the canvas, keeps fills slot content states and colours slot content that states none', () => {
    expect(paint(nodeOf(scene, 'Panel#well/body/own').fills)).toBe('rgb(102 102 102)')
    expect(paint(nodeOf(scene, 'Panel#well/body/bare').fills)).toBe('rgb(255 255 255)')
  })

  /*
   * Slot content is the consuming component's own, so its stylesheet styles
   * it (`emitCss`): a text that states fills gets them as a literal colour,
   * which the use's `--uidx-text-color` cannot reach, and one that states
   * none reads the hook, which the use sets on the element it fills.
   */
  it('keeps fills slot content states, in a browser too', () => {
    expect(colourOf('own')).toBe(paint(nodeOf(scene, 'Panel#well/body/own').fills))
  })

  it('colours slot content that states none, in a browser too', () => {
    expect(colourOf('bare')).toBe(paint(nodeOf(scene, 'Panel#well/body/bare').fills))
  })
})

describe('a box found through a frame that only wraps it (ADR 0018 §2)', () => {
  const scene = draw(DESK)
  const plaque = find(markupOf('desk'), hasClass('plaque'))
  const base = find(plaque, isNode('base'))

  it('draws on that frame’s element what the canvas draws on that frame', () => {
    expect(scene.warnings).toEqual([])
    const { browser, canvas } = boxes(base, nodeOf(scene, 'Desk#sign/base'))
    expect(browser).toEqual(canvas)
    expect(canvas).toMatchObject({
      'background-color': 'rgb(220 38 38)',
      'padding-left': '20px',
      'padding-right': '6px',
      opacity: '0.8',
    })
  })

  it('draws nothing on the wrapper, on the canvas or in a browser', () => {
    const wrapper = nodeOf(scene, 'Desk#sign')
    expect(paint(wrapper.fills)).toBeNull()
    expect([wrapper.paddingLeft, wrapper.opacity]).toEqual([0, 1])
    // Nothing set there, so a browser draws its initial values: no fill, no padding.
    const { browser } = boxes(plaque, wrapper)
    expect(Object.values(browser).every((value) => value === null)).toBe(true)
  })
})
