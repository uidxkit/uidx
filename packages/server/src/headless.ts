import { readFile, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve, sep } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { FoundManifest, HeadlessConfig } from './document.js'
import type { MiddlewareHost, ViewerPlugin } from './static-viewer.js'

export const HEADLESS_ROUTE = '/__uidx/headless'

/** A library a dependency ships, found by its `customElements` field. */
export interface HeadlessCandidate {
  /** The npm package name. */
  package: string
  /** Its manifest, relative to `uidx.json`, ready to write as `headless`. */
  path: string
}

/**
 * What the viewer receives for the headless library (ADR 0013 §3).
 *
 * `path` is the manifest's own word for where the library is, relative to
 * `uidx.json`, so the panel can say which file its choices come from. `null`
 * means the document declared none — a state, not an error — and then
 * `candidates` lists the libraries the project's dependencies ship, so the
 * panel can offer them instead of a path to type.
 */
export interface HeadlessResponse {
  path: string | null
  /** The `custom-elements.json` as written; the viewer reads the slice it needs. */
  library?: unknown
  profile?: Record<string, string>
  bindings?: Record<string, unknown>
  candidates: HeadlessCandidate[]
}

/**
 * The libraries this project depends on, by the Custom Elements Manifest
 * convention: a package that ships one names it in its `package.json` as
 * `"customElements": "custom-elements.json"`. The nearest `package.json` at
 * or above `uidx.json` is the project's; each dependency is looked up under
 * its `node_modules`, which is where a direct dependency resolves under npm,
 * pnpm and yarn alike. A dependency that is not installed is skipped.
 */
export async function discoverHeadless(dir: string): Promise<HeadlessCandidate[]> {
  let projectDir = dir
  let project: Record<string, unknown> | undefined
  for (;;) {
    try {
      project = JSON.parse(await readFile(resolve(projectDir, 'package.json'), 'utf8')) as Record<
        string,
        unknown
      >
      break
    } catch {
      const parent = dirname(projectDir)
      if (parent === projectDir) return []
      projectDir = parent
    }
  }
  const names = new Set<string>()
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies']) {
    const entries = project[field]
    if (entries && typeof entries === 'object')
      for (const name of Object.keys(entries)) names.add(name)
  }
  const out: HeadlessCandidate[] = []
  for (const name of [...names].sort()) {
    const packageDir = resolve(projectDir, 'node_modules', ...name.split('/'))
    try {
      const meta = JSON.parse(await readFile(resolve(packageDir, 'package.json'), 'utf8')) as {
        customElements?: unknown
      }
      if (typeof meta.customElements !== 'string' || meta.customElements === '') continue
      const manifest = resolve(packageDir, meta.customElements)
      await readFile(manifest, 'utf8')
      out.push({ package: name, path: relative(dir, manifest).split(sep).join('/') })
    } catch {
      continue
    }
  }
  return out
}

/**
 * Writes `headless` into `uidx.json`, keeping every other field as it is.
 *
 * Re-serialised with two-space indentation rather than patched as text: the
 * file is small, hand-written JSON, and a formatter pass is what an editor
 * would do to it too. A configured profile or bindings survive the change
 * of manifest; a plain string stays a plain string.
 */
export async function writeHeadless(found: FoundManifest, manifestPath: string): Promise<void> {
  const raw = JSON.parse(await readFile(found.path, 'utf8')) as Record<string, unknown>
  const current = raw.headless
  raw.headless =
    typeof current === 'object' && current !== null && !Array.isArray(current)
      ? { ...(current as Record<string, unknown>), manifest: manifestPath }
      : manifestPath
  await writeFile(found.path, `${JSON.stringify(raw, null, 2)}\n`)
  found.manifest.headless = { ...(found.manifest.headless ?? {}), manifest: manifestPath }
}

async function limitedBody(request: IncomingMessage, limit = 4096): Promise<string> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request as AsyncIterable<Buffer>) {
    size += chunk.length
    if (size > limit) throw new Error('The request is too large.')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString()
}

/**
 * Serves the document's headless library to the viewer, and lets the viewer
 * choose one.
 *
 * Read on every request rather than cached: the library is a build artefact
 * of another repository, and a designer who re-syncs it should see the new
 * elements on the next reload without restarting the server. Same holder
 * indirection as the font and asset routes, for the same reason — the route
 * registers before the workspace resolves.
 */
export function headlessRoutePlugin(manifest: { current: FoundManifest | null }): ViewerPlugin {
  const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    response.setHeader('cache-control', 'no-store')
    response.setHeader('content-type', 'application/json')
    const found = manifest.current
    if (!found) {
      response.statusCode = 404
      response.end(JSON.stringify({ error: 'Open a uidx project to read its headless library.' }))
      return
    }
    try {
      if (request.method === 'PUT') {
        const origin = request.headers.origin
        if (
          request.headers['sec-fetch-site'] === 'cross-site' ||
          (origin && new URL(origin).host !== request.headers.host)
        ) {
          response.statusCode = 403
          response.end(JSON.stringify({ error: 'The library choice must come from this viewer.' }))
          return
        }
        const input = JSON.parse(await limitedBody(request)) as { path?: unknown }
        if (typeof input.path !== 'string' || input.path === '' || input.path.includes('\0')) {
          response.statusCode = 400
          response.end(JSON.stringify({ error: 'Name the custom-elements.json to use.' }))
          return
        }
        await readFile(resolve(found.dir, input.path), 'utf8')
        await writeHeadless(found, input.path)
      } else if (request.method !== 'GET') {
        response.statusCode = 405
        response.end(JSON.stringify({ error: 'The headless library is read, or chosen with PUT.' }))
        return
      }
      const config: HeadlessConfig | undefined = found.manifest.headless
      if (config === undefined) {
        const candidates = await discoverHeadless(found.dir)
        response.end(JSON.stringify({ path: null, candidates } satisfies HeadlessResponse))
        return
      }
      const raw = await readFile(resolve(found.dir, config.manifest), 'utf8')
      const library: unknown = JSON.parse(raw)
      response.end(
        JSON.stringify({
          path: config.manifest,
          library,
          ...(config.profile ? { profile: config.profile } : {}),
          ...(config.bindings ? { bindings: config.bindings } : {}),
          candidates: [],
        } satisfies HeadlessResponse),
      )
    } catch (error) {
      response.statusCode = 400
      response.end(
        JSON.stringify({
          error: `Could not read the headless library: ${
            error instanceof Error ? error.message : String(error)
          }`,
        }),
      )
    }
  }
  const configure = (server: MiddlewareHost): void => {
    server.middlewares.use(HEADLESS_ROUTE, (req, res) => {
      void handle(req, res)
    })
  }
  return { name: 'uidx:headless', configureServer: configure, configurePreviewServer: configure }
}
