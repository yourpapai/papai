<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0264: Sandbox MCP Broker — Phase 2 (Worker Enclosure)

## Status

Implemented (with divergence)

## Date

2026-07-07

## Context

ADR-0260 shipped **Phase 1** of the sandbox MCP broker — the stdio transport slice of design D — and ADR-0262 verified that transport across a real container boundary. Phase 1's downstream was an inert stub (`serveStub`): it proved the `agent → mcp-tunnel → bind-mounted host socket → magi-main mediator → stub` round-trip with **no real capability**. Phase 2 is the slice that finally reaches the real network: replace that stub with a **kernel-isolated, credential-holding `mcp-worker`** that makes the real outbound HTTPS call to the upstream MCP server, injecting the credential and streaming the response back opaque.

This ADR's source plan (`docs/superpowers/plans/2026-07-07-sandbox-mcp-broker-phase-2.md`) implements design D §5.4 (worker) on top of the Phase-1 transport. The architecture: magi spawns a **second geofront enclosure** per MCP-enabled session whose entrypoint is a dumb `mcp-worker` binary (not an ACP agent — `AgentKind::Other`). The worker holds the upstream credential (staged host-side via magi's existing `SecretSource` `request` manifest → `magi-init` exports + shreds it, never entering the agent sandbox), has kernel-enforced egress restricted to the upstream MCP host, and speaks its control protocol over **stdio via geofront's existing `--acp` relay** (magi connects to the worker's control socket exactly as it connects to the agent's ACP socket). The worker translates stdio-MCP → HTTP-MCP: each request becomes an opaque POST with the credential injected, behind a fail-closed host allowlist, no redirects, real TLS, and size/time caps. magi-main stays a **dumb byte relay** between the mediator connection and the worker's control socket — it never parses MCP traffic.

The plan spans three repos: **magi** (the worker, enclosure provisioning, mediator relay, runtime wiring), **geofront** (reuse-only — `AgentKind::Other` + `--acp` relay + `proxy_container` egress; a regression test locking the non-agent path in), and **papai** (the session/spec wiring that exposes MCP config + the vaulted token to magi). The plan scoped Phase 2 to a **single upstream MCP server per session** with **env-based config** (`MAGI_MCP_UPSTREAM_*`, `MAGI_ALLOWED_MCP_HOSTS`); multi-server multiplexing and the papai catalog/vault/settings layer were explicitly deferred to Phase 3.

The shared design (`docs/archive/2026-07-05-sandbox-mcp-broker-design.md`, "design D"; §5.4 worker, §10 threats, §12.3 launch gate) is the spec, already archived alongside ADR-0260.

## Decision Drivers

