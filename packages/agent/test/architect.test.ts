import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { createArchitectureStore } from '../src/plan/architecture.js'
import { architectTools } from '../src/tools/architect.js'
import type { DocumentIndex, VariableEntry } from '../src/index/types.js'

const root = () => mkdtemp(join(tmpdir(), 'uidx-architect-'))

const run = async (tool: { execute?: unknown }, input: unknown): Promise<string> =>
  (tool.execute as (i: unknown, o: unknown) => Promise<string>)(input, {
    toolCallId: 'a1',
    messages: [],
  })

/** Just the two maps the gate reads; everything else unused. */
const indexWith = (
  collections: string[],
  components: string[] = [],
  headings: string[] = [],
): DocumentIndex =>
  ({
    variables: new Map(
      collections.map((collection): [string, VariableEntry] => [
        `${collection}#x`,
        { address: `${collection}#x`, file: 'tokens.uidx', collection, name: 'x', type: 'FLOAT' },
      ]),
    ),
    components: new Map(components.map((name) => [name, { name, file: 'home.uidx' }])),
    pages: new Map([['home.uidx', { file: 'home.uidx', headings }]]),
  }) as unknown as DocumentIndex

const CHECKLIST = [
  { id: 'cover', requirement: 'cover frame' },
  { id: 'states', requirement: 'states frame' },
  { id: 'in-context', requirement: 'in-context frame' },
  { id: 'component', requirement: 'a <Component> beside the page' },
  { id: 'core-intent', requirement: '## Core Intent above the tree' },
]

const GOOD = {
  action: 'set',
  summary: 'A Switch doc page: one component, two scales, sections in reading order',
  components: [
    {
      name: 'Control/Switch',
      props: [{ name: 'label', type: 'TEXT' }],
      axes: [{ name: 'checked', values: ['off', 'on'] }],
    },
  ],
  tokens: [
    { collection: 'space', tier: 'primitive', usedFor: 'gaps and padding', status: 'exists' },
  ],
  sections: [
    { name: 'cover', holds: 'title block' },
    { name: 'states', holds: 'instance grid' },
    { name: 'inContext', holds: 'real placements' },
  ],
}

/**
 * The failure this closes was measured three times: component APIs, token
 * usage and section order invented *while* building, drifting between
 * sections — twenty tokens bound with a declared scale untouched, axes
 * growing mid-page. The decisions that must stay consistent across steps get
 * decided once, checked, and stored.
 */
