<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0278: Multi-Server MCP Multiplexing — magi Broker (Plan 1 of 2)

## Status

Implemented (with divergence)

## Date

2026-07-09

## Context

Through Phases 1–3B, the sandbox MCP broker carried **exactly one** upstream per coding session: `ProjectSpec.mcp` was a single object, `mcpToken` a single string, and `startMcpApparatus` launched one credential-holding worker enclosure behind one mediator socket. ADR-0260 (Phase 1, stdio transport) and ADR-0264 (Phase 2, worker enclosure) established that substrate; ADR-0274 (Phase 3A, papai vault + operator catalog) and ADR-0275 (Phase 3B-magi, per-tool gate) layered identity vaulting, an operator-curated catalog, and per-tool allow/deny/ask enforcement on top — but always for the **single** upstream. A session that wanted two MCP servers (say, a `web-search` plugin and a `code-index` plugin) had no path: the type modeled one, the launch path provisioned one, and the mediator demuxed nothing.

This ADR's source plan (`docs/superpowers/plans/2026-07-09-multi-server-mcp-magi.md`, "Plan 1 of 2") is the **magi-side half** of multi-server multiplexing: make the broker accept and run **N MCP upstreams per coding session** with per-server tool-policy gating, fail-closed validation, and a hard ceiling — while leaving the mediator, the gate, the worker-client, and the tunnel code unchanged. The architecture the plan specifies: `projectSpec.mcp` becomes an array `[{ id, ... }]`; `mcpToken` becomes an `mcpTokens: Record<string,string>` map; magi launches one worker enclosure per upstream (dirs/sockets keyed by `serverId`) and stands up **one** mediator whose `handleConnection` is a new `serverId → handler` router (each handler is the existing `makeWorkerHandleConnection`, optionally wrapped by the existing per-server `makeGatedHandleConnection` from ADR-0275). The coding agent opens one tunnel per server and natively merges/namespaces their tools — so no JSON-RPC merge logic is added to magi.

The plan is explicit that this is **Plan 1 of 2** — it makes magi accept the new array/map contract; papai (Plan 2) sends it. There is **no backward compatibility**: the singular `mcp`/`mcpToken` shapes are replaced outright, and magi and papai must deploy together. No separate design spec was written for this plan (verified: `ls docs/superpowers/specs/ | grep multi-server-mcp-magi` is empty). Verified across the magi repo (`~/Projects/yourpapai/magi/`, READ-ONLY); the papai-side sender is covered by a companion ADR.

## Decision Drivers

