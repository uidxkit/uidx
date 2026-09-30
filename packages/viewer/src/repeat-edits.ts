import { resolve, toAlias, type UidxDocument, type UidxNode, type UidxPatch } from '@uidx/format'
import { repeatOf, type ModelIndex } from '@uidx/schema'
import { enclosingComponent } from './component-prop-edits'
import { placeableLists } from './contract-edits'

/**
 * Repeating a layer from the toolbar (ADR 0017 §2).
 *
 * Any layer inside a component may draw itself once per item of a list, so
 * the gesture is legal on one shape of selection: a single layer inside a
 * component, not repeating yet, with a list the contract can place — a list
 * prop, or a list field of an enclosing item. The tool disables itself
 * otherwise, the way the slot tool does, rather than failing on press.
 */
export interface RepeatTarget {
  node: UidxNode
  component: UidxNode
  /** The first list the layer may walk. */
  list: string
}

/** Elements that are structure rather than layers: a repeat rides on what they hold. */
const NOT_A_LAYER: ReadonlySet<string> = new Set(['Page', 'Component', 'Variant'])

export function repeatTargetFor(
  doc: UidxDocument,
  selection: readonly string[],
  models?: ModelIndex,
): RepeatTarget | null {
  if (selection.length !== 1) return null
  const address = selection[0]!
  const node = resolve(doc.tree, address)
  if (!node || NOT_A_LAYER.has(node.element) || repeatOf(node)) return null
  const component = enclosingComponent(doc, address)
  if (!component) return null
  const [list] = placeableLists(component, node, models)
  return list ? { node, component, list } : null
}

/**
 * The gesture: `repeat="{list}"` lands on the layer, and nothing else moves.
 * The rows are the model's samples; the Contract tab edits the list and the
 * item's name from the layer.
 */
export function newRepeatFor(
  doc: UidxDocument,
  selection: readonly string[],
  models?: ModelIndex,
): { patches: UidxPatch[]; address: string } | null {
  const target = repeatTargetFor(doc, selection, models)
  if (!target) return null
  return {
    patches: [
      { op: 'add', address: target.node.address, prop: 'repeat', value: toAlias(target.list) },
    ],
    address: target.node.address,
  }
}
