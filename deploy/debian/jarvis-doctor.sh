#!/usr/bin/env bash
set -u

MODEL="${JARVIS_MODEL:-qwen3.5:4b}"
PASS=0
WARN=0
FAIL=0

ok()   { printf '  [OK]   %s\n' "$*"; PASS=$((PASS + 1)); }
warn() { printf '  [WARN] %s\n' "$*"; WARN=$((WARN + 1)); }
fail() { printf '  [FAIL] %s\n' "$*"; FAIL=$((FAIL + 1)); }

echo "GE360 JARVIS Doctor · Low Resource"
echo "=================================="

if command -v free >/dev/null 2>&1; then
  MEM_MB="$(free -m | awk '/^Mem:/ {print $2}')"
  SWAP_MB="$(free -m | awk '/^Swap:/ {print $2}')"
  ok "RAM rilevata: ${MEM_MB:-?} MB"

  if [[ "${SWAP_MB:-0}" =~ ^[0-9]+$ ]] && (( SWAP_MB >= 2048 )); then
    ok "Swap di sicurezza: ${SWAP_MB} MB"
  else
    warn "Swap bassa o assente (${SWAP_MB:-0} MB). 2-4 GB di swap aiutano a evitare OOM nei picchi."
  fi
fi

if command -v nvidia-smi >/dev/null 2>&1; then
  GPU_INFO="$(nvidia-smi --query-gpu=name,memory.total,memory.free --format=csv,noheader,nounits 2>/dev/null | head -n 1 || true)"
  if [[ -n "${GPU_INFO}" ]]; then
    ok "GPU NVIDIA: ${GPU_INFO} MB (nome, VRAM totale, VRAM libera)"
  else
    warn "nvidia-smi presente ma dati GPU non leggibili"
  fi
else
  warn "nvidia-smi non trovato: Ollama potrebbe usare CPU"
fi

if command -v node >/dev/null 2>&1; then
  NODE_VERSION="$(node -p 'process.versions.node' 2>/dev/null || true)"
  NODE_MAJOR="${NODE_VERSION%%.*}"
  if [[ "${NODE_MAJOR}" =~ ^[0-9]+$ ]] && (( NODE_MAJOR >= 24 )); then
    ok "Node.js ${NODE_VERSION}"
  else
    fail "Node.js ${NODE_VERSION:-sconosciuto}; JARVIS richiede Node >= 24"
  fi
else
  fail "Node.js non trovato"
fi

if command -v pnpm >/dev/null 2>&1; then
  ok "pnpm $(pnpm --version 2>/dev/null || echo '?')"
else
  fail "pnpm non trovato"
fi

if command -v ollama >/dev/null 2>&1; then
  ok "Ollama trovato: $(command -v ollama)"
  if curl -fsS --max-time 3 http://127.0.0.1:11434/api/version >/dev/null 2>&1; then
    ok "Ollama API risponde su 127.0.0.1:11434"
  else
    warn "Ollama installato ma API non raggiungibile su 127.0.0.1:11434"
  fi

  if ollama list 2>/dev/null | awk 'NR>1 {print $1}' | grep -Fxq "${MODEL}"; then
    ok "Modello low-resource ${MODEL} presente"
  else
    warn "Modello ${MODEL} non presente. Esegui: ollama pull ${MODEL}"
  fi

  OLLAMA_PS="$(ollama ps 2>/dev/null || true)"
  if [[ -n "${OLLAMA_PS}" ]]; then
    echo
    echo "  Ollama ps:"
    echo "${OLLAMA_PS}" | sed 's/^/    /'
    if echo "${OLLAMA_PS}" | grep -Fq '100% CPU'; then
      warn "Il modello sta girando 100% CPU: sul tuo Debian sarà molto più lento della GPU."
    fi
  fi
else
  fail "Ollama non trovato"
fi

if systemctl cat ollama.service 2>/dev/null | grep -Fq 'OLLAMA_CONTEXT_LENGTH=8192'; then
  ok "Ollama context low-resource: 8192"
else
  warn "Override Ollama low-resource non rilevato. Esegui jarvis:prepare-ai."
fi

if systemctl cat ollama.service 2>/dev/null | grep -Fq 'OLLAMA_MAX_LOADED_MODELS=1'; then
  ok "Ollama limita i modelli caricati a 1"
else
  warn "OLLAMA_MAX_LOADED_MODELS=1 non rilevato"
fi

if [[ -f package.json && -f config.sample.yml ]]; then
  ok "Repository JARVIS rilevata"
else
  warn "Esegui doctor dalla root di JARVIS-LEON per controllare la repository"
fi

if [[ -f config.sample.yml ]] &&
   grep -Fq 'default: ollama/qwen3.5:4b' config.sample.yml &&
   grep -Fq 'agent_max_iterations: 64' config.sample.yml; then
  ok "Default JARVIS low-resource presente"
else
  warn "Default low-resource non rilevato in config.sample.yml"
fi

if systemctl list-unit-files ge360-jarvis.service >/dev/null 2>&1; then
  if systemctl is-active --quiet ge360-jarvis.service; then
    ok "ge360-jarvis.service attivo"
  else
    warn "ge360-jarvis.service installato ma non attivo"
  fi
else
  warn "ge360-jarvis.service non ancora installato"
fi

if curl -fsS --max-time 3 http://127.0.0.1:5366 >/dev/null 2>&1; then
  ok "Interfaccia JARVIS raggiungibile su http://127.0.0.1:5366"
else
  warn "Interfaccia JARVIS non raggiungibile sulla porta 5366"
fi

GE360_FOUND=""
for BASE in   "${GE360_BASE_URL:-}"   "http://127.0.0.1:8000"   "http://127.0.0.1:8788"   "http://127.0.0.1:8787"   "http://127.0.0.1:3000"; do
  [[ -z "${BASE}" ]] && continue
  if curl -fsS --max-time 2 "${BASE%/}/openapi.json" >/dev/null 2>&1 ||
     curl -fsS --max-time 2 "${BASE%/}/health" >/dev/null 2>&1 ||
     curl -fsS --max-time 2 "${BASE%/}/api/health" >/dev/null 2>&1; then
    GE360_FOUND="${BASE%/}"
    break
  fi
done

if [[ -n "${GE360_FOUND}" ]]; then
  ok "Backend GE360 rilevato: ${GE360_FOUND}"
else
  warn "Backend GE360 non rilevato sui localhost comuni; configura GE360_BASE_URL se usa un'altra porta"
fi

echo
echo "Risultato: ${PASS} OK, ${WARN} warning, ${FAIL} errori"

if (( FAIL > 0 )); then
  exit 1
fi
