# UIDX Agent Harness — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a separate, optional agent service that indexes a uidx document, answers chat requests from a floating panel in the viewer, and fulfills them by writing `.uidx` files — with validated writes and per-turn revert.

**Architecture:** A new `packages/agent` workspace package runs its own HTTP service (Hono). It discovers the open document by manifest id, parses and indexes every `.uidx` file with `@uidx/format`, and exposes a Vercel AI SDK `ToolLoopAgent` over `POST /chat`. Tools express *intent* (semantic edit ops); the harness compiles them to `UidxPatch`es, validates, and writes atomically. The viewer gains a toolbar icon and a floating chat panel; the uidx server is untouched, and the canvas updates through its existing file watching.

**Tech Stack:** TypeScript 5.7 (ESM), Vercel AI SDK `ai@7`, `@ai-sdk/vue@4`, `@ai-sdk/openai-compatible@3`, `@ai-sdk/anthropic@4`, `ai-sdk-ollama@4`, `zod@4`, `hono@4` + `@hono/node-server@2`, `chokidar@4`, `picomatch@4`, Vue 3.5, Vitest 2.1.8.

**Spec:** `docs/superpowers/specs/2026-08-29-uidx-agent-harness-design.md`

## Global Constraints

- **Node version:** tests fail with `ERR_REQUIRE_ESM` on a default Node 18. Every test/build command in this plan must be run with Node 22.15.0 on PATH: prefix with `export PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH";` (repo `.nvmrc` = 22.15.0, `engines.node >= 20.19`).
- **Package manager:** pnpm 9.12.2. Install into a workspace package with `pnpm --filter @uidx/agent add <pkg>`.
- **Modules:** every package is `"type": "module"`. Relative imports inside `src/` MUST carry the `.js` extension (e.g. `import { buildIndex } from './index/build.js'`), matching `packages/format/src/index.ts`.
- **Workspace export condition:** new packages need `"exports": { ".": { "development": "./src/index.ts", "types": "./dist/index.d.ts", "default": "./dist/index.js" } }` so Vite consumes TS source in dev.
- **Tests:** Vitest 2.1.8, test files in `<package>/test/*.test.ts` in kebab-case, importing from `../src/…`. Test names are sentences. `packages/agent/vitest.config.ts` MUST set `fileParallelism: false` (file watching + temp dirs starve under concurrency, same reason as `packages/server`).
- **Viewer styling:** no raw colours in any viewer component — only CSS custom properties from `packages/viewer/src/theme.css`. Icons are inline SVG with `viewBox="0 0 12 12"`, `aria-hidden="true"` on the `<svg>`, `aria-label` on the button.
- **Viewer z-index ladder:** CanvasPane 1–2, ColorPickerDialog 10, AssignPopup/PropertyDialog 20, dialogs 40. The chat panel uses **30**.
- **No changes to `packages/server`.** The service discovers documents itself.
- **Formatting:** run `pnpm format` and `pnpm lint` before each commit; CI enforces both.

## Deviations from the spec (deliberate, approved by this plan)

**1. `insert_node` takes a structured node, not JSX source.** The spec's tool table describes it as JSX. This plan implements it as `{ element, name?, attrs?, children? }`. Rationale: `@uidx/format`'s `parse()` only accepts a whole document (frontmatter + `## Visual Contract`), so accepting JSX would require synthesising and re-parsing a wrapper document, and free-text markup is exactly the failure mode small models are worst at. A structured object is schema-validated, compiles straight to `UidxNodeSpec`, and cannot produce a syntax error.

**2. Validation is parse-level, not full `uidx check`.** The spec says a write must "not introduce new `uidx check` errors". Phase 1 enforces the parse-and-patch half of that: `applyPatches` re-parses between every op and rejects any batch that would leave the document unparseable, which is what keeps a broken file off disk. It does not run the workspace symbol table (`buildSymbolTable`, UIDX400–412 — duplicate ids, unknown component references across pages), because that lives in `@uidx/server` and would couple the agent package to it. Cross-page diagnostics still surface to the user through the viewer's normal diagnostics path. Wiring the symbol table into the refusal check is a good Phase 2 addition once the package boundaries have settled.

## File Structure

**New package `packages/agent/`:**

| File | Responsibility |
|---|---|
| `src/config.ts` | Parse `.env`/process env into `AgentConfig`; model spec strings |
| `src/models.ts` | Map a `ModelSpec` to an AI SDK `LanguageModel` |
| `src/workspace/discover.ts` | Find `uidx.json` files under roots; match one to the open document |
| `src/workspace/workspace.ts` | Load, parse, watch, and serve one document's files |
| `src/index/types.ts` | `DocumentIndex` and entry types |
| `src/index/build.ts` | Build the index from parsed pages |
| `src/index/doc-map.ts` | Render the compact, token-budgeted doc map |
| `src/index/pack.ts` | Rank + assemble a mission context pack |
| `src/edit/jail.ts` | Path jail: resolve and authorise a relative path |
| `src/edit/checkpoint.ts` | Per-turn snapshots and revert |
| `src/edit/ops.ts` | Semantic edit op types + zod schemas |
| `src/edit/compile.ts` | Edit ops → `UidxPatch[]` |
| `src/edit/apply.ts` | Checkpoint, patch, validate, atomic write |
| `src/tools/read.ts` | `read` + `search` tools |
| `src/tools/edit.ts` | `edit`, `create_file`, `delete_file` tools |
| `src/tools/index.ts` | Assemble the tool set for a turn |
| `src/agent/prompt.ts` | The system prompt (< 600 tokens) |
| `src/agent/agent.ts` | Build the `ToolLoopAgent` for a turn |
| `src/server/app.ts` | Hono app: `/health`, `/chat`, `/revert` |
| `src/server/main.ts` | `uidx-agent` bin entry |
| `src/index.ts` | Barrel |

**Viewer changes:**

| File | Responsibility |
|---|---|
| `packages/viewer/src/agent-client.ts` | Agent URL resolution, health probe, chat body builder (pure) |
| `packages/viewer/src/ChatPanel.vue` | The floating chat panel |
| `packages/viewer/src/App.vue` | Toolbar toggle button + panel mount (modify) |

---

### Task 1: Package scaffold, config, and a health server

**Files:**
- Create: `packages/agent/package.json`, `packages/agent/tsconfig.json`, `packages/agent/tsconfig.build.json`, `packages/agent/vitest.config.ts`, `packages/agent/src/config.ts`, `packages/agent/src/server/app.ts`, `packages/agent/src/server/main.ts`, `packages/agent/src/index.ts`, `packages/agent/.env.example`
- Test: `packages/agent/test/config.test.ts`, `packages/agent/test/health.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `AgentConfig`, `ModelSpec`, `loadConfig(env, cwd)`, `parseModelSpec(raw, prefix, env)`, `createApp(deps)` returning a Hono app.

- [ ] **Step 1: Create the package manifest**

`packages/agent/package.json`:

```json
{
  "name": "@uidx/agent",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "bin": { "uidx-agent": "./dist/server/main.js" },
  "exports": {
    ".": {
      "development": "./src/index.ts",
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "dev": "node --experimental-strip-types src/server/main.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@ai-sdk/anthropic": "^4.0.45",
    "@ai-sdk/openai-compatible": "^3.0.40",
    "@hono/node-server": "^2.1.1",
    "@uidx/format": "workspace:*",
    "ai": "^7.0.84",
    "ai-sdk-ollama": "^4.2.0",
    "chokidar": "^4.0.3",
    "dotenv": "^17.4.2",
    "hono": "^4.13.5",
    "picomatch": "^4.0.2",
    "tinyglobby": "^0.2.10",
    "zod": "^4.5.2"
  },
  "devDependencies": {
    "@types/node": "^26.2.0",
    "@types/picomatch": "^4.0.0",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  }
}
```

Copy `packages/format/tsconfig.json` and `packages/format/tsconfig.build.json` verbatim into `packages/agent/`.

`packages/agent/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // The agent writes real files and runs real watchers; concurrent files
    // starve each other's chokidar events, exactly as in @uidx/server.
    fileParallelism: false,
    testTimeout: 20_000,
  },
})
```

Run: `export PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH"; pnpm install`

- [ ] **Step 2: Write the failing config test**

`packages/agent/test/config.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { loadConfig, parseModelSpec } from '../src/config.js'

describe('parseModelSpec', () => {
  it('reads a provider:model pair and defaults the base url per provider', () => {
    expect(parseModelSpec('vllm:gemma-3-27b-it', 'UIDX_AGENT', {})).toEqual({
      provider: 'vllm',
      model: 'gemma-3-27b-it',
      baseURL: 'http://localhost:8000/v1',
      apiKey: undefined,
    })
  })

  it('lets an explicit base url win over the default', () => {
    const env = { UIDX_AGENT_BASE_URL: 'http://gpu.local:8100/v1' }
    expect(parseModelSpec('vllm:gemma-3-27b-it', 'UIDX_AGENT', env).baseURL).toBe(
      'http://gpu.local:8100/v1',
    )
  })

  it('carries the anthropic api key from the environment', () => {
    const spec = parseModelSpec('anthropic:claude-sonnet-4-5', 'UIDX_AGENT', {
      ANTHROPIC_API_KEY: 'sk-test',
    })
    expect(spec).toMatchObject({ provider: 'anthropic', apiKey: 'sk-test' })
  })

  it('rejects a spec without a provider prefix', () => {
    expect(() => parseModelSpec('gemma-3-27b-it', 'UIDX_AGENT', {})).toThrow(/provider:model/)
  })
})

describe('loadConfig', () => {
  it('defaults the port, the roots and the budgets', () => {
    const config = loadConfig({ UIDX_AGENT_MODEL: 'vllm:gemma-3-27b-it' }, '/work')
    expect(config.port).toBe(4500)
    expect(config.roots).toEqual(['/work'])
    expect(config.budgets).toEqual({ maxSteps: 24, maxFilesPerTurn: 12, maxTokens: 200_000 })
  })

  it('has no repair model unless one is configured', () => {
    expect(loadConfig({ UIDX_AGENT_MODEL: 'vllm:g' }, '/work').models.repair).toBeUndefined()
  })

  it('reads a separate repair model with its own base url', () => {
    const config = loadConfig(
      {
        UIDX_AGENT_MODEL: 'vllm:g',
        UIDX_AGENT_REPAIR_MODEL: 'ollama:qwen2.5-coder',
        UIDX_AGENT_REPAIR_BASE_URL: 'http://localhost:11434/api',
      },
      '/work',
    )
    expect(config.models.repair).toMatchObject({ provider: 'ollama', model: 'qwen2.5-coder' })
  })

  it('refuses to start without a model', () => {
    expect(() => loadConfig({}, '/work')).toThrow(/UIDX_AGENT_MODEL/)
  })
})
```

- [ ] **Step 3: Run it to make sure it fails**

Run: `export PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH"; pnpm --filter @uidx/agent test`
Expected: FAIL — cannot resolve `../src/config.js`.

- [ ] **Step 4: Write the config module**

`packages/agent/src/config.ts`:

```ts
/**
 * Configuration comes from the environment, so a single `.env` switches the
 * harness between a local model and a hosted one without touching code.
 */
export type ProviderName = 'vllm' | 'lmstudio' | 'openai-compatible' | 'ollama' | 'anthropic'

export interface ModelSpec {
  provider: ProviderName
  model: string
  baseURL: string | undefined
  apiKey: string | undefined
}

export interface AgentConfig {
  port: number
  /** Directories searched for `uidx.json`. */
  roots: string[]
  models: { orchestrator: ModelSpec; repair?: ModelSpec }
  budgets: { maxSteps: number; maxFilesPerTurn: number; maxTokens: number }
}

const DEFAULT_BASE_URL: Record<ProviderName, string | undefined> = {
  vllm: 'http://localhost:8000/v1',
  lmstudio: 'http://localhost:1234/v1',
  'openai-compatible': undefined,
  ollama: 'http://localhost:11434/api',
  anthropic: undefined,
}

const PROVIDERS = Object.keys(DEFAULT_BASE_URL) as ProviderName[]

type Env = Record<string, string | undefined>

export function parseModelSpec(raw: string, prefix: string, env: Env): ModelSpec {
  const at = raw.indexOf(':')
  if (at <= 0) {
    throw new Error(`${raw}: a model must be written as provider:model, e.g. vllm:gemma-3-27b-it`)
  }
  const provider = raw.slice(0, at) as ProviderName
  if (!PROVIDERS.includes(provider)) {
    throw new Error(`${provider}: unknown provider, expected one of ${PROVIDERS.join(', ')}`)
  }
  const model = raw.slice(at + 1)
  if (model === '') throw new Error(`${raw}: a model must be written as provider:model`)

  return {
    provider,
    model,
    baseURL: env[`${prefix}_BASE_URL`] ?? DEFAULT_BASE_URL[provider],
    apiKey:
      env[`${prefix}_API_KEY`] ?? (provider === 'anthropic' ? env.ANTHROPIC_API_KEY : undefined),
  }
}

export function loadConfig(env: Env, cwd: string): AgentConfig {
  const orchestratorRaw = env.UIDX_AGENT_MODEL
  if (!orchestratorRaw) {
    throw new Error('UIDX_AGENT_MODEL is not set — e.g. UIDX_AGENT_MODEL=vllm:gemma-3-27b-it')
  }

  const repairRaw = env.UIDX_AGENT_REPAIR_MODEL
  const roots = env.UIDX_AGENT_ROOTS?.split(',').map((s) => s.trim()).filter(Boolean)

  return {
    port: Number(env.UIDX_AGENT_PORT ?? new URL(env.UIDX_AGENT_URL ?? 'http://localhost:4500').port),
    roots: roots?.length ? roots : [cwd],
    models: {
      orchestrator: parseModelSpec(orchestratorRaw, 'UIDX_AGENT', env),
      repair: repairRaw ? parseModelSpec(repairRaw, 'UIDX_AGENT_REPAIR', env) : undefined,
    },
    budgets: {
      maxSteps: Number(env.UIDX_AGENT_MAX_STEPS ?? 24),
      maxFilesPerTurn: Number(env.UIDX_AGENT_MAX_FILES ?? 12),
      maxTokens: Number(env.UIDX_AGENT_MAX_TOKENS ?? 200_000),
    },
  }
}
```

- [ ] **Step 5: Run the config test to verify it passes**

Run: `export PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH"; pnpm --filter @uidx/agent test config`
Expected: PASS (9 assertions across 8 tests).

- [ ] **Step 6: Write the failing health test**

`packages/agent/test/health.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { createApp } from '../src/server/app.js'

const app = () => createApp({ version: '0.0.0', chat: async () => new Response('unused') })

describe('GET /health', () => {
  it('answers with the harness version so the panel can show it is live', async () => {
    const response = await app().request('/health')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, version: '0.0.0' })
  })

  it('allows the viewer origin to read the response', async () => {
    const response = await app().request('/health', {
      headers: { Origin: 'http://localhost:4400' },
    })
    expect(response.headers.get('access-control-allow-origin')).toBe('http://localhost:4400')
  })
})
```

- [ ] **Step 7: Run it to verify it fails**

Run: `export PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH"; pnpm --filter @uidx/agent test health`
Expected: FAIL — cannot resolve `../src/server/app.js`.

- [ ] **Step 8: Write the app and the bin entry**

`packages/agent/src/server/app.ts`:

```ts
import { Hono } from 'hono'
import { cors } from 'hono/cors'

export interface AppDeps {
  version: string
  /** Runs one chat turn and returns the AI SDK UI message stream response. */
  chat: (body: unknown) => Promise<Response>
}

export function createApp(deps: AppDeps): Hono {
  const app = new Hono()

  // The viewer is served by the uidx dev server on a different port, so every
  // route has to be reachable cross-origin from localhost.
  app.use('*', cors({ origin: (origin) => origin ?? '*' }))

  app.get('/health', (c) => c.json({ ok: true, version: deps.version }))
  app.post('/chat', async (c) => deps.chat(await c.req.json()))

  return app
}
```

`packages/agent/src/server/main.ts`:

```ts
#!/usr/bin/env node
import { serve } from '@hono/node-server'
import 'dotenv/config'

import { loadConfig } from '../config.js'
import { createApp } from './app.js'

const config = loadConfig(process.env, process.cwd())
const app = createApp({
  version: '0.0.0',
  chat: async () => new Response('not implemented', { status: 501 }),
})

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`uidx agent listening on http://localhost:${info.port}`)
  console.log(`model: ${config.models.orchestrator.provider}:${config.models.orchestrator.model}`)
})
```

`packages/agent/src/index.ts`:

```ts
export { loadConfig, parseModelSpec } from './config.js'
export type { AgentConfig, ModelSpec, ProviderName } from './config.js'
export { createApp } from './server/app.js'
export type { AppDeps } from './server/app.js'
```

`packages/agent/.env.example`:

```sh
# Where the harness listens. The viewer panel reads VITE_UIDX_AGENT_URL.
UIDX_AGENT_URL=http://localhost:4500

# One model for everything. provider:model — vllm | ollama | lmstudio | anthropic
UIDX_AGENT_MODEL=vllm:gemma-3-27b-it
UIDX_AGENT_BASE_URL=http://localhost:8000/v1

