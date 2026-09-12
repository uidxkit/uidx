import {
  componentProps,
  componentVariants,
  instanceProps,
  matchesType,
  resolve,
  type JsonValue,
  type PropertyDeclaration,
  type UidxDocument,
  type UidxNode,
  type UidxPatch,
} from '@uidx/format'

/**
 * Filling in an instance's properties (story F7).
 *
 * The consuming half, and the half an author actually spends time in. Judgement
 * only — the split `layer-moves.ts` and `component-prop-edits.ts` keep.
 *
 * Everything here writes to the *consuming* page, which is the page the author
 * has open: `props` belongs to the `<Instance>`, not to the definition. That is
 * the whole reason this mechanism was chosen over reaching inside — the
 * component's file is never touched by a use of it.
 */

/** One row of the panel: what the definition declares, and what this use says. */
export interface InstanceProp {
  name: string
  declaration: PropertyDeclaration
  /**
   * The values this row may take, when it is a variant axis (F8, ADR 0005 §4).
   *
   * An axis and a property are assigned through one `props` object and are one
   * namespace, so they are one list of rows — but an axis has a stated domain
   * and a property does not, and the row that has one gets a picker instead of
   * a text field. Undefined for an ordinary property.
   */
  domain?: readonly string[]
  /** What the instance assigns, or undefined when it says nothing. */
  value: JsonValue | undefined
  /**
   * What it resolves to either way. An unset row shows this dimmed, exactly as
   * C7 shows an unset scene property — with one difference the row has to
   * carry: this default came from the *definition*, which is something a person
   * wrote, where C7's came from the engine. Two different claims.
   */
  resolved: JsonValue
}

/**
 * The rows for this instance, in the order the definition declares them.
 *
 * Order matters and is the definition's: a component author groups related
 * properties, and re-sorting them here would throw that away. Returns an empty
 * list when the component does not resolve — `uidx check` says why, and a panel
 * inventing rows for a component it cannot find would be guessing.
 */
export function instancePropRows(
  instance: UidxNode,
  definition: UidxNode | undefined,
): InstanceProp[] {
  if (!definition) return []
  const assigned = instanceProps(instance).values
  const row = (name: string, declaration: PropertyDeclaration, domain?: readonly string[]) => {
    const value = assigned.get(name)
    const usable =
      value !== undefined &&
      matchesType(declaration.type, value) &&
      (!domain || (typeof value === 'string' && domain.includes(value)))
    return {
      name,
      declaration,
      ...(domain ? { domain } : {}),
      value: usable ? value : undefined,
      resolved: usable ? value : declaration.default,
    }
  }

  /*
   * Axes first, then properties. One list because they are one namespace
   * (ADR 0005 §2), in this order because a state is the coarser choice — which
   * button this is, before what it says — and because it is the order the
   * component's own file states them in when it has both.
   *
   * An axis is presented as a TEXT declaration whose default is its first
   * value, which is exactly what it is: the domain is what makes the control a
   * picker, and the rest of the row behaves identically. `clearInstanceProp`
   * therefore resets an axis the same way it resets a property — by removing
   * the key, so the instance follows the component's default combination.
   */
  const axes = [...componentVariants(definition).axes].map(([name, domain]) =>
    row(name, { type: 'TEXT' as const, default: domain[0] ?? '' }, domain),
  )
  const declared = [...componentProps(definition).declared].map(([name, declaration]) =>
    row(name, declaration),
  )
  return [...axes, ...declared]
}

/** The `<Instance>` at this address, or null for anything else. */
function instanceAt(doc: UidxDocument, address: string): UidxNode | null {
  const node = resolve(doc.tree, address)
  return node && node.element === 'Instance' ? node : null
}

const asValue = (values: Map<string, JsonValue>): JsonValue => Object.fromEntries(values)

/**
 * Assign one.
 *
 * The whole map is rewritten because `props` is one attribute — `add` when the
 * instance sets nothing yet, `set` when it does. Refused when the type
 * disagrees, so the panel's control decides the shape and this decides whether
 * it is allowed; both, because a hand-typed value reaches here too.
 */
