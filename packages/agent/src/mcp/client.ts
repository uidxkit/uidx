import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { resolveDocumentRoot } from '../workspace/root.js'

/** Discover the actual bound port, then verify the server owns this project. */
export async function connectProjectMcp(from: string): Promise<Client> {
  const root = await resolveDocumentRoot(from)
  let mcpUrl: string
  try {
    const info = JSON.parse(await readFile(join(root, '.uidx-server.json'), 'utf8')) as {
      mcpUrl?: unknown
    }
    if (typeof info.mcpUrl !== 'string') throw new Error('Missing MCP endpoint')
    mcpUrl = info.mcpUrl
  } catch {
    throw new Error(`No uidx server is running for ${root}. Start it with npm run uidx.`)
  }
  const client = new Client({ name: 'uidx-project-client', version: '0.0.0' })
  const transport = new StreamableHTTPClientTransport(new URL(mcpUrl))
  const close = client.close.bind(client)
  let closing: Promise<void> | undefined
  client.close = () =>
    (closing ??= (async () => {
      // Closing the socket alone keeps an HTTP MCP session alive. Shell
      // commands are short-lived, so explicitly release their server cache.
      await transport.terminateSession().catch(() => undefined)
      await close()
    })())
  try {
    await client.connect(transport, { timeout: 5000 })
    const result = await client.callTool({ name: 'uidx_status', arguments: {} })
    const block = (result.content as { type: string; text?: string }[]).find(
      (entry) => entry.type === 'text',
    )
    const status = JSON.parse(block?.text ?? '{}') as { root?: string }
    if (status.root !== root) throw new Error('The endpoint belongs to another uidx project')
    return client
  } catch (error) {
    await client.close().catch(() => undefined)
    throw new Error(
      `Cannot connect to this project's uidx server at ${mcpUrl}: ${(error as Error).message}`,
    )
  }
}

/** A stdio adapter; functionality and document state remain on the viewer server. */
export async function startProjectMcpStdio(root: string): Promise<Server> {
  const remote = await connectProjectMcp(root)
  const proxy = new Server({ name: 'uidx', version: '0.0.0' }, { capabilities: { tools: {} } })
  proxy.setRequestHandler(ListToolsRequestSchema, () => remote.listTools())
  proxy.setRequestHandler(CallToolRequestSchema, (request) => remote.callTool(request.params))
  const stop = () => {
    void proxy.close()
  }
  proxy.onclose = () => {
    process.removeListener('SIGINT', stop)
    process.removeListener('SIGTERM', stop)
    process.stdin.removeListener('end', stop)
    void remote.close()
  }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  process.stdin.once('end', stop)
  await proxy.connect(new StdioServerTransport())
  return proxy
}
