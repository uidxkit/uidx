import {
  resolve,
  type ContractDeclaration,
  type ContractKind,
  type UidxDocument,
  type UidxNode,
  type UidxPatch,
} from '@uidx/format'
import { derivedTarget } from '@uidx/schema'
import { enclosingComponent } from './component-prop-edits'
import type { HeadlessElement, HeadlessLibrary } from './headless'

/**
 * What the Contract tab shows and writes (ADR 0013 §3, ADR 0017 §2).
 *
 * The tab binds the visual tree to the code render: a `<Component>` names the
 * headless element it implements, a layer names the part it draws, a
 * `<Repeat>` names the slot it multiplies. Three attributes — `implements`,
 * `part`, `slot`/`count` — that the prop table deliberately does not know,
 * because they are bindings to the contract rather than scene fields.
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
  repeats: boolean
  /** How the tree provides it: a `<Slot>`, a `<Repeat>` (with its count), or not yet. */
  provided: { kind: 'slot' | 'repeat'; address: string; count?: number } | null
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

export interface PartView {
  kind: 'part'
  node: UidxNode
  component: UidxNode
  partValue: string | null
  /** Every declared part; `takenBy` names the other layer holding it. */
  options: { name: string; takenBy: string | null; kind?: 'element' | 'shadow' }[]
  /** True when neither the library nor the contract declares any part. */
  undeclared: boolean
}

export interface RepeatView {
  kind: 'repeat'
  node: UidxNode
  component: UidxNode | null
  slotValue: string
  count: number
  /** The contract's repeating slots — the only legal values. */
  slotOptions: string[]
  /** The instance being multiplied, if the tree holds one. */
  child: { name: string; component: string } | null
}

export interface SlotView {
  kind: 'slot'
  node: UidxNode
  component: UidxNode | null
  declared: { repeats: boolean; accepts?: string } | null
}

export interface OtherView {
  kind: 'instance' | 'page' | 'other'
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
  ComponentView | PartView | RepeatView | SlotView | OtherView | DerivedView

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
    repeats: slot.repeats,
    provided: null,
  }))
  for (const name of element?.slots ?? []) {
    if (name !== '' && !slots.some((slot) => slot.name === name))
      slots.push({ name, repeats: false, provided: null })
  }
  const provide = (node: UidxNode): void => {
    for (const child of node.children) {
      if (child.element === 'Slot') {
        const row = slots.find((slot) => slot.name === child.name)
        if (row && !row.provided) row.provided = { kind: 'slot', address: child.address }
      } else if (child.element === 'Repeat') {
        const name = child.attrs.slot?.value
        const count = child.attrs.count?.value
        const row = slots.find((slot) => slot.name === name)
        if (row && !row.provided)
          row.provided = {
            kind: 'repeat',
            address: child.address,
            ...(typeof count === 'number' ? { count } : {}),
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

function partView(node: UidxNode, component: UidxNode, library: HeadlessLibrary | null): PartView {
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
  return { kind: 'part', node, component, partValue, options, undeclared: options.length === 0 }
}

function repeatView(node: UidxNode, component: UidxNode | null): RepeatView {
  const slot = node.attrs.slot?.value
  const count = node.attrs.count?.value
  const instance = node.children.find((child) => child.element === 'Instance')
  const named = instance?.attrs.component?.value
  return {
    kind: 'repeat',
    node,
    component,
    slotValue: typeof slot === 'string' ? slot : '',
    count: typeof count === 'number' ? count : 0,
    slotOptions: (component?.spec?.contract?.slots ?? [])
      .filter((entry) => entry.repeats)
      .map((entry) => entry.name),
    child: instance
      ? { name: instance.name, component: typeof named === 'string' ? named : '' }
      : null,
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
): ContractView {
  if (!doc || !node) return { kind: 'page', node: null }
  if (node.element === 'Component') return componentView(node, library)
  const from = derivedTarget(doc, node.address)
  if (from) {
    const state = Object.entries(from.keys)
      .map(([axis, value]) => `${axis}=${value}`)
      .join(', ')
    return { kind: 'derived', node, base: from.base, component: from.component, state }
  }
  const component = enclosingComponent(doc, node.address)
  if (node.element === 'Repeat') return repeatView(node, component)
  if (node.element === 'Slot') {
    const declared = component?.spec?.contract?.slots.find((slot) => slot.name === node.name)
    return {
      kind: 'slot',
      node,
      component,
      declared: declared
        ? { repeats: declared.repeats, ...(declared.accepts ? { accepts: declared.accepts } : {}) }
        : null,
    }
  }
  if (node.element === 'Instance') return { kind: 'instance', node }
  if (component && BINDABLE.has(node.element)) return partView(node, component, library)
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
 * The slot a `<Repeat>` multiplies. Its name is `repeat(<slot>)` (ADR 0017
 * §2), so this also moves the node's address: the caller reselects it at
 * `nextAddress`.
 */
export function setRepeatSlot(
  node: UidxNode,
  slot: string,
): { patches: UidxPatch[]; nextAddress: string } {
  const cut = Math.max(node.address.lastIndexOf('#'), node.address.lastIndexOf('/'))
  const nextAddress = `${node.address.slice(0, cut + 1)}repeat(${slot})`
  return { patches: slot ? setAttr(node, 'slot', slot) : [], nextAddress }
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

/** How many rows a `<Repeat>` draws; a non-negative integer, as the parser demands. */
export function setRepeatCount(node: UidxNode, count: number): UidxPatch[] {
  if (!Number.isInteger(count) || count < 0) return []
  return setAttr(node, 'count', count)
}
