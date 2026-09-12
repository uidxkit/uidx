import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { UidxPatch } from '@uidx/format'

/**
 * What the designer has selected in a running viewer, read from outside the
 * browser — the piece that lets "make this blue" mean something to an agent
 * on the shell. Both the CLI (`uidx selection`) and the MCP tool call this
 * one function, per the one-implementation rule.
 *
 * The viewer's server leaves a discovery file next to the document manifest
 * while it runs (`@uidx/server`'s `DISCOVERY_NAME`) and answers the selection
 * route with the latest report from the canvas. Two literals below are that
 * wire contract, duplicated rather than imported so this package does not
 * grow a dependency on the server package (and its Vite) for two strings.
 */
const DISCOVERY_NAME = '.uidx-server.json'
const SELECTION_ROUTE = '/__uidx/selection'
const PATCH_ROUTE = '/__uidx/patch'

export interface ViewerSelection {
  /** The page the selection is on; null when nothing was ever selected. */
  file: string | null
  addresses: string[]
  /** When the viewer last reported (ms since epoch); null before any report. */
  at: number | null
}

export type ViewerSelectionResult =
  { viewer: 'none'; reason: string } | { viewer: 'open'; url: string; selection: ViewerSelection }

const NO_VIEWER = 'no viewer is open on this document — start one with `uidx open <page.uidx>`'

export async function viewerSelection(
  root: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ViewerSelectionResult> {
  let url: string
  try {
    const raw = await readFile(join(root, DISCOVERY_NAME), 'utf8')
    const info = JSON.parse(raw) as { url?: unknown }
    if (typeof info.url !== 'string') return { viewer: 'none', reason: NO_VIEWER }
    url = info.url
  } catch {
    return { viewer: 'none', reason: NO_VIEWER }
  }

  try {
    const response = await fetchImpl(`${url}${SELECTION_ROUTE}`)
    if (!response.ok) return { viewer: 'none', reason: NO_VIEWER }
    const selection = (await response.json()) as ViewerSelection
    return { viewer: 'open', url, selection }
  } catch {
    // A discovery file with nobody home: the server crashed without cleaning
    // up. Same answer as no file — the fetch is the liveness check.
    return { viewer: 'none', reason: NO_VIEWER }
  }
}

export type PostPatchesResult =
  | { posted: true; revision: number; sourceHash: string }
  | { posted: false; reason: 'no-viewer' | 'stale' | 'rejected' | 'failed'; message: string }

/**
 * Hands patches to the viewer server's session instead of writing the file
 * (viewer-at-scale spec §3). The server applies them to its head, writes the
 * file once, and broadcasts a delta — so an LLM's edit reaches the canvas the
 * way the author's does, with no watcher round trip and no second parse.
 *
 * No viewer, or a viewer that is not answering, means the caller writes the
 * file itself exactly as before. A refusal comes back with the patcher's
 * sentence so the model can act on it.
 */
export async function postPatches(
  root: string,
  file: string,
  patches: readonly UidxPatch[],
  fetchImpl: typeof fetch = fetch,
): Promise<PostPatchesResult> {
  let url: string
  try {
    const raw = await readFile(join(root, DISCOVERY_NAME), 'utf8')
    const info = JSON.parse(raw) as { url?: unknown }
    if (typeof info.url !== 'string')
      return { posted: false, reason: 'no-viewer', message: NO_VIEWER }
    url = info.url
  } catch {
    return { posted: false, reason: 'no-viewer', message: NO_VIEWER }
  }
  let response: Response
  try {
    response = await fetchImpl(`${url}${PATCH_ROUTE}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ file, patches }),
    })
  } catch {
    return { posted: false, reason: 'no-viewer', message: NO_VIEWER }
  }
  let body: { revision?: unknown; sourceHash?: unknown; error?: unknown } = {}
  try {
    body = (await response.json()) as typeof body
  } catch {
    // fall through to the status check
  }
  if (response.ok && typeof body.revision === 'number' && typeof body.sourceHash === 'string') {
    return { posted: true, revision: body.revision, sourceHash: body.sourceHash }
  }
  const message =
    typeof body.error === 'string' ? body.error : `the viewer answered ${response.status}`
  if (response.status === 409) return { posted: false, reason: 'stale', message }
  if (response.status === 422) return { posted: false, reason: 'rejected', message }
  return { posted: false, reason: 'failed', message }
}
