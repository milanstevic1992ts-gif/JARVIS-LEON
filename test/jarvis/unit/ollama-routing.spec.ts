import { describe, expect, it } from 'vitest'

import { LLMProviders } from '@/core/llm-manager/types'
import { resolveConfiguredLLMTarget } from '@/core/llm-manager/llm-routing'
import { LOCAL_LLM_CONTEXT_WINDOW_TOKENS, isLocalLLMProvider } from '@/core/llm-manager/model-context-windows'
import { AGENT_MAX_PARALLEL_TOOL_CALLS } from '@/core/llm-manager/llm-duties/react-llm-duty/constants'
import { transformOllamaRequestBody } from '@/core/llm-manager/llm-providers/ollama-llm-provider'

const OPTIONS = {
  defaultInstalledLLMPath: '/models/default.gguf',
  llmDirPath: '/models'
}

describe('JARVIS Ollama routing', () => {
  it('keeps an Ollama model identifier instead of converting it into a file path', () => {
    const target = resolveConfiguredLLMTarget(
      'ollama/qwen3.5:4b',
      OPTIONS
    )

    expect(target.provider).toBe(LLMProviders.Ollama)
    expect(target.model).toBe('qwen3.5:4b')
    expect(target.isLocal).toBe(true)
    expect(target.isResolved).toBe(true)
    expect(target.label).toBe('ollama/qwen3.5:4b')
  })

  it('uses conservative local-resource defaults for Ollama', () => {
    expect(isLocalLLMProvider(LLMProviders.Ollama)).toBe(true)
    expect(LOCAL_LLM_CONTEXT_WINDOW_TOKENS).toBe(8_192)
    expect(AGENT_MAX_PARALLEL_TOOL_CALLS).toBe(2)
  })

  it('disables thinking for Qwen3.5 Ollama requests', () => {
    expect(
      transformOllamaRequestBody('qwen3.5:4b', {
        model: 'qwen3.5:4b',
        messages: []
      })
    ).toMatchObject({
      model: 'qwen3.5:4b',
      think: false
    })
  })

  it('does not inject think=false into unrelated Ollama models', () => {
    const body = {
      model: 'llama3.2:3b',
      messages: []
    }

    expect(transformOllamaRequestBody('llama3.2:3b', body)).toBe(body)
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
