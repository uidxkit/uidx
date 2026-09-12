import { describe, expect, it } from 'vitest'
import { CODES, emitDocument, parse, parseOrThrow, resolve } from '../src/index.js'

/**
 * `<Instance>`'s half of the grammar (story F3).
 *
 * Everything here is answerable from one page. Whether the name an instance
 * gives resolves to a component is *not* — component names are global to a
 * document (ADR 0004 §2) and the parser is handed one file — so that question
 * lives in `buildSymbolTable` beside the same question about a token alias.
 */
const contractOf = (body: string, frontmatter = 'id: t') =>
  `---\n${frontmatter}\n---\n\n## Visual Contract\n\n${body}\n`

const codes = (source: string): string[] => parse(source).diagnostics.map((d) => d.code)

const PAGE = (body: string) => contractOf(`<Page>\n${body}\n</Page>`)

describe('<Instance> in the grammar', () => {
  it('is legal on a page and inside a frame', () => {
    const doc = parseOrThrow(
      PAGE(
        `  <Instance name="save" component="Button/Primary" />\n` +
          `  <Frame name="bar" layoutMode="HORIZONTAL">\n` +
          `    <Instance name="cancel" component="Button/Primary" />\n` +
          `  </Frame>`,
      ),
    )
    expect(resolve(doc.tree, 'save')!.element).toBe('Instance')
    expect(resolve(doc.tree, 'bar#cancel')!.element).toBe('Instance')
  })

  it('is addressed like any other node', () => {
    const doc = parseOrThrow(
      PAGE(
        `  <Frame name="bar" layoutMode="HORIZONTAL">\n` +
          `    <Instance name="cancel" component="Button/Primary" />\n` +
          `  </Frame>`,
      ),
    )
    expect(resolve(doc.tree, 'bar')!.children[0]!.address).toBe('bar#cancel')
  })

  it('requires a name, as every node does', () => {
    expect(codes(PAGE(`  <Instance component="Button/Primary" />`))).toContain(CODES.MISSING_NAME)
  })

  it('requires the component it is an instance of', () => {
    expect(codes(PAGE(`  <Instance name="save" />`))).toEqual([CODES.MISSING_COMPONENT])
    expect(codes(PAGE(`  <Instance name="save" component="" />`))).toEqual([
      CODES.MISSING_COMPONENT,
    ])
    expect(codes(PAGE(`  <Instance name="save" component={12} />`))).toEqual([
      CODES.MISSING_COMPONENT,
    ])
  })

  it("takes no scene children — its children are the component's", () => {
    // ADR 0007 §2 made `<Instance>` a container for exactly one element, so
    // this is no longer "children are not allowed" but "that child is not one".
    expect(
      codes(
        PAGE(
          `  <Instance name="save" component="Button/Primary">\n` +
            `    <Text name="label" characters="Save" />\n` +
            `  </Instance>`,
        ),
      ),
    ).toContain(CODES.ELEMENT_NOT_ALLOWED_HERE)
  })

  it('accepts an overrides map keyed by a path inside the component', () => {
    const doc = parseOrThrow(
      PAGE(
        `  <Instance\n` +
          `    name="save"\n` +
          `    component="Button/Primary"\n` +
          `    overrides={{ 'container/label': { characters: 'Save' } }}\n` +
          `  />`,
      ),
    )
    expect(resolve(doc.tree, 'save')!.attrs.overrides!.value).toEqual({
      'container/label': { characters: 'Save' },
    })
  })

  it('refuses an overrides map that is not one', () => {
    expect(codes(PAGE(`  <Instance name="s" component="C" overrides={['a']} />`))).toEqual([
      CODES.BAD_OVERRIDES,
    ])
    expect(
      codes(PAGE(`  <Instance name="s" component="C" overrides={{ label: 'Save' }} />`)),
    ).toEqual([CODES.BAD_OVERRIDES])
  })

  it('refuses an override key that is not relative to the component', () => {
    // An override key is a path *inside* the component, so the entity separator
    // has no business in it — a key like `Button/Primary#container/label` names
    // the definition, which is the file the author is not editing.
    expect(
      codes(
        PAGE(
          `  <Instance name="s" component="Button/Primary"\n` +
            `    overrides={{ 'Button/Primary#container/label': { characters: 'Save' } }} />`,
        ),
      ),
    ).toEqual([CODES.BAD_OVERRIDES])
    expect(codes(PAGE(`  <Instance name="s" component="C" overrides={{ '': {} }} />`))).toEqual([
      CODES.BAD_OVERRIDES,
    ])
  })

  it("refuses <Instance>'s own properties on anything else", () => {
    // Both are in `KNOWN_PROPS`, so without this they would be spelled
    // correctly and do nothing — the quietest way for a file to be wrong.
    expect(codes(PAGE(`  <Frame name="f" component="Button/Primary" />`))).toEqual([
      CODES.COMPONENT_ATTR_MISPLACED,
    ])
    expect(codes(PAGE(`  <Frame name="f" overrides={{ 'a': {} }} />`))).toEqual([
      CODES.COMPONENT_ATTR_MISPLACED,
    ])
  })

  it('round-trips through the emitter untouched', () => {
    // Asserted against the *source*, not against another `emitDocument` call —
    // comparing the emitter with itself passes whatever it writes, which is the
    // trap D1's live pass caught. So the fixture is canonical to begin with,
    // Core Intent section and all, and any drift shows up as a diff.
    const source = `---
id: t
---

## Core Intent

Nothing to see here.

## Visual Contract

<Page>
  <Instance
    name="save"
    component="Button/Primary"
    overrides={{ 'container/label': { characters: 'Save' } }}
  />
</Page>
`
    expect(emitDocument(parseOrThrow(source))).toBe(source)
  })
})
