import { describe, expect, it } from 'vitest'

import { SYSTEM_PROMPT } from '../src/agent/prompt.js'

describe('SYSTEM_PROMPT', () => {
  it('stays under the budget the spec sets, roughly 600 tokens', () => {
    // ~4 characters per token is the usual rule of thumb.
    expect(SYSTEM_PROMPT.length).toBeLessThan(2400)
  })

  it('states the reuse-first rule, which is the whole point of the doc map', () => {
    expect(SYSTEM_PROMPT).toMatch(/reuse/i)
  })

  it('tells the model it edits files, not the canvas', () => {
    expect(SYSTEM_PROMPT).toMatch(/\.uidx/)
  })

  it('carries no per-document facts — those arrive as context, not prompt', () => {
    expect(SYSTEM_PROMPT).not.toMatch(/home\.uidx|Card/)
  })

  it('does not claim every change routes through edit, since create_file and delete_file do not', () => {
    expect(SYSTEM_PROMPT).not.toMatch(/every change goes through edit/i)
  })

  it('names create_file and delete_file so the model reaches for them instead of forcing edit', () => {
    expect(SYSTEM_PROMPT).toMatch(/create_file/)
    expect(SYSTEM_PROMPT).toMatch(/delete_file/)
  })

  it('tells the model to plan a long job and to complete each step, since nothing else will', () => {
    // A 9B model is the least likely thing in this harness to reach for an
    // unprompted tool. With no mention here, `plan` was never called,
    // `latestPlan` stayed null, `planRemaining` stayed 0, the panel's
    // Continue control never rendered, and the whole durable-plan path —
    // success criterion three — sat dormant.
    expect(SYSTEM_PROMPT).toMatch(/\bplan\b/)
    expect(SYSTEM_PROMPT).toMatch(/complete each step/i)
  })
})
