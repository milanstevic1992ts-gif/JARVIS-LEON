#!/usr/bin/env bash
set -euo pipefail

MODEL="${JARVIS_MODEL:-qwen3.5:9b}"

if ! command -v ollama >/dev/null 2>&1; then
  echo "Ollama non è installato."
  echo "Installa Ollama sul Debian, poi rilancia questo script."
  exit 1
fi

if ! curl -fsS --max-time 3 http://127.0.0.1:11434/api/version >/dev/null 2>&1; then
  echo "Avvio ollama.service..."
  if command -v systemctl >/dev/null 2>&1; then
    sudo systemctl start ollama
  fi
fi

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
echo "AI locale pronta."
