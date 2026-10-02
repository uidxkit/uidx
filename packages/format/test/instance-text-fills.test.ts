import { describe, expect, it } from 'vitest'
import { CODES, parse, parseOrThrow, resolve } from '../src/index.js'
import { scopesForProp } from '../src/scope-for-prop.js'

/**
 * The grammar half of ADR 0018: `textFills` on an `<Instance>`, the two
 * diagnostic codes the instance-box lint raises, and the scope that gates the
 * tokens a text colour may take.
 *
 * What the attribute does is the renderer's business. Here it is only a name
 * that belongs to one element, like `component`.
 */
const PAGE = (body: string) => `---\nid: t\n---\n\n## Visual Contract\n\n<Page>\n${body}\n</Page>\n`

const codes = (source: string): string[] => parse(source).diagnostics.map((d) => d.code)

describe('textFills in the grammar (ADR 0018 §4)', () => {
  it('is refused on anything but an <Instance>, as component is', () => {
    expect(codes(PAGE(`  <Frame name="f" textFills="{text#x}" />`))).toEqual([
      CODES.COMPONENT_ATTR_MISPLACED,
    ])
    expect(codes(PAGE(`  <Text name="t" characters="Hi" textFills="{text#x}" />`))).toEqual([
      CODES.COMPONENT_ATTR_MISPLACED,
    ])
  })

  it('names the attribute and the element it belongs to', () => {
    const [d] = parse(PAGE(`  <Frame name="f" textFills="{text#x}" />`)).diagnostics
    expect(d!.message).toContain('"textFills"')
    expect(d!.message).toContain('<Instance>')
  })

  it('parses clean on an <Instance> as a whole-attribute alias', () => {
    const source = PAGE(`  <Instance name="delete" component="B" textFills="{text#x}" />`)
    expect(codes(source)).toEqual([])
    const node = resolve(parseOrThrow(source).tree, 'delete')!
    expect(node.attrs.textFills!.value).toBe('{text#x}')
  })

  it('parses clean on an <Instance> as a paint list', () => {
    const source = PAGE(
      `  <Instance name="delete" component="B"\n` +
        `    textFills={[{ type: 'SOLID', color: '#ffffff' }]} />`,
    )
    expect(codes(source)).toEqual([])
    const node = resolve(parseOrThrow(source).tree, 'delete')!
    expect(node.attrs.textFills!.value).toEqual([{ type: 'SOLID', color: '#ffffff' }])
  })
})

describe('textFills scope', () => {
  // A text colour is a text's fills (ADR 0002), so it takes the tokens a
  // text's fills take, and nothing scoped only to frames or shapes.
  it('takes text-fill tokens and all-fill tokens', () => {
    expect(scopesForProp('textFills')).toEqual(['TEXT_FILL', 'ALL_FILLS'])
  })
})

describe('instance-box diagnostic codes', () => {
  it('appends UIDX154 and UIDX155 for the instance-box lint', () => {
    expect(CODES.INSTANCE_LOCKED_PROP).toBe('UIDX154')
    expect(CODES.INSTANCE_BOX_HINT).toBe('UIDX155')
  })

  it('never gives two names one code', () => {
    const values = Object.values(CODES)
    expect(new Set(values).size).toBe(values.length)
  })
})
