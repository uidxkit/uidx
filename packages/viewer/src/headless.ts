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

/** `null` until loaded, and when the document declares no library. */
export const headlessLibrary = shallowRef<HeadlessLibrary | null>(null)
/** Why the library could not be read, or `''`. Shown in the tab, never thrown. */
export const headlessError = shallowRef('')
/** Libraries the project's dependencies ship, while the document names none. */
export const headlessCandidates = shallowRef<HeadlessCandidate[]>([])

function unavailable(response: Response): void {
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
}

/** Where `uidx.json` says generated code goes (`codegen.out`), and how the last run went. */
export interface CodegenState {
  out: string | null
  running: boolean
  notice: string
}
export const codegenState = shallowRef<CodegenState>({ out: null, running: false, notice: '' })

function adopt(data: HeadlessPayload): void {
  headlessLibrary.value =
    data.path === null ? null : parseHeadless(data.path, data.library, data.bindings ?? {})
  headlessCandidates.value = data.candidates ?? []
  codegenState.value = { ...codegenState.value, out: data.codegen?.out ?? null }
}

/**
 * Renders the code targets into `codegen.out` on the server (ADR 0017 §3):
 * the same generator `uidx codegen` runs, over the same files, so the panel
 * and the command line never disagree about what the code looks like.
 */
export async function generateCode(): Promise<void> {
  codegenState.value = { ...codegenState.value, running: true, notice: '' }
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
      diagnostics?: {
        file: string
        line: number
        column: number
        message: string
        severity: string
      }[]
      error?: string
    }
    if (!response.ok) throw new Error(data.error ?? 'Could not generate code.')
    const errors = (data.diagnostics ?? []).filter((d) => d.severity === 'error')
    const notice = errors.length
      ? `Not written: ${errors.map((d) => `${d.file}:${d.line} ${d.message}`).join('; ')}`
      : `Wrote ${data.written?.length ?? 0} files to ${data.out ?? codegenState.value.out}`
    codegenState.value = { ...codegenState.value, running: false, notice }
  } catch (error) {
    codegenState.value = {
      ...codegenState.value,
      running: false,
      notice: error instanceof Error ? error.message : String(error),
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
  headlessError.value = ''
  try {
    const response = await fetch('/__uidx/headless', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path }),
      signal: AbortSignal.timeout(15_000),
    })
    unavailable(response)
    const data = (await response.json()) as HeadlessPayload
    if (!response.ok) throw new Error(data.error ?? 'Could not choose the headless library.')
    adopt(data)
    void loadConnection()
    connectionGeneration.value += 1
  } catch (error) {
    headlessError.value = error instanceof Error ? error.message : String(error)
  }
}

/**
 * Fetches the document's library from the server (`/__uidx/headless`).
 *
 * Called on every `document:opened`, which is also every reconnect, so a
 * library re-synced while the viewer was open shows up on the next reload of
 * the page without a restart.
 */
export async function refreshHeadless(): Promise<void> {
  headlessError.value = ''
  try {
    const response = await fetch('/__uidx/headless', { signal: AbortSignal.timeout(15_000) })
    unavailable(response)
    const data = (await response.json()) as HeadlessPayload
    if (!response.ok) throw new Error(data.error ?? 'Could not read the headless library.')
    adopt(data)
    void loadConnection()
  } catch (error) {
    headlessLibrary.value = null
    headlessCandidates.value = []
    headlessError.value = error instanceof Error ? error.message : String(error)
  }
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

export async function loadConnection(): Promise<void> {
  try {
    const response = await fetch('/__uidx/config', { signal: AbortSignal.timeout(15_000) })
    unavailable(response)
    const data = (await response.json()) as ConnectionConfig & { error?: string }
    if (!response.ok) throw new Error(data.error ?? 'Could not read the code connection.')
    connection.value = { headless: data.headless, codegen: data.codegen }
  } catch (error) {
    connectionError.value = error instanceof Error ? error.message : String(error)
  }
}

/** Writes one change to `uidx.json`; on success the library and codegen state follow. */
export async function saveConnection(change: ConfigChange): Promise<boolean> {
  connectionError.value = ''
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
    return false
  }
}
