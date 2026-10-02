import { describe, expect, it } from 'vitest'
import { parseOrThrow } from '@uidx/format'
import { cssDeclarations, generate } from '../src/index.js'
import { CHECKBOX, FIELD } from './fixtures.js'

/**
 * ADR 0018 §6: every generated component reads its outer box through
 * `--uidx-*` custom properties. The resting rules read them with the
 * component's own value as the fallback, so nothing renders differently until
 * a use sets one; the state rules stay literal, so a state still wins over the
 * use; and a nested instance sets the hooks in `style`.
 */

/** Button1, as the design-system example draws it: a pill with a hover row. */
const BUTTON1 = parseOrThrow(`---
id: button1
---

## Visual Contract

<Page>
  <Component name="Button1" status="draft"
    layoutMode="HORIZONTAL" primaryAxisSizingMode="AUTO" counterAxisSizingMode="AUTO"
    primaryAxisAlignItems="CENTER" counterAxisAlignItems="CENTER"
    paddingLeft={12} paddingRight={12} paddingTop={8} paddingBottom={8} cornerRadius={999}
    fills={[{ opacity: 1, visible: true, type: 'SOLID', color: { r: 0, g: 0.3333, b: 1, a: 1 } }]}>
    <Text name="label" characters="{label}" fontSize={14} />
  </Component>
</Page>

<Styles>
  <Style state="hover" root:fills={[{ opacity: 1, visible: true, type: 'SOLID', color: { r: 0.3678, g: 0.5744, b: 0.9875, a: 1 } }]} />
</Styles>

## Contract

<Props>
  <Prop name="label" type="string" sample="Button1">The words it shows.</Prop>
</Props>
`)

/** The example's Button, trimmed: enum rows, state rows, and a label part with its own colour. */
const BUTTON = parseOrThrow(`---
id: button
---

## Visual Contract

<Page>
  <Component name="Button" status="stable" implements="hwc-button"
    layoutMode="HORIZONTAL" primaryAxisSizingMode="AUTO" counterAxisSizingMode="AUTO"
    paddingLeft="{space#md}" paddingRight="{space#md}" paddingTop="{space#sm}" paddingBottom="{space#sm}"
    cornerRadius="{radius#md}" fills="{surface#accent}" strokes="{surface#accent}" strokeWeight={1}>
    <Text name="label" part="label" characters="{label}" fontSize={14} fills="{text#onAccent}" />
  </Component>
</Page>

<Styles>
  <Style variant="secondary" root:fills="{surface#raised}" root:strokes="{border#default}" label:fills="{text#default}" />
  <Style size="small" root:paddingLeft="{space#sm}" root:paddingRight="{space#sm}" label:fontSize={12} />
  <Style state="hover" root:fills="{surface#accentHover}" root:strokes="{surface#accentHover}" />
  <Style state="hover" variant="secondary" root:fills="{surface#raised}" label:fills="{text#strong}" />
  <Style state="focus" root:strokes="{border#focus}" />
  <Style state="disabled" root:opacity="{opacity#disabled}" />
</Styles>

## Contract

<Props>
  <Prop name="label" type="string" sample="Save">The words.</Prop>
  <Prop name="variant" type="'primary' | 'secondary'" default="primary" visual>Emphasis.</Prop>
  <Prop name="size" type="'small' | 'medium'" default="medium" visual>Size.</Prop>
  <Prop name="disabled" type="boolean" default={false} visual>Inert and dimmed.</Prop>
</Props>
`)

/** A component of one page, placing whatever `body` holds. */
function page(id: string, name: string, body: string, attrs = 'layoutMode="VERTICAL"'): string {
  return `---
id: ${id}
---

## Visual Contract

<Page>
  <Component name="${name}" status="draft" ${attrs}>
${body}
  </Component>
</Page>

## Contract

<Props>
  <Prop name="title" type="string" sample="Hi">Words.</Prop>
</Props>
`
}

