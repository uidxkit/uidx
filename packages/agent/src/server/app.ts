import { Hono } from 'hono'
import { cors } from 'hono/cors'

export interface AppDeps {
  version: string
  /** Runs one chat turn and returns the AI SDK UI message stream response. */
  chat: (body: unknown) => Promise<Response>
  /** Undoes one turn's writes. */
  revert: (body: unknown) => Promise<Response>
}

/**
 * The viewer, on the uidx dev server's own port. The port floats — `uidx open`
 * walks upward from 4400 until it finds a free one — so the allowance is by
 * host, not by exact origin.
 */
const LOOPBACK_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/

export function createApp(deps: AppDeps): Hono {
  const app = new Hono()

  // The viewer is served by the uidx dev server on a different port, so every
  // route has to be reachable cross-origin — but only from the machine the
  // designer is working on. Reflecting every origin meant any page they
  // happened to have open could POST a turn *and read the stream back*, and
  // that stream quotes `.uidx` source. `main.ts` binds the loopback interface
  // for the other half of this; the allowlist is what stops a browser being
  // used as the way in.
  app.use('*', cors({ origin: (origin) => (LOOPBACK_ORIGIN.test(origin) ? origin : null) }))

  // CORS is a read barrier, not a write one: a cross-origin POST that counts as
  // a "simple request" is sent before the browser ever checks who may read the
  // answer. Withholding the header stops the page seeing the stream, and this
  // stops it starting the turn at all. Registered after `cors` so a preflight
  // is still answered by the middleware that owns preflights.
  app.use('*', async (c, next) => {
    const origin = c.req.header('origin')
    if (origin !== undefined && !LOOPBACK_ORIGIN.test(origin)) {
      return c.json({ error: 'this service answers the viewer on this machine only' }, 403)
    }
    await next()
  })

  app.get('/health', (c) => c.json({ ok: true, version: deps.version }))
  app.post('/chat', async (c) => withBody(c.req.raw, deps.chat))
  app.post('/revert', async (c) => withBody(c.req.raw, deps.revert))

  return app
}

/**
 * Parses the request body, or answers in the same shape a refusal takes.
 *
 * `await c.req.json()` throwing outside a handler's own try/catch is a Hono
 * 500 with a stack in it — neither the `{ error }` contract the panel reads nor
 * anything a caller should be shown.
 */
async function withBody(
  request: Request,
  handle: (body: unknown) => Promise<Response>,
): Promise<Response> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'request body must be JSON' }, { status: 400 })
  }
  return handle(body)
}
