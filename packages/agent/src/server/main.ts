#!/usr/bin/env node
import { serve } from '@hono/node-server'
import 'dotenv/config'

import { loadConfig } from '../config.js'
import { languageModelFor } from '../models.js'
import { createApp } from './app.js'
import { createTurnRunner, type ChatBody, type RevertBody } from './turn.js'

const config = loadConfig(process.env, process.cwd())

const runner = createTurnRunner({
  roots: config.roots,
  maxSteps: config.budgets.maxSteps,
  maxFilesPerTurn: config.budgets.maxFilesPerTurn,
  maxTokens: config.budgets.maxTokens,
  contextTokens: config.contextTokens,
  providerOptions: config.providerOptions,
  vision: config.vision,
  model: () => languageModelFor(config.models.orchestrator),
  repairModel: config.models.repair ? () => languageModelFor(config.models.repair!) : undefined,
})

const app = createApp({
  version: '0.0.0',
  chat: (body) => runner.chat(body as ChatBody),
  revert: (body) => runner.revert(body as RevertBody),
})

// Loopback only. Without a hostname Node binds every interface, which puts a
// service that reads and rewrites the designer's files on whatever network
// they are joined to — a café, a conference, a shared office — with no
// authentication in front of it. The viewer it exists for is on this machine.
serve({ fetch: app.fetch, hostname: '127.0.0.1', port: config.port }, (info) => {
  console.log(`uidx agent listening on http://127.0.0.1:${info.port} (this machine only)`)
  console.log(`model: ${config.models.orchestrator.provider}:${config.models.orchestrator.model}`)
  console.log(`roots: ${config.roots.join(', ')}`)
})
