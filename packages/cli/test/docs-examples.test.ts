import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse, type UidxNode } from '@uidx/format'
import { deriveVariants, INSTANCE_BOX_HOOKS } from '@uidx/schema/design-system'
import {
  boxTargetOf,
  INSTANCE_BOX_PROPS,
  INSTANCE_CASCADE_PROPS,
  INSTANCE_PLACEMENT_PROPS,
  INSTANCE_STRUCTURAL_PROPS,
  instanceRole,
} from '@uidx/schema/instance-box'
import { check } from '../src/index.js'

/**
 * The docs teach an instance's outer box (ADR 0018) by example and by table,
 * and a reader copies both. So every `<Instance>` a doc shows has to pass
 * `uidx check` cleanly: it parses, its props are declared, and it states no
 * locked attribute (UIDX154) and no box value that does nothing (UIDX155).
 * The property vocabulary's tables have to say what the role table and the
 * generated hooks say.
 */

const REPO = join(import.meta.dirname, '..', '..', '..')

/** The docs that teach the format as it is now. The backlog and old plans are history. */
const DOCS = [
  'README.md',
  'docs/property-vocabulary.md',
  'docs/properties-panel.md',
  'docs/decisions/0018-instance-box-overrides.md',
  'packages/cli/skills/uidx-authoring/SKILL.md',
  'packages/cli/skills/uidx-design-system/SKILL.md',
]

const read = (doc: string) => readFileSync(join(REPO, doc), 'utf8')

/** Every fenced block of `doc` that places an instance, in order, a list item's included. */
function examplesIn(doc: string): string[] {
  return [...read(doc).matchAll(/^[ \t]*```[^\n]*\n([\s\S]*?)^[ \t]*```/gm)]
    .map((match) => match[1]!)
    .filter((block) => block.includes('<Instance'))
}

/** A page holding `block`, unless it is a whole document already. */
function pageFor(block: string): string {
  if (block.startsWith('---')) return block
  const tree = /<Page[\s>]/.test(block) ? block : `<Page>\n${block}</Page>\n`
  return `---\nid: docs-example\n---\n\n## Visual Contract\n\n${tree}`
}

/**
 * A copy of the pill button on examples/design-system's page1, which ADR
 * 0018's own example restyles: a hugging row with padding, a solid fill, one
 * bound label and one hover row, so its box is the derived `root`.
 */
const BUTTON1 = `---
id: button1
---

## Visual Contract

<Page>
  <Component name="Button1" status="draft"
    layoutMode="HORIZONTAL" primaryAxisSizingMode="AUTO" counterAxisSizingMode="AUTO"
    primaryAxisAlignItems="CENTER" counterAxisAlignItems="CENTER"
    paddingLeft={12} paddingRight={12} paddingTop={8} paddingBottom={8} cornerRadius={999}
    fills={[{ type: 'SOLID', color: { r: 0, g: 0.3333, b: 1, a: 1 } }]}>
    <Text name="label" characters="{label}" fontSize={14} />
  </Component>
</Page>

<Styles>
  <Style state="hover" root:fills={[{ type: 'SOLID', color: { r: 0.37, g: 0.57, b: 0.99, a: 1 } }]} />
</Styles>

## Contract

<Props>
  <Prop name="label" type="string" sample="Button1">The words it shows.</Prop>
</Props>
`

/** The card the authoring skill fills a slot of. */
const CARD = `---
id: card
---

## Visual Contract

<Page>
  <Component name="Card" status="draft"
    layoutMode="VERTICAL" primaryAxisSizingMode="AUTO" counterAxisSizingMode="AUTO"
    itemSpacing="{space#sm}" paddingLeft="{space#lg}" paddingRight="{space#lg}"
    paddingTop="{space#lg}" paddingBottom="{space#lg}" cornerRadius="{radius#md}"
    fills="{surface#raised}">
    <Text name="heading" characters="{heading}" fontSize={16} fontWeight="BOLD" fills="{text#default}" />
    <Slot name="body" />
  </Component>
</Page>

## Contract

<Props>
  <Prop name="heading" type="string" sample="Heading">The title above what it holds.</Prop>
</Props>
<Slots>
  <Slot name="body">What the card holds.</Slot>
</Slots>
`

