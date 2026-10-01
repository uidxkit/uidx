import { readFile, writeFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'

import { readManifest, type FoundManifest } from './document.js'
import type { MiddlewareHost, ViewerPlugin } from './static-viewer.js'

/**
 * The code connection, edited from the viewer (ADR 0013 §3, ADR 0017 §3).
 *
 * What a component *is* lives in its `.uidx` file; how the project's code
 * spells it lives in `uidx.json` — the library's naming profile, each
 * component's tag and attribute and event names there, the React component
 * an identity renders onto, and where generated code goes. This route edits
 * exactly those fields and nothing else, re-validates the whole manifest
 * after the change, and puts the file back as it was when the change makes
 * it invalid — so the panel can never leave a project that does not load.
 */
export const CONFIG_ROUTE = '/__uidx/config'

export type ConfigChange =
  | { key: 'profile'; value: Record<string, string> | null }
  | { key: 'binding'; component: string; value: Record<string, unknown> | null }
  | { key: 'react'; component: string; value: Record<string, unknown> | null }
  | { key: 'codegen'; value: { out: string; targets?: string[] } }

export class ConfigError extends Error {}

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

/** Empty records and undefined entries go, so a cleared mapping leaves no trace. */
function prune(value: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined || entry === null || entry === '') continue
    const nested = record(entry)
    if (nested) {
      const kept = prune(nested)
      if (Object.keys(kept).length) out[key] = kept
    } else if (Array.isArray(entry) && entry.length === 0) continue
    else out[key] = entry
  }
  return out
}

export async function writeConfig(found: FoundManifest, change: ConfigChange): Promise<void> {
  const before = await readFile(found.path, 'utf8')
  const raw = JSON.parse(before) as Record<string, unknown>

  if (change.key === 'profile' || change.key === 'binding') {
    const declared = raw.headless
    if (declared === undefined)
      throw new ConfigError('Choose the headless library first; its names are what this maps.')
    const headless: Record<string, unknown> =
      typeof declared === 'string' ? { manifest: declared } : { ...record(declared) }
    if (change.key === 'profile') {
      if (change.value) headless.profile = prune(change.value)
      else delete headless.profile
    } else {
      const bindings = { ...record(headless.bindings) }
      const value = change.value ? prune(change.value) : {}
      if (Object.keys(value).length) bindings[change.component] = value
      else delete bindings[change.component]
      if (Object.keys(bindings).length) headless.bindings = bindings
      else delete headless.bindings
    }
    // Back to the short form when only the manifest is left.
    raw.headless =
      Object.keys(headless).length === 1 && typeof headless.manifest === 'string'
        ? headless.manifest
        : headless
  } else {
    const codegen: Record<string, unknown> = { ...record(raw.codegen) }
    if (change.key === 'codegen') {
      const out = change.value.out.trim()
      if (!out) throw new ConfigError('Name the folder generated code goes into.')
      codegen.out = out
      if (change.value.targets?.length) codegen.targets = change.value.targets
      else delete codegen.targets
    } else {
      if (typeof codegen.out !== 'string')
        throw new ConfigError('Say where generated code goes first ("Output" below).')
      const react = { ...record(codegen.react) }
      const value = change.value ? prune(change.value) : {}
      if (Object.keys(value).length) {
        if (typeof value.from !== 'string')
          throw new ConfigError('Name the module the React component is imported from.')
        react[change.component] = value
      } else delete react[change.component]
      if (Object.keys(react).length) codegen.react = react
      else delete codegen.react
    }
    raw.codegen = codegen
  }

  await writeFile(found.path, `${JSON.stringify(raw, null, 2)}\n`)
  try {
    const fresh = await readManifest(found.path)
    // In place: the workspace and every route hold this same manifest object.
    const current = found.manifest as unknown as Record<string, unknown>
    for (const key of Object.keys(current)) if (!(key in fresh)) delete current[key]
    Object.assign(found.manifest, fresh)
  } catch (error) {
    await writeFile(found.path, before)
    throw new ConfigError(error instanceof Error ? error.message : String(error))
  }
}

/** What the panel shows: the connection fields of `uidx.json`, as they stand. */
export function configView(found: FoundManifest) {
  const { headless, codegen } = found.manifest
  return {
    headless: headless
      ? {
          manifest: headless.manifest,
          profile: headless.profile ?? {},
          bindings: headless.bindings ?? {},
        }
      : null,
    codegen: codegen
      ? { out: codegen.out, targets: codegen.targets ?? null, react: codegen.react ?? {} }
      : null,
  }
}

async function body(request: IncomingMessage, limit = 16_384): Promise<string> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request as AsyncIterable<Buffer>) {
    size += chunk.length
    if (size > limit) throw new ConfigError('The change is too large.')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString()
}

function parseChange(text: string): ConfigChange {
  const input = record(JSON.parse(text))
  const key = input?.key
  const component = input?.component
  const value = input?.value
  if (key === 'profile' && (value === null || record(value)))
    return { key, value: value as Record<string, string> | null }
  if ((key === 'binding' || key === 'react') && typeof component === 'string' && component) {
    if (value === null || record(value))
      return { key, component, value: value as Record<string, unknown> | null }
  }
  if (key === 'codegen' && record(value) && typeof record(value)!.out === 'string')
    return { key, value: value as { out: string; targets?: string[] } }
  throw new ConfigError('That is not a change this panel makes.')
}

export function configRoutePlugin(manifest: { current: FoundManifest | null }): ViewerPlugin {
  const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    response.setHeader('cache-control', 'no-store')
    response.setHeader('content-type', 'application/json')
    const found = manifest.current
    if (!found) {
      response.statusCode = 404
      response.end(JSON.stringify({ error: 'Open a uidx project to connect it to code.' }))
      return
    }
    try {
      if (request.method === 'PATCH') {
        const origin = request.headers.origin
        if (
          request.headers['sec-fetch-site'] === 'cross-site' ||
          (origin && new URL(origin).host !== request.headers.host)
        ) {
          response.statusCode = 403
          response.end(
            JSON.stringify({ error: 'Configuration changes must come from this viewer.' }),
          )
          return
        }
        await writeConfig(found, parseChange(await body(request)))
      } else if (request.method !== 'GET') {
        response.statusCode = 405
        response.end(JSON.stringify({ error: 'GET to read, PATCH to change.' }))
        return
      }
      response.end(JSON.stringify(configView(found)))
    } catch (error) {
      response.statusCode = 400
      response.end(
        JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      )
    }
  }
  const configure = (server: MiddlewareHost): void => {
    server.middlewares.use(CONFIG_ROUTE, (req, res) => {
      void handle(req, res)
    })
  }
  return { name: 'uidx:config', configureServer: configure, configurePreviewServer: configure }
}
