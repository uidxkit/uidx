import {
  aliasTarget,
  hasVariants,
  isAlias,
  METADATA_ATTRS,
  propertyBinding,
  toNodeSpec,
  type JsonValue,
  type UidxAttr,
  type UidxDocument,
  type UidxNode,
  type UidxNodeSpec,
  type UidxPatch,
} from '@uidx/format'
import {
  boxTargetOf,
  deriveVariants,
  instanceFills,
  instanceRole,
  laysOut,
  layered,
  placementOf,
  variantFor,
  withTextFills,
  wrappedFrame,
  type BoxLayer,
  type BoxTarget,
} from '@uidx/schema'

import { parentOf } from './layer-moves'

/** Attributes that make an instance an instance, and go when it becomes plain layers. */
const INSTANCE_ONLY = new Set(['component', 'props', 'overrides', 'textFills'])
/** Attributes that only mean something on a component's own tree. */
const COMPONENT_ONLY = new Set(['implements', 'variants', 'props', 'part', ...METADATA_ATTRS])

/**
 * Detach an instance (Figma's "Detach instance"): the layers it draws, written
 * into the page as an ordinary frame the component no longer controls. The
 * variant its props select is the one copied, its `{prop}` bindings are
 * replaced by the values it showed, its overrides are applied and its slots
 * are filled with what the instance put in them.
 *
 * What the use styled from outside is baked in where the build drew it (ADR
 * 0018 §6): its outer box, and the size it fixes, on the node that draws the
 * box, beneath anything a state row set; its text colour as the fills of each
 * text it reached. Where it sits stays on the copy's root, and its locked
 * attributes, which never drew, are left behind.
 */
export function detachInstance(
  pages: ReadonlyMap<string, UidxDocument>,
  doc: UidxDocument,
  address: string,
): { patches: UidxPatch[]; address: string } | null {
  const instance = findNode(doc.tree, address)
  if (!instance || instance.element !== 'Instance' || instance.synthetic) return null
  const name = instance.attrs.component?.value
  const definition = componentNamed(pages, typeof name === 'string' ? name : '')
  const parent = parentOf(doc, address)
  if (!definition || !parent) return null

  const values = propValues(definition, instance)
  const { source, root, target } = drawnRoot(definition, instance)
  const overrides = overrideMap(instance)
  const fills = new Map(
    instance.children
      .filter((child) => child.element === 'Slot')
      .map((child) => [child.name, child.children] as const),
  )

  /**
   * The node the use's box lands on (`boxTargetOf`): the copy's root when the
   * component lays itself out, else the frame or instance it wraps.
   */
  const boxNode = target.kind === 'self' ? root : target.node
  const box = statedBox(instance)
  const pinned = pinnedSize(instance, boxNode, parent)
  const own = statedTextFills(instance)
  const colour = own ?? inheritedTextFills(doc, instance)

  /**
   * A node of the component as the use draws it (`expandInstance`): the box
   * laid over the node that draws it, and the colour over every text — each
   * beneath any value a state row stamped. The instance a composition holds
   * is handed the box and the use's own colour, as if it had stated them
   * over what the definition wrote there.
   */
  const drawn = (node: UidxNode): UidxNode => {
    if (node === boxNode && target.kind === 'instance')
      return inheriting(layered(node, own ? { ...box, textFills: own } : box), colour)
    if (node === boxNode) return layered(node, box)
    if (node.element === 'Text') return withTextFills(node, colour?.value)
    if (node.element === 'Instance') return inheriting(node, colour)
    return node
  }

  /**
   * An override is looked up by its path inside what the instance draws. When
   * the copy is a variant's frame, the build's path starts at that frame — a
   * styles table's `root/label` — and the copy's own path does not.
   */
  const overridesAt = (path: string): Record<string, JsonValue> => ({
    ...overrides.get(path),
    ...(root === source ? {} : overrides.get(path ? `${root.name}/${path}` : root.name)),
  })

  const rewrite = (node: UidxNode, path: string): UidxNodeSpec => {
    const shown = drawn(node)
    const attrs: Record<string, JsonValue> = {}
    for (const [key, attr] of Object.entries(shown.attrs)) {
      if (!copied(node, key)) continue
      // A variant's attributes are its coordinates, which name it and draw nothing.
      if (node.element === 'Variant' && key in node.attrs) continue
      attrs[key] = substitute(attr.value, values)
    }
    // The size the use fixes sits over the node's own, as the build pins it.
    if (node === boxNode) Object.assign(attrs, pinned)
    Object.assign(attrs, overridesAt(path))
    if (node.element === 'Slot') {
      const filled = fills.get(node.name)
      return {
        element: 'Frame',
        attrs,
        children: (filled ?? node.children).map((child) =>
          filled ? fillContent(child, colour) : rewrite(child, join(path, child.name)),
        ),
      }
    }
    // An instance inside the component stays one, holding what the component
    // put in its slots; the colour reaches those through it.
    if (node.element === 'Instance') {
      const held = node.children.map((child) => written(child, values))
      return { element: 'Instance', attrs, ...(held.length ? { children: held } : {}) }
    }
    const children = node.children.map((child) => rewrite(child, join(path, child.name)))
    return {
      element: node.element === 'Component' || node.element === 'Variant' ? 'Frame' : node.element,
      attrs,
      ...(children.length ? { children } : {}),
    }
  }

  const spec = rewrite(root, '')
  // Where the use sits wins over the definition's, and so do its modes and
  // its repeat. The rest of what it states has gone where it draws, or
  // nowhere: its box to the box node, its colour to the texts, its locked
  // inside dropped (ADR 0018 §1).
  for (const [key, attr] of Object.entries(placementOf(instance).attrs))
    if (!INSTANCE_ONLY.has(key)) spec.attrs[key] = attr.value
  spec.attrs.name = instance.name
  return {
    patches: [
      { op: 'remove-node', address },
      {
        op: 'insert-node',
        parent: parent.address,
        index: parent.children.indexOf(instance),
        node: { ...spec, element: 'Frame' },
      },
    ],
    address,
  }
}

