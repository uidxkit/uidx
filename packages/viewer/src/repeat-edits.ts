import { resolve, toAlias, type UidxDocument, type UidxNode, type UidxPatch } from '@uidx/format'
import { repeatOf, type ModelIndex } from '@uidx/schema'
import { enclosingComponent } from './component-prop-edits'
import { ancestorsWithin, placeableLists } from './contract-edits'

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
  if (last === 'people') return 'person'
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
  const as = itemNameFor(component, node, list)
  return as === 'item' ? { node, component, list } : { node, component, list, as }
}

/**
 * The item's name for a new repeat over `list`: `item` unless that would
 * hide something — an enclosing repeat's item (a nested list) or a prop of
 * the component, which an item component like PersonRow has under that very
 * name. Otherwise the list's singular: `tag` for `{item.tags}`, `person` for
 * `{people}`, numbered past whatever is taken.
 */
export function itemNameFor(component: UidxNode, node: UidxNode, list: string): string {
  const taken = new Set<string>((component.spec?.contract?.props ?? []).map((prop) => prop.name))
  // Only what encloses the layer is in scope there; a sibling's item hides nothing.
  for (const ancestor of ancestorsWithin(component, node)) {
    const repeat = repeatOf(ancestor)
    if (repeat) taken.add(repeat.as)
  }
  if (!list.includes('.') && !taken.has('item')) return 'item'
  const base = list.includes('.') || singular(list) !== 'item' ? singular(list) : 'entry'
  let as = base
  for (let n = 2; taken.has(as); n++) as = `${base}${n}`
  return as
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

/** `Person` → `people`, `Category` → `categories`, `Tag` → `tags`: a list prop's name for a model. */
export function pluralFor(model: string): string {
  const base = model.charAt(0).toLowerCase() + model.slice(1)
  if (base === 'person') return 'people'
  if (/[^aeiou]y$/.test(base)) return `${base.slice(0, -1)}ies`
  if (/(s|x|ch|sh)$/.test(base)) return `${base}es`
  return `${base}s`
}

/**
 * Repeat a layer for each item of a model — the one choice the designer
 * makes. The file still says which list (ADR 0017 §2), so this picks it: a
 * list of that model the layer can already reach — an enclosing item's list
 * field, then a list prop of the component — or else a new list prop of the
 * component named after the model, declared in the same edit.
 */
export function repeatOverModel(
  component: UidxNode,
  node: UidxNode,
  model: string,
  lists: readonly { list: string; type: string }[],
): UidxPatch[] {
  const wanted = `${model}[]`
  const found = lists.find((entry) => entry.type.replace(/\s+/g, '') === wanted)
  let list = found?.list
  const patches: UidxPatch[] = []
  if (!list) {
    const taken = new Set((component.spec?.contract?.props ?? []).map((prop) => prop.name))
    const base = pluralFor(model)
    list = base
    for (let n = 2; taken.has(list); n++) list = `${base}${n}`
    patches.push({
      op: 'contract',
      kind: 'prop',
      name: list,
      declaration: { attrs: { type: wanted }, description: `The ${model} items to repeat.` },
    })
  }
  const repeating = repeatOf(node) !== null
  patches.push({
    op: repeating ? 'set' : 'add',
    address: node.address,
    prop: 'repeat',
    value: toAlias(list),
  })
  if (!repeating) {
    const as = itemNameFor(component, node, list)
    if (as !== 'item') patches.push({ op: 'add', address: node.address, prop: 'as', value: as })
  }
  return patches
}
