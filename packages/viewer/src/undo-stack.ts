import { shallowRef } from 'vue'
import type { UidxPatch } from '@uidx/format'

export type Origin = 'author' | { turn: string } | 'external'

export interface StackEntry {
  label: string
  origin: Origin
  files: Map<string, { forward: UidxPatch[]; inverse: UidxPatch[] }>
  /** Source hashes of the revisions this entry covers, for turn attribution. */
  hashes: string[]
}

export interface UndoStack {
  pushAuthor(file: string, forward: UidxPatch[], inverse: UidxPatch[], label: string): void
  pushExternal(file: string, forward: UidxPatch[], inverse: UidxPatch[], sourceHash: string): void
  /** Merges the run of external entries whose hashes a turn wrote into one turn entry. */
  attributeTurn(turn: string, written: readonly string[]): void
  undo(): StackEntry | null
  redo(): StackEntry | null
  readonly canUndo: boolean
  readonly canRedo: boolean
  readonly entries: readonly StackEntry[]
  readonly version: number
}

const MAX_ENTRIES = 200

/**
 * One linear history for every writer (spec §5). Undo hands back the entry;
 * dispatching its inverse is the shell's job, because that is a write like any
 * other — predicted, sent, confirmed — never a private rewind.
 *
 * Any new entry clears redo, whoever wrote it: one shared stack has one
 * linear history, and a redo over somebody else's revision would replay an
 * edit against a document it was never made on.
 */
export function createUndoStack(): UndoStack {
  const past: StackEntry[] = []
  const future: StackEntry[] = []
  const version = shallowRef(0)
  const bump = (): void => {
    version.value += 1
  }

  const push = (entry: StackEntry): void => {
    past.push(entry)
    if (past.length > MAX_ENTRIES) past.shift()
    future.length = 0
    bump()
  }

  return {
    pushAuthor(file, forward, inverse, label) {
      push({ label, origin: 'author', files: new Map([[file, { forward, inverse }]]), hashes: [] })
    },
    pushExternal(file, forward, inverse, sourceHash) {
      const label = forward.length
        ? `Change to ${file}`
        : `Change to ${file} (prose only — nothing to undo)`
      push({
        label,
        origin: 'external',
        files: new Map([[file, { forward, inverse }]]),
        hashes: [sourceHash],
      })
    },
    attributeTurn(turn, written) {
      const owned = new Set(written)
      const isTurns = (entry: StackEntry): boolean =>
        entry.origin === 'external' && entry.hashes.every((h) => owned.has(h))
      // The turn's revisions are a contiguous run of external entries; an
      // author edit made after the turn sits above the run and stays put.
      let end = past.length
      while (end > 0 && !isTurns(past[end - 1]!)) end -= 1
      let start = end
      while (start > 0 && isTurns(past[start - 1]!)) start -= 1
      if (start === end) return
      const run = past.slice(start, end)
      const merged: StackEntry = {
        label: 'LLM turn',
        origin: { turn },
        files: new Map(),
        hashes: run.flatMap((e) => e.hashes),
      }
      for (const entry of run) {
        for (const [file, { forward, inverse }] of entry.files) {
          const slot = merged.files.get(file) ?? { forward: [], inverse: [] }
          slot.forward.push(...forward)
          slot.inverse.unshift(...inverse)
          merged.files.set(file, slot)
        }
      }
      past.splice(start, run.length, merged)
      bump()
    },
    undo() {
      const entry = past.pop() ?? null
      if (entry) {
        future.push(entry)
        bump()
      }
      return entry
    },
    redo() {
      const entry = future.pop() ?? null
      if (entry) {
        past.push(entry)
        bump()
      }
      return entry
    },
    get canUndo() {
      void version.value
      return past.length > 0
    },
    get canRedo() {
      void version.value
      return future.length > 0
    },
    get entries() {
      void version.value
      return past
    },
    get version() {
      return version.value
    },
  }
}
