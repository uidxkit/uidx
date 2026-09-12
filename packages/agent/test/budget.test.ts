import { describe, expect, it } from 'vitest'

import { budgetFor, MIN_WINDOW_TOKENS } from '../src/index/budget.js'

describe('budgetFor', () => {
  it('spends a fraction of the window on context, leaving the model room to think', () => {
    const b = budgetFor(16_384)
    // measured ~3.1 chars per token for .uidx markup; the pack must not claim the whole window.
    expect(b.packChars).toBeLessThan(16_384 * 4 * 0.5)
    expect(b.packChars).toBeGreaterThan(0)
  })

  it('scales with the window rather than being a fixed number', () => {
    expect(budgetFor(32_768).packChars).toBeGreaterThan(budgetFor(16_384).packChars)
    expect(budgetFor(4_096).packChars).toBeLessThan(budgetFor(16_384).packChars)
  })

  it('keeps a whole-file read smaller than the pack, so reading cannot evict the context', () => {
    const b = budgetFor(16_384)
    expect(b.readChars).toBeLessThanOrEqual(b.packChars)
  })

  it('never returns a budget so small that nothing useful fits', () => {
    expect(budgetFor(2_048).packChars).toBeGreaterThan(500)
  })

  // Pinned to the exact measured constants (CHARS_PER_TOKEN = 3.1, shares
  // 0.35/0.2/0.3) so a future change to any of them has to be deliberate —
  // the property tests above pass across a wide range of constants and would
  // not catch a share silently halving.
  it('pins the exact budget at the default 16,384-token window', () => {
    expect(budgetFor(16_384)).toEqual({
      windowTokens: 16_384,
      packChars: 17_776,
      outlineChars: 10_158,
      readChars: 15_237,
    })
  })

  it('clamps a window below the sane minimum up to it, so the floor cannot exceed the window', () => {
    expect(budgetFor(10)).toEqual(budgetFor(MIN_WINDOW_TOKENS))
    expect(budgetFor(1)).toEqual(budgetFor(MIN_WINDOW_TOKENS))
  })

  it('treats a non-finite or non-positive window as the sane minimum, never NaN', () => {
    expect(budgetFor(NaN)).toEqual(budgetFor(MIN_WINDOW_TOKENS))
    expect(budgetFor(Infinity)).toEqual(budgetFor(MIN_WINDOW_TOKENS))
    expect(budgetFor(0)).toEqual(budgetFor(MIN_WINDOW_TOKENS))
    expect(budgetFor(-100)).toEqual(budgetFor(MIN_WINDOW_TOKENS))
  })
})
