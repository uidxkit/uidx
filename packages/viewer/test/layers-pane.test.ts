import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { parseOrThrow } from '@uidx/format'

import LayersPane from '../src/LayersPane.vue'
import { ROW_HEIGHT } from '../src/layer-window'

// jsdom has no scrollIntoView implementation; an unstubbed call throws.
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
})

const DOC = parseOrThrow(`---
id: page
---

## Visual Contract

<Page>
  <Component name="Button/Primary" status="stable">
    <Frame name="container">
      <Vector name="icon" visible={false} />
      <Text name="label" characters="Hi" />
    </Frame>
  </Component>
</Page>
`)

/** Matches DOC exactly except `container` is called `box` — the server's answer after a rename. */
const RENAMED = parseOrThrow(`---
id: page
---

## Visual Contract

<Page>
  <Component name="Button/Primary" status="stable">
    <Frame name="box">
      <Vector name="icon" visible={false} />
      <Text name="label" characters="Hi" />
    </Frame>
  </Component>
</Page>
`)

/** Two frames side by side, so one can be dragged into the other. */
const NESTED = parseOrThrow(`---
id: page
---

## Visual Contract

<Page>
  <Component name="Button/Primary" status="stable">
    <Frame name="container">
      <Frame name="group">
        <Vector name="icon" />
      </Frame>
      <Frame name="slot" />
    </Frame>
  </Component>
</Page>
`)

/** `NESTED` after `group` is dropped into `slot` — the server's answer. */
const REPARENTED = parseOrThrow(`---
id: page
---

## Visual Contract

<Page>
  <Component name="Button/Primary" status="stable">
    <Frame name="container">
      <Frame name="slot">
        <Frame name="group">
          <Vector name="icon" />
        </Frame>
      </Frame>
    </Frame>
  </Component>
</Page>
`)

/**
 * `container` holds a leaf `icon` and a real container `wrapper` — and
 * `wrapper` already has its own child named `icon`. Dropping `container/icon`
 * into the middle of `wrapper` is a legitimate `into` that `moveFor` refuses
 * for a duplicate sibling name, not because `wrapper` cannot hold children.
 */
const DUPLICATE_NAME_TARGET = parseOrThrow(`---
id: page
---

## Visual Contract

<Page>
  <Component name="Button/Primary" status="stable">
    <Frame name="container">
      <Vector name="icon" />
      <Frame name="wrapper">
        <Vector name="icon" />
      </Frame>
    </Frame>
  </Component>
</Page>
`)

const rowsOf = (w: ReturnType<typeof mount>) => w.findAll('[data-address]')

