import { describe, expect, it } from 'vitest'
import { parseOrThrow } from '@uidx/format'
import { buildTokenIndex } from '@uidx/schema'
import type { Diagnostic, UidxDocument } from '@uidx/format'

import { homeModel, type HomeInput } from '../src/home-model'
import { pageEntries } from '../src/page-list'

const page = (id: string, body: string) =>
  parseOrThrow(`---
id: ${id}
---

## Visual Contract

<Page>
${body}
</Page>
`)

const SIGN_IN = page(
  'sign-in',
  `  <Frame name="screen" width={100} height={100}>
    <Text name="title" characters="Sign in" />
  </Frame>`,
)

const LIBRARY = page(
  'library',
  `  <Component name="Button/Primary" status="stable">
    <Frame name="box" width={40} height={20} />
  </Component>
  <Component name="Card/Basic" status="draft" variants={{ state: ['default', 'hover'] }}>
    <Variant state="default"><Frame name="a" width={10} height={10} /></Variant>
    <Variant state="hover"><Frame name="b" width={10} height={10} /></Variant>
  </Component>`,
)

const SETTINGS = page(
  'settings',
  `  <Frame name="screen" width={100} height={100}>
    <Instance name="save" component="Button/Primary" />
    <Instance name="cancel" component="Button/Primary" />
  </Frame>`,
)

const TOKENS = parseOrThrow(`---
id: core-tokens
---

## Visual Contract

<Tokens>
  <Collection name="color" modes={['light', 'dark']}>
    <Variable name="bg" type="COLOR">
      <Mode name="light" value={{ r: 1, g: 1, b: 1, a: 1 }} />
      <Mode name="dark" value={{ r: 0, g: 0, b: 0, a: 1 }} />
    </Variable>
    <Variable name="fg" type="COLOR">
      <Mode name="light" value={{ r: 0, g: 0, b: 0, a: 1 }} />
      <Mode name="dark" value={{ r: 1, g: 1, b: 1, a: 1 }} />
    </Variable>
  </Collection>
  <Collection name="radius">
    <Variable name="md" type="FLOAT" value={4} />
  </Collection>
</Tokens>
`)

const FILES = ['tokens.uidx', 'sign-in.uidx', 'library.uidx', 'settings.uidx']

function input(overrides: Partial<HomeInput> = {}): HomeInput {
  const docs = new Map<string, UidxDocument>([
    ['tokens.uidx', TOKENS],
    ['sign-in.uidx', SIGN_IN],
    ['library.uidx', LIBRARY],
    ['settings.uidx', SETTINGS],
  ])
  const announced = overrides.entries ? [] : FILES
  return {
    entries: pageEntries(announced, docs),
    docs,
    revisions: new Map([
      ['tokens.uidx', 1],
      ['sign-in.uidx', 4],
      ['library.uidx', 2],
      ['settings.uidx', 9],
    ]),
    diagnostics: new Map<string, Diagnostic[]>(),
    tokens: buildTokenIndex([...docs.values()]),
    ...overrides,
  }
}

describe('the dashboard model', () => {
  it('cards every page of the document, in the order the server sent', () => {
    const { cards } = homeModel(input())

    expect(cards.map((card) => card.file)).toEqual(FILES)
    expect(cards.map((card) => card.label)).toEqual([
      'core-tokens',
      'sign-in',
      'library',
      'settings',
    ])
  })

  it('separates a page that can be drawn from one that declares variables', () => {
    const kinds = new Map(homeModel(input()).cards.map((card) => [card.file, card.kind]))

    expect(kinds.get('sign-in.uidx')).toBe('scene')
    // The tile shows why there is no picture rather than an empty well.
    expect(kinds.get('tokens.uidx')).toBe('tokens')
  })

  it('marks a page the server announced but has not sent yet', () => {
    const model = homeModel(
      input({ entries: pageEntries([...FILES, 'ghost.uidx'], new Map()), docs: new Map() }),
    )

    expect(model.cards.at(-1)).toMatchObject({ file: 'ghost.uidx', kind: 'pending', nodes: 0 })
  })

  it('counts what each page declares, the root Page excluded', () => {
    const cards = new Map(homeModel(input()).cards.map((card) => [card.file, card]))

    // A frame and a text, not the <Page> that holds them.
    expect(cards.get('sign-in.uidx')).toMatchObject({ nodes: 2, components: 0, instances: 0 })
    expect(cards.get('settings.uidx')).toMatchObject({ instances: 2, components: 0 })
    expect(cards.get('library.uidx')).toMatchObject({ components: 2, variants: 2 })
  })

  it('totals declarations across the document rather than distinct names', () => {
    const { stats } = homeModel(input())

    expect(stats).toMatchObject({ pages: 4, scenes: 3, components: 2, variants: 2, instances: 2 })
  })

  it('reports the document that is on disk, not the pages that have arrived', () => {
    // A page announced but still in flight is still one of the document's pages;
    // a dashboard that counted three of four would be wrong for as long as the
    // socket took, which is exactly when somebody is looking at it.
    const model = homeModel(
      input({
        entries: pageEntries(FILES, new Map([['sign-in.uidx', SIGN_IN]])),
        docs: new Map([['sign-in.uidx', SIGN_IN]]),
      }),
    )

    expect(model.stats.pages).toBe(4)
  })

  it('counts variables per collection and names their modes', () => {
    const { collections, tokens } = homeModel(input()).stats

    expect(tokens).toBe(3)
    expect(collections).toEqual([
      { name: 'color', modes: ['light', 'dark'], variables: 2 },
      // A collection declaring no modes still has one, so the panel never has to
      // branch on "has modes" (`IMPLICIT_MODE`).
      { name: 'radius', modes: ['default'], variables: 1 },
    ])
  })

  it('carries each page its own revision, which is what a thumbnail is keyed on', () => {
    const cards = new Map(homeModel(input()).cards.map((card) => [card.file, card.revision]))

    expect(cards.get('settings.uidx')).toBe(9)
    expect(cards.get('sign-in.uidx')).toBe(4)
  })

  it('counts errors per page and broken pages for the document', () => {
    const error: Diagnostic = {
      code: 'E100',
      severity: 'error',
      message: 'nope',
      loc: { start: 0, end: 1 },
    } as Diagnostic
    const warning: Diagnostic = { ...error, severity: 'warning' }

    const model = homeModel(
      input({ diagnostics: new Map([['settings.uidx', [error, error, warning]]]) }),
    )
    const cards = new Map(model.cards.map((card) => [card.file, card]))

    // Warnings are not failures — the file still parsed and still renders.
    expect(cards.get('settings.uidx')?.errors).toBe(2)
    expect(model.stats.brokenPages).toBe(1)
  })

  it('reports an empty document without inventing a page', () => {
    const model = homeModel(input({ entries: [], docs: new Map(), tokens: buildTokenIndex([]) }))

    expect(model.cards).toEqual([])
    expect(model.stats).toMatchObject({ pages: 0, scenes: 0, tokens: 0, brokenPages: 0 })
  })
})
