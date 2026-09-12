import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { parseOrThrow } from '@uidx/format'
import LayersPane from '../src/LayersPane.vue'
import { componentIndex, layerRows, visibleRows } from '../src/layer-rows'

/**
 * The rail's half of F3.
 *
 * The 2026-08-19 chrome work made the rail read `doc.tree`, which is exactly
 * why instances need something here: their children are the one part of the
 * canvas the document does not contain, so without these rows the rail shows an
 * instance as a leaf while the scene beneath it is a whole subtree — a
 * structure the canvas contradicts.
 */
const page = (id: string, body: string) =>
  `---\nid: ${id}\n---\n\n## Visual Contract\n\n<Page>\n${body}\n</Page>\n`

const BUTTON = parseOrThrow(
  page(
    'button',
    `  <Component name="Button/Primary" status="stable">
    <Frame name="container" layoutMode="HORIZONTAL">
      <Text name="label" characters="Click" />
    </Frame>
  </Component>`,
  ),
)

const USES = parseOrThrow(page('home', `  <Instance name="save" component="Button/Primary" />`))

const index = componentIndex([BUTTON, USES])

describe('an instance in the layers rail', () => {
  it("shows the component's children beneath it", () => {
    const rows = layerRows(USES, index)
    expect(rows.map((r) => r.address)).toEqual([
      '',
      'save',
      'save#container',
      'save#container/label',
    ])
  })

  it('addresses them exactly as the scene graph does', () => {
    // The rail's `address` is also the scene id it selects by, so the two have
    // to agree or a row would point at nothing.
    const rows = layerRows(USES, index)
    expect(rows.map((r) => r.generated)).toEqual([false, false, true, true])
  })

  it('leaves the instance a leaf when the component is not in the document', () => {
    const rows = layerRows(USES, componentIndex([USES]))
    expect(rows.map((r) => r.address)).toEqual(['', 'save'])
    expect(rows[1]!.hasChildren).toBe(false)
  })

  it('leaves the instance a leaf when no index is passed at all', () => {
    // Which is what the rail did before instances existed — the pane is handed
    // one page, and a page cannot answer a document-wide question on its own.
    expect(layerRows(USES).map((r) => r.address)).toEqual(['', 'save'])
  })

  it('gives the instance a chevron, so its subtree collapses like any other', () => {
    const rows = layerRows(USES, index)
    expect(rows[1]!.hasChildren).toBe(true)
    const collapsedOut = visibleRows(rows, new Set(['', 'save#container']))
    expect(collapsedOut.map((r) => r.address)).toEqual(['', 'save'])
  })

  it('expands a component that itself holds an instance', () => {
    const card = parseOrThrow(
      page(
        'card',
        `  <Component name="Card" status="draft">
    <Frame name="root" layoutMode="VERTICAL">
      <Instance name="action" component="Button/Primary" />
    </Frame>
  </Component>`,
      ),
    )
    const uses = parseOrThrow(page('home', `  <Instance name="c" component="Card" />`))
    const rows = layerRows(uses, componentIndex([BUTTON, card, uses]))
    expect(rows.map((r) => r.address)).toEqual([
      '',
      'c',
      'c#root',
      'c#root/action',
      'c#root/action/container',
      'c#root/action/container/label',
    ])
  })

  it('stops rather than recursing for ever on a component that names itself', () => {
    const loop = parseOrThrow(
      page(
        'loop',
        `  <Component name="A" status="draft">
    <Frame name="root" layoutMode="VERTICAL">
      <Instance name="me" component="A" />
    </Frame>
  </Component>
  <Instance name="use" component="A" />`,
      ),
    )
    const rows = layerRows(loop, componentIndex([loop]))
    expect(rows.some((r) => r.address === 'use#root/me')).toBe(true)
    expect(rows.some((r) => r.address.startsWith('use#root/me/'))).toBe(false)
  })
})

describe('a generated row does nothing', () => {
  const mountRail = () =>
    mount(LayersPane, { props: { doc: USES, components: index, selection: [] } })

  it('does not select, because there is nothing to fill an inspector with', async () => {
    const rail = mountRail()
    const generated = rail.find('[data-address="save#container/label"]')
    expect(generated.attributes('data-generated')).toBe('true')
    await generated.find('.label').trigger('click')
    expect(rail.emitted('select')).toBeUndefined()
  })

  it('still selects the instance itself, which is a line in the file', async () => {
    const rail = mountRail()
    await rail.find('[data-address="save"] .label').trigger('click')
    expect(rail.emitted('select')).toEqual([['save']])
  })

  it('offers no visibility toggle, which would patch an address that is not there', () => {
    const rail = mountRail()
    expect(rail.find('[data-address="save#container"] .eye').exists()).toBe(false)
    expect(rail.find('[data-address="save"] .eye').exists()).toBe(true)
  })

  it('is not draggable', () => {
    const rail = mountRail()
    expect(rail.find('[data-address="save#container"]').attributes('draggable')).toBe('false')
    expect(rail.find('[data-address="save"]').attributes('draggable')).toBe('true')
  })

  it('does not open a rename on double-click or on Enter', async () => {
    const rail = mountRail()
    // Awaited, not fired and forgotten: the input is `v-if`'d on `editing`, so
    // without the re-render this passes whether or not the guard is there.
    await rail.find('[data-address="save#container"] .label').trigger('dblclick')
    expect(rail.find('[data-address="save#container"] .rename-input').exists()).toBe(false)
    await rail.find('[data-address="save#container"]').trigger('keydown', { key: 'Enter' })
    expect(rail.find('[data-address="save#container"] .rename-input').exists()).toBe(false)
  })

  it('opens one on the instance itself, which does have a name to change', async () => {
    const rail = mountRail()
    await rail.find('[data-address="save"] .label').trigger('dblclick')
    expect(rail.find('[data-address="save"] .rename-input').exists()).toBe(true)
  })

  it('emits no patch of any kind', async () => {
    const rail = mountRail()
    await rail.find('[data-address="save#container/label"] .label').trigger('click')
    await rail.find('[data-address="save#container/label"] .label').trigger('dblclick')
    await rail.find('[data-address="save#container/label"]').trigger('keydown', { key: 'Enter' })
    expect(rail.emitted('patches')).toBeUndefined()
  })
})
