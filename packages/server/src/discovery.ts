import { rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * How something outside the browser finds a running viewer server.
 *
 * The server's port is dynamic (taken ports are skipped), so `uidx open`
 * leaves a card at the door: a small JSON file next to the document's
 * manifest naming where it is listening. A CLI or MCP reader (see
 * `viewerSelection` in `@uidx/agent`) reads the file and talks to the URL;
 * a file left behind by a crash is harmless because the reader's fetch
 * fails and reports "no viewer", the same as no file at all.
 *
 * The name is a wire contract shared with `@uidx/agent`, which reads it
 * without depending on this package.
 */
export const DISCOVERY_NAME = '.uidx-server.json'

export interface DiscoveryInfo {
  port: number
  url: string
  pid: number
  root?: string
  mcpUrl?: string
}

export async function writeDiscovery(dir: string, info: DiscoveryInfo): Promise<void> {
  await writeFile(join(dir, DISCOVERY_NAME), `${JSON.stringify(info, null, 2)}\n`)
}

export async function removeDiscovery(dir: string): Promise<void> {
  await rm(join(dir, DISCOVERY_NAME), { force: true })
}
