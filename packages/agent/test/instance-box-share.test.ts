import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inflateSync } from 'node:zlib'
import { parse, type UidxDocument } from '@uidx/format'
import { describe, expect, it } from 'vitest'

import { renderToPng } from '../src/render.js'

/**
 * An instance restyled from outside (ADR 0018), as `uidx render` and
 * `uidx share` draw it: through the same scene build as the canvas, so the
 * pill turns red where the canvas shows it red and nothing paints the
 * wrapper around it.
 */
const repo = join(dirname(fileURLToPath(import.meta.url)), '../../..')

/**
 * The scene-regression fixture page and the components it places, named
 * file by file: the design-system example's library, and the fixture's own
 * Button1 and component kinds. A scratch page in someone's checkout of the
 * example must not join.
 */
const FILES = [
  'examples/design-system/.uidx/tokens.uidx',
  'examples/design-system/.uidx/button.uidx',
  'examples/design-system/.uidx/checkbox.uidx',
  'examples/design-system/.uidx/checkbox-field.uidx',
  'examples/design-system/.uidx/field.uidx',
  'packages/schema/test/fixtures/instance-box/button1.uidx',
  'packages/schema/test/fixtures/instance-box/kinds.uidx',
  'packages/schema/test/fixtures/instance-box/overrides.uidx',
]
const OVERRIDES = FILES.at(-1)!

const docs = new Map<string, UidxDocument>(
  FILES.map((file) => {
    const result = parse(readFileSync(join(repo, file), 'utf8'))
    if (!result.doc) throw new Error(result.diagnostics.map((d) => d.message).join('; '))
    return [file, result.doc]
  }),
)

interface Image {
  width: number
  height: number
  /** RGBA at (x, y), 0–255. */
  at(x: number, y: number): [number, number, number, number]
}

/**
 * The pixels of an 8-bit RGB or RGBA PNG, which is what the headless
 * renderer writes. Enough of the format to read a pixel back, no more.
 */
function decodePng(bytes: Uint8Array): Image {
  const data = Buffer.from(bytes)
  let offset = 8
  let width = 0
  let height = 0
  let channels = 4
  const compressed: Buffer[] = []
  while (offset < data.length) {
    const length = data.readUInt32BE(offset)
    const type = data.toString('ascii', offset + 4, offset + 8)
    const body = data.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = body.readUInt32BE(0)
      height = body.readUInt32BE(4)
      const [depth, colorType, , , interlace] = [body[8], body[9], body[10], body[11], body[12]]
      if (depth !== 8 || interlace !== 0 || (colorType !== 6 && colorType !== 2))
        throw new Error(`unsupported PNG: depth ${depth}, colour type ${colorType}`)
      channels = colorType === 6 ? 4 : 3
    } else if (type === 'IDAT') compressed.push(body)
    offset += 12 + length
  }
  const raw = inflateSync(Buffer.concat(compressed))
  const stride = width * channels
  const pixels = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!
    for (let x = 0; x < stride; x++) {
      const value = raw[y * (stride + 1) + 1 + x]!
      const left = x >= channels ? pixels[y * stride + x - channels]! : 0
      const up = y > 0 ? pixels[(y - 1) * stride + x]! : 0
      const corner = x >= channels && y > 0 ? pixels[(y - 1) * stride + x - channels]! : 0
      const predicted =
        filter === 1
          ? left
          : filter === 2
            ? up
            : filter === 3
              ? (left + up) >> 1
              : filter === 4
                ? paeth(left, up, corner)
                : 0
      pixels[y * stride + x] = (value + predicted) & 0xff
    }
  }
  return {
    width,
    height,
    at(x, y) {
      const i = y * stride + x * channels
      return [pixels[i]!, pixels[i + 1]!, pixels[i + 2]!, channels === 4 ? pixels[i + 3]! : 255]
    },
  }
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

const render = async (address: string) =>
  decodePng(await renderToPng({ docs, file: OVERRIDES, address }))

/** Red: `surface#danger` (220, 38, 38) or the literal (255, 0, 0), opaque. */
const isRed = ([r, g, b, a]: [number, number, number, number]) =>
  r > 200 && g < 80 && b < 80 && a > 240

describe('a restyled instance renders as the canvas draws it (ADR 0018 §6)', () => {
  it('paints the pill red, where the wrapper used to be painted instead', async () => {
    const image = await render('styled')
    // Above the label and inside the stroke: the pill's own fill.
    expect(isRed(image.at(Math.floor(image.width / 2), 4))).toBe(true)
  }, 60_000)

  it('leaves the wrapper unpainted: the rounded pill’s corner shows through', async () => {
    const image = await render('sized')
    expect(image.width).toBe(199)
    expect(image.at(0, 0)[3]).toBeLessThan(10)
    // Inside the pill, clear of its label.
    expect(isRed(image.at(30, Math.floor(image.height / 2)))).toBe(true)
  }, 60_000)
})