function run(pages: Record<string, string | ReturnType<typeof parseOrThrow>>) {
  return generate({
    pages: Object.entries(pages).map(([file, doc]) => ({
      file: `${file}.uidx`,
      doc: typeof doc === 'string' ? parseOrThrow(doc) : doc,
    })),
    tokens: [],
    targets: ['html'],
  }).files
}

/** The body of the rule whose selector is exactly `selector`, or undefined. */
function rule(css: string, selector: string): string | undefined {
  const start = css.split('\n\n').find((block) => block.startsWith(`${selector} {\n`))
  return start?.slice(selector.length + 3, start.lastIndexOf('\n}'))
}

const files = run({ button1: BUTTON1, button: BUTTON })
const button1 = files.get('html/button1.css')!
const button = files.get('html/button.css')!

describe('the resting rule of the box reads the hooks', () => {
  const root = rule(button1, '.button1')!

  it("wraps each box declaration in its hook, with the component's own value as the fallback", () => {
    expect(root).toContain('  background-color: var(--uidx-fill, rgb(0 85 255));')
    expect(root).toContain('  padding-left: var(--uidx-padding-left, 12px);')
    expect(root).toContain('  padding-top: var(--uidx-padding-top, 8px);')
  })

  it('reads a corner through its own hook, falling back to the shorthand hook (ADR 0018 §5)', () => {
    for (const corner of ['top-left', 'top-right', 'bottom-right', 'bottom-left'])
      expect(root).toContain(
        `  border-${corner}-radius: var(--uidx-radius-${corner}, var(--uidx-radius, 999px));`,
      )
    expect(root).not.toMatch(/^ {2}border-radius:/m)
  })

  it('reads what the component leaves unset with a value that draws nothing', () => {
    expect(root).toContain('  border-style: var(--uidx-stroke-style, none);')
    expect(root).toContain('  border-color: var(--uidx-stroke, transparent);')
    // A stroke a use adds draws at Figma's default weight, as on the canvas.
    expect(root).toContain(
      '  border-top-width: var(--uidx-stroke-top-weight, var(--uidx-stroke-weight, 1px));',
    )
    expect(root).toContain('  opacity: var(--uidx-opacity, 1);')
    expect(root).toContain('  box-shadow: var(--uidx-shadow, none);')
  })

  it('resets every box hook on the root, so none leaks into a nested component', () => {
    expect(root).toContain('  --uidx-fill: initial;')
    expect(root).toContain('  --uidx-stroke-style: initial;')
    expect(root).toContain('  --uidx-radius-top-left: initial;')
    expect(root).toContain('  --uidx-padding-left: initial;')
    expect(root).toContain('  --uidx-shadow: initial;')
    // Text colour inherits: that is the cascade (ADR 0018 §4).
    expect(button1).not.toContain('--uidx-text-color: initial')
  })

  it('takes a side weight from its own hook, then the shorthand hook, then the side', () => {
    const css = cssDeclarations(
      {
        strokes: [{ type: 'SOLID', color: '{color#text}' }],
        strokeWeight: 1,
        strokeTopWeight: 2,
      },
      'container',
    )
    // The uniform weight, then the side that has its own: the longhand wins.
    expect(css['border-width']).toBe('1px')
    expect(css['border-top-width']).toBe('2px')
    const doc = page(
      'framed',
      'Framed',
      '',
      `layoutMode="HORIZONTAL" strokes={[{ type: 'SOLID', color: '{color#text}' }]} strokeWeight={1} strokeTopWeight={2}`,
    )
    const root = rule(run({ framed: doc }).get('html/framed.css')!, '.framed')!
    expect(root).toContain(
      '  border-top-width: var(--uidx-stroke-top-weight, var(--uidx-stroke-weight, 2px));',
    )
    expect(root).toContain(
      '  border-right-width: var(--uidx-stroke-right-weight, var(--uidx-stroke-weight, 1px));',
    )
    expect(root).toContain('  border-style: var(--uidx-stroke-style, solid);')
    expect(root).toContain('  border-color: var(--uidx-stroke, var(--color-text));')
  })

  it('reads padding only on a box that lays out, where padding insets anything', () => {
    const root = rule(files.get('html/button1.css')!, '.button1')!
    expect(root).toContain('padding-right: var(--uidx-padding-right, 12px)')
    const still = page('still', 'Still', '', 'width={40} height={40}')
    expect(rule(run({ still }).get('html/still.css')!, '.still')).not.toMatch(/^ {2}padding-/m)
  })

  it('reads padding on a component that declares no geometry, which the canvas draws as a column', () => {
    const bare = page('bare', 'Bare', '    <Text name="words" characters="Bare" />', '')
    const root = rule(run({ bare }).get('html/bare.css')!, '.bare')!
    expect(root).toContain('  flex-direction: column;')
    for (const side of ['top', 'right', 'bottom', 'left'])
      expect(root).toContain(`  padding-${side}: var(--uidx-padding-${side}, 0px);`)
    // So does a styles table's root on the canvas, which says what its
    // component does: a hugging column, where a use's padding insets.
    const styled = `---
id: styled
---

## Visual Contract

<Page>
  <Component name="Styled" status="draft">
    <Text name="words" characters="Styled" />
  </Component>
</Page>

<Styles>
  <Style state="hover" root:opacity={0.5} />
</Styles>

## Contract

<Props>
  <Prop name="title" type="string" sample="Hi">Words.</Prop>
</Props>
`
    const styledRoot = rule(run({ styled }).get('html/styled.css')!, '.styled')!
    for (const side of ['top', 'right', 'bottom', 'left'])
      expect(styledRoot).toContain(`  padding-${side}: var(--uidx-padding-${side}, 0px);`)
  })
})