function join(path: string, name: string): string {
  return path ? `${path}/${name}` : name
}

function findNode(root: UidxNode, address: string): UidxNode | null {
  if (root.address === address) return root
  for (const child of root.children) {
    const found = findNode(child, address)
    if (found) return found
  }
  return null
}

function componentNamed(pages: ReadonlyMap<string, UidxDocument>, name: string): UidxNode | null {
  for (const doc of pages.values()) {
    if (doc.tree.element === 'Tokens') continue
    const found = doc.tree.children.find(
      (child) => child.element === 'Component' && child.name === name,
    )
    if (found) return found
  }
  return null
}

/** What each prop shows on this instance: its value, else the default, else the sample. */
function propValues(definition: UidxNode, instance: UidxNode): Map<string, JsonValue> {
  const out = new Map<string, JsonValue>()
  for (const prop of definition.spec?.contract?.props ?? []) {
    const shown = prop.default ?? prop.sample
    if (shown !== undefined) out.set(prop.name, shown)
  }
  const legacy = definition.attrs.props?.value
  if (legacy && typeof legacy === 'object' && !Array.isArray(legacy))
    for (const [key, entry] of Object.entries(legacy))
      if (entry && typeof entry === 'object' && !Array.isArray(entry) && 'default' in entry)
        out.set(key, entry.default as JsonValue)
  const assigned = instance.attrs.props?.value
  if (assigned && typeof assigned === 'object' && !Array.isArray(assigned))
    for (const [key, value] of Object.entries(assigned)) out.set(key, value)
  return out
}

