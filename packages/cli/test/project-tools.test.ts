import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createUidxMcpServer } from '@uidx/agent/mcp'
import { createProjectMcpHttp } from '@uidx/agent/mcp/http'
import { connectProjectMcp } from '@uidx/agent/mcp/client'
import { createUidxServer, type UidxServer } from '@uidx/server'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { run } from '../src/cli.js'
import { initProject } from '../src/commands/init.js'

let root: string
let viewer: UidxServer | undefined
let client: Client | undefined
let mcp: ReturnType<typeof createUidxMcpServer> | undefined
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'uidx-tools-'))
  await writeFile(join(root, 'package.json'), '{"name":"tools-project"}')
  await initProject(root)
  await mkdir(join(root, 'src/components'), { recursive: true })
})
afterEach(async () => {
  await client?.close()
  await mcp?.close()
  await viewer?.close()
  client = undefined
  mcp = undefined
  viewer = undefined
  await rm(root, { recursive: true, force: true })
})
const textOf = (result: unknown) =>
  (result as { content: { text?: string }[] }).content[0]?.text ?? ''
async function cli(args: string[]) {
  let out = ''
  let err = ''
  const code = await run(args, {
    cwd: join(root, 'src/components'),
    out: (s) => {
      out += s
    },
    err: (s) => {
      err += s
    },
  })
  return { code, out, err }
}
async function connect() {
  mcp = createUidxMcpServer({ root })
  const [a, b] = InMemoryTransport.createLinkedPair()
  await mcp.connect(b)
  client = new Client({ name: 'project-test', version: '1.0.0' })
  await client.connect(a)
  return client
}

async function startViewer() {
  const content = join(root, '.uidx')
  const viewerRoot = join(root, 'built-viewer')
  await mkdir(viewerRoot)
  await writeFile(join(viewerRoot, 'index.html'), '<title>fixture</title>')
  viewer = await createUidxServer({
    file: join(content, 'welcome.uidx'),
    root: viewerRoot,
    viewerDist: viewerRoot,
    port: 4980,
    mcp: createProjectMcpHttp(content),
  })
  return viewer
}