describe('the rows of the styles table', () => {
  it('leaves a state row literal, so the state wins over a use (ADR 0018 §3)', () => {
    expect(rule(button1, '.button1:hover')).toBe('  background-color: rgb(94 146 252);')
    expect(rule(button, 'hwc-button[disabled]')).toBe('  opacity: var(--opacity-disabled);')
  })

  it("wraps an enum row in the hooks: it is the component's resting look for that value", () => {
    expect(rule(button, 'hwc-button[variant="secondary"]')).toBe(
      [
        '  background-color: var(--uidx-fill, var(--surface-raised));',
        '  border-style: var(--uidx-stroke-style, solid);',
        '  border-color: var(--uidx-stroke, var(--border-default));',
      ].join('\n'),
    )
    expect(rule(button, 'hwc-button[size="small"]')).toBe(
      [
        '  padding-left: var(--uidx-padding-left, calc(var(--space-sm) * 1px));',
        '  padding-right: var(--uidx-padding-right, calc(var(--space-sm) * 1px));',
      ].join('\n'),
    )
    // A property no use can set stays as it was.
    expect(rule(button, 'hwc-button[size="small"] hwc-button-label')).toBe('  font-size: 12px;')
  })

  it("draws a strokes-only row's border in the colour and style alone, keeping the base weight", () => {
    expect(rule(button, 'hwc-button:focus-visible')).toBe(
      ['  border-style: solid;', '  border-color: var(--border-focus);'].join('\n'),
    )
    expect(rule(button, 'hwc-button:hover')).toBe(
      [
        '  background-color: var(--surface-accentHover);',
        '  border-style: solid;',
        '  border-color: var(--surface-accentHover);',
      ].join('\n'),
    )
  })

  it('gives a stroke a row adds to a node with none the default weight, as before', () => {
    const pill = `---
id: pill
---

## Visual Contract

<Page>
  <Component name="Pill" status="draft" layoutMode="HORIZONTAL">
    <Frame name="ring" part="ring" width={10} height={10} />
  </Component>
</Page>

<Styles>
  <Style state="selected" ring:strokes="{border#focus}" />
</Styles>

## Contract

<Props>
  <Prop name="selected" type="boolean" default={false} visual>On.</Prop>
</Props>
`
    const css = run({ pill }).get('html/pill.css')!
    expect(rule(css, '.pill[data-selected] [data-part="ring"]')).toBe(
      [
        '  border-style: solid;',
        '  border-color: var(--border-focus);',
        '  border-width: 1px;',
      ].join('\n'),
    )
  })
})

