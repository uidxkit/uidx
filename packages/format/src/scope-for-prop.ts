import type { VariableScope } from './types.js'

/**
 * Which scopes gate each bindable property (story G8).
 *
 * Lives here rather than in `@uidx/schema` because it is vocabulary, not scene
 * mapping: property names and `VariableScope` are both this package's, so every
 * consumer already depends on it — the panel, and `uidx check` through the
 * server, which deliberately does not depend on schema.
 *
 * Transcribed from `docs/research/figma-binding-matrix.json`, whose rows carry
 * the Figma scope for every bindable property — read from the file rather than
 * from memory, which is what that research artefact was built to be used for.
 *
 * One deliberate departure, recorded in the spec's divergence table: padding
 * gets `SPACING` where Figma files it under `GAP`, so a padding scale stops
 * offering itself for gaps. Export maps `SPACING` back down to `GAP`.
 */
export const SCOPE_FOR_PROP: Readonly<Record<string, readonly VariableScope[]>> = {
  cornerRadius: ['CORNER_RADIUS'],
  topLeftRadius: ['CORNER_RADIUS'],
  topRightRadius: ['CORNER_RADIUS'],
  bottomLeftRadius: ['CORNER_RADIUS'],
  bottomRightRadius: ['CORNER_RADIUS'],
  width: ['WIDTH_HEIGHT'],
  height: ['WIDTH_HEIGHT'],
  minWidth: ['WIDTH_HEIGHT'],
  maxWidth: ['WIDTH_HEIGHT'],
  minHeight: ['WIDTH_HEIGHT'],
  maxHeight: ['WIDTH_HEIGHT'],
  paddingTop: ['SPACING'],
  paddingRight: ['SPACING'],
  paddingBottom: ['SPACING'],
  paddingLeft: ['SPACING'],
  itemSpacing: ['GAP'],
  counterAxisSpacing: ['GAP'],
  gridRowGap: ['GAP'],
  gridColumnGap: ['GAP'],
  strokeWeight: ['STROKE_FLOAT'],
  strokeTopWeight: ['STROKE_FLOAT'],
  strokeRightWeight: ['STROKE_FLOAT'],
  strokeBottomWeight: ['STROKE_FLOAT'],
  strokeLeftWeight: ['STROKE_FLOAT'],
  opacity: ['OPACITY'],
  characters: ['TEXT_CONTENT'],
  fontFamily: ['FONT_FAMILY'],
  fontStyle: ['FONT_STYLE'],
  fontWeight: ['FONT_WEIGHT'],
  fontSize: ['FONT_SIZE'],
  lineHeight: ['LINE_HEIGHT'],
  letterSpacing: ['LETTER_SPACING'],
  paragraphSpacing: ['PARAGRAPH_SPACING'],
  paragraphIndent: ['PARAGRAPH_INDENT'],
  fills: ['ALL_FILLS', 'FRAME_FILL', 'SHAPE_FILL', 'TEXT_FILL'],
  strokes: ['STROKE_COLOR'],
  effects: ['EFFECT_COLOR'],
  textRangeFills: ['TEXT_FILL', 'ALL_FILLS'],
}

/**
 * The scopes gating a property, or null when it has no entry.
 *
 * Null rather than an empty list, because the two mean opposite things: an
 * unmapped property is *under-filtered* — every variable of the right type is
 * offered — rather than unbindable. A property added tomorrow keeps working.
 */
export function scopesForProp(prop: string): readonly VariableScope[] | null {
  return SCOPE_FOR_PROP[prop] ?? null
}
