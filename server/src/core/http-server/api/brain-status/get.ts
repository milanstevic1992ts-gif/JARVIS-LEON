import os from 'node:os'

import type { FastifyPluginAsync } from 'fastify'

import type { APIOptions } from '@/core/http-server/http-server'
import { CONFIG_MANAGER } from '@/config'
import { CONFIG_STATE } from '@/core/config-states/config-state'
import { CONVERSATION_LOGGER } from '@/core'
import {
  getActiveLLMTarget,
  getRoutingModeLLMDisplay
} from '@/core/llm-manager/llm-routing'
import { getJarvisPolicyManager } from '@/core/jarvis-policy/jarvis-policy-manager'
import { SystemHelper } from '@/helpers/system-helper'
import { LogHelper } from '@/helpers/log-helper'

const GIB = 1_024 * 1_024 * 1_024
const OLLAMA_URL = 'http://127.0.0.1:11434'
const REQUEST_TIMEOUT_MS = 1_200
const HARDWARE_CACHE_TTL_MS = 10_000
const SERVICES_CACHE_TTL_MS = 5_000

let hardwareCache:
  | { expiresAt: number, data: Record<string, unknown> }
  | null = null
let servicesCache:
  | {
      expiresAt: number
      ollama: Record<string, unknown>
      ge360: Record<string, unknown>
    }
  | null = null

interface FetchJSONResult {
  ok: boolean
  status?: number
  data?: Record<string, unknown>
  error?: string
}

async function fetchJSON(url: string): Promise<FetchJSONResult> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal
    })
    const text = await response.text()
    let data: Record<string, unknown> | undefined

    try {
      const parsed = text ? JSON.parse(text) : null
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        data = parsed as Record<string, unknown>
      }
    } catch {
      data = undefined
    }

    return {
      ok: response.ok,
      status: response.status,
      ...(data ? { data } : {})
    }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    }
  } finally {
    clearTimeout(timeout)
  }
}

async function getOllamaStatus(): Promise<Record<string, unknown>> {
  const [version, ps, tags] = await Promise.all([
    fetchJSON(`${OLLAMA_URL}/api/version`),
    fetchJSON(`${OLLAMA_URL}/api/ps`),
    fetchJSON(`${OLLAMA_URL}/api/tags`)
  ])

  const models = Array.isArray(ps.data?.['models'])
    ? (ps.data?.['models'] as Array<Record<string, unknown>>)
    : []

  const installedModels = Array.isArray(tags.data?.['models'])
    ? (tags.data?.['models'] as Array<Record<string, unknown>>)
        .map((model) =>
          typeof model['name'] === 'string'
            ? model['name']
            : typeof model['model'] === 'string'
              ? model['model']
              : ''
        )
        .filter(Boolean)
    : []

  return {
    online: version.ok,
    version:
      typeof version.data?.['version'] === 'string'
        ? version.data['version']
        : null,
    installed_models: installedModels,
    loaded_models: models.map((model) => ({
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
          : null,
      expires_at:
        typeof model['expires_at'] === 'string'
          ? model['expires_at']
          : null
    }))
  }
}

async function probeGE360Candidate(
  baseURL: string
): Promise<Record<string, unknown> | null> {
  const openAPI = await fetchJSON(`${baseURL}/openapi.json`)
  if (openAPI.ok) {
    const info =
      openAPI.data?.['info'] &&
      typeof openAPI.data['info'] === 'object' &&
      !Array.isArray(openAPI.data['info'])
        ? (openAPI.data['info'] as Record<string, unknown>)
        : {}

    return {
      online: true,
      base_url: baseURL,
      title: typeof info['title'] === 'string' ? info['title'] : null,
      openapi: true
    }
  }

  const healthPaths = ['/health', '/api/health', '/healthz']
  const healthResults = await Promise.all(
    healthPaths.map((path) => fetchJSON(`${baseURL}${path}`))
  )
  const healthIndex = healthResults.findIndex((result) => result.ok)

  if (healthIndex >= 0) {
    return {
      online: true,
      base_url: baseURL,
      health_path: healthPaths[healthIndex],
      openapi: false
    }
  }

  return null
}

