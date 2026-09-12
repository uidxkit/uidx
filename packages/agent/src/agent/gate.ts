/**
 * Whether this turn's writing tools will answer yet.
 *
 * Step 0 is for orientation — a small model that can write immediately usually
 * writes before it has read — and that used to be enforced by handing step 0 a
 * restricted `activeTools`. It worked, and it cost more than it bought: a model
 * asked to *create a page* reaches for `create_file` first, and a tool missing
 * from `activeTools` comes back as `Model tried to call unavailable tool
 * 'create_file'`. That reads as "this tool does not exist", not "not yet".
 * Measured on qwen3.5, one run announced it could not create pages at all and
 * stopped; an otherwise identical run whose first instinct happened to be
 * `use_skill` created the file on its very next step. Whether the harness could
 * author anything came down to which way the model jumped first.
 *
 * So the rule is unchanged and only its voice is: the tool stays visible, and
 * answers early calls with a refusal in the same words every other refusal in
 * this harness uses — what went wrong, and what to do about it.
 */
export interface WriteGate {
  /**
   * False until the orchestrator has taken a step. Deliberately *not* a step
   * number: `delegate` hands a worker the orchestrator's own tool objects, so
   * this gate is shared with every worker's loop. "The orchestrator has taken a
   * step" is the precondition that makes that safe — a worker can only run
   * after `delegate` was called, and `delegate` is itself gated — where "is
   * this loop on step 0" would wrongly gate a worker's own first step.
   */
  open: boolean
}

export const createWriteGate = (): WriteGate => ({ open: false })

/**
 * The refusal a writing tool returns when it is called too early, or null when
 * it may proceed. Callers add their own `not applied — ` / `not created — `
 * opening, so the sentence reads the same as every other refusal from that
 * tool.
 *
 * An absent gate means the tool is being used outside an orchestrator loop —
 * a test, or a direct call — where there is no step 0 to be early for.
 */
export function tooEarly(gate: WriteGate | undefined, tool: string): string | null {
  if (!gate || gate.open) return null
  return `look at the page first — ${tool} is available from your next step, so call read or search now and ${tool} straight after`
}
