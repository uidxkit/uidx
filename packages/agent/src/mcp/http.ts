import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'
import { createUidxMcpServer } from './server.js'

/** MCP lives on the viewer's HTTP server and is bound to its document root. */
export function createProjectMcpHttp(root: string) {
  const sessions = new Map<string, StreamableHTTPServerTransport>()
  const servers = new Set<ReturnType<typeof createUidxMcpServer>>()
  return {
    async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
      const id = request.headers['mcp-session-id']
      if (typeof id === 'string') {
        const session = sessions.get(id)
        if (session) return session.handleRequest(request, response)
        response.writeHead(404).end('Unknown MCP session')
        return
      }
      if (request.method !== 'POST') {
        response.writeHead(400).end('Initialize an MCP session first')
        return
      }
      const chunks: Buffer[] = []
      let size = 0
      for await (const chunk of request) {
        const bytes = Buffer.from(chunk)
        size += bytes.length
        if (size > 1024 * 1024) {
          response.writeHead(413).end('Request too large')
          return
        }
        chunks.push(bytes)
      }
      let body: unknown
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      } catch {
        response.writeHead(400).end('Invalid JSON')
        return
      }
      if (!isInitializeRequest(body)) {
        response.writeHead(400).end('Initialize an MCP session first')
        return
      }
      const server = createUidxMcpServer({ root })
      const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sessionId) => {
          sessions.set(sessionId, transport)
        },
        onsessionclosed: (sessionId) => {
          sessions.delete(sessionId)
        },
      })
      servers.add(server)
      const onclose = server.server.onclose
      server.server.onclose = () => {
        servers.delete(server)
        onclose?.()
      }
      try {
        await server.connect(transport)
        await transport.handleRequest(request, response, body)
      } catch (error) {
        await server.close()
        throw error
      }
    },
    async close(): Promise<void> {
      await Promise.allSettled([...servers].map((server) => server.close()))
      servers.clear()
      sessions.clear()
    },
  }
}
