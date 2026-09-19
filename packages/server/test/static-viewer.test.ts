import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { connect as tcpConnect } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  contentTypeForFile,
  createStaticViewer,
  MiddlewareStack,
  type StaticViewer,
  type ViewerPlugin,
} from '../src/static-viewer.js'

/**
 * The static viewer replaces `vite preview` for consumers, so it has to keep
 * what that provided: the files, hashed-asset caching, the SPA fallback, and
 * connect's mount rules for the route plugins — with no Vite loaded at all.
 */
let dist: string
let viewer: StaticViewer | undefined

beforeEach(async () => {
  dist = await mkdtemp(join(tmpdir(), 'uidx-static-'))
  await mkdir(join(dist, 'assets'))
  await writeFile(join(dist, 'index.html'), '<!doctype html><title>viewer</title>')
  await writeFile(join(dist, 'assets/index-Ab12Cd34.js'), 'export const built = true')
  await writeFile(join(dist, 'canvaskit.wasm'), Buffer.from([0x00, 0x61, 0x73, 0x6d]))
  await writeFile(join(dist, '..', 'secret.txt'), 'not served').catch(() => undefined)
})

afterEach(async () => {
  await viewer?.close()
  viewer = undefined
  await rm(dist, { recursive: true, force: true })
})

async function start(plugins: ViewerPlugin[] = []): Promise<string> {
  viewer = createStaticViewer({ dist, plugins, socketPath: '/__uidx' })
  await viewer.listen(0, 'localhost')
  const address = viewer.httpServer.address()
  if (!address || typeof address === 'string') throw new Error('no port')
  return `http://localhost:${address.port}`
}

const plugin = (name: string, configure: ViewerPlugin['configurePreviewServer']): ViewerPlugin => ({
  name,
  configureServer: configure,
  configurePreviewServer: configure,
})

describe('the static viewer', () => {
  it('serves the entry, the bundles and the wasm with their content types', async () => {
    const url = await start()
    const entry = await fetch(url)
    expect(entry.status).toBe(200)
    expect(entry.headers.get('content-type')).toContain('text/html')
    expect(await entry.text()).toContain('<title>viewer</title>')

    const bundle = await fetch(`${url}/assets/index-Ab12Cd34.js`)
    expect(bundle.headers.get('content-type')).toContain('text/javascript')
    expect(bundle.headers.get('cache-control')).toContain('immutable')
    expect(await bundle.text()).toBe('export const built = true')

    const wasm = await fetch(`${url}/canvaskit.wasm`)
    expect(wasm.headers.get('content-type')).toBe('application/wasm')
    expect(wasm.headers.get('cache-control')).toBe('no-cache')
    expect((await wasm.arrayBuffer()).byteLength).toBe(4)
  })

  it('answers HEAD with the headers and no body', async () => {
    const url = await start()
    const head = await fetch(`${url}/canvaskit.wasm`, { method: 'HEAD' })
    expect(head.status).toBe(200)
    expect(head.headers.get('content-length')).toBe('4')
    expect((await head.arrayBuffer()).byteLength).toBe(0)
  })

  it('falls back to the entry for viewer routes and never for missing files', async () => {
    const url = await start()
    expect(await (await fetch(`${url}/some/route?page=x`)).text()).toContain('<title>viewer')
    const missing = await fetch(`${url}/missing.png`)
    expect(missing.status).toBe(404)
    expect(missing.headers.get('content-type')).toContain('text/plain')
  })

  it('never leaves the dist folder', async () => {
    const url = await start()
    for (const path of ['/../secret.txt', '/%2e%2e/secret.txt', '/assets/../../secret.txt']) {
      const response = await fetch(`${url}${path}`)
      expect(response.status, path).toBe(404)
      expect(await response.text()).not.toContain('not served')
    }
  })

  it('refuses methods other than GET and HEAD for files', async () => {
    const url = await start()
    expect((await fetch(`${url}/canvaskit.wasm`, { method: 'POST' })).status).toBe(405)
  })

  it('runs the route plugins before the files, in enforce order', async () => {
    const seen: string[] = []
    const url = await start([
      plugin('second', (server) =>
        server.middlewares.use((_request, _response, next) => {
          seen.push('second')
          next()
        }),
      ),
      {
        ...plugin('first', (server) =>
          server.middlewares.use((_request, _response, next) => {
            seen.push('first')
            next()
          }),
        ),
        enforce: 'pre',
      },
      plugin('route', (server) =>
        server.middlewares.use('/__uidx/selection', (_request, response) => {
          response.setHeader('content-type', 'application/json')
          response.end('{"ok":true}')
        }),
      ),
    ])
    expect(await (await fetch(`${url}/__uidx/selection`)).json()).toEqual({ ok: true })
    expect(seen).toEqual(['first', 'second'])
    // A route that ends the response shadows the file that would follow.
    expect(await (await fetch(url)).text()).toContain('<title>viewer')
  })

  it('reports a thrown handler as a 500 rather than hanging the request', async () => {
    const url = await start([
      plugin('broken', (server) =>
        server.middlewares.use('/boom', () => {
          throw new Error('handler failed')
        }),
      ),
    ])
    const response = await fetch(`${url}/boom`)
    expect(response.status).toBe(500)
    expect(await response.text()).toContain('handler failed')
  })

  it('refuses an upgrade on any path but the socket path', async () => {
    const url = await start()
    const port = Number(new URL(url).port)
    const closed = await new Promise<boolean>((resolve) => {
      const socket = tcpConnect(port, 'localhost', () => {
        socket.write(
          'GET /other HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n' +
            'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n',
        )
      })
      socket.on('close', () => resolve(true))
      socket.on('error', () => resolve(true))
      setTimeout(() => {
        socket.destroy()
        resolve(false)
      }, 3000)
    })
    expect(closed).toBe(true)
  })

  it('rejects a taken port with the bind error', async () => {
    const url = await start()
    const port = Number(new URL(url).port)
    const second = createStaticViewer({ dist, plugins: [], socketPath: '/__uidx' })
    await expect(second.listen(port, 'localhost')).rejects.toMatchObject({ code: 'EADDRINUSE' })
  })
})

