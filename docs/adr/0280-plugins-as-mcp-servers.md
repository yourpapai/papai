<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0280: Plugins as MCP Servers

## Status

Implemented (with divergence)

## Date

2026-07-09

## Context

papai was, until this work, an MCP **client** only: it consumes external MCP upstreams (the user `mcp` vault + the operator external `mcp_catalog`) and surfaces their tools to the orchestrator LLM via `src/mcp/`. Separately, the sandboxed coding agent (magi) consumes an operator-curated MCP catalog through the **sandbox MCP broker** — a credential-bearing worker enclosure that translates stdio-MCP → HTTP-MCP to an external upstream, with per-tool gating in the mediator and the INV-1/INV-2 isolation invariants.

Several papai plugins expose capabilities a coding agent would benefit from (web search being the obvious first case), but there was no path from a plugin's registered tools to the coding agent: plugin tools reach only the orchestrator LLM, and the coding MCP catalog only accepts external upstream URLs the operator types and the user pastes a token for.

The design (`docs/superpowers/specs/2026-07-09-plugins-as-mcp-servers-design.md`) and plan (`docs/superpowers/plans/2026-07-09-plugins-as-mcp-servers.md`) invert the relationship for plugins: a plugin can **act as** a standards-compliant streamable-HTTP MCP **server** (an upstream like any other), so the coding agent can call back into plugin capabilities. The work builds a **general plugin → MCP host layer** (`src/mcp-server/`) — any plugin can opt in, any MCP client could consume it — with the coding agent as the first consumer, proven end-to-end with `synthetic-web-search`'s `search` tool.

The constraint that shaped every decision: papai's endpoint must be _just another HTTPS upstream_ to the existing broker. magi, its worker enclosure, the mediator per-tool gate, the `projectSpec.mcp`/`mcpToken` wiring, and INV-1/INV-2 are all unchanged — the new surface must be invisible to magi.

## Decision Drivers

- **General host layer, not a coding-agent-only shim.** The MCP server surface must be reusable; the coding agent is merely the first consumer, so the design must not leak coding-session concepts into the host layer.
- **Reuse the existing broker/catalog path unchanged.** papai's endpoint is an opaque HTTPS upstream to the broker; magi, the worker enclosure, the mediator gate, `projectSpec.mcp`/`mcpToken`, and INV-1/INV-2 must be untouched (a magi→papai loopback shortcut was explicitly rejected — it breaks the credential/egress isolation invariants and forces magi changes).
- **Context binding to the initiator.** A brokered call must execute the plugin tool exactly as if the chat user invoked it in-chat — same context config, rate limits, web-fetch quota, and `tool_prefs`.
- **No new operator/user secret-pasting papai-internal surface.** Internal plugin servers must surface as first-class catalog options the operator toggles + policies and the user picks with no token to paste; papai mints the binding credential per identity at session start.
- **Manifest flag exposes all registered tools.** A single `mcpServer` flag opts in; the operator's per-tool `tool_policy` does the filtering, mirroring the external catalog semantics.
- **Stateless, fail-closed access control.** The HTTP endpoint is public; possession of a signed, time-bounded HMAC token is the access control (transcript-viewer trust model). No DB lookup per call; revocation is by secret rotation; eligibility is re-checked on every redemption.
- **Secure starting point.** An admin draft defaults to `enabled: false` + `default_tool_policy: 'deny'`; the operator consciously opens it up.
- **No ripple into magi or the user vault shape.** The minted token rides magi's existing staged-secret channel; the user vault stores only `{ server: 'plugin:<id>' }` for an internal selection (no `upstream_token`).

## Considered Options

### Option 1 — General streamable-HTTP MCP host layer with auto-published internal catalog entries and a minted binding token (chosen)