/**
 * The tree the instance draws, chosen as the build chooses it (`variantFor`):
 * `source` is the variant its props select — a stated `state` included — or
 * the component, and `target` is where its box lands in that. `root` is what
 * the copy is made from. A variant has no look of its own (ADR 0005 §5), so
 * when it only wraps one frame, that frame is the copy: the pill a styles
 * table draws one level down, not the wrapper around it. The box may land
 * deeper still, through a frame that only wraps another (ADR 0018 §2); that
 * frame stays in the copy, with what a state row set on it.
 *
 * Derived first, so the attributes a state row wrote carry their stamp.
 */
function drawnRoot(
  definition: UidxNode,
  instance: UidxNode,
): { source: UidxNode; root: UidxNode; target: BoxTarget } {
  const set = deriveVariants(definition)
  const source = hasVariants(set) ? (variantFor(set, instance) ?? set.children[0] ?? set) : set
  const target = boxTargetOf(source)
  const wrapped = wrappedFrame(source)
  const root = source.element === 'Variant' && wrapped?.element === 'Frame' ? wrapped : source
  return { source, root, target }
}

/**
 * Whether an attribute of the component's tree goes into the copy: not the
 * ones only a component's own tree means. `props` on an instance inside it is
 * what that instance shows, though, not a declaration, so it stays.
 */
const copied = (node: UidxNode, key: string): boolean =>
  key === 'props'
    ? node.element === 'Instance'
    : !COMPONENT_ONLY.has(key) && key !== 'repeat' && key !== 'as'

/**
 * The outer box the use states, as written: a token stays an alias, since the
 * copy sits where the instance did and resolves where it resolved. A `{prop}`
 * binding is dropped, as the build drops it, so the component's own value
 * shows (ADR 0018 §5).
 */
function statedBox(instance: UidxNode): BoxLayer {
  const out: BoxLayer = {}
  for (const [prop, attr] of Object.entries(instance.attrs))
    if (instanceRole(prop) === 'box' && !binds(attr.value)) out[prop] = attr
  return out
}

/** The text colour the use states, unless it is a binding, which draws nothing. */
function statedTextFills(instance: UidxNode): UidxAttr | undefined {
  const stated = instance.attrs.textFills
  return stated && !binds(stated.value) ? stated : undefined
}

/**
 * The colour an enclosing instance hands down, when this one sits in what it
 * put in a slot: the nearest that states one wins, as CSS `color` does (ADR
 * 0018 §4). An instance holds nothing but its slot fills, so any instance
 * above this one is such an encloser.
 */
function inheritedTextFills(doc: UidxDocument, instance: UidxNode): UidxAttr | undefined {
  for (let node = parentOf(doc, instance.address); node; node = parentOf(doc, node.address)) {
    const stated = node.element === 'Instance' ? statedTextFills(node) : undefined
    if (stated) return stated
  }
  return undefined
}

/** Whether `value` holds a component-property or item binding, `{label}` or `{item.tone}`, anywhere. */
function binds(value: JsonValue): boolean {
  const target = aliasTarget(value)
  if (target !== null) return propertyBinding(target) !== null
  if (value === null || typeof value !== 'object') return false
  return (Array.isArray(value) ? value : Object.values(value)).some(binds)
}

/** An instance handed the colour as its own, unless it states one: the nearest wins. */
function inheriting(node: UidxNode, colour: UidxAttr | undefined): UidxNode {
  if (!colour || node.attrs.textFills !== undefined) return node
  return { ...node, attrs: { ...node.attrs, textFills: colour } }
}

/**
 * The size the use fixes, written on the node its box lands on, so size and
 * look land together (ADR 0018 §1, §2): each dimension it states and does not
 * leave its parent to fill (`instanceFills`). A frame that lays out is made
 * Fixed on that axis, as the build pins it (`pinnedFrame`), or its hugging
 * would undo the number. An instance takes the size as stated, which already
 * says Fixed.
 */
