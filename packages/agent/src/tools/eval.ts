import { tool, type Tool } from 'ai'
import { z } from 'zod'

import { tooEarly, type WriteGate } from '../agent/gate.js'
import { evalDocument } from '../core/eval.js'
import type { OpenedDocument } from '../core/index.js'
import type { TurnFileBudget } from './edit.js'

export interface EvalToolDeps {
  opened: OpenedDocument
  /** Shared with `edit` — a script writing three files spends three files. */
  fileBudget: TurnFileBudget
  /** Same gate as every writing tool: look before writing. */
  writeGate?: WriteGate
}

/**
 * The eval tool, in the harness's own loop — the upgrade every measured
 * failure pointed at.
 *
 * The runs that built this project emitted ops one JSON object at a time,
 * and their worst failures were form-filling failures: a component phase
 * that died three times on shell-then-variants batching, states grids that
 * ran out of steps at thirty hand-emitted instances, twelve sections given
 * the same wrong width one op each. A script composes the structure in
 * memory — the whole Component with every variant in ONE insert, the grid as
 * a map over the axes — and applies once, through the same gates as edit.
 *
 * The turn's discipline still holds: the write gate refuses an eval before
 * the model has looked, and the file budget is shared with edit — a script
 * is not a way around either.
 */
export function evalTools(deps: EvalToolDeps): { eval: Tool } {
  const evalTool = tool({
    description:
      'Run a JavaScript function body against the document — query with code, write through the gates. Globals: doc(file) → the page as plain data {element,name,address,attrs,children}; pages(); visit(node,fn); find(node,predicate); ops(file) → {set,removeProp,insert,remove,move,rename} — queued ops apply AFTER the script as one gated batch per file, audits appended; console.log. Return a value to get it back as JSON. Reads are a snapshot: a script cannot see its own writes — chain calls, one section per script. Compose whole Components with all their Variants in one insert. Prefer this over many edit calls whenever a loop or a predicate says it better.',
    inputSchema: z.object({
      script: z.string().describe('JavaScript function body; 2s limit, no imports'),
    }),
    execute: async ({ script }) => {
      const early = tooEarly(deps.writeGate, 'eval')
      if (early) return `not run — ${early}`
      try {
        const outcome = await evalDocument(deps.opened, script, {
          gate: (file) => deps.fileBudget.check(file),
          onApplied: (file) => deps.fileBudget.record(file),
        })
        return JSON.stringify(outcome, null, 2)
      } catch (error) {
        return `eval failed: ${error instanceof Error ? error.message : String(error)}`
      }
    },
  })

  return { eval: evalTool }
}
