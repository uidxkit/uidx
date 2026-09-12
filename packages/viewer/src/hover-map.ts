/**
 * What the canvas lights up while a control in the panel is hovered (story
 * C9). Figma answers a hovered padding field by tinting that band on the
 * frame, and this table is the whole of that judgement — the components only
 * report which prop the cursor is over.
 */
export type HoverTarget =
  | { kind: 'node' }
  | { kind: 'spacing-value' }
  | { kind: 'padding-value'; side: 'top' | 'right' | 'bottom' | 'left' }
  | { kind: 'children' }

const PADDING_SIDES: Record<string, 'top' | 'right' | 'bottom' | 'left'> = {
  paddingTop: 'top',
  paddingRight: 'right',
  paddingBottom: 'bottom',
  paddingLeft: 'left',
}

/** Props whose meaning is "how the children sit", so the children light up. */
const CHILDREN_PROPS: ReadonlySet<string> = new Set([
  'layoutMode',
  'layoutWrap',
  'primaryAxisAlignItems',
  'counterAxisAlignItems',
  'counterAxisAlignContent',
])

/** Props that describe the node's own box, so the node lights up. */
const NODE_PROPS: ReadonlySet<string> = new Set([
  'x',
  'y',
  'width',
  'height',
  'rotation',
  'cornerRadius',
  'topLeftRadius',
  'topRightRadius',
  'bottomLeftRadius',
  'bottomRightRadius',
  'minWidth',
  'maxWidth',
  'minHeight',
  'maxHeight',
])

/** What the canvas should light up while this prop's control is hovered. Null: nothing. */
export function hoverTargetFor(prop: string): HoverTarget | null {
  if (prop === 'itemSpacing' || prop === 'counterAxisSpacing') return { kind: 'spacing-value' }
  const side = PADDING_SIDES[prop]
  if (side) return { kind: 'padding-value', side }
  if (CHILDREN_PROPS.has(prop)) return { kind: 'children' }
  if (NODE_PROPS.has(prop)) return { kind: 'node' }
  return null
}
