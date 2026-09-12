import { describe, expect, it } from 'vitest'
import { applyPatches, componentProps, parseOrThrow, resolve } from '@uidx/format'
import { mount } from '@vue/test-utils'
import ComponentPropsSection from '../src/ComponentPropsSection.vue'
import {
  bindCandidates,
  bindingSites,
  bindProperty,
  declareAndBindProperty,
  declareProperty,
  editProperty,
  enclosingComponent,
  removeProperty,
  renameProperty,
  setPropertyDefault,
  unbindProperty,
} from '../src/component-prop-edits'

/**
 * Managing a component's properties (story F6's panel half).
 *
 * Every case runs its patches for real. `applyPatches` re-parses between ops,
 * so a set that leaves the document unreadable is rejected halfway — which is
 * the property worth testing for a rename that has to carry four writes.
 */
const page = (body: string) => `---\nid: t\n---\n\n## Visual Contract\n\n<Page>\n${body}\n</Page>\n`

const BUTTON = page(
  `  <Component
    name="Button"
    status="draft"
    props={{
      label: { type: 'TEXT', default: 'Click' },
      showIcon: { type: 'BOOLEAN', default: true },
    }}
  >
    <Frame name="container" layoutMode="HORIZONTAL">
      <Vector name="icon" visible="{showIcon}" width={16} height={16} />
      <Text name="label" characters="{label}" />
      <Text name="echo" characters="{label}" />
    </Frame>
  </Component>`,
)

const BARE = page(
  `  <Component name="Button" status="draft">
    <Frame name="container" layoutMode="HORIZONTAL" />
  </Component>`,
)

/** Runs the edit for real, the way the shell does. */
function edit(source: string, patches: ReturnType<typeof declareProperty>) {
  if (!patches) return null
  const next = applyPatches(source, patches).source
  return { source: next, declared: componentProps(resolve(parseOrThrow(next).tree, 'Button')!) }
}

const run = (
  source: string,
  make: (doc: ReturnType<typeof parseOrThrow>) => ReturnType<typeof declareProperty>,
) => edit(source, make(parseOrThrow(source)))

describe('declaring one', () => {
  it('adds the attribute when the component has none', () => {
    const out = run(BARE, (doc) => declareProperty(doc, 'Button', 'label', 'TEXT'))!
    expect([...out.declared.declared]).toEqual([['label', { type: 'TEXT', default: 'Text' }]])
    expect(out.source).toContain('props=')
  })

  it('appends to the map when it already has some', () => {
    const out = run(BUTTON, (doc) => declareProperty(doc, 'Button', 'tone', 'TEXT', 'quiet'))!
    expect([...out.declared.declared.keys()]).toEqual(['label', 'showIcon', 'tone'])
  })

  it('refuses a name the component already declares', () => {
    expect(run(BUTTON, (doc) => declareProperty(doc, 'Button', 'label', 'TEXT'))).toBeNull()
  })

  it('refuses a name that would read as a token, and an empty one', () => {
    expect(run(BUTTON, (doc) => declareProperty(doc, 'Button', 'radius#md', 'TEXT'))).toBeNull()
    expect(run(BUTTON, (doc) => declareProperty(doc, 'Button', '  ', 'TEXT'))).toBeNull()
  })

  it('refuses a default the type contradicts', () => {
    expect(
      run(BUTTON, (doc) => declareProperty(doc, 'Button', 'tone', 'BOOLEAN', 'yes')),
    ).toBeNull()
  })

  it('refuses anything that is not a <Component>', () => {
    expect(run(BUTTON, (doc) => declareProperty(doc, 'Button#container', 'x', 'TEXT'))).toBeNull()
  })
})

describe('changing a default', () => {
  it('writes the new one and nothing else', () => {
    const out = run(BUTTON, (doc) => setPropertyDefault(doc, 'Button', 'label', 'Save'))!
    expect(out.declared.declared.get('label')).toEqual({ type: 'TEXT', default: 'Save' })
    expect(out.declared.declared.get('showIcon')).toEqual({ type: 'BOOLEAN', default: true })
  })

  it('refuses a value the type contradicts', () => {
    expect(run(BUTTON, (doc) => setPropertyDefault(doc, 'Button', 'showIcon', 'yes'))).toBeNull()
  })

  it('does nothing when the value is the one it already has', () => {
    expect(run(BUTTON, (doc) => setPropertyDefault(doc, 'Button', 'label', 'Click'))).toBeNull()
  })
})

