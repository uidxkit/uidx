import { tool, type Tool } from 'ai'
import { z } from 'zod'

import type { Architecture, ArchitectureStore } from '../plan/architecture.js'
import type { DocumentIndex } from '../index/types.js'

/** The checklist item ids that are prose or component work, not canvas sections — coverage is judged on the rest. */
const NON_SECTION_IDS = new Set([
  'spec',
  'core-intent',
  'page-structure',
  'anti-patterns',
  'component',
  'variants',
])

/** The same comparison the e2e coverage uses: which of `in-context`, `inContext`, `in_context` an author reaches for says nothing about the page. */
const sameName = (a: string, b: string): boolean =>
  a.replace(/[-_\s]/g, '').toLowerCase() === b.replace(/[-_\s]/g, '').toLowerCase()

export interface ArchitectDeps {
  store: ArchitectureStore
  taskId: string
  /** The document index, for checking planned tokens and components against what exists. Absent outside a turn. */
  index?: DocumentIndex
  /** The checklist of whichever loaded skill ships one — the standard section coverage is judged against. */
  checklist?: () => { id: string; requirement: string }[] | null
}

const inputSchema = z.object({
  action: z.enum(['set', 'show']).describe('set the architecture, or show the stored one'),
  summary: z
    .string()
    .optional()
    .describe('set: one line — what is being built, and why this shape'),
  components: z
    .array(
      z.object({
        name: z.string().describe('e.g. Control/Switch'),
        props: z
          .array(z.object({ name: z.string(), type: z.string() }))
          .optional()
          .describe('configurable props, e.g. label: TEXT'),
        axes: z
          .array(z.object({ name: z.string(), values: z.array(z.string()) }))
          .describe('every variant axis with every value it takes'),
      }),
    )
    .optional()
    .describe('set: the components this page defines or reuses'),
  tokens: z
    .array(
      z.object({
        collection: z.string().describe('e.g. space'),
        tier: z.string().optional().describe('primitive | semantic | component'),
        usedFor: z.string().describe('what binds to it, one line'),
        status: z
          .enum(['exists', 'declare'])
          .describe('already in the token docs, or to be declared by this task'),
      }),
    )
    .optional()
    .describe('set: which token scales the page will bind, at which tier'),
  sections: z
    .array(
      z.object({
        name: z.string().describe('frame name, e.g. cover'),
        holds: z.string().describe('one line'),
      }),
    )
    .optional()
    .describe('set: the canvas sections in build order'),
  constraints: z
    .array(z.string())
    .optional()
    .describe(
      'set: geometry and behaviour rules the research states, e.g. "the thumb must be at least as tall as the track" — the building must obey them',
    ),
  appearance: z
    .array(z.string())
    .optional()
    .describe(
      'set: how it looks, distilled from the reference images in your own words — every visible part, what draws on top of what, where parts rest in each state, proportions as ratios (never absolute pixels)',
    ),
})

/**
 * Refuses an architecture the harness can already show is wrong, naming every
 * gap at once — the same one-refusal-names-everything contract `edit` keeps,
 * so a model fixes the whole list in one retry rather than discovering gaps
 * one call at a time.
 */
export function gateArchitecture(
  deps: Pick<ArchitectDeps, 'index' | 'checklist'>,
  architecture: Omit<Architecture, 'taskId'>,
): string | null {
  return gate(deps, architecture)
}

function gate(
  deps: Pick<ArchitectDeps, 'index' | 'checklist'>,
  architecture: Omit<Architecture, 'taskId'>,
): string | null {
  const faults: string[] = []

  if (architecture.sections.length === 0)
    faults.push('no sections — a page with no sections is not an architecture')
  for (const component of architecture.components) {
    for (const axis of component.axes) {
      if (axis.values.length < 2) {
        faults.push(
          `${component.name}'s axis "${axis.name}" has ${axis.values.length} value(s) — an axis with fewer than two values is not an axis`,
        )
      }
    }
  }

  // Planned-as-existing tokens must exist. `declare` is a free commitment.
  const known = new Set<string>()
  for (const variable of deps.index?.variables.values() ?? []) known.add(variable.collection)
  for (const binding of architecture.tokens) {
    if (binding.status === 'exists' && deps.index && !known.has(binding.collection)) {
      const have = [...known].sort().join(', ') || '(none)'
      faults.push(
        `token collection "${binding.collection}" is marked exists, but the document declares: ${have} — mark it declare, or use one that exists`,
      )
    }
  }

  // Every section-shaped requirement of the loaded checklist must have a home.
  const checklist = deps.checklist?.() ?? null
  if (checklist) {
    const missing = checklist
      .filter((item) => !NON_SECTION_IDS.has(item.id))
      .filter((item) => !architecture.sections.some((section) => sameName(section.name, item.id)))
      .map((item) => item.id)
    if (missing.length > 0) {
      faults.push(
        `the loaded skill's checklist asks for section(s) this architecture has no home for: ${missing.join(', ')}`,
      )
    }
  }

  return faults.length > 0 ? faults.map((fault) => `- ${fault}`).join('\n') : null
}

/**
 * Declare the architecture before building any of it.
 *
 * Exists because its absence was measured: three runs invented component APIs,
 * token usage and section order while building, and the decisions drifted —
 * twenty tokens bound with a whole declared scale untouched, axes growing
 * mid-page. This is the decomposition step of a prompt-chain: the one turn
 * where "which components, which tokens at which tier, which sections" is
 * decided, checked, and stored — so every later step builds *from* the
 * decisions instead of re-guessing them.
 */
export function architectTools(deps: ArchitectDeps): { architect: Tool } {
  const architect = tool({
    description:
      'Declare the architecture before building: components with their axes, token scales at their tier, and the sections in order. Call it first on any build task — sections are built from it, not invented later.',
    inputSchema,
    execute: async (input) => {
      if (input.action === 'show') {
        const existing = await deps.store.read(deps.taskId)
        return existing
          ? deps.store.render(existing)
          : 'no architecture yet for this task — set one first'
      }

      if (!input.summary || !input.sections?.length) {
        return 'not set — set needs a summary and at least one section'
      }
      const architecture: Architecture = {
        taskId: deps.taskId,
        summary: input.summary,
        components: (input.components ?? []).map((c) => ({
          name: c.name,
          props: c.props ?? [],
          axes: c.axes,
        })),
        tokens: input.tokens ?? [],
        sections: input.sections,
        constraints: input.constraints ?? [],
        appearance: input.appearance ?? [],
      }
      const refusal = gate(deps, architecture)
      if (refusal)
        return `not set — this architecture has gaps the harness can already see:\n${refusal}`

      await deps.store.write(architecture)
      // Reuse beats rebuilding: a planned component that already exists is
      // good news worth saying, so the build steps instance it rather than
      // defining a duplicate. Better still when its page carries a design.md
      // — the research an earlier task distilled, kept so this one need not
      // redo it.
      const notes: string[] = []
      for (const component of architecture.components) {
        const entry = deps.index?.components.get(component.name)
        if (!entry) continue
        const page = deps.index?.pages.get(entry.file)
        const designed = page?.headings.some((heading) => heading.trim() === 'Design')
        notes.push(
          designed
            ? `${component.name} is already defined in ${entry.file}, and that page carries a ## Design section — read it and follow it before touching the component.`
            : `${component.name} is already defined in ${entry.file} — reuse it, don't rebuild.`,
        )
      }
      const reuse = notes.length > 0 ? `\n\n${notes.join('\n')}` : ''
      return `architecture set.\n\n${deps.store.render(architecture)}${reuse}`
    },
  })

  return { architect }
}
