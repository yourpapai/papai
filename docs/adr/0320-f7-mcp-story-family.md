<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0320: F7 MCP Story Family — Behavioral Coverage for Both MCP Directions (papai-as-Client Tool Round-Trip and the Hosted Plugin-MCP Route)

## Status

Accepted

## Date

2026-07-22

## Context

The coverage-expansion roadmap sequences family **F7** (`mcp-*`) after F1–F5. F7 spans the two **opposite** MCP directions the codebase implements:

1. **papai-as-client** (`src/mcp/` adapter): a configured user MCP endpoint is connected during tool assembly (`buildMcpToolSet`), its tools merged under the `mcp_<sanitizedServerId>__<tool>` wire prefix (`src/mcp/tool-adapter.ts:26-33`), and invoked by the model in a real chat turn.
2. **papai-as-server** (`/mcp/plugin/:pluginId` route): papai hosts plugin tools for external MCP clients behind the production exposure gate (operator `mcp_plugin_servers` config + plugin active/eligible + `mcpServer: true` + `SETTINGS_PUBLIC_BASE_URL`) and a signed plugin token (`mintPluginMcpToken` / `verifyPluginMcpToken`).

Two structural obstacles made these scenarios unexecutable under the hermetic story harness (ADR-0284). First, the scripted model can only address tools through **registered capability ids** — `resolveToolCapability` throws on unknown ids, and only the static `CORE_TOOL_CAPABILITIES` map was ever registered, so the dynamic `mcp_*` wire names were unreachable from a script. Second, no harness seam could serve a fake external MCP server: the real `StreamableHTTPClientTransport` calls live `globalThis.fetch`, and the MCP client pool arms a 10-minute idle timer per entry that the story I/O guard fails at teardown. The `fake-mcp-server` seam name itself was inherited from F4 (ADR-0306), where `SCN-http-mcp-plugin` was reclassified into F7 with the corrected server-vs-client direction rationale.

The design (`docs/superpowers/specs/2026-07-22-f7-mcp-story-family-design.md`) and plan (`docs/superpowers/plans/2026-07-22-f7-mcp-story-family.md`) chose one production seam (identity capability registration for MCP wire names), three harness seams (`FakeMcpServer`, MCP-pool teardown, `given.mcpPluginServer`), three story files under `tests/stories/integrations/mcp/`, and a ledger update moving the catalog from 97→100 executable / 31→28 pending (era totals; see Implementation Notes).

## Decision Drivers

- **One production seam only, and it is test-only for resolution.** `registerMcpToolCapabilities` registers each `mcp_*` wire name as an identity capability (id === wire name) purely so the scripted model can address it via `callCapability(wireName, input)`; nothing in production resolves capabilities. Registering dynamic wire names under the F1–F6 capability-id pattern keeps the seam a natural extension of `registerOfferedCoreToolCapabilities` rather than a special case.
- **No fetch-injection seam.** The fake external server is reached by the *real* `StreamableHTTPClientTransport` (`@modelcontextprotocol/sdk` v1.29.0) calling live `globalThis.fetch`, which the I/O guard patches to the strict dispatcher — so the story exercises the exact production client stack, handshake included, instead of a stubbed transport.
- **Harness seams land first, each reviewed independently (roadmap rule 2).** The production seam, `FakeMcpServer`, and pool teardown precede any story task; each is its own commit with its own contract test.
- **No assertion-only stories (rule 3).** The papai-as-client scenario qualifies through a server-sourced marker token whose fingerprint surfaces on the real tool result (`promptToolResultTokenFingerprints`) — unscriptable, so its presence proves the client→server round trip. The papai-as-server scenarios qualify through a real tool payload over the route and an authorization flip (200 enabled → 401 disabled).
- **Zero production change for the server direction.** The `/mcp/plugin` route is always live in `routeRequest`, stateless (`sessionIdGenerator: undefined`), and driven in stories by hand-crafted JSON-RPC via `world.runtime.request()` — no SDK client, no socket.
- **Story hermeticity under stress.** The MCP pool's per-entry idle timer must be cleared at scenario teardown or the I/O guard and the determinism stress lane fail.

## Considered Options

### Option 1 — One identity-capability production seam + `FakeMcpServer` over the strict dispatcher + hand-crafted JSON-RPC for the plugin route (chosen)

Register MCP wire names as identity capabilities at tool-assembly time; serve a fake external MCP server by declaring the pinned request sequence (SSE-probe GET→405, `initialize`, `notifications/initialized`, `tools/list`, `tools/call`) on the strict dispatcher and letting the real SDK client's global fetch be intercepted; shut the MCP pool down at teardown; add `given.mcpPluginServer` for the operator-enablement half of the exposure gate; drive the plugin route with raw JSON-RPC POSTs authed by the production `mintPluginMcpToken`.

