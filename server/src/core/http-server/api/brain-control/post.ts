import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import type { FastifyPluginAsync, FastifySchema } from 'fastify'
import { Type } from '@sinclair/typebox'
import type { Static } from '@sinclair/typebox'

import type { APIOptions } from '@/core/http-server/http-server'
import { CONFIG_MANAGER } from '@/config'
import { CONFIG_STATE } from '@/core/config-states/config-state'
import {
  getJarvisPolicyManager,
  type JarvisActionDescriptor,
  type JarvisRiskLevel
} from '@/core/jarvis-policy/jarvis-policy-manager'
import {
  LEON_RESTART_EXIT_CODE,
  requestShutdown
} from '@/core/server-lifecycle'
import { LogHelper } from '@/helpers/log-helper'

const execFileAsync = promisify(execFile)
const OLLAMA_URL = 'http://127.0.0.1:11434'
const REQUEST_TIMEOUT_MS = 180000

const controlSchema = {
  body: Type.Object({
    action: Type.Union([
      Type.Literal('set-mode'),
      Type.Literal('set-model'),
      Type.Literal('unload-model'),
      Type.Literal('benchmark'),
      Type.Literal('restart-jarvis'),
      Type.Literal('restart-ollama'),
      Type.Literal('approve'),
      Type.Literal('deny')
    ]),
    mode: Type.Optional(Type.Union([
      Type.Literal('eco'),
      Type.Literal('normal'),
      Type.Literal('boost')
    ])),
    model: Type.Optional(Type.Union([
      Type.Literal('qwen3.5:4b'),
      Type.Literal('qwen3.5:9b')
    ])),
    approval_id: Type.Optional(Type.String({ minLength: 1 }))
  })
} satisfies FastifySchema

type ControlBody = Static<typeof controlSchema.body>

interface OllamaResponse {
  response?: string
  total_duration?: number
  load_duration?: number
  prompt_eval_count?: number
  prompt_eval_duration?: number
  eval_count?: number
  eval_duration?: number
}

async function postOllama(
  path: string,
  body: Record<string, unknown>
): Promise<{ ok: boolean, status: number, data?: OllamaResponse, error?: string }> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

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
    let data: OllamaResponse | undefined

    try {
      data = text ? JSON.parse(text) as OllamaResponse : undefined
    } catch {
      data = undefined
    }

    return response.ok
      ? { ok: true, status: response.status, ...(data ? { data } : {}) }
      : {
          ok: false,
          status: response.status,
          error: 'Ollama HTTP ' + response.status
        }
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: error instanceof Error ? error.message : String(error)
    }
  } finally {
    clearTimeout(timeout)
  }
}

async function listInstalledModels(): Promise<string[]> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 3000)

  try {
    const response = await fetch(OLLAMA_URL + '/api/tags', {
      headers: { Accept: 'application/json' },
      signal: controller.signal
    })

    if (!response.ok) return []

    const data = await response.json() as {
      models?: Array<{ name?: string, model?: string }>
    }

    return (data.models || [])
      .map((item) => item.name || item.model || '')
      .filter(Boolean)
  } catch {
    return []
  } finally {
    clearTimeout(timeout)
  }
}

function createDescriptor(body: ControlBody): JarvisActionDescriptor {
  return {
    toolkitId: 'jarvis',
    toolId: 'brain-control',
    functionName: body.action,
    method: 'POST',
    path: '/api/v1/brain-control/' + body.action,
    params: {
      mode: body.mode || null,
      model: body.model || null
    },
    description: 'JARVIS Brain control: ' + body.action
  }
}

function getRisk(action: ControlBody['action']): JarvisRiskLevel {
  if (action === 'restart-jarvis' || action === 'restart-ollama') return 'red'
  if (action === 'set-mode' || action === 'set-model' || action === 'unload-model') return 'yellow'
  return 'green'
}

