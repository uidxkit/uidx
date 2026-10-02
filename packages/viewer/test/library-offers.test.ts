import { describe, expect, it } from 'vitest'
import { applyPatches, parseOrThrow } from '@uidx/format'
import { libraryOffers, scaffoldOffers } from '../src/contract-edits'
import { parseHeadless } from '../src/headless'

/**
 * Filling a contract from a general library (ADR 0013 §5): offered under the
 * identity's names, the usual shape ticked, the rest left to choose, and the
 * library's spellings kept as bindings so the code still reaches the element.
 */
const library = parseHeadless('custom-elements.json', {
  modules: [
    {
      declarations: [
        {
          tagName: 'sl-switch',
          attributes: [
            { name: 'checked', type: { text: 'boolean' } },
            { name: 'size', type: { text: "'small' | 'medium' | 'large'" } },
            { name: 'help-text', type: { text: 'string' }, description: 'Words under it.' },
            { name: 'required', type: { text: 'boolean' } },
          ],
          events: [{ name: 'sl-change' }, { name: 'sl-blur' }],
          slots: [{ name: '' }, { name: 'help-text' }],
          cssParts: [{ name: 'base' }, { name: 'thumb' }],
        },
      ],
    },
  ],
})
const SOURCE = `---
id: switch
---

## Visual Contract

<Page>
  <Component name="Switch" status="draft" implements="sl-switch">
    <Text name="label" characters="{label}" />
  </Component>
</Page>

## Contract

<Props>
  <Prop name="label" type="string">Words.</Prop>
</Props>
`
const doc = parseOrThrow(SOURCE)
const offers = libraryOffers(doc.tree.children[0]!, library.roots[0]!)

describe('Fill from library', () => {
  it('offers members under identity names, the usual ones ticked', () => {
    expect(
      offers.map((o) => `${o.kind}:${o.name}<-${o.library}${o.suggested ? ' *' : ''}`),
    ).toEqual([
      'prop:checked<-checked *',
      'prop:size<-size *',
      'prop:helpText<-help-text',
      'prop:required<-required',
      'event:change<-sl-change *',
      'event:blur<-sl-blur',
      'slot:default<- *',
      'slot:help-text<-help-text',
      'part:base<-base *',
      'part:thumb<-thumb *',
    ])
  })

  it('declares the chosen ones and keeps the library spellings as bindings', () => {
    const chosen = offers.filter((o) => o.suggested || o.name === 'helpText')
    const made = scaffoldOffers(chosen)
    expect(made.attributes).toEqual({ helpText: 'help-text' })
    expect(made.events).toEqual({ change: 'sl-change' })
    const contract = parseOrThrow(applyPatches(SOURCE, made.patches).source).spec!.contract!
    expect(contract.props.map((p) => p.name)).toEqual(['label', 'checked', 'size', 'helpText'])
    expect(contract.events.map((e) => e.name)).toEqual(['change'])
    expect(contract.slots.map((s) => s.name)).toEqual(['default'])
    expect(contract.parts.map((p) => p.name)).toEqual(['base', 'thumb'])
  })

  it('does not offer what the contract already declares, under either spelling', () => {
    const again = parseOrThrow(applyPatches(SOURCE, scaffoldOffers(offers).patches).source)
    expect(libraryOffers(again.tree.children[0]!, library.roots[0]!)).toEqual([])
  })
})

describe('Bind by name', () => {
  it('binds each unbound part to the one layer named after it, and guesses nothing', async () => {
    const { bindPartsByName, declaredParts } = await import('../src/contract-edits')
    const source = SOURCE.replace(
      '<Text name="label" characters="{label}" />',
      `<Frame name="base">
      <Frame name="thumb" />
      <Frame name="label" part="base" />
    </Frame>
    <Frame name="other">
      <Frame name="thumb" />
    </Frame>`,
    )
    const switchDoc = parseOrThrow(source)
    const component = switchDoc.tree.children[0]!
    const parts = declaredParts(component, library.roots[0]!)
    // `base` is already bound (to the label layer), and two layers are named thumb.
    expect(bindPartsByName(switchDoc, component, parts)).toEqual([])
    const once = parseOrThrow(
      source.replace('<Frame name="other">\n      <Frame name="thumb" />\n    </Frame>', ''),
    )
    const bound = bindPartsByName(
      once,
      once.tree.children[0]!,
      declaredParts(once.tree.children[0]!, library.roots[0]!),
    )
    expect(bound).toEqual([
      { op: 'add', address: 'Switch#base/thumb', prop: 'part', value: 'thumb' },
    ])
  })
})
