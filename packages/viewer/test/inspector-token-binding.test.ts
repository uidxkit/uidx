import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyPatches, parseOrThrow, resolve, type UidxPatch } from '@uidx/format'
import { buildTokenIndex, defaultTuple, TokenResolver } from '@uidx/schema'
import PropertiesPane from '../src/PropertiesPane.vue'

const TOKEN_SOURCE = `---
id: token-controls
---

## Visual Contract

<Tokens>
  <Collection name="space">
    <Variable name="sm" type="FLOAT" value={8} scopes={['SPACING']} />
    <Variable name="lg" type="FLOAT" value={24} scopes={['SPACING']} />
  </Collection>
  <Collection name="size">
    <Variable name="card" type="FLOAT" value={240} scopes={['WIDTH_HEIGHT']} />
  </Collection>
  <Collection name="radius">
    <Variable name="round" type="FLOAT" value={12} scopes={['CORNER_RADIUS']} />
  </Collection>
  <Collection name="type">
    <Variable name="family" type="STRING" value="Inter" scopes={['FONT_FAMILY']} />
  </Collection>
  <Collection name="content">
    <Variable name="first" type="STRING" value="Hello" scopes={['TEXT_CONTENT']} />
    <Variable name="second" type="STRING" value="Welcome" scopes={['TEXT_CONTENT']} />
  </Collection>
  <Collection name="flags">
    <Variable name="on" type="BOOLEAN" value={true} />
    <Variable name="off" type="BOOLEAN" value={false} />
  </Collection>
  <Collection name="palette">
    <Variable name="blue" type="COLOR" value={{ r: 0, g: 0.3, b: 1, a: 1 }} />
  </Collection>
</Tokens>
`
const SOURCE = `---
id: token-controls
---

## Visual Contract

<Page>
  <Frame name="card" width={160} height={100} layoutMode="VERTICAL" cornerRadius={4}
    paddingLeft={8} paddingRight={8} paddingTop={8} paddingBottom={8}
    fills={[{type: 'SOLID', color: {r: 1, g: 1, b: 1, a: 1}}]}
    strokes={[{type: 'SOLID', color: {r: 0, g: 0, b: 0, a: 1}}]}>
    <Text name="label" characters="Hi" fontFamily="Arial" />
  </Frame>
</Page>
`
const doc = parseOrThrow(TOKEN_SOURCE)
const tokenIndex = buildTokenIndex([doc])
const tokens = new Map(new TokenResolver(tokenIndex).resolve(defaultTuple(tokenIndex)))
const wrappers: ReturnType<typeof mount>[] = []
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()))
function pane(source = SOURCE, selection = 'card', writable = true) {
  const wrapper = mount(PropertiesPane, {
    props: { doc: parseOrThrow(source), selection: [selection], tokens, tokenIndex, writable },
    attachTo: document.body,
  })
  wrappers.push(wrapper)
  return wrapper
}
const button = (wrapper: ReturnType<typeof pane>, label: string) =>
  wrapper.get(`button[aria-label="${label}"]`)
const patches = (wrapper: ReturnType<typeof pane>) =>
  wrapper.emitted('patches')!.at(-1)![0] as UidxPatch[]