# Optional: escalate malformed tool calls to a stronger model.
# UIDX_AGENT_REPAIR_MODEL=anthropic:claude-sonnet-4-5
# ANTHROPIC_API_KEY=sk-...
```

- [ ] **Step 9: Run the whole suite to verify it passes**

Run: `export PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH"; pnpm --filter @uidx/agent test && pnpm --filter @uidx/agent typecheck`
Expected: PASS, no type errors.

- [ ] **Step 10: Commit**

```bash
git add packages/agent pnpm-lock.yaml && git commit -m "The harness gets a package, a config and a pulse"
```

---

### Task 2: Model registry

**Files:**
- Create: `packages/agent/src/models.ts`
- Test: `packages/agent/test/models.test.ts`
- Modify: `packages/agent/src/index.ts`

**Interfaces:**
- Consumes: `ModelSpec` from Task 1.
- Produces: `languageModelFor(spec: ModelSpec): LanguageModel`.

- [ ] **Step 1: Write the failing test**

`packages/agent/test/models.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { languageModelFor } from '../src/models.js'

describe('languageModelFor', () => {
  it('builds an openai-compatible model for a vllm spec', () => {
    const model = languageModelFor({
      provider: 'vllm',
      model: 'gemma-3-27b-it',
      baseURL: 'http://localhost:8000/v1',
      apiKey: undefined,
    })
    expect(model.modelId).toBe('gemma-3-27b-it')
    expect(model.provider).toContain('vllm')
  })

  it('builds an ollama model', () => {
    const model = languageModelFor({
      provider: 'ollama',
      model: 'qwen2.5-coder',
      baseURL: 'http://localhost:11434/api',
      apiKey: undefined,
    })
    expect(model.modelId).toBe('qwen2.5-coder')
  })

  it('builds an anthropic model', () => {
    const model = languageModelFor({
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
      baseURL: undefined,
      apiKey: 'sk-test',
    })
    expect(model.modelId).toBe('claude-sonnet-4-5')
  })

  it('refuses an openai-compatible spec with no base url, since there is nothing to call', () => {
    expect(() =>
      languageModelFor({
        provider: 'openai-compatible',
        model: 'x',
        baseURL: undefined,
        apiKey: undefined,
      }),
    ).toThrow(/base url/i)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `export PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH"; pnpm --filter @uidx/agent test models`
Expected: FAIL — cannot resolve `../src/models.js`.

- [ ] **Step 3: Write the registry**

`packages/agent/src/models.ts`:

```ts
import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModel } from 'ai'
import { createOllama } from 'ai-sdk-ollama'

import type { ModelSpec } from './config.js'

/**
 * Every local runtime we support speaks the OpenAI-compatible protocol, so one
 * branch covers vLLM, LM Studio and llama.cpp. Ollama gets its own provider
 * because its tool-call streaming is more reliable than its OpenAI shim.
 */
export function languageModelFor(spec: ModelSpec): LanguageModel {
  switch (spec.provider) {
    case 'vllm':
    case 'lmstudio':
    case 'openai-compatible': {
      if (!spec.baseURL) {
        throw new Error(`${spec.provider}: a base url is required, e.g. http://localhost:8000/v1`)
      }
      const provider = createOpenAICompatible({
        name: spec.provider,
        baseURL: spec.baseURL,
        apiKey: spec.apiKey ?? 'not-needed',
      })
      return provider(spec.model)
    }
    case 'ollama': {
      const provider = createOllama(spec.baseURL ? { baseURL: spec.baseURL } : {})
      return provider(spec.model)
    }
    case 'anthropic': {
      const provider = createAnthropic(spec.apiKey ? { apiKey: spec.apiKey } : {})
      return provider(spec.model)
    }
  }
}
```

Append to `packages/agent/src/index.ts`:

```ts
export { languageModelFor } from './models.js'
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `export PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH"; pnpm --filter @uidx/agent test models`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/agent && git commit -m "One line of env picks the model, local or hosted"
```

---

### Task 3: Document discovery and workspace

**Files:**
- Create: `packages/agent/src/workspace/discover.ts`, `packages/agent/src/workspace/workspace.ts`
- Test: `packages/agent/test/discover.test.ts`, `packages/agent/test/workspace.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `discoverManifests(roots: string[]): Promise<FoundDoc[]>` where `FoundDoc = { path: string; dir: string; id: string; files: string[] }`
  - `matchDocument(found: FoundDoc[], hint: DocumentHint): FoundDoc` and `DocumentHint = { id?: string; page?: string }`
  - `openWorkspace(found: FoundDoc): Promise<Workspace>` with:
    ```ts
    interface Workspace {
      root: string
      manifestId: string
      members(): readonly string[]
      docOf(file: string): UidxDocument | null
      sourceOf(file: string): string | null
      docs(): ReadonlyMap<string, UidxDocument>
      diagnosticsOf(file: string): readonly Diagnostic[]
      reload(file: string): Promise<void>
      writeFile(file: string, source: string): Promise<void>
      removeFile(file: string): Promise<void>
      close(): Promise<void>
    }
    ```

- [ ] **Step 1: Write the failing discovery test**

`packages/agent/test/discover.test.ts`:

```ts
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { discoverManifests, matchDocument } from '../src/workspace/discover.js'

const PAGE = `---\nid: home\n---\n\n## Visual Contract\n\n<Page>\n  <Frame name="a" width={10} height={10} />\n</Page>\n`

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'uidx-agent-'))
  for (const [dir, id] of [
    ['alpha', 'alpha-doc'],
    ['beta', 'beta-doc'],
  ]) {
    await mkdir(join(root, dir), { recursive: true })
    await writeFile(join(root, dir, 'uidx.json'), JSON.stringify({ id, files: ['**/*.uidx'] }))
    await writeFile(join(root, dir, 'home.uidx'), PAGE)
  }
  return root
}

describe('discoverManifests', () => {
  it('finds every document beneath the roots', async () => {
    const found = await discoverManifests([await fixture()])
    expect(found.map((f) => f.id).sort()).toEqual(['alpha-doc', 'beta-doc'])
  })

  it('lists each document members, workspace-relative', async () => {
    const found = await discoverManifests([await fixture()])
    expect(found[0]?.files).toEqual(['home.uidx'])
  })
})

