import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { enableAutoUnmount, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { parseOrThrow, type UidxNode } from '@uidx/format'
import { resolveTokenValues } from '@uidx/schema'
import AlignmentMatrix from '../src/AlignmentMatrix.vue'
import CornerField from '../src/CornerField.vue'
import PaddingField from '../src/PaddingField.vue'
import PropertiesPane from '../src/PropertiesPane.vue'
import PropertyField from '../src/PropertyField.vue'

/**
 * A selected instance in the properties panel (ADR 0018 §7): its outer box
 * and the colour it hands down, each showing the component's value dimmed
 * until the use changes it, and nothing of the component's inside but one
 * read-only line. Every edit reaches the file as a patch on the `<Instance>`,
 * never as a scene write — a value through the canvas, which draws its scrub,
 * a reset straight from here — and every override can be handed back: a row,
 * a section, or all of them at once.
 */
enableAutoUnmount(afterEach)

const repo = join(__dirname, '../../..')
const read = (file: string) => parseOrThrow(readFileSync(join(repo, file), 'utf8'), file)

/**
 * Button1 is the schema fixture's copy of the pill on the design-system
 * example's page1: a styles table, so its box is the derived `root`. Badge,
 * from the same folder, draws per-corner radii and one side's stroke weight.
 * Checkbox and the tokens are the example's own, named rather than scanned.
 */
const LIBRARY = [
  read('packages/schema/test/fixtures/instance-box/button1.uidx'),
  read('packages/schema/test/fixtures/instance-box/kinds.uidx'),
  read('examples/design-system/.uidx/checkbox.uidx'),
  read('examples/design-system/.uidx/tokens.uidx'),
  parseOrThrow(
    `---\nid: pair\n---\n\n## Visual Contract\n\n<Page>
  <Component name="Pair" layoutMode="VERTICAL" primaryAxisSizingMode="AUTO" counterAxisSizingMode="AUTO">
    <Text name="title" characters="Title" fontSize={14} fills={[{ type: 'SOLID', color: { r: 0, g: 0, b: 0, a: 1 } }]} />
    <Text name="note" characters="Note" fontSize={12} fills={[{ type: 'SOLID', color: { r: 0.5, g: 0.5, b: 0.5, a: 1 } }]} />
  </Component>
</Page>\n`,
    'pair.uidx',
  ),
]
const tokens = resolveTokenValues(LIBRARY)

const page = (body: string) =>
  `---\nid: use\n---\n\n## Visual Contract\n\n<Page>\n${body}\n</Page>\n`

const RED = `[{ type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 } }]`

/** The panel with the use named `selected` chosen, on a page holding `body`. */
function pane(body: string, selected = 'b', withComponents = true) {
  const doc = parseOrThrow(page(body), 'use.uidx')
  const components = new Map<string, UidxNode>()
  for (const source of [...LIBRARY, doc])
    for (const child of source.tree.children)
      if (child.element === 'Component') components.set(child.name, child)
  return mount(PropertiesPane, {
    props: {
      doc,
      selection: [selected],
      tokens,
      writable: true,
      ...(withComponents ? { components } : {}),
    },
  })
}

type Pane = ReturnType<typeof pane>

const section = (wrapper: Pane, label: string) => wrapper.find(`.section[aria-label="${label}"]`)
const field = (wrapper: Pane, prop: string) => wrapper.find(`.field[data-prop="${prop}"]`)

const PLAIN = `  <Instance name="b" component="Button1" props={{ label: 'Go' }} />`
const styled = (attrs: string) =>
  `  <Instance name="b" component="Button1" props={{ label: 'Go' }} ${attrs} />`

describe('selecting an instance of Button1', () => {
  it('shows Padding, Text color and the locked line, with no Direction, Gap or Align controls', () => {
    const wrapper = pane(PLAIN)
    expect(wrapper.findComponent(PaddingField).exists()).toBe(true)
    expect(section(wrapper, 'Text color').exists()).toBe(true)
    const locked = wrapper.get('.locked-layout')
    expect(locked.get('.locked-summary').text()).toBe('Row · Gap 0 · center/center · No wrap')
    expect(locked.get('.locked-from').text()).toBe('— from Button1')

    expect(wrapper.find('[data-prop="layoutMode"]').exists()).toBe(false)
    expect(wrapper.find('[data-prop="itemSpacing"]').exists()).toBe(false)
    expect(wrapper.find('select[aria-label="Direction"]').exists()).toBe(false)
    expect(wrapper.findComponent(AlignmentMatrix).exists()).toBe(false)
    expect(wrapper.find('[data-inspector-group="layout-spacing"]').exists()).toBe(false)
  })

  it('opens the component from the locked line', async () => {
    const wrapper = pane(PLAIN)
    await wrapper.get('.locked-layout .locked-open').trigger('click')
    expect(wrapper.emitted('openComponent')).toEqual([['Button1']])
  })

  it('shows Fill as Button1’s blue, dimmed', () => {
    const fill = field(pane(PLAIN), 'fills')
    expect(fill.get('.paints').attributes('data-origin')).toBe('component')
    expect((fill.get('input.paint-hex').element as HTMLInputElement).value).toBe('#0055ff')
  })

  it('shows Button1’s padding and corner radius in the compound controls, dimmed', () => {
    const wrapper = pane(PLAIN)
    const padding = wrapper.getComponent(PaddingField)
    expect(padding.props('values')).toEqual({ top: 8, right: 12, bottom: 8, left: 12 })
    expect([...padding.props('inherited')!].sort()).toEqual(
      ['paddingBottom', 'paddingLeft', 'paddingRight', 'paddingTop'].sort(),
    )
    const corners = wrapper.getComponent(CornerField)
    expect(corners.props('corners')).toEqual({ top: 999, right: 999, bottom: 999, left: 999 })
    expect(corners.props('inherited')).toEqual(expect.arrayContaining(['cornerRadius']))
    // A paired row dims through its field: opacity is Button1's, untouched.
    const opacity = wrapper
      .findAllComponents(PropertyField)
      .find((f) => f.props('field').name === 'opacity')!
    expect(opacity.props('override')).toBe('inherited')
  })

  it('gives Text color one colour and no +, with a footnote saying where it reaches', () => {
    const wrapper = pane(PLAIN)
    const text = section(wrapper, 'Text color')
    expect(text.find('[data-section-add]').exists()).toBe(false)
    const row = wrapper
      .findAllComponents(PropertyField)
      .find((f) => f.props('field').name === 'textFills')!
    expect(row.props('single')).toBe(true)
    expect(row.props('override')).toBe('inherited')
    // Slot text that states no colour takes this one too (ADR 0018 §4).
    expect(text.get('.section-note').text()).toBe(
      'Every text inside Button1 · slot text with its own colour keeps it',
    )
  })
})

describe('editing an instance’s outer box', () => {
  /*
   * A release goes where the scrub went. The canvas draws an instance's scrub
   * on the frame its component wraps and holds it there, so it is the canvas
   * that has to let the scrub go, and it writes the `<Instance>` the patch
   * (`canvas-instance-box.test.ts`). A patch sent from here left the hold in
   * place: ↺, Reset all and undo then changed the file under a pill still
   * drawn at the scrubbed value.
   */
  it('hands Fill to the canvas as a commit, never as a patch of its own', async () => {
    const wrapper = pane(PLAIN)
    await field(wrapper, 'fills').get('input.paint-hex').setValue('#ff0000')
    expect(wrapper.emitted('patches')).toBeUndefined()
    expect(wrapper.emitted('commit')).toEqual([
      [
        'b',
        'fills',
        // Copy-on-write: the component's paint, recoloured, becomes the use's own.
        [{ opacity: 1, visible: true, type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 } }],
      ],
    ])
  })

  it.each([
    ['a paint whose colour is a token', [{ type: 'SOLID', color: '{surface#danger}' }]],
    ['a whole-attribute token', '{surface#danger}'],
  ])('hands %s to the canvas too, as written', (_, value) => {
    // A frame's alias-carrying paint goes straight to the file, since a scene
    // write resolves the alias away; an instance's never reaches the scene.
    const wrapper = pane(PLAIN)
    const fill = wrapper
      .findAllComponents(PropertyField)
      .find((f) => f.props('field').name === 'fills')!
    fill.vm.$emit('commit', 'fills', value)
    expect(wrapper.emitted('patches')).toBeUndefined()
    expect(wrapper.emitted('commit')).toEqual([['b', 'fills', value]])
  })

  it('hands a value the use states to the canvas the same way', async () => {
    const wrapper = pane(styled(`fills={${RED}}`))
    await field(wrapper, 'fills').get('input.paint-hex').setValue('#00ff00')
    expect(wrapper.emitted('patches')).toBeUndefined()
    expect(wrapper.emitted('commit')).toEqual([
      ['b', 'fills', [{ type: 'SOLID', color: { r: 0, g: 1, b: 0, a: 1 } }]],
    ])
  })

  it('hands both sides of a padding axis to the canvas in one tick, for one envelope', () => {
    const wrapper = pane(PLAIN)
    wrapper.getComponent(PaddingField).vm.$emit('commit', [
      { prop: 'paddingLeft', value: 24 },
      { prop: 'paddingRight', value: 24 },
    ])
    expect(wrapper.emitted('patches')).toBeUndefined()
    expect(wrapper.emitted('commit')).toEqual([
      ['b', 'paddingLeft', 24],
      ['b', 'paddingRight', 24],
    ])
  })

  it('previews through the canvas, as any scrub does', () => {
    const wrapper = pane(PLAIN)
    wrapper.getComponent(PaddingField).vm.$emit('preview', [{ prop: 'paddingLeft', value: 30 }])
    expect(wrapper.emitted('preview')).toEqual([['b', 'paddingLeft', 30]])
    expect(wrapper.emitted('patches')).toBeUndefined()
  })
})

