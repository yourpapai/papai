<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design: Multi-server MCP multiplexing for coding sessions

**Status:** approved (brainstorm), ready for implementation planning
**Date:** 2026-07-09
**Spans:** papai (this repo) + magi (`~/Projects/yourpapai/magi`) + geofront (`~/Projects/experiments/geofront`, config-only — no code change)
**Builds on:** the "plugins as MCP servers" feature (`docs/superpowers/specs/2026-07-09-plugins-as-mcp-servers-design.md`).

## Problem

Today a coding session can use **exactly one** MCP upstream — either one operator-curated external catalog server, or one papai-hosted internal plugin server, never several. The whole stack bakes in the single-upstream assumption: papai's `mcp` credential vault holds one `{ server, upstream_token }`, `resolveMcp`/`resolveMcpToken` return one value, `projectSpec.mcp` + `mcpToken` carry one server + one credential, and magi launches one worker enclosure per session.

Users want one session to reach **multiple** MCP servers at once — arbitrary mixes of internal plugin servers and external catalog servers (e.g. the web-search plugin **and** a GitHub MCP **and** an internal task-tracker plugin). This design makes that possible.

## Key decisions (settled during brainstorm)

1. **Fully general.** A session may combine any mix of internal and external servers, any count up to the cap.
2. **Architecture: N independent servers, mediator-as-router** (Approach A below). Each upstream = its own tunnel + worker enclosure; magi's mediator routes by the per-connection `serverId`; the coding agent natively merges each server's tools and namespaces them per server. No JSON-RPC merge/rewrite logic is added to magi's gate.
3. **Fail-closed, all-or-nothing.** If any requested upstream can't be validated/brought up (host not in the egress ceiling, worker launch fails, missing/expired credential, unknown server), the **whole session refuses** with an error naming the offending server. A session never launches with a silently-incomplete toolset.
4. **Cap:** an operator-configurable soft cap (`maxMcpServers`, default **3**) enforced by papai, plus a magi absolute hard ceiling (`MAX_MCP_UPSTREAMS`, **8**) enforced at the trust boundary regardless of caller config.
5. **Selection UX:** an add-row list — each row is one upstream (server dropdown + a token field that appears only for external rows). The `mcp` vault stores a JSON **array** of `{ server, upstream_token? }`.
6. **No backward compatibility.** This is a clean contract cutover: the `mcp` vault is array-only (no legacy flat-object read), and magi's `projectSpec.mcp`/`mcpTokens` are array/map-only (no dual single+array acceptance). papai and magi deploy together on the new contract.

## Approaches considered

- **A — N independent servers, mediator-as-router (chosen).** Minimal magi change; preserves the opaque-relay + per-server `toolPolicy` gating invariants; the agent does fan-out/merge; geofront untouched. magi's own code comments (`src/mcp-broker/worker-client.ts` header) name `serverId`-based demux as the intended follow-up.
- **B — Aggregating gateway (rejected).** One tunnel → one worker that fans out to N upstreams inside magi, merging `tools/list` and routing `tools/call` by tool name. Forces the gate to become a JSON-RPC-aware proxy (breaking its "opaque, never re-serialize" invariant), needs magi-side tool-name namespacing, and still needs N isolated credentials — more complexity, no cost saving.
- **C — papai "meta-MCP" proxy (rejected).** magi sees one upstream (papai) that internally proxies N servers. Collapses credential isolation (external tokens transit papai; papai needs egress to every external host), breaking INV-1 and the per-enclosure isolation model.

## Architecture (Approach A)

### Data flow

```
coding agent (sandbox)
  ├─ mcp-tunnel --server plugin:web-search  ┐
  ├─ mcp-tunnel --server github-mcp         ┼─► one bind-mounted mediator socket (/run/magi/mcp.sock)
  └─ mcp-tunnel --server jira-mcp           ┘        mediator routes each connection by serverId
                                                     ├─► worker enclosure A (egress: papai origin) → papai /mcp/plugin/web-search
                                                     ├─► worker enclosure B (egress: api.github.com) → GitHub MCP
                                                     └─► worker enclosure C (egress: jira host)     → Jira MCP
```

The agent's MCP client treats each `serverId` as an independent, namespaced tool source and unions their `tools/list` results itself — so **no fan-out/merge lives in magi**. One mediator (cheap fan-in point); N credential-isolated worker enclosures (INV-1); the agent still reaches only the single mediator socket (INV-2, unchanged by N). geofront simply runs `workspace up` N times.

### `serverId` scheme

`serverId` is the vault `server` value verbatim: `plugin:<pluginId>` for internal servers, the catalog `name` for external ones. Both are already unique within their namespace, and the existing `plugin:` reserved-prefix guard (added in the plugins-as-MCP-servers feature, `src/coding-credentials/mcp-catalog.ts`) prevents cross-namespace collision. No new naming scheme is introduced. `serverId` becomes the ACP `McpServer.name`, the handshake tag, and the mediator's routing key.

