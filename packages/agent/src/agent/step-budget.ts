/**
 * What one assistant step has already pulled into the window.
 *
 * `ai@7` runs the tool calls of a single step under `Promise.all`, so two
 * `read` calls landing together is an ordinary shape rather than an edge case
 * — and `budget.readChars` sizes exactly *one* of them. Measured at roughly
 * 27% over the window when two arrive in the same step, which is a turn that
 * ends in `finishReason: length` for a reason nothing in the loop reports.
 *
 * This is Codex's `TruncationPolicy` idea at this harness's grain: bound the
 * input when it is recorded, not after it has already cost the turn.
 *
 * Reset by `prepareStep` at the top of every step; spent by `read`. An absent
 * budget means the tool is being used outside a loop — a test, a direct call —
 * where there is no step to be spent.
 */
export interface StepBudget {
  spent: number
}

export const createStepBudget = (): StepBudget => ({ spent: 0 })
