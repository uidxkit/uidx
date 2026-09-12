import { ancestorsOf, type LayerRow } from './layer-rows'

/**
 * What a key means for the layers rail, decided without Vue or the DOM.
 *
 * `move` carries the address focus should land on — the rail then selects
 * it, which is also what moves the roving tabindex, since selection and
 * focus are one concept here. `expand`/`collapse` leave the address alone
 * and only ask the rail to flip its own `collapsed` set; `rename` asks it
 * to open the box already behind `startRename`.
 */
export type LayerKeyIntent =
  { kind: 'move'; address: string } | { kind: 'expand' } | { kind: 'collapse' } | { kind: 'rename' }

/**
 * Turns (visible rows, the focused address, whether that row is expanded,
 * the key) into an intent, or `null` for a key that does nothing here.
 *
 * `rows` is the *visible* list — exactly what `visibleRows` produces — so
 * ArrowDown/Up walk it directly rather than re-deriving what collapse hides.
 * `expanded` is passed in rather than looked up, because that state lives in
 * `LayersPane`'s `collapsed` set, not in the row itself.
 */
export function keyIntent(
  rows: readonly LayerRow[],
  address: string,
  expanded: boolean,
  key: string,
): LayerKeyIntent | null {
  const index = rows.findIndex((r) => r.address === address)
  if (index === -1) return null
  const row = rows[index]!

  switch (key) {
    case 'ArrowDown':
      return index < rows.length - 1 ? { kind: 'move', address: rows[index + 1]!.address } : null

    case 'ArrowUp':
      return index > 0 ? { kind: 'move', address: rows[index - 1]!.address } : null

    case 'Home':
      return { kind: 'move', address: rows[0]!.address }

    case 'End':
      return { kind: 'move', address: rows[rows.length - 1]!.address }

    case 'ArrowRight': {
      if (!row.hasChildren) return null
      if (!expanded) return { kind: 'expand' }
      // Expanded means the next row in document order is the first child —
      // visibleRows never hides a child of a row that is itself expanded.
      const child = rows[index + 1]
      return child && child.depth === row.depth + 1
        ? { kind: 'move', address: child.address }
        : null
    }

    case 'ArrowLeft': {
      if (row.hasChildren && expanded) return { kind: 'collapse' }
      // Collapsed, or a leaf: climb. The nearest ancestor is the last entry
      // ancestorsOf returns; the root has none, so ArrowLeft there is a no-op.
      const ancestors = ancestorsOf(row.address)
      const parent = ancestors[ancestors.length - 1]
      return parent !== undefined ? { kind: 'move', address: parent } : null
    }

    case 'Enter':
      return { kind: 'rename' }

    default:
      return null
  }
}