/**
 * Tokens the docs name that the example theme lacks: ADR 0018's example
 * strokes its Delete button with `border#danger`. A collection may span
 * pages, so this adds the one variable beside the theme's own.
 */
const THEME = `---
id: docs-theme
---

## Visual Contract

<Tokens>
  <Collection name="border">
    <Variable name="danger" type="COLOR" value={{ r: 0.6, g: 0.1, b: 0.1, a: 1 }} />
  </Collection>
</Tokens>
`

/**
 * What the examples draw on: the repo's design system as committed, plus the
 * components and the token the docs name that it lacks. Only git-tracked
 * pages: a designer's unsaved work in the example folder is theirs.
 */
function library(): Array<[file: string, text: string]> {
  const dir = join(REPO, 'examples/design-system/.uidx')
  const tracked = execFileSync('git', ['ls-files', '*.uidx'], { cwd: dir, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
  return [
    ...tracked.map((file): [string, string] => [file, readFileSync(join(dir, file), 'utf8')]),
    ['button1.uidx', BUTTON1],
    ['card.uidx', CARD],
    ['docs-theme.uidx', THEME],
  ]
}

/** What `uidx check` says about `block`, checked in a document of its own beside the library. */
async function checked(block: string): Promise<string[]> {
  const dir = await mkdtemp(join(tmpdir(), 'uidx-docs-'))
  for (const [file, text] of [...library(), ['docs-example.uidx', pageFor(block)] as const])
    await writeFile(join(dir, file), text)
  const result = await check(['.'], { cwd: dir })
  const page = result.files.find((report) => report.file === 'docs-example.uidx')
  // Never pass for want of looking.
  if (!page) throw new Error('the example page was not checked')
  return page.diagnostics.map((d) => `${d.code}: ${d.message}`)
}

/** The instances `block` places, at any depth. */
function instancesIn(block: string): UidxNode[] {
  const out: UidxNode[] = []
  const walk = (node: UidxNode): void => {
    if (node.element === 'Instance') out.push(node)
    node.children.forEach(walk)
  }
  const { doc } = parse(pageFor(block))
  if (doc) walk(doc.tree)
  return out
}

/** Whether a use restyles itself from outside: its outer box, or the colour it hands down. */
const restyles = (instance: UidxNode): boolean =>
  Object.keys(instance.attrs).some((prop) => ['box', 'cascade'].includes(instanceRole(prop)))

const EXAMPLES = DOCS.flatMap((doc) =>
  examplesIn(doc).map((block, i) => [`${doc} #${i + 1}`, block] as const),
)

describe('the instances the docs show', () => {
  it('include a restyled use wherever the docs teach the outer box', () => {
    for (const doc of [
      'README.md',
      'docs/property-vocabulary.md',
      'docs/decisions/0018-instance-box-overrides.md',
      'packages/cli/skills/uidx-authoring/SKILL.md',
    ]) {
      expect(
        examplesIn(doc).some((block) => instancesIn(block).some(restyles)),
        doc,
      ).toBe(true)
    }
  })

  it.each(EXAMPLES)('%s passes uidx check with nothing to say', async (_, block) => {
    expect(await checked(block)).toEqual([])
  })
})

describe('the property vocabulary', () => {
  const lines = read('docs/property-vocabulary.md').split('\n')
  /** The code spans of a table cell, in order. */
  const spans = (cell: string | undefined) =>
    [...(cell ?? '').matchAll(/`([^`]+)`/g)].map((match) => match[1]!)
  const cells = (row: string) => row.split('|').slice(1, -1)
  /** `--uidx-radius-{top-left,top-right}` as the hooks it names. */
  const expand = (name: string): string[] => {
    const group = /\{([^}]+)\}/.exec(name)
    if (!group) return [name]
    return group[1]!.split(',').flatMap((part) => expand(name.replace(group[0], part.trim())))
  }

  it('lists the attributes of each instance role as instance-box.ts does', () => {
    const listed = (role: string) => {
      const row = lines.find((line) => line.startsWith(`| ${role} |`))
      return spans(row && cells(row)[1]).sort()
    }
    // Structural is held whole too: a reader takes an attribute the row leaves
    // out for locked, though `uidx check` never says UIDX154 for it.
    expect(listed('Structural')).toEqual([...INSTANCE_STRUCTURAL_PROPS].sort())
    expect(listed('Placement')).toEqual([...INSTANCE_PLACEMENT_PROPS].sort())
    expect(listed('Box')).toEqual([...INSTANCE_BOX_PROPS].sort())
    expect(listed('Cascade')).toEqual([...INSTANCE_CASCADE_PROPS].sort())
  })

  it('names every generated hook beside the attribute it reads', () => {
    const documented: Record<string, string> = {}
    for (const row of lines.filter((line) => line.startsWith('| `--uidx-'))) {
      const [hooks, props] = cells(row)
      const named = spans(hooks).flatMap(expand)
      const reads = spans(props)
      expect(reads, row).toHaveLength(named.length)
      reads.forEach((prop, i) => (documented[prop] = named[i]!))
    }
    expect(documented).toEqual(INSTANCE_BOX_HOOKS)
  })
})

