import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseOrThrow, resolve, type UidxNode } from '@uidx/format'
import { deriveVariants, derivesVariants } from '../src/design-system.js'

/**
 * The stamp that puts a state row above an instance's outer box (ADR 0018 §3).
 *
 * `deriveVariants` marks every attribute a row keyed by a non-default state
 * wrote with that state's name. A row keyed only by visual enums, or by
 * `state="default"`, is the component's resting look and writes no stamp, and
 * a later row that wins the property replaces the attribute and its stamp.
 * Nothing else about the derivation changes.
 */
const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '../../..')

const page = (id: string, body: string, regions = '') =>
  `---\nid: ${id}\n---\n\n## Visual Contract\n\n<Page>\n${body}\n</Page>\n${regions}`

const componentIn = (source: string, name: string): UidxNode =>
  resolve(parseOrThrow(source).tree, name)!

const example = (file: string, name: string): UidxNode =>
  componentIn(readFileSync(join(repo, file), 'utf8'), name)

/** The derived variant whose coordinates are `keys`, every other axis at whatever it is. */
function variant(set: UidxNode, keys: Record<string, string>): UidxNode {
  const found = set.children.find((child) =>
    Object.entries(keys).every(([axis, value]) => child.attrs[axis]?.value === value),
  )
  if (!found) throw new Error(`no variant ${JSON.stringify(keys)} in ${set.name}`)
  return found
}

const rootOf = (set: UidxNode, keys: Record<string, string>): UidxNode =>
  variant(set, keys).children[0]!

const child = (node: UidxNode, name: string): UidxNode =>
  node.children.find((entry) => entry.name === name)!

describe('a state row stamps what it writes', () => {
  const button1 = deriveVariants(
    example('packages/schema/test/fixtures/instance-box/button1.uidx', 'Button1'),
  )

  it('marks the hover root fill with its state, and leaves the resting fill unmarked', () => {
    expect(rootOf(button1, { state: 'hover' }).attrs.fills!.stateRow).toBe('hover')
    expect(rootOf(button1, { state: 'default' }).attrs.fills!.stateRow).toBeUndefined()
  })

  it('leaves the base attributes a state row does not touch unmarked', () => {
    const hover = rootOf(button1, { state: 'hover' })
    expect(hover.attrs.paddingLeft!.stateRow).toBeUndefined()
    expect(hover.attrs.cornerRadius!.stateRow).toBeUndefined()
  })

  it('stamps every target of a visual boolean, the indicator included', () => {
    const checkbox = deriveVariants(
      example('examples/design-system/.uidx/checkbox.uidx', 'Checkbox'),
    )
    const checked = rootOf(checkbox, { state: 'checked' })
    expect(checked.attrs.fills!.stateRow).toBe('checked')
    expect(checked.attrs.strokes!.stateRow).toBe('checked')
    expect(child(checked, 'check').attrs.visible!.stateRow).toBe('checked')
    // The other indicator belongs to a different state, so it is the base here.
    expect(child(checked, 'dash').attrs.visible!.stateRow).toBeUndefined()
  })

  it('stamps an enum-and-state row with the state, and leaves the enum row unmarked', () => {
    // ADR 0018 §3's own example: a destructive Button is red at rest because
    // the variant row is its resting look, and `surface#danger` on hover.
    const button = deriveVariants(example('examples/design-system/.uidx/button.uidx', 'Button'))
    const resting = rootOf(button, { variant: 'destructive', size: 'medium', state: 'default' })
    const hovered = rootOf(button, { variant: 'destructive', size: 'medium', state: 'hover' })
    expect(resting.attrs.fills!.value).toBe('{surface#danger}')
    expect(resting.attrs.fills!.stateRow).toBeUndefined()
    expect(hovered.attrs.fills!.stateRow).toBe('hover')
  })

  const CHIP = page(
    'chip',
    `  <Component name="Chip" layoutMode="HORIZONTAL" fills="{surface#base}" opacity={1}>
    <Text name="label" part="label" characters="{label}" fills="{text#default}" />
  </Component>`,
    `
<Styles>
  <Style state="default" root:opacity={0.9} />
  <Style state="hover" root:fills="{surface#hover}" />
  <Style tone="danger" size="small" root:fills="{surface#dangerSmall}" />
  <Style state="disabled" label:fills="{text#muted}" />
</Styles>

## Contract

<Props>
  <Prop name="label" type="string" sample="Chip">The words.</Prop>
  <Prop name="tone" type="'neutral' | 'danger'" default="neutral" visual>Tone.</Prop>
  <Prop name="size" type="'medium' | 'small'" default="medium" visual>Size.</Prop>
  <Prop name="disabled" type="boolean" default={false} visual>Inert.</Prop>
</Props>
`,
  )
  const chip = deriveVariants(componentIn(CHIP, 'Chip'))

  it('clears the stamp when a more specific enum row wins the property', () => {
    const plain = rootOf(chip, { tone: 'neutral', size: 'medium', state: 'hover' })
    expect(plain.attrs.fills).toMatchObject({ value: '{surface#hover}', stateRow: 'hover' })
    // Two enum keys outrank one state key, so the row applied last is the enum
    // row: the value is the resting look of that combination again.
    const won = rootOf(chip, { tone: 'danger', size: 'small', state: 'hover' })
    expect(won.attrs.fills!.value).toBe('{surface#dangerSmall}')
    expect(won.attrs.fills!.stateRow).toBeUndefined()
  })

  it('writes no stamp for a state="default" row', () => {
    const resting = rootOf(chip, { tone: 'neutral', size: 'medium', state: 'default' })
    expect(resting.attrs.opacity).toMatchObject({ value: 0.9 })
    expect(resting.attrs.opacity!.stateRow).toBeUndefined()
  })

  it('stamps a part the row names, not just the root', () => {
    const disabled = rootOf(chip, { tone: 'neutral', size: 'medium', state: 'disabled' })
    expect(child(disabled, 'label').attrs.fills).toMatchObject({
      value: '{text#muted}',
      stateRow: 'disabled',
    })
    expect(disabled.attrs.fills!.stateRow).toBeUndefined()
  })

  it('leaves the authored component untouched', () => {
    const authored = componentIn(CHIP, 'Chip')
    deriveVariants(authored)
    expect(authored.attrs.fills!.stateRow).toBeUndefined()
    expect(child(authored, 'label').attrs.fills!.stateRow).toBeUndefined()
  })
})

