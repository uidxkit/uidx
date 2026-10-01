import {
  aliasTarget,
  resolve,
  toAlias,
  type ContractDeclaration,
  type ContractKind,
  type JsonValue,
  type UidxDocument,
  type UidxNode,
  type UidxPatch,
} from '@uidx/format'
import {
  derivedTarget,
  modelByRef,
  repeatListType,
  repeatModel,
  repeatOf,
  sampleCount,
  type ModelIndex,
  type RepeatScope,
} from '@uidx/schema'
import { enclosingComponent } from './component-prop-edits'
import { contractType, type HeadlessElement, type HeadlessLibrary } from './headless'
export { contractType }

/**
 * What the Contract tab shows and writes (ADR 0013 §3, ADR 0017 §2).
 *
 * The tab binds the visual tree to the code render: a `<Component>` names the
 * headless element it implements, a layer names the part it draws, and any
 * layer names the list it repeats over. Three bindings — `implements`,
 * `part`, `repeat`/`as` — that the prop table deliberately does not
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
  provided: { address: string; repeat: { list: string } | null } | null
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
  /** `<Slot>`s in the tree the contract does not declare; each is one click from declared. */
  straySlots: { address: string; name: string }[]
}

/** How a layer repeats (ADR 0017 §2): the list it walks, its item's name, the canvas's rows. */
export interface RepeatBinding {
  /** The alias target: `items`, or `person.tags` inside an outer repeat. */
  list: string
  as: string
  /** Rows the canvas draws: the model's longest sample list, three when it has none. */
  rows: number
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
  /**
   * A repeat on a container holding one row: the container repeats, which is
   * rarely what was meant — the row is. Names the row so the tab can offer
   * to move the repeat onto it.
   */
  wrapsOne: { address: string; name: string } | null
}

