import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { applyPatches, componentVariants, parseOrThrow, resolve } from '@uidx/format'
import ComponentVariantsSection from '../src/ComponentVariantsSection.vue'
import {
  addAxisValue,
  addVariant,
  emptyCombinations,
  instancesNaming,
  isAxisValueFree,
  removeAxisValue,
  removeVariant,
  renameAxisValue,
} from '../src/variant-edits'

/**
 * Growing and shrinking a component's states (story F9's managing half).
 *
 * Every case runs its patches for real, and that is the whole point here rather
 * than a habit: `applyPatches` re-parses between ops, so an envelope whose
 * *middle* document is invalid is rejected halfway. A `<Variant>`'s coordinates
 * live on the variant and their domain on the component, so almost every edge
 * in this file is about whether a legal ordering exists at all.
 */
const page = (id: string, body: string) =>
  `---\nid: ${id}\n---\n\n## Visual Contract\n\n<Page>\n${body}\n</Page>\n`

const variant = (attrs: string, label = 'Click') =>
  `    <Variant ${attrs}>
      <Frame name="row" layoutMode="HORIZONTAL"><Text name="t" characters="${label}" /></Frame>
    </Variant>`

const component = (variants: string, body: string) =>
  page(
    'c',
    `  <Component name="Chip" status="draft" variants={${variants}}>\n${body}\n  </Component>`,
  )

const ONE_AXIS = component(
  `{ state: ['off', 'on'] }`,
  [variant(`state="off"`), variant(`state="on"`, 'On')].join('\n'),
)

const TWO_AXES = component(
  `{ state: ['off', 'on'], size: ['md', 'sm'] }`,
  [
    variant(`state="off" size="md"`),
    variant(`state="on" size="md"`, 'On'),
    variant(`state="off" size="sm"`, 'Small'),
  ].join('\n'),
)

/** Runs the edit for real, the way the shell does. */
function edit(source: string, patches: ReturnType<typeof addVariant>) {
  if (!patches) return null
  const next = applyPatches(source, patches).source
  const doc = parseOrThrow(next)
  return { source: next, doc, chip: resolve(doc.tree, 'Chip')! }
}

const run = (
  source: string,
  make: (doc: ReturnType<typeof parseOrThrow>) => ReturnType<typeof addVariant>,
) => edit(source, make(parseOrThrow(source)))

const coords = (entries: [string, string][]) => new Map(entries)

describe('the cells a component has not filled', () => {
  it('names them, in declared order', () => {
    const chip = resolve(parseOrThrow(TWO_AXES).tree, 'Chip')!
    expect(emptyCombinations(chip).map((c) => c.name)).toEqual(['state=on, size=sm'])
  })

  it('is empty when every combination exists', () => {
    expect(emptyCombinations(resolve(parseOrThrow(ONE_AXIS).tree, 'Chip')!)).toEqual([])
  })

  it('says nothing about a component with no states', () => {
    const plain = parseOrThrow(
      page('p', `  <Component name="P" status="draft"><Frame name="f" /></Component>`),
    )
    expect(emptyCombinations(resolve(plain.tree, 'P')!)).toEqual([])
  })
})

describe('adding a state', () => {
  it('copies the closest existing variant rather than starting blank', () => {
    // A variant holds exactly one child, and an author adding `hover` wants the
    // `default` tree to start from, not a frame they have to rebuild.
    const out = run(TWO_AXES, (doc) =>
      addVariant(
        doc,
        'Chip',
        coords([
          ['state', 'on'],
          ['size', 'sm'],
        ]),
      ),
    )!
    expect(out.chip.children.map((v) => v.name)).toEqual([
      'state=off, size=md',
      'state=on, size=md',
      'state=off, size=sm',
      'state=on, size=sm',
    ])
    // Closest is the one sharing the most coordinates: the `state=on` row, not
    // whatever happened to be declared first.
    expect(resolve(out.doc.tree, 'Chip#state=on, size=sm/row/t')!.attrs.characters!.value).toBe(
      'On',
    )
  })

  it('orders the new name by the declaration, not by how it was asked for', () => {
    const out = run(TWO_AXES, (doc) =>
      addVariant(
        doc,
        'Chip',
        coords([
          ['size', 'sm'],
          ['state', 'on'],
        ]),
      ),
    )!
    expect(out.chip.children.at(-1)!.name).toBe('state=on, size=sm')
  })

  it('refuses a combination that already exists', () => {
    expect(
      run(TWO_AXES, (doc) =>
        addVariant(
          doc,
          'Chip',
          coords([
            ['state', 'off'],
            ['size', 'md'],
          ]),
        ),
      ),
    ).toBeNull()
  })

  it('refuses a partial or out-of-domain combination', () => {
    expect(run(TWO_AXES, (doc) => addVariant(doc, 'Chip', coords([['state', 'on']])))).toBeNull()
    expect(
      run(TWO_AXES, (doc) =>
        addVariant(
          doc,
          'Chip',
          coords([
            ['state', 'nope'],
            ['size', 'md'],
          ]),
        ),
      ),
    ).toBeNull()
  })

  it('refuses anything that is not a component with states', () => {
    expect(
      run(TWO_AXES, (doc) => addVariant(doc, 'Chip#state=off, size=md', coords([]))),
    ).toBeNull()
  })
})

