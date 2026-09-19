import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { extname, resolve, sep } from 'node:path'

/**
 * The prebuilt viewer, served without Vite.
 *
 * The viewer a consumer installs is a folder of static files plus a handful
 * of local routes — fonts, assets, pages, selection, patches, MCP. Serving
 * that through `vite preview` made Vite a *runtime* dependency of the shipped
 * package, and Vite 8 runs on native binaries (rolldown, lightningcss) that
 * arrive as one optional package per platform. Any consumer whose install
 * missed the binding for its platform — a lockfile made on another OS,
 * optional dependencies switched off, an unsupported libc — failed on the
 * first `uidx` command with ERR_MODULE_NOT_FOUND, before a single design was
 * read. Node's own HTTP server needs none of that.
 *
 * The route plugins are kept in Vite's plugin shape so the `--viewer-dev`
 * path, which still boots a Vite dev server from a source checkout, can hand
 * them over unchanged. What they use of Vite is one thing: a connect-style
 * `middlewares.use`, which this module reproduces with connect's rules —
 * a mount path is matched case-insensitively up to a boundary, stripped from
 * `request.url` for the handler, and put back before the next layer.
 */

export type NextFunction = (error?: unknown) => void
export type Middleware = (
  request: IncomingMessage,
  response: ServerResponse,
  next: NextFunction,
) => void

/** The slice of Vite's connect app the route plugins use. */
export interface MiddlewareHost {
  middlewares: {
    use(handler: Middleware): unknown
    use(route: string, handler: Middleware): unknown
  }
}

/** A route plugin: Vite's shape, so the dev server can take it as-is. */
export interface ViewerPlugin {
  name: string
  enforce?: 'pre' | 'post'
  configureServer(server: MiddlewareHost): void
  configurePreviewServer(server: MiddlewareHost): void
}

export interface StaticViewerOptions {
  /** The folder holding the prebuilt viewer: `index.html` and its assets. */
  dist: string
  plugins: readonly ViewerPlugin[]
  /**
   * The one upgrade path the host answers itself. Any other upgrade is
   * refused here — Vite's HMR channel used to take those, and without it a
   * stray upgrade would otherwise hang open.
   */
  socketPath: string
}

export interface StaticViewer {
  httpServer: Server
  /** Resolves once listening; rejects with the bind error (EADDRINUSE included). */
  listen(port: number, host: string): Promise<void>
  close(): Promise<void>
}

/** connect's `use`: mount paths strip and restore, plain handlers see everything. */
export class MiddlewareStack {
  private readonly layers: { route: string; handler: Middleware }[] = []

  use(handler: Middleware): this
  use(route: string, handler: Middleware): this
  use(routeOrHandler: string | Middleware, maybeHandler?: Middleware): this {
    const route =
      typeof routeOrHandler === 'string' ? routeOrHandler.replace(/\/+$/, '').toLowerCase() : ''
    const handler = typeof routeOrHandler === 'string' ? maybeHandler! : routeOrHandler
    this.layers.push({ route, handler })
    return this
  }

  /** Runs the layers in order; `done` gets control when none of them ended the response. */
  run(request: IncomingMessage, response: ServerResponse, done: NextFunction): void {
    const original = request.url ?? '/'
    let index = 0
    const next: NextFunction = (error) => {
      request.url = original
      const layer = this.layers[index++]
      if (!layer) return done(error)
      // No error-handling layers exist here, so an error skips to the end.
      if (error) return next(error)
      if (layer.route) {
        const path = original.split('?')[0]!
        // connect's boundary rule: the mount ends the path, or a `/` or `.` follows.
        if (!path.toLowerCase().startsWith(layer.route)) return next()
        const boundary = path.charAt(layer.route.length)
        if (boundary !== '' && boundary !== '/' && boundary !== '.') return next()
        const rest = original.slice(layer.route.length)
        request.url = rest.startsWith('/') ? rest : `/${rest}`
      }
      try {
        layer.handler(request, response, next)
      } catch (thrown) {
        next(thrown)
      }
    }
    next()
  }
}

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.xml': 'application/xml',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

export function contentTypeForFile(file: string): string {
  return CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream'
}

/** Vite's build names every bundled file `name-<hash>.ext`, which may be cached forever. */
const HASHED_ASSET = /^\/assets\/[^/]+-[A-Za-z0-9_-]{8,}\.[a-z0-9]+$/