- **INV-1 — the credential lives only in the worker enclosure.** It is staged + shredded there (magi's existing secret channel), never in the agent sandbox and never in magi-main's long-lived process env. The worker is the one component permitted to hold it.
- **INV-2 — deny-by-default agent egress, byte-identical.** The agent still reaches only `mcp-tunnel` over stdio; the worker's egress is a _separate_ enclosure. A no-MCP session must launch byte-identically to pre-MCP behavior (no second enclosure, no cost).
- **Opaque — never parse hostile output.** Neither magi-main nor the worker parses upstream response bodies; the worker newline-frames and streams only. The parser-RCE surface stays collapsed (the Phase-1 decomposition invariant).
- **SSRF — fail-closed, kernel + code.** Worker egress is kernel-enforced (enclosure `proxy_container` + iptables, allowlisted to the upstream host only) **and** re-checked in-code: an empty `MAGI_ALLOWED_MCP_HOSTS` ⇒ refuse; a non-allowlisted upstream host ⇒ refuse at module load, before stdin is touched.
- **Reuse the `--acp` relay for the control channel.** No new geofront flag/mount: geofront `docker exec -i`s the worker entrypoint and byte-relays its stdio to a host socket (`serve_acp_bridge`, protocol-oblivious); magi connects to that socket and drives the worker exactly as it drives a coding agent.
- **Real TLS in the shipped artifact.** The outbound path must perform genuine certificate verification (accept trusted / reject untrusted) in the bundle that actually ships, not just in source the unit tests stub out (the load-bearing property for a credential-holding component) — the Phase-2 verification (ADR-0263) closes this gap.
- **Cost note (§12.3).** Two enclosures per MCP-enabled session (agent + worker), each with its egress proxy + iptables sidecar; startup/resource cost is a launch-blocking data point.

## Considered Options

### Option 1 — Design D §5.4: second geofront enclosure (non-agent `Other`) driven over the reused `--acp` relay (chosen)

magi builds a worker `ProvisioningPlan` (`agentEntrypoint=['mcp-worker']`, `egressDomains=[upstream host]`, the credential as a `request` secret) and runs `geofront workspace up --acp <worker-ctrl.sock>` against a dedicated dir under `tmpdir()`. The mediator's `handleConnection` (was `serveStub`) becomes a dumb relay that pipes the agent's MCP stream to the worker's control socket and the worker's replies back.

- **Pros:** reuses geofront's existing `--acp` relay and `AgentKind::Other` non-agent path (no new geofront flag/mount); the credential stays two non-addressable hops from the agent and never in magi's process; the worker's egress is a wholly separate kernel-enforced boundary (INV-1/INV-2); decomposes the dangerous properties (the tunnel is valueless, magi-main is a dumb relay, the worker parses nothing); the worker is a tiny node-bundled script, cheap to stage.
- **Cons:** two enclosures per session (cost); the worker's `--acp` relay is a single-exec ndjson bridge with no concurrent-caller framing, so multi-server/multi-connection demux needs serialization or real multiplexing later; reuses a relay named "acp" for a non-ACP workload (acceptable — the relay is protocol-oblivious byte-splicing).

### Option 2 — Run the credential-holding worker inside magi-main's own process

Instead of a second enclosure, magi-main itself makes the upstream HTTPS call (holding the credential in its process env) and the mediator's downstream is an in-process outbound function.

- **Pros:** one fewer enclosure (no per-session worker dir/socket/lifecycle); simpler control path (no `--acp` relay hop).
- **Cons:** **violates INV-1** — the credential would live in magi-main's long-lived process env, addressable by any magi-main compromise, not isolated to a kernel-enforced boundary; collapses "holds the secret" + "faces the agent's requests" into one component (the Phase-1 decomposition invariant forbids this); loses the kernel-enforced egress boundary (magi-main would need its own SSRF allowlist with no kernel backstop). Rejected.

### Option 3 — A network-reachable MCP-gateway sidecar the worker talks to

A ToolHive / Docker-MCP-Gateway-style sidecar (Design B from the shared spec) holding the credential, reached over the network.

- **Pros:** off-the-shelf; natural per-server containers; handles stdio upstreams.
- **Cons:** the credential-holder becomes a network peer (concentrating adversary-facing + secret-holding + hostile-parsing in one reachable box — the reason Design B was already rejected at Phase 1, ADR-0260); optimizes against the secondary threat, not the primary (the agent). Rejected at the spec level; retained only as a fallback if per-server container isolation becomes a hard requirement.

## Decision

The Phase-2 worker enclosure shipped in full across magi (the worker, the enclosure, the mediator relay, the runtime wiring), with geofront reuse-only regression coverage and the papai-side token/spec threading in place. What shipped:

1. **Worker config parsing (magi).** `parseWorkerConfig` (`worker/config.ts`) validates the worker's env into a `WorkerConfig`; fail-closed — refuses unless the upstream is `https` **and** its host is in a non-empty `MAGI_ALLOWED_MCP_HOSTS`; honors an optional `MAGI_MCP_UPSTREAM_HEADER` (default `Authorization`).
2. **Hardened outbound HTTP-MCP client (magi).** `makeOutbound` (`worker/outbound.ts`) POSTs one opaque JSON-RPC body to the upstream, injects the credential at the header (never the body), re-checks the host against the allowlist, follows no redirects (`redirect: 'manual'`), enforces size/time caps, streams the response opaque via `readCappedBody`, and deterministically aborts the fetch on every exit path (teardown).
3. **stdio ⇄ outbound bridge + entry (magi).** `runBridge` (`worker/bridge.ts`) reads ndjson request lines from stdin (UTF-8-safe via `StringDecoder`), calls the outbound once per line **serially** (order-preserving), writes each response as a line. `worker-main.ts` is the `#!/usr/bin/env node` entry that wires `process.stdin/stdout` + env into the bridge.
4. **`build:mcp-worker` node bundle (magi).** A `bun build ... --target=node --outfile ./dist/mcp-worker` script produces a small `#!/usr/bin/env node` bundle (~4 KB, per ADR-0263) — the same node-bundle approach the tunnel uses after its Phase-1 100 MB-binary fix.
5. **Worker enclosure provisioning + launch (magi).** `enclosure.ts` — `buildWorkerPlan` (entrypoint `mcp-worker`, `egressDomains=[cfg.host]`, the token as a `request` secret `{ request:'MCP_UPSTREAM_TOKEN', targetEnv:'MAGI_MCP_UPSTREAM_TOKEN', required:true }`, never in plan `env`), `provisionWorkerDir` (writeBuildContext + stageSecrets + renderGeofrontToml into a dedicated dir under `tmpdir()`, never the agent worktree), and `launchWorker` (`geofront workspace up --acp <ctrl.sock>` + `waitForSocket` + shutdown/teardown).
6. **magi-main worker client (magi).** `worker-client.ts` — `makeWorkerHandleConnection` connects to the worker control socket and pipes the mediator's per-connection stream ⇄ worker, a dumb byte relay (no parsing); a **fresh** worker connection per `handleConnection` call; tears down the mediator connection on worker/inbound error or close.
7. **Runtime wiring (magi).** `geofront-runtime.launch` stands up the MCP apparatus only when MCP is enabled, passes `--mcp-mount <mcpSocketPath>` to `workspace up`, and tears the apparatus down on both normal shutdown and failed-agent-launch paths. The production downstream is the worker (via `startMcpApparatus`), **not** `serveStub`.
8. **Phase-1 stub is test-only.** `serveStub` is retained solely for the pure-transport E2E (`transport-e2e.test.ts`) and the mediator unit test; no production path references it.
9. **geofront regression coverage.** Existing `AgentKind::Other` tests lock the non-agent egress-proxy/isolation posture and the no-agent-config-mount behavior the worker depends on.
10. **papai token/spec threading.** The ACP plugin resolves the session's MCP upstreams and vaulted tokens (`resolveMcpServers`/`resolveMcpTokens`) and threads them as `mcp` + `mcpTokens` on the project spec sent to magi.
11. **Docs note (papai).** `docs/architecture/coding-sessions.md` documents the Phase-2 worker enclosure (egress isolation, credential staging+shred, the reused `--acp` control channel, env config, dumb-relay magi-main).
12. **Docker-boundary verification.** The launch-gate proof (Task 11) is recorded separately in ADR-0263: the compiled `dist/mcp-worker` bundle performs genuine TLS verification (accept trusted / reject untrusted) and fail-closed config allowlisting; the full `tunnel → mediator → worker` chain on real geofront enclosures is a documented handoff to native Linux/CI (same-kernel `--mcp-mount` constraint inherited from Phase 1).

## Consequences

### Positive

- The agent can finally reach a **real** MCP server through a credential-holding worker, with **zero new agent egress** (INV-2 preserved) and the credential **never entering the agent sandbox or magi-main's process env** (INV-1 preserved) — it lives only in the kernel-isolated worker enclosure, staged + shredded.
- The broker's dangerous-property decomposition holds: the tunnel stays valueless, magi-main stays a dumb byte relay (no parsing), and the worker parses nothing beyond newline framing (opaque response streaming) — the parser-RCE surface stays collapsed.
- SSRF containment is defense-in-depth: kernel-enforced enclosure egress allowlisted to the upstream host **and** an in-code fail-closed allowlist that aborts at module load before stdin is touched.
- Normal sessions with no MCP upstream launch byte-identically to pre-MCP behavior (the apparatus is gated on a non-empty MCP upstream list; non-MCP sessions pay nothing).
- The worker leg is kernel-agnostic and cheap: a ~4 KB node script reusing the existing `--acp` relay, validated on macOS without Linux (ADR-0263), and the control channel reuses an existing geofront path with no new flag/mount.
- Real TLS certificate verification is proven in the compiled artifact that ships (ADR-0263), closing the gap the `insecureTlsForTest` unit suite leaves.

### Negative

- The production wiring **outpaced the plan**: where the plan wired a single, env-configured (`MAGI_MCP_TUNNEL_SERVERS`/`parseWorkerConfig(process.env)`) upstream, the shipped `startMcpApparatus` is multi-server (one worker per upstream, routed by the Phase-1 `serverId` tag via `makeServerRouter`) and sources config from the session (`LaunchMcpConfig[]`), with per-tool gating already layered in (`makeGatedHandleConnection`). The env-config contract survives only at the worker-process seam (`worker-main.ts` still calls `parseWorkerConfig(process.env)` against env that `buildWorkerPlan` sets) — see divergences. The Phase-3-shape arrived in the same files before the Phase-2 ADR was written.
- Two enclosures per MCP-enabled session (agent + worker) each carry an egress proxy + iptables sidecar; the cost measurement (§12.3) is part of the deferred Linux full-chain verification, not yet recorded.
- The worker's `--acp` relay is a single-exec ndjson bridge with no concurrent-caller framing; the multi-server router that shipped means the documented "single upstream" scoping is already wider than planned, so the interleaving limitation flagged in `worker-client.ts` is closer to biting than the plan assumed (mitigated today by the per-call fresh connection and the still-typical single-upstream session).
- The geofront `--acp`-relay-exec regression test the plan (Task 5) and ADR-0263 reference does **not** exist in the tree — see divergences.

### Risks

- **Full broker chain unverified until Linux/CI.** The `tunnel → mediator → worker-client → worker` composition across two real geofront enclosures (INV-1/INV-2 at the kernel layer, two-enclosure cost) is a documented handoff (ADR-0263 Part B), not a recorded pass; a regression in that composition (e.g., a byte-loss across the mediator seam, or a credential leak into the agent enclosure) would only be caught at manual Linux sign-off.
- **Multi-server wiring shipped ahead of its concurrency story.** The router dispatches by `serverId`, but the worker relay lacks multiplexing; if a session ever runs several upstreams with overlapping concurrent tunnel connections, request/response lines can interleave on a shared worker stream with no correlation. The single-upstream-today reality keeps this latent.
- **Node-proxy egress is an env-flag dependency.** The worker honors the enclosure's `HTTPS_PROXY` only because `buildWorkerPlan` sets `NODE_USE_ENV_PROXY=1` (Node's fetch does not auto-honor proxy env); a future base-image pin below Node 22.21 would silently break strict-egress reachability. The floor is documented in `enclosure.ts`.
- **Missing geofront relay regression.** With no test asserting `--acp` exec's a non-agent entrypoint byte-for-byte, a geofront refactor could break the worker's control channel without a failing test (the `Other`-kind tests cover egress/isolation/config-mounts, not the relay exec args).

