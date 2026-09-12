import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MockLanguageModelV4 } from 'ai/test'
import { afterEach, describe, expect, it } from 'vitest'

import { DEFAULT_CONTEXT_TOKENS } from '../src/config.js'
import { AGENT_DIR } from '../src/edit/jail.js'
import { budgetFor } from '../src/index/budget.js'
import { createTurnRunner, type TurnRunner } from '../src/server/turn.js'

/**
 * Phase 2's whole premise in one document: a page too large for the read
 * budget, but still navigable — outline first, then a targeted read, exactly
 * the shape `examples/checkbox.uidx` forced in the real harness (see the
 * throwaway script in the task-11 report for the numbers against the real
 * file; this fixture proves the same mechanism deterministically). 1,500
 * top-level siblings, each ~45-50 characters, comfortably clears every
 * budget field `budgetFor(DEFAULT_CONTEXT_TOKENS)` computes.
 */
const ROW_COUNT = 1_500

function bigPage(): string {
  const rows = Array.from(
    { length: ROW_COUNT },
    (_, i) => `  <Frame name="row${i}" width={10} height={10} />`,
  ).join('\n')
  return `---\nid: big\n---\n\n## Visual Contract\n\n<Page>\n${rows}\n</Page>\n`
}

const TEST_SKILL = `---
name: test-skill
description: A tiny skill used only by this end-to-end test.
---

Always mention the phrase HOUSE IDIOM CONFIRMED when this skill applies.
`

let runner: TurnRunner | null = null
afterEach(async () => {
  await runner?.close()
  runner = null
})

const usage = () => ({
  inputTokens: { total: 1, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1, text: undefined, reasoning: undefined },
})

/** One `finish`-terminated `doStream` result carrying a single tool call. */
function toolCallStream(toolCallId: string, toolName: string, input: unknown) {
  return new ReadableStream({
    start(controller) {
      controller.enqueue({
        type: 'tool-call',
        toolCallId,
        toolName,
        input: JSON.stringify(input),
      })
      controller.enqueue({
        type: 'finish',
        finishReason: { unified: 'tool-calls', raw: undefined },
        usage: usage(),
      })
      controller.close()
    },
  })
}

/** One `finish`-terminated `doStream` result carrying plain text. */
function textStream(text: string) {
  return new ReadableStream({
    start(controller) {
      controller.enqueue({ type: 'text-start', id: '0' })
      controller.enqueue({ type: 'text-delta', id: '0', delta: text })
      controller.enqueue({ type: 'text-end', id: '0' })
      controller.enqueue({
        type: 'finish',
        finishReason: { unified: 'stop', raw: undefined },
        usage: usage(),
      })
      controller.close()
    },
  })
}

/**
 * `delegate.ts` runs a worker's own `ToolLoopAgent` through `generate()`, not
 * `stream()` — a worker's steps are `doGenerate` calls on this same shared
 * mock instance, scripted separately from the orchestrator's `doStream`
 * steps (see `turn.test.ts`'s "a worker starts near-empty" for the same
 * split). Step 0 calls `edit` to widen `row250`; step 1 reports in text —
 * mirroring the orchestrator's own "read before write before report" shape,
 * just on the worker's smaller budget.
 */
