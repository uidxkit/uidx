import { lstat, mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type { MiddlewareHost, ViewerPlugin } from './static-viewer.js'
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

/** What a new file holds: a canvas, one component's identity, or the tokens. */
export type NewFileKind = 'page' | 'component' | 'tokens'

const pascal = (text: string): string =>
  text
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join('')
    .replace(/^[0-9]+/, '')

/** The starting source for each kind — valid, and saying what to write next. */
export function starterSource(kind: NewFileKind, stem: string, name: string): string {
  const front = `---\nid: ${JSON.stringify(stem)}\n---\n\n`
  if (kind === 'tokens') {
    return `${front}The design system's foundations: name each collection after what it holds, and give a collection modes (light and dark) when its values change with them.\n\n## Visual Contract\n\n<Tokens>\n  <Collection name="color">\n    <Variable name="accent" type="COLOR" value={{ r: 0.145, g: 0.388, b: 0.922, a: 1 }} />\n  </Collection>\n  <Collection name="space">\n    <Variable name="md" type="FLOAT" value={12} />\n  </Collection>\n</Tokens>\n`
  }
  if (kind === 'component') {
    const component = pascal(name) || 'Component'
    return `${front}Describe what ${component} is for, and when to reach for something else.\n\n## Visual Contract\n\n<Page>\n  <Component name="${component}" status="draft"\n    layoutMode="HORIZONTAL" primaryAxisSizingMode="AUTO" counterAxisSizingMode="AUTO"\n    primaryAxisAlignItems="CENTER" counterAxisAlignItems="CENTER"\n    paddingLeft={12} paddingRight={12} paddingTop={8} paddingBottom={8} cornerRadius={6}\n    fills={[{ type: 'SOLID', color: { r: 0.933, g: 0.941, b: 0.957, a: 1 } }]}>\n    <Text name="label" characters="{label}" fontSize={14} />\n  </Component>\n</Page>\n\n## Contract\n\n<Props>\n  <Prop name="label" type="string" sample="${component}">The words it shows.</Prop>\n</Props>\n`
  }
  return `${front}## Core Intent\n\nDescribe what this page is for.\n\n## Visual Contract\n\n<Page>\n</Page>\n`
}

/** Page names become filenames; callers never supply a write path. */
async function createPage(
  workspace: Workspace,
  value: unknown,
  kind: NewFileKind = 'page',
): Promise<string> {
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
  const source = starterSource(kind, stem, name)
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

export function pagesRoutePlugin(holder: { current: Workspace | null }): ViewerPlugin {
  const configure = (server: MiddlewareHost): void => {
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
        const request_ = body as { name?: unknown; kind?: unknown } | null
        const kind = request_?.kind ?? 'page'
        if (kind !== 'page' && kind !== 'component' && kind !== 'tokens')
          return answer(400, { error: 'A new file is a page, a component or tokens.' })
        void createPage(workspace, request_?.name, kind).then(
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
