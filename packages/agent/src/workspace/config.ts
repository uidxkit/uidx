import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export const DEFAULT_VIEWER_PORT = 4400
export function validatePort(port: unknown): number {
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('uidx port must be an integer from 1 to 65535')
  }
  return port
}
export async function readProjectConfig(root: string): Promise<{ port: number }> {
  let source: string
  try {
    source = await readFile(join(root, 'config.json'), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { port: DEFAULT_VIEWER_PORT }
    throw error
  }
  const config: unknown = JSON.parse(source)
  if (!config || typeof config !== 'object' || Array.isArray(config))
    throw new Error('.uidx/config.json must contain an object')
  return { port: validatePort((config as { port?: unknown }).port ?? DEFAULT_VIEWER_PORT) }
}
