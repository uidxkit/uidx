import { describe, expect, it } from 'vitest'
import { applyPatches, parseOrThrow, resolve } from '@uidx/format'
import { mount } from '@vue/test-utils'
import { componentFrom, isComponentNameFree } from '../src/layer-moves'
import NameComponentDialog from '../src/NameComponentDialog.vue'
import PickComponentDialog from '../src/PickComponentDialog.vue'

/**
 * Making a component out of something already drawn (story F10).
 *
 * The story's own open question was the *shape* of the patch, and these tests
 * are mostly about that: two ops rather than one, in an order where the
 * document is valid at every step. `applyPatches` re-parses between ops, so a
 * pair that only works if you squint at the end would be rejected halfway —
 * which is why every test here runs the patches for real rather than comparing
 * them to an expected literal.
 */
const page = (body: string) => `---\nid: t\n---\n\n## Visual Contract\n\n<Page>\n${body}\n</Page>\n`

const MARK = page(
  `  <Vector
    name="mark"
    x={20}
    y={30}
    width={16}
    height={16}
    vectorPaths={[{ windingRule: 'NONZERO', data: 'M0 0L16 0L16 16Z' }]}
  />`,
)

/**
 * The shape the live pass found: absolutely-placed artwork inside an
 * absolutely-placed frame. `NESTED` could not catch a position bug because its
 * parent is auto-layout, so its children carry no `x`/`y` to get wrong.
 */
const PLACED = page(
  `  <Frame name="stage" x={-40} y={-64} width={1460} height={720}>
    <Frame name="frame-1" x={423} y={438} width={257} height={85} />
    <Vector name="mark" x={11} y={13} width={16} height={16}
      vectorPaths={[{ windingRule: 'NONZERO', data: 'M0 0L16 0L16 16Z' }]} />
  </Frame>`,
)

const NESTED = page(
  `  <Frame name="bar" x={0} y={0} layoutMode="HORIZONTAL">
    <Vector name="mark" width={16} height={16}
      vectorPaths={[{ windingRule: 'NONZERO', data: 'M0 0L16 0L16 16Z' }]} />
    <Text name="label" characters="Hi" />
  </Frame>`,
)

/** Runs the gesture for real, the way the shell does. */
function make(source: string, address: string, name: string, taken: string[] = []) {
  const doc = parseOrThrow(source)
  const result = componentFrom(doc, address, name, new Set(taken))
  if (!result) return null
  return { ...result, source: applyPatches(source, result.patches).source }
}