describe('text colour', () => {
  it('reads --uidx-text-color in resting rules, over the colour the text states', () => {
    expect(rule(button, 'hwc-button hwc-button-label')).toBe(
      ['  font-size: 14px;', '  color: var(--uidx-text-color, var(--text-onAccent));'].join('\n'),
    )
    expect(rule(button, 'hwc-button[variant="secondary"] hwc-button-label')).toBe(
      '  color: var(--uidx-text-color, var(--text-default));',
    )
  })

  it('stays literal in a state row', () => {
    expect(rule(button, 'hwc-button:hover[variant="secondary"] hwc-button-label')).toBe(
      '  color: var(--text-strong);',
    )
  })

  it('gives a text that states no colour the hook alone, so it inherits until a use sets one', () => {
    expect(rule(button1, '.button1 [data-node="label"]')).toBe(
      ['  font-size: 14px;', '  color: var(--uidx-text-color);'].join('\n'),
    )
  })

  /**
   * What a component puts in the slot of an instance it holds is its own
   * content, so its own stylesheet styles it: a text that states fills keeps
   * them as a literal colour, which no use's colour reaches, and one that
   * states none takes the nearest use's (ADR 0018 §4).
   */
  describe('of what a component puts in the slot of an instance it holds', () => {
    const WELL = page(
      'well',
      'Well',
      `    <Text name="heading" characters="{title}" fontSize={14} />
    <Slot name="body" />`,
    )
    const PANEL = page(
      'panel',
      'Panel',
      `    <Instance name="well" component="Well" props={{ title: 'Heading' }} textFills="{text#onAccent}">
      <Slot name="body">
        <Text name="own" characters="Own" fontSize={12} fills="{text#muted}" />
        <Text name="bare" characters="Bare" fontSize={12} />
        <Frame name="row" layoutMode="HORIZONTAL" itemSpacing={4}>
          <Text name="deep" characters="Deep" />
        </Frame>
      </Slot>
    </Instance>`,
    )
    const out = run({ well: WELL, panel: PANEL })
    const css = out.get('html/panel.css')!

    it('keeps fills a text states, as a literal no use’s colour reaches', () => {
      expect(rule(css, '.panel [data-node="own"]')).toBe(
        ['  font-size: 12px;', '  color: var(--text-muted);'].join('\n'),
      )
    })

    it('hands a text that states none the nearest use’s colour, at any depth', () => {
      expect(rule(css, '.panel [data-node="bare"]')).toBe(
        ['  font-size: 12px;', '  color: var(--uidx-text-color);'].join('\n'),
      )
      expect(rule(css, '.panel [data-node="deep"]')).toBe('  color: var(--uidx-text-color);')
      expect(rule(css, '.panel [data-node="row"]')).toContain('  gap: 4px;')
    })

    it('renders that content where those rules find it', () => {
      expect(out.get('html/panel.html')).toMatch(
        /<span data-slot="body">\s+<span data-node="own">Own<\/span>\s+<span data-node="bare">Bare<\/span>/,
      )
    })

    it('leaves an instance there to its own stylesheet', () => {
      const shelf = page(
        'shelf',
        'Shelf',
        `    <Instance name="well" component="Well">
      <Slot name="body"><Instance name="cta" component="Button1" /></Slot>
    </Instance>`,
      )
      const shelfCss = run({ well: WELL, button1: BUTTON1, shelf }).get('html/shelf.css')!
      expect(shelfCss).not.toContain('[data-node="cta"]')
    })
  })

  it('leaves a vector its own colour (ADR 0018 §4)', () => {
    const css = run({ checkbox: CHECKBOX }).get('html/checkbox.css')!
    expect(rule(css, 'hwc-checkbox hwc-checkbox-checked-indicator')).toContain(
      '  color: rgb(255 255 255);',
    )
  })
})

