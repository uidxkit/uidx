import {
  resolve,
  toAlias,
  type ContractDeclaration,
  type ContractKind,
  type UidxDocument,
  type UidxNode,
  type UidxPatch,
} from '@uidx/format'
import {
  derivedTarget,
  repeatListType,
  repeatModel,
  repeatOf,
  sampleCount,
  type ModelIndex,
  type RepeatScope,
} from '@uidx/schema'
import { enclosingComponent } from './component-prop-edits'
import type { HeadlessElement, HeadlessLibrary } from './headless'

/**
 * What the Contract tab shows and writes (ADR 0013 §3, ADR 0017 §2).
 *
 * The tab binds the visual tree to the code render: a `<Component>` names the
 * headless element it implements, a layer names the part it draws, and any
 * layer names the list it repeats over. Three bindings — `implements`,
 * `part`, `repeat`/`as`/`count` — that the prop table deliberately does not
 * know, because they are bindings to the contract rather than scene fields.
 *
 * Pure, like `instance-prop-edits`: the view is computed from the document
 * and the library, and every gesture is a list of patches the shell applies.
 */

/** The elements a part may be bound to: things that draw, not holes or uses. */
const BINDABLE: ReadonlySet<string> = new Set(['Frame', 'Text', 'Vector', 'Rectangle', 'Ellipse'])

export interface PartRow {
  name: string
  /** Where the name is declared: the library, the file's `<Parts>`, or both. */
  declaredBy: 'library' | 'contract' | 'both'
  /** How the library exposes it; absent for a part only the contract declares. */
  kind?: 'element' | 'shadow'
  /** The layer bound to it, or null while unbound. */
  boundTo: { address: string; name: string; element: string } | null
}

export interface SlotRow {
  name: string
  /** The `<Slot>` providing it, with what it repeats over when it does, or null while missing. */
  provided: { address: string; repeat: { list: string; count: number | null } | null } | null
}

export interface Candidate {
  address: string
  name: string
  element: string
  depth: number
}

export interface ComponentView {
  kind: 'component'
  component: UidxNode
  implementsValue: string | null
  /** The library's roots, plus the current value when the library lacks it. */
  rootOptions: { tag: string; known: boolean }[]
  element: HeadlessElement | null
  parts: PartRow[]
  /** Layers a part could be bound to, in tree order, excluding those already bound. */
  candidates: Candidate[]
  slots: SlotRow[]
  /** Layers bound to a part nothing declares. */
  strayParts: { address: string; name: string; part: string }[]
}

/** How a layer repeats (ADR 0017 §2): the list it walks, its item's name, the canvas's rows. */
export interface RepeatBinding {
  /** The alias target: `items`, or `person.tags` inside an outer repeat. */
  list: string
  as: string
  /** Rows the canvas draws when the file says; null leaves it to the model's samples. */
  count: number | null
  /** The rows drawn while `count` is null: the model's longest sample list. */
  defaultCount: number
  /** The model of one item, when the contract can place the list; by type alone when unknown. */
  model: string | null
  /** True when the list is placed but its model is declared on no page in the index. */
  unknownModel: boolean
}

/** The repeat rows every layer inside a component shows: part, slot, or instance alike. */
export interface RepeatFacet {
  repeat: RepeatBinding | null
  /** Lists a repeat here may walk: the contract's list props, then list fields of enclosing items. */
  lists: string[]
}

export interface PartView extends RepeatFacet {
  kind: 'part'
  node: UidxNode
  component: UidxNode
  partValue: string | null
  /** Every declared part; `takenBy` names the other layer holding it. */
  options: { name: string; takenBy: string | null; kind?: 'element' | 'shadow' }[]
  /** True when neither the library nor the contract declares any part. */
  undeclared: boolean
}

export interface SlotView extends RepeatFacet {
  kind: 'slot'
  node: UidxNode
  component: UidxNode | null
  declared: { accepts?: string } | null
}

export interface InstanceView extends RepeatFacet {
  kind: 'instance'
  node: UidxNode
  component: UidxNode | null
}