describe('handing an override back', () => {
  it('↺ on a section removes what the use states there', async () => {
    const wrapper = pane(styled(`fills={${RED}}`))
    const head = section(wrapper, 'Fill').get('.section-head')
    expect(head.find('.override-dot').exists()).toBe(true)
    await head.get('button.reset').trigger('click')
    expect(wrapper.emitted('patches')).toEqual([[[{ op: 'remove', address: 'b', prop: 'fills' }]]])
  })

  it('↺ on Layout takes the padding and the stated size, in one envelope', async () => {
    const wrapper = pane(styled('width={199} paddingLeft={24}'))
    await section(wrapper, 'Layout').get('.section-head button.reset').trigger('click')
    expect(wrapper.emitted('patches')).toEqual([
      [
        [
          { op: 'remove', address: 'b', prop: 'paddingLeft' },
          { op: 'remove', address: 'b', prop: 'width' },
        ],
      ],
    ])
  })

  it('↺ on a row removes that row’s value alone', async () => {
    const wrapper = pane(styled(`opacity={0.5} fills={${RED}}`))
    const caption = wrapper.get('.pair-captions .field-caption.marked')
    expect(caption.text()).toContain('Opacity')
    await caption.get('button.reset').trigger('click')
    expect(wrapper.emitted('patches')).toEqual([
      [[{ op: 'remove', address: 'b', prop: 'opacity' }]],
    ])
  })

  it('↺ on Padding takes every side the use states, and nothing else', async () => {
    const wrapper = pane(styled('paddingLeft={24} paddingTop={4} width={199}'))
    const padding = wrapper.get('[data-field="instance-padding"]')
    await padding.get('button.reset').trigger('click')
    expect(wrapper.emitted('patches')).toEqual([
      [
        [
          { op: 'remove', address: 'b', prop: 'paddingTop' },
          { op: 'remove', address: 'b', prop: 'paddingLeft' },
        ],
      ],
    ])
  })

  it('shows no mark where the use states nothing', () => {
    const wrapper = pane(PLAIN)
    expect(wrapper.find('.section-head .override-mark').exists()).toBe(false)
    expect(wrapper.find('.override-mark').exists()).toBe(false)
  })

  it('counts the overrides on the card, and Reset all sends them as one envelope', async () => {
    const wrapper = pane(
      styled(`x={10} fills={${RED}} paddingLeft={24} textFills={${RED}} width={199}`),
    )
    const card = wrapper.get('[data-field="overrides"]')
    expect(card.text()).toContain('4 overrides')
    await card.get('button').trigger('click')
    const sent = wrapper.emitted('patches')!
    expect(sent).toHaveLength(1)
    expect(sent[0]![0]).toEqual(
      ['fills', 'paddingLeft', 'textFills', 'width'].map((prop) => ({
        op: 'remove',
        address: 'b',
        prop,
      })),
    )
  })

  it('offers no Reset all to a use that overrides nothing', () => {
    expect(pane(PLAIN).find('[data-field="overrides"]').exists()).toBe(false)
  })

  it('offers to remove an attribute of the component’s inside, which nothing draws', async () => {
    const wrapper = pane(styled('itemSpacing={4}'))
    const row = wrapper.get('.field[data-prop="itemSpacing"]')
    expect(row.text()).toContain('the component’s own layout')
    await row.get('button.remove-attr').trigger('click')
    expect(wrapper.emitted('patches')).toEqual([
      [[{ op: 'remove', address: 'b', prop: 'itemSpacing' }]],
    ])
  })
})

