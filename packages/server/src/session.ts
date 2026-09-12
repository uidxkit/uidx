import { createHash } from 'node:crypto'
import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import chokidar, { type FSWatcher } from 'chokidar'
import {
  applyPatchesIncremental,
  diffToPatches,
  parse,
  type Diagnostic,
  type UidxDocument,
  type UidxPatch,
} from '@uidx/format'

import { WriteLedger } from './ledger.js'
import type { ServerMessage } from './protocol.js'

export interface SessionOptions {
  file: string
  /** Workspace-relative id this session's messages carry (G6). */
  page?: string
  /** chokidar write-settling window; small values keep tests fast. */
  stabilityThreshold?: number
  onBroadcast?(message: ServerMessage): void
}

export type SessionState =
  | { kind: 'ok'; revision: number; doc: UidxDocument }
  | { kind: 'error'; revision: number; diagnostics: Diagnostic[] }

export interface PatchRequest {
  patchId: string
  /** The revision of *this page* the client wrote these patches against (C3). */
  baseRevision: number
  patches: readonly UidxPatch[]
}

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

let tempCounter = 0

/**
 * Write to a sibling temp file, then rename over the target (spec §9.4).
 *
 * `rename` within a directory is atomic, so a reader sees either the whole old
 * file or the whole new one. Writing in place is not: a crash or a full disk
 * partway through leaves the author with a truncated design contract, and the
 * file the tool just destroyed is the only copy of their intent.
 *
 * The temp name deliberately does not end in `.uidx` — `documentMembers` globs
 * for that extension, and a manifest that briefly matched a half-written file
 * would load it as a page.
 */
async function writeAtomically(file: string, contents: string): Promise<void> {
  const temp = `${file}.${process.pid}.${++tempCounter}.tmp`
  await writeFile(temp, contents, 'utf8')
  try {
    await rename(temp, file)
  } catch (err) {
    await rm(temp, { force: true })
    throw err
  }
}

/**
 * Owns one `.uidx` file: watches it, parses it, and produces the messages the
 * viewer needs. Transport-free on purpose, so the whole file→canvas path is
 * testable without opening a socket.
 *
 * `revision` is a monotonic counter over accepted file states (spec §6.1). It
 * only advances when a read produces a state the client has not seen, which is
 * what makes `baseRevision` staleness detection meaningful later.
 */
export class FileSession {
  readonly file: string
  /** The `file` every message from this session carries. */
  readonly page: string
  readonly ledger = new WriteLedger()

  private watcher: FSWatcher | null = null
  /**
   * Serialises reloads. Two rapid saves used to interleave — both reads could
   * be in flight at once, and the slower one would commit its (older) document
   * at the higher revision. Chaining them means a reload always sees the state
   * the previous one left.
   */
  private queue: Promise<unknown> = Promise.resolve()
  private state: SessionState = { kind: 'error', revision: 0, diagnostics: [] }
  private lastHash: string | null = null
  private readonly listeners = new Set<(message: ServerMessage) => void>()

  constructor(private readonly options: SessionOptions) {
    this.file = resolve(options.file)
    this.page = options.page ?? this.file
    if (options.onBroadcast) this.listeners.add(options.onBroadcast)
  }

  get current(): SessionState {
    return this.state
  }

  get revision(): number {
    return this.state.revision
  }

  onMessage(listener: (message: ServerMessage) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Reads the file once, then begins watching. */
  async start(): Promise<SessionState> {
    await this.reload()
    this.watcher = chokidar.watch(this.file, {
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: this.options.stabilityThreshold ?? 40,
        pollInterval: 10,
      },
    })
    this.watcher.on('change', () => void this.reload())
    this.watcher.on('add', () => void this.reload())
    // A deleted file is a state to report, not silence. `reloadNow` already
    // turns the failed read into a `file:error`, so the canvas says the page is
    // gone instead of going on drawing the last one it saw. In a document the
    // `Workspace` tears this session down as well; on a loose file — `uidx open
    // one.uidx` outside any manifest — this is the only thing that notices.
    this.watcher.on('unlink', () => void this.reload())
    return this.state
  }

  async close(): Promise<void> {
    await this.watcher?.close()
    this.watcher = null
    this.listeners.clear()
  }

  /** The message a freshly connected client should receive (spec §11). */
  snapshot(): ServerMessage {
    return this.state.kind === 'ok'
      ? {
          type: 'file:changed',
          file: this.page,
          revision: this.state.revision,
          doc: this.state.doc,
          sourceHash: this.state.doc.sourceHash,
        }
      : {
          type: 'file:error',
          file: this.page,
          revision: this.state.revision,
          diagnostics: this.state.diagnostics,
        }
  }

  /**
   * Re-reads and re-parses. Returns the message that was broadcast, or null if
   * the read was swallowed as our own echo or produced no observable change.
   */
  async reload(): Promise<ServerMessage | null> {
    // Serialised, not concurrent — see `queue`.
    const run = this.queue.then(() => this.reloadNow())
    this.queue = run.catch(() => undefined)
    return run
  }