papai grows a public, token-authed streamable-HTTP MCP endpoint (`/mcp/plugin/<pluginId>`) mounted before the settings auth gate (alongside the transcript viewer). Each brokered call is bound to the initiator's context by a stateless HMAC-signed token minted at coding-session start. Eligible plugins auto-publish as internal catalog entries (`plugin:<id>`); the operator toggles + policies them, the user picks one with no token to paste. papai's endpoint is _just another HTTPS upstream_ to the existing broker.

- **Pros:** reusable host surface (any MCP client, not just magi); magi and INV-1/INV-2 untouched; user-facing flow is identical to the external catalog path (pick a server, no new papai-internal auth UX); fail-closed at resolver + route + admin layers; revocation by secret rotation with no per-token storage.
- **Cons:** a new public endpoint and signing-key surface to operate and document; binding token has a long (30-day) TTL with time-based revocation only; single upstream per session is retained (multi-server multiplexing is out of scope here and landed separately); text-only tool output.

### Option 2 — magi → papai loopback shortcut bypassing the worker enclosure

Have magi call papai's plugin tools directly over a private channel, skipping the worker enclosure / broker path.

- **Pros:** avoids minting a token and admitting papai's origin host in the geofront egress ceiling; lower latency.
- **Cons:** breaks the credential/egress isolation invariants (INV-1/INV-2); forces magi changes (special-cased knowledge of papai internals); the coding agent loses the per-tool mediator gate and the staged-secret channel; rejects the "general host layer" driver — it is a coding-agent-only shim.

### Option 3 — Treat plugin tools as a virtual external catalog entry with a user-pasted papai-issued token

Publish each plugin as a regular external catalog entry whose upstream URL is papai's origin and require the user to obtain + paste a token.

- **Pros:** no internal/external branch in the resolver or the picker UI; smallest conceptual surface.
- **Cons:** inverts the "no token to paste" driver; forces the user into a papai-internal auth flow the design explicitly avoids; the operator cannot independently toggle exposure + policy per plugin (the catalog entry is just a URL); fails the "auto-published, first-class internal" driver.

## Decision

The chosen Option 1 shipped across the host layer, the resolver, the admin + user settings surfaces, the proof plugin, and the docs. What shipped:

