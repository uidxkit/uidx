import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createAgentUIStreamResponse, wrapLanguageModel, type LanguageModel } from 'ai'

import { buildAgent } from '../agent/agent.js'
import { anthropicCaching } from '../agent/cache-middleware.js'
import { createWriteGate } from '../agent/gate.js'
import { createStepBudget } from '../agent/step-budget.js'
import { discoverMemories, MEMORY_DIR, renderMemoryListing } from '../memory/shelf.js'
import { imageDelivery } from '../agent/image-middleware.js'
import { usageLog } from '../agent/usage-middleware.js'
import {
  ArchitectureCorruptError,
  createArchitectureStore,
  type Architecture,
  type ArchitectureStore,
} from '../plan/architecture.js'
import type { ConcreteLanguageModel } from '../models.js'
import { createImageStash } from '../tools/view_image.js'
import { DEFAULT_CONTEXT_TOKENS } from '../config.js'
import { AGENT_DIR } from '../edit/jail.js'
import { createCheckpointStore, type CheckpointStore } from '../edit/checkpoint.js'
import { postPatches } from '../core/viewer.js'
import { budgetFor } from '../index/budget.js'
import { buildIndex } from '../index/build.js'
import { packContext } from '../index/pack.js'
import {
  createPlanStore,
  isFinished,
  isValidTaskId,
  PlanCorruptError,
  type Plan,
  type PlanStore,
} from '../plan/store.js'
import {
  discoverSkills,
  renderSkillListing,
  type SkillRoot,
  type SkillEntry,
} from '../skills/discover.js'
import { buildTools } from '../tools/index.js'
import { discoverManifests, matchDocument, type FoundDoc } from '../workspace/discover.js'
import { openWorkspace, type Workspace } from '../workspace/workspace.js'
import type { ProviderOptions } from '../config.js'

/**
 * Where `discoverSkills` looks, each labeled with why it is trusted enough to
 * sit in `instructions` unfenced (see the placement comment in `agent.ts`):
 * the document's own root first — a skill there took write access to the
 * document tree, same as `edit` already grants — then the operator's home
 * directory, which took access to their machine. Docroot before home also
 * gives `discoverSkills`'s same-name precedence its meaning: a skill shipped
 * with the design system shadows a personal one of the same name.
 *
 * Recomputed from `docroot` on every turn rather than cached, unlike
 * `open.workspace.docs()` a few lines below: that map is kept fresh for free
 * by `openWorkspace`'s chokidar watcher, no disk I/O involved, whereas this
 * is a real `readdir`/`readFile` scan every time. Deliberately not optimised
 * here — skills are presently a handful of small files — but the two are not
 * the same kind of "free," and a future change that grows the skill catalog
 * is the place to revisit it, not a reason to believe this already scales.
 */
function skillRoots(docroot: string): SkillRoot[] {
  return [
    { dir: join(docroot, AGENT_DIR, 'skills'), origin: 'docroot' },
    { dir: join(homedir(), AGENT_DIR, 'skills'), origin: 'user' },
  ]
}

/** The same two places, one shelf over. See `memory/shelf.ts`. */
function memoryRoots(docroot: string): SkillRoot[] {
  return [
    { dir: join(docroot, AGENT_DIR, MEMORY_DIR), origin: 'docroot' },
    { dir: join(homedir(), AGENT_DIR, MEMORY_DIR), origin: 'user' },
  ]
}

export interface ChatBody {
  messages: unknown[]
  /** The manifest id the viewer reported from `document:opened`. */
  documentId?: string
  /** Workspace-relative path of the open page. */
  page?: string
  selection?: string[]
  /**
   * The task this turn continues — carried by the panel from an earlier
   * reply's metadata (see `ChatPanel.vue`) so a plan (`plan/store.ts`) can
   * span more than one HTTP turn. Minted with `randomUUID()` when a
   * conversation is starting fresh and the panel has none yet.
   */
  taskId?: string
}

export interface RevertBody {
  documentId?: string
  page?: string
  turnId: string
}

export interface TurnRunnerConfig {
  roots: string[]
  maxSteps: number
  maxFilesPerTurn: number
  maxTokens: number
  /** Concrete, never the bare model-id string form — `wrapLanguageModel` cannot take that. */
  model: () => ConcreteLanguageModel
  repairModel?: () => LanguageModel
  /** The orchestrator model's context window, in tokens — drives `budgetFor`. Defaults to `DEFAULT_CONTEXT_TOKENS`. */
  contextTokens?: number
  /** Provider-specific request options forwarded to every model call, orchestrator and worker alike. See `AgentConfig.providerOptions`. */
  providerOptions?: ProviderOptions
  /** Whether the model can read an image. See `view_image.ts`. */
  vision?: boolean
}