describe('a state the instance’s own props select', () => {
  const CHECKED = `  <Instance name="b" component="Checkbox" props={{ checked: true }} fills={${RED}} />`

  it('says what it sets, above the sections', () => {
    const note = pane(CHECKED).get('[data-field="masked"]')
    expect(note.classes()).toContain('state-cells')
    // Checkbox's checked row sets its box's fill and stroke; its check mark is
    // inside, not the box, so it goes unsaid.
    expect(note.text()).toBe('Its checked state sets: Fill, Stroke')
  })

  it('marks a value the use states that the state hides with a chip and the note', () => {
    const wrapper = pane(CHECKED)
    const fill = section(wrapper, 'Fill')
    expect(fill.get('.section-head .state-chip').text()).toBe('checked')
    expect(fill.get('.shadow-note').text()).toBe(
      'The ‘checked’ state sets this; your value shows in the other states',
    )
  })

  it('says nothing when no state is selected', () => {
    const wrapper = pane(`  <Instance name="b" component="Checkbox" fills={${RED}} />`)
    expect(wrapper.find('[data-field="masked"]').exists()).toBe(false)
    expect(wrapper.find('.shadow-note').exists()).toBe(false)
    expect(section(wrapper, 'Fill').find('.section-head .override-dot').exists()).toBe(true)
  })
})

