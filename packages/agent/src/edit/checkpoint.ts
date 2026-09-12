import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { AGENT_DIR, resolveInside } from './jail.js'

export interface CheckpointStore {
  /** Snapshot a file's prior content, once per turn. */
  capture(turnId: string, relPath: string): Promise<void>
  /** Restore every file the turn captured. Returns the files restored. */
  revert(turnId: string): Promise<string[]>
  turns(): Promise<string[]>
}

/** A missing file is a real prior state: reverting means deleting it again. */
const ABSENT = '\u0000absent'

const encode = (relPath: string): string => encodeURIComponent(relPath)
const decode = (name: string): string => decodeURIComponent(name)

/**
 * A turn id is a `randomUUID`, and nothing else may name a directory here.
 *
 * `encodeURIComponent` leaves `..` untouched, so `revert('..')` resolved to
 * `.uidx-agent/` itself and read everything in it as a turn's snapshots.
 * Harmless only for as long as that directory holds exactly one subdirectory —
 * Phase 2 puts config and memory beside it. Checking the shape is cheaper than
 * resolving the path and safer than trusting an encoding, and the id is
 * machine-generated, so nothing legitimate is turned away.
 */
const TURN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function createCheckpointStore(root: string): CheckpointStore {
  const base = join(root, AGENT_DIR, 'checkpoints')
  const dirOf = (turnId: string): string => {
    if (!TURN_ID.test(turnId)) throw new Error(`no checkpoint for turn ${turnId}: not a turn id`)
    return join(base, turnId)
  }

  return {
    async capture(turnId, relPath) {
      // Resolve first, outside any try/catch: a JailError must propagate to
      // the caller, never be mistaken for "the file doesn't exist yet".
      const target = resolveInside(root, relPath)

      const dir = dirOf(turnId)
      await mkdir(dir, { recursive: true })
      const snapshot = join(dir, encode(relPath))

      // First writer wins: the snapshot must hold what the turn *found*.
      try {
        await readFile(snapshot, 'utf8')
        return
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        // no snapshot yet
      }

      let prior: string
      try {
        prior = await readFile(target, 'utf8')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        prior = ABSENT
      }
      await writeFile(snapshot, prior, 'utf8')
    },

    async revert(turnId) {
      const dir = dirOf(turnId)
      let names: string[]
      try {
        names = await readdir(dir)
      } catch {
        throw new Error(`no checkpoint for turn ${turnId}`)
      }

      const restored: string[] = []
      for (const name of names.sort()) {
        const relPath = decode(name)
        const prior = await readFile(join(dir, name), 'utf8')
        const target = resolveInside(root, relPath)
        if (prior === ABSENT) await rm(target, { force: true })
        else await writeFile(target, prior, 'utf8')
        restored.push(relPath)
      }
      return restored
    },

    async turns() {
      try {
        // Turn ids are UUIDs and are stored verbatim, so there is nothing to
        // decode — only the per-file snapshot names carry an encoded path.
        return (await readdir(base)).sort()
      } catch {
        return []
      }
    },
  }
}
