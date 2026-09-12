import { describe, expect, it } from 'vitest'
import {
  aliasTarget,
  CODES,
  emitDocument,
  isAlias,
  parse,
  parseOrThrow,
  resolve,
  toAlias,
  variableTypeOf,
} from '../src/index.js'

const tokens = (body: string, frontmatter = 'id: t') =>
  `---\n${frontmatter}\n---\n\n## Visual Contract\n\n${body}\n`

const CORE = tokens(`<Tokens>
  <Collection name="radius">
    <Variable name="md" type="FLOAT" value={8} />
  </Collection>
  <Collection name="palette">
    <Variable name="blue" type="COLOR" value={{ r: 0.1, g: 0.4, b: 0.9, a: 1 }} />
  </Collection>
  <Collection name="semantic">
    <Variable name="brand" type="COLOR" value="{palette#blue}" />
  </Collection>
</Tokens>`)

describe('token files (G5)', () => {
  it('parses a <Tokens> root', () => {
    const { doc, diagnostics } = parse(CORE)
    expect(diagnostics).toEqual([])
    expect(doc!.tree.element).toBe('Tokens')
    expect(doc!.tree.children.map((c) => c.name)).toEqual(['radius', 'palette', 'semantic'])
  })

  it('addresses a variable by the same law as a node', () => {
    const doc = parseOrThrow(CORE)
    // `collection#variable` — ADR 0004 §3's separator, one tree over.
    expect(resolve(doc.tree, 'radius#md')!.element).toBe('Variable')
    expect(resolve(doc.tree, 'radius#md')!.attrs.value!.value).toBe(8)
    expect(resolve(doc.tree, 'radius#nope')).toBeNull()
  })

  it('keeps the two trees from mixing', () => {
    const codes = (source: string) => parse(source).diagnostics.map((d) => d.code)
    expect(codes(tokens('<Tokens>\n  <Frame name="a" />\n</Tokens>'))).toContain(
      CODES.ELEMENT_NOT_ALLOWED_HERE,
    )
    expect(
      codes(
        tokens(
          '<Tokens>\n  <Collection name="c">\n    <Frame name="a" />\n  </Collection>\n</Tokens>',
        ),
      ),
    ).toContain(CODES.ELEMENT_NOT_ALLOWED_HERE)
    expect(codes(tokens('<Page>\n  <Collection name="c" />\n</Page>'))).toContain(
      CODES.ELEMENT_NOT_ALLOWED_HERE,
    )
  })

  it('requires a value, and rejects one it cannot type', () => {
    const codes = (source: string) => parse(source).diagnostics.map((d) => d.code)
    expect(
      codes(
        tokens(
          '<Tokens>\n  <Collection name="c">\n    <Variable name="v" />\n  </Collection>\n</Tokens>',
        ),
      ),
    ).toContain(CODES.MISSING_VARIABLE_VALUE)
    expect(
      codes(
        tokens(
          '<Tokens>\n  <Collection name="c">\n    <Variable name="v" value={[1, 2]} />\n  </Collection>\n</Tokens>',
        ),
      ),
    ).toContain(CODES.BAD_VARIABLE_VALUE)
  })

  it('infers the Figma variable type from the value (ADR 0002)', () => {
    expect(variableTypeOf(8)).toBe('FLOAT')
    expect(variableTypeOf('Inter')).toBe('STRING')
    expect(variableTypeOf(true)).toBe('BOOLEAN')
    expect(variableTypeOf({ r: 1, g: 1, b: 1, a: 1 })).toBe('COLOR')
    // An alias has no type of its own; it takes its target's.
    expect(variableTypeOf('{palette#blue}')).toBeNull()
    expect(variableTypeOf([1, 2])).toBeNull()
  })
})

