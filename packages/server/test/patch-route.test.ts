import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import {
  createUidxServer,
  PATCH_ROUTE,
  WS_PATH,
  type ServerMessage,
  type UidxServer,
} from '../src/index.js'

const VALID = `---
id: served
---

## Visual Contract

<Component name="c" status="draft">
  <Frame name="root" cornerRadius={4} />
</Component>
`

let dir: string
let file: string
let server: UidxServer

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'uidx-patch-route-'))
  file = join(dir, 'served.uidx')
  await writeFile(file, VALID)
  server = await createUidxServer({ file, root: dir, port: 4700, stabilityThreshold: 10 })
})

afterEach(async () => {
  await server?.close()
  await rm(dir, { recursive: true, force: true })
})

async function post(body: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${server.url}${PATCH_ROUTE}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: response.status, body: (await response.json()) as Record<string, unknown> }
}

async function connect(): Promise<{ messages: ServerMessage[]; socket: WebSocket }> {
  const socket = new WebSocket(`${server.url!.replace('http', 'ws')}${WS_PATH}`)
  const messages: ServerMessage[] = []
  socket.on('message', (data) => messages.push(JSON.parse(String(data))))
  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve)
    socket.once('error', reject)
  })
  return { messages, socket }
}

async function waitFor(predicate: () => boolean, timeoutMs = 15_000): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out')
    await new Promise((r) => setTimeout(r, 15))
  }
}

describe('POST /__uidx/patch (spec: viewer at scale §3)', () => {
  it('applies to the head, writes the file, answers revision and hash, and clients get a delta', async () => {
    const client = await connect()
    await waitFor(() => client.messages.length > 0)
    client.messages.length = 0

    const reply = await post({
      file: server.session.page,
      patches: [{ op: 'set', address: 'c#root', prop: 'cornerRadius', value: 9 }],
    })
    expect(reply.status).toBe(200)
    expect(reply.body.revision).toBe(2)
    expect(typeof reply.body.sourceHash).toBe('string')
    expect(await readFile(file, 'utf8')).toContain('cornerRadius={9}')

    await waitFor(() => client.messages.some((m) => m.type === 'file:changed'))
    const delta = client.messages.find((m) => m.type === 'file:changed')!
    if (delta.type !== 'file:changed') throw new Error('unreachable')
    expect(delta.patches).toEqual([
      { op: 'set', address: 'c#root', prop: 'cornerRadius', value: 9 },
    ])
    expect(delta.sourceHash).toBe(reply.body.sourceHash)
    client.socket.close()
  })

  it('refuses a patch the patcher refuses, with its sentence, and leaves the file alone', async () => {
    const reply = await post({
      file: server.session.page,
      patches: [{ op: 'set', address: 'c#nope', prop: 'cornerRadius', value: 9 }],
    })
    expect(reply.status).toBe(422)
    expect(String(reply.body.error)).toMatch(/no node at address/)
    expect(await readFile(file, 'utf8')).toBe(VALID)
  })

  it('answers 409 for a stale base revision and 404 for an unknown page', async () => {
    const stale = await post({
      file: server.session.page,
      baseRevision: 99,
      patches: [{ op: 'set', address: 'c#root', prop: 'cornerRadius', value: 9 }],
    })
    expect(stale.status).toBe(409)
    const missing = await post({ file: 'nowhere.uidx', patches: [] })
    expect(missing.status).toBe(404)
  })

  it('answers 400 for a body that is not a patch request', async () => {
    const reply = await post({ nope: true })
    expect(reply.status).toBe(400)
  })
})
