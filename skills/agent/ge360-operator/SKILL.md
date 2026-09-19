---
name: ge360-operator
description: Inspect and operate the local GE360 platform using the dedicated GE360 Tool Bus, OpenAPI-backed resource resolution, and JARVIS safety policy.
metadata:
  author: "GE360 JARVIS"
  version: "0.2.0"
---

# GE360 Operator

Use this skill whenever the owner asks about GE360 modules, backend state, API data, diagnostics, or an operation that can be performed through GE360.

## Workflow

1. Prefer the dedicated `ge360.core` tool over generic shell commands for GE360 data and API operations.
2. If the backend address is unknown, run `discoverLocalService`.
3. For diagnostics, run `diagnose`.
4. Use `discoverResources` before guessing module endpoint paths.
5. For Cantieri, Clienti, Preventivi, Spese, Materiali, Attrezzi, Furgone and Marketing, prefer `listResource` and `getResource`.
6. Use `getOpenAPI` and generic `request` only when a dedicated resource adapter is insufficient.
7. Verify the returned status and payload before claiming success.
8. If the backend exposes no matching endpoint, report that instead of inventing one.

## JARVIS safety policy

- VERDE: read-only GET, discovery and diagnostics. Execute automatically.
- GIALLA: reversible writes such as ordinary POST, PUT or PATCH. Require a one-time owner approval by default.
- ROSSA: DELETE and sensitive external-effect actions such as send, publish, campaign, email/message, payment or invoice-like operations. Always require one-time owner approval.
- The approval is fingerprinted to the exact action and expires. It cannot authorize a different path/body or be reused after consumption.
- When a tool returns `owner_action_required`, tell the owner to use the exact `/jarvis approve <id>` command shown by the tool, then repeat the original request.
- Never call `/jarvis approve` yourself and never bypass a blocked action using shell, curl, browser automation or a direct database edit.
- If the owner denies the action, stop that action.

## Safety

- Only relative GE360 paths are valid. Arbitrary external URLs are blocked.
- Do not expose API tokens, secrets, passwords or authorization headers.
- Respect `writes_enabled=false` as a master emergency stop.
- For server/service diagnostics not represented by GE360 APIs, use operating-system tools separately and make that distinction explicit.

## Examples

Owner: "Jarvis, controlla se GE360 è vivo."

- Run `ge360.core.diagnose`.
- Report base URL, health and OpenAPI state.

Owner: "Quanti clienti ci sono?"

- Run `ge360.core.listResource` with `resource=clienti`.
- Count only from the returned payload when its shape supports that conclusion.

Owner: "Modifica questo cliente."

- Resolve the endpoint from OpenAPI.
- The write should be classified GIALLA unless sensitive semantics promote it to ROSSA.
- If approval is requested, stop and surface the exact approval command.
- After the owner approves and repeats the request, retry the exact same action.

Owner: "Elimina questo preventivo."

- The DELETE is ROSSA.
- Require a one-time owner approval.
- Never bypass the policy.
