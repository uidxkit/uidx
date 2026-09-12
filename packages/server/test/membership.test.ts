import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { membershipRoots, Workspace } from '../src/workspace.js'
import type { ServerMessage } from '../src/protocol.js'

/**
 * Membership is not fixed for the life of a server.
 *
 * The agent harness writes `.uidx` files and lets the file watch carry them to
 * the canvas — that is its whole architecture. It held only for edits to pages
 * that already existed: the session map was built once at `start()` and never
 * added to, so a created page never appeared and a deleted one kept rendering
 * from a session that could still write, which put the deleted file back on
 * disk the next time the canvas touched it.
 *
 * These tests are watcher-driven end to end, because the watcher is the thing
 * under test. They run under `fileParallelism: false` like the rest of this
 * package for the reason its vitest config gives.
 */
const page = (id: string, name: string): string =>
  `---\nid: ${id}\n---\n\n## Visual Contract\n\n<Page>\n  <Frame name="${name}" width={10} height={10} />\n</Page>\n`

let dir: string
let workspace: Workspace | null = null
let received: ServerMessage[] = []

async function waitFor(predicate: () => boolean, what: string, timeout = 15_000): Promise<void> {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > timeout) throw new Error(`timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 10))
  }
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'uidx-members-'))
  received = []
})

afterEach(async () => {
  await workspace?.close()
  workspace = null
  await rm(dir, { recursive: true, force: true })
})

async function open(files: string[] = ['**/*.uidx']): Promise<Workspace> {
  await writeFile(join(dir, 'uidx.json'), JSON.stringify({ id: 'ws', files }))
  workspace = await Workspace.open({
    from: dir,
    stabilityThreshold: 10,
    onBroadcast: (m) => received.push(m),
  })
  await workspace.start()
  received = []
  return workspace
}

const announced = (): string[][] =>
  received.filter((m) => m.type === 'document:opened').map((m) => [...m.pages])

describe('the directories a member could appear in', () => {
  it('watches the manifest directory and no deeper for a flat glob', () => {
    expect(membershipRoots(['*.uidx'])).toEqual({ dirs: [''], depth: 0 })
  })

  /**
   * The whole point. This repo's root manifest is `examples/**\/*.uidx`, and a
   * recursive watch on the manifest directory would put a live watcher on every
   * package, doc tree and build output in the repo to notice a file that can
   * only ever land under `examples/`.
   */
  it('watches only the subtree a prefixed glob can reach', () => {
    expect(membershipRoots(['examples/**/*.uidx'])).toEqual({
      dirs: ['examples'],
      depth: undefined,
    })
  })

  it('takes a nested prefix off the list and puts its levels back on the depth', () => {
    // Keeping `pages` as its own root would make chokidar walk it twice and
    // report every event twice; dropping it without raising the depth would
    // watch the manifest directory at depth 0 and never see `pages/x.uidx`.
    expect(membershipRoots(['*.uidx', 'pages/*.uidx'])).toEqual({ dirs: [''], depth: 1 })
  })

  it('keeps sibling prefixes apart', () => {
    expect(membershipRoots(['screens/*.uidx', 'tokens/*.uidx'])).toEqual({
      dirs: ['screens', 'tokens'],
      depth: 0,
    })
  })

  it('goes all the way down as soon as one glob is recursive', () => {
    expect(membershipRoots(['*.uidx', 'nested/**/*.uidx'])).toEqual({
      dirs: [''],
      depth: undefined,
    })
  })

  it('ignores a negated pattern, which can only ever remove members', () => {
    expect(membershipRoots(['pages/*.uidx', '!pages/draft.uidx'])).toEqual({
      dirs: ['pages'],
      depth: 0,
    })
  })
})

