#!/usr/bin/env bash
set -euo pipefail

MODEL="${JARVIS_MODEL:-qwen3.5:4b}"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v ollama >/dev/null 2>&1; then
  echo "Ollama non è installato."
  echo "Installa Ollama sul Debian, poi rilancia questo script."
  exit 1
fi

if command -v systemctl >/dev/null 2>&1 &&
   systemctl list-unit-files ollama.service >/dev/null 2>&1; then
  echo "Applico il profilo Ollama low-resource..."
  sudo bash "${SCRIPT_DIR}/configure-ollama-low-resource.sh"
elif ! curl -fsS --max-time 3 http://127.0.0.1:11434/api/version >/dev/null 2>&1; then
  echo "Ollama non risponde su 127.0.0.1:11434."
  exit 1
fi

# Free memory if the previous 9B model is still resident.
ollama stop qwen3.5:9b >/dev/null 2>&1 || true

echo "Verifica modello: ${MODEL}"
if ollama list 2>/dev/null | awk 'NR>1 {print $1}' | grep -Fxq "${MODEL}"; then
  echo "Modello già presente."
else
  echo "Download modello ${MODEL}..."
  ollama pull "${MODEL}"
fi

echo
echo "Test modello..."
ollama run "${MODEL}" "Rispondi soltanto con: JARVIS READY" 2>/dev/null | tail -n 5

echo
echo "Stato memoria Ollama:"
ollama ps 2>/dev/null || true

echo
echo "AI locale pronta in profilo low-resource."
