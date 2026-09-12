import { describe, expect, it } from 'vitest'
import { parseOrThrow } from '@uidx/format'
import { buildSymbolTable, suggest, WORKSPACE_CODES } from '../src/index.js'

const page = (id: string, ...components: string[]) =>
  parseOrThrow(`---
id: ${id}
---

## Visual Contract

<Page>
${components
  .map(
    (name) => `  <Component name="${name}" status="draft">
    <Frame name="root" cornerRadius={4} />
  </Component>`,
  )
  .join('\n')}
</Page>
`)

const pages = (entries: Record<string, string[]>) =>
  Object.entries(entries).map(([file, components]) => ({
    file,
    doc: page(file.replace('.uidx', ''), ...components),
  }))

describe('buildSymbolTable', () => {
  it('collects every component across the document, with its location', () => {
    const { table, diagnostics } = buildSymbolTable(
      pages({ 'marketing.uidx': ['Marketing/Hero'], 'app.uidx': ['App/Button', 'App/Card'] }),
    )
    expect(diagnostics).toEqual([])
    expect(table.entries.map((e) => e.name)).toEqual(['Marketing/Hero', 'App/Button', 'App/Card'])
    expect(table.get('App/Card')).toMatchObject({ file: 'app.uidx', kind: 'component' })
    expect(table.get('App/Card')!.line).toBeGreaterThan(1)
  })

  it('does not treat a bare <Frame> on a page as a global name', () => {
    const doc = parseOrThrow(`---
id: scenery
---

## Visual Contract

<Page>
  <Frame name="backdrop" width={10} height={10} />
  <Component name="Real" status="draft">
    <Frame name="root" cornerRadius={4} />
  </Component>
</Page>
`)
    const { table } = buildSymbolTable([{ file: 'a.uidx', doc }])
    expect(table.entries.map((e) => e.name)).toEqual(['Real'])
  })

  it('reports a duplicate against both declarations, and suggests grouping', () => {
    const { table, diagnostics } = buildSymbolTable(
      pages({ 'a.uidx': ['Button'], 'b.uidx': ['Button'] }),
    )
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]!.code).toBe(WORKSPACE_CODES.DUPLICATE_COMPONENT)
    expect(diagnostics[0]!.file).toBe('b.uidx')
    expect(diagnostics[0]!.message).toMatch(/also declared at a\.uidx:\d+:\d+/)
    expect(diagnostics[0]!.message).toMatch(/group them with "\/"/)
    // The first declaration still owns the name; the duplicate is not indexed.
    expect(table.entries).toHaveLength(1)
    expect(table.get('Button')!.file).toBe('a.uidx')
  })

  it('lets two systems coexist once their names are grouped', () => {
    const { diagnostics } = buildSymbolTable(
      pages({ 'a.uidx': ['Marketing/Button'], 'b.uidx': ['App/Button'] }),
    )
    expect(diagnostics).toEqual([])
  })

  it('still catches a duplicate page id', () => {
    const { diagnostics } = buildSymbolTable([
      { file: 'a.uidx', doc: page('same', 'A') },
      { file: 'b.uidx', doc: page('same', 'B') },
    ])
    expect(diagnostics.map((d) => d.code)).toEqual([WORKSPACE_CODES.DUPLICATE_PAGE_ID])
  })
})

/**
 * Global naming costs a diagnostic its best hint — "not found" cannot say which
 * file the name should have been in — so the near-match suggestion carries more
 * weight here than it would in a scoped language.
 *
 * Token aliases (G5) are its first real caller; `<Instance>` (F3) will be the
 * second. These stay as direct tests of the matcher itself.
 */
describe('suggest', () => {
  const names = ['Button/Primary', 'Button/Ghost', 'Card/Basic', 'Marketing/Hero']

  it('finds an obvious typo', () => {
    expect(suggest('Button/Primry', names)[0]).toBe('Button/Primary')
  })

  it('is case-insensitive', () => {
    expect(suggest('button/ghost', names)[0]).toBe('Button/Ghost')
  })

  it('returns nothing for a name that resembles none of them', () => {
    expect(suggest('Totally/Different/Thing', names)).toEqual([])
  })

  it('scales its tolerance with the length of the name', () => {
    // Two edits is within budget for a short name...
    expect(suggest('Crd/Basic', names)).toContain('Card/Basic')
    // ...but a short candidate list should not match on almost nothing.
    expect(suggest('X', names)).toEqual([])
  })

  it('caps how many it offers', () => {
    expect(suggest('Button/Primar', names, 1)).toHaveLength(1)
  })
})

const tokenPage = (id: string, body: string) =>
  parseOrThrow(`---
id: ${id}
---

## Visual Contract

<Tokens>
${body}
</Tokens>
`)