export interface OtherView {
  kind: 'page' | 'other'
  node: UidxNode | null
}

/** A node of a derived state: bindings live on the base layer it was copied from. */
export interface DerivedView {
  kind: 'derived'
  node: UidxNode
  base: UidxNode
  component: UidxNode
  state: string
}

export type ContractView =
  ComponentView | PartView | SlotView | InstanceView | OtherView | DerivedView

/** The parts a component may bind, from the library element and the contract. */
export function declaredParts(component: UidxNode, element: HeadlessElement | null): PartRow[] {
  const contract = (component.spec?.contract?.parts ?? []).map((part) => part.name)
  const rows = new Map<string, PartRow>()
  for (const part of element?.parts ?? [])
    rows.set(part.name, { name: part.name, declaredBy: 'library', kind: part.kind, boundTo: null })
  for (const name of contract) {
    const row = rows.get(name)
    if (row) row.declaredBy = 'both'
    else rows.set(name, { name, declaredBy: 'contract', boundTo: null })
  }
  return [...rows.values()]
}

function implementedElement(
  component: UidxNode,
  library: HeadlessLibrary | null,
): HeadlessElement | null {
  const tag = component.attrs.implements?.value
  return typeof tag === 'string' ? (library?.elements.get(tag) ?? null) : null
}

/** Every layer below a component, depth-first, with its depth for indenting. */
function descendants(component: UidxNode): Candidate[] {
  const out: Candidate[] = []
  const walk = (node: UidxNode, depth: number): void => {
    for (const child of node.children) {
      out.push({ address: child.address, name: child.name, element: child.element, depth })
      // An instance's insides belong to another component; a part cannot
      // reach into them (ADR 0013 §3 binds parts within one tree).
      if (child.element !== 'Instance') walk(child, depth + 1)
    }
  }
  walk(component, 0)
  return out
}

function partBindings(component: UidxNode): Map<string, UidxNode> {
  const out = new Map<string, UidxNode>()
  const walk = (node: UidxNode): void => {
    for (const child of node.children) {
      const part = child.attrs.part?.value
      if (typeof part === 'string' && !out.has(part)) out.set(part, child)
      if (child.element !== 'Instance') walk(child)
    }
  }
  walk(component)
  return out
}

function componentView(component: UidxNode, library: HeadlessLibrary | null): ComponentView {
  const value = component.attrs.implements?.value
  const implementsValue = typeof value === 'string' ? value : null
  const element = implementedElement(component, library)
  const rootOptions = (library?.roots ?? []).map((root) => ({ tag: root.tag, known: true }))
  if (implementsValue !== null && !rootOptions.some((option) => option.tag === implementsValue))
    rootOptions.unshift({ tag: implementsValue, known: false })

  const bindings = partBindings(component)
  const parts = declaredParts(component, element)
  for (const row of parts) {
    const node = bindings.get(row.name)
    if (node) row.boundTo = { address: node.address, name: node.name, element: node.element }
  }
  const declared = new Set(parts.map((row) => row.name))
  const strayParts = [...bindings]
    .filter(([name]) => !declared.has(name))
    .map(([part, node]) => ({ address: node.address, name: node.name, part }))

  const bound = new Set([...bindings.values()].map((node) => node.address))
  const candidates = descendants(component).filter(
    (candidate) => BINDABLE.has(candidate.element) && !bound.has(candidate.address),
  )

  const slots: SlotRow[] = (component.spec?.contract?.slots ?? []).map((slot) => ({
    name: slot.name,
    provided: null,
  }))
  for (const name of element?.slots ?? []) {
    if (name !== '' && !slots.some((slot) => slot.name === name))
      slots.push({ name, provided: null })
  }
  const provide = (node: UidxNode): void => {
    for (const child of node.children) {
      if (child.element === 'Slot') {
        const row = slots.find((slot) => slot.name === child.name)
        const repeat = repeatOf(child)
        if (row && !row.provided)
          row.provided = {
            address: child.address,
            repeat: repeat ? { list: repeat.list, count: repeat.count ?? null } : null,
          }
      }
      if (child.element !== 'Instance') provide(child)
    }
  }
  provide(component)

  return {
    kind: 'component',
    component,
    implementsValue,
    rootOptions,
    element,
    parts,
    candidates,
    slots,
    strayParts,
  }
}

