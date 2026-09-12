import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { asSchema } from 'ai'
import { describe, expect, it } from 'vitest'

import { createPlanStore } from '../src/plan/store.js'
import { planTools, type NodeFault } from '../src/plan/tool.js'

const root = () => mkdtemp(join(tmpdir(), 'uidx-plan-'))

const run = async (tool: { execute?: unknown }, input: unknown): Promise<string> =>
  (tool.execute as (i: unknown, o: unknown) => Promise<string>)(input, {
    toolCallId: 't',
    messages: [],
  })

describe('PlanStore', () => {
  it('round-trips a plan through disk', async () => {
    const store = createPlanStore(await root())
    await store.write({
      taskId: 't1',
      goal: 'Build a checkbox page',
      steps: [{ id: 1, text: 'Create the file', status: 'todo' }],
    })
    const back = await store.read('t1')
    expect(back?.goal).toBe('Build a checkbox page')
    expect(back?.steps[0]).toMatchObject({ id: 1, status: 'todo' })
  })

  it('returns null for a task it has never seen', async () => {
    expect(await createPlanStore(await root()).read('nope')).toBeNull()
  })

  it('renders compactly, so reloading it costs little', async () => {
    const store = createPlanStore(await root())
    const plan = {
      taskId: 't1',
      goal: 'g',
      steps: [
        { id: 1, text: 'one', status: 'done' as const, result: 'created home.uidx' },
        { id: 2, text: 'two', status: 'todo' as const },
      ],
    }
    const text = store.render(plan)
    expect(text).toContain('one')
    expect(text).toContain('created home.uidx')
    expect(text.length).toBeLessThan(400)
  })
})