- **N upstreams per session, behind one mediator.** The single mediator socket (and its single bind-mounted `--mcp-mount`) stays; multiplexing happens by routing each tunnel connection to its upstream's worker via the `serverId` the mediator already parses out of the handshake. No second mount, no second mediator.
- **The mediator, gate, worker-client, and tunnel code stay unchanged.** The plan's "Unchanged" list (mediator, handshake, tunnel, declare, gate, worker-client, worker bridge/outbound/config/main, acp client) is load-bearing: multi-server is an **apparatus + router + types** change, not a re-plumbing of the broker path.
- **Per-server, not session-level, tool policy.** Each upstream carries its own optional `toolPolicy`; the apparatus applies each entry's policy to its own handler independently. The gate (ADR-0275) was already per-entry in its shipped form, so this plan's per-entry threading is the natural consumer.
- **Fail-closed at the trust boundary.** A non-array `mcp`, a duplicate `id`, a count over the ceiling, an entry whose host is not in `policy.allowedHosts`, and an upstream declared without a matching `mcpTokens[id]` all reject the whole spec / fail the session fast — never silently launch with fewer workers than declared.
- **Hard ceiling regardless of caller config.** `MAX_MCP_UPSTREAMS = 8` is enforced at magi's trust boundary; papai enforces a lower operator-configurable soft cap separately.
- **Collision-free per-server filesystem paths.** Server ids like `plugin:web-search` contain `:` and `/`; two distinct raw ids can sanitize to the same prefix. Worker dirs and AF_UNIX ctrl sockets must be collision-free so concurrent provisioning for two upstreams never races a credential into the same directory.
- **One tunnel per server; no JSON-RPC merge.** The agent spawns one `mcp-tunnel` per server name (its `serverId`), all dialing the single broker socket; the agent natively merges/namespaces the tools. magi adds no merge logic.
- **Backward-incompatible contract; deploy together.** The singular shape is gone; magi and papai ship in lockstep (the plan's self-review note).

## Considered Options

### Option 1 — array `McpUpstream[]` + `mcpTokens` map + per-serverId worker dirs/socket + single-mediator `serverId` router (chosen)

`ProjectSpec.mcp` becomes `McpUpstream[]` with a required `id`; `mcpToken: string` becomes `mcpTokens: Record<string,string>` across the request/router/session/launcher types. The apparatus launches one worker per entry (bounded by `MAX_MCP_UPSTREAMS`), each in its own dir keyed by a collision-free `serverId` path segment, and builds a `Map<serverId, handler>` consumed by one mediator whose downstream is `makeServerRouter(routes)`.

- **Pros:** keeps the mediator/gate/worker-client/tunnel code unchanged; reuses the ADR-0275 per-entry gate verbatim; one mount/mediator regardless of N; the `serverId` (already in the handshake) is the natural routing key; fail-closed everywhere; the hard ceiling is a single constant.
- **Cons:** the type change is breaking across router/session/launcher (mid-plan typecheck is red until all tasks land — flagged in the plan); a singular `mcpToken` caller is hard-rejected; adds a new module (`server-router.ts`) and a new apparatus shape.

### Option 2 — keep `mcp` singular; run N sessions or N mediators

Leave the singular contract; a session wanting two upstreams launches two mediators / two mounts.

- **Pros:** no shared-type breakage; smallest conceptual diff.
- **Cons:** **rejected** by the architecture — the agent sees one broker socket via one bind-mount; two mediators would need two mounts (a geofront contract change) and the agent would have to be told about both. The mediator demux already parses `serverId`; routing inside one mediator is the structurally correct place. Doubles the enclosure overhead and the mount surface for no capability gain.

### Option 3 — merge JSON-RPC in the mediator (one worker, many upstreams)

Keep one worker enclosure but have the mediator (or worker) fan each request out to N upstreams and merge responses.

- **Pros:** one worker dir/socket regardless of N.
- **Cons:** **rejected** — reopens the parser surface the Phase-1 decomposition deliberately collapsed (the opaque-response invariant); merges hostile upstream output; couples credential boundaries (one worker would hold N tokens); the agent already natively merges tools from N tunnels, so magi-side merge is redundant and dangerous. The plan names this explicitly: "no JSON-RPC merge logic is added."

## Decision

The chosen Option 1 shipped in full across magi — `ProjectSpec.mcp` is an array, `mcpTokens` is a map, one worker enclosure per upstream is launched behind one mediator routed by `serverId`, and a hard ceiling caps the count. Every task in the plan landed, with two material divergences (the path-segment hash and the module extraction of the apparatus) documented below. What shipped:

1. **`McpUpstream` type + `MAX_MCP_UPSTREAMS` (config.ts).** `ProjectSpec.mcp` is `McpUpstream[]` where each entry carries `{ id, url, host, header, allowedHosts, toolPolicy? }`; `MAX_MCP_UPSTREAMS = 8` is exported alongside (`config.ts:69-76,80,105`).
2. **Array validation in `resolveMcp` (spec-validation.ts).** `resolveMcp` parses `mcp` as an array of entries via `resolveMcpEntry`: per-entry id-required + charset + https URL + host-pinned-to-hostname + `policy.allowedHosts` re-check + allowedHosts bare-host check + per-entry `resolveMcpToolPolicy`; the wrapper rejects a non-array, enforces the `MAX_MCP_UPSTREAMS` ceiling, and rejects duplicate ids (fail-closed) (`spec-validation.ts:117-166`). An additional `MCP_ID_PATTERN` charset guard (`:115`) protects the CSV round-trip in `mcpServersFor`.
3. **`mcpTokens` map on the request (router.ts).** `handleStart`, `handleFollowUp`, and the follow-up body parsing all read `mcpTokens: asStringRecord(body['mcpTokens'])`; the singular `mcpToken` is gone from the server layer (`router.ts:121,241,273`).
4. **`LaunchMcpConfig.id` + array `LaunchSpec.mcp` (launcher.ts).** `LaunchMcpConfig` carries a required `id` (plus `url`/`host`/`header`/`allowedHosts`/`token`/`toolPolicy?`); `LaunchSpec.mcp` is `LaunchMcpConfig[]` (`launcher.ts:8-16,30`).
5. **`mcpLaunchConfigs` (helpers.ts).** Replaces the singular `mcpLaunchConfig`; builds one `LaunchMcpConfig` per declared upstream by spreading `...entry` and pairing each with its `mcpTokens[id]` token; an upstream without a matching token fails closed naming the offending id (`helpers.ts:65-78`).
6. **`buildLaunchSpec` + `mcpServersFor` + session input types.** `buildLaunchSpec` (now in `launch-spec.ts:14-27`) threads `mcpLaunchConfigs(input.projectSpec.mcp, input.mcpTokens)`; `mcpServersFor` (lifecycle.ts:123-126) derives the CSV of ids consumed by `buildTunnelMcpServers` (one tunnel MCP server per upstream); `StartSessionInput`/follow-up/`FollowUpPlan` all carry `mcpTokens?: Record<string,string>` (state.ts:124,142,163; lifecycle.ts:158,198). No stray singular `mcpToken` remains in `src/` outside the worker's `MAGI_MCP_UPSTREAM_TOKEN` env var.
7. **Per-server worker dirs/sockets + the `serverId` router.** `defaultWorkerDir(sessionId, serverId)` keys the dir by a collision-free `serverIdPathSegment` (sanitized-readable-prefix + sha256 hash suffix); `launchWorker(dir, sessionId, serverId, opts)` builds the ctrl socket path from the same segment; `makeServerRouter(routes)` dispatches each tunnel connection by handshake `serverId`, failing closed with a `-32601` JSON-RPC error on an unknown id (`enclosure.ts:66-77,199-214`; `server-router.ts:10-29`).
8. **N-worker apparatus.** `McpApparatus` carries `workers: LaunchedWorker[]`; `startMcpApparatus` launches one worker per upstream via `Promise.allSettled` (bounded by the validated ceiling), builds the per-`serverId` route map, applies each entry's `toolPolicy` to its own handler (`inner` when absent, `makeGatedHandleConnection(entry.toolPolicy, sessionId, inner, onMcpToolAsk)` when present), and stands up one mediator whose downstream is `makeServerRouter(routes)`; a failed entry triggers best-effort shutdown of any already-launched workers and propagates the launch error (`mcp-apparatus.ts:27-31,100-145`).
9. **Teardown.** `teardownMcpApparatus` closes the mediator + unlinks its socket, then concurrently shuts down every worker (best-effort, error-isolated) (`mcp-apparatus.ts:167-173`).
10. **Tests.** Type/unit coverage for `MAX_MCP_UPSTREAMS`/`McpUpstream`/array `ProjectSpec.mcp` (config.test.ts:186-198), array validation incl. duplicate/ceiling/fail-closed (spec-validation.test.ts), `LaunchMcpConfig.id`/array `LaunchSpec.mcp` (launcher-types.test.ts), router `mcpTokens` threading, `makeServerRouter` dispatch + fail-closed (server-router.test.ts), and the multi-upstream apparatus — one worker per upstream behind one mediator, per-`serverId` routing, per-server gate isolation, and rollback naming the failed upstream (mcp-apparatus.test.ts).

## Consequences

### Positive

- A coding session can reach **N MCP upstreams** (up to the hard ceiling) through one mediator and one bind-mounted broker socket — the architecture's single-mount contract is preserved while the capability scales.
- The mediator, gate, worker-client, tunnel, handshake, and declare code are **unchanged**: multi-server is purely an apparatus + router + types change, so the opaque-response invariant and the Phase-1/2 safety properties carry forward verbatim.
- Per-server tool policy is the natural unit (an operator denies a tool on one upstream without affecting another), and the ADR-0275 gate is reused per route without modification.
- Fail-closed everywhere a misconfiguration could waste a credential or cross-wire an upstream: non-array `mcp`, duplicate id, over-ceiling count, disallowed host, and a missing `mcpTokens[id]` all reject fast.
- Collision-free per-server paths (sanitized prefix + hash) mean concurrent provisioning for two upstreams can never race a staged token into the same directory, even for ids that sanitize identically.
- The hard ceiling (`MAX_MCP_UPSTREAMS = 8`) is a single constant at magi's trust boundary, independent of papai's lower operator-configurable soft cap.

### Negative

- **Breaking contract change with no backward compatibility.** The singular `mcp`/`mcpToken` shapes are replaced outright; any caller still sending the singular shape is hard-rejected. magi and papai must deploy together (the plan's explicit lockstep note). Mid-plan, the shared-type change makes cross-file typecheck red until all threading tasks land — the plan flags this and allows combining the Task 1+2 commits.
- **The apparatus was extracted to its own module, not a direct `geofront-runtime.ts` edit.** The plan's file structure (Task 8) put `startMcpApparatus` inside `geofront-runtime.ts`; shipped lives in `mcp-apparatus.ts` (a sibling module), with `geofront-runtime.launch` just calling it. Intent preserved; location diverged.
- **The two-upstream e2e test (Task 9) was folded into `mcp-apparatus.test.ts`, not a standalone `multi-upstream-e2e.test.ts`.** The plan envisioned a separate `tests/mcp-broker/multi-upstream-e2e.test.ts` mirroring `transport-e2e.test.ts`; shipped proves the same properties (one worker per upstream, per-`serverId` routing, per-server gate isolation, rollback) inside the apparatus test against fake workers.
- **`serverIdPathSegment` hashes, not just sanitizes-truncates.** The plan's `sanitizeServerId(serverId).slice(0, 32)` guard would still collide for ids sharing a long common prefix; shipped appends a sha256 hash suffix to make the path segment collision-free (a defense the plan's note gestured at but did not specify).

### Risks

- **Full two-enclosure docker E2E (two real worker containers behind one mediator in a live session) remains the Linux handoff.** The apparatus test proves routing/gating/rollback against fake worker control sockets; the real two-enclosure docker chain inherits the same-kernel `--mcp-mount` verification path from ADR-0263.
- **The `serverId` routing key is caller-supplied and trust-boundary-validated.** An unknown `serverId` fails closed (`-32601`), but a misconfigured papai sending a token under the wrong id would fail the session at `mcpLaunchConfigs` rather than silently degrade — the fail-closed contract is only as good as the id/token pairing the caller sends.
- **The hard ceiling is enforced only at `resolveMcp`.** A caller that bypasses `validateRepoSpec` (e.g. an internal test path) could construct an over-ceiling array; production paths all go through validation, but the ceiling is not re-checked inside `startMcpApparatus`.
- **No dedicated CSV-injection test for `mcpServersFor`.** `MCP_ID_PATTERN` forbids commas/whitespace so the id→CSV→split round-trip is structurally safe, but the round-trip correctness rests on the charset guard rather than a dedicated round-trip test.

## Related Decisions

- **ADR-0260: Sandbox MCP Broker — Phase 1 (Stdio Transport)** — established the mediator whose `handleConnection(serverId, inbound, outbound)` seam (`MediatorDeps`) the `serverId` router dispatches along; this plan adds the router without touching the mediator.
- **ADR-0264: Sandbox MCP Broker — Phase 2 (Worker Enclosure)** — the credential-holding worker whose per-upstream launch, ctrl-socket, and teardown this plan generalizes from one to N (dirs/sockets now keyed by `serverId`).
- **ADR-0274: Sandbox MCP Broker — Phase 3a (papai Vault & Catalog)** — the papai-side operator catalog + per-identity resolver that **populates** `projectSpec.mcp[]` and `mcpTokens`; this plan is the magi-side consumer of that array/map contract.
- **ADR-0275: Sandbox MCP Broker — Phase 3b (magi: Multi-Server & Operator Catalog)** — the per-tool gate (`makeGatedHandleConnection`) this plan wraps each route's handler in; ADR-0275 already documented `makeServerRouter`, `mcp-apparatus.ts`, and the per-entry `toolPolicy` as shipped, and explicitly attributed the multi-server substrate to this plan. This ADR owns that attribution in depth.
- **ADR-0276: Sandbox MCP Broker — Phase 3b (papai: Catalog UI, Vault, Gating)** — the papai-side sender of the array/map contract; this plan's "Plan 2 of 2" companion.

## Implementation Notes

Verified present against the shipped tree via `grep`/`glob`/`read`. magi paths are under `~/Projects/yourpapai/magi/` (READ-ONLY); the papai-side sender is covered by a companion ADR.

| File | Role | Evidence |
| --- | --- | --- |
| `~/Projects/yourpapai/magi/src/project/config.ts:69-76` | `McpUpstream` interface — `{ id, url, host, header, allowedHosts, toolPolicy? }`; `id` is the stable serverId (ACP name, handshake tag, routing key). | `read` confirms. |
| `~/Projects/yourpapai/magi/src/project/config.ts:80` | `MAX_MCP_UPSTREAMS = 8` — absolute per-session ceiling at magi's trust boundary. | `read` confirms. |
| `~/Projects/yourpapai/magi/src/project/config.ts:105` | `ProjectSpec.mcp?: McpUpstream[]` — the array contract (was a single object). | `read` confirms. |
| `~/Projects/yourpapai/magi/src/project/spec-validation.ts:115` | `MCP_ID_PATTERN` charset guard — protects the CSV round-trip in `mcpServersFor` (divergence: extra guard the plan did not specify). | `read` confirms. |
| `~/Projects/yourpapai/magi/src/project/spec-validation.ts:117-150` | `resolveMcpEntry` — per-entry: id-required + charset, https URL, host-pinned-to-hostname, `policy.allowedHosts` re-check, bare-host `allowedHosts`, per-entry `resolveMcpToolPolicy`. | `read` confirms. |
| `~/Projects/yourpapai/magi/src/project/spec-validation.ts:152-166` | `resolveMcp` — non-array reject, empty→undefined, `MAX_MCP_UPSTREAMS` ceiling, duplicate-id reject (fail-closed). | `read` confirms. |
| `~/Projects/yourpapai/magi/src/project/spec-validation.ts:226,237` | `validateRepoSpec` calls `resolveMcp` and returns the validated `mcp` array. | `read` confirms. |
| `~/Projects/yourpapai/magi/src/server/router.ts:121,241,273` | `mcpTokens: asStringRecord(body['mcpTokens'])` in `handleStart`, follow-up, and follow-up-body parsing — the singular `mcpToken` is gone from the server layer. | `grep` confirms. |
| `~/Projects/yourpapai/magi/src/launcher/launcher.ts:8-16` | `LaunchMcpConfig` carries required `id` (plus url/host/header/allowedHosts/token/toolPolicy?). | `read` confirms. |
| `~/Projects/yourpapai/magi/src/launcher/launcher.ts:30` | `LaunchSpec.mcp?: LaunchMcpConfig[]` — array (was a single object). | `read` confirms. |
| `~/Projects/yourpapai/magi/src/session/helpers.ts:65-78` | `mcpLaunchConfigs` — one `LaunchMcpConfig` per upstream via `...entry` spread + `mcpTokens[id]` token pairing; missing token fails closed naming the id. | `read` confirms. |
| `~/Projects/yourpapai/magi/src/session/launch-spec.ts:14-27` | `buildLaunchSpec` threads `mcpLaunchConfigs(input.projectSpec.mcp, input.mcpTokens)` into `LaunchSpec.mcp`. | `read` confirms (divergence: extracted to `launch-spec.ts`, not `lifecycle.ts`). |
| `~/Projects/yourpapai/magi/src/session/lifecycle.ts:123-126` | `mcpServersFor` — derives the CSV of ids (`spec.mcp.map(m=>m.id).join(',')`) consumed by `buildTunnelMcpServers`; empty when no upstreams. | `read` confirms. |
| `~/Projects/yourpapai/magi/src/session/lifecycle.ts:158,198` | Follow-up paths thread `mcpTokens` (from `input` and from `credentials`). | `read` confirms. |
| `~/Projects/yourpapai/magi/src/session/state.ts:124,142,163` | `StartSessionInput`/follow-up/create-session input types carry `mcpTokens?: Record<string,string>`. | `grep` confirms. |
| `~/Projects/yourpapai/magi/src/mcp-broker/worker/enclosure.ts:66-70` | `serverIdPathSegment` — sanitized-readable-prefix (24 chars) + sha256 hash suffix (12 chars) = collision-free path segment (divergence: hash, not just sanitize-truncate). | `read` confirms. |
| `~/Projects/yourpapai/magi/src/mcp-broker/worker/enclosure.ts:75-77` | `defaultWorkerDir(sessionId, serverId)` — keyed by both sessionId and the collision-free serverId segment. | `read` confirms. |
| `~/Projects/yourpapai/magi/src/mcp-broker/worker/enclosure.ts:199-214` | `launchWorker(dir, sessionId, serverId, opts)` — ctrl socket path built from `serverIdPathSegment`; returns `LaunchedWorker { serverId, ctrlSocketPath, shutdown }`. | `read` confirms. |
| `~/Projects/yourpapai/magi/src/mcp-broker/server-router.ts:10-29` | `makeServerRouter(routes)` — per-`serverId` dispatch; unknown id fails closed with `-32601` + `outbound.end()` + `inbound.resume()`. | `read` confirms. |
| `~/Projects/yourpapai/magi/src/runtime/geofront/mcp-apparatus.ts:27-31` | `McpApparatus { mediator, mcpSocketPath, workers: LaunchedWorker[] }` — N workers behind one mediator (divergence: extracted module). | `read` confirms. |
| `~/Projects/yourpapai/magi/src/runtime/geofront/mcp-apparatus.ts:52-67` | `launchOneWorker` — per-entry launch (dir + plan + provision + launch), errors re-tagged with the offending upstream id. | `read` confirms. |
| `~/Projects/yourpapai/magi/src/runtime/geofront/mcp-apparatus.ts:100-145` | `startMcpApparatus` — one worker per upstream via `Promise.allSettled` (`:114`); per-entry route map (`:124-135`); absent policy → `inner`, else `makeGatedHandleConnection(entry.toolPolicy, sessionId, inner, onMcpToolAsk)`; single mediator downstream = `makeServerRouter(routes)` (`:137`); failed entry → best-effort shutdown + propagate (`:117-123`). | `read` confirms. |
| `~/Projects/yourpapai/magi/src/runtime/geofront/mcp-apparatus.ts:167-173` | `teardownMcpApparatus` — mediator close+unlink, then concurrent worker shutdown (best-effort, error-isolated). | `read` confirms. |
| `~/Projects/yourpapai/magi/tests/project/config.test.ts:186-198` | `MAX_MCP_UPSTREAMS === 8`; `ProjectSpec.mcp` typed as `McpUpstream[]`. | `grep` confirms. |
| `~/Projects/yourpapai/magi/tests/project/spec-validation.test.ts` | Array validation: multiple valid upstreams, duplicate-id reject, fail-closed on disallowed host, over-ceiling reject, absent-mcp → undefined. | `grep` confirms (uses `MAX_MCP_UPSTREAMS + 1`). |
| `~/Projects/yourpapai/magi/tests/launcher/launcher-types.test.ts:6-27` | `LaunchMcpConfig` carries `id`; `LaunchSpec.mcp` is an array of `LaunchMcpConfig`. | `grep` confirms. |
| `~/Projects/yourpapai/magi/tests/mcp-broker/server-router.test.ts:29` | `makeServerRouter` dispatch + fail-closed unknown-id. | `grep` confirms. |
| `~/Projects/yourpapai/magi/tests/runtime/geofront/mcp-apparatus.test.ts:43-108` | Multi-upstream apparatus: one worker per upstream (`'a'`/`'b'`) behind one mediator, per-`serverId` routing, teardown unlinks sockets (divergence: Task 9 e2e folded here). | `grep` confirms. |
| `~/Projects/yourpapai/magi/tests/runtime/geofront/mcp-apparatus.test.ts:132-158` | `onMcpToolAsk` wiring end-to-end (per-server gate isolation inherited from ADR-0275). | `grep` confirms. |
| `~/Projects/yourpapai/magi/tests/runtime/geofront/mcp-apparatus.test.ts:201-260` | Rollback: one of two upstreams never ready → launch error preserved (names the failed upstream), launched worker shut down, no leaked ctrl socket. | `grep` confirms. |

Plan-vs-implementation notes:

- **`serverIdPathSegment` hashes; the plan specified sanitize-truncate only.** The plan's Task 7 (`enclosure.ts`) called for `sanitizeServerId(serverId).slice(0, 32)` as a guard against AF_UNIX path-length overflow, with a parenthetical "if a very long id risks overflow, hash it instead." Shipped goes further: `serverIdPathSegment` (`enclosure.ts:66-70`) appends a 12-char sha256 hash of the **raw** id to a 24-char sanitized-readable prefix, making the path segment **collision-free** — necessary because distinct raw ids can sanitize to the same prefix (`plugin:a` and `plugin/a` both → `plugin_a`), and two colliding ids would share a worker dir + ctrl socket, racing staged tokens into the same directory during concurrent provisioning. The inline rationale (`enclosure.ts:56-65`) documents this. Intent (filesystem-safe, length-bounded path) preserved; the collision-free defense is stricter than the plan.
- **The apparatus was extracted to `mcp-apparatus.ts`, not a direct `geofront-runtime.ts` edit.** The plan's file structure (Task 8) listed `McpApparatus`/`startMcpApparatus`/`teardownMcpApparatus` as edits inside `src/runtime/geofront/geofront-runtime.ts`. Shipped: the apparatus lives in a dedicated sibling `mcp-apparatus.ts` (`startMcpApparatus`, `launchOneWorker`, `teardownMcpApparatus`, `McpApparatus`, `shutdownWorkersBestEffort`), and `geofront-runtime.launch` just calls it. ADR-0275 already co-cited `mcp-apparatus.ts` as a Phase-3B module; this ADR owns the multi-server apparatus attribution. Intent (N workers, one mediator, per-route gating, rollback) preserved verbatim; location diverged.
- **`buildLaunchSpec` moved to `launch-spec.ts`.** The plan (Task 6) edited `buildLaunchSpec`/`mcpServersFor` in `lifecycle.ts`. Shipped: `buildLaunchSpec` (and the added `buildLaunchSpecFor`) live in `launch-spec.ts:14-48`; `mcpServersFor` stayed in `lifecycle.ts:123-126`, and `lifecycle.ts:118` re-exports the launch-spec helpers. Intent preserved; `buildLaunchSpec` relocated.
- **The Task 9 two-upstream e2e was folded into `mcp-apparatus.test.ts`, not a standalone file.** The plan (Task 9) created `tests/mcp-broker/multi-upstream-e2e.test.ts` mirroring `transport-e2e.test.ts`. Shipped has no such file (`ls tests/mcp-broker/ | grep multi` is empty); the multi-upstream routing + per-server gate isolation + rollback proofs live in `tests/runtime/geofront/mcp-apparatus.test.ts` (lines 43-108, 132-158, 201-260) against fake worker control sockets. The coverage the plan asked for is present; the file boundary diverged.
- **`MCP_ID_PATTERN` is an extra charset guard the plan did not specify.** The plan's `resolveMcpEntry` (Task 2) checked only that `id` was a non-empty string. Shipped adds `/^[a-zA-Z0-9_.:/-]+$/u` (`spec-validation.ts:115,121`) forbidding commas and whitespace, because `mcpServersFor` joins ids with `,` and `buildTunnelMcpServers` splits on `,` — a comma or whitespace in an id would silently drop or duplicate upstreams. Checked at the trust boundary so the round-trip is safe regardless of caller. Additive hardening, within the plan's fail-closed intent.
- **`mcpLaunchConfigs` is plural and multi-server; `toolPolicy` rides `...entry`.** The plan (Task 5) replaced singular `mcpLaunchConfig(mcp, token)` with plural `mcpLaunchConfigs(mcp, mcpTokens)`. Shipped is exactly that (`helpers.ts:65-78`); the per-entry `toolPolicy` is carried by the `...entry` spread (`:76`), not a dedicated field assignment — matching the ADR-0275 per-entry policy shape.
- **`Promise.allSettled` (bounded), not a sequential await-in-loop.** The plan's Task 8 `startMcpApparatus` sketch used a sequential `for (const entry of mcp) { ... }` loop with a try/catch that shut down launched workers on failure. Shipped `startMcpApparatus` (`mcp-apparatus.ts:100-145`) launches all entries via `Promise.allSettled(mcp.map(...))` (bounded by the validated `MAX_MCP_UPSTREAMS`), then collects fulfilled workers and propagates the first rejection after best-effort shutdown. Concurrent launch is safe because each upstream's dir/socket is collision-free (see the `serverIdPathSegment` divergence). Intent (launch all, rollback on failure, propagate the real error) preserved; the concurrency shape is richer.
- **No magi-specific design spec exists; a shared cross-repo design does.** `ls docs/superpowers/specs/ | grep multi-server-mcp-magi` is empty; the plan instead references the cross-repo design `docs/superpowers/specs/2026-07-09-multi-server-mcp-multiplexing-design.md` (shared with the papai half / ADR-0279). That shared design is archived to `docs/archive/` alongside this batch; no magi-only design was written.
- **Full two-enclosure docker E2E remains the Linux handoff.** The apparatus test proves one-worker-per-upstream routing, per-server gate isolation, and rollback against fake worker control sockets; the real two-enclosure docker chain (two credential-holding containers behind one mediator in a live session) inherits the same-kernel `--mcp-mount` verification path from ADR-0263, the same handoff ADR-0275 recorded.

The source plan `docs/superpowers/plans/2026-07-09-multi-server-mcp-magi.md` is archived alongside this ADR to `docs/archive/`. No magi-specific design spec was written; the plan references the shared cross-repo design `docs/archive/2026-07-09-multi-server-mcp-multiplexing-design.md` (co-shared with ADR-0279), also archived to `docs/archive/`.
