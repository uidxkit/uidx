import { applyPatchesIncremental, type UidxDocument, type UidxPatch } from '@uidx/format'

export interface DeltaMessage {
  doc?: UidxDocument
  patches?: UidxPatch[]
  base?: number
  sourceHash: string
}

/**
 * The document a `file:changed` carries, once applied (viewer-at-scale spec §2).
 *
 * A whole document is taken as is. A delta applies to the document this client
 * holds when that is the revision the patches were written against, and only
 * counts when the result hashes to what the server holds; anything else — no
 * base, a different base, a hash mismatch, a patch that will not apply, an
 * empty delta for a prose-only change — returns null, and the caller asks for
 * the document with `page:request`.
 */
export function applyDelta(
  held: UidxDocument | undefined,
  heldRevision: number | undefined,
  message: DeltaMessage,
): UidxDocument | null {
  if (message.doc) return message.doc
  if (!message.patches || !held || message.base === undefined || heldRevision !== message.base) {
    return null
  }
  try {
    const applied = applyPatchesIncremental(held, message.patches).doc
    return applied.sourceHash === message.sourceHash ? applied : null
  } catch {
    return null
  }
}