function approvalRequired(
  action: JarvisActionDescriptor,
  risk: JarvisRiskLevel
): Record<string, unknown> {
  const approval = getJarvisPolicyManager().requestApproval(action, risk)

  return {
    success: false,
    status: 'owner_action_required',
    code: 'jarvis_brain_control_approval_required',
    message: 'Azione ' + risk.toUpperCase() + ' in attesa di conferma.',
    approval: {
      id: approval.id,
      risk,
      expires_at: new Date(approval.expiresAt).toISOString()
    }
  }
}

function nsToSeconds(value?: number): number {
  return Number(((value || 0) / 1000000000).toFixed(3))
}

function speed(count?: number, duration?: number): number {
  const seconds = (duration || 0) / 1000000000
  return seconds > 0 ? Number(((count || 0) / seconds).toFixed(2)) : 0
}

async function ensureInstalled(model: string): Promise<boolean> {
  const installed = await listInstalledModels()
  return installed.some((name) => name === model || name.startsWith(model + '-'))
}

async function applyMode(mode: 'eco' | 'normal' | 'boost'): Promise<Record<string, unknown>> {
  const profiles = {
    eco: { model: 'qwen3.5:4b', iterations: 32 },
    normal: { model: 'qwen3.5:4b', iterations: 64 },
    boost: { model: 'qwen3.5:9b', iterations: 96 }
  } as const

  const selected = profiles[mode]

  if (!(await ensureInstalled(selected.model))) {
    return {
      success: false,
      code: 'jarvis_model_not_installed',
      message: 'Il modello ' + selected.model + ' non è installato. Esegui: ollama pull ' + selected.model
    }
  }

  await CONFIG_STATE.getModelState().setUnifiedTarget('ollama/' + selected.model)
  await CONFIG_MANAGER.setValue(['runtime', 'agent_max_iterations'], selected.iterations)
  await CONFIG_MANAGER.setValue(['runtime', 'pulse_enabled'], false)
  await CONFIG_MANAGER.setValue(['runtime', 'private_diary_enabled'], false)

  return {
    success: true,
    code: 'jarvis_performance_mode_updated',
    mode,
    model: selected.model,
    agent_max_iterations: selected.iterations
  }
}

async function applyModel(model: 'qwen3.5:4b' | 'qwen3.5:9b'): Promise<Record<string, unknown>> {
  if (!(await ensureInstalled(model))) {
    return {
      success: false,
      code: 'jarvis_model_not_installed',
      message: 'Il modello ' + model + ' non è installato. Esegui: ollama pull ' + model
    }
  }

  await CONFIG_STATE.getModelState().setUnifiedTarget('ollama/' + model)

  return {
    success: true,
    code: 'jarvis_model_updated',
    model
  }
}

async function unloadModel(model?: 'qwen3.5:4b' | 'qwen3.5:9b'): Promise<Record<string, unknown>> {
  const configured = CONFIG_STATE.getModelState().getAgentModelName()
  const target = model || (configured === 'qwen3.5:9b' ? 'qwen3.5:9b' : 'qwen3.5:4b')
  const result = await postOllama('/api/generate', {
    model: target,
    keep_alive: 0,
    stream: false
  })

  return result.ok
    ? { success: true, code: 'jarvis_model_unloaded', model: target }
    : { success: false, code: 'jarvis_model_unload_failed', message: result.error || 'Unload fallito.' }
}

async function benchmark(model?: 'qwen3.5:4b' | 'qwen3.5:9b'): Promise<Record<string, unknown>> {
  const configured = CONFIG_STATE.getModelState().getAgentModelName()
  const target = model || (configured === 'qwen3.5:9b' ? 'qwen3.5:9b' : 'qwen3.5:4b')
  const result = await postOllama('/api/generate', {
    model: target,
    prompt: 'Rispondi in italiano con una frase breve: sistema operativo pronto.',
    stream: false,
    think: false,
    keep_alive: '2m',
    options: {
      num_ctx: 8192,
      temperature: 0.2,
      num_predict: 80
    }
  })

  if (!result.ok || !result.data) {
    return {
      success: false,
      code: 'jarvis_benchmark_failed',
      message: result.error || 'Benchmark fallito.'
    }
  }

  return {
    success: true,
    code: 'jarvis_benchmark_completed',
    benchmark: {
      model: target,
      response: result.data.response?.trim() || '',
      total_seconds: nsToSeconds(result.data.total_duration),
      load_seconds: nsToSeconds(result.data.load_duration),
      prompt_tokens: result.data.prompt_eval_count || 0,
      prompt_tokens_per_second: speed(result.data.prompt_eval_count, result.data.prompt_eval_duration),
      output_tokens: result.data.eval_count || 0,
      output_tokens_per_second: speed(result.data.eval_count, result.data.eval_duration)
    }
  }
}

