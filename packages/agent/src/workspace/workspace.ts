import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import { once } from 'node:events'
import { join } from 'node:path'
import { parse, type Diagnostic, type UidxDocument } from '@uidx/format'
import chokidar, { type FSWatcher } from 'chokidar'

import type { FoundDoc } from './discover.js'

export interface Workspace {
  root: string
  manifestId: string
  members(): readonly string[]
  docOf(file: string): UidxDocument | null
  sourceOf(file: string): string | null
  docs(): ReadonlyMap<string, UidxDocument>
  diagnosticsOf(file: string): readonly Diagnostic[]
  /** Re-read one file from disk. */
  reload(file: string): Promise<void>
  /** Drop a page from the index without touching disk. */
  forget(file: string): void
  /**
   * Write atomically, then adopt the result. A caller that already holds the
   * parse of `source` — `applyOps` does, from the patcher's validating parse —
   * passes it so the index does not parse the same text again.
   */
  writeFile(file: string, source: string, parsed?: UidxDocument): Promise<void>
  /** Take a source and its parse as the page's current state without touching disk. */
  adopt?(file: string, source: string, parsed?: UidxDocument): void
  removeFile(file: string): Promise<void>
  close(): Promise<void>
}

interface PageState {
  source: string
  doc: UidxDocument | null
  diagnostics: Diagnostic[]
}

/**
 * Writes go to a temp sibling and are renamed into place, so a reader never
 * sees half a file. The temp name deliberately does not end in `.uidx`, or the
 * manifest glob would pick it up mid-write.
 */
async function writeAtomically(path: string, source: string): Promise<void> {
  const temp = `${path}.agent-tmp`
  await writeFile(temp, source, 'utf8')
  await rename(temp, path)
}

export async function openWorkspace(found: FoundDoc): Promise<Workspace> {
  const pages = new Map<string, PageState>()

  const adopt = (file: string, source: string, parsed?: UidxDocument): void => {
    if (parsed && parsed.source === source) {
      pages.set(file, { source, doc: parsed, diagnostics: [] })
      return
    }
    const result = parse(source)
    pages.set(file, { source, doc: result.doc, diagnostics: result.diagnostics })
  }

  const readInto = async (file: string): Promise<void> => {
    adopt(file, await readFile(join(found.dir, file), 'utf8'))
  }

  await Promise.all(found.files.map(readInto))

  // Watching keeps the index honest when the *user* edits on canvas.
  const watcher: FSWatcher = chokidar.watch(found.dir, {
    ignored: (path) => path.includes('node_modules') || path.includes('.uidx-agent'),
    ignoreInitial: true,
  })
  const relative = (path: string): string => path.slice(found.dir.length + 1)
  const reread = (path: string): void => {
    if (path.endsWith('.uidx')) void readInto(relative(path)).catch(() => undefined)
  }
  watcher.on('change', reread)
  // A page the designer *added* on canvas counts as much as one they edited.
  // Without this the index only ever shrank after `openWorkspace`, so a new
  // page was invisible to `read`, to `search`, and to the doc map — the model
  // was told a page it could see on screen did not exist.
  watcher.on('add', reread)
  watcher.on('unlink', (path) => {
    if (path.endsWith('.uidx')) pages.delete(relative(path))
  })

  // Do not expose the workspace until external edits can be observed. Changes
  // made during chokidar's initial scan are otherwise swallowed by ignoreInitial.
  try {
    await once(watcher, 'ready')
  } catch (error) {
    await watcher.close()
    throw error
  }

  return {
    root: found.dir,
    manifestId: found.id,
    members: () => [...pages.keys()].sort(),
    docOf: (file) => pages.get(file)?.doc ?? null,
    sourceOf: (file) => pages.get(file)?.source ?? null,
    docs: () => {
      const live = new Map<string, UidxDocument>()
      for (const [file, state] of pages) if (state.doc) live.set(file, state.doc)
      return live
    },
    diagnosticsOf: (file) => pages.get(file)?.diagnostics ?? [],
    reload: readInto,
    forget: (file) => {
      pages.delete(file)
    },
    writeFile: async (file, source, parsed) => {
      await writeAtomically(join(found.dir, file), source)
      adopt(file, source, parsed)
    },
    adopt,
    removeFile: async (file) => {
      await rm(join(found.dir, file), { force: true })
      pages.delete(file)
    },
    close: async () => {
      await watcher.close()
    },
  }
}
