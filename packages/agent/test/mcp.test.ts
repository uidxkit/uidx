import { randomUUID } from 'node:crypto'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { describe, expect, it } from 'vitest'

import { createUidxMcpServer } from '../src/mcp/server.js'

const PAGE = `---
id: home
---

## Visual Contract

<Page>
  <Frame name="hero" width={600} height={200} />
</Page>
`

async function harness() {
  const root = await mkdtemp(join(tmpdir(), 'uidx-mcp-'))
  await writeFile(join(root, 'uidx.json'), JSON.stringify({ id: 'doc', files: ['**/*.uidx'] }))
  await writeFile(join(root, 'home.uidx'), PAGE)
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const server = createUidxMcpServer()
  await server.connect(serverTransport)
  const client = new Client({ name: 'test', version: '0.0.0' })
  await client.connect(clientTransport)
  return { root, client }
}

// `callTool` returns a union that includes a legacy `toolResult` shape; this
// suite only ever speaks the modern one.
const textOf = (result: unknown): string =>
  (result as { content: { type: string; text?: string }[] }).content[0]?.text ?? ''

/**
 * The MCP surface is the same facade the harness tools and the CLI call — so
 * this suite checks the wiring, not the rules: the rules have their own tests,
 * and a surface that re-tested them would be a surface tempted to re-implement
 * them.
 */
describe('uidx over MCP', () => {
  it('lists the project tools an external agent drives uidx with', async () => {
    const { client } = await harness()
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name).sort()).toEqual([
      'uidx_apply',
      'uidx_architect',
      'uidx_audit',
      'uidx_create',
      'uidx_eval',
      'uidx_intent',
      'uidx_read',
      'uidx_render',
      'uidx_search',
      'uidx_selection',
      'uidx_status',
    ])
  })

  it('answers a selection request with no viewer open in plain words', async () => {
    const { root, client } = await harness()
    const result = await client.callTool({ name: 'uidx_selection', arguments: { root } })
    expect(textOf(result)).toContain('no viewer is open')
  })

  // A component page runs to ~150k characters; the query surface is how an
  // agent understands it without swallowing it — the same slices the
  // harness's own model reads.
  it('reads one node by address, and a page as an outline', async () => {
    const { root, client } = await harness()
    const node = await client.callTool({
      name: 'uidx_read',
      arguments: { root, page: 'home.uidx', address: 'hero' },
    })
    expect(textOf(node)).toContain('<Frame name="hero"')
    expect(textOf(node)).not.toContain('<Page>')
    const outline = await client.callTool({
      name: 'uidx_read',
      arguments: { root, page: 'home.uidx', mode: 'outline' },
    })
    expect(textOf(outline)).toContain('@hero')
  })

  it('searches every page and answers with addresses, not files', async () => {
    const { root, client } = await harness()
    const found = await client.callTool({
      name: 'uidx_search',
      arguments: { root, query: 'hero' },
    })
    expect(textOf(found)).toContain('home.uidx')
    expect(textOf(found)).not.toContain('<Page>')
  })

  it('applies ops through the same jail and appends the same audits', async () => {
    const { root, client } = await harness()
    const applied = await client.callTool({
      name: 'uidx_apply',
      arguments: {
        root,
        page: 'home.uidx',
        ops: [
          {
            kind: 'insert_node',
            parent: '',
            node: { element: 'Frame', attrs: { name: 'stray' } },
          },
        ],
      },
    })
    expect(textOf(applied)).toContain('applied 1 change(s)')
    // The audit chain rode along: a sized-nothing frame is named on the spot.
    expect(textOf(applied)).toContain('stray draws nothing')
  })

  it('refuses a bad op in the words the shared narrowing chose', async () => {
    const { root, client } = await harness()
    const refused = await client.callTool({
      name: 'uidx_apply',
      arguments: { root, page: 'home.uidx', ops: [{ kind: 'insert_node' }] },
    })
    expect(textOf(refused)).toContain('not applied — ')
  })

  it('audits a page as structured data', async () => {
    const { root, client } = await harness()
    const audit = await client.callTool({
      name: 'uidx_audit',
      arguments: { root, page: 'home.uidx', render: false },
    })
    const [report] = JSON.parse(textOf(audit))
    expect(report.file).toBe('home.uidx')
    expect(report.faults).toEqual([])
  })

  it('reads a page source as written', async () => {
    const { root, client } = await harness()
    const read = await client.callTool({
      name: 'uidx_read',
      arguments: { root, page: 'home.uidx' },
    })
    expect(textOf(read)).toContain('<Frame name="hero"')
  })

  // The two write tools a remote agent cannot do without: a new page, and the
  // prose above the tree. Both write on the machine the server runs on —
  // which is the point of remote: the document lives with the server.
  it('creates a page and writes its intent through the same apply path', async () => {
    const { root, client } = await harness()
    const created = await client.callTool({
      name: 'uidx_create',
      arguments: { root, page: 'settings.uidx', pageId: 'settings' },
    })
    expect(textOf(created)).toBe('created settings.uidx')
    const wrote = await client.callTool({
      name: 'uidx_intent',
      arguments: { root, page: 'settings.uidx', body: '## Core Intent\n\nA settings page.' },
    })
    expect(textOf(wrote)).toBe('wrote the intent of settings.uidx')
    const read = await client.callTool({
      name: 'uidx_read',
      arguments: { root, page: 'settings.uidx' },
    })
    expect(textOf(read)).toContain('A settings page.')
  })

  it('gates an architecture the same way the harness architect does', async () => {
    const { root, client } = await harness()
    const refused = await client.callTool({
      name: 'uidx_architect',
      arguments: {
        root,
        taskId: 't1',
        set: {
          summary: 's',
          components: [{ name: 'C', props: [], axes: [{ name: 'a', values: ['only'] }] }],
          tokens: [],
          sections: [{ name: 'cover', holds: 'x' }],
          constraints: [],
          appearance: [],
        },
      },
    })
    expect(textOf(refused)).toContain('not set')
    expect(textOf(refused)).toContain('"a" has 1 value(s)')
  })
})