describe('matchDocument', () => {
  it('picks the document whose manifest id the app reported', async () => {
    const found = await discoverManifests([await fixture()])
    expect(matchDocument(found, { id: 'beta-doc' }).id).toBe('beta-doc')
  })

  it('falls back to the document that contains the open page', async () => {
    const found = await discoverManifests([await fixture()])
    // Two documents both hold "home.uidx", so an ambiguous page is an error…
    expect(() => matchDocument(found, { page: 'home.uidx' })).toThrow(/ambiguous/i)
  })

  it('says so plainly when nothing matches', async () => {
    const found = await discoverManifests([await fixture()])
    expect(() => matchDocument(found, { id: 'nope' })).toThrow(/no uidx document/i)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `export PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH"; pnpm --filter @uidx/agent test discover`
Expected: FAIL — cannot resolve `../src/workspace/discover.js`.

- [ ] **Step 3: Write the discovery module**

`packages/agent/src/workspace/discover.ts`:

```ts
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { glob } from 'tinyglobby'

/** A `uidx.json` on disk, with its member pages resolved. */
export interface FoundDoc {
  /** Absolute path to `uidx.json`. */
  path: string
  /** The workspace root; every member path is relative to this. */
  dir: string
  id: string
  /** Member pages, workspace-relative and sorted. */
  files: string[]
}

/** What the open app told us about the document it is showing. */
export interface DocumentHint {
  id?: string
  page?: string
}

export async function discoverManifests(roots: readonly string[]): Promise<FoundDoc[]> {
  const found: FoundDoc[] = []
  for (const root of roots) {
    const manifests = await glob(['**/uidx.json'], {
      cwd: resolve(root),
      absolute: true,
      ignore: ['**/node_modules/**'],
    })
    for (const path of manifests.sort()) {
      const parsed: unknown = JSON.parse(await readFile(path, 'utf8'))
      if (typeof parsed !== 'object' || parsed === null) continue
      const { id, files } = parsed as { id?: unknown; files?: unknown }
      if (typeof id !== 'string' || !Array.isArray(files)) continue

      const dir = dirname(path)
      const members = await glob(files as string[], {
        cwd: dir,
        absolute: false,
        ignore: ['**/node_modules/**'],
      })
      found.push({ path, dir, id, files: [...new Set(members)].sort() })
    }
  }
  return found
}

/**
 * The viewer knows a document's id but never its path on disk, so the service
 * resolves the two itself rather than asking the uidx server to grow a field.
 */
export function matchDocument(found: readonly FoundDoc[], hint: DocumentHint): FoundDoc {
  const byId = hint.id ? found.filter((f) => f.id === hint.id) : []
  if (byId.length === 1) return byId[0]!
  if (byId.length > 1) {
    throw new Error(`ambiguous document id ${hint.id}: ${byId.map((f) => f.dir).join(', ')}`)
  }

  const byPage = hint.page ? found.filter((f) => f.files.includes(hint.page!)) : []
  if (byPage.length === 1) return byPage[0]!
  if (byPage.length > 1) {
    throw new Error(`ambiguous page ${hint.page}: ${byPage.map((f) => f.dir).join(', ')}`)
  }

  const asked = hint.id ?? hint.page ?? '(nothing)'
  throw new Error(`no uidx document matched ${asked}`)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `export PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH"; pnpm --filter @uidx/agent test discover`
Expected: PASS.

- [ ] **Step 5: Write the failing workspace test**

`packages/agent/test/workspace.test.ts`:

```ts
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { discoverManifests } from '../src/workspace/discover.js'
import { openWorkspace, type Workspace } from '../src/workspace/workspace.js'

const page = (id: string, name: string) =>
  `---\nid: ${id}\n---\n\n## Visual Contract\n\n<Page>\n  <Frame name="${name}" width={10} height={10} />\n</Page>\n`

let open: Workspace | null = null
afterEach(async () => {
  await open?.close()
  open = null
})

async function workspace(): Promise<Workspace> {
  const root = await mkdtemp(join(tmpdir(), 'uidx-agent-ws-'))
  await writeFile(join(root, 'uidx.json'), JSON.stringify({ id: 'doc', files: ['**/*.uidx'] }))
  await writeFile(join(root, 'home.uidx'), page('home', 'hero'))
  const [found] = await discoverManifests([root])
  open = await openWorkspace(found!)
  return open
}

describe('openWorkspace', () => {
  it('parses every member page up front', async () => {
    const ws = await workspace()
    expect(ws.members()).toEqual(['home.uidx'])
    expect(ws.docOf('home.uidx')?.tree.children[0]?.name).toBe('hero')
  })

  it('re-reads a file the user changed on canvas', async () => {
    const ws = await workspace()
    await writeFile(join(ws.root, 'home.uidx'), page('home', 'renamed'))
    await ws.reload('home.uidx')
    expect(ws.docOf('home.uidx')?.tree.children[0]?.name).toBe('renamed')
  })

  it('keeps the diagnostics of a page that stopped parsing, and its last good doc', async () => {
    const ws = await workspace()
    await writeFile(join(ws.root, 'home.uidx'), '---\nid: home\n---\n\nno contract here\n')
    await ws.reload('home.uidx')
    expect(ws.diagnosticsOf('home.uidx').length).toBeGreaterThan(0)
  })

  it('adds a file written through the workspace to its member list', async () => {
    const ws = await workspace()
    await ws.writeFile('about.uidx', page('about', 'body'))
    expect(ws.members()).toContain('about.uidx')
    expect(ws.docOf('about.uidx')).not.toBeNull()
  })

  it('forgets a file it removed', async () => {
    const ws = await workspace()
    await ws.removeFile('home.uidx')
    expect(ws.members()).not.toContain('home.uidx')
    expect(ws.docOf('home.uidx')).toBeNull()
  })
})
```

- [ ] **Step 6: Run it to verify it fails**

Run: `export PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH"; pnpm --filter @uidx/agent test workspace`
Expected: FAIL — cannot resolve `../src/workspace/workspace.js`.

- [ ] **Step 7: Write the workspace module**

`packages/agent/src/workspace/workspace.ts`:

```ts
import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parse, type Diagnostic, type UidxDocument } from '@uidx/format'
import chokidar, { type FSWatcher } from 'chokidar'

import type { FoundDoc } from './discover.js'

export interface Workspace {
  root: string
  manifestId: string
  members(): readonly string[]
  docOf(file: string): UidxDocument | null
  sourceOf(file: string): string | null
  docs(): ReadonlyMap<string, UidxDocument>
  diagnosticsOf(file: string): readonly Diagnostic[]
  /** Re-read one file from disk. */
  reload(file: string): Promise<void>
  /** Write atomically, then adopt the result. */
  writeFile(file: string, source: string): Promise<void>
  removeFile(file: string): Promise<void>
  close(): Promise<void>
}

interface PageState {
  source: string
  doc: UidxDocument | null
  diagnostics: Diagnostic[]
}

/**
 * Writes go to a temp sibling and are renamed into place, so a reader never
 * sees half a file. The temp name deliberately does not end in `.uidx`, or the
 * manifest glob would pick it up mid-write.
 */
async function writeAtomically(path: string, source: string): Promise<void> {
  const temp = `${path}.agent-tmp`
  await writeFile(temp, source, 'utf8')
  await rename(temp, path)
}

export async function openWorkspace(found: FoundDoc): Promise<Workspace> {
  const pages = new Map<string, PageState>()

  const adopt = (file: string, source: string): void => {
    const result = parse(source)
    pages.set(file, { source, doc: result.doc, diagnostics: result.diagnostics })
  }

  const readInto = async (file: string): Promise<void> => {
    adopt(file, await readFile(join(found.dir, file), 'utf8'))
  }

  await Promise.all(found.files.map(readInto))

  // Watching keeps the index honest when the *user* edits on canvas.
  const watcher: FSWatcher = chokidar.watch(found.dir, {
    ignored: (path) => path.includes('node_modules') || path.includes('.uidx-agent'),
    ignoreInitial: true,
  })
  const relative = (path: string): string => path.slice(found.dir.length + 1)
  watcher.on('change', (path) => {
    if (path.endsWith('.uidx')) void readInto(relative(path)).catch(() => undefined)
  })
  watcher.on('unlink', (path) => {
    if (path.endsWith('.uidx')) pages.delete(relative(path))
  })

  return {
    root: found.dir,
    manifestId: found.id,
    members: () => [...pages.keys()].sort(),
    docOf: (file) => pages.get(file)?.doc ?? null,
    sourceOf: (file) => pages.get(file)?.source ?? null,
    docs: () => {
      const live = new Map<string, UidxDocument>()
      for (const [file, state] of pages) if (state.doc) live.set(file, state.doc)
      return live
    },
    diagnosticsOf: (file) => pages.get(file)?.diagnostics ?? [],
    reload: readInto,
    writeFile: async (file, source) => {
      await writeAtomically(join(found.dir, file), source)
      adopt(file, source)
    },
    removeFile: async (file) => {
      await rm(join(found.dir, file), { force: true })
      pages.delete(file)
    },
    close: async () => {
      await watcher.close()
    },
  }
}
```

Note on the third test: `parse()` never throws, and returns `doc: null` with diagnostics when the source has no visual contract, so `diagnosticsOf` is populated while `docOf` becomes null. The test only asserts the diagnostics.

- [ ] **Step 8: Run the test to verify it passes**

Run: `export PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH"; pnpm --filter @uidx/agent test workspace`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/agent && git commit -m "The service finds its own document, and keeps it fresh"
```

---

### Task 4: Build the document index

**Files:**
- Create: `packages/agent/src/index/types.ts`, `packages/agent/src/index/build.ts`
- Test: `packages/agent/test/index-build.test.ts`

**Interfaces:**
- Consumes: `Workspace` (Task 3).
- Produces: `buildIndex(manifestId, docs: ReadonlyMap<string, UidxDocument>): DocumentIndex`, and the types below.

- [ ] **Step 1: Write the types**

`packages/agent/src/index/types.ts`:

```ts
import type { JsonValue } from '@uidx/format'

export interface ComponentEntry {
  name: string
  file: string
  address: string
  status: string | null
  props: { name: string; type: string; default: JsonValue | undefined }[]
  slots: string[]
  variants: string[]
}

export interface InstanceEntry {
  address: string
  file: string
  component: string
}

export interface VariableEntry {
  address: string
  file: string
  collection: string
  name: string
  type: string
}

export interface PageEntry {
  file: string
  id: string
  kind: 'page' | 'tokens'
  /** `##` headings from the intent markdown, in source order. */
  headings: string[]
  /** Direct children of the root, the page's skeleton. */
  topLevel: { name: string; element: string; address: string }[]
  nodeCount: number
}

export interface DocumentIndex {
  manifestId: string
  pages: Map<string, PageEntry>
  components: Map<string, ComponentEntry>
  instances: InstanceEntry[]
  variables: Map<string, VariableEntry>
  /** Every instance of a component, across every page. */
  usesOfComponent(name: string): InstanceEntry[]
  /** Every `prop={"{collection#name}"}` alias pointing at a variable. */
  usesOfVariable(address: string): { address: string; file: string; prop: string }[]
}
```

- [ ] **Step 2: Write the failing test**

`packages/agent/test/index-build.test.ts`:

```ts
import { parse, type UidxDocument } from '@uidx/format'
import { describe, expect, it } from 'vitest'

import { buildIndex } from '../src/index/build.js'

const doc = (source: string): UidxDocument => {
  const result = parse(source)
  if (!result.doc) throw new Error(result.diagnostics.map((d) => d.message).join('; '))
  return result.doc
}

const COMPONENTS = doc(`---
id: components
---

## Core Intent

Shared surfaces.

## Visual Contract

<Page>
  <Component name="Card" status="stable" props={{ heading: { type: 'TEXT', default: 'Title' } }}>
    <Frame name="container" layoutMode="VERTICAL" width={280} height={180}>
      <Text name="title" characters="{heading}" fontSize={16} />
      <Slot name="body" layoutMode="VERTICAL" />
    </Frame>
  </Component>
</Page>
`)

const HOME = doc(`---
id: home
---

## Visual Contract

<Page>
  <Frame name="hero" width={600} height={200} cornerRadius="{radius#md}" />
  <Instance name="revenue" component="Card" x={0} y={0} props={{ heading: 'Revenue' }} />
</Page>
`)

const TOKENS = doc(`---
id: tokens
---

## Visual Contract

<Tokens>
  <Collection name="radius">
    <Variable name="md" type="FLOAT" value={8} />
  </Collection>
</Tokens>
`)

const index = () =>
  buildIndex(
    'doc',
    new Map([
      ['components.uidx', COMPONENTS],
      ['home.uidx', HOME],
      ['tokens.uidx', TOKENS],
    ]),
  )

describe('buildIndex', () => {
  it('records every component with its props and slots', () => {
    const card = index().components.get('Card')
    expect(card).toMatchObject({ file: 'components.uidx', status: 'stable', slots: ['body'] })
    expect(card?.props).toEqual([{ name: 'heading', type: 'TEXT', default: 'Title' }])
  })

  it('records each page skeleton without its bodies', () => {
    const home = index().pages.get('home.uidx')
    expect(home?.kind).toBe('page')
    expect(home?.topLevel.map((n) => n.name)).toEqual(['hero', 'revenue'])
  })

  it('marks a token file as tokens, not a page', () => {
    expect(index().pages.get('tokens.uidx')?.kind).toBe('tokens')
  })

  it('collects the intent headings so the agent can read the designers words', () => {
    expect(index().pages.get('components.uidx')?.headings).toContain('Core Intent')
  })

  it('indexes variables by their addresses', () => {
    expect(index().variables.get('radius#md')).toMatchObject({ type: 'FLOAT', name: 'md' })
  })

  it('answers which pages use a component', () => {
    expect(index().usesOfComponent('Card')).toEqual([
      { address: 'revenue', file: 'home.uidx', component: 'Card' },
    ])
  })

  it('answers which nodes reference a token', () => {
    expect(index().usesOfVariable('radius#md')).toEqual([
      { address: 'hero', file: 'home.uidx', prop: 'cornerRadius' },
    ])
  })
})
```

- [ ] **Step 3: Run it to verify it fails**

Run: `export PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH"; pnpm --filter @uidx/agent test index-build`
Expected: FAIL — cannot resolve `../src/index/build.js`.

- [ ] **Step 4: Write the builder**

`packages/agent/src/index/build.ts`:

```ts
import { aliasTarget, type JsonValue, type UidxDocument, type UidxNode } from '@uidx/format'

import type {
  ComponentEntry,
  DocumentIndex,
  InstanceEntry,
  PageEntry,
  VariableEntry,
} from './types.js'

const HEADING = /^##\s+(.+)$/gm

function walk(node: UidxNode, visit: (node: UidxNode) => void): void {
  visit(node)
  for (const child of node.children) walk(child, visit)
}

function propsOf(node: UidxNode): ComponentEntry['props'] {
  const declared = node.attrs.props?.value
  if (typeof declared !== 'object' || declared === null || Array.isArray(declared)) return []
  return Object.entries(declared).map(([name, declaration]) => {
    const shape = declaration as { type?: JsonValue; default?: JsonValue }
    return {
      name,
      type: typeof shape.type === 'string' ? shape.type : 'TEXT',
      default: shape.default,
    }
  })
}

/**
 * The index is names and shapes only — never bodies. It is what lets a small
 * model see the whole document at once and still have room to think.
 */
export function buildIndex(
  manifestId: string,
  docs: ReadonlyMap<string, UidxDocument>,
): DocumentIndex {
  const pages = new Map<string, PageEntry>()
  const components = new Map<string, ComponentEntry>()
  const variables = new Map<string, VariableEntry>()
  const instances: InstanceEntry[] = []
  const aliasUses: { address: string; file: string; prop: string; target: string }[] = []

  for (const [file, doc] of docs) {
    let nodeCount = 0
    walk(doc.tree, () => {
      nodeCount += 1
    })

    pages.set(file, {
      file,
      id: typeof doc.frontmatter.id === 'string' ? doc.frontmatter.id : file,
      kind: doc.tree.element === 'Tokens' ? 'tokens' : 'page',
      headings: [...doc.intent.raw.matchAll(HEADING)].map((m) => m[1]!.trim()),
      topLevel: doc.tree.children.map((child) => ({
        name: child.name,
        element: child.element,
        address: child.address,
      })),
      nodeCount,
    })

    walk(doc.tree, (node) => {
      for (const [prop, attr] of Object.entries(node.attrs)) {
        const target = aliasTarget(attr.value)
        if (target) aliasUses.push({ address: node.address, file, prop, target })
      }

      if (node.element === 'Component') {
        const slots: string[] = []
        const variants: string[] = []
        walk(node, (inner) => {
          if (inner === node) return
          if (inner.element === 'Slot') slots.push(inner.name)
          if (inner.element === 'Variant') variants.push(inner.name)
        })
        components.set(node.name, {
          name: node.name,
          file,
          address: node.address,
          status: typeof node.attrs.status?.value === 'string' ? node.attrs.status.value : null,
          props: propsOf(node),
          slots,
          variants,
        })
      }

      if (node.element === 'Instance') {
        const component = node.attrs.component?.value
        if (typeof component === 'string') {
          instances.push({ address: node.address, file, component })
        }
      }

      if (node.element === 'Variable') {
        variables.set(node.address, {
          address: node.address,
          file,
          collection: node.address.split('#')[0] ?? '',
          name: node.name,
          type: typeof node.attrs.type?.value === 'string' ? node.attrs.type.value : 'STRING',
        })
      }
    })
  }

  return {
    manifestId,
    pages,
    components,
    instances,
    variables,
    usesOfComponent: (name) => instances.filter((i) => i.component === name),
    usesOfVariable: (address) =>
      aliasUses
        .filter((use) => use.target === address)
        .map(({ address: at, file, prop }) => ({ address: at, file, prop })),
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `export PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH"; pnpm --filter @uidx/agent test index-build`
Expected: PASS (7 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/agent && git commit -m "Names and shapes, never bodies: the document index"
```

---

### Task 5: The doc map

**Files:**
- Create: `packages/agent/src/index/doc-map.ts`
- Test: `packages/agent/test/doc-map.test.ts`

**Interfaces:**
- Consumes: `DocumentIndex` (Task 4).
- Produces: `renderDocMap(index: DocumentIndex, options?: { maxChars?: number }): string`.

- [ ] **Step 1: Write the failing test**

`packages/agent/test/doc-map.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { buildIndex } from '../src/index/build.js'
import { renderDocMap } from '../src/index/doc-map.js'
import { docsFixture } from './fixtures/docs.js'

const index = () => buildIndex('doc', docsFixture())

describe('renderDocMap', () => {
  it('lists every component with the props a caller must pass', () => {
    expect(renderDocMap(index())).toContain('Card(heading: TEXT) slots: body [stable]')
  })

  it('says how many times each component is used, so reuse is the obvious path', () => {
    expect(renderDocMap(index())).toMatch(/Card.*used 1×/)
  })

  it('lists pages with their top-level nodes', () => {
    const map = renderDocMap(index())
    expect(map).toContain('home.uidx')
    expect(map).toContain('hero')
  })

  it('lists token variables by address', () => {
    expect(renderDocMap(index())).toContain('radius#md: FLOAT')
  })

  it('never includes node bodies or attribute values', () => {
    expect(renderDocMap(index())).not.toContain('600')
  })

  it('stays within the character budget, and says what it dropped', () => {
    const map = renderDocMap(index(), { maxChars: 200 })
    expect(map.length).toBeLessThanOrEqual(260)
    expect(map).toMatch(/omitted/)
  })
})
```

Create the shared fixture `packages/agent/test/fixtures/docs.ts` (used by this task and Task 6):

```ts
import { parse, type UidxDocument } from '@uidx/format'

const doc = (source: string): UidxDocument => {
  const result = parse(source)
  if (!result.doc) throw new Error(result.diagnostics.map((d) => d.message).join('; '))
  return result.doc
}

export function docsFixture(): Map<string, UidxDocument> {
  return new Map([
    [
      'components.uidx',
      doc(`---
id: components
---

## Core Intent

Shared surfaces.

## Visual Contract

<Page>
  <Component name="Card" status="stable" props={{ heading: { type: 'TEXT', default: 'Title' } }}>
    <Frame name="container" layoutMode="VERTICAL" width={280} height={180}>
      <Text name="title" characters="{heading}" fontSize={16} />
      <Slot name="body" layoutMode="VERTICAL" />
    </Frame>
  </Component>
</Page>
`),
    ],
    [
      'home.uidx',
      doc(`---
id: home
---

## Visual Contract

<Page>
  <Frame name="hero" width={600} height={200} cornerRadius="{radius#md}">
    <Text name="headline" characters="Welcome" fontSize={32} />
  </Frame>
  <Instance name="revenue" component="Card" x={0} y={0} props={{ heading: 'Revenue' }} />
</Page>
`),
    ],
    [
      'tokens.uidx',
      doc(`---
id: tokens
---

## Visual Contract

<Tokens>
  <Collection name="radius">
    <Variable name="md" type="FLOAT" value={8} />
  </Collection>
</Tokens>
`),
    ],
  ])
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `export PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH"; pnpm --filter @uidx/agent test doc-map`
Expected: FAIL — cannot resolve `../src/index/doc-map.js`.

- [ ] **Step 3: Write the renderer**

`packages/agent/src/index/doc-map.ts`:

```ts
import type { DocumentIndex } from './types.js'

export interface DocMapOptions {
  /** Hard ceiling. Sections are dropped from the end, never truncated mid-line. */
  maxChars?: number
}

const DEFAULT_MAX_CHARS = 6000

function componentLine(index: DocumentIndex, name: string): string {
  const entry = index.components.get(name)!
  const props = entry.props.map((p) => `${p.name}: ${p.type}`).join(', ')
  const slots = entry.slots.length ? ` slots: ${entry.slots.join(', ')}` : ''
  const variants = entry.variants.length ? ` variants: ${entry.variants.length}` : ''
  const status = entry.status ? ` [${entry.status}]` : ''
  const uses = index.usesOfComponent(name).length
  return `  ${name}(${props})${slots}${variants}${status} — used ${uses}×, in ${entry.file}`
}

/**
 * The orientation a small model needs and cannot reliably search for: what
 * exists, what it is called, and what is already reused. Bodies stay on disk.
 */
export function renderDocMap(index: DocumentIndex, options: DocMapOptions = {}): string {
  const max = options.maxChars ?? DEFAULT_MAX_CHARS
  const sections: string[] = []

  if (index.components.size > 0) {
    const names = [...index.components.keys()].sort()
    sections.push(['COMPONENTS', ...names.map((name) => componentLine(index, name))].join('\n'))
  }

  const pages = [...index.pages.values()].filter((p) => p.kind === 'page')
  if (pages.length > 0) {
    sections.push(
      [
        'PAGES',
        ...pages.map((page) => {
          const nodes = page.topLevel.map((n) => `${n.name}<${n.element}>`).join(', ')
          return `  ${page.file} (${page.nodeCount} nodes): ${nodes || '(empty)'}`
        }),
      ].join('\n'),
    )
  }

  if (index.variables.size > 0) {
    const lines = [...index.variables.values()]
      .sort((a, b) => a.address.localeCompare(b.address))
      .map((v) => `  ${v.address}: ${v.type}`)
    sections.push(['TOKENS', ...lines].join('\n'))
  }

  const kept: string[] = []
  let used = 0
  let dropped = 0
  for (const section of sections) {
    if (used + section.length + 1 > max) {
      dropped += 1
      continue
    }
    kept.push(section)
    used += section.length + 1
  }
  if (dropped > 0) kept.push(`(${dropped} section(s) omitted to fit the context budget)`)

  return kept.join('\n\n')
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `export PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH"; pnpm --filter @uidx/agent test doc-map`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/agent && git commit -m "A map the model can hold in one hand"
```

---

### Task 6: Mission context packs

**Files:**
- Create: `packages/agent/src/index/pack.ts`
- Test: `packages/agent/test/pack.test.ts`

**Interfaces:**
- Consumes: `DocumentIndex` (Task 4), `renderDocMap` (Task 5).
- Produces:
  ```ts
  interface MissionFocus { file: string | null; selection: readonly string[] }
  interface ContextPack { text: string; files: string[] }
  function packContext(
    index: DocumentIndex,
    docs: ReadonlyMap<string, UidxDocument>,
    focus: MissionFocus,
    options?: { maxChars?: number },
  ): ContextPack
  ```

- [ ] **Step 1: Write the failing test**

`packages/agent/test/pack.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { buildIndex } from '../src/index/build.js'
import { packContext } from '../src/index/pack.js'
import { docsFixture } from './fixtures/docs.js'

const docs = docsFixture()
const index = buildIndex('doc', docs)

describe('packContext', () => {
  it('always opens with the doc map', () => {
    const pack = packContext(index, docs, { file: null, selection: [] })
    expect(pack.text).toContain('COMPONENTS')
  })

  it('puts the selected node source in front of everything else', () => {
    const pack = packContext(index, docs, { file: 'home.uidx', selection: ['hero'] })
    const selected = pack.text.indexOf('SELECTED')
    const map = pack.text.indexOf('COMPONENTS')
    expect(selected).toBeGreaterThan(-1)
    expect(selected).toBeLessThan(map)
    expect(pack.text).toContain('name="hero"')
  })

  it('includes the source of the ancestors of the selection, not just the node', () => {
    const pack = packContext(index, docs, { file: 'home.uidx', selection: ['hero/headline'] })
    expect(pack.text).toContain('name="headline"')
    expect(pack.text).toContain('CURRENT PAGE')
  })

  it('names the definition of a component the selection instantiates', () => {
    const pack = packContext(index, docs, { file: 'home.uidx', selection: ['revenue'] })
    expect(pack.text).toContain('components.uidx')
    expect(pack.files).toContain('components.uidx')
  })

  it('reports which files it drew on, so the caller can checkpoint them', () => {
    const pack = packContext(index, docs, { file: 'home.uidx', selection: [] })
    expect(pack.files).toEqual(['home.uidx'])
  })

  it('says there is no selection rather than pretending there is one', () => {
    const pack = packContext(index, docs, { file: 'home.uidx', selection: [] })
    expect(pack.text).toContain('nothing selected')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `export PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH"; pnpm --filter @uidx/agent test pack`
Expected: FAIL — cannot resolve `../src/index/pack.js`.

- [ ] **Step 3: Write the packer**

`packages/agent/src/index/pack.ts`:

```ts
import { resolve, type UidxDocument, type UidxNode } from '@uidx/format'

import { renderDocMap } from './doc-map.js'
import type { DocumentIndex } from './types.js'

export interface MissionFocus {
  /** Workspace-relative path of the page the user is looking at. */
  file: string | null
  /** Addresses of the selected nodes. */
  selection: readonly string[]
}

export interface ContextPack {
  text: string
  /** Files whose source this pack quoted. */
  files: string[]
}

const DEFAULT_MAX_CHARS = 12_000

function sourceOf(doc: UidxDocument, node: UidxNode): string {
  return doc.source.slice(node.loc.start, node.loc.end)
}

/**
 * Ranking is deterministic graph proximity, not similarity: the selection, then
 * the page it lives on, then the definitions it depends on. Everything else the
 * model can fetch with `read` when it decides it needs to.
 */
export function packContext(
  index: DocumentIndex,
  docs: ReadonlyMap<string, UidxDocument>,
  focus: MissionFocus,
  options: { maxChars?: number } = {},
): ContextPack {
  const max = options.maxChars ?? DEFAULT_MAX_CHARS
  const blocks: string[] = []
  const files = new Set<string>()

  const doc = focus.file ? (docs.get(focus.file) ?? null) : null

  if (doc && focus.selection.length > 0) {
    const quoted: string[] = []
    for (const address of focus.selection) {
      const node = resolve(doc.tree, address)
      if (!node) continue
      quoted.push(`${address} <${node.element}>\n${sourceOf(doc, node)}`)

      // A component definition the selection points at is the next thing the
      // model will need, and it usually lives on another page.
      const component = node.attrs.component?.value
      if (typeof component === 'string') {
        const entry = index.components.get(component)
        const definition = entry ? docs.get(entry.file) : undefined
        if (entry && definition) {
          const defNode = resolve(definition.tree, entry.address)
          if (defNode) {
            quoted.push(
              `definition of ${component} (${entry.file})\n${sourceOf(definition, defNode)}`,
            )
            files.add(entry.file)
          }
        }
      }
    }
    if (quoted.length > 0) {
      files.add(focus.file!)
      blocks.push(`SELECTED\n${quoted.join('\n\n')}`)
    }
  } else if (focus.file) {
    blocks.push('SELECTED\n  (nothing selected — the user is looking at the whole page)')
  }

  if (doc && focus.file) {
    files.add(focus.file)
    const page = index.pages.get(focus.file)
    const skeleton = page?.topLevel.map((n) => `  ${n.address} <${n.element}>`).join('\n') ?? ''
    blocks.push(`CURRENT PAGE ${focus.file}\n${skeleton || '  (empty)'}`)
  }

  blocks.push(renderDocMap(index, { maxChars: Math.floor(max / 2) }))

  let text = blocks.join('\n\n')
  if (text.length > max) text = `${text.slice(0, max)}\n(context truncated)`

  return { text, files: [...files].sort() }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `export PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH"; pnpm --filter @uidx/agent test pack`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/agent && git commit -m "The selection goes first, the map goes last"
```

---

### Task 7: Safety primitives — path jail and checkpoints

**Files:**
- Create: `packages/agent/src/edit/jail.ts`, `packages/agent/src/edit/checkpoint.ts`
- Test: `packages/agent/test/jail.test.ts`, `packages/agent/test/checkpoint.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `class JailError extends Error`, `resolveInside(root, relPath): string`, `assertWritable(root, globs, relPath): void`
  - `createCheckpointStore(root): CheckpointStore` with `capture(turnId, relPath)`, `revert(turnId): Promise<string[]>`, `turns(): Promise<string[]>`

- [ ] **Step 1: Write the failing jail test**

`packages/agent/test/jail.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { assertWritable, JailError, resolveInside } from '../src/edit/jail.js'

describe('resolveInside', () => {
  it('resolves a relative path against the document root', () => {
    expect(resolveInside('/work/doc', 'pages/home.uidx')).toBe('/work/doc/pages/home.uidx')
  })

  it('refuses to climb out of the root', () => {
    expect(() => resolveInside('/work/doc', '../secrets.uidx')).toThrow(JailError)
  })

  it('refuses an absolute path', () => {
    expect(() => resolveInside('/work/doc', '/etc/passwd')).toThrow(JailError)
  })

  it('refuses a path that escapes through a symlink-looking segment', () => {
    expect(() => resolveInside('/work/doc', 'pages/../../out.uidx')).toThrow(JailError)
  })
})

describe('assertWritable', () => {
  const globs = ['**/*.uidx']

  it('accepts a uidx file that the manifest globs cover', () => {
    expect(() => assertWritable('/work/doc', globs, 'pages/home.uidx')).not.toThrow()
  })

  it('refuses anything that is not a uidx file', () => {
    expect(() => assertWritable('/work/doc', globs, 'notes.md')).toThrow(/\.uidx/)
  })

  it('refuses a uidx file outside the manifest globs', () => {
    expect(() => assertWritable('/work/doc', ['design/**/*.uidx'], 'other/home.uidx')).toThrow(
      /manifest/,
    )
  })

  it('refuses to write into the agent own directory', () => {
    expect(() => assertWritable('/work/doc', globs, '.uidx-agent/notes.uidx')).toThrow(JailError)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `export PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH"; pnpm --filter @uidx/agent test jail`
Expected: FAIL — cannot resolve `../src/edit/jail.js`.

- [ ] **Step 3: Write the jail**

`packages/agent/src/edit/jail.ts`:

```ts
import { isAbsolute, resolve as resolvePath, sep } from 'node:path'
import picomatch from 'picomatch'

export class JailError extends Error {}

export const AGENT_DIR = '.uidx-agent'

/** Resolve a workspace-relative path, refusing anything that leaves the root. */
export function resolveInside(root: string, relPath: string): string {
  if (isAbsolute(relPath)) {
    throw new JailError(`${relPath}: paths must be relative to the document root`)
  }
  const absolute = resolvePath(root, relPath)
  if (absolute !== root && !absolute.startsWith(root.endsWith(sep) ? root : root + sep)) {
    throw new JailError(`${relPath}: outside the document root`)
  }
  return absolute
}

/**
 * The toolset is the sandbox: only `.uidx` files the manifest already claims
 * can be written, and never the harness's own bookkeeping.
 */
export function assertWritable(root: string, globs: readonly string[], relPath: string): void {
  resolveInside(root, relPath)

  if (relPath.split('/')[0] === AGENT_DIR) {
    throw new JailError(`${relPath}: ${AGENT_DIR} belongs to the harness, not the document`)
  }
  if (!relPath.endsWith('.uidx')) {
    throw new JailError(`${relPath}: only .uidx files can be written`)
  }
  if (!picomatch(globs as string[])(relPath)) {
    throw new JailError(`${relPath}: not covered by the manifest files globs (${globs.join(', ')})`)
  }
}
```

- [ ] **Step 4: Run the jail test to verify it passes**

Run: `export PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH"; pnpm --filter @uidx/agent test jail`
Expected: PASS (8 tests).

- [ ] **Step 5: Write the failing checkpoint test**

`packages/agent/test/checkpoint.test.ts`:

```ts
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { createCheckpointStore } from '../src/edit/checkpoint.js'

async function root(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'uidx-agent-ck-'))
  await writeFile(join(dir, 'home.uidx'), 'original')
  return dir
}

describe('createCheckpointStore', () => {
  it('restores the content a turn found, not the content it left', async () => {
    const dir = await root()
    const store = createCheckpointStore(dir)

    await store.capture('turn-1', 'home.uidx')
    await writeFile(join(dir, 'home.uidx'), 'agent wrote this')
    await store.revert('turn-1')

    expect(await readFile(join(dir, 'home.uidx'), 'utf8')).toBe('original')
  })

  it('captures a file once per turn, so a second edit cannot overwrite the snapshot', async () => {
    const dir = await root()
    const store = createCheckpointStore(dir)

    await store.capture('turn-1', 'home.uidx')
    await writeFile(join(dir, 'home.uidx'), 'first edit')
    await store.capture('turn-1', 'home.uidx')
    await writeFile(join(dir, 'home.uidx'), 'second edit')
    await store.revert('turn-1')

    expect(await readFile(join(dir, 'home.uidx'), 'utf8')).toBe('original')
  })

  it('reports which files a revert restored', async () => {
    const dir = await root()
    const store = createCheckpointStore(dir)
    await store.capture('turn-1', 'home.uidx')
    expect(await store.revert('turn-1')).toEqual(['home.uidx'])
  })

  it('records a file that did not exist, and deletes it on revert', async () => {
    const dir = await root()
    const store = createCheckpointStore(dir)

    await store.capture('turn-1', 'new.uidx')
    await writeFile(join(dir, 'new.uidx'), 'created by the agent')
    await store.revert('turn-1')

    await expect(readFile(join(dir, 'new.uidx'), 'utf8')).rejects.toThrow()
  })

  it('refuses to revert a turn it never saw', async () => {
    const store = createCheckpointStore(await root())
    await expect(store.revert('nope')).rejects.toThrow(/nope/)
  })
})
```

- [ ] **Step 6: Run it to verify it fails**

Run: `export PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH"; pnpm --filter @uidx/agent test checkpoint`
Expected: FAIL — cannot resolve `../src/edit/checkpoint.js`.

- [ ] **Step 7: Write the checkpoint store**

`packages/agent/src/edit/checkpoint.ts`:

```ts
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { AGENT_DIR, resolveInside } from './jail.js'

export interface CheckpointStore {
  /** Snapshot a file's prior content, once per turn. */
  capture(turnId: string, relPath: string): Promise<void>
  /** Restore every file the turn captured. Returns the files restored. */
  revert(turnId: string): Promise<string[]>
  turns(): Promise<string[]>
}

/** A missing file is a real prior state: reverting means deleting it again. */
const ABSENT = '\u0000absent'

const encode = (relPath: string): string => encodeURIComponent(relPath)
const decode = (name: string): string => decodeURIComponent(name)

export function createCheckpointStore(root: string): CheckpointStore {
  const base = join(root, AGENT_DIR, 'checkpoints')
  const dirOf = (turnId: string): string => join(base, encodeURIComponent(turnId))

  return {
    async capture(turnId, relPath) {
      const dir = dirOf(turnId)
      await mkdir(dir, { recursive: true })
      const snapshot = join(dir, encode(relPath))

      // First writer wins: the snapshot must hold what the turn *found*.
      try {
        await readFile(snapshot, 'utf8')
        return
      } catch {
        // no snapshot yet
      }

      let prior: string
      try {
        prior = await readFile(resolveInside(root, relPath), 'utf8')
      } catch {
        prior = ABSENT
      }
      await writeFile(snapshot, prior, 'utf8')
    },

    async revert(turnId) {
      const dir = dirOf(turnId)
      let names: string[]
      try {
        names = await readdir(dir)
      } catch {
        throw new Error(`no checkpoint for turn ${turnId}`)
      }

      const restored: string[] = []
      for (const name of names.sort()) {
        const relPath = decode(name)
        const prior = await readFile(join(dir, name), 'utf8')
        const target = resolveInside(root, relPath)
        if (prior === ABSENT) await rm(target, { force: true })
        else await writeFile(target, prior, 'utf8')
        restored.push(relPath)
      }
      return restored
    },

    async turns() {
      try {
        return (await readdir(base)).map(decodeURIComponent).sort()
      } catch {
        return []
      }
    },
  }
}
```

- [ ] **Step 8: Run the checkpoint test to verify it passes**

Run: `export PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH"; pnpm --filter @uidx/agent test checkpoint`
Expected: PASS (5 tests).

- [ ] **Step 9: Commit**

```bash
git add packages/agent && git commit -m "A locked door and a way back"
```

---

### Task 8: Edit ops and the patch compiler

**Files:**
- Create: `packages/agent/src/edit/ops.ts`, `packages/agent/src/edit/compile.ts`
- Test: `packages/agent/test/compile.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  ```ts
  type EditOp =
    | { kind: 'set_prop'; address: string; prop: string; value: JsonValue }
    | { kind: 'remove_prop'; address: string; prop: string }
    | { kind: 'insert_node'; parent: string; index?: number; node: NodeInput }
    | { kind: 'remove_node'; address: string }
    | { kind: 'move_node'; address: string; newParent: string; index: number }
    | { kind: 'rename'; address: string; name: string }
  interface NodeInput { element: string; name?: string; attrs?: Record<string, JsonValue>; children?: NodeInput[] }
  const editOpsSchema: z.ZodType<EditOp[]>
  function compileOps(doc: UidxDocument, ops: readonly EditOp[]): UidxPatch[]
  ```

- [ ] **Step 1: Write the failing test**

`packages/agent/test/compile.test.ts`:

```ts
import { parse, type UidxDocument } from '@uidx/format'
import { describe, expect, it } from 'vitest'

import { compileOps } from '../src/edit/compile.js'
import { editOpsSchema } from '../src/edit/ops.js'

const HOME = `---
id: home
---

## Visual Contract

<Page>
  <Frame name="hero" width={600} height={200}>
    <Text name="headline" characters="Welcome" fontSize={32} />
  </Frame>
</Page>
`

const doc = (): UidxDocument => {
  const result = parse(HOME)
  if (!result.doc) throw new Error('fixture does not parse')
  return result.doc
}

describe('editOpsSchema', () => {
  it('accepts a well-formed batch', () => {
    const parsed = editOpsSchema.safeParse([
      { kind: 'set_prop', address: 'hero', prop: 'width', value: 800 },
    ])
    expect(parsed.success).toBe(true)
  })

  it('rejects an unknown op rather than guessing what was meant', () => {
    expect(editOpsSchema.safeParse([{ kind: 'nudge', address: 'hero' }]).success).toBe(false)
  })

  it('rejects an op that names no address', () => {
    expect(editOpsSchema.safeParse([{ kind: 'remove_node' }]).success).toBe(false)
  })
})

describe('compileOps', () => {
  it('turns set_prop into a set patch when the property is already there', () => {
    expect(compileOps(doc(), [{ kind: 'set_prop', address: 'hero', prop: 'width', value: 800 }])).toEqual(
      [{ op: 'set', address: 'hero', prop: 'width', value: 800 }],
    )
  })

  it('turns set_prop into an add patch when the property is new', () => {
    expect(
      compileOps(doc(), [{ kind: 'set_prop', address: 'hero', prop: 'opacity', value: 0.5 }]),
    ).toEqual([{ op: 'add', address: 'hero', prop: 'opacity', value: 0.5 }])
  })

  it('compiles a rename into a set of the name property', () => {
    expect(compileOps(doc(), [{ kind: 'rename', address: 'hero', name: 'banner' }])).toEqual([
      { op: 'set', address: 'hero', prop: 'name', value: 'banner' },
    ])
  })

  it('names an inserted node automatically when the model did not', () => {
    const patches = compileOps(doc(), [
      { kind: 'insert_node', parent: 'hero', node: { element: 'Rectangle' } },
    ])
    expect(patches[0]).toMatchObject({ op: 'insert-node', parent: 'hero', index: 1 })
    const spec = (patches[0] as { node: { attrs: Record<string, unknown> } }).node
    expect(spec.attrs.name).toBe('rectangle-1')
  })

  it('appends an inserted node when no index is given', () => {
    const patches = compileOps(doc(), [
      { kind: 'insert_node', parent: 'hero', node: { element: 'Text', name: 'sub' } },
    ])
    expect(patches[0]).toMatchObject({ index: 1 })
  })

  it('carries nested children into the node spec', () => {
    const patches = compileOps(doc(), [
      {
        kind: 'insert_node',
        parent: '',
        node: {
          element: 'Frame',
          name: 'footer',
          attrs: { width: 600 },
          children: [{ element: 'Text', name: 'legal', attrs: { characters: '©' } }],
        },
      },
    ])
    expect(patches[0]).toMatchObject({
      op: 'insert-node',
      parent: '',
      node: {
        element: 'Frame',
        attrs: { name: 'footer', width: 600 },
        children: [{ element: 'Text', attrs: { name: 'legal', characters: '©' } }],
      },
    })
  })

  it('refuses an op whose address is not in the document', () => {
    expect(() =>
      compileOps(doc(), [{ kind: 'set_prop', address: 'ghost', prop: 'width', value: 1 }]),
    ).toThrow(/ghost/)
  })

  it('refuses an element the format does not know', () => {
    expect(() =>
      compileOps(doc(), [{ kind: 'insert_node', parent: 'hero', node: { element: 'Widget' } }]),
    ).toThrow(/Widget/)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `export PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH"; pnpm --filter @uidx/agent test compile`
Expected: FAIL — cannot resolve `../src/edit/ops.js`.

- [ ] **Step 3: Write the op schemas**

`packages/agent/src/edit/ops.ts`:

```ts
import { z } from 'zod'

/**
 * Small models are unreliable at free-text markup, so the edit surface is a
 * closed set of intents with flat arguments. The harness does the surgery.
 */
const jsonValue: z.ZodType<
  string | number | boolean | null | unknown[] | Record<string, unknown>
> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(jsonValue), z.record(z.string(), jsonValue)]),
)

const nodeInput: z.ZodType<NodeInput> = z.lazy(() =>
  z.object({
    element: z.string().describe('Frame, Text, Rectangle, Ellipse, Vector, Instance or Slot'),
    name: z.string().optional().describe('omit to have one generated'),
    attrs: z.record(z.string(), jsonValue).optional(),
    children: z.array(nodeInput).optional(),
  }),
)

export interface NodeInput {
  element: string
  name?: string
  attrs?: Record<string, unknown>
  children?: NodeInput[]
}

export const editOpSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('set_prop'),
    address: z.string().describe('node address, e.g. hero/headline'),
    prop: z.string(),
    value: jsonValue,
  }),
  z.object({ kind: z.literal('remove_prop'), address: z.string(), prop: z.string() }),
  z.object({
    kind: z.literal('insert_node'),
    parent: z.string().describe('address of the parent; "" is the page root'),
    index: z.number().int().min(0).optional().describe('omit to append'),
    node: nodeInput,
  }),
  z.object({ kind: z.literal('remove_node'), address: z.string() }),
  z.object({
    kind: z.literal('move_node'),
    address: z.string(),
    newParent: z.string(),
    index: z.number().int().min(0),
  }),
  z.object({ kind: z.literal('rename'), address: z.string(), name: z.string() }),
])

export const editOpsSchema = z.array(editOpSchema).min(1)

export type EditOp = z.infer<typeof editOpSchema>
```

- [ ] **Step 4: Write the compiler**

`packages/agent/src/edit/compile.ts`:

```ts
import {
  autoName,
  ELEMENTS,
  resolve,
  type JsonValue,
  type UidxDocument,
  type UidxElement,
  type UidxNodeSpec,
  type UidxPatch,
} from '@uidx/format'

import type { EditOp, NodeInput } from './ops.js'

export class CompileError extends Error {}

function nodeAt(doc: UidxDocument, address: string): ReturnType<typeof resolve> {
  const node = resolve(doc.tree, address)
  if (!node) throw new CompileError(`no node at address ${JSON.stringify(address)}`)
  return node
}

function toSpec(input: NodeInput, siblings: readonly { name: string }[]): UidxNodeSpec {
  if (!(ELEMENTS as readonly string[]).includes(input.element)) {
    throw new CompileError(`${input.element}: not a uidx element (${ELEMENTS.join(', ')})`)
  }
  const element = input.element as UidxElement
  const name = input.name ?? autoName(element, siblings)
  const children = input.children?.map((child, i) =>
    toSpec(child, (input.children ?? []).slice(0, i).map((c, j) => ({ name: c.name ?? `${j}` }))),
  )

  return {
    element,
    attrs: { name, ...(input.attrs as Record<string, JsonValue> | undefined) },
    ...(children && children.length > 0 ? { children } : {}),
  }
}

/** Compile intents into the document patches `@uidx/format` knows how to apply. */
export function compileOps(doc: UidxDocument, ops: readonly EditOp[]): UidxPatch[] {
  const patches: UidxPatch[] = []

  for (const op of ops) {
    switch (op.kind) {
      case 'set_prop': {
        const node = nodeAt(doc, op.address)!
        patches.push({
          op: node.attrs[op.prop] === undefined ? 'add' : 'set',
          address: op.address,
          prop: op.prop,
          value: op.value as JsonValue,
        })
        break
      }
      case 'remove_prop': {
        nodeAt(doc, op.address)
        patches.push({ op: 'remove', address: op.address, prop: op.prop })
        break
      }
      case 'rename': {
        nodeAt(doc, op.address)
        patches.push({ op: 'set', address: op.address, prop: 'name', value: op.name })
        break
      }
      case 'insert_node': {
        const parent = nodeAt(doc, op.parent)!
        patches.push({
          op: 'insert-node',
          parent: op.parent,
          index: op.index ?? parent.children.length,
          node: toSpec(op.node, parent.children),
        })
        break
      }
      case 'remove_node': {
        nodeAt(doc, op.address)
        patches.push({ op: 'remove-node', address: op.address })
        break
      }
      case 'move_node': {
        nodeAt(doc, op.address)
        nodeAt(doc, op.newParent)
        patches.push({
          op: 'move-node',
          address: op.address,
          newParent: op.newParent,
          index: op.index,
        })
        break
      }
    }
  }

  return patches
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `export PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH"; pnpm --filter @uidx/agent test compile`
Expected: PASS (11 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/agent && git commit -m "The model states intent; the harness does the surgery"
```

---

### Task 9: The apply pipeline

**Files:**
- Create: `packages/agent/src/edit/apply.ts`
- Test: `packages/agent/test/apply.test.ts`

**Interfaces:**
- Consumes: `Workspace` (Task 3), `CheckpointStore` (Task 7), `compileOps` (Task 8).
- Produces:
  ```ts
  interface ApplyContext {
    workspace: Workspace
    checkpoints: CheckpointStore
    globs: readonly string[]
    turnId: string
  }
  type ApplyOutcome =
    | { ok: true; file: string; changed: number }
    | { ok: false; file: string; error: string }
  function applyOps(ctx: ApplyContext, file: string, ops: readonly EditOp[]): Promise<ApplyOutcome>
  function createFile(ctx: ApplyContext, file: string, pageId: string): Promise<ApplyOutcome>
  function deleteFile(ctx: ApplyContext, file: string): Promise<ApplyOutcome>
  ```

- [ ] **Step 1: Write the failing test**

`packages/agent/test/apply.test.ts`:

```ts
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { createCheckpointStore } from '../src/edit/checkpoint.js'
import { applyOps, createFile, deleteFile, type ApplyContext } from '../src/edit/apply.js'
import { discoverManifests } from '../src/workspace/discover.js'
import { openWorkspace, type Workspace } from '../src/workspace/workspace.js'

const HOME = `---
id: home
---

## Visual Contract

<Page>
  <Frame name="hero" width={600} height={200} />
</Page>
`

let open: Workspace | null = null
afterEach(async () => {
  await open?.close()
  open = null
})

async function context(): Promise<ApplyContext> {
  const root = await mkdtemp(join(tmpdir(), 'uidx-agent-apply-'))
  await writeFile(join(root, 'uidx.json'), JSON.stringify({ id: 'doc', files: ['**/*.uidx'] }))
  await writeFile(join(root, 'home.uidx'), HOME)
  const [found] = await discoverManifests([root])
  open = await openWorkspace(found!)
  return {
    workspace: open,
    checkpoints: createCheckpointStore(root),
    globs: ['**/*.uidx'],
    turnId: 'turn-1',
  }
}

describe('applyOps', () => {
  it('writes the change to disk and reports success', async () => {
    const ctx = await context()
    const result = await applyOps(ctx, 'home.uidx', [
      { kind: 'set_prop', address: 'hero', prop: 'width', value: 800 },
    ])
    expect(result).toMatchObject({ ok: true, file: 'home.uidx' })
    expect(await readFile(join(ctx.workspace.root, 'home.uidx'), 'utf8')).toContain('width={800}')
  })

  it('snapshots the file before writing, so the turn can be reverted', async () => {
    const ctx = await context()
    await applyOps(ctx, 'home.uidx', [
      { kind: 'set_prop', address: 'hero', prop: 'width', value: 800 },
    ])
    await ctx.checkpoints.revert('turn-1')
    expect(await readFile(join(ctx.workspace.root, 'home.uidx'), 'utf8')).toBe(HOME)
  })

  it('refuses an edit against a node that does not exist, and leaves the file alone', async () => {
    const ctx = await context()
    const result = await applyOps(ctx, 'home.uidx', [
      { kind: 'set_prop', address: 'ghost', prop: 'width', value: 1 },
    ])
    expect(result).toMatchObject({ ok: false })
    expect(await readFile(join(ctx.workspace.root, 'home.uidx'), 'utf8')).toBe(HOME)
  })

  it('returns the diagnostic when a patch would break the document', async () => {
    const ctx = await context()
    const result = await applyOps(ctx, 'home.uidx', [
      { kind: 'set_prop', address: 'hero', prop: 'layoutMode', value: 'SIDEWAYS' },
    ])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/layoutMode|invalid|rejected/i)
  })

  it('refuses to touch a file outside the manifest', async () => {
    const ctx = await context()
    const result = await applyOps({ ...ctx, globs: ['design/**/*.uidx'] }, 'home.uidx', [
      { kind: 'set_prop', address: 'hero', prop: 'width', value: 800 },
    ])
    expect(result).toMatchObject({ ok: false })
  })
})

describe('createFile', () => {
  it('writes a page skeleton that parses', async () => {
    const ctx = await context()
    const result = await createFile(ctx, 'about.uidx', 'about')
    expect(result.ok).toBe(true)
    expect(ctx.workspace.docOf('about.uidx')).not.toBeNull()
  })

  it('refuses to overwrite a page that already exists', async () => {
    const ctx = await context()
    expect(await createFile(ctx, 'home.uidx', 'home')).toMatchObject({ ok: false })
  })
})

describe('deleteFile', () => {
  it('removes the page and can be reverted', async () => {
    const ctx = await context()
    expect(await deleteFile(ctx, 'home.uidx')).toMatchObject({ ok: true })
    expect(ctx.workspace.docOf('home.uidx')).toBeNull()
    await ctx.checkpoints.revert('turn-1')
    expect(await readFile(join(ctx.workspace.root, 'home.uidx'), 'utf8')).toBe(HOME)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `export PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH"; pnpm --filter @uidx/agent test apply`
Expected: FAIL — cannot resolve `../src/edit/apply.js`.

- [ ] **Step 3: Write the apply pipeline**

`packages/agent/src/edit/apply.ts`:

```ts
import { applyPatches } from '@uidx/format'

import type { Workspace } from '../workspace/workspace.js'
import type { CheckpointStore } from './checkpoint.js'
import { compileOps } from './compile.js'
import { assertWritable } from './jail.js'
import type { EditOp } from './ops.js'

export interface ApplyContext {
  workspace: Workspace
  checkpoints: CheckpointStore
  /** The manifest's `files` globs. */
  globs: readonly string[]
  turnId: string
}

export type ApplyOutcome =
  | { ok: true; file: string; changed: number }
  | { ok: false; file: string; error: string }

const PAGE_SKELETON = (id: string): string =>
  `---\nid: ${id}\n---\n\n## Core Intent\n\nDescribe what this page is for.\n\n## Visual Contract\n\n<Page>\n</Page>\n`

const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

/**
 * Nothing reaches disk that does not parse. `applyPatches` re-parses between
 * every op and rejects a batch that would leave the document invalid, so a
 * refusal is returned to the model as a tool result rather than written out.
 */
export async function applyOps(
  ctx: ApplyContext,
  file: string,
  ops: readonly EditOp[],
): Promise<ApplyOutcome> {
  try {
    assertWritable(ctx.workspace.root, ctx.globs, file)

    const doc = ctx.workspace.docOf(file)
    if (!doc) {
      return { ok: false, file, error: `${file}: not a parsed page in this document` }
    }

    const patches = compileOps(doc, ops)
    const result = applyPatches(doc.source, patches, { document: doc })

    if (result.source === doc.source) return { ok: true, file, changed: 0 }

    await ctx.checkpoints.capture(ctx.turnId, file)
    await ctx.workspace.writeFile(file, result.source)
    return { ok: true, file, changed: patches.length }
  } catch (error) {
    return { ok: false, file, error: message(error) }
  }
}

export async function createFile(
  ctx: ApplyContext,
  file: string,
  pageId: string,
): Promise<ApplyOutcome> {
  try {
    assertWritable(ctx.workspace.root, ctx.globs, file)
    if (ctx.workspace.members().includes(file)) {
      return { ok: false, file, error: `${file}: already exists — edit it instead` }
    }
    await ctx.checkpoints.capture(ctx.turnId, file)
    await ctx.workspace.writeFile(file, PAGE_SKELETON(pageId))
    return { ok: true, file, changed: 1 }
  } catch (error) {
    return { ok: false, file, error: message(error) }
  }
}

export async function deleteFile(ctx: ApplyContext, file: string): Promise<ApplyOutcome> {
  try {
    assertWritable(ctx.workspace.root, ctx.globs, file)
    if (!ctx.workspace.members().includes(file)) {
      return { ok: false, file, error: `${file}: no such page` }
    }
    await ctx.checkpoints.capture(ctx.turnId, file)
    await ctx.workspace.removeFile(file)
    return { ok: true, file, changed: 1 }
  } catch (error) {
    return { ok: false, file, error: message(error) }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `export PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH"; pnpm --filter @uidx/agent test apply`
Expected: PASS (8 tests). If the `layoutMode: 'SIDEWAYS'` case passes validation (the parser may accept unknown enum values as a warning rather than an error), replace that op with `{ kind: 'set_prop', address: 'hero', prop: 'name', value: 42 }`, which is a hard parse error, and keep the assertion.

- [ ] **Step 5: Commit**

```bash
git add packages/agent && git commit -m "Broken files never reach the disk"
```

---

### Task 10: The read and search tools

**Files:**
- Create: `packages/agent/src/tools/read.ts`
- Test: `packages/agent/test/tools-read.test.ts`

**Interfaces:**
- Consumes: `Workspace` (Task 3), `DocumentIndex` (Task 4).
- Produces: `readTools(deps: { workspace: Workspace; index: () => DocumentIndex })` returning `{ read: Tool; search: Tool }`.

- [ ] **Step 1: Write the failing test**

`packages/agent/test/tools-read.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { readTools } from '../src/tools/read.js'
import { docsFixture } from './fixtures/docs.js'

const docs = docsFixture()

const tools = () =>
  readTools({
    workspace: {
      docOf: (file: string) => docs.get(file) ?? null,
      sourceOf: (file: string) => docs.get(file)?.source ?? null,
      members: () => [...docs.keys()].sort(),
    },
  })

const run = async (tool: { execute?: unknown }, input: unknown): Promise<string> => {
  const execute = tool.execute as (i: unknown, o: unknown) => Promise<string>
  return execute(input, { toolCallId: 't', messages: [] })
}

describe('read', () => {
  it('returns the exact source of a node', async () => {
    const out = await run(tools().read, { file: 'home.uidx', address: 'hero' })
    expect(out).toContain('name="hero"')
    expect(out).toContain('name="headline"')
  })

  it('returns a whole file when no address is given', async () => {
    const out = await run(tools().read, { file: 'tokens.uidx' })
    expect(out).toContain('<Tokens>')
  })

  it('says what is available when the file is unknown', async () => {
    const out = await run(tools().read, { file: 'nope.uidx' })
    expect(out).toMatch(/no such page/i)
    expect(out).toContain('home.uidx')
  })

  it('says so when the address is not on that page', async () => {
    const out = await run(tools().read, { file: 'home.uidx', address: 'ghost' })
    expect(out).toMatch(/no node/i)
  })
})

describe('search', () => {
  it('finds a literal across every page and reports the enclosing address', async () => {
    const out = await run(tools().search, { query: 'Welcome' })
    expect(out).toContain('home.uidx')
    expect(out).toContain('hero/headline')
  })

  it('supports a regular expression', async () => {
    const out = await run(tools().search, { query: 'fontSize=\\{\\d+\\}', regex: true })
    expect(out).toContain('home.uidx')
  })

  it('says plainly when nothing matched', async () => {
    expect(await run(tools().search, { query: 'zzz-not-here' })).toMatch(/no matches/i)
  })

  it('caps the number of hits so a broad query cannot flood the context', async () => {
    const out = await run(tools().search, { query: 'name', limit: 2 })
    expect(out.split('\n').filter((l) => l.includes(':')).length).toBeLessThanOrEqual(4)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `export PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH"; pnpm --filter @uidx/agent test tools-read`
Expected: FAIL — cannot resolve `../src/tools/read.js`.

- [ ] **Step 3: Write the tools**

`packages/agent/src/tools/read.ts`:

```ts
import { resolve, type UidxDocument, type UidxNode } from '@uidx/format'
import { tool } from 'ai'
import { z } from 'zod'

export interface ReadDeps {
  workspace: {
    docOf(file: string): UidxDocument | null
    sourceOf(file: string): string | null
    members(): readonly string[]
  }
}

const MAX_HITS = 20

/** The deepest authored node containing `offset`, for locating a search hit. */
function enclosing(node: UidxNode, offset: number): UidxNode | null {
  if (offset < node.loc.start || offset >= node.loc.end) return null
  for (const child of node.children) {
    const deeper = enclosing(child, offset)
    if (deeper) return deeper
  }
  return node
}

function lineOf(source: string, offset: number): number {
  let line = 1
  for (let i = 0; i < offset; i += 1) if (source[i] === '\n') line += 1
  return line
}

export function readTools(deps: ReadDeps) {
  const read = tool({
    description: 'Read the exact source of one node, or of a whole page.',
    inputSchema: z.object({
      file: z.string().describe('page path, e.g. home.uidx'),
      address: z
        .string()
        .optional()
        .describe('node address, e.g. hero/headline. Omit for the whole page.'),
    }),
    execute: async ({ file, address }) => {
      const doc = deps.workspace.docOf(file)
      if (!doc) {
        return `no such page: ${file}. Pages: ${deps.workspace.members().join(', ')}`
      }
      if (!address) return doc.source
      const node = resolve(doc.tree, address)
      if (!node) return `no node at ${address} on ${file}`
      return doc.source.slice(node.loc.start, node.loc.end)
    },
  })

  const search = tool({
    description: 'Search every page for text. Returns addresses, not whole files.',
    inputSchema: z.object({
      query: z.string(),
      regex: z.boolean().optional().describe('treat the query as a regular expression'),
      limit: z.number().int().min(1).max(MAX_HITS).optional(),
    }),
    execute: async ({ query, regex, limit }) => {
      const cap = limit ?? MAX_HITS
      const matcher = regex ? new RegExp(query, 'g') : null
      const hits: string[] = []

      for (const file of deps.workspace.members()) {
        const doc = deps.workspace.docOf(file)
        const source = deps.workspace.sourceOf(file)
        if (!doc || !source) continue

        const offsets: number[] = []
        if (matcher) {
          matcher.lastIndex = 0
          for (const match of source.matchAll(matcher)) {
            if (match.index !== undefined) offsets.push(match.index)
          }
        } else {
          let at = source.indexOf(query)
          while (at !== -1) {
            offsets.push(at)
            at = source.indexOf(query, at + query.length)
          }
        }

        for (const offset of offsets) {
          if (hits.length >= cap) break
          const node = enclosing(doc.tree, offset)
          const line = lineOf(source, offset)
          const address = node?.address === '' ? '(page)' : (node?.address ?? '(page)')
          const text = source.slice(offset, offset + 80).split('\n')[0] ?? ''
          hits.push(`${file}:${line} ${address} — ${text.trim()}`)
        }
      }

      if (hits.length === 0) return `no matches for ${query}`
      const more = hits.length >= cap ? `\n(stopped at ${cap} hits)` : ''
      return hits.join('\n') + more
    },
  })

  return { read, search }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `export PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH"; pnpm --filter @uidx/agent test tools-read`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/agent && git commit -m "Two ways to look, neither of them a whole file"
```

---

### Task 11: The write tools

**Files:**
- Create: `packages/agent/src/tools/edit.ts`, `packages/agent/src/tools/index.ts`
- Test: `packages/agent/test/tools-edit.test.ts`

**Interfaces:**
- Consumes: `ApplyContext`, `applyOps`, `createFile`, `deleteFile` (Task 9); `readTools` (Task 10).
- Produces: `editTools(ctx: ApplyContext & { onFileTouched?: (file: string) => void })` returning `{ edit, create_file, delete_file }`, and `buildTools(deps)` returning the full tool set.

- [ ] **Step 1: Write the failing test**

`packages/agent/test/tools-edit.test.ts`:

```ts
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { createCheckpointStore } from '../src/edit/checkpoint.js'
import { editTools } from '../src/tools/edit.js'
import { discoverManifests } from '../src/workspace/discover.js'
import { openWorkspace, type Workspace } from '../src/workspace/workspace.js'

const HOME = `---
id: home
---

## Visual Contract

<Page>
  <Frame name="hero" width={600} height={200} />
</Page>
`

let open: Workspace | null = null
afterEach(async () => {
  await open?.close()
  open = null
})

async function harness() {
  const root = await mkdtemp(join(tmpdir(), 'uidx-agent-tools-'))
  await writeFile(join(root, 'uidx.json'), JSON.stringify({ id: 'doc', files: ['**/*.uidx'] }))
  await writeFile(join(root, 'home.uidx'), HOME)
  const [found] = await discoverManifests([root])
  open = await openWorkspace(found!)
  const touched: string[] = []
  const tools = editTools({
    workspace: open,
    checkpoints: createCheckpointStore(root),
    globs: ['**/*.uidx'],
    turnId: 'turn-1',
    maxFilesPerTurn: 2,
    onFileTouched: (file) => touched.push(file),
  })
  return { root, tools, touched, workspace: open }
}

const run = async (tool: { execute?: unknown }, input: unknown): Promise<string> => {
  const execute = tool.execute as (i: unknown, o: unknown) => Promise<string>
  return execute(input, { toolCallId: 't', messages: [] })
}

describe('edit', () => {
  it('applies a batch and confirms what changed', async () => {
    const { tools, root } = await harness()
    const out = await run(tools.edit, {
      file: 'home.uidx',
      ops: [{ kind: 'set_prop', address: 'hero', prop: 'width', value: 800 }],
    })
    expect(out).toMatch(/applied/i)
    expect(await readFile(join(root, 'home.uidx'), 'utf8')).toContain('width={800}')
  })

  it('hands a refusal back as text the model can act on', async () => {
    const { tools } = await harness()
    const out = await run(tools.edit, {
      file: 'home.uidx',
      ops: [{ kind: 'set_prop', address: 'ghost', prop: 'width', value: 1 }],
    })
    expect(out).toMatch(/ghost/)
    expect(out).toMatch(/not applied|refused|failed/i)
  })

  it('records every file it touched so the turn can be reverted', async () => {
    const { tools, touched } = await harness()
    await run(tools.edit, {
      file: 'home.uidx',
      ops: [{ kind: 'set_prop', address: 'hero', prop: 'width', value: 800 }],
    })
    expect(touched).toEqual(['home.uidx'])
  })

  it('stops once the turn has touched its budget of files', async () => {
    const { tools } = await harness()
    await run(tools.create_file, { file: 'a.uidx', pageId: 'a' })
    await run(tools.create_file, { file: 'b.uidx', pageId: 'b' })
    const out = await run(tools.create_file, { file: 'c.uidx', pageId: 'c' })
    expect(out).toMatch(/budget/i)
  })
})

describe('create_file and delete_file', () => {
  it('creates a page that parses', async () => {
    const { tools, workspace } = await harness()
    expect(await run(tools.create_file, { file: 'about.uidx', pageId: 'about' })).toMatch(/created/i)
    expect(workspace.docOf('about.uidx')).not.toBeNull()
  })

  it('deletes a page', async () => {
    const { tools, workspace } = await harness()
    expect(await run(tools.delete_file, { file: 'home.uidx' })).toMatch(/deleted/i)
    expect(workspace.docOf('home.uidx')).toBeNull()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `export PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH"; pnpm --filter @uidx/agent test tools-edit`
Expected: FAIL — cannot resolve `../src/tools/edit.js`.

- [ ] **Step 3: Write the write tools**

`packages/agent/src/tools/edit.ts`:

```ts
import { tool } from 'ai'
import { z } from 'zod'

import { applyOps, createFile, deleteFile, type ApplyContext } from '../edit/apply.js'
import { editOpsSchema } from '../edit/ops.js'

export interface EditDeps extends ApplyContext {
  maxFilesPerTurn: number
  onFileTouched?: (file: string) => void
}

export function editTools(deps: EditDeps) {
  const touched = new Set<string>()

  const budgetLeft = (file: string): string | null =>
    touched.has(file) || touched.size < deps.maxFilesPerTurn
      ? null
      : `file budget reached (${deps.maxFilesPerTurn} files this turn) — finish and report instead`

  const record = (file: string): void => {
    if (!touched.has(file)) {
      touched.add(file)
      deps.onFileTouched?.(file)
    }
  }

  const edit = tool({
    description:
      'Change one page. Reuse an existing component before building a new tree; extract a repeated structure into a Component.',
    inputSchema: z.object({
      file: z.string().describe('page path, e.g. home.uidx'),
      ops: editOpsSchema,
    }),
    execute: async ({ file, ops }) => {
      const blocked = budgetLeft(file)
      if (blocked) return blocked
      const result = await applyOps(deps, file, ops)
      if (!result.ok) return `not applied — ${result.error}`
      record(file)
      return `applied ${result.changed} change(s) to ${file}`
    },
  })

  const create_file = tool({
    description: 'Create a new empty page, then fill it with edit.',
    inputSchema: z.object({
      file: z.string().describe('new page path, e.g. settings.uidx'),
      pageId: z.string().describe('the id in the page frontmatter'),
    }),
    execute: async ({ file, pageId }) => {
      const blocked = budgetLeft(file)
      if (blocked) return blocked
      const result = await createFile(deps, file, pageId)
      if (!result.ok) return `not created — ${result.error}`
      record(file)
      return `created ${file}`
    },
  })

  const delete_file = tool({
    description: 'Delete a page. Only when the user asked for it.',
    inputSchema: z.object({ file: z.string() }),
    execute: async ({ file }) => {
      const blocked = budgetLeft(file)
      if (blocked) return blocked
      const result = await deleteFile(deps, file)
      if (!result.ok) return `not deleted — ${result.error}`
      record(file)
      return `deleted ${file}`
    },
  })

  return { edit, create_file, delete_file }
}
```

`packages/agent/src/tools/index.ts`:

```ts
import { editTools, type EditDeps } from './edit.js'
import { readTools } from './read.js'

export function buildTools(deps: EditDeps) {
  return {
    ...readTools({ workspace: deps.workspace }),
    ...editTools(deps),
  }
}

export type UidxTools = ReturnType<typeof buildTools>
export { editTools, readTools }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `export PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH"; pnpm --filter @uidx/agent test tools-edit`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/agent && git commit -m "Three ways to write, all of them checked"
```

---

### Task 12: The system prompt and the agent

**Files:**
- Create: `packages/agent/src/agent/prompt.ts`, `packages/agent/src/agent/agent.ts`
- Test: `packages/agent/test/prompt.test.ts`, `packages/agent/test/agent.test.ts`

**Interfaces:**
- Consumes: `buildTools` (Task 11), `languageModelFor` (Task 2), `packContext` (Task 6).
- Produces: `SYSTEM_PROMPT: string`, `buildAgent(deps): ToolLoopAgent`.

- [ ] **Step 1: Write the failing prompt test**

`packages/agent/test/prompt.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { SYSTEM_PROMPT } from '../src/agent/prompt.js'

describe('SYSTEM_PROMPT', () => {
  it('stays under the budget the spec sets, roughly 600 tokens', () => {
    // ~4 characters per token is the usual rule of thumb.
    expect(SYSTEM_PROMPT.length).toBeLessThan(2400)
  })

  it('states the reuse-first rule, which is the whole point of the doc map', () => {
    expect(SYSTEM_PROMPT).toMatch(/reuse/i)
  })

  it('tells the model it edits files, not the canvas', () => {
    expect(SYSTEM_PROMPT).toMatch(/\.uidx/)
  })

  it('carries no per-document facts — those arrive as context, not prompt', () => {
    expect(SYSTEM_PROMPT).not.toMatch(/home\.uidx|Card/)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `export PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH"; pnpm --filter @uidx/agent test prompt`
Expected: FAIL — cannot resolve `../src/agent/prompt.js`.

- [ ] **Step 3: Write the prompt**

`packages/agent/src/agent/prompt.ts`:

```ts
/**
 * Deliberately small. Everything specific to a document — the map, the current
 * page, the selection — arrives as context on the turn, never as prompt.
 */
export const SYSTEM_PROMPT = `You are the uidx design agent. You edit a designer's .uidx files: Markdown intent plus a JSX tree of Figma-shaped nodes (Page, Component, Frame, Text, Rectangle, Ellipse, Vector, Instance, Variant, Slot, Tokens).

How you work:
- Look before you write. Use read and search to check the exact source you are about to change.
- Reuse first. The map lists every component that exists; instantiate one rather than rebuilding its tree.
- Extract repetition. Three similar structures should become one Component with props.
- Keep pages small. A page is a skeleton of instances, not a thousand nodes.
- Reference tokens by alias ("{collection#name}") rather than hardcoding a value that already has a name.

Editing:
- Every change goes through edit, as a batch of ops on one file. Addresses look like hero/headline; "" is the page root.
- A refused edit comes back as text explaining why. Read it, fix the op, try again. Do not repeat a failing edit unchanged.
- Say what you changed in one sentence when you are done. Do not paste the file back.`
```

- [ ] **Step 4: Run the prompt test to verify it passes**

Run: `export PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH"; pnpm --filter @uidx/agent test prompt`
Expected: PASS (4 tests).

- [ ] **Step 5: Write the failing agent test**

`packages/agent/test/agent.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { MockLanguageModelV4 } from 'ai/test'
import type { LanguageModel } from 'ai'

import { buildAgent } from '../src/agent/agent.js'

const textModel = (text: string): LanguageModel =>
  new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: 'text', text }],
      finishReason: 'stop',
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      warnings: [],
    }),
  })

const deps = (model: LanguageModel) => ({
  model,
  tools: {},
  maxSteps: 5,
  maxTokens: 200_000,
  context: 'SELECTED\n  (nothing selected)',
})

describe('buildAgent', () => {
  it('answers a plain question without touching a tool', async () => {
    const agent = buildAgent(deps(textModel('There are two pages.')))
    const result = await agent.generate({ prompt: 'How many pages are there?' })
    expect(result.text).toBe('There are two pages.')
  })

  it('sends the mission context to the model, not just the question', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => ({
        content: [{ type: 'text', text: 'ok' }],
        finishReason: 'stop',
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        warnings: [],
      }),
    })
    const agent = buildAgent(deps(model))
    await agent.generate({ prompt: 'anything' })
    const sent = JSON.stringify(model.doGenerateCalls[0]?.prompt ?? [])
    expect(sent).toContain('nothing selected')
  })

  it('carries the system prompt as instructions', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => ({
        content: [{ type: 'text', text: 'ok' }],
        finishReason: 'stop',
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        warnings: [],
      }),
    })
    await buildAgent(deps(model)).generate({ prompt: 'anything' })
    const sent = JSON.stringify(model.doGenerateCalls[0]?.prompt ?? [])
    expect(sent).toContain('uidx design agent')
  })
})
```

- [ ] **Step 6: Run it to verify it fails**

Run: `export PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH"; pnpm --filter @uidx/agent test agent`
Expected: FAIL — cannot resolve `../src/agent/agent.js`.

- [ ] **Step 7: Write the agent builder**

`packages/agent/src/agent/agent.ts`:

```ts
import {
  generateText,
  isStepCount,
  ToolLoopAgent,
  type LanguageModel,
  type ToolCallRepairFunction,
  type ToolSet,
} from 'ai'

import { SYSTEM_PROMPT } from './prompt.js'

export interface AgentDeps {
  model: LanguageModel
  tools: ToolSet
  maxSteps: number
  /** Stop the loop once the turn has burned this many tokens. */
  maxTokens: number
  /** The mission context pack for this turn. */
  context: string
  /** Optional stronger model used only to regenerate malformed tool arguments. */
  repairModel?: LanguageModel
}

/**
 * One flat loop. The scaffolding small models need lives here: the context pack
 * is pinned as instructions rather than buried in history, and the first step
 * is nudged toward looking before writing.
 */
export function buildAgent(deps: AgentDeps): ToolLoopAgent<never, ToolSet> {
  const readOnly = ['read', 'search'].filter((name) => name in deps.tools)
  const tokenCap = deps.maxTokens

  return new ToolLoopAgent({
    model: deps.model,
    instructions: [
      SYSTEM_PROMPT,
      '',
      'What the user is looking at right now:',
      deps.context,
    ].join('\n'),
    tools: deps.tools,
    stopWhen: [
      isStepCount(deps.maxSteps),
      // A loop that keeps reading without converging costs real money on a
      // hosted model and real minutes on a local one.
      ({ steps }) =>
        steps.reduce((total, step) => total + (step.usage?.totalTokens ?? 0), 0) >= tokenCap,
    ],
    prepareStep: async ({ stepNumber }) =>
      // Step 0 is for orientation: a small model that can write immediately
      // usually writes before it has read.
      stepNumber === 0 && readOnly.length > 0 ? { activeTools: readOnly } : {},
    ...(deps.repairModel ? { repairToolCall: repairWith(deps.repairModel) } : {}),
  })
}

/**
 * Regenerate a malformed tool call's arguments on a stronger model, with the
 * tool forced so the repair cannot turn into a conversation.
 */
function repairWith(model: LanguageModel): ToolCallRepairFunction<ToolSet> {
  return async ({ toolCall, tools, error, messages, instructions }) => {
    const result = await generateText({
      model,
      instructions,
      messages: [
        ...messages,
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `The call to ${toolCall.toolName} was rejected: ${error.message}. Call it again with corrected arguments.`,
            },
          ],
        },
      ],
      tools,
      toolChoice: { type: 'tool', toolName: toolCall.toolName },
    })

    const repaired = result.toolCalls.find((call) => call.toolName === toolCall.toolName)
    // Returning null lets the loop hand the original error to the model, which
    // is the right fallback when the repair model cannot do better either.
    return repaired ? { ...toolCall, input: JSON.stringify(repaired.input) } : null
  }
}
```

- [ ] **Step 8: Run the agent test to verify it passes**

Run: `export PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH"; pnpm --filter @uidx/agent test agent`
Expected: PASS (3 tests).

- [ ] **Step 9: Commit**

```bash
git add packages/agent && git commit -m "A small prompt and a flat loop"
```

---

### Task 13: The chat and revert routes

**Files:**
- Modify: `packages/agent/src/server/app.ts`, `packages/agent/src/server/main.ts`, `packages/agent/src/index.ts`
- Create: `packages/agent/src/server/turn.ts`
- Test: `packages/agent/test/turn.test.ts`, `packages/agent/test/chat-route.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces:
  - `interface ChatBody { messages: unknown[]; documentId?: string; page?: string; selection?: string[] }`
  - `createTurnRunner(config, deps): { chat(body): Promise<Response>; revert(body): Promise<Response> }`

- [ ] **Step 1: Write the failing turn test**

`packages/agent/test/turn.test.ts`:

```ts
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MockLanguageModelV4 } from 'ai/test'
import { afterEach, describe, expect, it } from 'vitest'

import { createTurnRunner, type TurnRunner } from '../src/server/turn.js'

const HOME = `---
id: home
---

## Visual Contract

<Page>
  <Frame name="hero" width={600} height={200} />
</Page>
`

let runner: TurnRunner | null = null
afterEach(async () => {
  await runner?.close()
  runner = null
})

async function harness(model: MockLanguageModelV4) {
  const root = await mkdtemp(join(tmpdir(), 'uidx-agent-turn-'))
  await writeFile(join(root, 'uidx.json'), JSON.stringify({ id: 'doc', files: ['**/*.uidx'] }))
  await writeFile(join(root, 'home.uidx'), HOME)
  runner = createTurnRunner({
    roots: [root],
    maxSteps: 6,
    maxFilesPerTurn: 4,
    maxTokens: 200_000,
    model: () => model,
  })
  return { root, runner: runner! }
}

const textModel = (text: string) =>
  new MockLanguageModelV4({
    doStream: async () => ({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: 'text-start', id: '0' })
          controller.enqueue({ type: 'text-delta', id: '0', delta: text })
          controller.enqueue({ type: 'text-end', id: '0' })
          controller.enqueue({
            type: 'finish',
            finishReason: 'stop',
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          })
          controller.close()
        },
      }),
    }),
  })

const userMessage = (text: string) => ({
  id: 'm1',
  role: 'user',
  parts: [{ type: 'text', text }],
})

describe('chat', () => {
  it('streams an answer for the document the app named', async () => {
    const { runner } = await harness(textModel('Two pages.'))
    const response = await runner.chat({
      messages: [userMessage('how many pages?')],
      documentId: 'doc',
      page: 'home.uidx',
      selection: [],
    })
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('Two pages.')
  })

  it('puts the current page and selection into the model context', async () => {
    const model = textModel('ok')
    const { runner } = await harness(model)
    await runner.chat({
      messages: [userMessage('what is selected?')],
      documentId: 'doc',
      page: 'home.uidx',
      selection: ['hero'],
    })
    const sent = JSON.stringify(model.doStreamCalls[0]?.prompt ?? [])
    expect(sent).toContain('name="hero"')
  })

  it('refuses politely when no document matches', async () => {
    const { runner } = await harness(textModel('ok'))
    const response = await runner.chat({
      messages: [userMessage('hi')],
      documentId: 'missing-doc',
    })
    expect(response.status).toBe(404)
  })
})

describe('revert', () => {
  it('restores every file a turn wrote', async () => {
    const { root, runner } = await harness(textModel('ok'))
    const response = await runner.chat({
      messages: [userMessage('hi')],
      documentId: 'doc',
      page: 'home.uidx',
    })
    const turnId = response.headers.get('x-uidx-turn')
    expect(turnId).toBeTruthy()

    // Simulate the turn having written, then revert it.
    await runner.captureForTest(turnId!, 'doc', 'home.uidx')
    await writeFile(join(root, 'home.uidx'), 'clobbered')
    const reverted = await runner.revert({ documentId: 'doc', turnId: turnId! })

    expect(reverted.status).toBe(200)
    expect(await readFile(join(root, 'home.uidx'), 'utf8')).toBe(HOME)
  })

  it('says so when the turn is unknown', async () => {
    const { runner } = await harness(textModel('ok'))
    const response = await runner.revert({ documentId: 'doc', turnId: 'nope' })
    expect(response.status).toBe(404)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `export PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH"; pnpm --filter @uidx/agent test turn`
Expected: FAIL — cannot resolve `../src/server/turn.js`.

- [ ] **Step 3: Carry the manifest globs through discovery**

A write is authorised against the manifest's raw `files` patterns, not its
expanded member list, so `FoundDoc` has to keep them.

In `packages/agent/src/workspace/discover.ts`, add the field to the interface:

```ts
export interface FoundDoc {
  path: string
  dir: string
  id: string
  /** The manifest's raw `files` globs — what authorises a write. */
  globs: string[]
  files: string[]
}
```

and populate it in `discoverManifests`, replacing the existing `found.push(...)`:

```ts
      found.push({ path, dir, id, globs: files as string[], files: [...new Set(members)].sort() })
```

Add to `packages/agent/test/discover.test.ts`:

```ts
it('keeps the raw manifest globs, which is what authorises a write', async () => {
  const found = await discoverManifests([await fixture()])
  expect(found[0]?.globs).toEqual(['**/*.uidx'])
})
```

Run: `export PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH"; pnpm --filter @uidx/agent test discover`
Expected: PASS (5 tests).

- [ ] **Step 4: Write the turn runner**

`packages/agent/src/server/turn.ts`:

```ts
import { randomUUID } from 'node:crypto'
import { createAgentUIStreamResponse, type LanguageModel } from 'ai'

import { buildAgent } from '../agent/agent.js'
import { createCheckpointStore, type CheckpointStore } from '../edit/checkpoint.js'
import { buildIndex } from '../index/build.js'
import { packContext } from '../index/pack.js'
import { buildTools } from '../tools/index.js'
import { discoverManifests, matchDocument, type FoundDoc } from '../workspace/discover.js'
import { openWorkspace, type Workspace } from '../workspace/workspace.js'

export interface ChatBody {
  messages: unknown[]
  /** The manifest id the viewer reported from `document:opened`. */
  documentId?: string
  /** Workspace-relative path of the open page. */
  page?: string
  selection?: string[]
}

export interface RevertBody {
  documentId?: string
  page?: string
  turnId: string
}

export interface TurnRunnerConfig {
  roots: string[]
  maxSteps: number
  maxFilesPerTurn: number
  maxTokens: number
  model: () => LanguageModel
  repairModel?: () => LanguageModel
}

export interface TurnRunner {
  chat(body: ChatBody): Promise<Response>
  revert(body: RevertBody): Promise<Response>
  /** Test seam: snapshot a file under a turn without running a model. */
  captureForTest(turnId: string, documentId: string, file: string): Promise<void>
  close(): Promise<void>
}

interface Session {
  found: FoundDoc
  workspace: Workspace
  checkpoints: CheckpointStore
}

export function createTurnRunner(config: TurnRunnerConfig): TurnRunner {
  const sessions = new Map<string, Session>()

  async function session(hint: { id?: string; page?: string }): Promise<Session> {
    const found = matchDocument(await discoverManifests(config.roots), hint)
    const existing = sessions.get(found.path)
    if (existing) return existing

    const opened: Session = {
      found,
      workspace: await openWorkspace(found),
      checkpoints: createCheckpointStore(found.dir),
    }
    sessions.set(found.path, opened)
    return opened
  }

  const problem = (error: unknown, status: number): Response =>
    new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
      status,
      headers: { 'content-type': 'application/json' },
    })

  return {
    async chat(body) {
      let open: Session
      try {
        open = await session({ id: body.documentId, page: body.page })
      } catch (error) {
        return problem(error, 404)
      }

      const turnId = randomUUID()
      const docs = open.workspace.docs()
      const index = buildIndex(open.found.id, docs)
      const pack = packContext(index, docs, {
        file: body.page ?? null,
        selection: body.selection ?? [],
      })

      const tools = buildTools({
        workspace: open.workspace,
        checkpoints: open.checkpoints,
        globs: open.found.globs,
        turnId,
        maxFilesPerTurn: config.maxFilesPerTurn,
      })

      const agent = buildAgent({
        model: config.model(),
        tools,
        maxSteps: config.maxSteps,
        maxTokens: config.maxTokens,
        context: pack.text,
        repairModel: config.repairModel?.(),
      })

      const response = await createAgentUIStreamResponse({
        agent,
        uiMessages: body.messages,
        // The panel needs the turn id to offer "revert this turn".
        messageMetadata: () => ({ turnId }),
      })
      response.headers.set('x-uidx-turn', turnId)
      return response
    },

    async revert(body) {
      let open: Session
      try {
        open = await session({ id: body.documentId, page: body.page })
      } catch (error) {
        return problem(error, 404)
      }
      try {
        const files = await open.checkpoints.revert(body.turnId)
        for (const file of files) await open.workspace.reload(file).catch(() => undefined)
        return Response.json({ ok: true, files })
      } catch (error) {
        return problem(error, 404)
      }
    },

    async captureForTest(turnId, documentId, file) {
      const open = await session({ id: documentId })
      await open.checkpoints.capture(turnId, file)
    },

    async close() {
      for (const open of sessions.values()) await open.workspace.close()
      sessions.clear()
    },
  }
}
```

- [ ] **Step 5: Wire the routes**

Replace `packages/agent/src/server/app.ts`'s `AppDeps` and routes:

```ts
export interface AppDeps {
  version: string
  chat: (body: unknown) => Promise<Response>
  revert: (body: unknown) => Promise<Response>
}
```

and add, after the `/chat` route:

```ts
  app.post('/revert', async (c) => deps.revert(await c.req.json()))
```

Update `packages/agent/src/server/main.ts` to build a real runner:

```ts
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
  model: () => languageModelFor(config.models.orchestrator),
  repairModel: config.models.repair
    ? () => languageModelFor(config.models.repair!)
    : undefined,
})

const app = createApp({
  version: '0.0.0',
  chat: (body) => runner.chat(body as ChatBody),
  revert: (body) => runner.revert(body as RevertBody),
})

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`uidx agent listening on http://localhost:${info.port}`)
  console.log(`model: ${config.models.orchestrator.provider}:${config.models.orchestrator.model}`)
  console.log(`roots: ${config.roots.join(', ')}`)
})
```

Update `packages/agent/test/health.test.ts`'s `app()` helper to pass the new dep:

```ts
const app = () =>
  createApp({
    version: '0.0.0',
    chat: async () => new Response('unused'),
    revert: async () => new Response('unused'),
  })
```

- [ ] **Step 6: Write the failing route test**

`packages/agent/test/chat-route.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { createApp } from '../src/server/app.js'

const app = () =>
  createApp({
    version: '0.0.0',
    chat: async (body) => Response.json({ saw: body }),
    revert: async (body) => Response.json({ reverted: body }),
  })

describe('POST /chat', () => {
  it('hands the whole body to the runner, metadata included', async () => {
    const response = await app().request('/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [], documentId: 'doc', page: 'home.uidx', selection: ['hero'] }),
    })
    expect(await response.json()).toEqual({
      saw: { messages: [], documentId: 'doc', page: 'home.uidx', selection: ['hero'] },
    })
  })
})

describe('POST /revert', () => {
  it('hands the turn id to the runner', async () => {
    const response = await app().request('/revert', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ documentId: 'doc', turnId: 't-1' }),
    })
    expect(await response.json()).toEqual({ reverted: { documentId: 'doc', turnId: 't-1' } })
  })
})
```

- [ ] **Step 7: Run the whole package suite**

Run: `export PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH"; pnpm --filter @uidx/agent test && pnpm --filter @uidx/agent typecheck`
Expected: PASS across every file, no type errors.

- [ ] **Step 8: Commit**

```bash
git add packages/agent && git commit -m "One turn, end to end, with a way back"
```

---

### Task 14: The viewer's agent client

**Files:**
- Create: `packages/viewer/src/agent-client.ts`
- Test: `packages/viewer/test/agent-client.test.ts`

**Interfaces:**
- Consumes: nothing (pure module).
- Produces:
  - `agentUrl(env: Record<string, string | undefined>): string`
  - `probeAgent(url, fetchImpl): Promise<{ online: boolean; version?: string }>`
  - `chatBody(input: { documentId: string | null; page: string | null; selection: readonly string[] }): Record<string, unknown>`

- [ ] **Step 1: Write the failing test**

`packages/viewer/test/agent-client.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'

import { agentUrl, chatBody, probeAgent } from '../src/agent-client.ts'

describe('agentUrl', () => {
  it('falls back to the documented default', () => {
    expect(agentUrl({})).toBe('http://localhost:4500')
  })

  it('prefers the configured url', () => {
    expect(agentUrl({ VITE_UIDX_AGENT_URL: 'http://gpu.local:9000' })).toBe('http://gpu.local:9000')
  })

  it('trims a trailing slash so route joins stay clean', () => {
    expect(agentUrl({ VITE_UIDX_AGENT_URL: 'http://localhost:4500/' })).toBe('http://localhost:4500')
  })
})

describe('probeAgent', () => {
  it('reports the version when the service answers', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true, version: '0.0.0' })))
    expect(await probeAgent('http://localhost:4500', fetchImpl)).toEqual({
      online: true,
      version: '0.0.0',
    })
  })

  it('reports offline rather than throwing when nothing is listening', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNREFUSED')
    })
    expect(await probeAgent('http://localhost:4500', fetchImpl)).toEqual({ online: false })
  })

  it('reports offline on a non-ok response', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 500 }))
    expect(await probeAgent('http://localhost:4500', fetchImpl)).toEqual({ online: false })
  })
})

describe('chatBody', () => {
  it('carries the document, the page and the selection', () => {
    expect(chatBody({ documentId: 'doc', page: 'home.uidx', selection: ['hero'] })).toEqual({
      documentId: 'doc',
      page: 'home.uidx',
      selection: ['hero'],
    })
  })

  it('omits what the app does not know rather than sending nulls', () => {
    expect(chatBody({ documentId: null, page: 'home.uidx', selection: [] })).toEqual({
      page: 'home.uidx',
      selection: [],
    })
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `export PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH"; pnpm --filter @uidx/viewer test agent-client`
Expected: FAIL — cannot resolve `../src/agent-client.ts`.

- [ ] **Step 3: Write the client module**

`packages/viewer/src/agent-client.ts`:

```ts
/**
 * Everything the panel needs to talk to the agent service, kept out of the
 * component so it can be tested without mounting anything.
 */
const DEFAULT_URL = 'http://localhost:4500'

export function agentUrl(env: Record<string, string | undefined>): string {
  return (env.VITE_UIDX_AGENT_URL ?? DEFAULT_URL).replace(/\/+$/, '')
}

export interface AgentStatus {
  online: boolean
  version?: string
}

export async function probeAgent(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<AgentStatus> {
  try {
    const response = await fetchImpl(`${url}/health`)
    if (!response.ok) return { online: false }
    const body = (await response.json()) as { version?: string }
    return { online: true, version: body.version }
  } catch {
    // The service is optional; not running is a normal state, not an error.
    return { online: false }
  }
}

export interface ChatContext {
  documentId: string | null
  page: string | null
  selection: readonly string[]
}

/** The canvas status that rides along with every message. */
export function chatBody(context: ChatContext): Record<string, unknown> {
  const body: Record<string, unknown> = { selection: [...context.selection] }
  if (context.documentId !== null) body.documentId = context.documentId
  if (context.page !== null) body.page = context.page
  return body
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `export PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH"; pnpm --filter @uidx/viewer test agent-client`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/viewer && git commit -m "The viewer learns the agent's address"
```

---

### Task 15: The chat panel component

**Files:**
- Create: `packages/viewer/src/ChatPanel.vue`
- Test: `packages/viewer/test/chat-panel.test.ts`
- Modify: `packages/viewer/package.json` (add `@ai-sdk/vue`, `ai`)

**Interfaces:**
- Consumes: `agentUrl`, `chatBody` (Task 14).
- Produces: a `ChatPanel` component with props `{ documentId: string | null; page: string | null; selection: readonly string[]; url: string }` and emit `close`.

- [ ] **Step 1: Add the client dependencies**

Run: `export PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH"; pnpm --filter @uidx/viewer add @ai-sdk/vue@^4.0.84 ai@^7.0.84`

- [ ] **Step 2: Write the failing test**

`packages/viewer/test/chat-panel.test.ts`:

```ts
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import ChatPanel from '../src/ChatPanel.vue'

const render = (props: Record<string, unknown> = {}) =>
  mount(ChatPanel, {
    props: {
      documentId: 'doc',
      page: 'home.uidx',
      selection: ['hero'],
      url: 'http://localhost:4500',
      ...props,
    },
  })

describe('ChatPanel', () => {
  it('offers a prompt box and a send button', () => {
    const panel = render()
    expect(panel.find('textarea').exists()).toBe(true)
    expect(panel.find('[aria-label="Send"]').exists()).toBe(true)
  })

  it('shows what the agent can see, so the user knows the context it has', () => {
    expect(render().text()).toContain('home.uidx')
    expect(render().text()).toContain('hero')
  })

  it('says nothing is selected rather than showing an empty slot', () => {
    expect(render({ selection: [] }).text()).toMatch(/nothing selected/i)
  })

  it('closes when the close button is pressed', async () => {
    const panel = render()
    await panel.find('[aria-label="Close chat"]').trigger('click')
    expect(panel.emitted('close')).toHaveLength(1)
  })

  it('keeps the send button out of reach while the prompt is empty', () => {
    expect(render().find('[aria-label="Send"]').attributes('disabled')).toBeDefined()
  })
})
```

- [ ] **Step 3: Run it to verify it fails**

Run: `export PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH"; pnpm --filter @uidx/viewer test chat-panel`
Expected: FAIL — cannot resolve `../src/ChatPanel.vue`.

- [ ] **Step 4: Write the component**

`packages/viewer/src/ChatPanel.vue`:

```vue
<script setup lang="ts">
/**
 * The chat surface. It knows the page and the selection, sends them with every
 * message, and renders tool activity so the run is legible while it happens.
 * It never touches the document — the agent writes files, the socket brings
 * the change back through the normal file-changed path.
 */
import { useChat } from '@ai-sdk/vue'
import { DefaultChatTransport } from 'ai'
import { computed, ref } from 'vue'

import { chatBody } from './agent-client'

const props = defineProps<{
  documentId: string | null
  page: string | null
  selection: readonly string[]
  url: string
}>()

const emit = defineEmits<{ close: [] }>()

const input = ref('')

const { messages, status, error, sendMessage, stop } = useChat(() => ({
  transport: new DefaultChatTransport({ api: `${props.url}/chat` }),
}))

const busy = computed(() => status.value === 'submitted' || status.value === 'streaming')
const canSend = computed(() => input.value.trim().length > 0 && !busy.value)

const selectionLabel = computed(() =>
  props.selection.length > 0 ? props.selection.join(', ') : 'nothing selected',
)

function send(): void {
  if (!canSend.value) return
  const text = input.value
  input.value = ''
  void sendMessage(
    { text },
    {
      body: chatBody({
        documentId: props.documentId,
        page: props.page,
        selection: props.selection,
      }),
    },
  )
}
</script>

<template>
  <aside class="chat" aria-label="Agent chat">
    <header class="head">
      <span class="title">Agent</span>
      <span class="spacer" />
      <button type="button" class="icon" aria-label="Close chat" @click="emit('close')">
        <svg viewBox="0 0 12 12" aria-hidden="true">
          <path d="M3 3l6 6M9 3l-6 6" fill="none" stroke="currentColor" />
        </svg>
      </button>
    </header>

    <p class="context">
      {{ page ?? 'no page open' }} · {{ selectionLabel }}
    </p>

    <div class="log">
      <div v-for="message in messages" :key="message.id" class="msg" :data-role="message.role">
        <template v-for="(part, i) in message.parts" :key="`${message.id}-${i}`">
          <p v-if="part.type === 'text'" class="text">{{ part.text }}</p>
          <p v-else-if="part.type.startsWith('tool-')" class="tool">
            {{ part.type.replace('tool-', '') }}
          </p>
        </template>
      </div>
      <p v-if="error" class="failed" role="alert">{{ error.message }}</p>
    </div>

    <form class="compose" @submit.prevent="send">
      <textarea
        v-model="input"
        rows="2"
        placeholder="Ask for a change…"
        aria-label="Message"
        @keydown.enter.exact.prevent="send"
      />
      <button v-if="busy" type="button" class="icon" aria-label="Stop" @click="stop">
        <svg viewBox="0 0 12 12" aria-hidden="true">
          <rect x="3" y="3" width="6" height="6" fill="currentColor" />
        </svg>
      </button>
      <button v-else type="submit" class="icon" aria-label="Send" :disabled="!canSend">
        <svg viewBox="0 0 12 12" aria-hidden="true">
          <path d="M2 6h8M6.5 2.5L10 6l-3.5 3.5" fill="none" stroke="currentColor" />
        </svg>
      </button>
    </form>
  </aside>
</template>

<style scoped>
.chat {
  position: fixed;
  right: var(--gap);
  bottom: var(--gap);
  z-index: 30;
  display: flex;
  flex-direction: column;
  width: 320px;
  max-height: 60vh;
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  background: var(--panel);
  box-shadow: var(--shadow);
  font: var(--ui-size) / var(--ui-line) var(--ui-font);
  color: var(--text);
}

.head {
  display: flex;
  align-items: center;
  gap: var(--gap-sm);
  padding: var(--gap-sm) var(--pad);
  border-bottom: 1px solid var(--line);
}

.title {
  font-weight: 600;
}

.spacer {
  flex: 1;
}

.context {
  margin: 0;
  padding: var(--gap-sm) var(--pad);
  color: var(--text-faint);
  font-size: var(--ui-size-sm);
  border-bottom: 1px solid var(--line);
}

.log {
  flex: 1;
  overflow-y: auto;
  padding: var(--pad);
  display: flex;
  flex-direction: column;
  gap: var(--gap);
}

.msg[data-role='user'] .text {
  color: var(--text);
}

.msg[data-role='assistant'] .text {
  color: var(--text-dim);
}

.text {
  margin: 0;
  white-space: pre-wrap;
}

.tool {
  margin: 0;
  color: var(--text-faint);
  font-size: var(--ui-size-sm);
}

.failed {
  margin: 0;
  color: var(--danger);
}

.compose {
  display: flex;
  align-items: flex-end;
  gap: var(--gap-sm);
  padding: var(--gap-sm);
  border-top: 1px solid var(--line);
}

textarea {
  flex: 1;
  resize: none;
  padding: var(--gap-sm);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--bg);
  color: var(--text);
  font: inherit;
}

.icon {
  display: grid;
  place-items: center;
  width: var(--field-h);
  height: var(--field-h);
  border: none;
  border-radius: var(--radius);
  background: none;
  color: var(--text-dim);
  cursor: pointer;
}

.icon:hover:not(:disabled) {
  background: var(--raised);
}

.icon:disabled {
  color: var(--text-faint);
  cursor: default;
}

.icon svg {
  width: var(--icon);
  height: var(--icon);
  stroke-width: 1;
}
</style>
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `export PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH"; pnpm --filter @uidx/viewer test chat-panel`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/viewer pnpm-lock.yaml && git commit -m "A panel that says what the agent can see"
```

---

### Task 16: Wire the panel into the app

**Files:**
- Modify: `packages/viewer/src/App.vue`
- Test: `packages/viewer/test/agent-toggle.test.ts`

**Interfaces:**
- Consumes: `ChatPanel` (Task 15), `agentUrl`, `probeAgent` (Task 14).
- Produces: nothing consumed downstream.

- [ ] **Step 1: Write the failing test**

The viewer's convention is that `App.vue` is never mounted in tests, so this task tests the toggle logic as a pure module. Create `packages/viewer/src/agent-toggle.ts` alongside the test.

`packages/viewer/test/agent-toggle.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'

import { createAgentToggle } from '../src/agent-toggle.ts'

describe('createAgentToggle', () => {
  it('starts closed and offline, so a missing service costs nothing', () => {
    const toggle = createAgentToggle({ url: 'http://x', fetchImpl: async () => new Response('x') })
    expect(toggle.open.value).toBe(false)
    expect(toggle.status.value).toEqual({ online: false })
  })

  it('goes online once the probe answers', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true, version: '1' })))
    const toggle = createAgentToggle({ url: 'http://x', fetchImpl })
    await toggle.probe()
    expect(toggle.status.value).toEqual({ online: true, version: '1' })
  })

  it('opens and closes', async () => {
    const toggle = createAgentToggle({
      url: 'http://x',
      fetchImpl: async () => new Response(JSON.stringify({ ok: true, version: '1' })),
    })
    await toggle.probe()
    toggle.toggle()
    expect(toggle.open.value).toBe(true)
    toggle.toggle()
    expect(toggle.open.value).toBe(false)
  })

  it('refuses to open while the service is offline', async () => {
    const toggle = createAgentToggle({
      url: 'http://x',
      fetchImpl: async () => {
        throw new Error('down')
      },
    })
    await toggle.probe()
    toggle.toggle()
    expect(toggle.open.value).toBe(false)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `export PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH"; pnpm --filter @uidx/viewer test agent-toggle`
Expected: FAIL — cannot resolve `../src/agent-toggle.ts`.

- [ ] **Step 3: Write the toggle module**

`packages/viewer/src/agent-toggle.ts`:

```ts
import { ref, type Ref } from 'vue'

import { probeAgent, type AgentStatus } from './agent-client'

export interface AgentToggle {
  open: Ref<boolean>
  status: Ref<AgentStatus>
  probe(): Promise<void>
  toggle(): void
}

/**
 * The panel is optional: with no service running the icon stays inert rather
 * than opening onto an error.
 */
export function createAgentToggle(deps: {
  url: string
  fetchImpl?: typeof fetch
}): AgentToggle {
  const open = ref(false)
  const status = ref<AgentStatus>({ online: false })

  return {
    open,
    status,
    async probe() {
      status.value = await probeAgent(deps.url, deps.fetchImpl)
      if (!status.value.online) open.value = false
    },
    toggle() {
      if (!status.value.online) return
      open.value = !open.value
    },
  }
}
```

- [ ] **Step 4: Run the toggle test to verify it passes**

Run: `export PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH"; pnpm --filter @uidx/viewer test agent-toggle`
Expected: PASS (4 tests).

- [ ] **Step 5: Wire it into App.vue**

Add to the `<script setup>` imports in `packages/viewer/src/App.vue`:

```ts
import ChatPanel from './ChatPanel.vue'
import { agentUrl } from './agent-client'
import { createAgentToggle } from './agent-toggle'
```

Add near the other state declarations (after `const selection = shallowRef<string[]>([])`, around App.vue:87):

```ts
const agentHost = agentUrl(import.meta.env as Record<string, string | undefined>)
const agent = createAgentToggle({ url: agentHost })
// The service is optional and may start after the viewer, so keep asking.
void agent.probe()
const agentProbe = setInterval(() => void agent.probe(), 10_000)
onBeforeUnmount(() => clearInterval(agentProbe))
```

Add `onBeforeUnmount` to the existing `vue` import in App.vue if it is not already there.

Add the toggle button in `<header class="bar">`, immediately after the second `<span class="spacer" />` (App.vue:904) and before the `.conn` badge:

```vue
      <button
        type="button"
        class="agent-toggle"
        :disabled="!agent.status.value.online"
        :aria-pressed="agent.open.value"
        :title="agent.status.value.online ? 'Agent chat' : 'Agent offline'"
        aria-label="Agent chat"
        @click="agent.toggle()"
      >
        <svg viewBox="0 0 12 12" aria-hidden="true">
          <path
            d="M2 3.5h8v5H6.5L4 10.5V8.5H2z"
            fill="none"
            stroke="currentColor"
          />
        </svg>
      </button>
```

Add the panel as a sibling of the dialogs, immediately before `<div class="panes">` (App.vue:942):

```vue
    <ChatPanel
      v-if="agent.open.value"
      :document-id="documentId"
      :page="view.kind === 'page' ? view.file : null"
      :selection="selection"
      :url="agentHost"
      @close="agent.toggle()"
    />
```

Add to App.vue's `<style scoped>`:

```css
.agent-toggle {
  display: grid;
  place-items: center;
  width: var(--row-h);
  height: var(--row-h);
  border: none;
  border-radius: var(--radius);
  background: none;
  color: var(--text-dim);
  cursor: pointer;
}

.agent-toggle:hover:not(:disabled) {
  background: var(--raised);
}

.agent-toggle[aria-pressed='true'] {
  background: var(--accent);
  color: var(--text);
}

.agent-toggle:disabled {
  color: var(--text-faint);
  cursor: default;
}

.agent-toggle svg {
  width: var(--icon);
  height: var(--icon);
  stroke-width: 1;
}
```

- [ ] **Step 6: Verify the whole viewer suite and types**

Run: `export PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH"; pnpm --filter @uidx/viewer test && pnpm --filter @uidx/viewer typecheck`
Expected: PASS, no type errors. If `vue-tsc` complains about `import.meta.env`, add `/// <reference types="vite/client" />` at the top of `packages/viewer/src/agent-client.ts`.

- [ ] **Step 7: Commit**

```bash
git add packages/viewer && git commit -m "An icon in the bar, a panel over the canvas"
```

---

### Task 17: End-to-end verification and documentation

**Files:**
- Create: `packages/agent/README.md`
- Test: `packages/agent/test/end-to-end.test.ts`

**Interfaces:**
- Consumes: everything.
- Produces: nothing.

- [ ] **Step 1: Write the failing end-to-end test**

`packages/agent/test/end-to-end.test.ts`:

```ts
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MockLanguageModelV4 } from 'ai/test'
import { afterEach, describe, expect, it } from 'vitest'

import { createTurnRunner, type TurnRunner } from '../src/server/turn.js'

const HOME = `---
id: home
---

## Visual Contract

<Page>
  <Frame name="hero" width={600} height={200} />
</Page>
`

let runner: TurnRunner | null = null
afterEach(async () => {
  await runner?.close()
  runner = null
})

/** Step 1 calls `edit`; step 2 reports in words. */
function scriptedModel(): MockLanguageModelV4 {
  let call = 0
  return new MockLanguageModelV4({
    doStream: async () => {
      call += 1
      const first = call === 1
      return {
        stream: new ReadableStream({
          start(controller) {
            if (first) {
              controller.enqueue({
                type: 'tool-call',
                toolCallId: 'c1',
                toolName: 'edit',
                input: JSON.stringify({
                  file: 'home.uidx',
                  ops: [{ kind: 'set_prop', address: 'hero', prop: 'width', value: 800 }],
                }),
              })
            } else {
              controller.enqueue({ type: 'text-start', id: '0' })
              controller.enqueue({ type: 'text-delta', id: '0', delta: 'Widened the hero.' })
              controller.enqueue({ type: 'text-end', id: '0' })
            }
            controller.enqueue({
              type: 'finish',
              finishReason: first ? 'tool-calls' : 'stop',
              usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
            })
            controller.close()
          },
        }),
      }
    },
  })
}

describe('a whole turn', () => {
  it('edits the file the user was looking at, and can be undone', async () => {
    const root = await mkdtemp(join(tmpdir(), 'uidx-agent-e2e-'))
    await writeFile(join(root, 'uidx.json'), JSON.stringify({ id: 'doc', files: ['**/*.uidx'] }))
    await writeFile(join(root, 'home.uidx'), HOME)

    runner = createTurnRunner({
      roots: [root],
      maxSteps: 6,
      maxFilesPerTurn: 4,
      maxTokens: 200_000,
      model: () => scriptedModel(),
    })

    const response = await runner.chat({
      messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'make the hero wider' }] }],
      documentId: 'doc',
      page: 'home.uidx',
      selection: ['hero'],
    })

    const body = await response.text()
    expect(body).toContain('Widened the hero.')
    expect(await readFile(join(root, 'home.uidx'), 'utf8')).toContain('width={800}')

    const turnId = response.headers.get('x-uidx-turn')!
    const reverted = await runner.revert({ documentId: 'doc', turnId })
    expect(reverted.status).toBe(200)
    expect(await readFile(join(root, 'home.uidx'), 'utf8')).toBe(HOME)
  })
})
```

- [ ] **Step 2: Run it and fix what it finds**

Run: `export PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH"; pnpm --filter @uidx/agent test end-to-end`
Expected: PASS. This is the integration gate — if the tool call does not reach `edit`, check that `prepareStep` is not still restricting the toolset on the step that calls it (step 0 is read-only by design, so the scripted model's tool call happens on step 0 and would be blocked). If so, change `buildAgent`'s `prepareStep` to restrict only when the step has no prior tool results **and** the tool set contains write tools, and adjust `packages/agent/test/agent.test.ts` accordingly. Record whichever behaviour you land on in the README.

- [ ] **Step 3: Write the README**

`packages/agent/README.md`:

````markdown
# @uidx/agent

An optional chat harness for uidx. It runs as its own process, indexes a
document's `.uidx` files, and answers requests from the viewer's chat panel by
writing those files. It never talks to the canvas: the uidx server already
watches the files, so an accepted edit appears on screen the same way a
hand edit does.

## Running it

```bash
cp packages/agent/.env.example .env    # then edit
pnpm --filter @uidx/agent build
node packages/agent/dist/server/main.js
```

The service listens on `UIDX_AGENT_PORT` (default 4500) and searches
`UIDX_AGENT_ROOTS` (default: the working directory) for `uidx.json` files. The
viewer panel finds it at `VITE_UIDX_AGENT_URL`.

## Models

`UIDX_AGENT_MODEL` is `provider:model`. Every local runtime speaks the
OpenAI-compatible protocol:

| Provider | Example | Default base URL |
|---|---|---|
| `vllm` | `vllm:gemma-3-27b-it` | `http://localhost:8000/v1` |
| `ollama` | `ollama:qwen2.5-coder` | `http://localhost:11434/api` |
| `lmstudio` | `lmstudio:qwen2.5-coder` | `http://localhost:1234/v1` |
| `anthropic` | `anthropic:claude-sonnet-4-5` | — (needs `ANTHROPIC_API_KEY`) |

## Safety

- Only `.uidx` files inside the document root and covered by the manifest's
  `files` globs can be written.
- Every write is validated by re-parsing; a patch that would produce an invalid
  document is refused and the diagnostic goes back to the model.
- Every turn snapshots the files it is about to change under
  `.uidx-agent/checkpoints/<turn>/`. `POST /revert` restores them.

## Routes

| Route | Purpose |
|---|---|
| `GET /health` | Liveness; the panel's icon probes this |
| `POST /chat` | One turn. Body: `{ messages, documentId?, page?, selection? }` |
| `POST /revert` | Undo one turn. Body: `{ documentId?, turnId }` |
````

- [ ] **Step 4: Add `.uidx-agent/` to gitignore**

Append to the repo's `.gitignore`:

```
.uidx-agent/
```

- [ ] **Step 5: Run every check the CI runs**

Run:
```bash
export PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH"; pnpm format && pnpm lint && pnpm typecheck && pnpm build && pnpm test
```
Expected: all green. Fix anything that is not before committing.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "A turn that lands on disk, and a page that explains itself"
```

---

## Manual verification (after Task 17)

The automated suite proves the harness with mock models. To see it work for real:

1. Start a model: `vllm serve google/gemma-3-27b-it --port 8000` (or `ollama serve` with `UIDX_AGENT_MODEL=ollama:<model>`).
2. Start the agent from the repo root: `node packages/agent/dist/server/main.js`.
3. Start the viewer on a design document: `node packages/cli/dist/uidx.js open design/option-4/home.uidx`.
4. The chat icon in the top bar should be enabled. Open it, select a frame on canvas, and ask for a change (e.g. "make the hero 800 wide").
5. Confirm: the file on disk changes, the canvas updates without a reload, and `git diff` shows a minimal patch.

## Not in Phase 1

Deferred to Phase 2 and 3 per the spec: `view_image` (node and page rendering),
skills, memory and the learning loop, `web_search`, `delegate`, the live status
channel and agent halo, "Propose" mode, and the option-4 UI language.