describe('removing a state', () => {
  it('takes the variant out', () => {
    const out = run(TWO_AXES, (doc) => removeVariant(doc, 'Chip#state=off, size=sm').patches)!
    expect(out.chip.children.map((v) => v.name)).toEqual([
      'state=off, size=md',
      'state=on, size=md',
    ])
  })

  it('refuses the default combination, and says what to do instead', () => {
    const { refusal } = removeVariant(parseOrThrow(TWO_AXES), 'Chip#state=off, size=md')
    expect(refusal).toContain('default combination')
    expect(refusal).toContain('Reorder the axis')
  })

  it('refuses the last one, because a component with states needs one', () => {
    const single = component(`{ state: ['off'] }`, variant(`state="off"`))
    const { refusal } = removeVariant(parseOrThrow(single), 'Chip#state=off')
    expect(refusal).toContain('only state')
  })

  it('leaves a valid document behind, which the refusals are for', () => {
    const out = run(TWO_AXES, (doc) => removeVariant(doc, 'Chip#state=off, size=sm').patches)!
    expect(() => parseOrThrow(out.source)).not.toThrow()
  })
})

describe('a value of an axis', () => {
  it('is added with one write, because combinations may be sparse', () => {
    // The new value has no variants yet and that is legal — which is what makes
    // "add a state" and "design it" two steps rather than one pretending to be.
    const out = run(ONE_AXIS, (doc) => addAxisValue(doc, 'Chip', 'state', 'pressed'))!
    expect(componentVariants(out.chip).axes.get('state')).toEqual(['off', 'on', 'pressed'])
    expect(out.chip.children).toHaveLength(2)
    expect(emptyCombinations(out.chip).map((c) => c.name)).toEqual(['state=pressed'])
  })

  it('refuses a value the axis already has, a blank one, and a separator', () => {
    for (const bad of ['on', '', ' ', 'a=b', 'a,b', 'a/b', 'a#b']) {
      expect(run(ONE_AXIS, (doc) => addAxisValue(doc, 'Chip', 'state', bad))).toBeNull()
    }
    expect(isAxisValueFree(['on'], 'off')).toBe(true)
  })

  it('is removed only once nothing uses it', () => {
    const widened = run(ONE_AXIS, (doc) => addAxisValue(doc, 'Chip', 'state', 'pressed'))!
    const out = edit(
      widened.source,
      removeAxisValue(widened.doc, 'Chip', 'state', 'pressed').patches,
    )!
    expect(componentVariants(out.chip).axes.get('state')).toEqual(['off', 'on'])
  })

  it('refuses to take designed states with it, and names them', () => {
    const { refusal } = removeAxisValue(parseOrThrow(TWO_AXES), 'Chip', 'size', 'sm')
    expect(refusal).toContain('state=off, size=sm')
  })

  it('refuses to empty an axis', () => {
    const single = component(`{ state: ['off'] }`, variant(`state="off"`))
    expect(removeAxisValue(parseOrThrow(single), 'Chip', 'state', 'off').refusal).toContain(
      'no values left',
    )
  })
})

