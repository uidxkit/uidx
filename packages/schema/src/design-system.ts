import {
  addressOf,
  aliasTarget,
  defaultCombination,
  hasVariants,
  METADATA_ATTRS,
  variantName,
  type ContractSpec,
  type DocumentSpec,
  type FieldSpec,
  type JsonValue,
  type ModelSpec,
  type PropSpec,
  type StyleRow,
  type UidxAttr,
  type UidxDocument,
  type UidxNode,
} from '@uidx/format'

/**
 * The design-system model on the scene side (ADRs 0012–0017).
 *
 * Three jobs, all pure functions of a parsed document:
 *
 * - `specBindings`: what `{label}` and `{item.name}` resolve to inside a
 *   component — a contract prop's default, or a model field's sample.
 * - `deriveVariants`: the styles table expanded into the full `<Variant>`
 *   trees ADR 0005's canvas and Figma export already understand.
 * - `derivedDocument`: the same, for every component of a document, so the
 *   builder and the reconciler see one tree.
 *
 * Nothing here reaches the file. Derived nodes are `synthetic`, the bimap
 * never links them, and a gesture on one produces no patch (ADR 0016 §4).
 */

/** The `state` axis every component with declared states has (ADR 0016 §1). */
export const STATE_AXIS = 'state'
export const DEFAULT_STATE = 'default'
/** The styles-table name for the component's own frame (ADR 0016 §2). */
export const ROOT_PART = 'root'

/* --------------------------------------------------------------- models */

/** `{models#Contact}` → the model named `Contact` in `spec`, or undefined. */
export function modelByRef(
  spec: DocumentSpec | undefined,
  ref: string | undefined,
): ModelSpec | undefined {
  if (!spec?.models || ref === undefined) return undefined
  const target = aliasTarget(ref) ?? ref
  const name = target.includes('#') ? target.slice(target.indexOf('#') + 1) : target
  return spec.models.find((model) => model.name === name)
}

/**
 * The n-th sample of a field: a list gives varied rows (wrapping, so a repeat
 * longer than the list still draws), a single value repeats, and an absent
 * optional field is the empty string — a bound text collapses rather than
 * warning (ADR 0015 §2).
 */
export function sampleAt(field: FieldSpec, index: number): JsonValue | undefined {
  const sample = field.sample
  if (sample === undefined) return undefined
  if (Array.isArray(sample)) {
    if (sample.length === 0) return undefined
    const value = sample[index % sample.length]
    return value === null ? '' : (value as JsonValue)
  }
  return sample
}

/**
 * What a component's own subtree resolves bare names to, from its contract:
 * `{label}` is a prop's default; `{item.name}` is the n-th sample of a model
 * field; `{item.address.city}` reaches one model deeper (ADR 0015 §2).
 */
export function specBindings(
  spec: DocumentSpec | undefined,
  sampleIndex = 0,
): Map<string, JsonValue> {
  const out = new Map<string, JsonValue>()
  if (!spec?.contract) return out
  const bindModel = (prefix: string, model: ModelSpec, depth: number): void => {
    for (const field of model.fields) {
      const nested = modelByRef(spec, field.type)
      if (nested && depth < 2) {
        bindModel(`${prefix}.${field.name}`, nested, depth + 1)
        continue
      }
      const value = sampleAt(field, sampleIndex)
      if (value !== undefined) out.set(`${prefix}.${field.name}`, value)
    }
  }
  for (const prop of spec.contract.props) {
    const model = modelByRef(spec, prop.model)
    if (model) bindModel(prop.name, model, 0)
    else if (prop.default !== undefined) out.set(prop.name, prop.default)
  }
  return out
}

/* ------------------------------------------------------------------ axes */

/** `'a' | 'b'` → `['a', 'b']`; anything else is not an enum. */
export function enumValues(type: string | undefined): string[] | null {
  if (!type) return null
  const parts = type.split('|').map((part) => part.trim())
  const values: string[] = []
  for (const part of parts) {
    const match = /^'([^']*)'$|^"([^"]*)"$/.exec(part)
    if (!match) return null
    values.push(match[1] ?? match[2] ?? '')
  }
  return values.length ? values : null
}

/** The visual enum props of a contract, each with its values, default first. */
export function visualAxes(contract: ContractSpec | undefined): Map<string, string[]> {
  const axes = new Map<string, string[]>()
  for (const prop of contract?.props ?? []) {
    if (!prop.visual) continue
    const values = enumValues(prop.type)
    if (!values) continue
    const fallback = typeof prop.default === 'string' ? prop.default : undefined
    axes.set(
      prop.name,
      fallback && values.includes(fallback)
        ? [fallback, ...values.filter((value) => value !== fallback)]
        : values,
    )
  }
  return axes
}

