import { describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { parseOrThrow } from '@uidx/format'
import InsertPanel from '../src/InsertPanel.vue'

/**
 * The Insert panel opens ready to search: a designer types "Person" and picks
 * the component. Unfocused, the letters went to the canvas as tool keys.
 */
const doc = parseOrThrow(`---
id: p
---

## Visual Contract

<Page>
  <Component name="PersonRow" status="draft" width={10} height={10} />
</Page>`)

describe('the Insert panel', () => {
  it('puts the caret in its search when it opens, and filters to what is typed', async () => {
    const panel = mount(InsertPanel, {
      attachTo: document.body,
      props: {
        components: new Map([['PersonRow', doc.tree.children[0]!]]),
        writable: true,
        tool: null,
        placing: null,
      },
    })
    await flushPromises()
    await new Promise((resolve) => setTimeout(resolve, 0))
    const search = panel.get('input[type="search"]')
    expect(document.activeElement).toBe(search.element)
    await search.setValue('person')
    expect(panel.text()).toContain('PersonRow')
    panel.unmount()
  })
})
