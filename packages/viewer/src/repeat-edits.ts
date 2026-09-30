import {
  addressOf,
  resolve,
  resolveParent,
  toNodeSpec,
  type UidxDocument,
  type UidxNode,
  type UidxPatch,
} from '@uidx/format'
import { enclosingComponent } from './component-prop-edits'

/**
 * Wrapping an instance in a `<Repeat>` from the toolbar (ADR 0017 §2).
 *
 * A repeat multiplies one instance on a repeating slot of the contract, so
 * the gesture is legal on exactly one shape of selection: a single
 * `<Instance>` inside a component whose contract declares a repeating slot
 * no `<Repeat>` provides yet. The tool disables itself otherwise, the way the
 * slot tool does, rather than failing on press.
 */
export interface RepeatTarget {
  instance: UidxNode
  component: UidxNode
  /** The first repeating slot the tree does not provide yet. */
  slot: string
}

export function repeatTargetFor(
  doc: UidxDocument,
  selection: readonly string[],
): RepeatTarget | null {
  if (selection.length !== 1) return null
  const address = selection[0]!
  const instance = resolve(doc.tree, address)
  if (!instance || instance.element !== 'Instance') return null
  const parent = resolveParent(doc.tree, address)
  if (!parent || parent.element === 'Repeat') return null
  const component = enclosingComponent(doc, address)
  if (!component) return null
  const provided = new Set<string>()
  const walk = (node: UidxNode): void => {
    for (const child of node.children) {
      if (child.element === 'Repeat' && typeof child.attrs.slot?.value === 'string')
        provided.add(child.attrs.slot.value)
      if (child.element !== 'Instance') walk(child)
    }
  }
  walk(component)
  const slot = component.spec?.contract?.slots.find(
    (entry) => entry.repeats && !provided.has(entry.name),
  )
  if (!slot) return null
  return { instance, component, slot: slot.name }
}

/**
 * The gesture: the instance leaves its place and comes back inside a
 * `<Repeat>` at the same index.
 *
 * Two ops rather than an insert and a move, because `applyPatches` re-parses
 * between ops and a `<Repeat>` with no child is not a document (UIDX145).
 * Removing first and inserting the wrapper with the instance already inside
 * leaves a valid file after each step. The repeat's own name is derived from
 * its slot (ADR 0017 §2), which is why it is selected by that address.
 */
export function newRepeatFor(
  doc: UidxDocument,
  selection: readonly string[],
  count = 3,
): { patches: UidxPatch[]; address: string } | null {
  const target = repeatTargetFor(doc, selection)
  if (!target) return null
  const parent = resolveParent(doc.tree, target.instance.address)
  if (!parent) return null
  const index = parent.children.indexOf(target.instance)
  return {
    patches: [
      { op: 'remove-node', address: target.instance.address },
      {
        op: 'insert-node',
        parent: parent.address,
        index,
        node: {
          element: 'Repeat',
          attrs: { slot: target.slot, count },
          children: [toNodeSpec(target.instance)],
        },
      },
    ],
    address: addressOf(parent.address, `repeat(${target.slot})`),
  }
}
