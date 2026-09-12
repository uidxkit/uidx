import { describe, expect, it } from 'vitest'
import { MockLanguageModelV4 } from 'ai/test'
import { tool, type ToolSet } from 'ai'
import { z } from 'zod'

import {
  delegateTool,
  isRefusal,
  MAX_SUMMARY_CHARS,
  type MissionResult,
} from '../src/agent/delegate.js'
import { budgetFor } from '../src/index/budget.js'
import { editTools, type EditDeps } from '../src/tools/edit.js'
import { readTools } from '../src/tools/read.js'

const usage = {
  inputTokens: { total: 1, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1, text: undefined, reasoning: undefined },
}

/** A stub tool standing in for one of the harness's real tools — just enough shape (an `execute` that echoes `file`) for `delegate` to route calls to it and for `files` extraction to have something to find. */
const stub = () =>
  tool({
    description: 'stub',
    inputSchema: z.object({ file: z.string().optional() }),
    execute: async ({ file }: { file?: string }) => `stub result for ${file ?? '(no file)'}`,
  })

/**
 * The orchestrator's full tool set, as `delegateTool` would actually receive
 * it — including `delegate` and `plan` themselves, so the "never leaked to a
 * worker" tests are checking something real (an implementation that just
 * forwarded whatever it was given would fail them) rather than trivially
 * passing because the forbidden names were never offered in the first place.
 */
const fullToolSet: ToolSet = {
  read: stub(),
  search: stub(),
  edit: stub(),
  create_file: stub(),
  delete_file: stub(),
  plan: stub(),
  delegate: stub(),
}

const execOpts = { toolCallId: 't', messages: [] }

const runDelegate = async (
  delegate: { execute?: unknown },
  input: unknown,
): Promise<MissionResult> => {
  const execute = delegate.execute as (i: unknown, o: unknown) => Promise<string>
  const raw = await execute(input, execOpts)
  return JSON.parse(raw) as MissionResult
}

const textModel = (text: string) =>
  new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: 'text' as const, text }],
      finishReason: { unified: 'stop' as const, raw: undefined },
      usage,
      warnings: [],
    }),
  })

const deps = (model: MockLanguageModelV4, maxSteps = 4, budget = budgetFor(16_384)) => ({
  model,
  tools: fullToolSet,
  budget,
  maxSteps,
  context: () => 'SELECTED\n  (nothing selected)',
})

