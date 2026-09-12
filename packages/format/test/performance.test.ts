import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { applyPatch, parse, parseOrThrow, positionAt } from '../src/index.js'

/**
 * Spec §5 states a parse budget of under 10ms for a 500-line file.
 *
 * This is not a nice-to-have: §6.3 re-parses between *every* structural patch
 * on the assumption that parsing is nearly free, and §9.2 re-parses after each
 * applied patch. If the budget is wrong, that strategy needs rethinking — so it
 * is worth a test rather than an assumption.
 *
 * The budget was missed for a long time — 13.6ms — and dropping acorn from the
 * MDX extensions is what closed the gap. Timing assertions here stay generous,
 * because CI runners are shared and a tight bound would flake; the durable guard
 * against that regression is `does not parse JavaScript` below, which pins the
 * decision rather than the clock. The measured figures are printed so a real
 * regression is visible even while the timing tests pass.
 */

const TARGET_MS = 10
const CEILING_MS = 60

/** A ~500-line contract: one frame of many children, each with several props. */
function generate(children: number): string {
  const nodes = Array.from(
    { length: children },
    (_, i) => `    <Text
      name="row-${i}"
      characters="Row number ${i}"
      fontSize={${12 + (i % 6)}}
      fontWeight="BOLD"
      textAutoResize="WIDTH_AND_HEIGHT"
      fills={[{ type: 'SOLID', color: { r: ${(i % 10) / 10}, g: 0.4, b: 0.9, a: 1 } }]}
    />`,
  ).join('\n')

  return `---
id: big-list
---

## Core Intent

A stress fixture.

## Visual Contract

<Component name="big-list" status="draft">
  <Frame name="list" layoutMode="VERTICAL" itemSpacing={4}>
${nodes}
  </Frame>
</Component>
`
}

function median(run: () => void, iterations = 25): number {
  const samples: number[] = []
  for (let i = 0; i < iterations; i++) {
    const started = performance.now()
    run()
    samples.push(performance.now() - started)
  }
  return samples.sort((a, b) => a - b)[Math.floor(samples.length / 2)]!
}

describe('parse budget (spec §5)', () => {
  const source = generate(62) // ~500 lines
  const lines = source.split('\n').length

  it('builds a fixture of about 500 lines', () => {
    expect(lines).toBeGreaterThan(450)
    expect(lines).toBeLessThan(560)
  })

  it('parses well inside the budget', () => {
    // Warm up, so the first-call JIT cost is not what gets measured.
    parse(source)
    const ms = median(() => parse(source))
    console.log(`    parse: ${ms.toFixed(2)}ms for ${lines} lines (§5 target ${TARGET_MS}ms)`)
    expect(ms).toBeLessThan(CEILING_MS)
  })

  it('applies a patch inside the budget too', () => {
    // applyPatch parses twice — once to resolve, once to validate the result —
    // so its cost is the number that actually bounds the write path.
    const patch = {
      op: 'set',
      address: 'big-list#list/row-0',
      prop: 'fontSize',
      value: 20,
    } as const
    applyPatch(source, patch)
    const ms = median(() => applyPatch(source, patch), 15)
    console.log(`    patch: ${ms.toFixed(2)}ms (two parses)`)
    expect(ms).toBeLessThan(CEILING_MS * 2)
  })

  it('costs about one parse when the caller already has the document', () => {
    // What a `FileSession` will do: it holds the parsed document for the source
    // it is about to patch, so the resolving parse is redundant work.
    const patch = {
      op: 'set',
      address: 'big-list#list/row-0',
      prop: 'fontSize',
      value: 20,
    } as const
    const document = parseOrThrow(source)
    applyPatch(source, patch, { document })
    const both = median(() => applyPatch(source, patch), 15)
    const one = median(() => applyPatch(source, patch, { document }), 15)
    console.log(`    patch with document: ${one.toFixed(2)}ms vs ${both.toFixed(2)}ms`)
    // Loose on purpose: the claim is "the second parse went away", not a ratio.
    expect(one).toBeLessThan(both)
  })

  it('rejects a document that does not describe the source it is patching', () => {
    const document = parseOrThrow(source)
    const other = source.replace('Row number 0', 'Row number zero')
    expect(() =>
      applyPatch(
        other,
        { op: 'set', address: 'big-list#list/row-0', prop: 'fontSize', value: 20 },
        { document },
      ),
    ).toThrow(/different source/)
  })

  /**
   * The §5 budget was missed because `micromark-extension-mdxjs` runs acorn over
   * every expression and stores an estree UIDX never reads — `values.ts` re-parses
   * attribute values under the restricted §3.3 grammar regardless.
   *
   * A timing test cannot defend that: reintroducing acorn costs ~4ms, which is
   * inside the flake margin of any bound a shared runner can carry. So the guard
   * is the dependency itself.
   */
  it('does not parse JavaScript', async () => {
    const require = createRequire(import.meta.url)
    const pkg = require('../package.json') as { dependencies: Record<string, string> }
    const deps = Object.keys(pkg.dependencies)
    expect(deps).not.toContain('micromark-extension-mdxjs')
    expect(deps).not.toContain('mdast-util-mdx')
    expect(deps).not.toContain('acorn')
  })

  /**
   * `positionAt` is asked once per reference, not once per file.
   *
   * The workspace rebuilds its symbol table on every patch, and
   * `collectReferences` maps each alias's offset to a line — 9,198 of them on
   * this repo's `design-systems/simple`. A scan from index 0 per call makes
   * that quadratic in file size: measured on 2026-09-02 it read 553 million
   * characters and cost ~1s, twice per patch, which is the whole of the
   * second-plus lag between picking Hug in the panel and the file coming back.
   *
   * So the guard is on the shape of the cost, not on a clock: eight times the
   * offsets must not cost sixty-four times the time.
   */
  it('maps offsets to positions without rescanning from the start', () => {
    const positions = (lines: number): (() => void) => {
      const source = Array.from({ length: lines }, (_, i) => `line ${i}`).join('\n')
      const offsets = Array.from({ length: lines }, (_, i) => i * 7)
      return () => {
        for (const offset of offsets) positionAt(source, offset)
      }
    }
    const small = positions(500)
    const large = positions(4000)
    small()
    large()
    const smallMs = median(small, 5)
    const largeMs = median(large, 5)
    console.log(`    positionAt: ${smallMs.toFixed(2)}ms / ${largeMs.toFixed(2)}ms (500 / 4000)`)
    // Eight times the work. Linear lands near 8x; the scan-from-zero loop lands
    // near 64x, which is what this exists to catch.
    expect(largeMs / Math.max(smallMs, 0.001)).toBeLessThan(20)
  })

  it('scales roughly linearly, not quadratically', () => {
    const small = generate(30)
    const large = generate(120)
    parse(small)
    parse(large)
    const smallMs = median(() => parse(small))
    const largeMs = median(() => parse(large))
    // 4x the nodes should not cost dramatically more than 4x the time; a
    // quadratic parser would show up here long before it hurt a real file.
    expect(largeMs / Math.max(smallMs, 0.01)).toBeLessThan(12)
  })
})