describe('where the box lands (ADR 0018 §2)', () => {
  it('reads the hooks on the frame a bare component wraps, and resets them on the root', () => {
    const card = page(
      'card',
      'Card',
      `    <Frame name="box" layoutMode="VERTICAL" paddingLeft={16} fills={[{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 } }]}>
      <Text name="title" characters="{title}" />
    </Frame>`,
      '',
    )
    const css = run({ card }).get('html/card.css')!
    const root = rule(css, '.card')!
    expect(root).toContain('  --uidx-fill: initial;')
    expect(root).not.toContain('var(--uidx-fill')
    const box = rule(css, '.card [data-node="box"]')!
    expect(box).toContain('  background-color: var(--uidx-fill, rgb(255 255 255));')
    expect(box).toContain('  padding-left: var(--uidx-padding-left, 16px);')
    expect(box).not.toContain('initial')
  })

  describe('around the one instance a component holds', () => {
    const TAG = `---
id: tag
---

## Visual Contract

<Page>
  <Component name="Tag" status="draft">
    <Frame name="box" layoutMode="HORIZONTAL" paddingLeft={6} fills={[{ type: 'SOLID', color: { r: 0, g: 0, b: 1, a: 1 } }]}>
      <Text name="words" characters="Tag" />
    </Frame>
  </Component>
</Page>
`

    it('on a component that lays itself out: its own frame, which it draws as the canvas does', () => {
      const holder = page(
        'holder',
        'Holder',
        '    <Instance name="tag" component="Tag" />',
        'layoutMode="VERTICAL" paddingLeft={4}',
      )
      const use = page(
        'outer',
        'Outer',
        `    <Instance name="held" component="Holder" fills={[{ type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 } }]} paddingLeft={20} />`,
        '',
      )
      const out = run({ tag: TAG, holder, outer: use })
      expect(out.get('html/holder.html')).toMatch(/<div class="holder">\s+<div class="tag">/)
      const root = rule(out.get('html/holder.css')!, '.holder')!
      expect(root).toContain('  padding-left: var(--uidx-padding-left, 4px);')
      expect(root).toContain('  --uidx-fill: initial;')
      // The use restyles Holder's frame; the Tag inside keeps its own box.
      expect(out.get('html/outer.html')).toMatch(
        /<div class="holder" style="--uidx-fill: rgb\(255 0 0\); --uidx-padding-left: 20px">\s+<div class="tag">/,
      )
    })

    it('on a component with a styles table: the instance its root only wraps, as without one', () => {
      const wrapped = `---
id: wrapped
---

## Visual Contract

<Page>
  <Component name="Wrapped" status="draft">
    <Instance name="tag" component="Tag" />
  </Component>
</Page>

<Styles>
  <Style state="hover" root:opacity={0.5} />
</Styles>

## Contract

<Props>
  <Prop name="title" type="string" sample="Hi">Words.</Prop>
</Props>
`
      const use = page(
        'outer',
        'Outer',
        `    <Instance name="held" component="Wrapped" fills={[{ type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 } }]} />`,
        '',
      )
      const out = run({ tag: TAG, wrapped, outer: use })
      expect(out.get('html/wrapped.html')).toMatch(/<div class="wrapped">\s+<div class="tag">/)
      const css = out.get('html/wrapped.css')!
      expect(rule(css, '.wrapped')).not.toContain('var(--uidx-fill')
      expect(rule(css, '.wrapped')).toContain('  --uidx-fill: initial;')
      expect(rule(css, '.wrapped:hover')).toBe('  opacity: 0.5;')
      // The Tag it holds is the box: the use's fill goes on it, and its frame reads it.
      expect(out.get('html/outer.html')).toMatch(
        /<div class="wrapped">\s+<div class="tag" style="--uidx-fill: rgb\(255 0 0\)">/,
      )
    })

    it('on a component that only wraps it in a frame of its own: that instance', () => {
      const shell = page(
        'shell',
        'Shell',
        '    <Instance name="tag" component="Tag" />',
        'layoutMode="HORIZONTAL" primaryAxisSizingMode="AUTO" counterAxisSizingMode="AUTO"',
      )
      const use = page(
        'outer',
        'Outer',
        `    <Instance name="held" component="Shell" fills={[{ type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 } }]} />`,
        '',
      )
      const out = run({ tag: TAG, shell, outer: use })
      // It states a layout, so it renders an element of its own around the Tag.
      expect(out.get('html/shell.html')).toMatch(/<div class="shell">\s+<div class="tag">/)
      expect(out.get('html/outer.html')).toMatch(
        /<div class="shell">\s+<div class="tag" style="--uidx-fill: rgb\(255 0 0\)">/,
      )
      expect(rule(out.get('html/shell.css')!, '.shell')).not.toContain('var(--uidx-fill')
    })
  })

  it('reads the hooks on the frame a component that lays itself out only wraps', () => {
    const plaque = page(
      'plaque',
      'Plaque',
      `    <Frame name="base" layoutMode="HORIZONTAL" primaryAxisSizingMode="AUTO" counterAxisSizingMode="AUTO"
      paddingLeft={12} cornerRadius={6} fills={[{ type: 'SOLID', color: { r: 0, g: 0, b: 1, a: 1 } }]}>
      <Text name="label" characters="{title}" />
    </Frame>`,
      'layoutMode="HORIZONTAL" primaryAxisSizingMode="AUTO" counterAxisSizingMode="AUTO"',
    )
    const css = run({ plaque }).get('html/plaque.css')!
    const root = rule(css, '.plaque')!
    expect(root).toContain('  --uidx-fill: initial;')
    expect(root).not.toContain('var(--uidx-')
    const base = rule(css, '.plaque [data-node="base"]')!
    expect(base).toContain('  background-color: var(--uidx-fill, rgb(0 0 255));')
    expect(base).toContain('  padding-left: var(--uidx-padding-left, 12px);')
    expect(base).toContain('  padding-right: var(--uidx-padding-right, 0px);')
    expect(base).toContain(
      '  border-top-left-radius: var(--uidx-radius-top-left, var(--uidx-radius, 6px));',
    )
    expect(base).toContain('  opacity: var(--uidx-opacity, 1);')
  })

  it('reads on a shadow part a host only wraps the hooks whose property the design sets there', () => {
    const doc = parseOrThrow(`---
id: button
---

## Visual Contract

<Page>
  <Component name="Button" status="stable" implements="sl-button"
    layoutMode="HORIZONTAL" primaryAxisSizingMode="AUTO" counterAxisSizingMode="AUTO">
    <Frame name="base" part="base" layoutMode="HORIZONTAL" primaryAxisSizingMode="AUTO" counterAxisSizingMode="AUTO"
      paddingLeft="{space#lg}" cornerRadius="{radius#md}" fills="{color#accent}" strokes="{color#accent}" strokeWeight={1}>
      <Slot name="default">
        <Text name="text" characters="{label}" fills="{color#on-accent}" />
      </Slot>
    </Frame>
  </Component>
</Page>

<Styles>
  <Style variant="neutral" base:fills="{color#surface-raised}" />
  <Style state="hover" base:fills="{color#accent-hover}" />
  <Style state="disabled" root:opacity="{opacity#disabled}" />
</Styles>

## Contract

<Props>
  <Prop name="label" type="string" sample="Save">Words.</Prop>
  <Prop name="variant" type="'primary' | 'neutral'" default="primary" visual>Emphasis.</Prop>
  <Prop name="disabled" type="boolean" default={false} visual>Inert.</Prop>
</Props>
<Parts>
  <Part name="base">The button's box.</Part>
</Parts>
`)
    const css = generate({
      pages: [{ file: 'button.uidx', doc }],
      manifest: {
        modules: [{ declarations: [{ tagName: 'sl-button', cssParts: [{ name: 'base' }] }] }],
      },
      targets: ['html'],
    }).files.get('html/button.css')!
    const host = rule(css, 'sl-button')!
    expect(host).toContain('  --uidx-fill: initial;')
    expect(host).not.toContain('var(--uidx-')
    const base = rule(css, 'sl-button::part(base)')!
    expect(base).toContain('  background-color: var(--uidx-fill, var(--color-accent));')
    expect(base).toContain('  border-color: var(--uidx-stroke, var(--color-accent));')
    expect(base).toContain('  padding-left: var(--uidx-padding-left, calc(var(--space-lg) * 1px));')
    expect(base).toContain(
      '  border-top-left-radius: var(--uidx-radius-top-left, var(--uidx-radius, calc(var(--radius-md) * 1px)));',
    )
    // The library styles its own part: no fallback the design never asked for.
    expect(base).not.toMatch(/^ {2}(box-shadow|opacity|padding-right):/m)
    expect(rule(css, 'sl-button[variant="neutral"]::part(base)')).toBe(
      '  background-color: var(--uidx-fill, var(--color-surface-raised));',
    )
    expect(rule(css, 'sl-button:hover::part(base)')).toBe(
      '  background-color: var(--color-accent-hover);',
    )
  })

  it('reads on a shadow host only the hooks whose property the design sets', () => {
    const doc = parseOrThrow(`---
id: chip
---

## Visual Contract

<Page>
  <Component name="Chip" status="stable" implements="sl-tag" layoutMode="HORIZONTAL" fills="{surface#accent}">
    <Frame name="base" part="base" width={10} height={10} />
    <Text name="label" characters="{label}" />
  </Component>
</Page>

## Contract

<Props>
  <Prop name="label" type="string">Words.</Prop>
</Props>
`)
    const css = generate({
      pages: [{ file: 'chip.uidx', doc }],
      manifest: {
        modules: [{ declarations: [{ tagName: 'sl-tag', cssParts: [{ name: 'base' }] }] }],
      },
      targets: ['html'],
    }).files.get('html/chip.css')!
    const root = rule(css, 'sl-tag')!
    expect(root).toContain('  background-color: var(--uidx-fill, var(--surface-accent));')
    expect(root).toContain('  --uidx-fill: initial;')
    // The library styles its own host: no fallback the design never asked for.
    expect(root).not.toMatch(/^ {2}(box-shadow|border-style|opacity|padding-left):/m)
    expect(rule(css, 'sl-tag [data-node="label"]')).toBeUndefined()
  })
})

