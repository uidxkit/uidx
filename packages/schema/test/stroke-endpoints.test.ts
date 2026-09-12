import { describe, it, expect } from 'vitest'
import { applyPatches, parseOrThrow } from '@uidx/format'
import { parseSVGPath } from '@open-pencil/scene-graph/parse-path'
import { vectorEndpointShapes } from '@open-pencil/core/vector'
import { computeContentBounds, renderNodesToSVG } from '@open-pencil/core/io'
import {
  fromSceneChange,
  toSceneGraph,
  withStrokeEndpoints,
  STROKE_ENDPOINT_CAPS,
} from '../src/index.js'

const source = `---
id: endpoints
---
## Visual Contract
<Page><Vector name="line" width={100} height={1} strokeStartCap="SQUARE" strokeEndCap="ARROW_EQUILATERAL"
  strokeWeight={4} strokeAlign="CENTER" strokeCap="ROUND"
  strokes={[{ type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 } }]}
  vectorPaths={[{ windingRule: 'NONZERO', data: 'M0 0L100 0' }]} /></Page>`

describe('independent stroke endpoints', () => {
  it('resolves endpoint styles bound to a token', () => {
    const doc = parseOrThrow(
      source.replace('strokeEndCap="ARROW_EQUILATERAL"', 'strokeEndCap="{tips#arrow}"'),
    )
    const scene = toSceneGraph(doc, {
      resolveAlias: (address) => (address === 'tips#arrow' ? 'ARROW_LINES' : undefined),
    })
    expect(scene.graph.getNode('line')!.vectorNetwork!.vertices[1]!.strokeCap).toBe('ARROW_LINES')
  })
  it('composes caps regardless of attribute order and preserves the centerline', () => {
    const scene = toSceneGraph(parseOrThrow(source))
    const network = scene.graph.getNode('line')!.vectorNetwork!
    expect(network.vertices).toMatchObject([
      { x: 0, y: 0, strokeCap: 'SQUARE' },
      { x: 100, y: 0, strokeCap: 'ARROW_EQUILATERAL' },
    ])
    expect(network.segments).toHaveLength(1)
  })

  it('saves an endpoint edit without rewriting geometry or the other endpoint', () => {
    const doc = parseOrThrow(source)
    const scene = toSceneGraph(doc)
    const vectorNetwork = withStrokeEndpoints(scene.graph.getNode('line')!.vectorNetwork!, {
      strokeEndCap: 'DIAMOND_FILLED',
    })
    scene.graph.updateNode('line', { vectorNetwork })
    const ctx = { doc, graph: scene.graph, addresses: scene.addresses }
    expect(fromSceneChange('line', { vectorNetwork }, ctx)).toEqual([])
    const patches = fromSceneChange(
      'line',
      { vectorNetwork },
      { ...ctx, authored: new Set(['strokeEndCap']), authoredFor: 'line' },
    )
    expect(patches).toEqual([
      { op: 'set', address: 'line', prop: 'strokeEndCap', value: 'DIAMOND_FILLED' },
    ])
    const saved = applyPatches(doc.source, patches).source
    expect(saved).toContain("data: 'M0 0L100 0'")
    const reloaded = toSceneGraph(parseOrThrow(saved)).graph.getNode('line')!.vectorNetwork!
    expect(reloaded.vertices.map((v) => v.strokeCap)).toEqual(['SQUARE', 'DIAMOND_FILLED'])
  })

  it('only styles open endpoints in a compound path', () => {
    const network = withStrokeEndpoints(parseSVGPath('M0 0L10 0L10 10ZM20 20L30 30'), {
      strokeStartCap: 'ROUND',
      strokeEndCap: 'SQUARE',
    })
    expect(network.vertices.slice(0, 3).every((v) => v.strokeCap === undefined)).toBe(true)
    expect(network.vertices.slice(-2).map((v) => v.strokeCap)).toEqual(['ROUND', 'SQUARE'])
  })

  it('uses curve tangents to orient tips and handles reversed drawing directions', () => {
    const network = withStrokeEndpoints(parseSVGPath('M100 0C100 50 0 50 0 0'), {
      strokeStartCap: 'ARROW_EQUILATERAL',
      strokeEndCap: 'ARROW_EQUILATERAL',
    })
    const tips = vectorEndpointShapes(network, 4)
    expect(tips).toHaveLength(2)
    expect(tips[0]!.bounds.minY).toBeCloseTo(0)
    expect(tips[0]!.bounds.maxY).toBeCloseTo(12)
    expect(tips[1]!.bounds.maxY).toBeCloseTo(12)
  })

  it('exports every supported tip with finite geometry and includes it in export bounds', () => {
    for (const cap of STROKE_ENDPOINT_CAPS) {
      const doc = parseOrThrow(
        source.replace('strokeEndCap="ARROW_EQUILATERAL"', `strokeEndCap="${cap}"`),
      )
      const scene = toSceneGraph(doc)
      const node = scene.graph.getNode('line')!
      const tips = vectorEndpointShapes(node.vectorNetwork, 4, node.strokeCap)
      const bounds = computeContentBounds(scene.graph, ['line'])!
      for (const tip of tips) {
        expect(tip.d).not.toMatch(/NaN|Infinity/)
        expect(bounds.minY).toBeLessThanOrEqual(tip.bounds.minY)
        expect(bounds.maxY).toBeGreaterThanOrEqual(tip.bounds.maxY)
      }
      const svg = renderNodesToSVG(scene.graph, scene.rootId, ['line'])!
      expect(svg).toContain('stroke-linecap="butt"')
      for (const tip of tips) expect(svg).toContain(tip.d)
    }
  })
})
