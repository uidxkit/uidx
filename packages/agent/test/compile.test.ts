import { parse, type UidxDocument } from '@uidx/format'
import { asSchema } from 'ai'
import { describe, expect, it } from 'vitest'

import { compileOps } from '../src/edit/compile.js'
import { editOpsSchema, foldAttrs, narrowOps, type EditOpInput } from '../src/edit/ops.js'

const HOME = `---
id: home
---

## Visual Contract

<Page>
  <Frame name="hero" width={600} height={200}>
    <Text name="headline" characters="Welcome" fontSize={32} />
  </Frame>
</Page>
`

const doc = (): UidxDocument => {
  const result = parse(HOME)
  if (!result.doc) throw new Error('fixture does not parse')
  return result.doc
}

describe('editOpsSchema', () => {
  it('accepts a well-formed batch', () => {
    const parsed = editOpsSchema.safeParse([
      { kind: 'set_prop', address: 'hero', prop: 'width', value: 800 },
    ])
    expect(parsed.success).toBe(true)
  })

  it('rejects an unknown op rather than guessing what was meant', () => {
    expect(editOpsSchema.safeParse([{ kind: 'nudge', address: 'hero' }]).success).toBe(false)
  })

  // `element` carries the vocabulary as an enum, so an invented tag is caught
  // where the model can see the alternatives rather than after the fact.
  it('rejects a node whose element is not one the parser knows', () => {
    const op = { kind: 'insert_node', parent: '', node: { element: 'Div' } }
    expect(editOpsSchema.safeParse([op]).success).toBe(false)
    expect(editOpsSchema.safeParse([{ ...op, node: { element: 'Text' } }]).success).toBe(true)
  })

  it('offers every insertable element and no page or token element', () => {
    // `node` is recursive (a node may hold children), so zod emits it as a
    // `$ref` into `definitions` rather than inline. Resolve it the way a
    // reader has to.
    const schema = asSchema(editOpsSchema).jsonSchema as {
      items?: { properties?: { node?: { allOf?: { $ref?: string }[] } } }
      definitions?: Record<string, { properties?: { element?: { enum?: string[] } } }>
    }
    const ref = schema.items?.properties?.node?.allOf?.[0]?.$ref ?? ''
    const definition = schema.definitions?.[ref.replace('#/definitions/', '')]
    expect(definition?.properties?.element?.enum).toEqual([
      'Component',
      'Frame',
      'Text',
      'Rectangle',
      'Ellipse',
      'Vector',
      'Instance',
      'Variant',
      'Slot',
    ])
  })

  // The schema is flat on purpose (a small model cannot read a top-level
  // `oneOf`), so "this kind needs that field" is no longer something zod can
  // answer. It parses, and `narrowOps` is what refuses it.
  it('accepts an op that names no address, leaving the field check to narrowOps', () => {
    expect(editOpsSchema.safeParse([{ kind: 'remove_node' }]).success).toBe(true)
  })
})