function partView(
  node: UidxNode,
  component: UidxNode,
  library: HeadlessLibrary | null,
  models?: ModelIndex,
): PartView {
  const element = implementedElement(component, library)
  const value = node.attrs.part?.value
  const partValue = typeof value === 'string' ? value : null
  const bindings = partBindings(component)
  const options = declaredParts(component, element).map((row) => {
    const holder = bindings.get(row.name)
    return {
      name: row.name,
      takenBy: holder && holder.address !== node.address ? holder.name : null,
      ...(row.kind ? { kind: row.kind } : {}),
    }
  })
  // A value nothing declares still shows, so the row never lies about the file.
  if (partValue !== null && !options.some((option) => option.name === partValue))
    options.unshift({ name: partValue, takenBy: null })
  return {
    kind: 'part',
    node,
    component,
    partValue,
    options,
    undeclared: options.length === 0,
    ...repeatFacet(component, node, models),
  }
}

/* ------------------------------------------------------------ repeats */

/** The layers from the component down to, excluding, the node — the repeats among them scope it. */
function ancestorsWithin(component: UidxNode, node: UidxNode): UidxNode[] {
  const path: UidxNode[] = []
  const walk = (current: UidxNode): boolean => {
    if (current === node) return true
    for (const child of current.children) {
      path.push(current)
      if (walk(child)) return true
      path.pop()
    }
    return false
  }
  return walk(component) ? path : []
}

/** The repeats enclosing a node, outermost first, each with the model its item carries. */
function enclosingRepeats(component: UidxNode, node: UidxNode, models?: ModelIndex): RepeatScope[] {
  const scopes: RepeatScope[] = []
  for (const ancestor of ancestorsWithin(component, node)) {
    const repeat = repeatOf(ancestor)
    if (repeat)
      scopes.push({ as: repeat.as, model: repeatModel(repeat, component.spec, scopes, models) })
  }
  return scopes
}

/**
 * The lists a repeat on this layer may walk (ADR 0017 §2): the contract's
 * list props as `items`, and the list fields of every enclosing item as
 * `person.tags` — what a tree or a grouped list nests on.
 */
export function placeableLists(
  component: UidxNode | null,
  node: UidxNode,
  models?: ModelIndex,
): string[] {
  if (!component) return []
  const out: string[] = []
  for (const prop of component.spec?.contract?.props ?? [])
    if (prop.type.trim().endsWith('[]')) out.push(prop.name)
  for (const scope of enclosingRepeats(component, node, models))
    for (const field of scope.model?.fields ?? [])
      if (field.type.trim().endsWith('[]')) out.push(`${scope.as}.${field.name}`)
  return out
}

function repeatFacet(component: UidxNode | null, node: UidxNode, models?: ModelIndex): RepeatFacet {
  const lists = placeableLists(component, node, models)
  const attrs = repeatOf(node)
  if (!attrs || !component) return { repeat: null, lists }
  const enclosing = enclosingRepeats(component, node, models)
  const model = repeatModel(attrs, component.spec, enclosing, models)
  const placed = model ? undefined : repeatListType(attrs, component.spec, enclosing, models)
  return {
    repeat: {
      list: attrs.list,
      as: attrs.as,
      count: attrs.count ?? null,
      defaultCount: sampleCount(model),
      model: model?.name ?? (placed ? placed.slice(0, -2) : null),
      unknownModel: !model && typeof placed === 'string',
    },
    lists,
  }
}

/**
 * The tab's view of the selection.
 *
 * A component is the anchor: everything the tab writes is a binding to a
 * component's contract, so a layer outside one has nothing to bind and says so.
 */
