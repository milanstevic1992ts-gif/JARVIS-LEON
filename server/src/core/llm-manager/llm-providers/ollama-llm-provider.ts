import AISDKRemoteLLMProvider from '@/core/llm-manager/llm-providers/ai-sdk-remote-llm-provider'
import type { ResolvedLLMTarget } from '@/core/llm-manager/llm-routing'
import { CONFIG_MANAGER } from '@/config'

/**
 * JARVIS local Ollama provider.
 *
 * Ollama exposes an OpenAI-compatible endpoint at /v1, including tool calls
 * for models that support them. No real API key is required.
 */
export default class OllamaLLMProvider extends AISDKRemoteLLMProvider {
  constructor(target: ResolvedLLMTarget) {
    super({
      name: 'JARVIS Ollama LLM Provider',
      providerName: 'ollama',
      apiKeyEnv: 'JARVIS_OLLAMA_API_KEY',
      model: target.model,
      baseURL:
        CONFIG_MANAGER.getProviderBaseURL('ollama') ||
        'http://127.0.0.1:11434/v1',
      flavor: 'openai-compatible',
      requiresApiKey: false
    })
  }
}
