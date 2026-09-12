import type { JsonValue, UidxDocument, VariableScope, VariableType } from '@uidx/format'

/**
 * The mode a collection that declares none still has.
 *
 * Figma has no unmoded collection — every one carries at least a default
 * column — so the index gives flat collections that same shape rather than
 * branching on "has modes" at every read site. The name cannot collide with an
 * authored one: a collection with no `modes` cannot hold `<Mode>` children.
 */
export const IMPLICIT_MODE = 'default'

export interface TokenEntry {
  address: string
  collection: string
  name: string
  type: VariableType
  scopes: readonly VariableScope[]
  description: string
  /** Marked no-longer-offered: pickers hide it, existing bindings keep resolving. */
  deprecated: boolean
  /** Mode name → the authored value, which may still be an alias. */
  valuesByMode: Record<string, JsonValue>
}

export interface CollectionInfo {
  name: string
  /** Ordered. `modes[0]` is the default — leftmost wins, as in Figma. */
  modes: string[]
}

export interface TokenIndex {
  entries: Map<string, TokenEntry>
  collections: Map<string, CollectionInfo>
}

/**
 * Every token a document declares, as data — no alias resolution.
 *
 * Resolution is separated out because it depends on a mode tuple and this does
 * not: the index is built once per document load, while `TokenResolver.resolve`
 * runs once per distinct tuple a render encounters.
 */
export function buildTokenIndex(docs: readonly UidxDocument[]): TokenIndex {
  const entries = new Map<string, TokenEntry>()
  const collections = new Map<string, CollectionInfo>()

  for (const doc of docs) {
    if (doc.tree.element !== 'Tokens') continue

    for (const collection of doc.tree.children) {
      const declared = collection.attrs.modes?.value
      const modes =
        Array.isArray(declared) && declared.length > 0 ? (declared as string[]) : [IMPLICIT_MODE]
      collections.set(collection.name, { name: collection.name, modes })

      for (const variable of collection.children) {
        const type = variable.attrs.type?.value
        // An untyped variable is a diagnostic the parser already raised; the
        // index simply has nothing to say about it.
        if (typeof type !== 'string') continue

        const scopes = variable.attrs.scopes?.value
        const description = variable.attrs.description?.value

        const valuesByMode: Record<string, JsonValue> = {}
        if (modes[0] === IMPLICIT_MODE && variable.attrs.value !== undefined) {
          valuesByMode[IMPLICIT_MODE] = variable.attrs.value.value
        } else {
          for (const mode of variable.children) {
            if (mode.element !== 'Mode') continue
            const value = mode.attrs.value?.value
            if (value !== undefined) valuesByMode[mode.name] = value
          }
        }

        entries.set(variable.address, {
          address: variable.address,
          collection: collection.name,
          name: variable.name,
          type: type as VariableType,
          scopes: Array.isArray(scopes) ? (scopes as VariableScope[]) : ['ALL_SCOPES'],
          description: typeof description === 'string' ? description : '',
          deprecated: variable.attrs.deprecated?.value === true,
          valuesByMode,
        })
      }
    }
  }

  return { entries, collections }
}