function pinnedSize(
  instance: UidxNode,
  node: UidxNode,
  parent: UidxNode,
): Record<string, JsonValue> {
  const filled = instanceFills(instance, layoutOf(parent))
  const layout = node.attrs.layoutMode?.value
  const out: Record<string, JsonValue> = {}
  for (const dimension of ['width', 'height'] as const) {
    const stated = instance.attrs[dimension]
    if (stated === undefined || filled[dimension]) continue
    out[dimension] = stated.value
    if (node.element === 'Instance' || (layout !== 'HORIZONTAL' && layout !== 'VERTICAL')) continue
    const primary = (layout === 'HORIZONTAL') === (dimension === 'width')
    out[primary ? 'primaryAxisSizingMode' : 'counterAxisSizingMode'] = 'FIXED'
  }
  return out
}

/**
 * The direction `node` lays out what it holds, which decides whether a child's
 * stretch fills its width or its height. A component, a variant or a slot that
 * states no layout is drawn as a hugging column (`laysOut`).
 */
function layoutOf(node: UidxNode): 'HORIZONTAL' | 'VERTICAL' | undefined {
  const mode = node.attrs.layoutMode?.value
  if (mode === 'HORIZONTAL' || mode === 'VERTICAL') return mode
  return mode === undefined && laysOut(node) ? 'VERTICAL' : undefined
}

/**
 * What the use put in a slot, copied as written: it is the consuming page's
 * own content. A text that states no fills takes the colour; one that states
 * its own keeps it, since explicit beats inherited (ADR 0018 §4). An instance
 * takes the colour as its own unless it states one.
 */
function fillContent(node: UidxNode, colour: UidxAttr | undefined): UidxNodeSpec {
  if (node.element === 'Instance') return toNodeSpec(inheriting(node, colour))
  if (node.element === 'Text' && node.attrs.fills === undefined)
    return toNodeSpec(withTextFills(node, colour?.value))
  const children = node.children.map((child) => fillContent(child, colour))
  const attrs = Object.fromEntries(
    Object.entries(node.attrs).map(([key, attr]) => [key, attr.value]),
  )
  return { element: node.element, attrs, ...(children.length ? { children } : {}) }
}

/**
 * What the component wrote inside an instance it holds — that instance's slot
 * fills — with the component's `{prop}` bindings replaced. A `<Slot>` here is
 * a fill and stays one: an instance holds nothing else.
 */
function written(node: UidxNode, values: ReadonlyMap<string, JsonValue>): UidxNodeSpec {
  const attrs: Record<string, JsonValue> = {}
  for (const [key, attr] of Object.entries(node.attrs))
    if (copied(node, key)) attrs[key] = substitute(attr.value, values)
  const children = node.children.map((child) => written(child, values))
  return { element: node.element, attrs, ...(children.length ? { children } : {}) }
}

function overrideMap(node: UidxNode): Map<string, Record<string, JsonValue>> {
  const declared = node.attrs.overrides?.value
  const out = new Map<string, Record<string, JsonValue>>()
  if (!declared || typeof declared !== 'object' || Array.isArray(declared)) return out
  for (const [key, value] of Object.entries(declared))
    if (value && typeof value === 'object' && !Array.isArray(value))
      out.set(key, value as Record<string, JsonValue>)
  return out
}

/** A `{prop}` binding replaced by the value the instance showed; tokens stay bound. */
function substitute(value: JsonValue, values: ReadonlyMap<string, JsonValue>): JsonValue {
  if (typeof value === 'string') {
    const target = isAlias(value) ? aliasTarget(value) : null
    if (target) return !target.includes('#') && values.has(target) ? values.get(target)! : value
    return value.replace(/\{([A-Za-z][\w.]*)\}/g, (whole: string, name: string) => {
      const found = values.get(name)
      return found === undefined || typeof found === 'object' ? whole : String(found)
    })
  }
  if (Array.isArray(value)) return value.map((item) => substitute(item, values))
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, substitute(item, values)]),
    )
  return value
}
