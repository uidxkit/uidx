import type { Tool } from 'ai'

import {
  discoverSkills,
  renderSkillListing,
  type SkillEntry,
  type SkillRoot,
} from '../skills/discover.js'
import { skillTools } from '../skills/tool.js'

/**
 * Memory is a skill shelf under another name.
 *
 * A memory and a skill have the same shape at every point that matters: a
 * one-line description that rides in the prompt whether or not it is ever
 * used, and a body read on demand and bounded by the same budget. Phase 2's
 * design described "an always-loaded index plus topic files read on demand",
 * which is `discoverSkills` + `renderSkillListing` + `use_skill`, exactly.
 *
 * So this module builds no mechanism. It points the existing one at
 * `.uidx-agent/memory/` and renames the tool, because the two shelves answer
 * different questions and a model choosing between them should not have to
 * guess which pile a thing is in: a skill is how to do something well, a
 * memory is something this harness got wrong before.
 *
 * What is deliberately *not* here: any way for the agent to write one. A
 * lesson worth keeping is one a person agreed with, and an agent that edits
 * its own memory unsupervised drifts without anyone noticing. Seeded by hand,
 * from corrections that were actually measured.
 */
export type MemoryEntry = SkillEntry

/** The directory name under `.uidx-agent/`, beside `skills/`. */
export const MEMORY_DIR = 'memory'

export function discoverMemories(roots: readonly SkillRoot[]): Promise<MemoryEntry[]> {
  return discoverSkills(roots)
}

export function renderMemoryListing(memories: readonly MemoryEntry[]): string {
  return renderSkillListing(memories)
}

export interface MemoryToolDeps {
  memories: () => readonly MemoryEntry[]
  maxChars: number
}

export function memoryTools(deps: MemoryToolDeps): { use_memory: Tool } {
  const { use_skill } = skillTools({ skills: deps.memories, maxChars: deps.maxChars })
  return {
    use_memory: {
      ...use_skill,
      description:
        'Read one lesson from memory by name, from the list under "Memory" above — things this harness got wrong before. Read one when you are about to do the thing it is about.',
    } as Tool,
  }
}
