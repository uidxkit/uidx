import {
  componentVariants,
  defaultCombination,
  hasVariants,
  instanceProps,
  resolve,
  toSpec,
  variantName,
  type JsonValue,
  type UidxDocument,
  type UidxNode,
  type UidxPatch,
} from '@uidx/format'

/**
 * Growing and shrinking a component's set of states (story F9's managing half).
 *
 * Judgement only — the split `layer-moves.ts` and `component-prop-edits.ts`
 * keep. What is unusual here, and what shaped every operation below, is a
 * constraint the format imposes rather than a preference:
 *
 * **`applyPatches` re-parses between every op**, so each intermediate document
 * has to be valid on its own — and a `<Variant>`'s coordinates live on the
 * variant while their domain lives on the component. Any edit that has to move
 * both at once therefore has no legal ordering, because there is no op that
 * spans two nodes. Measured, not assumed: declaring an axis first reports
 * UIDX118 on every variant that has not got it yet, and writing the attribute
 * first reports UIDX118 for an axis nobody declared.
 *
 * That rules out **adding, removing or renaming an *axis*** — each needs the
 * declaration and every variant to move together. It does *not* rule out
 * renaming an axis **value**, which `renameAxisValue` gets by widening the
 * domain to hold both spellings, moving the variants across, and narrowing it
 * again — three ops, every one of them a document that parses.
 */

/** Which of a component's cells have no `<Variant>` — what "add" can offer. */
export interface EmptyCombination {
  /** The derived name, which will be the new variant's address segment. */
  name: string
  coordinates: Map<string, string>
}

/** The `<Component>` at this address, if it has states. */
function statefulAt(doc: UidxDocument, address: string): UidxNode | null {
  const node = resolve(doc.tree, address)
  return node && node.element === 'Component' && hasVariants(node) ? node : null
}

/** Every combination the axes allow, in declared order, row-major. */
function allCombinations(axes: ReadonlyMap<string, readonly string[]>): Map<string, string>[] {
  let rows: Map<string, string>[] = [new Map()]
  for (const [axis, domain] of axes) {
    rows = rows.flatMap((row) => domain.map((value) => new Map(row).set(axis, value)))
  }
  return rows
}

/**
 * The combinations this component could have and does not (F9).
 *
 * Offered rather than created, because sparseness is deliberate (ADR 0005 §2):
 * a `size=lg, state=disabled` nobody designed is a combination that does not
 * exist, not an obligation. The panel shows the gaps so filling one is a click;
 * it never fills them itself.
 */
export function emptyCombinations(component: UidxNode): EmptyCombination[] {
  const { axes } = componentVariants(component)
  if (!axes.size) return []
  const taken = new Set(component.children.map((child) => child.name))
  return allCombinations(axes)
    .map((coordinates) => ({ name: variantName(coordinates), coordinates }))
    .filter((cell) => !taken.has(cell.name))
}

/**
 * Add one combination, as a copy of the closest existing variant.
 *
 * Copied rather than born empty for the reason a `<Component>` cannot be born
 * empty either: a variant holds exactly one child, and an author adding a
 * `hover` state wants the `default` one to start from, not a blank frame they
 * have to rebuild. "Closest" is the variant sharing the most coordinates, which
 * for a second axis means a new `size=sm, state=hover` starts from the
 * `state=hover` row rather than from whatever was declared first.
 */
export function addVariant(
  doc: UidxDocument,
  address: string,
  coordinates: ReadonlyMap<string, string>,
): UidxPatch[] | null {
  const component = statefulAt(doc, address)
  if (!component) return null

  const { axes } = componentVariants(component)
  if (axes.size !== coordinates.size) return null
  for (const [axis, value] of coordinates) {
    if (!axes.get(axis)?.includes(value)) return null
  }

  // Ordered by the declaration, so the derived name is the one the parser will
  // derive too — the coordinates a caller hands in may be in any order.
  const ordered = new Map<string, string>()
  for (const axis of axes.keys()) ordered.set(axis, coordinates.get(axis)!)
  const name = variantName(ordered)
  if (component.children.some((child) => child.name === name)) return null

  const source = closestVariant(component, ordered)
  if (!source || source.children.length !== 1) return null

  return [
    {
      op: 'insert-node',
      parent: address,
      index: component.children.length,
      node: {
        element: 'Variant',
        attrs: Object.fromEntries(ordered) as Record<string, JsonValue>,
        children: [toSpec(source.children[0]!)],
      },
    },
  ]
}

