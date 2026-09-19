# Deploy Debian · Low Resource

Questa configurazione è pensata per il server GE360 con risorse limitate: un solo modello locale alla volta, contesto controllato, niente processi AI autonomi in background e servizio Node con memoria contenuta.

## Profilo consigliato

- Modello: `qwen3.5:4b`
- Context Ollama/JARVIS: 8192 token
- Richieste Ollama parallele: 1
- Modelli Ollama caricati: 1
- Tool JARVIS paralleli: 2
- Agent max iterations: 64
- Pulse autonomo: off
- Private diary: off
- ASR/TTS/wake word: off finché non servono
- KV cache Ollama: `q8_0`
- Keep alive modello: 2 minuti

Il modello 9B resta utilizzabile manualmente, ma non è più il default del server.

## 1. Pull e dipendenze

```bash
git pull
pnpm install
pnpm run build
```

Il servizio di produzione usa `server/dist`; il build va eseguito dopo gli aggiornamenti del codice.

## 2. Migra il profilo esistente

```bash
pnpm run jarvis:low-resource
```

Il comando crea prima un backup timestampato del `config.yml` del profilo. Non modifica token/API key.

## 3. Configura Ollama e scarica Qwen 4B

```bash
pnpm run jarvis:prepare-ai
```

Questo applica il drop-in systemd `ollama-low-resource.conf`, riavvia Ollama, scarica `qwen3.5:4b` se manca e fa un test.

## 4. Installa/aggiorna il servizio JARVIS

```bash
sudo bash deploy/debian/install-service.sh
sudo systemctl restart ge360-jarvis
```

## 5. Diagnostica

```bash
pnpm run jarvis:doctor
```

Controlla Node, pnpm, RAM, swap, NVIDIA/VRAM, Ollama, modello caricato, configurazione low-resource, servizio JARVIS e backend GE360.

Per vedere se il modello è tutto su GPU:

```bash
ollama ps
```

`100% GPU` è l'obiettivo. Un fallback importante su CPU sarà molto più lento sul server.

## Log

```bash
journalctl -u ge360-jarvis -f
journalctl -u ollama -f
```

## Nota sulla swap

Con RAM limitata è consigliabile avere almeno 2-4 GB di swap come rete di sicurezza contro picchi/OOM. La swap non sostituisce la RAM e non deve essere usata normalmente per l'inferenza.

## GE360 Tool Bus

Il tool `ge360.core` cerca il backend solo su localhost. Per una porta diversa:

```bash
export GE360_BASE_URL=http://127.0.0.1:PORTA
```

Le policy VERDE/GIALLA/ROSSA restano attive indipendentemente dal profilo low-resource.


## Brain Dashboard: Restart Ollama

Per sicurezza il pulsante **Restart Ollama** è bloccato per default.

Se vuoi abilitarlo, JARVIS non riceve sudo generale. Lo script seguente crea una regola sudoers limitata esclusivamente a `systemctl restart ollama.service` e abilita la relativa variabile nel servizio:

```bash
sudo bash deploy/debian/enable-brain-service-control.sh
```

Per revocare il permesso:

```bash
sudo bash deploy/debian/disable-brain-service-control.sh
```

Gli altri controlli Brain restano disponibili senza questo permesso.
