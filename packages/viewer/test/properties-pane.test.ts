import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { applyPatches, parseOrThrow, type JsonValue, type UidxPatch } from '@uidx/format'
import PropertiesPane from '../src/PropertiesPane.vue'

const DOC = parseOrThrow(`---
id: fields
---

## Visual Contract

<Page>
  <Component name="Card" status="stable" version="2.1.0">
    <Frame name="root" cornerRadius="{radius#md}" opacity={0.5} visible={true}
      layoutMode="VERTICAL" notAThing={3} x={10} y={20} width={120} height={40}
      itemSpacing={8}
      fills={[{ type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 } }]}
      effects={[{ type: 'DROP_SHADOW', color: { r: 0, g: 0, b: 0, a: 0.25 },
        offset: { x: 0, y: 4 }, radius: 4, spread: 0, visible: true }]}>
      <Text name="label" characters="Hi" fontSize={14} lineHeight={20} letterSpacing={0.5} />
      <Frame name="actions" layoutMode="HORIZONTAL" width={200}
        paddingLeft={14} paddingRight={6} paddingTop={9} paddingBottom={9} />
      <Rectangle name="swatch" opacity={1} cornerRadius={4}
        constraints={{ horizontal: 'MIN', vertical: 'MIN' }}
        strokeWeight={1} dashPattern={[4, 2]} />
    </Frame>
  </Component>
</Page>
`)

const tokens = new Map<string, JsonValue>([
  ['radius#md', 8],
  ['radius#lg', 16],
  ['flags#on', true],
  ['strings#label', 'Hello'],
])

function pane(selection: string[] = ['Card#root'], writable = true) {
  return mount(PropertiesPane, {
    props: { doc: DOC, selection, tokens, writable },
  })
}

const row = (wrapper: ReturnType<typeof pane>, prop: string) =>
  wrapper.find(`.editor [data-prop="${prop}"]`)

const sectionTitles = (wrapper: ReturnType<typeof pane>) =>
  wrapper.findAll('.section-title').map((t) => t.text())

describe('graphic stroke controls', () => {
  const source = `---
id: stroke-controls
---
## Visual Contract
<Page><Vector name="line" width={100} height={1} strokeCap="ROUND" strokeWeight={4}
 strokes={[{ type: 'SOLID', color: { r: 0, g: 0, b: 0, a: 1 } }]}
 vectorPaths={[{ windingRule: 'NONZERO', data: 'M0 0L100 0' }]} /></Page>`

  it('offers independent endpoints with inherited caps and routes the selected property', async () => {
    const w = mount(PropertiesPane, {
      props: { doc: parseOrThrow(source), selection: ['line'], writable: true },
    })
    const start = w.get<HTMLSelectElement>('#f-strokeStartCap')
    const end = w.get<HTMLSelectElement>('#f-strokeEndCap')
    expect(start.element.value).toBe('ROUND')
    expect(end.element.value).toBe('ROUND')
    expect(w.find('#f-strokeCap').exists()).toBe(false)
    expect(w.find('[data-prop="strokeTopWeight"]').exists()).toBe(false)
    await end.setValue('ARROW_EQUILATERAL')
    expect(w.emitted('commit')).toEqual([['line', 'strokeEndCap', 'ARROW_EQUILATERAL']])
    await w.setProps({ writable: false })
    expect(start.attributes('disabled')).toBeDefined()
    expect(end.attributes('disabled')).toBeDefined()
    w.unmount()
  })

  it('keeps endpoint controls off closed shapes', () => {
    const doc = parseOrThrow(source.replace('M0 0L100 0', 'M0 0L100 0L50 80Z'))
    const w = mount(PropertiesPane, { props: { doc, selection: ['line'], writable: true } })
    expect(w.find('#f-strokeStartCap').exists()).toBe(false)
    expect(w.find('#f-strokeEndCap').exists()).toBe(false)
    expect(w.find('#f-strokeCap').exists()).toBe(true)
    w.unmount()
  })
})

