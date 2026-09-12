import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Workspace } from '../src/workspace.js'
import type { ServerMessage } from '../src/protocol.js'

const TOKENS = `---
id: tokens
---

## Visual Contract

<Tokens>
  <Collection name="radius">
    <Variable name="md" type="FLOAT" value={8} />
  </Collection>
</Tokens>
`

const BOUND = `---
id: bound
---

## Visual Contract

<Page>
  <Component name="Card" status="draft">
    <Frame name="root" cornerRadius="{radius#md}" />
  </Component>
</Page>
`

const LOOSE = `---
id: loose
---

## Visual Contract

<Page>
  <Component name="Loose" status="draft">
    <Frame name="root" cornerRadius={2} />
  </Component>
</Page>
`

let dir: string
let workspace: Workspace | null = null
let received: ServerMessage[] = []

const write = (name: string, body: string) => writeFile(join(dir, name), body, 'utf8')

/**
 * Only for the one test that genuinely exercises the watcher.
 *
 * Everything else drives `reload()` directly, for the reason `session.test.ts`
 * already documents: chokidar's `awaitWriteFinish` coalesces rapid writes by
 * design, so a test waiting on a specific intermediate event can wait forever.
 * Asserting the state machine through the watcher makes a correct optimisation
 * look like a bug.
 */
async function waitFor(predicate: () => boolean, timeout = 15_000): Promise<void> {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > timeout) throw new Error('timed out waiting')
    await new Promise((r) => setTimeout(r, 10))
  }
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'uidx-ws-'))
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'uidx.json'), '{ "id": "ws", "files": ["*.uidx"] }')
  await write('tokens.uidx', TOKENS)
  await write('bound.uidx', BOUND)
  await write('loose.uidx', LOOSE)
  received = []
})

afterEach(async () => {
  await workspace?.close()
  workspace = null
  await rm(dir, { recursive: true, force: true })
})

async function open(): Promise<Workspace> {
  workspace = await Workspace.open({
    from: dir,
    stabilityThreshold: 10,
    onBroadcast: (m) => received.push(m),
  })
  await workspace.start()
  return workspace
}

describe('Workspace', () => {
  it('runs a session per member page', async () => {
    const ws = await open()
    expect(ws.pages).toEqual(['bound.uidx', 'loose.uidx', 'tokens.uidx'])
    expect(ws.session('tokens.uidx')!.current.kind).toBe('ok')
  })

  it('keeps revisions per page rather than document-wide', async () => {
    const ws = await open()
    expect(ws.session('bound.uidx')!.revision).toBe(1)

    await write('bound.uidx', BOUND.replace('cornerRadius="{radius#md}"', 'cornerRadius={12}'))
    await ws.session('bound.uidx')!.reload()

    expect(ws.session('bound.uidx')!.revision).toBe(2)
    // The page nobody touched did not move.
    expect(ws.session('loose.uidx')!.revision).toBe(1)
  })

  it('tags every message with the page it concerns', async () => {
    const ws = await open()
    const snapshot = ws.snapshot('bound.uidx')
    const opened = snapshot[0]!
    expect(opened.type).toBe('document:opened')
    for (const message of snapshot.slice(1)) {
      expect(message).toHaveProperty('file')
    }
  })

  it('sends the entry page before the rest of the document', async () => {
    const ws = await open()
    // `loose` sorts last of the three, so this fails if the session map's own
    // order survives — which is the bug: the author waits on pages they are not
    // looking at before the one they asked for renders. Token pages are the one
    // thing that still goes ahead of it; see the next test for why.
    const files = ws
      .snapshot('loose.uidx')
      .slice(1)
      .map((m) => (m as { file: string }).file)
    expect(files).toEqual(['tokens.uidx', 'loose.uidx', 'bound.uidx'])
  })

  /**
   * A page cannot be drawn before the pages it resolves against have arrived.
   *
   * Every message is its own frame, and the viewer renders whatever it has when
   * a page lands — so an entry page that arrives first is built with an empty
   * token index, every `{…}` alias fails to resolve, and `resolvePaintAliases`
   * drops the paint rather than draw a literal. The author gets an unstyled
   * canvas: on a Studio sheet, 448 unresolved tokens and no white card.
   *
   * It self-heals — the viewer rebuilds when the index changes — which is
   * exactly what made it so slippery. All eight pages usually arrive in one
   * read, so the whole document is in hand before Vue flushes and nothing is
   * ever seen. Split those frames across two reads, which a large document on a
   * slower machine does, and the first paint is unstyled.
   *
   * Ordering is the fix rather than making the viewer wait: the declarations go
   * first, so however the reads split, the page that binds to them cannot be
   * built without them.
   */
  it('sends the pages that declare tokens before the page that binds to them', async () => {
    const ws = await open()
    const files = ws
      .snapshot('bound.uidx')
      .slice(1)
      .map((m) => (m as { file: string }).file)

    expect(files.indexOf('tokens.uidx')).toBeLessThan(files.indexOf('bound.uidx'))
    expect(files[0]).toBe('tokens.uidx')
  })

  it('still leads with the entry page when the entry page is the token page', async () => {
    const ws = await open()
    const files = ws
      .snapshot('tokens.uidx')
      .slice(1)
      .map((m) => (m as { file: string }).file)

    expect(files[0]).toBe('tokens.uidx')
    expect(files).toHaveLength(3)
  })

  it('re-sends a page that binds to a token whose file changed', async () => {
    const ws = await open()
    expect(ws.dependentsOf('tokens.uidx')).toEqual(['bound.uidx'])

    received.length = 0
    await write('tokens.uidx', TOKENS.replace('value={8}', 'value={16}'))
    await ws.session('tokens.uidx')!.reload()

    const changed = received.filter((m) => m.type === 'file:changed').map((m) => m.file)
    expect(changed).toContain('tokens.uidx')
    // The whole point: nothing else would tell `bound` its value moved. It is
    // told to re-resolve, not re-sent whole (viewer-at-scale spec §2).
    const reresolve = received.filter((m) => m.type === 'page:reresolve').map((m) => m.file)
    expect(reresolve).toContain('bound.uidx')
    expect(changed).not.toContain('bound.uidx')
  })

  it('leaves a page that references nothing alone', async () => {
    const ws = await open()
    expect(ws.dependentsOf('tokens.uidx')).not.toContain('loose.uidx')

    received.length = 0
    await write('tokens.uidx', TOKENS.replace('value={8}', 'value={4}'))
    await ws.session('tokens.uidx')!.reload()

    expect(received.filter((m) => m.type === 'page:reresolve').map((m) => m.file)).not.toContain(
      'loose.uidx',
    )
    expect(received.filter((m) => m.type === 'file:changed').map((m) => m.file)).not.toContain(
      'loose.uidx',
    )
  })

  it('re-indexes when a binding is added, not only at start', async () => {
    const ws = await open()
    expect(ws.dependentsOf('tokens.uidx')).toEqual(['bound.uidx'])

    await write('loose.uidx', LOOSE.replace('cornerRadius={2}', 'cornerRadius="{radius#md}"'))
    await ws.session('loose.uidx')!.reload()
    expect(ws.dependentsOf('tokens.uidx')).toEqual(['bound.uidx', 'loose.uidx'])
  })

  /** One genuinely watcher-driven case, so the wiring is not only asserted. */
  it('picks up a save through the watcher', async () => {
    const ws = await open()
    received.length = 0
    await write('loose.uidx', LOOSE.replace('cornerRadius={2}', 'cornerRadius={7}'))
    await waitFor(() => received.some((m) => m.type === 'file:changed' && m.file === 'loose.uidx'))
    expect(ws.session('loose.uidx')!.revision).toBe(2)
  })

  it('maps an absolute path back to its page id', async () => {
    const ws = await open()
    expect(ws.pageOf(join(dir, 'bound.uidx'))).toBe('bound.uidx')
    expect(ws.pageOf(join(dir, 'nope.uidx'))).toBeNull()
  })

  it('refuses to open outside a document', async () => {
    const orphan = await mkdtemp(join(tmpdir(), 'uidx-orphan-'))
    await expect(Workspace.open({ from: orphan })).rejects.toThrow(/no uidx\.json/)
    await rm(orphan, { recursive: true, force: true })
  })
})

