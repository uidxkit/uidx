import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { glob } from 'tinyglobby'

/** A `uidx.json` on disk, with its member pages resolved. */
export interface FoundDoc {
  /** Absolute path to `uidx.json`. */
  path: string
  /** The workspace root; every member path is relative to this. */
  dir: string
  id: string
  /** The manifest's raw `files` globs — what authorises a write. */
  globs: string[]
  /** Member pages, workspace-relative and sorted. */
  files: string[]
}

/** What the open app told us about the document it is showing. */
export interface DocumentHint {
  id?: string
  page?: string
}

/**
 * Where a manifest is never worth looking for.
 *
 * Not an optimisation. A repository routinely holds copies of its own
 * documents — a build output, a git worktree under a dot-directory — and every
 * copy carries the same manifest `id`, which is what made a document that is
 * plainly the only one anybody is editing look ambiguous.
 *
 * Deliberately not applied to the member glob below: the manifest's own `files`
 * decide what a document contains, and the uidx server's `documentMembers`
 * excludes `node_modules` and nothing else. A second, narrower answer here
 * would mean the two disagreed about which pages exist.
 */
const NEVER_A_DOCUMENT = ['**/node_modules/**', '**/dist/**', '**/.*/**']

export async function discoverManifests(roots: readonly string[]): Promise<FoundDoc[]> {
  const found: FoundDoc[] = []
  for (const root of roots) {
    const legacy = await glob(['**/uidx.json'], {
      cwd: resolve(root),
      absolute: true,
      ignore: NEVER_A_DOCUMENT,
    })
    // Explicitly include the project convention while keeping other hidden
    // directories (checkpoints, caches, git worktrees) out of discovery.
    const projects = await glob(['.uidx/uidx.json', '**/.uidx/uidx.json'], {
      cwd: resolve(root),
      absolute: true,
      ignore: ['**/node_modules/**', '**/dist/**', '**/.git/**', '**/.uidx-agent/**'],
    })
    // `resolve` puts every path in the platform's own spelling: tinyglobby
    // answers with forward slashes even on Windows, where `resolveDocumentRoot`
    // and every caller speak backslashes, so a `dir` compared as a string
    // never matched and no document was ever found there.
    const manifests = [...new Set([...legacy, ...projects].map((path) => resolve(path)))]
    for (const path of manifests.sort()) {
      if (found.some((doc) => doc.path === path)) continue
      // Discovery is best-effort: it is scanning directories it does not own,
      // so a manifest that cannot be read or parsed is skipped, not fatal.
      let parsed: unknown
      try {
        parsed = JSON.parse(await readFile(path, 'utf8'))
      } catch {
        continue
      }
      if (typeof parsed !== 'object' || parsed === null) continue
      const { id, files } = parsed as { id?: unknown; files?: unknown }
      if (typeof id !== 'string' || !Array.isArray(files)) continue

      const dir = dirname(path)
      const members = await glob(files as string[], {
        cwd: dir,
        absolute: false,
        ignore: ['**/node_modules/**'],
      })
      found.push({ path, dir, id, globs: files as string[], files: [...new Set(members)].sort() })
    }
  }
  return found
}

/**
 * The viewer knows a document's id but never its path on disk, so the service
 * resolves the two itself rather than asking the uidx server to grow a field.
 *
 * The viewer sends both an id and the open page with every message, so both are
 * used, in that order: the id names the document, and the page settles which
 * *copy* of it — several checkouts of one design share an id, and there is no
 * point failing on an ambiguity the caller already told us how to resolve.
 */
export function matchDocument(found: readonly FoundDoc[], hint: DocumentHint): FoundDoc {
  const holdsPage = (doc: FoundDoc): boolean =>
    hint.page !== undefined && doc.files.includes(hint.page)

  const byId = hint.id === undefined ? [] : found.filter((doc) => doc.id === hint.id)
  if (byId.length === 1) return byId[0]!
  if (byId.length > 1) {
    const narrowed = byId.filter(holdsPage)
    if (narrowed.length === 1) return narrowed[0]!
    throw new Error(ambiguous(byId.length, `id "${hint.id}"`, hint))
  }

  const byPage = found.filter(holdsPage)
  if (byPage.length === 1) return byPage[0]!
  if (byPage.length > 1) {
    throw new Error(ambiguous(byPage.length, `page "${hint.page}"`, hint))
  }

  const asked = hint.id ?? hint.page ?? '(nothing)'
  throw new Error(`no uidx document matched ${asked}`)
}

/**
 * Why the service cannot tell two documents apart, and what would fix it.
 *
 * Deliberately carries no paths. This text reaches whoever called the route,
 * and where the designer keeps their work is not something an error has to
 * hand over to say what went wrong.
 */
function ambiguous(count: number, named: string, hint: DocumentHint): string {
  const page =
    hint.page === undefined
      ? 'the viewer sent no open page to narrow it'
      : `the open page "${hint.page}" did not narrow it`
  return (
    `${count} uidx documents match ${named}, and ${page}. ` +
    'Start the agent with UIDX_AGENT_ROOTS pointing at the one you are working in, ' +
    'or give the copies distinct "id" values in their uidx.json.'
  )
}
