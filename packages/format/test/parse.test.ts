import { describe, expect, it } from 'vitest'
import {
  applyPatch,
  CODES,
  emitDocument,
  parse,
  parseOrThrow,
  relativeAddress,
  resolve,
  resolveParent,
} from '../src/index.js'
import { BUTTON, MINIMAL, SUGARED } from './fixtures.js'

const contractOf = (body: string, frontmatter = 'id: t') =>
  `---\n${frontmatter}\n---\n\n## Visual Contract\n\n${body}\n`

describe('parse', () => {
  it('parses the canonical example', () => {
    const { doc, diagnostics } = parse(BUTTON)
    expect(diagnostics).toEqual([])
    expect(doc).not.toBeNull()
    expect(doc!.frontmatter).toMatchObject({ id: 'primary-button' })
    expect(doc!.tree.children[0]!.attrs.status!.value).toBe('stable')
  })

  it('roots addresses at the Page, and bounds the entity with # (ADR 0003, 0004)', () => {
    const doc = parseOrThrow(BUTTON)
    expect(doc.tree.element).toBe('Page')
    expect(doc.tree.address).toBe('')
    expect(doc.tree.name).toBe('primary-button')

    const component = doc.tree.children[0]!
    expect(component.address).toBe('Button/Primary')
    expect(component.children[0]!.address).toBe('Button/Primary#container')
    expect(component.children[0]!.children.map((c) => c.address)).toEqual([
      'Button/Primary#container/leading-icon',
      'Button/Primary#container/label',
    ])
  })

  it('reads the entity name to the first #, so / stays a name character', () => {
    const doc = parseOrThrow(BUTTON)
    // The component's own name contains a `/`; only the `/` to the right of the
    // `#` is a path separator.
    expect(resolve(doc.tree, 'Button/Primary')!.element).toBe('Component')
    expect(resolveParent(doc.tree, 'Button/Primary#container')!.name).toBe('Button/Primary')
    expect(resolveParent(doc.tree, 'Button/Primary#container/label')!.name).toBe('container')
    expect(resolveParent(doc.tree, 'Button/Primary')).toBe(doc.tree)
  })

  it('gives an override key the substring after # (ADR 0004 §3)', () => {
    expect(relativeAddress('Button/Primary#container/label')).toBe('container/label')
    expect(relativeAddress('Button/Primary')).toBeNull()
  })

  it('accepts a bare <Component> root as a single-component page (ADR 0003 §4)', () => {
    const doc = parseOrThrow(SUGARED)
    expect(doc.tree.element).toBe('Page')
    expect(doc.tree.synthetic).toBe(true)
    expect(doc.tree.children.map((c) => c.name)).toEqual(['sugared'])
    // Addresses are page-absolute either way — there is one address law.
    expect(resolve(doc.tree, 'sugared#root/a')!.element).toBe('Text')
  })

  it('refuses to write through a synthetic page, naming the fix', () => {
    expect(() =>
      applyPatch(SUGARED, {
        op: 'insert-node',
        parent: '',
        index: 1,
        node: { element: 'Frame', attrs: { name: 'second' } },
      }),
    ).toThrow(/uidx fmt/)
  })

  it('materialises the implied <Page> on fmt', () => {
    const out = emitDocument(parseOrThrow(SUGARED))
    expect(out).toContain('<Page>')
    // Two attributes, so canonical style puts them one per line.
    expect(out).toContain('name="sugared"')
    expect(out).toContain('status="draft"')
    expect(parseOrThrow(out).tree.synthetic).toBeUndefined()
  })

  it('resolves addresses, with "" for the root', () => {
    const doc = parseOrThrow(BUTTON)
    expect(resolve(doc.tree, '')).toBe(doc.tree)
    expect(resolve(doc.tree, 'Button/Primary#container/label')!.element).toBe('Text')
    expect(resolve(doc.tree, 'Button/Primary#container/nope')).toBeNull()
  })

  it('reads every value form in the grammar', () => {
    const doc = parseOrThrow(BUTTON)
    const frame = resolve(doc.tree, 'Button/Primary#container')!
    const label = resolve(doc.tree, 'Button/Primary#container/label')!
    const icon = resolve(doc.tree, 'Button/Primary#container/leading-icon')!

    expect(frame.attrs.layoutMode!.value).toBe('HORIZONTAL')
    expect(frame.attrs.itemSpacing!.value).toBe(8)
    expect(frame.attrs.fills!.value).toEqual([
      { type: 'SOLID', color: { r: 0.1, g: 0.4, b: 0.9, a: 1 } },
    ])
    // Since F6 the canonical example binds these two to component properties
    // rather than stating them, which is itself a value form the grammar reads:
    // a reference is a string, and what it stands for is resolved later.
    expect(icon.attrs.visible!.value).toBe('{showIcon}')
    expect(label.attrs.characters!.value).toBe('{label}')
  })

  it('reads a literal boolean and a literal string, which the example no longer has', () => {
    // Kept as its own case rather than left to whichever fixture happens to
    // carry one: the canonical example is a moving target, and "every value
    // form" should not quietly lose a form when a story rewrites it.
    const doc = parseOrThrow(
      contractOf('<Page>\n  <Text name="t" characters="Hello" visible={false} />\n</Page>'),
    )
    const text = resolve(doc.tree, 't')!
    expect(text.attrs.visible!.value).toBe(false)
    expect(text.attrs.characters!.value).toBe('Hello')
  })

  it('keeps the offset invariant on every attribute', () => {
    for (const source of [BUTTON, MINIMAL]) {
      const doc = parseOrThrow(source)
      const walk = (node: typeof doc.tree): void => {
        for (const attr of Object.values(node.attrs)) {
          expect(doc.source.slice(attr.valueLoc.start, attr.valueLoc.end)).toBe(attr.raw)
          expect(doc.source.slice(attr.loc.start, attr.loc.end)).toContain(attr.name)
        }
        node.children.forEach(walk)
      }
      walk(doc.tree)
    }
  })

  it('records open-tag spans and self-closing form', () => {
    const doc = parseOrThrow(BUTTON)
    const frame = resolve(doc.tree, 'Button/Primary#container')!
    const icon = resolve(doc.tree, 'Button/Primary#container/leading-icon')!

    expect(doc.source.slice(frame.openTagLoc.start, frame.openTagLoc.end)).toMatch(
      /^<Frame[\s\S]*>$/,
    )
    expect(frame.selfClosing).toBe(false)
    expect(icon.selfClosing).toBe(true)
    expect(doc.source.slice(icon.loc.start, icon.loc.end)).toMatch(/\/>$/)
  })

  it('survives CRLF, tabs and unicode names', () => {
    const source = contractOf(
      '<Component name="t" status="draft">\r\n\t<Frame name="контейнер" cornerRadius={4}>\r\n\t\t<Text name="ラベル" characters="hi" />\r\n\t</Frame>\r\n</Component>',
    ).replace(/\n/g, '\r\n')
    const doc = parseOrThrow(source)
    const frame = resolve(doc.tree, 't#контейнер')!
    expect(frame.attrs.cornerRadius!.value).toBe(4)
    expect(resolve(doc.tree, 't#контейнер/ラベル')).not.toBeNull()
    expect(
      doc.source.slice(
        frame.attrs.cornerRadius!.valueLoc.start,
        frame.attrs.cornerRadius!.valueLoc.end,
      ),
    ).toBe('{4}')
  })

  it('allows MDX comments in the contract region', () => {
    const { doc, diagnostics } = parse(
      contractOf(
        '{/* a note */}\n\n<Component name="t" status="draft">\n  <Frame name="a" />\n</Component>',
      ),
    )
    expect(diagnostics).toEqual([])
    expect(doc).not.toBeNull()
  })
})

