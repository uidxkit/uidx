import type { IncomingMessage, Server as HttpServer, ServerResponse } from 'node:http'
import type { UidxPatch } from '@uidx/format'

import { ASSET_ROUTE, assetReply } from './assets.js'
import { fontRoutePlugin } from './fonts.js'
import { pagesRoutePlugin } from './pages.js'
import { allowsLocalRequest, localAccessPlugin } from './local-access.js'
import type { FoundManifest } from './document.js'
import { WebSocketServer, type WebSocket } from 'ws'

import { FileSession } from './session.js'
import { Workspace } from './workspace.js'
import { isClientMessage, WS_PATH, type NodePatchMessage, type ServerMessage } from './protocol.js'
import { SELECTION_ROUTE, selectionReply, type SelectionState } from './selection.js'
import { removeDiscovery, writeDiscovery } from './discovery.js'
import { createStaticViewer, type MiddlewareHost, type ViewerPlugin } from './static-viewer.js'

export interface UidxServerOptions {
  /** The `.uidx` file this server is about. */
  file: string
  /** Preferred port; taken ports are skipped (spec §8). */
  port?: number
  /**
   * Viewer *source* root, for a Vite dev server with hot reload — a source
   * checkout only. Omit both this and `viewerDist` to run headless: sockets
   * only, no HTTP.
   */
  root?: string
  /**
   * The prebuilt viewer, served by this package's own static server. No Vite
   * is loaded — or needed — on this path, which is the one consumers get.
   */
  viewerDist?: string
  /** Project-bound MCP hosted on the viewer's HTTP server. */
  mcp?: {
    handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void>
    close(): Promise<void>
  }
  stabilityThreshold?: number
  /**
   * Receives socket lifecycle and message traffic (spec §8's --verbose).
   * Sync bugs are the hardest thing here to reason about after the fact, so
   * being able to see what actually crossed the wire matters.
   */
  log?: (message: string) => void
}

export interface UidxServer {
  url: string | null
  port: number | null
  /**
   * The session for the page named in `options.file`.
   *
   * Kept as the entry point's session rather than removed: it is what `uidx
   * open` reports on, and every other page of the document is reachable through
   * `workspace`.
   */
  session: FileSession
  /** Every page of the document, live (G6). Null when there is no manifest. */
  workspace: Workspace | null
  close(): Promise<void>
}

const MAX_PORT_ATTEMPTS = 20
/** What the socket rides on, whichever server is underneath. */
interface ViewerServer {
  httpServer: HttpServer | null
  close(): Promise<void>
}

/**
 * The document the target file belongs to, or null if it is not in one.
 *
 * `uidx open` refuses a page outside a document before it ever gets here, so
 * null in practice means a caller that deliberately opted out — the headless
 * tests, and anything driving the server directly.
 */
async function openWorkspace(options: UidxServerOptions): Promise<Workspace | null> {
  try {
    const workspace = await Workspace.open({
      from: options.file,
      stabilityThreshold: options.stabilityThreshold,
    })
    await workspace.start()
    return workspace
  } catch {
    return null
  }
}

/**
 * The viewer's HTTP server plus the UIDX socket (spec §4.3).
 *
 * The socket rides on the viewer's HTTP server but answers on its own path,
 * because Vite's HMR channel, on the dev path, is already using the default
 * one. With neither `viewerDist` nor `root` no HTTP server is started at all,
 * which is what the headless tests use.
 */