describe('renaming one', () => {
  it('carries every binding with it, in one envelope', () => {
    const doc = parseOrThrow(BUTTON)
    const patches = renameProperty(doc, 'Button', 'label', 'caption')!
    // The declaration plus one write per site — two layers read `{label}`.
    expect(patches).toHaveLength(3)

    const out = edit(BUTTON, patches)!
    const tree = parseOrThrow(out.source).tree
    expect([...out.declared.declared.keys()]).toEqual(['caption', 'showIcon'])
    expect(resolve(tree, 'Button#container/label')!.attrs.characters!.value).toBe('{caption}')
    expect(resolve(tree, 'Button#container/echo')!.attrs.characters!.value).toBe('{caption}')
    // The one that never named it is untouched.
    expect(resolve(tree, 'Button#container/icon')!.attrs.visible!.value).toBe('{showIcon}')
  })

  it('keeps the declaration order, so the panel does not reshuffle', () => {
    const out = run(BUTTON, (doc) => renameProperty(doc, 'Button', 'label', 'caption'))!
    expect([...out.declared.declared.keys()]).toEqual(['caption', 'showIcon'])
  })

  it('refuses a name another property already has', () => {
    expect(run(BUTTON, (doc) => renameProperty(doc, 'Button', 'label', 'showIcon'))).toBeNull()
  })

  it('does nothing when the name is unchanged', () => {
    expect(run(BUTTON, (doc) => renameProperty(doc, 'Button', 'label', 'label'))).toBeNull()
  })

  it('refuses a property that is not declared', () => {
    expect(run(BUTTON, (doc) => renameProperty(doc, 'Button', 'nope', 'x'))).toBeNull()
  })
})

describe('removing one', () => {
  it('bakes the default in wherever it was read', () => {
    // Not simply dropped: a binding whose property has gone draws nothing and
    // reports UIDX401, so removing would silently break the component.
    const out = run(BUTTON, (doc) => removeProperty(doc, 'Button', 'label'))!
    const tree = parseOrThrow(out.source).tree
    expect([...out.declared.declared.keys()]).toEqual(['showIcon'])
    expect(resolve(tree, 'Button#container/label')!.attrs.characters!.value).toBe('Click')
    expect(resolve(tree, 'Button#container/echo')!.attrs.characters!.value).toBe('Click')
  })

  it('bakes a boolean in as a boolean', () => {
    const out = run(BUTTON, (doc) => removeProperty(doc, 'Button', 'showIcon'))!
    expect(
      resolve(parseOrThrow(out.source).tree, 'Button#container/icon')!.attrs.visible!.value,
    ).toBe(true)
  })

  it('takes the attribute away entirely when the last one goes', () => {
    const once = run(BUTTON, (doc) => removeProperty(doc, 'Button', 'label'))!
    const twice = run(once.source, (doc) => removeProperty(doc, 'Button', 'showIcon'))!
    expect(twice.declared.declared.size).toBe(0)
    // `props={{}}` left behind is a thing a reader has to wonder about.
    expect(twice.source).not.toContain('props=')
  })

  it('refuses a property that is not declared', () => {
    expect(run(BUTTON, (doc) => removeProperty(doc, 'Button', 'nope'))).toBeNull()
  })
})

describe('binding sites', () => {
  it('finds every layer that reads the name, and no others', () => {
    const component = resolve(parseOrThrow(BUTTON).tree, 'Button')!
    expect(bindingSites(component, 'label')).toEqual([
      { address: 'Button#container/label', prop: 'characters' },
      { address: 'Button#container/echo', prop: 'characters' },
    ])
    expect(bindingSites(component, 'showIcon')).toEqual([
      { address: 'Button#container/icon', prop: 'visible' },
    ])
    expect(bindingSites(component, 'nobody')).toEqual([])
  })

  it('does not mistake a token for a property of the same tail', () => {
    const doc = parseOrThrow(
      page(
        `  <Component name="Button" status="draft" props={{ md: { type: 'TEXT', default: 'x' } }}>
    <Frame name="container" cornerRadius="{radius#md}" layoutMode="VERTICAL" />
  </Component>`,
      ),
    )
    expect(bindingSites(resolve(doc.tree, 'Button')!, 'md')).toEqual([])
  })
})

