import { describe, expect, it } from 'vitest'
import { parseOrThrow } from '@uidx/format'
import { parseFigFile } from '@open-pencil/core/io/formats/fig'

import { exportFig } from '../src/core/fig.js'

describe('exportFig', () => {
  it('writes one .fig per page that parses back', async () => {
    const docs = new Map([
      [
        'card.uidx',
        parseOrThrow(`---
id: card
---

## Visual Contract

<Page>
  <Frame name="card" width={200} height={120}>
    <Text name="title" characters="Hello" fontSize={16} />
  </Frame>
</Page>
`),
      ],
    ])
    const files = await exportFig(docs)
    expect([...files.keys()]).toEqual(['card.fig'])
    const bytes = files.get('card.fig')!
    const parsed = await parseFigFile(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    )
    expect(parsed).toBeTruthy()
  })
})
