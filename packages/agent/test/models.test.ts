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