describe('the panel section (F6)', () => {
  const mountFor = (source = BUTTON, writable = true) => {
    const doc = parseOrThrow(source)
    return mount(ComponentPropsSection, {
      props: { doc, component: resolve(doc.tree, 'Button')!, writable },
    })
  }

  it('lists what the component declares, with the field each type fills', () => {
    const panel = mountFor()
    expect(panel.findAll('.row .pill-name').map((b) => b.text())).toEqual(['label', 'showIcon'])
    expect(panel.find('[data-prop="label"] .pill').attributes('title')).toContain('characters')
  })

  it('says how many layers read each one, so a removal is not a surprise', () => {
    const panel = mountFor()
    expect(panel.find('[data-prop="label"] .pill').attributes('title')).toContain('2 layers')
    expect(panel.find('[data-prop="showIcon"] .pill').attributes('title')).toContain('1 layer')
  })

  it('shows a boolean as its word and a text as its value', () => {
    const panel = mountFor()
    expect(panel.find('[data-prop="showIcon"] .pill-value').text()).toBe('True')
    expect(panel.find('[data-prop="label"] .pill-value').text()).toBe('Click')
  })

  it('emits one envelope for a default change', async () => {
    const panel = mountFor()
    await panel.find('[data-prop="label"] .edit').trigger('click')
    await panel.find('.property-dialog .value-input').setValue('Save')
    await panel.find('.property-dialog form').trigger('submit')
    expect(panel.emitted('patches')).toEqual([
      [
        [
          {
            op: 'set',
            address: 'Button',
            prop: 'props',
            value: {
              label: { type: 'TEXT', default: 'Save' },
              showIcon: { type: 'BOOLEAN', default: true },
            },
          },
        ],
      ],
    ])
  })

  it('emits the declaration and every binding for a rename', async () => {
    const panel = mountFor()
    await panel.find('[data-prop="label"] .edit').trigger('click')
    await panel.find('.property-dialog .name-input').setValue('caption')
    await panel.find('.property-dialog form').trigger('submit')
    const [sent] = panel.emitted('patches')![0] as [unknown[]]
    expect(sent).toHaveLength(3)
  })

  it('opens the same dialog from the add button, with the type to choose', async () => {
    const panel = mountFor()
    await panel.find('.add').trigger('click')
    expect(panel.find('.property-dialog').text()).toContain('Create property')
    expect(panel.find('.property-dialog .type-input').exists()).toBe(true)
  })

  it('offers no type picker when the field opening it fixes the type', async () => {
    const panel = mountFor()
    await panel.find('[data-prop="label"] .edit').trigger('click')
    expect(panel.find('.property-dialog .type-input').exists()).toBe(false)
  })

  it('refuses to add a name the component already has', async () => {
    const panel = mountFor()
    await panel.find('.add').trigger('click')
    await panel.find('.property-dialog .name-input').setValue('label')
    await panel.find('.property-dialog form').trigger('submit')
    expect(panel.emitted('patches')).toBeUndefined()
    expect(panel.find('.property-dialog').exists()).toBe(true)
  })

  it('adds one, and it starts with a default its type accepts', async () => {
    const panel = mountFor()
    await panel.find('.add').trigger('click')
    await panel.find('.property-dialog .name-input').setValue('tone')
    await panel.find('.property-dialog form').trigger('submit')
    const [sent] = panel.emitted('patches')![0] as [{ value: Record<string, unknown> }[]]
    expect(sent[0]!.value.tone).toEqual({ type: 'TEXT', default: 'Text' })
  })

  it('adds a boolean with a boolean default when the type is switched', async () => {
    const panel = mountFor()
    await panel.find('.add').trigger('click')
    await panel.find('.property-dialog .name-input').setValue('tone')
    await panel.find('.property-dialog .type-input').setValue('BOOLEAN')
    await panel.find('.property-dialog form').trigger('submit')
    const [sent] = panel.emitted('patches')![0] as [{ value: Record<string, unknown> }[]]
    expect(sent[0]!.value.tone).toEqual({ type: 'BOOLEAN', default: true })
  })

  it('says what a document with none can have, rather than showing nothing', () => {
    expect(mountFor(BARE).find('.empty').text()).toContain('without reaching inside')
  })

  it('goes read-only with the socket', () => {
    const panel = mountFor(BUTTON, false)
    expect(panel.find('.add').attributes('disabled')).toBeDefined()
    expect(panel.find('[data-prop="label"] .pill').attributes('disabled')).toBeDefined()
    expect(panel.find('[data-prop="label"] .edit').attributes('disabled')).toBeDefined()
    expect(panel.find('[data-prop="label"] .drop').attributes('disabled')).toBeDefined()
  })
})

