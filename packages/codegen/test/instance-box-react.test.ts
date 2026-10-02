import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { CODES, parseOrThrow } from '@uidx/format'
import { generate, type GenerateInput } from '../src/index.js'
import { CHECKBOX, FIELD, MANIFEST } from './fixtures.js'

/**
 * ADR 0018 §6 in the React target. A nested instance hands the component the
 * outer box it states, and the size it fixes, as `style`: the `--uidx-*`
 * hooks, which the component's root takes and its stylesheet reads. A
 * composition passes its consumer's style on to the instance it renders as,
 * over what the definition wrote there. The CEM lists the hooks each element
 * reads, and a component mapped onto a React library takes none, which the
 * generator says.
 */

/** Button1, as the design-system example draws it: a pill with a hover row. */
const BUTTON1 = `---
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
`

/** A component of one page holding whatever `body` holds. */
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

function run(
  pages: Record<string, string | ReturnType<typeof parseOrThrow>>,
  extra: Partial<GenerateInput> = {},
) {
  return generate({
    pages: Object.entries(pages).map(([file, doc]) => ({
      file: `${file}.uidx`,
      doc: typeof doc === 'string' ? parseOrThrow(doc) : doc,
    })),
    tokens: [],
    targets: ['html', 'react'],
    ...extra,
  })
}

/** The declarations of an HTML `style="…"` attribute, in order. */
function htmlStyle(html: string, open: string): [string, string][] {
  const found = new RegExp(`${open} style="([^"]*)"`).exec(html)
  if (!found) throw new Error(`no ${open} with a style in\n${html}`)
  return found[1]!.split('; ').map((entry) => {
    const at = entry.indexOf(': ')
    return [entry.slice(0, at), entry.slice(at + 2)]
  })
}

/** A function the generated module defines, compiled as the consumer's bundler would, ready to call. */
function generatedFunction(tsx: string, name: string): (...args: unknown[]) => unknown {
  const source = new RegExp(`^function ${name}\\([\\s\\S]*?^}`, 'm').exec(tsx)?.[0]
  if (!source) throw new Error(`no function ${name} in\n${tsx}`)
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  })
  return new Function(`${outputText}\nreturn ${name}`)() as (...args: unknown[]) => unknown
}

/** The entries of a React `style={{ … } as CSSProperties}` on the element `open`, in order. */
function reactStyle(tsx: string, open: string): [string, string][] {
  const found = new RegExp(`${open}[^\\n]*? style=\\{\\{ (.*?) \\} as CSSProperties\\}`).exec(tsx)
  if (!found) throw new Error(`no ${open} with a style in\n${tsx}`)
  return [...found[1]!.matchAll(/'?([\w-]+)'?: '((?:[^'\\]|\\.)*)'/g)].map((entry) => [
    entry[1]!,
    entry[2]!,
  ])
}

