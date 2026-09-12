import type { ClientMessage } from '@uidx/server/protocol'

/**
 * The canvas telling the server what is selected, so an agent outside the
 * browser can read what "this" means (the CLI's `uidx selection`, the MCP
 * tool). Fire-and-forget over the same socket patches ride; an empty
 * selection is a report too, or the server would go on serving something the
 * designer already walked away from.
 *
 * Null before a page is open: the dashboard has no nodes, and a report
 * without a page would be an address with no document to mean it in.
 */
export function selectionReport(
  file: string | null,
  addresses: readonly string[],
): ClientMessage | null {
  if (file === null) return null
  return { type: 'selection:changed', file, addresses: [...addresses] }
}
