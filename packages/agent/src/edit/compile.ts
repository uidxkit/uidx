import {
  autoName,
  ELEMENTS,
  resolve,
  type JsonValue,
  type UidxDocument,
  type UidxElement,
  type UidxNodeSpec,
  type UidxPatch,
} from '@uidx/format'

import { describeNearest } from '../address.js'
import type { EditOp, NodeInput } from './ops.js'

export class CompileError extends Error {}

function nodeAt(doc: UidxDocument, address: string): ReturnType<typeof resolve> {
  const node = resolve(doc.tree, address)
  if (!node) {
    throw new CompileError(
      `no node at address ${JSON.stringify(address)}${describeNearest(doc, address)}`,
    )
  }
  return node
}

function toSpec(input: NodeInput, siblings: readonly { name: string }[]): UidxNodeSpec {
  if (!(ELEMENTS as readonly string[]).includes(input.element)) {
    throw new CompileError(`${input.element}: not a uidx element (${ELEMENTS.join(', ')})`)
  }
  const element = input.element as UidxElement
  // A `<Variant>` is named by its axis coordinates and must carry no `name`
  // (UIDX118). Auto-naming it made the element impossible to insert at all:
  // the compiler added a name and the validator rejected the document for
  // having one, so every attempt to build a component with variants — the
  // centre of any design system page — failed with an error about markup the
  // model never wrote.
  const named = element !== 'Variant'
  if (!named && input.name !== undefined) {
    throw new CompileError(
      `a <Variant> has no name of its own — it is named by the axis values it assigns, so pass those as props instead of "${input.name}"`,
    )
  }
  const name = named ? (input.name ?? autoName(element, siblings)) : undefined

  // Each nested child is auto-named against the names its earlier siblings
  // actually received, not a placeholder derived from the raw input — two
  // unnamed children of the same element must not both land on `<el>-1`.
  const children: UidxNodeSpec[] = []
  const assigned: { name: string }[] = []
  for (const child of input.children ?? []) {
    const spec = toSpec(child, assigned)
    children.push(spec)
    // A Variant contributes no name, so it cannot collide with a sibling's
    // and must not take a slot in the auto-naming sequence.
    if (typeof spec.attrs.name === 'string') assigned.push({ name: spec.attrs.name })
  }

  return {
    element,
    attrs: {
      ...(name === undefined ? {} : { name }),
      ...(input.attrs as Record<string, JsonValue> | undefined),
    },
    ...(children.length > 0 ? { children } : {}),
  }
}

/**
 * Compile intents into the document patches `@uidx/format` knows how to apply.
 *
 * Every op in `ops` is compiled against this one `doc` snapshot — including a
 * defaulted `insert_node` index, which reads `parent.children.length` as of
 * `doc`. A caller applying more than one op must re-compile against the
 * document produced by the previous op, not compile a whole batch up front.
 */
export function compileOps(doc: UidxDocument, ops: readonly EditOp[]): UidxPatch[] {
  const patches: UidxPatch[] = []

  for (const op of ops) {
    switch (op.kind) {
      case 'set_prop': {
        const node = nodeAt(doc, op.address)!
        patches.push({
          op: node.attrs[op.prop] === undefined ? 'add' : 'set',
          address: op.address,
          prop: op.prop,
          value: op.value as JsonValue,
        })
        break
      }
      case 'remove_prop': {
        nodeAt(doc, op.address)
        patches.push({ op: 'remove', address: op.address, prop: op.prop })
        break
      }
      case 'rename': {
        nodeAt(doc, op.address)
        patches.push({ op: 'set', address: op.address, prop: 'name', value: op.name })
        break
      }
      case 'insert_node': {
        const parent = nodeAt(doc, op.parent)!
        patches.push({
          op: 'insert-node',
          parent: op.parent,
          index: op.index ?? parent.children.length,
          node: toSpec(op.node, parent.children),
        })
        break
      }
      case 'remove_node': {
        nodeAt(doc, op.address)
        patches.push({ op: 'remove-node', address: op.address })
        break
      }
      case 'move_node': {
        nodeAt(doc, op.address)
        nodeAt(doc, op.newParent)
        patches.push({
          op: 'move-node',
          address: op.address,
          newParent: op.newParent,
          index: op.index,
        })
        break
      }
    }
  }

  return patches
}
