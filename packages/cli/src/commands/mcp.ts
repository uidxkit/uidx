import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { startProjectMcpStdio } from '@uidx/agent/mcp/client'
import type { Io } from '../cli.js'

/** stdout belongs exclusively to the MCP transport. */
export async function runMcp(argv: string[], io: Io): Promise<number> {
  try {
    const { values } = parseArgs({ args: argv, options: { root: { type: 'string' } } })
    await startProjectMcpStdio(resolve(io.cwd ?? process.cwd(), values.root ?? '.'))
    return 0
  } catch (error) {
    io.err(`${(error as Error).message}\n`)
    return 1
  }
}
