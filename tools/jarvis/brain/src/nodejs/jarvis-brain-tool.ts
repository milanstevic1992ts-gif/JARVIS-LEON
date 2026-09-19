import os from 'node:os'

import { Tool } from '@sdk/base-tool'
import { ToolkitConfig } from '@sdk/toolkit-config'

import { CONFIG_MANAGER } from '@/config'
import { CONFIG_STATE } from '@/core/config-states/config-state'
import {
  getJarvisPolicyManager,
  type JarvisActionDescriptor,
  type JarvisRiskLevel
} from '@/core/jarvis-policy/jarvis-policy-manager'
import { SystemHelper } from '@/helpers/system-helper'

const TOOLKIT_ID = 'jarvis'
const TOOL_ID = 'brain'
const OLLAMA_URL = 'http://127.0.0.1:11434'
const REQUEST_TIMEOUT_MS = 180_000
const GIB = 1_024 * 1_024 * 1_024

type SupportedModel = 'qwen3.5:4b' | 'qwen3.5:9b'
type PerformanceMode = 'eco' | 'normal' | 'boost'

interface OllamaGenerateResponse {
  response?: string
  total_duration?: number
  load_duration?: number
  prompt_eval_count?: number
  prompt_eval_duration?: number
  eval_count?: number
  eval_duration?: number
}

interface OwnerActionRequired {
  success: false
  status: 'owner_action_required'
  error: string
  owner_action: {
    message: string
  }
  policy: {
    risk: JarvisRiskLevel
    approval_id: string
    expires_at: string
  }
}

export default class JarvisBrainTool extends Tool {
  private readonly config: ReturnType<typeof ToolkitConfig.load>

  constructor() {
    super()
    this.config = ToolkitConfig.load(TOOLKIT_ID, this.toolName)
    this.settings = ToolkitConfig.loadToolSettings(
      TOOLKIT_ID,
      this.toolName,
      {}
    )
    this.requiredSettings = []
    this.checkRequiredSettings(this.toolName)
  }

  get toolName(): string {
    return TOOL_ID
  }

  get toolkit(): string {
    return TOOLKIT_ID
  }

  get description(): string {
    return this.config['description']
  }

  async getStatus(): Promise<Record<string, unknown>> {
    const [
      installedModels,
      loadedModels,
      gpuDeviceNames,
      graphicsComputeAPI,
      totalVRAM,
      freeVRAM,
      usedVRAM
    ] = await Promise.all([
      this.listInstalledModels(),
      this.listLoadedModels(),
      SystemHelper.getGPUDeviceNames(),
      SystemHelper.getGraphicsComputeAPI(),
      SystemHelper.getTotalVRAM(),
      SystemHelper.getFreeVRAM(),
      SystemHelper.getUsedVRAM()
    ])

    const totalMemory = os.totalmem()
    const freeMemory = os.freemem()
    const usedMemory = Math.max(totalMemory - freeMemory, 0)
    const modelState = CONFIG_STATE.getModelState()
    const profileConfig = CONFIG_MANAGER.getConfig()
    const configuredModel = modelState.getAgentModelName()

    return {
      success: true,
      model: configuredModel,
      performance_mode:
        configuredModel === 'qwen3.5:9b'
          ? 'boost'
          : profileConfig.runtime.agent_max_iterations <= 32
            ? 'eco'
            : 'normal',
      agent_max_iterations:
        profileConfig.runtime.agent_max_iterations || null,
      low_resource:
        process.env['JARVIS_LOW_RESOURCE'] === '1',
      context_tokens: Number.parseInt(
        process.env['JARVIS_LOCAL_CONTEXT_WINDOW_TOKENS'] || '8192',
        10
      ),
      memory: {
        total_gb: Number((totalMemory / GIB).toFixed(2)),
        used_gb: Number((usedMemory / GIB).toFixed(2)),
        free_gb: Number((freeMemory / GIB).toFixed(2)),
        used_percent:
          totalMemory > 0
            ? Number(((usedMemory / totalMemory) * 100).toFixed(1))
            : 0
      },
      gpu: {
        name: gpuDeviceNames[0] || null,
        compute_api: graphicsComputeAPI,
        total_vram_gb: totalVRAM,
        used_vram_gb: usedVRAM,
        free_vram_gb: freeVRAM,
        used_percent:
          totalVRAM > 0
            ? Number(((usedVRAM / totalVRAM) * 100).toFixed(1))
            : 0
      },
      ollama: {
        installed_models: installedModels,
        loaded_models: loadedModels
      }
    }
  }