describe('properties pane', () => {
  it('offers Auto / LTR / RTL on text and keeps the content editor in the chosen direction', async () => {
    const wrapper = pane(['Card#root/label'])
    const direction = row(wrapper, 'textDirection')
    const choices = direction.findAll('.enum-item')
    expect(choices.map((choice) => choice.text())).toEqual(['Auto', 'LTR', 'RTL'])
    expect(choices[0]!.attributes('data-state')).toBe('on')
    expect(wrapper.get('#f-characters').attributes('dir')).toBe('auto')
    await choices[2]!.trigger('click')
    expect(wrapper.emitted('commit')).toEqual([['Card#root/label', 'textDirection', 'RTL']])
    const doc = parseOrThrow(
      applyPatches(DOC.source, [
        {
          op: 'add',
          address: 'Card#root/label',
          prop: 'textDirection',
          value: 'RTL',
        },
      ]).source,
    )
    await wrapper.setProps({ doc })
    expect(row(wrapper, 'textDirection').get('[data-state="on"]').text()).toBe('RTL')
    expect(wrapper.get('#f-characters').attributes('dir')).toBe('rtl')
    await wrapper.setProps({ writable: false })
    expect(
      row(wrapper, 'textDirection')
        .findAll('.enum-item')
        .every((choice) => choice.attributes('disabled') !== undefined),
    ).toBe(true)
    wrapper.unmount()
  })

  it('keeps paragraph direction off non-text layers', () => {
    const wrapper = pane()
    expect(row(wrapper, 'textDirection').exists()).toBe(false)
    wrapper.unmount()
  })

  it('asks for a selection before offering anything to edit', () => {
    const wrapper = pane([])
    expect(wrapper.find('.editor').exists()).toBe(false)
    expect(wrapper.text()).toContain('Select a layer')
  })

  /**
   * `editableProps` excludes `status` and `version` because no patch through
   * the prop table could write them — which makes these chips the only place
   * they appear at all. The outline that used to carry them is gone, so
   * dropping them here puts them in the file and nowhere in the app.
   */
  it('shows a component status and version as chips', () => {
    const chips = pane(['Card']).findAll('.node-head .meta')
    expect(chips.map((c) => c.text())).toEqual(['stable', '2.1.0'])
    expect(chips[0]!.attributes('data-meta')).toBe('status')
    expect(chips[0]!.attributes('data-value')).toBe('stable')
  })

  it('shows no chips on a node that carries no metadata', () => {
    expect(pane().findAll('.node-head .meta')).toHaveLength(0)
  })

  it('groups fields into sections, in spec order', () => {
    const wrapper = pane()
    // Stroke and Effects render although the file never declared them — the
    // C8 virtual fields put the sections there so each can offer its `+`.
    // Export closes the list and is not a `PropGroup`: it groups no field, and
    // it is here because it is a section of the panel all the same.
    expect(sectionTitles(wrapper)).toEqual([
      'Position',
      'Layout',
      'Appearance',
      'Fill',
      'Stroke',
      'Effects',
      'Export',
    ])
  })

  it('a Text node shows the Text section; a Frame does not', () => {
    const text = pane(['Card#root/label'])
    expect(sectionTitles(text)).toContain('Text')

    const frame = pane(['Card#root'])
    expect(sectionTitles(frame)).not.toContain('Text')
  })

  it('offers no control for a prop the prop table does not know', () => {
    const wrapper = pane()
    const unknown = row(wrapper, 'notAThing')
    expect(unknown.find('input, select, button:not(.token-detach)').exists()).toBe(false)
    expect(unknown.text()).toContain('not in the prop table')
  })

  it('fills no longer reads as an uneditable row (C8)', () => {
    expect(row(pane(), 'fills').find('.paint-row').exists()).toBe(true)
  })

  /**
   * Story C5: a bound value shows as its token, not its number, and detaching
   * is a deliberate, visible act — the same distinction Figma draws. Task 10
   * turns that token into Figma's own pill: short name in the box, full
   * address and resolved value in the tooltip.
   */
  it('shows a bound value as its token pill, with what it resolves to in the tooltip', () => {
    const wrapper = pane()
    const bound = row(wrapper, 'cornerRadius')
    const pill = bound.find('.token-pill')
    expect(pill.text()).toBe('md')
    expect(pill.attributes('title')).toContain('radius#md')
    expect(pill.attributes('title')).toContain('8')
    // No number field: typing over the binding is not how you detach.
    expect(bound.find('input[type="text"]').exists()).toBe(false)
  })

  it('detaches a binding only when the button is pressed, and writes the literal', async () => {
    const wrapper = pane()
    expect(wrapper.emitted('commit')).toBeUndefined()

    await row(wrapper, 'cornerRadius').find('.token-detach').trigger('click')
    // Finding 2: the scene already renders the resolved value, so a
    // scene-routed commit would produce no patch at all — detach has to go
    // structural, the same trap the paint-alias fix closed for fills.
    expect(wrapper.emitted('patches')).toEqual([
      [[{ op: 'set', address: 'Card#root', prop: 'cornerRadius', value: 8 }]],
    ])
    expect(wrapper.emitted('commit')).toBeUndefined()
  })

  /**
   * Task 10: the token row IS the pill Figma renders for a bound value — the
   * glyph, the short name, and a trailing detach icon that writes the
   * resolved literal back.
   *
   * Finding 2: detach routes structurally, not through the scene commit — the
   * scene already renders the resolved value, so a scene commit would
   * produce no change and no patch.
   */
  it('renders a token binding as a pill and detaches to the literal', async () => {
    const wrapper = pane()
    const pill = row(wrapper, 'cornerRadius').find('.token-pill')
    expect(pill.text()).toBe('md')
    expect(pill.attributes('title')).toContain('radius#md')
    expect(pill.attributes('title')).toContain('8')
    await row(wrapper, 'cornerRadius').find('.token-detach').trigger('click')
    const patches = wrapper.emitted('patches')!.at(-1)![0] as UidxPatch[]
    expect(patches).toEqual([{ op: 'set', address: 'Card#root', prop: 'cornerRadius', value: 8 }])
    expect(wrapper.emitted('commit')).toBeUndefined()
  })

  it('switches the token from the pill popup', async () => {
    const wrapper = pane()
    await row(wrapper, 'cornerRadius').find('.token-pill').trigger('click')
    await wrapper.find('[data-variable="radius#lg"]').trigger('click')
    const patches = wrapper.emitted('patches')!.at(-1)![0] as UidxPatch[]
    expect(patches).toEqual([
      { op: 'set', address: 'Card#root', prop: 'cornerRadius', value: '{radius#lg}' },
    ])
  })

  it('commits a toggled flag immediately', async () => {
    // C9: visibility moved from a checkbox row onto the Appearance header.
    const wrapper = pane()
    await wrapper.find('.section-eye').trigger('click')
    expect(wrapper.emitted('commit')).toEqual([['Card#root', 'visible', false]])
  })

  it('offers matching variables in the eye popup and binds one as a patch', async () => {
    const wrapper = pane()
    await wrapper.find('.section-link .apply-property').trigger('click')
    // BOOLEAN input: the boolean variable shows, the number one does not.
    expect(wrapper.find('[data-variable="flags#on"]').exists()).toBe(true)
    expect(wrapper.find('[data-variable="radius#md"]').exists()).toBe(false)
    await wrapper.find('[data-variable="flags#on"]').trigger('click')
    const patches = wrapper.emitted('patches')!.at(-1)![0] as UidxPatch[]
    expect(patches).toEqual([
      { op: 'set', address: 'Card#root', prop: 'visible', value: '{flags#on}' },
    ])
  })

  it('commits a changed string', async () => {
    const wrapper = pane(['Card#root/label'])
    // `setValue` fires `change` itself; triggering it again would double-count.
    const input = row(wrapper, 'characters').find('textarea')
    await input.setValue('Yo')
    expect(wrapper.emitted('commit')).toEqual([['Card#root/label', 'characters', 'Yo']])
  })

  it('renders an enum with exactly its legal options, and nothing lets you type a fifth', () => {
    const wrapper = pane()
    const layoutMode = row(wrapper, 'layoutMode')
    expect(layoutMode.find('input[type="text"]').exists()).toBe(false)
    const items = layoutMode.findAllComponents({ name: 'SegmentedControlItem' })
    expect(items.map((i: { props: (name: string) => unknown }) => i.props('value'))).toEqual([
      'NONE',
      'HORIZONTAL',
      'VERTICAL',
      'GRID',
    ])
  })

  it('commits an enum selection', async () => {
    const wrapper = pane()
    const segmented = row(wrapper, 'layoutMode').findComponent({ name: 'SegmentedControlRoot' })
    segmented.vm.$emit('update:modelValue', 'HORIZONTAL')
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('commit')).toEqual([['Card#root', 'layoutMode', 'HORIZONTAL']])
  })

  /**
   * C4's rule, at the boundary the panel owns: a value passing through is a
   * preview and must not become a patch. Only a commit does.
   */
  it('keeps preview and commit apart', async () => {
    const wrapper = pane()
    const numberField = row(wrapper, 'opacity').findComponent({ name: 'NumberFieldRoot' })

    numberField.vm.$emit('update:modelValue', 0.7)
    numberField.vm.$emit('update:modelValue', 0.8)
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('preview')).toHaveLength(2)
    expect(wrapper.emitted('commit')).toBeUndefined()

    numberField.vm.$emit('commit', 0.8, 0.5)
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('commit')).toHaveLength(1)
  })

  /**
   * The number under the cursor has to be the number the canvas is drawing.
   *
   * `NumberFieldRoot` is controlled: what it renders comes from `model-value`,
   * and a preview deliberately never reaches the document. So the value the
   * panel resolves from `doc` cannot move during a gesture, and the pane has to
   * hold the previewed one itself or spend the whole drag showing the old one.
   */
  it('shows the value being previewed, not the committed one', async () => {
    // C9: opacity is a percentage control now — the field works in percent
    // and only the value leaving it is the fraction the file holds.
    const wrapper = pane()
    expect(row(wrapper, 'opacity').find('.scrub').text()).toBe('50%')

    const numberField = row(wrapper, 'opacity').findComponent({ name: 'NumberFieldRoot' })
    numberField.vm.$emit('update:modelValue', 80)
    await wrapper.vm.$nextTick()

    expect(row(wrapper, 'opacity').find('.scrub').text()).toBe('80%')
  })

  /**
   * Position is the parent's business: `root` is a VERTICAL auto-layout frame,
   * so `actions` sits where the layout puts it — X and Y show the value but
   * refuse the edit, the way Figma greys them out. Writing them anyway is what
   * produced the double-`add` envelope the server refused whole.
   */
  it('greys out x and y for a child the parent lays out', async () => {
    const wrapper = pane(['Card#root/actions'])
    const x = row(wrapper, 'x')
    const numberField = x.findComponent({ name: 'NumberFieldRoot' })
    numberField.vm.$emit('update:modelValue', 50)
    await wrapper.vm.$nextTick()
    // The scrub is swallowed: nothing previews, nothing will ever commit.
    expect(wrapper.emitted('preview')).toBeUndefined()
    // The reason travels as a tooltip so "cannot edit" never reads as broken.
    expect(x.attributes('title')).toMatch(/auto layout/i)
  })

  it('keeps x editable on the auto-layout frame itself', async () => {
    const wrapper = pane(['Card#root'])
    const x = row(wrapper, 'x')
    x.findComponent({ name: 'NumberFieldRoot' }).vm.$emit('update:modelValue', 50)
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('preview')).toEqual([['Card#root', 'x', 50]])
    expect(x.attributes('title')).toBeUndefined()
  })

  /**
   * The file is the source of truth and it can change mid-scrub. The property
   * under the author's finger stays theirs; everything else reads the new
   * document. Only the previewed node leaving the file reclaims the row.
   */
  it('holds a scrub through a remote document change', async () => {
    const wrapper = pane()
    const numberField = row(wrapper, 'opacity').findComponent({ name: 'NumberFieldRoot' })
    numberField.vm.$emit('update:modelValue', 80)
    await wrapper.vm.$nextTick()
    expect(row(wrapper, 'opacity').find('.scrub').text()).toBe('80%')

    // An unrelated external edit: same tree, one other value moved.
    const touched = parseOrThrow(DOC.source.replace('fontSize={14}', 'fontSize={15}'))
    await wrapper.setProps({ doc: touched })
    expect(row(wrapper, 'opacity').find('.scrub').text()).toBe('80%')
  })

  it('drops the held scrub when the previewed node leaves the file', async () => {
    const wrapper = pane()
    const numberField = row(wrapper, 'opacity').findComponent({ name: 'NumberFieldRoot' })
    numberField.vm.$emit('update:modelValue', 80)
    await wrapper.vm.$nextTick()

    // The node vanishes, then comes back: the scrub must not survive the trip.
    const gone = parseOrThrow(DOC.source.replace('name="root"', 'name="elsewhere"'))
    await wrapper.setProps({ doc: gone })
    await wrapper.setProps({ doc: DOC })
    expect(row(wrapper, 'opacity').find('.scrub').text()).toBe('50%')
  })

  /** The same thing through the real gesture, which is how it was reported. */
  it('tracks a scrub as it happens, and still commits exactly once', async () => {
    const wrapper = pane()
    const scrub = () => row(wrapper, 'opacity').find('.scrub')
    const target = scrub().element as HTMLElement
    // jsdom tracks no live pointers, so capture would throw on a made-up id.
    Object.assign(target, {
      setPointerCapture: () => {},
      hasPointerCapture: () => false,
      releasePointerCapture: () => {},
    })

    // `clientX` is read-only on a constructed event, so VTU cannot set it and
    // the scrub — which is nothing but a sum of `clientX` deltas — needs it.
    const drag = async (type: string, clientX: number) => {
      const event = new MouseEvent(type, { clientX, bubbles: true, cancelable: true })
      Object.defineProperty(event, 'pointerId', { value: 1 })
      target.dispatchEvent(event)
      await wrapper.vm.$nextTick()
    }

    await drag('pointerdown', 100)
    // Past the 2px threshold that separates a scrub from a click. In percent
    // the step is 1, so ten pixels is ten points.
    await drag('pointermove', 110)
    expect(scrub().text()).toBe('60%')

    await drag('pointermove', 120)
    expect(scrub().text()).toBe('70%')

    await drag('pointerup', 120)
    expect(wrapper.emitted('commit')).toEqual([['Card#root', 'opacity', 0.7]])
  })

  /**
   * At rest the file is the only source of truth. The held value is for the
   * duration of the gesture and nothing longer — otherwise a rejected patch, or
   * an edit arriving from elsewhere, would leave the panel quietly lying.
   */
  it('hands the value back to the document once the gesture ends', async () => {
    const wrapper = pane()
    const numberField = row(wrapper, 'opacity').findComponent({ name: 'NumberFieldRoot' })

    numberField.vm.$emit('update:modelValue', 80)
    await wrapper.vm.$nextTick()
    expect(row(wrapper, 'opacity').find('.scrub').text()).toBe('80%')

    // This document still says 0.5, and until it says otherwise, so does the panel.
    numberField.vm.$emit('commit', 80, 50)
    await wrapper.vm.$nextTick()
    expect(row(wrapper, 'opacity').find('.scrub').text()).toBe('50%')
  })

  it('holds the previewed value for the scrubbed field only', async () => {
    const wrapper = pane()
    const numberField = row(wrapper, 'opacity').findComponent({ name: 'NumberFieldRoot' })

    numberField.vm.$emit('update:modelValue', 80)
    await wrapper.vm.$nextTick()
    // `cornerRadius` resolves through the token map and is nobody's gesture.
    expect(row(wrapper, 'cornerRadius').find('.token-pill').attributes('title')).toContain('8')
  })

  it('goes read-only when the socket is down, and says so', async () => {
    const wrapper = pane(['Card#root'], false)
    expect(wrapper.text()).toContain('Reconnect to edit')

    const eye = wrapper.find('.section-eye')
    expect(eye.attributes('disabled')).toBeDefined()
    await eye.trigger('click')
    expect(wrapper.emitted('commit')).toBeUndefined()

    expect(row(wrapper, 'cornerRadius').find('.token-detach').attributes('disabled')).toBeDefined()
  })

  it('offers the paintable sections even on a node that declares nothing (C8)', () => {
    const wrapper = pane(['Card'])
    // `Card` authors only `name` and metadata; since C7 every applicable
    // section shows, and the paintable ones still offer their `+`.
    for (const section of ['Fill', 'Stroke', 'Effects']) {
      expect(sectionTitles(wrapper), section).toContain(section)
    }
    expect(wrapper.find('[data-section-add="fill"]').exists()).toBe(true)
  })

  it('puts each axis on one row, and Width and Height on another', () => {
    const wrapper = pane()
    const position = row(wrapper, 'x')
    expect(position.findAll('.pair-grid > .field-cell')).toHaveLength(2)
    // Left beside Right — the axis is the line since the CSS revision, so an
    // edge sits in the same place whatever the pin holds.
    expect(position.find('[data-field="right"]').exists()).toBe(true)
    expect(row(wrapper, 'y').find('[data-field="bottom"]').exists()).toBe(true)

    // C9: W and H became the Resizing row, so they carry their sizing state
    // rather than being a generic pair.
    const size = wrapper.find('.field-resizing')
    expect(size.find('.size-field[data-dimension="width"]').exists()).toBe(true)
    expect(size.find('.size-field[data-dimension="height"]').exists()).toBe(true)
  })

  it('renders captions above controls, UI3 style', () => {
    const wrapper = pane()
    // One caption above each half of the axis pair — the spanning "Position"
    // caption with letters inside the boxes went with the CSS revision:
    // every edge is named the same way, label over input.
    expect(wrapper.find('[data-prop="x"] .pair-captions').text()).toBe('LeftRight')
    // A solo labeled row's label is a caption block over the box.
    expect(row(wrapper, 'opacity').find('.pair-captions').text()).toBe('OpacityBlend mode')
  })

  /**
   * A pair with no group name of its own — unlike x/y's "Position" — falls
   * back to captioning each half separately, rather than showing nothing or
   * reusing the wrong word. `label` authors both in the fixture above.
   */
  it('captions a named pair (no shared group name) with each half’s own label', () => {
    const wrapper = pane(['Card#root/label'])
    const captions = row(wrapper, 'lineHeight').findAll('.pair-captions .field-caption')
    expect(captions.map((c) => c.text())).toEqual(['Line height', 'Letter spacing'])
  })

  describe('constraints and dashes (C8)', () => {
    /**
     * C8 built this as two selects carrying the scene graph's five-value
     * domain. H2 replaced it with Figma's edge widget, which is the same
     * decision asked once instead of twice — and drops SCALE, which the format
     * refuses (UIDX136, ADR 0011 §3). The commit is unchanged: one
     * `constraints` value carrying both axes.
     */
    it('disables the widget on a flowed child, whose pin the server refuses', () => {
      // `swatch` sits in root's VERTICAL flow, and a pin on a flowed child is
      // UIDX135. The authored pair still renders — it is in the file — but
      // every edge is inert: an active widget here was an affordance for a
      // write the server always rejected.
      const wrapper = pane(['Card#root/swatch'])
      const widget = row(wrapper, 'constraints')
      expect(widget.findAll('select')).toHaveLength(0)
      expect(widget.find('[aria-label="pin bottom"]').attributes('disabled')).toBeDefined()
    })

    it('commits a parsed dash pattern and refuses garbage without writing', async () => {
      const wrapper = pane(['Card#root/swatch'])
      const input = row(wrapper, 'dashPattern').find('input[type="text"]')
      expect((input.element as HTMLInputElement).value).toBe('4, 2')

      await input.setValue('8, 4, 2')
      expect(wrapper.emitted('commit')).toEqual([['Card#root/swatch', 'dashPattern', [8, 4, 2]]])

      await input.setValue('8, banana')
      expect(wrapper.emitted('commit')).toHaveLength(1)
      expect(row(wrapper, 'dashPattern').find('.invalid').exists()).toBe(true)
    })
  })

  describe('paint stack (C8)', () => {
    it('offers + on the Fill header and appends a solid through it', async () => {
      const wrapper = pane()
      const add = wrapper.find('[data-section-add="fill"]')
      expect(add.exists()).toBe(true)
      // The in-field header row is gone — the section title is the label now.
      expect(wrapper.find('.paints-head').exists()).toBe(false)
      await add.trigger('click')
      const commits = wrapper.emitted('commit')!
      const [, prop, value] = commits[commits.length - 1]!
      expect(prop).toBe('fills')
      expect((value as unknown[]).length).toBe(2) // DOC's red solid + the appended one
    })

    it('renders a row per paint with hex, opacity, eye and remove', () => {
      const fills = row(pane(), 'fills')
      expect(fills.findAll('.paint-row')).toHaveLength(1)
      expect((fills.find('.paint-hex').element as HTMLInputElement).value).toBe('#ff0000')
      expect(fills.find('.paint-eye').exists()).toBe(true)
      expect(fills.find('.paint-remove').exists()).toBe(true)
    })

    it('commits a hex recolour as the whole fills value', async () => {
      const wrapper = pane()
      await row(wrapper, 'fills').find('.paint-hex').setValue('#0000ff')
      expect(wrapper.emitted('commit')).toEqual([
        ['Card#root', 'fills', [{ type: 'SOLID', color: { r: 0, g: 0, b: 1, a: 1 } }]],
      ])
    })

    it('toggles a paint’s eye with everything else untouched', async () => {
      const wrapper = pane()
      await row(wrapper, 'fills').find('.paint-eye').trigger('click')
      expect(wrapper.emitted('commit')).toEqual([
        [
          'Card#root',
          'fills',
          [{ type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 }, visible: false }],
        ],
      ])
    })

    it('adds the first fill to a bare node from the section’s +', async () => {
      const wrapper = pane(['Card#root/swatch'])
      const fills = row(wrapper, 'fills')
      expect(fills.findAll('.paint-row')).toHaveLength(0)
      await wrapper.find('[data-section-add="fill"]').trigger('click')
      expect(wrapper.emitted('commit')).toEqual([
        [
          'Card#root/swatch',
          'fills',
          [{ type: 'SOLID', color: { r: 0.5, g: 0.5, b: 0.5, a: 1 }, opacity: 1, visible: true }],
        ],
      ])
    })

    it('opens the picker dialog from a swatch; SV drags preview and release commits once', async () => {
      const wrapper = pane()
      await row(wrapper, 'fills').find('.paint-swatch').trigger('click')
      const sv = row(wrapper, 'fills').find('.picker-sv')
      expect(sv.exists()).toBe(true)

      const el = sv.element as HTMLElement
      el.getBoundingClientRect = () =>
        ({
          left: 0,
          top: 0,
          width: 100,
          height: 100,
          right: 100,
          bottom: 100,
          x: 0,
          y: 0,
          toJSON: () => '',
        }) as DOMRect
      Object.assign(el, { setPointerCapture: () => {}, releasePointerCapture: () => {} })

      const point = async (type: string, x: number, y: number) => {
        const event = new MouseEvent(type, { clientX: x, clientY: y, bubbles: true })
        Object.defineProperty(event, 'pointerId', { value: 1 })
        el.dispatchEvent(event)
        await wrapper.vm.$nextTick()
      }
      await point('pointerdown', 100, 0) // s=1, v=1 -> pure hue
      expect(wrapper.emitted('preview')!.length).toBeGreaterThan(0)
      expect(wrapper.emitted('commit')).toBeUndefined()
      await point('pointerup', 100, 0)
      expect(wrapper.emitted('commit')).toHaveLength(1)
      // fills was red -> hue 0, s=1 v=1 stays pure red
      expect(wrapper.emitted('commit')![0]).toEqual([
        'Card#root',
        'fills',
        [{ type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 } }],
      ])
    })

    it('commits a document swatch with one click', async () => {
      const wrapper = pane()
      await row(wrapper, 'fills').find('.paint-swatch').trigger('click')
      const swatches = row(wrapper, 'fills').findAll('.picker-swatch')
      expect(swatches.length).toBeGreaterThan(0)
      await swatches[0]!.trigger('click')
      expect(wrapper.emitted('commit')).toHaveLength(1)
    })

    it('stays open across a commit, the way a picker you are working in must', async () => {
      const wrapper = pane()
      await row(wrapper, 'fills').find('.paint-swatch').trigger('click')
      const swatches = row(wrapper, 'fills').findAll('.picker-swatch')
      await swatches[0]!.trigger('click')
      expect(wrapper.emitted('commit')).toHaveLength(1)
      expect(row(wrapper, 'fills').find('.picker-dialog').exists()).toBe(true)
    })

    it('closes the dialog on Escape', async () => {
      const wrapper = pane([], true)
      const open = pane()
      await row(open, 'fills').find('.paint-swatch').trigger('click')
      expect(row(open, 'fills').find('.picker-dialog').exists()).toBe(true)
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      await open.vm.$nextTick()
      expect(row(open, 'fills').find('.picker-dialog').exists()).toBe(false)
      expect(wrapper.exists()).toBe(true)
    })

    it('closes the dialog when a pointer lands outside it', async () => {
      const wrapper = pane()
      await row(wrapper, 'fills').find('.paint-swatch').trigger('click')
      expect(row(wrapper, 'fills').find('.picker-dialog').exists()).toBe(true)
      document.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
      await wrapper.vm.$nextTick()
      expect(row(wrapper, 'fills').find('.picker-dialog').exists()).toBe(false)
    })

    it('leaves the dialog open for a pointer inside it', async () => {
      const wrapper = pane()
      await row(wrapper, 'fills').find('.paint-swatch').trigger('click')
      const dialog = row(wrapper, 'fills').find('.picker-dialog')
      dialog.element.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
      await wrapper.vm.$nextTick()
      expect(row(wrapper, 'fills').find('.picker-dialog').exists()).toBe(true)
    })

    it('refuses invalid hex in the dialog without writing', async () => {
      const wrapper = pane()
      await row(wrapper, 'fills').find('.paint-swatch').trigger('click')
      await row(wrapper, 'fills').find('.picker-hex').setValue('nope')
      expect(wrapper.emitted('commit')).toBeUndefined()
      expect(row(wrapper, 'fills').find('.picker-hex.invalid').exists()).toBe(true)
    })
  })

  describe('effects list (C8)', () => {
    const SHADOW = {
      type: 'DROP_SHADOW',
      color: { r: 0, g: 0, b: 0, a: 0.25 },
      offset: { x: 0, y: 4 },
      radius: 4,
      spread: 0,
      visible: true,
    }

    it('renders a row with type select and the four numbers', () => {
      const effects = row(pane(), 'effects')
      expect(effects.findAll('.effect-row')).toHaveLength(1)
      expect(effects.find('.effect-type').findAll('option')).toHaveLength(5)
      // C9: the numbers are NumberFieldRoot boxes now — a scrub span, not an input.
      expect(effects.find('.effect-radius .scrub').text()).toBe('4')
    })

    it('commits a blur change as the whole effects value', async () => {
      const wrapper = pane()
      const radius = row(wrapper, 'effects').find('.effect-radius')
      await radius.find('.scrub').trigger('dblclick')
      await radius.find('input').setValue('10')
      await radius.find('input').trigger('blur')
      expect(wrapper.emitted('commit')).toEqual([
        ['Card#root', 'effects', [{ ...SHADOW, radius: 10 }]],
      ])
    })

    it('adds the first effect to a bare node as Figma’s default shadow', async () => {
      const wrapper = pane(['Card#root/swatch'])
      await wrapper.find('[data-section-add="effects"]').trigger('click')
      expect(wrapper.emitted('commit')).toEqual([['Card#root/swatch', 'effects', [SHADOW]]])
    })

    it('toggles an effect’s eye', async () => {
      const wrapper = pane()
      await row(wrapper, 'effects').find('.effect-eye').trigger('click')
      expect(wrapper.emitted('commit')).toEqual([
        ['Card#root', 'effects', [{ ...SHADOW, visible: false }]],
      ])
    })

    /**
     * Finding 3: an alias-colored effect resolves fine through the scene (the
     * doc's `+` value here would render), but `asEffects` rejects the whole
     * array — it wants a literal `Rgba`, not an alias string — so the empty
     * list `EffectListField` showed used to make the header's `+` compute
     * `addEffect(asEffects(value)) = addEffect(null) = [defaultShadow]`: one
     * click silently replaced the whole attribute, deleting the alias. The
     * `+` now disables itself instead, and the list explains why it looks
     * empty rather than looking broken.
     */
    it('disables the effects + and explains why for an alias-colored effect', () => {
      const doc = parseOrThrow(`---
id: alias-effect
---

## Visual Contract

<Page>
  <Component name="Card" status="draft">
    <Frame name="root" width={10} height={10}
      effects={[{ type: 'DROP_SHADOW', color: "{palette#shadow}",
        offset: { x: 0, y: 4 }, radius: 4, spread: 0, visible: true }]} />
  </Component>
</Page>
`)
      const wrapper = mount(PropertiesPane, {
        props: {
          doc,
          selection: ['Card#root'],
          tokens: new Map<string, JsonValue>([['palette#shadow', { r: 0, g: 0, b: 0, a: 0.25 }]]),
          writable: true,
        },
      })
      const add = wrapper.find('[data-section-add="effects"]')
      expect(add.attributes('disabled')).toBeDefined()
      expect(add.attributes('title')).toContain('cannot edit')
      const effects = row(wrapper, 'effects')
      expect(effects.findAll('.effect-row')).toHaveLength(0)
      expect(effects.find('.effects-readonly').exists()).toBe(true)
    })

    // Regression guard: a doc whose effects are all literal keeps its `+`.
    it('keeps the effects + enabled for a literal effects list', () => {
      const wrapper = pane()
      const add = wrapper.find('[data-section-add="effects"]')
      expect(add.attributes('disabled')).toBeUndefined()
      expect(row(wrapper, 'effects').find('.effects-readonly').exists()).toBe(false)
    })
  })

  it('collapsing a section survives re-selecting the node', async () => {
    const wrapper = pane(['Card#root'])
    const appearanceSection = wrapper
      .findAllComponents({ name: 'PropertySectionRoot' })
      .find((s) => s.find('.section-title').text() === 'Appearance')!

    // Through the real toggle button, not a direct emit — the wiring from
    // the header's slot action to `update:open` is exactly what regressed
    // unseen when this test only emitted the event.
    await appearanceSection.find('.section-toggle').trigger('click')
    expect(appearanceSection.props('open')).toBe(false)

    await wrapper.setProps({ selection: ['Card#root/swatch'] })
    const appearanceAgain = wrapper
      .findAllComponents({ name: 'PropertySectionRoot' })
      .find((s) => s.find('.section-title').text() === 'Appearance')!
    expect(appearanceAgain.props('open')).toBe(false)
  })

  describe('number instruments (C9)', () => {
    it('renders a glyph inside a prop that has one, with a tooltip', () => {
      const wrapper = pane()
      const glyph = row(wrapper, 'itemSpacing').find('.field-glyph')
      expect(glyph.exists()).toBe(true)
      expect(glyph.attributes('title')).toBe('Gap')
      expect(glyph.find('svg').exists()).toBe(true)
    })

    it.each(['Card#root', 'Card#root/actions', 'Card#root/swatch'])(
      'scrolls over every number field without changing %s',
      async (selection) => {
        vi.useFakeTimers()
        const wrapper = pane([selection])
        try {
          const fields = wrapper.findAll(
            '.number, .size-number, .padding-box, .corner-box, .effect-num',
          )
          expect(fields.length).toBeGreaterThan(0)
          const bubbled = vi.fn()
          wrapper.element.addEventListener('wheel', bubbled)
          let count = 0
          for (const field of fields) {
            const before = field.text()
            for (const modifiers of [{}, { shiftKey: true }, { altKey: true }]) {
              const event = new WheelEvent('wheel', {
                deltaY: -100,
                bubbles: true,
                cancelable: true,
                ...modifiers,
              })
              field.element.dispatchEvent(event)
              expect(event.defaultPrevented).toBe(false)
              count++
            }
            expect(field.text()).toBe(before)
          }
          vi.advanceTimersByTime(1000)
          expect(bubbled).toHaveBeenCalledTimes(count)
          expect(wrapper.emitted('preview')).toBeUndefined()
          expect(wrapper.emitted('commit')).toBeUndefined()
          expect(wrapper.emitted('patches')).toBeUndefined()
        } finally {
          wrapper.unmount()
          vi.useRealTimers()
        }
      },
    )

    it('keeps a focused number input editable while wheel events bubble to the panel', async () => {
      const wrapper = pane()
      const field = row(wrapper, 'itemSpacing')
      await field.get('.scrub').trigger('dblclick')
      const input = field.get('input.number-input')
      const wheel = new WheelEvent('wheel', { deltaY: 80, bubbles: true, cancelable: true })
      input.element.dispatchEvent(wheel)
      expect(wheel.defaultPrevented).toBe(false)
      expect(wrapper.emitted('preview')).toBeUndefined()
      expect(wrapper.emitted('commit')).toBeUndefined()
      await input.setValue('16')
      await input.trigger('blur')
      expect(wrapper.emitted('commit')).toContainEqual(['Card#root', 'itemSpacing', 16])
      wrapper.unmount()
    })

    it('effect numbers scrub like everything else now', () => {
      const effects = row(pane(), 'effects')
      expect(effects.find('.effect-radius .scrub').exists()).toBe(true)
    })
  })

  describe('the number field’s own variable glyph (task 8)', () => {
    it('binds a number field to a FLOAT variable from its own glyph', async () => {
      const wrapper = pane()
      const gapRow = row(wrapper, 'itemSpacing')
      await gapRow.find('.field-variables').trigger('click')
      await gapRow.find('[data-variable="radius#md"]').trigger('click')
      const patches = wrapper.emitted('patches')!.at(-1)![0] as UidxPatch[]
      expect(patches).toEqual([
        { op: 'set', address: 'Card#root', prop: 'itemSpacing', value: '{radius#md}' },
      ])
    })

    /**
     * `x` and `y` are a compact pair (spec's Position row): both halves render
     * inside the same `.field-pair` wrapper, sharing every ancestor up to that
     * row. `AssignPopup`'s outside-close guard used to climb from its root to
     * find "this trigger's own scope" (Task 7's fix for `PropertyLink`), but
     * climbing from a number field's popup lands on that same shared wrapper —
     * which would exempt *both* halves' triggers, leaving two popups open at
     * once when a click on Y's glyph should have closed X's. The controller
     * ruling replaces the climb with an explicit `trigger` element here, so
     * only that field's own glyph is exempt.
     */
    it('closes X’s popup when Y’s own glyph opens its own, in a paired row', async () => {
      const wrapper = mount(PropertiesPane, {
        props: { doc: DOC, selection: ['Card#root/label'], tokens, writable: true },
        attachTo: document.body,
      })
      // The lineHeight|letterSpacing pair: both halves authored and editable.
      // (x pairs right since the CSS revision, and a loose far edge offers no
      // glyph — so the classic two-glyph row lives in Text now.)
      const pairRow = row(wrapper, 'lineHeight')
      const xGlyph = pairRow.find('[data-field="lineHeight"] .field-variables')
      const yGlyph = pairRow.find('[data-field="letterSpacing"] .field-variables')

      await xGlyph.trigger('click')
      expect(wrapper.findAll('.assign-popup')).toHaveLength(1)

      // A real click is pointerdown then click — the pointerdown is what the
      // open popup's outside-click guard sees; the click opens Y's own,
      // separate popup through its own `pickingVariable` toggle.
      await yGlyph.trigger('pointerdown')
      await yGlyph.trigger('click')

      // Exactly one popup survives — X's must have closed, not stacked.
      expect(wrapper.findAll('.assign-popup')).toHaveLength(1)

      // And the survivor is Y's own: toggling Y's glyph again closes it,
      // which a stale, still-open X popup would not do.
      await yGlyph.trigger('click')
      expect(wrapper.findAll('.assign-popup')).toHaveLength(0)

      wrapper.unmount()
    })
  })

  describe('panel hover (C9)', () => {
    it('re-emits the hovered prop with the address, and null on leave', async () => {
      const wrapper = pane()
      await row(wrapper, 'itemSpacing').trigger('mouseenter')
      expect(wrapper.emitted('hover')!.at(-1)).toEqual(['Card#root', 'itemSpacing'])
      await row(wrapper, 'itemSpacing').trigger('mouseleave')
      expect(wrapper.emitted('hover')!.at(-1)).toEqual(['Card#root', null])
    })

    it('reports props the canvas cannot light too — the map decides, not the panel', async () => {
      const wrapper = pane()
      await row(wrapper, 'fills').trigger('mouseenter')
      expect(wrapper.emitted('hover')!.at(-1)).toEqual(['Card#root', 'fills'])
    })
  })

  describe('alignment matrix and icon segments (C9)', () => {
    it('renders nine cells for an auto-layout frame', () => {
      const matrix = pane().find('.alignment-matrix')
      expect(matrix.exists()).toBe(true)
      expect(matrix.findAll('.matrix-cell')).toHaveLength(9)
    })

    it('commits both axis props from one cell, in one tick', async () => {
      const wrapper = pane()
      const cells = wrapper.findAll('.alignment-matrix .matrix-cell')
      await cells[4]!.trigger('click')
      const commits = wrapper.emitted('commit')!
      expect(commits).toContainEqual(['Card#root', 'primaryAxisAlignItems', 'CENTER'])
      expect(commits).toContainEqual(['Card#root', 'counterAxisAlignItems', 'CENTER'])
    })

    it('names both values in every cell tooltip', () => {
      const cells = pane().findAll('.alignment-matrix .matrix-cell')
      for (const cell of cells) expect(cell.attributes('title')).toMatch(/·/)
    })

    it('offers no matrix for a node with no auto layout', () => {
      expect(pane(['Card#root/swatch']).find('.alignment-matrix').exists()).toBe(false)
    })

    it('renders segmented options as glyphs where one exists, keeping the tooltip', () => {
      const segments = row(pane(), 'layoutMode').findAll('.enum-item')
      expect(segments.length).toBeGreaterThan(0)
      expect(segments[0]!.find('svg').exists()).toBe(true)
      expect(segments[0]!.attributes('title')).toBeTruthy()
    })
  })

  describe('auto layout rebuilt (C9)', () => {
    it('shows W and H as size fields with their sizing state', () => {
      const wrapper = pane()
      const w = wrapper.find('.size-field[data-dimension="width"]')
      expect(w.exists()).toBe(true)
      expect(w.find('.size-mode').exists()).toBe(true)
      // The fixture frame is VERTICAL, so width is governed by the counter axis.
      expect(w.find('.size-mode').attributes('data-prop')).toBe('counterAxisSizingMode')
    })

    it('shows a dash rather than a made-up zero for a dimension the file leaves out', () => {
      // `actions` authors a width and hugs its height.
      const wrapper = pane(['Card#root/actions'])
      expect(wrapper.find('.size-field[data-dimension="height"] .scrub').text()).toBe('–')
      expect(wrapper.find('.size-field[data-dimension="width"] .scrub').text()).toBe('200')
    })

    it('commits the sizing prop the layout mode implies', async () => {
      const wrapper = pane()
      await wrapper.find('.size-field[data-dimension="width"] .size-mode').setValue('AUTO')
      expect(wrapper.emitted('commit')).toContainEqual([
        'Card#root',
        'counterAxisSizingMode',
        'AUTO',
      ])
    })

    /**
     * A `<Text>` has no `layoutMode`, so the auto-layout test that gates the
     * dropdowns answered no for it — leaving the one node whose size is most
     * obviously computed with no way to say so. Its axes are one prop.
     */
    it('offers a text its own sizing, spelled as textAutoResize', () => {
      const wrapper = pane(['Card#root/label'])
      const modes = wrapper.findAll('.size-mode')
      expect(modes).toHaveLength(2)
      expect(modes.map((m) => m.attributes('data-prop'))).toEqual([
        'textAutoResize',
        'textAutoResize',
      ])
      // Nothing authored, so the text hugs its glyphs on both axes.
      expect(modes.map((m) => (m.element as HTMLSelectElement).value)).toEqual(['AUTO', 'AUTO'])
    })

    it('fixes a hugging text one axis at a time, as the vocabulary allows', async () => {
      const wrapper = pane(['Card#root/label'])
      await wrapper.find('.size-field[data-dimension="width"] .size-mode').setValue('FIXED')
      // Auto-width implies auto-height, so fixing the width leaves Auto height.
      expect(wrapper.emitted('commit')).toContainEqual([
        'Card#root/label',
        'textAutoResize',
        'HEIGHT',
      ])
    })

    /** Figma stacks Resizing over the Dimensions it governs; so does this. */
    it('leads the layout section with a text’s Resizing switch', () => {
      const wrapper = pane(['Card#root/label'])
      const layout = sectionNamed(wrapper, 'Layout')
      // Rows, not controls: a text's W/H selects carry `textAutoResize` as
      // their own `data-prop` too, since that is the attribute they write.
      const rows = layout.findAll('.field[data-prop="textAutoResize"], .field-resizing')
      expect(rows.map((r) => r.classes().includes('field-resizing'))).toEqual([false, true])
      // And only once: the generic rows must not render the switch again.
      expect(layout.findAll('.field[data-prop="textAutoResize"]')).toHaveLength(1)
    })

    it('collapses symmetric padding into two boxes', () => {
      const padding = pane().find('.padding-field')
      expect(padding.exists()).toBe(true)
      expect(padding.findAll('.padding-box')).toHaveLength(2)
    })

    it('writes both sides from one collapsed padding box', async () => {
      const wrapper = pane()
      const box = wrapper.find('.padding-field .padding-box[data-axis="horizontal"]')
      await box.find('.scrub').trigger('dblclick')
      await box.find('input').setValue('24')
      await box.find('input').trigger('blur')
      const commits = wrapper.emitted('commit')!
      expect(commits).toContainEqual(['Card#root', 'paddingLeft', 24])
      expect(commits).toContainEqual(['Card#root', 'paddingRight', 24])
    })

    it('expands to four boxes on request', async () => {
      const wrapper = pane()
      await wrapper.find('.padding-field .padding-expand').trigger('click')
      expect(wrapper.findAll('.padding-field .padding-box')).toHaveLength(4)
    })

    it('opens expanded when the sides disagree', () => {
      const wrapper = pane(['Card#root/actions'])
      expect(wrapper.findAll('.padding-field .padding-box')).toHaveLength(4)
    })

    it('stops rendering generic rows for the props these controls own', () => {
      const wrapper = pane()
      for (const prop of [
        'primaryAxisAlignItems',
        'counterAxisAlignItems',
        'primaryAxisSizingMode',
        'counterAxisSizingMode',
        'paddingLeft',
        'paddingTop',
        'width',
        'height',
      ]) {
        // The dedicated controls still carry these prop names (the Hug/Fixed
        // select names the sizing prop it writes); what is gone is the row.
        expect(wrapper.find(`.editor .field[data-prop="${prop}"]`).exists(), prop).toBe(false)
      }
    })
  })

  describe('appearance rebuilt (C9)', () => {
    it('reads opacity as a percentage', () => {
      // The fixture authors opacity={0.5}.
      expect(row(pane(), 'opacity').find('.scrub').text()).toBe('50%')
    })

    it('keeps percentage values unchanged when scrolling', async () => {
      const wrapper = pane()
      await row(wrapper, 'opacity').find('.number').trigger('wheel', { deltaY: -1 })
      expect(row(wrapper, 'opacity').find('.scrub').text()).toBe('50%')
      expect(wrapper.emitted('preview')).toBeUndefined()
      expect(wrapper.emitted('commit')).toBeUndefined()
      wrapper.unmount()
    })

    it('puts the visibility eye on the section header, not in the body', async () => {
      const wrapper = pane()
      const eye = wrapper.find('.section-eye')
      expect(eye.exists()).toBe(true)
      expect(eye.find('svg').exists()).toBe(true)
      expect(row(wrapper, 'visible').exists()).toBe(false)
      await eye.trigger('click')
      expect(wrapper.emitted('commit')).toContainEqual(['Card#root', 'visible', false])
    })

    it('collapses a uniform corner radius into one box', () => {
      const corner = pane(['Card#root/swatch']).find('.corner-field')
      expect(corner.exists()).toBe(true)
      expect(corner.findAll('.corner-box')).toHaveLength(1)
    })

    it('expands to four corners plus smoothing', async () => {
      const wrapper = pane(['Card#root/swatch'])
      await wrapper.find('.corner-field .corner-expand').trigger('click')
      expect(wrapper.findAll('.corner-field .corner-box')).toHaveLength(4)
      expect(wrapper.find('.corner-smoothing').exists()).toBe(true)
    })

    it('leaves a token-bound radius as its binding row, detach and all', () => {
      // Card#root binds cornerRadius to {radius#md}. C6's guarantee is that a
      // binding is never overwritten without an explicit detach, and a
      // collapse control that wrote through it would do exactly that.
      const wrapper = pane()
      expect(wrapper.find('.corner-field').exists()).toBe(false)
      expect(row(wrapper, 'cornerRadius').find('.token-detach').exists()).toBe(true)
    })

    it('writes cornerRadius alone while only cornerRadius is authored', async () => {
      const wrapper = pane(['Card#root/swatch'])
      const box = wrapper.find('.corner-field .corner-box')
      await box.find('.scrub').trigger('dblclick')
      await box.find('input').setValue('6')
      await box.find('input').trigger('blur')
      expect(wrapper.emitted('commit')).toEqual([['Card#root/swatch', 'cornerRadius', 6]])
    })

    /**
     * #17 and #18: these two controls listened for `commit` alone, so a scrub
     * or a keystroke showed nothing until release — the number stood still and
     * the corners stayed square while every other field previewed live.
     */
    it('previews a corner scrub live, in the field and to the canvas', async () => {
      const wrapper = pane(['Card#root/swatch'])
      // The number field renders the box through its slot, so it is found from
      // the control rather than from inside the box.
      const field = wrapper.find('.corner-field').findComponent({ name: 'NumberFieldRoot' })
      field.vm.$emit('update:modelValue', 12)
      await wrapper.vm.$nextTick()
      expect(wrapper.emitted('preview')).toEqual([['Card#root/swatch', 'cornerRadius', 12]])
      expect(wrapper.emitted('commit')).toBeUndefined()
      expect(wrapper.find('.corner-field .corner-box .scrub').text()).toBe('12')
    })

    it('previews both sides of a collapsed padding box live', async () => {
      const wrapper = pane()
      // Collapsed: two number fields, the horizontal axis first.
      const fields = wrapper.find('.padding-field').findAllComponents({ name: 'NumberFieldRoot' })
      expect(fields).toHaveLength(2)
      fields[0]!.vm.$emit('update:modelValue', 20)
      await wrapper.vm.$nextTick()
      const previews = wrapper.emitted('preview')!
      expect(previews).toContainEqual(['Card#root', 'paddingLeft', 20])
      expect(previews).toContainEqual(['Card#root', 'paddingRight', 20])
      expect(wrapper.emitted('commit')).toBeUndefined()
      expect(
        wrapper.find('.padding-field .padding-box[data-axis="horizontal"] .scrub').text(),
      ).toBe('20')
      // The other axis is nobody's gesture.
      expect(wrapper.find('.padding-field .padding-box[data-axis="vertical"] .scrub').text()).toBe(
        '0',
      )
    })

    it('previews one side of an expanded padding control', async () => {
      const wrapper = pane(['Card#root/actions'])
      // Expanded: left, right, top, bottom.
      const fields = wrapper.find('.padding-field').findAllComponents({ name: 'NumberFieldRoot' })
      expect(fields).toHaveLength(4)
      fields[2]!.vm.$emit('update:modelValue', 30)
      await wrapper.vm.$nextTick()
      expect(wrapper.emitted('preview')).toEqual([['Card#root/actions', 'paddingTop', 30]])
      expect(wrapper.find('.padding-field .padding-box[data-side="top"] .scrub').text()).toBe('30')
      expect(wrapper.find('.padding-field .padding-box[data-side="bottom"] .scrub').text()).toBe(
        '9',
      )
    })
  })

  describe('unset properties (C7)', () => {
    it('marks an unset row so it reads as a default, not a decision', () => {
      const wrapper = pane()
      // `rotation` is nowhere in the fixture.
      const rotation = wrapper.find('.editor .field[data-prop="rotation"]')
      expect(rotation.exists()).toBe(true)
      expect(rotation.attributes('data-authored')).toBe('false')
    })

    it('leaves an authored row unmarked', () => {
      const opacity = pane().find('.editor .field[data-prop="opacity"]')
      expect(opacity.attributes('data-authored')).toBe('true')
    })

    it('shows the value the engine falls back to', () => {
      const wrapper = pane()
      expect(wrapper.find('.field[data-prop="rotation"] .scrub').text()).toBe('0')
    })

    it('shows a dash where unset means no limit, not zero', () => {
      // `maxWidth` unset is no constraint; printing 0 would state a limit the
      // document does not set.
      const wrapper = pane()
      expect(wrapper.find('[data-field="maxWidth"] .scrub').text()).toBe('–')
    })

    it('writes nothing until the author changes it', () => {
      const wrapper = pane()
      expect(wrapper.find('.field[data-prop="rotation"]').exists()).toBe(true)
      expect(wrapper.emitted('commit')).toBeUndefined()
    })

    it('commits a change to an unset row, which the patcher turns into an add', async () => {
      const wrapper = pane()
      const rotation = wrapper.find('.field[data-prop="rotation"]')
      await rotation.find('.scrub').trigger('dblclick')
      await rotation.find('input').setValue('30')
      await rotation.find('input').trigger('blur')
      expect(wrapper.emitted('commit')).toEqual([['Card#root', 'rotation', 30]])
    })
  })
})

