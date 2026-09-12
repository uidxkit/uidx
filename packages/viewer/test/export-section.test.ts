import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { parseOrThrow } from '@uidx/format'
import PropertiesPane from '../src/PropertiesPane.vue'
import type { ExportBounds } from '../src/export-image'

const DOC = parseOrThrow(`---
id: exports
---

## Visual Contract

<Page>
  <Component name="Button/Primary" status="stable">
    <Frame name="root" x={0} y={0} width={120} height={40}
      fills={[{ type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 } }]} />
  </Component>
</Page>
`)

const BOUNDS: ExportBounds = { minX: 0, minY: 0, maxX: 120, maxY: 40 }

function pane(exportBounds: ExportBounds | null = BOUNDS, writable = true) {
  return mount(PropertiesPane, {
    props: { doc: DOC, selection: ['Button/Primary#root'], exportBounds, writable },
  })
}

type Pane = ReturnType<typeof pane>

const pill = (wrapper: Pane, format: string) => wrapper.find(`[data-export-format="${format}"]`)
const scale = (wrapper: Pane) => wrapper.find('[data-export-scale]')
const pixels = (wrapper: Pane) => wrapper.find('[data-export-pixels]')
const run = (wrapper: Pane) => wrapper.find('[data-export-run]')

describe('the export section', () => {
  it('closes the panel, after every section that styles the layer', () => {
    const titles = pane()
      .findAll('.section-title')
      .map((t) => t.text())
    expect(titles.at(-1)).toBe('Export')
  })

  it('offers the three formats the writer can produce, and no others', () => {
    const labels = pane()
      .findAll('[data-export-format]')
      .map((b) => b.text())
    expect(labels).toEqual(['PNG', 'JPEG', 'SVG'])
  })

  it('opens on PNG at 2x, the answer most often wanted', () => {
    const wrapper = pane()
    expect(pill(wrapper, 'PNG').attributes('aria-checked')).toBe('true')
    expect((scale(wrapper).element as HTMLInputElement).value).toBe('2')
  })

  it('names the file the button is about to write', () => {
    expect(run(pane()).text()).toBe('Export root@2x.png')
  })

  it('counts the pixels the file will land on', () => {
    expect(pixels(pane()).text()).toBe('240 × 80')
  })

  it('renames the file when another format is picked', async () => {
    const wrapper = pane()
    await pill(wrapper, 'JPEG').trigger('click')
    expect(run(wrapper).text()).toBe('Export root@2x.jpg')
  })

  it('recounts the pixels when the scale changes', async () => {
    const wrapper = pane()
    await scale(wrapper).setValue('1')
    expect(pixels(wrapper).text()).toBe('120 × 40')
    expect(run(wrapper).text()).toBe('Export root.png')
  })

  it('holds a typed-in absurdity to the panel ceiling', async () => {
    const wrapper = pane()
    await scale(wrapper).setValue('900')
    expect(pixels(wrapper).text()).toBe('480 × 160')
  })

  /**
   * An SVG has no pixels to count, and `renderNodesToSVG` takes no scale. The
   * controls stay in place rather than vanishing — a section that changed
   * height on every format click would make the button move under the cursor.
   */
  it('greys the scale and drops the pixel count under SVG', async () => {
    const wrapper = pane()
    await pill(wrapper, 'SVG').trigger('click')
    expect(scale(wrapper).attributes('disabled')).toBeDefined()
    expect(pixels(wrapper).text()).toBe('—')
    expect(run(wrapper).text()).toBe('Export root.svg')
  })

  it('asks the canvas for the render, naming the file it promised', async () => {
    const wrapper = pane()
    await run(wrapper).trigger('click')
    expect(wrapper.emitted('export')).toEqual([
      [{ address: 'Button/Primary#root', format: 'PNG', scale: 2, fileName: 'root@2x.png' }],
    ])
  })

  it('offers no export for a node with no extent to render', () => {
    const wrapper = pane({ minX: 4, minY: 4, maxX: 4, maxY: 40 })
    expect(run(wrapper).attributes('disabled')).toBeDefined()
  })

  it('offers no export before the canvas has measured the node', () => {
    expect(run(pane(null)).attributes('disabled')).toBeDefined()
  })

  /**
   * Every other control in the panel goes read-only when the socket drops,
   * because every other control writes to the file. An export reads.
   */
  it('stays available while the file is read-only', () => {
    const wrapper = pane(BOUNDS, false)
    expect(run(wrapper).attributes('disabled')).toBeUndefined()
  })
})