/** Every state the contract declares, `default` first (ADR 0016 §1). */
export function stateAxis(contract: ContractSpec | undefined): string[] {
  const states = [
    ...(contract?.states.structural ?? []),
    ...(contract?.states.styling ?? []),
  ].filter((state) => state !== DEFAULT_STATE)
  return [DEFAULT_STATE, ...states]
}

/**
 * The variant space of a component: its visual enum props and its states,
 * in declaration order with the state axis last. Empty when the contract
 * declares neither, which is also when nothing needs deriving.
 */
export function axesOf(spec: DocumentSpec | undefined): Map<string, string[]> {
  const axes = visualAxes(spec?.contract)
  const states = stateAxis(spec?.contract)
  if (states.length > 1) axes.set(STATE_AXIS, states)
  return axes
}

function combinations(axes: ReadonlyMap<string, readonly string[]>): Map<string, string>[] {
  let out: Map<string, string>[] = [new Map()]
  for (const [axis, values] of axes) {
    const next: Map<string, string>[] = []
    for (const partial of out)
      for (const value of values) next.push(new Map([...partial, [axis, value]]))
    out = next
  }
  return out
}

/* --------------------------------------------------------- derivation */

function synthAttr(
  name: string,
  value: JsonValue,
  at: UidxAttr | { loc: { start: number; end: number } },
): UidxAttr {
  const loc = 'valueLoc' in at ? at.loc : { start: at.loc.start, end: at.loc.start }
  return {
    name,
    value,
    raw: typeof value === 'string' ? JSON.stringify(value) : `{${JSON.stringify(value)}}`,
    loc,
    valueLoc: { start: loc.start, end: loc.start },
  }
}

/** A deep copy of `node` re-addressed under `address`, marked synthetic. */
function rebase(node: UidxNode, address: string): UidxNode {
  return {
    ...node,
    address,
    attrs: { ...node.attrs },
    synthetic: true,
    children: node.children.map((child) => rebase(child, addressOf(address, child.name))),
  }
}

/** Rows that apply to a combination, least specific first, file order within. */
function rowsFor(rows: readonly StyleRow[], combination: ReadonlyMap<string, string>): StyleRow[] {
  return rows
    .map((row, order) => ({ row, order }))
    .filter(({ row }) =>
      Object.entries(row.keys).every(([axis, value]) => combination.get(axis) === value),
    )
    .sort(
      (a, b) =>
        Object.keys(a.row.keys).length - Object.keys(b.row.keys).length || a.order - b.order,
    )
    .map(({ row }) => row)
}

/** The node bound to `part` inside `tree`, or undefined. */
export function partNode(tree: UidxNode, part: string): UidxNode | undefined {
  if (tree.attrs.part?.value === part) return tree
  for (const child of tree.children) {
    const found = partNode(child, part)
    if (found) return found
  }
  return undefined
}

/** The first node named `name` inside `tree` (not the tree itself), or undefined. */
export function nodeNamed(tree: UidxNode, name: string): UidxNode | undefined {
  for (const child of tree.children) {
    if (child.name === name) return child
    const found = nodeNamed(child, name)
    if (found) return found
  }
  return undefined
}

/**
 * What a styles-table target names (ADR 0016 §2): the component's own
 * frame, a declared part, or — for the design's own nodes, which have no
 * headless element — a node by its name.
 */
export function styleTarget(tree: UidxNode, target: string): UidxNode | undefined {
  return partNode(tree, target) ?? nodeNamed(tree, target)
}

/** Whether a component's variants are derived from its styles table. */
export function derivesVariants(component: UidxNode): boolean {
  return (
    component.element === 'Component' &&
    !hasVariants(component) &&
    (component.spec?.styles?.length ?? 0) > 0 &&
    axesOf(component.spec).size > 0
  )
}

/**
 * The styles table expanded into ADR 0005's shape: `variants` declaring the
 * axes and one `<Variant>` tree per combination, each holding a `root`
 * frame that carries the component's own attributes with the matching rows
 * applied, and the component's children beneath it.
 *
 * Pure. The result is a new node; the authored one is untouched, which is
 * what keeps the file the source of truth (ADR 0016 §4).
 */