describe('renaming a value', () => {
  it('carries every variant with it, and every intermediate document parses', () => {
    // The shape is forced: widen the domain to hold both spellings, move the
    // variants, narrow it again. `applyPatches` re-parses between ops, so a
    // variant holding a value its component no longer declares is UIDX118.
    const patches = renameAxisValue(parseOrThrow(TWO_AXES), 'Chip', 'state', 'on', 'active')!
    expect(patches).toHaveLength(3)

    const out = edit(TWO_AXES, patches)!
    expect(componentVariants(out.chip).axes.get('state')).toEqual(['off', 'active'])
    expect(out.chip.children.map((v) => v.name)).toEqual([
      'state=off, size=md',
      'state=active, size=md',
      'state=off, size=sm',
    ])
  })

  it('renames the default value too, by keeping some combination the default meanwhile', () => {
    // The middle document would otherwise trip UIDX120 — the default is each
    // axis's first value, and it has to name a variant that exists.
    const out = run(TWO_AXES, (doc) => renameAxisValue(doc, 'Chip', 'state', 'off', 'idle'))!
    expect(componentVariants(out.chip).axes.get('state')).toEqual(['idle', 'on'])
    expect(out.chip.children.map((v) => v.name)).toContain('state=idle, size=md')
  })

  it('renames a value nothing uses yet', () => {
    const widened = run(ONE_AXIS, (doc) => addAxisValue(doc, 'Chip', 'state', 'pressed'))!
    const out = edit(
      widened.source,
      renameAxisValue(widened.doc, 'Chip', 'state', 'pressed', 'down'),
    )!
    expect(componentVariants(out.chip).axes.get('state')).toEqual(['off', 'on', 'down'])
  })

  it('moves every address beneath the variant, because the segment is derived', () => {
    const out = run(ONE_AXIS, (doc) => renameAxisValue(doc, 'Chip', 'state', 'on', 'active'))!
    expect(resolve(out.doc.tree, 'Chip#state=active/row/t')!.attrs.characters!.value).toBe('On')
    expect(resolve(out.doc.tree, 'Chip#state=on/row/t')).toBeNull()
  })

  it('refuses a name the axis already has, and a no-op', () => {
    expect(run(TWO_AXES, (doc) => renameAxisValue(doc, 'Chip', 'state', 'on', 'off'))).toBeNull()
    expect(run(TWO_AXES, (doc) => renameAxisValue(doc, 'Chip', 'state', 'on', 'on'))).toBeNull()
    expect(run(TWO_AXES, (doc) => renameAxisValue(doc, 'Chip', 'state', 'nope', 'x'))).toBeNull()
  })
})

describe('the instances that name a value', () => {
  const home = parseOrThrow(
    page(
      'home',
      `  <Instance name="a" component="Chip" props={{ state: 'on' }} />
  <Instance name="b" component="Chip" props={{ state: 'off', size: 'sm' }} />
  <Instance name="c" component="Other" props={{ state: 'on' }} />`,
    ),
  )
  const other = parseOrThrow(
    page('other', `  <Instance name="d" component="Chip" props={{ state: 'on' }} />`),
  )

  it('finds them across every page, grouped by the file they sit in', () => {
    // They land in *different files*: the component's page carries the
    // declaration and the variants, every consuming page carries its own
    // instances, and C1's envelope is page-addressed.
    const found = instancesNaming(
      new Map([
        ['home.uidx', home],
        ['other.uidx', other],
      ]),
      'Chip',
      'state',
      'on',
      'active',
    )
    expect([...found.keys()]).toEqual(['home.uidx', 'other.uidx'])
    expect(found.get('home.uidx')).toEqual([
      { op: 'set', address: 'a', prop: 'props', value: { state: 'active' } },
    ])
  })

  it('leaves an instance of another component alone, and one that never said it', () => {
    const found = instancesNaming(new Map([['home.uidx', home]]), 'Chip', 'state', 'on', 'active')
    expect(found.get('home.uidx')!.map((p) => (p as { address: string }).address)).toEqual(['a'])
  })

  it('keeps the values it already had', () => {
    const found = instancesNaming(new Map([['home.uidx', home]]), 'Chip', 'size', 'sm', 'compact')
    expect(found.get('home.uidx')).toEqual([
      { op: 'set', address: 'b', prop: 'props', value: { state: 'off', size: 'compact' } },
    ])
  })

  it('returns nothing when no instance names it', () => {
    expect(
      instancesNaming(new Map([['home.uidx', home]]), 'Chip', 'state', 'nobody', 'x').size,
    ).toBe(0)
  })
})

