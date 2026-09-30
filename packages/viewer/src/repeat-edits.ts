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
  /**
   * The item's name when the default `item` would hide an enclosing item:
   * `child` for `{item.children}`, `tag` for `{item.tags}`. Absent at the
   * top level, where `item` is the name and is not written.
   */
  as?: string
}

/** `children` → `child`, `tags` → `tag`, `entries` → `entry`; the last segment of the list. */
function singular(list: string): string {
  const last = list.split('.').at(-1) ?? 'item'
  if (last === 'children') return 'child'
  if (last.endsWith('ies')) return `${last.slice(0, -3)}y`
  if (last.endsWith('s') && last.length > 2) return last.slice(0, -1)
  return `${last}Item`
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
  if (!list) return null
  // Nested in another repeat (the list is an item's field), the row needs a
  // name of its own; `item` would hide the outer item's bindings.
  if (!list.includes('.')) return { node, component, list }
  const taken = new Set<string>()
  const walk = (current: UidxNode): void => {
    if (current.attrs.repeat !== undefined) {
      const as = current.attrs.as?.value
      taken.add(typeof as === 'string' && as !== '' ? as : 'item')
    }
    for (const child of current.children) walk(child)
  }
  walk(component)
  let as = singular(list)
  for (let n = 2; taken.has(as); n++) as = `${singular(list)}${n}`
  return { node, component, list, as }
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
      ...(target.as
        ? [{ op: 'add' as const, address: target.node.address, prop: 'as', value: target.as }]
        : []),
    ],
    address: target.node.address,
  }
}