describe('delegateTool', () => {
  it("runs a fresh worker loop and returns the worker's own summary, not a transcript", async () => {
    const model = textModel('Found three disabled buttons on checkbox.uidx.')
    const { delegate } = delegateTool(deps(model))
    const result = await runDelegate(delegate, {
      kind: 'read-mission',
      mission: 'find disabled controls',
    })
    expect(result.ok).toBe(true)
    expect(result.summary).toBe('Found three disabled buttons on checkbox.uidx.')
    // A transcript would carry the tool-call machinery's own vocabulary;
    // a summary is just the worker's own sentence.
    expect(result.summary).not.toMatch(/toolCallId|doGenerate/)
  })

  it('gives a read-mission worker only read and search — never edit, create_file, delete_file, plan, or delegate', async () => {
    const model = textModel('done')
    const { delegate } = delegateTool(deps(model))
    await runDelegate(delegate, { kind: 'read-mission', mission: 'investigate the page' })

    const sentNames = (model.doGenerateCalls[0]?.tools ?? []).map((t) => t.name).sort()
    expect(sentNames).toEqual(['read', 'search'])
  })

  it('gives an edit-mission worker only read and edit — never create_file, delete_file, plan, or delegate', async () => {
    const model = textModel('done')
    const { delegate } = delegateTool(deps(model))
    await runDelegate(delegate, { kind: 'edit-mission', mission: 'widen the hero frame' })

    const sentNames = (model.doGenerateCalls[0]?.tools ?? []).map((t) => t.name).sort()
    expect(sentNames).toEqual(['edit', 'read'])
  })

  it('gives an author-mission worker only read, edit, and create_file — never delete_file, plan, or delegate', async () => {
    const model = textModel('done')
    const { delegate } = delegateTool(deps(model))
    await runDelegate(delegate, { kind: 'author-mission', mission: 'create a settings page' })

    const sentNames = (model.doGenerateCalls[0]?.tools ?? []).map((t) => t.name).sort()
    expect(sentNames).toEqual(['create_file', 'edit', 'read'])
  })

  it('never offers delegate itself to a worker, of any mission kind', async () => {
    for (const kind of ['read-mission', 'edit-mission', 'author-mission'] as const) {
      const model = textModel('done')
      const { delegate } = delegateTool(deps(model))
      await runDelegate(delegate, { kind, mission: 'do something small' })
      const sentNames = (model.doGenerateCalls[0]?.tools ?? []).map((t) => t.name)
      expect(sentNames).not.toContain('delegate')
      expect(sentNames).not.toContain('plan')
    }
  })

  it('returns a summary saying its budget ran out, instead of throwing, when the worker never converges', async () => {
    const alwaysToolCall = new MockLanguageModelV4({
      doGenerate: async () => ({
        content: [
          {
            type: 'tool-call' as const,
            toolCallId: 'c',
            toolName: 'read',
            input: '{"file":"a.uidx"}',
          },
        ],
        finishReason: { unified: 'tool-calls' as const, raw: undefined },
        usage,
        warnings: [],
      }),
    })
    const { delegate } = delegateTool(deps(alwaysToolCall, 2))

    const result = await runDelegate(delegate, {
      kind: 'read-mission',
      mission: 'investigate everything, forever',
    })

    expect(result.ok).toBe(false)
    expect(result.summary).toMatch(/ran out of budget/i)
    expect(result.files).toContain('a.uidx')
  })

  it('measures the current conversation size, not a running sum across steps, when checking its token cap', async () => {
    // Growing per-step usage — mimicking a real, stateless chat completion
    // API, which resends the whole conversation on every step: each step's
    // own `inputTokens` already IS the current conversation size (it is not
    // additional to prior steps' own totals — it already contains them). A
    // flat per-step figure exercises the `stopWhen` mechanism but can't tell
    // a running-sum bug from a correctly-sized guard — both stop
    // *somewhere*. Only a genuinely growing figure can, because summing
    // growing-but-already-cumulative inputs balloons far faster than the
    // conversation itself does.
    let call = 0
    const growingToolCall = new MockLanguageModelV4({
      doGenerate: async () => {
        call += 1
        // Step 1 ≈ 6,200 tokens (role prompt + mission + a small
        // mission-scoped context) — in the same ballpark a worker's first
        // request actually costs. Each later step adds roughly one more
        // read result — `READ_SHARE` (`budget.ts`) of a 16,384-token window
        // ≈ 4,915 tokens, the same figure a single read call is bounded to.
        const inputTotal = 6_200 + (call - 1) * 4_915
        return {
          content: [
            {
              type: 'tool-call' as const,
              toolCallId: `c${call}`,
              toolName: 'read',
              input: '{"file":"a.uidx"}',
            },
          ],
          finishReason: { unified: 'tool-calls' as const, raw: undefined },
          usage: {
            inputTokens: {
              total: inputTotal,
              noCache: undefined,
              cacheRead: undefined,
              cacheWrite: undefined,
            },
            outputTokens: { total: 50, text: undefined, reasoning: undefined },
          },
          warnings: [],
        }
      },
    })
    // A step cap high enough to never itself be the thing that fires —
    // proves whatever stops this loop is the token guard, not `isStepCount`.
    const { delegate } = delegateTool(deps(growingToolCall, 50, budgetFor(16_384)))

    const result = await runDelegate(delegate, {
      kind: 'read-mission',
      mission: 'investigate everything, forever',
    })

    // After 2 steps the conversation is genuinely only ~11,165 of 16,384
    // tokens (68%) — comfortably under budget, and a correct guard must not
    // stop there. A running-sum guard does: 6,250 + 11,165 = 17,415, already
    // over a full window after only two steps that were never that big.
    expect(growingToolCall.doGenerateCalls.length).toBeGreaterThan(2)
    // By step 3 the conversation is genuinely ~16,080 of 16,384 tokens
    // (98%) — actually near full, which is when a correct guard should stop
    // it, rather than running all the way to the 50-step cap.
    expect(growingToolCall.doGenerateCalls.length).toBeLessThan(6)
    expect(result.ok).toBe(false)
    expect(result.summary).toMatch(/ran out of budget/i)
    expect(result.summary).not.toMatch(/worker failed before finishing/i)
  })

  it("caps the summary's length even when the worker writes a very long final answer", async () => {
    const longText = 'the page has many controls. '.repeat(200)
    const model = textModel(longText)
    const { delegate } = delegateTool(deps(model))

    const result = await runDelegate(delegate, {
      kind: 'read-mission',
      mission: 'describe every control on the page',
    })

    expect(longText.length).toBeGreaterThan(MAX_SUMMARY_CHARS)
    // Some slack for the truncation marker itself, but nowhere near the
    // worker's original, uncapped answer.
    expect(result.summary.length).toBeLessThan(MAX_SUMMARY_CHARS + 100)
    expect(result.summary.length).toBeLessThan(longText.length)
  })

  it('runs two missions strictly one after another, never overlapping calls on the shared model', async () => {
    let active = 0
    let maxActive = 0
    const order: string[] = []
    const model = new MockLanguageModelV4({
      doGenerate: async (options) => {
        active += 1
        maxActive = Math.max(maxActive, active)
        const sent = JSON.stringify(options.prompt)
        order.push(sent.includes('MISSION-A') ? 'A' : sent.includes('MISSION-B') ? 'B' : '?')
        // A real await point, so a caller that failed to serialise these two
        // missions would have every opportunity to let them interleave.
        await new Promise((resolve) => setTimeout(resolve, 5))
        active -= 1
        return {
          content: [{ type: 'text' as const, text: 'done' }],
          finishReason: { unified: 'stop' as const, raw: undefined },
          usage,
          warnings: [],
        }
      },
    })
    const { delegate } = delegateTool(deps(model))

    const [a, b] = await Promise.all([
      runDelegate(delegate, { kind: 'read-mission', mission: 'MISSION-A: look at page one' }),
      runDelegate(delegate, { kind: 'read-mission', mission: 'MISSION-B: look at page two' }),
    ])

    expect(maxActive).toBe(1)
    expect(order).toEqual(['A', 'B'])
    expect(a.ok).toBe(true)
    expect(b.ok).toBe(true)
  })
})

