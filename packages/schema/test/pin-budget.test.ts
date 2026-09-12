import { describe, expect, it } from 'vitest'
import { parseOrThrow } from '@uidx/format'
import { layOutEntity, toSceneGraph } from '../src/index.js'

/**
 * The pin pass stays linear (ADR 0011, the design's §8).
 *
 * The walk itself is not a cost: one subtraction per axis on a Yoga pass that
 * already runs, inside a scope that is already narrow. What *would* be a cost
 * is re-running layout for the whole subtree after each pinned node resolves —
 * quadratic in the child count, and invisible until a page is large. This is
 * the test that notices.
 *
 * Every row here has a child, on purpose. The guard being tested is "re-layout
 * only under a node whose size actually moved, and only where there is
 * something to reflow" — and a row with no children never reaches it, so a
 * flat page of texts would measure the wrong thing entirely. Fifty rows mean
 * fifty small scoped layouts, which is linear; the mistake would be one
 * whole-entity layout per row.
 *
 * **The work is counted, not only timed.** Milliseconds turned out to be a bad
 * discriminator here: the obvious wrong implementation — re-laying out the
 * whole entity after each resize — was measured at *0.47ms*, faster than the
 * correct one, because Yoga skips any frame whose `layoutMode` is `NONE` and
 * the pinned rows' parent is exactly that. So a timing budget alone would have
 * passed a regression it was written to catch. The `node:updated` count is the
 * honest signal: one pass writes each row once and reflows it once, so the
 * work is linear in the row count and a quadratic pass cannot hide inside a
 * loose millisecond budget. The timing assertion stays as a coarse canary for
 * anything that starts re-measuring text.
 */

const CHILDREN = 50
const BUDGET_MS = 16
/** One write for the pin, one for the reflow it triggers. Measured at 102. */
const UPDATE_CEILING = CHILDREN * 4

const source = [
  '---',
  'id: card',
  '---',
  '',
  '## Visual Contract',
  '',
  '<Page>',
  '  <Component name="Card">',
  '    <Frame name="body" width={320} height={400}>',
  ...Array.from({ length: CHILDREN }, (_, i) => [
    `      <Frame name="row${i}" y={${i * 6}} x={8} right={8} height={5} ` +
      `layoutMode="HORIZONTAL" primaryAxisAlignItems="CENTER" ` +
      `constraints={{ horizontal: 'STRETCH' }}>`,
    `        <Text name="label" characters="a stretched label that has to be measured" />`,
    '      </Frame>',
  ]).flat(),
  '    </Frame>',
  '  </Component>',
  '</Page>',
  '',
].join('\n')

describe('the pin pass stays linear', () => {
  it(`resolves ${CHILDREN} stretched rows, each reflowing its own content`, () => {
    const scene = toSceneGraph(parseOrThrow(source))

    let updates = 0
    scene.graph.emitter.on('node:updated', () => {
      updates++
    })

    const started = performance.now()
    layOutEntity(scene.graph, 'Card', scene.pins)
    const elapsed = performance.now() - started
    if (process.env.PIN_BUDGET_REPORT) {
      console.log(`pin pass: ${elapsed.toFixed(2)}ms, ${updates} node updates`)
    }

    // 320 − 8 − 8. Asserted first: a fast pass that resolves nothing is not
    // the thing being measured, and neither is one whose rows never reflow.
    expect(scene.graph.getNode('Card#body/row0')?.width).toBe(304)
    expect(scene.graph.getNode(`Card#body/row${CHILDREN - 1}`)?.width).toBe(304)
    expect(scene.graph.getNode('Card#body/row0/label')?.width).toBeGreaterThan(0)

    expect(updates).toBeLessThan(UPDATE_CEILING)
    expect(elapsed).toBeLessThan(BUDGET_MS)
  })
})
