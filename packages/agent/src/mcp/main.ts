#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { startProjectMcpStdio } from './client.js'

// The viewer owns HTTP /mcp. This executable adapts it for stdio-only clients.
const { values } = parseArgs({ options: { root: { type: 'string' } } })
await startProjectMcpStdio(values.root ?? process.cwd())
