import { shallowRef } from 'vue'

/**
 * The headless library, as the Contract tab reads it (ADR 0013 §3).
 *
 * A `custom-elements.json` is the library's own description of itself, and
 * the tab wants three things from it: which tags exist, which of them are
 * *roots* an author may implement, and which parts and slots each root has.
 * The rest — attributes, events — is shown for orientation and never written.
 */
export {
  contractType,
  parseHeadless,
  type HeadlessCandidate,
  type HeadlessElement,
  type HeadlessLibrary,
  type HeadlessMember,
  type HeadlessPart,
} from '@uidx/schema/headless'
import { parseHeadless, type HeadlessCandidate, type HeadlessLibrary } from '@uidx/schema/headless'
import { classifyFailure, type Failure } from './inspector-messages'

/** `null` until loaded, and when the document declares no library. */
export const headlessLibrary = shallowRef<HeadlessLibrary | null>(null)
/** Why the library could not be read, or `''`. Shown in the tab, never thrown. */
export const headlessError = shallowRef('')
/**
 * The same failure by class, for the inspector tabs' status line: they word
 * a missing file, an unreadable one and a dead server differently, and the
 * raw `headlessError` stays for the app bar and the error banner.
 */
export const headlessFailure = shallowRef<Failure | null>(null)
/**
 * Why the last library the reader chose was refused, for the Library path
 * field; null when none. A refused choice is a typo to fix, not a library
 * that stopped loading: the one already loaded stays, and so do its checks.
 */
export const headlessChoiceError = shallowRef<Failure | null>(null)
/** Libraries the project's dependencies ship, while the document names none. */
export const headlessCandidates = shallowRef<HeadlessCandidate[]>([])

/**
 * Throws when the response is not the uidx server's JSON — an HTML error
 * page from a proxy, or a dev server without the route — so the caller
 * reports a missing service instead of a JSON parse error.
 */
export function unavailable(response: Response): void {
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new Error('The headless library service is unavailable.')
  }
}

interface HeadlessPayload {
  path: string | null
  library?: unknown
  bindings?: HeadlessLibrary['bindings']
  candidates?: HeadlessCandidate[]
  codegen?: { out: string }
  error?: string
  /** The errno (`ENOENT`, `EACCES`…) or `EJSON` behind `error`, from newer servers. */
  code?: string
}

/** The server's refusal as an error that keeps its `code`, for `classifyFailure`. */
function failure(data: { error?: string; code?: string }, fallback: string): Error {
  return Object.assign(new Error(data.error ?? fallback), { code: data.code })
}

/** One finding of the code generator, as the server reports it. */
export interface Diagnostic {
  file: string
  line: number
  column: number
  message: string
  severity: string
}

/**
 * How the last Write code run ended: files written, stopped by the
 * generator's own diagnostics, or failed on the way (server, disk).
 */
export type WriteResult =
  | { kind: 'ok'; written: number; out: string; at: number }
  | { kind: 'blocked'; diagnostics: Diagnostic[] }
  | { kind: 'failed'; failure: Failure }

/** Where `uidx.json` says generated code goes (`codegen.out`), and how the last run went. */
export interface CodegenState {
  out: string | null
  running: boolean
  /** The last run as one sentence, for the app bar. */
  notice: string
  /** The last run as data, for the Code tab; null before the first. */
  result: WriteResult | null
}
export const codegenState = shallowRef<CodegenState>({
  out: null,
  running: false,
  notice: '',
  result: null,
})

function adopt(data: HeadlessPayload): void {
  headlessLibrary.value =
    data.path === null ? null : parseHeadless(data.path, data.library, data.bindings ?? {})
  headlessCandidates.value = data.candidates ?? []
  setOut(data.codegen?.out ?? null)
}

/**
 * Where generated code goes, as `uidx.json` says now. The last Write code
 * result was about the folder it wrote to: once the folder changes it no
 * longer applies, a failure above all, so it is dropped with it.
 */
function setOut(out: string | null): void {
  if (out === codegenState.value.out) return
  codegenState.value = { ...codegenState.value, out, result: null }
}

/**
 * Renders the code targets into `codegen.out` on the server (ADR 0017 §3):
 * the same generator `uidx codegen` runs, over the same files, so the panel
 * and the command line never disagree about what the code looks like.
 */
export async function generateCode(): Promise<void> {
  codegenState.value = { ...codegenState.value, running: true, notice: '', result: null }
  try {
    const response = await fetch('/__uidx/codegen', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(60_000),
    })
    unavailable(response)
    const data = (await response.json()) as {
      out?: string
      written?: string[]
      diagnostics?: Diagnostic[]
      error?: string
    }
    if (!response.ok) throw new Error(data.error ?? 'Could not generate code.')
    const errors = (data.diagnostics ?? []).filter((d) => d.severity === 'error')
    const out = data.out ?? codegenState.value.out
    const notice = errors.length
      ? `Not written: ${errors.map((d) => `${d.file}:${d.line} ${d.message}`).join('; ')}`
      : `Wrote ${data.written?.length ?? 0} files to ${out}`
    const result: WriteResult = errors.length
      ? { kind: 'blocked', diagnostics: errors }
      : { kind: 'ok', written: data.written?.length ?? 0, out: out ?? '', at: Date.now() }
    codegenState.value = { ...codegenState.value, running: false, notice, result }
  } catch (error) {
    codegenState.value = {
      ...codegenState.value,
      running: false,
      notice: error instanceof Error ? error.message : String(error),
      result: { kind: 'failed', failure: classifyFailure(error) },
    }
  }
}

