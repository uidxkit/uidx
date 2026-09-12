import { parse, type UidxDocument } from '@uidx/format'
import { describe, expect, it } from 'vitest'

import { describeNearest, resolvablePrefixes } from '../src/address.js'

const SOURCE = `---
id: home
---

## Visual Contract

<Page>
  <Frame name="card" layoutMode="VERTICAL">
    <Text name="title" characters="Hello" />
    <Text name="body" characters="World" />
  </Frame>
  <Frame name="empty" />
</Page>
`

const doc = (): UidxDocument => {
  const result = parse(SOURCE)
  if (!result.doc) throw new Error('fixture does not parse')
  return result.doc
}

describe('resolvablePrefixes', () => {
  it('walks a deep address back to the page root, longest first', () => {
    expect(resolvablePrefixes('doc#states/matrix/cell')).toEqual([
      'doc#states/matrix/cell',
      'doc#states/matrix',
      'doc#states',
      'doc',
      '',
    ])
  })

  it("keeps a top-level name's own slash, which is part of the name", () => {
    expect(resolvablePrefixes('Control/Checkbox#state=on')).toEqual([
      'Control/Checkbox#state=on',
      'Control/Checkbox',
      '',
    ])
  })

  it('bottoms out at the page root', () => {
    expect(resolvablePrefixes('')).toEqual([''])
  })
})

describe('describeNearest', () => {
  it('names the children of the nearest node that does exist', () => {
    expect(describeNearest(doc(), 'card#missing')).toBe(' — card holds card#title, card#body')
  })

  it('says so plainly when the nearest node has no children', () => {
    expect(describeNearest(doc(), 'empty#title')).toBe(' — empty has no children yet')
  })

  it('falls back to the page root, naming its top-level nodes', () => {
    expect(describeNearest(doc(), 'nowhere#at#all')).toBe(' — the page holds card, empty')
  })

  it('says nothing when the address actually resolves', () => {
    expect(describeNearest(doc(), 'card')).toBe('')
  })
})