- **Pros:** the client direction exercises the real SDK transport, the real adapter wire-name sanitization, and the real pool; the server direction exercises the real exposure gate and real token verification with zero production change; each seam is contract-testable in isolation; `synthetic-web-search` is reused as the fixture plugin (no bespoke fixture plugin).
- **Cons:** the strict dispatcher's ordered FIFO matching pins the exact v1.29.0 SDK request sequence (a discovery spike was required to count `tools/list` calls per turn); the pool teardown must clear timers before the I/O guard checks; capability-id collisions between a wire name and a future core capability are possible in principle (covered by the idempotency/duplicate tests).

### Option 2 — Inject a fake transport/fetch into the MCP client pool (rejected)

Add a production seam letting tests substitute the `StreamableHTTPClientTransport` or its fetch.

- **Pros:** stories would not depend on the global-fetch interception or the exact SDK request sequence.
- **Cons:** production code exists only for tests; the seam would bypass the very machinery (transport handshake, wire-name sanitization, pool lifecycle) the stories exist to trip; contradicts the family's design constraint that capability registration is the only production change.

### Option 3 — Drive the plugin route through a real SDK client in stories (rejected)

Connect a `StreamableHTTPClientTransport` to `https://bot.invalid/mcp/plugin/:pluginId` inside the scenario.

- **Pros:** symmetric with the client-direction stories.
- **Cons:** the route is stateless (`sessionIdGenerator: undefined`, `enableJsonResponse: true`) — a single JSON-RPC POST suffices and the SDK's initialize handshake adds pinned-request fragility for no behavioral gain; hand-crafted JSON-RPC asserts the exact wire contract (401 without token, 401 on pluginId claim mismatch) more directly.

## Decision

Option 1 shipped across eight tasks:

1. **Production seam — `registerMcpToolCapabilities(tools, catalog)`** (`src/tools/core-capabilities.ts:113`). Registers each `mcp_`-prefixed wire name as an identity capability (id === wire name); idempotent (the catalog rejects only a duplicate id mapping to a *different* wire name). Wired into tool assembly beside `registerOfferedCoreToolCapabilities` (`src/llm-orchestrator-tools.ts:24,249`).
2. **Harness seam — `FakeMcpServer`** (`tests/stories/harness/fake-mcp-server.ts`). `expectConnect` / `expectToolsList` / `expectToolCall` / `verifyConsumed` append ordered expectations to the strict dispatcher, branching defensively on the parsed JSON-RPC `method`; contract-tested with a real `StreamableHTTPClientTransport` over the dispatcher (`fake-mcp-server.test.ts`).
3. **Harness seam — MCP pool teardown.** `teardown()` in `fixtures.ts:331` now `await mcpPool.shutdown()`, clearing the 10-minute idle timers and closing clients per scenario; the pool-isolation contract test (`fixtures.test.ts:262`) proves `getServerInfos()` empties after teardown.
4. **Enablement seam — `given.mcpPluginServer(platformInstanceId, pluginId)`** (`scenario.ts:214,715-717` → `fixtures.ts:284,441`), writing `mcp_plugin_servers` config via `setMcpPluginServerConfigs`; contract-tested in `scenario.test.ts:536`.
5. **`SCN-settings-admin-mcp-catalog`** (`tests/stories/integrations/mcp/admin-mcp-catalog.story.test.ts`) — seeds a user `mcp_endpoints` entry, serves the fake server, scripts `callCapability('mcp_fake__echo', …)`, and asserts the server-sourced marker fingerprint on the real tool result.
6. **`SCN-http-mcp-plugin`** (`tests/stories/integrations/mcp/mcp-plugin-route.story.test.ts`) — full enablement stack + `mintPluginMcpToken`; happy path `tools/call` against `synthetic-web-search` with the plugin's upstream `api.synthetic.new` stubbed on the dispatcher; negatives: no token → 401, pluginId claim mismatch → 401.
7. **`SCN-settings-admin-mcp-plugin-servers`** (`tests/stories/integrations/mcp/mcp-plugin-servers.story.test.ts`) — the governance flip: `tools/list` serves the real `search` descriptor while operator-enabled, then `setMcpPluginServerConfigs(..., enabled: false)` flips the same request to 401 within one scenario.
8. **Ledger reconciliation.** The three `SCN-*` audit records moved to `EXECUTABLE_STORY_MAPPINGS` (`coverage.ts:479,884,890`, `verifiedAt: '2026-07-22'`); `fake-mcp-server` stays in `STORY_SEAM_IDS` as realized; totals literals reconciled (see Implementation Notes for the cumulative totals).

## Consequences

### Positive

