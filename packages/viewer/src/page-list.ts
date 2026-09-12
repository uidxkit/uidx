import type { UidxDocument } from '@uidx/format'

/**
 * One row of the pages rail.
 *
 * The shell already holds every page of the document — resolving a token or a
 * component name needs the whole thing (ADR 0004 §1), so the server sends all
 * of it and `App` keeps the lot. What was missing was any way to *say* which
 * one the canvas draws, which is why seeing seven sheets meant running seven
 * servers (`design/preview.sh`).
 */
export interface PageEntry {
  /** Workspace-relative path. The id every protocol message uses for a page. */
  file: string
  /** The frontmatter `id`, or the filename until the document arrives. */
  label: string
  /**
   * Whether the canvas can draw it.
   *
   * A `<Tokens>` page declares variable collections rather than a scene, and
   * `toSceneGraph` throws rather than guess at one. Listed all the same: a page
   * that exists in the document and cannot be reached from the UI is worse than
   * a page that says what it is.
   */
  renderable: boolean
  /** Whether this page's document has come over the socket yet. */
  loaded: boolean
}

/**
 * The document's pages, in the order the server announced them.
 *
 * Server order rather than sorted here: `documentMembers` already settles it,
 * and two orderings of one list is one too many.
 *
 * `announced` may be empty — the single-file server sends no `document:opened`
 * — and it may miss a page that later arrives over the socket, so anything
 * loaded but unannounced is appended rather than dropped.
 */
export function pageEntries(
  announced: readonly string[],
  docs: ReadonlyMap<string, UidxDocument>,
): PageEntry[] {
  const files = [...announced]
  for (const file of docs.keys()) if (!files.includes(file)) files.push(file)

  return files.map((file) => {
    const doc = docs.get(file)
    return {
      file,
      label: labelFor(file, doc),
      renderable: doc ? doc.tree.element !== 'Tokens' : true,
      loaded: doc !== undefined,
    }
  })
}

/**
 * The pages the shell is still holding that the document no longer has.
 *
 * `document:opened` is re-sent when membership changes, so it is also what says
 * a page has *left* — deleted on disk, by a hand or by the agent harness. Its
 * document has to be dropped with it or `pageEntries` appends it right back as
 * an unannounced-but-loaded row, and the rail keeps offering a page that is
 * gone.
 *
 * Only meaningful for a server that announces at all: the single-file server
 * sends no `document:opened`, so nothing ever calls this and nothing is pruned.
 */
export function departedPages(announced: readonly string[], held: Iterable<string>): string[] {
  const kept = new Set(announced)
  return [...held].filter((file) => !kept.has(file))
}

/**
 * What to call a page.
 *
 * The frontmatter `id` is the document's own name for itself and is what the
 * title bar already shows, so the rail agreeing with it costs nothing. The
 * filename is the fallback for a page announced but not yet received — and it
 * is kept on the row as its path, because the filename is what the author typed
 * on the command line and what a diff will name.
 */
function labelFor(file: string, doc: UidxDocument | undefined): string {
  const id = doc?.frontmatter.id
  if (typeof id === 'string' && id.length > 0) return id
  return (
    file
      .split('/')
      .pop()
      ?.replace(/\.uidx$/, '') ?? file
  )
}
