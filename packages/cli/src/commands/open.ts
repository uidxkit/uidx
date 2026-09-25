import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { readFile, stat } from 'node:fs/promises'
import { dirname, relative, resolve, sep } from 'node:path'
import { createProjectMcpHttp } from '@uidx/agent/mcp/http'
import { readProjectConfig } from '@uidx/agent/core'
import { formatDiagnostic, parse } from '@uidx/format'
import { createUidxServer, type UidxServer } from '@uidx/server'
import {
  findManifest,
  documentMembers,
  readManifest,
  isMember,
  loadDocument,
  MANIFEST_NAME,
  ManifestError,
  type LoadedDocument,
} from '@uidx/server/document'

import { exists, findProjectRoot, PROJECT_DIR, projectContentRoot } from '../project.js'
import { initProject } from './init.js'

export interface OpenOptions {
  port?: number
  /** Viewer project root. */
  root?: string
  /** Use the source viewer and hot reload even when a build exists. */
  viewerDev?: boolean
  launchBrowser?: boolean
  cwd?: string
  verbose?: boolean
  /**
   * Escape hatch for opening a page that is not in a document. Off by default:
   * a silent single-file fallback would work until the first cross-page
   * reference and then fail invisibly.
   */
  requireDocument?: boolean
}

export interface OpenResult {
  /**
   * The project root whose workspace this run created, or null when one
   * already existed. npm now blocks install scripts unless they are approved,
   * so the postinstall that used to do this setup cannot be relied on; the
   * first `uidx dev` does it instead, and says so.
   */
  initialized: string | null
  server: UidxServer
  url: string | null
  /** Null only when `requireDocument` is false. */
  document: LoadedDocument | null
}

export class BootError extends Error {
  constructor(readonly lines: string[]) {
    super(lines.join('\n'))
    this.name = 'BootError'
  }
}

/**
 * Resolve the project or page, load the document, then start its server.
 *
 * An explicit broken page fails with diagnostics before boot. A project can
 * still open its overview, where each broken page carries its own diagnostics.
 */
export async function open(file = '.', options: OpenOptions = {}): Promise<OpenResult> {
  const cwd = options.cwd ?? process.cwd()
  const target = resolve(cwd, file)
  const browse = (await stat(target).catch(() => null))?.isDirectory() ?? false
  const { path, initialized } = await resolveEntry(target)

  let source: string
  try {
    source = await readFile(path, 'utf8')
  } catch (err) {
    throw new BootError([`cannot read ${file}: ${(err as Error).message}`])
  }

  const started = performance.now()
  const { doc, diagnostics } = parse(source)
  if (!doc && !browse) {
    throw new BootError(diagnostics.map((d) => formatDiagnostic(d, file)))
  }
  if (options.verbose) {
    process.stderr.write(`parsed ${file} in ${(performance.now() - started).toFixed(1)}ms\n`)
  }

  const document = await resolveDocument(path, file, options)
  if (options.verbose && document) {
    process.stderr.write(
      `document "${document.manifest.id}" — ${document.pages.length} page(s), ` +
        `read ${document.readMs.toFixed(1)}ms, parse ${document.parseMs.toFixed(1)}ms\n`,
    )
  }

  const config = document ? await readProjectConfig(document.dir) : undefined
  const viewer = resolveViewerRoot()
  const viewerDist =
    !options.viewerDev && viewer && (await exists(resolve(viewer.dist, 'index.html')))
      ? viewer.dist
      : undefined
  if (
    options.viewerDev &&
    !(await exists(resolve(options.root ?? viewer?.root ?? '', 'src/main.ts')))
  ) {
    throw new BootError([
      '--viewer-dev requires a local uidx source checkout. Installed packages serve the prebuilt viewer.',
    ])
  }
  const server = await createUidxServer({
    file: path,
    port: options.port ?? config?.port,
    mcp: document ? createProjectMcpHttp(document.dir) : undefined,
    root: options.root ?? viewer?.root,
    viewerDist: options.root ? undefined : viewerDist,
    log: options.verbose ? (text) => process.stderr.write(`${text}\n`) : undefined,
  })

  // A project opens its overview; only an explicit file asks for a canvas page.
  let url = server.url
  if (url && document && !browse) {
    const pageUrl = new URL(url)
    pageUrl.searchParams.set('page', relative(document.dir, path).split(sep).join('/'))
    url = pageUrl.toString()
  }
  if (options.launchBrowser && url) launch(url)
  return { server, url, document, initialized }
}

