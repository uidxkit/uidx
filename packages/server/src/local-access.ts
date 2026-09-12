import type { IncomingMessage } from 'node:http'
import type { Plugin, ViteDevServer } from 'vite'

/** Browser requests may only come from this exact local viewer origin. */
export function allowsLocalRequest(request: IncomingMessage): boolean {
  try {
    const host = request.headers.host
    if (!host) return false
    const target = new URL(`http://${host}`)
    if (
      !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) ||
      target.username ||
      target.password ||
      target.pathname !== '/' ||
      target.search ||
      target.hash ||
      Number(target.port || 80) !== request.socket.localPort
    )
      return false
    if (request.headers['sec-fetch-site'] === 'cross-site') return false
    const origin = request.headers.origin
    // CLI/MCP clients are local trusted processes and don't send Origin.
    return origin === undefined || origin === target.origin
  } catch {
    return false
  }
}

export function localAccessPlugin(): Plugin {
  const configure = (server: Pick<ViteDevServer, 'middlewares'>): void => {
    server.middlewares.use((request, response, next) => {
      if (allowsLocalRequest(request)) return next()
      response.writeHead(403, {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'no-store',
      })
      response.end('uidx accepts requests from its own localhost viewer and local clients only.')
    })
  }
  return {
    name: 'uidx:local-access',
    enforce: 'pre',
    configureServer: configure,
    configurePreviewServer: configure,
  }
}