describe('MiddlewareStack', () => {
  const run = (stack: MiddlewareStack, url: string, done: (error?: unknown) => void) =>
    stack.run({ url, method: 'GET' } as never, {} as never, done)

  it('strips a mount path the way connect does, and puts it back for the next layer', () => {
    const seen: string[] = []
    const stack = new MiddlewareStack()
    stack.use('/__uidx/fonts', (request, _response, next) => {
      seen.push(`fonts:${request.url}`)
      next()
    })
    stack.use((request, _response, next) => {
      seen.push(`all:${request.url}`)
      next()
    })
    run(stack, '/__uidx/fonts?x=1', () => undefined)
    run(stack, '/__uidx/fonts/upload', () => undefined)
    run(stack, '/__UIDX/Fonts', () => undefined)
    expect(seen).toEqual([
      'fonts:/?x=1',
      'all:/__uidx/fonts?x=1',
      'fonts:/upload',
      'all:/__uidx/fonts/upload',
      'fonts:/',
      'all:/__UIDX/Fonts',
    ])
  })

  it('does not let a mount match into the middle of a longer segment', () => {
    const seen: string[] = []
    const stack = new MiddlewareStack()
    stack.use('/__uidx/asset', (request, _response, next) => {
      seen.push(request.url ?? '')
      next()
    })
    run(stack, '/__uidx/assets/x', () => undefined)
    run(stack, '/__uidx/asset/icon.svg', () => undefined)
    run(stack, '/__uidx/asset.json', () => undefined)
    // A `.` boundary matches too, and the remainder gets connect's leading slash.
    expect(seen).toEqual(['/icon.svg', '/.json'])
  })

  it('hands control to `done` when no layer ends the response', () => {
    const stack = new MiddlewareStack()
    stack.use((_request, _response, next) => next())
    let finished = false
    run(stack, '/', () => (finished = true))
    expect(finished).toBe(true)
  })
})

describe('contentTypeForFile', () => {
  it('knows the types the viewer ships and falls back to octet-stream', () => {
    expect(contentTypeForFile('a/index.html')).toContain('text/html')
    expect(contentTypeForFile('a/x.css')).toContain('text/css')
    expect(contentTypeForFile('a/Inter.ttf')).toBe('font/ttf')
    expect(contentTypeForFile('a/x.woff2')).toBe('font/woff2')
    expect(contentTypeForFile('a/x.unknown')).toBe('application/octet-stream')
  })
})