/**
 * The remote story: a client on another machine speaks Streamable HTTP to a
 * server sitting where the document lives, and the writes land there — same
 * facade, same jail, same audits, different wire.
 */
describe('uidx over streamable HTTP', () => {
  it('serves the same tools over the network transport', async () => {
    const root = await mkdtemp(join(tmpdir(), 'uidx-mcp-http-'))
    await writeFile(join(root, 'uidx.json'), JSON.stringify({ id: 'doc', files: ['**/*.uidx'] }))
    await writeFile(join(root, 'home.uidx'), PAGE)

    const sessions = new Map<string, StreamableHTTPServerTransport>()
    const http = createServer(async (req, res) => {
      const sessionId = req.headers['mcp-session-id']
      const existing = typeof sessionId === 'string' ? sessions.get(sessionId) : undefined
      if (existing) return void (await existing.handleRequest(req, res))
      const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          sessions.set(id, transport)
        },
      })
      await createUidxMcpServer().connect(transport)
      await transport.handleRequest(req, res)
    })
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve))
    const { port } = http.address() as AddressInfo

    try {
      const client = new Client({ name: 'remote', version: '0.0.0' })
      await client.connect(
        new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)),
      )
      const { tools } = await client.listTools()
      expect(tools.map((t) => t.name)).toContain('uidx_apply')
      const applied = await client.callTool({
        name: 'uidx_apply',
        arguments: {
          root,
          page: 'home.uidx',
          ops: [{ kind: 'set_prop', address: 'hero', prop: 'width', value: 800 }],
        },
      })
      expect(textOf(applied)).toContain('applied 1 change(s)')
      await client.close()
    } finally {
      http.close()
    }
  })
})
