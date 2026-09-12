import { defineConfig } from 'vitest/config'

/**
 * Watcher-driven tests wait on filesystem events, which behave badly under
 * concurrency: every `FileSession` starts a chokidar watcher, and running the
 * test files in parallel puts dozens of them on one machine polling at once.
 * That starved a single-file watcher badly enough to blow a 15s budget, which
 * reads as a product bug and is not one.
 *
 * So the files run one at a time. Slower, and the alternative was a suite that
 * failed roughly one run in six for reasons nobody could act on.
 *
 * The timeout is generous for the same reason: CI runners are slower than a dev
 * machine. Helpers stay below this ceiling so a failure names what it was
 * waiting for rather than being killed mid-wait — the default 5s was exactly
 * what `server.test.ts`'s own helper used, so vitest always won that race.
 */
export default defineConfig({
  test: {
    testTimeout: 20_000,
    hookTimeout: 20_000,
    fileParallelism: false,
  },
})