  private async reloadNow(): Promise<ServerMessage | null> {
    let source: string
    try {
      source = await readFile(this.file, 'utf8')
    } catch (err) {
      // A missing file is a state to report, not a crash (spec §11).
      return this.emitError([
        {
          code: 'UIDX000',
          message: `cannot read ${this.file}: ${(err as Error).message}`,
          severity: 'error',
          loc: { start: 0, end: 0 },
          line: 1,
          column: 1,
        },
      ])
    }

    const hash = sha256(source)
    if (this.ledger.claim(hash)) return null // our own write coming back
    if (hash === this.lastHash) return null // touched but unchanged
    this.lastHash = hash

    const { doc, diagnostics } = parse(source)
    if (!doc) return this.emitError(diagnostics)

    const previous = this.state
    this.state = { kind: 'ok', revision: this.state.revision + 1, doc }
    // An outside write is expressed as the patches from the last good revision
    // when there is one (viewer-at-scale spec §2); a client that cannot apply
    // them asks for the document. Only prose moving leaves the list empty.
    if (previous.kind === 'ok') {
      return this.broadcast({
        type: 'file:changed',
        file: this.page,
        revision: this.state.revision,
        patches: diffToPatches(previous.doc, doc),
        base: previous.revision,
        sourceHash: doc.sourceHash,
      })
    }
    return this.broadcast({
      type: 'file:changed',
      file: this.page,
      revision: this.state.revision,
      doc,
      sourceHash: doc.sourceHash,
    })
  }

  /** Records a hash the server is about to write, so its echo is swallowed. */
  expectWrite(source: string): void {
    this.ledger.record(sha256(source))
  }

  /**
   * Applies patches to this page and writes the result (story C1).
   *
   * Returns the message for the client that sent them — an ack, or a refusal
   * with the reason. A successful write also broadcasts `file:changed` to
   * everyone, which is what carries the new document to other viewers; the
   * sender's own client reconciles it to nothing, because B7 diffs an incoming
   * document against the one on screen rather than replacing it.
   *
   * Queued behind reloads on the same chain as `reload()`. A watcher event
   * landing between reading `state.doc` and writing the result would otherwise
   * mean patching a document the file no longer holds.
   */
  async patch(request: PatchRequest): Promise<ServerMessage> {
    const run = this.queue.then(() => this.patchNow(request))
    this.queue = run.catch(() => undefined)
    return run
  }

  private async patchNow(request: PatchRequest): Promise<ServerMessage> {
    const state = this.state
    const { patchId } = request

    if (state.kind !== 'ok') {
      return this.refuse(
        patchId,
        'this page does not currently parse, so there is no tree to patch — fix the file first',
      )
    }

    // C3. Addresses resolve against the tree the client was looking at, so a
    // patch written against an older one may name a node that has since been
    // renamed or removed. Rejecting is the only safe answer: the alternative is
    // applying an edit to whatever now happens to sit at that address.
    if (request.baseRevision !== state.revision) {
      return {
        type: 'patch:stale',
        file: this.page,
        patchId,
        revision: state.revision,
      }
    }

    let doc: UidxDocument
    try {
      // Only the element the patches touched is re-lowered (viewer-at-scale
      // spec §1): about 0.2 s on the 63k-line atlas page where a full parse
      // was 1 s. The result is what a full parse would produce, and a change
      // the fast path cannot vouch for takes that full parse instead.
      doc = applyPatchesIncremental(state.doc, request.patches).doc
    } catch (err) {
      return this.refuse(patchId, (err as Error).message)
    }
    const next = doc.source

    // A patch that changes nothing is not a revision. Dragging a value back to
    // where it started should leave the file — and the diff — untouched.
    if (next === state.doc.source) {
      return { type: 'patch:applied', file: this.page, patchId, revision: state.revision }
    }

    const hash = sha256(next)
    // Recorded before the write, not after: the watcher can fire while `rename`
    // is still returning, and an echo that arrives before its own ledger entry
    // is exactly the flicker C2 exists to prevent.
    this.ledger.record(hash)
    try {
      await writeAtomically(this.file, next)
    } catch (err) {
      // Nothing reached the file, so the entry would otherwise sit there and
      // swallow the next genuine external save that produced these bytes.
      this.ledger.claim(hash)
      return this.refuse(patchId, `could not write ${this.file}: ${(err as Error).message}`)
    }

    this.lastHash = hash
    this.state = { kind: 'ok', revision: state.revision + 1, doc }
    // A delta, not the document: the patches that made this revision, the
    // revision they applied to, and the hash to check the result against.
    this.broadcast({
      type: 'file:changed',
      file: this.page,
      revision: this.state.revision,
      patches: [...request.patches],
      base: state.revision,
      sourceHash: doc.sourceHash,
      patchId,
    })
    return { type: 'patch:applied', file: this.page, patchId, revision: this.state.revision }
  }

  private refuse(patchId: string, reason: string): ServerMessage {
    return {
      type: 'patch:rejected',
      file: this.page,
      patchId,
      revision: this.state.revision,
      reason,
    }
  }

  private emitError(diagnostics: Diagnostic[]): ServerMessage {
    // The revision does not advance: an unparseable file is not a state the
    // client can hold, and the last good document stays authoritative.
    this.state = { kind: 'error', revision: this.state.revision, diagnostics }
    return this.broadcast({
      type: 'file:error',
      file: this.page,
      revision: this.state.revision,
      diagnostics,
    })
  }

  private broadcast(message: ServerMessage): ServerMessage {
    for (const listener of this.listeners) listener(message)
    return message
  }
}
