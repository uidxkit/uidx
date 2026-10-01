import { addressOf, resolve, resolveParent } from './parse.js'
import { fieldDeclarationOf, PatchError } from './patch.js'
import { contractElementAttrs, regionBody } from './region-patch.js'
import { predictDocument } from './predict.js'
import type {
  ContractDeclaration,
  ContractKind,
  JsonValue,
  UidxDocument,
  UidxNode,
  UidxNodeSpec,
  UidxPatch,
} from './types.js'

/** A node as an insert spec: attrs by value, children recursively. */
export function toNodeSpec(node: UidxNode): UidxNodeSpec {
  const attrs = Object.fromEntries(Object.entries(node.attrs).map(([k, a]) => [k, a.value]))
  return node.children.length
    ? { element: node.element, attrs, children: node.children.map(toNodeSpec) }
    : { element: node.element, attrs }
}

/**
 * The batch that undoes `patches`, computed against the document they were
 * written for (spec §5). Later ops in a batch are inverted against the
 * document as the earlier ones leave it, and the result is emitted newest
 * first, so applying it walks the edit back step by step.
 *
 * Undo in this design is a *new* write through the same channel, never a
 * rewind — which is why the answer is patches and not a source string.
 */
export function inversePatches(doc: UidxDocument, patches: readonly UidxPatch[]): UidxPatch[] {
  const out: UidxPatch[] = []
  let current = doc
  for (const patch of patches) {
    out.unshift(...invertOne(current, patch))
    current = advance(current, patch)
  }
  return out
}

function mustResolve(doc: UidxDocument, address: string): UidxNode {
  const node = resolve(doc.tree, address)
  if (!node) throw new PatchError(`no node at address ${JSON.stringify(address)}`)
  return node
}

function invertOne(doc: UidxDocument, patch: UidxPatch): UidxPatch[] {
  switch (patch.op) {
    case 'set': {
      const attr = mustResolve(doc, patch.address).attrs[patch.prop]
      if (!attr) {
        throw new PatchError(`${patch.address} has no attribute "${patch.prop}" to restore`)
      }
      return [{ op: 'set', address: patch.address, prop: patch.prop, value: attr.value }]
    }
    case 'add':
      return [{ op: 'remove', address: patch.address, prop: patch.prop }]
    case 'remove': {
      const attr = mustResolve(doc, patch.address).attrs[patch.prop]
      if (!attr) {
        throw new PatchError(`${patch.address} has no attribute "${patch.prop}" to restore`)
      }
      return [{ op: 'add', address: patch.address, prop: patch.prop, value: attr.value }]
    }
    case 'set-mode': {
      const variable = mustResolve(doc, patch.address)
      const mode = variable.children.find(
        (c) => c.element === 'Mode' && c.attrs.name?.value === patch.mode,
      )
      const value = mode?.attrs.value?.value
      if (value === undefined) {
        throw new PatchError(`${patch.address} has no mode "${patch.mode}" to restore`)
      }
      return [{ op: 'set-mode', address: patch.address, mode: patch.mode, value }]
    }
    case 'insert-node': {
      const name = patch.node.attrs.name
      if (typeof name !== 'string') {
        throw new PatchError('an insert-node without a name attribute cannot be inverted')
      }
      mustResolve(doc, patch.parent)
      return [{ op: 'remove-node', address: addressOf(patch.parent, name) }]
    }
    case 'remove-node': {
      const node = mustResolve(doc, patch.address)
      const parent = resolveParent(doc.tree, patch.address)
      if (!parent) throw new PatchError('the root cannot be removed, so there is nothing to invert')
      const index = parent.children.indexOf(node)
      return [{ op: 'insert-node', parent: parent.address, index, node: toNodeSpec(node) }]
    }
    case 'move-node': {
      const node = mustResolve(doc, patch.address)
      const parent = resolveParent(doc.tree, patch.address)
      if (!parent) throw new PatchError('the root cannot be moved, so there is nothing to invert')
      const index = parent.children.indexOf(node)
      mustResolve(doc, patch.newParent)
      return [
        {
          op: 'move-node',
          address: addressOf(patch.newParent, node.name),
          newParent: parent.address,
          index,
        },
      ]
    }
    case 'style': {
      const row = (doc.spec?.styles ?? []).find(
        (entry) =>
          Object.keys(entry.keys).length === Object.keys(patch.keys).length &&
          Object.entries(patch.keys).every(([axis, value]) => entry.keys[axis] === value),
      )
      if (patch.target === '' && patch.prop === '') {
        if (patch.value === undefined && !row)
          throw new PatchError('that style row is not in the table; nothing to restore')
        return [
          {
            op: 'style',
            keys: { ...patch.keys },
            target: '',
            prop: '',
            ...(row ? { value: structuredClone(row.values) as JsonValue } : {}),
          },
        ]
      }
      const old = row?.values[patch.target]?.[patch.prop]
      if (patch.value === undefined && old === undefined) {
        throw new PatchError(`no ${patch.target}:${patch.prop} in that style row to restore`)
      }
      return [
        {
          op: 'style',
          keys: { ...patch.keys },
          target: patch.target,
          prop: patch.prop,
          ...(old === undefined ? {} : { value: old }),
        },
      ]
    }
    case 'contract': {
      const before = declarationOf(doc, patch.kind, patch.name)
      if (!before && !patch.declaration)
        throw new PatchError(`${patch.name} is not declared; nothing to restore`)
      return [
        {
          op: 'contract',
          kind: patch.kind,
          name: patch.name,
          ...(before ? { declaration: before } : {}),
        },
      ]
    }
    case 'model': {
      const before = doc.spec?.models?.find((model) => model.name === patch.name)
      if (!before && !patch.declaration)
        throw new PatchError(`<Model name="${patch.name}"> is not declared; nothing to restore`)
      // A removal took the fields too; the inverse brings them back one by one.
      const fields: UidxPatch[] =
        before && !patch.declaration
          ? before.fields.map((field) => ({
              op: 'field',
              model: patch.name,
              name: field.name,
              declaration: fieldDeclarationOf(field),
            }))
          : []
      return [
        {
          op: 'model',
          name: patch.name,
          ...(before ? { declaration: { description: before.description } } : {}),
        },
        ...fields,
      ]
    }
    case 'region': {
      const before = regionBody(doc, patch.name)
      if (before === undefined && !patch.body)
        throw new PatchError(`there is no ## ${patch.name} to restore`)
      return [{ op: 'region', name: patch.name, ...(before ? { body: before } : {}) }]
    }
    case 'intent':
      return [{ op: 'intent', text: doc.intent.raw.trim() }]
    case 'contract-element': {
      const before = contractElementAttrs(doc, patch.element)
      if (!before && !patch.attrs) throw new PatchError(`there is no <${patch.element}> to restore`)
      return [
        {
          op: 'contract-element',
          element: patch.element,
          ...(before ? { attrs: structuredClone(before) } : {}),
        },
      ]
    }
    case 'field': {
      const model = doc.spec?.models?.find((entry) => entry.name === patch.model)
      const before = model?.fields.find((field) => field.name === patch.name)
      if (!before && !patch.declaration)
        throw new PatchError(`<Field name="${patch.name}"> is not declared; nothing to restore`)
      return [
        {
          op: 'field',
          model: patch.model,
          name: patch.name,
          ...(before ? { declaration: fieldDeclarationOf(before) } : {}),
        },
      ]
    }
    default:
      throw new PatchError(`the "${patch.op}" op cannot be inverted`)
  }
}

