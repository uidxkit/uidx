/**
 * Which page of the document the address bar is on.
 *
 * The pages rail changes what the canvas draws, which makes "which page" part
 * of where the author *is* — so it belongs in the URL, where a reload holds it,
 * back and forward walk it, and a link to a particular sheet can be sent to
 * somebody else. Held as a query parameter rather than a path segment because
 * the viewer is served at the root and has no router.
 *
 * Pure string functions, apart from `window`, so the shell's own wiring is the
 * only part of this that cannot be tested headlessly.
 */

const PARAM = 'page'

/** The page a URL asks for, or null if it does not ask. */
export function pageInUrl(href: string): string | null {
  return new URL(href).searchParams.get(PARAM)
}

/**
 * The same URL, saying which page is open.
 *
 * `searchParams.set` rather than string concatenation: a page id is a
 * workspace-relative path and so contains `/`, which has to be escaped on the
 * way in and unescaped on the way out, and any other query the URL was carrying
 * has to survive.
 */
export function urlWithPage(href: string, file: string): string {
  const url = new URL(href)
  url.searchParams.set(PARAM, file)
  return url.toString()
}

/**
 * The page to open on connect: the URL's, if this document has it.
 *
 * A URL naming a page the document does not have is not an error worth
 * reporting — it is a link from another document, or a page deleted since it
 * was sent. Falling back to the entry page the server chose shows something
 * real, and the shell rewrites the URL to match, so the address bar never keeps
 * claiming a page that is not on screen.
 */
export function pageToOpen(href: string, pages: readonly string[], entry: string): string {
  const wanted = pageInUrl(href)
  return wanted !== null && pages.includes(wanted) ? wanted : entry
}

/**
 * Home is the absence of a page, not a page called "home".
 *
 * A sentinel value in `?page=` would be a page id that names no file, and every
 * function above is written against ids that are workspace-relative paths — one
 * of which could legitimately *be* `home.uidx`, as three of the four design
 * options in this repo prove. So the dashboard is what a URL carrying no page
 * means, which also makes the app's own root URL land there with nothing to
 * encode.
 */
export type View =
  | { kind: 'home' }
  | { kind: 'page'; file: string }
  /**
   * The same page, shown as its tokens rather than its scene (spec: tokens
   * view §1). A second parameter beside `page` rather than a page sentinel,
   * for the same reason home is an absence: page ids are paths and any
   * spelling of "tokens" could be one.
   */
  | { kind: 'tokens'; file: string }
  | { kind: 'fonts'; file: string }

export const HOME: View = { kind: 'home' }

const VIEW_PARAM = 'view'

/** The same URL, saying which view is open — home drops the parameter. */
export function urlWithView(href: string, view: View): string {
  const url = new URL(view.kind === 'home' ? href : urlWithPage(href, view.file))
  if (view.kind === 'home') url.searchParams.delete(PARAM)
  if (view.kind === 'tokens' || view.kind === 'fonts') url.searchParams.set(VIEW_PARAM, view.kind)
  else url.searchParams.delete(VIEW_PARAM)
  return url.toString()
}

/**
 * The page view of a `<Tokens>` page IS its tokens view (spec §1): there is no
 * scene to draw, so the old placeholder becomes a real face. The shell calls
 * this wherever a page view lands, with the root element once the page's
 * document is known; anything but that one combination passes through.
 */
export function upgradedView(view: View, rootElement: string | null): View {
  if (view.kind === 'page' && rootElement === 'Tokens') return { kind: 'tokens', file: view.file }
  return view
}

/** A bare viewer URL always shows the workspace; a page URL opens that page. */
export function viewToOpen(href: string, pages: readonly string[], entry: string): View {
  if (pages.length === 0) return HOME
  const wanted = pageInUrl(href)
  if (wanted !== null && pages.includes(wanted)) {
    // An unknown value falls through to the page view: a link from a future
    // version should still show the page rather than nothing.
    const view = new URL(href).searchParams.get(VIEW_PARAM)
    return view === 'tokens' || view === 'fonts'
      ? { kind: view, file: wanted }
      : { kind: 'page', file: wanted }
  }
  if (wanted === null) return HOME
  return { kind: 'page', file: entry }
}
