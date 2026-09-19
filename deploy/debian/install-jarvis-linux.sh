#!/usr/bin/env bash
set -euo pipefail

MODEL="${JARVIS_MODEL:-qwen3.5:4b}"
PROFILE="${LEON_PROFILE:-just-me}"
ENABLE_OLLAMA_RESTART=0
RUN_BENCHMARK=1

for arg in "$@"; do
  case "$arg" in
    --enable-ollama-restart)
      ENABLE_OLLAMA_RESTART=1
      ;;
    --no-benchmark)
      RUN_BENCHMARK=0
      ;;
    *)
      echo "Argomento sconosciuto: $arg"
      echo "Uso: bash deploy/debian/install-jarvis-linux.sh [--enable-ollama-restart] [--no-benchmark]"
      exit 2
      ;;
  esac
done

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd -- "${SCRIPT_DIR}/../.." && pwd)"

log() {
  printf '\n\033[1;36m[JARVIS]\033[0m %s\n' "$*"
}

ok() {
  printf '\033[1;32m[OK]\033[0m %s\n' "$*"
}

warn() {
  printf '\033[1;33m[WARN]\033[0m %s\n' "$*"
}

die() {
  printf '\033[1;31m[ERRORE]\033[0m %s\n' "$*" >&2
  exit 1
}

if [[ "${EUID}" -eq 0 ]]; then
  die "Non eseguire tutto come root. Avvia questo script come utente normale; userà sudo solo quando serve."
fi

if [[ ! -f "${REPO_DIR}/package.json" ]]; then
  die "Repository JARVIS non valida: ${REPO_DIR}"
fi

if ! command -v sudo >/dev/null 2>&1; then
  die "sudo non trovato."
fi

if ! sudo -v; then
  die "Autorizzazione sudo fallita."
fi

if [[ -f /etc/os-release ]]; then
  . /etc/os-release
else
  die "/etc/os-release non trovato."
fi

case "${ID:-}" in
  debian|ubuntu|linuxmint|pop)
    ;;
  *)
    warn "Distribuzione ${ID:-sconosciuta} non testata. Proseguo perché il sistema usa apt se disponibile."
    ;;
esac

if ! command -v apt-get >/dev/null 2>&1; then
  die "Questo installer richiede una distribuzione Debian/Ubuntu con apt-get."
fi

ARCH="$(uname -m)"
if [[ "${ARCH}" != "x86_64" && "${ARCH}" != "amd64" ]]; then
  die "Architettura non supportata da questo profilo: ${ARCH}. Atteso x86_64/amd64."
fi

log "1/10 · Pacchetti di sistema"
sudo apt-get update
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y \
  ca-certificates \
  curl \
  git \
  jq \
  xz-utils \
  build-essential \
  python3 \
  python3-venv \
  python3-pip \
  pkg-config

ok "Dipendenze Linux installate."

log "2/10 · Node.js 24 LTS"
NODE_MAJOR=0
if command -v node >/dev/null 2>&1; then
  NODE_VERSION="$(node -p 'process.versions.node' 2>/dev/null || true)"
  NODE_MAJOR="${NODE_VERSION%%.*}"
fi

if ! [[ "${NODE_MAJOR}" =~ ^[0-9]+$ ]] || (( NODE_MAJOR < 24 )); then
  log "Installo nvm e Node.js 24 per l'utente ${USER}..."
  export NVM_DIR="${HOME}/.nvm"

  if [[ ! -s "${NVM_DIR}/nvm.sh" ]]; then
    curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.7/install.sh | bash
  fi

  # shellcheck disable=SC1091
  . "${NVM_DIR}/nvm.sh"
  nvm install 24
  nvm alias default 24
  nvm use 24
else
  ok "Node.js già compatibile: $(node -v)"
fi

if ! command -v npm >/dev/null 2>&1; then
  die "npm non disponibile dopo l'installazione di Node.js."
fi

