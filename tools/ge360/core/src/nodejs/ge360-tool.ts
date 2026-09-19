import { Tool } from '@sdk/base-tool'
import { ToolkitConfig } from '@sdk/toolkit-config'

const TOOLKIT_ID = 'ge360'
const TOOL_ID = 'core'
const DEFAULT_TIMEOUT_MS = 10_000
const MAX_RESPONSE_TEXT_CHARS = 100_000

type HTTPMethod = 'GET' | 'POST' | 'PUT' | 'PATCH'

interface RequestOptions {
  method?: HTTPMethod
  query?: Record<string, string | number | boolean>
  body?: unknown
}

interface GE360Settings {
  base_url?: string
  api_token?: string
  allow_write_actions?: boolean
  timeout_ms?: number
}

interface ProbeResult {
  base_url: string
  reachable: boolean
  status?: number
  health_path?: string
  openapi: boolean
  title?: string
  error?: string
}

interface GE360Response {
  success: boolean
  base_url?: string
  method?: string
  path?: string
  status?: number
  data?: unknown
  error?: string
}

export default class GE360Tool extends Tool {
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

  async discoverLocalService(): Promise<{
    success: boolean
    selected_base_url?: string
    probes: ProbeResult[]
    hint?: string
  }> {
    const probes: ProbeResult[] = []

    for (const baseURL of this.getCandidateBaseURLs()) {
      const probe = await this.probeBaseURL(baseURL)
      probes.push(probe)

      if (probe.reachable && (probe.openapi || probe.health_path)) {
        return {
          success: true,
          selected_base_url: baseURL,
          probes
        }
      }
    }

    return {
      success: false,
      probes,
      hint:
        'Set tools/ge360/core/settings.json base_url or GE360_BASE_URL to the local GE360 backend address.'
    }
  }

  async diagnose(): Promise<Record<string, unknown>> {
    const discovery = await this.discoverLocalService()
    if (!discovery.success || !discovery.selected_base_url) {
      return {
        success: false,
        discovery
      }
    }

    const baseURL = discovery.selected_base_url
    const healthChecks: Array<Record<string, unknown>> = []

    for (const path of ['/health', '/api/health', '/healthz']) {
      const result = await this.requestAgainstBaseURL(baseURL, path, {
        method: 'GET'
      })
      healthChecks.push({
        path,
        success: result.success,
        status: result.status,
        ...(result.success ? { data: result.data } : { error: result.error })
      })
    }

    const openAPI = await this.getOpenAPIAgainstBaseURL(baseURL)

    return {
      success: true,
      base_url: baseURL,
      write_actions_enabled: this.getSettings().allow_write_actions === true,
      health_checks: healthChecks,
      openapi: openAPI
    }
  }

  async getOpenAPI(): Promise<Record<string, unknown>> {
    const baseURL = await this.resolveBaseURL()

    if (!baseURL) {
      return {
        success: false,
        error:
          'GE360 backend not found. Run discoverLocalService or configure base_url.'
      }
    }

    return this.getOpenAPIAgainstBaseURL(baseURL)
  }

  async request(
    path: string,
    options: RequestOptions = {}
  ): Promise<GE360Response> {
    const baseURL = await this.resolveBaseURL()

    if (!baseURL) {
      return {
        success: false,
        error:
          'GE360 backend not found. Run discoverLocalService or configure base_url.'
      }
    }

    return this.requestAgainstBaseURL(baseURL, path, options)
  }

  private async getOpenAPIAgainstBaseURL(
    baseURL: string
  ): Promise<Record<string, unknown>> {
    const response = await this.requestAgainstBaseURL(baseURL, '/openapi.json', {
      method: 'GET'
    })

    if (!response.success) {
      return response
    }

    const document =
      response.data && typeof response.data === 'object'
        ? (response.data as Record<string, unknown>)
        : {}
    const info =
      document['info'] && typeof document['info'] === 'object'
        ? (document['info'] as Record<string, unknown>)
        : {}
    const paths =
      document['paths'] && typeof document['paths'] === 'object'
        ? (document['paths'] as Record<string, unknown>)
        : {}

    const endpoints = Object.entries(paths)
      .slice(0, 250)
      .map(([endpointPath, definition]) => {
        const methods =
          definition && typeof definition === 'object'
            ? Object.keys(definition as Record<string, unknown>)
                .map((method) => method.toUpperCase())
                .filter((method) =>
                  ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)
                )
            : []

        return {
          path: endpointPath,
          methods
        }
      })