describe('tokens join one namespace (G5)', () => {
  const palette = tokenPage(
    'palette',
    `  <Collection name="palette">
    <Variable name="blue" type="COLOR" value={{ r: 0, g: 0, b: 1, a: 1 }} />
    <Variable name="white" type="COLOR" value={{ r: 1, g: 1, b: 1, a: 1 }} />
  </Collection>`,
  )

  it('indexes variables by their address, alongside components', () => {
    const { table, diagnostics } = buildSymbolTable([
      { file: 'tokens.uidx', doc: palette },
      { file: 'page.uidx', doc: page('page', 'Button') },
    ])
    expect(diagnostics).toEqual([])
    expect(table.entries.map((e) => `${e.kind}:${e.name}`).sort()).toEqual([
      'component:Button',
      'variable:palette#blue',
      'variable:palette#white',
    ])
  })

  it('resolves an alias that points at a real variable', () => {
    const semantic = tokenPage(
      'semantic',
      `  <Collection name="semantic">
    <Variable name="brand" type="COLOR" value="{palette#blue}" />
  </Collection>`,
    )
    const { diagnostics } = buildSymbolTable([
      { file: 'a.uidx', doc: palette },
      { file: 'b.uidx', doc: semantic },
    ])
    expect(diagnostics).toEqual([])
  })

  it('reports an unresolved alias with a near match', () => {
    const typo = tokenPage(
      'typo',
      `  <Collection name="semantic">
    <Variable name="brand" type="COLOR" value="{palette#bleu}" />
  </Collection>`,
    )
    const { diagnostics } = buildSymbolTable([
      { file: 'a.uidx', doc: palette },
      { file: 'b.uidx', doc: typo },
    ])
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]!.code).toBe(WORKSPACE_CODES.UNRESOLVED_REFERENCE)
    expect(diagnostics[0]!.message).toMatch(/Did you mean "palette#blue"\?/)
  })

  it('reports a reference cycle as the path it walks', () => {
    const loop = tokenPage(
      'loop',
      `  <Collection name="c">
    <Variable name="a" type="FLOAT" value="{c#b}" />
    <Variable name="b" type="FLOAT" value="{c#a}" />
  </Collection>`,
    )
    const { diagnostics } = buildSymbolTable([{ file: 'loop.uidx', doc: loop }])
    const cycles = diagnostics.filter((d) => d.code === WORKSPACE_CODES.REFERENCE_CYCLE)
    // Reported once, not once per rotation.
    expect(cycles).toHaveLength(1)
    expect(cycles[0]!.message).toMatch(/c#a → c#b → c#a|c#b → c#a → c#b/)
  })

  it('catches a longer cycle too', () => {
    const loop = tokenPage(
      'loop',
      `  <Collection name="c">
    <Variable name="a" type="FLOAT" value="{c#b}" />
    <Variable name="b" type="FLOAT" value="{c#d}" />
    <Variable name="d" type="FLOAT" value="{c#a}" />
  </Collection>`,
    )
    const cycles = buildSymbolTable([{ file: 'loop.uidx', doc: loop }]).diagnostics.filter(
      (d) => d.code === WORKSPACE_CODES.REFERENCE_CYCLE,
    )
    expect(cycles).toHaveLength(1)
  })

  it('does not report a cycle for an alias that never resolved', () => {
    const dangling = tokenPage(
      'dangling',
      `  <Collection name="c">
    <Variable name="a" type="FLOAT" value="{c#missing}" />
  </Collection>`,
    )
    const codes = buildSymbolTable([{ file: 'a.uidx', doc: dangling }]).diagnostics.map(
      (d) => d.code,
    )
    expect(codes).toEqual([WORKSPACE_CODES.UNRESOLVED_REFERENCE])
  })

  it('lets a diamond share a target without calling it a cycle', () => {
    const diamond = tokenPage(
      'diamond',
      `  <Collection name="c">
    <Variable name="base" type="FLOAT" value={4} />
    <Variable name="a" type="FLOAT" value="{c#base}" />
    <Variable name="b" type="FLOAT" value="{c#base}" />
  </Collection>`,
    )
    expect(buildSymbolTable([{ file: 'a.uidx', doc: diamond }]).diagnostics).toEqual([])
  })

  it('flags two collections declaring the same variable address', () => {
    const { diagnostics } = buildSymbolTable([
      { file: 'a.uidx', doc: palette },
      {
        file: 'b.uidx',
        doc: tokenPage(
          'other',
          `  <Collection name="palette">
    <Variable name="blue" type="COLOR" value={{ r: 1, g: 0, b: 0, a: 1 }} />
  </Collection>`,
        ),
      },
    ])
    expect(diagnostics.map((d) => d.code)).toContain(WORKSPACE_CODES.DUPLICATE_VARIABLE)
  })
})