1. **Manifest opt-in (`mcpServer`).** A new optional boolean on `pluginManifestSchema` (`src/plugins/types.ts`); when true, all of the plugin's registered tools are MCP-exposable. The proof plugin `synthetic-web-search` declares `"mcpServer": true`.
2. **Binding token (`src/mcp-server/token.ts`).** `mintPluginMcpToken`/`verifyPluginMcpToken` issue a stateless HMAC-SHA256 envelope `{ v, storageContextId, chatUserId, pluginId, exp }` with a 30-day TTL, signed with `timingSafeEqual`. Signing key defaults to a domain-separated HMAC of `INSTANCE_CONFIG_KEY`; `MCP_SERVER_SIGNING_SECRET` overrides it for independent rotation. `verifyPluginMcpToken` never throws.
3. **Plugin bridge (`src/mcp-server/plugin-bridge.ts`).** `listPluginMcpTools` enumerates a plugin's registered tools as MCP descriptors (raw, un-namespaced names; JSON-schema input schemas derived via `asSchema(...).jsonSchema`); `callPluginMcpTool` executes one tool in the caller's bound context via the existing plugin tool runtime (`buildPluginToolRuntimeContext`, providerless path), returning text-only MCP content.
4. **HTTP route (`src/mcp-server/server-route.ts`).** `routePluginMcpPaths` serves `/mcp/plugin/<pluginId>`: bearer-token verify (token `pluginId` must equal path) → re-check the plugin is a currently-exposed internal server for the token's context (`isExposedInternalServer`, fail-closed) → spin up a fresh, stateless `McpServer` + `WebStandardStreamableHTTPServerTransport` per request wired to the bridge. Mounted in `src/debug/server.ts` **before** the settings auth gate, alongside the transcript viewer.
5. **Operator config + derivation (`src/coding-credentials/mcp-plugin-servers.ts`).** Admin config `mcp_plugin_servers` under context id `__admin_mcp_plugin_servers__:<platformInstanceId>`; `listEnabledInternalMcpServers` returns the effective internal servers (operator-enabled ∧ plugin active/eligible ∧ `mcpServer` declared ∧ `SETTINGS_PUBLIC_BASE_URL` set), deriving `name = 'plugin:<id>'`, `upstreamUrl` from the public base URL, `header = 'Authorization'`, and the operator's `toolPolicy`. `INTERNAL_SERVER_PREFIX = 'plugin:'` is the single source of truth and is reserved in the external catalog name schema.
6. **Resolver integration (`src/coding-credentials/resolve-mcp-servers.ts`).** The internal-`plugin:` branch derives `url`/`host`/`allowedHosts`/`header`/`toolPolicy` from `listEnabledInternalMcpServers` with no vault token; `resolveMcpTokens` mints `mintPluginMcpToken` for internal selections and reads the vault token for external ones. External catalog behavior is unchanged; both branches are fail-closed (disabled/ineligible/unset-base-URL → no server).
7. **Admin surface.** A dedicated `AdminMcpPluginServersSection` + `src/debug/settings/admin/mcp-plugin-servers-routes.ts` (`/settings/api/admin/mcp-plugin-servers`, GET/POST, admin-scoped, CSRF) expose available `mcpServer` plugins (id/name/description/tool list) and persist per-plugin `enabled` + `default_tool_policy`/`tool_policy`. Secure-by-default draft (`enabled: false`, `default_tool_policy: 'deny'`).
8. **User picker.** The `mcp` coding-credentials GET response carries `pluginServers`; `CodingMcpSection` lists them alongside external catalog entries, hides the `upstream_token` row for internal selections, and never persists a token for them.
9. **Proof + integration.** `synthetic-web-search` opts in; route + bridge are covered by unit and integration tests (`tools/list` then `tools/call` round-trip through the real transport).
10. **Docs.** `docs/architecture/environment.md` documents `MCP_SERVER_SIGNING_SECRET` and the `SETTINGS_PUBLIC_BASE_URL` gating + geofront egress-ceiling operator requirement; `docs/architecture/coding-sessions.md` adds an "Internal plugin MCP servers" subsection; `src/mcp/CLAUDE.md` records the client/server direction split.

## Consequences

### Positive

- A papai plugin can now be consumed by the sandboxed coding agent (and, in principle, any MCP client) through exactly the same broker path as an external upstream — magi, the mediator per-tool gate, the worker enclosure, and INV-1/INV-2 are all untouched, so the new surface inherits the existing isolation invariants for free.
- The host layer is general: a plugin opts in with one manifest flag and gets a standards-compliant MCP upstream; the operator's existing `tool_policy` model filters it the same way as external servers.
- The user-facing flow is unchanged from the external catalog path — pick a server, no new papai-internal auth UX, nothing to paste. The user vault stores only `{ server: 'plugin:<id>' }` for an internal selection.
- Access control is fail-closed at three layers: the resolver (won't derive an ineligible/disabled server), the route (re-checks exposure on every redemption, keyed off the token's `storageContextId`), and the admin (secure-by-default draft). Disabling a plugin server takes effect immediately for the live authorization decision, even against an already-minted token whose 30-day signature is still valid.
- Revocation needs no per-token storage or lifecycle UI — rotating the signing secret invalidates all outstanding tokens at once.

### Negative

- New public endpoint and signing-key surface to operate: `MCP_SERVER_SIGNING_SECRET`, `SETTINGS_PUBLIC_BASE_URL` gating, and the geofront egress-ceiling admission of papai's own origin host are now deploy requirements documented in `environment.md`.
- The binding token has a long (30-day) TTL by design (it must outlast a long-running coding session); there is no per-token revocation list, so a leaked token is valid until secret rotation. Mitigated by the per-request exposure re-check, which is what actually gates a live request.
- Text-only tool output (existing MCP convention); images/resources are dropped.
- Single upstream per session is retained; multi-server multiplexing is out of scope here (it landed separately — see ADR-0278/0279).

