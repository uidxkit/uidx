import { applyPatches, parseOrThrow } from '@uidx/format'
import { describe, expect, it } from 'vitest'

import { compileOps } from '../src/edit/compile.js'
import { editOpsSchema, narrowOps, type EditOpInput } from '../src/edit/ops.js'
import { refuseBadOps } from '../src/tools/edit.js'

const BUTTON = `---
id: button
---

## Visual Contract

<Page>
  <Component name="Button" implements="x-button" width={80} height={32}>
    <Text name="label" characters="{label}" />
  </Component>
</Page>
`

/** Applies a batch the way `applyOps` does: one compiled op at a time. */
function run(source: string, input: EditOpInput[]): string {
  expect(editOpsSchema.safeParse(input).success).toBe(true)
  const narrowed = narrowOps(input)
  if (!narrowed.ok) throw new Error(narrowed.message)
  expect(refuseBadOps(narrowed.value)).toBeNull()
  let current = source
  for (const op of narrowed.value) {
    current = applyPatches(current, compileOps(parseOrThrow(current), [op])).source
  }
  return current
}

describe('design-system ops (ADRs 0013–0016)', () => {
  it('declares a contract, a model with fields, and a style cell', () => {
    const next = run(BUTTON, [
      {
        kind: 'declare',
        contractKind: 'prop',
        name: 'label',
        attrs: { type: 'string', sample: 'Save' },
        description: 'The words on the button.',
      },
      {
        kind: 'declare',
        contractKind: 'prop',
        name: 'disabled',
        attrs: { type: 'boolean', default: false, visual: true },
        description: 'Inert and dimmed.',
      },
      { kind: 'set_model', name: 'Action', description: 'What a button does.' },
      {
        kind: 'set_field',
        model: 'Action',
        name: 'id',
        attrs: { type: 'string', key: true, sample: ['save'] },
        description: 'Stable identity.',
      },
      {
        kind: 'set_style',
        keys: { state: 'disabled' },
        target: 'root',
        prop: 'opacity',
        value: 0.4,
      },
    ])
    const spec = parseOrThrow(next).spec!
    expect(spec.contract?.props?.map((p) => p.name)).toEqual(['label', 'disabled'])
    expect(spec.models?.[0]?.fields.map((f) => f.name)).toEqual(['id'])
    expect(spec.styles?.[0]).toMatchObject({
      keys: { state: 'disabled' },
      values: { root: { opacity: 0.4 } },
    })
  })

  it('removes a declaration', () => {
    const declared = run(BUTTON, [
      { kind: 'declare', contractKind: 'event', name: 'press', description: 'Fires on click.' },
    ])
    const removed = run(declared, [
      { kind: 'declare', contractKind: 'event', name: 'press', remove: true },
    ])
    expect(parseOrThrow(removed).spec?.contract?.events ?? []).toEqual([])
  })

  it('asks for the words a declaration needs', () => {
    const narrowed = narrowOps([{ kind: 'declare', contractKind: 'prop', name: 'size' }])
    expect(narrowed).toEqual({
      ok: false,
      message: 'op 1 (declare) needs a description (or remove: true)',
    })
  })

  it('refuses a style cell with a prop no node carries', () => {
    const narrowed = narrowOps([
      { kind: 'set_style', keys: { state: 'hover' }, target: 'root', prop: 'colour', value: 1 },
    ])
    if (!narrowed.ok) throw new Error(narrowed.message)
    expect(refuseBadOps(narrowed.value)).toMatch(/not a uidx prop/)
  })
})
