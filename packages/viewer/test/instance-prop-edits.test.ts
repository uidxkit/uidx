import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { applyPatches, parseOrThrow, resolve, type UidxNode } from '@uidx/format'
import InstancePropsSection from '../src/InstancePropsSection.vue'
import {
  clearInstanceProp,
  instancePropRows,
  setInstanceProp,
  unusedInstanceProps,
} from '../src/instance-prop-edits'

/**
 * Filling in an instance's properties (story F7).
 *
 * The thing every case here is really about: a write lands on the `<Instance>`,
 * which is on the page the author has open. The component's own file is never
 * touched by a use of it, and that is the point of choosing declared properties
 * over reaching inside.
 */
const page = (id: string, body: string) =>
  `---\nid: ${id}\n---\n\n## Visual Contract\n\n<Page>\n${body}\n</Page>\n`

const DEFINITION = resolve(
  parseOrThrow(
    page(
      'button',
      `  <Component name="Button" status="draft"
    props={{
      label: { type: 'TEXT', default: 'Click' },
      showIcon: { type: 'BOOLEAN', default: true },
    }}>
    <Frame name="root" layoutMode="VERTICAL"><Text name="t" characters="{label}" /></Frame>
  </Component>`,
    ),
  ).tree,
  'Button',
)!

const uses = (props = '') =>
  page('home', `  <Instance name="save" component="Button"${props ? ` props={${props}}` : ''} />`)

const instanceIn = (source: string): UidxNode => resolve(parseOrThrow(source).tree, 'save')!

/** Runs the edit for real, the way the shell does. */
function apply(source: string, patches: ReturnType<typeof setInstanceProp>) {
  if (!patches) return null
  return applyPatches(source, patches).source
}

describe('the rows an instance shows', () => {
  it('lists what the definition declares, in its order', () => {
    const rows = instancePropRows(instanceIn(uses()), DEFINITION)
    expect(rows.map((r) => r.name)).toEqual(['label', 'showIcon'])
  })

  it("marks an unset row and resolves it to the definition's default", () => {
    const [label] = instancePropRows(instanceIn(uses()), DEFINITION)
    expect(label!.value).toBeUndefined()
    expect(label!.resolved).toBe('Click')
  })

  it('marks a set row and resolves it to the value', () => {
    const [label] = instancePropRows(instanceIn(uses(`{ label: 'Save' }`)), DEFINITION)
    expect(label!.value).toBe('Save')
    expect(label!.resolved).toBe('Save')
  })

  it('treats a value of the wrong type as unset, so the row still draws', () => {
    const rows = instancePropRows(instanceIn(uses(`{ showIcon: 'yes' }`)), DEFINITION)
    expect(rows[1]!.value).toBeUndefined()
    expect(rows[1]!.resolved).toBe(true)
  })

  it('shows nothing at all for a component the document does not have', () => {
    expect(instancePropRows(instanceIn(uses()), undefined)).toEqual([])
  })

  it('names a value the component no longer declares', () => {
    const instance = instanceIn(uses(`{ label: 'Save', tone: 'quiet' }`))
    expect(unusedInstanceProps(instance, DEFINITION)).toEqual([
      { name: 'tone', reason: 'undeclared', value: 'quiet' },
    ])
    expect(unusedInstanceProps(instanceIn(uses(`{ label: 'Save' }`)), DEFINITION)).toEqual([])
  })

  it('names a mistyped value too, which the rows themselves cannot', () => {
    // `instancePropRows` reports it as unset, because that is what the renderer
    // does with it — so without this the panel would say "nothing chosen here"
    // about a key the file plainly has.
    expect(unusedInstanceProps(instanceIn(uses(`{ showIcon: 'yes' }`)), DEFINITION)).toEqual([
      { name: 'showIcon', reason: 'mistyped', value: 'yes' },
    ])
  })

  it('says nothing about a component it cannot find', () => {
    expect(unusedInstanceProps(instanceIn(uses(`{ tone: 'quiet' }`)), undefined)).toEqual([])
  })
})

describe('assigning one', () => {
  it('adds the attribute when the instance sets nothing yet', () => {
    const source = uses()
    const out = apply(
      source,
      setInstanceProp(parseOrThrow(source), 'save', DEFINITION, 'label', 'Save'),
    )!
    expect(resolve(parseOrThrow(out).tree, 'save')!.attrs.props!.value).toEqual({ label: 'Save' })
  })

  it('keeps the values it already had', () => {
    const source = uses(`{ label: 'Save' }`)
    const out = apply(
      source,
      setInstanceProp(parseOrThrow(source), 'save', DEFINITION, 'showIcon', false),
    )!
    expect(resolve(parseOrThrow(out).tree, 'save')!.attrs.props!.value).toEqual({
      label: 'Save',
      showIcon: false,
    })
  })

  it('writes to the instance and never to the definition', () => {
    // The whole reason this mechanism was chosen: a use does not touch the file
    // that defines the component.
    const source = uses()
    const patches = setInstanceProp(parseOrThrow(source), 'save', DEFINITION, 'label', 'Save')!
    expect(patches.every((p) => (p as { address: string }).address === 'save')).toBe(true)
  })

  it("refuses a value the declaration's type contradicts", () => {
    const source = uses()
    expect(setInstanceProp(parseOrThrow(source), 'save', DEFINITION, 'showIcon', 'yes')).toBeNull()
  })

  it('refuses a property the component does not declare', () => {
    const source = uses()
    expect(setInstanceProp(parseOrThrow(source), 'save', DEFINITION, 'tone', 'quiet')).toBeNull()
  })

  it('does nothing when the value is the one it already has', () => {
    const source = uses(`{ label: 'Save' }`)
    expect(setInstanceProp(parseOrThrow(source), 'save', DEFINITION, 'label', 'Save')).toBeNull()
  })
})

