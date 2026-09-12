import { describe, expect, it } from 'vitest'
import { CODES, componentProps, instanceProps, parse, parseOrThrow, resolve } from '../src/index.js'

/**
 * A component declaring what its consumers may change (story F6).
 *
 * Only the *shape* is a parse-time question. Whether a `{label}` binding finds
 * one of these is about the whole subtree rather than one tag, so it lives with
 * every other "does this reference resolve" question in `buildSymbolTable`.
 */
const page = (body: string) => `---\nid: t\n---\n\n## Visual Contract\n\n<Page>\n${body}\n</Page>\n`

const codes = (source: string): string[] => parse(source).diagnostics.map((d) => d.code)

const component = (props: string, body = '<Frame name="root" />') =>
  page(`  <Component name="C" status="draft" props={${props}}>\n    ${body}\n  </Component>`)

describe('declaring properties', () => {
  it('reads a well-formed declaration', () => {
    const doc = parseOrThrow(
      component(`{
      label: { type: 'TEXT', default: 'Click me' },
      showIcon: { type: 'BOOLEAN', default: true },
      icon: { type: 'INSTANCE_SWAP', default: 'Icon/Check' },
    }`),
    )
    const { declared, problems } = componentProps(resolve(doc.tree, 'C')!)
    expect(problems).toEqual([])
    expect([...declared]).toEqual([
      ['label', { type: 'TEXT', default: 'Click me' }],
      ['showIcon', { type: 'BOOLEAN', default: true }],
      ['icon', { type: 'INSTANCE_SWAP', default: 'Icon/Check' }],
    ])
  })

  it('is absent, and that is not a problem', () => {
    const doc = parseOrThrow(
      page(`  <Component name="C" status="draft"><Frame name="r" /></Component>`),
    )
    expect(componentProps(resolve(doc.tree, 'C')!)).toEqual({ declared: new Map(), problems: [] })
  })

  it('refuses a declaration that is not a map of entries', () => {
    expect(codes(component(`['label']`))).toEqual([CODES.BAD_COMPONENT_PROPS])
    expect(codes(component(`{ label: 'TEXT' }`))).toEqual([CODES.BAD_COMPONENT_PROPS])
  })

  it('refuses a type it does not have', () => {
    expect(codes(component(`{ label: { type: 'COLOR', default: 'x' } }`))).toEqual([
      CODES.BAD_COMPONENT_PROPS,
    ])
    // VARIANT is the SDK's fourth and is deliberately not one of ours: ADR 0005
    // gives a component's states their own grammar.
    expect(codes(component(`{ size: { type: 'VARIANT', default: 'lg' } }`))).toEqual([
      CODES.BAD_COMPONENT_PROPS,
    ])
  })

  it('requires a default, because an unset instance has to show something', () => {
    expect(codes(component(`{ label: { type: 'TEXT' } }`))).toEqual([CODES.BAD_COMPONENT_PROPS])
  })

  it('requires the default to be what the type promises', () => {
    expect(codes(component(`{ label: { type: 'TEXT', default: 12 } }`))).toEqual([
      CODES.BAD_COMPONENT_PROPS,
    ])
    // A real boolean, not the SDK's stringified one — two spellings of truth in
    // the authored surface is how a format starts lying.
    expect(codes(component(`{ on: { type: 'BOOLEAN', default: 'true' } }`))).toEqual([
      CODES.BAD_COMPONENT_PROPS,
    ])
    expect(codes(component(`{ on: { type: 'BOOLEAN', default: false } }`))).toEqual([])
  })

  it('refuses a name that would read as a token', () => {
    // `{radius#md}` is a token by construction, so a property may not be named
    // in a way that spells one.
    expect(codes(component(`{ 'radius#md': { type: 'TEXT', default: 'x' } }`))).toEqual([
      CODES.BAD_COMPONENT_PROPS,
    ])
  })

  it('reports every bad entry, not only the first', () => {
    // One diagnostic each, so a file with three mistakes needs one pass rather
    // than three saves. An error means `parse` yields no document at all, which
    // is why this reads the diagnostics rather than the tree.
    const { diagnostics } = parse(
      component(`{ a: { type: 'NOPE', default: 1 }, b: { type: 'TEXT' } }`),
    )
    expect(diagnostics).toHaveLength(2)
    expect(diagnostics[0]!.message).toContain('"a"')
    expect(diagnostics[1]!.message).toContain('"b"')
  })

  it('keeps the entries it understood, for a caller holding a node directly', () => {
    // `componentProps` drops a bad entry and keeps the rest rather than
    // refusing the map whole. Unreachable through `parse` — an error means no
    // document — but it is what lets the panel show what it can (F6's own UI)
    // instead of going blank on one typo.
    const node = {
      attrs: {
        props: {
          value: {
            good: { type: 'TEXT', default: 'x' },
            bad: { type: 'NOPE', default: 1 },
          },
        },
      },
    }
    const { declared, problems } = componentProps(node as never)
    expect([...declared.keys()]).toEqual(['good'])
    expect(problems.map((p) => p.name)).toEqual(['bad'])
  })

  it('belongs to <Component> and nowhere else', () => {
    // In `KNOWN_PROPS`, so without this it would be spelled correctly and do
    // nothing — the quietest way for a file to be wrong.
    expect(
      codes(page(`  <Frame name="f" props={{ a: { type: 'TEXT', default: 'x' } }} />`)),
    ).toEqual([CODES.COMPONENT_ATTR_MISPLACED])
  })
})