describe('aliases', () => {
  it('recognises the braced form and nothing else', () => {
    expect(isAlias('{radius#md}')).toBe(true)
    expect(isAlias('{ radius#md }')).toBe(true)
    expect(isAlias('radius#md')).toBe(false)
    expect(isAlias('{}')).toBe(false)
    expect(isAlias('{ }')).toBe(false)
    expect(isAlias(8)).toBe(false)
  })

  it('extracts the target, trimmed', () => {
    expect(aliasTarget('{ radius#md }')).toBe('radius#md')
    expect(aliasTarget('{Button/Primary#container}')).toBe('Button/Primary#container')
    expect(aliasTarget('plain')).toBeNull()
    expect(aliasTarget(8)).toBeNull()
  })

  it('round-trips through the authored spelling', () => {
    expect(aliasTarget(toAlias('radius#md'))).toBe('radius#md')
  })

  it('is legal wherever a value is, including a number-typed prop', () => {
    const { doc, diagnostics } = parse(
      tokens(`<Page>
  <Component name="C" status="draft">
    <Frame name="root" cornerRadius="{radius#md}" />
  </Component>
</Page>`),
    )
    expect(diagnostics).toEqual([])
    expect(resolve(doc!.tree, 'C#root')!.attrs.cornerRadius!.value).toBe('{radius#md}')
  })
})

describe('explicit variable types (G8)', () => {
  const one = (attrs: string) =>
    tokens(`<Tokens>
  <Collection name="c">
    <Variable name="v" ${attrs} />
  </Collection>
</Tokens>`)

  it('requires a type attribute', () => {
    const codes = parse(one('value={8}')).diagnostics.map((d) => d.code)
    expect(codes).toContain(CODES.MISSING_VARIABLE_TYPE)
  })

  it('accepts a matching type', () => {
    expect(parse(one('type="FLOAT" value={8}')).diagnostics).toEqual([])
  })

  it('rejects a type the value contradicts', () => {
    const codes = parse(one('type="COLOR" value={8}')).diagnostics.map((d) => d.code)
    expect(codes).toContain(CODES.VARIABLE_TYPE_MISMATCH)
  })

  it('rejects an unknown type name', () => {
    const codes = parse(one('type="DIMENSION" value={8}')).diagnostics.map((d) => d.code)
    expect(codes).toContain(CODES.VARIABLE_TYPE_MISMATCH)
  })

  it('lets an alias declare any type, since it takes its target’s', () => {
    expect(parse(one('type="COLOR" value="{palette#blue}"')).diagnostics).toEqual([])
  })
})

describe('modes (G8)', () => {
  const MODED = tokens(`<Tokens>
  <Collection name="semantic" modes={['light', 'dark']}>
    <Variable name="surface" type="COLOR">
      <Mode name="light" value={{ r: 1, g: 1, b: 1, a: 1 }} />
      <Mode name="dark" value={{ r: 0, g: 0, b: 0, a: 1 }} />
    </Variable>
  </Collection>
</Tokens>`)

  const codes = (source: string) => parse(source).diagnostics.map((d) => d.code)

  it('parses <Mode> children', () => {
    const { doc, diagnostics } = parse(MODED)
    expect(diagnostics).toEqual([])
    const v = resolve(doc!.tree, 'semantic#surface')!
    expect(v.children.map((m) => m.element)).toEqual(['Mode', 'Mode'])
  })

  // The collision this guards: addressOf joins with `/` once an address holds
  // `#`, so an addressed Mode would be `semantic#surface/light` — identical to
  // the address a variable named `surface/light` already owns.
  it('gives a <Mode> no address of its own', () => {
    const doc = parseOrThrow(MODED)
    const v = resolve(doc.tree, 'semantic#surface')!
    expect(v.children.map((m) => m.address)).toEqual(['', ''])
    expect(resolve(doc.tree, 'semantic#surface/light')).toBeNull()
  })

  it('rejects <Mode> children in a collection with no modes', () => {
    expect(
      codes(
        tokens(`<Tokens>
  <Collection name="c">
    <Variable name="v" type="FLOAT"><Mode name="light" value={8} /></Variable>
  </Collection>
</Tokens>`),
      ),
    ).toContain(CODES.MODE_SHAPE)
  })

  it('rejects a bare value in a moded collection', () => {
    expect(
      codes(
        tokens(`<Tokens>
  <Collection name="c" modes={['light']}>
    <Variable name="v" type="FLOAT" value={8} />
  </Collection>
</Tokens>`),
      ),
    ).toContain(CODES.MODE_SHAPE)
  })

  it('rejects a <Mode> name the collection never declared', () => {
    expect(
      codes(
        tokens(`<Tokens>
  <Collection name="c" modes={['light']}>
    <Variable name="v" type="FLOAT"><Mode name="dusk" value={8} /></Variable>
  </Collection>
</Tokens>`),
      ),
    ).toContain(CODES.UNKNOWN_MODE)
  })

  it('rejects a variable that misses a declared mode', () => {
    expect(
      codes(
        tokens(`<Tokens>
  <Collection name="c" modes={['light', 'dark']}>
    <Variable name="v" type="FLOAT"><Mode name="light" value={8} /></Variable>
  </Collection>
</Tokens>`),
      ),
    ).toContain(CODES.MISSING_MODE)
  })

  it('rejects duplicate mode names on a collection', () => {
    expect(
      codes(
        tokens(`<Tokens>
  <Collection name="c" modes={['light', 'light']}>
    <Variable name="v" type="FLOAT"><Mode name="light" value={8} /></Variable>
  </Collection>
</Tokens>`),
      ),
    ).toContain(CODES.BAD_COLLECTION_MODES)
  })

  it('round-trips through emit, children and all', () => {
    const doc = parseOrThrow(MODED)
    const printed = emitDocument(doc)
    // The emitter breaks a multi-attribute tag over lines, so this asserts the
    // attributes survive rather than any particular line shape.
    expect(printed).toContain("modes={['light', 'dark']}")
    expect(printed).toContain('<Mode')
    // Re-parsing the printed form yields the same two columns, which is the
    // property `uidx fmt` depends on.
    const again = parseOrThrow(printed)
    expect(resolve(again.tree, 'semantic#surface')!.children.map((m) => m.name)).toEqual([
      'light',
      'dark',
    ])
  })

  it('type-checks each mode value', () => {
    expect(
      codes(
        tokens(`<Tokens>
  <Collection name="c" modes={['light']}>
    <Variable name="v" type="COLOR"><Mode name="light" value={8} /></Variable>
  </Collection>
</Tokens>`),
      ),
    ).toContain(CODES.VARIABLE_TYPE_MISMATCH)
  })

  it('still requires a value on an unmoded variable', () => {
    expect(
      codes(
        tokens(`<Tokens>
  <Collection name="c"><Variable name="v" type="FLOAT" /></Collection>
</Tokens>`),
      ),
    ).toContain(CODES.MISSING_VARIABLE_VALUE)
  })
})

