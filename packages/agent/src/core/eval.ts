import { runInNewContext } from 'node:vm'

import type { JsonValue, UidxDocument, UidxNode } from '@uidx/format'

import { applyGated, type OpenedDocument } from './index.js'

/**
 * A script's-eye view of one node: plain data, no methods, no handles back
 * into the live document. Mutation happens through `ops` or not at all.
 */
export interface NodeView {
  element: string
  name: string | null
  address: string
  attrs: Record<string, JsonValue>
  children: NodeView[]
}

export interface EvalOutcome {
  /** Whatever the script returned, put through JSON — query results. */
  result: unknown
  /** One line per file the script queued ops for, in the words applyGated chose. */
  applied: { file: string; ok: boolean; message: string }[]
  /** console.log lines from the script, capped. */
  logs: string[]
}

const TIMEOUT_MS = 2_000
const MAX_LOGS = 200

function viewOf(node: UidxNode): NodeView {
  const attrs: Record<string, JsonValue> = {}
  for (const [key, attr] of Object.entries(node.attrs)) {
    if (attr?.value !== undefined) attrs[key] = attr.value
  }
  return {
    element: node.element,
    name: node.name ?? null,
    address: node.address,
    attrs,
    children: node.children.map(viewOf),
  }
}

/**
 * Run a script against the document — the Figma-plugin-API move, with this
 * harness's rules kept.
 *
 * The reason to have it is arithmetic: "set every section's width to its
 * parent's inner width" is five lines of code, or a read, a hand computation,
 * and thirty structured ops. Agents are better at writing the loop, and the
 * loop is cheaper on the wire. So a script gets a *plain-data* view of every
 * page (`doc`, `pages`, `visit`, `find`) and an op *builder* (`ops`) — and
 * that builder is the whole trick: scripts never mutate anything directly.
 * Queued ops run through `applyGated` after the script ends — the same
 * narrow → refuse → apply → audit path as every other surface — so a script
 * that writes `layoutMode="vertical"` is refused in the same words the
 * harness's own edit tool would use, and the twelve failure classes stay
 * closed.
 *
 * The sandbox is a `node:vm` context holding only the five names above plus
 * `console.log`. That is containment against accident and ambient authority,
 * not a hard boundary against a determined adversary — which is the honest
 * frame, because the caller already holds write authority through
 * `uidx_apply`; a script cannot do anything apply could not.
 */
export interface EvalHooks {
  /** Runs before a file's batch applies; a string refuses that batch with it. The harness's file budget lives here. */
  gate?: (file: string) => string | null
  /** Runs after a file's batch applied successfully. */
  onApplied?: (file: string) => void
}

export async function evalDocument(
  opened: OpenedDocument,
  script: string,
  hooks: EvalHooks = {},
): Promise<EvalOutcome> {
  const docs = opened.workspace.docs()
  const queued = new Map<string, unknown[]>()
  const logs: string[] = []

  const sandbox = {
    /** The whole page as plain data. */
    doc: (file: string): NodeView => {
      const document: UidxDocument | undefined = docs.get(file)
      if (!document) throw new Error(`no such page: ${file}`)
      return viewOf(document.tree)
    },
    /** Every page of the document, by file name. */
    pages: (): string[] => [...docs.keys()],
    /** Depth-first walk. */
    visit: (node: NodeView, fn: (node: NodeView) => void): void => {
      fn(node)
      for (const child of node.children) sandbox.visit(child, fn)
    },
    /** Every node matching a predicate. */
    find: (node: NodeView, predicate: (node: NodeView) => boolean): NodeView[] => {
      const hits: NodeView[] = []
      sandbox.visit(node, (n) => {
        if (predicate(n)) hits.push(n)
      })
      return hits
    },
    /** The op builder for one file — queued, then applied through the gates. */
    ops: (file: string) => {
      const list = queued.get(file) ?? []
      queued.set(file, list)
      return {
        set: (address: string, prop: string, value: unknown) =>
          void list.push({ kind: 'set_prop', address, prop, value }),
        removeProp: (address: string, prop: string) =>
          void list.push({ kind: 'remove_prop', address, prop }),
        insert: (parent: string, node: unknown, index?: number) =>
          void list.push({
            kind: 'insert_node',
            parent,
            node,
            ...(index === undefined ? {} : { index }),
          }),
        remove: (address: string) => void list.push({ kind: 'remove_node', address }),
        move: (address: string, newParent: string, index: number) =>
          void list.push({ kind: 'move_node', address, newParent, index }),
        rename: (address: string, name: string) =>
          void list.push({ kind: 'rename', address, name }),
      }
    },
    console: {
      log: (...parts: unknown[]) => {
        if (logs.length < MAX_LOGS) logs.push(parts.map((p) => String(p)).join(' '))
      },
    },
  }

  const raw = runInNewContext(`(() => { ${script}\n })()`, sandbox, {
    timeout: TIMEOUT_MS,
    // A script is one expression of intent; requiring code generation
    // (eval/new Function inside the sandbox) has no honest use here.
    contextCodeGeneration: { strings: false, wasm: false },
  })

  const applied: EvalOutcome['applied'] = []
  for (const [file, list] of queued) {
    if (list.length === 0) continue
    const refused = hooks.gate?.(file)
    if (refused) {
      applied.push({ file, ok: false, message: refused })
      continue
    }
    const outcome = await applyGated(opened, file, list)
    if (outcome.ok) hooks.onApplied?.(file)
    applied.push({ file, ok: outcome.ok, message: outcome.message })
  }

  // JSON round-trip: whatever crosses back out of the sandbox is data.
  const result = raw === undefined ? undefined : JSON.parse(JSON.stringify(raw))
  return { result, applied, logs }
}
