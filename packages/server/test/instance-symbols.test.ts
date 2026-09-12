import { describe, expect, it } from 'vitest'
import { parseOrThrow } from '@uidx/format'
import { buildSymbolTable, collectReferences, WORKSPACE_CODES } from '../src/symbols.js'

/**
 * `<Instance>` joins the reference graph token aliases already built (F3).
 *
 * The point of these tests is that nothing here is instance-specific machinery:
 * an unresolved component name and an unresolved token alias are the same
 * diagnostic through the same code path, and so is a cycle. What is
 * instance-specific is only *where the edge starts*, which is what the last two
 * tests pin down.
 */
const page = (id: string, body: string) =>
  `---\nid: ${id}\n---\n\n## Visual Contract\n\n<Page>\n${body}\n</Page>\n`

const source = (file: string, id: string, body: string) => ({
  file,
  doc: parseOrThrow(page(id, body)),
})

const BUTTON = source(
  'button.uidx',
  'button',
  `  <Component name="Button/Primary" status="stable">
    <Frame name="container" layoutMode="HORIZONTAL">
      <Text name="label" characters="Click" />
    </Frame>
  </Component>`,
)

const codes = (pages: Parameters<typeof buildSymbolTable>[0]): string[] =>
  buildSymbolTable(pages).diagnostics.map((d) => d.code)

describe('an instance as a reference', () => {
  it('resolves a component named in another page of the document', () => {
    const uses = source(
      'home.uidx',
      'home',
      `  <Instance name="save" component="Button/Primary" />`,
    )
    expect(codes([BUTTON, uses])).toEqual([])
  })

  it('reports a name that resolves to nothing, and suggests the near miss', () => {
    const uses = source('home.uidx', 'home', `  <Instance name="save" component="Button/Primry" />`)
    const [problem, ...rest] = buildSymbolTable([BUTTON, uses]).diagnostics
    expect(rest).toEqual([])
    expect(problem!.code).toBe(WORKSPACE_CODES.UNRESOLVED_REFERENCE)
    expect(problem!.message).toContain('"Button/Primary"')
    // Pointed at the name itself, not at the element — the fix is one word.
    expect(problem!.file).toBe('home.uidx')
  })

  it('catches a component that instantiates itself', () => {
    const recursive = source(
      'a.uidx',
      'a',
      `  <Component name="A" status="draft">
    <Frame name="root" layoutMode="VERTICAL">
      <Instance name="me" component="A" />
    </Frame>
  </Component>`,
    )
    expect(codes([recursive])).toEqual([WORKSPACE_CODES.REFERENCE_CYCLE])
  })

  it('catches a loop that closes through another page', () => {
    const a = source(
      'a.uidx',
      'a',
      `  <Component name="A" status="draft">
    <Frame name="root" layoutMode="VERTICAL">
      <Instance name="b" component="B" />
    </Frame>
  </Component>`,
    )
    const b = source(
      'b.uidx',
      'b',
      `  <Component name="B" status="draft">
    <Frame name="root" layoutMode="VERTICAL">
      <Instance name="a" component="A" />
    </Frame>
  </Component>`,
    )
    const found = buildSymbolTable([a, b]).diagnostics
    expect(found.map((d) => d.code)).toEqual([WORKSPACE_CODES.REFERENCE_CYCLE])
    expect(found[0]!.message).toContain('A')
    expect(found[0]!.message).toContain('B')
  })

  it('does not call one component used twice a cycle', () => {
    const uses = source(
      'home.uidx',
      'home',
      `  <Instance name="save" component="Button/Primary" />
  <Instance name="cancel" component="Button/Primary" />`,
    )
    expect(codes([BUTTON, uses])).toEqual([])
  })

  it('starts the edge at the enclosing component, not at the instance', () => {
    // This is the whole reason an instance edge is not simply the node's own
    // address: `A#root/me -> A` is not a loop, and `A -> A` is.
    const recursive = source(
      'a.uidx',
      'a',
      `  <Component name="A" status="draft">
    <Frame name="root" layoutMode="VERTICAL">
      <Instance name="me" component="A" />
    </Frame>
  </Component>`,
    )
    expect(collectReferences([recursive])).toMatchObject([{ from: 'A', target: 'A' }])
  })

  it('starts a loose instance at its own address, which nothing can target', () => {
    const loose = source(
      'home.uidx',
      'home',
      `  <Instance name="save" component="Button/Primary" />`,
    )
    expect(collectReferences([loose])).toMatchObject([{ from: 'save', target: 'Button/Primary' }])
    // And an instance of a component that is only ever used, never nested into
    // anything, is therefore never reported as a cycle.
    expect(codes([BUTTON, loose])).toEqual([])
  })

  it('leaves a token alias reaching the same graph unchanged', () => {
    const tokens = {
      file: 'tokens.uidx',
      doc: parseOrThrow(
        `---\nid: tokens\n---\n\n## Visual Contract\n\n<Tokens>\n` +
          `  <Collection name="radius">\n    <Variable name="md" type="FLOAT" value={8} />\n  </Collection>\n` +
          `</Tokens>\n`,
      ),
    }
    const uses = source(
      'home.uidx',
      'home',
      `  <Frame name="card" cornerRadius="{radius#md}" />
  <Instance name="save" component="Button/Primary" />`,
    )
    expect(codes([tokens, BUTTON, uses])).toEqual([])
    expect(collectReferences([uses]).map((r) => r.target)).toEqual(['radius#md', 'Button/Primary'])
  })
})
