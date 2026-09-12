import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { verifyDependencyFixes } from './check-dependency-fixes.mjs'

const exec = promisify(execFile)
const root = fileURLToPath(new URL('..', import.meta.url))
const tarballs = resolve(root, 'dist/packages')
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const linked = process.argv.includes('--linked')
const registry = process.argv.includes('--registry')
assert(!(linked && registry), 'Choose a local link or the npm registry')
const release = JSON.parse(await readFile(join(root, 'packages/cli/package.json'), 'utf8'))
const ignoreScripts = process.argv.includes('--ignore-scripts')
const project = await realpath(await mkdtemp(join(tmpdir(), 'uidx-install-')))
let child
let mcp
let log = ''
async function command(bin, args) {
  const result = await exec(bin, args, { cwd: project, maxBuffer: 4 * 1024 * 1024 })
  return result.stdout
}
async function until(check) {
  const deadline = Date.now() + 20_000
  do {
    const result = await check()
    if (result) return result
    if (child?.exitCode !== null && child?.exitCode !== undefined) throw new Error(log)
    await new Promise((done) => setTimeout(done, 50))
  } while (Date.now() < deadline)
  throw new Error(`Timed out waiting for the installed viewer.\n${log}`)
}
try {
  await writeFile(
    join(project, 'package.json'),
    JSON.stringify({ name: 'consumer-app', private: true, scripts: { dev: 'echo application' } }),
  )
  const files = linked
    ? [join(root, 'packages/cli')]
    : registry
      ? [`${release.name}@${release.version}`]
      : (await readdir(tarballs))
          .filter((name) => name.endsWith('.tgz'))
          .map((name) => join(tarballs, name))
  if (!linked) assert.equal(files.length, 1, 'run pnpm pack:release first')
  console.log(`Installing ${files.join(', ')} in ${project}`)
  await command(npm, [
    'install',
    '--save-dev',
    ...(linked || ignoreScripts ? ['--ignore-scripts'] : []),
    '--no-audit',
    '--no-fund',
    '--cache',
    join(tmpdir(), 'uidx-npm-cache'),
    ...files,
  ])
  // Import the published API and use the installed executable, with no workspace source resolution.
  const cli = join(project, 'node_modules/@uidxkit/uidx/dist/uidx.js')
  assert.equal((await command(process.execPath, [cli, '--version'])).trim(), release.version)
  await command(process.execPath, [
    '--input-type=module',
    '-e',
    "const { run } = await import('@uidxkit/uidx'); if (typeof run !== 'function') process.exit(1)",
  ])
  const port = linked ? 4950 : 4940
  if (linked || ignoreScripts) {
    await command(process.execPath, [cli, 'init'])
  }
  const pkg = JSON.parse(await readFile(join(project, 'package.json'), 'utf8'))
  assert.equal(pkg.scripts.uidx, 'uidx dev')
  assert.equal(pkg.scripts['uidx:mcp'], 'uidx mcp')
  assert.equal(pkg.scripts.dev, 'echo application')
  assert.ok(
    pkg.devDependencies['@uidxkit/uidx'],
    '@uidxkit/uidx is installed as a project devDependency',
  )
  assert.deepEqual(Object.keys(pkg.devDependencies), ['@uidxkit/uidx'])
  assert.equal(pkg.dependencies?.['@uidxkit/uidx'], undefined)
  assert.deepEqual(JSON.parse(await readFile(join(project, '.uidx/config.json'), 'utf8')), {
    port: 4400,
  })
  // Configuration is owned and editable by the consumer, independently of setup.
  await writeFile(join(project, '.uidx/config.json'), JSON.stringify({ port }))
  const starter = await readFile(join(project, '.uidx/welcome.uidx'), 'utf8')
  const manifest = await readFile(join(project, '.uidx/uidx.json'), 'utf8')
  if (!linked && !ignoreScripts) {
    // Re-running the install lifecycle preserves authored files and configuration.
    await command(npm, ['rebuild', '@uidxkit/uidx', '--cache', join(tmpdir(), 'uidx-npm-cache')])
    assert.equal(await readFile(join(project, '.uidx/welcome.uidx'), 'utf8'), starter)
    assert.equal(await readFile(join(project, '.uidx/uidx.json'), 'utf8'), manifest)
    assert.deepEqual(JSON.parse(await readFile(join(project, '.uidx/config.json'), 'utf8')), {
      port,
    })
  }
  const require = createRequire(await realpath(cli))
  verifyDependencyFixes(dirname(require.resolve('@uidx/schema')))
  if (!linked) {
    assert.match(
      await readFile(join(project, 'node_modules/@uidxkit/uidx/LICENSE'), 'utf8'),
      /MIT License/,
    )
    assert.match(
      await readFile(join(project, 'node_modules/@uidxkit/uidx/THIRD_PARTY_NOTICES.md'), 'utf8'),
      /Open Pencil/,
    )
    const schemaRequire = createRequire(require.resolve('@uidx/schema'))
    const agentRequire = createRequire(require.resolve('@uidx/agent'))
    assert.equal(
      schemaRequire.resolve('@open-pencil/core'),
      agentRequire.resolve('@open-pencil/core'),
      'schema and agent use the same patched drawing runtime',
    )
    const sourceRequire = createRequire(join(root, 'packages/schema/package.json'))
    for (const specifier of ['@open-pencil/core/vector', '@open-pencil/scene-graph/types']) {
      assert.equal(
        await readFile(schemaRequire.resolve(specifier), 'utf8'),
        await readFile(sourceRequire.resolve(specifier), 'utf8'),
        `${specifier} retains the workspace patches in the installed package`,
      )
    }
  }
  for (const name of ['server', 'viewer']) {
    const location = require.resolve(`@uidx/${name}${name === 'viewer' ? '/package.json' : ''}`)
    assert.ok(linked || location.startsWith(join(project, 'node_modules')))
  }
  for (const folder of ['.agents/skills', '.claude/skills', '.uidx/.uidx-agent/skills']) {
    assert.match(
      await readFile(join(project, folder, 'uidx-project/SKILL.md'), 'utf8'),
      /uidx render/,
    )
  }
  const registration = JSON.parse(await readFile(join(project, '.mcp.json'), 'utf8')).mcpServers
    .uidx
  assert.match(await command(process.execPath, [cli, 'check']), /1 file OK/)
  await writeFile(
    join(project, 'vite.config.js'),
    'throw new Error("Do not load the application config")',
  )
  child = spawn(npm, ['run', 'uidx', '--', '--no-open', ...(linked ? ['--viewer-dev'] : [])], {
    cwd: project,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  })
  child.stdout.on('data', (data) => {
    log += data
  })
  child.stderr.on('data', (data) => {
    log += data
  })
  const url = await until(() => log.match(/http:\/\/localhost:\d+/)?.[0])
  assert.equal(url, `http://localhost:${port}`, 'project config is used without a CLI override')
  const html = await (await fetch(url)).text()
  assert.match(html, /<title>UIDX<\/title>/)
  if (linked) assert.match(html, /\/@vite\/client/)
  else assert.doesNotMatch(html, /\/src\/|\/@vite\/client/)
  const script = linked ? '/src/main.ts' : html.match(/src="([^"]+\.js)"/)?.[1]
  assert.ok(script)
  assert.equal((await fetch(`${url}${script}`)).status, 200)
  const wasm = await (await fetch(`${url}/canvaskit.wasm`)).arrayBuffer()
  assert.deepEqual([...new Uint8Array(wasm).slice(0, 4)], [0, 97, 115, 109])
  assert.equal((await fetch(`${url}/fonts/Inter-Regular.ttf`)).status, 200)
  if (!linked) {
    const notices = await (await fetch(`${url}/third-party-notices.txt`)).text()
    assert.match(notices, /SIL OPEN FONT LICENSE/)
    assert.match(notices, /@open-pencil\/core/)
  }
  const patch = await fetch(`${url}/__uidx/patch`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      file: 'welcome.uidx',
      patches: [
        {
          op: 'set',
          address: 'Welcome#heading',
          prop: 'characters',
          value: 'Saved from installed uidx',
        },
      ],
    }),
  })
  assert.equal(patch.status, 200, await patch.text())
  assert.match(
    await readFile(join(project, '.uidx/welcome.uidx'), 'utf8'),
    /Saved from installed uidx/,
  )
  // A shell-only agent needs no MCP setup and uses the very same server.
  const status = JSON.parse(await command(process.execPath, [cli, 'status']))
  assert.equal(status.url, url)
  assert.equal(status.mcpUrl, `${url}/mcp`)
  assert.equal(status.root, await realpath(join(project, '.uidx')))
  assert.match(
    await command(process.execPath, [cli, 'read', 'welcome.uidx']),
    /Saved from installed uidx/,
  )
  await command(process.execPath, [cli, 'create', 'second.uidx', '--id', 'second'])
  assert.match(await readFile(join(project, '.uidx/second.uidx'), 'utf8'), /id: second/)
  const edit = (value) => ({
    kind: 'set_prop',
    address: 'Welcome#heading',
    prop: 'characters',
    value,
  })
  await writeFile(join(project, 'edits.json'), JSON.stringify([edit('CLI-only agent edit')]))
  assert.match(
    await command(process.execPath, [cli, 'apply', 'welcome.uidx', '--ops', 'edits.json']),
    /applied 1 change/,
  )
  assert.match(
    await command(process.execPath, [cli, 'search', 'CLI-only agent edit']),
    /welcome.uidx/,
  )
  await command(process.execPath, [cli, 'render', 'welcome.uidx', '-o', 'preview.png'])
  assert.deepEqual(
    [...(await readFile(join(project, 'preview.png'))).subarray(0, 8)],
    [137, 80, 78, 71, 13, 10, 26, 10],
  )

  // Exercise the exact stdio registration init generated; tools execute at /mcp.
  const { Client } = await import(
    pathToFileURL(require.resolve('@modelcontextprotocol/sdk/client/index.js')).href
  )
  const { StdioClientTransport } = await import(
    pathToFileURL(require.resolve('@modelcontextprotocol/sdk/client/stdio.js')).href
  )
  mcp = new Client({ name: 'npm-install-smoke', version: '1.0.0' })
  await mcp.connect(new StdioClientTransport({ ...registration, cwd: project, stderr: 'pipe' }))
  assert.equal((await mcp.listTools()).tools.length, 11)
  const textOf = (reply) => reply.content.find((block) => block.type === 'text')?.text
  const remoteStatus = JSON.parse(
    textOf(await mcp.callTool({ name: 'uidx_status', arguments: {} })),
  )
  assert.equal(remoteStatus.url, url)
  assert.equal(remoteStatus.root, status.root)
  const applied = await mcp.callTool({
    name: 'uidx_apply',
    arguments: { page: 'welcome.uidx', ops: [edit('MCP agent edit')] },
  })
  assert.match(textOf(applied), /applied 1 change/)
  assert.match(await command(process.execPath, [cli, 'read', 'welcome.uidx']), /MCP agent edit/)
  console.log(
    'Passed: project installation, skills, configured port, viewer JS/WASM/fonts, CLI reads/edits/PNG rendering, and MCP stdio sharing the viewer server.',
  )
} finally {
  await mcp?.close()
  if (child && child.exitCode === null) {
    const closed = once(child, 'close')
    if (process.platform === 'win32') child.kill('SIGTERM')
    else process.kill(-child.pid, 'SIGTERM')
    await closed
  }
  await rm(project, { recursive: true, force: true })
}