  async benchmark(
    model?: SupportedModel
  ): Promise<Record<string, unknown>> {
    const target = model || this.getConfiguredModel()

    if (!(await this.isModelInstalled(target))) {
      return this.modelMissing(target)
    }

    const result = await this.postOllama('/api/generate', {
      model: target,
      prompt:
        'Rispondi in italiano con una frase breve: sistema operativo pronto.',
      stream: false,
      think: false,
      keep_alive: '2m',
      options: {
        num_ctx: 8_192,
        temperature: 0.2,
        num_predict: 80
      }
    })

    if (!result.ok || !result.data) {
      return {
        success: false,
        error: result.error || 'Benchmark Ollama fallito.'
      }
    }

    return {
      success: true,
      model: target,
      response: result.data.response?.trim() || '',
      total_seconds: this.nsToSeconds(result.data.total_duration),
      load_seconds: this.nsToSeconds(result.data.load_duration),
      prompt_tokens: result.data.prompt_eval_count || 0,
      prompt_tokens_per_second: this.tokensPerSecond(
        result.data.prompt_eval_count,
        result.data.prompt_eval_duration
      ),
      output_tokens: result.data.eval_count || 0,
      output_tokens_per_second: this.tokensPerSecond(
        result.data.eval_count,
        result.data.eval_duration
      )
    }
  }

  async setMode(
    mode: PerformanceMode
  ): Promise<Record<string, unknown> | OwnerActionRequired> {
    const profiles = {
      eco: { model: 'qwen3.5:4b', iterations: 32 },
      normal: { model: 'qwen3.5:4b', iterations: 64 },
      boost: { model: 'qwen3.5:9b', iterations: 96 }
    } as const

    const selected = profiles[mode]

    if (!(await this.isModelInstalled(selected.model))) {
      return this.modelMissing(selected.model)
    }

    const action = this.createAction(
      'setMode',
      { mode },
      'Switch JARVIS performance mode to ' + mode
    )
    const approval = this.requireApproval(action, 'yellow')
    if (approval) {
      return approval
    }

    await CONFIG_STATE
      .getModelState()
      .setUnifiedTarget('ollama/' + selected.model)
    await CONFIG_MANAGER.setValue(
      ['runtime', 'agent_max_iterations'],
      selected.iterations
    )
    await CONFIG_MANAGER.setValue(['runtime', 'pulse_enabled'], false)
    await CONFIG_MANAGER.setValue(
      ['runtime', 'private_diary_enabled'],
      false
    )

    getJarvisPolicyManager().recordExecution(
      action,
      'yellow',
      true,
      {
        mode,
        model: selected.model
      }
    )

    return {
      success: true,
      mode,
      model: selected.model,
      agent_max_iterations: selected.iterations
    }
  }

  async setModel(
    model: SupportedModel
  ): Promise<Record<string, unknown> | OwnerActionRequired> {
    if (!(await this.isModelInstalled(model))) {
      return this.modelMissing(model)
    }

    const action = this.createAction(
      'setModel',
      { model },
      'Switch JARVIS model to ' + model
    )
    const approval = this.requireApproval(action, 'yellow')
    if (approval) {
      return approval
    }

    await CONFIG_STATE
      .getModelState()
      .setUnifiedTarget('ollama/' + model)

    getJarvisPolicyManager().recordExecution(
      action,
      'yellow',
      true,
      { model }
    )

    return {
      success: true,
      model
    }
  }

  async unloadModel(
    model?: SupportedModel
  ): Promise<Record<string, unknown> | OwnerActionRequired> {
    const target = model || this.getConfiguredModel()
    const action = this.createAction(
      'unloadModel',
      { model: target },
      'Unload Ollama model ' + target
    )
    const approval = this.requireApproval(action, 'yellow')
    if (approval) {
      return approval
    }

    const result = await this.postOllama('/api/generate', {
      model: target,
      keep_alive: 0,
      stream: false
    })

    getJarvisPolicyManager().recordExecution(
      action,
      'yellow',
      result.ok,
      {
        model: target,
        http_status: result.status
      }
    )

    return result.ok
      ? {
          success: true,
          model: target,
          unloaded: true
        }
      : {
          success: false,
          model: target,
          error: result.error || 'Impossibile scaricare il modello.'
        }
  }

  private createAction(
    functionName: string,
    params: Record<string, unknown>,
    description: string
  ): JarvisActionDescriptor {
    return {
      toolkitId: TOOLKIT_ID,
      toolId: TOOL_ID,
      functionName,
      method: 'POST',
      path: '/jarvis/brain/' + functionName,
      params,
      description
    }
  }

