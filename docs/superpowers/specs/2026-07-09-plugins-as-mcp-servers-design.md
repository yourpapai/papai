<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design: Plugins as MCP servers for the coding agent

**Status:** approved (brainstorm), ready for implementation planning
**Date:** 2026-07-09
**Proof target:** expose the `synthetic-web-search` plugin's `search` tool as an MCP endpoint consumable by the coding agent.

## Problem

papai is today an MCP **client** only: it consumes external MCP servers (user `mcp_endpoints` + plugin-declared `mcp` field) and surfaces their tools to the orchestrator LLM. Separately, the coding agent (magi sandbox) consumes an operator-curated **MCP catalog** through the **sandbox MCP broker** — a credential-bearing worker enclosure that translates stdio-MCP → HTTP-MCP to an external upstream.

Several papai plugins expose capabilities a coding agent would benefit from (web search being the obvious first case). There is currently no way to make a plugin's tools available to the coding agent: plugin tools reach only the orchestrator LLM, and the coding MCP catalog only accepts external upstream URLs.

This design inverts the relationship for plugins: a plugin can **act as** an MCP server (a standards-compliant HTTP-MCP upstream), so the coding agent can call back into plugin capabilities. It builds a **general plugin→MCP host layer** (any plugin can opt in; any MCP client could consume it), with the coding agent as the first consumer, proven end-to-end with `synthetic-web-search`.

## Key decisions (settled during brainstorm)

1. **General host layer**, not a coding-agent-only shim. papai grows a reusable MCP server surface; the coding agent is merely its first consumer.
2. **Reuse the existing broker/catalog path.** papai's endpoint is _just another HTTPS upstream_. magi's worker enclosure, mediator gating, `projectSpec.mcp`/`mcpToken` wiring, and INV-1/INV-2 are unchanged. (Rejected alternative: a magi→papai loopback shortcut bypassing the worker enclosure — it breaks the credential/egress isolation invariants and forces magi changes.)
3. **Context binding to the initiator's config-context.** A brokered call executes the plugin tool exactly as if that chat user invoked it — same context config, rate limits, web-fetch quota, and `tool_prefs`. Mirrors Phase 5b identity resolution.
4. **Auto-published internal catalog entries with a papai-minted token.** Eligible plugin-MCP servers surface as first-class catalog options (operator toggles exposure + sets `tool_policy`); no self-referential URL typing, no user-pasted secret — papai derives the binding token per identity at session start.
5. **Manifest flag exposes all registered tools.** A single `mcpServer` flag exposes every tool the plugin registers; the operator's per-tool `tool_policy` does the filtering.
6. **Stateless, time-bounded signed token.** HMAC-signed, no DB lookup, maps straight to the config-context; mass-revoke by rotating the server secret.
7. **Single upstream per session** is retained (existing limitation). Multi-server multiplexing is an explicit follow-up, out of scope here.

## Architecture

### Data flow (proof path)

```
coding agent (sandbox)
  → mcp-tunnel (spawned in sandbox, dials bind-mounted unix socket)
  → magi-main mediator (per-tool tool_policy gate; opaque byte relay)
  → magi mcp-worker enclosure (holds minted token; egress = papai origin host only)
  → HTTPS POST → papai  /mcp/plugin/synthetic-web-search  (streamable-HTTP MCP)
  → papai MCP server surface: verify token → resolve config-context → execute plugin `search`
  → results (text content) back up the same chain
```

Everything from `mcp-tunnel` through the worker enclosure is the **existing** broker, unchanged. The only new surface is papai's HTTP-MCP endpoint and the machinery that publishes it into the catalog and mints its token.

### Component 1 — Plugin manifest opt-in

- New optional field on `pluginManifestSchema` (`src/plugins/types.ts`): `mcpServer: true` (boolean; a `{ enabled: true }` object form may be adopted if future per-server metadata is needed, but boolean is the MVP).
- When set, **all** tools the plugin registers via `registration.registerTool` become MCP-exposable. No per-tool selection at the plugin layer — the operator's `tool_policy` filters.
- The MCP server's advertised name/description derive from the manifest `name`/`description`.
- **Proof change:** add `"mcpServer": true` to `plugins/synthetic-web-search/plugin.json`.

### Component 2 — papai MCP server surface (`src/mcp-server/`, new module)

