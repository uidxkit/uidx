import { mkdir, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { glob } from 'tinyglobby'
import { readProjectConfig, validatePort } from '@uidx/agent/core'
import { readManifest } from '@uidx/server/document'
import { configureMcp, installSkills, readMcpConfig } from '../setup.js'
import type { Io } from '../cli.js'
import { exists, findProjectRoot, PROJECT_DIR, readPackage } from '../project.js'

const STARTER = `---
id: welcome
---

## Core Intent

Design alongside your application. Add pages and components in this .uidx folder.
Edits in the viewer are saved back to these files.

## Visual Contract

<Page>
  <Frame name="Welcome" width={640} height={240} layoutMode="VERTICAL"
    paddingTop={40} paddingBottom={40} paddingLeft={40} paddingRight={40} itemSpacing={16}
    fills={[{ type: 'SOLID', color: { r: 0.96, g: 0.97, b: 1, a: 1 } }]}>
    <Text name="heading" characters="Welcome to uidx" fontSize={32} fontWeight="BOLD" />
    <Text name="description" characters="Your project's design workspace." fontSize={16} />
  </Frame>
</Page>
`

export async function initProject(
  cwd: string,
  script = 'uidx',
  options: { port?: number } = {},
): Promise<string> {
  const root = await findProjectRoot(cwd)
  if (!root) throw new Error('No package.json found. Run uidx init inside an npm project.')
  if (!/^[\w:-]+$/.test(script)) throw new Error('--script must be a non-empty npm script name')
  const { source, data } = await readPackage(root)
  if (
    data.scripts !== undefined &&
    (!data.scripts || typeof data.scripts !== 'object' || Array.isArray(data.scripts))
  ) {
    throw new Error('package.json scripts must be an object')
  }
  const scripts = (data.scripts ?? {}) as Record<string, unknown>
  const additions = { [script]: 'uidx dev', [`${script}:mcp`]: 'uidx mcp' }
  for (const [name, command] of Object.entries(additions)) {
    if (scripts[name] !== undefined && scripts[name] !== command) {
      throw new Error(
        `The "${name}" script already exists. Choose another name with --script <name>.`,
      )
    }
  }
  const mcp = await readMcpConfig(root)

  const content = resolve(root, PROJECT_DIR)
  const manifest = resolve(content, 'uidx.json')
  const config = await readProjectConfig(content)
  if (options.port !== undefined) config.port = validatePort(options.port)
  const hasManifest = await exists(manifest)
  // Validate before writing anything; rerunning setup never replaces authored content.
  if (hasManifest) await readManifest(manifest)
  const hasPages =
    (await exists(content)) &&
    (
      await glob(['**/*.uidx'], {
        cwd: content,
        ignore: ['**/node_modules/**', '**/.uidx-agent/**'],
      })
    ).length > 0

  await mkdir(resolve(content, 'assets'), { recursive: true })
  if (!hasManifest) {
    const id = typeof data.name === 'string' && data.name ? data.name : basename(root)
    await writeFile(
      manifest,
      `${JSON.stringify({ id, files: ['**/*.uidx'], assets: ['assets/**'] }, null, 2)}\n`,
      { flag: 'wx' },
    )
    if (!hasPages) await writeFile(resolve(content, 'welcome.uidx'), STARTER, { flag: 'wx' })
  }
  const ignore = resolve(content, '.gitignore')
  if (!(await exists(ignore))) {
    await writeFile(
      ignore,
      '.uidx-server.json\n.uidx-agent/*\n!.uidx-agent/skills/\n!.uidx-agent/memory/\n',
      { flag: 'wx' },
    )
  }
  if (options.port !== undefined || !(await exists(resolve(content, 'config.json')))) {
    await writeFile(resolve(content, 'config.json'), `${JSON.stringify(config, null, 2)}\n`)
  }
  await installSkills(root)
  await configureMcp(mcp, script)
  if (Object.entries(additions).some(([name, command]) => scripts[name] !== command)) {
    data.scripts = { ...scripts, ...additions }
    const indent = source.match(/\n([\t ]+)"/)?.[1] ?? '  '
    const newline = source.includes('\r\n') ? '\r\n' : '\n'
    await writeFile(
      resolve(root, 'package.json'),
      `${JSON.stringify(data, null, indent)}\n`.replace(/\n/g, newline),
    )
  }
  return root
}

export async function runInit(argv: string[], io: Io): Promise<number> {
  try {
    const parsed = parseArgs({
      args: argv,
      options: { script: { type: 'string', default: 'uidx' }, port: { type: 'string' } },
    })
    const script = parsed.values.script!
    const root = await initProject(io.cwd ?? process.cwd(), script, {
      port: parsed.values.port === undefined ? undefined : Number(parsed.values.port),
    })
    io.out(
      `uidx ready in ${resolve(root, PROJECT_DIR)}\nRun npm run ${script} to open your design workspace.\nMCP: npm run --silent ${script}:mcp (.mcp.json).\nSkills: .agents/skills, .claude/skills, and .uidx/.uidx-agent/skills.\n`,
    )
    return 0
  } catch (error) {
    io.err(`${(error as Error).message}\n`)
    return 1
  }
}