### Risks

- **Exposure check, not TTL, gates a live request.** The 30-day TTL exists so a token outlasts a session; the security boundary is the route's per-request `isExposedInternalServer` re-check. If a future change caches that check or skips it on a hot path, a disabled plugin server would remain callable until token expiry — the check must stay uncached and per-request.
- **`MCP_SERVER_SIGNING_SECRET` rotation invalidates all outstanding tokens.** This is the only mass-revocation mechanism; an operator who rotates it without coordination will interrupt in-flight sessions. Documented, but inherently operator-visible only via session failure.
- **Single-element `allowedHosts`.** `allowedHosts` is `[hostname]` derived from `SETTINGS_PUBLIC_BASE_URL`; a multi-host origin is not supported (YAGNI now).
- **Provider-backed plugin tools over MCP are not yet supported.** The bridge executes providerless (`provider: undefined`); plugins whose tools need a `TaskProvider` are documented follow-up. `synthetic-web-search` needs no provider, so the proof path is unaffected.

## Related Decisions

- **ADR-0123 — Trusted Local Plugin System.** Establishes the plugin runtime, contribution registry, manifest schema, and the `buildPluginToolRuntimeContext` execution path this host layer reuses verbatim.
- **ADR-0135 — MCP Adapter.** Defines `src/mcp/`, papai-as-MCP-**client** (consuming upstreams for the orchestrator LLM). This ADR is the opposite direction — papai-as-MCP-**server** (`src/mcp-server/`) — and the two modules are deliberately distinct and non-overlapping.
- **ADR-0260 / ADR-0264 / ADR-0274 — Sandbox MCP Broker (Phases 1, 2, 3a).** The broker, credential-bearing worker enclosure, mediator per-tool gate, and `projectSpec.mcp`/`mcpToken` wiring this host layer routes through — unchanged by this work.
- **ADR-0271 — MCP Catalog Hardening.** The reserved-`plugin:`-prefix refine on the external catalog name schema, the `default_tool_policy`-required posture, and the host-derivation model this work depends on and mirrors for internal entries.
- **ADR-0276 — Sandbox MCP Broker Phase 3b (papai).** The catalog UI, vault, and gating this work extends with an internal-servers surface.
- **ADR-0278 / ADR-0279 — Multi-Server MCP Multiplexing (magi + papai).** The concurrent reshape that folded the single-server `resolveMcp`/`resolveMcpToken` into the fail-closed set resolver `resolveMcpServers`/`resolveMcpTokens` + `maxMcpServers` guardrail, which is where this work's resolver integration ultimately landed.

## Implementation Notes

Verified present against the shipped tree via `grep`/`glob`/`read`.

