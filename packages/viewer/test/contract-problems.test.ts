import { describe, expect, it } from 'vitest'
import { parseOrThrow, resolve } from '@uidx/format'

import { contractIssues, contractProblems, contractView } from '../src/contract-edits'
import { parseHeadless, type HeadlessLibrary } from '../src/headless'

const LIBRARY = parseHeadless('vendor/custom-elements.json', {
  modules: [
    {
      declarations: [
        { tagName: 'hwc-button', attributes: [{ name: 'variant' }] },
        { tagName: 'hwc-button-label' },
        { tagName: 'hwc-button-spinner' },
      ],
    },
  ],
})

const page = (body: string, regions = '') =>
  `---\nid: button\n---\n\n## Visual Contract\n\n<Page>\n${body}\n</Page>\n${regions}`

/**
 * The Contract tab's warning dot counts faults, not progress: an unbound part
 * is work not done yet, a binding code generation refuses is a problem.
 */
describe('contractProblems', () => {
  const doc = parseOrThrow(
    page(
      `  <Component name="Button" status="draft" implements="hwc-button">
    <Text name="label" part="label" characters="Go" />
    <Frame name="track" part="spinner-track" width={8} height={8} />
    <Frame name="icon" width={8} height={8} />
  </Component>
  <Component name="Plain" status="draft">
    <Frame name="thing" part="whatever" width={8} height={8} />
  </Component>`,
    ),
  )
  const view = (address: string, library: HeadlessLibrary | null = LIBRARY) =>
    contractView(doc, resolve(doc.tree, address), library)

  it('counts stray bindings on a component, not its unbound parts', () => {
    const button = view('Button')
    // spinner is unbound (progress); spinner-track is bound to nothing declared (a fault).
    expect(contractIssues(button)).toBe(2)
    expect(contractProblems(button, LIBRARY)).toBe(1)
  })

  it('counts a part value the implemented element does not offer', () => {
    expect(contractProblems(view('Button#track'), LIBRARY)).toBe(1)
    expect(contractProblems(view('Button#label'), LIBRARY)).toBe(0)
    expect(contractProblems(view('Button#icon'), LIBRARY)).toBe(0)
  })

  it('has nothing to check bindings against without a library or an element', () => {
    expect(contractProblems(view('Button#track', null), null)).toBe(0)
    expect(contractProblems(view('Plain#thing'), LIBRARY)).toBe(0)
    // The same bindings seen from the component: unchecked, so not a fault.
    expect(contractProblems(view('Button', null), null)).toBe(0)
    expect(contractProblems(view('Plain'), LIBRARY)).toBe(0)
  })
})
