import { tool, type Tool } from 'ai'
import { z } from 'zod'

import {
  isFinished,
  PlanCorruptError,
  type Plan,
  type PlanStep,
  type PlanStore,
  type StepStatus,
} from './store.js'

/** A node the harness can show is wrong, and what would put it right. */
export interface NodeFault {
  /** The node, by address. */
  address: string
  /** What is wrong with it, as a predicate: "still draws nothing". */
  why: string
  /** The way out, as an imperative: "give it a size, a fill, or children". */
  fix: string
}

export interface PlanToolDeps {
  store: PlanStore
  /** The task this plan belongs to — real and turn-spanning since Task 9, not one turn's own id. */
  taskId: string
  /**
   * Every node in the document the harness can currently show is wrong —
   * drawing nothing, or wider than the parent it sits in. Absent outside a
   * turn, where there is no document to check against. See `drawsNothing` and
   * `overflows`.
   */
  faults?: () => readonly NodeFault[]
}

const STEP_ID = 'step id, from the plan'

/**
 * What a call *is* once it has been checked. The schema the model sees is
 * flat; this is what `execute` switches on.
 */
type PlanCall =
  | { action: 'set'; goal: string; steps: string[]; replace?: boolean }
  | { action: 'complete'; id: number; result: string }
  | { action: 'block'; id: number; result: string }
  | { action: 'show' }

/**
 * Flat for the same measured reason `edit`'s ops are (see `ops.ts`): asked to
 * set a plan, qwen3.5:9b answered this tool's discriminated union with
 * `{"steps":"[\"a\",\"b\"]"}` — no `action`, no `goal`, the array stringified
 * — and answered the flat form correctly on the first try.
 */
const inputSchema = z.object({
  action: z.enum(['set', 'complete', 'block', 'show']).describe('which plan operation to perform'),
  goal: z.string().optional().describe('set: what this task accomplishes'),
  steps: z.array(z.string()).optional().describe('set: ordered step descriptions'),
  replace: z
    .boolean()
    .optional()
    .describe('set: true to discard a plan that already has completed/blocked steps'),
  id: z.number().int().optional().describe(`complete/block: ${STEP_ID}`),
  result: z
    .string()
    .optional()
    .describe('complete: one line on what the step produced. block: one line on why'),
})

type PlanInput = z.infer<typeof inputSchema>

/**
 * Checks a flat call against the fields its action uses. A mismatch comes back
 * as text naming the action and the field, never as an exception — the same
 * contract every other refusal in this tool keeps.
 */
function narrowCall(input: PlanInput): { ok: true; call: PlanCall } | { ok: false; message: string }
function narrowCall(input: PlanInput) {
  switch (input.action) {
    case 'set':
      if (!input.goal || !input.steps?.length) {
        return { ok: false as const, message: 'set needs a goal and at least one step' }
      }
      return {
        ok: true as const,
        call: {
          action: 'set' as const,
          goal: input.goal,
          steps: input.steps,
          ...(input.replace === undefined ? {} : { replace: input.replace }),
        },
      }
    case 'complete':
    case 'block':
      if (input.id === undefined || input.result === undefined) {
        return { ok: false as const, message: `${input.action} needs id and result` }
      }
      return {
        ok: true as const,
        call: { action: input.action, id: input.id, result: input.result },
      }
    case 'show':
      return { ok: true as const, call: { action: 'show' as const } }
  }
}

/**
 * Steps carrying a real outcome — what `set` must never overwrite without
 * being asked. `todo`/`doing` have no `result` yet, so replacing them loses
 * nothing; `done`/`blocked` are the record of work already spent.
 */
function hasProgress(steps: readonly PlanStep[]): boolean {
  return steps.some((step) => step.status === 'done' || step.status === 'blocked')
}

function findStep(plan: Plan, id: number): PlanStep | undefined {
  return plan.steps.find((step) => step.id === id)
}

function freshPlan(taskId: string, goal: string, steps: readonly string[]): Plan {
  return {
    taskId,
    goal,
    steps: steps.map((text, index) => ({ id: index + 1, text, status: 'todo' as const })),
  }
}

/** How a corrupt file is explained back to the model — always the same words, so `set`'s own advice matches what a caught `PlanCorruptError` says everywhere else. */
const corruptAdvice = (message: string): string =>
  `${message}. Call set with replace: true to start over.`

