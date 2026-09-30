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
  if (diagnostics.length) return { out: config.out, written: [], diagnostics }

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
  const result = generate({
    pages,
    tokens,
    manifest,
    library,
    targets: config.targets as Target[] | undefined,
  })
  diagnostics.push(...result.diagnostics)
  if (result.diagnostics.some((d) => d.severity === 'error'))
    return { out: config.out, written: [], diagnostics }

  const written: string[] = []
  for (const [path, text] of result.files) {
    const target = resolve(found.dir, config.out, path)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, text)
    written.push(path)
  }
  return { out: config.out, written, diagnostics }
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
  const configure = (server: MiddlewareHost): void => {
    server.middlewares.use(CODEGEN_ROUTE, (req, res) => {
      void handle(req, res)
    })
  }
  return { name: 'uidx:codegen', configureServer: configure, configurePreviewServer: configure }
}
