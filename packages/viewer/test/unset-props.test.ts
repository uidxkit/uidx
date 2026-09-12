import { describe, expect, it } from 'vitest'
import { parseOrThrow, type UidxNode } from '@uidx/format'
import { editableProps, selectedNode } from '../src/editable'

const DOC = parseOrThrow(`---
id: unset
---

## Visual Contract

<Page>
  <Component name="Card" status="stable">
    <Frame name="root" layoutMode="VERTICAL" opacity={0.5}>
      <Text name="label" characters="Hi" />
    </Frame>
  </Component>
</Page>
`)

const node = (address: string): UidxNode => selectedNode(DOC.tree, [address])!
const fieldsOf = (address: string) => editableProps(node(address))
const find = (address: string, prop: string) => fieldsOf(address).find((f) => f.name === prop)

describe('every applicable property shows (C7)', () => {
  it('offers rotation on a frame that never declared one', () => {
    const rotation = find('Card#root', 'rotation')
    expect(rotation).toBeDefined()
    expect(rotation!.authored).toBe(false)
    expect(rotation!.value).toBe(0)
    expect(rotation!.control).toBe('number')
  })

  it('marks an authored property as authored, with the file’s value', () => {
    const opacity = find('Card#root', 'opacity')
    expect(opacity!.authored).toBe(true)
    expect(opacity!.value).toBe(0.5)
  })

  it('offers a frame its layout and appearance props unset', () => {
    for (const prop of ['cornerRadius', 'paddingLeft', 'clipsContent', 'blendMode']) {
      const field = find('Card#root', prop)
      expect(field, prop).toBeDefined()
      expect(field!.authored, prop).toBe(false)
    }
  })

  it('offers a text its typography, and no frame-only props', () => {
    const names = fieldsOf('Card#root/label').map((f) => f.name)
    expect(names).toContain('fontSize')
    expect(names).toContain('textAlignHorizontal')
    // `layoutMode` belongs to frames and components alone.
    expect(names).not.toContain('layoutMode')
  })

  it('leaves a prop with no meaningful default valueless rather than inventing one', () => {
    // `maxWidth` unset means no limit, not zero.
    const maxWidth = find('Card#root', 'maxWidth')
    expect(maxWidth).toBeDefined()
    expect(maxWidth!.authored).toBe(false)
    expect(maxWidth!.value).toBeNull()
  })

  it('offers the page root nothing it cannot own', () => {
    // The page is a document, not a shape — as C8 already held for paints.
    const names = fieldsOf('').map((f) => f.name)
    expect(names).not.toContain('rotation')
  })

  it('keeps authored rows first, so the file’s own decisions read together', () => {
    const fields = fieldsOf('Card#root')
    const firstUnset = fields.findIndex((f) => !f.authored)
    const lastAuthored = fields.map((f) => f.authored).lastIndexOf(true)
    expect(lastAuthored).toBeLessThan(firstUnset)
  })
})
