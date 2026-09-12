import { h, type FunctionalComponent, type PropType } from 'vue'

/**
 * The inspector's glyph set (story C9): one table of 12×12 stroke paths, one
 * renderer. Icons are data so the theme owns their colour (`currentColor`)
 * and a review can diff a glyph like any other value.
 */
export const ICON_PATHS = {
  // Component-property glyphs (the binding UI): one per type, plus the two
  // controls a linked row carries.
  'prop-text': 'M2 2 H10 V10 H2 Z M4 4.5 H8 M6 4.5 V8',
  'prop-boolean':
    'M1.5 6 A 4.5 3.2 0 0 1 10.5 6 A 4.5 3.2 0 0 1 1.5 6 M6 4.6 A 1.4 1.4 0 1 1 6 7.4 A 1.4 1.4 0 1 1 6 4.6',
  'prop-instance': 'M6 1.5 L10.5 6 L6 10.5 L1.5 6 Z',
  'apply-property':
    'M6 1.2 A 4.8 4.8 0 1 1 6 10.8 A 4.8 4.8 0 1 1 6 1.2 M6 3.9 A 2.1 2.1 0 1 1 6 8.1 A 2.1 2.1 0 1 1 6 3.9',
  'unlink-property':
    'M4.6 7.4 L3.1 8.9 A 2.1 2.1 0 0 1 3.1 5.9 L4.3 4.7 M7.4 4.6 L8.9 3.1 A 2.1 2.1 0 0 1 8.9 6.1 L7.7 7.3 M2 2 L10 10',
  // Figma's adjust-sliders glyph: the popup row's "edit this property".
  'edit-property':
    'M2 4 H5.7 M8.3 4 H10 M5.7 4 A 1.3 1.3 0 1 1 8.3 4 A 1.3 1.3 0 1 1 5.7 4 M2 8 H3.7 M6.3 8 H10 M3.7 8 A 1.3 1.3 0 1 1 6.3 8 A 1.3 1.3 0 1 1 3.7 8',
  // The dropdown affordance a field draws itself, where a native `<select>`
  // arrow would be the OS's rather than the panel's (`SizeField`).
  'chevron-down': 'M3.5 5 L6 7.5 L8.5 5',
  rotation: 'M9.5 6 A 3.5 3.5 0 1 1 6 2.5 M6 2.5 L4.4 1.1 M6 2.5 L4.4 4',
  opacity: 'M2 2 H10 V10 H2 Z M2 5 L5 2 M2 8 L8 2 M4 10 L10 4 M7 10 L10 7',
  radius: 'M2 10 V6 A4 4 0 0 1 6 2 H10',
  'radius-corner': 'M2 10 V5 A3 3 0 0 1 5 2 H10',
  'padding-h': 'M2 2 V10 M10 2 V10 M4.5 6 H7.5',
  'padding-v': 'M2 2 H10 M2 10 H10 M6 4.5 V7.5',
  'padding-left': 'M2 2 V10 M4.5 6 H9',
  'padding-right': 'M10 2 V10 M3 6 H7.5',
  'padding-top': 'M2 2 H10 M6 4.5 V9',
  'padding-bottom': 'M2 10 H10 M6 3 V7.5',
  'gap-h': 'M2 2 V10 M10 2 V10 M6 3.5 V8.5',
  'gap-v': 'M2 2 H10 M2 10 H10 M3.5 6 H8.5',
  'stroke-weight': 'M2 3 H10 M2 6.5 H10 M2 9.5 H10',
  blur: 'M6 1.5 A 4.5 4.5 0 0 0 6 10.5 M8.3 2.9 L8.3 2.9 M9.9 4.8 L9.9 4.8 M9.9 7.2 L9.9 7.2 M8.3 9.1 L8.3 9.1',
  spread: 'M4 4 H8 V8 H4 Z M2 2 H10 V10 H2 Z',
  'flow-none': 'M3 3 H5 V5 H3 Z M7 5 H9 V7 H7 Z M4 8 H6 V10 H4 Z',
  'flow-vertical': 'M4 2 H8 V4 H4 Z M4 7 H8 V9 H4 Z M6 4.5 V6.5 M5 5.8 L6 6.8 L7 5.8',
  'flow-horizontal': 'M2 4 H4 V8 H2 Z M7 4 H9 V8 H7 Z M4.5 6 H6.5 M5.8 5 L6.8 6 L5.8 7',
  'flow-grid':
    'M2.5 2.5 H5 V5 H2.5 Z M7 2.5 H9.5 V5 H7 Z M2.5 7 H5 V9.5 H2.5 Z M7 7 H9.5 V9.5 H7 Z',
  wrap: 'M2 3.5 H10 M2 6.5 H8 A1.8 1.8 0 0 1 8 10 H6 M7 9 L6 10 L7 11',
  'align-left': 'M2 3 H10 M2 6 H7 M2 9 H10',
  'align-center-h': 'M2 3 H10 M3.5 6 H8.5 M2 9 H10',
  'align-right': 'M2 3 H10 M5 6 H10 M2 9 H10',
  'align-justify': 'M2 3 H10 M2 6 H10 M2 9 H10',
  'align-top': 'M2 2 H10 M6 4.5 V10 M4.5 6 L6 4.5 L7.5 6',
  'align-middle': 'M2 6 H10 M4 2 H8 V4.4 H4 Z M4 7.6 H8 V10 H4 Z',
  'align-bottom': 'M2 10 H10 M6 2 V7.5 M4.5 6 L6 7.5 L7.5 6',
  'resize-none': 'M3 3 H9 V9 H3 Z',
  'resize-height': 'M3 3 H9 M3 9 H9 M6 4.5 V7.5 M5 5.3 L6 4.3 L7 5.3 M5 6.7 L6 7.7 L7 6.7',
  'resize-both': 'M2 2 H6 V6 H2 Z M6 6 L9.5 9.5 M9.5 7 V9.5 H7',
  'resize-truncate': 'M2 6 H5 M6.5 6 H7 M8.5 6 H9 M10 6 H10.2',
  'stroke-inside': 'M2 2 H10 V10 H2 Z M4 4 H8 V8 H4 Z',
  'stroke-center': 'M3 3 H9 V9 H3 Z M2 6 H4 M8 6 H10 M6 2 V4 M6 8 V10',
  'stroke-outside': 'M4 4 H8 V8 H4 Z M2 2 H10 V10 H2 Z M2 2 L4 4 M10 2 L8 4 M2 10 L4 8 M10 10 L8 8',
  'position-auto': 'M2.5 3 H6 V6 H2.5 Z M6 6 H9.5 V9 H6 Z',
  'position-absolute': 'M2 2 H10 V10 H2 Z M5.5 5.5 H10 V10 H5.5 Z',
  italic: 'M5 2 H10 M2 10 H7 M7.5 2 L4.5 10',
  'case-original': 'M2 9 L4.5 3 L7 9 M3 7 H6 M8 5 A1.6 2 0 1 1 8 8.6 M9.6 5 V9',
  'case-upper': 'M2 9 L4.5 3 L7 9 M3 7 H6 M7.5 9 L10 3 M8.3 6.8 H11',
  'case-lower': 'M4 6 A1.8 1.8 0 1 0 4 9.4 M5.8 5.5 V9 M7 6 A1.8 1.8 0 1 0 7 9.4 M8.8 5.5 V9',
  'case-title': 'M2 9 L4.5 3 L7 9 M3 7 H6 M8.2 6 A1.6 1.7 0 1 0 8.2 9.2 M9.8 5.5 V9',
  'deco-none': 'M3 3 C 5 5, 7 5, 9 3 M3 9 C 5 7, 7 7, 9 9',
  'deco-underline': 'M3 2 V6 A3 3 0 0 0 9 6 V2 M2.5 10 H9.5',
  'deco-strike': 'M2 6 H10 M4 3 C 6 2, 8 2.5, 8.5 4 M8 9 C 6 10, 4 9.5, 3.5 8',
  eye: 'M1.5 6 C 3 3.5, 9 3.5, 10.5 6 C 9 8.5, 3 8.5, 1.5 6 Z M6 6 m-1.3 0 a1.3 1.3 0 1 0 2.6 0 a1.3 1.3 0 1 0 -2.6 0',
  'eye-off': 'M1.5 6 C 3 3.5, 9 3.5, 10.5 6 C 9 8.5, 3 8.5, 1.5 6 Z M2.5 9.5 L9.5 2.5',
  expand: 'M2 5 V2 H5 M7 2 H10 V5 M10 7 V10 H7 M5 10 H2 V7',
  droplet: 'M6 1.5 C 8 4.5, 9.5 6.5, 9.5 8 A 3.5 3.5 0 0 1 2.5 8 C 2.5 6.5, 4 4.5, 6 1.5 Z',
  // The UI3 pass (spec §5): the popup's chrome and the variable glyphs.
  search: 'M5.2 1.8 A 3.4 3.4 0 1 1 5.2 8.6 A 3.4 3.4 0 1 1 5.2 1.8 M7.8 7.8 L10.5 10.5',
  close: 'M2.5 2.5 L9.5 9.5 M9.5 2.5 L2.5 9.5',
  plus: 'M6 2 V10 M2 6 H10',
  trash: 'M2 3 H10 M4.5 3 V1.5 H7.5 V3 M3 3 L3.5 10.5 H8.5 L9 3 M5 5 V8.5 M7 5 V8.5',
  variable: 'M2.5 2.5 H9.5 V9.5 H2.5 Z M4.8 4 L4.2 8 M7.8 4 L7.2 8 M3.5 5.2 H8.7 M3.3 6.8 H8.5',
  'variables-grid':
    'M3.2 3.2 m-1 0 a1 1 0 1 0 2 0 a1 1 0 1 0 -2 0 M8.8 3.2 m-1 0 a1 1 0 1 0 2 0 a1 1 0 1 0 -2 0 M3.2 8.8 m-1 0 a1 1 0 1 0 2 0 a1 1 0 1 0 -2 0 M8.8 8.8 m-1 0 a1 1 0 1 0 2 0 a1 1 0 1 0 -2 0',
} as const

