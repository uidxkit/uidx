import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import {
  createUidxServer,
  SELECTION_ROUTE,
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
  dir = await mkdtemp(join(tmpdir(), 'uidx-server-'))
  file = join(dir, 'served.uidx')
  await writeFile(file, VALID)
})

afterEach(async () => {
  await server?.close()
  await rm(dir, { recursive: true, force: true })
})

/** Connects and collects every message the server pushes. */
async function connect(url: string): Promise<{ messages: ServerMessage[]; socket: WebSocket }> {
  const socket = new WebSocket(`${url.replace('http', 'ws')}${WS_PATH}`)
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

async function waitForAsync(predicate: () => Promise<boolean>, timeoutMs = 15_000): Promise<void> {
  const start = Date.now()
  while (!(await predicate())) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out')
    await new Promise((r) => setTimeout(r, 15))
  }
}

describe('createUidxServer', () => {
  it('serves prebuilt assets, document assets and live patches without loading Vite config', async () => {
    const viewerDist = join(dir, 'dist')
    await mkdir(viewerDist)
    await mkdir(join(dir, 'assets'))
    await writeFile(join(viewerDist, 'index.html'), '<!doctype html><title>built viewer</title>')
    await writeFile(join(viewerDist, 'app.js'), 'window.uidx = true')
    await writeFile(join(dir, 'vite.config.js'), 'throw new Error("consumer config must not run")')
    await writeFile(
      join(dir, 'uidx.json'),
      JSON.stringify({ id: 'project', files: ['*.uidx'], assets: ['assets/**'] }),
    )
    await writeFile(join(dir, 'assets/icon.svg'), '<svg />')
    server = await createUidxServer({
      file,
      root: dir,
      viewerDist,
      port: 4720,
      stabilityThreshold: 10,
    })
    const html = await (await fetch(server.url!)).text()
    expect(html).toContain('built viewer')
    expect(html).not.toContain('/@vite/client')
    expect(await (await fetch(`${server.url}/app.js`)).text()).toBe('window.uidx = true')
    expect(await (await fetch(`${server.url}/__uidx/asset/assets/icon.svg`)).text()).toBe('<svg />')
    expect(await (await fetch(`${server.url}/__uidx/selection`)).json()).toEqual({
      file: null,
      addresses: [],
      at: null,
    })
    const { messages, socket } = await connect(server.url!)
    await waitFor(() => messages.some((message) => message.type === 'document:opened'))
    const response = await fetch(`${server.url}/__uidx/patch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        file: 'served.uidx',
        patches: [{ op: 'set', address: 'c#root', prop: 'cornerRadius', value: 42 }],
      }),
    })
    expect(response.status).toBe(200)
    await waitFor(() =>
      messages.some((message) => message.type === 'file:changed' && message.revision === 2),
    )
    expect(await readFile(file, 'utf8')).toContain('cornerRadius={42}')
    socket.close()
  })

  it('runs headless when no viewer root is given', async () => {
    server = await createUidxServer({ file, stabilityThreshold: 10 })
    expect(server.url).toBeNull()
    expect(server.session.revision).toBe(1)
  })

  it('serves the viewer and pushes the current state on connect', async () => {
    server = await createUidxServer({
      file,
      root: dir,
      port: 4610,
      stabilityThreshold: 10,
    })
    expect(server.url).toMatch(/^http:\/\/localhost:\d+$/)

    const { messages, socket } = await connect(server.url!)
    await waitFor(() => messages.length > 0)

    const first = messages[0]!
    expect(first.type).toBe('file:changed')
    if (first.type !== 'file:changed') throw new Error('unreachable')
    expect(first.doc!.frontmatter.id).toBe('served')
    socket.close()
  })

  it('pushes file:changed to every connected client on save', async () => {
    server = await createUidxServer({ file, root: dir, port: 4620, stabilityThreshold: 10 })
    const a = await connect(server.url!)
    const b = await connect(server.url!)
    await waitFor(() => a.messages.length > 0 && b.messages.length > 0)
    a.messages.length = 0
    b.messages.length = 0

    await writeFile(file, VALID.replace('cornerRadius={4}', 'cornerRadius={16}'))
    await waitFor(() => a.messages.length > 0 && b.messages.length > 0)

    for (const { messages } of [a, b]) {
      const message = messages.at(-1)!
      expect(message.type).toBe('file:changed')
      if (message.type !== 'file:changed') throw new Error('unreachable')
      expect(message.revision).toBe(2)
      // A save reaches every client as a delta against the revision they hold.
      expect(message.base).toBe(1)
      expect(message.patches).toEqual([
        { op: 'set', address: 'c#root', prop: 'cornerRadius', value: 16 },
      ])
    }
    a.socket.close()
    b.socket.close()
  })

  it('leaves Vite its own HMR socket path', async () => {
    server = await createUidxServer({ file, root: dir, port: 4630, stabilityThreshold: 10 })
    // Connecting on the default path must not be handled by us; Vite answers it
    // with its own protocol, so we simply must not receive a UIDX message.
    const socket = new WebSocket(`${server.url!.replace('http', 'ws')}/`, 'vite-hmr')
    const messages: string[] = []
    socket.on('message', (d) => messages.push(String(d)))
    await new Promise<void>((resolve) => {
      socket.once('open', () => resolve())
      socket.once('error', () => resolve())
    })
    await new Promise((r) => setTimeout(r, 150))
    expect(messages.some((m) => m.includes('file:changed'))).toBe(false)
    socket.close()
  })

  it('skips a port that is already taken', async () => {
    const first = await createUidxServer({ file, root: dir, port: 4640, stabilityThreshold: 10 })
    const second = await createUidxServer({ file, root: dir, port: 4640, stabilityThreshold: 10 })
    expect(second.port).toBe(4641)
    await first.close()
    await second.close()
    // `server` is unset here; assign so afterEach has something safe to close.
    server = await createUidxServer({ file, stabilityThreshold: 10 })
  })

  it('serves the viewer index over HTTP', async () => {
    await writeFile(join(dir, 'index.html'), '<!doctype html><title>viewer</title><h1>ok</h1>')
    server = await createUidxServer({ file, root: dir, port: 4650, stabilityThreshold: 10 })
    const response = await fetch(server.url!)
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('viewer')
  })
})

/**
 * Story C1 over the wire. `FileSession` tests cover what lands on disk; these
 * cover the envelope — that a patch names the page it targets, that the reply
 * goes to the client that asked, and that everyone else hears the document.
 */
describe('node:patch over the socket (C1)', () => {
  const envelope = (over: Record<string, unknown> = {}) => ({
    type: 'node:patch',
    file,
    patchId: 'p1',
    baseRevision: 1,
    patches: [{ op: 'set', address: 'c#root', prop: 'cornerRadius', value: 12 }],
    ...over,
  })

  it('applies a patch and acks the sender', async () => {
    server = await createUidxServer({ file, root: dir, port: 4660, stabilityThreshold: 10 })
    const { messages, socket } = await connect(server.url!)
    await waitFor(() => messages.some((m) => m.type === 'file:changed'))

    socket.send(JSON.stringify(envelope()))
    await waitFor(() => messages.some((m) => m.type === 'patch:applied'))

    const ack = messages.find((m) => m.type === 'patch:applied')
    expect(ack).toMatchObject({ patchId: 'p1', revision: 2, file })
    expect(await readFile(file, 'utf8')).toContain('cornerRadius={12}')
    socket.close()
  })

  it('sends the new document to a second viewer', async () => {
    server = await createUidxServer({ file, root: dir, port: 4670, stabilityThreshold: 10 })
    const author = await connect(server.url!)
    const observer = await connect(server.url!)
    await waitFor(() => observer.messages.some((m) => m.type === 'file:changed'))
    observer.messages.length = 0

    author.socket.send(JSON.stringify(envelope()))
    await waitFor(() => observer.messages.some((m) => m.type === 'file:changed'))

    // The observer hears the document, and is told nothing about someone else's
    // in-flight gesture.
    expect(observer.messages.some((m) => m.type === 'patch:applied')).toBe(false)
    author.socket.close()
    observer.socket.close()
  })

  it('rejects a patch naming a page this server does not serve', async () => {
    server = await createUidxServer({ file, root: dir, port: 4680, stabilityThreshold: 10 })
    const { messages, socket } = await connect(server.url!)
    await waitFor(() => messages.some((m) => m.type === 'file:changed'))

    socket.send(JSON.stringify(envelope({ file: 'nowhere.uidx' })))
    await waitFor(() => messages.some((m) => m.type === 'patch:rejected'))
    expect(messages.find((m) => m.type === 'patch:rejected')).toMatchObject({
      reason: expect.stringContaining('nowhere.uidx'),
    })
    socket.close()
  })

  it('serves the latest reported selection over HTTP', async () => {
    server = await createUidxServer({ file, root: dir, port: 4700, stabilityThreshold: 10 })
    const { messages, socket } = await connect(server.url!)
    await waitFor(() => messages.some((m) => m.type === 'file:changed'))

    // Before anyone reports: an empty selection, not an error.
    const before = await fetch(`${server.url}${SELECTION_ROUTE}`)
    expect(before.status).toBe(200)
    expect(await before.json()).toEqual({ file: null, addresses: [], at: null })

    socket.send(
      JSON.stringify({
        type: 'selection:changed',
        file: 'served.uidx',
        addresses: ['served#c/root'],
      }),
    )
    // The report is fire-and-forget, so poll until the server has heard it.
    let after = {
      file: null as string | null,
      addresses: [] as string[],
      at: null as number | null,
    }
    await waitForAsync(async () => {
      after = (await (await fetch(`${server.url}${SELECTION_ROUTE}`)).json()) as typeof after
      return after.addresses.length > 0
    })
    expect(after.file).toBe('served.uidx')
    expect(after.addresses).toEqual(['served#c/root'])
    expect(after.at).toBeTypeOf('number')
    socket.close()
  })

  it('ignores a frame that is not a message, without dropping the connection', async () => {
    server = await createUidxServer({ file, root: dir, port: 4690, stabilityThreshold: 10 })
    const { messages, socket } = await connect(server.url!)
    await waitFor(() => messages.some((m) => m.type === 'file:changed'))

    socket.send('not json at all')
    socket.send(JSON.stringify({ type: 'something:else' }))
    socket.send(JSON.stringify(envelope()))

    await waitFor(() => messages.some((m) => m.type === 'patch:applied'))
    expect(socket.readyState).toBe(WebSocket.OPEN)
    socket.close()
  })
})