- Both MCP directions now have behavioral tripwires: a refactor that breaks the client transport handshake, the wire-name sanitization, the capability catalog, the exposure-gate order, or the token claim binding fails a story, not a unit assertion.
- The identity-capability seam is minimal and honest: production registers wire names so the scripted model can address tools; nothing in production resolves them, and re-registration across runtime start/stop is idempotent by the catalog's duplicate rule.
- `FakeMcpServer` pins the real SDK v1.29.0 request sequence against the strict dispatcher — a silent SDK behavior change (extra `tools/list`, altered handshake) fails loudly with the dispatcher's `undeclared request` message.
- The pool-teardown seam structurally closes the determinism hazard the stress lane scrutinizes: no idle timer or open client survives a scenario.
- F7 completed the F4 reclassification (ADR-0306): `fake-mcp-server` is realized and `SCN-http-mcp-plugin` is executable under its correct server direction.

### Negative

- **Ordered-expectation fragility.** The strict dispatcher matches method+URL in declaration order, so the stories encode the SDK's exact call sequence; upgrading the MCP SDK may require re-pinning `expectToolsList` counts (the failure message names the divergence directly).
- **Shared-harness-file churn.** `fixtures.ts`, `scenario.ts`, `coverage.ts`, and `catalog-coverage.test.ts` all changed; the frozen-tree compat baseline must re-record for these intended harness byte changes.
- **Hand-crafted JSON-RPC duplicates** the request shape across the two plugin-route story files (a deliberate choice so each file reads standalone).

### Risks

- **Capability-id collision** between an `mcp_*` wire name and a future core capability id — mitigated by the `mcp_` prefix convention and the Task 1 duplicate/idempotency tests.
- **Plugin-egress path dependency.** The `tools/call` happy path relies on the plugin's `httpFetch` deriving from `pluginProviderRuntimeDeps.fetch` (threaded from `world.http.fetch`); if the plugin-bridge wiring changes to bypass it, the story would trip the I/O guard rather than fail cleanly — the story comment (`mcp-plugin-route.story.test.ts:64-67`) records this derivation explicitly.
- The governance-flip story depends on `setCachedConfig` writes taking effect immediately (no restart); a future config-cache change that defers invalidation would silently keep the disabled case at 200 — the assertion catches it as a 200-vs-401 mismatch.

## Related Decisions

- [ADR-0306](0306-f4-http-story-family.md) — F4 HTTP-Surfaces Story Family: reclassified `SCN-http-mcp-plugin` into F7 with the server-vs-client direction rationale and made `fake-mcp-server` an F7-only seam; F7 is that reclassification's completion, and reuses F4's `given.publicBaseUrl` seam and in-process `world.runtime.request()` HTTP entry point.
- [ADR-0304](0304-story-catalog-audit.md) — Story Catalog Audit: established the `EXECUTABLE_STORY_MAPPINGS` table and pending-record shape F7's three ledger moves land in.
- [ADR-0284](0284-scenario-catalog-hermetic-stories.md) / [ADR-0282](0282-hermetic-e2e-master-baseline.md) / [ADR-0283](0283-hermetic-story-process-sandbox-phase-1.md) / [ADR-0286](0286-hermetic-story-docker-all-hosts.md) — the hermetic Tier 0 story harness (catalog, baseline, OS sandbox, Docker-all-hosts) these scenarios execute under; the I/O guard's global-fetch interception is what makes the no-fetch-injection choice work.
- [ADR-0297](0297-f1-command-meta-story-family.md) / [ADR-0298](0298-f2a-task-lifecycle-story-family.md) / [ADR-0299](0299-f2b1-task-provider-surface-story-family.md) / [ADR-0300](0300-f2b2-task-integration-surface-story-family.md) / [ADR-0305](0305-f3-memory-story-family.md) — the sibling story-family batch that established the seams-first discipline, the capability-id registration pattern F7's identity registration extends, and the strict-dispatcher FIFO matching `FakeMcpServer` declares against.
- [ADR-0135](0135-mcp-adapter.md) — MCP Adapter: the papai-as-client direction (`src/mcp/` pool, wire-name sanitization) the `SCN-settings-admin-mcp-catalog` story exercises end to end.
- [ADR-0280](0280-plugins-as-mcp-servers.md) / [ADR-0271](0271-mcp-catalog-hardening.md) — the papai-as-server direction: plugins exposed over `/mcp/plugin/:pluginId`, the exposure gate, and the plugin-MCP token the route stories drive through the real gate and real `mintPluginMcpToken`.

## Implementation Notes

Verified present against the shipped tree via `grep`/`glob`/`read`.

