import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { viewerSelection } from '../src/core/viewer.js'

let root: string
let fake: Server | null = null

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'uidx-viewer-sel-'))
})

afterEach(async () => {
  await new Promise<void>((resolve) => (fake ? fake.close(() => resolve()) : resolve()))
  fake = null
  await rm(root, { recursive: true, force: true })
})

/** A stand-in viewer server answering the selection route. */
async function serveSelection(body: unknown): Promise<number> {
  fake = createServer((request, response) => {
    if (request.url === '/__uidx/selection') {
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify(body))
      return
    }
    response.statusCode = 404
    response.end()
  })
  await new Promise<void>((resolve) => fake!.listen(0, resolve))
  return (fake!.address() as AddressInfo).port
}

async function writeDiscovery(port: number): Promise<void> {
  await writeFile(
    join(root, '.uidx-server.json'),
    JSON.stringify({ port, url: `http://localhost:${port}`, pid: 12345 }),
  )
}

describe('viewerSelection', () => {
  it('reports no viewer when no discovery file exists', async () => {
    const result = await viewerSelection(root)
    expect(result.viewer).toBe('none')
    if (result.viewer === 'none') expect(result.reason).toContain('uidx open')
  })

  it('reads the selection from the server the discovery file names', async () => {
    const port = await serveSelection({
      file: 'home.uidx',
      addresses: ['home#hero'],
      at: 1234,
    })
    await writeDiscovery(port)

    const result = await viewerSelection(root)
    expect(result).toEqual({
      viewer: 'open',
      url: `http://localhost:${port}`,
      selection: { file: 'home.uidx', addresses: ['home#hero'], at: 1234 },
    })
  })

  it('treats a stale discovery file as no viewer', async () => {
    const port = await serveSelection({})
    await new Promise<void>((resolve) => fake!.close(() => resolve()))
    fake = null
    await writeDiscovery(port)

    const result = await viewerSelection(root)
    expect(result.viewer).toBe('none')
  })
})