- One streamable-HTTP MCP endpoint per exposed plugin, at `/mcp/plugin/<pluginId>`.
- Mounted on the debug/settings HTTP server (`src/debug/server.ts`) **before the auth gate**, alongside the transcript-viewer public capability-token routes (`routeTranscriptPaths` precedent, currently ~line 230). It is deliberately public; possession of the signed token is the access control.
- Built on `@modelcontextprotocol/sdk/server` `McpServer` + the `webStandardStreamableHttp` transport (Web `Request`/`Response` — fits Bun's fetch-style server). Run **stateless per request** (no server-held session).
- Handlers:
  - `initialize` → verify the bearer token (Component 3) → resolve the config-context → **fail-closed** reject if the token is invalid/expired or the plugin is no longer active/eligible for that context.
  - `tools/list` → enumerate the plugin's registered tools from the plugin registry (names, descriptions, input schemas).
  - `tools/call` → execute the named tool via the **existing plugin tool runtime**, in the resolved context, so the plugin's normal context config, rate limits, web-fetch quota, and `tool_prefs` all apply exactly as for an in-chat invocation. Return `type: 'text'` content (matches the existing text-only MCP convention; non-text dropped).
- **Failures never break anything upstream:** malformed requests and tool errors surface as JSON-RPC / `{ error }` responses, not process faults.

### Component 3 — Binding token (`src/mcp-server/token.ts`)

- HMAC-SHA256 signed token encoding `{ v, configContextId, pluginId, iat, exp }`, signed with a server secret. Reuse existing key material where possible; a dedicated `MCP_SERVER_SIGNING_SECRET` env var is acceptable if cleaner (documented in `docs/architecture/environment.md`).
- Verification is `timingSafeEqual` on the signature, then `exp` check, then decode `{ configContextId, pluginId }`.
- **Long expiry (≈30 days)** so a token outlasts a long-running coding session. **Revocation is time-based only:** rotating the server secret invalidates all outstanding tokens at once. (No per-token storage or lifecycle UI — a deliberate simplicity trade-off.)
- `mintPluginMcpToken(configContextId, pluginId)` is called by `resolveMcpToken` at session start (Component 5), not stored in the user's vault.
- **No token material in logs**, ever.

### Component 4 — Catalog integration (auto-published internal entries)

- Alongside the operator-typed `mcp_catalog` (`src/coding-credentials/mcp-catalog.ts`), papai computes **internal** entries from active plugins that declare `mcpServer` and are eligible for the platform instance.
- Each internal entry derives:
  - `name` = `plugin:<pluginId>` (e.g. `plugin:synthetic-web-search`),
  - `upstream_url` = `<SETTINGS_PUBLIC_BASE_URL>/mcp/plugin/<pluginId>`,
  - `header` = `Authorization`,
  - `default_tool_policy` / `tool_policy` = **operator-set** (same semantics as external entries).
- Internal and external entries **share the existing Admin → MCP catalog surface** (`AdminMcpCatalogSection`). Internal servers render as a distinct, clearly-labelled group: the operator gets a **toggle (expose on/off) + tool_policy controls only** — `upstream_url`/`header` are derived and not editable. External entries keep the current URL/header editing.
- The user's **Coding MCP servers** section (`CodingMcpSection`) lists internal servers in the same picker as external ones. Selecting an internal server stores only `{ server: 'plugin:<pluginId>' }` in the `mcp` vault namespace — **no** `upstream_token` (papai injects the minted token at resolve time).

### Component 5 — `resolveMcp` / `resolveMcpToken` (`src/coding-credentials/resolve-agent-secrets.ts`)

- `resolveMcp`: when the selected `server` resolves to an **internal** plugin entry:
  - derive `url`/`host`/`allowedHosts` from `SETTINGS_PUBLIC_BASE_URL` + plugin id, `header = 'Authorization'`, `toolPolicy` from the operator's internal-entry policy;
  - **relax** the existing "vault must carry a token" fail-closed guard for internal servers (the token is minted, not stored);
  - **fail-closed** if `SETTINGS_PUBLIC_BASE_URL` is unset, the plugin is disabled/ineligible for the resolved context, or the internal entry is toggled off by the operator.
- `resolveMcpToken`: for an internal plugin server, return `mintPluginMcpToken(configContextId, pluginId)` instead of the vault token. External servers are unchanged.
- **Everything downstream is unchanged:** `buildSessionProjectSpec` → `projectSpec.mcp` + the sibling `mcpToken` field, magi's trust-boundary re-validation, INV-1's staged-secret channel, and the mediator's per-tool gate all operate identically — they cannot tell an internal upstream from an external one.

### Component 6 — Egress / operator requirement

- The worker enclosure's derived egress = `allowedHosts` = `[papai-public-origin host]` (the single host of `SETTINGS_PUBLIC_BASE_URL`).
- The operator must admit that host within the geofront egress **ceiling** (`[egress.policy.ceiling]` in `org.toml`), exactly as for any external upstream; a host outside the ceiling is silently dropped and the session gets no MCP. Documented as a deploy requirement.

### Component 7 — Security posture

- Public endpoint; the signed token is the access control (transcript-viewer trust model). Per request: timing-safe token verify → resolve context → apply the plugin's normal rate limits/quota/permissions → fail-closed if the plugin is ineligible.
- TLS is provided by the HTTPS public origin. No tokens/headers in logs.
- **INV-1 preserved:** the minted token rides magi's staged-secret channel into the worker enclosure only — it never enters the agent sandbox.
- **INV-2 preserved:** the agent gains no new egress; the worker's egress (papai origin host) lives in its own enclosure.
- The plugin's own outbound calls (e.g. `synthetic-web-search` → `api.synthetic.new`) still go through `providerRuntime.httpFetch` and its `providerAllowedHosts` allowlist — unchanged.

## Proof (web-search) — acceptance path

1. Add `"mcpServer": true` to `plugins/synthetic-web-search/plugin.json`; admin config `api_key` set as today.
2. Operator opens **Admin → MCP catalog**, sees `plugin:synthetic-web-search` in the internal-servers group, toggles it on, sets `default_tool_policy: allow`.
3. User selects `plugin:synthetic-web-search` in **Coding MCP servers** (no token to paste).
4. User starts a coding session. magi launches the worker enclosure pointed at `https://<origin>/mcp/plugin/synthetic-web-search` with the minted token; egress restricted to the papai origin host.
5. The coding agent issues a search `tools/call`; it flows sandbox → tunnel → mediator (per-tool gate) → worker → papai endpoint → `search` executes **in the initiator's config-context** → results return up the chain.

## Out of scope / known limitations (carried forward)

- **Single upstream per session** (existing): a session gets one plugin server _or_ one external server, not several, and not multiple plugins. Multi-server multiplexing (array-shaped `projectSpec.mcp`, a routing mediator in magi, N worker enclosures, multi-select settings UI) is a **separate follow-up spec**, not this one.
- **Time-based revocation only** (secret rotation); no per-token revocation/audit UI.
- **Text-only tool output** (existing MCP convention). `'ask'` tool policy = allow-with-warn (existing).

## Module boundaries

| Area                                                       | Change                                                                                 |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `src/mcp-server/` (new)                                    | MCP server surface (route handlers + transport), token mint/verify, plugin-tool bridge |
| `src/plugins/types.ts`                                     | `mcpServer` manifest field on `pluginManifestSchema`                                   |
| `src/coding-credentials/mcp-catalog.ts`                    | compute + merge auto-published internal entries                                        |
| `src/coding-credentials/resolve-agent-secrets.ts`          | internal-entry derivation in `resolveMcp`; minted token in `resolveMcpToken`           |
| `src/debug/server.ts`                                      | mount `/mcp/plugin/<id>` before the auth gate                                          |
| settings UI (`AdminMcpCatalogSection`, `CodingMcpSection`) | internal-server group (admin) + picker entry (user)                                    |
| `plugins/synthetic-web-search/plugin.json`                 | `mcpServer: true` (proof)                                                              |
| `docs/architecture/environment.md`                         | signing secret (if new) + geofront ceiling deploy note                                 |

## Testing

- **Token** — mint/verify round-trip; tamper (signature mismatch) rejected; expiry rejected; timing-safe comparison.
- **Manifest schema** — accepts `mcpServer: true`; rejects malformed forms.
- **MCP server route** — `initialize`/`tools/list`/`tools/call` against a fake plugin registry; unauthorized/invalid token → rejected; ineligible/disabled plugin → fail-closed; tool error surfaces as a JSON-RPC/`{ error }` response, not a fault.
- **`resolveMcp`/`resolveMcpToken`** — internal-entry derivation; fail-closed when `SETTINGS_PUBLIC_BASE_URL` unset, plugin disabled, or operator toggle off; external-entry behavior unchanged.
- **Catalog** — auto-published internal-entry merge; admin section renders internal group (toggle + policy only); user picker stores `{ server }` without a token.
- **E2E (Linux, same-kernel)** — reuse the existing broker E2E harness with papai's own origin as the upstream: operator toggle → user pick → session → agent search call → result, plus a denied-tool policy still blocked at the mediator.
