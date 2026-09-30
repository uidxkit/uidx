import type { ContractSpec, DocumentSpec, StyleRow } from './types.js'

/**
 * What a contract says about a component's variant space (ADR 0016 §1),
 * as pure functions of the spec. Here rather than in `@uidx/schema` because
 * the server's lint and the code target need the same answers without a
 * scene: which props are axes, which names are states, and where a state
 * comes from.
 */

/** The `state` axis every component with states has (ADR 0016 §1). */
export const STATE_AXIS = 'state'
export const DEFAULT_STATE = 'default'

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

/** The states the browser produces; they need no declaration (ADR 0016 §1). */
export const INTERACTION_STATES: readonly string[] = ['hover', 'focus', 'active']

/**
 * Where a state named in a style row comes from (ADR 0016 §1): a visual
 * boolean prop the consumer sets, an interaction the browser produces, or a
 * state the element declares itself. Undefined for a name that is none of
 * them, which the audit reports.
 */
export function stateKind(
  name: string,
  contract: ContractSpec | undefined,
): 'prop' | 'interaction' | 'declared' | undefined {
  if (contract?.props.some((prop) => prop.name === name && prop.visual && prop.type === 'boolean'))
    return 'prop'
  if (INTERACTION_STATES.includes(name)) return 'interaction'
  if (contract?.states.some((state) => state.name === name)) return 'declared'
  return undefined
}

/**
 * The `state` axis, `default` first (ADR 0016 §1): the visual boolean props
 * in declaration order, then the interaction states in the order the styles
 * table first mentions them, then the states the element declares. A visual
 * boolean no row styles is still drawn, so the set shows honestly that it
 * looks like the default.
 */
export function stateAxis(
  contract: ContractSpec | undefined,
  styles: readonly StyleRow[] = [],
): string[] {
  const states: string[] = [DEFAULT_STATE]
  const add = (name: string): void => {
    if (!states.includes(name)) states.push(name)
  }
  for (const prop of contract?.props ?? [])
    if (prop.visual && prop.type === 'boolean') add(prop.name)
  for (const row of styles) {
    const named = row.keys[STATE_AXIS]
    if (named !== undefined && stateKind(named, contract) === 'interaction') add(named)
  }
  for (const state of contract?.states ?? []) add(state.name)
  return states
}

/**
 * The variant space of a component: its visual enum props and its states,
 * in declaration order with the state axis last. Empty when the contract
 * declares neither, which is also when nothing needs deriving.
 */
export function axesOf(spec: DocumentSpec | undefined): Map<string, string[]> {
  const axes = visualAxes(spec?.contract)
  const states = stateAxis(spec?.contract, spec?.styles ?? [])
  if (states.length > 1) axes.set(STATE_AXIS, states)
  return axes
}