/** What one contract prop of an instance's definition receives (ADR 0017 §2). */
export interface ReceiveRow {
  prop: string
  type: string
  /** The alias it receives — `item`, `child.owner`, `nodes` — or null for nothing. */
  from: string | null
  /** True when the use says so in `props={{…}}`; false when the tab inferred it from the repeat. */
  explicit: boolean
  /** Every alias of the right type in scope: enclosing items, their fields, the component's props. */
  options: string[]
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
  /** The component it is an instance of, when the document has it. */
  definition: UidxNode | null
  /** Its definition's contract props, each with what this use hands it. */
  receives: ReceiveRow[]
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
  const straySlots: { address: string; name: string }[] = []
  const provide = (node: UidxNode): void => {
    for (const child of node.children) {
      if (child.element === 'Slot') {
        const row = slots.find((slot) => slot.name === child.name)
        const repeat = repeatOf(child)
        if (row && !row.provided)
          row.provided = {
            address: child.address,
            repeat: repeat ? { list: repeat.list } : null,
          }
        else if (!row) straySlots.push({ address: child.address, name: child.name })
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
    straySlots,
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
export function ancestorsWithin(component: UidxNode, node: UidxNode): UidxNode[] {
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
export function enclosingRepeats(
  component: UidxNode,
  node: UidxNode,
  models?: ModelIndex,
): RepeatScope[] {
  const scopes: RepeatScope[] = []
  for (const ancestor of ancestorsWithin(component, node)) {
    const repeat = repeatOf(ancestor)
    if (repeat)
      scopes.push({ as: repeat.as, model: repeatModel(repeat, component.spec, scopes, models) })
  }
  return scopes
}

/**
 * The lists a repeat on this layer may walk (ADR 0017 §2): the list fields
 * of every enclosing item as `person.tags`, nearest first — what a tree or
 * a grouped list nests on, and the likeliest answer for a layer inside a
 * row — then the contract's list props as `items`.
 */
export function placeableLists(
  component: UidxNode | null,
  node: UidxNode,
  models?: ModelIndex,
): string[] {
  if (!component) return []
  const out: string[] = []
  for (const scope of [...enclosingRepeats(component, node, models)].reverse())
    for (const field of scope.model?.fields ?? [])
      if (field.type.trim().endsWith('[]')) out.push(`${scope.as}.${field.name}`)
  for (const prop of component.spec?.contract?.props ?? [])
    if (prop.type.trim().endsWith('[]')) out.push(prop.name)
  return out
}

export function repeatFacet(
  component: UidxNode | null,
  node: UidxNode,
  models?: ModelIndex,
): RepeatFacet {
  const lists = placeableLists(component, node, models)
  const attrs = repeatOf(node)
  if (!attrs || !component) return { repeat: null, lists, wrapsOne: null }
  const enclosing = enclosingRepeats(component, node, models)
  const model = repeatModel(attrs, component.spec, enclosing, models)
  const placed = model ? undefined : repeatListType(attrs, component.spec, enclosing, models)
  const only = node.children.length === 1 ? node.children[0]! : null
  const wrapsOne =
    node.element !== 'Slot' && only && (only.element === 'Instance' || only.element === 'Frame')
      ? { address: only.address, name: only.name }
      : null
  return {
    repeat: {
      list: attrs.list,
      as: attrs.as,
      rows: sampleCount(model),
      model: model?.name ?? (placed ? placed.slice(0, -2) : null),
      unknownModel: !model && typeof placed === 'string',
    },
    lists,
    wrapsOne,
  }
}

/* ------------------------------------------------------------ receives */

/** `Contact[]` → `Contact`, and whether it was a list. */
const typeName = (type: string): { name: string; list: boolean } => {
  const text = type.trim()
  return text.endsWith('[]')
    ? { name: text.slice(0, -2).trim(), list: true }
    : { name: text, list: false }
}

/**
 * What an instance hands each contract prop of its definition (ADR 0017 §2).
 *
 * Inside a repeat the row's item is what the instance is of, so a prop typed
 * by the item's model receives the item without anyone writing it — the same
 * rule the code target follows. The use may say otherwise in `props={{…}}`:
 * another enclosing item, a field of one, or a prop of the component. The
 * options are every alias in scope whose type matches.
 */
export function receivesFor(
  instance: UidxNode,
  definition: UidxNode | null,
  component: UidxNode | null,
  models?: ModelIndex,
): ReceiveRow[] {
  if (!definition || !component) return []
  const spec = component.spec
  const enclosing = enclosingRepeats(component, instance, models)
  // An instance that repeats is its own row: its item is the innermost.
  const own = repeatOf(instance)
  if (own) enclosing.push({ as: own.as, model: repeatModel(own, spec, enclosing, models) })
  const explicit = instance.attrs.props?.value
  const passed: Record<string, JsonValue> =
    explicit && typeof explicit === 'object' && !Array.isArray(explicit)
      ? (explicit as Record<string, JsonValue>)
      : {}
  return (definition.spec?.contract?.props ?? []).map((prop) => {
    const wanted = typeName(prop.type)
    const options: string[] = []
    // Innermost first: the nearest item is the likeliest answer.
    for (const scope of [...enclosing].reverse()) {
      if (!wanted.list && scope.model?.name === wanted.name) options.push(scope.as)
      for (const field of scope.model?.fields ?? [])
        if (field.type.trim() === prop.type.trim()) options.push(`${scope.as}.${field.name}`)
    }
    for (const own of spec?.contract?.props ?? [])
      if (own.type.trim() === prop.type.trim()) options.push(own.name)
    const written = passed[prop.name]
    const alias = typeof written === 'string' ? aliasTarget(written) : null
    if (alias !== null) {
      if (!options.includes(alias)) options.unshift(alias)
      return { prop: prop.name, type: prop.type, from: alias, explicit: true, options }
    }
    // Nothing is inferred (ADR 0017 §2): a prop gets the item only when the
    // use binds it, so an unbound prop receives nothing.
    return { prop: prop.name, type: prop.type, from: null, explicit: false, options }
  })
}

/**
 * Writes what an instance hands one prop: an alias into `props={{…}}`, or
 * nothing, which leaves the inference to stand. A `props` left empty goes.
 */
export function setReceives(instance: UidxNode, prop: string, alias: string | null): UidxPatch[] {
  const current = instance.attrs.props?.value
  const next: Record<string, JsonValue> =
    current && typeof current === 'object' && !Array.isArray(current)
      ? { ...(current as Record<string, JsonValue>) }
      : {}
  if (alias === null || alias === '') delete next[prop]
  else next[prop] = toAlias(alias)
  if (Object.keys(next).length === 0)
    return instance.attrs.props === undefined
      ? []
      : [{ op: 'remove', address: instance.address, prop: 'props' }]
  return [
    {
      op: instance.attrs.props === undefined ? 'add' : 'set',
      address: instance.address,
      prop: 'props',
      value: next,
    },
  ]
}

/**
 * The repeat moves from a container onto the one row it holds (ADR 0017 §2):
 * the row is what repeats, the container is the outer structure. The row
 * gets the list and the item name; the container gives them up, `as` first
 * so every step leaves a valid file.
 */
export function moveRepeatOnto(container: UidxNode, row: UidxNode): UidxPatch[] {
  const repeat = repeatOf(container)
  if (!repeat) return []
  const out: UidxPatch[] = [
    ...setAttr(row, 'repeat', toAlias(repeat.list)),
    ...(container.attrs.as !== undefined ? setAttr(row, 'as', repeat.as) : []),
  ]
  for (const prop of ['as', 'repeat']) out.push(...setAttr(container, prop, null))
  return out
}

/** What kind of value a field takes, for offering bindings of that kind. */
export type BindingKind = 'text' | 'number' | 'boolean'

/** Whether a declared type (`string`, `number`, `boolean`, `'a' | 'b'`) fits a field of this kind. */
function fits(type: string, kind: BindingKind): boolean {
  const text = type.trim()
  if (kind === 'boolean') return text === 'boolean'
  if (kind === 'number') return text === 'number'
  return text !== 'boolean' && !text.endsWith('[]')
}

/**
 * What a field may bind to from the layer (ADR 0015 §2): the fields of every
 * enclosing item, a model prop's fields one level deep, and the component's
 * own props — anything a `{…}` in the attribute could name, of the kind the
 * field takes. A text takes words and numbers; a checkbox takes booleans; a
 * number takes numbers. Empty outside a component.
 */
export function fieldBindingCandidates(
  component: UidxNode | null,
  node: UidxNode,
  kind: BindingKind,
  models?: ModelIndex,
): { alias: string; label: string }[] {
  if (!component) return []
  const out: { alias: string; label: string }[] = []
  const offer = (alias: string, type: string): void => {
    if (fits(type, kind)) out.push({ alias, label: bindingLabel(component, node, alias, models) })
  }
  // A repeated layer is drawn once per item, so its own item is in scope too —
  // innermost, as it is for an instance's props.
  const scopes = enclosingRepeats(component, node, models)
  const own = repeatOf(node)
  if (own) scopes.push({ as: own.as, model: repeatModel(own, component.spec, scopes, models) })
  for (const scope of [...scopes].reverse()) {
    for (const field of scope.model?.fields ?? []) {
      if (modelByRef(component.spec, typeName(field.type).name, models)) continue
      offer(`${scope.as}.${field.name}`, field.type)
    }
  }
  for (const prop of component.spec?.contract?.props ?? []) {
    const { name, list } = typeName(prop.type)
    const model = modelByRef(component.spec, name, models)
    if (!model) {
      offer(prop.name, prop.type)
      continue
    }
    // A model prop's fields, one level deep (ADR 0015 §2): `{node.label}`.
    if (list) continue
    for (const field of model.fields) {
      if (modelByRef(component.spec, typeName(field.type).name, models)) continue
      offer(`${prop.name}.${field.name}`, field.type)
    }
  }
  return out
}

/**
 * How a binding reads to a designer: the row of a repeat is "This Person",
 * its fields "This Person › name". The name the file uses for the row
 * (`item`, `{item.name}`) is code's, so it stays out of the panel. A prop of
 * the component itself reads by its own name: "person › name".
 */
export function bindingLabel(
  component: UidxNode | null,
  node: UidxNode,
  alias: string,
  models?: ModelIndex,
): string {
  const [head, ...rest] = alias.split('.')
  const scopes = component ? enclosingRepeats(component, node, models) : []
  const own = repeatOf(node)
  if (own && component)
    scopes.push({ as: own.as, model: repeatModel(own, component.spec, scopes, models) })
  return itemLabel(head!, rest, scopes)
}

/** `item`, `[name]` in scopes where `item` is a Person's row → "This Person › name". */
export function itemLabel(
  head: string,
  rest: readonly string[],
  scopes: readonly { as: string; model?: { name: string } | null }[],
): string {
  const scope = [...scopes].reverse().find((candidate) => candidate.as === head)
  const base = scope ? `This ${scope.model?.name ?? 'item'}` : head
  return [base, ...rest].join(' › ')
}

/** The text form of `fieldBindingCandidates`, kept for the Content field. */
export function textBindingCandidates(
  component: UidxNode | null,
  node: UidxNode,
  models?: ModelIndex,
): { alias: string; label: string }[] {
  return fieldBindingCandidates(component, node, 'text', models)
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
  /** Component name -> definition across every page, for what an instance receives. */
  components?: ReadonlyMap<string, UidxNode>,
): ContractView {
  if (!doc || !node) return { kind: 'page', node: null }
  if (node.element === 'Component') return componentView(node, library)
  const from = derivedTarget(doc, node.address)
  if (from) {
    // The default state draws the base tree (ADR 0016 §4): selected there, a
    // layer is the authored one, and the component's root is the component.
    if (from.isDefault) return contractView(doc, from.base, library, models, components)
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
  if (node.element === 'Instance') {
    const named = node.attrs.component?.value
    const definition = typeof named === 'string' ? (components?.get(named) ?? null) : null
    return {
      kind: 'instance',
      node,
      component,
      definition,
      receives: receivesFor(node, definition, component, models),
      ...repeatFacet(component, node, models),
    }
  }
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
 * `repeat="{list}"` on a layer (ADR 0017 §2). Clearing it takes `as` with
 * it — first, since the parser refuses `as` without a repeat to ride on and
 * every patch must leave a valid file.
 */
export function setRepeat(node: UidxNode, list: string | null): UidxPatch[] {
  const target = list?.trim().replace(/^\{|\}$/g, '') ?? ''
  if (target === '') return ['as', 'repeat'].flatMap((prop) => setAttr(node, prop, null))
  return setAttr(node, 'repeat', toAlias(target))
}

/** The item's name for the bindings below a repeat; `item` is the default and is not written. */
export function setRepeatAs(node: UidxNode, as: string | null): UidxPatch[] {
  const name = as?.trim() ?? ''
  if (name === '' || name === 'item') return setAttr(node, 'as', null)
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return []
  return setAttr(node, 'as', name)
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

/** One thing the library's element offers that the contract could declare. */
export interface LibraryOffer {
  kind: Exclude<ContractKind, 'state'>
  /** The identity's name for it: camelCase for a prop, unprefixed for an event, `default` for the unnamed slot. */
  name: string
  /** The library's name, when it is spelled differently — recorded as a binding. */
  library: string
  type?: string
  description?: string
  /** Ticked when the list opens: what a design system usually wraps. */
  suggested: boolean
}

/** Booleans that are form or focus plumbing rather than a look, so not suggested. */
const PLUMBING = new Set(['required', 'readonly', 'autofocus', 'spellcheck', 'novalidate'])

/** Events a design system usually exposes, by their unprefixed name. */
const USUAL_EVENTS = new Set(['change', 'select', 'toggle', 'close', 'open'])

const camelCase = (name: string): string =>
  name.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase())

/**
 * What the element offers and the contract lacks (ADR 0013 §5), each under
 * the identity's own name — a `help-text` attribute is the `helpText` prop, an
 * `sl-change` event the `change` event — with the library's spelling kept for
 * the binding. Ticked by default is the shape a design system's contract
 * usually takes: on/off and choice attributes, the change event, the default
 * slot and every part. Everything else is offered unticked, rather than
 * declared wholesale: a general library's element carries form plumbing and
 * focus events a component's contract does not want to promise.
 */
export function libraryOffers(component: UidxNode, element: HeadlessElement): LibraryOffer[] {
  const contract = component.spec?.contract
  const declared = (kind: LibraryOffer['kind'], ...names: string[]): boolean => {
    const list =
      kind === 'prop'
        ? contract?.props
        : kind === 'event'
          ? contract?.events
          : kind === 'slot'
            ? contract?.slots
            : contract?.parts
    return list?.some((entry) => names.includes(entry.name)) ?? false
  }
  const prefix = element.tag.includes('-') ? element.tag.slice(0, element.tag.indexOf('-') + 1) : ''
  const out: LibraryOffer[] = []
  for (const attribute of element.members.attributes) {
    if (!attribute.name) continue
    const name = camelCase(attribute.name)
    if (declared('prop', name, attribute.name)) continue
    const type = contractType(attribute.type)
    out.push({
      kind: 'prop',
      name,
      library: attribute.name,
      type,
      ...(attribute.description ? { description: attribute.description } : {}),
      suggested: (type === 'boolean' && !PLUMBING.has(name)) || type.startsWith("'"),
    })
  }
  for (const event of element.members.events) {
    if (!event.name) continue
    const bare =
      prefix && event.name.startsWith(prefix) ? event.name.slice(prefix.length) : event.name
    const name = camelCase(bare)
    if (declared('event', name, event.name)) continue
    out.push({
      kind: 'event',
      name,
      library: event.name,
      ...(event.description ? { description: event.description } : {}),
      suggested: USUAL_EVENTS.has(name),
    })
  }
  for (const slot of element.members.slots) {
    const name = slot.name || 'default'
    if (declared('slot', name)) continue
    out.push({
      kind: 'slot',
      name,
      library: slot.name,
      ...(slot.description ? { description: slot.description } : {}),
      suggested: name === 'default',
    })
  }
  for (const part of element.parts) {
    if (declared('part', part.name)) continue
    out.push({ kind: 'part', name: part.name, library: part.name, suggested: true })
  }
  return out
}

/**
 * The chosen offers as declarations, and the library names they need: a prop
 * or event the identity spells differently is bound to the library's
 * spelling in `uidx.json` (ADR 0013 §3), so generated code still sets the
 * attribute and listens for the event the element actually has.
 */
export function scaffoldOffers(chosen: readonly LibraryOffer[]): {
  patches: UidxPatch[]
  attributes: Record<string, string>
  events: Record<string, string>
} {
  const patches: UidxPatch[] = []
  const attributes: Record<string, string> = {}
  const events: Record<string, string> = {}
  for (const offer of chosen) {
    const description = offer.description ?? `${PLACEHOLDER}the ${offer.kind} "${offer.name}".`
    const attrs: Record<string, JsonValue> =
      offer.kind === 'prop'
        ? {
            type: offer.type ?? 'string',
            ...(offer.type === 'boolean' ? { default: false, visual: true } : {}),
          }
        : {}
    patches.push(...declare(offer.kind, offer.name, { attrs, description }))
    if (offer.kind === 'prop' && offer.library !== offer.name)
      attributes[offer.name] = offer.library
    if (offer.kind === 'event' && offer.library !== offer.name) events[offer.name] = offer.library
  }
  return { patches, attributes, events }
}

/**
 * Every unbound part matched to the one layer of the component named after it
 * — the `thumb` frame to the `thumb` part — when that layer binds no part yet.
 * A designer names layers after the anatomy they draw; making them bind each
 * row by hand afterwards is clicking for nothing. A part two layers could
 * claim is left alone rather than guessed.
 */
export function bindPartsByName(
  doc: UidxDocument,
  component: UidxNode,
  parts: readonly PartRow[],
): UidxPatch[] {
  const layers: UidxNode[] = []
  const walk = (node: UidxNode): void => {
    for (const child of node.children) {
      layers.push(child)
      // An instance's insides are another component's (ADR 0013 §3).
      if (child.element !== 'Instance') walk(child)
    }
  }
  walk(component)
  const bound = partBindings(component)
  const out: UidxPatch[] = []
  for (const part of parts) {
    if (part.boundTo || bound.has(part.name)) continue
    const named = layers.filter(
      (layer) => layer.name === part.name && layer.attrs.part === undefined,
    )
    if (named.length === 1) out.push(...bindPart(doc, component, part.name, named[0]!.address))
  }
  return out
}
