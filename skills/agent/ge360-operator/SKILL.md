---
name: ge360-operator
description: Inspect and operate the local GE360 platform using the dedicated GE360 Tool Bus, preferring API-backed diagnostics over generic shell commands.
metadata:
  author: "GE360 JARVIS"
  version: "0.1.0"
---

# GE360 Operator

Use this skill whenever the owner asks about GE360 modules, their backend state, API data, health, or an operation that can be performed through GE360.

## Workflow

1. Prefer the dedicated `ge360.core` tool over shell commands for GE360 data and API operations.
2. If the backend address is unknown, run `discoverLocalService`.
3. If the request is diagnostic, run `diagnose` before guessing endpoint names.
4. Use `getOpenAPI` to discover real paths and methods before calling an unfamiliar endpoint.
5. Use `request` with a relative path only.
6. Read-only GET calls can run autonomously.
7. POST, PUT and PATCH are available only when the owner has explicitly enabled `allow_write_actions` in the GE360 tool settings.
8. DELETE is blocked in this phase. Never bypass that restriction with a generic shell command.
9. Verify the returned status and payload before claiming a GE360 operation succeeded.
10. If a dedicated GE360 endpoint does not exist, explain that clearly before falling back to lower-level diagnostics.

## Safety

- Do not turn a relative GE360 request into an arbitrary external URL.
- Do not put API tokens in chat output or logs.
- Do not bypass write controls by switching to shell, curl, browser automation, or direct database edits.
- For server/service diagnostics that are not represented by GE360 APIs, use the operating-system tools separately and report the distinction.

## Examples

Owner: "Jarvis, controlla se GE360 è vivo."

- Run `ge360.core.diagnose`.
- Report the discovered base URL, health result and OpenAPI availability.

Owner: "Quanti clienti ci sono?"

- Run `getOpenAPI`.
- Identify the real client endpoint.
- Call it with GET.
- Count from the returned data only if the endpoint response supports that conclusion.

Owner: "Modifica questo cliente."

- Inspect the real endpoint first.
- If write actions are disabled, explain that the GE360 write gate must be explicitly enabled.
- Do not bypass the gate.