describe('a nested instance sets the hooks in style', () => {
  const STYLED = page(
    'toolbar',
    'Toolbar',
    `    <Instance name="delete" component="Button1" props={{ label: 'Delete' }} width={199}
      fills="{surface#danger}" strokes="{border#danger}" strokeWeight={2} cornerRadius={4}
      paddingLeft="{space#lg}" opacity={0.5} strokeAlign="OUTSIDE" cornerSmoothing={0.6}
      effects={[{ type: 'DROP_SHADOW', color: { r: 0, g: 0, b: 0, a: 0.25 }, offset: { x: 0, y: 2 }, radius: 4, spread: 0, visible: true }]}
      textFills="{text#onAccent}" />`,
    '',
  )

  it('carries only the stated box, tokens as their variables, and the stated size', () => {
    const html = run({ button1: BUTTON1, toolbar: STYLED }).get('html/toolbar.html')!
    expect(html).toContain(
      `<div class="button1" style="${[
        '--uidx-fill: var(--surface-danger)',
        '--uidx-stroke: var(--border-danger)',
        '--uidx-stroke-style: solid',
        '--uidx-stroke-weight: 2px',
        '--uidx-radius: 4px',
        '--uidx-padding-left: calc(var(--space-lg) * 1px)',
        '--uidx-opacity: 0.5',
        '--uidx-shadow: 0px 2px 4px 0px rgb(0 0 0 / 0.25)',
        '--uidx-text-color: var(--text-onAccent)',
        'width: 199px',
      ].join('; ')}">`,
    )
  })

  it('never emits a locked attribute', () => {
    const locked = page(
      'locked',
      'Locked',
      `    <Instance name="b" component="Button1" layoutMode="VERTICAL" itemSpacing={4} clipsContent={true}
      primaryAxisAlignItems="MAX" strokeCap="ROUND" fontSize={20} fills="{surface#danger}" />`,
      '',
    )
    const out = run({ button1: BUTTON1, locked })
    expect(out.get('html/locked.html')).toContain(
      '<div class="button1" style="--uidx-fill: var(--surface-danger)">',
    )
    expect(out.get('html/locked.css')).not.toMatch(/gap|flex-end|overflow|font-size: 20px/)
  })

  it('writes an explicit none, a dashed stroke, and drops a binding (ADR 0018 §5)', () => {
    const doc = page(
      'plain',
      'Plain',
      `    <Instance name="b" component="Button1" fills={[]} effects={[]} strokes={[{ type: 'SOLID', color: { r: 0, g: 0, b: 0, a: 1 } }]} dashPattern={[4, 2]} />
    <Instance name="c" component="Button1" fills="{title}" strokes={[]} paddingTop="{title}" />`,
      '',
    )
    const html = run({ button1: BUTTON1, plain: doc }).get('html/plain.html')!
    expect(html).toContain(
      '<div class="button1" style="--uidx-fill: transparent; --uidx-shadow: none; --uidx-stroke: rgb(0 0 0); --uidx-stroke-style: dashed">',
    )
    expect(html).toContain('<div class="button1" style="--uidx-stroke-style: none">')
  })

  it('fixes only the dimensions the instance fixes: a stretch fills its axis', () => {
    const doc = page(
      'column',
      'Column',
      `    <Instance name="b" component="Button1" width={199} height={33} layoutAlign="STRETCH" />`,
    )
    expect(run({ button1: BUTTON1, column: doc }).get('html/column.html')).toContain(
      '<div class="button1" style="height: 33px">',
    )
  })

  it("passes a composition's box to the instance it holds, over what the definition wrote there", () => {
    const composed = parseOrThrow(`---
id: checkbox-field
---

## Visual Contract

<Page>
  <Component name="CheckboxField" status="stable">
    <Instance name="field" component="Field" fills="{surface#control}" topLeftRadius={2} props={{ label: '{label}' }}>
      <Slot name="control"><Instance name="box" component="Checkbox" /></Slot>
    </Instance>
  </Component>
</Page>

## Contract

<Props>
  <Prop name="label" type="string" sample="Remember me">The option's name.</Prop>
</Props>
<Composes with="Field, Checkbox" />
`)
    const form = page(
      'signup',
      'Signup',
      `    <Instance name="agree" component="CheckboxField" props={{ label: 'Agree' }}
      fills="{surface#accent}" cornerRadius={6} textFills="{text#onAccent}" width={300} />`,
    )
    const out = run({ checkbox: CHECKBOX, field: FIELD, 'checkbox-field': composed, signup: form })
    expect(out.get('html/checkbox-field.html')).toContain(
      '<hwc-field style="--uidx-fill: var(--surface-control); --uidx-radius-top-left: 2px">',
    )
    // The use's cornerRadius drops the definition's corner, as a shorthand does.
    expect(out.get('html/signup.html')).toContain(
      '<hwc-field style="--uidx-fill: var(--surface-accent); --uidx-radius: 6px; --uidx-text-color: var(--text-onAccent); width: 300px">',
    )
    // The checkbox inside keeps its own box: it states none.
    expect(out.get('html/signup.html')).toContain('<hwc-checkbox>')
  })
})