/**
 * A property rename reaching the instances that set it (F6's debt, closed by F9).
 *
 * F6 shipped this rename carrying every *binding* inside the component, and its
 * own note said instance values would join the list once F7 built them. They
 * did — and the reason it waited was not the list but the *envelope*: those
 * values sit on consuming pages, and a patch envelope is page-addressed. F9
 * taught the shell to send one per page, which is what made this a small
 * addition rather than a second mechanism.
 */
describe('carrying instance values (F9)', () => {
  const home = parseOrThrow(
    page(
      `  <Instance name="a" component="Button" props={{ label: 'Save', showIcon: false }} />
  <Instance name="b" component="Button" props={{ showIcon: true }} />`,
    ).replace('id: t', 'id: home'),
  )

  const mountFor = (pages?: Map<string, ReturnType<typeof parseOrThrow>>, file?: string) => {
    const doc = parseOrThrow(BUTTON)
    return mount(ComponentPropsSection, {
      props: { doc, component: resolve(doc.tree, 'Button')!, pages, file, writable: true },
    })
  }

  const rename = async (panel: ReturnType<typeof mount>, from: string, to: string) => {
    await panel.find(`[data-prop="${from}"] .edit`).trigger('click')
    const input = panel.find('.property-dialog .name-input')
    await input.setValue(to)
    await panel.find('.property-dialog form').trigger('submit')
  }

  it('sends one envelope per page, and only to pages that name it', async () => {
    const doc = parseOrThrow(BUTTON)
    const panel = mountFor(
      new Map([
        ['button.uidx', doc],
        ['home.uidx', home],
      ]),
      'button.uidx',
    )
    await rename(panel, 'label', 'caption')

    const [byFile] = panel.emitted('remap')![0] as [Map<string, unknown[]>]
    expect([...byFile.keys()]).toEqual(['button.uidx', 'home.uidx'])
    // The declaration plus one write per binding site, unchanged from F6.
    expect(byFile.get('button.uidx')).toHaveLength(3)
    // Only the instance that set it; `b` never said `label`.
    expect(byFile.get('home.uidx')).toEqual([
      { op: 'set', address: 'a', prop: 'props', value: { caption: 'Save', showIcon: false } },
    ])
  })

  it('keeps the renamed key where it was, so the order does not reshuffle', async () => {
    const panel = mountFor(new Map([['home.uidx', home]]), 'button.uidx')
    await rename(panel, 'label', 'caption')
    const [byFile] = panel.emitted('remap')![0] as [Map<string, { value: object }[]>]
    expect(Object.keys(byFile.get('home.uidx')![0]!.value)).toEqual(['caption', 'showIcon'])
  })

  it('stays a plain single-file edit when nothing else names it', async () => {
    const panel = mountFor(new Map([['button.uidx', parseOrThrow(BUTTON)]]), 'button.uidx')
    await rename(panel, 'label', 'caption')
    expect(panel.emitted('remap')).toBeUndefined()
    expect(panel.emitted('patches')![0]).toBeDefined()
  })

  it('still works with no pages at all, which is a page opened alone', async () => {
    const panel = mountFor()
    await rename(panel, 'label', 'caption')
    const [sent] = panel.emitted('patches')![0] as [unknown[]]
    expect(sent).toHaveLength(3)
  })
})

describe('committing a property rename exactly once (F9)', () => {
  // The blur-after-Enter double fire this used to guard belonged to the inline
  // rename input, which the dialog replaced — a modal has one submit and no
  // blur to race it. What still has to hold is the invariant behind that guard,
  // because F9 made a rename several ops across several files and the second
  // envelope reports an edit that landed as lost.
  const mountFor = () => {
    const doc = parseOrThrow(BUTTON)
    return mount(ComponentPropsSection, {
      props: { doc, component: resolve(doc.tree, 'Button')!, writable: true },
    })
  }

  it('sends one envelope per submit, however the dialog is dismissed', async () => {
    const panel = mountFor()
    await panel.find('[data-prop="label"] .edit').trigger('click')
    await panel.find('.property-dialog .name-input').setValue('caption')
    await panel.find('.property-dialog form').trigger('submit')
    expect(panel.emitted('patches')).toHaveLength(1)
  })

  it('sends nothing when the dialog closes without a submit', async () => {
    const panel = mountFor()
    await panel.find('[data-prop="label"] .edit').trigger('click')
    await panel.find('.property-dialog .name-input').setValue('caption')
    await panel.find('.property-dialog .dialog-close').trigger('click')
    expect(panel.emitted('patches')).toBeUndefined()
  })
})