describe('diagnostics', () => {
  const codesFor = (source: string) => parse(source).diagnostics.map((d) => d.code)

  it('rejects unknown elements', () => {
    expect(
      codesFor(
        contractOf('<Component name="t" status="draft">\n  <Blob name="x" />\n</Component>'),
      ),
    ).toContain(CODES.UNKNOWN_ELEMENT)
  })

  it('requires a name attribute', () => {
    expect(
      codesFor(
        contractOf(
          '<Component name="t" status="draft">\n  <Frame cornerRadius={2} />\n</Component>',
        ),
      ),
    ).toContain(CODES.MISSING_NAME)
  })

  it('rejects duplicate sibling names and points at the first', () => {
    const source = contractOf(
      '<Component name="t" status="draft">\n  <Frame name="a">\n    <Text name="dup" characters="1" />\n    <Text name="dup" characters="2" />\n  </Frame>\n</Component>',
    )
    const d = parse(source).diagnostics.find((x) => x.code === CODES.DUPLICATE_SIBLING_NAME)
    expect(d).toBeDefined()
    expect(d!.message).toMatch(/duplicate sibling name "dup" \(first at \d+:\d+\)/)
  })

  it('rejects non-literal attribute values', () => {
    for (const bad of ['{someVar}', '{compute()}', '{`tpl${x}`}', '{1 + 2}']) {
      expect(
        codesFor(
          contractOf(
            `<Component name="t" status="draft">\n  <Frame name="a" x=${bad} />\n</Component>`,
          ),
        ),
      ).toContain(CODES.BAD_VALUE)
    }
  })

  it('rejects shorthand and spread attributes', () => {
    expect(
      codesFor(
        contractOf(
          '<Component name="t" status="draft">\n  <Frame name="a" visible />\n</Component>',
        ),
      ),
    ).toContain(CODES.SHORTHAND_ATTR)
    expect(
      codesFor(
        contractOf(
          '<Component name="t" status="draft">\n  <Frame name="a" {...rest} />\n</Component>',
        ),
      ),
    ).toContain(CODES.SPREAD_ATTR)
  })

  it('rejects children on leaf elements', () => {
    expect(
      codesFor(
        contractOf(
          '<Component name="t" status="draft">\n  <Text name="a">hello</Text>\n</Component>',
        ),
      ),
    ).toContain(CODES.CHILDREN_NOT_ALLOWED)
  })

  it('lets a Component hold several children, and still guards the root element', () => {
    // ADR 0008 §1 — a component is a frame, so it holds what a frame holds.
    expect(
      codesFor(
        contractOf(
          '<Component name="t" status="draft">\n  <Frame name="a" />\n  <Frame name="b" />\n</Component>',
        ),
      ),
    ).toEqual([])
    expect(codesFor(contractOf('<Frame name="a" />'))).toContain(CODES.BAD_ROOT)
  })

  it('lets a Component hold nothing at all — an empty frame is a frame', () => {
    expect(codesFor(contractOf('<Component name="t" status="draft" />'))).toEqual([])
  })

  it('requires exactly one Visual Contract heading', () => {
    expect(codesFor('---\nid: t\n---\n\n# Hi\n')).toContain(CODES.NO_CONTRACT)
    const twice =
      '---\nid: t\n---\n\n## Visual Contract\n\n<Component name="t" status="draft">\n  <Frame name="a" />\n</Component>\n\n## Visual Contract\n'
    expect(codesFor(twice)).toContain(CODES.DUPLICATE_CONTRACT)
  })

  it('rejects a status outside the documented set', () => {
    const source = contractOf(
      '<Component name="t" status="banana">\n  <Frame name="a" />\n</Component>',
    )
    const d = parse(source).diagnostics.find((x) => x.code === CODES.BAD_STATUS)
    expect(d?.message).toMatch(/draft \| stable \| deprecated/)
  })

  it('lets a <Component> declare no status at all (ADR 0009 §1)', () => {
    // Required, it produced `draft` on everything: the gesture wrote it because
    // the grammar demanded a value, and no control existed to change it. What
    // it collected was not maturity information.
    expect(
      codesFor(contractOf('<Component name="t">\n  <Frame name="a" />\n</Component>')),
    ).toEqual([])
  })

  it('still checks a status it is given', () => {
    expect(
      codesFor(contractOf('<Component name="t" status="wip">\n  <Frame name="a" />\n</Component>')),
    ).toContain(CODES.BAD_STATUS)
  })

  it('keeps metadata off anything that is not a <Component> (ADR 0003 §3)', () => {
    expect(codesFor(contractOf('<Page>\n  <Frame name="a" status="draft" />\n</Page>'))).toContain(
      CODES.METADATA_ATTR_MISPLACED,
    )
  })

  it('rejects metadata left behind in the frontmatter', () => {
    const codes = codesFor(
      contractOf(
        '<Component name="t" status="draft">\n  <Frame name="a" />\n</Component>',
        'id: t\nstatus: draft',
      ),
    )
    expect(codes).toContain(CODES.FRONTMATTER_KEY_MOVED)
  })

  it('accepts each documented status', () => {
    for (const status of ['draft', 'stable', 'deprecated']) {
      const source = contractOf(
        `<Component name="t" status="${status}">\n  <Frame name="a" />\n</Component>`,
      )
      expect(parse(source).diagnostics).toEqual([])
    }
  })

  it('requires a kebab-case id', () => {
    for (const id of ['Primary Button', 'primaryButton', 'primary_button', '-lead', 'trail-']) {
      const source = contractOf(
        '<Component name="t" status="draft">\n  <Frame name="a" />\n</Component>',
        `id: ${id}`,
      )
      const codes = parse(source).diagnostics.map((x) => x.code)
      expect(codes, `expected ${id} to be rejected`).toContain(CODES.BAD_ID)
    }
  })

  it('accepts a well-formed id', () => {
    for (const id of ['button', 'primary-button', 'h1', 'card-2-alt']) {
      const source = contractOf(
        '<Component name="t" status="draft">\n  <Frame name="a" />\n</Component>',
        `id: ${id}`,
      )
      expect(parse(source).diagnostics, `expected ${id} to be accepted`).toEqual([])
    }
  })

  it('requires id in frontmatter', () => {
    expect(
      codesFor(
        contractOf(
          '<Component name="t" status="draft">\n  <Frame name="a" />\n</Component>',
          'tags: [x]',
        ),
      ),
    ).toContain(CODES.MISSING_FRONTMATTER_KEY)
  })

  it('reports file:line:col', () => {
    const source = contractOf(
      '<Component name="t" status="draft">\n  <Blob name="x" />\n</Component>',
    )
    const d = parse(source).diagnostics.find((x) => x.code === CODES.UNKNOWN_ELEMENT)!
    expect(d.line).toBeGreaterThan(1)
    // `<Blob` starts two spaces in.
    expect(d.column).toBe(3)
  })
})
