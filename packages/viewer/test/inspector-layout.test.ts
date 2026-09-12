import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { parseOrThrow, type JsonValue } from '@uidx/format'
import { SECTION_ORDER } from '@uidx/schema'
import { editableProps, sectionsFor, type PairedField } from '../src/editable'
import { inspectorGroups } from '../src/inspector-layout'
import PropertiesPane from '../src/PropertiesPane.vue'

const doc = parseOrThrow(`---
id: inspector
---
## Visual Contract
<Page>
  <Frame name="frame" width={400} height={200} layoutMode="HORIZONTAL" minWidth="{sizes#min}"
    opacity={0.7} blendMode="MULTIPLY" paddingLeft={12} paddingRight={16}
    fills={[{type: 'SOLID', color: {r: 1, g: 0, b: 0, a: 1}}]}>
    <Text name="text" characters="A label" fontSize={14} maxLines={2} />
    <Rectangle name="rect" strokeTopWeight={2} cornerRadius={8} />
  </Frame>
  <Vector name="line" width={100} height={1} strokeWeight={4} strokeMiterLimit={8}
    strokeStartCap="ROUND" strokeEndCap="ARROW_LINES"
    vectorPaths={[{windingRule: 'NONZERO', data: 'M0 0L100 0'}]} />
</Page>`)

describe('inspector presentation preserves capabilities', () => {
  it('keeps every supplied row exactly once, including its alias, readonly state and paired field', () => {
    const nodes = [...doc.tree.children, ...doc.tree.children[0]!.children]
    for (const node of nodes) {
      for (const section of sectionsFor(node, editableProps(node), null)) {
        const grouped = inspectorGroups(section.group, section.fields).flatMap(
          (group) => group.fields,
        )
        expect(grouped.length).toBe(section.fields.length)
        expect(new Set(grouped).size).toBe(section.fields.length)
        for (const row of section.fields) expect(grouped).toContain(row)
      }
    }
  })

  it('gives future properties a visible fallback instead of dropping unlisted rows', () => {
    const field = editableProps(doc.tree.children[0]!)[0]!
    for (const group of SECTION_ORDER) {
      const row: PairedField = {
        field: { ...field, group, name: 'futureProperty' },
        pairedWith: null,
      }
      expect(inspectorGroups(group, [row]).flatMap((part) => part.fields)).toEqual([row])
    }
  })

  it('keeps size-limit variable switching and detaching available inside the disclosure', async () => {
    const wrapper = mount(PropertiesPane, {
      props: {
        doc,
        writable: true,
        selection: ['frame'],
        tokens: new Map<string, JsonValue>([['sizes#min', 120]]),
      },
    })
    const limits = wrapper.get('[data-inspector-group="size-limits"]')
    expect(limits.get('summary').text()).toContain('1 set')
    expect(limits.get('.token-pill').text()).toBe('min')
    await limits.get('.token-detach').trigger('click')
    expect(wrapper.emitted('patches')).toEqual([
      [[{ op: 'set', address: 'frame', prop: 'minWidth', value: 120 }]],
    ])
  })

  it('routes an advanced stroke edit through the same authored property', async () => {
    const wrapper = mount(PropertiesPane, { props: { doc, writable: true, selection: ['line'] } })
    const details = wrapper.get('[data-inspector-group="stroke-options"]')
    expect(details.get('summary').text()).toContain('Stroke details')
    const limit = details.get('[data-prop="strokeMiterLimit"]')
    limit.findComponent({ name: 'NumberFieldRoot' }).vm.$emit('commit', 6)
    expect(wrapper.emitted('commit')).toEqual([['line', 'strokeMiterLimit', 6]])
    expect(wrapper.find('#f-strokeStartCap').exists()).toBe(true)
    expect(wrapper.find('#f-strokeEndCap').exists()).toBe(true)
  })

  it('edits multiline text and preserves exact content', async () => {
    const wrapper = mount(PropertiesPane, {
      props: { doc, writable: true, selection: ['frame#text'] },
    })
    await wrapper.get('textarea').setValue('First line\nSecond line')
    expect(wrapper.emitted('commit')).toEqual([
      ['frame#text', 'characters', 'First line\nSecond line'],
    ])
    await wrapper.setProps({ writable: false })
    expect(wrapper.get('textarea').attributes('disabled')).toBeDefined()
  })

  it('accepts the percent suffix displayed in paint opacity without changing its color', async () => {
    const wrapper = mount(PropertiesPane, { props: { doc, writable: true, selection: ['frame'] } })
    await wrapper.get('.paint-opacity').setValue('25%')
    expect(wrapper.emitted('commit')).toEqual([
      ['frame', 'fills', [{ type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 }, opacity: 0.25 }]],
    ])
  })
})