describe('the panel section', () => {
  const mountFor = (source = TWO_AXES, writable = true) => {
    const doc = parseOrThrow(source)
    const home = parseOrThrow(
      page('home', `  <Instance name="a" component="Chip" props={{ state: 'on' }} />`),
    )
    return mount(ComponentVariantsSection, {
      props: {
        doc,
        component: resolve(doc.tree, 'Chip')!,
        pages: new Map([
          ['chip.uidx', doc],
          ['home.uidx', home],
        ]),
        file: 'chip.uidx',
        writable,
      },
    })
  }

  it('lists each axis with its values, marking the default', () => {
    const panel = mountFor()
    expect(panel.findAll('[data-axis]').map((a) => a.attributes('data-axis'))).toEqual([
      'state',
      'size',
    ])
    expect(
      panel.findAll('[data-axis="state"] .value').map((v) => v.attributes('data-default')),
    ).toEqual(['true', 'false'])
  })

  it('offers the combinations nobody designed, and adds one on click', async () => {
    const panel = mountFor()
    const gaps = panel.findAll('.gap')
    expect(gaps.map((g) => g.text())).toEqual(['+ state=on, size=sm'])
    await gaps[0]!.trigger('click')
    const [sent] = panel.emitted('patches')![0] as [{ op: string }[]]
    expect(sent[0]!.op).toBe('insert-node')
  })

  it('adds a value to an axis, and refuses one it already has', async () => {
    const panel = mountFor()
    await panel.find('[data-axis="state"] .add').trigger('click')
    await panel.find('[data-axis="state"] .rename').setValue('on')
    expect(panel.find('.confirm').attributes('disabled')).toBeDefined()
    await panel.find('[data-axis="state"] .rename').setValue('pressed')
    expect(panel.find('.confirm').attributes('disabled')).toBeUndefined()
    await panel.find('.confirm').trigger('click')
    expect(panel.emitted('patches')![0]).toBeDefined()
  })

  it('says why a removal was refused rather than doing nothing', async () => {
    const panel = mountFor()
    await panel.find('[data-axis="size"] [data-value="sm"] .drop').trigger('click')
    expect(panel.emitted('patches')).toBeUndefined()
    expect((panel.emitted('refused')![0] as string[])[0]).toContain('state=off, size=sm')
  })

  it('sends a value rename to every page that names it', async () => {
    const panel = mountFor()
    await panel.find('[data-axis="state"] [data-value="on"] .value-name').trigger('click')
    const input = panel.find('[data-axis="state"] .rename')
    await input.setValue('active')
    await input.trigger('keydown.enter')

    const [byFile] = panel.emitted('remap')![0] as [Map<string, unknown[]>]
    expect([...byFile.keys()]).toEqual(['chip.uidx', 'home.uidx'])
    // The component's own page: widen, move each variant, narrow.
    expect(byFile.get('chip.uidx')).toHaveLength(3)
    expect(byFile.get('home.uidx')).toEqual([
      { op: 'set', address: 'a', prop: 'props', value: { state: 'active' } },
    ])
  })

  it('lists the states, and offers to remove one', async () => {
    const panel = mountFor()
    expect(panel.findAll('[data-state]').map((s) => s.attributes('data-state'))).toEqual([
      'state=off, size=md',
      'state=on, size=md',
      'state=off, size=sm',
    ])
    await panel.find('[data-state="state=off, size=sm"] .drop').trigger('click')
    expect(panel.emitted('patches')![0]).toEqual([
      [{ op: 'remove-node', address: 'Chip#state=off, size=sm' }],
    ])
  })

  it('goes read-only with the socket', () => {
    const panel = mountFor(TWO_AXES, false)
    expect(panel.find('[data-axis="state"] .add').attributes('disabled')).toBeDefined()
    expect(panel.find('.gap').attributes('disabled')).toBeDefined()
    expect(panel.find('[data-state] .drop').attributes('disabled')).toBeDefined()
  })
})

/**
 * The blur that follows an Enter (found live, fixed in both panels).
 *
 * Enter clears `renaming`, which unmounts the input, which fires `blur` — so
 * the same edit was sent twice. Harmless-looking, and not harmless: the second
 * envelope is written against a revision the first already moved, so it goes
 * stale, its targets are gone (the variant it named has just been renamed), and
 * the shell tells the author their edit "was not applied" about an edit that
 * landed.
 */
describe('committing a rename exactly once', () => {
  const mountFor = () => {
    const doc = parseOrThrow(TWO_AXES)
    return mount(ComponentVariantsSection, {
      props: {
        doc,
        component: resolve(doc.tree, 'Chip')!,
        pages: new Map([['chip.uidx', doc]]),
        file: 'chip.uidx',
        writable: true,
      },
    })
  }

  it('sends one envelope for Enter, not one for Enter and one for the blur', async () => {
    const panel = mountFor()
    await panel.find('[data-axis="state"] [data-value="on"] .value-name').trigger('click')
    const input = panel.find('[data-axis="state"] .rename')
    await input.setValue('active')
    await input.trigger('keydown.enter')
    // The real sequence: Vue unmounts the input on the next tick and the
    // browser fires `blur` as it goes.
    await input.trigger('blur')
    expect(panel.emitted('remap')).toHaveLength(1)
  })

  it('still commits a rename the author finished by clicking away', async () => {
    const panel = mountFor()
    await panel.find('[data-axis="state"] [data-value="on"] .value-name').trigger('click')
    const input = panel.find('[data-axis="state"] .rename')
    await input.setValue('active')
    await input.trigger('blur')
    expect(panel.emitted('remap')).toHaveLength(1)
  })
})
