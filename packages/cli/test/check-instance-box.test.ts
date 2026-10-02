import { execFileSync } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { check, renderText } from '../src/index.js'

/**
 * `uidx check` on an instance's outer box (ADR 0018 §6): a locked attribute
 * is UIDX154 and a box value with nowhere to act is UIDX155. Both warn and
 * neither fails the run, since every target still draws the file.
 */
const BUTTON1 = `---
id: button1
---

## Visual Contract

<Page>
  <Component name="Button1" status="draft"
    layoutMode="HORIZONTAL" primaryAxisSizingMode="AUTO" counterAxisSizingMode="AUTO"
    paddingLeft={12} paddingRight={12} paddingTop={8} paddingBottom={8} cornerRadius={999}
    fills={[{ type: 'SOLID', color: { r: 0, g: 0.3333, b: 1, a: 1 } }]}>
    <Text name="label" characters="{label}" fontSize={14} />
  </Component>
  <Component name="Swatch" status="draft" width={24} height={24} />
</Page>

<Styles>
  <Style state="hover" root:fills={[{ type: 'SOLID', color: { r: 0.37, g: 0.57, b: 0.99, a: 1 } }]} />
</Styles>

## Contract

<Props>
  <Prop name="label" type="string" sample="Button1">The words it shows.</Prop>
</Props>
`

const TOKENS = (collection: string) => `---
id: tokens
---

## Visual Contract

<Tokens>
  <Collection name="${collection}">
    <Variable name="danger" type="COLOR" value={{ r: 1, g: 0, b: 0, a: 1 }} />
  </Collection>
</Tokens>
`

const USES = (body: string, regions = '') => `---
id: uses
---

## Visual Contract

<Page>
${body}
</Page>
${regions}`

/**
 * A binding every other check accepts: a field of the definition's model
 * prop. A bare `{tone}` would also be refused for its type (UIDX404), or as
 * unresolved outside a definition (UIDX401); this one only UIDX155 explains.
 */
const BOUND = [
  `  <Component name="Danger" status="draft">
    <Instance name="b" component="Button1" fills="{item.tone}" />
  </Component>`,
  `
## Contract

<Props>
  <Prop name="item" type="Alert">What it warns about.</Prop>
</Props>

## Models

<Model name="Alert">
  <Field name="tone" type="string" sample="red">The colour it asks for.</Field>
</Model>
`,
] as const

/** A loose document of three pages: the components, the tokens and the uses. */
async function checked(body: string, collection = 'surface', regions = '') {
  const dir = await mkdtemp(join(tmpdir(), 'uidx-instance-box-'))
  await writeFile(join(dir, 'button1.uidx'), BUTTON1)
  await writeFile(join(dir, 'tokens.uidx'), TOKENS(collection))
  await writeFile(join(dir, 'uses.uidx'), USES(body, regions))
  const result = await check(['.'], { cwd: dir })
  return { result, text: renderText(result, dir) }
}

const codes = (result: Awaited<ReturnType<typeof check>>) =>
  result.files.flatMap((file) => file.diagnostics.map((d) => d.code))

describe('uidx check on an instance outer box', () => {
  it('warns about each locked attribute, naming the component from another page', async () => {
    const { result, text } = await checked(
      `  <Instance name="b" component="Button1" layoutMode="VERTICAL" itemSpacing={4} />`,
    )
    expect(codes(result)).toEqual(['UIDX154', 'UIDX154'])
    expect(text).toMatch(
      /uses\.uidx:8:42 warning UIDX154: layoutMode on an instance of Button1 is ignored/,
    )
    expect(text).toMatch(/warning UIDX154: itemSpacing on an instance of Button1 is ignored/)
    expect(result.warnings).toBe(2)
  })

  it('leaves the exit code alone, since these are warnings', async () => {
    const { result } = await checked(
      `  <Instance name="b" component="Button1" clipsContent={true} paddingLeft={4} />
  <Instance name="s" component="Swatch" paddingLeft={8} />`,
    )
    expect(result.errors).toBe(0)
    expect(result.exitCode).toBe(0)
    expect(codes(result)).toEqual(['UIDX154', 'UIDX155'])
  })

  it('stays quiet for the box, placement and textFills', async () => {
    const { result, text } = await checked(
      `  <Instance name="b" component="Button1" props={{ label: 'Delete' }} x={8} y={8} width={199}
    fills="{surface#danger}" strokeWeight={2} cornerRadius={4} opacity={0.5}
    paddingLeft={24} textFills="{surface#danger}" />`,
    )
    expect(text).toMatch(/✔ 3 files OK/)
    expect(result.warnings).toBe(0)
  })

  it('reports a box value that does nothing', async () => {
    const { result, text } = await checked(
      `  <Instance name="s" component="Swatch" paddingLeft={8} textFills="{surface#danger}" />
${BOUND[0]}`,
      'surface',
      BOUND[1],
    )
    expect(codes(result)).toEqual(['UIDX155', 'UIDX155', 'UIDX155'])
    expect(result.errors).toBe(0)
    expect(text).toMatch(/UIDX155: paddingLeft does nothing here: Swatch's box does not lay out/)
    expect(text).toMatch(/UIDX155: textFills does nothing here: Swatch draws no text/)
    expect(text).toMatch(/UIDX155: fills binds "\{item\.tone\}"/)
  })

  it('reports a token collection named uidx', async () => {
    const { result, text } = await checked(
      `  <Instance name="b" component="Button1" fills="{uidx#danger}" />`,
      'uidx',
    )
    expect(codes(result)).toEqual(['UIDX155'])
    expect(text).toMatch(/tokens\.uidx:8:15 warning UIDX155: collection "uidx"/)
  })
})

describe('the shipped examples', () => {
  /**
   * Only git-tracked pages: a designer's own unsaved work in an example
   * folder is theirs, and a test must neither read nor depend on it.
   */
  const repo = join(import.meta.dirname, '..', '..', '..')
  const tracked = (dir: string) =>
    execFileSync('git', ['ls-files', '*.uidx'], { cwd: join(repo, dir), encoding: 'utf8' })
      .split('\n')
      .filter(Boolean)

  it.each([
    'examples/design-system/.uidx',
    'examples/shoelace/.uidx',
    'packages/viewer/test/fixtures/tour',
  ])('state no locked or idle box attribute on any instance in %s', async (dir) => {
    const files = tracked(dir)
    // An empty list would check the whole folder, untracked pages and all.
    expect(files.length).toBeGreaterThan(0)
    const result = await check(files, { cwd: join(repo, dir) })
    expect(codes(result).filter((code) => code === 'UIDX154' || code === 'UIDX155')).toEqual([])
  })
})
