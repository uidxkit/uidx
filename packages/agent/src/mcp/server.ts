import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { resolveDocumentRoot } from '../workspace/root.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { evalDocument } from '../core/eval.js'
import {
  applyGated,
  auditAll,
  buildIndex,
  createFile,
  gateArchitecture,
  openDocument,
  queryDocument,
  renderToPng,
  RenderError,
  setIntent,
  viewerSelection,
  type Architecture,
  type OpenedDocument,
} from '../core/index.js'

export interface UidxMcpOptions {
  /** Bind every tool to this project's document; explicit roots must match it. */
  root?: string
}

/** Each connection owns its document cache and follows that document's viewer. */
export function createUidxMcpServer(options: UidxMcpOptions = {}): McpServer {
  const server = new McpServer({ name: 'uidx', version: '0.0.0' })
  const cwd = process.cwd()
  const open = new Map<string, Promise<OpenedDocument>>()
  const rootFor = async (root?: string): Promise<string> => {
    const bound = options.root ? await resolveDocumentRoot(resolve(cwd, options.root)) : null
    const dir = root
      ? await resolveDocumentRoot(resolve(cwd, root))
      : (bound ?? (await resolveDocumentRoot(cwd)))
    if (bound && dir !== bound) throw new Error('This MCP server is bound to another uidx project.')
    return dir
  }
  const documentAt = async (root?: string): Promise<OpenedDocument> => {
    const dir = await rootFor(root)
    let opening = open.get(dir)
    if (!opening) {
      opening = openDocument(dir)
      open.set(dir, opening)
      void opening.catch(() => open.delete(dir))
    }
    return opening
  }
  let closing: Promise<unknown> | undefined
  const closeDocuments = () =>
    (closing ??= Promise.allSettled([...open.values()].map(async (doc) => (await doc).close())))
  const previousClose = server.server.onclose
  server.server.onclose = () => {
    previousClose?.()
    void closeDocuments()
  }
  const close = server.close.bind(server)
  server.close = async () => {
    await close()
    await closeDocuments()
  }

  const text = (value: string) => ({ content: [{ type: 'text' as const, text: value }] })

  server.registerTool(
    'uidx_status',
    {
      description: 'The current project, viewer URL and MCP endpoint on the shared uidx server.',
      inputSchema: {},
    },
    async () => {
      const root = await rootFor()
      const info = JSON.parse(await readFile(join(root, '.uidx-server.json'), 'utf8')) as Record<
        string,
        unknown
      >
      return text(JSON.stringify({ ...info, root }, null, 2))
    },
  )

  server.registerTool(
    'uidx_audit',
    {
      description:
        'Run every uidx audit against a page (or all pages): blank nodes, unpositioned siblings, overflow, token-into-text, FIXED-without-size, missing glyphs — and whether the page actually renders. The verdict to trust over any visual impression.',
      inputSchema: {
        root: z
          .string()
          .optional()
          .describe('project or document root; defaults to the connected project'),
        page: z.string().optional().describe('one page, e.g. home.uidx; omit for every page'),
        render: z.boolean().optional().describe('also render for real (slower); default true'),
      },
    },
    async ({ root, page, render }) => {
      const opened = await documentAt(root)
      const docs = opened.workspace.docs()
      const pages = page
        ? [page]
        : [...docs.entries()].filter(([, d]) => d.tree.element === 'Page').map(([f]) => f)
      const reports = []
      for (const file of pages)
        reports.push(await auditAll(docs, file, { render: render !== false }))
      return text(JSON.stringify(reports, null, 2))
    },
  )

  server.registerTool(
    'uidx_read',
    {
      description:
        "Read efficiently: one node's exact source by address, a subtree's outline (shape without bodies), or a one-line signature. A component page runs to ~150k characters — never read a whole page when an address answers the question; get addresses from uidx_search or an outline read of the page.",
      inputSchema: {
        root: z
          .string()
          .optional()
          .describe('project or document root; defaults to the connected project'),
        page: z.string().describe('page path, e.g. home.uidx'),
        address: z
          .string()
          .optional()
          .describe(
            'node address, e.g. doc#states/grid — omit for the page (prefer mode outline then)',
          ),
        mode: z
          .enum(['source', 'outline', 'signature'])
          .optional()
          .describe(
            'source (default) exact text; outline the shape without bodies; signature one line',
          ),
      },
    },
    async ({ root, page, address, mode }) => {
      const opened = await documentAt(root)
      return text(
        await queryDocument(opened).read({
          file: page,
          ...(address ? { address } : {}),
          ...(mode ? { mode } : {}),
        }),
      )
    },
  )

  server.registerTool(
    'uidx_search',
    {
      description:
        'Search every page of the document for text. Addresses come back, not whole files — feed them to uidx_read.',
      inputSchema: {
        root: z
          .string()
          .optional()
          .describe('project or document root; defaults to the connected project'),
        query: z.string().describe('text to find'),
        regex: z.boolean().optional().describe('treat the query as a regular expression'),
        limit: z.number().optional().describe('most matches to return'),
      },
    },
    async ({ root, query, regex, limit }) => {
      const opened = await documentAt(root)
      return text(
        await queryDocument(opened).search({
          query,
          ...(regex !== undefined ? { regex } : {}),
          ...(limit !== undefined ? { limit } : {}),
        }),
      )
    },
  )

  server.registerTool(
    'uidx_apply',
    {
      description:
        'Apply edit ops to a page — the same jail, checkpoints and refusals the harness writes through, with every audit appended to a success.',
      inputSchema: {
        root: z
          .string()
          .optional()
          .describe('project or document root; defaults to the connected project'),
        page: z.string().describe('page path, e.g. home.uidx'),
        ops: z
          .array(z.record(z.string(), z.unknown()))
          .describe('edit ops: {kind, address?, prop?, value?, parent?, node?, ...}'),
      },
    },
    async ({ root, page, ops }) => {
      const opened = await documentAt(root)
      // The gated path: narrow → refuse (prop names, enum values, instances
      // of nothing) → apply → audit. For a while this surface skipped the
      // refusals and would have written layoutMode="vertical" happily.
      return text((await applyGated(opened, page, ops)).message)
    },
  )

  server.registerTool(
    'uidx_create',
    {
      description: 'Create a new empty page in the document, then fill it with uidx_apply.',
      inputSchema: {
        root: z
          .string()
          .optional()
          .describe('project or document root; defaults to the connected project'),
        page: z.string().describe('new page path, e.g. settings.uidx'),
        pageId: z.string().describe('the id in the page frontmatter'),
      },
    },
    async ({ root, page, pageId }) => {
      const opened = await documentAt(root)
      const result = await createFile(opened.apply, page, pageId)
      return text(result.ok ? `created ${page}` : `not created — ${result.error}`)
    },
  )

  server.registerTool(
    'uidx_intent',
    {
      description:
        "Write a page's Markdown intent — the prose above the tree (## Core Intent, ## Design, ## Anti-Patterns…). Replaces ALL of it, so include every section you want kept.",
      inputSchema: {
        root: z
          .string()
          .optional()
          .describe('project or document root; defaults to the connected project'),
        page: z.string().describe('page path, e.g. home.uidx'),
        body: z.string().describe('the whole intent as Markdown'),
      },
    },
    async ({ root, page, body }) => {
      const opened = await documentAt(root)
      const result = await setIntent(opened.apply, page, body)
      return text(result.ok ? `wrote the intent of ${page}` : `not written — ${result.error}`)
    },
  )

  server.registerTool(
    'uidx_eval',
    {
      description:
        'Run a JavaScript snippet against the document — query with code, write through the gates. The sandbox holds: doc(file) → the page as plain data ({element,name,address,attrs,children}); pages(); visit(node,fn); find(node,predicate); ops(file) → {set(address,prop,value), insert(parent,node,index?), remove(address)} — queued ops apply AFTER the script through the same refusals and audits as uidx_apply; console.log. Return a value to get it back as JSON. Semantics: reads are a snapshot (a script cannot see its own writes — chain two evals); ops are gated per file as one atomic batch (a bad op refuses the whole batch); one synchronous function body, 2s timeout, no imports; compose whole Components with all Variants in one insert. Builder also has removeProp/move/rename. Use this instead of chains of reads whenever a loop or a predicate says it better.',
      inputSchema: {
        root: z
          .string()
          .optional()
          .describe('project or document root; defaults to the connected project'),
        script: z
          .string()
          .describe('JavaScript function body; its return value comes back as JSON'),
      },
    },
    async ({ root, script }) => {
      const opened = await documentAt(root)
      try {
        const outcome = await evalDocument(opened, script)
        return text(JSON.stringify(outcome, null, 2))
      } catch (error) {
        return text(`eval failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    },
  )

  server.registerTool(
    'uidx_render',
    {
      description:
        'Draw a page or one node the way the canvas draws it, returned as a PNG image — look at what you built.',
      inputSchema: {
        root: z
          .string()
          .optional()
          .describe('project or document root; defaults to the connected project'),
        page: z.string().describe('page path, e.g. home.uidx'),
        address: z.string().optional().describe('node address, e.g. doc#states; omit for the page'),
        scale: z.number().optional().describe('default 0.5'),
      },
    },
    async ({ root, page, address, scale }) => {
      const opened = await documentAt(root)
      try {
        const png = await renderToPng({
          docs: opened.workspace.docs(),
          file: page,
          scale: scale ?? 0.5,
          ...(address ? { address } : {}),
        })
        return {
          content: [
            {
              type: 'image' as const,
              data: Buffer.from(png).toString('base64'),
              mimeType: 'image/png',
            },
          ],
        }
      } catch (error) {
        if (error instanceof RenderError) return text(`refused: ${error.message}`)
        throw error
      }
    },
  )

  server.registerTool(
    'uidx_selection',
    {
      description:
        'What the designer has selected in the open viewer right now — the addresses "this" means when they say "make this blue". Read-only; reports "no viewer is open" when none is running on the document.',
      inputSchema: {
        root: z
          .string()
          .optional()
          .describe('project or document root; defaults to the connected project'),
      },
    },
    async ({ root }) => {
      const result = await viewerSelection(await rootFor(root))
      if (result.viewer === 'none') return text(result.reason)
      return text(JSON.stringify(result.selection, null, 2))
    },
  )

  server.registerTool(
    'uidx_architect',
    {
      description:
        "Read or set a task's architecture — components with axes, token plan by tier, sections, constraints, appearance. Setting runs the same gate the harness runs: an architecture with named gaps is refused.",
      inputSchema: {
        root: z
          .string()
          .optional()
          .describe('project or document root; defaults to the connected project'),
        taskId: z.string().describe('the task this architecture belongs to'),
        set: z
          .record(z.string(), z.unknown())
          .optional()
          .describe('the architecture to store; omit to read the stored one'),
      },
    },
    async ({ root, taskId, set }) => {
      const opened = await documentAt(root)
      if (!set) {
        const existing = await opened.architectures.read(taskId)
        return text(existing ? opened.architectures.render(existing) : 'no architecture yet')
      }
      const architecture = { ...(set as unknown as Architecture), taskId }
      const index = buildIndex(opened.found.id, opened.workspace.docs())
      const refusal = gateArchitecture({ index }, architecture)
      if (refusal) return text(`not set — this architecture has gaps:\n${refusal}`)
      await opened.architectures.write(architecture)
      return text(`architecture set.\n${opened.architectures.render(architecture)}`)
    },
  )

  return server
}
