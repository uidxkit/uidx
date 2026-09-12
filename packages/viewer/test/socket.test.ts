import { describe, expect, it } from 'vitest'
import {
  createUidxSocket,
  defaultUrl,
  type ConnectionState,
  type UidxSocket,
  type WebSocketLike,
} from '../src/socket'
import type { ServerMessage } from '@uidx/server/protocol'

/** Minimal fake standing in for a real socket, driven by hand. */
class FakeSocket implements WebSocketLike {
  onopen: ((ev: unknown) => unknown) | null = null
  onclose: ((ev: unknown) => unknown) | null = null
  onerror: ((ev: unknown) => unknown) | null = null
  onmessage: ((ev: { data: unknown }) => unknown) | null = null
  closed = false
  /** Everything the client sent, so the write path can be asserted on. */
  sent: string[] = []
  /** Set to make `send` throw, standing in for a socket closing under us. */
  refuseSend = false

  close(): void {
    this.closed = true
  }
  send(data: string): void {
    if (this.refuseSend) throw new Error('socket is closing')
    this.sent.push(data)
  }
  open(): void {
    this.onopen?.({})
  }
  emit(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) })
  }
  emitRaw(data: string): void {
    this.onmessage?.({ data })
  }
  drop(): void {
    this.onclose?.({})
  }
}

interface Harness {
  client: UidxSocket
  sockets: FakeSocket[]
  states: ConnectionState[]
  messages: ServerMessage[]
  timers: { fn: () => void; ms: number }[]
  runNextTimer(): void
  close(): void
}

function harness(): Harness {
  const sockets: FakeSocket[] = []
  const states: ConnectionState[] = []
  const messages: ServerMessage[] = []
  const timers: { fn: () => void; ms: number }[] = []

  const client = createUidxSocket({
    url: 'ws://test/__uidx',
    factory: () => {
      const socket = new FakeSocket()
      sockets.push(socket)
      return socket
    },
    backoff: [10, 20, 30],
    setTimeoutFn: (fn, ms) => {
      const timer = { fn, ms }
      timers.push(timer)
      return timer
    },
    clearTimeoutFn: (handle) => {
      const at = timers.indexOf(handle as (typeof timers)[number])
      if (at !== -1) timers.splice(at, 1)
    },
    onState: (state) => states.push(state),
    onMessage: (message) => messages.push(message),
  })

  return {
    client,
    sockets,
    states,
    messages,
    timers,
    runNextTimer: () => timers.shift()?.fn(),
    close: () => client.close(),
  }
}

const CHANGED: ServerMessage = {
  type: 'file:changed',
  sourceHash: 'h',
  file: 'a.uidx',
  revision: 3,
  doc: { frontmatter: { id: 'x' } } as never,
}

