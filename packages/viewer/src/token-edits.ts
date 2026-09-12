import {
  aliasTarget,
  fitsVariableType,
  isAlias,
  variableTypeOf,
  type JsonValue,
  type UidxPatch,
  type VariableType,
} from '@uidx/format'
import { IMPLICIT_MODE, type TokenEntry, type TokenIndex } from '@uidx/schema'

/**
 * The tokens view's writes, built pure (spec §§5–6): a cell edit, a new
 * token, a new collection — each as `{ file, patches }` for the shell to
 * dispatch through the ordinary channel, or a `{ refused }` in the editor's
 * own words. Refusal happens here, before anything reaches the patcher: a
 * type-mismatched alias must never leave the editor.
 */
export type EditOutcome = { file: string; patches: UidxPatch[] } | { refused: string }

export function editCellPatch(input: {
  index: TokenIndex
  row: { address: string; type: VariableType; file: string }
  mode: string
  /** What the editor holds: a literal, or '{collection#token}' alias text. */
  value: JsonValue
}): EditOutcome {
  const { index, row, mode, value } = input

  if (isAlias(value)) {
    const target = aliasTarget(value)!
    const entry = index.entries.get(target)
    if (!entry) return { refused: `there is no token at ${target}` }
    if (entry.deprecated) return { refused: `${target} is deprecated — pick a live token` }
    if (entry.type !== row.type) {
      return { refused: `${target} is ${entry.type}; this token is ${row.type}` }
    }
  } else if (!fitsVariableType(value, row.type)) {
    return {
      refused: `${JSON.stringify(value)} is ${variableTypeOf(value) ?? 'not a token value'}, not ${row.type}`,
    }
  }

  const patch: UidxPatch =
    mode === IMPLICIT_MODE
      ? { op: 'set', address: row.address, prop: 'value', value }
      : { op: 'set-mode', address: row.address, mode, value }
  return { file: row.file, patches: [patch] }
}

export function addTokenPatch(input: {
  collection: string
  file: string
  name: string
  type: VariableType
  value: JsonValue
  /** Insert position — the end of the collection's children. */
  at: number
  /** The collection's modes; more than one means <Mode> children (UIDX125/127). */
  modes: readonly string[]
}): { file: string; patches: UidxPatch[] } {
  // A moded collection refuses a plain `value` and demands every mode, so a
  // new token is born with one <Mode> child per column, all holding the same
  // starting value — complete on arrival, edited apart afterwards.
  const moded = input.modes.length > 1
  return {
    file: input.file,
    patches: [
      {
        op: 'insert-node',
        parent: input.collection,
        index: input.at,
        node: moded
          ? {
              element: 'Variable',
              attrs: { name: input.name, type: input.type },
              children: input.modes.map((mode) => ({
                element: 'Mode' as const,
                attrs: { name: mode, value: input.value },
              })),
            }
          : {
              element: 'Variable',
              attrs: { name: input.name, type: input.type, value: input.value },
            },
      },
    ],
  }
}

export function addCollectionPatch(input: { file: string; name: string; at: number }): {
  file: string
  patches: UidxPatch[]
} {
  return {
    file: input.file,
    patches: [
      {
        op: 'insert-node',
        parent: '',
        index: input.at,
        node: { element: 'Collection', attrs: { name: input.name } },
      },
    ],
  }
}

/**
 * What the alias autocomplete offers: same-typed live tokens that would not
 * close a cycle. "Would not" is checked by walking each candidate's own
 * chain — a candidate that already resolves *through* the token being edited
 * would loop the moment the edit lands.
 */
export function aliasTargets(
  index: TokenIndex,
  forType: VariableType,
  selfAddress: string,
): TokenEntry[] {
  const out: TokenEntry[] = []
  for (const entry of index.entries.values()) {
    if (entry.address === selfAddress) continue
    if (entry.deprecated) continue
    if (entry.type !== forType) continue
    if (chainTouches(index, entry, selfAddress)) continue
    out.push(entry)
  }
  return out
}

function chainTouches(index: TokenIndex, from: TokenEntry, needle: string): boolean {
  const seen = new Set<string>([from.address])
  const queue = Object.values(from.valuesByMode)
  while (queue.length) {
    const value = queue.pop()!
    if (!isAlias(value)) continue
    const target = aliasTarget(value)!
    if (target === needle) return true
    if (seen.has(target)) continue
    seen.add(target)
    const entry = index.entries.get(target)
    if (entry) queue.push(...Object.values(entry.valuesByMode))
  }
  return false
}