export async function createUidxServer(options: UidxServerOptions): Promise<UidxServer> {
  // The HTTP server boots while the document parses, not after it.
  //
  // Loading a document is CPU-bound parsing — measured at ~6.4ms per 130-line
  // page, so a large design system spends real time here and every millisecond
  // of it used to sit in front of the browser opening. Nothing about the two
  // jobs is ordered: Vite serves the viewer bundle, the workspace produces the
  // documents that bundle asks for over a socket that does not exist yet.
  //
  // This does not make loading cheaper, it takes it off the critical path. The
  // parser is the other half of that story (§5), and both were needed.
  /*
   * Filled in once the workspace resolves, read at request time.
   *
   * Vite boots *before* the document is opened — deliberately, so parsing and
   * serving overlap — so the asset route cannot be handed a manifest when it is
   * registered. It has to be registered that early all the same: middleware
   * added after `createViteServer` sits behind Vite's own SPA fallback, which
   * answers everything with `index.html`. Found live, as a PNG served as HTML.
   */
  const manifestHolder: { current: FoundManifest | null } = { current: null }
  const workspaceHolder: { current: Workspace | null } = { current: null }
  // Same holder pattern as the manifest: the route registers before the socket
  // that will fill it exists, so it reads through indirection at request time.
  const selectionHolder: { current: SelectionState | null } = { current: null }
  // The patch route is how writers other than the viewer — the agent harness,
  // `uidx apply` — hand their edits to the session instead of writing the file
  // themselves (viewer-at-scale spec §3). Filled once the sessions exist.
  const patchHolder: PatchRouteHolder = { apply: null }
  const booting =
    options.root || options.viewerDist
      ? listenOnFreePort(
          options.root,
          options.port ?? 4400,
          manifestHolder,
          selectionHolder,
          patchHolder,
          workspaceHolder,
          options.viewerDist,
          options.mcp,
        )
      : null
  // Listening can fail while the document is still parsing. Observe the error
  // immediately; attach still awaits the original promise and reports it.
  void booting?.catch(() => undefined)
  let workspace: Workspace | null = null
  let session: FileSession | null = null

  try {
    // The whole document is watched, because a bare name resolves against all of
    // it (ADR 0004 §2) — a page bound to a token has to hear when that token
    // moves. Falling back to a lone session keeps the server usable on a file
    // outside any document, which is what the headless tests exercise.
    workspace = await openWorkspace(options)
    workspaceHolder.current = workspace
    manifestHolder.current = workspace?.manifest ?? null
    const entry = workspace?.pageOf(options.file) ?? null

    session =
      workspace && entry
        ? workspace.session(entry)!
        : new FileSession({ file: options.file, stabilityThreshold: options.stabilityThreshold })
    if (!workspace || !entry) await session.start()

    return await attach(options, booting, workspace, entry, session, selectionHolder, patchHolder)
  } catch (err) {
    // An HTTP server that is already listening has to be closed, or a failure
    // here leaves the port bound for the life of the process.
    await booting?.then(({ vite }) => vite.close()).catch(() => undefined)
    if (workspace) await workspace.close()
    else await session?.close()
    await options.mcp?.close()
    throw err
  }
}