describe('CLI, MCP and viewer share one project', () => {
  it('defaults CLI reads, creation and edits to the nearest project from a subdirectory', async () => {
    await startViewer()
    expect(await cli(['read', 'welcome.uidx', '--mode', 'outline'])).toMatchObject({
      code: 0,
      out: expect.stringContaining('Welcome'),
    })
    expect(await cli(['read', 'missing.uidx'])).toMatchObject({
      code: 1,
      err: expect.stringContaining('no such page'),
    })
    expect(await cli(['search', '[', '--regex'])).toMatchObject({
      code: 1,
      err: expect.stringContaining('invalid regex'),
    })
    expect((await cli(['create', 'button.uidx', '--id', 'button'])).code).toBe(0)
    expect(await readFile(join(root, '.uidx/button.uidx'), 'utf8')).toContain('id: button')
    await writeFile(
      join(root, 'src/components/ops.json'),
      JSON.stringify([
        {
          kind: 'set_prop',
          address: 'Welcome#heading',
          prop: 'characters',
          value: 'Local CLI edit',
        },
      ]),
    )
    expect(await cli(['apply', 'welcome.uidx', '--ops', 'ops.json'])).toMatchObject({
      code: 0,
      out: expect.stringContaining('applied 1 change'),
    })
    expect((await cli(['search', 'Local CLI edit'])).out).toContain('welcome.uidx')
    await writeFile(join(root, 'src/components/intent.md'), '## Core Intent\n\nCLI-authored intent')
    expect((await cli(['intent', 'welcome.uidx', '--file', 'intent.md'])).code).toBe(0)
    expect(await readFile(join(root, '.uidx/welcome.uidx'), 'utf8')).toContain(
      'CLI-authored intent',
    )
    await writeFile(join(root, 'src/components/query.js'), 'return pages()')
    const evaluated = await cli(['eval', '--file', 'query.js'])
    expect(evaluated.code, evaluated.err).toBe(0)
    expect(evaluated.out).toContain('button.uidx')
    const audit = await cli(['audit', '--format', 'json', '--no-render'])
    expect(JSON.parse(audit.out)).toEqual(
      expect.arrayContaining([expect.objectContaining({ file: 'welcome.uidx' })]),
    )
    const before = await readFile(join(root, '.uidx/welcome.uidx'), 'utf8')
    await writeFile(
      join(root, 'src/components/ops.json'),
      JSON.stringify([
        { kind: 'set_prop', address: 'Welcome', prop: 'layoutMode', value: 'vertical' },
      ]),
    )
    expect(await cli(['apply', 'welcome.uidx', '--ops', 'ops.json'])).toMatchObject({
      code: 1,
      err: expect.stringContaining('not applied'),
    })
    expect(await readFile(join(root, '.uidx/welcome.uidx'), 'utf8')).toBe(before)
  })

  it('binds MCP defaults and refuses another project root', async () => {
    const client = await connect()
    const tools = await client.listTools()
    expect(
      tools.tools.find((tool) => tool.name === 'uidx_apply')?.inputSchema.required,
    ).not.toContain('root')
    expect(
      textOf(
        await client.callTool({
          name: 'uidx_read',
          arguments: { page: 'welcome.uidx', mode: 'outline' },
        }),
      ),
    ).toContain('Welcome')
    const other = join(root, 'other')
    await mkdir(other)
    await writeFile(join(other, 'package.json'), '{"name":"other"}')
    await initProject(other)
    const refused = await client.callTool({
      name: 'uidx_create',
      arguments: { root: other, page: 'wrong.uidx', pageId: 'wrong' },
    })
    expect(refused.isError).toBe(true)
    expect(textOf(refused)).toContain('bound to another uidx project')
    // Canonical aliases of the same document are accepted.
    expect(
      textOf(
        await client.callTool({
          name: 'uidx_read',
          arguments: { root: join(root, '.uidx'), page: 'welcome.uidx' },
        }),
      ),
    ).toContain('Welcome to uidx')
  })

  it('routes both CLI and MCP node edits through the open viewer session', async () => {
    const content = join(root, '.uidx')
    const viewer = await startViewer()
    client = await connectProjectMcp(root)
    expect(
      textOf(
        await client.callTool({
          name: 'uidx_read',
          arguments: { page: 'welcome.uidx' },
        }),
      ),
    ).toContain('Welcome to uidx')
    expect(await cli(['selection', '--format', 'json'])).toMatchObject({
      code: 0,
      out: expect.stringContaining('addresses'),
    })
    expect(
      JSON.parse(textOf(await client.callTool({ name: 'uidx_selection', arguments: {} }))),
    ).toEqual({ file: null, addresses: [], at: null })
    await writeFile(
      join(root, 'src/components/ops.json'),
      JSON.stringify([
        {
          kind: 'set_prop',
          address: 'Welcome#heading',
          prop: 'characters',
          value: 'CLI through viewer',
        },
      ]),
    )
    expect((await cli(['apply', 'welcome.uidx', '--ops', 'ops.json'])).code).toBe(0)
    // HTTP writes advance the session synchronously; no filesystem watcher wait.
    expect(viewer.session.revision).toBe(2)
    expect(
      textOf(
        await client.callTool({
          name: 'uidx_read',
          arguments: { page: 'welcome.uidx' },
        }),
      ),
    ).toContain('CLI through viewer')
    const reply = await client.callTool({
      name: 'uidx_apply',
      arguments: {
        page: 'welcome.uidx',
        ops: [
          {
            kind: 'set_prop',
            address: 'Welcome#heading',
            prop: 'characters',
            value: 'MCP through viewer',
          },
        ],
      },
    })
    expect(textOf(reply)).toContain('applied 1 change')
    expect(viewer.session.revision).toBe(3)
    expect(await readFile(join(content, 'welcome.uidx'), 'utf8')).toContain('MCP through viewer')
  })

  it('tells CLI-only agents how to start the current project server', async () => {
    expect(await cli(['read', 'welcome.uidx'])).toMatchObject({
      code: 1,
      err: expect.stringContaining('npm run uidx'),
    })
  })

  it('releases the HTTP session when a shell client exits', async () => {
    const viewer = await startViewer()
    client = await connectProjectMcp(root)
    const id = (client.transport as StreamableHTTPClientTransport).sessionId!
    await client.close()
    const reply = await fetch(`${viewer.url}/mcp`, { headers: { 'mcp-session-id': id } })
    expect(reply.status).toBe(404)
    expect(await reply.text()).toBe('Unknown MCP session')
  })

  it('rejects discovery pointing to a different project before running any tools', async () => {
    await startViewer()
    const other = join(root, 'other')
    await mkdir(other)
    await writeFile(join(other, 'package.json'), '{"name":"other-project"}')
    await initProject(other)
    await writeFile(
      join(other, '.uidx/.uidx-server.json'),
      await readFile(join(root, '.uidx/.uidx-server.json')),
    )
    await expect(connectProjectMcp(other)).rejects.toThrow('another uidx project')
  })
})