export function contractView(
  doc: UidxDocument | null,
  node: UidxNode | null,
  library: HeadlessLibrary | null,
  models?: ModelIndex,
): ContractView {
  if (!doc || !node) return { kind: 'page', node: null }
  if (node.element === 'Component') return componentView(node, library)
  const from = derivedTarget(doc, node.address)
  if (from) {
    // The default state draws the base tree (ADR 0016 §4): selected there, a
    // layer is the authored one, and the component's root is the component.
    if (from.isDefault) return contractView(doc, from.base, library, models)
    const state = Object.entries(from.keys)
      .map(([axis, value]) => `${axis}=${value}`)
      .join(', ')
    return { kind: 'derived', node, base: from.base, component: from.component, state }
  }
  const component = enclosingComponent(doc, node.address)
  if (node.element === 'Slot') {
    const declared = component?.spec?.contract?.slots.find((slot) => slot.name === node.name)
    return {
      kind: 'slot',
      node,
      component,
      declared: declared ? (declared.accepts ? { accepts: declared.accepts } : {}) : null,
      ...repeatFacet(component, node, models),
    }
  }
  if (node.element === 'Instance')
    return { kind: 'instance', node, component, ...repeatFacet(component, node, models) }
  if (component && BINDABLE.has(node.element)) return partView(node, component, library, models)
  return { kind: 'other', node }
}

/** Parts declared and unbound, plus stray bindings — what the tab's badge counts. */
export function contractIssues(view: ContractView): number {
  if (view.kind === 'component')
    return view.parts.filter((row) => !row.boundTo).length + view.strayParts.length
  if (view.kind === 'part' && view.partValue !== null)
    return view.options.some((option) => option.name === view.partValue && !option.takenBy) ? 0 : 1
  return 0
}

/* ------------------------------------------------------------ writes */

function setAttr(node: UidxNode, prop: string, value: string | number | null): UidxPatch[] {
  if (value === null || value === '')
    return node.attrs[prop] === undefined ? [] : [{ op: 'remove', address: node.address, prop }]
  return [
    { op: node.attrs[prop] === undefined ? 'add' : 'set', address: node.address, prop, value },
  ]
}

/** `implements` on a component; empty clears it. */
export function setImplements(component: UidxNode, tag: string | null): UidxPatch[] {
  return setAttr(component, 'implements', tag)
}

/** `part` on a layer; empty clears it. */
export function setPart(node: UidxNode, part: string | null): UidxPatch[] {
  return setAttr(node, 'part', part)
}

/**
 * Binds a part to a layer from the component's side, moving it off whichever
 * layer held it — a part is bound once (ADR 0013 §3), so choosing a new layer
 * is also unbinding the old one, and the two land in one patch.
 */
export function bindPart(
  doc: UidxDocument,
  component: UidxNode,
  part: string,
  address: string,
): UidxPatch[] {
  const target = resolve(doc.tree, address)
  if (!target) return []
  const holder = partBindings(component).get(part)
  const out: UidxPatch[] = []
  if (holder && holder.address !== target.address) out.push(...setPart(holder, null))
  out.push(...setPart(target, part))
  return out
}

/**
 * `repeat="{list}"` on a layer (ADR 0017 §2). Clearing it takes `as` and
 * `count` with it — those first, since the parser refuses either without a
 * repeat to ride on and every patch must leave a valid file.
 */
export function setRepeat(node: UidxNode, list: string | null): UidxPatch[] {
  const target = list?.trim().replace(/^\{|\}$/g, '') ?? ''
  if (target === '') return ['as', 'count', 'repeat'].flatMap((prop) => setAttr(node, prop, null))
  return setAttr(node, 'repeat', toAlias(target))
}

/** The item's name for the bindings below a repeat; `item` is the default and is not written. */
export function setRepeatAs(node: UidxNode, as: string | null): UidxPatch[] {
  const name = as?.trim() ?? ''
  if (name === '' || name === 'item') return setAttr(node, 'as', null)
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return []
  return setAttr(node, 'as', name)
}

