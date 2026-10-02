import { expect, it } from 'vitest'
import { parseOrThrow } from '../src/index.js'

/**
 * A description is prose the code target copies into a doc comment, so it is
 * kept as written: a code span keeps its backticks, and no space appears
 * where the author wrote none ("`item`;" was read back as "item ;").
 */
it('keeps code spans and punctuation in a declaration description', () => {
  const doc = parseOrThrow(`---
id: list
---

## Visual Contract

<Page>
  <Component name="List" status="draft">
    <Slot name="item" />
  </Component>
</Page>

## Contract

<Slots>
  <Slot name="item">Receives the person as \`item\`; defaults to a PersonRow.</Slot>
</Slots>
`)
  expect(doc.spec?.contract?.slots[0]?.description).toBe(
    'Receives the person as `item`; defaults to a PersonRow.',
  )
})
