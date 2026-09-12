import { isUnitLength, lengthToPx, rootFontSizeOf } from '@uidx/format'
import { SceneGraph, type Variable, type VariableValue } from '@open-pencil/scene-graph'
import { buildTokenIndex } from './token-index.js'
import { defaultTuple, TokenResolver } from './resolve-modes.js'
import {
  aliasTarget,
  variableTypeOf,
  type JsonValue,
  type UidxDocument,
  type UidxNode,
} from '@uidx/format'

export interface TokenResult {
  /** Address (`collection#variable`) -> the variable created for it. */
  byAddress: Map<string, Variable>
  /** Aliases that pointed at nothing in this document, by address. */
  unresolved: string[]
}

/**
 * Registers a `<Tokens>` document's collections and variables on a scene graph.
 *
 * Variables live beside the node tree rather than in it, which is why this is
 * separate from `toSceneGraph` rather than a branch inside it. Spike S4
 * established that collections and their variables survive a `.fig` round-trip,
 * so this is the shape export already understands — no translation layer.
 *
 * Aliases are resolved in a second pass. A variable may reference another
 * variable (Figma's `{ aliasId }`), and a semantic token pointing at a primitive
 * is the whole reason a token system has two layers — so forward references have
 * to work regardless of declaration order.
 */
export function applyTokens(graph: SceneGraph, doc: UidxDocument): TokenResult {
  if (doc.tree.element !== 'Tokens') {
    throw new Error(`applyTokens expects a <Tokens> document, got <${doc.tree.element}>`)
  }

  const byAddress = new Map<string, Variable>()
  const pending: { variable: Variable; target: string }[] = []

  for (const collectionNode of doc.tree.children) {
    const collection = graph.createCollection(collectionNode.name)

    for (const variableNode of collectionNode.children) {
      const value = variableNode.attrs.value?.value
      if (value === undefined) continue

      const target = aliasTarget(value)
      // An alias has no type of its own, so it is created as a placeholder and
      // retyped once its target is known.
      const type =
        target === null
          ? ((variableNode.attrs.type?.value as ReturnType<typeof variableTypeOf>) ??
            variableTypeOf(value))
          : null
      const variable = graph.createVariable(
        variableNode.name,
        type ?? 'FLOAT',
        collection.id,
        target === null
          ? type === 'FLOAT' && isUnitLength(value)
            ? lengthToPx(value, rootFontSizeOf(doc))!
            : (value as VariableValue)
          : 0,
      )

      byAddress.set(variableNode.address, variable)
      if (target !== null) pending.push({ variable, target })
    }
  }

  const unresolved: string[] = []
  for (const { variable, target } of pending) {
    const referenced = byAddress.get(target)
    if (!referenced) {
      unresolved.push(target)
      continue
    }
    variable.type = referenced.type
    for (const mode of Object.keys(variable.valuesByMode)) {
      variable.valuesByMode[mode] = { aliasId: referenced.id }
    }
  }

  return { byAddress, unresolved }
}

/** Every variable a token document declares, addressed `collection#variable`. */
export function tokenAddresses(doc: UidxDocument): string[] {
  if (doc.tree.element !== 'Tokens') return []
  return doc.tree.children.flatMap((collection: UidxNode) =>
    collection.children.map((variable) => variable.address),
  )
}

/**
 * Every token flattened at the default mode of every collection.
 *
 * Retained for callers with no node context — `uidx check`, and the viewer's
 * address list. Anything rendering a *node* wants `TokenResolver` instead,
 * since only a mode tuple can say which mode that node is in (story G8).
 *
 * Alias chains are followed to their literal, so a consumer never has to walk
 * them. A chain that does not terminate — a cycle, or a dangling target — is
 * simply absent: `uidx check` reports both properly, and the renderer's job is
 * to draw what it can rather than to diagnose.
 */
export function resolveTokenValues(docs: readonly UidxDocument[]): Map<string, JsonValue> {
  const index = buildTokenIndex(docs)
  return new Map(new TokenResolver(index).resolve(defaultTuple(index)))
}