describe('plan tool', () => {
  it('creates a plan with steps and reports the first todo', async () => {
    const store = createPlanStore(await root())
    const out = await run(planTools({ store, taskId: 't1' }).plan, {
      action: 'set',
      goal: 'Build a checkbox page',
      steps: ['Create the file', 'Add the states'],
    })
    expect(out).toContain('Create the file')
    expect((await store.read('t1'))?.steps).toHaveLength(2)
  })

  it('marks a step done with its result and shows what remains', async () => {
    const store = createPlanStore(await root())
    await run(planTools({ store, taskId: 't1' }).plan, {
      action: 'set',
      goal: 'g',
      steps: ['one', 'two'],
    })
    const out = await run(planTools({ store, taskId: 't1' }).plan, {
      action: 'complete',
      id: 1,
      result: 'created home.uidx',
    })
    expect(out).toContain('two')
    expect((await store.read('t1'))?.steps[0]).toMatchObject({
      status: 'done',
      result: 'created home.uidx',
    })
  })

  it('reads back the plan so a later turn can resume it', async () => {
    const store = createPlanStore(await root())
    await run(planTools({ store, taskId: 't1' }).plan, {
      action: 'set',
      goal: 'g',
      steps: ['one'],
    })
    // A *different* tool instance, same task id — this is the resume path.
    const out = await run(planTools({ store, taskId: 't1' }).plan, { action: 'show' })
    expect(out).toContain('one')
  })

  it('says plainly when there is no plan yet', async () => {
    const out = await run(planTools({ store: createPlanStore(await root()), taskId: 'x' }).plan, {
      action: 'show',
    })
    expect(out).toMatch(/no plan/i)
  })

  it('refuses to overwrite a plan that already has completed work', async () => {
    const store = createPlanStore(await root())
    const tools = planTools({ store, taskId: 't1' })
    await run(tools.plan, { action: 'set', goal: 'g', steps: ['one', 'two'] })
    await run(tools.plan, { action: 'complete', id: 1, result: 'created home.uidx' })

    const out = await run(tools.plan, { action: 'set', goal: 'a different goal', steps: ['x'] })

    expect(out).toMatch(/not overwritten/i)
    const stored = await store.read('t1')
    expect(stored?.goal).toBe('g')
    expect(stored?.steps[0]).toMatchObject({ status: 'done', result: 'created home.uidx' })
  })

  it('refuses to overwrite a plan whose work is blocked rather than done', async () => {
    // `hasProgress` protects `blocked` for the same reason it protects
    // `done` — a blocked step carries a recorded reason, and losing it means
    // the model rediscovers the obstacle. Only `done` was pinned before.
    const store = createPlanStore(await root())
    const tools = planTools({ store, taskId: 't1' })
    await run(tools.plan, { action: 'set', goal: 'g', steps: ['one', 'two'] })
    const blocked = await run(tools.plan, {
      action: 'block',
      id: 1,
      result: 'the token collection does not exist',
    })
    expect(blocked).toContain('the token collection does not exist')

    const out = await run(tools.plan, { action: 'set', goal: 'a different goal', steps: ['x'] })

    expect(out).toMatch(/not overwritten/i)
    const stored = await store.read('t1')
    expect(stored?.goal).toBe('g')
    expect(stored?.steps[0]).toMatchObject({
      status: 'blocked',
      result: 'the token collection does not exist',
    })
  })

  it('lets set start a new task over a plan whose every step is already done', async () => {
    // A task id lives as long as the panel's conversation, so a finished
    // plan is still on disk when an unrelated later request arrives. If
    // `hasProgress` refused that too, the model would be told to keep a plan
    // it has no way to keep — see `isFinished` in `plan/store.ts`.
    const store = createPlanStore(await root())
    const tools = planTools({ store, taskId: 't1' })
    await run(tools.plan, { action: 'set', goal: 'g', steps: ['one'] })
    await run(tools.plan, { action: 'complete', id: 1, result: 'created home.uidx' })

    const out = await run(tools.plan, { action: 'set', goal: 'a new job', steps: ['fresh step'] })

    expect(out).not.toMatch(/not overwritten/i)
    expect(out).toContain('fresh step')
    const stored = await store.read('t1')
    expect(stored?.goal).toBe('a new job')
    expect(stored?.steps[0]).toMatchObject({ status: 'todo' })
  })

  it('bounds what a render costs, however long the plan the model wrote', async () => {
    // The render rides in `instructions` on every turn that continues the
    // task, and comes straight back as the tool's own result. Nothing about
    // `steps`, `text`, `result` or `goal` was bounded before.
    const store = createPlanStore(await root())
    const text = await run(planTools({ store, taskId: 't1' }).plan, {
      action: 'set',
      goal: 'g'.repeat(5_000),
      steps: Array.from({ length: 200 }, (_, i) => `step ${i} ${'x'.repeat(500)}`),
    })
    expect(text.length).toBeLessThanOrEqual(2_000)
    expect(text).toMatch(/not shown/i)
  })

  it('lets set replace a plan that has no completed or blocked steps', async () => {
    const store = createPlanStore(await root())
    const tools = planTools({ store, taskId: 't1' })
    await run(tools.plan, { action: 'set', goal: 'g', steps: ['one', 'two'] })

    const out = await run(tools.plan, { action: 'set', goal: 'g v2', steps: ['revised step'] })

    expect(out).toContain('revised step')
    const stored = await store.read('t1')
    expect(stored?.goal).toBe('g v2')
    expect(stored?.steps).toHaveLength(1)
  })

  it('keeps both results when two completes race for the same task', async () => {
    const store = createPlanStore(await root())
    const tools = planTools({ store, taskId: 't1' })
    await run(tools.plan, { action: 'set', goal: 'g', steps: ['one', 'two'] })

    // A single model step can emit more than one tool call, executed together
    // (`ai@7` runs a step's tool calls under `Promise.all`) — two `complete`s
    // for different steps landing at once is a real, not hypothetical, shape.
    await Promise.all([
      run(tools.plan, { action: 'complete', id: 1, result: 'first done' }),
      run(tools.plan, { action: 'complete', id: 2, result: 'second done' }),
    ])

    const stored = await store.read('t1')
    expect(stored?.steps[0]).toMatchObject({ status: 'done', result: 'first done' })
    expect(stored?.steps[1]).toMatchObject({ status: 'done', result: 'second done' })
  })

  it('lets replace:true discard a plan that has completed work', async () => {
    const store = createPlanStore(await root())
    const tools = planTools({ store, taskId: 't1' })
    await run(tools.plan, { action: 'set', goal: 'g', steps: ['one'] })
    await run(tools.plan, { action: 'complete', id: 1, result: 'done already' })

    const out = await run(tools.plan, {
      action: 'set',
      goal: 'g v2',
      steps: ['fresh step'],
      replace: true,
    })

    expect(out).toContain('fresh step')
    const stored = await store.read('t1')
    expect(stored?.goal).toBe('g v2')
    expect(stored?.steps).toHaveLength(1)
    expect(stored?.steps[0]).toMatchObject({ status: 'todo' })
  })

  it('recovers legibly from a plan file that is not valid JSON', async () => {
    const dir = await root()
    const store = createPlanStore(dir)
    await run(planTools({ store, taskId: 't1' }).plan, { action: 'set', goal: 'g', steps: ['one'] })
    await writeFile(join(dir, '.uidx-agent', 'plans', 't1.json'), '{not json', 'utf8')

    const out = await run(planTools({ store, taskId: 't1' }).plan, { action: 'show' })
    expect(out).toMatch(/replace.*true/is)

    const recovered = await run(planTools({ store, taskId: 't1' }).plan, {
      action: 'set',
      goal: 'recovered',
      steps: ['start over'],
      replace: true,
    })
    expect(recovered).toContain('start over')
  })
})

