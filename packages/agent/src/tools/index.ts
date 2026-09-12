import type { LanguageModel, Tool } from 'ai'

import { delegateTool } from '../agent/delegate.js'
import type { ContextBudget } from '../index/budget.js'
import { planTools, type NodeFault } from '../plan/tool.js'
import type { ArchitectureStore } from '../plan/architecture.js'
import { architectTools } from './architect.js'
import { evalTools } from './eval.js'
import type { OpenedDocument } from '../core/index.js'
import { createFileBudget } from './edit.js'
import { drawsNothing } from '../edit/draws-nothing.js'
import { overflows } from '../edit/overflow.js'
import type { PlanStore } from '../plan/store.js'
import type { SkillEntry } from '../skills/discover.js'
import { skillTools } from '../skills/tool.js'
import { memoryTools, type MemoryEntry } from '../memory/shelf.js'
import { editTools, type EditDeps } from './edit.js'
import { readTools } from './read.js'
import { fetchUrlTools } from './fetch_url.js'
import { reviewTools } from './review.js'
import type { StepBudget } from '../agent/step-budget.js'
import { viewImageTools, type ImageStash } from './view_image.js'
import type { ProviderOptions } from '../config.js'

export interface UidxTools {
  read: Tool
  search: Tool
  edit: Tool
  create_file: Tool
  delete_file: Tool
  set_intent: Tool
  use_skill: Tool
  use_memory: Tool
  fetch_url: Tool
  plan: Tool
  architect: Tool
  eval: Tool
  delegate: Tool
  view_image: Tool
  review: Tool
}

export function buildTools(
  deps: EditDeps & {
    budget: ContextBudget
    skills: () => readonly SkillEntry[]
    /** Lessons this harness has been corrected on. See `memory/shelf.ts`. */
    memories?: () => readonly MemoryEntry[]
    /** The requirements a page is meant to satisfy, for `review` to judge against. */
    requirements?: () => string | null
    planStore: PlanStore
    /** Where the `architect` tool keeps a task's declared architecture. See `plan/architecture.ts`. */
    architectureStore: ArchitectureStore
    /** The loaded skill's checklist items, for the architect gate's section-coverage check. */
    checklist?: () => { id: string; requirement: string }[] | null
    /** The task this turn belongs to — real and turn-spanning since Task 9, not the turn's own id. See `turn.ts`. */
    taskId: string
    /** The opened document for `eval` — same workspace, same apply context, assembled by the turn. */
    opened: OpenedDocument
    /** The same model the orchestrator itself runs on — reused for every worker `delegate` spins up this turn. See `delegate.ts`. */
    model: LanguageModel
    /** Worker step cap for `delegate` — deliberately smaller than the orchestrator's own `maxSteps`. */
    missionMaxSteps: number
    /** Builds a worker's `<context>` fence for one mission. See `delegate.ts`'s own `context` field. */
    missionContext: (mission: string) => string
    /** Provider-specific request options, passed on to every worker so a worker's model call carries the same switches the orchestrator's does. */
    providerOptions?: ProviderOptions
    /** Whether the model can read an image. See `view_image.ts`. */
    vision?: boolean
    /** Where a rendered picture waits for the agent loop to place it. See `ImageStash`. */
    imageStash?: ImageStash
    /** What this step has already read. See `StepBudget`. */
    stepBudget?: StepBudget
  },
): UidxTools {
  // Built without `delegate` first: `delegate.ts` needs the *rest* of the
  // tool set to hand a subset of it to each worker, and building `delegate`
  // from a set that already contains itself would be circular for no
  // benefit — a worker is never allowed to see `delegate` regardless (see
  // `TOOLS_BY_KIND` in `delegate.ts`), so leaving it out here changes nothing
  // a worker could reach either way.
  const fileBudget = createFileBudget(deps.maxFilesPerTurn, deps.onFileTouched)
  const base = {
    ...readTools({
      workspace: deps.workspace,
      budget: deps.budget,
      ...(deps.stepBudget ? { stepBudget: deps.stepBudget } : {}),
    }),
    ...viewImageTools({
      workspace: deps.workspace,
      vision: deps.vision ?? false,
      ...(deps.imageStash ? { stash: deps.imageStash } : {}),
    }),
    ...reviewTools({
      workspace: deps.workspace,
      vision: deps.vision ?? false,
      ...(deps.imageStash ? { stash: deps.imageStash } : {}),
      // The checklist of whichever shipped skill carries one, so a judgement
      // is made against a standard rather than against taste alone.
      requirements: () => deps.requirements?.() ?? null,
    }),
    ...editTools({ ...deps, fileBudget }),
    // A skill body is a chunk of curated instruction text pulled into the same
    // window a document read would occupy — bounding it to `readChars` keeps
    // the same "one call cannot swallow the window" guarantee `read` already
    // gives, without growing `ContextBudget` with a dimension of its own.
    ...skillTools({ skills: deps.skills, maxChars: deps.budget.readChars }),
    ...planTools({
      store: deps.planStore,
      taskId: deps.taskId,
      // Read fresh on every call: a step completed after the section was
      // filled must settle, and the audits have to see the document as it is
      // now rather than as it was when the turn began.
      faults: () => {
        const faults: NodeFault[] = []
        for (const doc of deps.workspace.docs().values()) {
          for (const address of drawsNothing(doc)) {
            faults.push({
              address,
              why: 'still draws nothing',
              fix: 'give it a size, a fill, or children first',
            })
          }
          for (const { address, width, inner } of overflows(doc)) {
            faults.push({
              address,
              why: `is ${width} wide inside ${inner} of space, so it overflows its parent`,
              fix: "subtract the parent's left and right padding from its width first",
            })
          }
        }
        return faults
      },
    }),
    ...evalTools({
      opened: deps.opened,
      fileBudget,
      ...(deps.writeGate ? { writeGate: deps.writeGate } : {}),
    }),
    ...architectTools({
      store: deps.architectureStore,
      taskId: deps.taskId,
      ...(deps.index ? { index: deps.index } : {}),
      ...(deps.checklist ? { checklist: deps.checklist } : {}),
    }),
    ...memoryTools({ memories: deps.memories ?? (() => []), maxChars: deps.budget.readChars }),
    ...fetchUrlTools({
      maxChars: deps.budget.readChars,
      vision: deps.vision ?? false,
      ...(deps.imageStash ? { stash: deps.imageStash } : {}),
    }),
  }
  const { delegate } = delegateTool({
    model: deps.model,
    // Spread into a fresh object literal at the call site — `base`'s own
    // inferred type names its keys explicitly and carries no index
    // signature, so it is not assignable to `ToolSet` by reference (same
    // reasoning `turn.ts` already documents for its own `{ ...tools }`).
    tools: { ...base },
    budget: deps.budget,
    maxSteps: deps.missionMaxSteps,
    context: deps.missionContext,
    providerOptions: deps.providerOptions,
    writeGate: deps.writeGate,
  })
  return { ...base, delegate }
}

export { editTools, readTools }
