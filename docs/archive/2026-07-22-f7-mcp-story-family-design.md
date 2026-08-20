<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design: F7 MCP story family

**Status:** approved

**Date:** 2026-07-22

## Context

The coverage-expansion roadmap (`2026-07-19-story-coverage-expansion-roadmap-design.md`)
sequences family F7 (`settings-admin-mcp-*`, plus `http-mcp-plugin` reclassified in from F4)
after F1–F6. F7's charter is "Settings routes, MCP adapter", and it is the roadmap's sole
owner of all MCP-harness machinery: after F3 reclassified `fetch-chat-link` off
`public-url-assertion` and F4 moved `http-mcp-plugin` here, `fake-mcp-server` is an F7-only
seam (roadmap seam-drift table).

F7 spans **two opposite MCP directions**, and the shared `fake-mcp-server` seam name hides
different machinery in each (F4's reclassification note flagged this):

- **papai-as-MCP-client** — the MCP _adapter_ (`src/mcp/`) that connects papai out to an
  external MCP server and merges its tools into the orchestrator tool set. `plugin-core-
separation` rewires builtin/plugin tool registration and runtime composition; a broken
  merge would silently drop MCP tools. The behavioral tripwire is a chat turn that invokes a
  remote tool.
- **papai-as-MCP-server** — the `/mcp/plugin/:pluginId` route (`src/mcp-server/`) that hosts a
  plugin's tools for an external client, gated by an operator config and a signed token.

The catalog audit (`docs/superpowers/plans/2026-07-19-story-catalog-audit.md`) classified all
three F7 records `needs-seam:[fake-mcp-server]`. This spec lands **3 executable scenarios** and
moves the ledger from **97 to 100 executable** (31 → 28 pending), realizing and **exhausting**
the `fake-mcp-server` seam: after F7 no pending scenario references it.

Research resolved one interpretation conflict (see "Reclassifications and findings"), confirmed
the client-transport interception path, and found the papai-as-server route far simpler than
the audit's seam name implies.

Research basis: the MCP adapter (`src/mcp/client-pool.ts:32-41,160-176,252-259`,
`user-endpoints.ts:65-99`, `tool-adapter.ts:16-60`, `types.ts:15-24,64-70`), tool assembly
(`src/tools/index.ts:180-220`, `src/llm-orchestrator-tools.ts:222,231`), the capability catalog
(`src/runtime/capability-catalog.ts:13-38`, `src/runtime/create-runtime.ts:41-48,203-206`), the
papai-as-server route (`src/mcp-server/server-route.ts:62-158`, `plugin-bridge.ts:89-112`,
`token.ts:51-86`, `src/debug/server.ts:200-206`, `src/coding-credentials/mcp-plugin-servers.ts:48-84`),
the settings routes (`src/debug/settings/mcp-routes.ts:73-76`,
`src/debug/settings/admin/mcp-catalog-routes.ts:23-29`), the MCP SDK transport (v1.29.0,
`@modelcontextprotocol/sdk/.../client/streamableHttp.js:89,306,443`), and harness mechanics
(`tests/stories/harness/strict-http.ts:47-118`, `io-guard.ts:333-336`, `world.ts:407-411,438`,
`fake-magi.ts`, `embeddings.ts`, `tests/stories/integrations/plugins/eligibility.story.test.ts`,
F4/F6 specs).

## Scope and scenario mapping (Hybrid, per-direction)

The three F7 records map to the three genuinely distinct MCP machineries, one per scenario:

| Scenario                                | Direction               | Machinery                                                              |
| --------------------------------------- | ----------------------- | ---------------------------------------------------------------------- |
| `SCN-settings-admin-mcp-catalog`        | papai-as-client         | fake external MCP server over the strict dispatcher; MCP adapter merge |
| `SCN-settings-admin-mcp-plugin-servers` | papai-as-server (gate)  | `mcp_plugin_servers` operator config governing the `/mcp/plugin` route |
| `SCN-http-mcp-plugin`                   | papai-as-server (route) | the `/mcp/plugin/:pluginId` JSON-RPC route + signed-token auth         |

This maximizes distinct-surface coverage per scenario and honors the `plugin-servers` name
literally (it _is_ the papai-hosted internal-server config). The one unavoidable
reinterpretation is `catalog` → user `mcp_endpoints` (see "Reclassifications and findings").

## The interception fact (why no fetch-injection seam is required)

Under `bun test:stories` the I/O guard patches `globalThis.fetch` to route through the world's
strict HTTP dispatcher (`io-guard.ts:333-336`). The MCP SDK's `StreamableHTTPClientTransport`
performs every network operation via `(this._fetch ?? fetch)(…)`
(`streamableHttp.js:89,306,443`), and papai's `buildClientAndTransport` never passes a `fetch`
option — only `requestInit` headers (`client-pool.ts:37-39`). So `this._fetch` is always
`undefined` and the transport resolves the **live** `globalThis.fetch` at call time. MCP client
traffic is therefore ordinary interceptable `fetch` traffic — a fake external MCP server can be
served over the strict dispatcher with no production plumbing, exactly as the audit assumed.

## Production seam (one — lands first, reviewed independently, rule 2)

### `capability-ids` — capability registration for user-MCP tools

The scripted model addresses tools with `callCapability(id, input)`, resolved through the
runtime's capability catalog (`create-runtime.ts:203-206` → `capability-catalog.ts:24-28`, which
**throws on an unknown id**). User-MCP tools carry dynamic wire names
(`mcp_<sanitizedServerId>__<toolName>`, `tool-adapter.ts:26-33`) that are never registered:
`registerOfferedCoreToolCapabilities` (`llm-orchestrator-tools.ts:222`) only registers the
static `CORE_TOOL_CAPABILITIES` map, and MCP-sourced tools declare no `capabilityId` (unlike
native plugin tools, `src/plugins/contributions.ts:205-206`). So the scripted model literally
cannot invoke a remote MCP tool today.