export type IconName = keyof typeof ICON_PATHS

export const FieldIcon: FunctionalComponent<{ name: IconName }> = (props) =>
  h(
    'svg',
    {
      viewBox: '0 0 12 12',
      // Named in the DOM so a test can assert which glyph drew — the paths are
      // data, and a test that matched on one would break on a nudged curve.
      'data-icon': props.name,
      width: 12,
      height: 12,
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': 1.2,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'aria-hidden': 'true',
    },
    [h('path', { d: ICON_PATHS[props.name] })],
  )
FieldIcon.props = { name: { type: String as PropType<IconName>, required: true } }

export const PROP_ICON: Partial<Record<string, IconName>> = {
  rotation: 'rotation',
  opacity: 'opacity',
  cornerRadius: 'radius',
  cornerSmoothing: 'radius',
  topLeftRadius: 'radius-corner',
  topRightRadius: 'radius-corner',
  bottomLeftRadius: 'radius-corner',
  bottomRightRadius: 'radius-corner',
  itemSpacing: 'gap-h',
  counterAxisSpacing: 'gap-v',
  paddingLeft: 'padding-left',
  paddingRight: 'padding-right',
  paddingTop: 'padding-top',
  paddingBottom: 'padding-bottom',
  strokeWeight: 'stroke-weight',
  strokeTopWeight: 'padding-top',
  strokeRightWeight: 'padding-right',
  strokeBottomWeight: 'padding-bottom',
  strokeLeftWeight: 'padding-left',
  strokeMiterLimit: 'stroke-weight',
  layoutGrow: 'resize-both',
  fontSize: 'case-upper',
  lineHeight: 'gap-v',
  letterSpacing: 'gap-h',
  maxLines: 'align-justify',
  blur: 'blur',
  spread: 'spread',
  blendMode: 'droplet',
}

