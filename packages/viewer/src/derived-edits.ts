import type { UidxDocument, UidxPatch } from '@uidx/format'
import { derivedTarget, type DerivedTarget } from '@uidx/schema'

/**
 * Where an edit to a derived variant goes (ADR 0016 §4).
 *
 * The canvas draws every state of a component from its styles table, and an
 * author designs a state the Figma way: select the hover variant, change the
 * stroke. The node they changed has no source span, so the patch the panel
 * wrote — `set` on `Checkbox#state=hover/root` — cannot land as written. It
 * lands as a cell of the `state="hover"` row instead; on the default
 * combination it lands on the base tree, since that is what the default
 * draws. Structural edits have nowhere to go and are refused with a reason.
 *
 * Pure, like every edit helper here: patches in, patches or a refusal out.
 */

/**
 * Properties a state may not change: where a variant sits is the arrangement's,
 * and what a layer is named or binds is the base tree's. Rotation is a look —
 * a chevron turns when a row opens, and the CSS target renders it as a
 * transform — so a state may set it.
 */
const NOT_A_STYLE: ReadonlySet<string> = new Set(['x', 'y', 'name', 'part'])

export type Routed = { patches: UidxPatch[] } | { refused: string }

export function routeDerivedPatches(doc: UidxDocument, patches: readonly UidxPatch[]): Routed {
  const out: UidxPatch[] = []
  for (const patch of patches) {
    const at = addressOf(patch)
    const target = at === null ? null : derivedTarget(doc, at)
    if (!target) {
      out.push(patch)
      continue
    }
    const where = describe(target)
    switch (patch.op) {
      case 'set':
      case 'add':
      case 'remove': {
        if (target.isDefault) {
          out.push({ ...patch, address: target.base.address })
          break
        }
        if (NOT_A_STYLE.has(patch.prop) && target.target === 'root') {
          return {
            refused: `${where} draws where its base draws; move or rename the base instead`,
          }
        }
        if (NOT_A_STYLE.has(patch.prop)) {
          return { refused: `"${patch.prop}" is not a look; change it on the base layer` }
        }
        out.push({
          op: 'style',
          keys: { ...target.keys },
          target: target.target,
          prop: patch.prop,
          ...(patch.op === 'remove' ? {} : { value: patch.value }),
        })
        break
      }
      default:
        return {
          refused: `${where} is drawn from the base tree; add, remove or move layers on the base`,
        }
    }
  }
  return { patches: out }
}

/** `state=hover of Checkbox`, for a notice or a chip. */
export function describe(target: DerivedTarget): string {
  const at = Object.entries(target.keys)
    .map(([axis, value]) => `${axis}=${value}`)
    .join(', ')
  return `${at} of ${target.component.name}`
}

function addressOf(patch: UidxPatch): string | null {
  switch (patch.op) {
    case 'insert-node':
      return patch.parent
    case 'style':
    case 'contract':
    case 'model':
    case 'field':
      return null
    default:
      return patch.address
  }
}