| File | Role | Evidence |
| --- | --- | --- |
| `src/tools/core-capabilities.ts:113` | `registerMcpToolCapabilities(tools, catalog)` — identity registration of `mcp_` wire names. | `grep` confirms. |
| `src/llm-orchestrator-tools.ts:24,249` | Import + call beside `registerOfferedCoreToolCapabilities` in tool assembly. | `grep` confirms. |
| `tests/tools/core-capabilities.test.ts:195-212` | Seam unit tests: registration, non-`mcp` exclusion, idempotency. | `grep` confirms. |
| `tests/stories/harness/fake-mcp-server.ts` | `FakeMcpServer` — `expectConnect`/`expectToolsList`/`expectToolCall`/`verifyConsumed` over the strict dispatcher. | `glob` confirms. |
| `tests/stories/harness/fake-mcp-server.test.ts` | Contract test with a real `StreamableHTTPClientTransport` over the dispatcher. | `glob` confirms. |
| `tests/stories/harness/fixtures.ts:20,331` | `mcpPool` import; `teardown()` `await mcpPool.shutdown()`. | `grep` confirms. |
| `tests/stories/harness/fixtures.test.ts:262-275` | Pool-isolation contract test (`getServerInfos()` empties after teardown). | `grep` confirms. |
| `tests/stories/harness/scenario.ts:214,715-717` | `given.mcpPluginServer` DSL → `world.fixtures.enableMcpPluginServer`. | `grep` confirms. |
| `tests/stories/harness/fixtures.ts:284,441` | `enableMcpPluginServer` fixture (`setMcpPluginServerConfigs` with `enabled: true, default_tool_policy: 'allow'`). | `grep` confirms. |
| `tests/stories/harness/scenario.test.ts:536-543` | `given.mcpPluginServer` contract test. | `grep` confirms. |
| `tests/stories/integrations/mcp/admin-mcp-catalog.story.test.ts:19-49` | `SCN-settings-admin-mcp-catalog` — marker fingerprint on the real tool result. | `read` confirms. |
| `tests/stories/integrations/mcp/mcp-plugin-route.story.test.ts:45-85` | `SCN-http-mcp-plugin` — `tools/call` happy path + two 401 negatives. | `read` confirms. |
| `tests/stories/integrations/mcp/mcp-plugin-servers.story.test.ts:44-81` | `SCN-settings-admin-mcp-plugin-servers` — 200 enabled → 401 disabled flip. | `read` confirms. |
| `tests/stories/catalog/coverage.ts:479-482,884-893` | Three `EXECUTABLE_STORY_MAPPINGS` records, `verifiedAt: '2026-07-22'`, story-id strings matching the `scenario(...)` names. | `grep` confirms. |

Plan-vs-implementation notes:

- **Teardown shipped async.** The plan preferred a synchronous `void mcpPool.shutdown()` with an async fallback if `clearTimeout` proved post-`await` (Task 3 Step 0 contingency). Shipped `teardown` is async and `await mcpPool.shutdown()` (`fixtures.ts:331`).
- **Task 6 Step 0 resolved in favor of `tools/call`.** The discovery confirmed the plugin's `httpFetch` is `pluginProviderRuntimeDeps.fetch`, threaded from `world.http.fetch` through `buildManifestProviderRuntime`, so the upstream stub is dispatcher-routed and the `tools/call` happy path applies — the `tools/list` fallback was not needed (recorded in the story comment, `mcp-plugin-route.story.test.ts:64-67`).
- **The upstream stub uses the `text` field** (`{ title, url, text }`, `mcp-plugin-route.story.test.ts:69`) — matching the plugin's actual `parseSearchResponse` schema, where the plan's sketch wrote `snippet`; the plan flagged this as a confirm-against-`parseSearchResponse` step.
- **The request sequence pinned by the Task 4 spike was exactly one connect, one `tools/list`, one `tools/call` per turn** (`admin-mcp-catalog.story.test.ts:33-38`) — no repeated `expectToolsList` was needed.
- **Cumulative catalog totals exceed the era target.** The plan's ledger target was 97→100 executable / 31→28 pending / needs-seam 8→5 (128 ids). Shipped, the catalog now carries **140 executable / 25 pending / 165 ids / 3 needs-seam** (`catalog-coverage.test.ts:114,216,305,352`): the tier-expansion roadmap and later families (including the T3 platform lane, `verifiedAt: '2026-07-25'`) landed after F7. F7's own three mappings at `verifiedAt: '2026-07-22'` are all present; the larger totals are cumulative state, not an F7 divergence.
- **The plan's own task checkboxes remain unchecked** in the plan file — the tracking syntax was not updated during execution, but every task's artifact is present in the codebase.

The source plan `docs/superpowers/plans/2026-07-22-f7-mcp-story-family.md` and design `docs/superpowers/specs/2026-07-22-f7-mcp-story-family-design.md` remain in the legacy tree pending archival alongside this ADR to `docs/archive/`.
