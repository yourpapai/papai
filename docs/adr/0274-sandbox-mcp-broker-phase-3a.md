<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0274: Sandbox MCP Broker — Phase 3a (papai Vault & Catalog)

## Status

Implemented (with divergence)

## Date

2026-07-08

## Context

ADR-0260 shipped **Phase 1** (the stdio transport: `agent → mcp-tunnel → bind-mounted host socket → magi-main mediator → stub`) and ADR-0264 shipped **Phase 2** (the kernel-isolated, credential-holding `mcp-worker` enclosure that makes the real outbound HTTPS call). Both phases ran on **magi-process env config** — `MAGI_MCP_UPSTREAM_URL`/`_HEADER`/`_TOKEN`, `MAGI_ALLOWED_MCP_HOSTS`, `MAGI_MCP_TUNNEL_SERVERS` — and were scoped to a **single** upstream per session. That env config put the credential in magi-main's long-lived process env and could not vary per user/group, so it was always an interim contract.

**Phase 3A is the papai side of the broker: retire that env config and source the worker's upstream MCP config + credential *per session* from a per-identity papai vault**, threaded through `projectSpec` to magi exactly like the existing forge token. This ADR's source plan (`docs/superpowers/plans/2026-07-08-sandbox-mcp-broker-phase-3a.md`) implements design D §5.5 (papai vault). The architecture: papai gains a new `mcp` namespace in the `coding_session_credentials` vault (alongside `forge`/`agent-provider`); a `resolveMcp`/`resolveMcpToken` resolver (per-identity, mirroring `resolveForge`/`resolveForgeToken`) feeds `projectSpec.mcp` (non-secret) + an `mcpToken` (secret, sibling to `forgeToken`) into the `/sessions` request; magi re-validates `projectSpec.mcp` in `validateRepoSpec` and sources the worker's `WorkerConfig` + credential + enable-gate from the validated session spec instead of `process.env`. The Phase-2 worker enclosure, outbound client, gating, and geofront are unchanged — only *where magi gets the config* changes.

The plan scoped Phase 3A to the **per-identity vault + resolver + config wiring** and explicitly deferred the operator catalog, the settings-UI section, magi-side per-tool gating/audit, and multi-server to **Phase 3B**. In 3A the user's `mcp` vault held their upstream URL directly (bring-your-own); 3B was to constrain the URL to operator-catalog entries.

The shared design (`docs/archive/2026-07-05-sandbox-mcp-broker-design.md`, "design D"; §5.5 papai vault, §3 tiered trust) is the spec, already archived alongside ADR-0260.

## Decision Drivers

