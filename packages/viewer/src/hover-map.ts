import type { UidxNode } from '@uidx/format'
import { instanceBase, instanceDefinition, instanceRole } from '@uidx/schema'
import type { InstanceScope } from './resize-writes'

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

/**
 * Which node the hovered row lights: `id`, where the selected layer is drawn,
 * unless the layer is an instance and the row is one of its outer box (ADR
 * 0018 §2). That box is drawn on the frame its component wraps — through any
 * frame that only wraps another — or through a composition on the frame of
 * the instance it holds, and the instance's own node is only the wrapper
 * around it, with no padding to tint. A component that lays itself out draws
 * its box on the instance itself, unless all it does is wrap one frame.
 */
export function hoverNodeFor(
  prop: string,
  id: string,
  layer: UidxNode | null,
  scope: InstanceScope,
): string {
  if (layer?.element !== 'Instance' || instanceRole(prop) !== 'box') return id
  const base = instanceBase({ ...layer, address: id }, instanceDefinition(layer, scope), scope)
  return base?.target.id ?? id
}