describe('a nested instance hands its outer box to the component as style', () => {
  it('carries the hooks it states, tokens as their variables, and the size it fixes', () => {
    const toolbar = page(
      'toolbar',
      'Toolbar',
      `    <Instance name="delete" component="Button1" props={{ label: 'Delete' }} width={199} fills="{surface#danger}" />`,
      'layoutMode="HORIZONTAL"',
    )
    const tsx = run({ button1: BUTTON1, toolbar }).files.get('react/Toolbar.tsx')!
    expect(tsx).toContain(
      `<Button1 label="Delete" style={{ '--uidx-fill': 'var(--surface-danger)', width: '199px' } as CSSProperties} />`,
    )
  })

  it('says exactly what the HTML target says, hook for hook', () => {
    const toolbar = page(
      'toolbar',
      'Toolbar',
      `    <Instance name="delete" component="Button1" props={{ label: 'Delete' }} width={199}
      fills="{surface#danger}" strokes="{border#danger}" strokeWeight={2} cornerRadius={4}
      paddingLeft="{space#lg}" opacity={0.5} strokeAlign="OUTSIDE" cornerSmoothing={0.6}
      effects={[{ type: 'DROP_SHADOW', color: { r: 0, g: 0, b: 0, a: 0.25 }, offset: { x: 0, y: 2 }, radius: 4, spread: 0, visible: true }]}
      textFills="{text#onAccent}" />`,
      'layoutMode="HORIZONTAL"',
    )
    const { files } = run({ button1: BUTTON1, toolbar })
    const react = reactStyle(files.get('react/Toolbar.tsx')!, '<Button1')
    expect(react).toEqual(htmlStyle(files.get('html/toolbar.html')!, '<div class="button1"'))
    expect(react.map(([prop]) => prop)).toEqual([
      '--uidx-fill',
      '--uidx-stroke',
      '--uidx-stroke-style',
      '--uidx-stroke-weight',
      '--uidx-radius',
      '--uidx-padding-left',
      '--uidx-opacity',
      '--uidx-shadow',
      '--uidx-text-color',
      'width',
    ])
  })

  it('carries no style for an instance that states no box and fixes no size', () => {
    const toolbar = page(
      'toolbar',
      'Toolbar',
      `    <Instance name="plain" component="Button1" props={{ label: 'Plain' }} x={4} y={4} />`,
      'layoutMode="HORIZONTAL"',
    )
    const tsx = run({ button1: BUTTON1, toolbar }).files.get('react/Toolbar.tsx')!
    expect(tsx).toContain('<Button1 label="Plain" />')
  })

  it('never writes a locked attribute, a binding, or a size the parent fills', () => {
    const column = page(
      'column',
      'Column',
      `    <Instance name="b" component="Button1" layoutMode="VERTICAL" itemSpacing={4} clipsContent={true}
      strokeCap="ROUND" fontSize={20} fills="{title}" layoutAlign="STRETCH" width={199} height={33} />`,
    )
    const tsx = run({ button1: BUTTON1, column }).files.get('react/Column.tsx')!
    expect(tsx).toContain(`<Button1 style={{ height: '33px' } as CSSProperties} />`)
  })

  it('styles an instance a slot fill holds', () => {
    const form = page(
      'form',
      'Form',
      `    <Instance name="field" component="Field" props={{ label: 'Name' }}>
      <Slot name="control"><Instance name="box" component="Checkbox" fills="{surface#accent}" /></Slot>
    </Instance>`,
    )
    const tsx = run({ checkbox: CHECKBOX, field: FIELD, form }).files.get('react/Form.tsx')!
    expect(tsx).toContain(
      `<Checkbox style={{ '--uidx-fill': 'var(--surface-accent)' } as CSSProperties} />`,
    )
  })
})

describe('what a component puts in the slot of an instance it holds (ADR 0018 §4)', () => {
  it('renders where its own stylesheet colours it, as the HTML target does', () => {
    const well = page('well', 'Well', '    <Slot name="body" />')
    const panel = page(
      'panel',
      'Panel',
      `    <Instance name="well" component="Well" textFills="{text#onAccent}">
      <Slot name="body">
        <Text name="own" characters="Own" fills="{text#muted}" />
        <Text name="bare" characters="Bare" />
      </Slot>
    </Instance>`,
    )
    const out = run({ well, panel }).files
    const tsx = out.get('react/Panel.tsx')!
    expect(tsx).toContain(
      `<Well style={{ '--uidx-text-color': 'var(--text-onAccent)' } as CSSProperties}`,
    )
    expect(tsx).toMatch(/<span data-node="own">Own<\/span>\s+<span data-node="bare">Bare<\/span>/)
    const css = out.get('react/panel.css')!
    expect(css).toContain('.panel [data-node="own"] {\n  color: var(--text-muted);\n}')
    expect(css).toContain('.panel [data-node="bare"] {\n  color: var(--uidx-text-color);\n}')
    expect(css).toBe(out.get('html/panel.css'))
  })
})

