const EVENTS = {
  answer: 'leon:answer',
  typing: 'leon:is-typing',
  token: 'leon:llm-token',
  owner: 'leon:owner-utterance',
  error: 'leon:error'
}

function createElement(tagName, className, text) {
  const element = document.createElement(tagName)
  if (className) element.className = className
  if (text !== undefined) element.textContent = text
  return element
}

function formatTime(timestamp = Date.now()) {
  return new Intl.DateTimeFormat('it-IT', {
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(timestamp))
}

export default class JarvisQuickChat {
  constructor({ client }) {
    this.client = client
    this.socket = client.socket
    this.messages = []
    this.isOpen = false
    this.isTyping = false
    this.activeStreamId = null
    this.activeStreamText = ''
    this.root = null
    this.feed = null
    this.input = null
    this.sendButton = null
    this.toggleButton = null
    this.brainMount = null
    this.brainFeed = null
    this.brainInput = null
    this.brainSendButton = null
  }

  init() {
    this.buildGlobalChat()
    this.bindSocket()
  }

  buildGlobalChat() {
    this.toggleButton = createElement('button', 'jarvis-quick-chat-toggle')
    this.toggleButton.type = 'button'
    this.toggleButton.setAttribute('aria-label', 'Apri chat rapida JARVIS')
    this.toggleButton.innerHTML =
      '<i class="ri-chat-ai-line" aria-hidden="true"></i>' +
      '<span>JARVIS Chat</span>'

    this.root = createElement('aside', 'jarvis-quick-chat')
    this.root.setAttribute('aria-hidden', 'true')

    const header = createElement('header', 'jarvis-quick-chat__header')
    const titleWrap = createElement('div', 'jarvis-quick-chat__title-wrap')
    const icon = createElement('span', 'jarvis-quick-chat__orb')
    icon.innerHTML = '<i class="ri-brain-line" aria-hidden="true"></i>'
    const titles = createElement('div', 'jarvis-quick-chat__titles')
    titles.append(
      createElement('strong', 'jarvis-quick-chat__title', 'JARVIS'),
      createElement(
        'span',
        'jarvis-quick-chat__subtitle',
        'Stessa sessione, stessi tool, stesso cervello'
      )
    )
    titleWrap.append(icon, titles)

    const close = createElement('button', 'jarvis-quick-chat__close')
    close.type = 'button'
    close.setAttribute('aria-label', 'Chiudi chat rapida')
    close.innerHTML = '<i class="ri-close-line" aria-hidden="true"></i>'
    close.addEventListener('click', () => this.close())

    header.append(titleWrap, close)

    this.feed = createElement('div', 'jarvis-quick-chat__feed')
    const suggestions = this.createSuggestions()
    const composer = this.createComposer('global')

    this.root.append(header, this.feed, suggestions, composer)
    document.body.append(this.toggleButton, this.root)

    this.toggleButton.addEventListener('click', () => {
      this.isOpen ? this.close() : this.open()
    })

    this.renderFeeds()
  }

  createSuggestions() {
    const wrap = createElement('div', 'jarvis-quick-chat__suggestions')
    const prompts = [
      'Come stai?',
      'Controlla GE360',
      'Perché sei lento?',
      'Fai un benchmark'
    ]

    for (const prompt of prompts) {
      const button = createElement(
        'button',
        'jarvis-quick-chat__suggestion',
        prompt
      )
      button.type = 'button'
      button.addEventListener('click', () => {
        void this.send(prompt)
      })
      wrap.append(button)
    }

    return wrap
  }

  createComposer(surface) {
    const form = createElement('form', 'jarvis-quick-chat__composer')
    const input = createElement('textarea', 'jarvis-quick-chat__input')
    input.rows = 1
    input.placeholder = 'Scrivi a JARVIS...'
    input.setAttribute('aria-label', 'Messaggio per JARVIS')

    const send = createElement('button', 'jarvis-quick-chat__send')
    send.type = 'submit'
    send.innerHTML = '<i class="ri-send-plane-2-fill" aria-hidden="true"></i>'
    send.setAttribute('aria-label', 'Invia')

    if (surface === 'global') {
      this.input = input
      this.sendButton = send
    } else {
      this.brainInput = input
      this.brainSendButton = send
    }

    input.addEventListener('input', () => {
      input.style.height = 'auto'
      input.style.height = Math.min(input.scrollHeight, 112) + 'px'
    })

    input.addEventListener('keydown', (event) => {
      if (
        event.key === 'Enter' &&
        !event.shiftKey &&
        !event.isComposing
      ) {
        event.preventDefault()
        form.requestSubmit()
      }
    })

    form.addEventListener('submit', (event) => {
      event.preventDefault()
      const value = input.value.trim()
      if (!value) return
      input.value = ''
      input.style.height = 'auto'
      void this.send(value)
    })

    form.append(input, send)
    return form
  }

  mountInsideBrain(container) {
    if (!container) return

    this.brainMount = container
    container.replaceChildren()

    const header = createElement('div', 'brain-chat__header')
    header.append(
      createElement('span', 'brain-chat__title', 'Chat con JARVIS'),
      createElement(
        'span',
        'brain-chat__meta',
        'collegata alla sessione principale'
      )
    )

    this.brainFeed = createElement('div', 'brain-chat__feed')
    const suggestions = this.createSuggestions()
    suggestions.classList.add('brain-chat__suggestions')
    const composer = this.createComposer('brain')
    composer.classList.add('brain-chat__composer')

    container.append(header, this.brainFeed, suggestions, composer)
    this.renderFeeds()
  }

  open() {
    this.isOpen = true
    this.root?.classList.add('jarvis-quick-chat--open')
    this.root?.setAttribute('aria-hidden', 'false')
    this.toggleButton?.classList.add('jarvis-quick-chat-toggle--active')
    window.setTimeout(() => this.input?.focus(), 120)
  }

  close() {
    this.isOpen = false
    this.root?.classList.remove('jarvis-quick-chat--open')
    this.root?.setAttribute('aria-hidden', 'true')
    this.toggleButton?.classList.remove('jarvis-quick-chat-toggle--active')
  }

  async send(value) {
    const text = String(value || '').trim()
    if (!text) return false

    const sent = this.client.sendUtterance(text)

    if (!sent) {
      this.pushMessage({
        role: 'system',
        text: 'JARVIS sta già elaborando una richiesta. Attendi la risposta.',
        sentAt: Date.now()
      })
      return false
    }

    this.pushMessage({
      role: 'owner',
      text,
      sentAt: Date.now()
    })

    this.setBusy(true)
    return true
  }

  bindSocket() {
    this.socket.on(EVENTS.typing, (value) => {
      this.isTyping = Boolean(value)
      this.setBusy(this.isTyping)
      this.renderFeeds()
    })

    this.socket.on(EVENTS.owner, (data) => {
      if (!data?.utterance) return

      const exists = this.messages.some(
        (message) =>
          message.role === 'owner' &&
          message.text === data.utterance &&
          Math.abs((message.sentAt || 0) - (data.sentAt || 0)) < 2500
      )

      if (!exists) {
        this.pushMessage({
          role: 'owner',
          text: data.utterance,
          sentAt: data.sentAt || Date.now()
        })
      }
    })

    this.socket.on(EVENTS.token, (data) => {
      if (data?.reset) {
        if (this.activeStreamId === data.generationId) {
          this.activeStreamId = null
          this.activeStreamText = ''
        }
        return
      }

      if (!data?.generationId) return

      if (this.activeStreamId !== data.generationId) {
        this.activeStreamId = data.generationId
        this.activeStreamText = ''
      }

      this.activeStreamText += data.token || ''
      this.renderFeeds()
    })

    this.socket.on(EVENTS.answer, (data) => {
      if (data?.isToolOutput || data?.widget || data?.componentTree) {
        return
      }

      const answerText =
        typeof data === 'string'
          ? data
          : typeof data?.answer === 'string'
            ? data.answer
            : ''

      if (!answerText) return

      this.activeStreamId = null
      this.activeStreamText = ''
      this.pushMessage({
        role: 'jarvis',
        text: answerText,
        sentAt: data?.sentAt || Date.now(),
        metrics: data?.llmMetrics || null
      })
      this.setBusy(false)
    })

    this.socket.on(EVENTS.error, (data) => {
      this.activeStreamId = null
      this.activeStreamText = ''
      this.pushMessage({
        role: 'system',
        text: data?.message || 'Errore JARVIS.',
        sentAt: Date.now()
      })
      this.setBusy(false)
    })
  }

  setBusy(value) {
    const busy = Boolean(value)
    if (this.sendButton) this.sendButton.disabled = busy
    if (this.brainSendButton) this.brainSendButton.disabled = busy
  }

  pushMessage(message) {
    const last = this.messages[this.messages.length - 1]
    if (
      last &&
      last.role === message.role &&
      last.text === message.text &&
      Math.abs((last.sentAt || 0) - (message.sentAt || 0)) < 1500
    ) {
      return
    }

    this.messages.push(message)
    this.messages = this.messages.slice(-40)
    this.renderFeeds()
  }

  renderFeeds() {
    this.renderFeed(this.feed)
    this.renderFeed(this.brainFeed)
  }

  renderFeed(feed) {
    if (!feed) return

    feed.replaceChildren()

    if (this.messages.length === 0 && !this.activeStreamText) {
      const empty = createElement('div', 'jarvis-quick-chat__empty')
      empty.innerHTML =
        '<i class="ri-sparkling-2-line" aria-hidden="true"></i>' +
        '<strong>Parla direttamente con JARVIS</strong>' +
        '<span>Puoi chiedere diagnostica, GE360, benchmark, modelli e attività operative.</span>'
      feed.append(empty)
    }

    for (const message of this.messages) {
      feed.append(this.createMessageElement(message))
    }

    if (this.activeStreamText) {
      feed.append(
        this.createMessageElement({
          role: 'jarvis',
          text: this.activeStreamText,
          sentAt: Date.now(),
          streaming: true
        })
      )
    } else if (this.isTyping) {
      const typing = createElement(
        'div',
        'jarvis-quick-chat__typing',
        'JARVIS sta lavorando'
      )
      typing.append(
        createElement('span', 'jarvis-quick-chat__typing-dot'),
        createElement('span', 'jarvis-quick-chat__typing-dot'),
        createElement('span', 'jarvis-quick-chat__typing-dot')
      )
      feed.append(typing)
    }

    feed.scrollTop = feed.scrollHeight
  }

  createMessageElement(message) {
    const wrapper = createElement(
      'article',
      'jarvis-quick-chat__message jarvis-quick-chat__message--' + message.role
    )
    const meta = createElement('div', 'jarvis-quick-chat__message-meta')
    meta.append(
      createElement(
        'span',
        'jarvis-quick-chat__message-author',
        message.role === 'owner'
          ? 'Tu'
          : message.role === 'jarvis'
            ? 'JARVIS'
            : 'Sistema'
      ),
      createElement(
        'time',
        'jarvis-quick-chat__message-time',
        formatTime(message.sentAt)
      )
    )

    const text = createElement(
      'p',
      'jarvis-quick-chat__message-text',
      message.text
    )

    wrapper.append(meta, text)

    if (message.streaming) {
      wrapper.classList.add('jarvis-quick-chat__message--streaming')
    }

    if (message.metrics?.tokensPerSecond) {
      wrapper.append(
        createElement(
          'span',
          'jarvis-quick-chat__message-metric',
          Number(message.metrics.tokensPerSecond).toFixed(1) + ' tok/s'
        )
      )
    }

    return wrapper
  }
}
