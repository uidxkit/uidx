import { aliasTarget, type JsonValue } from '@uidx/format'
import { optionLabelFor } from '@uidx/schema'
import { asPaints, colorToHex, paintColorAlias, type Rgba } from './paint-edit'

/**
 * The pure half of the instance-override controls (ADR 0018 §7).
 *
 * A row on a selected instance shows the component's value until the use
 * changes it. These are the words and states the controls draw that from; the
 * controls themselves take them as explicit props, so nothing here knows how
 * the pane works them out.
 */

/**
 * Where an instance row stands against its component:
 *
 * - `inherited`: the component's value shows, dimmed, and there is nothing to
 *   reset;
 * - `set`: the use states the value — a dot and ↺;
 * - `shadowed`: the use states it, but a state the instance's own props select
 *   sets it too, so the state's value shows now and the use's shows in the
 *   other states (§3).
 */
export type OverrideState = 'inherited' | 'set' | 'shadowed'

/** What an override mark says besides its state. */
export interface OverrideContext {
  /** The component the use inherits from — "Reset to Button1". */
  component: string
  /** The component's own value as the row would show it, or null when it states none. */
  inherited: string | null
  /** The state whose row wins the property right now, for `shadowed`. */
  shadowedBy: string | null
}

/**
 * A row's state from where its value comes from and which state, if any, sets
 * it. A state that sets a value the use never touched hides nothing of the
 * use's, so that row stays inherited — the section's note covers it.
 */
export function overrideState(
  origin: 'own' | 'component' | 'engine',
  shadow: { state: string } | null,
): OverrideState {
  if (origin !== 'own') return 'inherited'
  return shadow ? 'shadowed' : 'set'
}

/** The reset's tooltip: what the row goes back to, and whose value that is. */
export function resetTitle(component: string, inherited: string | null): string {
  return inherited === null ? `Reset to ${component}` : `Reset to ${component} — ${inherited}`
}

/** Why a value the use set does not show right now. */
export function shadowNote(state: string): string {
  return `The ‘${state}’ state sets this; your value shows in the other states`
}

/**
 * A value as short text for the reset's title: a number as itself, a token by
 * its address, a paint stack by its first paint.
 */
export function inheritedText(value: JsonValue): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return aliasTarget(value) ?? value
  if (typeof value !== 'object') return String(value)
  const paints = asPaints(value)
  if (!paints) return JSON.stringify(value)
  const first = paints[0]
  if (!first) return 'none'
  if (first.type !== 'SOLID') return first.type.startsWith('GRADIENT') ? 'Gradient' : first.type
  return paintColorAlias(first) ?? (first.color ? colorToHex(first.color as Rgba) : 'none')
}

/** The component's layout as `LockedLayoutRow` reads it; unset fields take the engine's defaults. */
export interface LockedLayout {
  layoutMode?: JsonValue
  itemSpacing?: JsonValue
  primaryAxisAlignItems?: JsonValue
  counterAxisAlignItems?: JsonValue
  layoutWrap?: JsonValue
  clipsContent?: JsonValue
}

/** CSS's words for the two ends of an axis, which read the same for a row and a column. */
const ALIGN_WORD: Record<string, string> = { MIN: 'start', CENTER: 'center', MAX: 'end' }

const alignWord = (prop: string, value: JsonValue | undefined): string => {
  const option = typeof value === 'string' ? value : 'MIN'
  return ALIGN_WORD[option] ?? optionLabelFor(prop, option).toLowerCase()
}

/** A gap as the panel shows it: a token by its name, as its pill does. */
const gapText = (value: JsonValue | undefined): string => {
  if (typeof value === 'string') return aliasTarget(value)?.split('#').pop() ?? value
  return String(value ?? 0)
}

/**
 * The one line an instance shows for its component's layout:
 * "Row · Gap 8 · center/center · No wrap". Wrap is a row's alone, and a
 * component that lays nothing out has no gap or alignment to speak of.
 */
export function lockedLayoutSummary(layout: LockedLayout): string {
  const mode = typeof layout.layoutMode === 'string' ? layout.layoutMode : 'NONE'
  const parts = [optionLabelFor('layoutMode', mode)]
  if (mode !== 'NONE') {
    parts.push(`Gap ${gapText(layout.itemSpacing)}`)
    if (mode !== 'GRID') {
      parts.push(
        `${alignWord('primaryAxisAlignItems', layout.primaryAxisAlignItems)}/` +
          alignWord('counterAxisAlignItems', layout.counterAxisAlignItems),
      )
    }
    if (mode === 'HORIZONTAL') {
      const wrap = typeof layout.layoutWrap === 'string' ? layout.layoutWrap : 'NO_WRAP'
      parts.push(optionLabelFor('layoutWrap', wrap))
    }
  }
  if (layout.clipsContent === true) parts.push('Clips content')
  return parts.join(' · ')
}
