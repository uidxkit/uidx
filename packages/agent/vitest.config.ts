import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // The agent writes real files and runs real watchers; concurrent files
    // starve each other's chokidar events, exactly as in @uidx/server.
    fileParallelism: false,
    testTimeout: 20_000,
  },
})
