import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MockLanguageModelV4 } from 'ai/test'
import { afterEach, describe, expect, it } from 'vitest'

import { createTurnRunner, type TurnRunner } from '../src/server/turn.js'

const HOME = `---
id: home
---

## Visual Contract

<Page>
  <Frame name="hero" width={600} height={200} />
</Page>
`

let runner: TurnRunner | null = null
afterEach(async () => {
  await runner?.close()
  runner = null
})

type FinishReason = 'stop' | 'tool-calls'

const finish = (reason: FinishReason) => ({
  type: 'finish' as const,
  finishReason: { unified: reason, raw: undefined },
  usage: {
    inputTokens: { total: 1, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
    outputTokens: { total: 1, text: undefined, reasoning: undefined },
  },
})

/**
 * `buildAgent`'s `prepareStep` restricts step 0 to the read-only tools
 * (`read`, `search`) precisely so a small model looks before it writes — a
 * scripted model that called `edit` on step 0 would have that call dropped as
 * `NoSuchToolError` and the file would never change (see the test run this
 * replaced: it called `edit` on step 0 and failed exactly that way). A
 * realistic script instead reads on step 0, edits on step 1, and reports in
 * words on step 2.
 */
function scriptedModel(): MockLanguageModelV4 {
  let call = 0
  return new MockLanguageModelV4({
    doStream: async () => {
      const step = call
      call += 1
      return {
        stream: new ReadableStream({
          start(controller) {
            if (step === 0) {
              controller.enqueue({
                type: 'tool-call',
                toolCallId: 'c1',
                toolName: 'read',
                input: JSON.stringify({ file: 'home.uidx', address: 'hero' }),
              })
              controller.enqueue(finish('tool-calls'))
            } else if (step === 1) {
              controller.enqueue({
                type: 'tool-call',
                toolCallId: 'c2',
                toolName: 'edit',
                input: JSON.stringify({
                  file: 'home.uidx',
                  ops: [{ kind: 'set_prop', address: 'hero', prop: 'width', value: 800 }],
                }),
              })
              controller.enqueue(finish('tool-calls'))
            } else {
              controller.enqueue({ type: 'text-start', id: '0' })
              controller.enqueue({ type: 'text-delta', id: '0', delta: 'Widened the hero.' })
              controller.enqueue({ type: 'text-end', id: '0' })
              controller.enqueue(finish('stop'))
            }
            controller.close()
          },
        }),
      }
    },
  })
}

describe('a whole turn', () => {
  it('edits the file the user was looking at, and can be undone', async () => {
    const root = await mkdtemp(join(tmpdir(), 'uidx-agent-e2e-'))
    await writeFile(join(root, 'uidx.json'), JSON.stringify({ id: 'doc', files: ['**/*.uidx'] }))
    await writeFile(join(root, 'home.uidx'), HOME)

    runner = createTurnRunner({
      roots: [root],
      maxSteps: 6,
      maxFilesPerTurn: 4,
      maxTokens: 200_000,
      model: () => scriptedModel(),
    })

    const response = await runner.chat({
      messages: [
        { id: 'm1', role: 'user', parts: [{ type: 'text', text: 'make the hero wider' }] },
      ],
      documentId: 'doc',
      page: 'home.uidx',
      selection: ['hero'],
    })

    const body = await response.text()
    expect(body).toContain('Widened the hero.')
    expect(await readFile(join(root, 'home.uidx'), 'utf8')).toContain('width={800}')

    const turnId = response.headers.get('x-uidx-turn')!
    const reverted = await runner.revert({ documentId: 'doc', turnId })
    expect(reverted.status).toBe(200)
    expect(await readFile(join(root, 'home.uidx'), 'utf8')).toBe(HOME)
  })
})