describe('LayersPane', () => {
  it('renders every row of an expanded tree, indented by depth', () => {
    const w = mount(LayersPane, { props: { doc: DOC, selection: [] } })
    const rows = rowsOf(w)
    expect(rows).toHaveLength(5)
    expect(rows[4]!.attributes('data-address')).toBe('Button/Primary#container/label')
    expect(rows[4]!.attributes('style')).toContain('--depth: 3')
  })

  it('collapses a subtree when its chevron is clicked', async () => {
    const w = mount(LayersPane, { props: { doc: DOC, selection: [] } })
    await w.get('[data-address="Button/Primary"] .chevron').trigger('click')
    expect(rowsOf(w).map((r) => r.attributes('data-address'))).toEqual(['', 'Button/Primary'])
  })

  it('emits the address when a row is clicked', async () => {
    const w = mount(LayersPane, { props: { doc: DOC, selection: [] } })
    await w.get('[data-address="Button/Primary#container"] .label').trigger('click')
    expect(w.emitted('select')?.[0]).toEqual(['Button/Primary#container'])
  })

  it('marks the selected row', () => {
    const w = mount(LayersPane, {
      props: { doc: DOC, selection: ['Button/Primary#container'] },
    })
    expect(w.get('[data-address="Button/Primary#container"]').attributes('data-selected')).toBe(
      'true',
    )
  })

  /** A hidden node has to read as hidden without hovering to find out. */
  it('marks a row whose node is not visible', () => {
    const w = mount(LayersPane, { props: { doc: DOC, selection: [] } })
    const icon = w.get('[data-address="Button/Primary#container/icon"]')
    expect(icon.attributes('data-hidden')).toBe('true')
  })

  it('opens the tree down to a selection made elsewhere', async () => {
    const w = mount(LayersPane, { props: { doc: DOC, selection: [] } })
    await w.get('[data-address="Button/Primary"] .chevron').trigger('click')
    expect(rowsOf(w)).toHaveLength(2)

    await w.setProps({ selection: ['Button/Primary#container/label'] })
    expect(rowsOf(w).map((r) => r.attributes('data-address'))).toContain(
      'Button/Primary#container/label',
    )
  })

  it('renders nothing for no document', () => {
    const w = mount(LayersPane, { props: { doc: null, selection: [] } })
    expect(rowsOf(w)).toHaveLength(0)
  })

  describe('the eye', () => {
    it('hides a visible node by setting the attribute it already declares', async () => {
      const w = mount(LayersPane, { props: { doc: DOC, selection: [] } })
      await w.get('[data-address="Button/Primary#container/icon"] .eye').trigger('click')
      // `icon` declares visible={false}, so toggling it writes true.
      expect(w.emitted('patches')?.[0]).toEqual([
        [{ op: 'set', address: 'Button/Primary#container/icon', prop: 'visible', value: true }],
      ])
    })

    /**
     * The root row has no eye at all.
     *
     * A bare `<Component>` gets a synthetic `<Page>` wrapper whose tag span is
     * zero-width, so `add visible false` on address `''` computes an insertion
     * point before the tag and splices into the prose. The patcher refuses the
     * result — the file is safe — but the author is shown a UIDX003 about an
     * ArrayBuffer for a gesture that was never meaningful: a page has no
     * visibility of its own.
     */
    it('is not offered on the root page', () => {
      const w = mount(LayersPane, { props: { doc: DOC, selection: [] } })
      expect(w.find('[data-address=""] .eye').exists()).toBe(false)
      expect(w.find('[data-address="Button/Primary"] .eye').exists()).toBe(true)
    })

    /**
     * The icon is `aria-hidden`, so without a label the button announces with
     * no name; `aria-pressed="!visible"` announced the state backwards on top
     * of that. Together: "button, pressed", nameless and inverted.
     */
    it('names itself for a screen reader, and says which way it goes', () => {
      const w = mount(LayersPane, { props: { doc: DOC, selection: [] } })
      const shown = w.get('[data-address="Button/Primary#container/label"] .eye')
      const hidden = w.get('[data-address="Button/Primary#container/icon"] .eye')
      expect(shown.attributes('aria-label')).toBe('Hide layer')
      expect(hidden.attributes('aria-label')).toBe('Show layer')
      expect(shown.attributes('aria-pressed')).toBeUndefined()
    })

    /**
     * A node with no `visible` attribute is visible. Hiding it has to *add* the
     * attribute, not set one that is not there — `set` on an absent prop has no
     * span to replace.
     */
    it('adds the attribute when the node never declared it', async () => {
      const w = mount(LayersPane, { props: { doc: DOC, selection: [] } })
      await w.get('[data-address="Button/Primary#container/label"] .eye').trigger('click')
      expect(w.emitted('patches')?.[0]).toEqual([
        [{ op: 'add', address: 'Button/Primary#container/label', prop: 'visible', value: false }],
      ])
    })
  })

  describe('rename', () => {
    const startRename = async (w: ReturnType<typeof mount>, address: string) => {
      await w.get(`[data-address="${address}"] .label`).trigger('dblclick')
      return w.get(`[data-address="${address}"] .rename-input`)
    }

    /**
     * Figma replaces the whole name on the first keystroke of a rename; typing
     * should not append to what was there. The `select()` that makes that true
     * is deferred past Vue's own mount ordering — `@vue:mounted` fires before
     * `v-model`'s `mounted` hook assigns `el.value` (see `focusRename` in
     * LayersPane.vue) — so this waits a macrotask before asserting.
     *
     * This exercises the actual mechanism, not an approximation of it: it fails
     * against the unfixed `focusRename` (`selectionStart` lands at 9, the end
     * of "container", instead of 0) for the same reason the real browser did,
     * because the ordering is Vue's own scheduling and not a browser quirk.
     */
    it('selects the whole name when a rename opens', async () => {
      const w = mount(LayersPane, { props: { doc: DOC, selection: [] } })
      const input = await startRename(w, 'Button/Primary#container')
      await new Promise((resolve) => setTimeout(resolve, 0))

      const el = input.element as HTMLInputElement
      expect(el.selectionStart).toBe(0)
      expect(el.selectionEnd).toBe(el.value.length)
    })

    it('commits a new name as a set on the name attribute', async () => {
      const w = mount(LayersPane, { props: { doc: DOC, selection: [] } })
      const input = await startRename(w, 'Button/Primary#container/icon')
      await input.setValue('glyph')
      await input.trigger('keydown', { key: 'Enter' })

      expect(w.emitted('patches')?.[0]).toEqual([
        [{ op: 'set', address: 'Button/Primary#container/icon', prop: 'name', value: 'glyph' }],
      ])
    })

    /**
     * Addresses are name paths, so the rename moves every address beneath it.
     * The shell needs both halves to remap selection and expansion; emitting only
     * the patch would leave the rail pointing at an address that no longer
     * exists the moment the file comes back.
     */
    it('reports the address it moved, so the shell can follow', async () => {
      const w = mount(LayersPane, { props: { doc: DOC, selection: [] } })
      const input = await startRename(w, 'Button/Primary#container')
      await input.setValue('box')
      await input.trigger('keydown', { key: 'Enter' })

      expect(w.emitted('moved')?.[0]).toEqual(['Button/Primary#container', 'Button/Primary#box'])
    })

    it('refuses a name a sibling already has, and writes nothing', async () => {
      const w = mount(LayersPane, { props: { doc: DOC, selection: [] } })
      const input = await startRename(w, 'Button/Primary#container/icon')
      await input.setValue('label')
      await input.trigger('keydown', { key: 'Enter' })

      expect(w.emitted('patches')).toBeUndefined()
      expect(
        w.get('[data-address="Button/Primary#container/icon"]').attributes('data-invalid'),
      ).toBe('true')
    })

    /**
     * Typing the name it already has is not a refusal — there is nothing to
     * write. `renameFor` returns null for that and for a duplicate alike, so
     * the pane had to tell the two apart itself or paint an unchanged name red.
     */
    it('closes cleanly when the name was not changed', async () => {
      const w = mount(LayersPane, { props: { doc: DOC, selection: [] } })
      const input = await startRename(w, 'Button/Primary#container/icon')
      await input.trigger('keydown', { key: 'Enter' })

      expect(w.emitted('patches')).toBeUndefined()
      expect(w.find('.rename-input').exists()).toBe(false)
      expect(
        w.get('[data-address="Button/Primary#container/icon"]').attributes('data-invalid'),
      ).toBe('false')
    })

    /** The red border marks the name that was refused, not the box you fix it in. */
    it('drops the refusal as soon as the draft changes', async () => {
      const w = mount(LayersPane, { props: { doc: DOC, selection: [] } })
      const input = await startRename(w, 'Button/Primary#container/icon')
      await input.setValue('label')
      await input.trigger('keydown', { key: 'Enter' })
      const row = () => w.get('[data-address="Button/Primary#container/icon"]')
      expect(row().attributes('data-invalid')).toBe('true')

      await w.get('[data-address="Button/Primary#container/icon"] .rename-input').setValue('glyph')
      expect(row().attributes('data-invalid')).toBe('false')
    })

    /**
     * The whole row is the drag handle, so while the rename box is open,
     * selecting text inside it started a row drag instead.
     */
    it('stops the row being a drag handle while it is being renamed', async () => {
      const w = mount(LayersPane, { props: { doc: DOC, selection: [] } })
      const row = () => w.get('[data-address="Button/Primary#container/icon"]')
      expect(row().attributes('draggable')).toBe('true')

      await startRename(w, 'Button/Primary#container/icon')
      expect(row().attributes('draggable')).toBe('false')
    })

    it('abandons the edit on escape', async () => {
      const w = mount(LayersPane, { props: { doc: DOC, selection: [] } })
      const input = await startRename(w, 'Button/Primary#container/icon')
      await input.setValue('glyph')
      await input.trigger('keydown', { key: 'Escape' })

      expect(w.emitted('patches')).toBeUndefined()
      expect(w.find('.rename-input').exists()).toBe(false)
    })

    /**
     * Figma commits on blur: a name you typed and then clicked away from is a
     * name you meant. Only Enter used to commit, so clicking anywhere else
     * threw the edit away with no signal — that is what the user meant by
     * "rename doesn't work."
     */
    it('commits on blur, as Figma does', async () => {
      const w = mount(LayersPane, { props: { doc: DOC, selection: [] } })
      const input = await startRename(w, 'Button/Primary#container/icon')
      await input.setValue('glyph')
      await input.trigger('blur')

      expect(w.emitted('patches')?.[0]).toEqual([
        [{ op: 'set', address: 'Button/Primary#container/icon', prop: 'name', value: 'glyph' }],
      ])
      expect(w.emitted('moved')?.[0]).toEqual([
        'Button/Primary#container/icon',
        'Button/Primary#container/glyph',
      ])
      expect(w.find('.rename-input').exists()).toBe(false)
    })

    /**
     * A blur that cannot commit — here, a name a sibling already has — reverts
     * rather than leaving a red input the author has already clicked away
     * from. `commitRename` would paint it invalid, which is right for Enter,
     * where the author is still looking at the box; wrong for blur, where
     * they are not.
     */
    it('reverts on blur when the new name collides with a sibling', async () => {
      const w = mount(LayersPane, { props: { doc: DOC, selection: [] } })
      const input = await startRename(w, 'Button/Primary#container/icon')
      await input.setValue('label')
      await input.trigger('blur')

      expect(w.emitted('patches')).toBeUndefined()
      expect(w.emitted('moved')).toBeUndefined()
      expect(w.find('.rename-input').exists()).toBe(false)
    })

    /**
     * Escape clears `editing` synchronously, so a blur that arrives after it
     * has nothing left to commit — the guard in `blurRename` has to see that
     * and do nothing, not resurrect the abandoned edit.
     */
    it('does not commit on the blur that follows Escape', async () => {
      const w = mount(LayersPane, { props: { doc: DOC, selection: [] } })
      const input = await startRename(w, 'Button/Primary#container/icon')
      await input.setValue('glyph')
      await input.trigger('keydown', { key: 'Escape' })
      await input.trigger('blur')

      expect(w.emitted('patches')).toBeUndefined()
      expect(w.emitted('moved')).toBeUndefined()
    })

    /**
     * Correct today by trace — `commitRename` clears `editing` before a
     * trailing blur's guard in `blurRename` reads it — but untested, and that
     * ordering is exactly the kind of thing a later refactor breaks quietly.
     */
    it('does not double-commit when a blur follows Enter', async () => {
      const w = mount(LayersPane, { props: { doc: DOC, selection: [] } })
      const input = await startRename(w, 'Button/Primary#container/icon')
      await input.setValue('glyph')
      await input.trigger('keydown', { key: 'Enter' })
      await input.trigger('blur')

      expect(w.emitted('patches')).toHaveLength(1)
      expect(w.emitted('moved')).toHaveLength(1)
    })

    it('closes cleanly on blur when the name was not changed', async () => {
      const w = mount(LayersPane, { props: { doc: DOC, selection: [] } })
      const input = await startRename(w, 'Button/Primary#container/icon')
      await input.trigger('blur')

      expect(w.emitted('patches')).toBeUndefined()
      expect(w.emitted('moved')).toBeUndefined()
      expect(w.find('.rename-input').exists()).toBe(false)
    })

    it('does not offer a rename on the root page', async () => {
      const w = mount(LayersPane, { props: { doc: DOC, selection: [] } })
      await w.get('[data-address=""] .label').trigger('dblclick')
      expect(w.find('.rename-input').exists()).toBe(false)
    })

    it('reports the moved address for an entity rename, where the prefix is empty', async () => {
      const w = mount(LayersPane, { props: { doc: DOC, selection: [] } })
      const input = await startRename(w, 'Button/Primary')
      await input.setValue('Button/Secondary')
      await input.trigger('keydown', { key: 'Enter' })

      expect(w.emitted('moved')?.[0]).toEqual(['Button/Primary', 'Button/Secondary'])
    })

    it('keeps a renamed subtree collapsed after the file round-trips', async () => {
      const w = mount(LayersPane, { props: { doc: DOC, selection: [] } })
      await w.get('[data-address="Button/Primary#container"] .chevron').trigger('click')
      expect(w.findAll('[data-address]')).toHaveLength(3)

      const input = await startRename(w, 'Button/Primary#container')
      await input.setValue('box')
      await input.trigger('keydown', { key: 'Enter' })

      // The server answers with the patched file.
      await w.setProps({ doc: RENAMED })
      expect(w.findAll('[data-address]').map((r) => r.attributes('data-address'))).toEqual([
        '',
        'Button/Primary',
        'Button/Primary#box',
      ])
    })
  })

  describe('drag', () => {
    const drag = async (w: ReturnType<typeof mount>, from: string, to: string, offsetY: number) => {
      await w.get(`[data-address="${from}"]`).trigger('dragstart')
      const target = w.get(`[data-address="${to}"]`)
      // 24px rows: <6 is above, >18 is below, the middle band is into.
      Object.defineProperty(target.element, 'getBoundingClientRect', {
        value: () => ({ top: 0, height: 24 }),
      })
      await target.trigger('dragover', { clientY: offsetY })
      await target.trigger('drop')
    }

    it('reorders a sibling upward', async () => {
      const w = mount(LayersPane, { props: { doc: DOC, selection: [] } })
      await drag(w, 'Button/Primary#container/label', 'Button/Primary#container/icon', 2)
      expect(w.emitted('patches')?.[0]).toEqual([
        [
          {
            op: 'move-node',
            address: 'Button/Primary#container/label',
            newParent: 'Button/Primary#container',
            index: 0,
          },
        ],
      ])
    })

    it('writes nothing for a refused drop', async () => {
      const w = mount(LayersPane, { props: { doc: DOC, selection: [] } })
      // A container cannot be dropped into its own child.
      await drag(w, 'Button/Primary#container', 'Button/Primary#container/icon', 12)
      expect(w.emitted('patches')).toBeUndefined()
    })

    /**
     * A reparent moves an address exactly as a rename does, so it has to report
     * the move for the same reason: the shell holds the selection as addresses,
     * and without this the author loses the node they just dragged.
     */
    it('reports the address a reparent moved, so the shell can follow', async () => {
      const w = mount(LayersPane, { props: { doc: NESTED, selection: [] } })
      await drag(w, 'Button/Primary#container/group', 'Button/Primary#container/slot', 12)
      expect(w.emitted('moved')?.[0]).toEqual([
        'Button/Primary#container/group',
        'Button/Primary#container/slot/group',
      ])
    })

    it('keeps a reparented subtree collapsed after the file round-trips', async () => {
      const w = mount(LayersPane, { props: { doc: NESTED, selection: [] } })
      await w.get('[data-address="Button/Primary#container/group"] .chevron').trigger('click')
      await drag(w, 'Button/Primary#container/group', 'Button/Primary#container/slot', 12)

      await w.setProps({ doc: REPARENTED })
      expect(rowsOf(w).map((r) => r.attributes('data-address'))).toEqual([
        '',
        'Button/Primary',
        'Button/Primary#container',
        'Button/Primary#container/slot',
        'Button/Primary#container/slot/group',
      ])
    })

    /**
     * Firefox will not start a drag whose payload carries no data at all, so
     * without this the rail is simply inert there.
     */
    it('puts the dragged address on the payload', async () => {
      const w = mount(LayersPane, { props: { doc: DOC, selection: [] } })
      const dataTransfer = { setData: vi.fn() }
      await w.get('[data-address="Button/Primary#container/icon"]').trigger('dragstart', {
        dataTransfer,
      })
      expect(dataTransfer.setData).toHaveBeenCalledWith(
        'text/plain',
        'Button/Primary#container/icon',
      )
    })

    /**
     * `dragover` was the only thing that ever cleared the indicator, so leaving
     * the list sideways left the last row still showing where a drop would land.
     */
    it('clears the drop indicator when the pointer leaves the row', async () => {
      const w = mount(LayersPane, { props: { doc: DOC, selection: [] } })
      await w.get('[data-address="Button/Primary#container/label"]').trigger('dragstart')
      const target = w.get('[data-address="Button/Primary#container/icon"]')
      Object.defineProperty(target.element, 'getBoundingClientRect', {
        value: () => ({ top: 0, height: 24 }),
      })
      await target.trigger('dragover', { clientY: 2 })
      expect(target.attributes('data-drop')).toBe('above')

      await target.trigger('dragleave', { relatedTarget: null })
      expect(target.attributes('data-drop')).toBe('none')
    })

    it('shows no drop indicator for a refused target', async () => {
      const w = mount(LayersPane, { props: { doc: DOC, selection: [] } })
      await w.get('[data-address="Button/Primary#container"]').trigger('dragstart')
      const target = w.get('[data-address="Button/Primary#container/icon"]')
      Object.defineProperty(target.element, 'getBoundingClientRect', {
        value: () => ({ top: 0, height: 24 }),
      })
      await target.trigger('dragover', { clientY: 12 })
      expect(target.attributes('data-drop')).toBe('none')
    })

    /**
     * `icon` and `label` are leaves (Vector, Text) — `moveFor` refuses `into`
     * for both, since `CONTAINER_ELEMENTS` does not include them. The middle
     * half of a leaf row therefore has to fall back to a reorder rather than
     * sit there as a dead zone: aiming at the top half of the target reorders
     * above it, the bottom half reorders below it.
     */
    it('reorders instead of reparenting when the middle of a leaf row is the target', async () => {
      const w = mount(LayersPane, { props: { doc: DOC, selection: [] } })
      // Top half of the 24px `icon` row: falls back to 'above'.
      await drag(w, 'Button/Primary#container/label', 'Button/Primary#container/icon', 10)
      expect(w.emitted('patches')?.[0]).toEqual([
        [
          {
            op: 'move-node',
            address: 'Button/Primary#container/label',
            newParent: 'Button/Primary#container',
            index: 0,
          },
        ],
      ])
    })

    it('reorders below when the bottom half of a leaf row is the target', async () => {
      const w = mount(LayersPane, { props: { doc: DOC, selection: [] } })
      // Bottom half of the 24px `label` row: falls back to 'below'.
      await drag(w, 'Button/Primary#container/icon', 'Button/Primary#container/label', 14)
      expect(w.emitted('patches')?.[0]).toEqual([
        [
          {
            op: 'move-node',
            address: 'Button/Primary#container/icon',
            newParent: 'Button/Primary#container',
            index: 1,
          },
        ],
      ])
    })

    it('shows an above/below indicator, not "into", for a mid-row drag over a leaf', async () => {
      const w = mount(LayersPane, { props: { doc: DOC, selection: [] } })
      await w.get('[data-address="Button/Primary#container/label"]').trigger('dragstart')
      const target = w.get('[data-address="Button/Primary#container/icon"]')
      Object.defineProperty(target.element, 'getBoundingClientRect', {
        value: () => ({ top: 0, height: 24 }),
      })
      await target.trigger('dragover', { clientY: 10 })
      expect(target.attributes('data-drop')).toBe('above')
    })

    /**
     * A row that CAN take a child keeps its reparent band at mid-row: the
     * leaf fallback must not swallow the real `into` case.
     */
    it('still reparents at the middle of a row that can contain children', async () => {
      const w = mount(LayersPane, { props: { doc: NESTED, selection: [] } })
      await drag(w, 'Button/Primary#container/group', 'Button/Primary#container/slot', 12)
      expect(w.emitted('patches')?.[0]).toEqual([
        [
          {
            op: 'move-node',
            address: 'Button/Primary#container/group',
            newParent: 'Button/Primary#container/slot',
            index: 0,
          },
        ],
      ])
    })

    /**
     * `wrapper` is a real container — the fallback exists for rows that can
     * never take a child, not for an `into` a container refuses for its own
     * reasons. Recomputing against `parentOf(target)` asks a different
     * question than the one `moveFor` just answered, so without gating on the
     * target's own element, this silently turns a refused "into wrapper" into
     * a same-parent reorder nobody asked for — a different move than the one
     * the author aimed at, which is worse than doing nothing.
     */
    it('shows no indicator and writes nothing when a container refuses "into" for a duplicate name', async () => {
      const w = mount(LayersPane, { props: { doc: DUPLICATE_NAME_TARGET, selection: [] } })
      await w.get('[data-address="Button/Primary#container/icon"]').trigger('dragstart')
      const target = w.get('[data-address="Button/Primary#container/wrapper"]')
      Object.defineProperty(target.element, 'getBoundingClientRect', {
        value: () => ({ top: 0, height: 24 }),
      })
      await target.trigger('dragover', { clientY: 12 })
      expect(target.attributes('data-drop')).toBe('none')

      await target.trigger('drop')
      expect(w.emitted('patches')).toBeUndefined()
    })
  })

  describe('keyboard', () => {
    it('exposes tree and treeitem roles, with aria-level from depth', () => {
      const w = mount(LayersPane, { props: { doc: DOC, selection: [] } })
      expect(w.get('.layers').attributes('role')).toBe('tree')
      const rows = rowsOf(w)
      expect(rows.map((r) => r.attributes('role'))).toEqual(rows.map(() => 'treeitem'))
      expect(
        w.get('[data-address="Button/Primary#container/label"]').attributes('aria-level'),
      ).toBe('4')
      expect(w.get('[data-address=""]').attributes('aria-level')).toBe('1')
    })

    /**
     * `aria-selected` relies on Vue coercing a bound boolean to the string
     * `"true"`/`"false"` rather than the more common boolean-attribute rule
     * (present/absent) — correct for `aria-*`, but worth pinning down rather
     * than trusting `data-selected`'s (already-tested) parallel logic to mean
     * the ARIA attribute followed along.
     */
    it('reads aria-selected true on the selected row and false elsewhere', () => {
      const w = mount(LayersPane, {
        props: { doc: DOC, selection: ['Button/Primary#container'] },
      })
      expect(w.get('[data-address="Button/Primary#container"]').attributes('aria-selected')).toBe(
        'true',
      )
      expect(w.get('[data-address="Button/Primary"]').attributes('aria-selected')).toBe('false')
    })

    /**
     * Exactly one row is a tab stop at a time. With no selection, the first
     * row is the entry point — otherwise a tab into an empty selection would
     * reach nothing at all.
     */
    it('gives exactly one row tabindex 0, defaulting to the first row', () => {
      const w = mount(LayersPane, { props: { doc: DOC, selection: [] } })
      const rows = rowsOf(w)
      const tabbable = rows.filter((r) => r.attributes('tabindex') === '0')
      expect(tabbable).toHaveLength(1)
      expect(tabbable[0]!.attributes('data-address')).toBe('')
      expect(rows.filter((r) => r.attributes('tabindex') === '-1')).toHaveLength(rows.length - 1)
    })

    it('moves the tab stop to the selected row', () => {
      const w = mount(LayersPane, {
        props: { doc: DOC, selection: ['Button/Primary#container'] },
      })
      const rows = rowsOf(w)
      const tabbable = rows.filter((r) => r.attributes('tabindex') === '0')
      expect(tabbable).toHaveLength(1)
      expect(tabbable[0]!.attributes('data-address')).toBe('Button/Primary#container')
    })

    /**
     * Two ordinary mouse clicks, no keyboard involved: select a leaf, then
     * collapse its parent. Nothing reconciles `selection` with `collapsed` —
     * `toggle` doesn't touch `selection`, and the ancestor-expanding watcher
     * only fires when `selection[0]` *changes*, not when the visible list
     * changes out from under an unchanged selection. Without a fallback that
     * checks the selection is actually visible, no row ends up tabbable at
     * all: Tab skips the rail entirely.
     */
    it('falls back to a visible row when the selected one is hidden by a collapse', async () => {
      const w = mount(LayersPane, { props: { doc: DOC, selection: [] } })
      await w.get('[data-address="Button/Primary#container/label"] .label').trigger('click')
      await w.setProps({ selection: ['Button/Primary#container/label'] })
      await w.get('[data-address="Button/Primary#container"] .chevron').trigger('click')

      const rows = rowsOf(w)
      const tabbable = rows.filter((r) => r.attributes('tabindex') === '0')
      expect(tabbable).toHaveLength(1)
      // The nearest still-visible ancestor of the hidden selection, not the
      // first row in the tree — the tab stop should stay near where the
      // author was working.
      expect(tabbable[0]!.attributes('data-address')).toBe('Button/Primary#container')
    })

    it('ArrowDown selects the next visible row', async () => {
      const w = mount(LayersPane, { props: { doc: DOC, selection: [] } })
      await w.get('[data-address=""]').trigger('keydown', { key: 'ArrowDown' })
      expect(w.emitted('select')?.[0]).toEqual(['Button/Primary'])
    })

    it('ArrowUp selects the previous visible row', async () => {
      const w = mount(LayersPane, { props: { doc: DOC, selection: [] } })
      await w
        .get('[data-address="Button/Primary#container/label"]')
        .trigger('keydown', { key: 'ArrowUp' })
      expect(w.emitted('select')?.[0]).toEqual(['Button/Primary#container/icon'])
    })

    it('ArrowRight expands a collapsed row without changing the selection', async () => {
      const w = mount(LayersPane, { props: { doc: DOC, selection: [] } })
      await w.get('[data-address="Button/Primary"] .chevron').trigger('click')
      expect(rowsOf(w)).toHaveLength(2)

      await w.get('[data-address="Button/Primary"]').trigger('keydown', { key: 'ArrowRight' })
      expect(rowsOf(w)).toHaveLength(5)
      expect(w.emitted('select')).toBeUndefined()
    })

    it('ArrowRight descends to the first child of an already-expanded row', async () => {
      const w = mount(LayersPane, { props: { doc: DOC, selection: [] } })
      await w.get('[data-address="Button/Primary#container"]').trigger('keydown', {
        key: 'ArrowRight',
      })
      expect(w.emitted('select')?.[0]).toEqual(['Button/Primary#container/icon'])
    })

    it('ArrowLeft collapses an expanded row without changing the selection', async () => {
      const w = mount(LayersPane, { props: { doc: DOC, selection: [] } })
      await w
        .get('[data-address="Button/Primary#container"]')
        .trigger('keydown', { key: 'ArrowLeft' })
      // Collapsing `container` hides only its own two children (`icon`,
      // `label`); `''`, `Button/Primary` and `container` itself stay visible.
      expect(rowsOf(w)).toHaveLength(3)
      expect(w.emitted('select')).toBeUndefined()
    })

    it('ArrowLeft climbs to the parent of a leaf row', async () => {
      const w = mount(LayersPane, { props: { doc: DOC, selection: [] } })
      await w
        .get('[data-address="Button/Primary#container/icon"]')
        .trigger('keydown', { key: 'ArrowLeft' })
      expect(w.emitted('select')?.[0]).toEqual(['Button/Primary#container'])
    })

    /**
     * Home/End route through the same `move` intent as ArrowUp/Down inside
     * `onKeyDown`, and `layer-keys.test.ts` already covers `keyIntent`'s own
     * logic for them — but nothing exercised that shared path against the
     * mounted component itself until now.
     */
    it('Home selects the first visible row from anywhere in the tree', async () => {
      const w = mount(LayersPane, { props: { doc: DOC, selection: [] } })
      await w
        .get('[data-address="Button/Primary#container/label"]')
        .trigger('keydown', { key: 'Home' })
      expect(w.emitted('select')?.[0]).toEqual([''])
    })

    it('End selects the last visible row from anywhere in the tree', async () => {
      const w = mount(LayersPane, { props: { doc: DOC, selection: [] } })
      await w.get('[data-address=""]').trigger('keydown', { key: 'End' })
      expect(w.emitted('select')?.[0]).toEqual(['Button/Primary#container/label'])
    })

    it('Enter opens the rename on the focused row', async () => {
      const w = mount(LayersPane, { props: { doc: DOC, selection: [] } })
      await w
        .get('[data-address="Button/Primary#container/icon"]')
        .trigger('keydown', { key: 'Enter' })
      expect(w.find('[data-address="Button/Primary#container/icon"] .rename-input').exists()).toBe(
        true,
      )
    })

    /**
     * Enter moves focus into the input. Nothing used to return it, so
     * committing or cancelling dumped the author to the top of the document
     * mid-navigation. `attachTo` is required here — jsdom only tracks
     * `document.activeElement` for elements actually attached to the document.
     */
    it('returns focus to the row when a rename commits', async () => {
      const w = mount(LayersPane, {
        props: { doc: DOC, selection: [] },
        attachTo: document.body,
      })
      const row = w.get('[data-address="Button/Primary#container/icon"]')
      await w.get('[data-address="Button/Primary#container/icon"] .label').trigger('dblclick')
      const input = w.get('[data-address="Button/Primary#container/icon"] .rename-input')
      await input.setValue('glyph')
      await input.trigger('keydown', { key: 'Enter' })

      expect(document.activeElement).toBe(row.element)
      w.unmount()
    })

    it('returns focus to the row when a rename is cancelled', async () => {
      const w = mount(LayersPane, {
        props: { doc: DOC, selection: [] },
        attachTo: document.body,
      })
      const row = w.get('[data-address="Button/Primary#container/icon"]')
      await w.get('[data-address="Button/Primary#container/icon"] .label').trigger('dblclick')
      const input = w.get('[data-address="Button/Primary#container/icon"] .rename-input')
      await input.setValue('glyph')
      await input.trigger('keydown', { key: 'Escape' })

      expect(document.activeElement).toBe(row.element)
      w.unmount()
    })

    /**
     * A selection made on the canvas has to scroll into view, not just expand
     * into view — otherwise selecting a node in a long tree opens the path to
     * it and leaves it off screen. `block: 'nearest'` is the same call for
     * keyboard travel and for a canvas-driven selection, since both arrive
     * here as the same prop change.
     */
    it('scrolls the selected row into view on any selection change', async () => {
      const w = mount(LayersPane, { props: { doc: DOC, selection: [] } })
      await w.setProps({ selection: ['Button/Primary#container/label'] })

      const target = w.get('[data-address="Button/Primary#container/label"]').element
      expect(target.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' })
    })
  })
})

/**
 * A page with thousands of nodes — a generated world map is the real case —
 * must not put thousands of rows in the DOM. Only the rows near the scroll
 * viewport are rendered; the rest is a spacer the scrollbar describes.
 *
 * jsdom lays nothing out, so the viewport height is stubbed on the element
 * class and the scroll offset is driven by hand. `ROW_HEIGHT` is the
 * stylesheet's `--row-h`, which the windowing math relies on.
 */
describe('a long tree', () => {
  /** 300 leaves under one frame: 302 rows, none of them auto-collapsed. */
  const LONG = parseOrThrow(`---
id: long
---

## Visual Contract

<Page>
  <Frame name="dots">
${Array.from({ length: 300 }, (_, i) => `    <Vector name="d${i}" />`).join('\n')}
  </Frame>
</Page>
`)

  /** Ten rows tall, as the pane's element reports it. */
  const VIEWPORT = 10 * ROW_HEIGHT

  let heightSpy: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    heightSpy = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.classList.contains('layers') ? VIEWPORT : 0
    })
  })
  afterEach(() => heightSpy.mockRestore())

  it('renders only the rows near the viewport, on a spacer the height of the list', async () => {
    const w = mount(LayersPane, { props: { doc: LONG, selection: [] }, attachTo: document.body })
    // The viewport is measured on mount; the slice follows on the next tick.
    await nextTick()
    const rendered = rowsOf(w)
    expect(rendered.length).toBeGreaterThanOrEqual(10)
    expect(rendered.length).toBeLessThan(40)
    expect(rendered[0]!.attributes('data-address')).toBe('')
    expect(w.get('.spacer').attributes('style')).toContain(`height: ${302 * ROW_HEIGHT}px`)
    w.unmount()
  })

  it('moves the rendered slice with the scroll offset', async () => {
    const w = mount(LayersPane, { props: { doc: LONG, selection: [] }, attachTo: document.body })
    const pane = w.get('.layers').element as HTMLElement
    pane.scrollTop = 200 * ROW_HEIGHT
    await w.get('.layers').trigger('scroll')

    const addresses = rowsOf(w).map((r) => r.attributes('data-address'))
    expect(addresses).toContain('dots#d200')
    expect(addresses).not.toContain('')
    expect(addresses).not.toContain('dots#d0')
    expect(w.get('.window').attributes('style')).toMatch(/translateY\(\d+px\)/)
    w.unmount()
  })

  it('scrolls a selection made elsewhere into the window before scrolling it into view', async () => {
    const w = mount(LayersPane, { props: { doc: LONG, selection: [] }, attachTo: document.body })
    const pane = w.get('.layers').element as HTMLElement
    await w.setProps({ selection: ['dots#d250'] })
    await nextTick()

    // Row 252 of 302 (page, frame, then the leaves): the least scroll that
    // shows it puts its bottom edge at the bottom of a ten-row viewport.
    expect(pane.scrollTop).toBe(253 * ROW_HEIGHT - VIEWPORT)
    const target = w.get('[data-address="dots#d250"]').element
    expect(target.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' })
    w.unmount()
  })

  it('brings the row keyboard travel lands on into the window', async () => {
    const w = mount(LayersPane, {
      props: { doc: LONG, selection: ['dots#d3'] },
      attachTo: document.body,
    })
    const pane = w.get('.layers').element as HTMLElement
    await w.get('[data-address="dots#d3"]').trigger('keydown', { key: 'End' })
    await nextTick()

    expect(w.emitted('select')?.at(-1)).toEqual(['dots#d299'])
    expect(pane.scrollTop).toBe(302 * ROW_HEIGHT - VIEWPORT)
    expect(document.activeElement?.getAttribute('data-address')).toBe('dots#d299')
    w.unmount()
  })
})

