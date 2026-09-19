import axios from 'axios'

const REFRESH_INTERVAL_MS = 4_000
const LEON_TYPING_EVENT = 'leon:is-typing'
const LEON_ANSWER_EVENT = 'leon:answer'
const LEON_ERROR_EVENT = 'leon:error'

function formatNumber(value, fallback = '—') {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(1) : fallback
}

function formatDuration(seconds) {
  const total = Math.max(Number(seconds) || 0, 0)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)

  if (hours > 0) {
    return `${hours}h ${minutes}m`
  }

  return `${Math.max(minutes, 1)}m`
}

function formatTime(timestamp) {
  if (!timestamp) {
    return '—'
  }

  return new Intl.DateTimeFormat('it-IT', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(new Date(timestamp))
}

function clampPercent(value) {
  return Math.min(Math.max(Number(value) || 0, 0), 100)
}

function createElement(tagName, className, text) {
  const element = document.createElement(tagName)

  if (className) {
    element.className = className
  }
  if (text !== undefined) {
    element.textContent = text
  }

  return element
}

function createStatusDot(online) {
  const dot = createElement('span', 'brain-status-dot')
  dot.classList.toggle('brain-status-dot--online', Boolean(online))
  dot.classList.toggle('brain-status-dot--offline', !online)

  return dot
}

function createMeter(label, value, valueLabel) {
  const wrapper = createElement('div', 'brain-meter')
  const top = createElement('div', 'brain-meter__top')
  top.append(
    createElement('span', 'brain-meter__label', label),
    createElement('span', 'brain-meter__value', valueLabel)
  )

  const track = createElement('div', 'brain-meter__track')
  const fill = createElement('div', 'brain-meter__fill')
  fill.style.width = `${clampPercent(value)}%`
  track.append(fill)

  wrapper.append(top, track)

  return wrapper
}

function createCard(title, iconName) {
  const card = createElement('section', 'brain-card')
  const header = createElement('header', 'brain-card__header')
  const titleWrap = createElement('div', 'brain-card__title-wrap')
  const icon = createElement('i', `brain-card__icon ri-${iconName}-line`)
  icon.setAttribute('aria-hidden', 'true')
  titleWrap.append(icon, createElement('h3', 'brain-card__title', title))
  header.append(titleWrap)
  card.append(header)

  return { card, header }
}

function createKeyValue(label, value, tone = '') {
  const row = createElement('div', 'brain-kv')
  row.append(
    createElement('span', 'brain-kv__label', label),
    createElement(
      'span',
      `brain-kv__value${tone ? ` brain-kv__value--${tone}` : ''}`,
      value
    )
  )

  return row
}

export default class BrainDashboard {
  constructor({ serverUrl, socket }) {
    this.serverUrl = serverUrl
    this.socket = socket
    this.isOpen = false
    this.isThinking = false
    this.lastError = null
    this.refreshTimer = null
    this.panel = null
    this.content = null
    this.statusLabel = null
    this.statusDot = null
    this.lastUpdated = null
    this.lastData = null
    this.pendingControl = null
    this.controlBusy = false
    this.controlNotice = ''
    this.benchmarkHistory = []
    this.toggleButton = document.querySelector('#brain-toggle')
  }

  init() {
    if (!this.toggleButton) {
      return
    }

    this.buildPanel()
    this.toggleButton.addEventListener('click', () => this.toggle())

    this.socket?.on(LEON_TYPING_EVENT, (value) => {
      this.isThinking = Boolean(value)
      this.renderLiveState()
    })
    this.socket?.on(LEON_ANSWER_EVENT, () => {
      this.isThinking = false
      this.lastError = null
      this.renderLiveState()
      if (this.isOpen) {
        void this.refresh()
      }
    })
    this.socket?.on(LEON_ERROR_EVENT, (error) => {
      this.isThinking = false
      this.lastError = error?.message || 'Errore runtime'
      this.renderLiveState()
    })
  }

  buildPanel() {
    this.panel = createElement('aside', 'brain-dashboard')
    this.panel.setAttribute('aria-label', 'JARVIS Brain Dashboard')
    this.panel.setAttribute('aria-hidden', 'true')

    const header = createElement('header', 'brain-dashboard__header')
    const heading = createElement('div', 'brain-dashboard__heading')
    const eyebrow = createElement('span', 'brain-dashboard__eyebrow', 'GE360')
    const title = createElement('h2', 'brain-dashboard__title', 'JARVIS Brain')
    const subtitle = createElement(
      'p',
      'brain-dashboard__subtitle',
      'Cervello, risorse, attività e sicurezza in tempo reale'
    )
    heading.append(eyebrow, title, subtitle)

    const actions = createElement('div', 'brain-dashboard__actions')
    const refreshButton = createElement('button', 'brain-icon-button')
    refreshButton.type = 'button'
    refreshButton.title = 'Aggiorna'
    refreshButton.innerHTML = '<i class="ri-refresh-line" aria-hidden="true"></i>'
    refreshButton.addEventListener('click', () => void this.refresh())

    const closeButton = createElement('button', 'brain-icon-button')
    closeButton.type = 'button'
    closeButton.title = 'Chiudi'
    closeButton.innerHTML = '<i class="ri-close-line" aria-hidden="true"></i>'
    closeButton.addEventListener('click', () => this.close())

    actions.append(refreshButton, closeButton)
    header.append(heading, actions)

    const hero = createElement('section', 'brain-hero')
    const orb = createElement('div', 'brain-orb')
    orb.innerHTML = [
      '<span class="brain-orb__ring brain-orb__ring--one"></span>',
      '<span class="brain-orb__ring brain-orb__ring--two"></span>',
      '<span class="brain-orb__core"><i class="ri-cpu-line"></i></span>'
    ].join('')

    const heroState = createElement('div', 'brain-hero__state')
    const stateLine = createElement('div', 'brain-hero__state-line')
    this.statusDot = createStatusDot(true)
    stateLine.append(this.statusDot)
    this.statusLabel = createElement(
      'span',
      'brain-hero__status',
      'JARVIS ONLINE'
    )
    stateLine.append(this.statusLabel)

    this.lastUpdated = createElement(
      'span',
      'brain-hero__updated',
      'In attesa dei dati'
    )
    heroState.append(stateLine, this.lastUpdated)
    hero.append(orb, heroState)

    this.content = createElement('div', 'brain-dashboard__content')
    this.content.append(
      createElement(
        'div',
        'brain-dashboard__loading',
        'Caricamento stato del cervello...'
      )
    )

    this.panel.append(header, hero, this.content)
    document.body.append(this.panel)
    this.renderLiveState()
  }

  toggle() {
    if (this.isOpen) {
      this.close()
      return
    }

    this.open()
  }

  open() {
    if (!this.panel) {
      return
    }

    this.isOpen = true
    this.panel.classList.add('brain-dashboard--open')
    this.panel.setAttribute('aria-hidden', 'false')
    this.toggleButton?.classList.add('brain-toggle--active')
    void this.refresh()
    this.startPolling()
  }

  close() {
    if (!this.panel) {
      return
    }

    this.isOpen = false
    this.panel.classList.remove('brain-dashboard--open')
    this.panel.setAttribute('aria-hidden', 'true')
    this.toggleButton?.classList.remove('brain-toggle--active')
    this.stopPolling()
  }

  startPolling() {
    this.stopPolling()
    this.refreshTimer = window.setInterval(() => {
      void this.refresh()
    }, REFRESH_INTERVAL_MS)
  }

  stopPolling() {
    if (this.refreshTimer !== null) {
      window.clearInterval(this.refreshTimer)
      this.refreshTimer = null
    }
  }

  renderLiveState() {
    if (!this.statusLabel || !this.panel) {
      return
    }

    if (this.lastError) {
      this.statusLabel.textContent = 'JARVIS ERROR'
      this.panel.dataset.runtimeState = 'error'
      this.statusDot?.classList.remove('brain-status-dot--online')
      this.statusDot?.classList.add('brain-status-dot--offline')
      return
    }

    this.statusDot?.classList.remove('brain-status-dot--offline')
    this.statusDot?.classList.add('brain-status-dot--online')

    if (this.isThinking) {
      this.statusLabel.textContent = 'JARVIS STA LAVORANDO'
      this.panel.dataset.runtimeState = 'working'
      return
    }

    this.statusLabel.textContent = 'JARVIS ONLINE'
    this.panel.dataset.runtimeState = 'online'
  }

  async refresh() {
    if (!this.content) {
      return
    }

    try {
      const response = await axios.get(
        `${this.serverUrl}/api/v1/brain-status`
      )
      this.lastError = null
      this.render(response.data)
    } catch (error) {
      this.lastError =
        error.response?.data?.message ||
        error.message ||
        'Brain status non disponibile'
      this.renderError(this.lastError)
    }

    this.renderLiveState()
  }

  render(data) {
    if (!this.content) {
      return
    }

    this.lastData = data
    this.content.replaceChildren()

    if (this.lastUpdated) {
      this.lastUpdated.textContent =
        `Aggiornato ${formatTime(data.generated_at)} · uptime ${formatDuration(data.runtime?.uptime_seconds)}`
    }

    const overviewGrid = createElement('div', 'brain-grid brain-grid--overview')

    const brainCard = createCard('Cervello', 'brain')
    const loadedModel = data.ollama?.loaded_models?.[0]
    brainCard.card.append(
      createKeyValue('Modello attivo', data.llm?.model || '—'),
      createKeyValue('Provider', data.llm?.provider || '—'),
      createKeyValue('Routing', data.runtime?.routing_mode || '—'),
      createKeyValue(
        'Ollama',
        data.ollama?.online ? 'ONLINE' : 'OFFLINE',
        data.ollama?.online ? 'success' : 'danger'
      ),
      createKeyValue(
        'Modello in VRAM',
        loadedModel?.name || 'non caricato'
      ),
      createKeyValue(
        'Context',
        `${data.runtime?.local_context_tokens || '—'} token`
      )
    )

    const hardwareCard = createCard('Hardware', 'dashboard-3')
    hardwareCard.card.append(
      createMeter(
        'RAM',
        data.memory?.used_percent,
        `${formatNumber(data.memory?.used_gb)} / ${formatNumber(data.memory?.total_gb)} GB`
      ),
      createMeter(
        'VRAM',
        data.gpu?.used_percent,
        `${formatNumber(data.gpu?.used_vram_gb)} / ${formatNumber(data.gpu?.total_vram_gb)} GB`
      ),
      createMeter(
        'CPU load',
        data.cpu?.estimated_load_percent,
        `${formatNumber(data.cpu?.estimated_load_percent)}%`
      ),
      createKeyValue('GPU', data.gpu?.name || 'non rilevata'),
      createKeyValue('Compute', data.gpu?.compute_api || '—'),
      createKeyValue(
        'JARVIS RSS',
        `${formatNumber(data.memory?.process_rss_mb)} MB`
      )
    )

    overviewGrid.append(brainCard.card, hardwareCard.card)

    const servicesGrid = createElement('div', 'brain-grid brain-grid--services')
    const servicesCard = createCard('Servizi', 'server')
    const serviceList = createElement('div', 'brain-service-list')

    const ollamaRow = createElement('div', 'brain-service')
    ollamaRow.append(
      createStatusDot(data.ollama?.online),
      createElement('span', 'brain-service__name', 'Ollama'),
      createElement(
        'span',
        'brain-service__meta',
        data.ollama?.version || 'locale'
      )
    )

    const ge360Row = createElement('div', 'brain-service')
    ge360Row.append(
      createStatusDot(data.ge360?.online),
      createElement('span', 'brain-service__name', 'GE360 Backend'),
      createElement(
        'span',
        'brain-service__meta',
        data.ge360?.online
          ? data.ge360?.title || data.ge360?.base_url || 'online'
          : 'non rilevato'
      )
    )

    serviceList.append(ollamaRow, ge360Row)
    servicesCard.card.append(serviceList)

    const safetyCard = createCard('Sicurezza', 'shield-check')
    const pending = Array.isArray(data.safety?.pending)
      ? data.safety.pending
      : []
    const audit = Array.isArray(data.safety?.audit)
      ? data.safety.audit
      : []

    safetyCard.card.append(
      createKeyValue('VERDE', 'automatico', 'success'),
      createKeyValue('GIALLA', 'approvazione one-shot', 'warning'),
      createKeyValue('ROSSA', 'approvazione obbligatoria', 'danger'),
      createKeyValue(
        'In attesa',
        String(pending.length),
        pending.length > 0 ? 'warning' : 'success'
      )
    )

    if (pending.length > 0) {
      const pendingList = createElement('div', 'brain-pending-list')
      for (const item of pending.slice(0, 4)) {
        const row = createElement('div', 'brain-pending')
        row.append(
          createElement(
            'span',
            `brain-risk brain-risk--${item.risk || 'yellow'}`,
            String(item.risk || 'yellow').toUpperCase()
          ),
          createElement(
            'code',
            'brain-pending__code',
            item.action?.path || item.action?.functionName || item.id
          ),
          createElement('span', 'brain-pending__id', item.id)
        )
        pendingList.append(row)
      }
      safetyCard.card.append(pendingList)
    }

    servicesGrid.append(servicesCard.card, safetyCard.card)

    const controlsCard = createCard('Controllo cervello', 'settings-3')
    this.renderControls(controlsCard.card, data)

    const activityCard = createCard('Attività agente', 'pulse')
    this.renderActivity(activityCard.card, data.activity)

    const auditCard = createCard('Audit recente', 'history')
    this.renderAudit(auditCard.card, audit)

    this.content.append(
      overviewGrid,
      servicesGrid,
      controlsCard.card,
      activityCard.card,
      auditCard.card
    )
  }

  createControlButton(label, iconName, onClick, options = {}) {
    const button = createElement(
      'button',
      'brain-control-button' +
        (options.tone ? ' brain-control-button--' + options.tone : '') +
        (options.active ? ' brain-control-button--active' : '')
    )
    button.type = 'button'
    button.disabled = this.controlBusy || Boolean(options.disabled)
    if (options.title) {
      button.title = options.title
    }
    button.innerHTML =
      '<i class="ri-' + iconName + '-line" aria-hidden="true"></i>' +
      '<span>' + label + '</span>'
    button.addEventListener('click', onClick)

    return button
  }

  renderControls(card, data) {
    const currentMode = data.runtime?.performance_mode || 'normal'
    const installedModels = Array.isArray(data.ollama?.installed_models)
      ? data.ollama.installed_models
      : []
    const configuredModel = data.llm?.model || ''
    const hasBoostModel = installedModels.some(
      (name) => name === 'qwen3.5:9b' || name.startsWith('qwen3.5:9b-')
    )
    const restartOllamaAvailable = data.controls?.restart_ollama === true

    const sectionLabel = (text) =>
      createElement('div', 'brain-control-section-label', text)

    const modeRow = createElement('div', 'brain-control-row')
    for (const mode of ['eco', 'normal', 'boost']) {
      const labels = {
        eco: 'ECO',
        normal: 'NORMAL',
        boost: 'BOOST'
      }
      const icons = {
        eco: 'leaf',
        normal: 'speed',
        boost: 'rocket'
      }
      modeRow.append(
        this.createControlButton(
          labels[mode],
          icons[mode],
          () => void this.requestControl({
            action: 'set-mode',
            mode
          }),
          {
            active: currentMode === mode,
            tone: mode === 'boost' ? 'boost' : mode,
            disabled: mode === 'boost' && !hasBoostModel,
            title:
              mode === 'boost' && !hasBoostModel
                ? 'Installa prima: ollama pull qwen3.5:9b'
                : ''
          }
        )
      )
    }

    const modelRow = createElement('div', 'brain-control-row')
    for (const model of ['qwen3.5:4b', 'qwen3.5:9b']) {
      const installed = installedModels.some(
        (name) => name === model || name.startsWith(model + '-')
      )
      modelRow.append(
        this.createControlButton(
          model.endsWith(':4b') ? 'Qwen 4B' : 'Qwen 9B',
          'cpu',
          () => void this.requestControl({
            action: 'set-model',
            model
          }),
          {
            active: configuredModel === model,
            disabled: !installed,
            tone: model.endsWith(':9b') ? 'boost' : 'normal',
            title:
              installed
                ? ''
                : 'Installa prima: ollama pull ' + model
          }
        )
      )
    }

    const actionRow = createElement('div', 'brain-control-row brain-control-row--actions')
    actionRow.append(
      this.createControlButton(
        'Benchmark',
        'line-chart',
        () => void this.requestControl({ action: 'benchmark' }),
        { tone: 'green' }
      ),
      this.createControlButton(
        'Unload',
        'eject',
        () => void this.requestControl({ action: 'unload-model' }),
        { tone: 'yellow' }
      ),
      this.createControlButton(
        'Restart JARVIS',
        'restart',
        () => void this.requestControl({ action: 'restart-jarvis' }),
        { tone: 'red' }
      ),
      this.createControlButton(
        restartOllamaAvailable ? 'Restart Ollama' : 'Ollama protetto',
        restartOllamaAvailable ? 'refresh' : 'lock',
        () => void this.requestControl({ action: 'restart-ollama' }),
        {
          tone: 'red',
          disabled: !restartOllamaAvailable
        }
      )
    )

    card.append(
      sectionLabel('Modalità prestazioni'),
      modeRow,
      sectionLabel('Modello'),
      modelRow,
      sectionLabel('Azioni'),
      actionRow
    )

    if (this.pendingControl) {
      const approval = createElement('div', 'brain-control-approval')
      const label = createElement(
        'div',
        'brain-control-approval__label',
        'Conferma ' + String(this.pendingControl.approval?.risk || '').toUpperCase()
      )
      const description = createElement(
        'p',
        'brain-control-approval__description',
        this.pendingControl.message ||
          'Questa azione richiede una conferma esplicita.'
      )
      const buttons = createElement('div', 'brain-control-approval__actions')
      buttons.append(
        this.createControlButton(
          'Conferma',
          'check',
          () => void this.confirmPendingControl(),
          { tone: 'red' }
        ),
        this.createControlButton(
          'Annulla',
          'close',
          () => void this.denyPendingControl(),
          { tone: 'normal' }
        )
      )
      approval.append(label, description, buttons)
      card.append(approval)
    }

    if (this.controlNotice) {
      card.append(
        createElement('p', 'brain-control-notice', this.controlNotice)
      )
    }

    if (this.benchmarkHistory.length > 0) {
      const chart = createElement('div', 'brain-benchmark')
      const title = createElement(
        'div',
        'brain-control-section-label',
        'Benchmark token/s'
      )
      const bars = createElement('div', 'brain-benchmark__bars')
      const maxValue = Math.max(
        ...this.benchmarkHistory.map((item) => item.tokensPerSecond),
        1
      )

      for (const item of this.benchmarkHistory.slice(-8)) {
        const column = createElement('div', 'brain-benchmark__column')
        const value = createElement(
          'span',
          'brain-benchmark__value',
          formatNumber(item.tokensPerSecond)
        )
        const barWrap = createElement('div', 'brain-benchmark__track')
        const bar = createElement('div', 'brain-benchmark__bar')
        bar.style.height =
          Math.max((item.tokensPerSecond / maxValue) * 100, 6) + '%'
        barWrap.append(bar)
        const label = createElement(
          'span',
          'brain-benchmark__label',
          item.model.includes('9b') ? '9B' : '4B'
        )
        column.append(value, barWrap, label)
        bars.append(column)
      }

      chart.append(title, bars)
      card.append(chart)
    }
  }

  async requestControl(payload) {
    if (this.controlBusy) {
      return
    }

    this.controlBusy = true
    this.controlNotice = 'Esecuzione...'
    this.pendingControl = null
    if (this.lastData) {
      this.render(this.lastData)
    }

    try {
      const response = await axios.post(
        this.serverUrl + '/api/v1/brain-control',
        payload
      )
      const data = response.data

      if (data.status === 'owner_action_required') {
        this.pendingControl = {
          payload,
          approval: data.approval,
          message: data.message
        }
        this.controlNotice =
          'Serve la tua conferma per continuare.'
        return
      }

      if (data.success !== true) {
        this.controlNotice =
          data.message || 'Operazione non completata.'
        return
      }

      if (data.benchmark) {
        this.benchmarkHistory.push({
          model: data.benchmark.model || 'unknown',
          tokensPerSecond:
            Number(data.benchmark.output_tokens_per_second) || 0
        })
        this.benchmarkHistory = this.benchmarkHistory.slice(-8)
        this.controlNotice =
          'Benchmark: ' +
          formatNumber(data.benchmark.output_tokens_per_second) +
          ' token/s · load ' +
          formatNumber(data.benchmark.load_seconds) +
          's'
      } else {
        this.controlNotice = data.message || 'Operazione completata.'
      }

      window.setTimeout(() => {
        if (this.isOpen) {
          void this.refresh()
        }
      }, 700)
    } catch (error) {
      this.controlNotice =
        error.response?.data?.message ||
        error.message ||
        'Controllo JARVIS non disponibile.'
    } finally {
      this.controlBusy = false
      if (this.lastData) {
        this.render(this.lastData)
      }
    }
  }

  async confirmPendingControl() {
    if (!this.pendingControl || this.controlBusy) {
      return
    }

    const pending = this.pendingControl
    this.controlBusy = true
    this.controlNotice = 'Conferma in corso...'
    if (this.lastData) {
      this.render(this.lastData)
    }

    try {
      const approvalResponse = await axios.post(
        this.serverUrl + '/api/v1/brain-control',
        {
          action: 'approve',
          approval_id: pending.approval.id
        }
      )

      if (approvalResponse.data.success !== true) {
        this.controlNotice =
          approvalResponse.data.message || 'Conferma fallita.'
        return
      }

      this.controlBusy = false
      this.pendingControl = null
      await this.requestControl(pending.payload)
    } catch (error) {
      this.controlNotice =
        error.response?.data?.message ||
        error.message ||
        'Conferma non riuscita.'
    } finally {
      this.controlBusy = false
      if (this.lastData) {
        this.render(this.lastData)
      }
    }
  }

  async denyPendingControl() {
    if (!this.pendingControl || this.controlBusy) {
      return
    }

    const pending = this.pendingControl
    this.controlBusy = true

    try {
      await axios.post(
        this.serverUrl + '/api/v1/brain-control',
        {
          action: 'deny',
          approval_id: pending.approval.id
        }
      )
      this.pendingControl = null
      this.controlNotice = 'Operazione annullata.'
    } catch (error) {
      this.controlNotice =
        error.response?.data?.message ||
        error.message ||
        'Impossibile annullare la richiesta.'
    } finally {
      this.controlBusy = false
      if (this.lastData) {
        this.render(this.lastData)
      }
    }
  }

  renderActivity(card, activity) {
    if (!activity) {
      card.append(
        createElement(
          'p',
          'brain-empty',
          'Nessuna attività agente registrata ancora.'
        )
      )
      return
    }

    if (activity.reasoning_summary) {
      const summary = createElement('p', 'brain-activity-summary')
      summary.textContent = activity.reasoning_summary
      card.append(summary)
    }

    const metrics = activity.metrics || {}
    const metricRow = createElement('div', 'brain-chip-row')
    const metricValues = [
      ['Token/s', metrics.tokensPerSecond ?? metrics.tokens_per_second],
      ['Input', metrics.inputTokens ?? metrics.input_tokens],
      ['Output', metrics.outputTokens ?? metrics.output_tokens]
    ]

    for (const [label, value] of metricValues) {
      if (value === undefined || value === null) {
        continue
      }
      metricRow.append(
        createElement(
          'span',
          'brain-chip',
          `${label}: ${formatNumber(value)}`
        )
      )
    }
    if (metricRow.childElementCount > 0) {
      card.append(metricRow)
    }

    const steps = Array.isArray(activity.plan_steps)
      ? activity.plan_steps
      : []
    const tools = Array.isArray(activity.tool_calls)
      ? activity.tool_calls
      : []

    const timeline = createElement('div', 'brain-timeline')

    for (const step of steps) {
      const row = createElement('div', 'brain-timeline__row')
      const dot = createElement(
        'span',
        `brain-timeline__dot brain-timeline__dot--${step.status || 'pending'}`
      )
      row.append(
        dot,
        createElement('span', 'brain-timeline__label', step.label || 'Passo')
      )
      timeline.append(row)
    }

    for (const tool of tools.slice(-8)) {
      const row = createElement('div', 'brain-timeline__row brain-timeline__row--tool')
      const dot = createElement(
        'span',
        `brain-timeline__dot brain-timeline__dot--${tool.status || 'pending'}`
      )
      row.append(
        dot,
        createElement(
          'span',
          'brain-timeline__label',
          tool.step_label || tool.name || 'Tool'
        ),
        createElement(
          'span',
          'brain-timeline__meta',
          tool.status || ''
        )
      )
      timeline.append(row)
    }

    if (timeline.childElementCount === 0) {
      timeline.append(
        createElement(
          'p',
          'brain-empty',
          'Traccia agente presente, senza passi/tool visibili.'
        )
      )
    }

    card.append(timeline)
  }

  renderAudit(card, audit) {
    if (audit.length === 0) {
      card.append(createElement('p', 'brain-empty', 'Audit ancora vuoto.'))
      return
    }

    const list = createElement('div', 'brain-audit-list')

    for (const entry of audit.slice(0, 10)) {
      const row = createElement('div', 'brain-audit')
      const top = createElement('div', 'brain-audit__top')
      top.append(
        createElement(
          'span',
          `brain-risk brain-risk--${entry.risk || 'green'}`,
          String(entry.risk || 'green').toUpperCase()
        ),
        createElement('span', 'brain-audit__event', entry.event || 'evento'),
        createElement(
          'time',
          'brain-audit__time',
          formatTime(entry.timestamp)
        )
      )

      const action = createElement(
        'code',
        'brain-audit__action',
        [
          entry.action?.method || '',
          entry.action?.path || entry.action?.functionName || ''
        ]
          .filter(Boolean)
          .join(' ')
      )

      row.append(top, action)
      list.append(row)
    }

    card.append(list)
  }

  renderError(message) {
    if (!this.content) {
      return
    }

    this.content.replaceChildren()
    const card = createElement('section', 'brain-card brain-card--error')
    card.append(
      createElement('h3', 'brain-card__title', 'Brain status non disponibile'),
      createElement('p', 'brain-empty', message)
    )
    this.content.append(card)

    if (this.lastUpdated) {
      this.lastUpdated.textContent = 'Connessione persa'
    }
  }
}