## The contract (papai ↔ magi)

- `projectSpec.mcp`: single object → **array** `[{ id, url, host, header, allowedHosts, toolPolicy? }]`, `id` = `serverId`.
- `mcpToken` (top-level sibling of `projectSpec`): single string → **`mcpTokens: Record<serverId, string>`**. Secrets stay out of `projectSpec`; magi pairs each spec entry to its token by `id`.
- Both are array/map-only — no single-shape acceptance.

## magi changes (`~/Projects/yourpapai/magi`)

geofront: **no code change** (see below). magi change surface (verified against the code):

| File                                                                                                                         | Change                                                                                                                                                                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/project/config.ts` (`ProjectSpec.mcp`)                                                                                  | single object → array `[{ id, url, host, header, allowedHosts, toolPolicy? }]`                                                                                                                                                                                                         |
| `src/project/spec-validation.ts` (`resolveMcp`)                                                                              | parse the array; validate each entry (https, host==url host, host ∈ `policy.allowedHosts` **and** ∈ entry `allowedHosts`, valid `toolPolicy`); enforce `id` uniqueness; enforce `length ≤ MAX_MCP_UPSTREAMS` (**8**); **reject the whole spec on any per-entry failure** (fail-closed) |
| `src/server/router.ts` (`mcpToken`)                                                                                          | `mcpToken` string → `mcpTokens` map keyed by `serverId`                                                                                                                                                                                                                                |
| `src/session/helpers.ts` (`mcpLaunchConfig`)                                                                                 | pair each spec entry with its token by `id`; produce `LaunchMcpConfig[]`                                                                                                                                                                                                               |
| `src/launcher/launcher.ts` (`LaunchSpec.mcp`)                                                                                | single → `LaunchMcpConfig[]` (each `& { id }`)                                                                                                                                                                                                                                         |
| `src/runtime/geofront/geofront-runtime.ts` (`McpApparatus`, `startMcpApparatus`, `teardownMcpApparatus`, `selectMcpHandler`) | `McpApparatus.workers: Map<serverId, LaunchedWorker>`; loop `startMcpApparatus` over the N configs (N `launchWorker` calls → N enclosures); teardown all                                                                                                                               |
| `src/mcp-broker/worker/enclosure.ts` (`defaultWorkerDir`)                                                                    | key the worker dir by `(sessionId, serverId)` so N workers don't collide                                                                                                                                                                                                               |
| `src/mcp-broker/worker-client.ts` (`makeWorkerHandleConnection`)                                                             | becomes a **router**: `makeWorkerRouter(Map<serverId, ctrlSocketPath>)`, dispatching on the `serverId` the mediator already passes; unknown `serverId` → JSON-RPC error (fail-closed)                                                                                                  |
| `src/mcp-broker/gate.ts` (`selectMcpHandler`)                                                                                | per-**server** `toolPolicy` keyed by `serverId`, wrapping each worker connection with its own gate                                                                                                                                                                                     |
| `src/session/lifecycle.ts` (`mcpServersFor`)                                                                                 | derive the N `serverId`s from `spec.mcp` (array) instead of the hardcoded `'mcp'`                                                                                                                                                                                                      |

**Unchanged (already N-capable):** `src/mcp-broker/mediator.ts` (handshake already threads `serverId`), `handshake.ts`, `tunnel.ts`/`tunnel-main.ts` (dumb pipe, `--server` already per-instance), `declare.ts` (`buildTunnelMcpServers` already CSV/array-capable), `src/acp/client.ts` (`mcpServers` already a loop), `worker/bridge.ts`/`outbound.ts`/`worker-main.ts`/`config.ts` (each worker process still serves exactly one upstream — correct per-worker, just launched N times), and the `--mcp-mount` wiring (stays **singular** — one mediator fan-in).

## papai changes (this repo)

- **Vault (`mcp` namespace):** value becomes a JSON **array** `[{ server, upstream_token? }]` (array-only; no legacy flat read). Internal rows carry no token; external rows carry the user's token.
- **Resolvers:** replace `resolveMcp`/`resolveMcpToken` with `resolveMcpServers(storageContextId, chatUserId): ResolvedMcpServer[]` and `resolveMcpTokens(storageContextId, chatUserId): Record<serverId, string>`. Each entry is resolved by the existing per-server logic — internal: fail-closed via `listEnabledInternalMcpServers` + `mintPluginMcpToken`; external: catalog lookup + vault token. **All-or-nothing:** if any selected server does not resolve, resolution yields a structured error identifying the offending server(s), and `start_session`/`continue_session`/`review_pr` refuse with that error (no silent drop).
- **`buildSessionProjectSpec` (`plugins/acp/tools.ts`):** emit the `mcp` array (each entry carrying its `id`) and the sibling `mcpTokens` map. `startSessionTool`/`continueSessionTool`/`review_pr` wiring updated to send the map.
- **Selection UI (`client/settings/sections/CodingMcpSection.svelte`):** the single `<select>` → an **add-row list**: "Add server" → pick from the dropdown (external catalog names + internal `plugin:<id>` labels) → a token field appears only when the chosen row is an external server; internal rows are tokenless. Rows are capped at the operator soft cap. Whole-record save persists the array. Mirrors the admin catalog-rows pattern.
- **Operator guardrail:** add `maxMcpServers` (default **3**) to `coding_guardrails` (`src/coding-credentials/guardrails.ts`) + its admin section. papai enforces the soft cap in the UI (max rows) and in `start_session` (refuse if the resolved set exceeds it). magi enforces the hard ceiling independently.
- **Redemption route (`src/mcp-server/server-route.ts`):** unchanged — each internal upstream is still one `/mcp/plugin/<id>` request with its own minted token; the per-request `isExposedInternalServer` fail-closed gate already operates per plugin.

## geofront (`~/Projects/experiments/geofront`) — no code change

N MCP-worker workspaces is a pure scale-out: magi runs `geofront workspace up` N times with N distinct working dirs, N single-host allowlists, and N mediator sockets. The workspace model is already fully independent per invocation (`--mcp-mount`/`--acp` are per-invocation `Option`s; the egress-proxy image is content-hash-cached/shared). Operator prerequisites, enforced fail-closed at magi:

- **Every** upstream host (papai's public origin + each external host) must be present in the org egress **ceiling** (`[egress.policy.ceiling]` in `org.toml`); a host outside it fails `workspace up` validation, which (per the all-or-nothing rule) refuses the whole session.
- Deployments running many concurrent multi-MCP sessions should widen Docker's default network address-pool (`dockerd --default-address-pools`): geofront creates 2 bridge networks per worker with no explicit subnets, so the default pool can exhaust around N≈15 concurrent workers host-wide.

## Fail-closed validation (both sides)

- **papai** pre-validates the full set at session start: every selected server resolves, and `count ≤ maxMcpServers`. Any failure → refuse, naming the offending server.
- **magi** re-validates every entry in `validateRepoSpec`: per-entry SSRF/host checks against `policy.allowedHosts`, `id` uniqueness, and `count ≤ MAX_MCP_UPSTREAMS`. Any failure → reject the whole spec.

A session never launches with a partial toolset.

## Cost & retained limitations

- Per MCP-enabled session: N worker enclosures + N egress proxies + N `geofront --acp` relay processes + 1 mediator; bounded by the cap.
- Cross-server tool-name collisions are resolved by the coding agent's per-server namespacing (documented; magi does no rewriting, preserving the opaque-relay invariant).
- Each worker still processes its upstream's requests serially; the agent parallelizes across servers via the N independent tunnels.
- `'ask'` tool policy remains allow-with-warn (unchanged); true interactive per-tool permission is still future work.
- Token revocation is still time-based (per-server minted-token TTL / secret rotation), unchanged.

## Testing

- **magi:** array `resolveMcp` validation (id-uniqueness, per-host ceiling rejection, `toolPolicy` per entry, count ≤ hard ceiling, whole-spec rejection on one bad entry); mediator `serverId` router (two workers — each `tools/call` reaches the correct upstream; unknown `serverId` → error); N-worker `startMcpApparatus`/teardown (dirs keyed by serverId, all shredded); per-server gate policy (a deny on server B doesn't affect server A).
- **papai:** array vault round-trip; `resolveMcpServers`/`resolveMcpTokens` all-or-nothing (one unresolvable entry → structured refusal naming it); mixed internal+external resolution; `maxMcpServers` guardrail enforcement (UI cap + start refusal); add-row UI visual spec (add/remove rows, token field only for external rows).
- **End-to-end:** a session with one internal + one external upstream lists and calls tools from both; a set containing one host outside the ceiling refuses the whole session with the culprit named.

## Module boundaries & phasing

Two repos change (geofront is config-only). Recommended plan phasing:

1. **magi** — array-capable broker (contract, validation, N-worker launch, mediator router, per-server gate). Testable in magi with a 2-upstream integration test.
2. **papai** — array vault + resolvers + `buildSessionProjectSpec` + add-row UI + `maxMcpServers` guardrail.

Because backward compatibility is out of scope, the two ship together as a contract cutover (magi built/tested first, but neither serves the old single shape once cut over). Each phase is independently buildable and testable; the cutover is the join point.