## Related Decisions

- **ADR-0260: Sandbox MCP Broker — Phase 1 (Stdio Transport)** — the transport this builds on; its Phase-1 stub downstream is what Phase 2 replaces with the credential-holding worker. ADR-0260 already flagged that `geofront-runtime.ts` stands up the worker apparatus (not the stub) and that the `mcp-broker` directory contains Phase-2/3 modules.
- **ADR-0262: Sandbox MCP Broker — Phase 1 Verification** — root-caused the same-kernel `--mcp-mount` constraint Phase 2 inherits.
- **ADR-0263: Sandbox MCP Broker — Phase 2 Verification** — the launch-gate proof (Task 11): compiled-bundle real-TLS + fail-closed config PASS on macOS; full-chain Linux E2E is the documented handoff.
- **Shared design spec — `docs/archive/2026-07-05-sandbox-mcp-broker-design.md`** (design D; §5.4 worker, §10 threats, §12.3 launch gate), archived alongside ADR-0260.
- **Later phases** (Phase 3A/3B papai catalog/vault/settings/gating — already layered onto the shipped wiring; multi-server; the Linux full-chain verification ADRs) build on this worker enclosure and reference the shared spec at its archived path.

## Implementation Notes

Verified present against the shipped tree via `grep`/`glob`/`read`. magi paths are under `~/Projects/yourpapai/magi/`; geofront (Rust) is a separate repo at `~/Projects/experiments/geofront/`; papai paths are in this worktree.

