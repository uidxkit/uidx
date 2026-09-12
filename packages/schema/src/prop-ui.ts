import type { SceneElement } from '@uidx/format'
import { STROKE_ENDPOINT_CAPS } from './stroke-endpoints.js'

/**
 * Where a property sits in the panel, and what control shows it.
 *
 * The panel is meant to be *generated from* the prop table (spec,
 * "The core problem"), which is why this lives beside `prop-table.ts` rather
 * than in `@uidx/viewer`: a second copy of this list in the viewer would
 * drift from the schema package the first time a property is added, and the
 * drift would be silent.
 */
export type PropGroup =
  'text' | 'position' | 'layout' | 'appearance' | 'typography' | 'fill' | 'stroke' | 'effects'

export interface PropUi {
  group: PropGroup
  /**
   * What the panel calls this field, when Figma calls it something else.
   *
   * The authored name is the file's and the patch key's — `characters` is what
   * §3.3 spells and what a `set` addresses — so a display name has to be a
   * second field rather than a rename. Omitted means the authored name shows.
   */
  label?: string
  /** Elements this applies to. Omitted means every scene element. */
  appliesTo?: readonly SceneElement[]
  control:
    | 'number'
    | 'boolean'
    | 'enum'
    | 'text'
    | 'paint'
    | 'effects'
    | 'constraints'
    | 'dashes'
    | 'text-resize'
    | 'opaque'
  /** Legal values, for `enum`. */
  options?: readonly string[]
  /** Explain abbreviated choices without making the control wider. */
  optionDescriptions?: Readonly<Record<string, string>>
  min?: number
  max?: number
  /** Scrub and arrow-key granularity, for `number`. @default 1 */
  step?: number
  /** Renders on one row with this sibling — x/y, width/height. Mutual. */
  pairs?: string
}

export const SECTION_ORDER: readonly PropGroup[] = [
  'position',
  'layout',
  'text',
  'typography',
  'appearance',
  'fill',
  'stroke',
  'effects',
]

export const SECTION_LABEL: Record<PropGroup, string> = {
  position: 'Position',
  layout: 'Layout',
  appearance: 'Appearance',
  fill: 'Fill',
  stroke: 'Stroke',
  text: 'Text',
  typography: 'Typography',
  effects: 'Effects',
}

/**
 * `SegmentedControlRoot` for a short enum, a `<select>` for a long one. The
 * threshold matches the spec's own two examples: alignment/sizing/wrap enums
 * (<=4 options) are segmented; `blendMode` (17) and `fontWeight` (9) are not.
 */
export const SEGMENTED_MAX_OPTIONS = 4

/**
 * Props the schema maps but the panel deliberately never shows: `name` is a
 * node's address component, and renaming it moves every address below it —
 * a structural operation (Epic D), not a property edit. Every other mapped
 * prop must have a `PROP_UI` entry; `prop-ui.test.ts` enforces this.
 */
export const PROP_UI_OPT_OUT: ReadonlySet<string> = new Set(['name'])

/**
 * Auto-layout belongs to the containers that lay children out.
 *
 * `Slot` is one of them on the *declaration* side (ADR 0007 §1): a card
 * decides how its body sits, which is the whole difference between a slot and
 * "an instance you may add children to". A fill-side slot owns none of it, but
 * that is a question about position rather than element and `appliesTo` cannot
 * ask it — `sectionsFor` does, where the parent is already in hand.
 */
const FRAME_OR_COMPONENT: readonly SceneElement[] = ['Frame', 'Component', 'Slot']
const TEXT_ONLY: readonly SceneElement[] = ['Text']