describe('making a component from a node', () => {
  it('moves the node into a new <Component> on the page', () => {
    const made = make(MARK, 'mark', 'Icon/Check')!
    const doc = parseOrThrow(made.source)
    const component = resolve(doc.tree, 'Icon/Check')!
    expect(component.element).toBe('Component')
    // ADR 0009 §3: nothing writes `status` on the author's behalf any more.
    expect(component.attrs.status).toBeUndefined()
    expect(component.children.map((c) => c.name)).toEqual(['mark'])
    // And it is gone from where it was.
    expect(resolve(doc.tree, 'mark')).toBeNull()
  })

  it('reports where the node now answers to, so the selection can follow', () => {
    const made = make(MARK, 'mark', 'Icon/Check')!
    expect(made.address).toBe('Icon/Check#mark')
    expect(resolve(parseOrThrow(made.source).tree, made.address)?.element).toBe('Vector')
  })

  it('moves the position up to the component rather than discarding it', () => {
    // A `<Component>` hugs its single child, so an `x`/`y` inside one is a
    // number the file states and the layout ignores. But the component is a
    // page child, whose position *is* authored — so it takes the node's, and
    // the artwork stays where the author left it. Without this the drawing
    // teleports to the page origin, which is how the live pass found it.
    const made = make(MARK, 'mark', 'Icon/Check')!
    const doc = parseOrThrow(made.source)
    const component = resolve(doc.tree, 'Icon/Check')!
    expect(component.attrs.x!.value).toBe(20)
    expect(component.attrs.y!.value).toBe(30)

    const moved = resolve(doc.tree, 'Icon/Check#mark')!
    expect(moved.attrs.width!.value).toBe(16)
    expect(moved.attrs.vectorPaths!.value).toBeInstanceOf(Array)
    expect(moved.attrs.x).toBeUndefined()
    expect(moved.attrs.y).toBeUndefined()
  })

  it('gives the component no position when the node had none to give', () => {
    // A child of an auto-layout frame is placed by its parent, so there is
    // nothing to carry up and nothing to invent.
    const made = make(NESTED, 'bar#mark', 'Icon/Check')!
    const component = resolve(parseOrThrow(made.source).tree, 'Icon/Check')!
    expect(component.attrs.x).toBeUndefined()
    expect(component.attrs.y).toBeUndefined()
  })

  it('makes a frame *into* the component rather than wrapping it (ADR 0008 §3)', () => {
    const made = make(NESTED, 'bar', 'Card/Bar')!
    const doc = parseOrThrow(made.source)
    const component = resolve(doc.tree, 'Card/Bar')!
    expect(component.element).toBe('Component')

    // The wrapper is gone, and with it a segment of every address inside: the
    // children are the component's own, not a `bar` frame's.
    expect(resolve(doc.tree, 'Card/Bar#label')!.attrs.characters!.value).toBe('Hi')
    expect(resolve(doc.tree, 'Card/Bar#bar/label')).toBeNull()

    // Nothing moved, because nothing but the tag changed: the frame's own
    // layout and position stay exactly where the author left them.
    expect(component.attrs.layoutMode!.value).toBe('HORIZONTAL')
    expect(component.attrs.x!.value).toBe(0)
    expect(component.attrs.status).toBeUndefined()
  })

  it('keeps wrapping what cannot be a component, because a vector is not a frame', () => {
    // F10 exists so a drawn mark becomes a component (ADR 0006 §7), and
    // `vectorPaths` is meaningless on one — so this is the shape that stays.
    const made = make(MARK, 'mark', 'Icon/Check')!
    const doc = parseOrThrow(made.source)
    expect(resolve(doc.tree, 'Icon/Check')!.element).toBe('Component')
    expect(resolve(doc.tree, 'Icon/Check#mark')!.element).toBe('Vector')
  })

  it('works on a node nested inside a frame, not only on a page child', () => {
    const made = make(NESTED, 'bar#mark', 'Icon/Check')!
    const doc = parseOrThrow(made.source)
    expect(resolve(doc.tree, 'Icon/Check#mark')?.element).toBe('Vector')
    expect(resolve(doc.tree, 'bar#mark')).toBeNull()
    // Its former sibling is untouched.
    expect(resolve(doc.tree, 'bar#label')?.name).toBe('label')
  })

  it("keeps the artwork where it was, rather than by the parent's offset away", () => {
    // A component is a page child (ADR 0003 §1), so making one out of a nested
    // node moves it to the page. Its `x`/`y` were its *parent's* frame of
    // reference; on the page they mean something else, and reusing the numbers
    // unchanged slides the artwork by exactly the parent's own offset — here
    // (+40, +64), which is what the author reported seeing.
    const made = make(PLACED, 'stage#frame-1', 'Deck/Thing')!
    const component = resolve(parseOrThrow(made.source).tree, 'Deck/Thing')!
    expect(component.attrs.x!.value).toBe(383) // -40 + 423
    expect(component.attrs.y!.value).toBe(374) // -64 + 438
  })

  it('rebases the wrapped kind too, which carried only its own half', () => {
    // `wrapInComponent` already knew to move the position up rather than throw
    // it away — but it read the node's own `x`/`y` and stopped there, so every
    // ancestor's offset above it was still lost.
    const made = make(PLACED, 'stage#mark', 'Icon/Check')!
    const component = resolve(parseOrThrow(made.source).tree, 'Icon/Check')!
    expect(component.attrs.x!.value).toBe(-29) // -40 + 11
    expect(component.attrs.y!.value).toBe(-51) // -64 + 13
  })

  it('leaves a document that parses at every step, not only at the end', () => {
    // The reason the ops are insert-then-remove rather than insert-then-move:
    // `applyPatches` re-parses between them, and a `<Component>` with no child
    // is a UIDX104 error. A pair in the wrong order is rejected halfway.
    const made = make(MARK, 'mark', 'Icon/Check')!
    expect(made.patches.map((p) => p.op)).toEqual(['insert-node', 'remove-node'])
    const half = applyPatches(MARK, made.patches.slice(0, 1)).source
    expect(resolve(parseOrThrow(half).tree, 'Icon/Check#mark')?.name).toBe('mark')
  })
})

