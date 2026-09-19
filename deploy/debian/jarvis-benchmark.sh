#!/usr/bin/env bash
set -euo pipefail

MODEL="${JARVIS_MODEL:-qwen3.5:4b}"
URL="${OLLAMA_URL:-http://127.0.0.1:11434/api/generate}"

if ! command -v curl >/dev/null 2>&1 || ! command -v python3 >/dev/null 2>&1; then
  echo "Servono curl e python3."
  exit 1
fi

echo "GE360 JARVIS benchmark"
echo "Model: ${MODEL}"
echo

PAYLOAD="$(python3 - "${MODEL}" <<'PY'
import json, sys
model = sys.argv[1]
print(json.dumps({
    "model": model,
    "prompt": "Rispondi in italiano con una frase breve: sistema operativo pronto.",
    "stream": False,
    "options": {
        "num_ctx": 8192,
        "temperature": 0.2,
        "num_predict": 80
    },
    "keep_alive": "2m"
}))
PY
)"

START="$(date +%s%N)"
RESPONSE="$(curl -fsS --max-time 180 "${URL}" -d "${PAYLOAD}")"
END="$(date +%s%N)"

printf '%s' "${RESPONSE}" | python3 -c '
import json, sys
data = json.load(sys.stdin)
start = int(sys.argv[1])
end = int(sys.argv[2])

def ns_to_s(value):
    return float(value or 0) / 1_000_000_000

eval_count = int(data.get("eval_count") or 0)
eval_duration = ns_to_s(data.get("eval_duration"))
prompt_count = int(data.get("prompt_eval_count") or 0)
prompt_duration = ns_to_s(data.get("prompt_eval_duration"))
load_duration = ns_to_s(data.get("load_duration"))
wall = (end - start) / 1_000_000_000

eval_tps = eval_count / eval_duration if eval_duration > 0 else 0
prompt_tps = prompt_count / prompt_duration if prompt_duration > 0 else 0

print(f"Wall time:        {wall:.2f}s")
print(f"Model load:       {load_duration:.2f}s")
print(f"Prompt tokens:    {prompt_count}")
print(f"Prompt speed:     {prompt_tps:.1f} tok/s")
print(f"Generated tokens: {eval_count}")
print(f"Generation speed: {eval_tps:.1f} tok/s")
print(f"Response:         {data.get(chr(114)+chr(101)+chr(115)+chr(112)+chr(111)+chr(110)+chr(115)+chr(101), str()).strip()}")
' "${START}" "${END}"

echo
echo "Ollama memory placement:"
ollama ps 2>/dev/null || true
