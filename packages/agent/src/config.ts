import type { JSONValue } from 'ai'
import { MIN_WINDOW_TOKENS } from './index/budget.js'

/**
 * The shape every model call accepts for provider-specific request options:
 * provider name to that provider's own settings. The SDK declares this type
 * internally but does not export it, so it is named once here — against `ai`'s
 * own exported `JSONValue` — and imported from this module everywhere else,
 * rather than restated in each file that forwards it.
 */
export type ProviderOptions = Record<string, Record<string, JSONValue>>

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
  /** The orchestrator model's context window, in tokens. Drives `budgetFor`. */
  contextTokens: number
  /**
   * Provider-specific request options, keyed by provider name, forwarded to
   * every model call. The OpenAI-compatible provider merges unknown keys
   * straight into the request body, which is how a local runtime's
   * non-standard switches are reached — vLLM's `guided_json`, or Ollama's
   * `chat_template_kwargs.enable_thinking`, without which a thinking model
   * spends its whole turn reasoning and returns no answer at all.
   */
  providerOptions?: ProviderOptions
  /**
   * Whether the orchestrator model can read an image. `view_image` refuses
   * when this is off rather than returning bytes a text-only model will
   * describe from the filename — a confident description of a picture it never
   * saw is worse than being told the tool is unavailable.
   */
  vision: boolean
}

const DEFAULT_BASE_URL: Record<ProviderName, string | undefined> = {
  vllm: 'http://localhost:8000/v1',
  lmstudio: 'http://localhost:1234/v1',
  'openai-compatible': undefined,
  ollama: 'http://localhost:11434/api',
  anthropic: undefined,
}

const PROVIDERS = Object.keys(DEFAULT_BASE_URL) as ProviderName[]

/** Shared with `turn.ts`, whose `TurnRunnerConfig.contextTokens` falls back to this same value when a caller (a test, mainly) omits it. */
export const DEFAULT_CONTEXT_TOKENS = 16_384

type Env = Record<string, string | undefined>

/**
 * A malformed UIDX_AGENT_CONTEXT_TOKENS must never reach `budgetFor` as NaN:
 * NaN propagates through every arithmetic step there, and a NaN char budget
 * silently turns `slice(0, NaN)` into `slice(0, 0)` — every read and pack
 * collapses to a zero-length string, with no error and nowhere to log it
 * (`console` is restricted to `server/main.ts`). `budgetFor` guards its own
 * input too (see `MIN_WINDOW_TOKENS`), but validating here means a bad env
 * var never even leaves `AgentConfig` looking wrong. A non-finite or
 * non-positive value falls back to the harness default; a value that parses
 * but is absurdly small is clamped up to `MIN_WINDOW_TOKENS` rather than
 * reset all the way to the default, so a deliberate small-but-sane override
 * still takes effect where one is possible.
 */
function parseContextTokens(raw: string | undefined): number {
  const parsed = Number(raw ?? DEFAULT_CONTEXT_TOKENS)
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_CONTEXT_TOKENS
  return Math.max(parsed, MIN_WINDOW_TOKENS)
}

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
  const roots = env.UIDX_AGENT_ROOTS?.split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  return {
    port: Number(
      env.UIDX_AGENT_PORT ?? new URL(env.UIDX_AGENT_URL ?? 'http://localhost:4500').port,
    ),
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
    contextTokens: parseContextTokens(env.UIDX_AGENT_CONTEXT_TOKENS),
    providerOptions: parseProviderOptions(env.UIDX_AGENT_PROVIDER_OPTIONS),
    vision: env.UIDX_AGENT_VISION === 'true',
  }
}

/**
 * Malformed JSON here is a typo in a `.env`, not a reason to refuse to start —
 * and a silently-empty value would be worse than a loud one, so the parse
 * failure is swallowed only after the shape is checked. An object of objects is
 * the only form the SDK accepts, so anything else is treated as absent.
 */
function parseProviderOptions(raw: string | undefined): AgentConfig['providerOptions'] {
  if (!raw) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
  for (const value of Object.values(parsed)) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  }
  return parsed as AgentConfig['providerOptions']
}