describe('narrowOps', () => {
  it('hands the strict op through when every field its kind needs is there', () => {
    const result = narrowOps([{ kind: 'set_prop', address: 'hero', prop: 'width', value: 800 }])
    expect(result).toEqual({
      ok: true,
      value: [{ kind: 'set_prop', address: 'hero', prop: 'width', value: 800 }],
    })
  })

  it('drops a field that belongs to another kind rather than passing it downstream', () => {
    const result = narrowOps([
      { kind: 'remove_node', address: 'hero', prop: 'width', name: 'nope' } as EditOpInput,
    ])
    expect(result).toEqual({ ok: true, value: [{ kind: 'remove_node', address: 'hero' }] })
  })

  it('omits an absent optional index instead of writing undefined into the op', () => {
    const result = narrowOps([{ kind: 'insert_node', parent: '', node: { element: 'Frame' } }])
    expect(result.ok && Object.hasOwn(result.value[0]!, 'index')).toBe(false)
  })

  // The whole point of narrowing here rather than in zod: the model has to be
  // told which op, which kind, and which field, or it cannot get closer.
  it('names the op, the kind and the missing fields', () => {
    expect(
      narrowOps([
        { kind: 'set_prop', address: 'hero', prop: 'width', value: 800 },
        { kind: 'move_node', address: 'hero' },
      ]),
    ).toEqual({ ok: false, message: 'op 2 (move_node) needs address, newParent and index' })
  })

  // The other thing observed on the wire: filling a page it had just created,
  // the model tried "/", then "@doc", then "@page", and never once wrote "" —
  // eighteen steps to land one Frame.
  it.each(['/', 'page', 'root', '@page', '@root', ' / ', 'ROOT'])(
    'takes %o as the page root for insert_node',
    (alias) => {
      const result = narrowOps([{ kind: 'insert_node', parent: alias, node: { element: 'Frame' } }])
      expect(result.ok && result.value[0]).toEqual({
        kind: 'insert_node',
        parent: '',
        node: { element: 'Frame' },
      })
    },
  )

  it('takes the same aliases for move_node, which also names a parent', () => {
    const result = narrowOps([{ kind: 'move_node', address: 'hero', newParent: '/', index: 0 }])
    expect(result.ok && result.value[0]).toEqual({
      kind: 'move_node',
      address: 'hero',
      newParent: '',
      index: 0,
    })
  })

  it('leaves a real address alone, so an alias never shadows a node', () => {
    const result = narrowOps([{ kind: 'insert_node', parent: 'hero', node: { element: 'Text' } }])
    expect(result.ok && result.value[0]).toMatchObject({ parent: 'hero' })
  })

  // `address` is deliberately not normalised: inserting into the page root is
  // a fair thing to reach by a near-miss, removing or renaming it is not.
  it('does not turn an aliased address into the page root', () => {
    const result = narrowOps([{ kind: 'remove_node', address: '/' }])
    expect(result.ok && result.value[0]).toEqual({ kind: 'remove_node', address: '/' })
  })

  // The mistake actually observed on the wire, and the one the bare "needs
  // parent and node" does not close: five of six kinds take `address`, so the
  // sixth gets `address` too.
  it('names the swap when insert_node was given an address', () => {
    expect(
      narrowOps([{ kind: 'insert_node', address: 'card', node: { element: 'Text' } }]),
    ).toEqual({
      ok: false,
      message: 'op 1 (insert_node) needs parent and node — it takes parent, not address',
    })
  })

  it('leaves the swap unsaid when parent was supplied and something else is missing', () => {
    const result = narrowOps([{ kind: 'insert_node', parent: '', address: 'card' }])
    expect(result).toEqual({ ok: false, message: 'op 1 (insert_node) needs parent and node' })
  })

  it.each([
    [{ kind: 'set_prop', address: 'hero', prop: 'width' }, 'address, prop and value'],
    [{ kind: 'remove_prop', address: 'hero' }, 'address and prop'],
    [{ kind: 'insert_node', parent: '' }, 'parent and node'],
    [{ kind: 'remove_node' }, 'address'],
    [{ kind: 'rename', address: 'hero' }, 'address and name'],
  ] as [EditOpInput, string][])('refuses %o for want of %s', (op, fields) => {
    const result = narrowOps([op])
    expect(result).toEqual({ ok: false, message: `op 1 (${op.kind}) needs ${fields}` })
  })
})

describe('foldAttrs', () => {
  it('gathers props written beside the tag, the way the markup writes them', () => {
    expect(
      foldAttrs({ element: 'Text', name: 'title', characters: 'Hello', fontSize: 16 }),
    ).toEqual({ element: 'Text', name: 'title', attrs: { characters: 'Hello', fontSize: 16 } })
  })

  it('still takes an explicit attrs, and lets it win a collision', () => {
    expect(
      foldAttrs({ element: 'Text', characters: 'beside', attrs: { characters: 'explicit' } }),
    ).toEqual({ element: 'Text', attrs: { characters: 'explicit' } })
  })

  it('leaves attrs off entirely when the node carries no props', () => {
    expect(foldAttrs({ element: 'Frame', name: 'card' })).toEqual({
      element: 'Frame',
      name: 'card',
    })
  })

  it('folds every level, not just the top one', () => {
    expect(
      foldAttrs({
        element: 'Frame',
        layoutMode: 'VERTICAL',
        children: [{ element: 'Text', characters: 'Hello' }],
      }),
    ).toEqual({
      element: 'Frame',
      attrs: { layoutMode: 'VERTICAL' },
      children: [{ element: 'Text', attrs: { characters: 'Hello' } }],
    })
  })
})