export const PROP_UI: Record<string, PropUi> = {
  // --- position ------------------------------------------------------------
  x: { group: 'position', label: 'X', control: 'number', step: 1, pairs: 'right' },
  y: { group: 'position', label: 'Y', control: 'number', step: 1, pairs: 'bottom' },
  // Beside the x/y it unlocks, the way Figma places it: this is a position
  // question — who places the node — not a layout-child participation one.
  // No `appliesTo`: any element can sit inside an auto-layout parent. Shown
  // only where there is a flow to escape, which this table cannot see — the
  // viewer's `sectionsFor` gates it on the parent's layoutMode.
  layoutPositioning: {
    group: 'position',
    label: 'Placement',
    control: 'enum',
    options: ['AUTO', 'ABSOLUTE'],
  },
  width: { group: 'layout', label: 'W', control: 'number', step: 1, pairs: 'height' },
  height: { group: 'layout', label: 'H', control: 'number', step: 1, pairs: 'width' },
  minWidth: { group: 'layout', label: 'Min width', control: 'number', step: 1, pairs: 'maxWidth' },
  maxWidth: { group: 'layout', label: 'Max width', control: 'number', step: 1, pairs: 'minWidth' },
  minHeight: {
    group: 'layout',
    label: 'Min height',
    control: 'number',
    step: 1,
    pairs: 'maxHeight',
  },
  maxHeight: {
    group: 'layout',
    label: 'Max height',
    control: 'number',
    step: 1,
    pairs: 'minHeight',
  },
  rotation: { group: 'position', label: 'Rotation', control: 'number', step: 1 },
  // A compound {horizontal, vertical} anchor pair. Read-only in C5 (an
  // object has no control there either) and stays that way — a two-select
  // constraints editor is not part of this story.
  constraints: { group: 'position', label: 'Constraints', control: 'constraints' },
  // The offsets a pinned child states instead of a coordinate (ADR 0011 §2).
  // Number rows like x/y and in the same section, because they answer the same
  // question — where is this, relative to the parent — from the other edge.
  // No `appliesTo`: any element can sit inside a frame that gives it edges.
  //
  // Present here and absent from `PROP_TABLE`, which is not a contradiction:
  // the table says what the scene graph holds, and this says what the panel
  // offers. These four are the one family where those differ.
  right: { group: 'position', label: 'Right', control: 'number', step: 1, pairs: 'x' },
  bottom: { group: 'position', label: 'Bottom', control: 'number', step: 1, pairs: 'y' },
  centerX: { group: 'position', label: 'Center X', control: 'number', step: 1 },
  centerY: { group: 'position', label: 'Center Y', control: 'number', step: 1 },
  // Vector/ellipse-only geometry. Neither doc section names them (see the
  // spec's "Sections and order" — Vector never gets one); grouped with the
  // rest of a node's geometry rather than left out of every section.
  vectorPaths: { group: 'position', label: 'Path', control: 'opaque', appliesTo: ['Vector'] },
  arcData: { group: 'position', label: 'Arc', control: 'opaque', appliesTo: ['Ellipse'] },

  // --- auto layout (Frame, Component) --------------------------------------
  layoutMode: {
    group: 'layout',
    label: 'Direction',
    control: 'enum',
    options: ['NONE', 'HORIZONTAL', 'VERTICAL', 'GRID'],
    appliesTo: FRAME_OR_COMPONENT,
  },
  layoutWrap: {
    group: 'layout',
    label: 'Wrap',
    control: 'enum',
    options: ['NO_WRAP', 'WRAP'],
    appliesTo: FRAME_OR_COMPONENT,
  },
  // Figma spells these AUTO/FIXED; SceneNode's own domain is FIXED/HUG/FILL.
  // FILL is excluded: the format cannot write it yet (ADR 0002, A2).
  primaryAxisSizingMode: {
    group: 'layout',
    label: 'Primary sizing',
    control: 'enum',
    options: ['FIXED', 'AUTO'],
    appliesTo: FRAME_OR_COMPONENT,
  },
  counterAxisSizingMode: {
    group: 'layout',
    label: 'Counter sizing',
    control: 'enum',
    options: ['FIXED', 'AUTO'],
    appliesTo: FRAME_OR_COMPONENT,
  },
  primaryAxisAlignItems: {
    group: 'layout',
    label: 'Primary align',
    control: 'enum',
    options: ['MIN', 'CENTER', 'MAX', 'SPACE_BETWEEN'],
    appliesTo: FRAME_OR_COMPONENT,
  },
  counterAxisAlignItems: {
    group: 'layout',
    label: 'Counter align',
    control: 'enum',
    options: ['MIN', 'CENTER', 'MAX', 'STRETCH', 'BASELINE'],
    appliesTo: FRAME_OR_COMPONENT,
  },
  // Not named in the doc's Auto layout bullet; it is that section's own
  // "wrap alignment" (only meaningful when layoutWrap is WRAP), so it groups
  // with the rest of auto layout rather than sitting in no section at all.
  counterAxisAlignContent: {
    group: 'layout',
    label: 'Wrapped rows',
    control: 'enum',
    options: ['AUTO', 'SPACE_BETWEEN'],
    appliesTo: FRAME_OR_COMPONENT,
  },
  itemSpacing: {
    group: 'layout',
    pairs: 'counterAxisSpacing',
    label: 'Gap',
    control: 'number',
    step: 1,
    appliesTo: FRAME_OR_COMPONENT,
  },
  counterAxisSpacing: {
    group: 'layout',
    pairs: 'itemSpacing',
    label: 'Wrap gap',
    control: 'number',
    step: 1,
    appliesTo: FRAME_OR_COMPONENT,
  },
  // z-order of overlapping auto-layout children — an auto-layout-only
  // concern the doc's bullet omits; same reasoning as counterAxisAlignContent.
  itemReverseZIndex: {
    group: 'layout',
    label: 'First layer on top',
    control: 'boolean',
    appliesTo: FRAME_OR_COMPONENT,
  },
  paddingLeft: {
    group: 'layout',
    label: 'Left',
    control: 'number',
    step: 1,
    appliesTo: FRAME_OR_COMPONENT,
  },
  paddingRight: {
    group: 'layout',
    label: 'Right',
    control: 'number',
    step: 1,
    appliesTo: FRAME_OR_COMPONENT,
  },
  paddingTop: {
    group: 'layout',
    label: 'Top',
    control: 'number',
    step: 1,
    appliesTo: FRAME_OR_COMPONENT,
  },
  paddingBottom: {
    group: 'layout',
    label: 'Bottom',
    control: 'number',
    step: 1,
    appliesTo: FRAME_OR_COMPONENT,
  },
  clipsContent: {
    group: 'layout',
    label: 'Clip content',
    control: 'boolean',
    appliesTo: FRAME_OR_COMPONENT,
  },

  // --- layout child ----------------------------------------------------------
  // No `appliesTo`: any element can sit inside an auto-layout parent. The
  // section itself is gated on the *parent's* layoutMode, which this table
  // cannot see — @uidx/viewer's `sectionsFor` does that check.
  // (`layoutPositioning` moved up beside x/y, where Figma keeps it.)
  layoutGrow: { group: 'layout', label: 'Grow', control: 'number', step: 1 },
  // Figma calls this layoutAlign on the child; SceneNode spells it
  // layoutAlignSelf (prop-table.ts's `rename`). Not named in the doc's
  // bullet; it is exactly this section's third child-participation prop.
  layoutAlign: {
    group: 'layout',
    label: 'Align self',
    control: 'enum',
    options: ['AUTO', 'MIN', 'CENTER', 'MAX', 'STRETCH', 'BASELINE'],
  },

  // --- appearance ------------------------------------------------------------
  opacity: {
    group: 'appearance',
    label: 'Opacity',
    control: 'number',
    step: 0.01,
    min: 0,
    max: 1,
    pairs: 'blendMode',
  },
  visible: { group: 'appearance', label: 'Visible', control: 'boolean' },
  locked: { group: 'appearance', label: 'Lock layer', control: 'boolean' },
  blendMode: {
    group: 'appearance',
    label: 'Blend mode',
    pairs: 'opacity',
    control: 'enum',
    options: [
      'NORMAL',
      'DARKEN',
      'MULTIPLY',
      'COLOR_BURN',
      'LIGHTEN',
      'SCREEN',
      'COLOR_DODGE',
      'OVERLAY',
      'SOFT_LIGHT',
      'HARD_LIGHT',
      'DIFFERENCE',
      'EXCLUSION',
      'HUE',
      'SATURATION',
      'COLOR',
      'LUMINOSITY',
      'PASS_THROUGH',
    ],
  },
  cornerRadius: { group: 'appearance', label: 'Corner radius', control: 'number', step: 1 },
  topLeftRadius: { group: 'appearance', label: 'Top left', control: 'number', step: 1 },
  topRightRadius: { group: 'appearance', label: 'Top right', control: 'number', step: 1 },
  bottomRightRadius: { group: 'appearance', label: 'Bottom right', control: 'number', step: 1 },
  bottomLeftRadius: { group: 'appearance', label: 'Bottom left', control: 'number', step: 1 },
  cornerSmoothing: {
    group: 'appearance',
    label: 'Corner smoothing',
    control: 'number',
    step: 0.01,
    min: 0,
    max: 1,
  },
  // Neither doc section names masking. It is an appearance-level toggle in
  // Figma's own model, so it groups with the rest of this section.
  isMask: { group: 'appearance', label: 'Use as mask', control: 'boolean' },
  maskType: {
    group: 'appearance',
    label: 'Mask type',
    control: 'enum',
    options: ['ALPHA', 'VECTOR', 'LUMINANCE'],
  },

  // --- fill --------------------------------------------------------------
  fills: { group: 'fill', label: 'Fill', control: 'paint' },

  // --- stroke --------------------------------------------------------------
  strokes: { group: 'stroke', label: 'Stroke', control: 'paint' },
  strokeWeight: {
    group: 'stroke',
    label: 'Weight',
    control: 'number',
    step: 1,
    min: 0,
    pairs: 'strokeAlign',
  },
  strokeAlign: {
    group: 'stroke',
    label: 'Position',
    control: 'enum',
    options: ['INSIDE', 'CENTER', 'OUTSIDE'],
    pairs: 'strokeWeight',
  },
  strokeCap: {
    group: 'stroke',
    label: 'Cap',
    control: 'enum',
    options: ['NONE', 'ROUND', 'SQUARE', 'ARROW_LINES', 'ARROW_EQUILATERAL'],
  },
  strokeStartCap: {
    group: 'stroke',
    label: 'Start point',
    control: 'enum',
    options: STROKE_ENDPOINT_CAPS,
    appliesTo: ['Vector'],
    pairs: 'strokeEndCap',
  },
  strokeEndCap: {
    group: 'stroke',
    label: 'End point',
    control: 'enum',
    options: STROKE_ENDPOINT_CAPS,
    appliesTo: ['Vector'],
    pairs: 'strokeStartCap',
  },
  strokeJoin: {
    group: 'stroke',
    label: 'Join',
    control: 'enum',
    options: ['MITER', 'BEVEL', 'ROUND'],
  },
  strokeMiterLimit: { group: 'stroke', label: 'Miter limit', control: 'number', step: 0.01 },
  dashPattern: { group: 'stroke', label: 'Dashes', control: 'dashes' },
  strokesIncludedInLayout: {
    group: 'layout',
    label: 'Include stroke in layout',
    control: 'boolean',
  },
  // Independent per-side weights; overlap `strokeWeight` last-writer-wins
  // (prop-table.ts). Not named in the doc's Stroke bullet, grouped with it.
  strokeTopWeight: {
    group: 'stroke',
    label: 'Top',
    control: 'number',
    step: 1,
    pairs: 'strokeBottomWeight',
  },
  strokeRightWeight: {
    group: 'stroke',
    label: 'Right',
    control: 'number',
    step: 1,
    pairs: 'strokeLeftWeight',
  },
  strokeBottomWeight: {
    group: 'stroke',
    label: 'Bottom',
    control: 'number',
    step: 1,
    pairs: 'strokeTopWeight',
  },
  strokeLeftWeight: {
    group: 'stroke',
    label: 'Left',
    control: 'number',
    step: 1,
    pairs: 'strokeRightWeight',
  },

  // --- typography (Text only) -----------------------------------------------
  characters: { group: 'text', label: 'Content', control: 'text', appliesTo: TEXT_ONLY },
  fontSize: {
    group: 'typography',
    label: 'Size',
    pairs: 'fontWeight',
    control: 'number',
    step: 1,
    appliesTo: TEXT_ONLY,
  },
  // Open-ended family name — no closed domain, so free text rather than enum.
  fontFamily: { group: 'typography', label: 'Font', control: 'text', appliesTo: TEXT_ONLY },
  fontWeight: {
    group: 'typography',
    label: 'Style',
    pairs: 'fontSize',
    control: 'enum',
    options: [
      'THIN',
      'EXTRA_LIGHT',
      'LIGHT',
      'REGULAR',
      'MEDIUM',
      'SEMI_BOLD',
      'BOLD',
      'EXTRA_BOLD',
      'BLACK',
    ],
    appliesTo: TEXT_ONLY,
  },
  italic: { group: 'typography', label: 'Italic', control: 'boolean', appliesTo: TEXT_ONLY },
  // Figma's own 3-way switch: Fixed size / Auto height / Auto width
  // (`TextResizeField`). `TRUNCATE` is still a legal fourth value the engine
  // accepts, but `textTruncation` below is this codebase's own settled
  // surface for that — offering `TRUNCATE` here too would be the same
  // behaviour reachable two ways, so this row reads it (as Fixed, the
  // nearer bucket) but never writes it, same stance as `FILL` (ADR 0002).
  textAutoResize: {
    // Layout, not typography: this is the node's *box*, which is what Figma
    // groups it with — its Resizing switch sits directly above Dimensions,
    // the W/H it governs. Typography is what the glyphs look like.
    group: 'layout',
    label: 'Resizing',
    control: 'text-resize',
    options: ['NONE', 'HEIGHT', 'WIDTH_AND_HEIGHT', 'TRUNCATE'],
    appliesTo: TEXT_ONLY,
  },
  textAlignHorizontal: {
    group: 'typography',
    label: 'Horizontal align',
    pairs: 'textAlignVertical',
    control: 'enum',
    options: ['LEFT', 'CENTER', 'RIGHT', 'JUSTIFIED'],
    appliesTo: TEXT_ONLY,
  },
  textDirection: {
    group: 'typography',
    label: 'Text direction',
    control: 'enum',
    options: ['AUTO', 'LTR', 'RTL'],
    optionDescriptions: {
      AUTO: 'Auto — detect direction from the text',
      LTR: 'Left to right',
      RTL: 'Right to left',
    },
    appliesTo: TEXT_ONLY,
  },
  textAlignVertical: {
    group: 'typography',
    label: 'Vertical align',
    pairs: 'textAlignHorizontal',
    control: 'enum',
    options: ['TOP', 'CENTER', 'BOTTOM'],
    appliesTo: TEXT_ONLY,
  },
  textCase: {
    group: 'typography',
    label: 'Case',
    control: 'enum',
    options: ['ORIGINAL', 'UPPER', 'LOWER', 'TITLE'],
    appliesTo: TEXT_ONLY,
  },
  textDecoration: {
    group: 'typography',
    label: 'Decoration',
    control: 'enum',
    options: ['NONE', 'UNDERLINE', 'STRIKETHROUGH'],
    appliesTo: TEXT_ONLY,
  },
  // Declared before its pair partner deliberately: for a node that leaves
  // both unauthored, `editableProps` appends unset fields in this object's
  // own key order, and the pairing in `editable.ts` gives the row to whichever
  // half it meets first — so this order is what makes the paired row read
  // "Line height | Letter spacing", Figma's own order, rather than the
  // reverse.
  lineHeight: {
    group: 'typography',
    label: 'Line height',
    control: 'number',
    step: 1,
    appliesTo: TEXT_ONLY,
    pairs: 'letterSpacing',
  },
  letterSpacing: {
    group: 'typography',
    label: 'Letter spacing',
    control: 'number',
    step: 1,
    appliesTo: TEXT_ONLY,
    pairs: 'lineHeight',
  },
  maxLines: {
    group: 'typography',
    label: 'Max lines',
    control: 'number',
    step: 1,
    appliesTo: TEXT_ONLY,
  },
  // Not in the spec's Enum domains table; confirmed against
  // `@open-pencil/scene-graph@0.14.0`'s `SceneNode.textTruncation` directly.
  textTruncation: {
    group: 'typography',
    label: 'Overflow',
    control: 'enum',
    options: ['DISABLED', 'ENDING'],
    appliesTo: TEXT_ONLY,
  },

  // --- effects -------------------------------------------------------------
  effects: { group: 'effects', label: 'Effects', control: 'effects' },
}

