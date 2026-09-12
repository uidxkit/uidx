import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { run, type Io } from '../src/cli.js'

let root: string
let fake: Server | null = null

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'uidx-cli-sel-'))
  await writeFile(join(root, 'uidx.json'), JSON.stringify({ id: 'doc', files: ['**/*.uidx'] }))
})

afterEach(async () => {
  await new Promise<void>((resolve) => (fake ? fake.close(() => resolve()) : resolve()))
  fake = null
  await rm(root, { recursive: true, force: true })
})

function collect(): { io: Io; out: string[]; err: string[] } {
  const out: string[] = []
  const err: string[] = []
  return { io: { out: (t) => out.push(t), err: (t) => err.push(t) }, out, err }
}

async function serveSelection(body: unknown): Promise<void> {
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
  const port = (fake!.address() as AddressInfo).port
  await writeFile(
    join(root, '.uidx-server.json'),
    JSON.stringify({ port, url: `http://localhost:${port}`, pid: 12345 }),
  )
}

describe('uidx selection', () => {
  it('requires a project or document when no root is supplied', async () => {
    const { io, err } = collect()
    await rm(join(root, 'uidx.json'))
    io.cwd = root
    expect(await run(['selection'], io)).toBe(1)
    expect(err.join('')).toContain('document root')
  })

  it('says no viewer is open when none is', async () => {
    const { io, err } = collect()
    expect(await run(['selection', root], io)).toBe(1)
    expect(err.join('')).toContain('no viewer is open')
  })

  it('prints the selected addresses one per line', async () => {
    await serveSelection({ file: 'home.uidx', addresses: ['home#hero', 'home#cta'], at: 5 })
    const { io, out } = collect()
    expect(await run(['selection', root], io)).toBe(0)
    expect(out.join('')).toBe('home#hero\nhome#cta\n')
  })

  it('says when the viewer has nothing selected', async () => {
    await serveSelection({ file: null, addresses: [], at: null })
    const { io, out } = collect()
    expect(await run(['selection', root], io)).toBe(0)
    expect(out.join('')).toContain('nothing selected')
  })

  it('prints the whole report as JSON on request', async () => {
    await serveSelection({ file: 'home.uidx', addresses: ['home#hero'], at: 5 })
    const { io, out } = collect()
    expect(await run(['selection', root, '--format', 'json'], io)).toBe(0)
    expect(JSON.parse(out.join(''))).toEqual({
      file: 'home.uidx',
      addresses: ['home#hero'],
      at: 5,
    })
  })
})
