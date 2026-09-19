import { LLMProviders } from '@/core/llm-manager/types'

function readContextWindowTokens(): number {
  const raw = process.env['JARVIS_LOCAL_CONTEXT_WINDOW_TOKENS']?.trim()
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN

  if (Number.isFinite(parsed) && parsed >= 2_048 && parsed <= 65_536) {
    return parsed
  }

  // GE360 JARVIS targets modest local hardware by default.
  // 8K keeps enough working context for tools without wasting VRAM/RAM.
  return 8_192
}

export const LOCAL_LLM_CONTEXT_WINDOW_TOKENS = readContextWindowTokens()

/**
 * Returns whether JARVIS runs the provider through a local inference server.
 */
export function isLocalLLMProvider(provider: LLMProviders): boolean {
  return (
    provider === LLMProviders.LlamaCPP ||
    provider === LLMProviders.SGLang ||
    provider === LLMProviders.Ollama
  )
}