/**
 * The order fields read in, per section (the parity spec, §2).
 *
 * Explicit because declaration order is an accident of how the table grew,
 * and the panel's order is a design decision — Visible leads Appearance
 * because it is the row a boolean property binds to, and Content leads Text
 * because it is the layer's payload. Anything a list omits keeps its
 * declaration order, after everything the list names.
 */
const FIELD_ORDER: Partial<Record<PropGroup, readonly string[]>> = {
  // `layoutPositioning` sits directly beside the x/y it unlocks — Figma's
  // placement, and the one this table already argued for where it is declared.
  // An offset reads directly under the coordinate it replaces: on a pinned
  // axis exactly one of the pair is the author's, and putting them apart would
  // make the panel look like it were offering both.
  position: [
    'x',
    'right',
    'centerX',
    'y',
    'bottom',
    'centerY',
    'layoutPositioning',
    'rotation',
    'constraints',
  ],
  layout: [
    // Above the W/H it governs, the way Figma stacks Resizing over Dimensions
    // (the pane renders it there explicitly; this keeps the declared order
    // honest about where it belongs).
    'textAutoResize',
    'width',
    'height',
    'minWidth',
    'maxWidth',
    'minHeight',
    'maxHeight',
    'layoutMode',
    'layoutWrap',
    'primaryAxisSizingMode',
    'counterAxisSizingMode',
    'primaryAxisAlignItems',
    'counterAxisAlignItems',
    'counterAxisAlignContent',
    'itemSpacing',
    'counterAxisSpacing',
    'paddingLeft',
    'paddingRight',
    'paddingTop',
    'paddingBottom',
    'clipsContent',
    'itemReverseZIndex',
    'layoutGrow',
    'layoutAlign',
    'strokesIncludedInLayout',
  ],
  appearance: [
    'opacity',
    'cornerRadius',
    'topLeftRadius',
    'topRightRadius',
    'bottomRightRadius',
    'bottomLeftRadius',
    'cornerSmoothing',
    'blendMode',
    'isMask',
    'maskType',
    'locked',
    // Last: this row exists only while a component property drives visibility,
    // and Figma trails the section with that pill rather than leading it.
    'visible',
  ],
  stroke: [
    'strokes',
    'strokeAlign',
    'strokeWeight',
    'strokeStartCap',
    'strokeEndCap',
    'strokeCap',
    'strokeJoin',
    'strokeMiterLimit',
    'dashPattern',
    'strokeTopWeight',
    'strokeRightWeight',
    'strokeBottomWeight',
    'strokeLeftWeight',
  ],
  text: ['characters'],
  typography: [
    'fontFamily',
    'fontWeight',
    'italic',
    'fontSize',
    'lineHeight',
    'letterSpacing',
    'textAlignHorizontal',
    'textAlignVertical',
    'textDirection',
    'textCase',
    'textDecoration',
    'maxLines',
    'textTruncation',
  ],
}