describe('a shorthand the instance states', () => {
  const badge = (attrs = '') =>
    pane(`  <Instance name="w" component="Badge" props={{ tone: 'warn' }} ${attrs} />`, 'w')
  const row = (wrapper: Pane, prop: string) =>
    wrapper.findAllComponents(PropertyField).find((f) => f.props('field').name === prop)!

  it('keeps the component’s own corners while it states none', () => {
    const corners = badge().getComponent(CornerField)
    expect(corners.props('perCorner')).toBe(true)
    expect(corners.props('corners')).toEqual({ top: 8, right: 0, bottom: 8, left: 0 })
  })

  it('draws every corner at its cornerRadius, which replaced the component’s corners', () => {
    const corners = badge('cornerRadius={2}').getComponent(CornerField)
    expect(corners.props('perCorner')).toBe(false)
    expect(corners.props('corners')).toEqual({ top: 2, right: 2, bottom: 2, left: 2 })
  })

  it('shows a side weight its strokeWeight replaced as that weight, with no mark of its own', () => {
    const inherited = row(badge(), 'strokeBottomWeight')
    expect(inherited.props('field').value).toBe(2)
    expect(inherited.props('override')).toBe('inherited')
    const replaced = row(badge('strokeWeight={1}'), 'strokeBottomWeight')
    expect(replaced.props('field').value).toBe(1)
    expect(replaced.props('override')).toBeUndefined()
  })
})

describe('Text color where the texts disagree', () => {
  it('shows Mixed rather than one of the colours', () => {
    const wrapper = pane(`  <Instance name="p" component="Pair" />`, 'p')
    const row = wrapper
      .findAllComponents(PropertyField)
      .find((f) => f.props('field').name === 'textFills')!
    expect(row.props('mixed')).toBe(true)
    expect(section(wrapper, 'Text color').get('[data-placeholder]').text()).toContain('Mixed')
  })
})

describe('an instance whose component is missing', () => {
  it('has nothing to inherit: no locked line, no padding it does not state, its own fill', () => {
    const wrapper = pane(styled(`fills={${RED}}`), 'b', false)
    expect(wrapper.find('.locked-layout').exists()).toBe(false)
    expect(wrapper.find('[data-field="masked"]').exists()).toBe(false)
    expect(wrapper.findComponent(PaddingField).exists()).toBe(false)
    const fill = field(wrapper, 'fills')
    expect(fill.get('.paints').attributes('data-origin')).toBe('own')
    expect((fill.get('input.paint-hex').element as HTMLInputElement).value).toBe('#ff0000')
  })

  it('still hands its box to the canvas, which writes it on the instance', async () => {
    const wrapper = pane(styled(`fills={${RED}}`), 'b', false)
    await field(wrapper, 'fills').get('input.paint-hex').setValue('#00ff00')
    expect(wrapper.emitted('patches')).toBeUndefined()
    expect(wrapper.emitted('commit')).toEqual([
      ['b', 'fills', [{ type: 'SOLID', color: { r: 0, g: 1, b: 0, a: 1 } }]],
    ])
  })
})
