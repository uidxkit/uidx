import { relative, resolve, sep } from 'node:path'
import chokidar, { type FSWatcher } from 'chokidar'
import { assetRefs, type UidxDocument } from '@uidx/format'

import { AssetWatcher } from './asset-watch.js'
import { documentMembers, findManifest, type FoundManifest } from './document.js'
import { FileSession } from './session.js'
import {
  buildSymbolTable,
  collectReferences,
  symbolTableOf,
  type Reference,
  type SymbolEntry,
  type SymbolTable,
} from './symbols.js'
import type { ServerMessage } from './protocol.js'

/** Anything a glob character can start; everything before the first one is literal. */
const MAGIC = /[*?[\]{}()!+@]/

/**
 * The directories a member could appear in, and how deep to look.
 *
 * A recursive watch on the whole manifest directory would be wrong twice over.
 * This repo's root manifest is `examples/**\/*.uidx`, so it would put a
 * persistent watcher on every package, every `docs/` tree and every build
 * output in the repo to notice a file that can only ever land under
 * `examples/`. And it would be watching directories the globs already say can
 * hold nothing.
 *
 * So the watch set is the literal prefix of each glob — the part before the
 * first glob character — and the depth is what the rest of the pattern can
 * still reach. `*.uidx` watches the manifest directory and nothing below it;
 * `examples/**\/*.uidx` watches `examples/` all the way down.
 *
 * Depth is measured from the root that is actually watched, not from each
 * glob's own prefix. A prefix that sits inside another is dropped — chokidar
 * would walk it twice and report every event twice — and the levels between
 * the two are added back to the depth, or `["*.uidx", "pages/*.uidx"]` would
 * watch the manifest directory at depth 0 and never see the second glob's
 * files. Over-watching by a level is harmless, since membership is decided by
 * `documentMembers` and not by the watch set; under-watching loses a page.
 *
 * A negated pattern only ever removes members, so it contributes no roots.
 */
export function membershipRoots(globs: readonly string[]): {
  dirs: string[]
  depth: number | undefined
} {
  const patterns: { prefix: string[]; reach: number | undefined }[] = []

  for (const glob of globs) {
    if (glob.startsWith('!')) continue
    const segments = glob.split('/')
    const prefix: string[] = []
    while (segments.length > 0 && !MAGIC.test(segments[0]!)) prefix.push(segments.shift()!)

    // The trailing segment is the filename, so the directory levels the rest of
    // the pattern can still descend is one fewer than what is left.
    const reach = segments.some((segment) => segment.includes('**'))
      ? undefined
      : Math.max(0, segments.length - 1)
    patterns.push({ prefix, reach })
  }
  if (patterns.length === 0) return { dirs: [], depth: 0 }

  const candidates = [...new Set(patterns.map((pattern) => pattern.prefix.join('/')))]
  const dirs = candidates.filter(
    (dir) => !candidates.some((other) => other !== dir && isUnder(dir, other)),
  )

  let depth: number | undefined = 0
  for (const { prefix, reach } of patterns) {
    if (reach === undefined) return { dirs: dirs.sort(), depth: undefined }
    const root = dirs.find((dir) => dir === prefix.join('/') || isUnder(prefix.join('/'), dir))!
    const below = root === '' ? prefix.length : prefix.length - root.split('/').length
    if (depth !== undefined) depth = Math.max(depth, below + reach)
  }
  return { dirs: dirs.sort(), depth }
}

/** Whether `path` sits inside `parent`, both `/`-joined and relative. */
function isUnder(path: string, parent: string): boolean {
  if (parent === '') return path !== ''
  return path.startsWith(`${parent}/`)
}

export interface WorkspaceOptions {
  /** Any path inside the document; the manifest is found by walking up. */
  from: string
  stabilityThreshold?: number
  onBroadcast?(message: ServerMessage): void
}