/** Every field of a group, in the order the panel shows them. */
export function fieldOrderFor(group: PropGroup): readonly string[] {
  const declared = Object.entries(PROP_UI)
    .filter(([, ui]) => ui.group === group)
    .map(([name]) => name)
  const wanted = FIELD_ORDER[group] ?? []
  const named = wanted.filter((name) => declared.includes(name))
  return [...named, ...declared.filter((name) => !named.includes(name))]
}

/** Text leads with its content and typography; other layer types lead with
 * geometry. Components and instances add their own controls above these.
 */
export function sectionOrderFor(element: SceneElement): readonly PropGroup[] {
  return element === 'Text'
    ? [
        'text',
        'typography',
        ...SECTION_ORDER.filter((group) => group !== 'text' && group !== 'typography'),
      ]
    : SECTION_ORDER.filter((group) => group !== 'text')
}

export function propUiFor(name: string): PropUi | undefined {
  return PROP_UI[name]
}

/**
 * What an enum option reads as, where Figma's word is not the value's.
 *
 * Keyed `prop.VALUE` because the same value means different things in
 * different domains — `AUTO` is "Hug" for a sizing mode and "Auto" for
 * positioning, and one flat value→label map would have to pick one.
 *
 * Everything absent falls through to the prettifier below, which is the
 * common case: `SPACE_BETWEEN` reads as "Space between" without being listed.
 */