describe('plan tool input shape', () => {
  // The regression this whole flattening exists for: a top-level `oneOf` has
  // no `properties` at its root, and that is the only place a small model
  // looks. Asserting the serialized schema, not the zod object, because the
  // serialized form is the only thing the model ever sees.
  it('serializes to one object with every field visible at the root', async () => {
    const { plan } = planTools({ store: createPlanStore(await root()), taskId: 't' })
    const schema = asSchema(plan.inputSchema).jsonSchema as {
      type?: string
      oneOf?: unknown
      anyOf?: unknown
      properties?: Record<string, unknown>
    }
    expect(schema.type).toBe('object')
    expect(schema.oneOf ?? schema.anyOf).toBeUndefined()
    expect(Object.keys(schema.properties ?? {}).sort()).toEqual([
      'action',
      'goal',
      'id',
      'replace',
      'result',
      'steps',
    ])
  })

  it('refuses a set with no goal or steps in words naming both', async () => {
    const { plan } = planTools({ store: createPlanStore(await root()), taskId: 't' })
    expect(await run(plan, { action: 'set' })).toBe('set needs a goal and at least one step')
    expect(await run(plan, { action: 'set', goal: 'g', steps: [] })).toBe(
      'set needs a goal and at least one step',
    )
  })

  it('refuses complete and block for want of the fields they settle with', async () => {
    const { plan } = planTools({ store: createPlanStore(await root()), taskId: 't' })
    expect(await run(plan, { action: 'complete', id: 1 })).toBe('complete needs id and result')
    expect(await run(plan, { action: 'block', result: 'why' })).toBe('block needs id and result')
  })

  it('takes a flat set and a flat complete end to end', async () => {
    const { plan } = planTools({ store: createPlanStore(await root()), taskId: 't' })
    const set = await run(plan, { action: 'set', goal: 'document Switch', steps: ['a', 'b'] })
    expect(set).toContain('document Switch')
    const done = await run(plan, { action: 'complete', id: 1, result: 'outlined it' })
    expect(done).toContain('outlined it')
  })
})

/**
 * Measured on a real run: a model marked "Build cover section" done with a
 * result reading "Built cover section with eyebrow, title, definition text"
 * over a cover that was an empty frame. Nothing disagreed, because nothing
 * could — the plan took the model's word for it.
 */
describe('completing a step that is not done', () => {
  const withFaults = async (faults: NodeFault[]) => {
    const { plan } = planTools({
      store: createPlanStore(await root()),
      taskId: 't',
      faults: () => faults,
    })
    await run(plan, { action: 'set', goal: 'g', steps: ['Build section: cover', 'Something else'] })
    return plan
  }

  const blankAt = (address: string): NodeFault => ({
    address,
    why: 'still draws nothing',
    fix: 'give it a size, a fill, or children first',
  })

  const withBlank = async (blank: string[]) => withFaults(blank.map(blankAt))

  it('refuses when the section the step names still draws nothing', async () => {
    const plan = await withBlank(['doc#cover'])
    const result = await run(plan, {
      action: 'complete',
      id: 1,
      result: 'Built cover section with eyebrow, title and definition',
    })
    expect(result).toContain('doc#cover still draws nothing')
    expect(result).toContain('or use block if it cannot be finished')
  })

  it('leaves the step untouched when it refuses', async () => {
    const plan = await withBlank(['doc#cover'])
    await run(plan, { action: 'complete', id: 1, result: 'Built the cover' })
    expect(await run(plan, { action: 'show' })).not.toContain('Built the cover')
  })

  it('lets it through once the section draws something', async () => {
    const plan = await withBlank([])
    expect(await run(plan, { action: 'complete', id: 1, result: 'Built the cover' })).toContain(
      'Built the cover',
    )
  })

  // It closes one specific lie. It does not appoint the plan tool judge of
  // whether the work is any good.
  it('says nothing about a step that names nothing checkable', async () => {
    const plan = await withBlank(['doc#cover'])
    expect(await run(plan, { action: 'complete', id: 2, result: 'Researched the spec' })).toContain(
      'Researched the spec',
    )
  })

  it('matches a whole name, not a fragment of a longer one', async () => {
    const plan = await withBlank(['doc#cover'])
    expect(
      await run(plan, { action: 'complete', id: 2, result: 'Wrote about covergirl marketing' }),
    ).toContain('covergirl')
  })

  // Blocking is how a model says a thing cannot be finished, so it must stay
  // open even when the section is empty — otherwise there is no way out.
  it('never blocks the escape hatch', async () => {
    const plan = await withBlank(['doc#cover'])
    expect(
      await run(plan, { action: 'block', id: 1, result: 'cover needs assets I do not have' }),
    ).toContain('cover needs assets')
  })

  /**
   * The opposite failure, from a later run: every section full, and every one
   * wider than the parent it sat in, so all twelve spilled their text. The
   * model called `review` six times, looked at the picture, and marked each
   * step done. A section that does not draw correctly is not finished either.
   */
  it('refuses a section that is full but wider than its parent', async () => {
    const plan = await withFaults([
      {
        address: 'doc#cover',
        why: 'is 1440 wide inside 1296 of space, so it overflows its parent',
        fix: "subtract the parent's left and right padding from its width first",
      },
    ])
    const result = await run(plan, { action: 'complete', id: 1, result: 'Built the cover section' })
    expect(result).toContain('doc#cover is 1440 wide inside 1296')
    expect(result).toContain("subtract the parent's left and right padding")
    expect(result).toContain('or use block if it cannot be finished')
  })
})
