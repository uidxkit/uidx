import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { createCheckpointStore } from '../src/edit/checkpoint.js'
import { JailError } from '../src/edit/jail.js'

/** Turn ids are `randomUUID`s in the service, and the store insists on it. */
const TURN = '7d1f0a2c-4b3e-4f6a-9c8d-0e1f2a3b4c5d'
const OTHER_TURN = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'

async function root(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'uidx-agent-ck-'))
  await writeFile(join(dir, 'home.uidx'), 'original')
  return dir
}

describe('createCheckpointStore', () => {
  it('restores the content a turn found, not the content it left', async () => {
    const dir = await root()
    const store = createCheckpointStore(dir)

    await store.capture(TURN, 'home.uidx')
    await writeFile(join(dir, 'home.uidx'), 'agent wrote this')
    await store.revert(TURN)

    expect(await readFile(join(dir, 'home.uidx'), 'utf8')).toBe('original')
  })

  it('captures a file once per turn, so a second edit cannot overwrite the snapshot', async () => {
    const dir = await root()
    const store = createCheckpointStore(dir)

    await store.capture(TURN, 'home.uidx')
    await writeFile(join(dir, 'home.uidx'), 'first edit')
    await store.capture(TURN, 'home.uidx')
    await writeFile(join(dir, 'home.uidx'), 'second edit')
    await store.revert(TURN)

    expect(await readFile(join(dir, 'home.uidx'), 'utf8')).toBe('original')
  })

  it('reports which files a revert restored', async () => {
    const dir = await root()
    const store = createCheckpointStore(dir)
    await store.capture(TURN, 'home.uidx')
    expect(await store.revert(TURN)).toEqual(['home.uidx'])
  })

  it('records a file that did not exist, and deletes it on revert', async () => {
    const dir = await root()
    const store = createCheckpointStore(dir)

    await store.capture(TURN, 'new.uidx')
    await writeFile(join(dir, 'new.uidx'), 'created by the agent')
    await store.revert(TURN)

    await expect(readFile(join(dir, 'new.uidx'), 'utf8')).rejects.toThrow()
  })

  it('refuses to revert a turn it never saw', async () => {
    const store = createCheckpointStore(await root())
    await expect(store.revert(OTHER_TURN)).rejects.toThrow(new RegExp(OTHER_TURN))
  })

  /**
   * `encodeURIComponent` leaves `..` alone, so this resolved to `.uidx-agent/`
   * itself and read whatever was in it as a turn's snapshots. Only one
   * subdirectory lives there today; Phase 2 puts config and memory beside it.
   */
  it('refuses a turn id that is not one, rather than walking out of the checkpoint store', async () => {
    const store = createCheckpointStore(await root())
    for (const bogus of ['..', '../..', 'turn-1', '', '.']) {
      await expect(store.revert(bogus)).rejects.toThrow(/not a turn id/)
      await expect(store.capture(bogus, 'home.uidx')).rejects.toThrow(/not a turn id/)
    }
  })

  it('refuses to capture a path that escapes the root, rather than recording it as absent', async () => {
    const dir = await root()
    const store = createCheckpointStore(dir)

    await expect(store.capture(TURN, '../outside.uidx')).rejects.toThrow(JailError)
  })

  it('refuses to capture an absolute path, rather than recording it as absent', async () => {
    const dir = await root()
    const store = createCheckpointStore(dir)

    await expect(store.capture(TURN, '/etc/passwd')).rejects.toThrow(JailError)
  })
})
