import type { JsonValue, UidxNode, UidxPatch } from '@uidx/format'
import { isStrokeEndpointProp, scenePropFor, scenePropsFor } from '@uidx/schema'

const STROKE_PROPS = new Set([
  'strokes',
  'strokeWeight',
  'strokeAlign',
  'strokeCap',
  'strokeJoin',
  'strokeMiterLimit',
  'dashPattern',
  'strokeStartCap',
  'strokeEndCap',
])

/** Compose the renderer's Stroke[] while saving only the authored property.
 * Scene strokes fold color, weight, alignment and caps into one record; writing
 * that record back would leak engine fields or replace source paint aliases.
 */
export function strokeEdit(
  node: UidxNode,
  prop: string,
  value: JsonValue,
  resolveAlias?: (address: string) => JsonValue | undefined,
  rootFontSize = 16,
) {
  if (!STROKE_PROPS.has(prop)) return null
  const updated: UidxNode = {
    ...node,
    attrs: {
      ...node.attrs,
      [prop]: { name: prop, value, raw: '', loc: node.loc, valueLoc: node.loc },
    },
  }
  const composed = scenePropsFor(updated, [], resolveAlias, undefined, rootFontSize)
  const fields = {
    ...scenePropFor(prop, value, { resolveAlias, at: node.address, rootFontSize }),
    ...(composed.strokes ? { strokes: composed.strokes } : {}),
    ...(isStrokeEndpointProp(prop) ? { vectorNetwork: composed.vectorNetwork } : {}),
  }
  const existing = node.attrs[prop]
  const patches: UidxPatch[] =
    JSON.stringify(existing?.value) === JSON.stringify(value)
      ? []
      : [
          {
            op: existing ? 'set' : 'add',
            address: node.address,
            prop,
            value,
          },
        ]
  return { fields, patches }
}