describe('the stamp is the only change to the derivation', () => {
  /**
   * Every derivable component in the repo's examples, from git-tracked files
   * only so a scratch component in a working copy never joins, plus the
   * instance-box fixtures.
   */
  function components(): Map<string, UidxNode> {
    const tracked = execFileSync(
      'git',
      ['ls-files', 'examples/*.uidx', 'packages/viewer/test/fixtures/tour/*.uidx'],
      { cwd: repo, encoding: 'utf8' },
    )
      .split('\n')
      .filter(Boolean)
    const fixtures = readdirSync(join(here, 'fixtures/instance-box'))
      .filter((file) => file.endsWith('.uidx'))
      .map((file) => relative(repo, join(here, 'fixtures/instance-box', file)))
    const out = new Map<string, UidxNode>()
    for (const file of [...tracked, ...fixtures].sort()) {
      const doc = parseOrThrow(readFileSync(join(repo, file), 'utf8'))
      for (const node of doc.tree.children)
        if (derivesVariants(node)) out.set(`${file}: ${node.name}`, node)
    }
    return out
  }

  /**
   * A short digest of a derived set, stamps and source positions left out.
   * The full trees run to thousands of lines, so the digests were recorded
   * from the derivation as it stood before the stamp existed; an example that
   * changes on purpose is re-recorded with `-u`.
   */
  const IGNORED = new Set(['stateRow', 'loc', 'valueLoc', 'openTagLoc', 'spec'])
  const digest = (node: UidxNode): string =>
    createHash('sha256')
      .update(JSON.stringify(node, (key, value) => (IGNORED.has(key) ? undefined : value)))
      .digest('hex')
      .slice(0, 16)

  it('derives every example exactly as before, once the stamps are stripped', () => {
    const digests = Object.fromEntries(
      [...components()].map(([key, component]) => [key, digest(deriveVariants(component))]),
    )
    expect(digests).toMatchInlineSnapshot(`
      {
        "examples/design-system/.uidx/button.uidx: Button": "de1209b9e0b59bce",
        "examples/design-system/.uidx/checkbox.uidx: Checkbox": "3f48cc72aafec4c9",
        "examples/design-system/.uidx/contact-list.uidx: ContactList": "a3167654226ebbe6",
        "examples/design-system/.uidx/contact-option.uidx: ContactOption": "32a744eac54d4d36",
        "examples/design-system/.uidx/field.uidx: Field": "41ecbc7bb43a3ae9",
        "examples/shoelace/.uidx/button.uidx: Button": "d818ba2b185b8746",
        "examples/shoelace/.uidx/checkbox.uidx: Checkbox": "1afaf1e597bba901",
        "examples/shoelace/.uidx/input.uidx: Input": "759bf7a6e9fd91db",
        "examples/shoelace/.uidx/switch.uidx: Switch": "443683d67d14e283",
        "packages/schema/test/fixtures/instance-box/button1.uidx: Button1": "9882079e02d953e8",
        "packages/viewer/test/fixtures/tour/button.uidx: Button": "2b61082cd468c904",
        "packages/viewer/test/fixtures/tour/switch.uidx: Switch": "b38f6a5f04c0d585",
      }
    `)
  })
})