describe('resetting one', () => {
  it('removes the key rather than writing the default', () => {
    // "Does not choose" follows the definition when it changes; "chooses the
    // same thing" does not, and only one of those is what reset means.
    const source = uses(`{ label: 'Save', showIcon: false }`)
    const out = apply(source, clearInstanceProp(parseOrThrow(source), 'save', 'label'))!
    expect(resolve(parseOrThrow(out).tree, 'save')!.attrs.props!.value).toEqual({ showIcon: false })
  })

  it('takes the attribute away entirely when the last key goes', () => {
    const source = uses(`{ label: 'Save' }`)
    const out = apply(source, clearInstanceProp(parseOrThrow(source), 'save', 'label'))!
    expect(out).not.toContain('props=')
  })

  it('does nothing for a key the instance never set', () => {
    const source = uses(`{ label: 'Save' }`)
    expect(clearInstanceProp(parseOrThrow(source), 'save', 'showIcon')).toBeNull()
  })

  it('drops a stale key, which is the offer the panel makes', () => {
    const source = uses(`{ label: 'Save', tone: 'quiet' }`)
    const out = apply(source, clearInstanceProp(parseOrThrow(source), 'save', 'tone'))!
    expect(resolve(parseOrThrow(out).tree, 'save')!.attrs.props!.value).toEqual({ label: 'Save' })
  })
})

describe('the panel', () => {
  const mountFor = (
    propsAttr = '',
    definition: UidxNode | undefined = DEFINITION,
    writable = true,
  ) => {
    const source = uses(propsAttr)
    const doc = parseOrThrow(source)
    return mount(InstancePropsSection, {
      props: { doc, instance: resolve(doc.tree, 'save')!, definition, writable },
    })
  }

  it("shows the definition's default dimmed on an unset row", () => {
    const panel = mountFor()
    const row = panel.find('[data-prop="label"]')
    expect(row.attributes('data-set')).toBe('false')
    expect(row.find('.text').element.getAttribute('value')).toBe('Click')
    // Nothing to reset when nothing was chosen.
    expect(row.find('.reset').exists()).toBe(false)
  })

  it('offers reset once a row has chosen something', () => {
    const panel = mountFor(`{ label: 'Save' }`)
    const row = panel.find('[data-prop="label"]')
    expect(row.attributes('data-set')).toBe('true')
    expect(row.find('.reset').exists()).toBe(true)
  })

  it('emits an assignment against the instance', async () => {
    const panel = mountFor()
    await panel.find('[data-prop="label"] .text').setValue('Save')
    expect(panel.emitted('patches')).toEqual([
      [[{ op: 'add', address: 'save', prop: 'props', value: { label: 'Save' } }]],
    ])
  })

  it('emits a removal on reset', async () => {
    const panel = mountFor(`{ label: 'Save' }`)
    await panel.find('[aria-label="Reset label"]').trigger('click')
    expect(panel.emitted('patches')).toEqual([[[{ op: 'remove', address: 'save', prop: 'props' }]]])
  })

  it('shows a BOOLEAN as a checkbox reflecting the resolved value', () => {
    expect(
      (mountFor().find('[data-prop="showIcon"] .bool').element as HTMLInputElement).checked,
    ).toBe(true)
    expect(
      (
        mountFor(`{ showIcon: false }`).find('[data-prop="showIcon"] .bool')
          .element as HTMLInputElement
      ).checked,
    ).toBe(false)
  })

  it('names a stale value and offers to drop it', async () => {
    const panel = mountFor(`{ label: 'Save', tone: 'quiet' }`)
    expect(panel.find('.stale').text()).toContain('tone')
    await panel.find('.stale-name').trigger('click')
    expect(panel.emitted('patches')).toEqual([
      [[{ op: 'set', address: 'save', prop: 'props', value: { label: 'Save' } }]],
    ])
  })

  it('says a mistyped value is there rather than letting the row deny it', async () => {
    const panel = mountFor(`{ showIcon: 'yes' }`)
    // The row itself is unset, because that is what the canvas shows.
    expect(panel.find('[data-prop="showIcon"]').attributes('data-set')).toBe('false')
    const said = panel.find('.mistyped').text()
    expect(said).toContain('showIcon')
    expect(said).toContain('"yes"')
    expect(said).toContain('true or false')

    await panel.find('.mistyped .stale-name').trigger('click')
    expect(panel.emitted('patches')).toEqual([[[{ op: 'remove', address: 'save', prop: 'props' }]]])
  })

  it('says why there is nothing to fill in', () => {
    // Mounted inline rather than through `mountFor`: passing `undefined` for a
    // parameter with a default re-triggers the default, so the helper would
    // have handed it `DEFINITION` and the test would have proved nothing.
    const doc = parseOrThrow(uses())
    const panel = mount(InstancePropsSection, {
      props: { doc, instance: resolve(doc.tree, 'save')!, definition: undefined, writable: true },
    })
    expect(panel.find('.empty').text()).toContain('no component called')
    expect(panel.findAll('.row')).toHaveLength(0)
  })

  it('goes read-only with the socket', () => {
    const panel = mountFor(`{ label: 'Save' }`, DEFINITION, false)
    expect(panel.find('[data-prop="label"] .text').attributes('disabled')).toBeDefined()
    expect(panel.find('.reset').attributes('disabled')).toBeDefined()
  })
})