export const postBrainControl: FastifyPluginAsync<APIOptions> = async (
  fastify,
  options
) => {
  fastify.route<{ Body: ControlBody }>({
    method: 'POST',
    url: '/api/' + options.apiVersion + '/brain-control',
    schema: controlSchema,
    handler: async (request, reply) => {
      const body = request.body
      const policy = getJarvisPolicyManager()

      if (body.action === 'approve' || body.action === 'deny') {
        const id = body.approval_id?.trim() || ''
        if (!id) {
          reply.statusCode = 400
          return reply.send({ success: false, code: 'jarvis_approval_id_required' })
        }

        const record = body.action === 'approve'
          ? policy.approve(id)
          : policy.deny(id)

        if (!record) {
          reply.statusCode = 404
          return reply.send({
            success: false,
            code: 'jarvis_approval_not_available',
            message: 'Approvazione non trovata, scaduta o già consumata.'
          })
        }

        return reply.send({
          success: true,
          code: body.action === 'approve' ? 'jarvis_action_approved' : 'jarvis_action_denied',
          approval: record
        })
      }

      const descriptor = createDescriptor(body)
      const risk = getRisk(body.action)

      if (risk !== 'green' && !policy.consumeApproved(descriptor)) {
        return reply.send(approvalRequired(descriptor, risk))
      }

      policy.recordAllowed(descriptor, risk)

      let result: Record<string, unknown>

      try {
        switch (body.action) {
          case 'set-mode':
            if (!body.mode) {
              reply.statusCode = 400
              return reply.send({ success: false, code: 'jarvis_mode_required' })
            }
            result = await applyMode(body.mode)
            break
          case 'set-model':
            if (!body.model) {
              reply.statusCode = 400
              return reply.send({ success: false, code: 'jarvis_model_required' })
            }
            result = await applyModel(body.model)
            break
          case 'unload-model':
            result = await unloadModel(body.model)
            break
          case 'benchmark':
            result = await benchmark(body.model)
            break
          case 'restart-jarvis':
            result = {
              success: true,
              code: 'jarvis_restart_requested',
              message: 'JARVIS si riavvierà ora.'
            }
            setTimeout(() => requestShutdown(LEON_RESTART_EXIT_CODE), 350)
            break
          case 'restart-ollama':
            if (process.env['JARVIS_ALLOW_SYSTEM_SERVICE_CONTROL'] !== '1') {
              result = {
                success: false,
                code: 'jarvis_system_service_control_disabled',
                message: 'Restart Ollama protetto. Abilita JARVIS_ALLOW_SYSTEM_SERVICE_CONTROL=1 e sudo -n per systemctl restart ollama.service.'
              }
              break
            }

            await execFileAsync('sudo', ['-n', 'systemctl', 'restart', 'ollama.service'], {
              timeout: 30000
            })
            result = {
              success: true,
              code: 'jarvis_ollama_restarted',
              message: 'Ollama riavviato.'
            }
            break
          default:
            result = { success: false, code: 'jarvis_control_action_unsupported' }
        }
      } catch (error) {
        result = {
          success: false,
          code: 'jarvis_brain_control_failed',
          message: error instanceof Error ? error.message : String(error)
        }
      }

      policy.recordExecution(descriptor, risk, result['success'] === true, {
        code: typeof result['code'] === 'string' ? result['code'] : null
      })

      LogHelper.title('POST /brain-control')
      LogHelper.info(body.action + ': ' + (result['success'] === true ? 'success' : 'failed'))

      return reply.send(result)
    }
  })
}