/**
 * Names the library the document uses: written into `uidx.json` by the
 * server, so the choice is committed with the project and every tool reads
 * the same file. `path` is one of the candidates, or any path relative to
 * `uidx.json`.
 */
export async function chooseHeadless(path: string): Promise<void> {
  headlessChoiceError.value = null
  try {
    const response = await fetch('/__uidx/headless', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path }),
      signal: AbortSignal.timeout(15_000),
    })
    unavailable(response)
    const data = (await response.json()) as HeadlessPayload
    if (!response.ok) throw failure(data, 'Could not choose the headless library.')
    adopt(data)
    headlessError.value = ''
    headlessFailure.value = null
    void loadConnection()
    connectionGeneration.value += 1
  } catch (error) {
    headlessChoiceError.value = classifyFailure(error)
    // The server refuses a path it cannot read before writing it, so the
    // library loaded before stays; but a file that reads and does not parse
    // is already in uidx.json. Re-read what is configured now, not guess.
    await refreshHeadless()
  }
}

/**
 * Fetches the document's library from the server (`/__uidx/headless`).
 *
 * Called on every `document:opened`, which is also every reconnect, so a
 * library re-synced while the viewer was open shows up on the next reload of
 * the page without a restart.
 *
 * A failure stands until a read succeeds: cleared up front, the status line
 * would blink out and back, and be announced again, on every save.
 */
export async function refreshHeadless(): Promise<void> {
  try {
    const response = await fetch('/__uidx/headless', { signal: AbortSignal.timeout(15_000) })
    unavailable(response)
    const data = (await response.json()) as HeadlessPayload
    if (!response.ok) throw failure(data, 'Could not read the headless library.')
    adopt(data)
    headlessError.value = ''
    headlessFailure.value = null
  } catch (error) {
    headlessLibrary.value = null
    headlessCandidates.value = []
    headlessError.value = error instanceof Error ? error.message : String(error)
    headlessFailure.value = classifyFailure(error)
  }
  // Outside the try: uidx.json still loads when the library it names does
  // not, so Connect can show the configured path and the output folder.
  void loadConnection()
}

/**
 * The code connection as `uidx.json` holds it (`/__uidx/config`): the
 * library's naming profile, each component's names in the library, the
 * React component an identity renders onto, and where code goes. The
 * Connect tab edits it; the Code tab redraws when it moves.
 */
export interface ConnectionConfig {
  headless: {
    manifest: string
    profile: Record<string, string>
    bindings: Record<string, ComponentNames>
  } | null
  codegen: {
    out: string
    targets: string[] | null
    react: Record<string, ReactMapping>
  } | null
}
export interface ComponentNames {
  tag?: string
  parts?: Record<string, string>
  attributes?: Record<string, string>
  events?: Record<string, string>
}
export interface ReactMapping {
  from?: string
  export?: string
  props?: Record<string, string>
  events?: Record<string, string>
  children?: string
  omit?: string[]
}
export type ConfigChange =
  | { key: 'profile'; value: Record<string, string> | null }
  | { key: 'binding'; component: string; value: ComponentNames | null }
  | { key: 'react'; component: string; value: ReactMapping | null }
  | { key: 'codegen'; value: { out: string; targets?: string[] } }

export const connection = shallowRef<ConnectionConfig>({ headless: null, codegen: null })
/** Moves on every saved change, so what renders code from it refreshes. */
export const connectionGeneration = shallowRef(0)
export const connectionError = shallowRef('')
/**
 * Which change `connectionError` is about, when a save failed; null when it
 * is a load error. The tab shows a save error under its field, and a load
 * error in the status line.
 */
export const connectionErrorKey = shallowRef<ConfigChange['key'] | null>(null)

/** Like the library's, a load error stands until a load succeeds, so it does not blink. */
export async function loadConnection(): Promise<void> {
  try {
    const response = await fetch('/__uidx/config', { signal: AbortSignal.timeout(15_000) })
    unavailable(response)
    const data = (await response.json()) as ConnectionConfig & { error?: string }
    if (!response.ok) throw new Error(data.error ?? 'Could not read the code connection.')
    connection.value = { headless: data.headless, codegen: data.codegen }
    connectionError.value = ''
    connectionErrorKey.value = null
    // Both routes read uidx.json; mirrored here too, the output folder stays
    // current when the library route fails and `adopt` does not run.
    setOut(data.codegen?.out ?? null)
  } catch (error) {
    connectionError.value = error instanceof Error ? error.message : String(error)
    connectionErrorKey.value = null
  }
}

/** Writes one change to `uidx.json`; on success the library and codegen state follow. */
export async function saveConnection(change: ConfigChange): Promise<boolean> {
  connectionError.value = ''
  connectionErrorKey.value = null
  try {
    const response = await fetch('/__uidx/config', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(change),
      signal: AbortSignal.timeout(15_000),
    })
    unavailable(response)
    const data = (await response.json()) as ConnectionConfig & { error?: string }
    if (!response.ok) throw new Error(data.error ?? 'Could not save the change.')
    connection.value = { headless: data.headless, codegen: data.codegen }
    connectionGeneration.value += 1
    await refreshHeadless()
    return true
  } catch (error) {
    connectionError.value = error instanceof Error ? error.message : String(error)
    connectionErrorKey.value = change.key
    return false
  }
}
