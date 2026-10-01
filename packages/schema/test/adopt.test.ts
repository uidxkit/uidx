import { describe, expect, it } from 'vitest'
import { parseOrThrow } from '@uidx/format'

import { adoptElement, componentNameFor } from '../src/adopt.js'
import { parseHeadless } from '../src/headless.js'

const MANIFEST = {
  modules: [
    {
      declarations: [
        {
          tagName: 'x-toggle',
          description: 'A switch.',
          attributes: [
            { name: 'checked', type: { text: 'boolean' } },
            { name: 'size', type: { text: "'sm' | 'md'" }, description: 'How big.' },
          ],
          events: [{ name: 'change' }],
          slots: [{ name: '' }, { name: 'hint' }],
        },
        { tagName: 'x-toggle-thumb' },
      ],
    },
  ],
}

describe('adoptElement', () => {
  const library = parseHeadless('custom-elements.json', MANIFEST)
  const page = adoptElement(library.roots[0]!)

  it('drafts a page that parses, named after the element without its prefix', () => {
    expect(componentNameFor('hwc-text-input')).toBe('TextInput')
    expect(page).toMatchObject({ file: 'toggle.uidx', name: 'Toggle' })
    const doc = parseOrThrow(page.source)
    expect(doc.tree.children[0]?.attrs.implements?.value).toBe('x-toggle')
  })

  it('fills the contract from the manifest, marking missing words', () => {
    const contract = parseOrThrow(page.source).spec!.contract!
    expect(contract.props.map((prop) => [prop.name, prop.type, prop.visual ?? false])).toEqual([
      ['checked', 'boolean', true],
      ['size', "'sm' | 'md'", false],
    ])
    expect(contract.props[1]!.description).toBe('How big.')
    expect(contract.props[0]!.description).toMatch(/^Describe /)
    expect(contract.slots.map((slot) => slot.name)).toEqual(['hint', 'default'])
    expect(contract.parts.map((part) => part.name)).toEqual(['thumb'])
  })

  it('drafts an element whose part and slot share a name (Shoelace sl-input)', () => {
    const shared = parseHeadless('custom-elements.json', {
      modules: [
        {
          declarations: [
            {
              tagName: 'sl-input',
              cssParts: [{ name: 'prefix' }, { name: 'base' }],
              slots: [{ name: 'prefix' }, { name: '' }],
            },
          ],
        },
      ],
    })
    const doc = parseOrThrow(adoptElement(shared.roots[0]!).source)
    const layers = doc.tree.children[0]!.children
    expect(layers.map((layer) => [layer.name, layer.attrs.part?.value])).toEqual([
      ['prefix-part', 'prefix'],
      ['base', 'base'],
      ['prefix', undefined],
      ['default', undefined],
    ])
  })
})