/**
 * Linking a field to a component property, from the panel.
 *
 * The direction the shipped panel had no control for: `characters="{label}"`
 * could only be hand-authored, and its detach button was disabled because the
 * only detach that existed replaced a *numeric* token binding.
 */
const BOUND = parseOrThrow(`---
id: bound
---

## Visual Contract

<Page>
  <Frame name="loose">
    <Text name="stray" characters="Hello" />
  </Frame>
  <Component name="Button" status="stable" props={{
    label: { type: 'TEXT', default: 'Click' },
    showIcon: { type: 'BOOLEAN', default: true },
  }}>
    <Frame name="container" layoutMode="HORIZONTAL">
      <Text name="caption" characters="{label}" fontSize={14} />
      <Text name="plain" characters="Press" fontSize={14} />
      <Text name="ghost" characters="Boo" visible="{showIcon}" fontSize={14} />
    </Frame>
  </Component>
</Page>
`)

const boundPane = (selection: string[]) =>
  mount(PropertiesPane, { props: { doc: BOUND, selection, tokens, writable: true } })

describe('the text row reads the way Figma spells it', () => {
  it('titles the section Text rather than Typography', () => {
    expect(sectionTitles(pane(['Card#root/label']))).toContain('Text')
  })

  it('labels the characters row Content', () => {
    expect(row(pane(['Card#root/label']), 'characters').text()).toContain('Content')
  })
})

