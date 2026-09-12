import { tool, type Tool } from 'ai'
import { z } from 'zod'

import { readFile } from 'node:fs/promises'

import { escapeContextFence } from '../agent/fence.js'
import { readSkillBody, type SkillEntry } from './discover.js'

export interface SkillToolDeps {
  /** Read fresh each call — skills are discovered once per turn (see `turn.ts`), not cached across turns. */
  skills: () => readonly SkillEntry[]
  /** Upper bound on one skill body's characters, so `use_skill` cannot swallow the context window in one call. */
  maxChars: number
}

/**
 * `use_skill` takes only `{ name }` — there is no narrower query to ask, so a
 * notice suggesting one would just reproduce the identical truncated output.
 * Naming the skill instead says plainly what was cut, without implying a
 * follow-up this tool cannot honour.
 */
const truncationNotice = (name: string, kept: number, total: number): string =>
  `\n\n[truncated to ${kept} of ${total} characters — the rest of "${name}"'s SKILL.md is not available through use_skill]`

const CHECKLIST_ITEM = z.object({ id: z.string(), requirement: z.string() })

/**
 * A skill's checklist as a block the model can plan against, or null when the
 * file is unreadable or malformed.
 *
 * Null rather than an error on purpose: a broken checklist must degrade to
 * "this skill has no checklist", never to a failed `use_skill`, because the
 * body is still the thing worth having.
 */
async function readChecklist(path: string): Promise<string | null> {
  try {
    const items = z.array(CHECKLIST_ITEM).parse(JSON.parse(await readFile(path, 'utf8')))
    if (items.length === 0) return null
    const lines = items.map((item) => `- ${item.id}: ${escapeContextFence(item.requirement)}`)
    return [
      '## REQUIREMENTS',
      '',
      ...lines,
      '',
      'None of these are done yet. Set a plan step for each, and say which are still outstanding when you stop.',
    ].join('\n')
  } catch {
    return null
  }
}

export function skillTools(deps: SkillToolDeps): { use_skill: Tool } {
  const use_skill = tool({
    description:
      'Load one skill\'s full instructions by name, from the list under "Skills" above. Call it before starting work a listed skill covers.',
    inputSchema: z.object({ name: z.string().describe('the skill name, exactly as listed') }),
    execute: async ({ name }) => {
      const skills = deps.skills()
      const found = skills.find((skill) => skill.name === name)
      if (!found) {
        const known = skills.map((skill) => skill.name).join(', ') || '(none discovered)'
        return `no skill named "${name}". Skills that do exist: ${known}`
      }

      let body: string
      try {
        // Escaped like the listing (`renderSkillListing`) and for the same
        // reason: a skill body comes from a file this harness did not write,
        // and must not be able to forge the `<context>` fence `buildAgent`
        // relies on to separate its instructions from a document's content.
        body = escapeContextFence(await readSkillBody(found.bodyPath))
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return `could not read skill "${name}": ${message}`
      }

      // Prose cannot be ticked off. A list can, and "six labels and a claim
      // of done" is exactly what an unticked list makes impossible to mistake
      // for finished.
      const requirements = found.checklistPath ? await readChecklist(found.checklistPath) : null
      const full = requirements ? `${body}\n\n${requirements}` : body

      if (full.length <= deps.maxChars) return full
      return full.slice(0, deps.maxChars) + truncationNotice(name, deps.maxChars, full.length)
    },
  })

  return { use_skill }
}