/** A declared contract element as the `contract` op would write it back. */
export function declarationOf(
  doc: UidxDocument,
  kind: ContractKind,
  name: string,
): ContractDeclaration | undefined {
  const contract = doc.spec?.contract
  if (!contract) return undefined
  const keep = (entries: Record<string, JsonValue | undefined>): Record<string, JsonValue> =>
    Object.fromEntries(
      Object.entries(entries).filter(
        (entry): entry is [string, JsonValue] => entry[1] !== undefined,
      ),
    )
  switch (kind) {
    case 'prop': {
      const prop = contract.props.find((entry) => entry.name === name)
      if (!prop) return undefined
      return {
        attrs: keep({
          type: prop.type,
          default: prop.default,
          sample: prop.sample,
          controllable: prop.controllable || undefined,
          visual: prop.visual || undefined,
        }),
        description: prop.description,
      }
    }
    case 'event': {
      const event = contract.events.find((entry) => entry.name === name)
      return event
        ? { attrs: keep({ detail: event.detail }), description: event.description }
        : undefined
    }
    case 'slot': {
      const slot = contract.slots.find((entry) => entry.name === name)
      return slot
        ? { attrs: keep({ accepts: slot.accepts }), description: slot.description }
        : undefined
    }
    case 'state': {
      const state = contract.states.find((entry) => entry.name === name)
      return state ? { attrs: {}, description: state.description } : undefined
    }
    case 'part': {
      const part = contract.parts.find((entry) => entry.name === name)
      return part ? { attrs: {}, description: part.description } : undefined
    }
  }
}

/** The document after `patch`, well enough for the next inversion to read. */
function advance(doc: UidxDocument, patch: UidxPatch): UidxDocument {
  switch (patch.op) {
    case 'set':
    case 'add':
    case 'remove':
    case 'set-mode':
      return predictDocument(doc, [patch])
    default:
      // A structural op moves addresses. Inverting later ops against the
      // pre-op document is right for every op that does not name what this
      // one moved, and a batch that does is one the server re-parses between.
      return doc
  }
}