describe('architect', () => {
  it('stores a sound architecture and reads it back rendered', async () => {
    const store = createArchitectureStore(await root())
    const { architect } = architectTools({ store, taskId: 't', index: indexWith(['space']) })
    const out = await run(architect, GOOD)
    expect(out).toContain('architecture set.')
    expect(out).toContain('Control/Switch — axes checked: off | on')
    expect(out).toContain('space (primitive) — gaps and padding')
    expect(out).toContain('1. cover — title block')
    expect(await run(architect, { action: 'show' })).toContain('Architecture:')
  })

  // Extracted from the research by the model, never authored by the harness —
  // and rendered under a heading that says what they are for.
  it('carries the constraints the research states into the render', async () => {
    const store = createArchitectureStore(await root())
    const { architect } = architectTools({ store, taskId: 't', index: indexWith(['space']) })
    const out = await run(architect, {
      ...GOOD,
      constraints: ['the thumb must be at least as tall as the track'],
    })
    expect(out).toContain('Constraints, from the research')
    expect(out).toContain('- the thumb must be at least as tall as the track')
  })

  // Vision distilled into language, because language survives: pictures get
  // evicted and cost tokens every step; a written spec rides in every brief.
  it('carries the appearance spec — vision written down — into the render', async () => {
    const store = createArchitectureStore(await root())
    const { architect } = architectTools({ store, taskId: 't', index: indexWith(['space']) })
    const out = await run(architect, {
      ...GOOD,
      appearance: ['the thumb is a lighter disc drawn on top of the track, resting at the ends'],
    })
    expect(out).toContain('Appearance, learned from the reference images')
    expect(out).toContain('draw what these words say')
    expect(out).toContain('- the thumb is a lighter disc drawn on top of the track')
  })

  it('refuses a token marked exists that the document does not declare, naming what does', async () => {
    const store = createArchitectureStore(await root())
    const { architect } = architectTools({ store, taskId: 't', index: indexWith(['radius']) })
    const out = await run(architect, GOOD)
    expect(out).toContain('not set')
    expect(out).toContain('"space" is marked exists')
    expect(out).toContain('radius')
  })

  it('lets a token the task will declare pass without a lookup', async () => {
    const store = createArchitectureStore(await root())
    const { architect } = architectTools({ store, taskId: 't', index: indexWith([]) })
    const out = await run(architect, {
      ...GOOD,
      tokens: [{ collection: 'space', usedFor: 'gaps', status: 'declare' }],
    })
    expect(out).toContain('architecture set.')
  })

  it('refuses an axis with fewer than two values — that is not an axis', async () => {
    const store = createArchitectureStore(await root())
    const { architect } = architectTools({ store, taskId: 't', index: indexWith(['space']) })
    const out = await run(architect, {
      ...GOOD,
      components: [{ name: 'C', axes: [{ name: 'state', values: ['on'] }] }],
    })
    expect(out).toContain('not set')
    expect(out).toContain('"state" has 1 value(s)')
  })

  /**
   * Coverage is judged with the same name-loosening the e2e coverage learned
   * the hard way: `inContext` covers `in-context`. Prose and component ids
   * are not sections and must not be demanded as ones.
   */
  it('refuses sections that leave a checklist requirement homeless, ignoring spelling', async () => {
    const store = createArchitectureStore(await root())
    const { architect } = architectTools({
      store,
      taskId: 't',
      index: indexWith(['space']),
      checklist: () => CHECKLIST,
    })
    const out = await run(architect, {
      ...GOOD,
      sections: [{ name: 'cover', holds: 'title' }],
    })
    expect(out).toContain('not set')
    expect(out).toContain('states, in-context')
    expect(out).not.toContain('core-intent')
    expect(out).not.toContain('component')

    expect(await run(architect, GOOD)).toContain('architecture set.')
  })

  it('names every gap in one refusal, not one per call', async () => {
    const store = createArchitectureStore(await root())
    const { architect } = architectTools({
      store,
      taskId: 't',
      index: indexWith(['radius']),
      checklist: () => CHECKLIST,
    })
    const out = await run(architect, {
      ...GOOD,
      components: [{ name: 'C', axes: [{ name: 's', values: ['a'] }] }],
      sections: [{ name: 'cover', holds: 'title' }],
    })
    expect(out).toContain('"s" has 1 value(s)')
    expect(out).toContain('"space" is marked exists')
    expect(out).toContain('states, in-context')
  })

  it('says which planned components already exist, so they are reused rather than rebuilt', async () => {
    const store = createArchitectureStore(await root())
    const { architect } = architectTools({
      store,
      taskId: 't',
      index: indexWith(['space'], ['Control/Switch']),
    })
    const out = await run(architect, GOOD)
    expect(out).toContain(
      "Control/Switch is already defined in home.uidx — reuse it, don't rebuild.",
    )
  })

  // The research an earlier task distilled, kept so this one need not redo it
  // — the whole point of a design.md that lives in the file.
  it('points a later task at an existing design.md before it touches the component', async () => {
    const store = createArchitectureStore(await root())
    const { architect } = architectTools({
      store,
      taskId: 't',
      index: indexWith(['space'], ['Control/Switch'], ['Core Intent', 'Design']),
    })
    const out = await run(architect, GOOD)
    expect(out).toContain('that page carries a ## Design section — read it and follow it')
  })

  it('refuses a set with no sections at all', async () => {
    const store = createArchitectureStore(await root())
    const { architect } = architectTools({ store, taskId: 't' })
    expect(await run(architect, { action: 'set', summary: 's' })).toContain(
      'needs a summary and at least one section',
    )
  })
})

describe('architecture store', () => {
  it('survives a corrupt file as an error naming the task, not a crash', async () => {
    const dir = await root()
    const store = createArchitectureStore(dir)
    const { mkdir } = await import('node:fs/promises')
    await mkdir(join(dir, '.uidx-agent/architecture'), { recursive: true })
    await writeFile(join(dir, '.uidx-agent/architecture/t.json'), 'not json')
    await expect(store.read('t')).rejects.toThrow('not valid JSON')
  })

  it('writes atomically and reads back what it wrote', async () => {
    const dir = await root()
    const store = createArchitectureStore(dir)
    const architecture = {
      taskId: 't',
      summary: 's',
      components: [],
      tokens: [],
      sections: [{ name: 'cover', holds: 'x' }],
      constraints: ['the thumb must be at least as tall as the track'],
      appearance: ['the thumb is a lighter disc drawn on top of the track'],
    }
    await store.write(architecture)
    expect(await store.read('t')).toEqual(architecture)
    expect(
      JSON.parse(await readFile(join(dir, '.uidx-agent/architecture/t.json'), 'utf8')),
    ).toEqual(architecture)
  })
})
