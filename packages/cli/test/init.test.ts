import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { run } from '../src/cli.js'
import { initProject } from '../src/commands/init.js'
import { projectContentRoot } from '../src/project.js'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'uidx-init-'))
  await writeFile(
    join(dir, 'package.json'),
    '{\n  "name": "my-app",\n  "scripts": { "dev": "vite" },\n  "devDependencies": { "@uidxkit/uidx": "0.1.0" }\n}\n',
  )
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

function invoke(args: string[], cwd = dir) {
  let out = ''
  let err = ''
  return run(args, {
    cwd,
    out: (text) => {
      out += text
    },
    err: (text) => {
      err += text
    },
  }).then((code) => ({ code, out, err }))
}

describe('project setup', () => {
  it('leaves project designs, nested pages, assets, configuration and skills trackable by Git', async () => {
    execFileSync('git', ['init', '--quiet'], { cwd: dir })
    await initProject(dir)
    await mkdir(join(dir, '.uidx/screens'))
    await writeFile(join(dir, '.uidx/screens/page.uidx'), 'design content')
    await writeFile(join(dir, '.uidx/assets/logo.svg'), '<svg/>')
    await writeFile(join(dir, '.uidx/.uidx-server.json'), '{"port":4400}')
    const visible = execFileSync('git', ['ls-files', '--others', '--exclude-standard'], {
      cwd: dir,
      encoding: 'utf8',
    }).split('\n')
    expect(visible).toEqual(
      expect.arrayContaining([
        '.uidx/uidx.json',
        '.uidx/config.json',
        '.uidx/welcome.uidx',
        '.uidx/screens/page.uidx',
        '.uidx/assets/logo.svg',
        '.uidx/.uidx-agent/skills/uidx-project/SKILL.md',
      ]),
    )
    expect(visible).not.toContain('.uidx/.uidx-server.json')
  })
  it('creates a valid design workspace and preserves application scripts and dependencies', async () => {
    expect((await invoke(['init'])).code).toBe(0)
    const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))
    expect(pkg).toEqual({
      name: 'my-app',
      scripts: { dev: 'vite', uidx: 'uidx dev', 'uidx:mcp': 'uidx mcp' },
      devDependencies: { '@uidxkit/uidx': '0.1.0' },
    })
    expect(JSON.parse(await readFile(join(dir, '.uidx/uidx.json'), 'utf8'))).toEqual({
      id: 'my-app',
      files: ['**/*.uidx'],
      assets: ['assets/**'],
    })
    expect(await invoke(['check'])).toMatchObject({
      code: 0,
      err: '',
      out: expect.stringContaining('1 file OK'),
    })
    expect((await invoke(['check', '.uidx'])).code).toBe(0)
    expect(await readFile(join(dir, '.uidx/.gitignore'), 'utf8')).toContain('.uidx-server.json')
  })

  it('installs portable skills and preserves existing MCP servers and authored skills', async () => {
    await writeFile(
      join(dir, '.mcp.json'),
      JSON.stringify({ mcpServers: { other: { command: 'other-tool' } } }),
    )
    await initProject(dir)
    const config = JSON.parse(await readFile(join(dir, '.mcp.json'), 'utf8'))
    expect(config.mcpServers).toEqual({
      other: { command: 'other-tool' },
      uidx: { command: 'npm', args: ['run', '--silent', 'uidx:mcp'] },
    })
    for (const folder of ['.agents/skills', '.claude/skills', '.uidx/.uidx-agent/skills']) {
      expect(await readdir(join(dir, folder))).toEqual([
        'uidx-authoring',
        'uidx-component-docs',
        'uidx-eval-api',
        'uidx-project',
      ])
      await writeFile(join(dir, folder, 'uidx-project/SKILL.md'), 'project-authored skill')
    }
    config.mcpServers.uidx = { command: 'custom-mcp' }
    const raw = JSON.stringify(config)
    await writeFile(join(dir, '.mcp.json'), raw)
    await initProject(dir)
    expect(await readFile(join(dir, '.mcp.json'), 'utf8')).toBe(raw)
    expect(await readFile(join(dir, '.agents/skills/uidx-project/SKILL.md'), 'utf8')).toBe(
      'project-authored skill',
    )
  })

  it('rejects malformed MCP configuration before creating files', async () => {
    await writeFile(join(dir, '.mcp.json'), '{"mcpServers":[]}')
    expect((await invoke(['init'])).code).toBe(1)
    expect(await readdir(dir)).toEqual(['.mcp.json', 'package.json'])
  })

  it('persists the shared viewer and MCP port and preserves it on reinitialization', async () => {
    expect((await invoke(['init', '--port', '4567'])).code).toBe(0)
    const path = join(dir, '.uidx/config.json')
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ port: 4567 })
    await initProject(dir)
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ port: 4567 })
    expect((await invoke(['init', '--port', '0'])).code).toBe(1)
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ port: 4567 })
  })

  it('is byte-for-byte idempotent and keeps authored files and configuration', async () => {
    await initProject(dir)
    const manifest = '{ "id": "custom", "files": ["welcome.uidx"], "assets": [] }\n'
    const page = (await readFile(join(dir, '.uidx/welcome.uidx'), 'utf8')).replace(
      'Welcome to uidx',
      'My design',
    )
    await writeFile(join(dir, '.uidx/uidx.json'), manifest)
    await writeFile(join(dir, '.uidx/welcome.uidx'), page)
    const pkg = await readFile(join(dir, 'package.json'), 'utf8')
    await initProject(dir)
    expect(await readFile(join(dir, 'package.json'), 'utf8')).toBe(pkg)
    expect(await readFile(join(dir, '.uidx/uidx.json'), 'utf8')).toBe(manifest)
    expect(await readFile(join(dir, '.uidx/welcome.uidx'), 'utf8')).toBe(page)
  })

  it('finds the nearest package from a subdirectory and keeps checks scoped to .uidx', async () => {
    const cwd = join(dir, 'src/components')
    await mkdir(cwd, { recursive: true })
    await writeFile(join(cwd, 'unrelated.uidx'), 'invalid source')
    await initProject(cwd)
    expect(await projectContentRoot(cwd)).toBe(join(dir, '.uidx'))
    expect((await invoke(['check'], cwd)).code).toBe(0)
    const result = await invoke(['fmt', '--check'], cwd)
    expect(result.out).toContain('welcome.uidx')
    expect(result.out).not.toContain('unrelated.uidx')
    expect((await invoke(['check', 'unrelated.uidx'], cwd)).code).toBe(1)
    await writeFile(join(cwd, 'package.json'), '{"name":"child"}')
    expect(await projectContentRoot(cwd)).toBeNull()
  })

  it('refuses script collisions before writing and accepts another script name', async () => {
    await writeFile(join(dir, 'package.json'), '{"scripts":{"uidx":"existing"}}')
    const result = await invoke(['init'])
    expect(result).toMatchObject({ code: 1, err: expect.stringContaining('--script') })
    expect(await readdir(dir)).toEqual(['package.json'])
    expect((await invoke(['init', '--script', 'design'])).code).toBe(0)
    expect(JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')).scripts).toEqual({
      uidx: 'existing',
      design: 'uidx dev',
      'design:mcp': 'uidx mcp',
    })
  })

  it('uses the manifest membership for default checks and formatting', async () => {
    await initProject(dir)
    await writeFile(join(dir, '.uidx/uidx.json'), '{"id":"app","files":["welcome.uidx"]}')
    await writeFile(join(dir, '.uidx/excluded.uidx'), 'not a design document')
    expect((await invoke(['check'])).code).toBe(0)
    expect((await invoke(['fmt', '--check'])).out).not.toContain('excluded.uidx')
    await writeFile(join(dir, '.uidx/uidx.json'), '{"id":"app","files":["missing.uidx"]}')
    expect(await invoke(['check'])).toMatchObject({
      code: 1,
      err: expect.stringContaining('No .uidx pages'),
    })
  })

  it('keeps existing pages when creating a manifest', async () => {
    await mkdir(join(dir, '.uidx'))
    await writeFile(join(dir, '.uidx/custom.uidx'), 'authored content')
    await initProject(dir)
    expect(await readdir(join(dir, '.uidx'))).not.toContain('welcome.uidx')
    expect(await readFile(join(dir, '.uidx/custom.uidx'), 'utf8')).toBe('authored content')
  })

  it('rejects malformed configuration without writing', async () => {
    await mkdir(join(dir, '.uidx'))
    await writeFile(join(dir, '.uidx/uidx.json'), 'broken')
    const before = await readFile(join(dir, 'package.json'), 'utf8')
    expect((await invoke(['init'])).code).toBe(1)
    expect(await readFile(join(dir, 'package.json'), 'utf8')).toBe(before)
    expect(await readdir(join(dir, '.uidx'))).toEqual(['uidx.json'])
  })

  it('reports missing setup and invalid ports clearly', async () => {
    expect(await invoke(['dev', '--port', '70000'])).toMatchObject({
      code: 1,
      err: expect.stringContaining('65535'),
    })
    // Inside an npm project a missing workspace is set up by `dev` itself
    // (see open.test.ts); outside one there is nothing to set up, so it says how.
    await rm(join(dir, 'package.json'))
    expect(await invoke(['dev', '--no-open'])).toMatchObject({
      code: 1,
      out: expect.stringContaining('uidx init'),
    })
    expect(await invoke(['init'])).toMatchObject({
      code: 1,
      err: expect.stringContaining('package.json'),
    })
  })
})
