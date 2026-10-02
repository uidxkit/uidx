import { describe, expect, it } from 'vitest'
import { applyPatches, inversePatches, parseOrThrow, type UidxPatch } from '../src/index.js'

/**
 * Designing a state from the canvas writes a style row (ADR 0016 §4): the
 * `style` op names a row by its keys and one cell in it. What these pin: the
 * cell lands in the right row, a row appears and disappears with its cells,
 * the table appears after the visual contract when the file had none, and
 * every op inverts to what was there.
 */
const page = (styles = '', regions = '') => `---
id: box
---

## Visual Contract

<Page>
  <Component name="Box" status="draft" implements="x-box" width={20} height={20}>
    <Frame name="ring" part="ring" width={10} height={10} />
  </Component>
</Page>
${styles}${regions}`

const CONTRACT = `
## Contract

<Props>
  <Prop name="checked" type="boolean" default={false} visual>On.</Prop>
</Props>
`

const style = (keys: Record<string, string>, target: string, prop: string, value?: unknown) =>
  ({ op: 'style', keys, target, prop, ...(value === undefined ? {} : { value }) }) as UidxPatch

describe('the style op', () => {
  it('adds a cell to an existing row, in canonical one-line rows', () => {
    const source = page(
      `
<Styles>
  <Style state="checked" root:opacity={0.5} />
  <Style state="hover" root:opacity={0.8} />
</Styles>
`,
      CONTRACT,
    )
    const { source: next } = applyPatches(source, [
      style({ state: 'hover' }, 'ring', 'visible', true),
    ])
    expect(next).toContain(
      '<Styles>\n  <Style state="checked" root:opacity={0.5} />\n  <Style state="hover" root:opacity={0.8} ring:visible={true} />\n</Styles>',
    )
    expect(parseOrThrow(next).spec!.styles!.map((row) => row.values)).toEqual([
      { root: { opacity: 0.5 } },
      { root: { opacity: 0.8 }, ring: { visible: true } },
    ])
  })

  it('adds a row for keys nobody wrote, and removes a row its last cell leaves', () => {
    const source = page(
      `
<Styles>
  <Style state="checked" root:opacity={0.5} />
</Styles>
`,
      CONTRACT,
    )
    const added = applyPatches(source, [style({ state: 'hover' }, 'root', 'opacity', 0.9)]).source
    expect(added).toContain('<Style state="hover" root:opacity={0.9} />')
    const emptied = applyPatches(added, [style({ state: 'checked' }, 'root', 'opacity')]).source
    expect(emptied).not.toContain('state="checked"')
    expect(emptied).toContain('<Styles>\n  <Style state="hover" root:opacity={0.9} />\n</Styles>')
  })

  it('creates the table after the visual contract, and removes it when the last row goes', () => {
    const source = page('', CONTRACT)
    const made = applyPatches(source, [style({ state: 'checked' }, 'root', 'opacity', 0.5)]).source
    expect(made).toContain(
      '</Page>\n\n<Styles>\n  <Style state="checked" root:opacity={0.5} />\n</Styles>\n\n## Contract',
    )
    const gone = applyPatches(made, [style({ state: 'checked' }, 'root', 'opacity')]).source
    expect(gone).toBe(source)
  })

  it('inverts to the value the cell had, or to a clear', () => {
    const source = page(
      `
<Styles>
  <Style state="checked" root:opacity={0.5} />
</Styles>
`,
      CONTRACT,
    )
    const doc = parseOrThrow(source)
    const set = style({ state: 'checked' }, 'root', 'opacity', 0.2)
    expect(inversePatches(doc, [set])).toEqual([
      style({ state: 'checked' }, 'root', 'opacity', 0.5),
    ])
    const add = style({ state: 'checked' }, 'ring', 'visible', true)
    expect(inversePatches(doc, [add])).toEqual([style({ state: 'checked' }, 'ring', 'visible')])
    const undone = applyPatches(
      applyPatches(source, [add]).source,
      inversePatches(doc, [add]),
    ).source
    expect(undone).toBe(source)
  })

  it('refuses a clear of a cell that is not there', () => {
    const source = page('', CONTRACT)
    expect(() => applyPatches(source, [style({ state: 'checked' }, 'root', 'opacity')])).toThrow(
      /no root:opacity to clear/,
    )
  })

  it('writes and removes a whole row, and inverts both', () => {
    const source = page('', CONTRACT)
    const doc = parseOrThrow(source)
    const seed = style({ state: 'hover' }, '', '', {})
    const seeded = applyPatches(source, [seed]).source
    expect(seeded).toContain('<Styles>\n  <Style state="hover" />\n</Styles>')
    expect(parseOrThrow(seeded).spec!.styles).toMatchObject([
      { keys: { state: 'hover' }, values: {} },
    ])
    expect(applyPatches(seeded, inversePatches(doc, [seed])).source).toBe(source)

    const full = page(
      `
<Styles>
  <Style state="hover" root:opacity={0.8} ring:visible={true} />
</Styles>
`,
      CONTRACT,
    )
    const drop = style({ state: 'hover' }, '', '')
    const dropped = applyPatches(full, [drop]).source
    expect(dropped).toBe(source)
    const back = inversePatches(parseOrThrow(full), [drop])
    expect(applyPatches(dropped, back).source).toBe(full)
    expect(() => applyPatches(source, [drop])).toThrow(/not in the styles table/)
  })
})