async function getGE360Status(): Promise<Record<string, unknown>> {
  const candidates = [
    process.env['GE360_BASE_URL'] || '',
    'http://127.0.0.1:8000',
    'http://127.0.0.1:8788',
    'http://127.0.0.1:8787',
    'http://127.0.0.1:3000'
  ]
    .map((value) => value.trim().replace(/\/+$/, ''))
    .filter(Boolean)

  const uniqueCandidates = [...new Set(candidates)]
  const results = await Promise.all(
    uniqueCandidates.map((baseURL) => probeGE360Candidate(baseURL))
  )
  const firstOnline = results.find(Boolean)

  return (
    firstOnline || {
      online: false,
      base_url: process.env['GE360_BASE_URL'] || null
    }
  )
}

async function getHardwareStatus(): Promise<Record<string, unknown>> {
  const now = Date.now()
  if (hardwareCache && hardwareCache.expiresAt > now) {
    return hardwareCache.data
  }

  const [
    gpuDeviceNames,
    graphicsComputeAPI,
    totalVRAM,
    freeVRAM,
    usedVRAM
  ] = await Promise.all([
    SystemHelper.getGPUDeviceNames(),
    SystemHelper.getGraphicsComputeAPI(),
    SystemHelper.getTotalVRAM(),
    SystemHelper.getFreeVRAM(),
    SystemHelper.getUsedVRAM()
  ])

  const data = {
    name: gpuDeviceNames[0] || null,
    compute_api: graphicsComputeAPI,
    total_vram_gb: totalVRAM,
    used_vram_gb: usedVRAM,
    free_vram_gb: freeVRAM,
    used_percent:
      totalVRAM > 0
        ? Number(((usedVRAM / totalVRAM) * 100).toFixed(1))
        : 0
  }

  hardwareCache = {
    expiresAt: now + HARDWARE_CACHE_TTL_MS,
    data
  }

  return data
}

async function getServiceStatus(): Promise<{
  ollama: Record<string, unknown>
  ge360: Record<string, unknown>
}> {
  const now = Date.now()
  if (servicesCache && servicesCache.expiresAt > now) {
    return {
      ollama: servicesCache.ollama,
      ge360: servicesCache.ge360
    }
  }

  const [ollama, ge360] = await Promise.all([
    getOllamaStatus(),
    getGE360Status()
  ])

  servicesCache = {
    expiresAt: now + SERVICES_CACHE_TTL_MS,
    ollama,
    ge360
  }

  return { ollama, ge360 }
}

function getCpuSnapshot(): Record<string, unknown> {
  const cpus = os.cpus()
  const load = os.loadavg()
  const coreCount = Math.max(cpus.length, 1)
  const estimatedLoadPercent = Math.min(
    Math.max((load[0] / coreCount) * 100, 0),
    100
  )

  return {
    model: cpus[0]?.model || 'unknown',
    cores: coreCount,
    load_1m: Number(load[0].toFixed(2)),
    load_5m: Number(load[1].toFixed(2)),
    load_15m: Number(load[2].toFixed(2)),
    estimated_load_percent: Number(estimatedLoadPercent.toFixed(1))
  }
}

function getMemorySnapshot(): Record<string, unknown> {
  const total = os.totalmem()
  const free = os.freemem()
  const used = Math.max(total - free, 0)
  const processMemory = process.memoryUsage()

  return {
    total_gb: Number((total / GIB).toFixed(2)),
    used_gb: Number((used / GIB).toFixed(2)),
    free_gb: Number((free / GIB).toFixed(2)),
    used_percent:
      total > 0 ? Number(((used / total) * 100).toFixed(1)) : 0,
    process_rss_mb: Number(
      (processMemory.rss / (1_024 * 1_024)).toFixed(1)
    ),
    process_heap_mb: Number(
      (processMemory.heapUsed / (1_024 * 1_024)).toFixed(1)
    )
  }
}

