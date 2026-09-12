/**
 * Collapse models for the multi-prop fields (story C9).
 *
 * Figma shows padding as one field per axis while the pair agrees and four
 * fields the moment it does not, and corner radius the same way across all
 * four corners. Both decisions are arithmetic, so they live here under tests
 * rather than inside a component — and the four prop names each collapsed
 * field stands for are written down exactly once, here.
 */
export interface SideValues {
  top: number
  right: number
  bottom: number
  left: number
}

export interface CollapsedModel {
  /** Both members equal → one field; else null and the UI expands. */
  horizontal: number | null
  vertical: number | null
}

export function paddingModel(values: SideValues): CollapsedModel {
  return {
    horizontal: values.left === values.right ? values.left : null,
    vertical: values.top === values.bottom ? values.top : null,
  }
}

/** The prop-name→value writes one collapsed padding field implies. */
export function paddingWrites(
  axis: 'horizontal' | 'vertical',
  value: number,
): Array<{ prop: string; value: number }> {
  return axis === 'horizontal'
    ? [
        { prop: 'paddingLeft', value },
        { prop: 'paddingRight', value },
      ]
    : [
        { prop: 'paddingTop', value },
        { prop: 'paddingBottom', value },
      ]
}

export interface CornerModel {
  /** All four equal → one field. */
  uniform: number | null
}

export function cornerModel(values: SideValues): CornerModel {
  const { top, right, bottom, left } = values
  return { uniform: top === right && right === bottom && bottom === left ? top : null }
}

/** The four corner props one uniform radius stands for, clockwise from top-left. */
export function cornerWrites(value: number): Array<{ prop: string; value: number }> {
  return [
    { prop: 'topLeftRadius', value },
    { prop: 'topRightRadius', value },
    { prop: 'bottomRightRadius', value },
    { prop: 'bottomLeftRadius', value },
  ]
}
