import { describe, expect, it } from 'vitest'
import { parseOrThrow } from '@uidx/format'
import { childSelection, parentSelection } from '../src/layer-actions'

/** Shift+Enter and Enter: up to the holder, down to what it holds — states included. */
const doc = parseOrThrow(`---
id: switch
---

## Visual Contract

<Page>
  <Component name="Switch" status="draft" layoutMode="HORIZONTAL">
    <Frame name="control" layoutMode="HORIZONTAL">
      <Frame name="thumb" />
    </Frame>
  </Component>
</Page>

## Contract

<Props>
  <Prop name="checked" type="boolean" default={false} visual>On.</Prop>
</Props>
`)

describe('selecting up and down', () => {
  it('walks authored layers', () => {
    expect(parentSelection(doc, 'Switch#control/thumb')).toBe('Switch#control')
    expect(parentSelection(doc, 'Switch#control')).toBe('Switch')
    expect(parentSelection(doc, 'Switch')).toBeNull()
    expect(childSelection(doc, 'Switch#control')).toEqual(['Switch#control/thumb'])
    expect(childSelection(doc, 'Switch#control/thumb')).toBeNull()
  })

  it("walks a state's variant by its addresses", () => {
    expect(parentSelection(doc, 'Switch#state=checked/root/control/thumb')).toBe(
      'Switch#state=checked/root/control',
    )
    expect(parentSelection(doc, 'Switch#state=checked/root')).toBe('Switch#state=checked')
    expect(parentSelection(doc, 'Switch#state=checked')).toBe('Switch')
    expect(childSelection(doc, 'Switch#state=checked/root/control')).toEqual([
      'Switch#state=checked/root/control/thumb',
    ])
    expect(childSelection(doc, 'Switch#state=checked')).toEqual([
      'Switch#state=checked/root/control',
    ])
  })
})
