import {
  ENTITY_SEP,
  PROPERTY_FIELD,
  PROPERTY_TYPES,
  type JsonValue,
  type PropertyDeclaration,
  type PropertyType,
  type UidxNode,
} from './types.js'

/**
 * What a `<Component>` declares its consumers may change (story F6).
 *
 * The point of this over a raw override is that it is a *contract*: the
 * consumer names `label`, not `container/label`, so the component author can
 * restructure their insides freely and nothing downstream notices. That is ADR
 * 0004's thesis — names are the contract, structure is not — applied one level
 * in, and it is why `overrides` stays as the hand-written escape hatch rather
 * than the thing the editor produces.
 *
 * Keyed by name, never by the SDK's own id. Figma spells a property
 * `Label#8:0`; ADR 0004 §2 refused exactly that kind of qualifier, so the build
 * path maps name → id and the file never sees one.
 */

/** A `{name}` binding with no `#` in it. Reading it is the whole discriminator. */
export function propertyBinding(target: string): string | null {
  return target.includes(ENTITY_SEP) ? null : target
}

/**
 * Why a bare `{label}` cannot be a token, and a `{radius#md}` cannot be a
 * property: a token variable's global name *is* its address, which is always
 * `collection#name` (ADR 0004 §3). One `#`, always. So the two live in one
 * syntax without a prefix, a sigil or a second spelling — which F6 named as its
 * one real design decision, and this is the answer.
 */
export const BINDING_RULE =
  'a token reference always contains "#" (radius#md); a component property never does (label)'

export interface PropertyProblem {
  /** Which entry, for the message. Empty when the whole map is wrong. */
  name: string
  detail: string
}

/**
 * The properties a component declares, and what is wrong with the declaration.
 *
 * Returns both rather than throwing, because `uidx check` wants every problem
 * in one pass and the viewer wants whatever is well-formed so it can still
 * draw. A malformed entry is dropped from `declared` and named in `problems`.
 */
export function componentProps(node: UidxNode): {
  declared: Map<string, PropertyDeclaration>
  problems: PropertyProblem[]
} {
  const declared = new Map<string, PropertyDeclaration>()
  const problems: PropertyProblem[] = []
  const value = node.attrs.props?.value
  if (value === undefined) return { declared, problems }

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    problems.push({
      name: '',
      detail:
        "props declares a component's properties by name, e.g. { label: { type: 'TEXT', default: 'Save' } }",
    })
    return { declared, problems }
  }

  for (const [name, entry] of Object.entries(value)) {
    if (name === '' || name.includes(ENTITY_SEP)) {
      problems.push({
        name,
        detail: `a property name is a bare word — "${ENTITY_SEP}" would make "{${name}}" read as a token`,
      })
      continue
    }
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      problems.push({ name, detail: `"${name}" needs a { type, default } object` })
      continue
    }
    const { type, default: fallback } = entry as { type?: unknown; default?: unknown }
    if (!isPropertyType(type)) {
      problems.push({
        name,
        detail: `"${name}" has type ${JSON.stringify(type)}; expected one of ${PROPERTY_TYPES.join(', ')}`,
      })
      continue
    }
    if (fallback === undefined) {
      // Required, not optional: F7 shows an unset property's default dimmed,
      // and a property with nothing to fall back to has nothing to show.
      problems.push({ name, detail: `"${name}" needs a default value` })
      continue
    }
    if (!matchesType(type, fallback)) {
      problems.push({
        name,
        detail: `"${name}" is ${type}, so its default should be ${expectedShape(type)}, not ${JSON.stringify(fallback)}`,
      })
      continue
    }
    declared.set(name, { type, default: fallback as JsonValue })
  }

  return { declared, problems }
}

/**
 * The values an `<Instance>` assigns, by property name (story F7).
 *
 * Shape only — a value is a string or a boolean, because those are what the
 * three types carry. Whether the component *declares* the name, and whether the
 * type agrees, are questions about the whole document (the definition may be
 * pages away), so they live with every other cross-page question in
 * `buildSymbolTable`.
 */