/**
 * Refuses a step that claims a section is done while that section is visibly
 * wrong.
 *
 * Measured on a real run: a model marked "Build cover section" done with a
 * result reading "Built cover section with eyebrow, title, definition text"
 * over a cover that was an empty frame. Nothing disagreed, because nothing
 * could — the plan was the only record of progress and it took the model's
 * word for it.
 *
 * A later run failed the same way with the opposite fault. Every section was
 * full, and every one was wider than the parent it sat in, so all twelve spilled
 * their text; the model called `review` six times, looked at the picture, and
 * marked each step done. Blankness and overflow are one thing to this gate —
 * a section that does not draw correctly is not a section that is finished.
 *
 * Matched by name rather than by parsing the step text for intent: a step
 * called "Build section: states" is about the node addressed `states`, and
 * that is a link the harness can check. A step naming nothing checkable
 * settles as it always did — this closes a specific lie, it does not appoint
 * the plan tool judge of whether work is good.
 */
function stillWrong(text: string, faults: readonly NodeFault[]): string | null {
  const named = faults.find(({ address }) => {
    const leaf = address.split(/[#/]/).pop() ?? address
    return (
      leaf !== '' &&
      new RegExp(`\\b${leaf.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\b`).test(text)
    )
  })
  return named
    ? `${named.address} ${named.why}, so that step is not done — ${named.fix}, or use block if it cannot be finished.`
    : null
}

export function planTools(deps: PlanToolDeps): { plan: Tool } {
  const settle = async (id: number, status: StepStatus, result: string): Promise<string> => {
    let refusal: string | null = null
    const next = await deps.store.update(deps.taskId, (existing) => {
      if (!existing) {
        refusal = 'no plan yet — call set first'
        return null
      }
      const step = findStep(existing, id)
      if (!step) {
        refusal = `no step ${id} in this plan`
        return null
      }
      step.status = status
      step.result = result
      return existing
    })
    if (refusal) return refusal
    if (!next) throw new Error('unreachable: settle produced neither a plan nor a refusal')
    return deps.store.render(next)
  }

  const plan = tool({
    description:
      "Keep a long task's plan — it lives on disk and survives across turns. set it once; complete/block each step as you finish it; show to resume after a break.",
    inputSchema,
    execute: async (raw) => {
      const narrowed = narrowCall(raw)
      if (!narrowed.ok) return narrowed.message
      const input = narrowed.call
      try {
        switch (input.action) {
          case 'set': {
            const candidate = freshPlan(deps.taskId, input.goal, input.steps)
            let blocked: Plan | null = null
            let next: Plan | null
            try {
              next = await deps.store.update(deps.taskId, (existing) => {
                // `isFinished` is the exception to `hasProgress`: a plan whose
                // every step is `done` has no work left to protect, and a
                // `set` against it is a *new* task arriving on a conversation
                // whose task id never resets — not an attempt to discard
                // progress. Refusing it strands the model (see `isFinished`).
                if (
                  existing &&
                  hasProgress(existing.steps) &&
                  !isFinished(existing) &&
                  !input.replace
                ) {
                  blocked = existing
                  return null
                }
                return candidate
              })
            } catch (error) {
              if (!(error instanceof PlanCorruptError) || !input.replace) throw error
              // The file couldn't even be read to check for progress, but the
              // model explicitly asked to replace it anyway — same intent as
              // overwriting a plan that does have recorded progress, just
              // reached by a different route (write straight past the read
              // that failed, rather than through `update`'s mutate step).
              await deps.store.write(candidate)
              next = candidate
            }
            if (blocked) {
              return [
                'plan already has completed work — not overwritten.',
                'Pass replace: true to discard it deliberately, or use complete/block to keep going.',
                '',
                deps.store.render(blocked),
              ].join('\n')
            }
            if (!next) throw new Error('unreachable: set neither wrote nor refused')
            return deps.store.render(next)
          }

          case 'complete': {
            const refusal = stillWrong(input.result, deps.faults?.() ?? [])
            if (refusal) return refusal
            return await settle(input.id, 'done', input.result)
          }

          case 'block':
            return await settle(input.id, 'blocked', input.result)

          case 'show': {
            const existing = await deps.store.read(deps.taskId)
            return existing ? deps.store.render(existing) : 'no plan yet for this task'
          }
        }
      } catch (error) {
        // A malformed file (bad JSON, a hand-edited shape) must not end the
        // task — say what's wrong and how to recover, the same way a refused
        // edit explains itself instead of throwing (see `edit.ts`).
        if (error instanceof PlanCorruptError) return corruptAdvice(error.message)
        throw error
      }
    },
  })

  return { plan }
}