function scriptedModel(): MockLanguageModelV4 {
  let streamCall = 0
  let generateCall = 0
  return new MockLanguageModelV4({
    doStream: async () => {
      streamCall += 1
      switch (streamCall) {
        case 1:
          // Step 0 (read-only): outline a page whose source exceeds the
          // read budget.
          return { stream: toolCallStream('c1', 'read', { file: 'big.uidx' }) }
        case 2:
          // Step 1: read one node's exact source by address.
          return {
            stream: toolCallStream('c2', 'read', { file: 'big.uidx', address: 'row250' }),
          }
        case 3:
          // Step 2: load a skill by name.
          return { stream: toolCallStream('c3', 'use_skill', { name: 'test-skill' }) }
        case 4:
          // Step 3: write a durable plan for this task.
          return {
            stream: toolCallStream('c4', 'plan', {
              action: 'set',
              goal: 'Widen row250 on the big page',
              steps: ['Widen row250', 'Report back'],
            }),
          }
        case 5:
          // Step 4: complete the first step.
          return {
            stream: toolCallStream('c5', 'plan', {
              action: 'complete',
              id: 1,
              result: 'delegated the edit to a worker',
            }),
          }
        case 6:
          // Step 5: hand the actual edit to a fresh worker.
          return {
            stream: toolCallStream('c6', 'delegate', {
              kind: 'edit-mission',
              mission: "Widen row250's width to 999 on big.uidx, then report what changed.",
            }),
          }
        default:
          // Step 6: report back in words.
          return {
            stream: textStream('Turn one is done: widened row250 and completed step one.'),
          }
      }
    },
    doGenerate: async () => {
      generateCall += 1
      if (generateCall === 1) {
        return {
          content: [
            {
              type: 'tool-call' as const,
              toolCallId: 'w1',
              toolName: 'edit',
              input: JSON.stringify({
                file: 'big.uidx',
                ops: [{ kind: 'set_prop', address: 'row250', prop: 'width', value: 999 }],
              }),
            },
          ],
          finishReason: { unified: 'tool-calls' as const, raw: undefined },
          usage: usage(),
          warnings: [],
        }
      }
      return {
        content: [{ type: 'text' as const, text: 'Widened row250 to 999.' }],
        finishReason: { unified: 'stop' as const, raw: undefined },
        usage: usage(),
        warnings: [],
      }
    },
  })
}

const userMessage = (text: string) => ({
  id: 'm1',
  role: 'user',
  parts: [{ type: 'text', text }],
})

/**
 * Every `tool-output-available` chunk in one turn's SSE body, keyed by
 * `toolCallId` — the exact string each tool's own `execute()` returned, read
 * off the wire the same way a real client would, rather than reverse-
 * engineered from a later step's request prompt.
 */
function toolOutputs(streamText: string): Map<string, unknown> {
  const outputs = new Map<string, unknown>()
  for (const line of streamText.split('\n')) {
    if (!line.startsWith('data: ')) continue
    let event: unknown
    try {
      event = JSON.parse(line.slice('data: '.length))
    } catch {
      continue
    }
    if (
      event &&
      typeof event === 'object' &&
      (event as { type?: unknown }).type === 'tool-output-available'
    ) {
      const { toolCallId, output } = event as { toolCallId: string; output: unknown }
      outputs.set(toolCallId, output)
    }
  }
  return outputs
}

/** `tool-output-available.output` may be the tool's raw string return value, or that string wrapped as `{ type: 'text', value }` — accept either. */
function outputText(output: unknown): string {
  if (typeof output === 'string') return output
  if (output && typeof output === 'object' && 'value' in output) {
    const value = (output as { value: unknown }).value
    if (typeof value === 'string') return value
  }
  return JSON.stringify(output)
}

function finishMetadata(streamText: string): Record<string, unknown> {
  const finishLine = streamText
    .split('\n')
    .reverse()
    .find((line) => line.startsWith('data: ') && line.includes('"type":"finish"'))
  if (!finishLine) throw new Error('no finish event in the stream')
  return (
    JSON.parse(finishLine.slice('data: '.length)) as { messageMetadata: Record<string, unknown> }
  ).messageMetadata
}