- **Per-identity, like forge.** The `mcp` vault honors the `coding_identity` group policy (`initiator`/`shared`/`designated:<userId>`); the resolver threads `identityContext(storageContextId, chatUserId)` exactly as `resolveForge`/`resolveForgeToken` do — a group session reads the acting identity's vault, never an arbitrary one.
- **INV-1 preserved — the credential rides the same secret channel as `forgeToken`.** It is a sibling field on the request (outside `projectSpec`), staged into the worker enclosure only (magi's `request`-secret manifest → `magi-init` export + shred), never in the agent sandbox and never in magi-main's process env. Phase 3A only changes *where magi gets the config*, not the secret channel.
- **magi is the trust boundary.** The untrusted `mcp` field is re-validated defensively in `validateRepoSpec`: https-only, host pinned to the URL's hostname, host in `policy.allowedHosts`, `allowedHosts` bare-host-validated — fail-closed (a present-but-invalid `mcp` rejects the session).
- **Retire env config.** No magi-main path may read `MAGI_MCP_UPSTREAM_*` / `MAGI_MCP_TUNNEL_SERVERS` anymore; the worker config + credential + enable-gate come from the session spec. (The enclosure env set by `buildWorkerPlan` is unchanged — `worker-main.ts` still calls `parseWorkerConfig(process.env)` against that per-session env.)
- **Non-MCP sessions are byte-identical.** A session with no `mcp` vault resolves to no `projectSpec.mcp`, no `mcpToken`, no apparatus — nothing changes for the common case.
- **(Evolved in 3B) Tiered trust — no self-serve arbitrary upstream URL.** An operator vets which servers exist and sets the per-tool policy; the user only picks a vetted server and supplies their own credential. This collapsed the Phase-3B handoff into the same files and superseded 3A's interim freeform-URL shape.

## Considered Options

### Option 1 — per-identity `mcp` vault → resolver → `projectSpec.mcp[]` + `mcpTokens` into `/sessions`; operator catalog authoritative (chosen, as shipped/evolved)

A `mcp` namespace in `coding_session_credentials`; `resolveMcpServers`/`resolveMcpTokens` resolve per-identity; the result is threaded as an array `projectSpec.mcp` + a per-server `mcpTokens` map; magi re-validates the array fail-closed; an operator-published catalog is the authoritative source of the URL/host/policy, and the user's vault stores only `{ server, upstream_token }` selections.

- **Pros:** preserves INV-1 (credential rides the `forgeToken` sibling channel); makes the catalog the single source of truth for URL/host/policy so a host/URL mismatch is no longer representable; generalizes cleanly to several upstreams; per-tool policy flows end-to-end from the catalog; per-identity resolution is identical to forge.
- **Cons:** it is the *Phase-3B* shape, not the plan's literal interim one — every concrete identifier in the plan (`resolveMcp`/`resolveMcpToken`, `projectSpec.mcp` object, `mcpToken` string, three flat vault fields) was generalized before this ADR was written; the catalog + plugin-server + selection/merge machinery is materially more surface than 3A scoped.

### Option 2 — the plan's literal interim shape: single bring-your-own URL, singular resolver/spec/token

The vault stores `upstream_url`/`upstream_header`/`upstream_token` (3 flat fields); `resolveMcp` returns one `ResolvedMcp` object and `resolveMcpToken` one string; `projectSpec.mcp` is a single object and the POST carries one `mcpToken`.

- **Pros:** smallest possible diff over Phase 2; mirrors `resolveForge` one-for-one; ships the per-identity secret-channel story with no catalog to design.
- **Cons:** a host/URL mismatch is representable and only caught at magi launch (a footgun); the operator has no control over which upstreams are allowed or their tool policies; no path to several upstreams; bring-your-own URL is a weaker trust posture than tiered trust. This shape **did ship briefly as the 3A interim**, then was superseded by Option 1 within the same files.

### Option 3 — keep env config (`MAGI_MCP_UPSTREAM_*`), no vault

Do not build a per-identity vault at all; leave Phase-2's env sourcing in place.

- **Pros:** zero papai-side work; no new vault namespace/resolver.
- **Cons:** **rejected** — the credential stays in magi-main's long-lived process env (re-opens the INV-1 surface Phase 2 deliberately closed); cannot vary per user/group; cannot retire `MAGI_MCP_UPSTREAM_*`/`MAGI_MCP_TUNNEL_SERVERS`; no per-identity scoping, defeating the whole phase.

## Decision

The Phase-3A goal shipped in full — the worker's upstream config + credential are sourced **per session from a per-identity papai vault**, threaded through `projectSpec` to magi, re-validated fail-closed at the magi trust boundary, and the magi-main env sourcing is retired. Verified against the *current* tree, every concrete identifier carries the **Phase-3B multi-server + operator-catalog generalization** (the interim freeform single-server shape of Option 2 shipped and was then superseded). What shipped:

1. **`mcp` vault namespace (papai).** `'mcp'` is a member of `CODING_NAMESPACES` alongside `agent-provider`/`forge`, with its own `FIELDS_BY_NAMESPACE`/`REQUIRED_BY_NAMESPACE` entries — so the vault is resolvable, redactable, and per-identity exactly like forge.
2. **Settings-route field metadata (papai).** A `FIELDS_META.mcp` entry drives the generic `coding-credentials` route so the vault is fully usable via the API (the Phase-3B UI section renders from it).
3. **Per-identity MCP resolvers (papai).** `resolveMcpServers` (non-secret validated config) + `resolveMcpTokens` (credential), added to the `RuntimeContext.codingSecrets` facade, both reusing the same `identityContext` threading as `resolveForge`/`resolveForgeToken`.
4. **`projectSpec.mcp` + `mcpTokens` threaded into `/sessions` (papai).** `buildSessionProjectSpec` spreads the resolved upstreams onto the spec; `startSessionTool` adds the per-server credential map to the POST body (sibling to `forgeToken`); the follow-up endpoint carries `mcpTokens` fail-closed and never resends `mcp[]`.
5. **magi re-validates `projectSpec.mcp` + intakes the credential map (magi).** `resolveMcp` validates the (array) `mcp` field fail-closed — https, host pinned to the URL hostname, host in `policy.allowedHosts`, bare-host `allowedHosts`, an upstream-count cap, and a duplicate-id check — inside `validateRepoSpec`; the request handler accepts `mcpTokens` and matches each `projectSpec.mcp[]` entry to a token fail-closed.
6. **Worker sourced from the session spec, not `process.env` (magi).** `mcpLaunchConfigs(projectSpec.mcp, mcpTokens)` builds the per-session launch config from the validated spec + per-request tokens; no magi-main path reads `MAGI_MCP_UPSTREAM_*`/`MAGI_MCP_TUNNEL_SERVERS` (fully attributed to / verified in ADR-0264, which covers the same tree).
7. **(Phase-3B superset) Operator catalog + selection model.** An admin-published catalog (`mcp_catalog`) is the authoritative source of URL/host/header/per-tool policy; the user's vault stores only `{ server, upstream_token }` selections in a single `servers` JSON field; `resolveMcpServers` looks the stored `server` up in the *current* catalog and derives `{ url, host, header, allowedHosts, toolPolicy }` from it — never from the vault — so a removed/renamed server fails closed.
8. **(Phase-3B superset) Internal first-party plugin MCP servers.** papai can host a plugin as an MCP upstream at `/mcp/plugin/<pluginId>` (manifest `mcpServer: true`); selecting `server = 'plugin:<id>'` stores no token (papai mints a signed 30-day binding token at resolve time). magi's view is unchanged — just another opaque HTTP-MCP upstream + bearer credential.
9. **(Phase-3B superset) Guardrail.** A `maxMcpServers` coding guardrail (1-8, default 3) caps the selection set, enforced fail-closed in the resolver and mirrored by magi's `MAX_MCP_UPSTREAMS`.
10. **Docs (papai).** `docs/architecture/coding-sessions.md` carries a combined "Sandbox MCP broker (Phases 1-3B)" section whose Config paragraph documents the Phase-3A→3B evolution explicitly, and `docs/architecture/coding-stack-overview.md` §3.5-3.6 documents the multi-server vault and states it supersedes the single-server (Phase 3A/3B) description.

## Consequences

### Positive

- The worker's upstream config + credential are **per session, per identity**, threaded through `projectSpec` exactly like the forge token — the magi-process env config (`MAGI_MCP_UPSTREAM_*`/`MAGI_MCP_TUNNEL_SERVERS`) is retired from every magi-main path, and a group session correctly reads the acting identity's vault via `coding_identity`.
- INV-1 is preserved end-to-end: the credential is a sibling field to `forgeToken` (outside `projectSpec`), matched fail-closed to each `projectSpec.mcp[]` entry, and staged into the worker enclosure only — never the agent sandbox, never magi-main's process env.
- The catalog made the URL/host authoritative and removed the host/URL-mismatch footgun (the interim freeform shape's `upstream_url`/`upstream_header`/`upstream_token` triple is gone); `default_tool_policy` is required on every entry with a code-level `deny` fallback, so there is no allow-all-by-omission.
- Resolution is fail-closed at two points — papai (malformed/over-cap/duplicate/unknown-catalog/missing-token/dropped-plugin) and magi (`validateRepoSpec`) — and the two never drift: `resolveMcpTokens` is derived strictly from `resolveMcpServers`' validated set.
- Non-MCP sessions (no `mcp` vault) resolve to no `projectSpec.mcp`/`mcpTokens` and launch byte-identically to pre-MCP behavior.

### Negative

- The production wiring **outpaced the plan**: the plan's literal interim shape (3 flat vault fields; singular `resolveMcp`/`resolveMcpToken`; singular `projectSpec.mcp` object; singular `mcpToken` string) is no longer present verbatim — every identifier was generalized to the Phase-3B multi-server/catalog shape before this ADR was written. An ADR that tries to verify the literal 3A field/resolver names against the current tree will not find them; the divergence notes below are the map.
- The vault field shape changed under existing data: 3A's flat `upstream_url`/`upstream_header`/`upstream_token` were replaced by a single `servers` JSON blob. Any vault written by the interim 3A shape is not forward-compatible with the catalog-selection model (a one-time migration/re-save is implied, not a migration script in the tree).
- Phase-3B scope (catalog, internal plugin servers, selection merge, `maxMcpServers` guardrail, admin routes) is co-attributed here because it supersedes the 3A shape in the same files; the operator-catalog/settings-UI/per-tool-gating work the plan deferred is *done*, not pending — which inflates this phase's apparent surface.

### Risks

- **The ADR's evidence cites the Phase-3B shape, not the plan's interim one.** A reader cross-checking the plan's Task 1-4 field/resolver names against the cited lines will find the generalized forms; the divergence notes are authoritative, and the docs (`coding-sessions.md`, `coding-stack-overview.md`) record the 3A→3B evolution.
- **No migration for the interim vault shape.** Because 3A's freeform triple shipped only briefly, the tree carries no migration from the flat fields to the `servers` selection blob; any interim vault would fail-closed (malformed → refuse) rather than silently coerce. Acceptable given the brief interim window, but undocumented.
- **Full broker chain (vault → worker → real upstream) unverified on Linux/CI.** The unit/integration seam proves the config flows (vault → resolver → `projectSpec.mcp`/`mcpTokens` → `validateRepoSpec` → spec-sourced launch); the real-docker end-to-end (a vaulted credential actually driving a worker enclosure to a mock upstream) remains the Linux handoff inherited from the Phase-2 verification (ADR-0263) — 3A only changed *where the config comes from*.

## Related Decisions

- **ADR-0260: Sandbox MCP Broker — Phase 1 (Stdio Transport)** — the transport this broker rides; archived the shared design spec (`docs/archive/2026-07-05-sandbox-mcp-broker-design.md`), the document this phase implements §5.5 of.
- **ADR-0262 / ADR-0263** — the Phase-1 / Phase-2 docker-boundary verifications; ADR-0263 records the launch-gate proof whose Linux full-chain handoff this phase inherits.
- **ADR-0264: Sandbox MCP Broker — Phase 2 (Worker Enclosure)** — the credential-holding worker whose config Phase 3A makes per-identity; ADR-0264 already verified that the magi runtime sources the worker from the session spec (multi-server, env retired) on the same tree this ADR verifies, and covers Task 6 (the magi-side env retirement) in depth.
- **Shared design spec — `docs/archive/2026-07-05-sandbox-mcp-broker-design.md`** (design D; §5.5 papai vault, §3 tiered trust, §10 threats).

## Implementation Notes

Verified present against the shipped tree via `grep`/`glob`/`read`. papai paths are in this worktree; magi paths are under `~/Projects/yourpapai/magi/` (READ-ONLY).

| File | Role | Evidence |
| --- | --- | --- |
| `src/coding-credentials/types.ts:6` | `'mcp'` added to `CODING_NAMESPACES` (alongside `agent-provider`/`forge`). | `read` confirms. |
| `src/coding-credentials/types.ts:52-53` | `MCP_FIELDS = ['servers']` + `REQUIRED_MCP_FIELDS = []` — single `servers` JSON field, not 3 flat fields. | `read` confirms (divergence). |
| `src/coding-credentials/types.ts:104-113` | `FIELDS_BY_NAMESPACE.mcp` / `REQUIRED_BY_NAMESPACE.mcp` wired into the namespace maps. | `read` confirms. |
| `src/debug/settings/coding-credentials-fields-meta.ts:85-92` | `FIELDS_META.mcp` = one `servers` field (`label:'MCP servers'`, `required:false`, `sensitive:true`). | `read` confirms (relocated from the route file; divergence). |
| `src/debug/settings/coding-credentials-routes.ts:63,89` | Route resolves field metadata via `FIELDS_META[namespace]` for both GET and PATCH. | `grep` confirms. |
| `src/debug/settings/coding-credentials-routes.ts:177-205` | mcp persist path: `serializeMcpSelections(mergeMcpTokens(...))` + `too many MCP servers` 422 guard. | `grep` confirms. |
| `src/coding-credentials/resolve-agent-secrets.ts:16-17` | Pointer comment: MCP resolution (`resolveMcpServers`/`resolveMcpTokens`) relocated to `./resolve-mcp-servers.js`. | `read` confirms (divergence). |
| `src/coding-credentials/resolve-agent-secrets.ts:37-49` | `identityContext` — per-identity vault key honoring `coding_identity`; the threading the MCP resolvers reuse. | `read` confirms. |
| `src/coding-credentials/resolve-mcp-servers.ts:26-35` | `ResolvedMcpServer` (`id`/`url`/`host`/`header`/`allowedHosts`/`toolPolicy?`) + `ResolveMcpResult` (`{ok,servers}` \| `{ok:false,error}`). | `read` confirms (plural + structured result; divergence). |
| `src/coding-credentials/resolve-mcp-servers.ts:99-137` | `resolveMcpServers` — fail-closed, catalog-authoritative; `maxMcpServers` cap, duplicate-selection + unknown-catalog/missing-token/disabled-plugin refusal. | `read` confirms. |
| `src/coding-credentials/resolve-mcp-servers.ts:147-167` | `resolveMcpTokens` — per-server token map derived strictly from the validated set; internal `plugin:` servers mint a signed token. | `read` confirms. |
| `src/coding-credentials/mcp-catalog.ts:14-31` | Operator catalog schema (`name`, https `upstream_url`, `header?`, **required** `default_tool_policy`, `tool_policy?`); `resolveMcpCatalog`/`setMcpCatalog` under `__admin_mcp_catalog__:<pi>`. | `read` confirms (Phase-3B scope). |
| `src/coding-credentials/mcp-selections.ts:11-45` | `codingMcpSelectionSchema` (`{server, upstream_token?}`) + `serializeMcpSelections`/`parseMcpSelections`/`hasMalformedMcpSelections` for the `servers` blob. | `read` confirms. |
| `src/coding-credentials/mcp-plugin-servers.ts:23-96` | Internal first-party plugin MCP servers; `listEnabledInternalMcpServers` (operator-enabled + active/eligible + public base URL). | `grep` confirms (Phase-3B scope). |
| `src/coding-credentials/guardrails.ts:18,30` | `maxMcpServers` guardrail (`z.number().int().min(1).max(8).default(3)`). | `grep` confirms (Phase-3B scope). |
| `plugins/acp/tools.ts:28-42` | `RuntimeContext.codingSecrets` gains `resolveMcpServers()` + `resolveMcpTokens()` (plural). | `read` confirms (divergence). |
| `plugins/acp/tools.ts:133-159` | `McpUpstream` type + `buildSessionProjectSpec(..., mcpServers: McpUpstream[])` spreads `mcp: mcpServers` (array). | `read` confirms (divergence: array, not object). |
| `plugins/acp/session-tools.ts:92-107` | `resolveMcpServers()` → `buildSessionProjectSpec`; `resolveMcpTokens()` → POST body `mcpTokens` map; `mcp_unavailable` fail-closed return. | `read` confirms (divergence: `mcpTokens` map, not `mcpToken` string). |
| `plugins/acp/continue-tool.ts:39-44,112-129` | Follow-up endpoint carries `mcpTokens` fail-closed; never resends `mcp[]`. | `grep` confirms. |
| `tests/coding-credentials/types.test.ts:64-71` | mcp namespace asserts `FIELDS_BY_NAMESPACE.mcp === ['servers']`, `REQUIRED_BY_NAMESPACE.mcp === []`. | `grep` confirms. |
| `tests/coding-credentials/resolve-mcp-servers.test.ts:106-261` | Resolve suites: mixed internal+external ok; fail-closed on disabled internal, missing token, unknown catalog, over-cap, duplicate, malformed. | `grep` confirms. |
| `tests/coding-credentials/{mcp-catalog,mcp-plugin-servers}.test.ts` | Catalog schema/context-id + internal-server eligibility suites. | `glob` confirms. |
| `tests/coding-credentials/redaction.test.ts:146` | `resolveMcpServers` stub in the redaction harness (the map never returns secrets). | `grep` confirms. |
| `docs/architecture/coding-sessions.md:30-44` | "Sandbox MCP broker (Phases 1-3B)" section; `:40` records the Phase-3A→3B config evolution (catalog replaces 3A's interim freeform `upstream_url`/`upstream_header`). | `grep` confirms. |
| `docs/architecture/coding-stack-overview.md:224-245` | §3.5-3.6 multi-server vault doc; `:226-228` states it "supersedes the single-server `mcp` description (Phase 3A/3B)". | `grep` confirms. |
| `~/Projects/yourpapai/magi/src/project/spec-validation.ts:117-166` | `resolveMcpEntry` + `resolveMcp(o,policy): McpUpstream[]\|undefined` — array validation (https, host==url hostname, host in `allowedHosts`, bare-host check, `MAX_MCP_UPSTREAMS` cap, duplicate-id). | `read` confirms (divergence: array, not single object). |
| `~/Projects/yourpapai/magi/src/project/spec-validation.ts:200-239` | `validateRepoSpec` calls `resolveMcp` (`:226`) and returns `mcp` (`:237`). | `read` confirms. |
| `~/Projects/yourpapai/magi/src/project/config.ts:80,105,116` | `MAX_MCP_UPSTREAMS = 8`; `ProjectSpec.mcp?: McpUpstream[]`; `isBareHost`. | `grep` confirms. |
| `~/Projects/yourpapai/magi/src/project/repo-spec-validation.ts:16,130,156,174-175` | Standalone trust-boundary entry reuses `resolveMcp` + re-derives `mcp`. | `grep` confirms. |
| `~/Projects/yourpapai/magi/src/server/router.ts:121,241,273` | `/sessions`, `/sessions/:id/follow-up`, `/continue` accept `mcpTokens: asStringRecord(body['mcpTokens'])`. | `grep` confirms. |
| `~/Projects/yourpapai/magi/src/session/helpers.ts:59-74` | `mcpTokens` fail-closed matched to `projectSpec.mcp[]` ids ("has no matching entry in mcpTokens"). | `grep` confirms. |
| `~/Projects/yourpapai/magi/src/session/launch-spec.ts:10,24` | `mcpLaunchConfigs(input.projectSpec.mcp, input.mcpTokens)` — worker sourced from validated spec + per-request tokens, not `process.env`. | `grep` confirms (Task 6 is covered in depth by ADR-0264). |

Plan-vs-implementation notes:

- **The interim freeform single-server shape shipped, then was superseded by the Phase-3B multi-server/catalog rewrite.** The plan (Tasks 1-4) specified a vault of three flat fields (`upstream_url`/`upstream_header`/`upstream_token`, the last two required), singular `resolveMcp()` returning a `ResolvedMcp` object and `resolveMcpToken()` returning a string, a singular `projectSpec.mcp` object, and a singular `mcpToken` request field. The docs record this as fact: `coding-sessions.md:40` states the `mcp` namespace "now holds `{ server, upstream_token }` … replacing 3A's interim freeform `upstream_url`/`upstream_header`", and `coding-stack-overview.md:226-228` states the array shape "supersedes the single-server `mcp` description (Phase 3A/3B)". The current tree therefore carries only the Phase-3B superset: `MCP_FIELDS = ['servers']` (`types.ts:52`), `resolveMcpServers`/`resolveMcpTokens` (plural) in a dedicated `resolve-mcp-servers.ts`, `projectSpec.mcp: McpUpstream[]` + `mcpTokens: Record<string,string>`. The *intent* of every 3A task shipped; the *names/arity* did not.
- **The vault field shape changed under the data, with no in-tree migration.** 3A's flat triple is gone; the vault now stores a single `servers` JSON blob of `{ server, upstream_token? }` selections (`mcp-selections.ts:11-22`). A vault written by the interim 3A shape would today parse to zero selections (or trip `hasMalformedMcpSelections` → fail-closed refuse), not silently coerce. The tree carries no migration script; the brief interim window makes this acceptable but it is undocumented.
- **`FIELDS_META` was relocated to its own module.** The plan (Task 2) edited `coding-credentials-routes.ts`. Shipped lives in `coding-credentials-fields-meta.ts:17` and the route imports it (`coding-credentials-routes.ts:36,63,89`). Intent unchanged; the `FIELDS_META.mcp` entry is a single `servers` field, not the three fields the plan listed.
- **`projectSpec.mcp` is an array and the credential is a per-server map, not a single object + single token.** The plan (Task 4) added one `projectSpec.mcp` object and one `mcpToken` string to the POST. Shipped `buildSessionProjectSpec(..., mcpServers: McpUpstream[])` spreads `mcp: mcpServers` (array, `tools.ts:157`), `startSessionTool` sends `mcpTokens` (map, `session-tools.ts:97,106`), and the follow-up endpoint carries `mcpTokens` too without resending `mcp[]` (`continue-tool.ts:129`). magi validates the array and matches each entry to its token (`spec-validation.ts:152-166`, `session/helpers.ts:74`).
- **The Phase-3B "Handoff" items collapsed into the same files.** The plan's explicit Phase-3B handoffs — operator catalog, settings UI, per-tool gating/audit, multi-server — all shipped and are co-attributed here because they supersede the 3A shape in the same modules: `mcp-catalog.ts` (catalog), `mcp-plugin-servers.ts` + `src/mcp-server/token.ts` (internal plugin servers + signed tokens), `maxMcpServers` guardrail (`guardrails.ts:18`), and the magi mediator per-tool gate (`makeGatedHandleConnection`, covered by ADR-0264). This is why the resolver is catalog-authoritative and fail-closed rather than reading a user-supplied URL.
- **Task 6 (magi env retirement) is verified by ADR-0264 on this same tree.** The plan's Task 6 retired magi-main's `process.env` sourcing. ADR-0264 already recorded — and verified against this tree — that `geofront-runtime.launch` sources the worker from the session spec (`LaunchMcpConfig[]`, never env), that a decoy `MAGI_MCP_TUNNEL_SERVERS` is proven not to leak, and that the env contract survives only at the worker-process seam (`worker-main.ts` calling `parseWorkerConfig(process.env)` against the per-session env `buildWorkerPlan` sets). This ADR cites `launch-spec.ts:24` as the current spec-sourced entry point and does not re-verify the Phase-2 worker internals.
- **The docs note documents Phases 1-3B together.** The plan (Task 7) added a short Phase-3A note. Shipped `coding-sessions.md` carries a combined "Sandbox MCP broker (Phases 1-3B)" section whose Config paragraph (`:40`) covers the per-identity vault + catalog + the 3A→3B evolution, and `coding-stack-overview.md` §3.5-3.6 documents the multi-server vault — the later-phase material having shipped alongside it.

The source plan `docs/superpowers/plans/2026-07-08-sandbox-mcp-broker-phase-3a.md` is archived alongside this ADR to `docs/archive/`. Its design spec (`2026-07-05-sandbox-mcp-broker-design.md`) is a shared document already archived with ADR-0260.
