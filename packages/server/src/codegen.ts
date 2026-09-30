import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { parse, type Diagnostic, type UidxDocument } from '@uidx/format'
import {
  generate,
  type LibraryBindings,
  type Manifest as ElementsManifest,
  type Target,
} from '@uidx/codegen'
import { documentMembers, type FoundManifest } from './document.js'
import type { MiddlewareHost, ViewerPlugin } from './static-viewer.js'

export const CODEGEN_ROUTE = '/__uidx/codegen'
export const PREVIEW_ROUTE = '/__uidx/preview'

export interface CodegenRun {
  /** Where the files went, as `uidx.json` spells it. */
  out: string
  /** Every path written, relative to `out`. Empty when an error stopped the run. */
  written: string[]
  diagnostics: (Diagnostic & { file: string })[]
}

/**
 * Renders the document's code targets into `codegen.out` (ADR 0017 §3):
 * the same generator, over the same pages, with the same library that
 * `uidx codegen` uses, so the viewer's button and the command line never
 * disagree. A page that does not parse, or a contract the library
 * contradicts, stops the run before anything is written — a half-written
 * `generated/` is worse than an old one.
 */
export async function runCodegen(found: FoundManifest): Promise<CodegenRun> {
  const config = found.manifest.codegen
  if (!config) throw new Error('uidx.json names no "codegen": { "out": … } to write into')
  const rendered = await renderDocument(found, config.targets as Target[] | undefined)
  if (!rendered.ok) return { out: config.out, written: [], diagnostics: rendered.diagnostics }
  const { result, diagnostics } = rendered
  const written: string[] = []
  for (const [path, text] of result.files) {
    const target = resolve(found.dir, config.out, path)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, text)
    written.push(path)
  }
  return { out: config.out, written, diagnostics }
}

/** The document's pages rendered by the code targets, or the diagnostics that stopped them. */
async function renderDocument(
  found: FoundManifest,
  targets: Target[] | undefined,
): Promise<
  | { ok: true; result: ReturnType<typeof generate>; diagnostics: CodegenRun['diagnostics'] }
  | { ok: false; diagnostics: CodegenRun['diagnostics'] }
> {
  const files = await documentMembers(found)
  const pages: { file: string; doc: UidxDocument }[] = []
  const tokens: UidxDocument[] = []
  const diagnostics: CodegenRun['diagnostics'] = []
  for (const file of files) {
    const { doc, diagnostics: found_ } = parse(await readFile(resolve(found.dir, file), 'utf8'))
    for (const d of found_) if (d.severity === 'error') diagnostics.push({ ...d, file })
    if (!doc) continue
    if (doc.tree.element === 'Tokens') tokens.push(doc)
    else pages.push({ file, doc })
  }
  if (diagnostics.length) return { ok: false, diagnostics }

  const headless = found.manifest.headless
  let manifest: ElementsManifest | undefined
  let library: LibraryBindings | undefined
  if (headless) {
    manifest = JSON.parse(
      await readFile(resolve(found.dir, headless.manifest), 'utf8'),
    ) as ElementsManifest
    library = {
      profile: headless.profile as LibraryBindings['profile'],
      components: headless.bindings as LibraryBindings['components'],
    }
  }
  const result = generate({ pages, tokens, manifest, library, targets })
  diagnostics.push(...result.diagnostics)
  if (result.diagnostics.some((d) => d.severity === 'error')) return { ok: false, diagnostics }
  return { ok: true, result, diagnostics }
}

/**
 * One component as the HTML/CSS target renders it, as a page: the tokens,
 * every generated stylesheet and the component's markup fragment. The Docs
 * face shows it beside the canvas's drawing, so a difference between what
 * is designed and what ships is visible where the component is read.
 * Static: behaviour is the headless library's, and this page loads none.
 */
export async function previewPage(found: FoundManifest, stem: string): Promise<string | null> {
  const rendered = await renderDocument(found, ['html'])
  if (!rendered.ok) return null
  const files = rendered.result.files
  const fragment = files.get(`html/${stem}.html`)
  if (fragment === undefined) return null
  const styles = [...files]
    .filter(([path]) => path.endsWith('.css'))
    .map(([, text]) => text)
    .join('\n')
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${stem}</title>
<style>
body { margin: 0; padding: 24px; font-family: Inter, system-ui, sans-serif; background: #f5f5f5; }
${styles}
</style></head>
<body>
${fragment}
</body></html>
`
}

/** `GET` says whether generation is configured and where; `POST` runs it. */
export function codegenRoutePlugin(manifest: { current: FoundManifest | null }): ViewerPlugin {
  const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    response.setHeader('cache-control', 'no-store')
    response.setHeader('content-type', 'application/json')
    const found = manifest.current
    if (!found) {
      response.statusCode = 404
      response.end(JSON.stringify({ error: 'Open a uidx project to generate its code.' }))
      return
    }
    const config = found.manifest.codegen
    if (request.method === 'GET') {
      response.end(JSON.stringify({ configured: config !== undefined, out: config?.out ?? null }))
      return
    }
    if (request.method !== 'POST') {
      response.statusCode = 405
      response.end(JSON.stringify({ error: 'GET to ask, POST to generate.' }))
      return
    }
    const origin = request.headers.origin
    if (
      request.headers['sec-fetch-site'] === 'cross-site' ||
      (origin && new URL(origin).host !== request.headers.host)
    ) {
      response.statusCode = 403
      response.end(JSON.stringify({ error: 'Code generation must come from this viewer.' }))
      return
    }
    if (!config) {
      response.statusCode = 400
      response.end(
        JSON.stringify({
          error: 'Add "codegen": { "out": "…" } to uidx.json to say where generated code goes.',
        }),
      )
      return
    }
    try {
      response.end(JSON.stringify(await runCodegen(found)))
    } catch (error) {
      response.statusCode = 400
      response.end(
        JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      )
    }
  }
  const preview = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    response.setHeader('cache-control', 'no-store')
    const found = manifest.current
    const stem = new URL(request.url ?? '/', 'http://local').searchParams.get('component') ?? ''
    const page =
      found && /^[\w-]+$/.test(stem) ? await previewPage(found, stem).catch(() => null) : null
    if (page === null) {
      response.statusCode = 404
      response.setHeader('content-type', 'text/plain; charset=utf-8')
      response.end('No generated markup for that component.')
      return
    }
    response.setHeader('content-type', 'text/html; charset=utf-8')
    response.end(page)
  }
  const configure = (server: MiddlewareHost): void => {
    server.middlewares.use(CODEGEN_ROUTE, (req, res) => {
      void handle(req, res)
    })
    server.middlewares.use(PREVIEW_ROUTE, (req, res) => {
      void preview(req, res)
    })
  }
  return { name: 'uidx:codegen', configureServer: configure, configurePreviewServer: configure }
}