F7 adds registration of user-MCP wire names as capabilities at the same point core capabilities
register (`llm-orchestrator-tools.ts` neighborhood of line 222), using an **identity id** — the
wire name is its own capability id, so the scripted model calls
`callCapability('mcp_<serverId>__<tool>', input)`. The registration is idempotent (the catalog
only rejects a duplicate id mapping to a _different_ wire name, `capability-catalog.ts:18-22`; id
== wire name is stable), the catalog is cleared per runtime start/stop
(`create-runtime.ts:41,45`), and the `mcp_` prefix is namespaced-distinct from builtins and
plugins. This is the roadmap's `capability-ids` seam applied to the MCP adapter, mirroring
F1–F6.

**Scope:** only `SCN-settings-admin-mcp-catalog` needs this. Both papai-as-server scenarios use
existing production functions (`mintPluginMcpToken`, `setMcpPluginServerConfigs`) and require
**zero** production change. This keeps F7's production footprint to a single additive
registration, contained to the tool-assembly capability step.

**Chosen over a harness identity-fallback.** The alternative — making the world's
`resolveCapability` (`world.ts:407-410`) pass an unknown id through as its own wire name — needs
no production change but weakens the catalog's deliberate throw-on-unknown contract and edits a
frozen shared-harness file's addressing semantics for every family. Registering in production
keeps the addressing contract intact and follows the established capability-id precedent.

## Harness seams (harness-only, land before any story, each with a contract test)

All additions are under `tests/stories/harness/`, each with its own contract test, landing
before any story consumes them (rule 2).

### 1. `FakeMcpServer` — the external-server responder helper

New `tests/stories/harness/fake-mcp-server.ts`, modeled on `fake-magi.ts`. It registers the
StreamableHTTP request sequence on `world.http.expect` and answers by inspecting each incoming
JSON-RPC body:

1. `GET {url}` (the SDK's initial SSE probe, `streamableHttp.js:56-89`) → **405** (a graceful
   "no server-push stream"; not an error to the client).
2. `POST {url}` `initialize` → a JSON-RPC `result` with `protocolVersion`, server `capabilities`,
   and `serverInfo`.