async function fileAt(path: string): Promise<{ size: number } | null> {
  try {
    const info = await stat(path)
    return info.isFile() ? { size: info.size } : null
  } catch {
    return null
  }
}

/**
 * Where a request path lands inside `dist`, or null when it would escape it.
 * Resolved and then checked against the root, so `..` and encoded slashes
 * cannot reach a sibling folder.
 */
function fileFor(dist: string, pathname: string): string | null {
  const file = resolve(dist, `.${pathname.endsWith('/') ? `${pathname}index.html` : pathname}`)
  return file === dist || file.startsWith(dist + sep) ? file : null
}

function reply(response: ServerResponse, status: number, text: string): void {
  response.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
  })
  response.end(text)
}

async function send(
  request: IncomingMessage,
  response: ServerResponse,
  file: string,
  size: number,
  pathname: string,
): Promise<void> {
  response.writeHead(200, {
    'content-type': contentTypeForFile(file),
    'content-length': size,
    // Hashed bundles never change under their name; everything else — the
    // entry, the wasm, the fonts — revalidates, since a package update
    // replaces them in place.
    'cache-control': HASHED_ASSET.test(pathname)
      ? 'public, max-age=31536000, immutable'
      : 'no-cache',
  })
  if (request.method === 'HEAD') {
    response.end()
    return
  }
  await new Promise<void>((done) => {
    const stream = createReadStream(file)
    stream.on('error', () => {
      if (!response.headersSent) reply(response, 500, 'could not read the viewer file')
      else response.destroy()
      done()
    })
    stream.on('end', done)
    stream.pipe(response)
  })
}

/**
 * The viewer's files, then the SPA fallback Vite's preview provided: a path
 * without a file extension is the viewer's own to route, so it gets
 * `index.html`; a missing file is a 404, never HTML pretending to be a PNG.
 */
async function serveStatic(
  dist: string,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    reply(response, 405, 'the viewer serves GET and HEAD')
    return
  }
  let pathname: string
  try {
    pathname = decodeURIComponent((request.url ?? '/').split('?')[0]!)
  } catch {
    reply(response, 400, 'malformed path')
    return
  }
  const file = fileFor(dist, pathname)
  if (!file) {
    reply(response, 404, 'not found')
    return
  }
  const found = await fileAt(file)
  if (found) {
    await send(request, response, file, found.size, pathname)
    return
  }
  const lastSegment = pathname.slice(pathname.lastIndexOf('/') + 1)
  if (!lastSegment.includes('.')) {
    const index = resolve(dist, 'index.html')
    const entry = await fileAt(index)
    if (entry) {
      await send(request, response, index, entry.size, '/index.html')
      return
    }
  }
  reply(response, 404, 'not found')
}

export function createStaticViewer(options: StaticViewerOptions): StaticViewer {
  const dist = resolve(options.dist)
  const stack = new MiddlewareStack()
  const host: MiddlewareHost = { middlewares: stack }
  // Vite's ordering: `pre` plugins first, `post` last, the rest in between.
  const rank = (plugin: ViewerPlugin): number =>
    plugin.enforce === 'pre' ? 0 : plugin.enforce === 'post' ? 2 : 1
  for (const plugin of [...options.plugins].sort((a, b) => rank(a) - rank(b))) {
    plugin.configurePreviewServer(host)
  }

  const httpServer = createServer((request, response) => {
    stack.run(request, response, (error) => {
      if (error) {
        if (!response.headersSent) reply(response, 500, String(error))
        else response.destroy()
        return
      }
      void serveStatic(dist, request, response)
    })
  })
  httpServer.on('upgrade', (request, socket) => {
    if ((request.url ?? '/').split('?')[0] !== options.socketPath) socket.destroy()
  })

  return {
    httpServer,
    listen: (port, hostname) =>
      new Promise<void>((done, fail) => {
        const onError = (error: Error): void => {
          httpServer.off('listening', onListening)
          fail(error)
        }
        const onListening = (): void => {
          httpServer.off('error', onError)
          done()
        }
        httpServer.once('error', onError)
        httpServer.once('listening', onListening)
        httpServer.listen(port, hostname)
      }),
    close: () =>
      new Promise<void>((done, fail) => {
        httpServer.closeAllConnections?.()
        httpServer.close((error) => (error ? fail(error) : done()))
      }),
  }
}