describe("a composition passes its consumer's style on (ADR 0018 §2)", () => {
  const composition = (field: string) =>
    parseOrThrow(`---
id: checkbox-field
---

## Visual Contract

<Page>
  <Component name="CheckboxField" status="stable">
    <Instance name="field" component="Field" ${field} props={{ label: '{label}' }}>
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
  const react = (field: string) =>
    run({ checkbox: CHECKBOX, field: FIELD, 'checkbox-field': composition(field) }).files.get(
      'react/CheckboxField.tsx',
    )!

  it("lays the consumer's style over the box the definition gave the instance it renders as", () => {
    expect(react('fills="{surface#control}" width={300}')).toContain(
      `<Field className={className} style={{ '--uidx-fill': 'var(--surface-control)', width: '300px', ...style } as CSSProperties} label={label}`,
    )
  })

  it("passes the consumer's style through untouched when the definition states no box", () => {
    expect(react('')).toContain('<Field className={className} style={style} label={label}')
  })

  it('lets a shorthand the consumer states replace the longhands the definition gave (ADR 0018 §5)', () => {
    // A longhand reads the consumer's shorthand first: their cornerRadius
    // takes every corner, as a use's does on the canvas.
    expect(react('topLeftRadius={2}')).toContain(
      `style={{ '--uidx-radius-top-left': 'var(--uidx-radius, 2px)', ...style } as CSSProperties}`,
    )
    // A shorthand beside its longhands is spelled out into the corners, so
    // only the consumer's shorthand can take them over.
    expect(react('cornerRadius={4} topLeftRadius={2} strokeWeight={1}')).toContain(
      `style={{ '--uidx-radius-top-left': 'var(--uidx-radius, 2px)', '--uidx-radius-top-right': 'var(--uidx-radius, 4px)', '--uidx-radius-bottom-right': 'var(--uidx-radius, 4px)', '--uidx-radius-bottom-left': 'var(--uidx-radius, 4px)', '--uidx-stroke-weight': '1px', ...style } as CSSProperties}`,
    )
  })

  describe('a component with an element of its own, whose box is the instance it holds', () => {
    const menu = (list: string) =>
      run({
        checkbox: CHECKBOX,
        field: FIELD,
        menu: page(
          'menu',
          'Menu',
          `    <Instance name="list" component="Field" ${list} props={{ label: '{title}' }} />`,
          'implements="hwc-menu"',
        ),
      }).files.get('react/Menu.tsx')!

    it("keeps the consumer's style on the element, and hands the box what is its own", () => {
      const tsx = menu('fills="{surface#raised}"')
      // Where the element sits is its own — a margin, a flex share, a grid
      // area — as with any React root, and its class is there too.
      expect(tsx).toContain(
        '<hwc-menu ref={ref} className={className} style={style} title={title}>',
      )
      // The box is the Field it holds: the consumer's hooks lie over what the
      // definition gave it.
      expect(tsx).toContain(
        `<Field style={{ '--uidx-fill': 'var(--surface-raised)', ...boxStyleOf(style) } as CSSProperties} label={title} />`,
      )
      expect(menu('')).toContain('<Field style={boxStyleOf(style)} label={title} />')
      expect(tsx).toContain(
        '/** Inline style for the root element. Its --uidx-* hooks and its size also reach its box, the Field it holds (ADR 0018 §2). */',
      )
    })

    it('hands the box the hooks, which its own root would reset, and a size the element takes and the box fills', () => {
      const boxStyleOf = generatedFunction(menu(''), 'boxStyleOf')
      expect(
        boxStyleOf({
          '--uidx-fill': 'red',
          '--uidx-text-color': 'white',
          margin: '4px',
          flex: 1,
          gridArea: 'menu',
          position: 'absolute',
          top: 0,
          width: 300,
          height: '2rem',
        }),
      ).toEqual({
        '--uidx-fill': 'red',
        '--uidx-text-color': 'white',
        width: '100%',
        height: '100%',
      })
      expect(boxStyleOf(undefined)).toEqual({})
      expect(boxStyleOf({ width: undefined, '--uidx-fill': undefined })).toEqual({})
    })

    it('hands the box on through a frame of its own that only wraps it', () => {
      const shell = page(
        'shell',
        'Shell',
        `    <Frame name="wrap" layoutMode="HORIZONTAL" primaryAxisSizingMode="AUTO" counterAxisSizingMode="AUTO">
      <Instance name="list" component="Field" props={{ label: '{title}' }} />
    </Frame>`,
        'layoutMode="HORIZONTAL" primaryAxisSizingMode="AUTO" counterAxisSizingMode="AUTO"',
      )
      const use = page(
        'desk',
        'Desk',
        `    <Instance name="held" component="Shell" fills="{surface#raised}" />`,
      )
      const out = run({ checkbox: CHECKBOX, field: FIELD, shell, desk: use }).files
      const tsx = out.get('react/Shell.tsx')!
      expect(tsx).toMatch(
        /<div ref=\{ref\} className=\{\['shell', className\][^}]*\} style=\{style\}/,
      )
      expect(tsx).toMatch(
        /<div data-node="wrap">\s+<Field style=\{boxStyleOf\(style\)\} label=\{title\} \/>/,
      )
      // The HTML target hands it down the same way.
      expect(out.get('html/desk.html')).toMatch(
        /<div class="shell">\s+<div data-node="wrap">\s+<hwc-field style="--uidx-fill: var\(--surface-raised\)">/,
      )
    })

    it('is written only where an element hands its box on', () => {
      const toolbar = page(
        'toolbar',
        'Toolbar',
        `    <Instance name="delete" component="Button1" props={{ label: 'Delete' }} fills="{surface#danger}" />`,
        'implements="hwc-toolbar" layoutMode="HORIZONTAL"',
      )
      const tsx = run({ button1: BUTTON1, toolbar }).files.get('react/Toolbar.tsx')!
      expect(tsx).not.toContain('boxStyleOf')
      expect(tsx).toContain('<hwc-toolbar ref={ref} className={className} style={style}')
    })
  })
})

describe('a repeat', () => {
  const ROW = `---
id: row
---

## Visual Contract

<Page>
  <Component name="Row" status="draft" layoutMode="HORIZONTAL">
    <Text name="name" characters="{item.name}" />
  </Component>
</Page>

## Contract

<Props>
  <Prop name="item" type="Person">One person.</Prop>
</Props>

## Models

<Model name="Person">
  One person.
  <Field name="id" type="string" key sample={['a', 'b']}>Id.</Field>
  <Field name="name" type="string" sample={['Ada', 'Grace']}>Name.</Field>
</Model>
`
  const list = (body: string) => `---
id: list
---

## Visual Contract

<Page>
  <Component name="List" status="draft" layoutMode="VERTICAL">
${body}
  </Component>
</Page>

## Contract

<Props>
  <Prop name="items" type="Person[]">People.</Prop>
</Props>
<Slots>
  <Slot name="item">One per person.</Slot>
</Slots>
`

  it("gives the default row of a repeating slot the style its instance states; an injected row is the consumer's", () => {
    const tsx = run({
      row: ROW,
      list: list(`    <Slot name="item" repeat="{items}">
      <Instance name="row" component="Row" props={{ item: '{item}' }} fills="{surface#raised}" width={120} />
    </Slot>`),
    }).files.get('react/List.tsx')!
    expect(tsx).toContain('{renderItem ? renderItem(item, index) : (')
    expect(tsx).toContain(
      `<Row item={item} style={{ '--uidx-fill': 'var(--surface-raised)', width: '120px' } as CSSProperties} />`,
    )
  })

  it('gives every row of a repeated instance its style', () => {
    const tsx = run({
      row: ROW,
      list: list(
        `    <Instance name="row" component="Row" repeat="{items}" props={{ item: '{item}' }} cornerRadius={8} />`,
      ),
    }).files.get('react/List.tsx')!
    expect(tsx).toContain('{items.map((item, index) => (')
    expect(tsx).toContain(`<Row item={item} style={{ '--uidx-radius': '8px' } as CSSProperties} />`)
  })
})

describe('the cem target lists the hooks each element reads', () => {
  const PAGES = [
    { file: 'checkbox.uidx', doc: CHECKBOX },
    { file: 'field.uidx', doc: FIELD },
  ]
  type Property = { name: string; description: string }
  const declarations = (pages: GenerateInput['pages']) => {
    const cem = JSON.parse(generate({ pages, targets: ['cem'] }).files.get('custom-elements.json')!)
    return new Map<string, { cssProperties: Property[] }>(
      cem.modules
        .flatMap((module: { declarations: { tagName: string }[] }) => module.declarations)
        .map((declaration: { tagName: string; cssProperties: Property[] }) => [
          declaration.tagName,
          declaration,
        ]),
    )
  }

  it('lists the box hooks the stylesheet reads, each saying what it styles', () => {
    const checkbox = declarations(PAGES).get('hwc-checkbox')!.cssProperties
    expect(checkbox.map((property) => property.name)).toEqual([
      '--uidx-fill',
      '--uidx-stroke',
      '--uidx-stroke-weight',
      '--uidx-stroke-style',
      '--uidx-stroke-top-weight',
      '--uidx-stroke-right-weight',
      '--uidx-stroke-bottom-weight',
      '--uidx-stroke-left-weight',
      '--uidx-radius',
      '--uidx-radius-top-left',
      '--uidx-radius-top-right',
      '--uidx-radius-bottom-right',
      '--uidx-radius-bottom-left',
      '--uidx-opacity',
      '--uidx-shadow',
    ])
    expect(checkbox[0]!.description).toMatch(/background-color/)
    expect(checkbox[0]!.description).toMatch(/fills/)
    for (const property of checkbox) expect(property.description).not.toBe('')
  })

  it('lists padding only where the box lays out, and text colour where a text reads it', () => {
    const found = declarations(PAGES)
    // Checkbox is a fixed 20×20 box with no text: neither does anything there.
    const checkbox = found.get('hwc-checkbox')!.cssProperties.map((property) => property.name)
    expect(checkbox).not.toContain('--uidx-padding-left')
    expect(checkbox).not.toContain('--uidx-text-color')
    const field = found.get('hwc-field')!.cssProperties
    expect(field.map((property) => property.name)).toContain('--uidx-padding-left')
    const text = field.find((property) => property.name === '--uidx-text-color')!
    expect(text.description).toMatch(/textFills/)
  })

  it("lists text colour for an element whose only texts are a nested component's, which inherit it", () => {
    const bar = page(
      'bar',
      'Bar',
      `    <Instance name="save" component="Button1" props={{ label: 'Save' }} />`,
      'implements="hwc-bar" layoutMode="HORIZONTAL"',
    )
    const names = declarations([
      { file: 'button1.uidx', doc: parseOrThrow(BUTTON1) },
      { file: 'bar.uidx', doc: parseOrThrow(bar) },
    ])
      .get('hwc-bar')!
      .cssProperties.map((property) => property.name)
    expect(names).toContain('--uidx-text-color')
  })
})

describe('a component mapped onto a React library (codegen.react)', () => {
  const react = { Checkbox: { from: '@acme/ui', export: 'Toggle' } }

  it('warns when a use restyles it, and hands the adapter no style it could not take', () => {
    const toolbar = page(
      'toolbar',
      'Toolbar',
      `    <Instance name="agree" component="Checkbox" fills="{surface#accent}" cornerRadius={6} x={4} />`,
      'layoutMode="HORIZONTAL"',
    )
    const out = run({ checkbox: CHECKBOX, toolbar }, { react, manifest: MANIFEST })
    expect(out.files.get('react/Toolbar.tsx')).toContain('<Checkbox />')
    const warnings = out.diagnostics.filter((d) => d.file === 'toolbar.uidx')
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatchObject({ code: CODES.CONFORMANCE, severity: 'warning' })
    expect(warnings[0]!.message).toContain('"agree"')
    expect(warnings[0]!.message).toContain('fills, cornerRadius')
    expect(warnings[0]!.message).toContain('@acme/ui')
    // The HTML target has the element itself, which takes the hooks.
    expect(out.files.get('html/toolbar.html')).toContain(
      '<hwc-checkbox style="--uidx-fill: var(--surface-accent); --uidx-radius: 6px">',
    )
  })

  it('says nothing of a use that leaves its box alone', () => {
    const toolbar = page(
      'toolbar',
      'Toolbar',
      `    <Instance name="agree" component="Checkbox" x={4} />`,
      'layoutMode="HORIZONTAL"',
    )
    const out = run({ checkbox: CHECKBOX, toolbar }, { react, manifest: MANIFEST })
    expect(out.diagnostics).toEqual([])
  })
})