export function deriveVariants(component: UidxNode): UidxNode {
  if (!derivesVariants(component)) return component
  const spec = component.spec!
  const axes = axesOf(spec)
  const rows = spec.styles ?? []

  const ownAttrs: Record<string, UidxAttr> = {}
  for (const [name, attr] of Object.entries(component.attrs)) {
    if (name === 'name' || name === 'implements' || name === 'props' || METADATA_ATTRS.has(name))
      continue
    ownAttrs[name] = attr
  }

  const variants: UidxNode[] = []
  for (const combination of combinations(axes)) {
    const name = variantName(combination)
    const variantAddress = addressOf(component.address, name)
    const rootAddress = addressOf(variantAddress, ROOT_PART)
    const root: UidxNode = {
      element: 'Frame',
      name: ROOT_PART,
      address: rootAddress,
      attrs: { ...ownAttrs, name: synthAttr('name', ROOT_PART, component) },
      children: component.children.map((child) =>
        rebase(child, addressOf(rootAddress, child.name)),
      ),
      loc: component.loc,
      openTagLoc: component.openTagLoc,
      selfClosing: false,
      indent: component.indent,
      synthetic: true,
    }
    for (const row of rowsFor(rows, combination)) {
      for (const [part, props] of Object.entries(row.values)) {
        const target = part === ROOT_PART ? root : styleTarget(root, part)
        if (!target) continue
        for (const [prop, value] of Object.entries(props)) {
          target.attrs[prop] = synthAttr(prop, value, target.attrs[prop] ?? component)
        }
      }
    }
    const coordinates: Record<string, UidxAttr> = {}
    for (const [axis, value] of combination) coordinates[axis] = synthAttr(axis, value, component)
    variants.push({
      element: 'Variant',
      name,
      address: variantAddress,
      attrs: coordinates,
      children: [root],
      loc: component.loc,
      openTagLoc: component.openTagLoc,
      selfClosing: false,
      indent: component.indent,
      synthetic: true,
    })
  }

  const declaration: JsonValue = Object.fromEntries(
    [...axes].map(([axis, values]) => [axis, values]),
  )
  return {
    ...component,
    attrs: { ...component.attrs, variants: synthAttr('variants', declaration, component) },
    children: variants,
  }
}

const derived = new WeakMap<UidxDocument, UidxDocument>()

/**
 * The document with every derivable component expanded, memoised per
 * document object. The identity when nothing derives, so callers that
 * compare documents by reference are unaffected.
 */
export function derivedDocument(doc: UidxDocument): UidxDocument {
  const cached = derived.get(doc)
  if (cached) return cached
  const needs = doc.tree.children.some(derivesVariants)
  const result = needs
    ? { ...doc, tree: { ...doc.tree, children: doc.tree.children.map(deriveVariants) } }
    : doc
  derived.set(doc, result)
  return result
}

/** The default combination of a derived or authored component, as a name. */
export function defaultVariantName(component: UidxNode): string | undefined {
  if (!derivesVariants(component)) return undefined
  return variantName(defaultCombination(axesOf(component.spec)))
}

/** A prop of the contract by name. */
export function propSpec(spec: DocumentSpec | undefined, name: string): PropSpec | undefined {
  return spec?.contract?.props.find((prop) => prop.name === name)
}

/* ---------------------------------------------------------- contract JSON */

/** A value with every `loc` removed, recursively — the shape a generator reads. */
function withoutLocs(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutLocs)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value)) {
      if (key === 'loc') continue
      out[key] = withoutLocs(entry)
    }
    return out
  }
  return value
}

/**
 * The document's spec regions as plain data, source spans dropped, plus the
 * facts a generator needs from the tree: each component's name, the headless
 * root it implements, and the parts and slots its tree binds. This is what
 * `uidx contract` prints (ADR 0017 §3), so a generator never parses MDX.
 */
export function contractJson(doc: UidxDocument): Record<string, unknown> {
  const components = doc.tree.children
    .filter((node) => node.element === 'Component')
    .map((component) => {
      const parts: string[] = []
      const slots: string[] = []
      const walk = (node: UidxNode): void => {
        if (typeof node.attrs.part?.value === 'string') parts.push(node.attrs.part.value)
        if (node.element === 'Slot') slots.push(node.name)
        for (const child of node.children) walk(child)
      }
      for (const child of component.children) walk(child)
      return {
        name: component.name,
        implements: component.attrs.implements?.value ?? null,
        status: component.attrs.status?.value ?? null,
        boundParts: parts,
        treeSlots: slots,
        axes: Object.fromEntries(axesOf(component.spec)),
      }
    })
  return {
    id: doc.frontmatter.id ?? null,
    components,
    ...(withoutLocs(doc.spec ?? {}) as Record<string, unknown>),
  }
}
