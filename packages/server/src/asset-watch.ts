import { dirname, resolve } from 'node:path'

import chokidar, { type FSWatcher } from 'chokidar'

/**
 * The artwork a document references, watched (the open half of ADR 0006 §9).
 *
 * A `.uidx` file is watched by its `FileSession`, so editing a page reaches the
 * canvas. The bytes behind an image paint had nothing watching them at all: the
 * viewer's asset store holds them by path for the life of the session, so
 * overwriting `assets/logo.png` left both the canvas and its thumbnail drawing
 * the old picture with nothing to correct them.
 *
 * **Driven by the referenced set, not by the asset folder.** What is announced
 * is exactly the `src` values the document's pages name — a handful — rather
 * than whatever `assets/**` happens to hold, which may be thousands. An event
 * for a file nobody paints with has no consumer, and a document sitting beside
 * a large asset folder must not pay for the whole of it: nothing here ever
 * recurses, and `chokidar@4` dropped glob support anyway, so the manifest's
 * globs could not be handed to it even if that were wanted.
 *
 * **Watched as directories, filtered to files.** Two things make per-file
 * watches wrong, and both are ordinary rather than exotic:
 *
 *   - A reference to artwork that does not exist yet is the common case — the
 *     author writes the page, then saves the image. There is nothing for a file
 *     watch to attach to, and chokidar establishes no watch at all, so the file
 *     appearing is silent.
 *   - Image tools save by writing a temporary file and renaming it over the
 *     target. That replaces the inode, which is what a per-file inotify watch
 *     is attached to.
 *
 * A non-recursive watch on the directory holding the artwork sees create,
 * modify, rename and delete alike. The watch set is therefore the *directories*
 * the references live in — usually one — while the *filter* stays the reference
 * set, so nothing is announced that no page paints with.
 *
 * One `FSWatcher` with `add`/`unwatch` rather than one per directory: the set is
 * re-synced on every page change, and churning watcher instances for a set that
 * usually does not move is the expensive way to do nothing.
 */
export interface AssetWatcherOptions {
  /** The manifest directory. Every `src` is relative to it (ADR 0006 §3). */
  dir: string
  /** chokidar's write-settling window; small values keep tests fast. */
  stabilityThreshold?: number
  /** Called with the `src`, not the absolute path — that is what a client knows. */
  onChange(src: string): void
}

export class AssetWatcher {
  private watcher: FSWatcher | null = null
  /** The `src` values announced, which is what a page references. */
  private watched = new Set<string>()
  /** The directories actually handed to chokidar, so a re-sync is a set diff. */
  private dirs = new Set<string>()
  /** Resolves when chokidar has finished its first scan; see `whenReady`. */
  private ready: Promise<void> | null = null

  constructor(private readonly options: AssetWatcherOptions) {}

  /** What is being watched, for tests and for the server log. */
  get watching(): string[] {
    return [...this.watched].sort()
  }

  /**
   * Resolves once chokidar's first scan is done and events will be delivered.
   *
   * There is a window between `add` and that scan finishing — about 7ms here —
   * in which a write is folded into the scan and, under `ignoreInitial`,
   * announced to nobody. It does not matter in use, where the artwork changes
   * seconds or minutes after the server started. It matters entirely to a test,
   * which writes the file on the next line and would otherwise be asserting on
   * a coin flip.
   *
   * Resolves immediately when there is nothing to watch.
   */
  whenReady(): Promise<void> {
    return this.ready ?? Promise.resolve()
  }

  /**
   * Point the watcher at exactly these references.
   *
   * Called on every reindex, which is every page change — a page that starts or
   * stops naming an image adjusts the set without anything else having to
   * notice. Idempotent: an unchanged set does no work at all, which is the
   * common case.
   */
  sync(srcs: Iterable<string>): void {
    const wanted = new Set(srcs)
    // The filter first, because an event that arrives between the two updates
    // should be judged against the newer reference set rather than the older.
    this.watched = wanted

    const dirs = new Set([...wanted].map((src) => dirname(this.pathOf(src))))
    const added = [...dirs].filter((dir) => !this.dirs.has(dir))
    const dropped = [...this.dirs].filter((dir) => !dirs.has(dir))
    if (added.length === 0 && dropped.length === 0) return

    for (const dir of dropped) {
      this.watcher?.unwatch(dir)
      this.dirs.delete(dir)
    }

    for (const dir of added) this.dirs.add(dir)
    if (added.length > 0) this.ensure().add(added)
  }

  async close(): Promise<void> {
    await this.watcher?.close()
    this.watcher = null
    this.ready = null
    this.watched.clear()
    this.dirs.clear()
  }

  private pathOf(src: string): string {
    return resolve(this.options.dir, src)
  }

  /**
   * The watcher, built on the first reference and not before.
   *
   * A document with no artwork — which is most of them, and every one in this
   * repo's `examples/` — never allocates a watcher or an inotify descriptor.
   */
  private ensure(): FSWatcher {
    if (this.watcher) return this.watcher
    const watcher = chokidar.watch([], {
      ignoreInitial: true,
      // The directory's own entries and no further. Artwork beside a large
      // subtree — an `assets/` holding a `raw/` of source files, say — must not
      // drag that subtree into the walk.
      depth: 0,
      // The same settling `FileSession` uses, and images need it more: a design
      // tool writing a PNG produces a burst of partial files, and hashing one of
      // those would key the graph on bytes that never existed.
      awaitWriteFinish: {
        stabilityThreshold: this.options.stabilityThreshold ?? 40,
        pollInterval: 10,
      },
    })

    // Three events, one meaning: whatever the client is holding for this `src`
    // is no longer what is on disk. `add` counts because a reference to a file
    // that does not exist yet is the ordinary case — the author writes the
    // page before saving the artwork — and `unlink` counts because a tile
    // showing artwork that has been deleted is worse than one showing a gap.
    const changed = (path: string): void => {
      const src = this.srcOf(path)
      if (src) this.options.onChange(src)
    }
    watcher.on('change', changed)
    watcher.on('add', changed)
    watcher.on('unlink', changed)

    this.ready = new Promise((resolve) => watcher.once('ready', () => resolve()))
    this.watcher = watcher
    return watcher
  }

  /**
   * The reference an event's path belongs to, or null for a file in a watched
   * directory that no page paints with.
   *
   * This is the filter that keeps a directory watch honest: `assets/` may hold
   * a hundred files and the document may reference two of them, and the other
   * ninety-eight must produce nothing. Matched against the reference set rather
   * than computed with `relative`, so a path arriving in a different shape than
   * it was registered — a symlinked directory, a case-insensitive filesystem —
   * cannot invent a `src` no document ever named.
   */
  private srcOf(path: string): string | null {
    for (const src of this.watched) if (this.pathOf(src) === path) return src
    return null
  }
}