describe('compileOps', () => {
  it('turns set_prop into a set patch when the property is already there', () => {
    expect(
      compileOps(doc(), [{ kind: 'set_prop', address: 'hero', prop: 'width', value: 800 }]),
    ).toEqual([{ op: 'set', address: 'hero', prop: 'width', value: 800 }])
  })

  it('turns set_prop into an add patch when the property is new', () => {
    expect(
      compileOps(doc(), [{ kind: 'set_prop', address: 'hero', prop: 'opacity', value: 0.5 }]),
    ).toEqual([{ op: 'add', address: 'hero', prop: 'opacity', value: 0.5 }])
  })

  it('compiles a rename into a set of the name property', () => {
    expect(compileOps(doc(), [{ kind: 'rename', address: 'hero', name: 'banner' }])).toEqual([
      { op: 'set', address: 'hero', prop: 'name', value: 'banner' },
    ])
  })

  it('names an inserted node automatically when the model did not', () => {
    const patches = compileOps(doc(), [
      { kind: 'insert_node', parent: 'hero', node: { element: 'Rectangle' } },
    ])
    expect(patches[0]).toMatchObject({ op: 'insert-node', parent: 'hero', index: 1 })
    const spec = (patches[0] as { node: { attrs: Record<string, unknown> } }).node
    expect(spec.attrs.name).toBe('rectangle-1')
  })

  it('appends an inserted node when no index is given', () => {
    const patches = compileOps(doc(), [
      { kind: 'insert_node', parent: 'hero', node: { element: 'Text', name: 'sub' } },
    ])
    expect(patches[0]).toMatchObject({ index: 1 })
  })

  it('carries nested children into the node spec', () => {
    const patches = compileOps(doc(), [
      {
        kind: 'insert_node',
        parent: '',
        node: {
          element: 'Frame',
          name: 'footer',
          attrs: { width: 600 },
          children: [{ element: 'Text', name: 'legal', attrs: { characters: '©' } }],
        },
      },
    ])
    expect(patches[0]).toMatchObject({
      op: 'insert-node',
      parent: '',
      node: {
        element: 'Frame',
        attrs: { name: 'footer', width: 600 },
        children: [{ element: 'Text', attrs: { name: 'legal', characters: '©' } }],
      },
    })
  })

  it('gives distinct auto-names to multiple unnamed nested children', () => {
    const patches = compileOps(doc(), [
      {
        kind: 'insert_node',
        parent: '',
        node: {
          element: 'Frame',
          name: 'footer',
          children: [{ element: 'Rectangle' }, { element: 'Rectangle' }],
        },
      },
    ])
    const spec = (patches[0] as { node: { children: { attrs: Record<string, unknown> }[] } }).node
    const names = spec.children.map((c) => c.attrs.name)
    expect(names).toEqual(['rectangle-1', 'rectangle-2'])
  })

  it('refuses an op whose address is not in the document', () => {
    expect(() =>
      compileOps(doc(), [{ kind: 'set_prop', address: 'ghost', prop: 'width', value: 1 }]),
    ).toThrow(/ghost/)
  })

  it('refuses an element the format does not know', () => {
    expect(() =>
      compileOps(doc(), [{ kind: 'insert_node', parent: 'hero', node: { element: 'Widget' } }]),
    ).toThrow(/Widget/)
  })
})

describe('compileOps refusals', () => {
  // The measured failure: twelve of twelve refusals in one authoring run were
  // "no node at address", each naming only the string that failed.
  it('names what the nearest existing node holds', () => {
    expect(() => compileOps(doc(), [{ kind: 'remove_node', address: 'hero#missing' }])).toThrow(
      'no node at address "hero#missing" — hero holds hero#headline',
    )
  })
})

/**
 * A `<Variant>` is named by the axis values it assigns and must carry no
 * `name` (UIDX118) — but `toSpec` auto-named every node it built, so the
 * compiler added the name the validator then rejected. The element was
 * impossible to insert, and every attempt to build a component with variants
 * — the centre of any design-system page — failed with an error about markup
 * the model never wrote.
 */
describe('variants are named by their coordinates', () => {
  const insertVariant = (node: Record<string, unknown>) =>
    narrowOps([{ kind: 'insert_node', parent: '', node } as never])

  it('builds a Variant with no name at all', () => {
    const result = insertVariant({ element: 'Variant', checked: 'off', size: 'md' })
    expect(result.ok).toBe(true)
    const patches = compileOps(doc(), result.ok ? result.value : [])
    const spec = (patches[0] as { node: { attrs: Record<string, unknown> } }).node
    expect(spec.attrs).toEqual({ checked: 'off', size: 'md' })
    expect(spec.attrs.name).toBeUndefined()
  })

  it('still auto-names everything else', () => {
    const result = narrowOps([{ kind: 'insert_node', parent: '', node: { element: 'Frame' } }])
    const patches = compileOps(doc(), result.ok ? result.value : [])
    const spec = (patches[0] as { node: { attrs: Record<string, unknown> } }).node
    expect(typeof spec.attrs.name).toBe('string')
  })

  it('says why when a name is passed to one anyway', () => {
    const result = insertVariant({ element: 'Variant', name: 'off-md', checked: 'off' })
    expect(() => compileOps(doc(), result.ok ? result.value : [])).toThrow(
      /named by the axis values it assigns/,
    )
  })

  // A component declaring variants must arrive holding them (UIDX121), so the
  // whole tree lands in one insert — which is only possible if the variants
  // inside it are unnamed.
  it('builds a whole component with its variants in one op', () => {
    const result = narrowOps([
      {
        kind: 'insert_node',
        parent: '',
        node: {
          element: 'Component',
          name: 'Control/Switch',
          variants: { checked: ['off', 'on'] },
          children: [
            { element: 'Variant', checked: 'off', children: [{ element: 'Frame', name: 'row' }] },
            { element: 'Variant', checked: 'on', children: [{ element: 'Frame', name: 'row' }] },
          ],
        },
      } as never,
    ])
    expect(result.ok).toBe(true)
    expect(() => compileOps(doc(), result.ok ? result.value : [])).not.toThrow()
  })
})
