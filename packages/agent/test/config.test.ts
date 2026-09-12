import { describe, expect, it } from 'vitest'

import { loadConfig, parseModelSpec } from '../src/config.js'
import { MIN_WINDOW_TOKENS } from '../src/index/budget.js'

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

  it('defaults the context window to a small local model, and reads an override', () => {
    expect(loadConfig({ UIDX_AGENT_MODEL: 'vllm:g' }, '/work').contextTokens).toBe(16_384)
    expect(
      loadConfig({ UIDX_AGENT_MODEL: 'vllm:g', UIDX_AGENT_CONTEXT_TOKENS: '32768' }, '/work')
        .contextTokens,
    ).toBe(32_768)
  })

  it('falls back to the default context window for a malformed value, instead of NaN', () => {
    const config = loadConfig(
      { UIDX_AGENT_MODEL: 'vllm:g', UIDX_AGENT_CONTEXT_TOKENS: 'not-a-number' },
      '/work',
    )
    expect(config.contextTokens).toBe(16_384)
    expect(Number.isNaN(config.contextTokens)).toBe(false)
  })

  it('falls back to the default context window for a non-positive value', () => {
    expect(
      loadConfig({ UIDX_AGENT_MODEL: 'vllm:g', UIDX_AGENT_CONTEXT_TOKENS: '0' }, '/work')
        .contextTokens,
    ).toBe(16_384)
    expect(
      loadConfig({ UIDX_AGENT_MODEL: 'vllm:g', UIDX_AGENT_CONTEXT_TOKENS: '-1' }, '/work')
        .contextTokens,
    ).toBe(16_384)
  })

  it('clamps an absurdly small context window up to the sane minimum', () => {
    expect(
      loadConfig({ UIDX_AGENT_MODEL: 'vllm:g', UIDX_AGENT_CONTEXT_TOKENS: '10' }, '/work')
        .contextTokens,
    ).toBe(MIN_WINDOW_TOKENS)
  })

  it("parses provider options, the only route to a local runtime's own switches", () => {
    const config = loadConfig(
      {
        UIDX_AGENT_MODEL: 'openai-compatible:qwen3.5',
        UIDX_AGENT_PROVIDER_OPTIONS: '{"openai-compatible":{"reasoningEffort":"none"}}',
      },
      '/work',
    )
    expect(config.providerOptions).toEqual({ 'openai-compatible': { reasoningEffort: 'none' } })
  })

  it('treats a malformed or wrongly-shaped value as absent rather than refusing to start', () => {
    for (const raw of ['{not json', '"a string"', '[{"a":1}]', '{"provider":"not an object"}']) {
      const config = loadConfig(
        { UIDX_AGENT_MODEL: 'vllm:g', UIDX_AGENT_PROVIDER_OPTIONS: raw },
        '/work',
      )
      expect(config.providerOptions, raw).toBeUndefined()
      expect(config.models.orchestrator.model).toBe('g')
    }
  })
})