/**
 * Applying happens from the section title, Figma's placement — a row carries
 * the control only once it is *linked*, and then it is the pill's own change
 * and remove. An icon on every bindable row put a second glyph beside half the
 * inspector; one per section says the same thing once.
 */
const sectionNamed = (wrapper: ReturnType<typeof boundPane>, title: string) =>
  wrapper.findAll('.section').find((s) => s.find('.section-title').text() === title)!

describe('linking a field to a property', () => {
  it('offers to link from the section that owns the input', () => {
    const wrapper = boundPane(['Button#container/plain'])
    expect(sectionNamed(wrapper, 'Text').find('.section-link .apply-property').exists()).toBe(true)
  })

  it('keeps the rows themselves free of the control', () => {
    const wrapper = boundPane(['Button#container/plain'])
    expect(row(wrapper, 'characters').find('.apply-property').exists()).toBe(false)
    expect(row(wrapper, 'fontSize').find('.apply-property').exists()).toBe(false)
  })

  it('offers nothing on a section whose input no property can fill', () => {
    const wrapper = boundPane(['Button#container/plain'])
    expect(sectionNamed(wrapper, 'Typography').find('.section-link').exists()).toBe(false)
  })

  it('offers tokens without component properties on a layer outside a component', () => {
    const wrapper = boundPane(['loose#stray'])
    expect(sectionNamed(wrapper, 'Text').find('.section-link .apply-token').exists()).toBe(true)
    expect(sectionNamed(wrapper, 'Text').find('.apply-property').exists()).toBe(false)
  })

  it('lists only the properties whose type fills the input', async () => {
    const wrapper = boundPane(['Button#container/plain'])
    await sectionNamed(wrapper, 'Text').find('.section-link .apply-property').trigger('click')
    expect(
      wrapper
        .findAll('.assign-popup .popup-row:not(.variable-row)')
        .map((o) => o.find('.row-name').text()),
    ).toEqual(['label'])
  })

  it('binds the field when an option is chosen', async () => {
    const wrapper = boundPane(['Button#container/plain'])
    await sectionNamed(wrapper, 'Text').find('.section-link .apply-property').trigger('click')
    await wrapper.findAll('.assign-popup .popup-row')[0]!.trigger('click')
    expect(wrapper.emitted('patches')?.[0]?.[0]).toEqual([
      { op: 'set', address: 'Button#container/plain', prop: 'characters', value: '{label}' },
    ])
  })

  it('hands the control back to the row once it is linked', () => {
    const wrapper = boundPane(['Button#container/caption'])
    expect(sectionNamed(wrapper, 'Text').find('.section-link').exists()).toBe(false)
    expect(row(wrapper, 'characters').find('.unlink-property').exists()).toBe(true)
  })
})

