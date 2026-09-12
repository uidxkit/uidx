import type { LanguageModelMiddleware } from 'ai'

/**
 * Logs every model request's token usage to the server's stdout, one line per
 * request, so cost is a number in the log rather than a guess after the bill.
 *
 * `usage: in=31204 cached=28900 out=412`
 *
 * A tool loop makes one request per step and a page costs on the order of a
 * hundred; nothing else in the harness records what each one weighed, which is
 * how the cost conversation ran on estimates for a week. The `cached` figure
 * is also the direct proof of whether `anthropicCaching` is earning its keep —
 * near-zero there with an anthropic model means the breakpoints are wrong.
 *
 * Middleware rather than a stream-response callback because this is the one
 * place every request passes regardless of caller — orchestrator, worker, and
 * whatever comes next — and the finish part of the raw stream is where the
 * provider reports what actually happened.
 *
 * The sink is injectable (and defaults to the process's stdout rather than
 * `console`, which this package's lint reserves for the bin entry) so a test
 * can capture lines without capturing a stream.
 */
export function usageLog(
  label = 'usage',
  write: (line: string) => void = (line) => process.stdout.write(`${line}\n`),
): LanguageModelMiddleware {
  return {
    wrapStream: async ({ doStream }) => {
      const { stream, ...rest } = await doStream()
      const tap = new TransformStream({
        transform(part, controller) {
          // The V4 usage shape: nested totals, with cache reads and writes
          // split out — exactly the split that says whether caching earns.
          const p = part as {
            type?: string
            usage?: {
              inputTokens?: { total?: number; cacheRead?: number; cacheWrite?: number }
              outputTokens?: { total?: number }
            }
          }
          if (p.type === 'finish' && p.usage) {
            const input = p.usage.inputTokens ?? {}
            const output = p.usage.outputTokens ?? {}
            write(
              `${label}: in=${input.total ?? '?'} cacheRead=${input.cacheRead ?? 0} cacheWrite=${input.cacheWrite ?? 0} out=${output.total ?? '?'}`,
            )
          }
          controller.enqueue(part)
        },
      })
      return { stream: stream.pipeThrough(tap), ...rest }
    },
  }
}
