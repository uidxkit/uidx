import { describe, expect, it } from 'vitest'
import { applyPatches, parseOrThrow, resolve } from '@uidx/format'

import { duplicateLayer, mainComponentOf } from '../src/layer-actions'

/**
 * The context menu's Duplicate and Go to main component: a copy lands just
 * after its original under a name nothing else holds, and an instance finds
 * the page its component is declared on.
 */
const page = (id: string, body: string) =>
  `---\nid: ${id}\n---\n\n## Visual Contract\n\n<Page>\n${body}\n</Page>\n`

const HOME = page(
  'home',
  `  <Frame name="card" x={10} y={20} width={50} height={50}>
    <Text name="title" characters="Hi" />
  </Frame>
  <Frame name="card-copy" x={0} y={0} width={5} height={5} />
  <Frame name="row" layoutMode="HORIZONTAL" width={100} height={20}>
    <Frame name="cell" x={4} width={10} height={10} />
  </Frame>
  <Instance name="save" component="Button" />`,
)
const BUTTON = page('button', `  <Component name="Button" status="draft" width={10} height={10} />`)

describe('duplicating a layer', () => {
  it('copies it whole after the original, under a free name, nudged into view', () => {
    const doc = parseOrThrow(HOME)
    const plan = duplicateLayer(doc, 'card', new Set())!
    expect(plan.address).toBe('card-copy-2')
    const next = parseOrThrow(applyPatches(HOME, plan.patches).source)
    expect(next.tree.children.map((child) => child.name)).toEqual([
      'card',
      'card-copy-2',
      'card-copy',
      'row',
      'save',
    ])
    const copy = resolve(next.tree, 'card-copy-2')!
    expect([copy.attrs.x!.value, copy.attrs.y!.value]).toEqual([26, 36])
    expect(copy.children.map((child) => child.name)).toEqual(['title'])
  })

  it('leaves the position alone inside auto layout', () => {
    const plan = duplicateLayer(parseOrThrow(HOME), 'row#cell', new Set())!
    const copy = resolve(parseOrThrow(applyPatches(HOME, plan.patches).source).tree, plan.address)!
    expect(plan.address).toBe('row#cell-copy')
    expect(copy.attrs.x!.value).toBe(4)
  })

  it('names a component copy against every name the document holds, and puts it beside', () => {
    const plan = duplicateLayer(parseOrThrow(BUTTON), 'Button', new Set(['Button', 'ButtonCopy']), {
      minX: 0,
      minY: 8,
      maxX: 60.4,
      maxY: 40,
    })!
    expect(plan.address).toBe('ButtonCopy2')
    const copy = resolve(
      parseOrThrow(applyPatches(BUTTON, plan.patches).source).tree,
      plan.address,
    )!
    expect([copy.attrs.x!.value, copy.attrs.y!.value]).toEqual([100, 8])
  })

  it("refuses to copy the component an identity file's contract describes", () => {
    const identity = `${BUTTON}\n## Contract\n\n<Props>\n  <Prop name="label" type="string">Words.</Prop>\n</Props>\n`
    expect(duplicateLayer(parseOrThrow(identity), 'Button', new Set())).toBeNull()
  })

  it('refuses the page itself and an address that is not in the file', () => {
    expect(duplicateLayer(parseOrThrow(HOME), '', new Set())).toBeNull()
    expect(duplicateLayer(parseOrThrow(HOME), 'save#label', new Set())).toBeNull()
  })
})

describe('the main component of an instance', () => {
  it('is found on the page that declares it', () => {
    const pages = new Map([
      ['home.uidx', parseOrThrow(HOME)],
      ['button.uidx', parseOrThrow(BUTTON)],
    ])
    const save = resolve(pages.get('home.uidx')!.tree, 'save')!
    expect(mainComponentOf(pages, save)).toEqual({ file: 'button.uidx', address: 'Button' })
    expect(mainComponentOf(pages, resolve(pages.get('home.uidx')!.tree, 'card')!)).toBeNull()
  })
})