| File | Role | Evidence |
| --- | --- | --- |
| `src/mcp-server/token.ts:33-37` | `getMcpTokenSigningSecret` — `MCP_SERVER_SIGNING_SECRET` override, else domain-separated HMAC of `INSTANCE_CONFIG_KEY`. | `read` confirms. |
| `src/mcp-server/token.ts:43-48` | `signaturesMatch` uses `timingSafeEqual` (length-checked first). | `read` confirms. |
| `src/mcp-server/token.ts:50-59` | `mintPluginMcpToken` — `{ v:1, exp, ...claims }`, base64url payload + `.` + HMAC sig. | `read` confirms. |
| `src/mcp-server/token.ts:61-86` | `verifyPluginMcpToken` — never throws; validates `v`/`exp`/claim types; `exp` check; returns claims or null. | `read` confirms. |
| `src/mcp-server/token.ts:14` | `PLUGIN_MCP_TOKEN_TTL_SECONDS = 60*60*24*30` (30 days). | `read` confirms. |
| `src/mcp-server/plugin-bridge.ts:54-65` | `listPluginMcpTools` — enumerates `contributionRegistry.getContributions(pluginId).tools`; raw names; JSON-schema via `asSchema(getPluginToolInputSchema(...)).jsonSchema`. | `read` confirms. |
| `src/mcp-server/plugin-bridge.ts:90-113` | `callPluginMcpTool` — finds tool by name; `buildPluginToolRuntimeContext(... provider: undefined ...)`; text-only result; errors → `isError: true` text. | `read` confirms. |
| `src/mcp-server/server-route.ts:21,144-158` | `routePluginMcpPaths` — `/mcp/plugin/` prefix; 404 on empty id; dispatches auth then transport. | `read` confirms. |
| `src/mcp-server/server-route.ts:62-76` | `resolvePluginMcpAuth` — bearer verify, token `pluginId` must equal path, `isExposedInternalServer` fail-closed → 401. | `read` confirms. |
| `src/mcp-server/server-route.ts:84-105` | `buildPluginMcpServer` — `McpServer` wrapping low-level `Server` with `ListToolsRequestSchema`/`CallToolRequestSchema` handlers wired to the bridge. | `read` confirms. |
| `src/mcp-server/server-route.ts:123-133` | Stateless transport `{ sessionIdGenerator: undefined, enableJsonResponse: true }`; `server.close()` in `finally`. | `read` confirms. |
| `src/mcp-server/index.ts:6-7` | Barrel re-exports `routePluginMcpPaths` + token surface. | `read` confirms. |
| `src/debug/server.ts:12,201-208` | Import + `routePublicCapabilityPaths` mounts `routePluginMcpPaths` alongside `routeTranscriptPaths` (before the auth gate). | `read` confirms. |
| `src/plugins/types.ts:208` | `mcpServer: z.boolean().optional().default(false)` on `pluginManifestSchema`. | `grep` confirms. |
| `src/plugins/types.ts:255,261` | `mcpServer` carried on the parsed-manifest type mirrors. | `grep` confirms. |
| `plugins/synthetic-web-search/plugin.json:8` | `"mcpServer": true` (proof plugin). | `read` confirms. |
| `src/coding-credentials/mcp-plugin-servers.ts:19` | `INTERNAL_SERVER_PREFIX = 'plugin:'` — single source of truth. | `read` confirms. |
| `src/coding-credentials/mcp-plugin-servers.ts:23-31` | `mcpPluginServerConfigSchema` — `plugin_id`/`enabled`/`default_tool_policy: enum`/optional `tool_policy`. | `read` confirms. |
| `src/coding-credentials/mcp-plugin-servers.ts:37-54` | `resolveMcpPluginServerConfigs`/`setMcpPluginServerConfigs` via `getCachedConfig`/`setCachedConfig` under `__admin_mcp_plugin_servers__:<pi>`. | `read` confirms. |
| `src/coding-credentials/mcp-plugin-servers.ts:76-102` | `listEnabledInternalMcpServers` — fail-closed when base URL unset; derives `name`/`upstreamUrl`/`header:'Authorization'`/`toolPolicy` for operator-enabled + eligible + `mcpServer` plugins. | `read` confirms. |
| `src/coding-credentials/resolve-mcp-servers.ts:46-88` | `resolveOneMcpServer` — internal `plugin:` branch (no vault token, derived entry, fail-closed) + external catalog branch (token required). | `read` confirms. |
| `src/coding-credentials/resolve-mcp-servers.ts:147-167` | `resolveMcpTokens` — mints `mintPluginMcpToken` for internal ids; reads vault token for external; derived strictly from the validated set. | `read` confirms. |
| `src/coding-credentials/mcp-catalog.ts:9,19-20` | External catalog name schema reserves the `plugin:` prefix (refuse). | `grep` confirms. |
| `src/coding-credentials/mcp-selections.ts:8,58` | Selection serialization drops `upstream_token` for `plugin:` selections (internal → `{ server }` only). | `grep` confirms. |
| `src/debug/settings/coding-credentials-routes.ts:218-231` | `mcp` GET returns `pluginServers` (+ `maxMcpServers`/`selections`); no token values exposed. | `read` confirms. |
| `src/debug/settings/admin/mcp-plugin-servers-routes.ts:31-41,71-80` | Admin route — `availablePluginServers()` (active `mcpServer` plugins); GET/POST on `/settings/api/admin/mcp-plugin-servers`; admin-scoped + CSRF; 422 on invalid body. | `read` confirms. |
| `src/debug/settings-api-router.ts:12,65` | Admin sub-dispatch registered for `mcp-plugin-servers`. | `grep` confirms. |
| `client/settings/fetcher-schemas.ts:92` | `pluginServers: z.array({ name, label }).optional()` on the coding-credentials response. | `grep` confirms. |
| `client/settings/sections/CodingMcpSection.svelte:45-55` | `pluginServers` derived; merged into options; `selectedIsInternal` (prefix or membership). | `grep` confirms. |
| `client/settings/sections/CodingMcpSection.svelte:108-112` | Internal selections persist `{ server }` only (no `upstream_token`). | `grep` confirms. |
| `client/settings/sections/CodingMcpSection.svelte:211` | Token row hidden when `selectedIsInternal`. | `grep` confirms. |
| `client/settings/sections/admin/AdminMcpPluginServersSection.svelte` | Admin section present (mounted in `client/settings/SettingsApp.svelte:48,267`). | `glob`/`grep` confirm. |
| `client/settings/fetcher-schemas-mcp-plugin-servers.ts` | Admin response schema mirror present. | `glob` confirms. |
| `docs/architecture/environment.md:30` | `SETTINGS_PUBLIC_BASE_URL` gates internal MCP servers + geofront egress-ceiling operator requirement. | `grep` confirms. |
| `docs/architecture/environment.md:32` | `MCP_SERVER_SIGNING_SECRET` documented (optional; rotation = mass-revoke). | `grep` confirms. |
| `docs/architecture/coding-sessions.md:46-56` | "Internal plugin MCP servers" subsection (route, token, operator+user config, fail-closed resolution, magi unchanged, single-upstream retained). | `grep` confirms. |
| `docs/architecture/coding-stack-overview.md:242-245` | Companion doc also updated with the `/mcp/plugin/<id>` surface + minted token. | `grep` confirms. |
| `src/mcp/CLAUDE.md:5` | Direction-split note: `src/mcp/` is client, `src/mcp-server/` is server; distinct, non-overlapping. | `grep` confirms. |
| `tests/mcp-server/token.test.ts` | Token mint/verify/tamper/expiry/malformed. | `glob` confirms. |
| `tests/mcp-server/plugin-bridge.test.ts` | List + call bridge; unknown plugin/tool → empty/error. | `glob` confirms. |
| `tests/mcp-server/server-route.test.ts` | Non-match→null, no-token→401, wrong-plugin→401. | `glob` confirms. |
| `tests/mcp-server/integration.test.ts` | `tools/list` then `tools/call` round-trip through the real transport. | `glob` confirms. |
| `tests/coding-credentials/mcp-plugin-servers.test.ts:76-153` | `listEnabledInternalMcpServers` — eligible/enabled/base-URL/mcpServer gating. | `grep` confirms. |
| `tests/coding-credentials/resolve-mcp-servers.test.ts:93-258` | `resolveMcpServers`/`resolveMcpTokens` — mixed internal+external set; fail-closed on disabled internal, missing token, `maxMcpServers`, malformed, unset/malformed base URL, duplicate selection. | `grep` confirms. |
| `tests/debug/settings/coding-credentials-mcp-plugin-servers.test.ts:11` | `mcp` GET includes `pluginServers` derived from enabled internal servers. | `grep` confirms. |
| `tests/debug/settings/admin/mcp-plugin-servers-routes.test.ts:94-220` | Admin GET/POST; auth/CSRF/422 coverage. | `grep` confirms. |
| `tests/visual/settings/sections/admin/AdminMcpPluginServersSection.spec.ts` | Visual spec for the admin section (`admin-mcp-plugin-servers-*` testids). | `grep` confirms. |

