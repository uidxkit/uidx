// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import CanvasKitInit, { type CanvasKit, type TypefaceFontProvider } from 'canvaskit-wasm'
import { renderNodesToSVG } from '@open-pencil/core/io'
import { parseOrThrow } from '@uidx/format'
import { toSceneGraph } from '@uidx/schema'
// Exercise the patched paragraph builder used by the canvas and raster exporter.
import { buildParagraph } from '../node_modules/@open-pencil/core/dist/canvas/text/index.js'

const require = createRequire(import.meta.url)
let ck: CanvasKit
let fontProvider: TypefaceFontProvider

beforeAll(async () => {
  const wasmPath = require.resolve('canvaskit-wasm/bin/canvaskit.wasm')
  const options = { locateFile: () => wasmPath, wasmBinary: readFileSync(wasmPath) }
  ck = await CanvasKitInit(options)
  fontProvider = ck.TypefaceFontProvider.Make()
  const core = dirname(require.resolve('@open-pencil/core/package.json'))
  fontProvider.registerFont(readFileSync(join(core, 'assets/Inter-Regular.ttf')), 'Inter')
  fontProvider.registerFont(
    readFileSync(join(core, 'assets/NotoNaskhArabic-Regular.ttf')),
    'Noto Naskh Arabic',
  )
})
afterAll(() => fontProvider?.delete())

describe('text direction rendering', () => {
  for (const direction of ['AUTO', 'LTR', 'RTL'] as const) {
    for (const alignment of ['LEFT', 'CENTER', 'RIGHT'] as const) {
      it(`keeps ${alignment} alignment with ${direction} text in canvas and SVG`, () => {
        const source = `---
id: alignment
---
## Visual Contract
<Page><Text name="label" characters="مرحبا hello 123" fontFamily="Noto Naskh Arabic" width={400} height={60} fontSize={24} textDirection="${direction}" textAlignHorizontal="${alignment}" /></Page>`
        const scene = toSceneGraph(parseOrThrow(source))
        const node = scene.graph.getNode('label')!
        const paragraph = buildParagraph({ ck, fontProvider, fontsLoaded: true }, node)
        try {
          const rects = paragraph.getRectsForRange(
            0,
            node.text.length,
            ck.RectHeightStyle.Tight,
            ck.RectWidthStyle.Tight,
          )
          expect(rects.length).toBeGreaterThan(0)
          const left = Math.min(...rects.map(({ rect }) => rect[0]!))
          const right = Math.max(...rects.map(({ rect }) => rect[2]!))
          if (alignment === 'LEFT') expect(left).toBeCloseTo(0, 0)
          if (alignment === 'CENTER') expect((left + right) / 2).toBeCloseTo(200, 0)
          if (alignment === 'RIGHT') expect(right).toBeCloseTo(400, 0)
        } finally {
          paragraph.delete()
        }
        const svg = renderNodesToSVG(scene.graph, scene.rootId, ['label'])!
        const text = svg.match(/<text\b[^>]*>/)![0]
        const rtl = direction !== 'LTR'
        expect(text).toContain(
          `x="${alignment === 'CENTER' ? 200 : alignment === 'RIGHT' ? 400 : 0}"`,
        )
        expect(text.includes('direction="rtl"')).toBe(rtl)
        if (alignment === 'CENTER') expect(text).toContain('text-anchor="middle"')
        else
          expect(text.includes('text-anchor="end"')).toBe(
            rtl ? alignment === 'LEFT' : alignment === 'RIGHT',
          )
      })
    }
  }
})