/** The existing variant sharing the most coordinates with the one being added. */
function closestVariant(
  component: UidxNode,
  coordinates: ReadonlyMap<string, string>,
): UidxNode | undefined {
  let best: UidxNode | undefined
  let score = -1
  for (const child of component.children) {
    if (child.element !== 'Variant') continue
    let shared = 0
    for (const [axis, value] of coordinates) {
      if (child.attrs[axis]?.value === value) shared++
    }
    if (shared > score) {
      score = shared
      best = child
    }
  }
  return best
}

/**
 * Remove one combination.
 *
 * Two refusals, each because the resulting file would be one `uidx check`
 * rejects, and a panel that produces an invalid file is worse than one that
 * says no: the last variant would leave a component declaring states and
 * holding none (UIDX121), and the default combination is what an instance
 * saying nothing renders (UIDX120).
 *
 * The second is a refusal rather than a cascade on purpose. "Delete the default
 * state" almost always means "make a different one the default", which is
 * reordering the axis — a different edit, with a different diff, that the author
 * should be the one to choose.
 */
export function removeVariant(doc: UidxDocument, address: string): RemoveVariant {
  const node = resolve(doc.tree, address)
  if (!node || node.element !== 'Variant') return { patches: null, refusal: null }

  const component = resolve(doc.tree, address.slice(0, address.lastIndexOf('#')))
  if (!component || !hasVariants(component)) return { patches: null, refusal: null }

  if (component.children.length <= 1) {
    return {
      patches: null,
      refusal:
        'this is the only state this component has; remove its "variants" declaration to make ' +
        'it an ordinary component instead',
    }
  }
  const fallback = variantName(defaultCombination(componentVariants(component).axes))
  if (node.name === fallback) {
    return {
      patches: null,
      refusal:
        `${fallback} is the default combination — an instance that says nothing renders it. ` +
        'Reorder the axis so another value comes first, then remove this one',
    }
  }
  return { patches: [{ op: 'remove-node', address }], refusal: null }
}

export interface RemoveVariant {
  patches: UidxPatch[] | null
  /** Why not, when the answer is "no" for a reason the author can act on. */
  refusal: string | null
}

/**
 * Add a value to an axis.
 *
 * One `set` on the declaration and nothing else, which is only true because
 * combinations may be sparse: the new value has no variants yet and that is a
 * legal state, so "add a state" and "design it" are two steps rather than one
 * pretending to be one. `emptyCombinations` then offers the cells it opened.
 */
export function addAxisValue(
  doc: UidxDocument,
  address: string,
  axis: string,
  value: string,
): UidxPatch[] | null {
  const component = statefulAt(doc, address)
  if (!component) return null
  const { axes } = componentVariants(component)
  const domain = axes.get(axis)
  if (!domain || !isAxisValueFree(domain, value)) return null

  return [declarationPatch(address, axes, axis, [...domain, value])]
}

/**
 * Remove a value from an axis.
 *
 * Refused while a variant still uses it, rather than deleting those trees:
 * dropping a value silently takes designed work with it, and the author asked
 * to narrow a domain, not to throw away a state. Naming the variants makes the
 * two-step obvious.
 */
export function removeAxisValue(
  doc: UidxDocument,
  address: string,
  axis: string,
  value: string,
): RemoveVariant {
  const component = statefulAt(doc, address)
  if (!component) return { patches: null, refusal: null }
  const { axes } = componentVariants(component)
  const domain = axes.get(axis)
  if (!domain || !domain.includes(value)) return { patches: null, refusal: null }

  if (domain.length === 1) {
    return {
      patches: null,
      refusal: `"${axis}" would have no values left; remove the axis instead`,
    }
  }
  const using = component.children.filter((child) => child.attrs[axis]?.value === value)
  if (using.length) {
    return {
      patches: null,
      refusal:
        `${using.length} ${using.length === 1 ? 'state uses' : 'states use'} ` +
        `${axis}=${value} — remove ${using.map((v) => `"${v.name}"`).join(', ')} first`,
    }
  }
  return {
    patches: [
      declarationPatch(
        address,
        axes,
        axis,
        domain.filter((v) => v !== value),
      ),
    ],
    refusal: null,
  }
}

/**
 * Rename a value of an axis, carrying every variant and every instance with it.
 *
 * Three ops, and the shape is forced. The domain is widened to hold both
 * spellings, each variant is moved across, and the domain is narrowed again —
 * because `applyPatches` re-parses between ops and a variant holding a value its
 * component no longer declares is UIDX118. The widening is ordered so that some
 * variant is the default combination at every step, or the middle document
 * trips UIDX120 instead.
 *
 * A rename here *is* a rename of every address beneath the variant, because the
 * segment is derived (ADR 0005 §3). Instances are not addresses though — they
 * name a combination in their `props` — so they are carried as ordinary value
 * writes, keyed by the page they sit on.
 */