describe('a linked field', () => {
  it('shows the property name, not the raw binding', () => {
    const text = row(boundPane(['Button#container/caption']), 'characters').text()
    expect(text).toContain('label')
    expect(text).not.toContain('{label}')
    expect(text).not.toContain('?')
  })

  it('offers changing the link through the pill, and one detach beside it', () => {
    const bound = row(boundPane(['Button#container/caption']), 'characters')
    // The pill is the trigger — Figma's one control. A second ◎ beside it
    // duplicated the same popup and read as a different control in practice.
    expect(bound.find('.property-pill[data-popup-trigger]').exists()).toBe(true)
    expect(bound.find('.apply-property').exists()).toBe(false)
    expect(bound.find('.unlink-property').exists()).toBe(true)
  })

  it('unlinks to the declared default, so the canvas does not change', async () => {
    const wrapper = boundPane(['Button#container/caption'])
    await row(wrapper, 'characters').find('.unlink-property').trigger('click')
    expect(wrapper.emitted('patches')?.[0]?.[0]).toEqual([
      { op: 'set', address: 'Button#container/caption', prop: 'characters', value: 'Click' },
    ])
  })
})

describe('declaring a property from the field that will read it', () => {
  it('offers Create alongside the existing options', async () => {
    const wrapper = boundPane(['Button#container/plain'])
    await sectionNamed(wrapper, 'Text').find('.section-link .apply-property').trigger('click')
    expect(wrapper.find('.popup-create').exists()).toBe(true)
  })

  it('opens a dialog named for the type the field takes', async () => {
    const wrapper = boundPane(['Button#container/plain'])
    await sectionNamed(wrapper, 'Text').find('.section-link .apply-property').trigger('click')
    await wrapper.find('.popup-create').trigger('click')
    expect(wrapper.find('.property-dialog').text()).toContain('Create text property')
  })

  it('seeds the default from the literal the field already holds', async () => {
    const wrapper = boundPane(['Button#container/plain'])
    await sectionNamed(wrapper, 'Text').find('.section-link .apply-property').trigger('click')
    await wrapper.find('.popup-create').trigger('click')
    expect((wrapper.find('.property-dialog .value-input').element as HTMLInputElement).value).toBe(
      'Press',
    )
  })

  it('declares and links in one envelope', async () => {
    const wrapper = boundPane(['Button#container/plain'])
    await sectionNamed(wrapper, 'Text').find('.section-link .apply-property').trigger('click')
    await wrapper.find('.popup-create').trigger('click')
    await wrapper.find('.property-dialog .name-input').setValue('caption')
    await wrapper.find('.property-dialog form').trigger('submit')
    expect(wrapper.emitted('patches')?.[0]?.[0]).toEqual([
      {
        op: 'set',
        address: 'Button',
        prop: 'props',
        value: {
          label: { type: 'TEXT', default: 'Click' },
          showIcon: { type: 'BOOLEAN', default: true },
          caption: { type: 'TEXT', default: 'Press' },
        },
      },
      { op: 'set', address: 'Button#container/plain', prop: 'characters', value: '{caption}' },
    ])
  })

  it('refuses a name the component already declared', async () => {
    const wrapper = boundPane(['Button#container/plain'])
    await sectionNamed(wrapper, 'Text').find('.section-link .apply-property').trigger('click')
    await wrapper.find('.popup-create').trigger('click')
    await wrapper.find('.property-dialog .name-input').setValue('label')
    await wrapper.find('.property-dialog form').trigger('submit')
    expect(wrapper.emitted('patches')).toBeUndefined()
    expect(wrapper.find('.property-dialog').exists()).toBe(true)
  })
})

/**
 * Rows and options read as Figma's words (the parity spec, §3).
 *
 * The file is untouched by all of this: every commit still carries the
 * authored name and the canonical option value, which is what these assert
 * alongside the label.
 */
describe('the panel speaks Figma', () => {
  it('labels a row with Figma word, not the authored name', () => {
    const wrapper = pane(['Card#root'])
    expect(row(wrapper, 'itemSpacing').text()).toContain('Gap')
    expect(row(wrapper, 'itemSpacing').text()).not.toContain('itemSpacing')
  })

  it('keeps the authored name as the hook a patch is keyed on', async () => {
    const wrapper = pane(['Card#root/label'])
    // `setValue` fires `change` itself; triggering it again would double-count.
    await row(wrapper, 'characters').find('textarea').setValue('Yo')
    expect(wrapper.emitted('commit')?.[0]?.[1]).toBe('characters')
  })

  it('renders enum options as their labels', () => {
    const wrapper = pane(['Card#root'])
    const text = row(wrapper, 'blendMode').text()
    expect(text).toContain('Color burn')
    expect(text).not.toContain('COLOR_BURN')
  })

  it('commits the canonical value the label stands for', async () => {
    const wrapper = pane(['Card#root'])
    const select = row(wrapper, 'blendMode').find('select')
    await select.setValue('COLOR_BURN')
    expect(wrapper.emitted('commit')?.[0]?.[2]).toBe('COLOR_BURN')
  })
})

/**
 * The instance-swap row (the parity spec, §2).
 *
 * The third corner of the type↔input↔section triangle, and the one F12 left
 * without a UI: an INSTANCE_SWAP property fills `component`, and Figma puts
 * that control at the top of the panel.
 */
const SWAP = parseOrThrow(`---
id: swap
---

## Visual Contract

<Page>
  <Component name="Icon" status="stable">
    <Frame name="box" width={16} height={16} />
  </Component>
  <Component name="Card" status="stable" props={{
    glyph: { type: 'INSTANCE_SWAP', default: 'Icon' },
    label: { type: 'TEXT', default: 'Hi' },
  }}>
    <Frame name="body" layoutMode="VERTICAL">
      <Instance name="free" component="Icon" />
      <Instance name="bound" component="{glyph}" />
    </Frame>
  </Component>
</Page>
`)

const swapPane = (selection: string[]) =>
  mount(PropertiesPane, { props: { doc: SWAP, selection, tokens, writable: true } })

describe('an instance swaps by property', () => {
  it('shows the component row at the top of the panel', () => {
    const wrapper = swapPane(['Card#body/free'])
    expect(wrapper.find('.instance-swap-row').exists()).toBe(true)
  })

  it('offers only the INSTANCE_SWAP declarations', async () => {
    const wrapper = swapPane(['Card#body/free'])
    await wrapper.find('.instance-swap-row .apply-property').trigger('click')
    expect(
      wrapper.findAll('.assign-popup .popup-row').map((o) => o.find('.row-name').text()),
    ).toEqual(['glyph'])
  })

  it('links the component attribute when one is chosen', async () => {
    const wrapper = swapPane(['Card#body/free'])
    await wrapper.find('.instance-swap-row .apply-property').trigger('click')
    await wrapper.findAll('.assign-popup .popup-row')[0]!.trigger('click')
    expect(wrapper.emitted('patches')?.[0]?.[0]).toEqual([
      { op: 'set', address: 'Card#body/free', prop: 'component', value: '{glyph}' },
    ])
  })

  it('shows a linked instance as the pill, not the raw binding', () => {
    const text = swapPane(['Card#body/bound']).find('.instance-swap-row').text()
    expect(text).toContain('glyph')
    expect(text).not.toContain('{glyph}')
  })

  it('unlinks to the declared default component', async () => {
    const wrapper = swapPane(['Card#body/bound'])
    await wrapper.find('.instance-swap-row .unlink-property').trigger('click')
    expect(wrapper.emitted('patches')?.[0]?.[0]).toEqual([
      { op: 'set', address: 'Card#body/bound', prop: 'component', value: 'Icon' },
    ])
  })

  it('offers nothing on a layer that is not an instance', () => {
    expect(swapPane(['Card#body']).find('.instance-swap-row').exists()).toBe(false)
  })
})