describe('scopes and descriptions (G8)', () => {
  const one = (attrs: string) =>
    tokens(`<Tokens>
  <Collection name="c">
    <Variable name="v" type="FLOAT" value={8} ${attrs} />
  </Collection>
</Tokens>`)

  it('accepts a known scope', () => {
    expect(parse(one(`scopes={['CORNER_RADIUS']}`)).diagnostics).toEqual([])
  })

  it('accepts SPACING, which Figma lacks', () => {
    expect(parse(one(`scopes={['SPACING']}`)).diagnostics).toEqual([])
  })

  it('rejects an unknown scope', () => {
    expect(parse(one(`scopes={['PADDING']}`)).diagnostics.map((d) => d.code)).toContain(
      CODES.BAD_SCOPE,
    )
  })

  it('rejects a non-array scopes', () => {
    expect(parse(one(`scopes="CORNER_RADIUS"`)).diagnostics.map((d) => d.code)).toContain(
      CODES.BAD_SCOPE,
    )
  })

  it('accepts a description', () => {
    expect(parse(one(`description="Card corners only."`)).diagnostics).toEqual([])
  })
})

describe('node mode selection (G8)', () => {
  const page = (attrs: string) =>
    `---\nid: p\n---\n\n## Visual Contract\n\n<Page>\n  <Frame name="f" ${attrs} />\n</Page>\n`

  it('accepts a collection-to-mode map', () => {
    expect(parse(page(`modes={{ semantic: 'dark' }}`)).diagnostics).toEqual([])
  })

  it('rejects a non-object', () => {
    expect(parse(page(`modes="dark"`)).diagnostics.map((d) => d.code)).toContain(
      CODES.BAD_NODE_MODES,
    )
  })

  it('rejects a non-string mode', () => {
    expect(parse(page(`modes={{ semantic: 3 }}`)).diagnostics.map((d) => d.code)).toContain(
      CODES.BAD_NODE_MODES,
    )
  })

  it('does not lint modes as an unknown prop', () => {
    const codes = parse(page(`modes={{ semantic: 'dark' }}`)).diagnostics.map((d) => d.code)
    expect(codes).not.toContain(CODES.UNKNOWN_PROP)
  })
})