/**
 * Linking a layer's value to a property, and unlinking it again.
 *
 * The direction F6 never built: `characters="{label}"` had to be hand-authored,
 * and the panel's detach button was disabled for it because the only detach
 * that existed replaced a *numeric* token binding.
 */
const NESTED = page(
  `  <Frame name="loose">
    <Text name="stray" characters="Hello" />
  </Frame>
  <Component
    name="Button"
    status="draft"
    props={{
      label: { type: 'TEXT', default: 'Click' },
      showIcon: { type: 'BOOLEAN', default: true },
    }}
  >
    <Frame name="container" layoutMode="HORIZONTAL">
      <Text name="label" characters="Press me" />
    </Frame>
  </Component>`,
)

const doc = (source: string) => parseOrThrow(source)
const attrOf = (source: string, address: string, prop: string) =>
  resolve(parseOrThrow(source).tree, address)!.attrs[prop]?.value

describe('finding the component a layer sits in', () => {
  it('walks up to the enclosing component', () => {
    expect(enclosingComponent(doc(NESTED), 'Button#container/label')?.address).toBe('Button')
  })

  it('is null for a layer outside any component', () => {
    expect(enclosingComponent(doc(NESTED), 'loose#stray')).toBeNull()
  })
})

describe('which properties a field may take', () => {
  it('offers only the declarations whose type fills this field', () => {
    const out = bindCandidates(doc(NESTED), 'Button#container/label', 'characters')
    expect(out?.map((c) => c.name)).toEqual(['label'])
  })

  it('offers the BOOLEAN declarations for visible', () => {
    const out = bindCandidates(doc(NESTED), 'Button#container/label', 'visible')
    expect(out?.map((c) => c.name)).toEqual(['showIcon'])
  })

  it('is null for a field no property type can fill', () => {
    expect(bindCandidates(doc(NESTED), 'Button#container/label', 'fontSize')).toBeNull()
  })
})

describe('linking a field to a property', () => {
  it('replaces the literal with the binding', () => {
    const patches = bindProperty(doc(NESTED), 'Button#container/label', 'characters', 'label')!
    const next = applyPatches(NESTED, patches).source
    expect(attrOf(next, 'Button#container/label', 'characters')).toBe('{label}')
  })

  it('refuses a property whose type cannot fill the field', () => {
    expect(bindProperty(doc(NESTED), 'Button#container/label', 'characters', 'showIcon')).toBeNull()
  })

  it('refuses a name the component never declared', () => {
    expect(bindProperty(doc(NESTED), 'Button#container/label', 'characters', 'nope')).toBeNull()
  })
})

describe('unlinking a field', () => {
  it('writes the declared default back, so the canvas does not change', () => {
    const bound = applyPatches(
      NESTED,
      bindProperty(doc(NESTED), 'Button#container/label', 'characters', 'label')!,
    ).source
    const next = applyPatches(
      bound,
      unbindProperty(doc(bound), 'Button#container/label', 'characters')!,
    ).source
    expect(attrOf(next, 'Button#container/label', 'characters')).toBe('Click')
  })

  it('refuses a field that is not bound', () => {
    expect(unbindProperty(doc(NESTED), 'Button#container/label', 'characters')).toBeNull()
  })
})

describe('declaring and linking in one go', () => {
  it('writes the declaration and the binding in a single envelope', () => {
    const patches = declareAndBindProperty(
      doc(NESTED),
      'Button#container/label',
      'characters',
      'caption',
      'Press me',
    )!
    const next = applyPatches(NESTED, patches).source
    expect(
      componentProps(resolve(parseOrThrow(next).tree, 'Button')!).declared.get('caption'),
    ).toEqual({
      type: 'TEXT',
      default: 'Press me',
    })
    expect(attrOf(next, 'Button#container/label', 'characters')).toBe('{caption}')
  })

  it('refuses a name the component already declared', () => {
    expect(
      declareAndBindProperty(doc(NESTED), 'Button#container/label', 'characters', 'label', 'x'),
    ).toBeNull()
  })
})