/**
 * Every page of one document, live (story G6).
 *
 * `FileSession` owns a page — watching, parsing, its own revision counter and
 * its own echo ledger. The workspace owns the set of them, which is the shape
 * ADR 0004 forces: a bare component name resolves against the whole document,
 * so the whole document has to be loaded and watched, not just the page on
 * screen.
 *
 * Revisions stay per page rather than becoming a document-wide counter. A
 * document-wide one would make every save look like a change to every page,
 * which is exactly what `baseRevision` staleness detection needs to distinguish.
 */
export class Workspace {
  readonly manifest: FoundManifest
  private readonly sessions = new Map<string, FileSession>()
  private readonly listeners = new Set<(message: ServerMessage) => void>()
  private symbols: SymbolTable | null = null
  /** Per page, so a save re-walks one document instead of all of them. */
  private readonly pageSymbols = new Map<string, readonly SymbolEntry[]>()
  private readonly pageReferences = new Map<string, readonly Reference[]>()
  /** Symbol name -> pages that reference it. */
  private dependents = new Map<string, Set<string>>()
  /**
   * The artwork the document references, watched.
   *
   * Kept beside the sessions rather than inside them: an image is referenced by
   * a `src` that ADR 0006 §3 makes relative to the manifest, so it belongs to
   * the document the way a component name does — several pages may paint with
   * one file, and a per-page watcher would watch it once per page.
   */
  private readonly assets: AssetWatcher
  /**
   * The document's membership, watched.
   *
   * A `FileSession` watches one file, which is enough to notice an edit and
   * nothing else. A page that is *created* has no session to notice it, and a
   * page that is *deleted* leaves one behind that still holds a write path —
   * so the next canvas gesture aimed at it wrote the deleted file back. Both
   * are ordinary now that a design can be edited by something other than a
   * hand: the agent harness's whole architecture is that it writes `.uidx`
   * files and lets this watch carry them to the canvas.
   */
  private membership: FSWatcher | null = null
  /**
   * Serialises membership syncs. A create and a delete can land in the same
   * tick, and two overlapping globs would each decide the map on stale facts.
   */
  private syncing: Promise<unknown> = Promise.resolve()
  /** Guards a sync that is mid-flight when the workspace is torn down. */
  private closed = false
  /**
   * The entry page of the last snapshot handed out, so a re-announcement names
   * the same one. Every client of one server is opened at the same page (see
   * `attach` in `server.ts`), so there is one answer rather than one per
   * socket; it is only a fallback anyway, since the viewer's URL outranks it.
   */
  private lastEntry: string | null = null

  private constructor(
    manifest: FoundManifest,
    private readonly options: WorkspaceOptions,
  ) {
    this.manifest = manifest
    if (options.onBroadcast) this.listeners.add(options.onBroadcast)
    this.assets = new AssetWatcher({
      dir: manifest.dir,
      stabilityThreshold: options.stabilityThreshold,
      onChange: (src) => this.broadcast({ type: 'asset:changed', src }),
    })
  }

  static async open(options: WorkspaceOptions): Promise<Workspace> {
    const manifest = await findManifest(options.from)
    if (!manifest) throw new Error(`no uidx.json above ${options.from}`)
    return new Workspace(manifest, options)
  }

  get pages(): string[] {
    return [...this.sessions.keys()].sort()
  }

  session(page: string): FileSession | undefined {
    return this.sessions.get(page)
  }

  /** The page id for an absolute path, or null if it is not a member. */
  pageOf(path: string): string | null {
    const rel = relative(this.manifest.dir, resolve(path)).split(sep).join('/')
    return this.sessions.has(rel) ? rel : null
  }