    return {
      success: true,
      base_url: baseURL,
      title: typeof info['title'] === 'string' ? info['title'] : null,
      version: typeof info['version'] === 'string' ? info['version'] : null,
      endpoint_count: Object.keys(paths).length,
      endpoints
    }
  }

  private async probeBaseURL(baseURL: string): Promise<ProbeResult> {
    const openAPI = await this.fetchURL(baseURL, '/openapi.json', 'GET')

    if (openAPI.success) {
      const data =
        openAPI.data && typeof openAPI.data === 'object'
          ? (openAPI.data as Record<string, unknown>)
          : {}
      const info =
        data['info'] && typeof data['info'] === 'object'
          ? (data['info'] as Record<string, unknown>)
          : {}

      return {
        base_url: baseURL,
        reachable: true,
        status: openAPI.status,
        openapi: true,
        ...(typeof info['title'] === 'string' ? { title: info['title'] } : {})
      }
    }

    for (const healthPath of ['/health', '/api/health', '/healthz']) {
      const health = await this.fetchURL(baseURL, healthPath, 'GET')
      if (health.success) {
        return {
          base_url: baseURL,
          reachable: true,
          status: health.status,
          health_path: healthPath,
          openapi: false
        }
      }
    }

    return {
      base_url: baseURL,
      reachable: false,
      openapi: false,
      error: openAPI.error || 'No GE360-compatible endpoint responded.'
    }
  }

  private async resolveBaseURL(): Promise<string | null> {
    const configured = this.normalizeBaseURL(
      this.getSettings().base_url || process.env['GE360_BASE_URL'] || ''
    )

    if (configured) {
      return configured
    }

    const discovery = await this.discoverLocalService()
    return discovery.selected_base_url || null
  }

  private getCandidateBaseURLs(): string[] {
    const candidates = [
      this.getSettings().base_url || '',
      process.env['GE360_BASE_URL'] || '',
      'http://127.0.0.1:8000',
      'http://127.0.0.1:8788',
      'http://127.0.0.1:8787',
      'http://127.0.0.1:3000'
    ]
      .map((value) => this.normalizeBaseURL(value))
      .filter((value): value is string => Boolean(value))

    return [...new Set(candidates)]
  }

  private async requestAgainstBaseURL(
    baseURL: string,
    rawPath: string,
    options: RequestOptions
  ): Promise<GE360Response> {
    const path = this.validateRelativePath(rawPath)
    if (!path) {
      return {
        success: false,
        error:
          'Only relative GE360 paths beginning with / are allowed. Full URLs are blocked.'
      }
    }

    const method = options.method || 'GET'
    if (!this.isMethodAllowed(method)) {
      return {
        success: false,
        base_url: baseURL,
        method,
        path,
        error:
          method === 'DELETE'
            ? 'DELETE is blocked by the GE360 Tool Bus in this phase.'
            : 'Write actions are disabled. Set allow_write_actions=true in GE360 tool settings to enable POST, PUT or PATCH.'
      }
    }

    const url = this.buildURL(baseURL, path, options.query)
    const result = await this.fetchAbsoluteURL(url, method, options.body)

    return {
      success: result.success,
      base_url: baseURL,
      method,
      path,
      status: result.status,
      ...(result.success ? { data: result.data } : { error: result.error })
    }
  }

  private async fetchURL(
    baseURL: string,
    path: string,
    method: HTTPMethod
  ): Promise<{ success: boolean, status?: number, data?: unknown, error?: string }> {
    const url = this.buildURL(baseURL, path)
    return this.fetchAbsoluteURL(url, method)
  }

  private async fetchAbsoluteURL(
    url: string,
    method: HTTPMethod,
    body?: unknown
  ): Promise<{ success: boolean, status?: number, data?: unknown, error?: string }> {
    const controller = new AbortController()
    const timeout = setTimeout(
      () => controller.abort(),
      this.getTimeoutMs()
    )

    try {
      const token = this.getSettings().api_token?.trim() || ''
      const headers: Record<string, string> = {
        Accept: 'application/json'
      }

      if (token) {
        headers['Authorization'] = `Bearer ${token}`
      }
      if (body !== undefined && method !== 'GET') {
        headers['Content-Type'] = 'application/json'
      }

      const response = await fetch(url, {
        method,
        headers,
        signal: controller.signal,
        ...(body !== undefined && method !== 'GET'
          ? { body: JSON.stringify(body) }
          : {})
      })

      const text = await response.text()
      const data = this.parseResponseText(text)

      if (!response.ok) {
        return {
          success: false,
          status: response.status,
          data,
          error: `GE360 returned HTTP ${response.status}.`
        }
      }

      return {
        success: true,
        status: response.status,
        data
      }
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : String(error)
      }
    } finally {
      clearTimeout(timeout)
    }
  }

  private parseResponseText(text: string): unknown {
    if (!text) {
      return null
    }

    try {
      return JSON.parse(text)
    } catch {
      return text.length <= MAX_RESPONSE_TEXT_CHARS
        ? text
        : `${text.slice(0, MAX_RESPONSE_TEXT_CHARS)}…`
    }
  }

  private buildURL(
    baseURL: string,
    path: string,
    query?: Record<string, string | number | boolean>
  ): string {
    const url = new URL(path, `${baseURL}/`)

    for (const [key, value] of Object.entries(query || {})) {
      url.searchParams.set(key, String(value))
    }

    return url.toString()
  }

  private validateRelativePath(value: string): string | null {
    const path = value.trim()

    if (
      !path.startsWith('/') ||
      path.startsWith('//') ||
      path.includes('://') ||
      path.includes('\\')
    ) {
      return null
    }

    return path
  }

  private isMethodAllowed(method: HTTPMethod): boolean {
    if (method === 'GET') {
      return true
    }

    return this.getSettings().allow_write_actions === true
  }

  private getSettings(): GE360Settings {
    return this.settings as GE360Settings
  }

  private getTimeoutMs(): number {
    const configured = this.getSettings().timeout_ms

    return typeof configured === 'number' &&
      Number.isFinite(configured) &&
      configured >= 1_000 &&
      configured <= 120_000
      ? Math.floor(configured)
      : DEFAULT_TIMEOUT_MS
  }

  private normalizeBaseURL(value: string): string {
    const normalized = value.trim().replace(/\/+$/, '')
    if (!normalized) {
      return ''
    }

    try {
      const url = new URL(normalized)
      const hostname = url.hostname.toLowerCase()
      const isLocal =
        hostname === '127.0.0.1' ||
        hostname === 'localhost' ||
        hostname === '::1'

      if (!isLocal || (url.protocol !== 'http:' && url.protocol !== 'https:')) {
        return ''
      }

      return url.toString().replace(/\/$/, '')
    } catch {
      return ''
    }
  }
}