describe('a page that joins the document', () => {
  it('gets a session and reaches the client', async () => {
    await writeFile(join(dir, 'home.uidx'), page('home', 'hero'))
    const ws = await open()

    await writeFile(join(dir, 'about.uidx'), page('about', 'body'))

    await waitFor(() => ws.pages.includes('about.uidx'), 'the new page to join')
    await waitFor(
      () => received.some((m) => m.type === 'file:changed' && m.file === 'about.uidx'),
      'the new page to be sent',
    )
    expect(ws.session('about.uidx')!.current.kind).toBe('ok')
    // The client's page list comes from `document:opened`, so the announcement
    // has to be re-sent or the rail never grows a row.
    expect(announced().at(-1)).toEqual(['about.uidx', 'home.uidx'])
  })

  it('appears in a sub-directory the manifest covers', async () => {
    await writeFile(join(dir, 'home.uidx'), page('home', 'hero'))
    const ws = await open()

    await mkdir(join(dir, 'nested'), { recursive: true })
    await writeFile(join(dir, 'nested', 'deep.uidx'), page('deep', 'body'))

    await waitFor(() => ws.pages.includes('nested/deep.uidx'), 'the nested page to join')
  })

  it('is seen in a directory a second, narrower glob names', async () => {
    await writeFile(join(dir, 'home.uidx'), page('home', 'hero'))
    await mkdir(join(dir, 'pages'), { recursive: true })
    const ws = await open(['*.uidx', 'pages/*.uidx'])

    await writeFile(join(dir, 'pages', 'second.uidx'), page('second', 'body'))

    await waitFor(() => ws.pages.includes('pages/second.uidx'), 'the second glob to be watched')
  })

  it('is ignored when the manifest globs do not cover it', async () => {
    await mkdir(join(dir, 'pages'), { recursive: true })
    await writeFile(join(dir, 'pages', 'home.uidx'), page('home', 'hero'))
    const ws = await open(['pages/*.uidx'])

    await writeFile(join(dir, 'stray.uidx'), page('stray', 'body'))
    await mkdir(join(dir, 'pages', 'deeper'), { recursive: true })
    await writeFile(join(dir, 'pages', 'deeper', 'nope.uidx'), page('nope', 'body'))
    // Something the globs *do* cover, so there is a positive event to wait on
    // rather than a sleep that proves nothing.
    await writeFile(join(dir, 'pages', 'second.uidx'), page('second', 'body'))

    await waitFor(() => ws.pages.includes('pages/second.uidx'), 'the covered page to join')
    expect(ws.pages).toEqual(['pages/home.uidx', 'pages/second.uidx'])
  })
})

describe('a page that leaves the document', () => {
  it('loses its session and its place in the page list', async () => {
    await writeFile(join(dir, 'home.uidx'), page('home', 'hero'))
    await writeFile(join(dir, 'about.uidx'), page('about', 'body'))
    const ws = await open()

    await rm(join(dir, 'about.uidx'))

    await waitFor(() => !ws.pages.includes('about.uidx'), 'the page to leave')
    expect(ws.session('about.uidx')).toBeUndefined()
    expect(announced().at(-1)).toEqual(['home.uidx'])
  })

  /**
   * The one that bites hardest. A surviving `FileSession` still owns a write
   * path, so the next canvas gesture aimed at the page the user just deleted
   * patched the last-known document and wrote it back — the deletion undone by
   * the tool, on disk, with no one asking for it.
   */
  it('cannot be resurrected by a later write', async () => {
    await writeFile(join(dir, 'home.uidx'), page('home', 'hero'))
    await writeFile(join(dir, 'about.uidx'), page('about', 'body'))
    const ws = await open()
    const doomed = ws.session('about.uidx')!

    await rm(join(dir, 'about.uidx'))
    await waitFor(() => !ws.pages.includes('about.uidx'), 'the page to leave')

    // Exactly what `server.ts` refuses to route now — but the session object a
    // client could still be holding is asked directly, so the guarantee is
    // proved at the session, not only at the router.
    await doomed.patch({
      patchId: 'p1',
      baseRevision: doomed.revision,
      patches: [{ op: 'set', address: 'body', prop: 'width', value: 99 }],
    })

    await expect(access(join(dir, 'about.uidx'))).rejects.toThrow()
  })

  it('is no longer routable, so a patch aimed at it is refused', async () => {
    await writeFile(join(dir, 'home.uidx'), page('home', 'hero'))
    await writeFile(join(dir, 'about.uidx'), page('about', 'body'))
    const ws = await open()

    await rm(join(dir, 'about.uidx'))
    await waitFor(() => !ws.pages.includes('about.uidx'), 'the page to leave')

    expect(ws.session('about.uidx')).toBeUndefined()
    expect(ws.pageOf(join(dir, 'about.uidx'))).toBeNull()
  })
})

describe('the server does not react to its own writes', () => {
  it('re-announces nothing when a patch rewrites a page in place', async () => {
    await writeFile(join(dir, 'home.uidx'), page('home', 'hero'))
    const ws = await open()

    await ws.session('home.uidx')!.patch({
      patchId: 'p1',
      baseRevision: 1,
      patches: [{ op: 'set', address: 'hero', prop: 'width', value: 44 }],
    })
    // The atomic write renames a temp sibling over the target. Give the watcher
    // room to have said something about it, then insist that it did not.
    await new Promise((r) => setTimeout(r, 300))

    expect(announced()).toEqual([])
    expect(ws.pages).toEqual(['home.uidx'])
  })
})
