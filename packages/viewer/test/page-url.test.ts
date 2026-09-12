import { describe, expect, it } from 'vitest'

import {
  HOME,
  pageInUrl,
  pageToOpen,
  upgradedView,
  urlWithPage,
  urlWithView,
  viewToOpen,
} from '../src/page-url'

const AT = 'http://localhost:4461/'

describe('the open page, in the URL', () => {
  it('reads the page a link asks for', () => {
    expect(pageInUrl(`${AT}?page=home.uidx`)).toBe('home.uidx')
    expect(pageInUrl(AT)).toBeNull()
  })

  it('survives a path with separators in it', () => {
    // Pages are workspace-relative, so a document with folders in it has `/`
    // in its page ids — which has to come back out exactly as it went in.
    const url = urlWithPage(AT, 'screens/sign-in.uidx')

    expect(pageInUrl(url)).toBe('screens/sign-in.uidx')
  })

  it('replaces the page rather than appending a second one', () => {
    const once = urlWithPage(`${AT}?page=home.uidx`, 'studio.uidx')

    expect(pageInUrl(once)).toBe('studio.uidx')
    expect(once.match(/page=/g)).toHaveLength(1)
  })

  it('keeps every other query the URL was carrying', () => {
    expect(urlWithPage(`${AT}?debug=1`, 'home.uidx')).toContain('debug=1')
  })

  it('opens what the URL names when the document has that page', () => {
    expect(pageToOpen(`${AT}?page=studio.uidx`, ['home.uidx', 'studio.uidx'], 'home.uidx')).toBe(
      'studio.uidx',
    )
  })

  it("falls back to the server's entry when the URL names a page this document lacks", () => {
    // A link pasted from another document, or a page since deleted. Opening the
    // entry page beats an empty canvas and a URL nobody can act on.
    expect(pageToOpen(`${AT}?page=ghost.uidx`, ['home.uidx'], 'home.uidx')).toBe('home.uidx')
  })

  it("falls back to the server's entry when the URL says nothing", () => {
    expect(pageToOpen(AT, ['home.uidx', 'studio.uidx'], 'studio.uidx')).toBe('studio.uidx')
  })

  it('says home for a URL that asks for no page', () => {
    expect(viewToOpen(AT, ['home.uidx', 'studio.uidx'], 'studio.uidx')).toEqual(HOME)
    expect(viewToOpen(`${AT}?page=deleted.uidx`, [], '')).toEqual(HOME)
  })

  it('shows the overview even for a workspace with one page', () => {
    expect(viewToOpen(AT, ['only.uidx'], 'only.uidx')).toEqual(HOME)
    expect(viewToOpen(`${AT}?page=only.uidx`, ['only.uidx'], 'only.uidx')).toEqual({
      kind: 'page',
      file: 'only.uidx',
    })
  })

  it('still opens the page a link names', () => {
    expect(viewToOpen(`${AT}?page=studio.uidx`, ['home.uidx', 'studio.uidx'], 'home.uidx')).toEqual(
      {
        kind: 'page',
        file: 'studio.uidx',
      },
    )
  })

  it('falls back to the entry page, not home, when the URL names a page this document lacks', () => {
    // The URL did ask for something. Answering with the dashboard would silently
    // drop the request; the entry page is the same fallback `pageToOpen` makes.
    expect(viewToOpen(`${AT}?page=ghost.uidx`, ['home.uidx', 'studio.uidx'], 'home.uidx')).toEqual({
      kind: 'page',
      file: 'home.uidx',
    })
  })

  it('drops the page parameter for home, so the root URL is the dashboard', () => {
    const url = urlWithView(`${AT}?page=studio.uidx&debug=1`, HOME)

    expect(pageInUrl(url)).toBeNull()
    // Everything else the URL was carrying survives, as it does for a page.
    expect(url).toContain('debug=1')
  })

  it('round-trips a page view through the URL', () => {
    const url = urlWithView(AT, { kind: 'page', file: 'screens/sign-in.uidx' })

    expect(viewToOpen(url, ['screens/sign-in.uidx'], 'screens/sign-in.uidx')).toEqual({
      kind: 'page',
      file: 'screens/sign-in.uidx',
    })
  })

  it('round-trips a tokens view through the URL', () => {
    const url = urlWithView(AT, { kind: 'tokens', file: 'core-tokens.uidx' })

    expect(viewToOpen(url, ['core-tokens.uidx', 'home.uidx'], 'home.uidx')).toEqual({
      kind: 'tokens',
      file: 'core-tokens.uidx',
    })
  })

  it('switching views rewrites, never accumulates, the view parameter', () => {
    const there = urlWithView(AT, { kind: 'tokens', file: 'core-tokens.uidx' })
    const back = urlWithView(there, { kind: 'page', file: 'core-tokens.uidx' })

    expect(viewToOpen(back, ['core-tokens.uidx', 'home.uidx'], 'home.uidx')).toEqual({
      kind: 'page',
      file: 'core-tokens.uidx',
    })
  })

  it('upgrades the page view of a <Tokens> page to its tokens view', () => {
    expect(upgradedView({ kind: 'page', file: 'core.uidx' }, 'Tokens')).toEqual({
      kind: 'tokens',
      file: 'core.uidx',
    })
    // Everything else passes through untouched.
    expect(upgradedView({ kind: 'page', file: 'home.uidx' }, 'Page')).toEqual({
      kind: 'page',
      file: 'home.uidx',
    })
    expect(upgradedView({ kind: 'page', file: 'home.uidx' }, null)).toEqual({
      kind: 'page',
      file: 'home.uidx',
    })
    expect(upgradedView(HOME, 'Tokens')).toEqual(HOME)
  })

  it('treats an unknown view parameter as the page view', () => {
    expect(
      viewToOpen(`${AT}?page=home.uidx&view=orbit`, ['home.uidx', 'core-tokens.uidx'], 'home.uidx'),
    ).toEqual({ kind: 'page', file: 'home.uidx' })
  })
  it('keeps the Fonts workspace page through links and reloads', () => {
    const view = { kind: 'fonts' as const, file: 'home.uidx' }
    const url = urlWithView(AT, view)
    expect(new URL(url).searchParams.get('view')).toBe('fonts')
    expect(viewToOpen(url, ['home.uidx'], 'home.uidx')).toEqual(view)
    expect(upgradedView(view, 'Tokens')).toEqual(view)
    expect(
      new URL(urlWithView(url, { kind: 'page', file: 'home.uidx' })).searchParams.has('view'),
    ).toBe(false)
  })
})