3. `POST {url}` `notifications/initialized` → 202/empty.
4. `POST {url}` `tools/list` → the fixture tool descriptor(s).
5. `POST {url}` `tools/call` → the canned tool result (a unique, non-scriptable token).

The strict dispatcher matches by method+URL in order (`strict-http.ts:74-80`); since steps 2–5
are all `POST {url}`, the helper's responders branch on the parsed JSON-RPC `method`. The URL is
HTTPS (`mcpEndpointConfigSchema` rejects non-`https`, `types.ts:20-23`), e.g.
`https://mcp.invalid/rpc`, matching `embeddings.ts`'s `https://llm.invalid`. The helper exposes a
single `expectToolCall(toolName, respond)` that declares the whole sequence, so a story writes
one line. Contract test: a real `StreamableHTTPClientTransport` drives the sequence end-to-end
and observes the canned `tools/call` result.

### 2. `given.mcpEndpoint(...)` — user-endpoint config seam

Configures a `mcp_endpoints` entry pointing at the fake server URL. The catalog scenario drives
the config write through the **real** `PUT /settings/api/mcp` route (`mcp-routes.ts:73-76`, a
settings session + CSRF) so the settings route is itself exercised, then the same URL is served
by `FakeMcpServer`.

### 3. Pool teardown — `mcpPool.shutdown()` in cleanup

`buildMcpToolSet` connects via the module-singleton `mcpPool`, which arms a 10-minute idle timer
per entry (`client-pool.ts:252-259`, `DEFAULT_IDLE_TIMEOUT_MS`). Production never shuts the pool
down in a lifecycle hook, so at scenario teardown that live timer (and the open client) would
trip the I/O guard's active-timer/leak checks. The fixture calls `mcpPool.shutdown()`
(`client-pool.ts:160-176`, clears timers + closes clients + clears entries) in
`fixtures.teardown` / the cleanup coordinator. This is harness-only (the method exists). Contract
test: after a scenario that connected, a second world in the same worker sees no leaked
timer/connection (the F4 notify-token-cache isolation shape).

### 4. Papai-as-server enablement (reuse `synthetic-web-search`)

Both papai-as-server scenarios reuse the real on-disk `synthetic-web-search` plugin (the only
`mcpServer: true` plugin), via the `eligibility.story.test.ts` pattern: `given.plugin(discovered(
'synthetic-web-search'))` + `setPluginAdminConfig('synthetic-web-search', 'api_key', …)` +
`setPluginEnabledForContext(...)` before `world.start()`. The `/mcp/plugin` exposure gate
additionally needs `given.publicBaseUrl(url)` (F4's seam; `listEnabledInternalMcpServers`
fail-closes to `[]` when `SETTINGS_PUBLIC_BASE_URL` is unset,
`mcp-plugin-servers.ts:80-84`) and `setMcpPluginServerConfigs(platformInstanceId, [{ plugin_id,
enabled, default_tool_policy: 'allow' }])` (`mcp-plugin-servers.ts:48-54`). A thin
`given.mcpPluginServer(...)` convenience may wrap the latter two; if so it lands with its own
contract test, otherwise the story calls them directly (the eligibility-story precedent for
direct config calls). No new `STORY_SEAM_IDS` id.

## Story files

New `tests/stories/integrations/mcp/` group (papai-as-server scenarios beside the plugin/coding
integrations) and the catalog scenario under the settings/adapter surface — exact placement is a
plan detail. Every scenario qualifies through observable behavior (rule 3): a real tool result,
an authorization flip, or a durable behavior change — never a bare status or an internal call
count.

