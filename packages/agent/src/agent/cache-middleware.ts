import type { LanguageModelMiddleware } from 'ai'

/**
 * Marks the prompt for Anthropic's prompt caching, cutting the input bill by
 * up to 90% on everything the loop re-sends.
 *
 * Why this matters here: a chat completion API is stateless, so every step of
 * a tool loop re-sends the entire conversation — the system prompt, the
 * document pack, and every prior step. Measured on a real run, a single page
 * cost ~105 requests across 8 turns, each carrying the whole growing history
 * at full input price. Anthropic bills a cached prefix at one tenth of that,
 * and the prefix of step N is byte-for-byte the prompt of step N-1 — the
 * perfect cache shape, going unused only because nobody set the flag.
 *
 * Two breakpoints:
 *   the system message   — stable across every turn of a task, so even a
 *                          fresh turn's first step reads it from cache
 *   the last message     — makes the *whole* conversation so far the cached
 *                          prefix, so the next step pays full price only for
 *                          what the previous step added
 *
 * Anthropic allows four breakpoints; two leaves deliberate headroom. Applied only
 * when the provider is Anthropic's — the option rides in a provider-namespaced
 * bag every other provider ignores by contract, and the guard in `turn.ts`
 * keeps even that noise off local models' wire.
 */
export function anthropicCaching(): LanguageModelMiddleware {
  return {
    transformParams: async ({ params }) => {
      const prompt = params.prompt.map((message, i) => {
        if (message.role !== 'system' && i !== params.prompt.length - 1) return message
        // Merged a level deep, not spread over: this middleware owns one key
        // in the anthropic namespace, and a message already carrying others
        // must keep them.
        const anthropic = {
          ...(message.providerOptions?.anthropic as Record<string, unknown> | undefined),
          cacheControl: { type: 'ephemeral' },
        }
        return { ...message, providerOptions: { ...message.providerOptions, anthropic } }
      })
      return { ...params, prompt }
    },
  }
}
