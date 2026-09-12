import { ENTITY_SEP, PATH_SEP, type JsonValue, type UidxNode } from './types.js'

/**
 * A component's states, declared once and assigned per variant (story F8).
 *
 * [ADR 0005](../../../docs/decisions/0005-variants.md) is the decision; this is
 * the format's half of it. Judgement only, no I/O and no parser — `parse.ts` is
 * the glue that turns a problem here into a located diagnostic, exactly as it
 * does for `component-props.ts`.
 *
 * The thing this file exists to prevent is the model it replaces: Figma keeps a
 * variant's identity in its *name* (`State=Hover, Size=Small`) and infers the
 * axes from parsing every child, so a typo silently mints an axis value and
 * there is nothing to check against. Here the domain is declared, the
 * coordinates are attributes, and the microformat survives only as a spelling
 * derived from checked values (§3).
 */

/**
 * The four characters ADR 0004 §3 and this ADR give jobs to.
 *
 * `#` bounds an entity and `/` walks inside one, so an axis carrying either
 * would break the address. `=` and `,` are the derived spelling's own
 * separators (§3), so an axis carrying either would make a variant name
 * ambiguous to `parseVariantName` — the one direction this format does not
 * control, since the SDK reads it back.
 */
export const AXIS_FORBIDDEN: readonly string[] = [ENTITY_SEP, PATH_SEP, '=', ',']

/** A declaration this file could not read, for the caller to locate. */
export interface VariantProblem {
  /** The axis at fault, or `''` when the whole declaration is. */
  axis: string
  detail: string
}

export interface ComponentVariants {
  /** Axis → its domain, in declared order. Empty when nothing is declared. */
  axes: Map<string, string[]>
  problems: VariantProblem[]
}

const isRecord = (v: unknown): v is Record<string, JsonValue> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** The character rule, as the sentence a diagnostic wants. */
function badCharacter(what: string, text: string): string | null {
  if (text === '') return `an axis ${what} may not be empty`
  const found = AXIS_FORBIDDEN.find((c) => text.includes(c))
  return found === undefined
    ? null
    : `an axis ${what} may not contain ${JSON.stringify(found)} — ` +
        `${AXIS_FORBIDDEN.map((c) => JSON.stringify(c)).join(', ')} separate an address ` +
        `from a path and an axis from its value`
}

/**
 * What a `<Component>` declares its axes to be.
 *
 * A bad entry is dropped and the rest kept, the way `componentProps` does, so a
 * panel shows what it understood rather than going blank on one typo. Through
 * `parse` that is unreachable — an error means no document — but a caller
 * holding a node directly is not going through `parse`.
 */
export function componentVariants(node: UidxNode): ComponentVariants {
  const axes = new Map<string, string[]>()
  const problems: VariantProblem[] = []
  const declared = node.attrs?.variants?.value
  if (declared === undefined) return { axes, problems }

  if (!isRecord(declared)) {
    problems.push({
      axis: '',
      detail:
        '"variants" declares each axis and the values it may take, ' +
        "e.g. { state: ['default', 'hover'] }",
    })
    return { axes, problems }
  }

  for (const [axis, domain] of Object.entries(declared)) {
    const badName = badCharacter('name', axis)
    if (badName) {
      problems.push({ axis, detail: `"${axis}": ${badName}` })
      continue
    }
    if (!Array.isArray(domain) || domain.length === 0) {
      problems.push({
        axis,
        detail: `"${axis}" must list the values it may take, e.g. ['default', 'hover']`,
      })
      continue
    }
    const values: string[] = []
    let ok = true
    for (const value of domain) {
      if (typeof value !== 'string') {
        problems.push({ axis, detail: `"${axis}": every value must be a string` })
        ok = false
        break
      }
      const badValue = badCharacter('value', value)
      if (badValue) {
        problems.push({ axis, detail: `"${axis}": ${badValue}` })
        ok = false
        break
      }
      if (values.includes(value)) {
        problems.push({ axis, detail: `"${axis}" lists ${JSON.stringify(value)} twice` })
        ok = false
        break
      }
      values.push(value)
    }
    if (ok) axes.set(axis, values)
  }
  return { axes, problems }
}