describe('FileSession reload race (known problem, fixed here)', () => {
  it('never commits an older document at a higher revision', async () => {
    const ws = await open()
    const session = ws.session('loose.uidx')!

    // Two saves landing back to back. Before reloads were serialised both reads
    // could be in flight at once, and the slower one could win.
    for (let i = 2; i <= 6; i++) {
      await write('loose.uidx', LOOSE.replace('cornerRadius={2}', `cornerRadius={${i}}`))
    }
    await session.reload()

    const state = session.current
    expect(state.kind).toBe('ok')
    if (state.kind !== 'ok') throw new Error('unreachable')
    // Whatever revision it settled on, the document it holds is the file on disk.
    expect(state.doc.source).toContain('cornerRadius={6}')
  })
})

/**
 * Story C1 in a document. A patch names one page and writes one file — and the
 * pages that render against what it declares have to hear about it, which is
 * the reverse dependency map G6 built.
 */
describe('patching a page of a document (C1)', () => {
  it('writes only the page the envelope names', async () => {
    const ws = await open()
    const reply = await ws.session('bound.uidx')!.patch({
      patchId: 'p1',
      baseRevision: 1,
      patches: [{ op: 'set', address: 'Card#root', prop: 'cornerRadius', value: 3 }],
    })

    expect(reply).toMatchObject({ type: 'patch:applied', file: 'bound.uidx', revision: 2 })
    expect(await readFile(join(dir, 'bound.uidx'), 'utf8')).toContain('cornerRadius={3}')
    // The other members are untouched, on disk and in their revisions.
    expect(await readFile(join(dir, 'loose.uidx'), 'utf8')).toBe(LOOSE)
    expect(ws.session('loose.uidx')!.revision).toBe(1)
  })

  it('re-sends the pages that bind to a token it just changed', async () => {
    const ws = await open()
    received.length = 0

    await ws.session('tokens.uidx')!.patch({
      patchId: 'p1',
      baseRevision: 1,
      patches: [{ op: 'set', address: 'radius#md', prop: 'value', value: 16 }],
    })

    const changed = received.filter((m) => m.type === 'file:changed').map((m) => m.file)
    expect(changed).toContain('tokens.uidx')
    // `bound.uidx` renders `cornerRadius="{radius#md}"`; its own document has
    // not moved, but the value every node resolved against has — so it is told
    // to re-resolve from the tokens page it now holds.
    const reresolve = received.filter((m) => m.type === 'page:reresolve').map((m) => m.file)
    expect(reresolve).toContain('bound.uidx')
    expect(reresolve).not.toContain('loose.uidx')
    expect(changed).not.toContain('loose.uidx')
  })
})
