import { createRequire } from 'node:module'
import { copyFile, constants, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { exists } from './project.js'

export interface JsonFile {
  path: string
  source: string | null
  data: Record<string, unknown>
}

export async function readMcpConfig(root: string): Promise<JsonFile> {
  const path = join(root, '.mcp.json')
  const source = (await exists(path)) ? await readFile(path, 'utf8') : null
  const data: unknown = source === null ? {} : JSON.parse(source)
  if (!data || typeof data !== 'object' || Array.isArray(data))
    throw new Error('.mcp.json must contain an object')
  const record = data as Record<string, unknown>
  if (
    record.mcpServers !== undefined &&
    (!record.mcpServers ||
      typeof record.mcpServers !== 'object' ||
      Array.isArray(record.mcpServers))
  ) {
    throw new Error('.mcp.json mcpServers must contain an object')
  }
  return { path, source, data: record }
}

export async function configureMcp(config: JsonFile, script: string): Promise<void> {
  const servers = (config.data.mcpServers ?? {}) as Record<string, unknown>
  if (Object.hasOwn(servers, 'uidx')) return
  config.data.mcpServers = {
    ...servers,
    uidx: { command: 'npm', args: ['run', '--silent', `${script}:mcp`] },
  }
  await writeFile(config.path, `${JSON.stringify(config.data, null, 2)}\n`)
}

/** Copies packaged skills without replacing any project-authored file. */
export async function installSkills(root: string): Promise<void> {
  const require = createRequire(import.meta.url)
  const source = join(dirname(require.resolve('uidx/package.json')), 'skills')
  const destinations = [
    join(root, '.agents/skills'),
    join(root, '.claude/skills'),
    join(root, '.uidx/.uidx-agent/skills'),
  ]
  for (const destination of destinations) await copyMissing(source, destination)
}

async function copyMissing(source: string, destination: string): Promise<void> {
  await mkdir(destination, { recursive: true })
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const target = join(destination, entry.name)
    if (entry.isDirectory()) {
      // Existing skill folders are authored units, including their references.
      if (!(await exists(target))) await copyMissing(join(source, entry.name), target)
    } else if (entry.isFile()) {
      try {
        await copyFile(join(source, entry.name), target, constants.COPYFILE_EXCL)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      }
    }
  }
}