| File | Role | Evidence |
| --- | --- | --- |
| `~/Projects/yourpapai/magi/src/mcp-broker/worker/config.ts:1-39` | `WorkerConfig` (`:1-7`) + `parseWorkerConfig` (`:11`) — fail-closed: requires `https` + non-empty allowlist + host match; honors custom header. | `read` confirms. |
| `~/Projects/yourpapai/magi/src/mcp-broker/worker/outbound.ts:58-92` | `makeOutbound` — opaque POST, cred at header (`:73`), allowlist recheck (`:62-65`), `redirect:'manual'` (`:75`), test-only `tls` bypass (`:77`), size/time caps (`:59-60`), deterministic `controller.abort()` teardown in `finally` (`:89`). | `read` confirms. |
| `~/Projects/yourpapai/magi/src/mcp-broker/worker/outbound.ts:15-31` | `readCappedBody` — opaque streaming reassembly via `TextDecoder`, size-cap throw. | `read` confirms. |
| `~/Projects/yourpapai/magi/src/mcp-broker/worker/bridge.ts:8-44` | `runBridge` — ndjson stdin → outbound-per-line → stdout; `StringDecoder` (`:14`); **serial** order-preserving chain (`:16-24`). | `read` confirms. |
| `~/Projects/yourpapai/magi/src/mcp-broker/worker/worker-main.ts:1-13` | `#!/usr/bin/env node` entry; `parseWorkerConfig(process.env)` (`:6`) → `makeOutbound(cfg,{})` (`:7`) → `runBridge`. | `read` confirms. |
| `~/Projects/yourpapai/magi/src/mcp-broker/worker/enclosure.ts:84-119` | `buildWorkerPlan` — entrypoint `mcp-worker` (`:116`), `egressDomains:[cfg.host]` (`:117`), token as `request` secret (`:114`, never in `env`), `NODE_USE_ENV_PROXY=1` (`:112`), `node:22-bookworm-slim` base (`:31`). | `read` confirms. |
| `~/Projects/yourpapai/magi/src/mcp-broker/worker/enclosure.ts:52,66-77` | `resolveWorkerBinary` (dist/mcp-worker) + `serverIdPathSegment` (collision-free hash) + `defaultWorkerDir` (under `tmpdir()`, keyed by sessionId+serverId). | `read` confirms. |
| `~/Projects/yourpapai/magi/src/mcp-broker/worker/enclosure.ts:126-140,199-214` | `provisionWorkerDir` (writeBuildContext + stageSecrets + renderGeofrontToml, cleanup-on-error) + `launchWorker` (`workspace up --acp <ctrl.sock>` + waitForSocket + shutdown). | `read` confirms. |
| `~/Projects/yourpapai/magi/src/mcp-broker/worker/index.ts:1-13` | Barrel re-export of the worker surface (`parseWorkerConfig`, `makeOutbound`, `runBridge`, `buildWorkerPlan`, `provisionWorkerDir`, `launchWorker`, `resolveWorkerBinary`). | `read` confirms. |
| `~/Projects/yourpapai/magi/src/mcp-broker/worker-client.ts:24-63` | `makeWorkerHandleConnection` — dumb byte relay; fresh `connect({path})` per call (`:26`); `inbound.pipe`/`workerConn.pipe` (`:50-51`); teardown on error/close (`:29-36`). | `read` confirms. |
| `~/Projects/yourpapai/magi/src/mcp-broker/server-router.ts:10-29` | `makeServerRouter` — per-`serverId` dispatch (Phase-3 multi-server); unknown id fails closed with a JSON-RPC error. | `read` confirms. |
| `~/Projects/yourpapai/magi/src/mcp-broker/gate.ts:43` | `makeGatedHandleConnection` — per-tool policy gate (Phase-3B-magi; wraps the worker handler). | `grep` confirms. |
| `~/Projects/yourpapai/magi/src/runtime/geofront/mcp-apparatus.ts:100-145` | `startMcpApparatus` — one worker per upstream via `Promise.allSettled` (`:114`); routes built per entry (`:124-135`); mediator downstream = `makeServerRouter` (`:137`); `mcpSocketPath` placed outside `spec.cwd` (`:108-112`). | `read` confirms. |
| `~/Projects/yourpapai/magi/src/runtime/geofront/mcp-apparatus.ts:167-173` | `teardownMcpApparatus` — best-effort mediator close + per-worker shutdown. | `read` confirms. |
| `~/Projects/yourpapai/magi/src/runtime/geofront/geofront-runtime.ts:143-184` | `launch` — apparatus gated on `spec.mcp` non-empty (`:152-156`); `--mcp-mount apparatus.mcpSocketPath` (`:160`); teardown on failed socket (`:179`) and in `buildShutdown` (`:76`). | `read` confirms. |
| `~/Projects/yourpapai/magi/src/launcher/launcher.ts:8-34` | `LaunchMcpConfig` (structurally `WorkerConfig` + `id`/`token`/`toolPolicy`) + `LaunchSpec.mcp?` + `onMcpToolAsk?` — session-sourced, not env. | `read` confirms. |
| `~/Projects/yourpapai/magi/package.json:22` | `build:mcp-worker` = `bun build ./src/mcp-broker/worker/worker-main.ts --target=node --outfile ./dist/mcp-worker`. | `grep` confirms. |
| `~/Projects/yourpapai/magi/tests/mcp-broker/worker/{config,outbound,bridge,enclosure}.test.ts` | Worker unit suites: fail-closed config, cred injection/opacity/teardown/timeout/redirect-inertness/proxy, ndjson bridge, plan builder (egress/secret/env/`NODE_USE_ENV_PROXY`/binary staging). | `glob` + `grep` confirm. |
| `~/Projects/yourpapai/magi/tests/mcp-broker/worker/outbound.node-proxy.test.ts` | Extra outbound proxy-awareness suite (beyond the plan). | `glob` confirms. |
| `~/Projects/yourpapai/magi/tests/mcp-broker/worker-client.test.ts:46-72` | Real-socket round-trip + teardown-on-worker-error. | `grep` confirms. |
| `~/Projects/yourpapai/magi/tests/mcp-broker/{server-router,gate}.test.ts` | Multi-server router + per-tool gate suites (Phase-3 coverage co-located). | `glob` confirms. |
| `~/Projects/yourpapai/magi/tests/runtime/geofront/mcp-apparatus.test.ts` | Apparatus wiring: per-entry launch, `onMcpToolAsk`, rollback, best-effort teardown. | `grep` confirms. |
| `~/Projects/yourpapai/magi/tests/runtime/geofront/geofront-runtime.test.ts:324,360` | `launch` runs no apparatus when `spec.mcp` absent (decoy env ignored) (`:324`); launches worker + `--mcp-mount` + relays to worker-not-stub, sourced from spec not env (`:360`). | `grep` confirms. |
| `~/Projects/experiments/geofront/crates/runtime-docker/tests/agent_container.rs:506,539` | `other_agent_does_not_mount_agent_config` + `other_agent_container_still_gets_egress_proxy_env_and_isolation` — non-agent egress/isolation/config-mount posture. | `grep` confirms. |
| `~/Projects/experiments/geofront/crates/runtime-docker/tests/runtime_invocation.rs:263` | `other_agent_runs_configured_entrypoint_without_codex_defaults` — non-agent entrypoint runs without agent defaults. | `grep` confirms. |
| `plugins/acp/session-tools.ts:92,97,106` | `resolveMcpServers()`/`resolveMcpTokens()` threaded as `mcp` + `mcpTokens` on the session project spec. | `grep` confirms. |
| `plugins/acp/continue-tool.ts:44,129` | Follow-up endpoint carries `mcpTokens` (fail-closed; does not resend `mcp[]`). | `grep` confirms. |
| `plugins/acp/tools.ts:28,41,133-159` | `RuntimeContext.codingSecrets` MCP resolvers + `McpUpstream`/`buildSessionProjectSpec` `mcp` spread. | `read` confirms (ADR-0260). |
| `docs/architecture/coding-sessions.md:36` | Phase-2 worker enclosure doc note (second enclosure, egress isolation, staged+shredded credential, reused `--acp` relay, opaque POST, dumb-relay magi-main). | `grep` confirms. |
| `~/Projects/yourpapai/magi/src/mcp-broker/stub-responder.ts` + `tests/mcp-broker/{transport-e2e,mediator,stub-responder}.test.ts` | `serveStub` retained test-only; no production reference (production uses the worker via `startMcpApparatus`). | `grep` confirms. |

