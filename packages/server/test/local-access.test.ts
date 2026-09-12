import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { request } from 'node:http'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import { createUidxServer, type UidxServer } from '../src/server.js'
import { WS_PATH } from '../src/protocol.js'

let dir: string
let file: string
let server: UidxServer | undefined
const source = '---\nid: access\n---\n\n## Visual Contract\n\n<Page><Frame name="Frame" /></Page>\n'

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'uidx-access-'))
  file = join(dir, 'access.uidx')
  await writeFile(file, source)
  await writeFile(join(dir, 'uidx.json'), '{"id":"access","files":["*.uidx"]}')
  await mkdir(join(dir, 'dist'))
  await writeFile(join(dir, 'dist/index.html'), '<title>Local viewer</title>')
})
afterEach(async () => {
  await server?.close()
  server = undefined
  await rm(dir, { recursive: true, force: true })
})

describe.each(['built', 'development'] as const)('%s local server', (mode) => {
  async function start() {
    server = await createUidxServer({
      file,
      root: dir,
      viewerDist: mode === 'built' ? join(dir, 'dist') : undefined,
      port: 4820,
    })
    return server.url!
  }

  it('allows local CLI requests and the viewer, and rejects foreign origins and hosts', async () => {
    const url = await start()
    const allowedHeaders: Record<string, string>[] = [{}, { origin: url }]
    for (const headers of allowedHeaders) {
      expect((await fetch(`${url}/__uidx/selection`, { headers })).status).toBe(200)
    }
    const blockedHeaders: Record<string, string>[] = [
      { origin: 'https://attacker.example' },
      { origin: 'http://localhost:1' },
      { origin: 'null' },
      { 'sec-fetch-site': 'cross-site' },
    ]
    for (const headers of blockedHeaders) {
      expect(
        (await fetch(`${url}/__uidx/selection`, { headers })).status,
        JSON.stringify(headers),
      ).toBe(403)
      expect((await fetch(`${url}/mcp`, { method: 'POST', headers, body: '{}' })).status).toBe(403)
      expect(
        (await fetch(`${url}/__uidx/patch`, { method: 'POST', headers, body: '{}' })).status,
      ).toBe(403)
    }
    // Node's fetch normalizes Host; use the HTTP client to test DNS rebinding.
    for (const host of [`attacker.example:${server!.port}`, 'localhost:1']) {
      const status = await new Promise<number>((resolve, reject) => {
        const req = request(`${url}/__uidx/selection`, { headers: { host } }, (res) => {
          res.resume()
          resolve(res.statusCode!)
        })
        req.on('error', reject)
        req.end()
      })
      expect(status).toBe(403)
    }
    expect(await readFile(file, 'utf8')).toBe(source)
  })

  it('rejects foreign WebSockets before sending project data and accepts the viewer origin', async () => {
    const url = await start()
    const blocked = new WebSocket(`${url.replace('http', 'ws')}${WS_PATH}`, {
      origin: 'https://attacker.example',
    })
    blocked.on('error', () => {})
    const status = await new Promise<number>((resolve, reject) => {
      blocked.once('unexpected-response', (_request, response) => {
        response.resume()
        blocked.terminate()
        resolve(response.statusCode!)
      })
      blocked.once('open', () => reject(new Error('Foreign origin connected')))
    })
    expect(status).toBe(403)
    const accepted = new WebSocket(`${url.replace('http', 'ws')}${WS_PATH}`, { origin: url })
    await new Promise<void>((resolve, reject) => {
      accepted.once('open', resolve)
      accepted.once('error', reject)
    })
    accepted.close()
  })

  it('bounds HTTP patch request bodies without editing a file', async () => {
    const url = await start()
    const response = await fetch(`${url}/__uidx/patch`, {
      method: 'POST',
      body: ' '.repeat(1024 * 1024 + 1),
    })
    expect(response.status).toBe(413)
    expect(await readFile(file, 'utf8')).toBe(source)
  })
})
