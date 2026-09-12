import { access, realpath, stat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

/** Select the same document from a project root, document path, or subdirectory. */
export async function resolveDocumentRoot(from = process.cwd()): Promise<string> {
  let dir = resolve(from)
  if (!(await stat(dir)).isDirectory()) dir = dirname(dir)
  for (;;) {
    if (await exists(resolve(dir, '.uidx/uidx.json'))) return realpath(resolve(dir, '.uidx'))
    if (await exists(resolve(dir, 'uidx.json'))) return realpath(dir)
    // A nested npm package must not silently edit its parent's designs.
    if (await exists(resolve(dir, 'package.json'))) break
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new Error(`No uidx document root found from ${from}. Run uidx init inside the project.`)
}
