import type { Diagnostic, UidxDocument, UidxPatch } from '@uidx/format'

/** Distinct from Vite's own HMR socket, which shares the same HTTP server. */
export const WS_PATH = '/__uidx'

/**
 * The document as it crosses the wire. `UidxDocument` is already plain JSON —
 * offsets, tree and source text all survive `JSON.stringify` unchanged, so the
 * client gets byte offsets it can trust against the same `source`.
 */
export type SerializedUidxDocument = UidxDocument

/**
 * Every message names the page it concerns (ADR 0004, story G6).
 *
 * Revisions are per page, so a revision number means nothing without knowing
 * which page it counts. This is also the field a patch envelope needs once
 * editing an instance and editing its main are edits to different files (C1).
 *
 * Workspace-relative and `/`-separated, so it matches on both sides of the
 * socket regardless of platform.
 */
export interface PageRef {
  file: string
}

export type ServerMessage =
  | ({
      type: 'file:changed'
      revision: number
      /**
       * The whole document — on connect, on `page:request`, and whenever the
       * server cannot express the change as patches. Absent on a delta.
       */
      doc?: SerializedUidxDocument
      /**
       * A delta (viewer-at-scale spec §2): the patches that take revision
       * `base` to this one. A client holding `base` applies them with
       * `applyPatchesIncremental` and checks `sourceHash`; anyone else asks
       * for the document with `page:request`. Empty when only prose moved.
       */
      patches?: UidxPatch[]
      base?: number
      /** The hash of this revision's source, so a delta's result can be checked. */
      sourceHash: string
      /**
       * Present when a `node:patch` produced this revision. The broadcast goes
       * out *before* the sender's `patch:applied`, so this is how a client tells
       * its own confirmation from someone else's edit (spec §2, §5).
       */
      patchId?: string
    } & PageRef)
  | ({ type: 'file:error'; revision: number; diagnostics: Diagnostic[] } & PageRef)
  | ({ type: 'patch:applied'; revision: number; patchId: string } & PageRef)
  | ({ type: 'patch:stale'; patchId: string; revision: number } & PageRef)
  /**
   * A patch that could not be applied at all — an address that no longer
   * resolves, a guard in the patcher, a failed write.
   *
   * Distinct from `patch:stale`, which the client answers by re-syncing and
   * retrying. A rejection is not retryable, so it carries a reason meant to be
   * shown to the author rather than handled.
   */
  | ({ type: 'patch:rejected'; patchId: string; revision: number; reason: string } & PageRef)
  /** The document's shape, sent once on connect so a client knows what exists. */
  | { type: 'document:opened'; id: string; pages: string[]; entry: string }
  /**
   * Artwork this document references has been written to, added or removed.
   *
   * Not page-addressed, and so not carrying a `PageRef`: a `src` is relative to
   * the manifest (ADR 0006 §3) and any number of pages may paint with it. The
   * client knows which of its pages reference it and is the only side that
   * knows what it is currently holding, so it decides what to redraw.
   *
   * Carries no bytes. The client's asset store fetches over the same route it
   * always does; this only says that what it has is stale.
   */
  | { type: 'asset:changed'; src: string }
  /**
   * A page this one binds tokens or components from has changed. The client
   * already holds the new declaring page, so it re-resolves from what it has;
   * this replaced re-sending the dependent's whole document.
   */
  | ({ type: 'page:reresolve' } & PageRef)

export type NodePatchMessage = {
  type: 'node:patch'
  patchId: string
  baseRevision: number
  patches: UidxPatch[]
} & PageRef

/**
 * The canvas telling the server what is selected right now, so an agent
 * outside the browser (CLI, MCP) can read what "this" means. Fire-and-forget:
 * the server keeps only the latest and never replies. `addresses` may be
 * empty — clearing the selection is a report too.
 */
export type SelectionChangedMessage = {
  type: 'selection:changed'
  addresses: string[]
} & PageRef

/** Asks for a page's whole document — after a delta the client could not apply. */
export type PageRequestMessage = { type: 'page:request' } & PageRef

export type ClientMessage = NodePatchMessage | SelectionChangedMessage | PageRequestMessage

export function isClientMessage(value: unknown): value is ClientMessage {
  if (typeof value !== 'object' || value === null) return false
  const m = value as Record<string, unknown>
  if (m.type === 'selection:changed') {
    return typeof m.file === 'string' && Array.isArray(m.addresses)
  }
  if (m.type === 'page:request') return typeof m.file === 'string'
  return (
    m.type === 'node:patch' &&
    typeof m.patchId === 'string' &&
    typeof m.file === 'string' &&
    typeof m.baseRevision === 'number' &&
    Array.isArray(m.patches)
  )
}
