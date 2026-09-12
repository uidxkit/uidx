import type { VariableType } from '@uidx/format'
import { defaultTuple, type TokenIndex, type TokenResolver } from '@uidx/schema'
import { aliasTargets } from './token-edits'
import { variableCandidates, type VariableCandidate } from './variable-binding'

/** The canvas picker, with previews in the edited column's mode and the
 * token editor's self-reference, deprecation, and cycle exclusions. */
export function tokenAliasCandidates(
  index: TokenIndex,
  resolver: TokenResolver,
  type: VariableType,
  selfAddress: string,
  mode: string,
): VariableCandidate[] {
  const tuple = new Map(defaultTuple(index))
  for (const [name, collection] of index.collections) {
    if (collection.modes.includes(mode)) tuple.set(name, mode)
  }
  const allowed = new Set(aliasTargets(index, type, selfAddress).map((entry) => entry.address))
  return variableCandidates(resolver.resolve(tuple), index, type, null).filter((candidate) =>
    allowed.has(candidate.address),
  )
}
