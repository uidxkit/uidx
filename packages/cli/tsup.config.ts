import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { uidx: 'src/uidx.ts', index: 'src/index.ts' },
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  clean: true,
  // Nothing is bundled. The workspace packages ship built JS now, so Node
  // resolves them at run time like any other dependency — which is what let
  // this package's own `dependencies` shrink to the two libraries it actually
  // imports. It used to list every transitive dependency of `@uidx/format` and
  // `@uidx/server`, because inlining their source made their imports this
  // bundle's problem.
  //
  // Bundling them was never desirable on its own: it pulled in CJS-only
  // packages (`yaml` resolves to CJS under the `node` condition) whose
  // `require('process')` became an esbuild `__require` that threw at startup.
  // Unit tests against the source never saw that, which is why
  // `test/binary.test.ts` runs the built artifact.
  shims: true,
  banner: { js: '#!/usr/bin/env node' },
})