/**
 * The boolean flow lives on the Appearance header (parity spec §2), because
 * that is where the node's visibility lives — C9 moved it to the header eye
 * and suppressed the redundant row, which left F12's boolean apply with no
 * home the UI could actually reach. The user-facing symptom: "there is no
 * option other than text".
 */
describe('visibility links from the Appearance header', () => {
  const headerOf = (wrapper: ReturnType<typeof boundPane>) =>
    wrapper.findAll('.section').find((s) => s.find('.section-title').text() === 'Appearance')!

  it('carries the apply control beside the eye', () => {
    const header = headerOf(boundPane(['Button#container/plain']))
    expect(header.find('.section-eye').exists()).toBe(true)
    expect(header.find('.section-link .apply-property').exists()).toBe(true)
  })

  it('offers only the BOOLEAN declarations', async () => {
    const wrapper = boundPane(['Button#container/plain'])
    await headerOf(wrapper).find('.section-link .apply-property').trigger('click')
    expect(
      wrapper
        .findAll('.assign-popup .popup-row:not(.variable-row)')
        .map((o) => o.find('.row-name').text()),
    ).toEqual(['showIcon'])
  })

  it('links visibility when one is chosen', async () => {
    const wrapper = boundPane(['Button#container/plain'])
    await headerOf(wrapper).find('.section-link .apply-property').trigger('click')
    await wrapper.findAll('.assign-popup .popup-row')[0]!.trigger('click')
    expect(wrapper.emitted('patches')?.[0]?.[0]).toEqual([
      { op: 'add', address: 'Button#container/plain', prop: 'visible', value: '{showIcon}' },
    ])
  })

  /**
   * Once bound, the pill is a row in the section body, not a chip in the
   * header: a header is a fixed-width line beside a title and a chevron, and a
   * property name of any length overflows it. Figma shows the pill in the
   * section for the same reason, and switching happens by clicking it there.
   */
  it('moves to a Visible row once bound, leaving the header clean', () => {
    const wrapper = boundPane(['Button#container/ghost'])
    expect(headerOf(wrapper).find('.section-link').exists()).toBe(false)
    expect(row(wrapper, 'visible').find('.property-pill').text()).toContain('showIcon')
  })

  it('has no Visible row while visibility is just a value — the eye is enough', () => {
    const wrapper = boundPane(['Button#container/plain'])
    expect(row(wrapper, 'visible').exists()).toBe(false)
    expect(headerOf(wrapper).find('.section-link').exists()).toBe(true)
  })

  it('stills the eye while a property drives visibility', () => {
    const header = headerOf(boundPane(['Button#container/ghost']))
    expect(header.find('.section-eye').attributes('disabled')).toBeDefined()
  })

  it('unlinks to the declared default', async () => {
    const wrapper = boundPane(['Button#container/ghost'])
    await row(wrapper, 'visible').find('.unlink-property').trigger('click')
    expect(wrapper.emitted('patches')?.[0]?.[0]).toEqual([
      { op: 'set', address: 'Button#container/ghost', prop: 'visible', value: true },
    ])
  })

  it('offers tokens without component properties outside a component', () => {
    const wrapper = boundPane(['loose#stray'])
    expect(headerOf(wrapper).find('.section-link .apply-token').exists()).toBe(true)
    expect(headerOf(wrapper).find('.apply-property').exists()).toBe(false)
  })
})

/**
 * Placement rule, spec §3: one open popup at a time. Every trigger carries
 * `data-popup-trigger` (Task 7's own additions to the pill and apply button),
 * which is also what `AssignPopup`'s outside-pointerdown guard checks — so a
 * naive guard would treat a *different* field's trigger as "this popup's own"
 * and refuse to close, leaving two popups open. `Button#container/plain`
 * offers two independent triggers at once (Text's section-link and
 * Appearance's), which is what this exercises.
 */
describe('only one popup open at a time', () => {
  it('closes a popup when a different trigger opens its own', async () => {
    // `attachTo` is required here: the outside-pointerdown guard listens on
    // `document`, and a capturing document listener only sees events from
    // elements actually attached to the document — an unattached VTU mount
    // never reaches it, the way it does for jsdom's `activeElement` tracking
    // (see layers-pane.test.ts's rename-focus tests for the same need).
    const wrapper = mount(PropertiesPane, {
      props: { doc: BOUND, selection: ['Button#container/plain'], tokens, writable: true },
      attachTo: document.body,
    })
    const textTrigger = sectionNamed(wrapper, 'Text').find('.section-link .apply-property')
    await textTrigger.trigger('click')
    expect(wrapper.findAll('.assign-popup')).toHaveLength(1)

    // A real click is pointerdown then click — the pointerdown is what the
    // open popup's outside-click guard sees; the click is what opens the
    // second popup through its own, separate `picking` toggle.
    const appearanceTrigger = sectionNamed(wrapper, 'Appearance').find(
      '.section-link .apply-property',
    )
    await appearanceTrigger.trigger('pointerdown')
    await appearanceTrigger.trigger('click')

    // Exactly one popup survives — the first must have closed, not stacked.
    expect(wrapper.findAll('.assign-popup')).toHaveLength(1)
    expect(sectionNamed(wrapper, 'Text').find('.assign-popup').exists()).toBe(false)
    expect(sectionNamed(wrapper, 'Appearance').find('.assign-popup').exists()).toBe(true)
    wrapper.unmount()
  })
})

/**
 * The link controls have to sit *on* the row, not below it.
 *
 * `.field` is a two-column grid (label | value). The apply button was a third
 * child, so it wrapped onto a second grid line under the label — the row read
 * as broken. Both states now hand the row exactly one extra child, which the
 * third column holds: unbound it is the controls, bound it is pill + controls.
 */
describe('a bindable row keeps its shape', () => {
  const children = (wrapper: ReturnType<typeof boundPane>, prop: string) =>
    [...row(wrapper, prop).element.children].map((c) => (c as HTMLElement).className)

  it('leaves an unlinked row at label and value — the title owns applying', () => {
    expect(children(boundPane(['Button#container/plain']), 'characters')).toHaveLength(2)
  })

  it('puts the pill in the value column and the controls beside it', () => {
    const kids = children(boundPane(['Button#container/caption']), 'characters')
    expect(kids).toHaveLength(3)
    expect(kids[1]).toContain('property-pill')
    expect(kids[2]).toContain('link-controls')
  })

  it('keeps an unbindable paired number in its own stable cell', () => {
    expect(
      row(boundPane(['Button#container/plain']), 'fontSize').findAll('.value.number'),
    ).toHaveLength(1)
  })
})

/**
 * A linked row goes full width, the way Figma's pill does.
 *
 * Squeezed into the value column beside a label, a property name of any length
 * truncates — "showIcon" rendered as "showTa…". Figma gives the pill the whole
 * row and lets the glyph say which input it fills, which is what the label was
 * there for.
 */
describe('a linked row is full width', () => {
  it('marks the row so it can drop its label and span', () => {
    const wrapper = boundPane(['Button#container/caption'])
    expect(row(wrapper, 'characters').attributes('data-linked')).toBe('true')
  })

  it('leaves an unlinked row alone', () => {
    const wrapper = boundPane(['Button#container/plain'])
    expect(row(wrapper, 'characters').attributes('data-linked')).toBeUndefined()
  })

  it('does not claim a token binding — that row keeps its resolved value', () => {
    expect(row(pane(['Card#root']), 'cornerRadius').attributes('data-linked')).toBeUndefined()
  })

  it('gives the instance-swap row the same treatment once it is linked', () => {
    const linked = swapPane(['Card#body/bound']).find('.instance-swap-row')
    expect(linked.attributes('data-linked')).toBe('true')
    expect(
      swapPane(['Card#body/free']).find('.instance-swap-row').attributes('data-linked'),
    ).toBeUndefined()
  })
})

/**
 * The ◎ edit-property button on a linked row (parity spec, Figma's second
 * trailing control): a bound field opens the existing PropertyDialog in edit
 * mode, seeded from the declaration the pill points at.
 */
const LINKED = parseOrThrow(`---
id: linked
---

## Visual Contract

<Page>
  <Component name="Chip" status="draft" props={{ Label: { type: 'TEXT', default: 'Hi' } }}>
    <Frame name="root" width={10} height={10}>
      <Text name="label" characters="{Label}" fontSize={12} />
    </Frame>
  </Component>
</Page>
`)

const EYED = parseOrThrow(`---
id: eyed
---

## Visual Contract

<Page>
  <Component name="Card" status="draft">
    <Frame name="root" width={10} height={10} visible="{flags#on}" />
  </Component>
</Page>
`)

it('a variable-driven visibility stills the eye and keeps a pill row', () => {
  const wrapper = mount(PropertiesPane, {
    props: { doc: EYED, selection: ['Card#root'], tokens, writable: true },
  })
  expect(wrapper.find('.section-eye').attributes('disabled')).toBeDefined()
  // The row renders (Task 10 styles it as the token pill; here it just exists).
  expect(row(wrapper, 'visible').exists()).toBe(true)
})

it('edits the bound property from the popup row, the way Figma places it', async () => {
  const wrapper = mount(PropertiesPane, {
    props: { doc: LINKED, selection: ['Chip#root/label'], tokens, writable: true },
  })
  // The pill opens the picker; each property row carries its own ⚙.
  await wrapper.find('[data-prop="characters"] .property-pill').trigger('click')
  await wrapper.find('.assign-popup .row-edit').trigger('click')
  const dialog = wrapper.find('form')
  expect(dialog.exists()).toBe(true)
  const name = wrapper.find('#prop-name')
  expect((name.element as HTMLInputElement).value).toBe('Label')
  await name.setValue('Caption')
  await dialog.trigger('submit')
  const patches = wrapper.emitted('patches')!.at(-1)![0] as UidxPatch[]
  // `editProperty` emits only `set` ops here (the component already authors
  // `props`); narrowing to that arm is what gives `.prop`/`.value` back after
  // `UidxPatch`'s structural variants dropped them.
  const sets = patches.filter((p): p is Extract<UidxPatch, { op: 'set' }> => p.op === 'set')
  // One envelope: the renamed declaration plus the re-pointed binding site.
  expect(sets.some((p) => p.prop === 'props')).toBe(true)
  expect(sets.some((p) => p.prop === 'characters' && p.value === '{Caption}')).toBe(true)
})

/**
 * Task 11: a fill whose color is a token shows the resolved swatch and the
 * variable name; detach writes the literal back. `DOC` above keeps its
 * literal fill, so this gets its own tiny document.
 */
const ALIASED_FILL = parseOrThrow(`---
id: aliased
---

## Visual Contract

<Page>
  <Component name="Card" status="draft">
    <Frame name="root" width={10} height={10}
      fills={[{ type: 'SOLID', color: "{palette#blue}" }]} />
  </Component>
</Page>
`)

it('shows a token fill as swatch + variable name, and detaches to the literal', async () => {
  const blue = { r: 0.1, g: 0.4, b: 0.9, a: 1 }
  const wrapper = mount(PropertiesPane, {
    props: {
      doc: ALIASED_FILL,
      selection: ['Card#root'],
      tokens: new Map<string, JsonValue>([['palette#blue', blue]]),
      writable: true,
    },
  })
  const tokenRow = wrapper.find('.paint-token')
  expect(tokenRow.text()).toBe('blue')
  expect(tokenRow.attributes('title')).toBe('palette#blue')
  await wrapper.find('.paint-detach').trigger('click')
  // Task 13 (Fix 1): structural, not a scene commit. The node's authored
  // fills still carry the alias, and the scene would see no change at all —
  // its resolved colour already equals the literal a detach commits, so a
  // scene-routed commit would produce no patch whatsoever.
  expect(wrapper.emitted('commit')).toBeUndefined()
  const patches = wrapper.emitted('patches')!.at(-1)![0] as UidxPatch[]
  const [patch] = patches
  expect(patch).toMatchObject({ op: 'set', address: 'Card#root', prop: 'fills' })
  const value = (patch as Extract<UidxPatch, { op: 'set' }>).value
  expect((value as { color: unknown }[])[0]!.color).toEqual(blue)
})

/**
 * Task 12: the color picker's Libraries tab lists COLOR variables grouped by
 * collection, alongside the Custom tab this dialog already had.
 */
it('binds a fill to a color variable from the Libraries tab', async () => {
  const blue = { r: 0.1, g: 0.4, b: 0.9, a: 1 }
  const wrapper = mount(PropertiesPane, {
    props: {
      doc: DOC, // the literal red fill
      selection: ['Card#root'],
      tokens: new Map<string, JsonValue>([['palette#blue', blue]]),
      writable: true,
    },
  })
  await wrapper.find('.paint-swatch').trigger('click')
  await wrapper.find('.picker-tab-libraries').trigger('click')
  await wrapper.find('[data-variable="palette#blue"]').trigger('click')
  // Task 13 (Fix 1): structural, not a scene commit. The scene would resolve
  // `{palette#blue}` to its literal before a patch could be derived from it.
  expect(wrapper.emitted('commit')).toBeUndefined()
  const patches = wrapper.emitted('patches')!.at(-1)![0] as UidxPatch[]
  expect(patches).toEqual([
    {
      op: 'set',
      address: 'Card#root',
      prop: 'fills',
      value: [{ type: 'SOLID', color: '{palette#blue}' }],
    },
  ])
})