export function setInstanceProp(
  doc: UidxDocument,
  address: string,
  definition: UidxNode | undefined,
  name: string,
  value: JsonValue,
): UidxPatch[] | null {
  const instance = instanceAt(doc, address)
  if (!instance || !definition) return null

  // An axis is checked against its stated domain rather than against a type
  // (ADR 0005 §2) — the whole reason the domain is declared is that there is
  // something to check a value against, which is what Figma's inferred axes
  // cannot offer.
  const domain = componentVariants(definition).axes.get(name)
  if (domain) {
    if (typeof value !== 'string' || !domain.includes(value)) return null
  } else {
    const declaration = componentProps(definition).declared.get(name)
    if (!declaration || !matchesType(declaration.type, value)) return null
  }

  const values = instanceProps(instance).values
  if (values.get(name) === value) return null
  values.set(name, value)

  return [
    instance.attrs.props === undefined
      ? { op: 'add', address, prop: 'props', value: asValue(values) }
      : { op: 'set', address, prop: 'props', value: asValue(values) },
  ]
}

/**
 * Put one back to the definition's default.
 *
 * A `remove` of the key rather than a write of the default's current value —
 * which is the difference between "this instance chooses the same thing" and
 * "this instance does not choose". Only the second follows the definition when
 * it changes, and following the definition is the point of a design system.
 * The whole attribute goes when the last key does, rather than leaving
 * `props={{}}` behind.
 */
export function clearInstanceProp(
  doc: UidxDocument,
  address: string,
  name: string,
): UidxPatch[] | null {
  const instance = instanceAt(doc, address)
  if (!instance) return null
  const values = instanceProps(instance).values
  if (!values.has(name)) return null
  values.delete(name)

  return [
    values.size === 0
      ? { op: 'remove', address, prop: 'props' }
      : { op: 'set', address, prop: 'props', value: asValue(values) },
  ]
}

/** A key the instance writes that nothing reads, and which of the two reasons. */
export interface UnusedValue {
  name: string
  /** The component dropped the property, or never had it. */
  reason: 'undeclared' | 'mistyped'
  /** What is in the file, for the sentence that names it. */
  value: JsonValue
}

/**
 * Values this instance sets that nothing consumes (F7).
 *
 * "An instance whose component has since dropped a property is holding a stale
 * value. Say so, name it, and offer to remove it — never keep quietly writing a
 * value nothing consumes." This is the naming half; `clearInstanceProp` is the
 * offer.
 *
 * A mistyped value belongs to the same sentence, and it is the one the panel
 * would otherwise *lie* about: `instancePropRows` treats it as unset, exactly
 * as the renderer does, so the row would read "nothing chosen here" while the
 * file plainly says otherwise. `uidx check` names it (UIDX406) in a file the
 * author may not have open, which is not good enough for the panel that is
 * showing them the row.
 *
 * Neither can be produced by pressing anything here — both arrive by hand.
 */
export function unusedInstanceProps(
  instance: UidxNode,
  definition: UidxNode | undefined,
): UnusedValue[] {
  if (!definition) return []
  const declared = componentProps(definition).declared
  const axes = componentVariants(definition).axes
  const out: UnusedValue[] = []
  for (const [name, value] of instanceProps(instance).values) {
    const domain = axes.get(name)
    if (domain) {
      // A value outside a stated domain is the same kind of mistake as a value
      // of the wrong type, and wants the same sentence: the row draws as unset
      // because that is what the canvas does with it, so without a word about
      // it the panel would deny a key the file plainly has.
      if (typeof value !== 'string' || !domain.includes(value)) {
        out.push({ name, reason: 'mistyped', value })
      }
      continue
    }
    const declaration = declared.get(name)
    if (!declaration) out.push({ name, reason: 'undeclared', value })
    else if (!matchesType(declaration.type, value)) out.push({ name, reason: 'mistyped', value })
  }
  return out
}