/** How many rows the canvas draws; a non-negative integer, or null to let the model's samples say. */
export function setRepeatCount(node: UidxNode, count: number | null): UidxPatch[] {
  if (count === null || Number.isNaN(count)) return setAttr(node, 'count', null)
  if (!Number.isInteger(count) || count < 0) return []
  return setAttr(node, 'count', count)
}

/* ------------------------------------------------- the contract itself */

/** Writes one declaration of the contract (ADR 0013 §2), creating its list and region as needed. */
export function declare(
  kind: ContractKind,
  name: string,
  declaration: ContractDeclaration,
): UidxPatch[] {
  if (!name.trim()) return []
  return [{ op: 'contract', kind, name: name.trim(), declaration }]
}

/** Removes one declaration; a list left empty goes with it. */
export function undeclare(kind: ContractKind, name: string): UidxPatch[] {
  return [{ op: 'contract', kind, name }]
}

/** The words a scaffolded declaration carries until someone writes its own. */
export const PLACEHOLDER = 'Describe '

/** True for a description nobody has written yet. */
export const isPlaceholder = (description: string): boolean => description.startsWith(PLACEHOLDER)

/**
 * The contract's type for a manifest attribute type: `boolean` stays,
 * a union of quoted strings becomes an enum in the contract's spelling, and
 * anything else — `string`, `number`, or nothing — is text.
 */
export function contractType(manifestType: string | undefined): string {
  if (!manifestType) return 'string'
  const text = manifestType.trim()
  if (text === 'boolean') return 'boolean'
  if (text === 'number') return 'number'
  const parts = text.split('|').map((part) => part.trim())
  if (parts.length > 1 && parts.every((part) => /^(['"]).*\1$/.test(part)))
    return parts.map((part) => `'${part.slice(1, -1)}'`).join(' | ')
  return 'string'
}

/**
 * Declarations the library's element implies and the contract lacks (ADR
 * 0013 §5): its attributes as props, its events, its named slots, its parts.
 * Descriptions come from the manifest where it has them and are otherwise
 * placeholders the tab marks until they are written — a contract with words
 * missing is a draft, not a lie.
 */
export function scaffoldFromLibrary(component: UidxNode, element: HeadlessElement): UidxPatch[] {
  const contract = component.spec?.contract
  const has = (kind: ContractKind, name: string): boolean => {
    switch (kind) {
      case 'prop':
        return contract?.props.some((entry) => entry.name === name) ?? false
      case 'event':
        return contract?.events.some((entry) => entry.name === name) ?? false
      case 'slot':
        return contract?.slots.some((entry) => entry.name === name) ?? false
      case 'part':
        return contract?.parts.some((entry) => entry.name === name) ?? false
      case 'state':
        return contract?.states.some((entry) => entry.name === name) ?? false
    }
  }
  const words = (member: { name: string; description?: string }, what: string): string =>
    member.description ?? `${PLACEHOLDER}the ${what} "${member.name}".`
  const out: UidxPatch[] = []
  for (const attribute of element.members.attributes) {
    if (!attribute.name || has('prop', attribute.name)) continue
    const type = contractType(attribute.type)
    out.push(
      ...declare('prop', attribute.name, {
        attrs: {
          type,
          ...(type === 'boolean' ? { default: false, visual: true } : {}),
        },
        description: words(attribute, 'prop'),
      }),
    )
  }
  for (const event of element.members.events) {
    if (!event.name || has('event', event.name)) continue
    out.push(...declare('event', event.name, { attrs: {}, description: words(event, 'event') }))
  }
  for (const slot of element.members.slots) {
    if (!slot.name || has('slot', slot.name)) continue
    out.push(...declare('slot', slot.name, { attrs: {}, description: words(slot, 'slot') }))
  }
  for (const part of element.parts) {
    if (has('part', part.name)) continue
    out.push(
      ...declare('part', part.name, {
        attrs: {},
        description: `${PLACEHOLDER}the part "${part.name}".`,
      }),
    )
  }
  return out
}