/**
 * A large tree opens closed below its top level, the way Figma opens a file.
 * A contract-sized tree still opens fully — the rule above is what the rest
 * of this file tests — and a subtree the author opened stays open across the
 * re-parse a save causes.
 */
describe('a large tree', () => {
  const LARGE = parseOrThrow(`---
id: large
---

## Visual Contract

<Page>
  <Frame name="screen">
    <Frame name="map">
${Array.from({ length: 300 }, (_, i) => `      <Vector name="d${i}" />`).join('\n')}
    </Frame>
    <Frame name="legend">
      <Text name="title" characters="Legend" />
    </Frame>
  </Frame>
</Page>
`)

  it('starts collapsed below the page and its top-level frames', () => {
    const w = mount(LayersPane, { props: { doc: LARGE, selection: [] } })
    expect(rowsOf(w).map((r) => r.attributes('data-address'))).toEqual([
      '',
      'screen',
      'screen#map',
      'screen#legend',
    ])
  })

  it('keeps a subtree the author opened open across a re-parse', async () => {
    const w = mount(LayersPane, { props: { doc: LARGE, selection: [] } })
    await w.get('[data-address="screen#legend"] .chevron').trigger('click')
    expect(rowsOf(w).map((r) => r.attributes('data-address'))).toContain('screen#legend/title')

    await w.setProps({ doc: parseOrThrow(LARGE.source) })
    expect(rowsOf(w).map((r) => r.attributes('data-address'))).toContain('screen#legend/title')
  })

  it('still opens the path to a selection made elsewhere', async () => {
    const w = mount(LayersPane, { props: { doc: LARGE, selection: [] } })
    await w.setProps({ selection: ['screen#map/d7'] })
    expect(rowsOf(w).map((r) => r.attributes('data-address'))).toContain('screen#map/d7')
  })
})