/**
 * Picking a variant is filling in a property (story F8, ADR 0005 §4).
 *
 * One surface and one spelling, so these are the same rows and the same edits
 * F7 built. What is new is that an axis has a *stated domain* — which is what
 * turns the control into a picker and gives the check something to check
 * against, neither of which Figma's inferred axes can offer.
 */
const STATEFUL = resolve(
  parseOrThrow(
    page(
      'chip',
      `  <Component name="Chip" status="draft"
    props={{ label: { type: 'TEXT', default: 'Chip' } }}
    variants={{ state: ['default', 'hover'] }}>
    <Variant state="default"><Frame name="root" layoutMode="VERTICAL" /></Variant>
    <Variant state="hover"><Frame name="root" layoutMode="VERTICAL" /></Variant>
  </Component>`,
    ),
  ).tree,
  'Chip',
)!

const chipUses = (props = '') =>
  page('home', `  <Instance name="save" component="Chip"${props ? ` props={${props}}` : ''} />`)

describe('an axis in the instance panel', () => {
  it('lists axes above properties, as one namespace in one list', () => {
    const rows = instancePropRows(instanceIn(chipUses()), STATEFUL)
    expect(rows.map((r) => r.name)).toEqual(['state', 'label'])
    expect(rows[0]!.domain).toEqual(['default', 'hover'])
    expect(rows[1]!.domain).toBeUndefined()
  })

  it('resolves an unset axis to the first value, which is the default combination', () => {
    expect(instancePropRows(instanceIn(chipUses()), STATEFUL)[0]!.resolved).toBe('default')
  })

  it('treats a value outside the domain as unset, and names it', () => {
    const instance = instanceIn(chipUses(`{ state: 'nope' }`))
    expect(instancePropRows(instance, STATEFUL)[0]!.value).toBeUndefined()
    expect(unusedInstanceProps(instance, STATEFUL)).toEqual([
      { name: 'state', reason: 'mistyped', value: 'nope' },
    ])
  })

  it('assigns a value the domain has, and refuses one it does not', () => {
    const source = chipUses()
    const doc = parseOrThrow(source)
    expect(setInstanceProp(doc, 'save', STATEFUL, 'state', 'hover')).toEqual([
      { op: 'add', address: 'save', prop: 'props', value: { state: 'hover' } },
    ])
    expect(setInstanceProp(doc, 'save', STATEFUL, 'state', 'nope')).toBeNull()
  })

  it('resets an axis by removing the key, so it follows the default combination', () => {
    const source = chipUses(`{ state: 'hover' }`)
    expect(clearInstanceProp(parseOrThrow(source), 'save', 'state')).toEqual([
      { op: 'remove', address: 'save', prop: 'props' },
    ])
  })

  it('draws a picker rather than a text field, because the values are stated', () => {
    const doc = parseOrThrow(chipUses(`{ state: 'hover' }`))
    const panel = mount(InstancePropsSection, {
      props: { doc, instance: resolve(doc.tree, 'save')!, definition: STATEFUL, writable: true },
    })
    const pick = panel.find('[data-prop="state"] .pick')
    expect(pick.findAll('option').map((o) => o.text())).toEqual(['default', 'hover'])
    expect((pick.element as HTMLSelectElement).value).toBe('hover')
    // The ordinary property beside it is unchanged.
    expect(panel.find('[data-prop="label"] .text').exists()).toBe(true)
  })

  it('emits an assignment when the picker changes', async () => {
    const doc = parseOrThrow(chipUses())
    const panel = mount(InstancePropsSection, {
      props: { doc, instance: resolve(doc.tree, 'save')!, definition: STATEFUL, writable: true },
    })
    await panel.find('[data-prop="state"] .pick').setValue('hover')
    expect(panel.emitted('patches')).toEqual([
      [[{ op: 'add', address: 'save', prop: 'props', value: { state: 'hover' } }]],
    ])
  })
})
