import { describe, expect, it } from 'vitest'
import { applyPatches, inversePatches, parseOrThrow, type UidxPatch } from '../src/index.js'

/**
 * Editing models from the inspector writes canonical `<Model>` elements into
 * `## Models` (ADR 0015 §1). What these pin: a model is reprinted whole, a
 * new one goes after the last, the region is created before `## Examples`
 * or at the end, a removal that empties the region removes it, and every op
 * inverts — a removed model coming back with its fields.
 */
const page = (regions = '') => `---
id: list
---

## Visual Contract

<Page>
  <Component name="List" status="draft" width={20} height={20} />
</Page>
${regions}`

const model = (name: string, description: string) =>
  ({ op: 'model', name, declaration: { description } }) as UidxPatch
const field = (model: string, name: string, attrs: Record<string, unknown>, description: string) =>
  ({ op: 'field', model, name, declaration: { attrs, description } }) as UidxPatch

const CONTACT = `
## Models

<Model name="Contact">
  One person.
  <Field name="id" type="string" key sample={['a', 'b']}>Identity.</Field>
  <Field name="email" type="string" optional>Omitted when unknown.</Field>
</Model>
`

describe('the model and field ops', () => {
  it('creates the region for the first model, before the examples or at the end', () => {
    const atEnd = applyPatches(
      page(
        '\n## Contract\n\n<Props>\n  <Prop name="items" type="Contact[]">Rows.</Prop>\n</Props>\n',
      ),
      [model('Contact', 'One person.')],
    ).source
    expect(atEnd).toContain(
      '</Props>\n\n## Models\n\n<Model name="Contact">\n  One person.\n</Model>\n',
    )
    expect(parseOrThrow(atEnd).spec!.models!.map((m) => [m.name, m.description])).toEqual([
      ['Contact', 'One person.'],
    ])
    const before = applyPatches(
      page(
        '\n## Examples\n\n<Example name="one">\n  <Set slot="option" count={1} />\n</Example>\n',
      ),
      [model('Contact', 'One person.')],
    ).source
    expect(before).toContain(
      '## Models\n\n<Model name="Contact">\n  One person.\n</Model>\n\n## Examples',
    )
  })

  it('adds a field, rewrites one in place, and prints flags bare and samples as lists', () => {
    let next = applyPatches(page(CONTACT), [
      field('Contact', 'name', { type: 'string', sample: ['Ada', 'Grace'] }, 'Display name.'),
    ]).source
    expect(next).toContain(
      `<Model name="Contact">\n  One person.\n  <Field name="id" type="string" key sample={['a', 'b']}>Identity.</Field>\n  <Field name="email" type="string" optional>Omitted when unknown.</Field>\n  <Field name="name" type="string" sample={['Ada', 'Grace']}>Display name.</Field>\n</Model>`,
    )
    next = applyPatches(next, [
      field('Contact', 'email', { type: 'string' }, 'Always known.'),
    ]).source
    expect(next).toContain('<Field name="email" type="string">Always known.</Field>')
    expect(next.split('<Field name="email"')).toHaveLength(2)
    // A second model goes after the first; the words of a model change alone.
    next = applyPatches(next, [model('Tag', 'A label.'), model('Contact', 'One row.')]).source
    expect(next).toContain('</Model>\n\n<Model name="Tag">\n  A label.\n</Model>\n')
    expect(next).toContain('<Model name="Contact">\n  One row.\n  <Field name="id"')
    expect(parseOrThrow(next).spec!.models!.map((m) => m.name)).toEqual(['Contact', 'Tag'])
  })

  it('removes a field, a model, and the region with the last model', () => {
    const fewer = applyPatches(page(CONTACT), [
      { op: 'field', model: 'Contact', name: 'email' },
    ]).source
    expect(fewer).not.toContain('email')
    expect(parseOrThrow(fewer).spec!.models![0]!.fields.map((f) => f.name)).toEqual(['id'])
    const two = applyPatches(fewer, [model('Tag', 'A label.')]).source
    const one = applyPatches(two, [{ op: 'model', name: 'Contact' }]).source
    expect(one).toContain('## Models\n\n<Model name="Tag">')
    expect(one).not.toContain('Contact')
    const none = applyPatches(one, [{ op: 'model', name: 'Tag' }]).source
    expect(none).not.toContain('## Models')
    expect(parseOrThrow(none).spec?.models).toBeUndefined()
    expect(() => applyPatches(none, [{ op: 'model', name: 'Tag' }])).toThrow(/not declared/)
    expect(() => applyPatches(page(CONTACT), [{ op: 'field', model: 'Nope', name: 'x' }])).toThrow(
      /not declared/,
    )
  })

  it('inverts every op, bringing a removed model back with its fields', () => {
    const source = page(CONTACT)
    const doc = parseOrThrow(source)
    const words = model('Contact', 'One row.')
    expect(inversePatches(doc, [words])).toEqual([model('Contact', 'One person.')])
    const change = field('Contact', 'email', { type: 'string' }, 'Always known.')
    expect(inversePatches(doc, [change])).toEqual([
      field('Contact', 'email', { type: 'string', optional: true }, 'Omitted when unknown.'),
    ])
    const add = field('Contact', 'name', { type: 'string' }, 'Name.')
    expect(inversePatches(doc, [add])).toEqual([{ op: 'field', model: 'Contact', name: 'name' }])
    const removal: UidxPatch = { op: 'model', name: 'Contact' }
    expect(inversePatches(doc, [removal])).toEqual([
      model('Contact', 'One person.'),
      field('Contact', 'id', { type: 'string', key: true, sample: ['a', 'b'] }, 'Identity.'),
      field('Contact', 'email', { type: 'string', optional: true }, 'Omitted when unknown.'),
    ])
    for (const patch of [words, change, add, removal]) {
      const forward = applyPatches(source, [patch]).source
      expect(applyPatches(forward, inversePatches(doc, [patch])).source).toBe(source)
    }
  })
})