/** True when this component has states rather than one look. */
export function hasVariants(node: UidxNode): boolean {
  return node.element === 'Component' && node.attrs?.variants !== undefined
}

/**
 * The derived spelling of a set of coordinates (ADR 0005 §3).
 *
 * `state=hover, size=sm` — the SDK's own `buildVariantName`, whose format this
 * has to match exactly because the SDK reads it back. A drift test in
 * `@uidx/schema` pins the two together; that package can see both spellings and
 * this one deliberately cannot depend on the SDK at all.
 *
 * The caller passes coordinates already in *declared* axis order, which is what
 * makes this a function of the component rather than of a JS object's insertion
 * order.
 */
export function variantName(coordinates: ReadonlyMap<string, string>): string {
  return [...coordinates].map(([axis, value]) => `${axis}=${value}`).join(', ')
}

/**
 * The combination every component with variants must have (ADR 0005 §2).
 *
 * The first value of each axis. Required because an instance that says nothing
 * has to render *something*, and "the first one declared" is a choice the
 * author can see and reorder rather than a positional accident.
 */
export function defaultCombination(
  axes: ReadonlyMap<string, readonly string[]>,
): Map<string, string> {
  const out = new Map<string, string>()
  for (const [axis, domain] of axes) {
    const first = domain[0]
    if (first !== undefined) out.set(axis, first)
  }
  return out
}

export interface VariantCoordinates {
  /** Axis → value, in *declared* order regardless of how they were written. */
  coordinates: Map<string, string>
  problems: VariantProblem[]
}

/**
 * What one `<Variant>` says it is, checked against the declaration.
 *
 * Ordered by the declaration rather than by the tag, so two variants that write
 * their axes in different orders still derive the same name for the same
 * combination — and a rename is therefore never an accident of typing order.
 *
 * Every axis must be assigned. A partly-assigned variant would have to mean
 * "all the combinations matching this", which is a wildcard grammar this format
 * does not have and ADR 0005 did not ask for; sparseness is expressed by simply
 * not writing a combination.
 */
export function variantCoordinates(
  node: UidxNode,
  axes: ReadonlyMap<string, readonly string[]>,
): VariantCoordinates {
  const coordinates = new Map<string, string>()
  const problems: VariantProblem[] = []

  for (const [axis, domain] of axes) {
    const assigned = node.attrs?.[axis]?.value
    if (assigned === undefined) {
      problems.push({
        axis,
        detail:
          `<Variant> must assign every declared axis; "${axis}" is missing ` +
          `(${domain.map((v) => JSON.stringify(v)).join(' | ')})`,
      })
      continue
    }
    if (typeof assigned !== 'string' || !domain.includes(assigned)) {
      problems.push({
        axis,
        detail:
          `${JSON.stringify(assigned)} is not a value of "${axis}" ` +
          `(${domain.map((v) => JSON.stringify(v)).join(' | ')})`,
      })
      continue
    }
    coordinates.set(axis, assigned)
  }

  // Anything else on the tag. `<Variant>` is exempt from the §3.3 scene-property
  // whitelist — an axis assignment is no more an unknown property than `value`
  // on a `<Variable>` is — so without this an attribute nobody declared would be
  // spelled correctly and do nothing, which is the quietest way to be wrong.
  for (const name of Object.keys(node.attrs ?? {})) {
    if (axes.has(name)) continue
    problems.push({
      axis: name,
      detail:
        name === 'name'
          ? '<Variant> has no name of its own — it is named by its coordinates, ' +
            'so remove this attribute'
          : `"${name}" is not a declared axis of this component ` +
            `(${[...axes.keys()].join(', ')})`,
    })
  }

  return { coordinates, problems }
}
