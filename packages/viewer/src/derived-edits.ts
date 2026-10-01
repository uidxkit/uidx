import type { JsonValue, UidxDocument, UidxNode, UidxPatch } from '@uidx/format'
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
        // A value the base already has — or an emptied paint list where the
        // base sets none — is the state letting go of the look, not a look
        // of its own: the cell goes rather than restating the base (removing
        // a stroke a state added used to write `strokes={[]}` and a weight).
        const base = target.base.attrs[patch.prop]?.value
        const reverts =
          patch.op === 'remove' ||
          equalValues(patch.value, base) ||
          (base === undefined && isNoPaint(patch.prop, patch.value)) ||
          (base === undefined && STROKE_WEIGHTS.has(patch.prop) && clearsStrokes(patches, at!))
        if (!reverts) {
          out.push({
            op: 'style',
            keys: { ...target.keys },
            target: target.target,
            prop: patch.prop,
            value: patch.value,
          })
          break
        }
        out.push(...clearCell(doc, target, patch.prop, out))
        // Strokes gone, their weights are inert cells: they go with them,
        // unless this batch is setting them again.
        if (
          patch.op !== 'remove' &&
          patch.prop === 'strokes' &&
          isNoPaint('strokes', patch.value)
        ) {
          for (const weight of STROKE_WEIGHTS) {
            const setHere = patches.some(
              (p) => (p.op === 'set' || p.op === 'add') && p.address === at && p.prop === weight,
            )
            if (!setHere) out.push(...clearCell(doc, target, weight, out))
          }
        }
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

const STROKE_WEIGHTS: ReadonlySet<string> = new Set([
  'strokeWeight',
  'strokeTopWeight',
  'strokeRightWeight',
  'strokeBottomWeight',
  'strokeLeftWeight',
])

const equalValues = (a: JsonValue | undefined, b: JsonValue | undefined): boolean =>
  JSON.stringify(a) === JSON.stringify(b)

const isNoPaint = (prop: string, value: JsonValue | undefined): boolean =>
  (prop === 'fills' || prop === 'strokes') && Array.isArray(value) && value.length === 0

/** Whether this batch empties the strokes of the node at `at`, so its weights go with them. */
function clearsStrokes(patches: readonly UidxPatch[], at: string): boolean {
  return patches.some(
    (p) =>
      (p.op === 'set' || p.op === 'add') &&
      p.address === at &&
      p.prop === 'strokes' &&
      isNoPaint('strokes', p.value),
  )
}

/**
 * Clearing one cell of a state's row, when it has that cell. The format drops
 * a row its last cell leaves; a state is turned on by its row, so an emptied
 * row is written back empty in the same batch — letting go of the last look
 * a state had must not turn the state off.
 */
function clearCell(
  doc: UidxDocument,
  target: DerivedTarget,
  prop: string,
  pending: readonly UidxPatch[],
): UidxPatch[] {
  const row = doc.spec?.styles?.find((entry) =>
    equalValues(sortKeys(entry.keys), sortKeys(target.keys)),
  )
  const cells = row?.values[target.target]
  if (!row || !cells || !(prop in cells)) return []
  const keys = { ...target.keys }
  const cleared = pending.filter(
    (p) =>
      p.op === 'style' && p.value === undefined && equalValues(sortKeys(p.keys), sortKeys(keys)),
  ).length
  const total = Object.values(row.values).reduce((n, values) => n + Object.keys(values).length, 0)
  const clear: UidxPatch = { op: 'style', keys, target: target.target, prop }
  return cleared + 1 === total
    ? [clear, { op: 'style', keys, target: '', prop: '', value: {} }]
    : [clear]
}

const sortKeys = (keys: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.entries(keys).sort(([a], [b]) => a.localeCompare(b)))

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
    case 'region':
    case 'intent':
    case 'contract-element':
      return null
    default:
      return patch.address
  }
}

/**
 * A derived variant's node as the panel should treat it: its base layer, with
 * what the state's row sets for it laid over, answering to the variant's
 * address. The edit helpers that read the node before writing (a stroke's
 * weight, a length's unit) need one, and a twin has none in the file; the
 * patches they produce at this address are routed to the row like any other.
 */
export function drawnNode(doc: UidxDocument, address: string): UidxNode | null {
  const target = derivedTarget(doc, address)
  if (!target) return null
  const row = doc.spec?.styles?.find((entry) =>
    equalValues(sortKeys(entry.keys), sortKeys(target.keys)),
  )
  const cells = target.isDefault ? {} : (row?.values[target.target] ?? {})
  const attrs = { ...target.base.attrs }
  for (const [prop, value] of Object.entries(cells))
    attrs[prop] = { name: prop, value, raw: '', loc: target.base.loc, valueLoc: target.base.loc }
  return { ...target.base, address, attrs }
}