/**
 * A component's states in the rail (story F8, ADR 0005).
 *
 * A `<Variant>` row is authored — it has a line in the file, its children are
 * ordinary editable nodes, and it is selectable like any other. What it lacks
 * is a name of its own (§3), a position of its own (§5), and any legal scene
 * attribute at all. Three of the rail's gestures therefore have nothing to
 * write, and refusing them is what keeps the rail from offering an edit the
 * format rejects.
 */
const STATEFUL = parseOrThrow(`---
id: chip
---

## Visual Contract

<Page>
  <Component name="Chip" status="draft" variants={{ state: ['default', 'hover'] }}>
    <Variant state="default">
      <Frame name="root" layoutMode="VERTICAL"><Text name="t" characters="Chip" /></Frame>
    </Variant>
    <Variant state="hover">
      <Frame name="root" layoutMode="VERTICAL"><Text name="t" characters="Hover" /></Frame>
    </Variant>
  </Component>
</Page>
`)

describe('a variant row', () => {
  const VARIANT = 'Chip#state=default'
  const mountIt = () => mount(LayersPane, { props: { doc: STATEFUL, selection: [] } })

  it('is shown, marked derived, and not draggable', () => {
    const row = mountIt().get(`[data-address="${VARIANT}"]`)
    expect(row.attributes('data-derived')).toBe('true')
    expect(row.attributes('data-generated')).toBe('false')
    expect(row.attributes('draggable')).toBe('false')
  })

  it('opens no rename box, because its name is its coordinates', async () => {
    const w = mountIt()
    await w.get(`[data-address="${VARIANT}"] .label`).trigger('dblclick')
    expect(w.find(`[data-address="${VARIANT}"] .rename-input`).exists()).toBe(false)
  })

  it('offers no visibility toggle, because `visible` is not legal on it', () => {
    const w = mountIt()
    expect(w.find(`[data-address="${VARIANT}"] .eye`).exists()).toBe(false)
    // The frame inside it keeps every one of those.
    expect(w.find(`[data-address="${VARIANT}/root"] .eye`).exists()).toBe(true)
    expect(w.get(`[data-address="${VARIANT}/root"]`).attributes('draggable')).toBe('true')
  })

  it('is still selectable, and so is everything inside it', async () => {
    const w = mountIt()
    await w.get(`[data-address="${VARIANT}"] .label`).trigger('click')
    expect(w.emitted('select')?.[0]).toEqual([VARIANT])
    await w.get(`[data-address="${VARIANT}/root/t"] .label`).trigger('click')
    expect(w.emitted('select')?.[1]).toEqual([`${VARIANT}/root/t`])
  })
})

it('opens a selected vector in the point editor from the layers panel', async () => {
  const w = mount(LayersPane, {
    props: {
      doc: DOC,
      selection: ['Button/Primary#container/icon'],
      vectorEditing: 'Button/Primary#container/icon',
      writable: true,
    },
  })
  const button = w.get('[aria-label="Edit vector icon"]')
  expect(button.attributes('data-active')).toBe('true')
  await button.trigger('click')
  expect(w.emitted('editVector')).toEqual([['Button/Primary#container/icon']])
  await w.setProps({ writable: false })
  expect(button.attributes('disabled')).toBeDefined()
  w.unmount()
})
