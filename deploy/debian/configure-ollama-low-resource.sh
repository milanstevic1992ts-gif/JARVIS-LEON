#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_CONF="${SCRIPT_DIR}/ollama-low-resource.conf"
DROPIN_DIR="/etc/systemd/system/ollama.service.d"
DROPIN_PATH="${DROPIN_DIR}/jarvis-low-resource.conf"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Esegui con sudo: sudo bash deploy/debian/configure-ollama-low-resource.sh"
  exit 1
fi

if ! systemctl list-unit-files ollama.service >/dev/null 2>&1; then
  echo "ollama.service non trovato."
  exit 1
fi

install -d -m 0755 "${DROPIN_DIR}"
install -m 0644 "${SOURCE_CONF}" "${DROPIN_PATH}"

systemctl daemon-reload
systemctl restart ollama.service

echo "Profilo Ollama low-resource applicato:"
echo "  context:      8192"
echo "  parallel:     1"
echo "  loaded models:1"
echo "  keep alive:   2m"
echo "  KV cache:     q8_0"
echo "  cloud:        off"