export function instanceProps(node: UidxNode): {
  values: Map<string, JsonValue>
  problems: PropertyProblem[]
} {
  const values = new Map<string, JsonValue>()
  const problems: PropertyProblem[] = []
  const declared = node.attrs.props?.value
  if (declared === undefined) return { values, problems }

  if (typeof declared !== 'object' || declared === null || Array.isArray(declared)) {
    problems.push({
      name: '',
      detail: "props assigns an instance's properties by name, e.g. { label: 'Save' }",
    })
    return { values, problems }
  }

  for (const [name, value] of Object.entries(declared)) {
    if (name === '' || name.includes(ENTITY_SEP)) {
      problems.push({ name, detail: `"${name}" is not a property name` })
      continue
    }
    if (typeof value !== 'string' && typeof value !== 'boolean') {
      problems.push({
        name,
        detail: `"${name}" is ${JSON.stringify(value)}; a property value is text or true/false`,
      })
      continue
    }
    values.set(name, value)
  }
  return { values, problems }
}

export function isPropertyType(value: unknown): value is PropertyType {
  return typeof value === 'string' && (PROPERTY_TYPES as readonly string[]).includes(value)
}

/** Whether a value is what this type promises. */
export function matchesType(type: PropertyType, value: unknown): boolean {
  switch (type) {
    case 'BOOLEAN':
      // A real JSON5 boolean, not the SDK's stringified one. Converting at the
      // boundary is what every other mapping here does; two spellings of truth
      // in the authored surface is how a format starts lying.
      return typeof value === 'boolean'
    case 'TEXT':
      return typeof value === 'string'
    case 'INSTANCE_SWAP':
      // A component's global name, which is a string like any other reference.
      return typeof value === 'string' && value !== ''
  }
}

const expectedShape = (type: PropertyType): string =>
  type === 'BOOLEAN' ? 'true or false' : type === 'TEXT' ? 'a string' : "a component's name"

/**
 * Whether this property may fill this UIDX property.
 *
 * One field per type, from the SDK's own `ComponentPropertyReference.field`.
 * Checked rather than assumed because a `TEXT` property bound to `visible` is a
 * mistake that would otherwise render as a string where a boolean belongs and
 * be blamed on the renderer.
 */
export function bindingFits(type: PropertyType, prop: string): boolean {
  return PROPERTY_FIELD[type] === prop
}

export { PROPERTY_FIELD }

/** A malformed or misplaced slot, named for the message that will carry it. */
export interface SlotProblem {
  /** The slot name, or empty when the node has none to report. */
  name: string
  detail: string
}

/**
 * The slots a `<Component>` declares, keyed by name (story F5, ADR 0007 §2).
 *
 * Shaped like `componentProps` on purpose, and for its reason: `uidx check`
 * wants every problem in one pass and the viewer wants whatever is well-formed
 * so it can still draw.
 *
 * The walk stops at an `<Instance>`, whose `<Slot>` children fill *its*
 * component rather than declaring one here, and — for a component with
 * variants — collects across every `<Variant>`, since the same slot is
 * expected to appear in each of them. A name declared by several variants is
 * one slot, so the first node found wins and no problem is raised: the parser
 * already refuses a genuine duplicate within one variant (UIDX130).
 */
export function slots(component: UidxNode): {
  declared: Map<string, UidxNode>
  problems: SlotProblem[]
} {
  const declared = new Map<string, UidxNode>()
  const problems: SlotProblem[] = []
  const walk = (node: UidxNode): void => {
    for (const child of node.children) {
      if (child.element === 'Instance') continue
      if (child.element === 'Slot' && !declared.has(child.name)) declared.set(child.name, child)
      walk(child)
    }
  }
  walk(component)
  return { declared, problems }
}

/**
 * The fills an `<Instance>` authors, keyed by the slot name each one names.
 *
 * A fill is a direct child and nothing deeper: ADR 0007 §2 gives `<Instance>`
 * exactly one legal child element, so there is no tree to walk here — which is
 * the point. The consumer writes `body`, never `container/body`, so moving the
 * slot inside the definition is invisible to every page that fills it.
 */
export function slotFills(instance: UidxNode): {
  fills: Map<string, UidxNode>
  problems: SlotProblem[]
} {
  const fills = new Map<string, UidxNode>()
  const problems: SlotProblem[] = []
  for (const child of instance.children) {
    if (child.element !== 'Slot') continue
    if (fills.has(child.name)) {
      problems.push({ name: child.name, detail: `filled more than once` })
      continue
    }
    fills.set(child.name, child)
  }
  return { fills, problems }
}