export const OPTION_ICON: Record<string, IconName> = {
  'layoutMode:NONE': 'flow-none',
  'layoutMode:HORIZONTAL': 'flow-horizontal',
  'layoutMode:VERTICAL': 'flow-vertical',
  'layoutMode:GRID': 'flow-grid',
  'layoutWrap:NO_WRAP': 'align-justify',
  'layoutWrap:WRAP': 'wrap',
  'textAlignHorizontal:LEFT': 'align-left',
  'textAlignHorizontal:CENTER': 'align-center-h',
  'textAlignHorizontal:RIGHT': 'align-right',
  'textAlignHorizontal:JUSTIFIED': 'align-justify',
  'textAlignVertical:TOP': 'align-top',
  'textAlignVertical:CENTER': 'align-middle',
  'textAlignVertical:BOTTOM': 'align-bottom',
  'textAutoResize:NONE': 'resize-none',
  'textAutoResize:HEIGHT': 'resize-height',
  'textAutoResize:WIDTH_AND_HEIGHT': 'resize-both',
  'textAutoResize:TRUNCATE': 'resize-truncate',
  'strokeAlign:INSIDE': 'stroke-inside',
  'strokeAlign:CENTER': 'stroke-center',
  'strokeAlign:OUTSIDE': 'stroke-outside',
  'layoutPositioning:AUTO': 'position-auto',
  'layoutPositioning:ABSOLUTE': 'position-absolute',
  'textDecoration:NONE': 'deco-none',
  'textDecoration:UNDERLINE': 'deco-underline',
  'textDecoration:STRIKETHROUGH': 'deco-strike',
  'textCase:ORIGINAL': 'case-original',
  'textCase:UPPER': 'case-upper',
  'textCase:LOWER': 'case-lower',
  'textCase:TITLE': 'case-title',
}