/**
 * Where the docs say the box lands on the Shoelace example, held to the code
 * both ways. Its Button draws its look on its `base` part, inside a frame of
 * its own that only wraps it, so a use's box goes through to `base` (ADR 0018
 * §2) and the generated stylesheet reads the hooks on `::part(base)`. Its
 * Checkbox draws its look further in and states no box on `base`, so over
 * the shadow DOM a use's box does nothing in code: the limit the docs name.
 * When the second test fails that limit has gone, and the sentences naming it
 * go with it.
 */
describe('the Shoelace example, where the docs say the box lands', () => {
  const component = (name: string): UidxNode => {
    const { doc } = parse(read(`examples/shoelace/.uidx/${name.toLowerCase()}.uidx`))
    return doc!.tree.children.find((node) => node.element === 'Component')!
  }
  const paints = (node: UidxNode) =>
    ['fills', 'strokes', 'effects', 'paddingLeft'].filter((prop) => node.attrs[prop] !== undefined)

  it('restyles the Button on its base part, on the canvas and in code', () => {
    const variants = deriveVariants(component('Button')).children
    expect(variants.length).toBeGreaterThan(0)
    for (const variant of variants) {
      const target = boxTargetOf(variant)
      expect(target.kind === 'frame' && target.path, variant.name).toEqual(['root', 'base'])
      expect(target.kind === 'frame' && target.node.attrs.part?.value, variant.name).toBe('base')
    }
    const css = read('examples/shoelace/generated/html/button.css')
    const base = css.slice(css.indexOf('sl-button::part(base) {'))
    expect(base.slice(0, base.indexOf('}'))).toContain(
      'background-color: var(--uidx-fill, var(--color-accent));',
    )
  })

  it('reads no box hook on the Checkbox, whose base states no box: the shadow-DOM limit', () => {
    const target = boxTargetOf(deriveVariants(component('Checkbox')).children[0]!)
    const base = target.kind === 'frame' ? target.node : undefined
    expect(base?.attrs.part?.value).toBe('base')
    expect(paints(base!)).toEqual([])
    const css = read('examples/shoelace/generated/html/checkbox.css')
    expect(css).toContain('--uidx-fill: initial')
    expect(css).not.toMatch(/var\(--uidx-(?!text-color)/)
  })

  it.each([
    ['docs/property-vocabulary.md', '**The box node**', '**Precedence**'],
    ['docs/property-vocabulary.md', 'Where code still differs', '## Excluded'],
    ['packages/cli/skills/uidx-authoring/SKILL.md', '- **The box:**', '- **`textFills`**'],
    ['packages/cli/skills/uidx-design-system/SKILL.md', '**A use restyles', '(UIDX155)'],
    [
      'docs/decisions/0018-instance-box-overrides.md',
      'Where code still differs',
      '- A composition',
    ],
  ])('is named in %s, from "%s"', (file, from, to) => {
    const text = read(file)
    const start = text.indexOf(from)
    const end = text.indexOf(to, start)
    expect(start, from).toBeGreaterThanOrEqual(0)
    expect(end, to).toBeGreaterThan(start)
    expect(text.slice(start, end)).toContain('Shoelace')
  })
})
