import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { findManifest, loadDocument } from '../src/index.js'

/**
 * ADR 0004 made document load mandatory before first paint, and the backlog
 * carried a worry that it multiplies the missed §5 parse budget by page count.
 * It did: this measured 362ms for 20 pages, ~18ms each, all of it ahead of the
 * browser opening.
 *
 * Both halves of that were addressed. The parser lost its JavaScript parse (§5),
 * which is most of the per-page figure below; and `createUidxServer` now boots
 * Vite concurrently with the load, so what remains overlaps work that has to
 * happen anyway rather than preceding it.
 *
 * The per-page assertion is what keeps this honest. A whole-document bound would
 * pass or fail on page count, which is the user's business rather than the
 * tool's — per page is the figure comparable to the §5 budget, and the one that
 * says whether the parser regressed.
 */

/** Per page, against §5's 10ms for a file about this size. Generous for CI. */
const PER_PAGE_CEILING_MS = 30

const PAGES = 20
const ROWS = 120

let dir: string

function page(index: number): string {
  const rows = Array.from(
    { length: ROWS },
    (_, i) =>
      `      <Text name="row-${i}" characters="Row ${i}" fontSize={14} ` +
      `fills={[{ type: 'SOLID', color: { r: ${(i % 10) / 10}, g: 0.4, b: 0.9, a: 1 } }]} />`,
  ).join('\n')

  return `---
id: page-${index}
---

## Visual Contract

<Page>
  <Component name="Sys/Comp${index}" status="draft">
    <Frame name="list" layoutMode="VERTICAL" itemSpacing={4}>
${rows}
    </Frame>
  </Component>
</Page>
`
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'uidx-docperf-'))
  await mkdir(join(dir, 'pages'), { recursive: true })
  await writeFile(
    join(dir, 'uidx.json'),
    JSON.stringify({ id: 'perf', files: ['pages/**/*.uidx'] }),
  )
  for (let i = 0; i < PAGES; i++) {
    await writeFile(join(dir, 'pages', `page-${i}.uidx`), page(i))
  }
})

describe('document load (G3)', () => {
  it('loads every member of the document', async () => {
    const loaded = await loadDocument((await findManifest(dir))!)
    expect(loaded.pages).toHaveLength(PAGES)
    expect(loaded.pages.every((p) => p.result.doc !== null)).toBe(true)
  })

  it('parses each page at about the §5 rate', async () => {
    const found = (await findManifest(dir))!
    await loadDocument(found) // warm up, so JIT cost is not what gets measured

    const parses: number[] = []
    const reads: number[] = []
    for (let i = 0; i < 5; i++) {
      const loaded = await loadDocument(found)
      parses.push(loaded.parseMs)
      reads.push(loaded.readMs)
    }
    const mid = (xs: number[]) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)]!
    const median = mid(parses)

    const lines = page(0).split('\n').length
    console.log(
      `document load: ${PAGES} pages of ~${lines} lines — ` +
        `parse ${median.toFixed(1)}ms (${(median / PAGES).toFixed(2)}ms/page), ` +
        `read ${mid(reads).toFixed(1)}ms`,
    )

    // Generous on purpose: this guards against an order-of-magnitude regression
    // in document load, not against normal machine-to-machine variance.
    expect(median / PAGES).toBeLessThan(PER_PAGE_CEILING_MS)
  })
})