/**
 * `isRefusal` is built from constants imported straight from `edit.ts` and
 * `read.ts` (see `delegate.ts`'s own comment on `REFUSAL_PREFIXES`), so it
 * can never drift from what those constants *say*. What it can still drift
 * from is what those tools *actually* return, if a future edit changes a
 * template literal without updating the constant it was supposed to be
 * built from. These tests call the real tools — not hand-typed strings that
 * would just repeat the constants — so a wording change that broke that
 * link would fail here, not rot silently.
 */
describe('the refusal detector matches what edit.ts and read.ts actually emit', () => {
  it('read\'s real "no such page" refusal', async () => {
    const { read } = readTools({
      workspace: { docOf: () => null, sourceOf: () => null, members: () => [] },
      budget: budgetFor(16_384),
    })
    const execute = read.execute as (i: unknown, o: unknown) => Promise<string>
    const refusal = await execute({ file: 'missing.uidx' }, execOpts)
    expect(isRefusal(refusal)).toBe(true)
  })

  it('edit\'s real "file budget reached" refusal', async () => {
    // `maxFilesPerTurn: 0` makes `budgetLeft` return its refusal before
    // `edit` ever touches `workspace`/`checkpoints`/`globs`/`turnId` — real
    // values for those only matter to the type here, not to this call.
    const fakeDeps = {
      workspace: {},
      checkpoints: {},
      globs: [],
      turnId: 't',
      maxFilesPerTurn: 0,
    } as unknown as EditDeps
    const { edit } = editTools(fakeDeps)
    const execute = edit.execute as (i: unknown, o: unknown) => Promise<string>
    const refusal = await execute({ file: 'a.uidx', ops: [] }, execOpts)
    expect(isRefusal(refusal)).toBe(true)
  })
})
