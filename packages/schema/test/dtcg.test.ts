import { describe, expect, it } from 'vitest'
import { parseOrThrow } from '@uidx/format'

import { fromDtcg, toDtcg } from '../src/dtcg.js'
import { buildTokenIndex } from '../src/token-index.js'

const TOKENS = parseOrThrow(`---
id: tokens
---

## Visual Contract

<Tokens>
  <Collection name="palette">
    <Variable name="blue" type="COLOR" value={{ r: 0, g: 0.5, b: 1, a: 1 }} description="Brand blue." />
    <Variable name="gap" type="FLOAT" value={8} />
    <Variable name="opacity-muted" type="FLOAT" value={0.6} />
  </Collection>
  <Collection name="theme" modes={['light', 'dark']}>
    <Variable name="accent" type="COLOR">
      <Mode name="light" value="{palette#blue}" />
      <Mode name="dark" value={{ r: 1, g: 1, b: 1, a: 1 }} />
    </Variable>
  </Collection>
</Tokens>
`)

describe('toDtcg', () => {
  const out = toDtcg(buildTokenIndex([TOKENS]))

  it('writes a file per collection and per mode, and a resolver for the modes', () => {
    expect([...out.files.keys()]).toEqual([
      'palette.tokens.json',
      'theme.light.tokens.json',
      'theme.dark.tokens.json',
    ])
    const resolver = JSON.parse(out.resolver!)
    expect(resolver.version).toBe('2025.10')
    expect(resolver.modifiers.theme).toEqual({
      contexts: {
        light: [{ $ref: 'theme.light.tokens.json' }],
        dark: [{ $ref: 'theme.dark.tokens.json' }],
      },
      default: 'light',
    })
  })

  it('writes 2025.10 values: colors, dimensions, numbers and aliases', () => {
    const palette = JSON.parse(out.files.get('palette.tokens.json')!).palette
    expect(palette.blue).toEqual({
      $type: 'color',
      $value: { colorSpace: 'srgb', components: [0, 0.5, 1], alpha: 1, hex: '#0080ff' },
      $description: 'Brand blue.',
    })
    expect(palette.gap).toEqual({ $type: 'dimension', $value: { value: 8, unit: 'px' } })
    expect(palette['opacity-muted']).toEqual({ $type: 'number', $value: 0.6 })
    const light = JSON.parse(out.files.get('theme.light.tokens.json')!).theme
    expect(light.accent.$value).toBe('{palette.blue}')
  })
})

describe('fromDtcg', () => {
  it('reads groups, hex colors, dimensions and aliases into a tokens page', () => {
    const { source, skipped } = fromDtcg([
      {
        color: {
          $type: 'color',
          blue: { 500: { $value: '#0080ff' } },
          link: { $value: '{color.blue.500}' },
        },
        space: { md: { $type: 'dimension', $value: { value: 1, unit: 'rem' } } },
        shadow: { card: { $type: 'shadow', $value: {} } },
      },
    ])
    const index = buildTokenIndex([parseOrThrow(source)])
    expect(index.entries.get('color#blue-500')?.valuesByMode.default).toEqual({
      r: 0,
      g: 0.502,
      b: 1,
      a: 1,
    })
    expect(index.entries.get('color#link')?.valuesByMode.default).toBe('{color#blue-500}')
    expect(index.entries.get('space#md')?.valuesByMode.default).toBe('1rem')
    expect(skipped).toEqual([
      'shadow.card: "shadow" is a composite token the variable model has no slot for',
    ])
  })

  it('makes several trees the modes of one collection, and round-trips', () => {
    const exported = toDtcg(buildTokenIndex([TOKENS]))
    const trees = ['theme.light.tokens.json', 'theme.dark.tokens.json'].map((file) =>
      JSON.parse(exported.files.get(file)!),
    )
    const { source } = fromDtcg(trees, { modes: ['light', 'dark'] })
    const accent = buildTokenIndex([parseOrThrow(source)]).entries.get('theme#accent')
    expect(accent?.type).toBe('COLOR')
    expect(accent?.valuesByMode).toEqual({
      light: '{palette#blue}',
      dark: { r: 1, g: 1, b: 1, a: 1 },
    })
  })
})
