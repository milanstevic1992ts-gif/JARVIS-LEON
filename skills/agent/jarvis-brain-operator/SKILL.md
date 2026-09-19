---
name: jarvis-brain-operator
description: Inspect and tune JARVIS local performance, Ollama model state and low-resource operating mode using the dedicated JARVIS Brain tool.
metadata:
  author: "GE360 JARVIS"
  version: "0.1.0"
---

# JARVIS Brain Operator

Use this skill when the owner asks why JARVIS is slow, how much RAM/VRAM is used, which model is active, to benchmark JARVIS, switch ECO/NORMAL/BOOST, switch between Qwen 4B and 9B, or unload the model.

## Rules

1. Prefer `jarvis.brain.getStatus` for performance diagnostics instead of guessing.
2. Prefer `jarvis.brain.benchmark` when the owner asks how fast JARVIS is.
3. ECO = Qwen 4B + 32 max agent iterations.
4. NORMAL = Qwen 4B + 64 max agent iterations.
5. BOOST = Qwen 9B + 96 max agent iterations.
6. Never silently install a missing model. Report the exact `ollama pull ...` command.
7. setMode, setModel and unloadModel are GIALLA and require one-time approval.
8. If the tool returns `owner_action_required`, surface the exact `/jarvis approve <id>` command and stop that action.
9. After the owner approves, retry only when the owner repeats the requested action.
10. Do not bypass the approval with shell, curl or direct config-file editing.
11. Restart JARVIS and restart Ollama remain dashboard/system controls, not agent tools, because restarting during an active turn can interrupt the response.

## Diagnostics

If the owner says "perché sei lento?":

- call `getStatus`;
- inspect whether Qwen 9B/BOOST is active;
- inspect RAM/VRAM pressure and whether a model is resident;
- optionally run `benchmark` if useful;
- report measured facts, not guesses.

If the owner says "passa a normal":

- call `setMode(normal)`;
- if approval is required, stop and surface the approval ID;
- do not claim success until the tool confirms it.
