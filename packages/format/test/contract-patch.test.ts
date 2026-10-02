import { describe, expect, it } from 'vitest'
import {
  applyPatches,
  inversePatches,
  parseOrThrow,
  type ContractKind,
  type UidxPatch,
} from '../src/index.js'

/**
 * Editing the contract from the inspector writes canonical elements into
 * `## Contract` (ADR 0013 §2). What these pin: an element is overwritten in
 * place, added at the end of its list, its list and the region are created
 * when absent, a removal that empties a list removes it, and every op inverts.
 */
const page = (regions = '') => `---
id: box
---

## Visual Contract

<Page>
  <Component name="Box" status="draft" implements="x-box" width={20} height={20} />
</Page>
${regions}`

const declare = (
  kind: ContractKind,
  name: string,
  attrs: Record<string, unknown>,
  description: string,
) => ({ op: 'contract', kind, name, declaration: { attrs, description } }) as UidxPatch
const remove = (kind: ContractKind, name: string) => ({ op: 'contract', kind, name }) as UidxPatch

describe('the contract op', () => {
  it('renames a declaration in place, refuses a taken name, and inverts', () => {
    const source = page(`
## Contract

<Props>
  <Prop name="a" type="string">A.</Prop>
  <Prop name="b" type="string">B.</Prop>
</Props>
`)
    const rename: UidxPatch = {
      op: 'contract',
      kind: 'prop',
      name: 'a',
      declaration: { attrs: { type: 'string' }, description: 'A.' },
      rename: 'title',
    }
    const next = applyPatches(source, [rename]).source
    expect(parseOrThrow(next).spec!.contract!.props.map((prop) => prop.name)).toEqual([
      'title',
      'b',
    ])
    expect(applyPatches(next, inversePatches(parseOrThrow(source), [rename])).source).toBe(source)
    expect(() => applyPatches(source, [{ ...rename, rename: 'b' } as UidxPatch])).toThrow(
      /already declared/,
    )
  })

  it('creates the region and the list for the first declaration, before other regions', () => {
    const source = page('\n## Behavior\n\n- a: does a thing.\n')
    const next = applyPatches(source, [
      declare('prop', 'checked', { type: 'boolean', default: false, visual: true }, 'On.'),
    ]).source
    expect(next).toContain(
      '</Page>\n\n## Contract\n\n<Props>\n  <Prop name="checked" type="boolean" default={false} visual>On.</Prop>\n</Props>\n\n## Behavior',
    )
    expect(parseOrThrow(next).spec!.contract!.props.map((p) => [p.name, p.visual])).toEqual([
      ['checked', true],
    ])
  })

  it('adds to an existing list, creates a missing list in the region, and rewrites in place', () => {
    const source = page(`
## Contract

<Props>
  <Prop name="checked" type="boolean" default={false} visual>On.</Prop>
</Props>
`)
    let next = applyPatches(source, [declare('prop', 'label', { type: 'string' }, 'Words.')]).source
    expect(next).toContain(
      '  <Prop name="checked" type="boolean" default={false} visual>On.</Prop>\n  <Prop name="label" type="string">Words.</Prop>\n</Props>',
    )
    next = applyPatches(next, [
      declare('event', 'change', { detail: '{ checked: boolean }' }, 'Fires.'),
    ]).source
    expect(next).toContain(
      '</Props>\n\n<Events>\n  <Event name="change" detail="{ checked: boolean }">Fires.</Event>\n</Events>',
    )
    next = applyPatches(next, [
      declare('prop', 'label', { type: 'string', sample: 'Hi' }, 'The words shown.'),
    ]).source
    expect(next).toContain('<Prop name="label" type="string" sample="Hi">The words shown.</Prop>')
    expect(next.split('<Prop name="label"')).toHaveLength(2)
  })

  it('removes a declaration, and the list with its last one', () => {
    const source = page(`
## Contract

<Props>
  <Prop name="checked" type="boolean" default={false} visual>On.</Prop>
  <Prop name="label" type="string">Words.</Prop>
</Props>
<Slots>
  <Slot name="control">The control.</Slot>
</Slots>
`)
    const fewer = applyPatches(source, [remove('prop', 'label')]).source
    expect(fewer).toContain(
      '<Props>\n  <Prop name="checked" type="boolean" default={false} visual>On.</Prop>\n</Props>',
    )
    const noSlots = applyPatches(fewer, [remove('slot', 'control')]).source
    expect(noSlots).not.toContain('<Slots>')
    expect(noSlots).toContain('</Props>\n')
    expect(parseOrThrow(noSlots).spec!.contract!.slots).toEqual([])
    expect(() => applyPatches(noSlots, [remove('slot', 'control')])).toThrow(/not declared/)
    // The last declaration of the whole region takes the heading with it.
    const none = applyPatches(noSlots, [remove('prop', 'checked')]).source
    expect(none).not.toContain('## Contract')
    expect(none).toBe(page())
    expect(parseOrThrow(none).spec?.contract).toBeUndefined()
  })

  it('inverts to the previous declaration, or to a removal', () => {
    const source = page(`
## Contract

<Props>
  <Prop name="checked" type="boolean" default={false} visual>On.</Prop>
</Props>
`)
    const doc = parseOrThrow(source)
    const change = declare('prop', 'checked', { type: 'boolean' }, 'Changed.')
    expect(inversePatches(doc, [change])).toEqual([
      declare('prop', 'checked', { type: 'boolean', default: false, visual: true }, 'On.'),
    ])
    const add = declare('prop', 'label', { type: 'string' }, 'Words.')
    expect(inversePatches(doc, [add])).toEqual([remove('prop', 'label')])
    const back = applyPatches(applyPatches(source, [add]).source, inversePatches(doc, [add])).source
    expect(back).toBe(source)
  })
})
