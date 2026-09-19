#!/usr/bin/env bash
set -euo pipefail

NODE_BIN="${JARVIS_NODE_BIN:-node}"

if [[ ! -x "${NODE_BIN}" ]]; then
  echo "JARVIS Node binary non eseguibile: ${NODE_BIN}" >&2
  exit 1
fi

if [[ ! -f server/dist/pre-check.js || ! -f server/dist/index.js ]]; then
  echo "Build JARVIS mancante. Esegui pnpm run build." >&2
  exit 1
fi

"${NODE_BIN}" server/dist/pre-check.js
exec "${NODE_BIN}" server/dist/index.js