async function getLatestAgentTrace(): Promise<Record<string, unknown> | null> {
  try {
    const logs = await CONVERSATION_LOGGER.load({ nbOfLogsToLoad: 20 })
    const latest = [...logs]
      .reverse()
      .find((entry) => Boolean(entry.agentResponseTrace))

    if (!latest?.agentResponseTrace) {
      return null
    }

    const trace = latest.agentResponseTrace

    return {
      sent_at: latest.sentAt,
      reasoning_summary: trace.reasoningSummary || '',
      plan_steps: trace.planSteps,
      tool_calls: trace.toolCalls.map((toolCall) => ({
        id: toolCall.id,
        name: toolCall.name,
        status: toolCall.status,
        step_label: toolCall.stepLabel || null,
        error_message: toolCall.errorMessage || null
      })),
      metrics: trace.metrics || latest.llmMetrics || null
    }
  } catch {
    return null
  }
}

export const getBrainStatus: FastifyPluginAsync<APIOptions> = async (
  fastify,
  options
) => {
  fastify.route({
    method: 'GET',
    url: `/api/${options.apiVersion}/brain-status`,
    handler: async (_request, reply) => {
      const profileConfig = CONFIG_MANAGER.getConfig()
      const modelState = CONFIG_STATE.getModelState()
      const routingMode = CONFIG_STATE.getRoutingModeState().getRoutingMode()
      const workflowTarget = modelState.getWorkflowTarget()
      const agentTarget = modelState.getAgentTarget()
      const activeLLMTarget = getActiveLLMTarget(
        routingMode,
        workflowTarget,
        agentTarget
      )
      const llmDisplay = getRoutingModeLLMDisplay(
        routingMode,
        workflowTarget,
        agentTarget
      )
      const policy = getJarvisPolicyManager()

      const [gpu, services, latestTrace] = await Promise.all([
        getHardwareStatus(),
        getServiceStatus(),
        getLatestAgentTrace()
      ])

      LogHelper.title('GET /brain-status')
      LogHelper.success('JARVIS brain status fetched.')

      const configuredModel = modelState.getAgentModelName()
      const performanceMode =
        configuredModel === 'qwen3.5:9b'
          ? 'boost'
          : profileConfig.runtime.agent_max_iterations <= 32
            ? 'eco'
            : 'normal'

      return reply.send({
        success: true,
        status: 200,
        code: 'jarvis_brain_status',
        generated_at: Date.now(),
        runtime: {
          uptime_seconds: Math.floor(process.uptime()),
          routing_mode: routingMode,
          low_resource: process.env['JARVIS_LOW_RESOURCE'] === '1',
          local_context_tokens: Number.parseInt(
            process.env['JARVIS_LOCAL_CONTEXT_WINDOW_TOKENS'] || '8192',
            10
          ),
          max_parallel_tools: Number.parseInt(
            process.env['JARVIS_AGENT_MAX_PARALLEL_TOOL_CALLS'] || '2',
            10
          ),
          pulse_enabled: profileConfig.runtime.pulse_enabled,
          private_diary_enabled:
            profileConfig.runtime.private_diary_enabled,
          agent_max_iterations:
            profileConfig.runtime.agent_max_iterations || null,
          performance_mode: performanceMode
        },
        llm: {
          heading: llmDisplay.heading,
          display: llmDisplay.value,
          provider: activeLLMTarget.provider,
          model: activeLLMTarget.model,
          workflow: workflowTarget.label,
          agent: agentTarget.label
        },
        cpu: getCpuSnapshot(),
        memory: getMemorySnapshot(),
        gpu,
        ollama: services.ollama,
        ge360: services.ge360,
        safety: {
          policy: policy.getPolicySummary(),
          pending: policy.listPending().slice(0, 12),
          audit: policy.listRecentAudit(16)
        },
        activity: latestTrace,
        controls: {
          restart_jarvis: true,
          restart_ollama:
            process.env['JARVIS_ALLOW_SYSTEM_SERVICE_CONTROL'] === '1',
          supported_modes: ['eco', 'normal', 'boost'],
          supported_models: ['qwen3.5:4b', 'qwen3.5:9b']
        }
      })
    }
  })
}
