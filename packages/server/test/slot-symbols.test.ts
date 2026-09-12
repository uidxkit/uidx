import { describe, expect, it } from 'vitest'
import { parseOrThrow } from '@uidx/format'
import { buildSymbolTable, WORKSPACE_CODES } from '../src/symbols.js'

/**
 * A fill against the slot it names (story F5, ADR 0007 §5).
 *
 * Cross-page by construction: the fill is in one file and the `<Slot>` in
 * another, so the parser cannot ask this question and `buildSymbolTable` is
 * where it belongs — beside the same question about a property name.
 */
const page = (id: string, body: string) =>
  `---\nid: ${id}\n---\n\n## Visual Contract\n\n<Page>\n${body}\n</Page>\n`

const source = (file: string, id: string, body: string) => ({
  file,
  doc: parseOrThrow(page(id, body)),
})

const CARD = (slotName: string) =>
  source(
    'card.uidx',
    'card',
    `  <Component name="Card" status="stable">
    <Frame name="container" layoutMode="VERTICAL">
      <Text name="title" characters="Title" />
      <Slot name="${slotName}" />
    </Frame>
  </Component>`,
  )

const fills = (file: string, id: string, slotName: string, extra = '') =>
  source(
    file,
    id,
    `  <Instance name="card-1" component="Card"${extra}>\n` +
      `    <Slot name="${slotName}"><Text name="figure" characters="x" /></Slot>\n` +
      `  </Instance>`,
  )

const found = (pages: Parameters<typeof buildSymbolTable>[0]) => buildSymbolTable(pages).diagnostics

describe('a fill against its component', () => {
  it('is silent when the slot is declared', () => {
    expect(found([CARD('body'), fills('home.uidx', 'home', 'body')])).toEqual([])
  })

  it('names the slots that do exist when a fill names one that does not', () => {
    const out = found([CARD('body'), fills('home.uidx', 'home', 'bodyy')])
    expect(out.map((d) => d.code)).toEqual([WORKSPACE_CODES.UNKNOWN_SLOT])
    expect(out[0]!.message).toMatch(/declares no slot "bodyy"/)
    // Shares `suggest` with every other unresolved name in this table.
    expect(out[0]!.message).toMatch(/Did you mean "body"/)
  })

  it('reports at the fill, not at the instance', () => {
    const pages = [CARD('body'), fills('home.uidx', 'home', 'nope')]
    const out = found(pages)
    expect(out[0]!.file).toBe('home.uidx')
    // Line 9 is the `<Slot>`; line 8 is the `<Instance>` above it.
    expect(out[0]!.line).toBe(9)
  })
})

describe('a slot deleted out from under its fills — ADR 0007 §5', () => {
  /**
   * `Card` declared "body" and now declares "main"; two pages still fill it.
   *
   * A second component keeps the name alive, which is the discriminator the
   * spec chose: a name nothing in the document declares reads as a typo
   * (UIDX410), a name something still declares reads as a slot deleted out
   * from under its fills (UIDX411).
   */
  const KEEPS = source(
    'keeps.uidx',
    'keeps',
    `  <Component name="Other" status="stable">
    <Frame name="w" layoutMode="VERTICAL"><Slot name="body" /></Frame>
  </Component>`,
  )
  const pages = [
    CARD('main'),
    KEEPS,
    fills('home.uidx', 'home', 'body'),
    fills('other.uidx', 'other', 'body'),
  ]

  it('names every fill site, by page', () => {
    const out = found(pages).filter((d) => d.code === WORKSPACE_CODES.ORPHANED_SLOT_FILL)
    expect(found(pages).every((d) => d.code === WORKSPACE_CODES.ORPHANED_SLOT_FILL)).toBe(true)
    expect(out).toHaveLength(2)
    expect(out.map((d) => d.file).sort()).toEqual(['home.uidx', 'other.uidx'])
  })

  it('says "declare it again or delete this" rather than "did you mean"', () => {
    // Distinct from UIDX410 because the fix is: the name is not a typo, it is
    // content that has quietly stopped being drawn.
    const out = found([CARD('main'), KEEPS, fills('home.uidx', 'home', 'body')])
    expect(out.map((d) => d.code)).toEqual([WORKSPACE_CODES.ORPHANED_SLOT_FILL])
    expect(out[0]!.message).toMatch(/no longer declares a slot "body"/)
  })
})

describe('an override that reaches into a filled slot — ADR 0007 §4', () => {
  it('refuses two ways of saying one thing', () => {
    const out = found([
      CARD('body'),
      fills('home.uidx', 'home', 'body', ` overrides={{ 'container/body': { itemSpacing: 4 } }}`),
    ])
    expect(out.map((d) => d.code)).toEqual([WORKSPACE_CODES.OVERRIDE_INTO_FILLED_SLOT])
    expect(out[0]!.message).toMatch(/keep one of the two/)
  })

  it('allows an override beside the slot, which the fill does not touch', () => {
    expect(
      found([
        CARD('body'),
        fills(
          'home.uidx',
          'home',
          'body',
          ` overrides={{ 'container/title': { characters: 'Revenue' } }}`,
        ),
      ]),
    ).toEqual([])
  })

  it('is silent about a slot the instance does not fill', () => {
    expect(
      found([
        CARD('body'),
        source(
          'home.uidx',
          'home',
          `  <Instance name="card-1" component="Card" overrides={{ 'container/body': { itemSpacing: 4 } }} />`,
        ),
      ]),
    ).toEqual([])
  })
})