/** Fail before boot when a page cannot resolve its document-wide symbols. */
async function resolveDocument(
  path: string,
  file: string,
  options: OpenOptions,
): Promise<LoadedDocument | null> {
  if (options.requireDocument === false) return null

  let found
  try {
    found = await findManifest(path)
  } catch (err) {
    if (err instanceof ManifestError) throw new BootError(err.lines)
    throw err
  }

  if (!found) {
    throw new BootError([
      `${file} is not inside a uidx document.`,
      `Create a ${MANIFEST_NAME} at the root of your workspace:`,
      '',
      '  { "id": "workspace", "files": ["**/*.uidx"] }',
      '',
      'Component names and design tokens are global to a document (ADR 0004),',
      'so there is no way to resolve them from a single file.',
    ])
  }

  const document = await loadDocument(found)
  const members = document.pages.map((p) => p.file)
  if (!isMember(found, members, path)) {
    throw new BootError([
      `${file} is not a member of document "${found.manifest.id}".`,
      `Add it to the "files" globs in ${found.path}.`,
    ])
  }
  return document
}

/** Resolve installed assets independently of the consuming project's cwd. */
function resolveViewerRoot(): { root: string; dist: string } | undefined {
  try {
    const require = createRequire(import.meta.url)
    const root = dirname(require.resolve('@uidx/viewer/package.json'))
    return { root, dist: resolve(root, 'dist') }
  } catch {
    return undefined
  }
}

/** Resolve a project or document directory without depending on its first filename. */
async function resolveEntry(target: string): Promise<{ path: string; initialized: string | null }> {
  const info = await stat(target).catch(() => null)
  if (!info?.isDirectory()) return { path: target, initialized: null }
  let content = (await exists(resolve(target, '.uidx', MANIFEST_NAME)))
    ? resolve(target, '.uidx')
    : (await exists(resolve(target, MANIFEST_NAME)))
      ? target
      : await projectContentRoot(target)
  let initialized: string | null = null
  if (!content) {
    // An npm project with no workspace yet: the install script that would
    // have set it up did not run — npm blocks install scripts unless they
    // are approved — so the first run does the same setup itself.
    const root = await findProjectRoot(target)
    if (!root) {
      throw new BootError(['No uidx workspace found. Run uidx init inside your project first.'])
    }
    try {
      initialized = await initProject(target)
    } catch (error) {
      throw new BootError([
        `No uidx workspace found, and setting one up failed: ${(error as Error).message}`,
        'Run uidx init inside your project, with --script <name> if the default script name is taken.',
      ])
    }
    content = resolve(initialized, PROJECT_DIR)
  }
  const path = resolve(content, MANIFEST_NAME)
  const found = { path, dir: content, manifest: await readManifest(path) }
  const members = await documentMembers(found)
  // The entry only primes the canvas. The overview includes every member,
  // including pages with diagnostics, so one broken page cannot block browsing.
  for (const member of members) {
    const file = resolve(content, member)
    const result = parse(await readFile(file, 'utf8'))
    if (!result.doc || result.doc.tree.element !== 'Tokens') return { path: file, initialized }
  }
  if (members[0]) return { path: resolve(content, members[0]), initialized }
  throw new BootError([`No .uidx pages are declared in ${path}. Add a page inside ${content}.`])
}

function launch(url: string): void {
  const command =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open'
  try {
    const child = spawn(command, [url], {
      stdio: 'ignore',
      detached: true,
      shell: process.platform === 'win32',
    })
    // A missing launcher — a container, a headless dev box — arrives as an
    // asynchronous `error` event, which no `try/catch` around `spawn` can see.
    // Unhandled it throws, and the server dies seconds after printing the URL
    // it was serving. The handler is what makes the comment below true.
    child.on('error', () => {})
    child.unref()
  } catch {
    // Not being able to launch a browser is not a reason to fail the command;
    // the URL is on stdout either way.
  }
}
