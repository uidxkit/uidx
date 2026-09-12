#!/usr/bin/env node
/**
 * Copies the runtime binaries the viewer needs out of node_modules.
 *
 * These are deliberately not committed: `canvaskit.wasm` alone is ~7 MB and both
 * it and the Inter faces are byte-for-byte copies of installed dependencies, so
 * versioning them would just be a large binary diff every time the SDK moves.
 *
 * They are *runtime* assets, not build inputs — CanvasKit fetches the wasm over
 * HTTP and the viewer fetches the fonts, so neither can be bundled by Vite. They
 * have to exist as static files under `public/`.
 */
import { createRequire } from 'node:module'
import { copyFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const require = createRequire(join(root, 'packages', 'viewer', 'package.json'))
const publicDir = join(root, 'packages', 'viewer', 'public')

const FONTS = ['Inter-Regular', 'Inter-Medium', 'Inter-SemiBold', 'Inter-Bold']

function packageDir(name) {
  return dirname(require.resolve(`${name}/package.json`))
}

async function main() {
  await mkdir(join(publicDir, 'fonts'), { recursive: true })

  const canvaskit = join(packageDir('canvaskit-wasm'), 'bin', 'canvaskit.wasm')
  await copyFile(canvaskit, join(publicDir, 'canvaskit.wasm'))
  console.log('canvaskit.wasm')

  const assets = join(packageDir('@open-pencil/core'), 'assets')
  for (const font of FONTS) {
    await copyFile(join(assets, `${font}.ttf`), join(publicDir, 'fonts', `${font}.ttf`))
    console.log(`fonts/${font}.ttf`)
  }
}

main().catch((err) => {
  console.error(`asset setup failed: ${err.message}`)
  console.error('run `pnpm install` first')
  process.exitCode = 1
})
