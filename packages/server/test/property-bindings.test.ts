import { describe, expect, it } from 'vitest'
import { parseOrThrow } from '@uidx/format'
import { buildSymbolTable, collectReferences, WORKSPACE_CODES } from '../src/symbols.js'

/**
 * `{label}` checked against the component that must declare it (story F6).
 *
 * The whole reason this lives here rather than in the parser: "does this
 * reference resolve" is one question with one answer, whether the thing
 * referenced is a token variable, a component, or a component property. F3
 * added instance edges to this pass for the same reason. What is new is that a
 * property reference is *scoped* — two components may each declare `label` —
 * so it never joins the global namespace or the cycle graph.
 */
const page = (id: string, body: string) =>
  `---\nid: ${id}\n---\n\n## Visual Contract\n\n<Page>\n${body}\n</Page>\n`

const src = (file: string, id: string, body: string) => ({
  file,
  doc: parseOrThrow(page(id, body)),
})

const button = (props: string, body: string) =>
  src(
    'button.uidx',
    'button',
    `  <Component name="Button" status="draft" props={${props}}>\n${body}\n  </Component>`,
  )

const codes = (pages: Parameters<typeof buildSymbolTable>[0]): string[] =>
  buildSymbolTable(pages).diagnostics.map((d) => d.code)

const TOKENS = {
  file: 'tokens.uidx',
  doc: parseOrThrow(
    `---\nid: tokens\n---\n\n## Visual Contract\n\n<Tokens>\n` +
      `  <Collection name="radius">\n    <Variable name="md" type="FLOAT" value={8} />\n  </Collection>\n` +
      `</Tokens>\n`,
  ),
}

describe('a property binding', () => {
  it('resolves against the component it sits inside', () => {
    expect(
      codes([
        button(
          `{ label: { type: 'TEXT', default: 'Click' } }`,
          `    <Frame name="root" layoutMode="VERTICAL">
      <Text name="label" characters="{label}" />
    </Frame>`,
        ),
      ]),
    ).toEqual([])
  })

  it('is told apart from a token by the "#", with no sigil of its own', () => {
    const one = button(
      `{ label: { type: 'TEXT', default: 'Click' } }`,
      `    <Frame name="root" cornerRadius="{radius#md}">
      <Text name="label" characters="{label}" />
    </Frame>`,
    )
    expect(codes([TOKENS, one])).toEqual([])
    expect(collectReferences([one]).map((r) => [r.kind, r.target])).toEqual([
      ['symbol', 'radius#md'],
      ['property', 'label'],
    ])
  })

  it('reports a name the component does not declare, and suggests the near miss', () => {
    const [problem, ...rest] = buildSymbolTable([
      button(
        `{ label: { type: 'TEXT', default: 'Click' } }`,
        `    <Frame name="root"><Text name="t" characters="{labl}" /></Frame>`,
      ),
    ]).diagnostics
    expect(rest).toEqual([])
    expect(problem!.code).toBe(WORKSPACE_CODES.UNRESOLVED_REFERENCE)
    expect(problem!.message).toContain('"label"')
  })

  it('reports a binding that is not inside a component at all', () => {
    const loose = src('home.uidx', 'home', `  <Text name="t" characters="{label}" />`)
    const [problem] = buildSymbolTable([loose]).diagnostics
    expect(problem!.code).toBe(WORKSPACE_CODES.UNRESOLVED_REFERENCE)
    expect(problem!.message).toContain('not inside a <Component>')
  })

  it('reports a type that cannot fill the attribute it was bound to', () => {
    // The one nothing else would catch: a TEXT property on `visible` renders a
    // string where a boolean belongs, and the renderer gets the blame.
    const [problem, ...rest] = buildSymbolTable([
      button(
        `{ label: { type: 'TEXT', default: 'Click' } }`,
        `    <Frame name="root"><Text name="t" visible="{label}" /></Frame>`,
      ),
    ]).diagnostics
    expect(rest).toEqual([])
    expect(problem!.code).toBe(WORKSPACE_CODES.PROPERTY_BINDING_MISMATCH)
    expect(problem!.message).toContain('characters')
  })

  it('accepts each type on the one attribute it fills', () => {
    expect(
      codes([
        button(
          `{ label: { type: 'TEXT', default: 'Click' },
             shown: { type: 'BOOLEAN', default: true },
             icon: { type: 'INSTANCE_SWAP', default: 'Button' } }`,
          `    <Frame name="root" layoutMode="VERTICAL">
      <Text name="label" characters="{label}" visible="{shown}" />
      <Instance name="glyph" component="{icon}" />
    </Frame>`,
        ),
      ]),
    ).toEqual([])
  })

  it('scopes a name to its own component, so two may share one', () => {
    const a = button(
      `{ label: { type: 'TEXT', default: 'A' } }`,
      `    <Frame name="root"><Text name="t" characters="{label}" /></Frame>`,
    )
    const b = src(
      'other.uidx',
      'other',
      `  <Component name="Other" status="draft" props={{ label: { type: 'TEXT', default: 'B' } }}>
    <Frame name="root"><Text name="t" characters="{label}" /></Frame>
  </Component>`,
    )
    expect(codes([a, b])).toEqual([])
  })

  it("does not let one component read another's property", () => {
    const a = button(`{ label: { type: 'TEXT', default: 'A' } }`, `    <Frame name="root" />`)
    const b = src(
      'other.uidx',
      'other',
      `  <Component name="Other" status="draft">
    <Frame name="root"><Text name="t" characters="{label}" /></Frame>
  </Component>`,
    )
    expect(codes([a, b])).toEqual([WORKSPACE_CODES.UNRESOLVED_REFERENCE])
  })

  it('never joins the cycle graph, because a property is not a node', () => {
    // A component whose property is named after itself is not a loop.
    const self = src(
      'a.uidx',
      'a',
      `  <Component name="A" status="draft" props={{ A: { type: 'TEXT', default: 'x' } }}>
    <Frame name="root"><Text name="t" characters="{A}" /></Frame>
  </Component>`,
    )
    expect(codes([self])).toEqual([])
  })
})
