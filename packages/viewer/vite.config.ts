import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { thirdPartyNotices } from './licenses.js'

export default defineConfig({
  plugins: [vue(), thirdPartyNotices()],
  server: {
    // The workspace packages this imports live above the package root.
    fs: { allow: ['../..'] },
  },
  // @open-pencil/yoga-layout initialises its WASM with a top-level await, which
  // esbuild rejects under Vite's default dep-optimizer target. All three need
  // esnight or the app fails to start.
  esbuild: { target: 'esnext' },
  optimizeDeps: { esbuildOptions: { target: 'esnext' } },
  build: { target: 'esnext' },
})
