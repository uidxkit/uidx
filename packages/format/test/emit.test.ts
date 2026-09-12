import { describe, expect, it } from 'vitest'
import {
  applyPatch,
  emitDocument,
  emitTree,
  parseOrThrow,
  parseExpression,
  resolve,
  serializeValue,
  toSpec,
} from '../src/index.js'
import { BUTTON, MINIMAL } from './fixtures.js'

describe('value round-tripping', () => {
  const values = [
    0,
    16,
    -4,
    0.5,
    true,
    false,
    null,
    'plain',
    'with spaces',
    [1, 2, 3],
    { a: 1, b: 'two', c: [true, null] },
    [{ type: 'SOLID', color: { r: 0.1, g: 0.4, b: 0.9, a: 1 } }],
    { 'not-an-identifier': 1 },
  ] as const

  for (const value of values) {
    it(`survives serialize -> parse: ${JSON.stringify(value)}`, () => {
      const text = serializeValue(value as never)
      const inner = text.startsWith('{') ? text.slice(1, -1) : text.slice(1, -1)
      expect(parseExpression(text.startsWith('{') ? inner : `'${inner}'`)).toEqual(value)
    })
  }

  it('writes strings as JSX attributes and escapes awkward ones', () => {
    expect(serializeValue('label')).toBe('"label"')
    expect(serializeValue('say "hi"')).toBe('{\'say "hi"\'}')
    expect(serializeValue('two\nlines')).toBe("{'two\\nlines'}")
  })

  it('never emits a trailing .0 for integral numbers', () => {
    expect(serializeValue(16)).toBe('{16}')
    expect(serializeValue(16.0)).toBe('{16}')
  })
})

describe('emit', () => {
  it('inlines a single attribute and self-closes childless elements', () => {
    expect(emitTree({ element: 'Ellipse', attrs: { name: 'dot' } })).toBe('<Ellipse name="dot" />')
  })

  it('puts each attribute on its own line beyond one', () => {
    expect(emitTree({ element: 'Text', attrs: { name: 'a', fontSize: 12 } })).toBe(
      '<Text\n  name="a"\n  fontSize={12}\n/>',
    )
  })

  it('always writes name first', () => {
    const out = emitTree({ element: 'Text', attrs: { fontSize: 12, name: 'a' } })
    expect(out.indexOf('name=')).toBeLessThan(out.indexOf('fontSize='))
  })

  it('nests children at the given indent', () => {
    expect(
      emitTree(
        {
          element: 'Frame',
          attrs: { name: 'row' },
          children: [{ element: 'Text', attrs: { name: 't' } }],
        },
        '  ',
      ),
    ).toBe('  <Frame name="row">\n    <Text name="t" />\n  </Frame>')
  })

  it('produces a document that re-parses to the same tree', () => {
    const original = parseOrThrow(BUTTON)
    const formatted = emitDocument(original)
    const reparsed = parseOrThrow(formatted)

    const shape = (n: ReturnType<typeof parseOrThrow>['tree']): unknown => ({
      element: n.element,
      address: n.address,
      attrs: Object.fromEntries(Object.entries(n.attrs).map(([k, a]) => [k, a.value])),
      children: n.children.map(shape),
    })
    expect(shape(reparsed.tree)).toEqual(shape(original.tree))
    expect(reparsed.frontmatter).toEqual(original.frontmatter)
  })

  it('preserves unknown and structured frontmatter keys (§3.2)', () => {
    const source = BUTTON.replace(
      'id: primary-button',
      'id: primary-button\ntags: [cta, form]\nowner:\n  team: design\n  slack: "#ds"',
    )
    const formatted = emitDocument(parseOrThrow(source))
    const reparsed = parseOrThrow(formatted)
    expect(reparsed.frontmatter).toEqual({
      id: 'primary-button',
      tags: ['cta', 'form'],
      owner: { team: 'design', slack: '#ds' },
    })
  })

  it('is idempotent — fmt of fmt changes nothing', () => {
    const once = emitDocument(parseOrThrow(BUTTON))
    const twice = emitDocument(parseOrThrow(once))
    expect(twice).toBe(once)
  })

  it('inserts nodes in the same style fmt would produce (spec §9.5)', () => {
    const spec = { element: 'Rectangle' as const, attrs: { name: 'divider', width: 1 } }
    const { source } = applyPatch(MINIMAL, {
      op: 'insert-node',
      parent: 'minimal#root',
      index: 0,
      node: spec,
    })
    const inserted = resolve(parseOrThrow(source).tree, 'minimal#root/divider')!
    expect(source.slice(inserted.loc.start, inserted.loc.end)).toBe(
      emitTree(toSpec(inserted), '      ').trimStart(),
    )
  })
})
