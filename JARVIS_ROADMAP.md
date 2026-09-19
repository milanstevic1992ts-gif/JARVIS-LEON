# GE360 JARVIS Roadmap

## Stato

Base upstream: Leon 2.0 `develop`.

Cervello locale predefinito: Ollama + `qwen3.5:9b`.

## Fase 1 — Base AI

- [x] Import Leon 2.0 nella repository JARVIS-LEON.
- [x] Conservazione licenza/provenienza upstream.
- [x] Provider Ollama nativo.
- [x] Qwen locale come modello predefinito.
- [x] Configurazione italiana.
- [x] CI dedicata alle modifiche JARVIS.

## Fase 2 — Identità e GE360

- [x] Identità JARVIS persistente nel generatore di contesto.
- [x] Runtime context rinominato JARVIS.
- [x] Banner installer JARVIS.
- [x] Branding principale interfaccia web.
- [x] Primo GE360 Tool Bus.
- [x] Discovery localhost GE360.
- [x] Diagnostica health/OpenAPI.
- [x] GET API controllate.
- [x] Gate esplicito per POST/PUT/PATCH.
- [x] DELETE bloccato.
- [x] Skill agente `ge360-operator`.
- [ ] Collegare endpoint specifici Cantieri.
- [ ] Collegare Clienti.
- [ ] Collegare Preventivi.
- [ ] Collegare Spese.
- [ ] Collegare Materiali/Attrezzi/Furgone.
- [ ] Collegare Marketing/Prospex.
- [x] Resolver OpenAPI dinamico per Clienti/Cantieri/Preventivi/Spese/Materiali/Attrezzi/Furgone/Marketing.

## Fase 3 — Voce

- [x] Interfaccia e messaggi voce rinominati JARVIS.
- [ ] Modello wake word dedicato "Jarvis".
- [ ] Test microfono continuo e anti-eco.
- [x] ASR collegato alla lingua del profilo con hotword contestuali JARVIS.
- [ ] Tuning ASR italiano su microfono reale.
- [ ] TTS italiano predefinito.
- [ ] Modalità push-to-talk + wake word.

## Fase 4 — Debian

- [x] Installer guidato del servizio Debian.
- [x] Service `ge360-jarvis.service`.
- [x] Verifica automatica Ollama.
- [x] Download/pull Qwen.
- [x] Healthcheck.
- [ ] Logrotate.
- [ ] Upgrade sicuro dalla repository GitHub.

## Fase 5 — Autonomia controllata

- [x] Policy Verde: lettura, ricerca, analisi, diagnostica.
- [x] Policy Gialla: modifiche reversibili con approvazione one-shot predefinita.
- [x] Policy Rossa: invii, cancellazioni e modifiche critiche con approvazione one-shot obbligatoria.
- [x] Audit log policy GE360/JARVIS con redazione segreti.
- [ ] Rollback per operazioni supportate.
