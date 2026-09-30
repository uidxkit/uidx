/**
 * Headers for a component set drawn on the canvas: which value each column
 * and each row of the grid is. `arrangeVariants` lays the first axis out as
 * columns and the remaining axes, read together, as rows; without headers a
 * seventy-two cell button is a wall of buttons nobody can name.
 *
 * Pure: cells in canvas units in, label anchors in canvas units out.
 */
export interface VariantCell {
  /** The variant's name, `size=sm, state=hover` (ADR 0005 §3). */
  name: string
  x: number
  y: number
  width: number
  height: number
}

export interface VariantLabel {
  text: string
  /** Canvas units the label may take before the next column starts. */
  width?: number
  /** Canvas units: the column's left edge, or the row's vertical centre. */
  x: number
  y: number
}

export interface VariantHeaders {
  /** The first axis, named once beside the column labels, which carry values only. */
  columnAxis?: string
  columns: VariantLabel[]
  rows: VariantLabel[]
}

/** `a=1, b=2` → [['a','1'], ['b','2']]; a name without `=` is not a variant name. */
export function variantCoordinates(name: string): [string, string][] | null {
  const pairs = name.split(',').map((part) => part.trim().split('='))
  if (!pairs.length || pairs.some((pair) => pair.length !== 2 || !pair[0])) return null
  return pairs.map(([axis, value]) => [axis!.trim(), value!.trim()])
}

export function variantHeaders(cells: readonly VariantCell[]): VariantHeaders {
  const parsed = cells
    .map((cell) => ({ cell, coords: variantCoordinates(cell.name) }))
    .filter((entry): entry is { cell: VariantCell; coords: [string, string][] } => !!entry.coords)
  if (parsed.length < 2) return { columns: [], rows: [] }
  const top = Math.min(...parsed.map(({ cell }) => cell.y))
  const left = Math.min(...parsed.map(({ cell }) => cell.x))

  const columns = new Map<string, VariantLabel>()
  const rows = new Map<string, { label: VariantLabel; top: number; bottom: number }>()
  for (const { cell, coords } of parsed) {
    const [first, ...rest] = coords
    // Columns carry the value; the axis is named once (`columnAxis`).
    const column = first![1]
    const known = columns.get(column)
    if (!known || cell.x < known.x)
      columns.set(column, { text: column, x: cell.x, y: top, width: cell.width })
    if (!rest.length) continue
    const row = rest.map(([axis, value]) => `${axis}=${value}`).join(', ')
    const span = rows.get(row)
    const cellTop = cell.y
    const cellBottom = cell.y + cell.height
    if (!span)
      rows.set(row, { label: { text: row, x: left, y: 0 }, top: cellTop, bottom: cellBottom })
    else {
      span.top = Math.min(span.top, cellTop)
      span.bottom = Math.max(span.bottom, cellBottom)
    }
  }
  const many = columns.size > 1
  return {
    ...(many ? { columnAxis: parsed[0]!.coords[0]![0] } : {}),
    // One column means the set has one value on its first axis: nothing to tell apart.
    columns: many ? spaced([...columns.values()].sort((a, b) => a.x - b.x)) : [],
    rows: [...rows.values()]
      .map(({ label, top: t, bottom }) => ({ ...label, y: (t + bottom) / 2 }))
      .sort((a, b) => a.y - b.y),
  }
}

/** Each column's room is the gap to the next. */
function spaced(columns: VariantLabel[]): VariantLabel[] {
  return columns.map((column, at) => ({
    ...column,
    width: Math.max(column.width ?? 0, (columns[at + 1]?.x ?? Infinity) - column.x - 4),
  }))
}