describe('createUidxSocket', () => {
  it('retries a stalled handshake and ignores late events from the abandoned socket', () => {
    const h = harness()
    expect(h.timers[0]!.ms).toBe(10000)
    h.runNextTimer()
    expect(h.sockets[0]!.closed).toBe(true)
    expect(h.states.at(-1)).toBe('reconnecting')
    h.runNextTimer()
    expect(h.sockets).toHaveLength(2)
    h.sockets[0]!.open()
    h.sockets[0]!.emit(CHANGED)
    h.sockets[0]!.drop()
    expect(h.messages).toEqual([])
    expect(h.states.at(-1)).toBe('reconnecting')
    h.sockets[1]!.open()
    expect(h.timers).toEqual([])
    expect(h.states.at(-1)).toBe('open')
    h.close()
  })

  it('cancels the handshake timeout when disposed before connecting', () => {
    const h = harness()
    h.close()
    expect(h.timers).toEqual([])
    h.sockets[0]!.open()
    expect(h.states.at(-1)).toBe('closed')
  })

  it('connects and reports open', () => {
    const h = harness()
    expect(h.states).toEqual(['connecting'])
    h.sockets[0]!.open()
    expect(h.states).toEqual(['connecting', 'open'])
    h.close()
  })

  it('forwards parsed messages', () => {
    const h = harness()
    h.sockets[0]!.open()
    h.sockets[0]!.emit(CHANGED)
    expect(h.messages).toEqual([CHANGED])
    h.close()
  })

  it('ignores a frame it cannot parse instead of tearing down', () => {
    const h = harness()
    h.sockets[0]!.open()
    h.sockets[0]!.emitRaw('not json{{')
    h.sockets[0]!.emit(CHANGED)
    expect(h.messages).toEqual([CHANGED])
    expect(h.sockets).toHaveLength(1)
    h.close()
  })

  it('reconnects after a drop', () => {
    const h = harness()
    h.sockets[0]!.open()
    h.sockets[0]!.drop()
    expect(h.states.at(-1)).toBe('reconnecting')

    h.runNextTimer()
    expect(h.sockets).toHaveLength(2)
    h.sockets[1]!.open()
    expect(h.states.at(-1)).toBe('open')
    h.close()
  })

  it('backs off further on each successive failure', () => {
    const h = harness()
    h.sockets[0]!.open()

    h.sockets[0]!.drop()
    expect(h.timers.at(-1)!.ms).toBe(10)
    h.runNextTimer()

    h.sockets[1]!.drop()
    expect(h.timers.at(-1)!.ms).toBe(20)
    h.runNextTimer()

    h.sockets[2]!.drop()
    expect(h.timers.at(-1)!.ms).toBe(30)
    h.runNextTimer()

    // The last entry repeats rather than growing without bound.
    h.sockets[3]!.drop()
    expect(h.timers.at(-1)!.ms).toBe(30)
    h.close()
  })

  it('resets the backoff once a connection succeeds', () => {
    const h = harness()
    h.sockets[0]!.open()
    h.sockets[0]!.drop()
    h.runNextTimer()

    h.sockets[1]!.open() // success resets the counter
    h.sockets[1]!.drop()
    expect(h.timers.at(-1)!.ms).toBe(10)
    h.close()
  })

  it('stops reconnecting once closed', () => {
    const h = harness()
    h.sockets[0]!.open()
    h.close()
    expect(h.states.at(-1)).toBe('closed')

    h.sockets[0]!.drop()
    h.runNextTimer()
    expect(h.sockets).toHaveLength(1)
  })
})

describe('defaultUrl', () => {
  it('uses ws for http', () => {
    expect(defaultUrl({ protocol: 'http:', host: 'localhost:4400' } as Location)).toBe(
      'ws://localhost:4400/__uidx',
    )
  })

  it('uses wss for https', () => {
    expect(defaultUrl({ protocol: 'https:', host: 'example.com' } as Location)).toBe(
      'wss://example.com/__uidx',
    )
  })
})

/**
 * The write path (C1). A patch carries a `baseRevision` the server checks, so a
 * message sent while the connection is down would arrive stale by construction
 * — dropping it and saying so beats queueing it into a guaranteed rejection.
 */
describe('sending', () => {
  it('sends a message once the socket is open', () => {
    const h = harness()
    h.sockets[0]!.open()

    const message = {
      type: 'node:patch' as const,
      file: 'page.uidx',
      patchId: 'p1',
      baseRevision: 3,
      patches: [],
    }
    expect(h.client.send(message)).toBe(true)
    expect(h.sockets[0]!.sent.map((s) => JSON.parse(s))).toEqual([message])
  })

  it('refuses to send before the socket has opened', () => {
    const h = harness()
    expect(
      h.client.send({
        type: 'node:patch',
        file: 'page.uidx',
        patchId: 'p1',
        baseRevision: 1,
        patches: [],
      }),
    ).toBe(false)
    expect(h.sockets[0]!.sent).toEqual([])
  })

  it('refuses to send while reconnecting', () => {
    const h = harness()
    h.sockets[0]!.open()
    h.sockets[0]!.drop()

    expect(
      h.client.send({
        type: 'node:patch',
        file: 'page.uidx',
        patchId: 'p1',
        baseRevision: 1,
        patches: [],
      }),
    ).toBe(false)
  })

  it('reports failure rather than throwing when the socket refuses the frame', () => {
    const h = harness()
    h.sockets[0]!.open()
    h.sockets[0]!.refuseSend = true

    expect(
      h.client.send({
        type: 'node:patch',
        file: 'page.uidx',
        patchId: 'p1',
        baseRevision: 1,
        patches: [],
      }),
    ).toBe(false)
  })

  it('can send again after a reconnect', () => {
    const h = harness()
    h.sockets[0]!.open()
    h.sockets[0]!.drop()
    h.runNextTimer()
    h.sockets[1]!.open()

    expect(
      h.client.send({
        type: 'node:patch',
        file: 'page.uidx',
        patchId: 'p2',
        baseRevision: 4,
        patches: [],
      }),
    ).toBe(true)
    expect(h.sockets[1]!.sent).toHaveLength(1)
  })
})