/**
 * An instance assigning them (story F7).
 *
 * The same attribute name on both sides of the contract: `props` on a
 * `<Component>` declares the list, `props` on an `<Instance>` fills it in.
 * Reading either is reading the same set of names, so one word rather than two.
 * Their shapes differ — a declaration is `{ type, default }`, an assignment is
 * the value itself — so the parser checks them apart.
 */
describe('assigning properties', () => {
  const instance = (props: string) =>
    page(`  <Instance name="save" component="Button" props={${props}} />`)

  it('reads text and boolean values', () => {
    const doc = parseOrThrow(instance(`{ label: 'Save', showIcon: false }`))
    const { values, problems } = instanceProps(resolve(doc.tree, 'save')!)
    expect(problems).toEqual([])
    expect([...values]).toEqual([
      ['label', 'Save'],
      ['showIcon', false],
    ])
  })

  it('is absent, and that is not a problem', () => {
    const doc = parseOrThrow(page(`  <Instance name="save" component="Button" />`))
    expect(instanceProps(resolve(doc.tree, 'save')!)).toEqual({
      values: new Map(),
      problems: [],
    })
  })

  it('refuses anything that is not a map of values', () => {
    expect(codes(instance(`['label']`))).toEqual([CODES.BAD_COMPONENT_PROPS])
  })

  it('refuses a value neither text nor true/false', () => {
    // Not a number and not a nested object: the three property types carry a
    // string or a boolean, and anything else is a value nothing could consume.
    expect(codes(instance(`{ label: 12 }`))).toEqual([CODES.BAD_COMPONENT_PROPS])
    expect(codes(instance(`{ label: { default: 'Save' } }`))).toEqual([CODES.BAD_COMPONENT_PROPS])
  })

  it("refuses a declaration's shape here, which is the mistake worth catching", () => {
    // Copying the component's own line into the instance. It parses, so
    // nothing else would notice.
    expect(codes(instance(`{ label: { type: 'TEXT', default: 'Save' } }`))).toEqual([
      CODES.BAD_COMPONENT_PROPS,
    ])
  })

  it('refuses a name that would read as a token', () => {
    expect(codes(instance(`{ 'radius#md': 'x' }`))).toEqual([CODES.BAD_COMPONENT_PROPS])
  })

  it('does not check the value against the component, which is not a parse question', () => {
    // The definition may be pages away, so "does Button declare `tone`" lives
    // with every other cross-page question in `buildSymbolTable` (UIDX405).
    expect(codes(instance(`{ tone: 'quiet' }`))).toEqual([])
  })
})