log "3/10 · pnpm"
if ! command -v pnpm >/dev/null 2>&1 || [[ "$(pnpm --version 2>/dev/null || true)" != "12.4.1" ]]; then
  npm install --global pnpm@12.4.1
fi
ok "pnpm $(pnpm --version)"

log "4/10 · Ollama"
if ! command -v ollama >/dev/null 2>&1; then
  log "Installo Ollama dal programma di installazione ufficiale..."
  curl -fsSL https://ollama.com/install.sh | sh
else
  ok "Ollama già installato: $(command -v ollama)"
fi

if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files ollama.service >/dev/null 2>&1; then
  sudo systemctl enable --now ollama.service
fi

for _ in {1..20}; do
  if curl -fsS --max-time 2 http://127.0.0.1:11434/api/version >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if ! curl -fsS --max-time 3 http://127.0.0.1:11434/api/version >/dev/null 2>&1; then
  die "Ollama installato ma non risponde su 127.0.0.1:11434."
fi

log "5/10 · Dipendenze e bootstrap JARVIS"
cd "${REPO_DIR}"

export LEON_PROFILE="${PROFILE}"
export GITHUB_ACTIONS=1
export JARVIS_OLLAMA_BASE_URL="http://127.0.0.1:11434/v1"

pnpm install --frozen-lockfile

unset GITHUB_ACTIONS

ok "Bootstrap JARVIS completato."

log "6/10 · Profilo low-resource GE360"
pnpm run jarvis:low-resource

log "7/10 · Ollama low-resource + modello ${MODEL}"
JARVIS_MODEL="${MODEL}" pnpm run jarvis:prepare-ai

if ! ollama list 2>/dev/null | awk 'NR>1 {print $1}' | grep -Fxq "${MODEL}"; then
  die "Il modello ${MODEL} non risulta installato dopo prepare-ai."
fi

log "8/10 · Build production"
pnpm run build

if [[ ! -f server/dist/index.js ]]; then
  die "Build server non trovata: server/dist/index.js"
fi

if [[ ! -f app/dist/index.html ]]; then
  die "Build interfaccia non trovata: app/dist/index.html"
fi

ok "Build production completata."

log "9/10 · Servizio systemd"
sudo bash deploy/debian/install-service.sh
sudo systemctl restart ge360-jarvis.service

sleep 3

if sudo systemctl is-active --quiet ge360-jarvis.service; then
  ok "ge360-jarvis.service attivo."
else
  sudo systemctl status ge360-jarvis.service --no-pager || true
  die "JARVIS non è partito correttamente."
fi

if (( ENABLE_OLLAMA_RESTART == 1 )); then
  log "Abilito Restart Ollama dal Brain Dashboard con privilegio minimo"
  sudo bash deploy/debian/enable-brain-service-control.sh
else
  warn "Restart Ollama dal Brain resta bloccato. Per abilitarlo in seguito:"
  echo "  sudo bash deploy/debian/enable-brain-service-control.sh"
fi

log "10/10 · Diagnostica"
pnpm run jarvis:doctor || true

if (( RUN_BENCHMARK == 1 )); then
  echo
  log "Benchmark finale"
  JARVIS_MODEL="${MODEL}" pnpm run jarvis:benchmark || warn "Benchmark non completato; JARVIS resta installato."
fi

echo
echo "============================================================"
echo " GE360 JARVIS INSTALLATO"
echo "============================================================"
echo
echo " Interfaccia locale: http://127.0.0.1:5366"
echo " Modello:           ${MODEL}"
echo " Profilo:           ${PROFILE}"
echo
echo " Stato:"
echo "   systemctl status ge360-jarvis --no-pager"
echo
echo " Log:"
echo "   journalctl -u ge360-jarvis -f"
echo
echo " Doctor:"
echo "   cd '${REPO_DIR}' && pnpm run jarvis:doctor"
echo
echo " Brain Dashboard:"
echo "   apri JARVIS e premi Brain"
echo
echo "============================================================"
