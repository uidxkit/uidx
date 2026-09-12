/**
 * How the context window is spent. The pack takes a share, not the lot: a
 * model that fills its window with document has no room left to answer, which
 * is how a small model ends a turn with `finishReason: length` instead of a
 * result.
 */
export interface ContextBudget {
  windowTokens: number
  packChars: number
  outlineChars: number
  readChars: number
}

/**
 * Measured, not assumed. `.uidx` source is JSX-like markup — brackets,
 * quotes, `=`, short attribute names — and it tokenizes denser than English
 * prose. Sent real chunks of `examples/checkbox.uidx` to a local model over
 * its OpenAI-compatible endpoint and read back `usage.prompt_tokens`: markup
 * came back at 3.14-3.30 chars/token across three independent samples (the
 * file's own prose "Core Intent" section measured 4.15, close to the old
 * flat guess of 4). The pack, the outline and a whole-file read all quote raw
 * `.uidx` source, so the markup figure is the one that governs. 3.1 sits at
 * or under every markup sample — the safe direction, since a CHARS_PER_TOKEN
 * that's too high lets a budget request more tokens than the window has.
 *
 * Exported so a caller that already has a `ContextBudget` (whose fields are
 * all in characters) can recover the window's own total character count —
 * `windowTokens * CHARS_PER_TOKEN` — without re-measuring or duplicating this
 * constant. The agent loop's compaction (`agent.ts`) is the first such
 * caller: it needs the whole window, not just the pack's share of it, to work
 * out what history can afford once the pack, a read, and fixed overhead are
 * also accounted for.
 */
export const CHARS_PER_TOKEN = 3.1

/** The context pack's share of the window. The rest is instructions, tools, history and output. */
const PACK_SHARE = 0.35
const OUTLINE_SHARE = 0.2
/**
 * Exported (unlike its two siblings above): `delegate.ts` reuses this figure
 * to size a worker's own token-usage guard — the most a single further tool
 * result could still add to a worker's conversation is bounded by this same
 * share, so the headroom that guard leaves is this value stated the other
 * way round. See `delegate.ts`'s own comment on `WORKER_STEP_TOKEN_SHARE`.
 */
export const READ_SHARE = 0.3

/**
 * Below this, the window can't hold anything useful: at CHARS_PER_TOKEN =
 * 3.1, a window has to be worth at least ~194 tokens of characters before
 * even the smallest share (OUTLINE_SHARE, 20%) clears a few hundred
 * characters. 2,048 leaves a wide margin above that and is also the smallest
 * window this module's own tests exercise, so it doubles as a "known good"
 * floor rather than an arbitrary one.
 *
 * Clamping `windowTokens` itself — instead of flooring packChars, outlineChars
 * and readChars independently — keeps the invariant in one place: no output
 * field can ever claim more characters than `windowTokens * CHARS_PER_TOKEN`
 * actually represents. A NaN or non-positive window (a malformed
 * UIDX_AGENT_CONTEXT_TOKENS, or any other caller that skipped validation)
 * falls back to this same floor rather than propagating NaN into every
 * consumer of the budget.
 */
export const MIN_WINDOW_TOKENS = 2_048

export function budgetFor(windowTokens: number): ContextBudget {
  const safeWindowTokens =
    Number.isFinite(windowTokens) && windowTokens > 0
      ? Math.max(windowTokens, MIN_WINDOW_TOKENS)
      : MIN_WINDOW_TOKENS
  const chars = safeWindowTokens * CHARS_PER_TOKEN
  return {
    windowTokens: safeWindowTokens,
    packChars: Math.floor(chars * PACK_SHARE),
    outlineChars: Math.floor(chars * OUTLINE_SHARE),
    readChars: Math.floor(chars * READ_SHARE),
  }
}