/**
 * Task 13 (Fix 1): a sibling paint's opacity must not lose another paint's
 * alias binding. Both live in one `fills` array — the paint algebra always
 * commits the whole value — so the write has to route structurally the
 * moment *either* paint in play carries an alias, or the untouched sibling's
 * binding would be resolved away by the scene along with it.
 */
const ALIAS_SIBLING_FILL = parseOrThrow(`---
id: alias-sibling
---

## Visual Contract

<Page>
  <Component name="Card" status="draft">
    <Frame name="root" width={10} height={10}
      fills={[{ type: 'SOLID', color: "{palette#blue}" },
        { type: 'SOLID', color: { r: 0, g: 0, b: 0, a: 1 }, opacity: 0.5 }]} />
  </Component>
</Page>
`)

it('routes an opacity edit through patches when a sibling paint is alias-bound', async () => {
  const blue = { r: 0.1, g: 0.4, b: 0.9, a: 1 }
  const wrapper = mount(PropertiesPane, {
    props: {
      doc: ALIAS_SIBLING_FILL,
      selection: ['Card#root'],
      tokens: new Map<string, JsonValue>([['palette#blue', blue]]),
      writable: true,
    },
  })
  // Only the second (literal) paint renders an opacity input — the first,
  // alias-bound one shows a token pill and a detach button instead.
  await wrapper.find('.paint-opacity').setValue('80')
  expect(wrapper.emitted('commit')).toBeUndefined()
  const patches = wrapper.emitted('patches')!.at(-1)![0] as UidxPatch[]
  const [patch] = patches
  expect(patch).toMatchObject({ op: 'set', address: 'Card#root', prop: 'fills' })
  const value = (patch as Extract<UidxPatch, { op: 'set' }>).value as {
    color: unknown
    opacity?: number
  }[]
  expect(value[0]!.color).toBe('{palette#blue}')
  expect(value[1]!.opacity).toBe(0.8)
})

/**
 * Task 13 (Fix 1): the counterpoint. Nothing in play — neither the value just
 * committed nor the node's authored fills — carries an alias, so the scene
 * route is exactly right and untouched.
 */
it('keeps a literal-only fill edit on the scene route', async () => {
  const wrapper = pane()
  await row(wrapper, 'fills').find('.paint-hex').setValue('#0000ff')
  expect(wrapper.emitted('commit')).toEqual([
    ['Card#root', 'fills', [{ type: 'SOLID', color: { r: 0, g: 0, b: 1, a: 1 } }]],
  ])
  expect(wrapper.emitted('patches')).toBeUndefined()
})

/**
 * Finding 2: the token pill's detach used to be a one-way door for anything
 * but a number — `resolvedValue` is number-typed, so a STRING-bound Content
 * pill could never detach. The literal now comes straight off the `tokens`
 * map keyed by `boundTo`, which has an answer for any JSON value.
 */
const TEXT_BOUND = parseOrThrow(`---
id: text-bound
---

## Visual Contract

<Page>
  <Component name="Card" status="draft">
    <Frame name="root" width={10} height={10}>
      <Text name="label" characters="{strings#label}" />
    </Frame>
  </Component>
</Page>
`)

it('detaches a token-bound Content pill to its resolved string literal', async () => {
  const wrapper = mount(PropertiesPane, {
    props: { doc: TEXT_BOUND, selection: ['Card#root/label'], tokens, writable: true },
  })
  const bound = row(wrapper, 'characters')
  const pill = bound.find('.token-pill')
  expect(pill.exists()).toBe(true)
  expect(pill.text()).toBe('label')
  const detach = bound.find('.token-detach')
  expect(detach.attributes('disabled')).toBeUndefined()
  await detach.trigger('click')
  expect(wrapper.emitted('commit')).toBeUndefined()
  const patches = wrapper.emitted('patches')!.at(-1)![0] as UidxPatch[]
  expect(patches).toEqual([
    { op: 'set', address: 'Card#root/label', prop: 'characters', value: 'Hello' },
  ])
})

describe('the slot actions the panel owns (story F5)', () => {
  const SLOTTED = parseOrThrow(`---
id: slotted
---

## Visual Contract

<Page>
  <Component name="Holder" status="draft">
    <Frame name="root" layoutMode="VERTICAL">
      <Frame name="inner" layoutMode="VERTICAL" />
      <Text name="label" characters="hi" />
    </Frame>
  </Component>
  <Instance name="use" component="Holder">
    <Slot name="body"><Text name="t" characters="x" /></Slot>
  </Instance>
</Page>
`)
  const slotPane = (selection: string[], writable = true) =>
    mount(PropertiesPane, { props: { doc: SLOTTED, selection, tokens, writable } })

  const convertButton = (w: ReturnType<typeof slotPane>) => w.find('.node-actions button')

  it('offers Convert to slot on a frame, in the panel rather than the toolbar', () => {
    const w = slotPane(['Holder#root/inner'])
    expect(convertButton(w).exists()).toBe(true)
    expect(convertButton(w).text()).toBe('Convert to slot')
  })

  it('does not offer it on a node no slot could stand in for', () => {
    // `characters` is TEXT_ONLY, so a converted Text would be a document that
    // validates and means nothing.
    expect(convertButton(slotPane(['Holder#root/label'])).exists()).toBe(false)
  })

  it('emits one retag, and nothing else', async () => {
    const w = slotPane(['Holder#root/inner'])
    await convertButton(w).trigger('click')
    expect(w.emitted('patches')).toEqual([
      [[{ op: 'retag', address: 'Holder#root/inner', element: 'Slot' }]],
    ])
  })

  it('disables it while the socket is down', () => {
    expect(
      convertButton(slotPane(['Holder#root/inner'], false)).attributes('disabled'),
    ).toBeDefined()
  })

  it('offers a fill its two states instead', () => {
    const w = slotPane(['use#body'])
    expect(convertButton(w).exists()).toBe(false)
    expect(w.findAll('.fill-buttons button').map((b) => b.text())).toEqual([
      'Reset slot',
      'Delete contents',
    ])
  })
})

/**
 * Pins in the panel (H2, ADR 0011).
 *
 * Its own fixture rather than the shared `DOC`: other tests count sections and
 * rows in that document, and a pinned node would change what they see.
 */
const PINNED = parseOrThrow(`---
id: pinned
---

## Visual Contract

<Page>
  <Component name="Card">
    <Frame name="body" width={320} height={200}>
      <Rectangle name="a" width={40} height={20} right={16}
        constraints={{ horizontal: 'MAX', vertical: 'MAX' }} />
    </Frame>
  </Component>
</Page>
`)

/** One pinned node, with what the canvas would have measured for it. */
function pinPane(over: Record<string, unknown> = {}) {
  return mount(PropertiesPane, {
    props: {
      doc: PINNED,
      selection: ['Card#body/a'],
      writable: true,
      // What the canvas would have measured: 320 − 16 − 40 = 264 across, and
      // 200 − 0 − 20 = 180 down, since `bottom` is unset and so zero.
      pinFrame: {
        box: { x: 264, y: 180, width: 40, height: 20 },
        parent: { width: 320, height: 200 },
      },
      ...over,
    },
  })
}

/**
 * A number row is a scrub, not a text input — the same gesture the opacity
 * test drives, and the only way to change one of these from the outside.
 */
async function scrubBy(
  wrapper: ReturnType<typeof pinPane>,
  prop: string,
  pixels: number,
): Promise<void> {
  const target = wrapper.find(`[data-field="${prop}"] .scrub`).element as HTMLElement
  // jsdom tracks no live pointers, so capture would throw on a made-up id.
  Object.assign(target, {
    setPointerCapture: () => {},
    hasPointerCapture: () => false,
    releasePointerCapture: () => {},
  })
  const drag = async (type: string, clientX: number): Promise<void> => {
    const event = new MouseEvent(type, { clientX, bubbles: true, cancelable: true })
    Object.defineProperty(event, 'pointerId', { value: 1 })
    target.dispatchEvent(event)
    await wrapper.vm.$nextTick()
  }
  await drag('pointerdown', 100)
  await drag('pointermove', 100 + pixels)
  await drag('pointerup', 100 + pixels)
}

