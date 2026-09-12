import type { PropGroup } from '@uidx/schema'
import type { PairedField } from './editable'

export interface InspectorGroup {
  id: string
  label?: string
  advanced?: boolean
  fields: PairedField[]
}

type GroupSpec = Omit<InspectorGroup, 'fields'> & { props?: readonly string[] }

const GROUPS: Partial<Record<PropGroup, readonly GroupSpec[]>> = {
  layout: [
    {
      id: 'size-limits',
      label: 'Size limits',
      advanced: true,
      props: ['minWidth', 'maxWidth', 'minHeight', 'maxHeight'],
    },
    { id: 'layout-direction', label: 'Auto layout', props: ['layoutMode'] },
    { id: 'layout-spacing', props: ['layoutWrap', 'itemSpacing', 'counterAxisSpacing'] },
    { id: 'layout-main' },
    {
      id: 'layout-options',
      label: 'Layout options',
      advanced: true,
      props: ['counterAxisAlignContent', 'itemReverseZIndex', 'strokesIncludedInLayout'],
    },
  ],
  appearance: [
    { id: 'appearance-main' },
    {
      id: 'layer-options',
      label: 'Layer options',
      advanced: true,
      props: ['isMask', 'maskType', 'locked'],
    },
  ],
  stroke: [
    { id: 'stroke-main' },
    {
      id: 'stroke-options',
      label: 'Stroke details',
      advanced: true,
      props: [
        'strokeCap',
        'strokeJoin',
        'strokeMiterLimit',
        'dashPattern',
        'strokeTopWeight',
        'strokeRightWeight',
        'strokeBottomWeight',
        'strokeLeftWeight',
      ],
    },
  ],
  typography: [
    { id: 'typography-main' },
    {
      id: 'type-options',
      label: 'Text options',
      advanced: true,
      props: ['italic', 'textCase', 'textDecoration', 'maxLines', 'textTruncation'],
    },
  ],
}

/** Presentation only: every supplied row appears exactly once, including
 * future properties. A paired control always stays together, with its bindings.
 */
export function inspectorGroups(section: PropGroup, fields: PairedField[]): InspectorGroup[] {
  const specs = GROUPS[section] ?? [{ id: `${section}-main` }]
  const owner = (row: PairedField) => specs.find((spec) => spec.props?.includes(row.field.name))?.id
  return specs
    .map(({ props: _props, ...spec }) => ({
      ...spec,
      fields: fields.filter(
        (row) => owner(row) === spec.id || (!owner(row) && spec.id.endsWith('-main')),
      ),
    }))
    .filter((group) => group.fields.length > 0)
}