describe('phase 2 end to end: proving the phase against a document that forces every mechanism', () => {
  it('outlines an oversized page, reads exact source by address, loads a skill, carries a plan across turns, and delegates an edit a worker actually makes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'uidx-agent-phase2-e2e-'))
    await writeFile(
      join(root, 'uidx.json'),
      JSON.stringify({ id: 'big-doc', files: ['**/*.uidx'] }),
    )
    await writeFile(join(root, 'big.uidx'), bigPage())
    await mkdir(join(root, AGENT_DIR, 'skills', 'test-skill'), { recursive: true })
    await writeFile(join(root, AGENT_DIR, 'skills', 'test-skill', 'SKILL.md'), TEST_SKILL)

    const budget = budgetFor(DEFAULT_CONTEXT_TOKENS)
    const sourceLength = bigPage().length
    // The fixture only proves something about budget-aware reading if it
    // actually forces the refusal path this test exercises — the same
    // relationship the real exemplar has to its own read budget.
    expect(sourceLength).toBeGreaterThan(budget.readChars)

    const model = { current: scriptedModel() }
    runner = createTurnRunner({
      roots: [root],
      maxSteps: 10,
      maxFilesPerTurn: 10,
      maxTokens: 200_000,
      model: () => model.current,
    })

    const first = await runner.chat({
      messages: [userMessage('widen row250 and get it done')],
      documentId: 'big-doc',
      page: 'big.uidx',
      taskId: 'task-1',
    })
    expect(first.status).toBe(200)
    const firstBody = await first.text()
    const outputs = toolOutputs(firstBody)

    // 1. Outlining an oversized page: the returned text is a refusal plus an
    // outline within budget, never the raw source.
    const outlineResult = outputText(outputs.get('c1'))
    expect(outlineResult).toMatch(/^refused:/)
    expect(outlineResult).toContain('big.uidx')
    expect(outlineResult.length).toBeLessThan(sourceLength / 2)
    expect(outlineResult.length).toBeLessThan(budget.outlineChars + 500)

    // 2. Reading one node's source by address: exact text, not a refusal.
    const sourceResult = outputText(outputs.get('c2'))
    expect(sourceResult).not.toMatch(/^refused:/)
    expect(sourceResult).toContain('name="row250"')
    expect(sourceResult.length).toBeLessThan(200)

    // 3. Loading a skill by name: its body, not a listing.
    const skillResult = outputText(outputs.get('c3'))
    expect(skillResult).toContain('HOUSE IDIOM CONFIRMED')

    // 4. The plan was written and one step completed this turn.
    const planSetResult = outputText(outputs.get('c4'))
    expect(planSetResult).toContain('Widen row250')
    const planCompleteResult = outputText(outputs.get('c5'))
    expect(planCompleteResult).toContain('[x] 1.')
    expect(planCompleteResult).toContain('[ ] 2.')
    expect(finishMetadata(firstBody).planRemaining).toBe(1)

    // 5. Delegation: the file actually changed on disk, and what came back
    // into the orchestrator's own context is the worker's short summary —
    // never its transcript (no role prompt, no raw tool-call JSON).
    const delegateResult = outputText(outputs.get('c6'))
    expect(delegateResult).toContain('Widened row250 to 999.')
    expect(delegateResult).not.toContain('set_prop')
    expect(delegateResult).not.toContain('You are a worker for the uidx design agent')
    expect(delegateResult.length).toBeLessThan(500)
    expect(model.current.doGenerateCalls.length).toBe(2)

    expect(await readFile(join(root, 'big.uidx'), 'utf8')).toContain('width={999}')

    // The final orchestrator step, answering in words, must not have had the
    // worker's own transcript machinery leak into its request either — the
    // worker's tool-call id, its edit op, and its role prompt are all things
    // only *its* isolated `doGenerate` conversation ever saw (asserted
    // directly below), never the orchestrator's own `doStream` history.
    const finalPrompt = JSON.stringify(model.current.doStreamCalls.at(-1)?.prompt ?? [])
    expect(finalPrompt).not.toContain('"w1"')
    expect(finalPrompt).not.toContain('"toolName":"edit"')
    expect(finalPrompt).not.toContain('You are a worker for the uidx design agent')

    // And the worker's own request never saw the orchestrator's machinery
    // either — no plan, no other tools, a mission-scoped context rather than
    // the orchestrator's full pack.
    const workerPrompt = JSON.stringify(model.current.doGenerateCalls[0]?.tools ?? [])
    expect(workerPrompt).not.toContain('"plan"')
    expect(workerPrompt).not.toContain('"delegate"')

    // 6. A second turn with the same task id sees the plan's remaining
    // steps — the durable record survived past the first HTTP turn.
    model.current = new MockLanguageModelV4({
      doStream: async () => ({ stream: textStream('Resuming the task.') }),
    })
    const second = await runner.chat({
      messages: [userMessage('keep going')],
      documentId: 'big-doc',
      page: 'big.uidx',
      taskId: 'task-1',
    })
    expect(second.status).toBe(200)
    const secondBody = await second.text()
    expect(secondBody).toContain('Resuming the task.')

    const secondSentPrompt = JSON.stringify(model.current.doStreamCalls[0]?.prompt ?? [])
    expect(secondSentPrompt).toContain('Widen row250 on the big page')
    expect(secondSentPrompt).toContain('[x] 1. Widen row250')
    expect(secondSentPrompt).toContain('[ ] 2. Report back')
    expect(finishMetadata(secondBody).planRemaining).toBe(1)
  })
})
