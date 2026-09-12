/**
 * Where a component's variants sit relative to each other (story F8).
 *
 * [ADR 0005](../../../docs/decisions/0005-variants.md) §5: the arrangement is
 * **generated, never authored**. It never appears in the file, never becomes a
 * patch, and is computed the same way twice — here for the canvas and, when F2
 * lands, for the `.fig` export, so the exported file opens looking like the
 * canvas did.
 *
 * That is the whole reason this is a function rather than auto-layout on the
 * set node: an exporter cannot ask a renderer where things ended up, and two
 * implementations of "where do the variants go" would drift the first time
 * either changed. It also deletes a class of Figma busywork — dragging variants
 * around inside the purple frame produces diffs there and produces nothing
 * here.
 */

/** Room between neighbouring variants, and between the outermost and the set's edge. */
export const VARIANT_GAP = 32
export const VARIANT_PADDING = 24

/** One variant, as measured after its own layout ran. */
export interface VariantBox {
  /** The derived name (`state=hover, size=sm`), which is also its address segment. */
  name: string
  /** Its coordinates, in declared axis order. */
  coordinates: ReadonlyMap<string, string>
  width: number
  height: number
}

export interface VariantPlacement {
  name: string
  x: number
  y: number
}

export interface VariantArrangement {
  placements: VariantPlacement[]
  /** The size the set node needs to contain them all, padding included. */
  width: number
  height: number
}

/**
 * The first axis along a row, every further axis stacking rows.
 *
 * Columns take the width of their widest variant and rows the height of their
 * tallest, so the result reads as a table rather than as a ragged pile — which
 * is the point of showing states side by side at all: structural drift between
 * them should be visible at a glance.
 *
 * A variant whose coordinates are unknown to the declaration is placed at the
 * end rather than dropped. Unreachable through `parse` — an error means no
 * document — but the renderer is handed mid-edit files, and a variant that
 * vanishes from the canvas while its row sits in the layers rail is a worse
 * thing to look at than one in the wrong cell.
 */
export function arrangeVariants(
  axes: ReadonlyMap<string, readonly string[]>,
  boxes: readonly VariantBox[],
): VariantArrangement {
  const [first, ...rest] = [...axes.keys()]

  const columnOf = (box: VariantBox): number => {
    if (first === undefined) return 0
    const index = (axes.get(first) ?? []).indexOf(box.coordinates.get(first) ?? '')
    return index === -1 ? (axes.get(first) ?? []).length : index
  }

  /** Rows are the remaining axes read together, in declared order. */
  const rowKeys: string[] = []
  const rowOf = (box: VariantBox): number => {
    const key = rest.map((axis) => `${axis}=${box.coordinates.get(axis) ?? ''}`).join(', ')
    const known = rowKeys.indexOf(key)
    if (known !== -1) return known
    rowKeys.push(key)
    return rowKeys.length - 1
  }

  const cells = boxes.map((box) => ({ box, column: columnOf(box), row: rowOf(box) }))

  const widths: number[] = []
  const heights: number[] = []
  for (const { box, column, row } of cells) {
    widths[column] = Math.max(widths[column] ?? 0, box.width)
    heights[row] = Math.max(heights[row] ?? 0, box.height)
  }

  /** Running offsets, so an empty column between two used ones takes no room. */
  const offsets = (sizes: readonly number[]): number[] => {
    const out: number[] = []
    let at = VARIANT_PADDING
    for (let i = 0; i < sizes.length; i++) {
      out[i] = at
      at += (sizes[i] ?? 0) + VARIANT_GAP
    }
    return out
  }
  const x = offsets(widths)
  const y = offsets(heights)

  const extent = (sizes: readonly number[]): number => {
    const used = sizes.filter((s) => s !== undefined && s > 0)
    if (!used.length) return VARIANT_PADDING * 2
    const total = used.reduce((a, b) => a + b, 0) + VARIANT_GAP * (used.length - 1)
    return total + VARIANT_PADDING * 2
  }

  return {
    placements: cells.map(({ box, column, row }) => ({
      name: box.name,
      x: x[column] ?? VARIANT_PADDING,
      y: y[row] ?? VARIANT_PADDING,
    })),
    width: extent(widths),
    height: extent(heights),
  }
}