describe('token aliases across modes (G8)', () => {
  const palette = tokenPage(
    'palette',
    `  <Collection name="palette">
    <Variable name="blue" type="COLOR" value={{ r: 0, g: 0, b: 1, a: 1 }} />
  </Collection>`,
  )

  it('reports an alias inside a <Mode> that points at nothing', () => {
    const moded = tokenPage(
      'moded',
      `  <Collection name="semantic" modes={['light', 'dark']}>
    <Variable name="surface" type="COLOR">
      <Mode name="light" value="{palette#blue}" />
      <Mode name="dark" value="{palette#bleu}" />
    </Variable>
  </Collection>`,
    )
    const { diagnostics } = buildSymbolTable([
      { file: 'a.uidx', doc: palette },
      { file: 'b.uidx', doc: moded },
    ])
    const unresolved = diagnostics.filter((d) => d.code === WORKSPACE_CODES.UNRESOLVED_REFERENCE)
    expect(unresolved).toHaveLength(1)
    expect(unresolved[0]!.message).toMatch(/palette#bleu/)
  })

  // The edge must start at the variable, not at the <Mode>: a mode has the
  // empty address, and an edge out of "" is an edge out of the page root.
  it('attributes a mode alias to its variable, so a cycle through one is found', () => {
    const loop = tokenPage(
      'loop',
      `  <Collection name="c" modes={['light']}>
    <Variable name="a" type="FLOAT"><Mode name="light" value="{c#b}" /></Variable>
    <Variable name="b" type="FLOAT"><Mode name="light" value="{c#a}" /></Variable>
  </Collection>`,
    )
    const { diagnostics } = buildSymbolTable([{ file: 'loop.uidx', doc: loop }])
    const cycles = diagnostics.filter((d) => d.code === WORKSPACE_CODES.REFERENCE_CYCLE)
    expect(cycles).toHaveLength(1)
    expect(cycles[0]!.message).toMatch(/c#a → c#b → c#a|c#b → c#a → c#b/)
  })

  it('reports an alias whose target has a different type', () => {
    const mismatch = tokenPage(
      'mismatch',
      `  <Collection name="s">
    <Variable name="c" type="COLOR" value="{palette#blue}" />
    <Variable name="n" type="FLOAT" value="{palette#blue}" />
  </Collection>`,
    )
    const { diagnostics } = buildSymbolTable([
      { file: 'a.uidx', doc: palette },
      { file: 'b.uidx', doc: mismatch },
    ])
    const mismatches = diagnostics.filter((d) => d.code === WORKSPACE_CODES.ALIAS_TYPE_MISMATCH)
    // Only the FLOAT one: an alias takes its target's type, and COLOR agrees.
    expect(mismatches).toHaveLength(1)
    expect(mismatches[0]!.message).toMatch(/FLOAT.*COLOR|COLOR.*FLOAT/)
  })

  it('accepts a moded alias that resolves', () => {
    const ok = tokenPage(
      'ok',
      `  <Collection name="semantic" modes={['light', 'dark']}>
    <Variable name="surface" type="COLOR">
      <Mode name="light" value="{palette#blue}" />
      <Mode name="dark" value="{palette#blue}" />
    </Variable>
  </Collection>`,
    )
    const { diagnostics } = buildSymbolTable([
      { file: 'a.uidx', doc: palette },
      { file: 'b.uidx', doc: ok },
    ])
    expect(diagnostics).toEqual([])
  })
})

describe('scope violations warn rather than fail (G8)', () => {
  const scoped = tokenPage(
    'scoped',
    `  <Collection name="radius">
    <Variable name="md" type="FLOAT" value={8} scopes={['CORNER_RADIUS']} />
  </Collection>
  <Collection name="any">
    <Variable name="loose" type="FLOAT" value={2} />
  </Collection>`,
  )

  const bind = (attrs: string) =>
    parseOrThrow(
      `---\nid: b\n---\n\n## Visual Contract\n\n<Page>\n  <Frame name="f" ${attrs} />\n</Page>\n`,
    )

  const codesFor = (attrs: string) =>
    buildSymbolTable([
      { file: 'a.uidx', doc: scoped },
      { file: 'b.uidx', doc: bind(attrs) },
    ]).diagnostics

  it('warns when a binding sits outside the variable scopes', () => {
    const hit = codesFor(`itemSpacing="{radius#md}"`).find(
      (d) => d.code === WORKSPACE_CODES.SCOPE_VIOLATION,
    )!
    // A warning, deliberately: Figma's scopes filter its picker, its API binds
    // regardless, and an imported file must still open.
    expect(hit).toBeDefined()
    expect(hit.severity).toBe('warning')
  })

  it('says nothing when the binding is in scope', () => {
    expect(
      codesFor(`cornerRadius="{radius#md}"`).some(
        (d) => d.code === WORKSPACE_CODES.SCOPE_VIOLATION,
      ),
    ).toBe(false)
  })

  it('says nothing for an unscoped variable, since absent means ALL_SCOPES', () => {
    expect(
      codesFor(`itemSpacing="{any#loose}"`).some((d) => d.code === WORKSPACE_CODES.SCOPE_VIOLATION),
    ).toBe(false)
  })
})
