import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { vectorNetworkToPath } from '@open-pencil/core'
import { renderNodesToSVG } from '@open-pencil/core/io'
import { parseSVGPath } from '@open-pencil/scene-graph/parse-path'
import { applyPatches, parseOrThrow, resolve } from '@uidx/format'
import { fromSceneChange, scenePropFor, toSceneGraph } from '@uidx/schema'
import { drawingBounds, graphicShape, simplifyPencil } from '../src/graphics-tools'
import { insertVertex, networkOf, subpathsOf } from '../src/vertex-edit'
import { resizeVectorPaths } from '../src/vector-resize'
import GraphicsSection from '../src/GraphicsSection.vue'

const source = `---
id: graphics
---
## Visual Contract
<Page>
  <Vector name="icon" width={24} height={24} vectorPaths={[{ windingRule: 'NONZERO', data: 'M0 0 L24 0 L24 24 Z' }]} />
</Page>`

describe('graphics geometry', () => {
  it('keeps proportions and draws from the center in every drag direction', () => {
    expect(
      drawingBounds({ x: 100, y: 100 }, { x: 80, y: 130 }, { shiftKey: true, altKey: true }),
    ).toEqual({ x: 70, y: 70, width: 60, height: 60 })
  })

  it('preserves line direction and snaps Shift-drag to 45 degrees', () => {
    const line = graphicShape('Line', { x: 100, y: 100 }, { x: 0, y: 120 }, { shiftKey: true })
    expect(line.vertices[1]!.x).toBeLessThan(line.vertices[0]!.x)
    expect(line.vertices[1]!.y).toBeCloseTo(100)
    const arrow = graphicShape('Arrow', { x: 10, y: 20 }, { x: 110, y: 20 })
    // Arrowheads are stroke properties; the editable path has only two ends.
    expect(arrow.vertices.map(({ x, y }) => [x, y])).toEqual([
      [10, 20],
      [110, 20],
    ])
  })

  it('simplifies freehand input while keeping a sharp corner and both ends', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 5, y: 0.1 },
      { x: 10, y: 0 },
      { x: 10, y: 5 },
      { x: 10, y: 10 },
    ]
    expect(simplifyPencil(points, 0.5).map(({ x, y }) => [x, y])).toEqual([
      [0, 0],
      [10, 0],
      [10, 10],
    ])
  })

  it('adds a point on a cubic without changing the curve', () => {
    const original = subpathsOf(parseSVGPath('M0 0 C0 100 100 100 100 0'))
    const divided = insertVertex(original, { subpath: 0, index: 0 })!
    expect(divided[0]!.vertices[1]).toEqual({
      x: 50,
      y: 75,
      in: { x: -25, y: 0 },
      out: { x: 25, y: 0 },
    })
    expect(divided[0]!.vertices[0]!.out).toEqual({ x: 0, y: 50 })
    expect(divided[0]!.vertices[2]!.in).toEqual({ x: 0, y: 50 })
    expect(original[0]!.vertices).toHaveLength(2)
    expect(networkOf(divided).segments).toHaveLength(2)
  })

  it('resizes ink through the same scene and file writeback used by the canvas', () => {
    const doc = parseOrThrow(source)
    const node = resolve(doc.tree, 'icon')!
    const resized = resizeVectorPaths(
      node.attrs.vectorPaths!.value,
      { width: 24, height: 24 },
      { width: 48, height: 12 },
    )!
    const scene = toSceneGraph(doc)
    const geometry = scenePropFor('vectorPaths', resized)!
    scene.graph.runPreviewUpdates(() =>
      scene.graph.updateNode('icon', { ...geometry, width: 48, height: 12 }),
    )
    scene.graph.updateNode('icon', { ...geometry, width: 48, height: 12 })
    const patches = fromSceneChange(
      'icon',
      { ...geometry, width: 48, height: 12 },
      {
        doc,
        graph: scene.graph,
        addresses: scene.addresses,
        authored: new Set(['vectorPaths', 'width', 'height']),
        authoredFor: 'icon',
      },
    )
    const saved = parseOrThrow(applyPatches(doc.source, patches).source)
    const reloaded = toSceneGraph(saved).graph.getNode('icon')!
    expect(reloaded.vectorNetwork!.vertices.map(({ x, y }) => [x, y])).toEqual([
      [0, 0],
      [48, 0],
      [48, 12],
    ])
    expect(reloaded.width).toBe(48)
    expect(reloaded.height).toBe(12)
    const restored = scenePropFor(
      'vectorPaths',
      resizeVectorPaths(
        node.attrs.vectorPaths!.value,
        { width: 24, height: 24 },
        { width: 24, height: 24 },
      )!,
    )!
    expect(restored.vectorNetwork?.vertices.map(({ x, y }) => [x, y])).toEqual([
      [0, 0],
      [24, 0],
      [24, 24],
    ])
  })
})

