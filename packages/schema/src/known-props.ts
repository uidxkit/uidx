/**
 * Every property name the v1 vocabulary blesses.
 *
 * Deliberately a plain list with no imports: `uidx check` needs to know which
 * properties are known in order to emit the §3.3 lint warning, and pulling the
 * real prop table in would drag `@open-pencil/*` — CanvasKit and all — into the
 * CLI for the sake of a set of strings.
 *
 * Drift is prevented by a test rather than by construction: `known-props.test.ts`
 * asserts this list is exactly `IDENTITY_PROPS` plus every `PROP_TABLE` entry.
 */
/**
 * Properties the vocabulary knows that the renderer does not (stories F3, F6).
 *
 * `component` and `overrides` are `<Instance>`'s and `props` is
 * `<Component>`'s, and none is a scene node property: one is a reference into the document's global namespace (ADR 0004
 * §2) and the other is a map keyed by addresses *inside* the component it
 * names. They reach the scene by deciding what gets built, not by being set on
 * anything — so they are absent from `PROP_TABLE` on purpose, and named here so
 * that absence reads as a decision rather than an omission.
 *
 * The parser checks their shape and `buildSymbolTable` checks that the name
 * resolves; this list exists only so the §3.3 lint does not call them unknown.
 */
export const STRUCTURAL_PROPS: readonly string[] = [
  'component',
  'overrides',
  'props',
  'modes',
  'rootFontSize',
]

/**
 * The offsets a pinned child states instead of a coordinate (ADR 0011 §2).
 *
 * `x` and `y` are already the `MIN` offsets and keep their Figma meaning; these
 * four carry the two edges they cannot. Figma has no spelling for them — it
 * stores a coordinate and recomputes the offset at resize time — so CSS
 * supplies the names, which is ADR 0002's other half.
 *
 * Absent from `PROP_TABLE` on purpose, exactly as `STRUCTURAL_PROPS` is.
 * `resolvePins` consumes them on the way in and the engine never sees them, so
 * no reflow can announce one back at the file.
 */
export const PIN_PROPS: readonly string[] = ['right', 'bottom', 'centerX', 'centerY']

export const KNOWN_PROPS: readonly string[] = [
  // identity & geometry
  'name',
  ...STRUCTURAL_PROPS,
  'width',
  'height',
  'minWidth',
  'maxWidth',
  'minHeight',
  'maxHeight',
  'rotation',
  'x',
  'y',
  ...PIN_PROPS,
  // appearance
  'opacity',
  'visible',
  'locked',
  'blendMode',
  'clipsContent',
  'fills',
  'strokes',
  'effects',
  'cornerRadius',
  'topLeftRadius',
  'topRightRadius',
  'bottomRightRadius',
  'bottomLeftRadius',
  'cornerSmoothing',
  // strokes
  'strokeCap',
  'strokeStartCap',
  'strokeEndCap',
  'strokeJoin',
  'strokeMiterLimit',
  'dashPattern',
  'strokesIncludedInLayout',
  'strokeWeight',
  'strokeAlign',
  'strokeTopWeight',
  'strokeRightWeight',
  'strokeBottomWeight',
  'strokeLeftWeight',
  // masking
  'isMask',
  'maskType',
  // auto layout
  'layoutMode',
  'layoutWrap',
  'itemSpacing',
  'counterAxisSpacing',
  'counterAxisAlignContent',
  'itemReverseZIndex',
  'paddingLeft',
  'paddingRight',
  'paddingTop',
  'paddingBottom',
  'layoutPositioning',
  'layoutGrow',
  'layoutAlign',
  'primaryAxisSizingMode',
  'counterAxisSizingMode',
  'primaryAxisAlignItems',
  'counterAxisAlignItems',
  'constraints',
  // text
  'fontSize',
  'fontFamily',
  'italic',
  'fontWeight',
  'characters',
  'textAutoResize',
  'textDirection',
  'textAlignHorizontal',
  'textAlignVertical',
  'textCase',
  'textDecoration',
  'textTruncation',
  'maxLines',
  'letterSpacing',
  'lineHeight',
  // vector
  'vectorPaths',
  'arcData',
]

const LOOKUP = new Set(KNOWN_PROPS)

export function isKnownProp(name: string): boolean {
  return LOOKUP.has(name)
}