  private requireApproval(
    action: JarvisActionDescriptor,
    risk: JarvisRiskLevel
  ): OwnerActionRequired | null {
    const policy = getJarvisPolicyManager()
    const approved = policy.consumeApproved(action)

    if (approved) {
      policy.recordAllowed(action, risk)
      return null
    }

    const approval = policy.requestApproval(action, risk)

    return {
      success: false,
      status: 'owner_action_required',
      error:
        'JARVIS ' +
        risk.toUpperCase() +
        ' policy requires owner approval.',
      owner_action: {
        message:
          'Per autorizzare una sola volta usa /jarvis approve ' +
          approval.id +
          ', poi ripeti la richiesta originale. Per annullare usa /jarvis deny ' +
          approval.id +
          '.'
      },
      policy: {
        risk,
        approval_id: approval.id,
        expires_at: new Date(approval.expiresAt).toISOString()
      }
    }
  }

  private async listInstalledModels(): Promise<string[]> {
    const result = await this.fetchOllama('/api/tags')
    const models =
      result.data &&
      Array.isArray(result.data['models'])
        ? (result.data['models'] as Array<Record<string, unknown>>)
        : []

    return models
      .map((item) =>
        typeof item['name'] === 'string'
          ? item['name']
          : typeof item['model'] === 'string'
            ? item['model']
            : ''
      )
      .filter(Boolean)
  }

  private async listLoadedModels(): Promise<Array<Record<string, unknown>>> {
    const result = await this.fetchOllama('/api/ps')
    const models =
      result.data &&
      Array.isArray(result.data['models'])
        ? (result.data['models'] as Array<Record<string, unknown>>)
        : []

    return models.map((model) => ({
      name:
        typeof model['name'] === 'string'
          ? model['name']
          : typeof model['model'] === 'string'
            ? model['model']
            : 'unknown',
      size_gb:
        typeof model['size'] === 'number'
          ? Number((model['size'] / GIB).toFixed(2))
          : null,
      vram_gb:
        typeof model['size_vram'] === 'number'
          ? Number((model['size_vram'] / GIB).toFixed(2))
          : null,
      context_length:
        typeof model['context_length'] === 'number'
          ? model['context_length']
          : null
    }))
  }

  private async isModelInstalled(
    model: SupportedModel
  ): Promise<boolean> {
    const models = await this.listInstalledModels()

    return models.some(
      (name) =>
        name === model ||
        name.startsWith(model + '-')
    )
  }

  private modelMissing(model: SupportedModel): Record<string, unknown> {
    return {
      success: false,
      model,
      error:
        'Il modello non è installato. Esegui: ollama pull ' + model
    }
  }

  private getConfiguredModel(): SupportedModel {
    return CONFIG_STATE.getModelState().getAgentModelName() === 'qwen3.5:9b'
      ? 'qwen3.5:9b'
      : 'qwen3.5:4b'
  }

  private async fetchOllama(
    path: string
  ): Promise<{
    ok: boolean
    status: number
    data?: Record<string, unknown>
    error?: string
  }> {
    const controller = new AbortController()
    const timeout = setTimeout(
      () => controller.abort(),
      3_000
    )

    try {
      const response = await fetch(OLLAMA_URL + path, {
        headers: { Accept: 'application/json' },
        signal: controller.signal
      })
      const data = await response.json() as Record<string, unknown>

      return {
        ok: response.ok,
        status: response.status,
        data
      }
    } catch (error) {
      return {
        ok: false,
        status: 0,
        error:
          error instanceof Error
            ? error.message
            : String(error)
      }
    } finally {
      clearTimeout(timeout)
    }
  }

  private async postOllama(
    path: string,
    body: Record<string, unknown>
  ): Promise<{
    ok: boolean
    status: number
    data?: OllamaGenerateResponse
    error?: string
  }> {
    const controller = new AbortController()
    const timeout = setTimeout(
      () => controller.abort(),
      REQUEST_TIMEOUT_MS
    )

    try {
      const response = await fetch(OLLAMA_URL + path, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body),
        signal: controller.signal
      })
      const text = await response.text()
      let data: OllamaGenerateResponse | undefined

      try {
        data = text
          ? JSON.parse(text) as OllamaGenerateResponse
          : undefined
      } catch {
        data = undefined
      }

      return response.ok
        ? {
            ok: true,
            status: response.status,
            ...(data ? { data } : {})
          }
        : {
            ok: false,
            status: response.status,
            error: 'Ollama HTTP ' + response.status
          }
    } catch (error) {
      return {
        ok: false,
        status: 0,
        error:
          error instanceof Error
            ? error.message
            : String(error)
      }
    } finally {
      clearTimeout(timeout)
    }
  }

  private nsToSeconds(value?: number): number {
    return Number(((value || 0) / 1_000_000_000).toFixed(3))
  }

  private tokensPerSecond(
    count?: number,
    duration?: number
  ): number {
    const seconds = (duration || 0) / 1_000_000_000

    return seconds > 0
      ? Number(((count || 0) / seconds).toFixed(2))
      : 0
  }
}
