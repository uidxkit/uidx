import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  test: {
    // Most viewer tests are pure and need no DOM; component tests do, and the
    // cost of jsdom for the whole (small) suite is not worth a second project.
    environment: 'jsdom',
  },
})
