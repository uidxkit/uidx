import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  chooseHeadless,
  codegenState,
  connection,
  connectionError,
  headlessChoiceError,
  headlessError,
  headlessFailure,
  headlessLibrary,
  loadConnection,
  refreshHeadless,
} from '../src/headless'
import { classifyFailure } from '../src/inspector-messages'

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const MANIFEST = { modules: [{ declarations: [{ tagName: 'sl-button' }] }] }
const LIBRARY = {
  path: 'vendor/shoelace/custom-elements.json',
  library: MANIFEST,
  bindings: {},
  candidates: [],
  codegen: { out: '../generated' },
}
const CONFIG = (out: string) => ({
  headless: { manifest: LIBRARY.path, profile: {}, bindings: {} },
  codegen: { out, targets: null, react: {} },
})

/** Routes `fetch` by method and path; each route answers in turn, the last one repeatedly. */
function serve(routes: Record<string, (() => Response | Promise<Response>)[]>) {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${url}`
    const answers = routes[key]
    if (!answers?.length) throw new Error(`unexpected ${key}`)
    return (answers.length > 1 ? answers.shift()! : answers[0]!)()
  })
  vi.stubGlobal('fetch', fetcher)
  return fetcher
}

afterEach(() => {
  vi.unstubAllGlobals()
  headlessLibrary.value = null
  headlessError.value = ''
  headlessFailure.value = null
  headlessChoiceError.value = null
  connection.value = { headless: null, codegen: null }
  connectionError.value = ''
  codegenState.value = { out: null, running: false, notice: '', result: null }
})

/** The library a document names, as the inspector tabs read it from the server. */
describe('the headless library', () => {
  it('keeps the loaded library when a mistyped choice is refused', async () => {
    serve({
      'GET /__uidx/headless': [() => json(LIBRARY)],
      'GET /__uidx/config': [() => json(CONFIG('../generated'))],
      'PUT /__uidx/headless': [
        () =>
          json({ error: 'Could not read vendor/nope/custom-elements.json', code: 'ENOENT' }, 400),
      ],
    })
    await refreshHeadless()
    expect(headlessLibrary.value?.elements.has('sl-button')).toBe(true)

    await chooseHeadless('vendor/nope/custom-elements.json')
    // A typo for the field to show, not a library that stopped loading.
    expect(headlessChoiceError.value?.code).toBe('not-found')
    expect(headlessFailure.value).toBeNull()
    expect(headlessError.value).toBe('')
    expect(headlessLibrary.value?.elements.has('sl-button')).toBe(true)
  })

  it('shows the real failure when the refused choice was written anyway', async () => {
    // A file that reads but does not parse is in uidx.json before it fails.
    serve({
      'PUT /__uidx/headless': [() => json({ error: 'Not JSON', code: 'EJSON' }, 400)],
      'GET /__uidx/headless': [() => json({ error: 'Not JSON', code: 'EJSON' }, 400)],
      'GET /__uidx/config': [() => json(CONFIG('../generated'))],
    })
    await chooseHeadless('vendor/broken.json')
    expect(headlessChoiceError.value?.code).toBe('invalid-json')
    expect(headlessFailure.value?.code).toBe('invalid-json')
    expect(headlessLibrary.value).toBeNull()
  })

  it('clears a choice error, and any failure, once a choice is accepted', async () => {
    headlessChoiceError.value = classifyFailure(Object.assign(new Error('x'), { code: 'ENOENT' }))
    headlessFailure.value = classifyFailure(Object.assign(new Error('x'), { code: 'ENOENT' }))
    serve({
      'PUT /__uidx/headless': [() => json(LIBRARY)],
      'GET /__uidx/config': [() => json(CONFIG('../generated'))],
    })
    await chooseHeadless(LIBRARY.path)
    expect(headlessChoiceError.value).toBeNull()
    expect(headlessFailure.value).toBeNull()
    expect(headlessLibrary.value).not.toBeNull()
  })

  it('keeps a failure in place while it reads again, so the status line does not blink', async () => {
    const missing = () => json({ error: 'ENOENT: no such file', code: 'ENOENT' }, 404)
    serve({
      'GET /__uidx/headless': [missing],
      'GET /__uidx/config': [() => json(CONFIG('../generated'))],
    })
    await refreshHeadless()
    const first = headlessFailure.value
    expect(first?.code).toBe('not-found')

    const seen: (string | null)[] = []
    const again = refreshHeadless()
    seen.push(headlessFailure.value?.code ?? null)
    await again
    seen.push(headlessFailure.value?.code ?? null)
    expect(seen).toEqual(['not-found', 'not-found'])
  })
})

describe('the output folder and the last write', () => {
  it('follows uidx.json while the library route fails', async () => {
    serve({
      'GET /__uidx/config': [() => json(CONFIG('../generated')), () => json(CONFIG('../gen2'))],
    })
    await loadConnection()
    expect(codegenState.value.out).toBe('../generated')
    await loadConnection()
    expect(codegenState.value.out).toBe('../gen2')
  })

  it('drops the last write result once the folder it wrote to changes', async () => {
    const failed = classifyFailure(new Error("ENOTDIR: not a directory, mkdir '/abs/x/html'"))
    codegenState.value = {
      out: '../package.json/x',
      running: false,
      notice: 'ENOTDIR',
      result: { kind: 'failed', failure: failed },
    }
    serve({
      'GET /__uidx/headless': [
        () => json({ ...LIBRARY, codegen: { out: '../package.json/x' } }),
        () => json({ ...LIBRARY, codegen: { out: '../generated' } }),
      ],
      'GET /__uidx/config': [
        () => json(CONFIG('../package.json/x')),
        () => json(CONFIG('../generated')),
      ],
    })
    // The same folder: the result still describes it.
    await refreshHeadless()
    expect(codegenState.value.result?.kind).toBe('failed')
    // Another folder: it no longer applies.
    await refreshHeadless()
    expect(codegenState.value.out).toBe('../generated')
    expect(codegenState.value.result).toBeNull()
    // The app bar's sentence stays as it was.
    expect(codegenState.value.notice).toBe('ENOTDIR')
  })
})
