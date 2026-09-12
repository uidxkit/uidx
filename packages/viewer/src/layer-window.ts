/**
 * Which rows of the layers rail are worth putting in the DOM.
 *
 * The rail draws one row per node, and a page like Meridian's atlas has eleven
 * thousand of them. Mounting them all costs ~90k DOM nodes: 400ms to lay out,
 * 375ms for Vue to re-diff on every selection or patch, and — the part that
 * reaches the canvas — a 15–20ms document relayout for *any* DOM write while
 * they exist, which a pan does once per frame. Rendering only the rows that
 * intersect the scroll viewport, plus a margin so a wheel tick lands on rows
 * that already exist, makes all of that proportional to the pane, not the page.
 *
 * Pure arithmetic, so the window is testable without a DOM: every row is
 * `rowHeight` tall (the rail's `--row-h`), so a scroll offset maps to an index
 * by division, not by measuring.
 */

/** The rail's `--row-h`, in CSS pixels. The stylesheet and this must agree. */
export const ROW_HEIGHT = 24

/** Rows rendered beyond each edge of the viewport, so a small scroll needs no re-render. */
export const OVERSCAN = 8

export interface RowWindow {
  /** Index of the first rendered row, inclusive. */
  start: number
  /** Index past the last rendered row. */
  end: number
}

/**
 * The slice of `total` rows that covers a viewport `height` tall scrolled to
 * `scrollTop`, widened by `overscan` rows on each side and clamped to the list.
 *
 * A viewport of no height means "not measured yet" (first paint, or jsdom),
 * and the answer for that is the whole list rather than nothing: an empty rail
 * on mount is a visible flicker, and the overscan alone would not cover a
 * short tree.
 */
export function rowWindow(
  total: number,
  scrollTop: number,
  height: number,
  rowHeight = ROW_HEIGHT,
  overscan = OVERSCAN,
): RowWindow {
  if (total <= 0) return { start: 0, end: 0 }
  if (!(height > 0) || !(rowHeight > 0)) return { start: 0, end: total }
  const top = Math.max(0, scrollTop)
  const first = Math.floor(top / rowHeight)
  const last = Math.ceil((top + height) / rowHeight)
  return {
    start: Math.max(0, Math.min(total, first - overscan)),
    end: Math.max(0, Math.min(total, last + overscan)),
  }
}

/**
 * The scroll offset that brings row `index` into a viewport `height` tall,
 * moving as little as possible — `scrollIntoView({ block: 'nearest' })` for a
 * row that is not in the DOM yet. Returns the current offset when the row is
 * already fully visible, so a caller can tell "nothing to do" from a move.
 */
export function scrollTopFor(
  index: number,
  scrollTop: number,
  height: number,
  rowHeight = ROW_HEIGHT,
): number {
  const rowTop = index * rowHeight
  const rowBottom = rowTop + rowHeight
  if (rowTop < scrollTop) return rowTop
  if (height > 0 && rowBottom > scrollTop + height) return rowBottom - height
  return scrollTop
}
