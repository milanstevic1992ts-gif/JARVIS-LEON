import { describe, expect, it } from 'vitest'

import { LLMProviders } from '@/core/llm-manager/types'
import { resolveConfiguredLLMTarget } from '@/core/llm-manager/llm-routing'

const OPTIONS = {
  defaultInstalledLLMPath: '/models/default.gguf',
  llmDirPath: '/models'
}

describe('JARVIS Ollama routing', () => {
  it('keeps an Ollama model identifier instead of converting it into a file path', () => {
    const target = resolveConfiguredLLMTarget(
      'ollama/qwen3.5:9b',
      OPTIONS
    )

    expect(target.provider).toBe(LLMProviders.Ollama)
    expect(target.model).toBe('qwen3.5:9b')
    expect(target.isLocal).toBe(true)
    expect(target.isResolved).toBe(true)
    expect(target.label).toBe('ollama/qwen3.5:9b')
  })

  it('requires an explicit model name for Ollama', () => {
    expect(() =>
      resolveConfiguredLLMTarget('ollama', OPTIONS)
    ).toThrow('missing its model identifier')
  })

  it('still resolves llama.cpp model names as local file paths', () => {
    const target = resolveConfiguredLLMTarget(
      'llamacpp/model.gguf',
      OPTIONS
    )

    expect(target.provider).toBe(LLMProviders.LlamaCPP)
    expect(target.model).toBe('/models/model.gguf')
    expect(target.isLocal).toBe(true)
  })
})