export function renameAxisValue(
  doc: UidxDocument,
  address: string,
  axis: string,
  from: string,
  to: string,
): UidxPatch[] | null {
  const component = statefulAt(doc, address)
  if (!component) return null
  const { axes } = componentVariants(component)
  const domain = axes.get(axis)
  if (!domain || !domain.includes(from) || from === to) return null
  if (!isAxisValueFree(domain, to)) return null

  const moving = component.children.filter((child) => child.attrs[axis]?.value === from)

  /*
   * The widened domain, ordered so a combination that *exists* is still the
   * default while the variants are mid-move. `from` keeps its place unless it
   * is the first value and something else can hold that spot; then the new
   * spelling goes to the front, which is where it will end up anyway.
   */
  const survivor = domain.find((value) => value !== from)
  const widened =
    domain[0] === from && survivor !== undefined && moving.length
      ? [survivor, ...domain.filter((v) => v !== survivor), to]
      : [...domain, to]

  const narrowed = domain.map((value) => (value === from ? to : value))

  return [
    declarationPatch(address, axes, axis, widened),
    ...moving.map((variant): UidxPatch => ({
      op: 'set',
      address: variant.address,
      prop: axis,
      value: to,
    })),
    declarationPatch(address, axes, axis, narrowed),
  ]
}

/**
 * The instances that name this combination, grouped by the page they sit on
 * (F9).
 *
 * Separate from `renameAxisValue` because they land in *different files*: the
 * component's page carries the declaration and the variants, and every
 * consuming page carries its own instances. C1's envelope is page-addressed, so
 * this is one envelope per page rather than one edit — which is exactly the
 * shape F7's property rename could not manage and this one can, now that the
 * shell tracks a revision per page.
 */
export function instancesNaming(
  pages: ReadonlyMap<string, UidxDocument>,
  componentName: string,
  axis: string,
  from: string,
  to: string,
): Map<string, UidxPatch[]> {
  return rewriteInstanceProps(pages, componentName, (values) => {
    if (values.get(axis) !== from) return false
    values.set(axis, to)
    return true
  })
}

/**
 * Every instance of a component, rewritten by one rule, grouped by page.
 *
 * Shared because two stories want the same walk with a different rule: F9
 * renames a variant's coordinate, F6's `renameProperty` renames a declared
 * property. Both are "find every use of this component and change one key in
 * its `props`", and two copies of that walk would disagree the first time
 * either grew.
 *
 * `rewrite` is handed a *mutable* copy of the instance's values and answers
 * whether it changed anything — which is what keeps "this instance says
 * nothing about it" from producing a no-op patch.
 */
export function rewriteInstanceProps(
  pages: ReadonlyMap<string, UidxDocument>,
  componentName: string,
  rewrite: (values: Map<string, JsonValue>) => boolean,
): Map<string, UidxPatch[]> {
  const out = new Map<string, UidxPatch[]>()
  for (const [file, page] of pages) {
    if (page.tree.element === 'Tokens') continue
    const patches: UidxPatch[] = []
    const walk = (node: UidxNode): void => {
      if (node.element === 'Instance' && node.attrs.component?.value === componentName) {
        const values = instanceProps(node).values
        if (rewrite(values)) {
          patches.push({
            op: 'set',
            address: node.address,
            prop: 'props',
            value: Object.fromEntries(values),
          })
        }
      }
      node.children.forEach(walk)
    }
    walk(page.tree)
    if (patches.length) out.set(file, patches)
  }
  return out
}

/** The whole `variants` map with one axis replaced, since it is one attribute. */
function declarationPatch(
  address: string,
  axes: ReadonlyMap<string, readonly string[]>,
  axis: string,
  domain: readonly string[],
): UidxPatch {
  const next: Record<string, JsonValue> = {}
  for (const [name, values] of axes) next[name] = name === axis ? [...domain] : [...values]
  return { op: 'set', address, prop: 'variants', value: next }
}

/** A value an axis may take: not blank, not already there, not a separator. */
export function isAxisValueFree(domain: readonly string[], value: string): boolean {
  const trimmed = value.trim()
  if (trimmed === '' || trimmed !== value) return false
  if (domain.includes(value)) return false
  return !['#', '/', '=', ','].some((c) => value.includes(c))
}
