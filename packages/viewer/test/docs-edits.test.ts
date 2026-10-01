import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { applyPatches, parseOrThrow, type UidxPatch } from '@uidx/format'
import { buildDependentsIndex } from '@uidx/schema'

import DocsPane from '../src/DocsPane.vue'
import { componentDocs } from '../src/docs-model'
import {
  behaviorPatch,
  exampleProblem,
  examplesOf,
  examplesPatch,
  ruleProblem,
  rulesOf,
  setChoices,
} from '../src/docs-edits'

/**
 * Writing a component's documentation from the Docs face: the description,
 * the behaviour rules and the examples go back into the file as the text
 * their regions hold, checked before they leave the editor.
 */
const SOURCE = `---
id: chip
---

A chip.

## Visual Contract

<Page>
  <Component name="Chip" status="draft" width={20} height={20} />
</Page>

<Styles>
  <Style state="hover" root:opacity={0.8} />
</Styles>

## Contract

<Props>
  <Prop name="tone" type="'info' | 'danger'" default="info" visual>Tone.</Prop>
  <Prop name="on" type="boolean" default={false} visual>On.</Prop>
  <Prop name="count" type="number" default={0}>How many.</Prop>
</Props>
`

const doc = parseOrThrow(SOURCE)

describe('behaviour rules', () => {
  it('are written as one bullet per rule, and removed when none are left', () => {
    const patch = behaviorPatch([
      { id: 'press', text: 'click fires `press`  once.' },
      { id: 'focus', text: 'a ring shows' },
    ])
    const next = parseOrThrow(applyPatches(SOURCE, [patch]).source)
    expect(rulesOf(next)).toEqual([
      { id: 'press', text: 'click fires `press` once.' },
      { id: 'focus', text: 'a ring shows' },
    ])
    expect(behaviorPatch([])).toEqual({ op: 'region', name: 'Behavior' })
  })

  it('are checked for an id, a sentence and no repeats', () => {
    expect(ruleProblem([{ id: 'Press', text: 'x' }])).toMatch(/lower-case/)
    expect(ruleProblem([{ id: 'a', text: '' }])).toMatch(/needs a sentence/)
    expect(
      ruleProblem([
        { id: 'a', text: 'x' },
        { id: 'a', text: 'y' },
      ]),
    ).toMatch(/Two rules/)
    expect(ruleProblem([{ id: 'a-b', text: 'x' }])).toBeNull()
  })
})

describe('examples', () => {
  it('offer every prop and the state axis, each with its kind', () => {
    expect(setChoices(doc)).toEqual([
      { name: 'tone', kind: 'choice', values: ['info', 'danger'] },
      { name: 'on', kind: 'boolean' },
      { name: 'count', kind: 'number' },
      { name: 'state', kind: 'choice', values: ['default', 'on', 'hover'] },
    ])
  })

  it('round-trip through the file, a slot fill included', () => {
    const patch = examplesPatch([
      {
        name: 'loud',
        sets: [
          { at: 'tone', value: 'danger' },
          { at: 'on', value: true },
        ],
      },
      { name: 'plain', sets: [] },
    ])
    const next = parseOrThrow(applyPatches(SOURCE, [patch]).source)
    expect(examplesOf(next)).toEqual([
      {
        name: 'loud',
        sets: [
          { at: 'tone', value: 'danger' },
          { at: 'on', value: true },
        ],
      },
      { name: 'plain', sets: [] },
    ])
    expect(exampleProblem([{ name: '', sets: [] }])).toMatch(/needs a name/)
    expect(exampleProblem([{ name: 'a', sets: [{ at: 'tone' }] }])).toMatch(/give tone a value/)
  })
})

describe('the Docs face', () => {
  const mounted = (source = SOURCE, writable = true) => {
    const parsed = parseOrThrow(source)
    return mount(DocsPane, {
      props: {
        docs: componentDocs(
          'chip.uidx',
          parsed,
          buildDependentsIndex(new Map([['chip.uidx', parsed]])),
        ),
        render: async () => null,
        stamp: '',
        doc: parsed,
        writable,
      },
    })
  }

  it('offers to add behaviour and examples when there are none, but only when writable', () => {
    const pane = mounted()
    expect(pane.find('[aria-label="Edit behaviour"]').text()).toBe('+ Add')
    expect(pane.find('[aria-label="Edit examples"]').text()).toBe('+ Add')
    expect(mounted(SOURCE, false).find('[aria-label="Edit behaviour"]').exists()).toBe(false)
  })

  it('writes the rules as one region op, and says what is wrong first', async () => {
    const pane = mounted()
    await pane.find('[aria-label="Edit behaviour"]').trigger('click')
    const row = pane.find('[data-rule="0"]')
    await row.find('[aria-label="Rule id"]').setValue('Press')
    await row.find('[aria-label="Rule"]').setValue('click fires press once')
    await pane.find('[data-editor="behavior"] .primary').trigger('click')
    expect(pane.find('[role="alert"]').text()).toMatch(/lower-case/)
    await row.find('[aria-label="Rule id"]').setValue('press')
    await pane.find('[data-editor="behavior"] .primary').trigger('click')
    expect(pane.emitted('patches')).toEqual([
      ['chip.uidx', [{ op: 'region', name: 'Behavior', body: '- press: click fires press once' }]],
    ])
    expect(pane.find('[data-editor="behavior"]').exists()).toBe(false)
  })

  it('edits an example with a picker for a choice prop', async () => {
    const pane = mounted()
    await pane.find('[aria-label="Edit examples"]').trigger('click')
    const example = pane.find('[data-example="0"]')
    await example.find('[aria-label="Example name"]').setValue('danger')
    await example.find('select[aria-label="Value"]').setValue('danger')
    await pane.find('[data-editor="examples"] .primary').trigger('click')
    const [file, patches] = (pane.emitted('patches') as [string, UidxPatch[]][])[0]!
    expect(file).toBe('chip.uidx')
    const next = parseOrThrow(applyPatches(SOURCE, patches).source)
    expect(examplesOf(next)).toEqual([{ name: 'danger', sets: [{ at: 'tone', value: 'danger' }] }])
  })

  it('rewrites the description', async () => {
    const pane = mounted()
    await pane.find('[aria-label="Edit description"]').trigger('click')
    await pane.find('textarea[aria-label="Description"]').setValue('A compact label.')
    await pane.find('[data-editor="intent"] .primary').trigger('click')
    expect(pane.emitted('patches')).toEqual([
      ['chip.uidx', [{ op: 'intent', text: 'A compact label.' }]],
    ])
  })
})