async function attach(
  options: UidxServerOptions,
  booting: Promise<{ vite: ViewerServer; port: number }> | null,
  workspace: Workspace | null,
  entry: string | null,
  session: FileSession,
  selection: { current: SelectionState | null },
  patchRoute?: PatchRouteHolder,
): Promise<UidxServer> {
  const log = options.log
  const sockets = new Set<WebSocket>()
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 })

  /**
   * The session a patch envelope names (ADR 0004, story C1).
   *
   * One patch writes exactly one file, and the page is carried explicitly rather
   * than implied by the connection: editing an instance and editing its main are
   * edits to different pages, and one canvas gesture can mean either (F3).
   */
  const sessionFor = (page: string): FileSession | undefined => {
    if (workspace) return workspace.session(page)
    return page === session.page ? session : undefined
  }

  let httpPatches = 0
  if (patchRoute) {
    patchRoute.apply = async (body) => {
      const target = sessionFor(body.file)
      if (!target)
        return { status: 404, body: { error: `no page "${body.file}" in this document` } }
      const reply = await target.patch({
        patchId: `http-${++httpPatches}`,
        baseRevision: body.baseRevision ?? target.revision,
        patches: body.patches,
      })
      log?.(`http patch ${body.file} → ${reply.type}`)
      switch (reply.type) {
        case 'patch:applied': {
          const state = target.current
          return {
            status: 200,
            body: {
              revision: reply.revision,
              sourceHash: state.kind === 'ok' ? state.doc.sourceHash : '',
            },
          }
        }
        case 'patch:stale':
          return {
            status: 409,
            body: {
              error: 'the page moved past the revision these patches were written against',
              revision: reply.revision,
            },
          }
        case 'patch:rejected':
          return { status: 422, body: { error: reply.reason } }
        default:
          return { status: 500, body: { error: 'unexpected reply' } }
      }
    }
  }

  const handlePatch = async (socket: WebSocket, message: NodePatchMessage): Promise<void> => {
    const target = sessionFor(message.file)
    if (!target) {
      send(
        socket,
        {
          type: 'patch:rejected',
          file: message.file,
          patchId: message.patchId,
          revision: 0,
          reason: `no page "${message.file}" in this document`,
        },
        log,
      )
      return
    }
    // The reply goes to the sender alone. A rejection is about one client's
    // in-flight gesture and means nothing to the others; what they need is the
    // `file:changed` the session broadcasts when a write lands.
    send(socket, await target.patch(message), log)
  }

  wss.on('connection', (socket) => {
    socket.on('error', (error) => log?.(`ws error: ${error.message}`))
    sockets.add(socket)
    log?.(`ws connect (${sockets.size} client${sockets.size === 1 ? '' : 's'})`)
    // A new or reconnecting client gets the whole current state; the server
    // keeps no per-connection state (spec §11).
    // A new or reconnecting client gets every page, not just the entry one:
    // resolving an alias needs whatever page declares the token.
    for (const message of workspace && entry ? workspace.snapshot(entry) : [session.snapshot()]) {
      send(socket, message, log)
    }
    socket.on('message', (raw) => {
      let parsed: unknown
      try {
        parsed = JSON.parse(String(raw))
      } catch {
        log?.('ws ← unparseable frame, ignored')
        return
      }
      if (!isClientMessage(parsed)) {
        log?.('ws ← unrecognised message, ignored')
        return
      }
      if (parsed.type === 'page:request') {
        // A client that could not apply a delta asks for the document; the
        // answer goes to that socket alone.
        log?.(`ws ← page:request ${parsed.file}`)
        const snapshot = sessionFor(parsed.file)?.snapshot()
        if (snapshot) send(socket, snapshot, log)
        return
      }
      if (parsed.type === 'selection:changed') {
        // Last report wins, across every connected client: whoever clicked
        // most recently is the one the agent should mean by "this".
        log?.(`ws ← selection:changed ${parsed.file} [${parsed.addresses.join(', ')}]`)
        selection.current = { file: parsed.file, addresses: parsed.addresses, at: Date.now() }
        return
      }
      log?.(`ws ← node:patch ${parsed.file} base=${parsed.baseRevision} ${parsed.patchId}`)
      // Errors inside are already turned into a `patch:rejected`; anything that
      // escapes must not take the socket — or the connection down with it.
      void handlePatch(socket, parsed).catch((err: unknown) => {
        log?.(`ws patch handler failed: ${String(err)}`)
      })
    })
    socket.on('close', () => {
      sockets.delete(socket)
      log?.(`ws disconnect (${sockets.size} remaining)`)
    })
  })

  const source = workspace && entry ? workspace : session
  const unsubscribe = source.onMessage((message) => {
    for (const socket of sockets) send(socket, message, log)
  })

  const closeSources = async (): Promise<void> => {
    if (workspace) await workspace.close()
    else await session.close()
  }

  if (!booting) {
    return {
      url: null,
      port: null,
      session,
      workspace,
      async close() {
        unsubscribe()
        for (const socket of sockets) socket.terminate()
        wss.close()
        await closeSources()
        await options.mcp?.close()
      },
    }
  }

  const { vite, port } = await booting

  vite.httpServer?.on('upgrade', (request, socket, head) => {
    // Anything that is not ours is left to the server underneath: Vite's HMR
    // handler on the dev path, and a refusal on the static one.
    const path = (request.url ?? '/').split('?')[0]
    if (path !== WS_PATH) return
    if (!allowsLocalRequest(request)) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n')
      return
    }
    wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request))
  })

  const url = `http://localhost:${port}`
  // Only a document gets a card at the door: a loose file has no root an
  // agent would open, so there is nowhere sensible to leave one.
  const manifestDir = workspace?.manifest?.dir ?? null
  if (manifestDir)
    await writeDiscovery(manifestDir, {
      port,
      url,
      pid: process.pid,
      root: manifestDir,
      ...(options.mcp ? { mcpUrl: `${url}/mcp` } : {}),
    })

  return {
    url,
    port,
    session,
    workspace,
    async close() {
      if (manifestDir) await removeDiscovery(manifestDir)
      unsubscribe()
      for (const socket of sockets) socket.terminate()
      wss.close()
      await closeSources()
      await options.mcp?.close()
      await vite.close()
    },
  }
}

/**
 * Serves the bytes an image reference names, on the viewer's own origin
 * (ADR 0006 §9).
 *
 * A plugin rather than a `vite.middlewares.use` after boot, because Vite
 * installs an SPA fallback that answers every unmatched path with
 * `index.html` — a middleware added afterwards never runs, and a PNG comes
 * back as HTML. `configureServer` runs before those are installed.
 *
 * Not a hole in G7's no-network rule: that is about the *renderer* not reaching
 * the internet, and this is the viewer asking its own server for a file the
 * document declares — the same way it already gets its wasm and its fonts.
 */