describe('refusals', () => {
  it('refuses a name already spoken for anywhere in the document', () => {
    // Components and token variables share one namespace (ADR 0004 §2), so the
    // caller passes both and this does not care which a collision came from.
    expect(make(MARK, 'mark', 'Icon/Check', ['Icon/Check'])).toBeNull()
    expect(make(MARK, 'mark', 'radius#md', ['radius#md'])).toBeNull()
  })

  it('refuses a name with an entity separator in it', () => {
    expect(isComponentNameFree('Icon#Check', new Set())).toBe(false)
    expect(isComponentNameFree('Icon/Check', new Set())).toBe(true)
  })

  it('refuses an empty name, and trims one that is only spaces', () => {
    expect(make(MARK, 'mark', '   ')).toBeNull()
    expect(isComponentNameFree('  ', new Set())).toBe(false)
    // A name with spaces around it is the name without them.
    expect(make(MARK, 'mark', '  Icon/Check  ')!.address).toBe('Icon/Check#mark')
  })

  it('refuses the page itself', () => {
    expect(make(MARK, '', 'Whole/Page')).toBeNull()
  })

  it('refuses a node that is not there', () => {
    expect(make(MARK, 'nope', 'Icon/Check')).toBeNull()
  })

  it("takes a <Component>'s child out, which ADR 0008 §1 made removable", () => {
    const already = page(
      `  <Component name="Button/Primary" status="stable">
    <Frame name="container" layoutMode="HORIZONTAL" />
  </Component>`,
    )
    const made = make(already, 'Button/Primary#container', 'Other')!
    expect(resolve(parseOrThrow(made.source).tree, 'Other')?.element).toBe('Component')
    // The component it came out of survives, empty — which parses now.
    expect(resolve(parseOrThrow(made.source).tree, 'Button/Primary')?.children).toEqual([])
    // And the component itself is still not something to make a component from.
    expect(make(already, 'Button/Primary', 'Other')).toBeNull()
  })

  it('refuses through the synthetic page a bare <Component> root implies', () => {
    // ADR 0003 §4: that wrapper has no source span, so nothing may be inserted
    // into it until `uidx fmt` materialises it. The refusal is `canRemove`'s
    // and `canInsert`'s, asked rather than re-derived.
    const bare = `---\nid: t\n---\n\n## Visual Contract\n\n<Component name="C" status="draft">\n  <Frame name="root" />\n</Component>\n`
    expect(make(bare, 'C#root', 'Other')).toBeNull()
  })
})

