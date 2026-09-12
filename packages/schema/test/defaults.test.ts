import { describe, expect, it } from 'vitest'
import { DECLARED_DEFAULTS, defaultFor, engineAnswers, PROP_UI, propUiFor } from '../src/index.js'

/**
 * The value an unset row shows has to be what the engine actually falls back
 * to, or a dimmed row is a lie about what the file resolves to. These come
 * from building a bare node of each element and reading it back through the
 * same `fromScene` mapping the write path uses — so they cannot drift from
 * the engine the way a hand-written table would.
 */
describe('defaultFor', () => {
  it('knows the geometry a bare rectangle resolves to', () => {
    expect(defaultFor('Rectangle', 'x')).toBe(0)
    expect(defaultFor('Rectangle', 'y')).toBe(0)
    expect(defaultFor('Rectangle', 'rotation')).toBe(0)
    expect(defaultFor('Rectangle', 'opacity')).toBe(1)
    expect(defaultFor('Rectangle', 'visible')).toBe(true)
  })

  it('knows a frame resolves its layout mode and padding', () => {
    expect(defaultFor('Frame', 'layoutMode')).toBe('NONE')
    expect(defaultFor('Frame', 'paddingLeft')).toBe(0)
    expect(defaultFor('Frame', 'cornerRadius')).toBe(0)
  })

  it('knows a text resolves its typography', () => {
    expect(defaultFor('Text', 'fontSize')).toBeTypeOf('number')
    expect(defaultFor('Text', 'textAlignHorizontal')).toBe('LEFT')
  })

  /**
   * A prop with no default is a real answer, not a gap: `maxWidth` unset means
   * no limit, not zero, and a line height unset means the font decides. Those
   * rows show as unset with nothing filled in rather than inventing a number
   * the document does not mean.
   */
  it('offers nothing only where nothing is what unset means', () => {
    const withoutDefault: string[] = []
    for (const [name, ui] of Object.entries(PROP_UI)) {
      if (ui.control === 'opaque') continue
      for (const element of ui.appliesTo ?? (['Frame'] as const)) {
        if (defaultFor(element, name) === undefined) withoutDefault.push(`${element}.${name}`)
      }
    }
    expect(withoutDefault.sort()).toEqual(
      [
        'Frame.maxHeight',
        'Frame.maxWidth',
        'Frame.minHeight',
        'Frame.minWidth',
        'Text.lineHeight',
        'Text.maxLines',
      ].sort(),
    )
  })

  it('declares a default only where the engine says nothing', () => {
    // Keeps the hand-written list from quietly growing: every entry must be a
    // prop the probe genuinely found nothing for.
    for (const prop of DECLARED_DEFAULTS) {
      const ui = PROP_UI[prop]
      const elements = ui?.appliesTo ?? (['Frame'] as const)
      const answered = elements.filter((element) => engineAnswers(element, prop))
      expect(answered, `${prop} is answered by the engine for ${answered.join()}`).toEqual([])
    }
  })

  it('is undefined for a prop that does not apply to the element', () => {
    // `characters` is Text's alone.
    expect(propUiFor('characters')?.appliesTo).toContain('Text')
    expect(defaultFor('Rectangle', 'characters')).toBeUndefined()
  })
})
