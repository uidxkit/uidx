import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModel } from 'ai'
import { createOllama } from 'ai-sdk-ollama'

import type { ModelSpec } from './config.js'

/** A provider-constructed model. This factory never returns the bare model-id string form of `LanguageModel`. */
export type ConcreteLanguageModel = Exclude<LanguageModel, string>

/**
 * Every local runtime we support speaks the OpenAI-compatible protocol, so one
 * branch covers vLLM, LM Studio and llama.cpp. Ollama gets its own provider
 * because its tool-call streaming is more reliable than its OpenAI shim.
 */
export function languageModelFor(spec: ModelSpec): ConcreteLanguageModel {
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