describe('the vector properties panel', () => {
  const node = resolve(parseOrThrow(source).tree, 'icon')!
  it('enters vector mode and offers component reuse', async () => {
    const w = mount(GraphicsSection, { props: { node, writable: true, canMakeComponent: true } })
    expect(w.text()).toContain('3 points · 1 path')
    await w.get('.edit-vector').trigger('click')
    expect(w.emitted('edit')).toEqual([['icon']])
    await w.get('.reuse').trigger('click')
    expect(w.emitted('makeComponent')).toHaveLength(1)
  })

  it('keeps path spelling when the fill rule changes', async () => {
    const w = mount(GraphicsSection, { props: { node, writable: true, canMakeComponent: false } })
    await w.get('select').setValue('EVENODD')
    expect(w.emitted('patches')?.[0]).toEqual([
      [
        {
          op: 'set',
          address: 'icon',
          prop: 'vectorPaths',
          value: [{ windingRule: 'EVENODD', data: 'M0 0 L24 0 L24 24 Z' }],
        },
      ],
    ])
  })

  it('enables point actions only when a point is selected and writable', async () => {
    const info = {
      id: 'icon',
      points: 3,
      paths: 1,
      selected: false,
      closed: true,
      canDelete: false,
    }
    const w = mount(GraphicsSection, {
      props: { node, info, writable: true, canMakeComponent: false },
    })
    expect(w.get('.point-actions button').attributes('disabled')).toBeDefined()
    await w.setProps({ info: { ...info, selected: true, canDelete: true } })
    await w.get('.point-actions button').trigger('click')
    expect(w.emitted('action')).toEqual([['corner']])
    await w.setProps({ writable: false })
    for (const b of w.findAll('.point-actions button'))
      expect(b.attributes('disabled')).toBeDefined()
  })
})

describe('compound icon rendering and export', () => {
  const doc = parseOrThrow(`---
id: compound
---
## Visual Contract
<Page><Vector name="icon" width={32} height={32}
 fills={[{ type: 'SOLID', color: { r: 0, g: 0, b: 0, a: 1 } }]}
 strokes={[{ type: 'SOLID', color: { r: 0, g: 0, b: 0, a: 1 } }]} strokeWeight={1}
 vectorPaths={[{ windingRule: 'EVENODD', data: 'M0 0L10 0L10 10Z' }, { windingRule: 'NONZERO', data: 'M2 5L8 5' }]} /></Page>`)

  it('draws the open detail as well as the closed outline', () => {
    class Path {
      lines: number[][] = []
      moveTo() {}
      lineTo(x: number, y: number) {
        this.lines.push([x, y])
      }
      close() {}
      setFillType() {}
    }
    const scene = toSceneGraph(doc)
    const paths = vectorNetworkToPath(
      { Path, FillType: { EvenOdd: 0, Winding: 1 } } as never,
      scene.graph.getNode('icon')!.vectorNetwork!,
    ) as unknown as Path[]
    expect(paths).toHaveLength(2)
    expect(paths[1]!.lines).toEqual([[8, 5]])
  })

  it('exports the fill rule and the open detail into SVG', () => {
    const scene = toSceneGraph(doc)
    const svg = renderNodesToSVG(scene.graph, scene.rootId, ['icon'])
    if (svg === null) throw new Error('Expected SVG export')
    expect(svg).toContain('fill-rule="evenodd"')
    expect(svg).toContain('M2 5L8 5')
    const paths = new DOMParser().parseFromString(svg, 'image/svg+xml').querySelectorAll('path')
    expect([...paths].find((p) => p.getAttribute('d') === 'M2 5L8 5')?.getAttribute('fill')).toBe(
      'none',
    )
  })
})
