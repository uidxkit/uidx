import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: {
    alias: {
      // The headless library, vendored until it is published (see vendor/hwc/VENDORED.md).
      '@hwc/components': fileURLToPath(new URL('./vendor/hwc/dist', import.meta.url)),
    },
  },
  esbuild: { jsx: 'automatic' },
  build: { target: 'esnext' },
})
