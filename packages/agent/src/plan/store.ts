import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { AGENT_DIR, resolveInside } from '../edit/jail.js'

export type StepStatus = 'todo' | 'doing' | 'done' | 'blocked'

export interface PlanStep {
  id: number
  text: string
  status: StepStatus
  /** One line: what the step produced, or why it is blocked. Not a paragraph — this rides in every turn's context (see `render`). */
  result?: string
}

export interface Plan {
  taskId: string
  goal: string
  steps: PlanStep[]
}

/** A plan file exists but its content isn't one — bad JSON, or valid JSON of the wrong shape (a hand edit, a half-written file that slipped past `writeAtomically`, disk damage). Thrown, not folded into `null`, because "corrupt" and "never written" call for different answers from the model: see `tool.ts`'s `replace` handling. */
export class PlanCorruptError extends Error {}

export interface PlanStore {
  read(taskId: string): Promise<Plan | null>
  write(plan: Plan): Promise<void>
  /** The compact markdown form a model sees — never the raw JSON. */
  render(plan: Plan): string
  /**
   * Read-modify-write as one step, queued behind every other `write`/`update`
   * for the same task id.
   *
   * `ai@7`'s tool calls within one model step run under `Promise.all` — two
   * `complete` calls for different steps in the same step is an ordinary
   * shape, not an edge case — and a plain `read` then `write` from two such
   * calls would each read the same prior state and the second write would
   * silently discard the first's result. Queuing per task id closes that,
   * the same way `packages/server/src/session.ts`'s `queue` field serialises
   * `reload`/`patch` on one file.
   *
   * `mutate` returns `null` to mean "make no change" — nothing is written,
   * and `update` resolves to `null` too. Otherwise its return value is
   * written and becomes the resolved value.
   */
  update(taskId: string, mutate: (plan: Plan | null) => Plan | null): Promise<Plan | null>
}

/**
 * A task id names a file under `.uidx-agent/plans/`, the same hazard
 * `checkpoint.ts` guards against for a turn id: `encodeURIComponent` leaves
 * `..` untouched, so an unchecked id would let `read('../../etc/passwd')`
 * resolve outside the plans directory. Unlike a turn id, a task id is not
 * always a `randomUUID` — since Task 9 it comes straight from the client
 * (`ChatBody.taskId`) and may be whatever a designer's browser sent — so the
 * pattern accepts UUID shape *or* a plain slug of letters, digits, `-` and
 * `_`, and refuses everything else, including any `.` or `/`.
 */
const TASK_ID = /^[A-Za-z0-9_-]{1,128}$/

/**
 * True when `taskId` is safe to resolve into `.uidx-agent/plans/<taskId>.json`.
 *
 * A caller sitting in front of a client-supplied task id — `turn.ts`'s chat
 * route is the one that matters, since Task 9 made `taskId` part of
 * `ChatBody` — must check this itself and answer with its own error contract
 * *before* the value ever reaches `pathFor` below. `pathFor`'s own `throw new
 * Error` is deliberately left unstructured: a last defensive line for a
 * caller that skipped this check, not a shape any HTTP boundary should be
 * translating into a response on the fly (an unwrapped `Error` reaching an
 * HTTP handler is a stack trace in a 500, the exact failure `app.ts`'s
 * `withBody` exists to prevent for a malformed request body — see its own
 * comment).
 */
export function isValidTaskId(taskId: string): boolean {
  return TASK_ID.test(taskId)
}

/**
 * Every step `done` — the task this plan recorded is over.
 *
 * A `taskId` lives as long as the panel's conversation does (`ChatPanel.vue`
 * keeps the first id any reply carried and never resets it), so the plan a
 * finished job left behind is still on disk when the designer types their
 * next, unrelated request into the same conversation. Without this, that
 * request inherits it: `turn.ts` injects the old plan saying "call plan to
 * update it, not to start over", the model does exactly that, and `set` is
 * refused because every step carries a recorded result. The model is left
 * with a plan it was told to keep, no way to keep it, and no instruction
 * that would get it to pass `replace: true`.
 *
 * A finished plan is therefore treated as absent everywhere the answer
 * depends on there being work in flight: what `turn.ts` injects, what
 * `planRemaining` reports, and whether `set` has progress worth protecting.
 * "Absent" is not "deleted" — the file stays, and `plan show` still reads it
 * back for a model that asks.
 */
export function isFinished(plan: Plan | null | undefined): boolean {
  if (!plan || plan.steps.length === 0) return false
  return plan.steps.every((step) => step.status === 'done')
}

const STATUS_MARK: Record<StepStatus, string> = {
  todo: '[ ]',
  doing: '[~]',
  done: '[x]',
  blocked: '[!]',
}

