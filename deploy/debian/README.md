# Deploy Debian

Questi file preparano JARVIS per l'host Debian senza cambiare la struttura interna ereditata da Leon.

## 1. Controllo prerequisiti

Dalla root della repository:

```bash
bash deploy/debian/jarvis-doctor.sh
```

JARVIS richiede Node.js 24+, pnpm e Ollama. Il modello locale predefinito è `qwen3.5:9b`.

## 2. Preparazione AI locale

Quando Ollama è già installato:

```bash
bash deploy/debian/prepare-local-ai.sh
```

Lo script scarica il modello solo se manca e fa un piccolo test locale.

## 3. Dipendenze JARVIS

```bash
pnpm install
pnpm run check
```

## 4. Servizio systemd

```bash
sudo bash deploy/debian/install-service.sh
sudo systemctl start ge360-jarvis
systemctl status ge360-jarvis
```

Log:

```bash
journalctl -u ge360-jarvis -f
```

L'interfaccia predefinita resta locale sulla porta 5366. L'esposizione via Tailscale/reverse proxy va configurata separatamente, così il servizio non viene pubblicato accidentalmente su Internet.

## GE360 Tool Bus

Il tool `ge360.core` cerca il backend solo su localhost. Per una porta diversa:

```bash
export GE360_BASE_URL=http://127.0.0.1:PORTA
```

Oppure configurare il file profilo generato per `tools/ge360/core/settings.json`.

Le scritture API restano disabilitate per default.
