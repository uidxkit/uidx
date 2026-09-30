import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { FoundManifest } from './document.js'
import type { MiddlewareHost, ViewerPlugin } from './static-viewer.js'

export const HEADLESS_ROUTE = '/__uidx/headless'

/**
 * What the viewer receives for the headless library (ADR 0013 §3).
 *
 * `path` is the manifest's own word for where the library is, relative to
 * `uidx.json`, so the panel can say which file its choices come from. `null`
 * means the document declared none — a state, not an error, and the panel
 * says how to declare one.
 */
export interface HeadlessResponse {
  path: string | null
  /** The `custom-elements.json` as written; the viewer reads the slice it needs. */
  library?: unknown
}

/**
 * Serves the document's `custom-elements.json` to the viewer.
 *
 * Read on every request rather than cached: the library is a build artefact of
 * another repository, and a designer who re-syncs it should see the new
 * elements on the next reload without restarting the server. Same holder
 * indirection as the font and asset routes, for the same reason — the route
 * registers before the workspace resolves.
 */
export function headlessRoutePlugin(manifest: { current: FoundManifest | null }): ViewerPlugin {
  const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    response.setHeader('cache-control', 'no-store')
    response.setHeader('content-type', 'application/json')
    if (request.method !== 'GET') {
      response.statusCode = 405
      response.end(JSON.stringify({ error: 'The headless library is read-only.' }))
      return
    }
    const found = manifest.current
    if (!found) {
      response.statusCode = 404
      response.end(JSON.stringify({ error: 'Open a uidx project to read its headless library.' }))
      return
    }
    const declared = found.manifest.headless
    if (declared === undefined) {
      response.end(JSON.stringify({ path: null } satisfies HeadlessResponse))
      return
    }
    try {
      const raw = await readFile(resolve(found.dir, declared), 'utf8')
      const library: unknown = JSON.parse(raw)
      response.end(JSON.stringify({ path: declared, library } satisfies HeadlessResponse))
    } catch (error) {
      response.statusCode = 400
      response.end(
        JSON.stringify({
          error: `Could not read the headless library at ${declared}: ${
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
