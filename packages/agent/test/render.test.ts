import { parse, type UidxDocument } from '@uidx/format'
import { describe, expect, it } from 'vitest'

import { renderToPng } from '../src/render.js'

const doc = (source: string): UidxDocument => {
  const result = parse(source)
  if (!result.doc) throw new Error(result.diagnostics.map((d) => d.message).join('; '))
  return result.doc
}

const TOKENS = doc(`---
id: tokens
---

## Visual Contract

<Tokens>
  <Collection name="radius">
    <Variable name="lg" type="FLOAT" value={60} />
  </Collection>
</Tokens>
`)

const PAGE = doc(`---
id: home
---

## Visual Contract

<Page>
  <Frame name="card" width={200} height={120} cornerRadius="{radius#lg}"
    fills={[{ type: 'SOLID', color: { r: 0.1, g: 0.4, b: 0.9, a: 1 } }]}>
    <Text name="title" characters="Hello" fontSize={24}
      fills={[{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 } }]} />
  </Frame>
</Page>
`)

const docs = new Map([
  ['tokens.uidx', TOKENS],
  ['home.uidx', PAGE],
])

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47]

describe('renderToPng', () => {
  it('renders a whole page to PNG bytes', async () => {
    const bytes = await renderToPng({ docs, file: 'home.uidx' })
    expect([...bytes.slice(0, 4)]).toEqual(PNG_MAGIC)
    expect(bytes.byteLength).toBeGreaterThan(1_000)
  }, 60_000)

  it('renders one node by address', async () => {
    const bytes = await renderToPng({ docs, file: 'home.uidx', address: 'card' })
    expect([...bytes.slice(0, 4)]).toEqual(PNG_MAGIC)
  }, 60_000)

  /**
   * Why this reuses `buildTokenIndex` rather than rendering a page in
   * isolation: the radius lives in another file. A render that missed it would
   * not fail — it would draw the corner square instead of round, and the model
   * would "verify" a picture the canvas never shows.
   */
  it('resolves a token defined in another file', async () => {
    const together = await renderToPng({ docs, file: 'home.uidx' })
    const alone = await renderToPng({ docs: new Map([['home.uidx', PAGE]]), file: 'home.uidx' })
    expect(Buffer.from(together).equals(Buffer.from(alone))).toBe(false)
  }, 60_000)

  it('refuses an address that is not on the page, naming what is', async () => {
    await expect(renderToPng({ docs, file: 'home.uidx', address: 'nope' })).rejects.toThrow(
      /the page holds card/,
    )
  }, 60_000)

  it('refuses a page it does not have, listing the ones it does', async () => {
    await expect(renderToPng({ docs, file: 'ghost.uidx' })).rejects.toThrow(/home\.uidx/)
  })

  /**
   * The font trap, made visible. `headlessRenderNodes` seeds no fonts, and an
   * unseeded face does not error — the node's font demand simply never settles
   * and it draws nothing, so a page comes back as its frames with every label
   * missing. That reads as a layout bug and is not one. Two identical frames
   * differing only in whether they carry text must not rasterise the same.
   */
  it('actually draws text, rather than silently dropping every label', async () => {
    const blank = doc(`---
id: blank
---

## Visual Contract

<Page>
  <Frame name="card" width={200} height={120}
    fills={[{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 } }]} />
</Page>
`)
    const lettered = doc(`---
id: lettered
---

## Visual Contract

<Page>
  <Frame name="card" width={200} height={120}
    fills={[{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 } }]}>
    <Text name="title" characters="Hello" fontSize={48}
      fills={[{ type: 'SOLID', color: { r: 0, g: 0, b: 0, a: 1 } }]} />
  </Frame>
</Page>
`)
    const without = await renderToPng({ docs: new Map([['b.uidx', blank]]), file: 'b.uidx' })
    const with_ = await renderToPng({ docs: new Map([['l.uidx', lettered]]), file: 'l.uidx' })
    expect(Buffer.from(with_).equals(Buffer.from(without))).toBe(false)
  }, 60_000)

  it('refuses a token file, which declares collections rather than a scene', async () => {
    await expect(renderToPng({ docs, file: 'tokens.uidx' })).rejects.toThrow(/not a scene/)
  })
})
