import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { glob } from 'tinyglobby'
import { readProjectConfig, validatePort } from '@uidx/agent/core'
import { readManifest } from '@uidx/server/document'
import { configureMcp, installSkills, readMcpConfig } from '../setup.js'
import type { Io } from '../cli.js'
import { exists, findProjectRoot, PROJECT_DIR, readPackage } from '../project.js'
import { STARTER_BUTTON, STARTER_TOKENS } from '../starter.js'

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
  options: { port?: number; designSystem?: boolean } = {},
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
    if (!hasPages && !options.designSystem)
      await writeFile(resolve(content, 'welcome.uidx'), STARTER, { flag: 'wx' })
  }
  if (options.designSystem) {
    // A starter system is written beside whatever exists; nothing is replaced.
    for (const [file, text] of [
      ['tokens.uidx', STARTER_TOKENS],
      ['button.uidx', STARTER_BUTTON],
    ] as const) {
      if (!(await exists(resolve(content, file)))) await writeFile(resolve(content, file), text)
    }
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
  await writeAgentGuide(root, script)
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
      options: {
        script: { type: 'string', default: 'uidx' },
        port: { type: 'string' },
        'design-system': { type: 'boolean', default: false },
      },
    })
    const script = parsed.values.script!
    const root = await initProject(io.cwd ?? process.cwd(), script, {
      port: parsed.values.port === undefined ? undefined : Number(parsed.values.port),
      designSystem: parsed.values['design-system'] === true,
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

const GUIDE_START = '<!-- uidx:start -->'
const GUIDE_END = '<!-- uidx:end -->'

/** What a coding agent in this repository should know about its design system. */
export function agentGuide(script: string): string {
  return `${GUIDE_START}
## Design system (uidx)

This project's designs and design system live in \`.uidx/\` as text files, one
component per page, and are versioned with the code.

When you build or change UI:

- **Use the design system's components and tokens.** Ask first: \`uidx_components\`
  and \`uidx_component\` (MCP) or \`npx uidx components\` and \`npx uidx component <Name>\`
  give each component's props, states, slots, behaviour rules, import line and a
  usage line. Never invent a prop, and never hard-code a colour, space or radius
  a token names — \`uidx_tokens\` / \`npx uidx tokens list\` gives each token's CSS variable.
- **Change a component in its \`.uidx\` file, not in generated code.** Generated
  files say so in their first line; regenerate with \`npx uidx codegen\`.
- **Check your work.** \`npx uidx check\` and \`npx uidx lint src\` must pass; \`npx uidx render <page> -o out.png\`
  shows a page as the canvas draws it. Designers review in the viewer: \`npm run ${script}\`.
- Editing designs: load the \`uidx-design-system\` and \`uidx-authoring\` skills first.
${GUIDE_END}
`
}

/**
 * Writes the guide into AGENTS.md (and CLAUDE.md when the project has one),
 * replacing a previous uidx block and leaving everything else as it was.
 */
async function writeAgentGuide(root: string, script: string): Promise<void> {
  const guide = agentGuide(script)
  const targets = ['AGENTS.md']
  if (await exists(resolve(root, 'CLAUDE.md'))) targets.push('CLAUDE.md')
  for (const name of targets) {
    const path = resolve(root, name)
    const current = (await exists(path)) ? await readFile(path, 'utf8') : ''
    const start = current.indexOf(GUIDE_START)
    const end = current.indexOf(GUIDE_END)
    const next =
      start !== -1 && end > start
        ? current.slice(0, start) + guide.trimEnd() + current.slice(end + GUIDE_END.length)
        : `${current}${current && !current.endsWith('\n\n') ? (current.endsWith('\n') ? '\n' : '\n\n') : ''}${guide}`
    if (next !== current) await writeFile(path, next)
  }
}