Plan-vs-implementation notes:

- **The production wiring is multi-server + session-sourced + gated, not the plan's single-upstream env-configured shape.** The plan's Task 8 specified `parseWorkerConfig(process.env)` building one `WorkerConfig` from `MAGI_MCP_TUNNEL_SERVERS` and a single `makeWorkerHandleConnection` downstream. Shipped `geofront-runtime.launch` calls `startMcpApparatus(spec.sessionId, …, spec.mcp, …)` where `spec.mcp: LaunchMcpConfig[]` is sourced from the session (`launcher.ts:8-34`), never from magi-main's process env. `startMcpApparatus` launches **one worker per upstream** (`mcp-apparatus.ts:114`), routes by `serverId` via `makeServerRouter` (`:137`), and wraps each handler in `makeGatedHandleConnection` when a `toolPolicy` is present (`:131-134`). This is the plan's "Handoff to Phase 3" items (multi-server demux, per-tool gating, catalog/vault sourcing) landing in the same files before the Phase-2 ADR was written. The env-config contract survives **at the worker-process seam only**: `worker-main.ts:6` still calls `parseWorkerConfig(process.env)` against env that `buildWorkerPlan` sets (`enclosure.ts:96-99`), and a decoy `MAGI_MCP_TUNNEL_SERVERS` is explicitly proven not to leak (`geofront-runtime.test.ts:324,360`). ADR-0260 already flagged the apparatus shape ("`geofront-runtime.ts` now stands up the Phase-2 worker apparatus, not the Phase-1 stub").
- **Outbound uses Bun/native `fetch`, not `undici`.** The plan (Task 2) specified `undici`'s `Agent`/`ProxyAgent`. Shipped uses `fetch` directly (`outbound.ts:71`): under Bun, the `undici` npm module is shadowed by a compat shim whose `Agent`/`ProxyAgent` are no-op stubs, so it cannot control TLS/proxying; Bun's native `fetch` honors `HTTPS_PROXY` automatically and exposes the test-only `tls` override. Because the worker runs under **Node** in production (`worker-main.ts` shebang), proxy-awareness is instead turned on globally via `NODE_USE_ENV_PROXY=1` in `buildWorkerPlan`'s `env` (`enclosure.ts:112`) — Node's fetch does not auto-honor proxy env. ADR-0263 confirmed the effective behavior (verify by default, trust only what `NODE_EXTRA_CA_CERTS` names) matches intent; the `tls` key is only ever paired with `insecureTlsForTest:true` (test-only, never set by `worker-main.ts`).
- **The outbound client adds a deterministic teardown and `TextDecoder` streaming.** Beyond the plan's `for await` reassembly, shipped `readCappedBody` (`outbound.ts:15-31`) decodes `Uint8Array` chunks via `TextDecoder` (UTF-8-safe streaming), and the `finally` block calls `controller.abort()` (`:89`) on every exit path — Bun does not cancel the underlying reader when the loop exits via `throw`, so without this a misbehaving allowlisted upstream could keep the socket ESTABLISHED indefinitely (a DoS vector for a credential-holding worker).
- **The enclosure is multi-dir with a collision-free id segment, not a single worker dir.** The plan's single-upstream scope implied one worker dir. Shipped `defaultWorkerDir` (`enclosure.ts:75`) keys the dir by `sessionId` **and** `serverId`, and `serverIdPathSegment` (`:66`) appends a 12-char sha256 hash of the raw id to a 24-char sanitized prefix — making the path collision-free (distinct ids that sanitize identically must not share a dir/socket and race the staged token) while staying under the AF_UNIX ~108-char limit. This anticipates the multi-server router; it is harmless for single-upstream.
- **The worker base image is `node:22-bookworm-slim`, not the agent's default.** Required for `NODE_USE_ENV_PROXY` (Node ≥22.21/≥24.0); the floating tag is documented to keep the floor (`enclosure.ts:24-31`).
- **`serveStub` was kept (test-only), not deleted.** The plan's Task 9 offered keep-vs-delete; shipped keeps it for the pure-transport E2E (`transport-e2e.test.ts`) and the mediator unit test, as the plan recommended, and the production path uses the worker — confirmed by grep (no production `serveStub` reference).
- **The geofront `--acp`-relay-exec regression test (Task 5) is absent.** The plan (Task 5) and ADR-0263 both reference `run_acp_session_execs_exact_non_agent_entrypoint_over_relay` as locking the non-agent `--acp` relay path; a `grep` across `~/Projects/experiments/geofront/crates/` finds **no** such test. The non-agent coverage that **does** exist is `other_agent_does_not_mount_agent_config` (`agent_container.rs:506`), `other_agent_container_still_gets_egress_proxy_env_and_isolation` (`:539`), and `other_agent_runs_configured_entrypoint_without_codex_defaults` (`runtime_invocation.rs:263`) — these cover egress/isolation/config-mounts/entrypoint-defaults, but none asserts the `--acp` relay exec's the non-agent entrypoint byte-for-byte. The worker's control channel therefore lacks the specific regression the plan called for; flagged as a risk.
- **The papai docs note documents Phases 1-3B together, not Phase 2 in isolation.** The plan's Task 10 added a short Phase-2 note; shipped `coding-sessions.md` carries a combined "Sandbox MCP broker (Phases 1-3B)" section whose Phase-2 paragraph (`:36`) covers exactly the worker-enclosure facts the plan asked for, but co-located with the later-phase material that had already shipped alongside it.

The source plan `docs/superpowers/plans/2026-07-07-sandbox-mcp-broker-phase-2.md` is archived alongside this ADR to `docs/archive/`. Its design spec (`2026-07-05-sandbox-mcp-broker-design.md`) is a shared document already archived with ADR-0260.