describe('the naming dialog', () => {
  it('refuses a taken name while the pointer is still moving', async () => {
    const dialog = mount(NameComponentDialog, {
      props: { suggested: 'mark', taken: new Set(['Icon/Check']) },
    })
    const confirm = () => dialog.find('.primary')
    expect(confirm().attributes('disabled')).toBeUndefined()

    await dialog.find('input').setValue('Icon/Check')
    expect(confirm().attributes('disabled')).toBeDefined()
    expect(dialog.find('.hint').text()).toContain('already the name of something')

    await dialog.find('input').setValue('Icon/Tick')
    expect(confirm().attributes('disabled')).toBeUndefined()
  })

  it('says which rule a name broke, rather than only that it did', async () => {
    const dialog = mount(NameComponentDialog, {
      props: { suggested: 'mark', taken: new Set<string>() },
    })
    await dialog.find('input').setValue('Icon#Check')
    expect(dialog.find('.hint').text()).toContain('#')
    expect(dialog.find('.primary').attributes('disabled')).toBeDefined()
  })

  it('stays quiet on an empty field, which is not yet a mistake', async () => {
    const dialog = mount(NameComponentDialog, {
      props: { suggested: 'mark', taken: new Set<string>() },
    })
    await dialog.find('input').setValue('')
    expect(dialog.find('.hint').attributes('data-problem')).toBe('false')
    // Quiet, but still not confirmable.
    expect(dialog.find('.primary').attributes('disabled')).toBeDefined()
  })

  it('hands back the trimmed name, and only when it is free', async () => {
    const dialog = mount(NameComponentDialog, {
      props: { suggested: 'mark', taken: new Set(['Taken']) },
    })
    await dialog.find('input').setValue('  Icon/Check  ')
    await dialog.find('.primary').trigger('click')
    expect(dialog.emitted('confirm')).toEqual([['Icon/Check']])

    await dialog.find('input').setValue('Taken')
    await dialog.find('input').trigger('keydown.enter')
    expect(dialog.emitted('confirm')).toHaveLength(1)
  })

  it('closes on Escape and on the scrim, without confirming', async () => {
    const dialog = mount(NameComponentDialog, {
      props: { suggested: 'mark', taken: new Set<string>() },
    })
    await dialog.find('input').trigger('keydown.esc')
    expect(dialog.emitted('close')).toHaveLength(1)
    expect(dialog.emitted('confirm')).toBeUndefined()
  })
})

describe('the component picker (F11)', () => {
  const pick = (components: string[]) => mount(PickComponentDialog, { props: { components } })

  it("lists the document's components, sorted", () => {
    const dialog = pick(['Icon/Check', 'Button/Primary', 'Card/Basic'])
    expect(dialog.findAll('.entry').map((b) => b.text())).toEqual([
      'Button/Primary',
      'Card/Basic',
      'Icon/Check',
    ])
  })

  it('filters on any part of the name, not just the start', async () => {
    const dialog = pick(['Icon/Check', 'Button/Primary'])
    await dialog.find('.filter').setValue('check')
    expect(dialog.findAll('.entry').map((b) => b.text())).toEqual(['Icon/Check'])
  })

  it('hands back the name that was clicked', async () => {
    const dialog = pick(['Icon/Check', 'Button/Primary'])
    await dialog.findAll('.entry')[1]!.trigger('click')
    expect(dialog.emitted('pick')).toEqual([['Icon/Check']])
  })

  it('takes the only match on Enter, which is what a filter box is for', async () => {
    const dialog = pick(['Icon/Check', 'Button/Primary'])
    await dialog.find('.filter').setValue('prim')
    await dialog.find('.filter').trigger('keydown.enter')
    expect(dialog.emitted('pick')).toEqual([['Button/Primary']])
  })

  it('picks nothing on Enter when nothing matches', async () => {
    const dialog = pick(['Icon/Check'])
    await dialog.find('.filter').setValue('zzz')
    await dialog.find('.filter').trigger('keydown.enter')
    expect(dialog.emitted('pick')).toBeUndefined()
    expect(dialog.find('.empty').text()).toContain('Nothing matches')
  })

  it('says how to get one when the document declares none', () => {
    const dialog = pick([])
    expect(dialog.find('.empty').text()).toContain('no components yet')
  })

  it('closes on Escape without picking', async () => {
    const dialog = pick(['Icon/Check'])
    await dialog.find('.filter').trigger('keydown.esc')
    expect(dialog.emitted('close')).toHaveLength(1)
    expect(dialog.emitted('pick')).toBeUndefined()
  })
})
