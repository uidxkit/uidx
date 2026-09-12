import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { afterEach, describe, expect, it } from 'vitest'

import { discoverManifests } from '../src/workspace/discover.js'
import { openWorkspace, type Workspace } from '../src/workspace/workspace.js'

const page = (id: string, name: string) =>
  `---\nid: ${id}\n---\n\n## Visual Contract\n\n<Page>\n  <Frame name="${name}" width={10} height={10} />\n</Page>\n`

let open: Workspace | null = null
afterEach(async () => {
  await open?.close()
  open = null
})

async function workspace(): Promise<Workspace> {
  const root = await mkdtemp(join(tmpdir(), 'uidx-agent-ws-'))
  await writeFile(join(root, 'uidx.json'), JSON.stringify({ id: 'doc', files: ['**/*.uidx'] }))
  await writeFile(join(root, 'home.uidx'), page('home', 'hero'))
  const [found] = await discoverManifests([root])
  open = await openWorkspace(found!)
  return open
}

describe('openWorkspace', () => {
  it('parses every member page up front', async () => {
    const ws = await workspace()
    expect(ws.members()).toEqual(['home.uidx'])
    expect(ws.docOf('home.uidx')?.tree.children[0]?.name).toBe('hero')
  })

  it('re-reads a file the user changed on canvas', async () => {
    const ws = await workspace()
    await writeFile(join(ws.root, 'home.uidx'), page('home', 'renamed'))
    await ws.reload('home.uidx')
    expect(ws.docOf('home.uidx')?.tree.children[0]?.name).toBe('renamed')
  })

  it('picks up an edit made outside the workspace on its own, via the watcher', async () => {
    const ws = await workspace()
    // Raw fs write, deliberately not ws.writeFile/ws.reload — this proves the
    // chokidar watcher itself notices and re-parses, with no help from the caller.
    await writeFile(join(ws.root, 'home.uidx'), page('home', 'outside'))
    while (ws.docOf('home.uidx')?.tree.children[0]?.name !== 'outside') {
      await sleep(25)
    }
    expect(ws.docOf('home.uidx')?.tree.children[0]?.name).toBe('outside')
  })

  it('keeps the diagnostics of a page that stopped parsing, and its last good doc', async () => {
    const ws = await workspace()
    await writeFile(join(ws.root, 'home.uidx'), '---\nid: home\n---\n\nno contract here\n')
    await ws.reload('home.uidx')
    expect(ws.diagnosticsOf('home.uidx').length).toBeGreaterThan(0)
  })

  it('adds a file written through the workspace to its member list', async () => {
    const ws = await workspace()
    await ws.writeFile('about.uidx', page('about', 'body'))
    expect(ws.members()).toContain('about.uidx')
    expect(ws.docOf('about.uidx')).not.toBeNull()
  })

  /**
   * The index only ever shrank on its own: `unlink` was handled and `add` was
   * not, so a page the designer created on canvas stayed invisible to `read`,
   * to `search` and to the doc map for the life of the session.
   */
  it('picks up a page created outside the workspace, via the watcher', async () => {
    const ws = await workspace()
    await writeFile(join(ws.root, 'about.uidx'), page('about', 'body'))
    while (!ws.members().includes('about.uidx')) {
      await sleep(25)
    }
    expect(ws.docOf('about.uidx')?.tree.children[0]?.name).toBe('body')
  })

  it('forgets a file it removed', async () => {
    const ws = await workspace()
    await ws.removeFile('home.uidx')
    expect(ws.members()).not.toContain('home.uidx')
    expect(ws.docOf('home.uidx')).toBeNull()
  })
})
