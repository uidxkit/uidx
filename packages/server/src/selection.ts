/**
 * The viewer's current selection, held for anyone outside the browser.
 *
 * The canvas reports over the socket (`selection:changed`); the server keeps
 * only the latest and answers this route with it. That is the whole feature:
 * an agent on the shell (CLI, MCP) can read what "this" means when the
 * designer says "make this blue". Read-only by design — nothing here lets an
 * agent move the selection.
 */
export const SELECTION_ROUTE = '/__uidx/selection'

export interface SelectionState {
  /** The page the selection is on, workspace-relative like every PageRef. */
  file: string
  addresses: string[]
  /** When the report arrived (ms since epoch), so a reader can judge staleness. */
  at: number
}

/** What the route answers: the latest report, or the empty selection. */
export function selectionReply(current: SelectionState | null): {
  file: string | null
  addresses: string[]
  at: number | null
} {
  if (!current) return { file: null, addresses: [], at: null }
  return current
}
