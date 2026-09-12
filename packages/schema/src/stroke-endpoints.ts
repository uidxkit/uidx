import type { SceneNode, VectorNetwork } from '@open-pencil/scene-graph'
import { vectorEndpoints } from '@open-pencil/core/vector'
import { aliasTarget, type JsonValue } from '@uidx/format'

export const STROKE_ENDPOINT_CAPS = [
  'NONE',
  'ROUND',
  'SQUARE',
  'ARROW_LINES',
  'ARROW_EQUILATERAL',
  'TRIANGLE_REVERSE',
  'DIAMOND_FILLED',
  'CIRCLE_FILLED',
] as const
export type StrokeEndpointProp = 'strokeStartCap' | 'strokeEndCap'
export function isStrokeEndpointProp(prop: string): prop is StrokeEndpointProp {
  return prop === 'strokeStartCap' || prop === 'strokeEndCap'
}

/** Endpoint properties decorate the network without altering its path geometry. */
export function withStrokeEndpoints(
  network: VectorNetwork,
  caps: { strokeStartCap?: JsonValue; strokeEndCap?: JsonValue },
  resolveAlias?: (address: string) => JsonValue | undefined,
): VectorNetwork {
  const vertices = network.vertices.map((vertex) => ({ ...vertex }))
  for (const endpoint of vectorEndpoints(network)) {
    const value = caps[endpoint.start ? 'strokeStartCap' : 'strokeEndCap']
    const target = value === undefined ? null : aliasTarget(value)
    const cap = target === null ? value : resolveAlias?.(target)
    if (typeof cap === 'string' && (STROKE_ENDPOINT_CAPS as readonly string[]).includes(cap))
      vertices[endpoint.vertex]!.strokeCap = cap
  }
  return { ...network, vertices }
}

export function strokeEndpointValue(node: Partial<SceneNode>, prop: StrokeEndpointProp): string {
  const start = prop === 'strokeStartCap'
  const endpoint = vectorEndpoints(node.vectorNetwork).find((end) => end.start === start)
  return (
    (endpoint ? node.vectorNetwork?.vertices[endpoint.vertex]?.strokeCap : undefined) ??
    node.strokeCap ??
    'NONE'
  )
}