// Exercise the panel's structural write route, reparse the result and mount it
// again: bindings must survive a reload and never pass through a numeric edit.
describe('visible token controls in the inspector', () => {
  it.each(['Width', 'Height'])(
    'binds and detaches %s while keeping the sizing menu',
    async (label) => {
      const wrapper = pane()
      await button(wrapper, `Apply token to ${label}`).trigger('click')
      expect(wrapper.find('[data-variable="space#sm"]').exists()).toBe(false)
      await wrapper.get('[data-variable="size#card"]').trigger('click')
      const next = applyPatches(SOURCE, patches(wrapper)).source
      const rebound = pane(next)
      expect(resolve(parseOrThrow(next).tree, 'card')!.attrs[label.toLowerCase()]!.value).toBe(
        '{size#card}',
      )
      expect(rebound.get(`[data-dimension="${label.toLowerCase()}"] .token-pill`).text()).toBe(
        'card',
      )
      expect(rebound.find(`[data-dimension="${label.toLowerCase()}"] .size-mode`).exists()).toBe(
        true,
      )
      expect(rebound.find(`[data-dimension="${label.toLowerCase()}"] .scrub`).exists()).toBe(false)
      await button(rebound, `Detach token from ${label}`).trigger('click')
      expect(patches(rebound)).toEqual([
        { op: 'set', address: 'card', prop: label.toLowerCase(), value: 240 },
      ])
      expect(wrapper.emitted('commit')).toBeUndefined()
      expect(rebound.emitted('commit')).toBeUndefined()
    },
  )

  it('does not let a pending numeric gesture overwrite a newly applied token', async () => {
    vi.useFakeTimers()
    try {
      const wrapper = pane()
      await wrapper.get('[data-dimension="width"] .size-number').trigger('wheel', { deltaY: -1 })
      await button(wrapper, 'Apply token to Width').trigger('click')
      await wrapper.get('[data-variable="size#card"]').trigger('click')
      await wrapper.setProps({ doc: parseOrThrow(applyPatches(SOURCE, patches(wrapper)).source) })
      vi.runAllTimers()
      expect(wrapper.emitted('commit')).toBeUndefined()
      expect(button(wrapper, 'Change token for Width').text()).toBe('card')
    } finally {
      vi.useRealTimers()
    }
  })

  it('binds symmetric padding together, then switches and detaches both sides', async () => {
    const wrapper = pane()
    await button(wrapper, 'Apply token to horizontal padding').trigger('click')
    expect(wrapper.find('[data-variable="radius#round"]').exists()).toBe(false)
    await wrapper.get('[data-variable="space#sm"]').trigger('click')
    expect(patches(wrapper).map((patch) => 'prop' in patch && patch.prop)).toEqual([
      'paddingLeft',
      'paddingRight',
    ])
    const next = applyPatches(SOURCE, patches(wrapper)).source
    const rebound = pane(next)
    await button(rebound, 'Change token for horizontal padding').trigger('click')
    await rebound.get('[data-variable="space#lg"]').trigger('click')
    const switched = pane(applyPatches(next, patches(rebound)).source)
    await button(switched, 'Detach token from horizontal padding').trigger('click')
    expect(patches(switched)).toEqual([
      { op: 'set', address: 'card', prop: 'paddingLeft', value: 24 },
      { op: 'set', address: 'card', prop: 'paddingRight', value: 24 },
    ])
  })

  it('expands equal-looking padding with distinct bindings so a literal cannot overwrite one', () => {
    const wrapper = pane(SOURCE.replace('paddingLeft={8}', 'paddingLeft="{space#sm}"'))
    expect(wrapper.get('.padding-field').attributes('data-expanded')).toBe('true')
    expect(wrapper.get('[data-token-properties="paddingLeft"]').find('.scrub').exists()).toBe(false)
    expect(wrapper.get('[data-token-properties="paddingRight"]').find('.scrub').exists()).toBe(true)
  })

  it('binds a radius from its compact control and keeps the existing bound pill', async () => {
    const wrapper = pane()
    await button(wrapper, 'Apply token to Corner radius').trigger('click')
    await wrapper.get('[data-variable="radius#round"]').trigger('click')
    const rebound = pane(applyPatches(SOURCE, patches(wrapper)).source)
    expect(rebound.get('[data-prop="cornerRadius"] .token-pill').text()).toBe('round')
  })

  it('preserves distinct per-corner tokens even when their resolved values match', async () => {
    const source = SOURCE.replace(
      'cornerRadius={4}',
      'cornerRadius={12} topLeftRadius="{radius#round}"',
    )
    const wrapper = pane(source)
    expect(wrapper.get('.corner-field').attributes('data-expanded')).toBe('true')
    expect(wrapper.get('[data-token-properties="topLeftRadius"]').find('.scrub').exists()).toBe(
      false,
    )
    await button(wrapper, 'Apply token to top right radius').trigger('click')
    await wrapper.get('[data-variable="radius#round"]').trigger('click')
    expect(patches(wrapper)).toEqual([
      { op: 'add', address: 'card', prop: 'topRightRadius', value: '{radius#round}' },
    ])
  })

  it('detaches an inherited per-corner token by adding a literal override', async () => {
    const source = SOURCE.replace(
      'cornerRadius={4}',
      'cornerRadius="{radius#round}" topLeftRadius={0}',
    )
    const wrapper = pane(source)
    await button(wrapper, 'Detach token from top right radius').trigger('click')
    expect(patches(wrapper)).toEqual([
      { op: 'add', address: 'card', prop: 'topRightRadius', value: 12 },
    ])
    const next = applyPatches(source, patches(wrapper)).source
    const node = resolve(parseOrThrow(next).tree, 'card')!
    expect(node.attrs.cornerRadius!.value).toBe('{radius#round}')
    expect(node.attrs.topRightRadius!.value).toBe(12)
  })

  it.each([
    ['Content', 'characters', 'content#first', 'content#second'],
    ['Visibility', 'visible', 'flags#on', 'flags#off'],
  ])(
    'binds and switches %s outside a component with the correct token type',
    async (label, prop, first, second) => {
      const wrapper = pane(SOURCE, 'card#label')
      await button(wrapper, `Apply token to ${label}`).trigger('click')
      await wrapper.get(`[data-variable="${first}"]`).trigger('click')
      const next = applyPatches(SOURCE, patches(wrapper)).source
      const rebound = pane(next, 'card#label')
      await rebound.get(`[data-prop="${prop}"] .token-pill`).trigger('click')
      expect(rebound.find('[data-variable="size#card"]').exists()).toBe(false)
      await rebound.get(`[data-variable="${second}"]`).trigger('click')
      expect(patches(rebound)[0]).toMatchObject({ prop, value: `{${second}}` })
    },
  )

  it('offers a scoped font-family token on the text input', async () => {
    const wrapper = pane(SOURCE, 'card#label')
    await button(wrapper, 'Apply token to Font').trigger('click')
    expect(wrapper.find('[data-variable="content#first"]').exists()).toBe(false)
    await wrapper.get('[data-variable="type#family"]').trigger('click')
    expect(patches(wrapper)[0]).toMatchObject({ prop: 'fontFamily', value: '{type#family}' })
  })

  it.each(['fill', 'stroke'])('offers color tokens directly from the %s row', async (label) => {
    const wrapper = pane()
    await button(wrapper, `Apply token to ${label} color 1`).trigger('click')
    expect(wrapper.find('[data-variable="size#card"]').exists()).toBe(false)
    await wrapper.get('[data-variable="palette#blue"]').trigger('click')
    const next = applyPatches(SOURCE, patches(wrapper)).source
    const rebound = pane(next)
    expect(rebound.get(`[data-prop="${label}s"] .paint-token`).text()).toBe('blue')
    expect(wrapper.emitted('commit')).toBeUndefined()
  })

  it('explains an empty picker and respects read-only documents', async () => {
    const wrapper = pane()
    await wrapper.setProps({ tokens: new Map() })
    await button(wrapper, 'Apply token to Width').trigger('click')
    expect(wrapper.get('.assign-popup').text()).toContain('No compatible tokens')
    await wrapper.get('.assign-popup input').setValue('missing')
    expect(wrapper.get('.assign-popup').text()).toContain('No matching tokens')
    expect(wrapper.emitted('patches')).toBeUndefined()
    const readonly = pane(SOURCE, 'card', false)
    expect(readonly.find('.field-variables, .paint-variables').exists()).toBe(false)
    const bound = pane(SOURCE.replace('width={160}', 'width="{size#card}"'), 'card', false)
    expect(button(bound, 'Change token for Width').attributes('disabled')).toBeDefined()
    expect(button(bound, 'Detach token from Width').attributes('disabled')).toBeDefined()
  })
})