describe('editing a declaration', () => {
  it('changes the name and the default in one envelope', () => {
    const patches = editProperty(doc(BUTTON), 'Button', 'label', 'caption', 'Go')!
    const out = edit(BUTTON, patches)!
    expect([...out.declared.declared]).toEqual([
      ['caption', { type: 'TEXT', default: 'Go' }],
      ['showIcon', { type: 'BOOLEAN', default: true }],
    ])
    expect(attrOf(out.source, 'Button#container/label', 'characters')).toBe('{caption}')
    expect(attrOf(out.source, 'Button#container/echo', 'characters')).toBe('{caption}')
  })

  it('changes the default alone when the name is unchanged', () => {
    const out = edit(BUTTON, editProperty(doc(BUTTON), 'Button', 'label', 'label', 'Go')!)!
    expect(out.declared.declared.get('label')).toEqual({ type: 'TEXT', default: 'Go' })
    expect(attrOf(out.source, 'Button#container/label', 'characters')).toBe('{label}')
  })

  it('keeps the declaration order a rename would otherwise reshuffle', () => {
    const out = edit(BUTTON, editProperty(doc(BUTTON), 'Button', 'label', 'caption', 'Go')!)!
    expect([...out.declared.declared.keys()]).toEqual(['caption', 'showIcon'])
  })

  it('refuses a name another property already holds', () => {
    expect(editProperty(doc(BUTTON), 'Button', 'label', 'showIcon', 'Go')).toBeNull()
  })

  it('refuses a default the type does not accept', () => {
    expect(editProperty(doc(BUTTON), 'Button', 'showIcon', 'showIcon', 'yes')).toBeNull()
  })
})

/**
 * The section drawn the way Figma draws it: a pill per property carrying its
 * glyph, its name and its value, with editing behind a dialog rather than
 * spread across three inline controls.
 */
describe('the properties section reads like Figma', () => {
  const section = (source = BUTTON, writable = true) => {
    const parsed = parseOrThrow(source)
    return mount(ComponentPropsSection, {
      props: { doc: parsed, component: resolve(parsed.tree, 'Button')!, writable },
    })
  }

  it('titles itself Properties', () => {
    expect(section().find('.title').text()).toBe('Properties')
  })

  it('shows each property as name and value together', () => {
    expect(
      section()
        .findAll('.row .pill')
        .map((p) => p.text()),
    ).toEqual(['label·Click', 'showIcon·True'])
  })

  it('wears the glyph of its type', () => {
    expect(
      section()
        .findAll('.row .pill svg')
        .map((s) => s.attributes('data-icon')),
    ).toEqual(['prop-text', 'prop-boolean'])
  })

  it('offers editing and removal on every row', () => {
    const panel = section()
    expect(panel.find('[data-prop="label"] .edit').exists()).toBe(true)
    expect(panel.find('[data-prop="label"] .drop').exists()).toBe(true)
  })

  it('opens the dialog named for the property type', async () => {
    const panel = section()
    await panel.find('[data-prop="showIcon"] .edit').trigger('click')
    expect(panel.find('.property-dialog').text()).toContain('Edit boolean property')
  })

  it('renames and re-defaults in one envelope', async () => {
    const panel = section()
    await panel.find('[data-prop="label"] .edit').trigger('click')
    await panel.find('.property-dialog .name-input').setValue('caption')
    await panel.find('.property-dialog .value-input').setValue('Go')
    await panel.find('.property-dialog form').trigger('submit')
    const patches = panel.emitted('patches')?.[0]?.[0] as ReturnType<typeof declareProperty>
    const out = edit(BUTTON, patches)!
    expect(out.declared.declared.get('caption')).toEqual({ type: 'TEXT', default: 'Go' })
    expect(attrOf(out.source, 'Button#container/label', 'characters')).toBe('{caption}')
  })

  it('keeps the dialog open when the name is taken', async () => {
    const panel = section()
    await panel.find('[data-prop="label"] .edit').trigger('click')
    await panel.find('.property-dialog .name-input').setValue('showIcon')
    await panel.find('.property-dialog form').trigger('submit')
    expect(panel.emitted('patches')).toBeUndefined()
    expect(panel.find('.property-dialog').exists()).toBe(true)
  })
})