| Scenario                                | Shape                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SCN-settings-admin-mcp-catalog`        | `given.mcpEndpoint(...)` writes `mcp_endpoints` via real `PUT /settings/api/mcp`; `FakeMcpServer.expectToolCall('<tool>', → token)`; model `callCapability('mcp_<serverId>__<tool>', input)` in a chat turn → papai connects out (GET-405, initialize, initialized, tools/list, tools/call), and the server-sourced token (not scriptable) surfaces on the real tool result/reply. |
| `SCN-settings-admin-mcp-plugin-servers` | `synthetic-web-search` active + `given.publicBaseUrl`; with `setMcpPluginServerConfigs([{ enabled: true }])`, a `tools/call` to `/mcp/plugin/:pluginId` (valid token) returns the plugin tool's real result; with `enabled: false`, the same request → **401** (exposure-gate flip). The admin config governs the route — an authorization flip, not a config readback.            |
| `SCN-http-mcp-plugin`                   | `synthetic-web-search` active + enabled; a hand-crafted JSON-RPC `tools/call` via `world.runtime.request()` (headers `content-type: application/json`, `accept: application/json, text/event-stream`, `authorization: Bearer {mintPluginMcpToken(...)}`) returns the tool's real result; negatives — 401 on missing token, malformed token, and plugin-id/claim mismatch.          |

**No `initialize` handshake for papai-as-server.** The route builds a stateless transport
(`sessionIdGenerator: undefined`, `enableJsonResponse: true`, `server-route.ts:107-133`); existing
unit tests call `tools/call` directly with no prior `initialize` and a plain JSON response
(`tests/mcp-server/server-route.test.ts`). Stories need **no** `@modelcontextprotocol/sdk`
client — a raw `Request` suffices.

**`synthetic-web-search` egress stays hermetic.** Its `search` tool fetches `api.synthetic.new`
through the plugin runtime's fetch, which the world wires to the strict dispatcher
(`world.ts:438`). A `tools/call` therefore declares one stubbed upstream response; the observable
result is the plugin tool's output over the route (papai-as-server) — a plan-discovery step
confirms the plugin-context fetch resolves to `http.fetch`.

## Reclassifications and findings (roadmap rule 6)

- **`SCN-settings-admin-mcp-catalog` re-mapped to the MCP adapter (papai-as-client).** Research
  found three distinct MCP config surfaces: user `mcp_endpoints` (`/settings/api/mcp` →
  `buildMcpToolSet`, connects out), plugin-declared manifest `mcp` (connects out), and the two
  **admin** surfaces — `mcp_catalog` (`/settings/api/admin/mcp-catalog`) and `mcp_plugin_servers`
  (`/settings/api/admin/mcp-plugin-servers`), both `requireAdmin` CRUD that **never connect out
  from papai**: catalog entries are resolved and connected inside the external Magi/sandbox
  process, proven by `acp-mcp.story.test.ts:143` asserting zero `http.request` for that path. The
  literal admin-catalog behavior (config → coding-session start) is already covered by landed
  `SCN-settings-coding-mcp` (`coverage.ts:387-392`) and `SCN-coding-acp-mcp-session`
  (`coverage.ts:321-324`). To earn the `fake-mcp-server` seam its charter mandates, this ID is
  mapped to the only unproven MCP-adapter surface — the papai-as-client user-endpoint path. The
  settings-family spec's deferral rationale ("MCP-sourced tools in a chat turn") describes exactly
  this path; the "catalog" name was loose bucketing. Recorded on the executable mapping.
- **`SCN-settings-admin-mcp-plugin-servers` scoped to route governance, not a config readback.**
  The proof is behavioral (a 401↔result flip driven by the operator config), honoring rule 3 and
  the name literally.
- **`fake-mcp-server` is exhausted by F7.** After these three land, no pending scenario references
  it; the id stays in `STORY_SEAM_IDS` as realized.

## Deliberate exclusions

- **No fetch-injection production seam** — global-fetch interception already reaches the MCP
  client transport (see "The interception fact").
- **No SDK MCP client in stories** — papai-as-server is stateless; the story hand-crafts JSON-RPC.
- **No bespoke fixture plugin** — reuse `synthetic-web-search`; no test-only plugin ships in
  production `plugins/`.
- **Plugin-declared MCP (manifest `mcp`) client path is not separately covered.** Under Hybrid,
  `plugin-servers` went to the papai-as-server governance proof. The user-endpoint catalog
  scenario already exercises the `src/mcp/` adapter merge + `mcpPool` connect end-to-end; the
  plugin-endpoint re-namespacing (`plugin-endpoints.ts`) is left as a documented gap rather than a
  speculative fourth scenario (no pending scenario references it). Recorded so the catalog stays
  truthful.
- **SSRF/HTTPS-guard variants stay out** — `mcpEndpointConfigSchema`'s HTTPS-only rule and DNS
  behavior remain covered by `tests/mcp/` unit tests; F7 tests the adapter surface, not the guard
  internals.
- **`startBackgroundServices` stays false** (`world.ts`); the only timer risk is the MCP pool's
  idle timer, cleared by `mcpPool.shutdown()` in teardown.

## New seam

`fake-mcp-server` was already reserved in `STORY_SEAM_IDS` (`coverage.ts:21`) and is realized by
F7. `given.mcpEndpoint`, the `mcpPool.shutdown()` teardown, and any `given.mcpPluginServer` wrapper
are harness `given.*`/fixture methods (not `STORY_SEAM_IDS` ids), following `given.publicBaseUrl` /
`given.recurringTask`. No new seam id is added.

## Ledger updates (same PR, roadmap rule 5)

Three `AUDIT_RECORDS` entries move to `EXECUTABLE_STORY_MAPPINGS` with the implementation date as
`verifiedAt` (the catalog re-mapping rationale recorded on its mapping). No new `STORY_SEAM_IDS`
id. Contract-test totals update to **128 ids / 100 executable / 28 pending**; the pending
readiness split becomes **1 executable-as-is / 5 needs-seam / 22 blocked** (needs-seam drops by
3). The runner manifest totals line follows
(`story catalog: 100/128 executable; pending 28 (1 executable-as-is, 5 needs-seam, 22 blocked)`).

## Success criteria

- 3 new scenarios pass sandboxed (`bun test:stories`).
- Ledger: 100 executable / 28 pending; runner prints the updated totals line.
- The single production change (user-MCP capability registration) lands first, is reviewed
  independently, and is covered by the story that consumes it (`SCN-settings-admin-mcp-catalog`).
- The `FakeMcpServer` helper, `given.mcpEndpoint`, and the `mcpPool.shutdown()` teardown land
  before any story and carry their own contract tests.
- `bun test:stories:contracts` (including the new seam/helper contract tests), typecheck, lint,
  and `format:check` stay green.
- `bun test:stories:stress` once before merge — no flakes (the pool-timer isolation is the
  specific determinism guard under scrutiny).
- The compat baseline is re-recorded only for the intended frozen-harness byte changes; the
  existing scenario set is otherwise untouched.

## Risks

1. **SDK request-count/order (v1.29.0) over the ordered dispatcher.** The strict dispatcher
   matches expectations in exact order; the connect handshake must be pinned. A plan-discovery
   smoke run confirms the exact sequence (GET-405, initialize, initialized, tools/list) before the
   story asserts, and confirms the pool caches the connection so `tools/call` is the only
   per-invocation request. `FakeMcpServer` encapsulates the sequence so a change in SDK behavior is
   a one-file fix.
2. **Pool timer/connection isolation across scenarios.** `mcpPool.shutdown()` in teardown, with a
   contract test proving no leaked timer/connection into a second world in the same worker (the F4
   notify-token analogue). This is the top determinism risk.
3. **`synthetic-web-search` egress path.** The plugin-context fetch inside `callPluginMcpTool` must
   resolve to the harness dispatcher for the `tools/call` stub to intercept; a plan-discovery step
   confirms it before the story asserts, else a `tools/list`-only observable (the plugin's real
   tool descriptor over the route) is the fallback proof.
4. **Capability-id identity registration.** Must not collide with builtins/plugins; the `mcp_`
   prefix is namespaced-distinct and re-registration is idempotent (id == wire name). A contract
   test asserts an `mcp_*` tool becomes resolvable and a core capability id is unaffected.
5. **Token/claim binding for papai-as-server negatives.** `mintPluginMcpToken` binds
   `{storageContextId, chatUserId, pluginId}`; the seeded token must match the ids the scenario's
   context resolves to, and the mismatch negative flips exactly one claim — a plan-discovery step
   confirms the id derivation.