Plan-vs-implementation notes:

- **The resolver was reshaped into a fail-closed set resolver.** The plan edited `resolve-agent-secrets.ts` (`resolveMcp`/`resolveMcpToken`, single server). Shipped: MCP resolution lives in `src/coding-credentials/resolve-mcp-servers.ts`; the single-server logic is the private `resolveOneMcpServer` and the internal-`plugin:` branch is preserved verbatim (derived `url`/`host`/`allowedHosts`/`header`/`toolPolicy`, no vault token, fail-closed). The public surface is now `resolveMcpServers` (all-or-nothing set) + `resolveMcpTokens` (per-server credential map); `resolve-agent-secrets.test.ts:188` carries a pointer comment. This is the same concurrent reshape noted in ADR-0271 and ADR-0279 (multi-server multiplexing + `maxMcpServers` guardrail), which landed alongside this work.
- **The route uses the high-level `McpServer` wrapping the low-level `Server`, not the plan's bare `Server`.** The plan instantiated `new Server(...)` directly. Shipped uses `new McpServer(...)` and reaches its underlying `Server` via `.server.setRequestHandler(...)` — documented in a source comment as the escape hatch for dynamic, pre-schematized tool sets (the SDK's `registerTool` only accepts Zod, which would require lossy on-the-fly JSON-Schema-to-Zod translation). The handlers (`listPluginMcpTools`/`callPluginMcpTool`) are unchanged.
- **The SSE-vs-JSON transport concern the plan flagged was resolved explicitly.** The plan anticipated deciding between `res.json()` and SSE-frame parsing and moving `server.close()` if needed. Shipped forces JSON mode with `enableJsonResponse: true` on the transport (documented in a multi-line comment), so the response is fully materialized before `handleRequest` resolves and `server.close()` in `finally` is safe; the integration test consumes a plain JSON body.
- **The route's eligibility check was renamed and tightened.** The plan's injected dep was `isEligible(pluginId, configContextId)` returning `{ eligible }`. Shipped's dep is `isExposedInternalServer(pluginId, storageContextId)`, which derives `pi` + `configContextId` from the token's `storageContextId` and asks `listEnabledInternalMcpServers`. The intent (fail-closed when the plugin is not currently exposed for the bound context) is preserved and stricter — it keys the live authorization decision off the token's bound context, so disabling a plugin server takes effect immediately even against an already-minted, still-signed token.
- **The admin route's auth/CSRF/response plumbing is the `mcp-catalog-routes.ts` shape, as the plan instructed.** Shipped reuses `authenticate`/`requireAdmin`/`requireCsrf`/`parseJsonBody`/`settingsJson` from `../respond.js` and returns `{ available, configs }` on both GET and POST, matching the plan.
- **The user picker diverged to a row-based multi-select model.** The plan's `CodingMcpSection` edits assumed the single-server shape (`drafts['server']`, filtering the `upstream_token` row, `collectValues` guard). Shipped is the multi-server row model landed by ADR-0279 (`McpRow`, `selectedIsInternal(row)`, per-row token suppression in serialization + UI), which is where the "no token for internal" intent now lives. `pluginServers` is still surfaced in the GET response and merged into the picker options as the plan specified.
- **No standalone `tests/mcp-server/index.test.ts` content was planned.** The barrel file exists (`src/mcp-server/index.ts`) and there is a `tests/mcp-server/index.test.ts`; the index just re-exports, so this is incidental coverage, not a divergence.
- **Docs updated in a third file.** The plan named `environment.md`, `coding-sessions.md`, and `src/mcp/CLAUDE.md`; `docs/architecture/coding-stack-overview.md:242-245` was also updated to the new surface.

The source plan `docs/superpowers/plans/2026-07-09-plugins-as-mcp-servers.md` and design `docs/superpowers/specs/2026-07-09-plugins-as-mcp-servers-design.md` are archived alongside this ADR to `docs/archive/`.