  onMessage(listener: (message: ServerMessage) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Starts a session for every member, then indexes what references what. */
  async start(): Promise<void> {
    const files = await documentMembers(this.manifest)

    await Promise.all(files.map((page) => this.adopt(page).start()))

    this.reindex()
    await this.watchMembership()
  }

  async close(): Promise<void> {
    // Set before anything else: a sync already past its first await must not
    // build sessions into a map that is about to be cleared, leaving watchers
    // with nothing left to close them.
    this.closed = true
    await this.membership?.close()
    this.membership = null
    await this.syncing.catch(() => undefined)

    await Promise.all([
      ...[...this.sessions.values()].map((session) => session.close()),
      this.assets.close(),
    ])
    this.sessions.clear()
    this.listeners.clear()
  }

  /** A session for one page, wired to this workspace but not yet started. */
  private adopt(page: string): FileSession {
    const session = new FileSession({
      file: resolve(this.manifest.dir, page),
      page,
      stabilityThreshold: this.options.stabilityThreshold,
    })
    this.sessions.set(page, session)
    session.onMessage((message) => this.onSessionMessage(page, message))
    return session
  }

  /**
   * Watches for `.uidx` files entering or leaving the document.
   *
   * Only `add` and `unlink` are listened for — a *change* to a member is the
   * `FileSession`'s job and always was. That is also what keeps the server from
   * reacting to its own writes: a patch renames a temp sibling over an existing
   * member, which is a `change`, and the temp name deliberately does not end in
   * `.uidx` so its own `add` is filtered out here before anything else runs.
   * The `WriteLedger` still swallows the echo at the session, exactly as before.
   *
   * Awaited rather than left to settle in the background: a file created in the
   * gap between `start()` returning and chokidar's first scan finishing would be
   * folded into that scan and, under `ignoreInitial`, announced to nobody — and
   * unlike a missed asset event, a page that is never announced never appears
   * at all. `server.ts` boots Vite alongside this, so it is not on its own
   * critical path.
   */
  private async watchMembership(): Promise<void> {
    const { dirs, depth } = membershipRoots(this.manifest.manifest.files)
    const paths = dirs.map((dir) => resolve(this.manifest.dir, dir))
    if (paths.length === 0) return

    const watcher = chokidar.watch(paths, {
      ignoreInitial: true,
      depth,
      ignored: (path) => this.unreachable(path),
      // The same settling window a `FileSession` uses. A page arriving in
      // pieces must not be globbed and parsed halfway through.
      awaitWriteFinish: {
        stabilityThreshold: this.options.stabilityThreshold ?? 40,
        pollInterval: 10,
      },
    })

    const consider = (path: string): void => {
      if (path.endsWith('.uidx')) this.syncMembers()
    }
    watcher.on('add', consider)
    watcher.on('unlink', consider)

    this.membership = watcher
    await new Promise<void>((done) => watcher.once('ready', () => done()))
  }

  /**
   * Whether a path can be ruled out as a member without asking the globs.
   *
   * Exactly the two exclusions `documentMembers` already applies — it ignores
   * `**\/node_modules/**`, and tinyglobby does not match dot-directories unless
   * asked — so nothing this skips could have been a member anyway. Worth doing
   * cheaply here rather than leaving to the glob: this is a live watch, and a
   * `node_modules` walked once by a globber is a `node_modules` watched forever.
   */
  private unreachable(path: string): boolean {
    const rel = relative(this.manifest.dir, path)
    if (rel === '' || rel.startsWith('..')) return false
    return rel
      .split(sep)
      .some((segment) => segment === 'node_modules' || (segment.startsWith('.') && segment !== '.'))
  }

  /** Queues a membership sync; see `syncing`. */
  private syncMembers(): void {
    void this.refreshMembers().catch(() => undefined)
  }

  /** Adopt a viewer-created page before acknowledging its creation. */
  refreshMembers(): Promise<void> {
    const refreshed = this.syncing.then(() => this.syncNow())
    this.syncing = refreshed.catch(() => undefined)
    return refreshed
  }

  /**
   * Brings the session map back in line with what the manifest globs match.
   *
   * The globs are re-run rather than matched in-process: `documentMembers` is
   * the one place that decides what a document contains, and a second matcher
   * here would be a second opinion to disagree with it. It is also what makes
   * this idempotent — an event for a file that was already a member, or for one
   * the globs never covered, diffs to nothing and broadcasts nothing.
   */
  private async syncNow(): Promise<void> {
    if (this.closed) return
    const files = await documentMembers(this.manifest)
    if (this.closed) return
    const wanted = new Set(files)
    const added = files.filter((page) => !this.sessions.has(page))
    const removed = [...this.sessions.keys()].filter((page) => !wanted.has(page))
    if (added.length === 0 && removed.length === 0) return

    // Asked before the removal, while the symbol table still knows what the
    // departing pages declared: a page that binds to a token whose file just
    // left is rendering against a value that no longer exists, and nothing else
    // would tell it so. Same reasoning as `onSessionMessage`.
    const orphaned = new Set(removed.flatMap((page) => this.dependentsOf(page)))

    for (const page of removed) {
      const session = this.sessions.get(page)!
      // Dropped from the map before it is closed, so nothing can route a write
      // to a page that has left — that is what put a deleted file back on disk.
      this.sessions.delete(page)
      await session.close()
    }

    const opened = added.map((page) => this.adopt(page))

    this.reindex()
    // The announcement leads, as it does on connect: a client that hears about
    // a page's document before it hears the page exists has to guess.
    this.broadcast(this.announcement(this.entry()))
    await Promise.all(opened.map((session) => session.start()))

    for (const page of orphaned) {
      const snapshot = this.sessions.get(page)?.snapshot()
      if (snapshot) this.broadcast(snapshot)
    }
  }

  /** The `document:opened` for the current membership. */
  private announcement(entry: string): ServerMessage {
    return { type: 'document:opened', id: this.manifest.manifest.id, pages: this.pages, entry }
  }

  /** The entry page to re-announce; see `lastEntry`. */
  private entry(): string {
    if (this.lastEntry !== null && this.sessions.has(this.lastEntry)) return this.lastEntry
    return this.pages[0] ?? ''
  }

  /** What the asset watcher is watching, for tests. */
  get watchedAssets(): string[] {
    return this.assets.watching
  }

  /** Resolves once artwork changes will actually be announced. See `whenReady`. */
  whenAssetsReady(): Promise<void> {
    return this.assets.whenReady()
  }

  /**
   * What a freshly connected client needs: the shape, then every page —
   * declarations first, then the entry page, then the rest.
   *
   * Ordering matters on a large document, in two directions that pull against
   * each other.
   *
   * The entry page goes early because every page crosses the socket as its own
   * message: leaving it wherever the session map happened to put it means the
   * author waits on pages they are not looking at before the one they asked for
   * renders.
   *
   * But it cannot go *first*. A page is drawn from whatever has arrived when it
   * lands, so an entry page ahead of its token pages is built against an empty
   * index — every `{…}` alias fails, and `resolvePaintAliases` drops the paint
   * rather than draw a literal, leaving an unstyled canvas (on one Studio sheet:
   * 448 unresolved tokens and no white card). The viewer does rebuild when the
   * index changes, which is what made this so slippery to see — the whole
   * document usually arrives in a single read, so it is all in hand before Vue
   * flushes and nothing is ever wrong on screen. Split those frames across two
   * reads, which a large document on a slower machine does, and the first paint
   * is unstyled.
   *
   * So the declarations lead, and the entry page follows them. Fixed here rather
   * than by making the viewer wait for the whole document: the dependency is a
   * fact about the document, the server is what knows the whole of it, and a
   * client that waits would be slower for every document to fix a race in a few.
   */
  snapshot(entry: string): ServerMessage[] {
    // Remembered so a later re-announcement — a page created or deleted while
    // the server is up — names the same entry rather than inventing one.
    this.lastEntry = entry
    const rank = (session: FileSession): number => {
      if (this.declaresTokens(session)) return 0
      return session.page === entry ? 1 : 2
    }
    const sessions = [...this.sessions.values()].sort((a, b) => rank(a) - rank(b))
    return [this.announcement(entry), ...sessions.map((session) => session.snapshot())]
  }

  /**
   * Whether a page declares variables rather than a scene.
   *
   * Asked of the parsed document, not the filename: `tokens.uidx` is a
   * convention and nothing enforces it, while a `<Tokens>` root is the thing
   * that actually puts values in the index. A page that does not currently
   * parse declares nothing anybody can resolve against, so it ranks with the
   * rest.
   */
  private declaresTokens(session: FileSession): boolean {
    const state = session.current
    return state.kind === 'ok' && state.doc.tree.element === 'Tokens'
  }

  /** Documents that currently parse, for the symbol table. */
  private parsedPages(): { file: string; doc: UidxDocument }[] {
    const out: { file: string; doc: UidxDocument }[] = []
    for (const [page, session] of this.sessions) {
      const state = session.current
      if (state.kind === 'ok') out.push({ file: page, doc: state.doc })
    }
    return out
  }

  /**
   * Rebuilds the symbol table and the reverse dependency map.
   *
   * Cheap enough to redo wholesale on any change: it walks documents already in
   * memory, with no I/O and no parsing. Maintaining it incrementally would mean
   * a second code path that can disagree with this one about what a page
   * declares, which is the class of bug that costs far more than the walk.
   */
  private reindex(changed?: string): void {
    const pages = this.parsedPages()
    const live = new Set<string>()
    for (const page of pages) {
      live.add(page.file)
      // Only the page that moved is walked again. A page's symbols and the
      // references out of it depend on that page alone, so the other 32 are
      // exactly what they were.
      if (changed !== undefined && page.file !== changed && this.pageSymbols.has(page.file)) {
        continue
      }
      this.pageSymbols.set(page.file, buildSymbolTable([page]).table.entries)
      this.pageReferences.set(page.file, collectReferences([page]))
    }
    for (const file of [...this.pageSymbols.keys()]) {
      if (live.has(file)) continue
      this.pageSymbols.delete(file)
      this.pageReferences.delete(file)
    }

    const order = pages.map((page) => page.file)
    this.symbols = symbolTableOf(order.flatMap((file) => this.pageSymbols.get(file) ?? []))

    const dependents = new Map<string, Set<string>>()
    for (const reference of order.flatMap((file) => this.pageReferences.get(file) ?? [])) {
      const set = dependents.get(reference.target)
      if (set) set.add(reference.file)
      else dependents.set(reference.target, new Set([reference.file]))
    }
    this.dependents = dependents

    // Re-synced here rather than on its own schedule: a page gaining or losing
    // an image paint is a change to the document's references, which is exactly
    // what this method exists to recompute. `sync` is a no-op when the set has
    // not moved, which is almost always.
    this.assets.sync(this.referencedAssets(pages))
  }

  /**
   * Every `src` the document's pages name, deduplicated.
   *
   * A page that does not currently parse contributes nothing — `parsedPages`
   * has already dropped it — which is right: its references are unknown until
   * it parses, and the save that fixes it runs this again.
   */
  private referencedAssets(pages: readonly { doc: UidxDocument }[]): Set<string> {
    const out = new Set<string>()
    for (const { doc } of pages) {
      for (const ref of assetRefs(doc)) if (ref.src !== '') out.add(ref.src)
    }
    return out
  }

  /**
   * Pages that must re-render because `page` changed.
   *
   * A page depends on another when it references a symbol that page declares —
   * editing a token re-renders every component bound to it. The changed page is
   * never in its own dependent set; its own `file:changed` already covers it.
   */
  dependentsOf(page: string): string[] {
    if (!this.symbols) return []
    const out = new Set<string>()
    for (const symbol of this.symbols.entries) {
      if (symbol.file !== page) continue
      for (const dependent of this.dependents.get(symbol.name) ?? []) {
        if (dependent !== page) out.add(dependent)
      }
    }
    return [...out].sort()
  }

  private onSessionMessage(page: string, message: ServerMessage): void {
    // The table and the dependency map are derived from document contents, so
    // they are stale the moment any page changes — but only for that page.
    this.reindex(page)
    this.broadcast(message)

    if (message.type !== 'file:changed') return
    // A page that binds to a token this page declares is now rendering against
    // a stale value, and nothing else would tell it so. It is told to
    // re-resolve from the documents it holds — the declaring page just arrived
    // — rather than being re-sent whole (viewer-at-scale spec §2).
    for (const dependent of this.dependentsOf(page)) {
      if (this.sessions.has(dependent)) this.broadcast({ type: 'page:reresolve', file: dependent })
    }
  }

  private broadcast(message: ServerMessage): void {
    for (const listener of this.listeners) listener(message)
  }
}
