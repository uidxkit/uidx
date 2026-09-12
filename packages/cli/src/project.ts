import { access, readFile, stat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { documentMembers, readManifest } from '@uidx/server/document'

export const PROJECT_DIR = '.uidx'

export async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

/** The nearest npm package owns the design directory, including in a monorepo. */
export async function findProjectRoot(from: string): Promise<string | null> {
  let dir = resolve(from)
  if (!(await stat(dir)).isDirectory()) dir = dirname(dir)
  for (;;) {
    if (await exists(resolve(dir, 'package.json'))) return dir
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

export async function projectContentRoot(cwd: string): Promise<string | null> {
  const root = await findProjectRoot(cwd)
  if (!root) return null
  const content = resolve(root, PROJECT_DIR)
  return (await exists(resolve(content, 'uidx.json'))) ? content : null
}

export async function readPackage(root: string): Promise<{
  source: string
  data: Record<string, unknown>
}> {
  const source = await readFile(resolve(root, 'package.json'), 'utf8')
  const data: unknown = JSON.parse(source)
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('package.json must contain an object')
  }
  return { source, data: data as Record<string, unknown> }
}

/** Default commands share exactly the membership used by the live viewer. */
export async function projectFiles(cwd: string): Promise<string[] | null> {
  const dir = await projectContentRoot(cwd)
  if (!dir) return null
  const path = resolve(dir, 'uidx.json')
  const members = await documentMembers({ path, dir, manifest: await readManifest(path) })
  if (!members.length) throw new Error(`No .uidx pages are declared in ${path}.`)
  return members.map((file) => resolve(dir, file))
}