const OPTION_LABEL: Record<string, string> = {
  'textDirection.LTR': 'LTR',
  'textDirection.RTL': 'RTL',
  'layoutMode.NONE': 'Free',
  'layoutMode.HORIZONTAL': 'Row',
  'layoutMode.VERTICAL': 'Column',
  'layoutPositioning.AUTO': 'Auto layout',
  'layoutPositioning.ABSOLUTE': 'Absolute',
  'layoutWrap.NO_WRAP': 'No wrap',
  'layoutWrap.WRAP': 'Wrap',
  // Figma names a sizing mode by what it does, not by the value's spelling.
  'primaryAxisSizingMode.AUTO': 'Hug',
  'counterAxisSizingMode.AUTO': 'Hug',
  // Text resizing: Figma's four words, none of which is the value's.
  'textAutoResize.NONE': 'Fixed size',
  'textAutoResize.HEIGHT': 'Auto height',
  'textAutoResize.WIDTH_AND_HEIGHT': 'Auto width',
  // A stroke's alignment is spelled as a position in Figma's UI.
  'strokeAlign.INSIDE': 'Inside',
  'strokeAlign.CENTER': 'Center',
  'strokeAlign.OUTSIDE': 'Outside',
  // `counterAxisAlignContent` takes no override: Figma offers wrap spacing as
  // "Auto", but that collides with this domain's own `AUTO`, and two options
  // reading alike is worse than one reading unlike Figma. Both prettify.
  // A truncation domain of DISABLED/ENDING reads as off/on in Figma.
  'textTruncation.DISABLED': 'None',
  'textTruncation.ENDING': 'Ellipsis',
}

/**
 * Title-case a screaming-snake value: `COLOR_BURN` → "Color burn".
 *
 * Deliberately not per-word capitalised — Figma sentence-cases its options,
 * and "Color Burn" reads as a proper noun the product does not use.
 */
function prettify(value: string): string {
  const words = value.toLowerCase().split('_').join(' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/**
 * The label one option of one enum shows.
 *
 * The canonical value is what a commit carries — this is presentation, the
 * same contract `PropUi.label` has for the row itself. An unknown prop still
 * gets a readable answer rather than a thrown error, because the control
 * renders whatever the file holds and a bad value must still be legible.
 */
export function optionLabelFor(prop: string, option: string): string {
  if (prop === 'strokeStartCap' || prop === 'strokeEndCap') {
    const labels: Record<string, string> = {
      ARROW_LINES: 'Line arrow',
      ARROW_EQUILATERAL: 'Triangle arrow',
      TRIANGLE_REVERSE: 'Reverse triangle',
      DIAMOND_FILLED: 'Diamond',
      CIRCLE_FILLED: 'Circle',
    }
    if (labels[option]) return labels[option]!
  }
  return OPTION_LABEL[`${prop}.${option}`] ?? prettify(option)
}