export interface TurnRunner {
  chat(body: ChatBody): Promise<Response>
  revert(body: RevertBody): Promise<Response>
  close(): Promise<void>
}

interface Session {
  found: FoundDoc
  workspace: Workspace
  checkpoints: CheckpointStore
  plans: PlanStore
  architectures: ArchitectureStore
}

/**
 * The document was found and could not be opened — a different failure from
 * not finding one, and a different answer: "no such document" is the caller's
 * problem to fix, an unreadable page or a filesystem that will not give up a
 * watcher is this service's.
 */
class WorkspaceOpenError extends Error {}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/**
 * Worker step cap for `delegate` (see `delegate.ts`) — deliberately smaller
 * than the orchestrator's own `config.maxSteps`. A mission is meant to be a
 * small, bounded piece of work handed to a fresh worker, not a second full
 * turn; a flat small cap keeps a runaway mission cheap regardless of how
 * generous the orchestrator's own budget is configured to be. Not derived
 * from `config.maxSteps` — a fraction of a large number is still large.
 */
const MISSION_MAX_STEPS = 6

/**
 * A worker's own context pack is a *fraction of the orchestrator's own pack
 * budget* (`budget.packChars`), not the same budget reused. The premise of
 * delegating is that a worker starts near-empty — its mission text plus a
 * small orientation, with `read`/`search` there to fetch anything more it
 * turns out to need — not a second copy of the whole document map the
 * orchestrator already built for itself. Handing it the full pack spends a
 * third of its own window before it has read a word of its own task, and
 * that head start is exactly what makes the token guard in `delegate.ts`
 * trip early on perfectly ordinary missions.
 *
 * `4` is a stated engineering choice, not a second measurement: unlike
 * `PACK_SHARE` (0.35, measured against a live model in Task 1 for the
 * orchestrator's own single request, where pack + read + fixed overhead +
 * output all coexist), a worker's request has no comparable fixed cost — its
 * role prompt and 2–3 tool schemas are a fraction of the orchestrator's own
 * 1,637-token overhead — so there's no equivalent budget arithmetic to
 * measure it against yet. Building on the one number that *was* measured
 * (`budget.packChars`) rather than inventing an unrelated one keeps this at
 * least traceable back to something real; `/ 4` is deliberately generous
 * headroom in the "smaller" direction, revisit with real measurement if a
 * mission ever turns out to need more orientation than this leaves room for.
 */
const MISSION_CONTEXT_CHARS_DIVISOR = 4

/**
 * Brings one reverted file back into the index — including when reverting it
 * meant deleting it.
 *
 * A checkpoint records "this file was absent" as a real prior state, so
 * reverting a turn that *created* a page removes it again. `reload` then throws
 * ENOENT, and swallowing that left the page in the in-memory map: `create_file`
 * would refuse it as already existing, and an `edit` would patch the phantom
 * and write it straight back to disk — resurrecting the very thing the user
 * just took back.
 *
 * Any other read failure is left alone. The file is still there, and dropping
 * a page because one read went wrong is a worse answer than holding what we
 * last saw.
 */
async function adoptReverted(open: Session, file: string): Promise<void> {
  try {
    await open.workspace.reload(file)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') open.workspace.forget(file)
  }
}

/**
 * Wraps a `PlanStore` so `chat()` can report `planRemaining` for whatever the
 * plan looks like *after* this turn's own tool calls, not just how it read
 * when the turn started — `onChange` fires with every plan a `write`/`update`
 * actually commits. `messageMetadata` (below, in `chat()`) is called again
 * for every part of the stream, including the `tool-result` part right after
 * a `plan` call resolves, so a value read out of the box this closes over is
 * always at least as fresh as what the model has seen so far — and, critically,
 * fully caught up by the time the stream's `finish` part is emitted, since
 * nothing in the agent loop can move past a tool call before its own
 * `execute()` — the thing that calls `onChange` — has resolved.
 */
function trackingPlanStore(store: PlanStore, onChange: (plan: Plan) => void): PlanStore {
  return {
    read: store.read,
    render: store.render,
    write: async (plan) => {
      await store.write(plan)
      onChange(plan)
    },
    update: async (taskId, mutate) => {
      const next = await store.update(taskId, mutate)
      if (next) onChange(next)
      return next
    },
  }
}