describe('pins (H2)', () => {
  const wrapper1 = () => pinPane()

  it('shows an authored offset as an editable number, not as an unmapped row', () => {
    // `right` is absent from PROP_TABLE by design (ADR 0011 §2), and `isMapped`
    // read that absence as "no edit to it can be written" — so the row rendered
    // read-only with a reason that is true of an unknown prop and false of this
    // one.
    const field = row(pinPane(), 'x').find('[data-field="right"]')
    expect(field.exists()).toBe(true)
    expect(field.find('.scrub').exists()).toBe(true)
    expect(field.text()).toContain('16')
  })

  it('commits an offset as a patch, never through the scene', async () => {
    // The scene graph has no `right` field, so a scene-routed commit is a write
    // that vanishes without saying so. Same rule as an alias-carrying paint.
    const wrapper = pinPane()
    await scrubBy(wrapper, 'right', 24)
    expect(wrapper.emitted('commit')).toBeUndefined()
    expect(wrapper.emitted('patches')?.[0]?.[0]).toEqual([
      { op: 'set', address: 'Card#body/a', prop: 'right', value: 40 },
    ])
  })

  it('adds an offset the file never stated', async () => {
    // C7 shows every applicable prop unset, so the row is there to scrub before
    // the file has mentioned it — and the write is an `add`.
    const wrapper = pinPane()
    await scrubBy(wrapper, 'bottom', 12)
    expect(wrapper.emitted('patches')?.[0]?.[0]).toEqual([
      { op: 'add', address: 'Card#body/a', prop: 'bottom', value: 12 },
    ])
  })

  it('shows an unset offset as 0, which is what the resolver already assumes', () => {
    // Not "—": a MAX-pinned child stating no `bottom` sits flush against the
    // far edge, so zero is the value rather than the absence of one.
    expect(row(pinPane(), 'y').find('[data-field="bottom"] .scrub').text()).toBe('0')
  })

  it('keeps every edge in its place — a loose one dashes, it does not vanish', () => {
    // Two revisions of this behaviour. First an editable X sat beside Right —
    // one position, two numbers. Then the loose edge vanished entirely, and
    // the rows re-flowed with every pin change. Now the grid is fixed: L|R on
    // one line, T|B on the next, and an edge the pin does not hold renders as
    // a disabled dash where it always is.
    const wrapper = wrapper1()
    const horizontal = row(wrapper, 'x')
    expect(horizontal.find('[data-field="x"] .scrub').text()).toBe('–')
    expect(horizontal.find('[data-field="right"] .scrub').text()).toBe('16')
    expect(horizontal.attributes('title')).toMatch(/loose/)
    const vertical = row(wrapper, 'y')
    expect(vertical.find('[data-field="y"] .scrub').text()).toBe('–')
    expect(vertical.find('[data-field="bottom"] .scrub').exists()).toBe(true)
  })

  it('labels the near edges Left and Top for a child of a box', () => {
    // `x` IS the left offset in this format (ADR 0011), so inside a parent box
    // the row says so. The prop and the patch key stay `x` — labels are the
    // display layer's job.
    const wrapper = pinPane({
      doc: parseOrThrow(
        [
          '---',
          'id: plain',
          '---',
          '',
          '## Visual Contract',
          '',
          '<Page>',
          '  <Component name="Card">',
          '    <Frame name="body" width={320} height={200}>',
          '      <Rectangle name="a" width={40} height={20} x={16} y={8} />',
          '    </Frame>',
          '  </Component>',
          '</Page>',
          '',
        ].join('\n'),
      ),
    })
    // Each axis is one line, and each half is named above its input — no
    // letters inside the boxes.
    expect(row(wrapper, 'x').find('.pair-captions').text()).toBe('LeftRight')
    expect(row(wrapper, 'y').find('.pair-captions').text()).toBe('TopBottom')
    expect(row(wrapper, 'x').find('[data-field="x"] .prefix').exists()).toBe(false)
  })

  it('speaks the same language at page level, minus the widget', () => {
    // Left/Top name a distance from the containing block, and a page is one —
    // CSS's own model, and the review's call: one language, no X/Y anywhere.
    // But no pin widget: a pin is illegal here (UIDX135), so offering one
    // would be an affordance for a file the server then refuses.
    const wrapper = pinPane({
      doc: parseOrThrow(
        [
          '---',
          'id: entity',
          '---',
          '',
          '## Visual Contract',
          '',
          '<Page>',
          '  <Component name="Card" x={40} y={12}>',
          '    <Frame name="body" width={320} height={200} />',
          '  </Component>',
          '</Page>',
          '',
        ].join('\n'),
      ),
      selection: ['Card'],
      pinFrame: null,
    })
    // No far edge exists at page level, so the near row stands alone with its
    // full caption rather than the compact pair.
    expect(row(wrapper, 'x').find('.field-caption').text()).toBe('Left')
    expect(wrapper.find('[aria-label="pin right"]').exists()).toBe(false)
  })

  it('shows Left and Right together under STRETCH', () => {
    const wrapper = pinPane({
      doc: parseOrThrow(
        [
          '---',
          'id: stretched-rows',
          '---',
          '',
          '## Visual Contract',
          '',
          '<Page>',
          '  <Component name="Card">',
          '    <Frame name="body" width={320} height={200}>',
          `      <Rectangle name="a" height={20} x={16} right={16} y={8}`,
          `        constraints={{ horizontal: 'STRETCH', vertical: 'MIN' }} />`,
          '    </Frame>',
          '  </Component>',
          '</Page>',
          '',
        ].join('\n'),
      ),
      pinFrame: {
        box: { x: 16, y: 8, width: 288, height: 20 },
        parent: { width: 320, height: 200 },
      },
    })
    expect(row(wrapper, 'x').find('.pair-captions').text()).toBe('LeftRight')
    expect(row(wrapper, 'x').find('[data-field="right"] .scrub').exists()).toBe(true)
  })

  it('still scrubs the near edge on an unpinned node through the scene route', async () => {
    const wrapper = pane(['Card#root'])
    await scrubBy(wrapper as unknown as ReturnType<typeof pinPane>, 'x', 14)
    expect(wrapper.emitted('commit')).toEqual([['Card#root', 'x', 24]])
  })

  /** Unpinned to start: x={264} is the author's, and a pin has to preserve it. */
  const UNPINNED_SRC = [
    '---',
    'id: unpinned',
    '---',
    '',
    '## Visual Contract',
    '',
    '<Page>',
    '  <Component name="Card">',
    '    <Frame name="body" width={320} height={200}>',
    '      <Rectangle name="a" width={40} height={20} x={264} y={16} />',
    '    </Frame>',
    '  </Component>',
    '</Page>',
    '',
  ].join('\n')

  const unpinnedPane = () =>
    pinPane({
      doc: parseOrThrow(UNPINNED_SRC),
      pinFrame: {
        box: { x: 264, y: 16, width: 40, height: 20 },
        parent: { width: 320, height: 200 },
      },
    })

  it('moves the pin to the edge you click, rather than adding to it', async () => {
    // The first cut toggled, so clicking the far edge while the near one was
    // lit produced STRETCH — "pin me to the bottom instead" became "stretch
    // me", by one click and silently. Figma's own rule is that a plain click
    // is one constraint and Shift adds a second.
    const wrapper = unpinnedPane()
    await wrapper.find('[aria-label="pin right"]').trigger('click')
    const patches = wrapper.emitted('patches')?.[0]?.[0] as UidxPatch[]
    expect(patches).toContainEqual({
      op: 'add',
      address: 'Card#body/a',
      prop: 'constraints',
      value: { horizontal: 'MAX', vertical: 'MIN' },
    })
    // 320 − 264 − 40 = 16, and the width it does not touch stays stated.
    expect(patches).toContainEqual({ op: 'add', address: 'Card#body/a', prop: 'right', value: 16 })
    expect(patches).toContainEqual({ op: 'remove', address: 'Card#body/a', prop: 'x' })
    expect(patches.some((p) => 'prop' in p && p.prop === 'width')).toBe(false)
  })

  it('holds both edges on a shift-click, which is the stretch', async () => {
    const wrapper = unpinnedPane()
    await wrapper.find('[aria-label="pin right"]').trigger('click', { shiftKey: true })
    const patches = wrapper.emitted('patches')?.[0]?.[0] as UidxPatch[]
    expect(patches).toContainEqual({
      op: 'add',
      address: 'Card#body/a',
      prop: 'constraints',
      value: { horizontal: 'STRETCH', vertical: 'MIN' },
    })
    // A stretched child's width is the pin's answer now, so the file stops
    // stating it — and both edges are written from where the node actually is.
    expect(patches).toContainEqual({ op: 'set', address: 'Card#body/a', prop: 'x', value: 264 })
    expect(patches).toContainEqual({ op: 'add', address: 'Card#body/a', prop: 'right', value: 16 })
    expect(patches).toContainEqual({ op: 'remove', address: 'Card#body/a', prop: 'width' })
  })

  it('takes out the coordinate the new pin makes derived', async () => {
    // Shift-clicking the lit top edge turns it off, leaving neither vertical
    // edge, which is CENTER — and a centred child's `y` is the resolver's
    // answer now, so the file must stop stating it or hold two answers that
    // disagree (UIDX134).
    const wrapper = unpinnedPane()
    await wrapper.find('[aria-label="pin top"]').trigger('click', { shiftKey: true })
    const patches = wrapper.emitted('patches')?.[0]?.[0] as UidxPatch[]
    expect(patches).toContainEqual({
      op: 'add',
      address: 'Card#body/a',
      prop: 'constraints',
      value: { horizontal: 'MIN', vertical: 'CENTER' },
    })
    // The box's vertical centre is 26 against a parent centre of 100, so −74.
    expect(patches).toContainEqual({
      op: 'add',
      address: 'Card#body/a',
      prop: 'centerY',
      value: -74,
    })
    expect(patches).toContainEqual({ op: 'remove', address: 'Card#body/a', prop: 'y' })
  })

  it('centres both axes from the centre dot', async () => {
    const wrapper = unpinnedPane()
    await wrapper.find('[aria-label="pin centre"]').trigger('click')
    const patches = wrapper.emitted('patches')?.[0]?.[0] as UidxPatch[]
    expect(patches).toContainEqual({
      op: 'add',
      address: 'Card#body/a',
      prop: 'constraints',
      value: { horizontal: 'CENTER', vertical: 'CENTER' },
    })
    // The box's centre is 284 against a parent centre of 160, so +124.
    expect(patches).toContainEqual({
      op: 'add',
      address: 'Card#body/a',
      prop: 'centerX',
      value: 124,
    })
  })

  it('emits an envelope every intermediate state of which is a legal document', () => {
    // Found live: clicking the bottom edge on a node with an authored height
    // was refused outright — "height is computed under a STRETCH pin". The
    // envelope was right as a whole and wrong op by op, and the server
    // re-parses between ops, so each step has to stand on its own.
    //
    // No ordering saves a naive envelope: writing the constraint first leaves
    // the old answer beside it, and writing the new offset first states one
    // the old constraint forbids. The removals have to go first, then the
    // question, then its answers.
    const wrapper = unpinnedPane()
    wrapper.find('[aria-label="pin bottom"]').trigger('click')
    const patches = wrapper.emitted('patches')?.[0]?.[0] as UidxPatch[]
    expect(() => applyPatches(UNPINNED_SRC, patches)).not.toThrow()
  })

  it('shows the resolved size on a stretched axis, not the unset default', () => {
    // The same defect X had, one section down: under STRETCH the width is the
    // resolver's answer and the file states none, so the Layout row would show
    // whatever the engine defaults to and call it a size.
    const wrapper = pinPane({
      doc: parseOrThrow(
        [
          '---',
          'id: stretched',
          '---',
          '',
          '## Visual Contract',
          '',
          '<Page>',
          '  <Component name="Card">',
          '    <Frame name="body" width={320} height={200}>',
          `      <Rectangle name="a" height={20} x={16} right={16} y={8}`,
          `        constraints={{ horizontal: 'STRETCH', vertical: 'MIN' }} />`,
          '    </Frame>',
          '  </Component>',
          '</Page>',
          '',
        ].join('\n'),
      ),
      pinFrame: {
        box: { x: 16, y: 8, width: 288, height: 20 },
        parent: { width: 320, height: 200 },
      },
    })
    expect(wrapper.find('.size-field[data-dimension="width"] .scrub').text()).toBe('288')
    // The unstretched axis still reads what the file states.
    expect(wrapper.find('.size-field[data-dimension="height"] .scrub').text()).toBe('20')
  })

  it('gives a plain frame the sizing menu, holding the one mode true of it', () => {
    // `body` has no auto layout, so Hug is a mode the engine would ignore —
    // absent from the menu, not the menu from the box (review, 2026-08-30).
    const wrapper = pinPane({ selection: ['Card#body'] })
    const width = wrapper.find('.size-field[data-dimension="width"]')
    expect(width.find('.size-mode').exists()).toBe(true)
    expect(width.findAll('.size-mode option').map((o) => o.text())).toEqual(['Fixed'])
  })

  it('answers at first paint, before the canvas has measured anything', () => {
    // The measure arrives only after the canvas's first settled render or
    // preview frame — so a stretched size showed a dash until the first drag
    // (review, 2026-08-30). The document itself can answer whenever the
    // parent's size is authored: the same resolvedBox the build runs.
    const wrapper = pinPane({
      doc: parseOrThrow(
        [
          '---',
          'id: first-paint',
          '---',
          '',
          '## Visual Contract',
          '',
          '<Page>',
          '  <Component name="Card">',
          '    <Frame name="body" width={320} height={200}>',
          `      <Rectangle name="a" height={20} x={16} right={16} y={8}`,
          `        constraints={{ horizontal: 'STRETCH', vertical: 'MIN' }} />`,
          '    </Frame>',
          '  </Component>',
          '</Page>',
          '',
        ].join('\n'),
      ),
      pinFrame: null,
    })
    expect(wrapper.find('.size-field[data-dimension="width"] .scrub').text()).toBe('288')
  })

  it('follows the measured box while a gesture holds it, file be damned', () => {
    // Mid-drag the scene box has moved and the file has not. Every position
    // and size row derives from the measured box — which at rest round-trips
    // to the authored numbers, so this is not a special mode, just the same
    // arithmetic fed a moving input. Here the box sits 64 left of where the
    // file says: Right must read the converted 80, not the stored 16.
    const wrapper = pinPane({
      pinFrame: {
        box: { x: 200, y: 16, width: 40, height: 20 },
        parent: { width: 320, height: 200 },
      },
    })
    expect(wrapper.find('[data-field="right"] .scrub').text()).toBe('80')
  })

  it('follows the box on the near edges too', () => {
    const wrapper = pinPane({
      doc: parseOrThrow(
        [
          '---',
          'id: live',
          '---',
          '',
          '## Visual Contract',
          '',
          '<Page>',
          '  <Component name="Card">',
          '    <Frame name="body" width={320} height={200}>',
          '      <Rectangle name="a" width={40} height={20} x={16} y={8} />',
          '    </Frame>',
          '  </Component>',
          '</Page>',
          '',
        ].join('\n'),
      ),
      pinFrame: {
        box: { x: 90, y: 44, width: 40, height: 20 },
        parent: { width: 320, height: 200 },
      },
    })
    expect(wrapper.find('[data-field="x"] .scrub').text()).toBe('90')
    expect(wrapper.find('[data-field="y"] .scrub').text()).toBe('44')
    // And an authored size mid-resize.
    expect(wrapper.find('.size-field[data-dimension="width"] .scrub').text()).toBe('40')
  })

  it('touches only the axis whose constraint changed', () => {
    // Reported live: moving the horizontal pin from left to right also rewrote
    // `bottom`. Converting both axes on every click is wrong twice over — it
    // rewrites a line the author did not touch, and it re-derives that line
    // from a measured box, so any staleness in the measurement corrupts an
    // axis nobody asked about.
    const wrapper = pinPane({
      doc: parseOrThrow(
        [
          '---',
          'id: two-axes',
          '---',
          '',
          '## Visual Contract',
          '',
          '<Page>',
          '  <Component name="Card">',
          '    <Frame name="body" width={320} height={200}>',
          `      <Rectangle name="a" width={40} height={20} x={16} bottom={24}`,
          `        constraints={{ horizontal: 'MIN', vertical: 'MAX' }} />`,
          '    </Frame>',
          '  </Component>',
          '</Page>',
          '',
        ].join('\n'),
      ),
      pinFrame: {
        box: { x: 16, y: 156, width: 40, height: 20 },
        parent: { width: 320, height: 200 },
      },
    })
    wrapper.find('[aria-label="pin right"]').trigger('click')
    const patches = wrapper.emitted('patches')?.[0]?.[0] as UidxPatch[]
    const touched = patches.map((patch) => ('prop' in patch ? patch.prop : patch.op)).sort()
    // The horizontal pair changes hands; `bottom` and `y` are not mentioned.
    expect(touched).toEqual(['constraints', 'right', 'x'])
  })

  it('does not offer SCALE, which the format refuses (UIDX136)', () => {
    expect(pinPane().html()).not.toContain('SCALE')
  })

  it('brings out the centre rows only when an axis centres', () => {
    // Both axes are MAX here: the edge lines carry everything, and Center X/Y
    // would be numbers the resolver ignores.
    const wrapper = pinPane()
    expect(row(wrapper, 'x').find('[data-field="right"]').exists()).toBe(true)
    expect(wrapper.find('[data-field="centerX"]').exists()).toBe(false)
    expect(wrapper.find('[data-field="centerY"]').exists()).toBe(false)
  })
})
