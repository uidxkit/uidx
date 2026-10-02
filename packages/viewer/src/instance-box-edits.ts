import {
  resolve,
  type JsonValue,
  type UidxDocument,
  type UidxNode,
  type UidxPatch,
} from '@uidx/format'
import {
  INSTANCE_BOX_PROPS,
  INSTANCE_CASCADE_PROPS,
  instanceDefinition,
  instancePreview,
  instanceRole,
  propUiFor,
  type InstancePreviewUpdate,
  type PropGroup,
} from '@uidx/schema'
import type { SceneNode } from '@open-pencil/scene-graph'
import type { InstanceScope } from './resize-writes'

/**
 * Restyling an instance from outside (ADR 0018 §7): the patch a row of its
 * outer box writes, what the canvas draws while that row is still a scrub,
 * and the resets.
 *
 * Every edit is a structural patch on the `<Instance>`, never a scene write.
 * The node that draws the value is generated and has no address, and the
 * instance's own node is only the wrapper around it, so a scene write would
 * either reach nothing or paint the wrapper. The preview is drawn by the
 * build's own functions (`instancePreview`), so what a scrub shows is what
 * the patch's echo draws.
 *
 * Judgement only, the split `instance-prop-edits.ts` keeps: nothing here
 * draws or emits.
 */

/**
 * What a use may hand back to its component: its outer box, the text colour
 * it hands down and the size it states. Never where it sits or how it flows,
 * its props, its slot fills or its modes — those say which use this is and
 * where, not how it looks.
 */
export const OVERRIDE_PROPS: readonly string[] = [
  ...INSTANCE_BOX_PROPS,
  ...INSTANCE_CASCADE_PROPS,
  'width',
  'height',
]

export interface InstanceBoxEditOptions {
  /** The scope the instance is written in: the scene build's own resolvers. */
  scope: InstanceScope
  /**
   * The instance's scene id, where that is not its address. A use inside a
   * slot fill is drawn at the definition's position (ADR 0007 §3), so when
   * Panel's slot sits in a frame, the `b` written as `p#body/b` is drawn as
   * `p#frame/body/b` (`SceneResult.addresses`). The preview moves the scene's
   * nodes, so it is drawn from here; the patch still names the address.
   */
  sceneId?: string
  /** The layout of the node it sits in, as the scene draws it. */
  parentLayout?: SceneNode['layoutMode']
  /** The texts its colour reaches: its entry in `SceneResult.textTargets`, keyed by scene id too. */
  textTargets?: readonly string[]
  /**
   * The instance as the scene draws it now, when an earlier step of the same
   * gesture moved it off the file's version: that step's `next`. Each step
   * previews from the one before, so a value scrubbed back to the file's is
   * drawn back, and the props a compound control writes accrue.
   */
  drawn?: UidxNode
}

export interface InstanceBoxEdit {
  /** An `add`, `set` or `remove` on the instance; none when the file already says it. */
  patches: UidxPatch[]
  /**
   * What the canvas moves to show it, by scene id: the instance's own node,
   * the node its box lands on and the texts its colour reaches, each only
   * where something changed. Empty when nothing draws the instance.
   */
  preview: InstancePreviewUpdate[]
  /** The instance as the preview draws it, at its scene id: `drawn` for the gesture's next step. */
  next: UidxNode
}

/**
 * Sets one property of an instance's outer box, or its text colour, to
 * `value`, or takes it off for undefined so the component's shows again.
 *
 * The patch answers to the file: `add` where it states nothing, `set` where it
 * states something else, `remove` for a reset. The preview answers to the
 * scene: it names the nodes under `options.sceneId`, and starts from
 * `options.drawn` when a step before moved it.
 *
 * Null when `address` is not an instance, or `prop` is neither the outer box
 * nor the text colour: where a use sits, its size and its props each have a
 * route of their own, and the component's inside has none (ADR 0018 §1).
 */
export function instanceBoxEdit(
  doc: UidxDocument,
  address: string,
  prop: string,
  value: JsonValue | undefined,
  options: InstanceBoxEditOptions,
): InstanceBoxEdit | null {
  const instance = resolve(doc.tree, address)
  if (!instance || instance.element !== 'Instance') return null
  const role = instanceRole(prop)
  if (role !== 'box' && role !== 'cascade') return null

  // The build reads an instance's address as its scene id (`instancePreview`).
  const drawn = { ...(options.drawn ?? instance), address: options.sceneId ?? address }
  const next = stating(drawn, prop, value)
  const preview = instancePreview(
    drawn,
    next,
    instanceDefinition(instance, options.scope),
    options.scope,
    options.parentLayout,
    options.textTargets,
  )
  return { patches: written(instance, prop, value), preview: preview ?? [], next }
}

/**
 * The patches that take each of `props` off `instance`, so its component's
 * value shows again: one `remove` per prop it states, none for one it does
 * not. A row's ↺, a section's, and the Remove an attribute of the
 * component's inside offers (`EditableProp.removable`).
 */
export function resetPatches(instance: UidxNode, props: readonly string[]): UidxPatch[] {
  return props
    .filter((prop) => instance.attrs[prop] !== undefined)
    .map((prop): UidxPatch => ({ op: 'remove', address: instance.address, prop }))
}

/**
 * What a section's ↺ hands back: the overrides among its rows. Layout's are
 * the stated size and the padding; Position has none, because where a use
 * sits is not how it looks.
 */
export function sectionResetProps(group: PropGroup): string[] {
  return OVERRIDE_PROPS.filter((prop) => propUiFor(prop)?.group === group)
}

/**
 * Reset all overrides: every one `instance` states, as one list, so the shell
 * sends one envelope and one undo brings them all back.
 */
export function resetAllPatches(instance: UidxNode): UidxPatch[] {
  return resetPatches(instance, OVERRIDE_PROPS)
}

/** How many overrides `instance` states, one per attribute: the card's "3 overrides". */
export function overrideCount(instance: UidxNode): number {
  return OVERRIDE_PROPS.filter((prop) => instance.attrs[prop] !== undefined).length
}

/** The patch that leaves the file stating `value` for `prop`, or nothing when it already does. */
function written(instance: UidxNode, prop: string, value: JsonValue | undefined): UidxPatch[] {
  const address = instance.address
  const stated = instance.attrs[prop]
  if (value === undefined) return stated ? [{ op: 'remove', address, prop }] : []
  if (!stated) return [{ op: 'add', address, prop, value }]
  return sameValue(stated.value, value) ? [] : [{ op: 'set', address, prop, value }]
}

/**
 * `instance` stating `value` for `prop`, or without it for undefined: the
 * version a build would read once the patch lands. The span is collapsed onto
 * the instance's own, as the schema's synthetic attributes are, since no
 * source text holds it yet.
 */
function stating(instance: UidxNode, prop: string, value: JsonValue | undefined): UidxNode {
  const attrs = { ...instance.attrs }
  if (value === undefined) {
    delete attrs[prop]
  } else {
    const at = { start: instance.loc.start, end: instance.loc.start }
    attrs[prop] = {
      name: prop,
      value,
      raw: typeof value === 'string' ? JSON.stringify(value) : `{${JSON.stringify(value)}}`,
      loc: at,
      valueLoc: at,
    }
  }
  return { ...instance, attrs }
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const keys = Object.keys(a)
  if (keys.length !== Object.keys(b).length) return false
  return keys.every((key) =>
    sameValue((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
  )
}
