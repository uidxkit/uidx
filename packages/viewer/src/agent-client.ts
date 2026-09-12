/**
 * Everything the panel needs to talk to the agent service, kept out of the
 * component so it can be tested without mounting anything.
 */
const DEFAULT_URL = 'http://localhost:4500'

export function agentUrl(env: Record<string, string | undefined>): string {
  return (env.VITE_UIDX_AGENT_URL ?? DEFAULT_URL).replace(/\/+$/, '')
}

export interface AgentStatus {
  online: boolean
  version?: string
}

export async function probeAgent(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<AgentStatus> {
  try {
    const response = await fetchImpl(`${url}/health`)
    if (!response.ok) return { online: false }
    const body = (await response.json()) as { version?: string }
    return { online: true, version: body.version }
  } catch {
    // The service is optional; not running is a normal state, not an error.
    return { online: false }
  }
}

export interface ChatContext {
  documentId: string | null
  page: string | null
  selection: readonly string[]
  /**
   * The task this conversation belongs to, once a reply has supplied one —
   * `null` for the first message of a fresh conversation. Sending it back
   * lets a job too big for one turn keep the same plan (see `plan/store.ts`
   * in the agent package) across every later turn instead of each one
   * starting a fresh, unreachable plan file.
   */
  taskId: string | null
}

/** The canvas status that rides along with every message. */
export function chatBody(context: ChatContext): Record<string, unknown> {
  const body: Record<string, unknown> = { selection: [...context.selection] }
  if (context.documentId !== null) body.documentId = context.documentId
  if (context.page !== null) body.page = context.page
  if (context.taskId !== null) body.taskId = context.taskId
  return body
}

/**
 * Undoes one turn's writes.
 *
 * uidx has no document-level undo underneath the harness, so the per-turn
 * checkpoint is the whole undo story — and until this existed, that story had
 * no trigger a designer could reach. The turn id rides on each assistant
 * message's metadata, which is why the panel can offer it per turn rather than
 * only for the last one.
 *
 * Resolves to the files restored, or throws with the service's own words: a
 * revert that quietly did nothing is worse than one that says why, because the
 * canvas will go on showing the change and look like the revert worked.
 */
export async function revertTurn(
  url: string,
  request: { documentId: string | null; page: string | null; turnId: string },
  fetchImpl: typeof fetch = fetch,
): Promise<string[]> {
  const body: Record<string, unknown> = { turnId: request.turnId }
  if (request.documentId !== null) body.documentId = request.documentId
  if (request.page !== null) body.page = request.page

  const response = await fetchImpl(`${url}/revert`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

  const payload = (await response.json().catch(() => null)) as {
    error?: string
    files?: string[]
  } | null

  if (!response.ok) {
    throw new Error(payload?.error ?? `could not revert this turn (${response.status})`)
  }
  return payload?.files ?? []
}
