import { lstat, mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type { Plugin, ViteDevServer } from 'vite'
import picomatch from 'picomatch'
import { parseOrThrow } from '@uidx/format'
import { membershipRoots, type Workspace } from './workspace.js'

class PageError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

/** Page names become filenames; callers never supply a write path. */
async function createPage(workspace: Workspace, value: unknown): Promise<string> {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 100) {
    throw new PageError(400, 'Enter a page name of 1–100 characters.')
  }
  const name = value.trim()
  if (/[\p{Cc}/\\]/u.test(value)) {
    throw new PageError(400, 'Page names cannot contain slashes or control characters.')
  }
  const stem = name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  if (!stem || Buffer.byteLength(stem) > 240) {
    throw new PageError(400, 'Use a shorter name containing Latin letters or numbers.')
  }
  const globs = workspace.manifest.manifest.files
  const included = picomatch(globs.filter((glob) => !glob.startsWith('!')))
  const excluded = picomatch(
    globs.filter((glob) => glob.startsWith('!')).map((glob) => glob.slice(1)),
  )
  const dirs = [...new Set(['', ...membershipRoots(globs).dirs, ...workspace.pages.map(dirname)])]
  const file = dirs
    .map((dir) => `${dir && dir !== '.' ? `${dir}/` : ''}${stem}.uidx`)
    .find(
      (candidate) =>
        candidate
          .split('/')
          .every(
            (part) =>
              part !== '' &&
              part !== 'node_modules' &&
              !part.startsWith('.') &&
              !part.includes('\\') &&
              !part.includes(':'),
          ) &&
        included(candidate) &&
        !excluded(candidate),
    )
  if (!file)
    throw new PageError(422, 'The configured files patterns do not allow a page with this name.')

  // Walk one directory at a time. Never follow a symlink out of the document.
  let dir = workspace.manifest.dir
  for (const part of file.split('/').slice(0, -1)) {
    dir = resolve(dir, part)
    try {
      await mkdir(dir)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
    const stat = await lstat(dir)
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new PageError(
        422,
        'The page folder must be a directory inside this document, not a symlink.',
      )
    }
  }
  const source = `---\nid: ${JSON.stringify(stem)}\n---\n\n## Core Intent\n\nDescribe what this page is for.\n\n## Visual Contract\n\n<Page>\n</Page>\n`
  parseOrThrow(source)
  try {
    // Exclusive creation also prevents overwriting a file created by another client.
    await writeFile(resolve(workspace.manifest.dir, file), source, { flag: 'wx' })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new PageError(409, 'A page with this filename already exists. Choose another name.')
    }
    throw error
  }
  await workspace.refreshMembers()
  return file
}

export function pagesRoutePlugin(holder: { current: Workspace | null }): Plugin {
  const configure = (server: Pick<ViteDevServer, 'middlewares'>): void => {
    server.middlewares.use('/__uidx/pages', (request, response) => {
      const answer = (status: number, body: object): void => {
        response.writeHead(status, {
          'content-type': 'application/json',
          'cache-control': 'no-store',
        })
        response.end(JSON.stringify(body))
      }
      if (request.method !== 'POST') return answer(405, { error: 'Use POST to create a page.' })
      const workspace = holder.current
      if (!workspace)
        return answer(503, { error: 'The document is not ready. Try again once connected.' })
      const chunks: Buffer[] = []
      let size = 0
      let rejected = false
      request.on('data', (chunk: Buffer) => {
        if (rejected) return
        size += chunk.length
        if (size > 4096) {
          rejected = true
          chunks.length = 0
          answer(413, { error: 'Page requests must be at most 4 KiB.' })
        } else chunks.push(chunk)
      })
      request.on('end', () => {
        if (rejected) return
        let body: unknown
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        } catch {
          return answer(400, { error: 'The body must be JSON.' })
        }
        void createPage(workspace, (body as { name?: unknown } | null)?.name).then(
          (file) => answer(201, { file }),
          (error: unknown) =>
            answer(error instanceof PageError ? error.status : 500, {
              error:
                error instanceof PageError
                  ? error.message
                  : 'Could not create the page. Check the design folder’s permissions and try again.',
            }),
        )
      })
    })
  }
  return { name: 'uidx:pages', configureServer: configure, configurePreviewServer: configure }
}
