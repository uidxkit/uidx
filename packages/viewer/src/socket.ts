import { WS_PATH, type ClientMessage, type ServerMessage } from '@uidx/server/protocol'

export type ConnectionState = 'connecting' | 'open' | 'reconnecting' | 'closed'

export interface SocketHandlers {
  onMessage(message: ServerMessage): void
  onState(state: ConnectionState): void
}

export interface SocketOptions extends SocketHandlers {
  url?: string
  /** Injectable so tests can drive a fake socket. */
  factory?: (url: string) => WebSocketLike
  /** Backoff schedule in ms; the last entry repeats. */
  backoff?: readonly number[]
  /** Retry a stalled WebSocket upgrade instead of waiting forever. */
  connectTimeoutMs?: number
  setTimeoutFn?: (fn: () => void, ms: number) => unknown
  clearTimeoutFn?: (handle: unknown) => void
}

/** The slice of WebSocket this client uses, so a fake is trivial to write. */
export interface WebSocketLike {
  close(): void
  send(data: string): void
  onopen: ((this: unknown, ev: unknown) => unknown) | null
  onclose: ((this: unknown, ev: unknown) => unknown) | null
  onerror: ((this: unknown, ev: unknown) => unknown) | null
  onmessage: ((this: unknown, ev: { data: unknown }) => unknown) | null
}

export interface UidxSocket {
  close(): void
  /**
   * Sends a message, or drops it if the connection is down.
   *
   * Dropping is deliberate. A patch carries a `baseRevision`, and the server
   * refuses one written against a revision it has moved past — so a patch held
   * through a reconnect would arrive stale by construction, and queueing it only
   * delays a rejection. The reconnect is followed by a full `file:changed`
   * (spec §11); an edit made while disconnected is better lost loudly than
   * applied against a document nobody was looking at.
   *
   * Returns whether it went out, so the caller can say so.
   */
  send(message: ClientMessage): boolean
}

const DEFAULT_BACKOFF = [250, 500, 1000, 2000, 5000] as const

export function defaultUrl(location = globalThis.location): string {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${location.host}${WS_PATH}`
}

/**
 * Keeps a connection to the UIDX channel open, reconnecting with backoff.
 *
 * The server is stateless per connection and sends a full `file:changed` on
 * connect (spec §11), so a reconnect needs no resynchronisation handshake —
 * whatever arrives next is authoritative.
 */
export function createUidxSocket(options: SocketOptions): UidxSocket {
  const url = options.url ?? defaultUrl()
  const factory = options.factory ?? ((u: string) => new WebSocket(u) as unknown as WebSocketLike)
  const backoff = options.backoff ?? DEFAULT_BACKOFF
  const setTimer = options.setTimeoutFn ?? ((fn, ms) => setTimeout(fn, ms))
  const clearTimer = options.clearTimeoutFn ?? ((h) => clearTimeout(h as never))

  let socket: WebSocketLike | null = null
  let attempt = 0
  let timer: unknown = null
  let handshake: unknown = null
  let disposed = false
  let open = false

  const connect = (state: ConnectionState): void => {
    if (disposed) return
    options.onState(state)
    const current = factory(url)
    socket = current
    const clearHandshake = (): void => {
      if (handshake !== null) clearTimer(handshake)
      handshake = null
    }
    const retry = (): void => {
      if (disposed || socket !== current) return
      clearHandshake()
      socket = null
      open = false
      const delay = backoff[Math.min(attempt++, backoff.length - 1)]!
      timer = setTimer(() => connect('reconnecting'), delay)
      options.onState('reconnecting')
    }
    handshake = setTimer(() => {
      retry()
      current.close()
    }, options.connectTimeoutMs ?? 10000)

    current.onopen = () => {
      if (disposed || socket !== current) return
      clearHandshake()
      attempt = 0
      open = true
      options.onState('open')
    }
    current.onmessage = (event) => {
      if (disposed || socket !== current) return
      let parsed: ServerMessage
      try {
        parsed = JSON.parse(String(event.data)) as ServerMessage
      } catch {
        // A frame we cannot read is not a reason to tear down the connection.
        return
      }
      options.onMessage(parsed)
    }
    current.onclose = retry
    // An error is always followed by a close, which owns the retry.
    current.onerror = () => {}
  }

  connect('connecting')

  return {
    send(message) {
      if (!open || !socket) return false
      try {
        socket.send(JSON.stringify(message))
        return true
      } catch {
        // A socket that reports open but refuses the frame is closing under us;
        // the `onclose` that follows owns the retry.
        return false
      }
    },
    close() {
      disposed = true
      open = false
      if (timer !== null) clearTimer(timer)
      if (handshake !== null) clearTimer(handshake)
      options.onState('closed')
      socket?.close()
    },
  }
}