function assetRoutePlugin(manifest: { current: FoundManifest | null }): ViewerPlugin {
  const configure = (server: MiddlewareHost): void => {
    // No trailing slash: connect strips the mount path and requires what is
    // left to begin with one, so `/__uidx/asset/` never matches a child.
    server.middlewares.use(ASSET_ROUTE.replace(/\/$/, ''), (request, response, next) => {
      const found = manifest.current
      // Serving one loose file rather than a document: nothing declares
      // assets, so there is nothing this route may hand out.
      if (!found) return next()
      const path = (request.url ?? '/').replace(/^\//, '').split('?')[0] ?? ''
      void assetReply(found, path).then(
        (reply) => {
          if (reply.status === 200) {
            response.setHeader('content-type', reply.type)
            // Immutable would be wrong — a watcher can change the file under
            // us — so this revalidates rather than caching blind.
            response.setHeader('cache-control', 'no-cache')
            response.end(Buffer.from(reply.body))
            return
          }
          response.statusCode = reply.status
          response.setHeader('content-type', 'text/plain; charset=utf-8')
          response.end(reply.message)
        },
        () => next(),
      )
    })
  }
  return { name: 'uidx:assets', configureServer: configure, configurePreviewServer: configure }
}

/**
 * Answers `GET /__uidx/selection` with the latest report. A plugin for the
 * same reason as the asset route: registered after boot it would sit behind
 * Vite's SPA fallback and answer as `index.html`.
 */
function selectionRoutePlugin(selection: { current: SelectionState | null }): ViewerPlugin {
  const configure = (server: MiddlewareHost): void => {
    server.middlewares.use(SELECTION_ROUTE, (_request, response) => {
      response.setHeader('content-type', 'application/json')
      response.setHeader('cache-control', 'no-store')
      response.end(JSON.stringify(selectionReply(selection.current)))
    })
  }
  return { name: 'uidx:selection', configureServer: configure, configurePreviewServer: configure }
}

export const PATCH_ROUTE = '/__uidx/patch'

export interface PatchRouteBody {
  file: string
  patches: UidxPatch[]
  /** Absent: apply to the session's head. */
  baseRevision?: number
}

export interface PatchRouteHolder {
  apply:
    ((body: PatchRouteBody) => Promise<{ status: number; body: Record<string, unknown> }>) | null
}

/**
 * `POST /__uidx/patch` — the session as the one writer of the file (spec §3).
 *
 * The body names the page and the patches; the reply is the revision and the
 * source hash the write produced, so a turn can attribute the revision to
 * itself. A plugin for the same reason as the other two routes.
 */
function patchRoutePlugin(holder: PatchRouteHolder): ViewerPlugin {
  const configure = (server: MiddlewareHost): void => {
    server.middlewares.use(PATCH_ROUTE, (request, response) => {
      const answer = (status: number, body: Record<string, unknown>): void => {
        response.statusCode = status
        response.setHeader('content-type', 'application/json')
        response.setHeader('cache-control', 'no-store')
        response.end(JSON.stringify(body))
      }
      if (request.method !== 'POST') return answer(405, { error: 'POST a { file, patches } body' })
      const chunks: Buffer[] = []
      let size = 0
      let rejected = false
      request.on('data', (chunk: Buffer) => {
        if (rejected) return
        size += chunk.length
        if (size > 1024 * 1024) {
          rejected = true
          chunks.length = 0
          answer(413, { error: 'Patch requests must be at most 1 MiB' })
          return
        }
        chunks.push(chunk)
      })
      request.on('end', () => {
        if (rejected) return
        let parsed: unknown
        try {
          parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        } catch {
          return answer(400, { error: 'the body is not JSON' })
        }
        const body = parsed as Partial<PatchRouteBody> | null
        if (
          !body ||
          typeof body.file !== 'string' ||
          !Array.isArray(body.patches) ||
          (body.baseRevision !== undefined && typeof body.baseRevision !== 'number')
        ) {
          return answer(400, {
            error: 'expected { file: string, patches: UidxPatch[], baseRevision?: number }',
          })
        }
        const apply = holder.apply
        if (!apply) return answer(503, { error: 'the document is still opening' })
        void apply(body as PatchRouteBody).then(
          (reply) => answer(reply.status, reply.body),
          (err: unknown) => answer(500, { error: String(err) }),
        )
      })
    })
  }
  return { name: 'uidx:patch', configureServer: configure, configurePreviewServer: configure }
}

async function listenOnFreePort(
  root: string | undefined,
  preferred: number,
  manifest: { current: FoundManifest | null },
  selection: { current: SelectionState | null },
  patchRoute: PatchRouteHolder,
  workspace: { current: Workspace | null },
  viewerDist?: string,
  mcp?: UidxServerOptions['mcp'],
): Promise<{ vite: ViewerServer; port: number }> {
  const plugins = [
    localAccessPlugin(),
    fontRoutePlugin(manifest),
    assetRoutePlugin(manifest),
    selectionRoutePlugin(selection),
    patchRoutePlugin(patchRoute),
    pagesRoutePlugin(workspace),
  ]
  if (mcp) {
    const configure = (server: MiddlewareHost): void => {
      server.middlewares.use('/mcp', (request, response) => {
        void mcp.handleRequest(request, response).catch((error: unknown) => {
          if (!response.headersSent) response.writeHead(500)
          response.end(String(error))
        })
      })
    }
    plugins.push({
      name: 'uidx:mcp',
      configureServer: configure,
      configurePreviewServer: configure,
    })
  }
  let lastError: unknown
  for (let port = preferred; port < Math.min(preferred + MAX_PORT_ATTEMPTS, 65536); port++) {
    if (viewerDist) {
      const viewer = createStaticViewer({ dist: viewerDist, plugins, socketPath: WS_PATH })
      try {
        await viewer.listen(port, 'localhost')
        return { port, vite: viewer }
      } catch (error) {
        lastError = error
        if (!isPortTaken(error)) throw error
        continue
      }
    }
    if (!root) throw new Error('a viewer source root is needed when no prebuilt viewer is given')
    // Loaded here and nowhere else: Vite is a dev-time tool for a source
    // checkout, and a consumer's install must not need it — or the native
    // binaries it runs on — to serve the prebuilt viewer above.
    const { createServer: createViteServer } = await import('vite')
    const vite = await createViteServer({
      root,
      plugins,
      // Left to auto-discovery so the viewer root owns its own config — it needs
      // its framework plugin, which the server has no business knowing about.
      // Inline options below still win over the discovered file.
      server: { port, strictPort: true, host: 'localhost', fs: { allow: [root, process.cwd()] } },
      // @open-pencil/yoga-layout initialises its WASM with a top-level await,
      // which esbuild rejects under the default dep-optimizer target.
      esbuild: { target: 'esnext' },
      optimizeDeps: { esbuildOptions: { target: 'esnext' } },
      build: { target: 'esnext' },
      appType: 'spa',
    })
    try {
      await vite.listen()
      // Plain HTTP by configuration, so the server underneath is `http.Server`;
      // the type admits an HTTP/2 server this code never creates.
      return {
        port,
        vite: { httpServer: vite.httpServer as HttpServer | null, close: () => vite.close() },
      }
    } catch (err) {
      lastError = err
      await vite.close()
      if (!isPortTaken(err)) throw err
    }
  }
  throw new Error(
    `no free port in ${preferred}..${preferred + MAX_PORT_ATTEMPTS - 1}: ${String(lastError)}`,
  )
}

/**
 * Vite raises a plain `Error("Port N is already in use")` under `strictPort`
 * rather than surfacing the underlying `EADDRINUSE`, so matching on the code
 * alone never fires and every retry re-throws.
 */
function isPortTaken(err: unknown): boolean {
  if ((err as { code?: string }).code === 'EADDRINUSE') return true
  return /already in use/i.test((err as Error)?.message ?? '')
}

function send(socket: WebSocket, message: ServerMessage, log?: (text: string) => void): void {
  if (socket.readyState !== socket.OPEN) return
  const payload = JSON.stringify(message)
  log?.(`ws → ${describe(message)} (${payload.length}b)`)
  socket.send(payload)
}

/** Short, greppable summary; the full document would drown the log. */
function describe(message: ServerMessage): string {
  switch (message.type) {
    case 'file:changed':
      return `file:changed ${message.file} rev=${message.revision}`
    case 'file:error':
      return `file:error ${message.file} rev=${message.revision} [${message.diagnostics.map((d) => d.code).join(',')}]`
    case 'patch:applied':
      return `patch:applied ${message.file} rev=${message.revision} ${message.patchId}`
    case 'patch:stale':
      return `patch:stale ${message.file} ${message.patchId}`
    case 'patch:rejected':
      return `patch:rejected ${message.file} ${message.patchId}: ${message.reason}`
    case 'document:opened':
      return `document:opened ${message.id} (${message.pages.length} pages)`
    case 'asset:changed':
      return `asset:changed ${message.src}`
    case 'page:reresolve':
      return `page:reresolve ${message.file}`
  }
}