/**
 * Caps on the rendered plan, because every one of its parts is model-authored
 * and none of them was bounded: `steps` has no maximum, `text` and `result`
 * no length limit, and `goal` none either. The render rides in `instructions`
 * on every turn that continues the task (see `turn.ts`) *and* comes back as
 * the `plan` tool's own result, so an over-eager 60-step plan with paragraph
 * results silently spends the window it was invented to protect.
 *
 * The line caps keep any single step honest; `MAX_RENDER_CHARS` is the real
 * bound, applied the way `renderOutline` applies its own — stop admitting
 * lines and say how many were left out, rather than let the trailer push the
 * whole thing back over. 2,000 characters is a comfortable ~15–20 steps at
 * full width against a default history budget of ~7,000.
 */
const MAX_GOAL_CHARS = 200
const MAX_STEP_TEXT_CHARS = 140
const MAX_RESULT_CHARS = 140
const MAX_RENDER_CHARS = 2_000
/** Held back unconditionally so the "not shown" trailer can never push the render past its own cap. */
const TRAILER_RESERVE_CHARS = 100

const clip = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max)}…` : text

function renderPlan(plan: Plan): string {
  const lines = [`Goal: ${clip(plan.goal, MAX_GOAL_CHARS)}`]
  let used = lines[0]!.length
  let shown = 0
  for (const step of plan.steps) {
    const outcome = step.result ? ` — ${clip(step.result, MAX_RESULT_CHARS)}` : ''
    const line = `${STATUS_MARK[step.status]} ${step.id}. ${clip(step.text, MAX_STEP_TEXT_CHARS)}${outcome}`
    if (used + line.length + 1 > MAX_RENDER_CHARS - TRAILER_RESERVE_CHARS) break
    lines.push(line)
    used += line.length + 1
    shown += 1
  }
  const unshown = plan.steps.length - shown
  if (unshown > 0) {
    lines.push(`(${unshown} more step(s) not shown — this plan is too long to render in full)`)
  }
  return lines.join('\n')
}

const STEP_STATUSES: readonly string[] = ['todo', 'doing', 'done', 'blocked']

function isPlanStep(value: unknown): value is PlanStep {
  if (typeof value !== 'object' || value === null) return false
  const step = value as Record<string, unknown>
  return (
    typeof step.id === 'number' &&
    typeof step.text === 'string' &&
    typeof step.status === 'string' &&
    STEP_STATUSES.includes(step.status) &&
    (step.result === undefined || typeof step.result === 'string')
  )
}

/** Just enough shape-checking to catch a hand-edited or half-written file before its `undefined`s reach the model's context — not a full schema validator. */
function isPlan(value: unknown): value is Plan {
  if (typeof value !== 'object' || value === null) return false
  const plan = value as Record<string, unknown>
  return (
    typeof plan.taskId === 'string' &&
    typeof plan.goal === 'string' &&
    Array.isArray(plan.steps) &&
    plan.steps.every(isPlanStep)
  )
}

/**
 * Writes go to a temp sibling and are renamed into place, so a reader never
 * observes a half-written plan — a crash mid-write must not brick a task's
 * whole durable record. Mirrors `workspace.ts`'s `writeAtomically`.
 */
async function writeAtomically(path: string, contents: string): Promise<void> {
  const temp = `${path}.agent-tmp`
  await writeFile(temp, contents, 'utf8')
  await rename(temp, path)
}

export function createPlanStore(root: string): PlanStore {
  const pathFor = (taskId: string): string => {
    if (!isValidTaskId(taskId)) throw new Error(`no plan for task ${taskId}: not a task id`)
    return resolveInside(root, `${AGENT_DIR}/plans/${taskId}.json`)
  }

  // One chain per task id, not one global chain: an unrelated task's writes
  // must not wait behind this one's, but two mutations for the *same* task
  // must never run concurrently (see `update`'s doc comment).
  const queues = new Map<string, Promise<unknown>>()
  const enqueue = <T>(taskId: string, task: () => Promise<T>): Promise<T> => {
    const previous = queues.get(taskId) ?? Promise.resolve()
    const run = previous.then(task, task)
    // The stored link is always a resolved promise, regardless of whether
    // `task` succeeded — a rejection must not permanently wedge every later
    // mutation for this task behind a promise that will never settle happily.
    queues.set(
      taskId,
      run.catch(() => undefined),
    )
    return run
  }

  const readPlan = async (taskId: string): Promise<Plan | null> => {
    const path = pathFor(taskId)
    let raw: string
    try {
      raw = await readFile(path, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
    let value: unknown
    try {
      value = JSON.parse(raw)
    } catch {
      throw new PlanCorruptError(`the plan for task ${taskId} is not valid JSON`)
    }
    if (!isPlan(value)) {
      throw new PlanCorruptError(`the plan for task ${taskId} does not have the shape of a plan`)
    }
    return value
  }

  const writePlan = async (plan: Plan): Promise<void> => {
    const path = pathFor(plan.taskId)
    await mkdir(dirname(path), { recursive: true })
    await writeAtomically(path, JSON.stringify(plan, null, 2))
  }

  return {
    read: readPlan,
    write: (plan) => enqueue(plan.taskId, () => writePlan(plan)),
    render: renderPlan,
    update: (taskId, mutate) =>
      enqueue(taskId, async () => {
        const current = await readPlan(taskId)
        const next = mutate(current)
        if (next) await writePlan(next)
        return next
      }),
  }
}
