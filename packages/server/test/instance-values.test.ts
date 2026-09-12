import { describe, expect, it } from 'vitest'
import { parseOrThrow } from '@uidx/format'
import { buildSymbolTable, WORKSPACE_CODES } from '../src/symbols.js'

/**
 * What an `<Instance>` assigns, against what its component declares (story F7).
 *
 * The panel refuses both of these before the author can press anything, so the
 * case that matters here is a hand-edited file — and a file the author may not
 * have open, since the declaration and the use are usually on different pages.
 * That is exactly the shape of question this pass exists for.
 */
const page = (id: string, body: string) =>
  `---\nid: ${id}\n---\n\n## Visual Contract\n\n<Page>\n${body}\n</Page>\n`

const src = (file: string, id: string, body: string) => ({
  file,
  doc: parseOrThrow(page(id, body)),
})

const BUTTON = src(
  'button.uidx',
  'button',
  `  <Component name="Button" status="draft"
    props={{
      label: { type: 'TEXT', default: 'Click' },
      showIcon: { type: 'BOOLEAN', default: true },
    }}>
    <Frame name="root" layoutMode="VERTICAL"><Text name="t" characters="{label}" /></Frame>
  </Component>`,
)

const BARE = src(
  'bare.uidx',
  'bare',
  `  <Component name="Bare" status="draft"><Frame name="root" layoutMode="VERTICAL" /></Component>`,
)

const uses = (props: string, component = 'Button') =>
  src('home.uidx', 'home', `  <Instance name="save" component="${component}" props={${props}} />`)

const report = (...pages: { file: string; doc: ReturnType<typeof parseOrThrow> }[]) =>
  buildSymbolTable(pages).diagnostics

describe('an instance filling in its properties', () => {
  it('says nothing when every value is declared and typed right', () => {
    expect(report(BUTTON, uses(`{ label: 'Save', showIcon: false }`))).toEqual([])
  })

  it('names a property the component does not declare, and suggests the near miss', () => {
    const [problem, ...rest] = report(BUTTON, uses(`{ labl: 'Save' }`))
    expect(rest).toEqual([])
    expect(problem!.code).toBe(WORKSPACE_CODES.UNDECLARED_PROPERTY_VALUE)
    expect(problem!.message).toContain('"label"')
    // Reported against the consuming page, which is where the mistake is.
    expect(problem!.file).toBe('home.uidx')
  })

  it('says so plainly when the component declares none at all', () => {
    const [problem] = report(BARE, uses(`{ label: 'Save' }`, 'Bare'))
    expect(problem!.code).toBe(WORKSPACE_CODES.UNDECLARED_PROPERTY_VALUE)
    expect(problem!.message).toContain('declares none at all')
  })

  it("names a value the declaration's type contradicts", () => {
    const [problem, ...rest] = report(BUTTON, uses(`{ showIcon: 'yes' }`))
    expect(rest).toEqual([])
    expect(problem!.code).toBe(WORKSPACE_CODES.PROPERTY_VALUE_MISMATCH)
    expect(problem!.message).toContain('true or false')
  })

  it('reports every bad value, not only the first', () => {
    expect(report(BUTTON, uses(`{ tone: 'quiet', showIcon: 'yes' }`)).map((d) => d.code)).toEqual([
      WORKSPACE_CODES.UNDECLARED_PROPERTY_VALUE,
      WORKSPACE_CODES.PROPERTY_VALUE_MISMATCH,
    ])
  })

  it('stays quiet about properties when the component itself is missing', () => {
    // Piling "Button declares no `tone`" on top of "there is no Button" tells
    // the author nothing they can act on; `checkReferences` already said the
    // one thing worth saying.
    expect(report(uses(`{ tone: 'quiet' }`)).map((d) => d.code)).toEqual([
      WORKSPACE_CODES.UNRESOLVED_REFERENCE,
    ])
  })

  it('checks an instance nested inside a component too', () => {
    const card = src(
      'card.uidx',
      'card',
      `  <Component name="Card" status="draft">
    <Frame name="root" layoutMode="VERTICAL">
      <Instance name="action" component="Button" props={{ tone: 'quiet' }} />
    </Frame>
  </Component>`,
    )
    expect(report(BUTTON, card).map((d) => d.code)).toEqual([
      WORKSPACE_CODES.UNDECLARED_PROPERTY_VALUE,
    ])
  })
})

/**
 * Picking a variant is filling in a property (story F8, ADR 0005 §4).
 *
 * One surface and one spelling: an axis is assigned through the same `props`
 * object F7 fills in, so it is checked here beside the rest rather than in a
 * pass of its own. What is new is the third mistake — asking for a combination
 * nobody designed, which is a mistake at the *use* site because sparseness is
 * deliberate in the component.
 */
const STATEFUL = src(
  'stateful.uidx',
  'stateful',
  `  <Component name="Chip" status="draft"
    props={{ label: { type: 'TEXT', default: 'Chip' } }}
    variants={{ state: ['default', 'hover'], size: ['md', 'sm'] }}>
    <Variant state="default" size="md"><Frame name="root" layoutMode="VERTICAL" /></Variant>
    <Variant state="hover" size="md"><Frame name="root" layoutMode="VERTICAL" /></Variant>
    <Variant state="default" size="sm"><Frame name="root" layoutMode="VERTICAL" /></Variant>
  </Component>`,
)

const chip = (props: string) =>
  src('home.uidx', 'home', `  <Instance name="c" component="Chip"${props} />`)

describe('an instance picking a variant', () => {
  it('says nothing when it asks for a combination that exists', () => {
    expect(report(STATEFUL, chip(` props={{ state: 'hover', label: 'Save' }}`))).toEqual([])
  })

  it('says nothing when it asks for nothing, which is the default combination', () => {
    expect(report(STATEFUL, chip(''))).toEqual([])
  })

  it('names a value outside the axis domain, and suggests the near miss', () => {
    const [problem, ...rest] = report(STATEFUL, chip(` props={{ state: 'hoverr' }}`))
    expect(rest).toEqual([])
    expect(problem!.code).toBe(WORKSPACE_CODES.PROPERTY_VALUE_MISMATCH)
    expect(problem!.message).toContain('"hover"')
  })

  it('names a combination nobody designed', () => {
    // Sparseness is the point of declaring the domain, so this is not the
    // component's mistake — it is this use asking for something that is not
    // there.
    const [problem, ...rest] = report(STATEFUL, chip(` props={{ state: 'hover', size: 'sm' }}`))
    expect(rest).toEqual([])
    expect(problem!.code).toBe(WORKSPACE_CODES.MISSING_VARIANT)
    expect(problem!.message).toContain('state=hover, size=sm')
    // And says what it does have, so the fix is visible without opening the file.
    expect(problem!.message).toContain('state=default, size=md')
  })

  it('does not also complain about the combination when a value was already wrong', () => {
    // One mistake, one sentence: the second would be a worse restatement of the
    // first, about a combination the author never asked for.
    expect(report(STATEFUL, chip(` props={{ state: 'nope' }}`)).map((d) => d.code)).toEqual([
      WORKSPACE_CODES.PROPERTY_VALUE_MISMATCH,
    ])
  })

  it('tells an axis apart from a property, and offers both as near misses', () => {
    const [problem] = report(STATEFUL, chip(` props={{ stat: 'hover' }}`))
    expect(problem!.code).toBe(WORKSPACE_CODES.UNDECLARED_PROPERTY_VALUE)
    expect(problem!.message).toContain('"state"')
  })
})