/**
 * The plan this turn should behave as though it has: the one on disk, unless
 * every step of it is `done`, in which case there is no task in flight and
 * the answer is none at all. See `isFinished` in `plan/store.ts` for why a
 * finished plan outlives the task that wrote it and what it costs the next,
 * unrelated request if it is treated as live.
 */
function inFlight(plan: Plan | null): Plan | null {
  return isFinished(plan) ? null : plan
}

/** Steps not yet `done` — what `planRemaining` in message metadata reports, and what gates the panel's Continue control. */
function stepsRemaining(plan: Plan | null): number {
  return plan ? plan.steps.filter((step) => step.status !== 'done').length : 0
}

export function createTurnRunner(config: TurnRunnerConfig): TurnRunner {
  // Computed once, not per turn: the window doesn't change while the server
  // runs, and every tool build in `chat()` below shares the same budget.
  const budget = budgetFor(config.contextTokens ?? DEFAULT_CONTEXT_TOKENS)

  // Keyed by the *promise* that will resolve to a session, not the session
  // itself: two concurrent callers for a document that has never been opened
  // (two browser tabs on the same document, not just adversarial traffic)
  // must share the one in-flight `openWorkspace` — and its chokidar watcher —
  // rather than each opening their own and leaking the loser's.
  const sessions = new Map<string, Promise<Session>>()

  async function session(hint: { id?: string; page?: string }): Promise<Session> {
    const found = matchDocument(await discoverManifests(config.roots), hint)
    const existing = sessions.get(found.path)
    if (existing) {
      const opened = await existing
      // The manifest can be edited on disk while a session stays open — most
      // importantly to narrow the write surface. `globs` is what authorises
      // a write (see `assertWritable`), so the freshly discovered manifest
      // must always be what governs, not whatever was in effect when the
      // session was first opened. The workspace and its watcher stay put —
      // only the authorisation record needs to be current.
      opened.found = found
      return opened
    }

    const opening = (async (): Promise<Session> => {
      try {
        return {
          found,
          workspace: await openWorkspace(found),
          checkpoints: createCheckpointStore(found.dir),
          plans: createPlanStore(found.dir),
          architectures: createArchitectureStore(found.dir),
        }
      } catch (error) {
        // Named by its manifest id rather than its directory: the caller asked
        // for a document, not for wherever this machine keeps it.
        throw new WorkspaceOpenError(`could not open document ${found.id}: ${message(error)}`)
      }
    })()
    sessions.set(found.path, opening)
    try {
      return await opening
    } catch (error) {
      // A failed open must not permanently occupy the slot behind a rejected
      // promise — remove it so the next call gets a fresh attempt.
      sessions.delete(found.path)
      throw error
    }
  }

  const problem = (error: unknown, status: number): Response =>
    new Response(JSON.stringify({ error: message(error) }), {
      status,
      headers: { 'content-type': 'application/json' },
    })

  /** 404 only when there is genuinely no such document; see `WorkspaceOpenError`. */
  const openFailed = (error: unknown): Response =>
    problem(error, error instanceof WorkspaceOpenError ? 500 : 404)

  return {
    async chat(body) {
      // Validated before anything else touches it, and before `session()`
      // even runs: `taskId` now comes straight from the client, and
      // `PlanStore` refuses an out-of-pattern one with a raw, unstructured
      // `throw` (see `isValidTaskId`'s own comment in `plan/store.ts`) that
      // is not the `{ error }` contract this route promises. Checking here,
      // ahead of every use, is what keeps that throw from ever firing on a
      // client-supplied value in the first place — a bad id becomes a plain
      // 400, not a 500 built from a message nobody structured on purpose.
      const taskId = body.taskId ?? randomUUID()
      if (!isValidTaskId(taskId)) {
        return problem(new Error(`invalid taskId ${JSON.stringify(taskId)}`), 400)
      }

      let open: Session
      try {
        open = await session({ id: body.documentId, page: body.page })
      } catch (error) {
        return openFailed(error)
      }

      // Everything from here through handing back the stream can throw —
      // a broken model factory, a document that fails to index, a tool that
      // fails to build. None of that is "no document matched" (404); it is
      // the route's own failure to complete the turn, and it must come back
      // as the `{ error }` JSON the panel expects rather than an unhandled
      // rejection at the Hono route.
      try {
        const turnId = randomUUID()
        /** Every file this turn wrote, by the hash of what it wrote (spec §5). */
        const written: { file: string; sourceHash: string }[] = []
        const onWrite = (file: string, sourceHash: string): void => {
          written.push({ file, sourceHash })
        }
        const docs = open.workspace.docs()
        const index = buildIndex(open.found.id, docs)
        const focus = {
          file: body.page ?? null,
          selection: body.selection ?? [],
        }
        const pack = packContext(index, docs, focus, { maxChars: budget.packChars })
        // Same focus, a much smaller budget — see `MISSION_CONTEXT_CHARS_DIVISOR`.
        // Built once per turn and reused for every mission `delegate` runs
        // this turn, the same way `pack` itself is reused for every one of
        // the orchestrator's own steps.
        const missionPack = packContext(index, docs, focus, {
          maxChars: Math.floor(budget.packChars / MISSION_CONTEXT_CHARS_DIVISOR),
        })
        const skills = await discoverSkills(skillRoots(open.found.dir))
        const memories = await discoverMemories(memoryRoots(open.found.dir))
        const checklist = await readChecklist(skills)
        const requirements = checklist
          ? checklist.map((i) => `- ${i.id}: ${i.requirement}`).join('\n')
          : null

        // What the task looked like entering this turn — folded into the
        // agent's instructions below so a model resuming a long task sees
        // its own prior plan instead of starting over. `latestPlan` starts
        // here and is kept current by `trackingPlanStore` as this turn's own
        // `plan` tool calls (if any) settle, so `planRemaining` in the
        // metadata below reflects the turn that just ran, not just the state
        // it began in.
        //
        // A `PlanCorruptError` here (bad JSON, a hand-edited shape) must not
        // fail the whole turn: this read happens before any tool exists, so
        // if it threw straight into the `catch` below every future turn for
        // this task would 500 identically, and the `plan` tool's own
        // recovery advice (`corruptAdvice`, in `plan/tool.ts` — "call set
        // with replace: true") would never become reachable, since the model
        // never gets a turn in which to call it. Treating a corrupt file the
        // same as "no plan yet" instead lets the turn proceed; if the model
        // calls `plan` itself, it hits the *same* corrupt file through the
        // tool's own read, where that advice is what comes back.
        let existingPlan: Plan | null
        try {
          existingPlan = await open.plans.read(taskId)
        } catch (error) {
          if (!(error instanceof PlanCorruptError)) throw error
          existingPlan = null
        }
        // Injected only while the task it records is still in flight — a
        // finished plan is a closed job, not this request's plan. See
        // `inFlight`.
        const openPlan = inFlight(existingPlan)
        let latestPlan = existingPlan
        const plans = trackingPlanStore(open.plans, (plan) => {
          latestPlan = plan
        })

        // The stored architecture, same lifecycle and same corrupt-file
        // tolerance as the plan just above: a broken file degrades to "no
        // architecture yet", where the `architect` tool's own read is the
        // place its recovery advice lives.
        let existingArchitecture: Architecture | null
        try {
          existingArchitecture = await open.architectures.read(taskId)
        } catch (error) {
          if (!(error instanceof ArchitectureCorruptError)) throw error
          existingArchitecture = null
        }

        // One model instance for the whole turn — the orchestrator's own
        // loop and every worker `delegate` spins up from it share this same
        // connection, rather than each minting its own.
        const imageStash = createImageStash()
        // Wrapped once, here, so the orchestrator's own loop and every worker
        // `delegate` spins up share it — they share the connection already.
        // Caching is stamped only for Anthropic's provider: the option rides
        // in a provider-namespaced bag others ignore by contract, but a local
        // model's wire has no business carrying it at all.
        const concrete = config.model()
        const model = wrapLanguageModel({
          model: concrete,
          middleware: [
            ...(concrete.provider.includes('anthropic') ? [anthropicCaching()] : []),
            usageLog(),
            imageDelivery(imageStash),
          ],
        })

        // One gate for the whole turn, shared by the orchestrator's tools and
        // by every worker built from them: closed now, opened by `buildAgent`'s
        // `prepareStep` once the orchestrator has taken a step. See `gate.ts`.
        const writeGate = createWriteGate()
        const stepBudget = createStepBudget()

        const tools = buildTools({
          writeGate,
          stepBudget,
          index,
          vision: config.vision ?? false,
          imageStash,
          workspace: open.workspace,
          checkpoints: open.checkpoints,
          globs: open.found.globs,
          turnId,
          onWrite,
          post: (file, patches) => postPatches(open.found.dir, file, patches),
          maxFilesPerTurn: config.maxFilesPerTurn,
          budget,
          skills: () => skills,
          memories: () => memories,
          // Whichever discovered skill ships a checklist supplies the standard
          // `review` judges against. Read once per turn: it is authored
          // content that changes between turns, not within one.
          requirements: () => requirements,
          planStore: plans,
          // The eval tool's view of the document: the turn's own workspace
          // and checkpoint context, never a second one — close is a no-op
          // because the session owns the workspace's lifetime.
          opened: {
            found: open.found,
            workspace: open.workspace,
            architectures: open.architectures,
            apply: {
              workspace: open.workspace,
              checkpoints: open.checkpoints,
              globs: open.found.globs,
              turnId,
              onWrite,
              post: (file, patches) => postPatches(open.found.dir, file, patches),
            },
            close: async () => {},
          },
          architectureStore: open.architectures,
          checklist: () => checklist,
          taskId,
          model,
          missionMaxSteps: MISSION_MAX_STEPS,
          providerOptions: config.providerOptions,
          // The smaller `missionPack`, not the orchestrator's own `pack` —
          // see `MISSION_CONTEXT_CHARS_DIVISOR`. Ignores the mission text
          // `delegate.ts`'s `context` field is passed — a future caller
          // could narrow further by mission, but this turn only has the one
          // (now smaller) document pack to offer either way.
          missionContext: () => missionPack.text,
        })

        const agent = buildAgent({
          writeGate,
          stepBudget,
          providerOptions: config.providerOptions,
          model,
          // `UidxTools` names its eight tools explicitly and carries no index
          // signature, so it is not assignable to `ToolSet` (`Record<string,
          // Tool>`) by reference — spreading into a fresh object literal here
          // is what lets TypeScript treat it as one.
          tools: { ...tools },
          maxSteps: config.maxSteps,
          maxTokens: config.maxTokens,
          context: pack.text,
          repairModel: config.repairModel?.(),
          skills: renderSkillListing(skills),
          memories: renderMemoryListing(memories),
          plan: openPlan ? open.plans.render(openPlan) : undefined,
          architecture: existingArchitecture
            ? open.architectures.render(existingArchitecture)
            : undefined,
          // Same budget the pack and the read tool were already sized
          // against above — compaction stays consistent with the rest of
          // this turn's context arithmetic rather than guessing at its own.
          budget,
        })

        const response = await createAgentUIStreamResponse({
          agent,
          uiMessages: body.messages,
          // The panel needs the turn id to offer "revert this turn", the
          // task id to keep sending it on later turns, and `planRemaining`
          // to know whether "Continue" belongs on this reply at all.
          // Recomputed on every call rather than closed over once: this
          // callback runs again for every part of the stream (see
          // `trackingPlanStore`'s own comment), so by the time it runs for
          // the `finish` part, `latestPlan` already reflects whatever this
          // turn's own `plan` tool calls committed.
          messageMetadata: () => ({
            turnId,
            taskId,
            planRemaining: stepsRemaining(inFlight(latestPlan)),
            // Read at the `finish` part, so by then it holds every write; the
            // panel hands the hashes to the undo stack, which folds those
            // revisions into one "LLM turn" entry.
            written: [...written],
          }),
        })
        response.headers.set('x-uidx-turn', turnId)
        response.headers.set('x-uidx-task', taskId)
        return response
      } catch (error) {
        return problem(error, 500)
      }
    },

    async revert(body) {
      let open: Session
      try {
        open = await session({ id: body.documentId, page: body.page })
      } catch (error) {
        return openFailed(error)
      }
      try {
        const files = await open.checkpoints.revert(body.turnId)
        for (const file of files) await adoptReverted(open, file)
        return Response.json({ ok: true, files })
      } catch (error) {
        return problem(error, 404)
      }
    },

    async close() {
      for (const opening of sessions.values()) {
        // A session whose open never finished has nothing to close; a
        // rejected entry is already gone from the map (see `session`) but
        // could still be resolving concurrently with `close()`.
        const opened = await opening.catch(() => null)
        if (opened) await opened.workspace.close()
      }
      sessions.clear()
    },
  }
}

/**
 * The requirements of whichever discovered skill ships a checklist, as lines.
 *
 * Read from disk on each call rather than cached: a skill's checklist is
 * authored content that can change between turns, and `review` is the one
 * caller, at most once or twice a turn.
 */
async function readChecklist(
  skills: readonly SkillEntry[],
): Promise<{ id: string; requirement: string }[] | null> {
  for (const skill of skills) {
    if (!skill.checklistPath) continue
    try {
      const raw = JSON.parse(await readFile(skill.checklistPath, 'utf8')) as {
        id?: unknown
        requirement?: unknown
      }[]
      const items = raw.filter(
        (i): i is { id: string; requirement: string } =>
          typeof i.id === 'string' && typeof i.requirement === 'string',
      )
      if (items.length > 0) return items
    } catch {
      // A broken checklist degrades to "no standard", never to a failed review.
    }
  }
  return null
}
