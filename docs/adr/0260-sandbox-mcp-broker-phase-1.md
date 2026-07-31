<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0260: Sandbox MCP Broker — Phase 1 (Stdio Transport)

## Status

Implemented (with divergence)

## Date

2026-07-06

## Context

papai + the ACP plugin + magi + geofront are security-first: the coding agent runs in a zero-trust geofront sandbox with **deny-by-default egress** and **no secrets in the agent container**. That posture is correct but blocks the natural "give the agent a custom MCP server" request — the only existing self-serve knob (`additionalEgressDomains`) punches a two-way network hole and would force MCP credentials into the sandbox, violating the no-secret invariant.

The shared design (`docs/superpowers/specs/2026-07-05-sandbox-mcp-broker-design.md`, "design D") resolves this with an **in-band MCP broker**: the agent spawns a deliberately-valueless `mcp-tunnel` as a stdio MCP server; the tunnel dials a **bind-mounted host unix socket**; `magi-main` mediates and (eventually) a credential-holding worker enclosure makes the outbound call. The agent gains **zero new network egress** and the credential never enters the sandbox.

This ADR covers **Phase 1 — the stdio transport slice of design D**, implemented by the plan `docs/superpowers/plans/2026-07-06-sandbox-mcp-broker-phase-1.md`. Phase 1 is **transport only**: prove the `agent → mcp-tunnel → bind-mounted host socket → magi-main mediator → stub responder → back` round-trip with **no** real worker, **no** credential, and **no** agent egress change. The real credential-holding worker enclosure (Phase 2), the papai catalog/vault/settings/gating (Phase 3), and the `McpServerAcp` transport (future, UNSTABLE and unadopted as of 2026-07) are explicitly out of scope.

The plan spans three repos: **magi** (Bun/TS — the tunnel, mediator, stub, ACP/opencode declaration, host-socket lifecycle), **geofront** (Rust — the `--mcp-mount` bind-mount flag), and — to complete the declaration chain — **papai** (the ACP plugin's `projectSpec.mcp` contract that feeds magi's tunnel declarations). Transport selection (spec §4.1): `McpServerStdio` ships (every current agent supports it); `http`/`sse` are rejected (agent egress → INV-2); `McpServerAcp` is opportunistic future work no agent advertises.

## Decision Drivers

- **INV-1 — no secret in the sandbox.** The tunnel holds nothing and is untrusted; the credential lives two non-addressable hops away. Phase 1 carries no credential at all (stub downstream).
- **INV-2 — deny-by-default egress, byte-identical.** The agent must reach only `mcp-tunnel` over stdio; the sole transport-related geofront change is a bind-mount (the same category as the workspace mount), **not** network egress. The session egress allowlist must be unchanged from a no-MCP session.
- **Decompose into dumb, single-purpose pieces.** No component may combine "faces an adversary" + "holds the secret" + "parses hostile output" (spec §4 table). The tunnel parses nothing; magi-main never parses the upstream response.
- **The server-id tag is routing, not authorization.** The mounted socket is reachable from inside the sandbox, so a compromised agent could bypass the tunnel and set any tag; magi-main must authorize against the session's enabled-server set, never the client-supplied tag (spec §5.1). Phase 1's stub does not enforce this — it is deferred to the Phase-2 mediation.
- **No new agent egress to reach the broker.** Use a bind-mounted host unix socket (Option X, spec §5.2), not a network peer; the tunnel dials, magi-main listens (direction inverted vs `--acp`).
- **Additive, byte-identical when unused.** Normal sessions (no MCP upstream) must not pay for a second enclosure and must launch byte-identical to pre-MCP behavior.
- **Prove the crossing on a real kernel.** The host↔container socket bind-mount only forwards `connect()` when magi and the sandbox share a kernel (spec §5.2 deployment constraint); the end-to-end crossing is verified on Linux, not on macOS Docker Desktop/OrbStack.

## Considered Options

### Option 1 — Design D: dumb in-band broker; stdio tunnel + bind-mounted host socket (chosen)

The agent spawns `mcp-tunnel` (ACP `McpServerStdio`, or opencode `mcp.local`); the tunnel dials a per-session host unix socket that geofront bind-mounts at `/run/magi/mcp.sock`; magi-main listens, reads a one-line `{ server }` handshake, and delegates the MCP stream to a downstream (stub in Phase 1).

- **Pros:** adds **no network peer** for the agent (stdio to a dumb pipe), preserving INV-2 exactly; credential stays two non-addressable hops away (INV-1); reuses magi's existing capability-brokering shape (the agent asks, magi answers — same as `fs/*` and `request_permission`); supported by every current agent; surface is split so no component combines all three dangerous properties.
- **Cons:** puts magi-main in the data path (acceptable only because it stays dumb/opaque about payloads); the bind-mount crossing is kernel-coupled (untestable on macOS Docker Desktop/OrbStack); requires staging a tunnel binary into the sandbox and a per-session host socket + geofront flag.

### Option 2 — Design B: smart MCP-gateway sidecar the agent talks to over the network

A ToolHive / Docker-MCP-Gateway sidecar the agent reaches directly over the network; off-the-shelf, keeps magi out of the MCP path, natural per-server containers, handles stdio upstreams.

- **Pros:** off-the-shelf; magi entirely out of the MCP path; natural per-server isolation; handles stdio upstreams.
- **Cons:** requires opening a hole in the agent's deny-by-default egress to reach the sidecar — handing the (hostile, assumed-compromised) agent a live service to scan/flood/fuzz; the credential-holder **is** the agent's network peer, so any gateway flaw exposes creds; concentrates adversary-facing + secret-holding + hostile-parsing in one network-reachable box. Optimizes against the secondary threat, not the primary (the agent). **Retained as the fallback** if per-server container isolation or stdio upstreams become hard requirements.

### Option 3 — Design A: extend geofront's `leliel` host-exec broker to MCP

Wire MCP through `leliel`, a built-but-unwired Rust host-exec broker (secrets host-side, over `wss://`).

- **Pros:** reuses an existing host-side-secret broker; genuine strength for deterministic local CLIs.
- **Cons:** `leliel`'s wire contract is frozen around single-exec argv semantics; an MCP server is a stateful JSON-RPC session, so this means rebuilding the worker inside leliel (different repo, different language, against a locked contract). **Rejected for MCP**; it is the future path for local-CLI brokering, not MCP.

### Option 4 — Direct `additionalEgressDomains` for the MCP endpoint (strawman)

Just allowlist the MCP endpoint's host for the agent.

- **Pros:** zero new infrastructure.
- **Cons:** loosens INV-1 (secret in sandbox), INV-2 (two-way egress + exfiltration surface), and INV-5 (no per-tool gating). This is the motivation for the whole design — explicitly rejected.

## Decision

Phase 1 shipped the full stdio transport plumbing of design D across magi + geofront, with the papai-side declaration contract in place. What shipped:

1. **`mcp-tunnel` core (magi).** `parseTunnelArgs` + `runTunnel` — a dumb pipe that dials the host socket, writes a one-line `{ server }` handshake, then splices stdin↔socket verbatim. No MCP parsing, no secrets, no policy.
2. **Tunnel executable entry.** `tunnel-main.ts` — a thin shebang wrapper that parses `process.argv` and splices `process.stdin`/`process.stdout` into `runTunnel`; staged into the sandbox at `/usr/local/bin/mcp-tunnel`.
3. **Handshake reader.** `readHandshake` — reads exactly one newline-terminated `{ server }` JSON line off the socket and returns the server id plus any bytes buffered after the newline (which belong to the MCP stream).
4. **Phase-1 stub responder.** `serveStub` — the Phase-1 stand-in downstream: a minimal ndjson MCP server answering `initialize`, `tools/list` (one canned `echo` tool), and `tools/call` (echoes arguments back). Never touches network or credentials.
5. **Mediator.** `startMediator` — listens on the host socket, reads each connection's handshake, forwards the post-handshake bytes, and delegates the connection's MCP stream to an injected `handleConnection` (DI seam so Phase 2 can swap the stub for the worker without touching the mediator).
6. **Transport E2E test.** An automated round-trip driving a `tools/call` through the real `runTunnel` → real `startMediator` → real `serveStub` (no agent binary, no container).
7. **`McpServerStdio` declaration.** `buildTunnelMcpServer` builds the `{ name, command, args, env }` stdio declaration pointing at the staged tunnel + mounted socket.
8. **`mcpServers` threaded through the ACP client.** Added `mcpServers?` to `RunAcpSessionOptions`; the session builder loops `.withMcpServer(...)` for each entry on `session/new`, and `session/load` passes `mcpServers: opts.mcpServers ?? []`.
9. **Session-side sourcing of the tunnel list.** `mcpServersFor(spec)` derives one tunnel declaration per configured upstream and threads it from the turn down into the ACP client via `RunRecordedTurnInput`.
10. **opencode native `mcp.local` config.** `generateOpencodeConfig` gained an `mcpServers` param that emits each entry under opencode's native `mcp` block as a `local` (stdio) server — distinct from ACP's `mcpServers` session param, for opencode which ignores ACP stdio MCP.
11. **Tunnel binary staged onto PATH.** A `build:mcp-tunnel` script produces `dist/mcp-tunnel`; the provisioning plan stages it at `/usr/local/bin/mcp-tunnel` (mode `755`).
12. **Host socket + `--mcp-mount`.** magi creates a per-session host socket and stands up the mediator before `workspace up`, and passes `--mcp-mount <mcpSocketPath>` to geofront so the socket is bind-mounted into the sandbox.
13. **geofront `--mcp-mount` flag (Rust).** A global `--mcp-mount <SOCKET>` flag, threaded from the CLI through the app/renderer/core plan/types down to the docker runtime, which adds `-v <host>:/run/magi/mcp.sock` to the container create — no relay, no egress change.
14. **papai declaration contract.** The ACP plugin resolves the session's MCP upstreams and threads them as `mcp` on the project spec sent to magi, which magi's `mcpServersFor` reads to build the tunnel declarations.
15. **Manual docker-boundary verification.** The real-docker end-to-end (Task 13) was a manual, Linux/same-kernel verification captured separately in `docs/superpowers/plans/2026-07-07-phase-1-verification.md`, which confirms the container↔socket crossing round-trips a `tools/call` and documents the macOS cross-kernel `ECONNREFUSED` predicted by spec §5.2.

## Consequences

### Positive

- The agent can reach a (stub) MCP server through a stdio child + a bind-mounted unix socket with **zero new network egress** — INV-2 preserved exactly; the session egress allowlist is unchanged.
- No credential enters the sandbox in Phase 1 (and the architecture keeps it two hops away for Phase 2) — INV-1 preserved.
- The broker is decomposed into dumb pieces: the tunnel is deliberately valueless, and magi-main never parses the upstream response (opaque streaming) — the parser-RCE surface is collapsed.
- Normal sessions with no MCP upstream launch byte-identical to pre-MCP behavior (the apparatus is gated on `spec.mcp`).
- The mediator's `handleConnection` DI seam is in place, so Phase 2 replaces `serveStub` with the credential-holding worker without touching the mediator or the tunnel.
- geofront's change is a single bind-mount category it already uses for the workspace — no relay, no new network path, no agent-facing service.

### Negative

- The transport is **kernel-coupled**: the host↔container socket bind-mount only forwards `connect()` when magi and the sandbox share a kernel (native Linux host). It is untestable on macOS Docker Desktop/OrbStack (`ECONNREFUSED`), so the real crossing must be verified on Linux/CI.
- Phase 1 ships an inert stub downstream; it gives the agent no real capability yet — the value arrives with the Phase-2 worker.
- Staging a tunnel binary into every sandbox adds a build prerequisite (`bun run build:mcp-tunnel` before provisioning) and a small per-session host socket + lifecycle cost.
- The session/load and opencode declaration paths are plumbed but only fully exercised later (the opencode call site still passes `[]` in Phase 1).

### Risks

- **Server-id spoofing is unmitigated in Phase 1.** The stub trusts the tunnel's tag; the spec mandates that magi-main authorize `tools/call` against the session's enabled-server set, not the tag (spec §5.1). This is a known Phase-1 gap, explicitly deferred to the Phase-2 mediation — acceptable only because the stub has no real capability to abuse.
- **Cross-kernel deployment silently breaks the crossing.** If magi ever runs off-kernel from the sandbox, Option X fails and the fallback is Option Y (the `--acp`-style exec-relay, kernel-agnostic) or a docker-bridge TCP channel — neither built.
- **Tunnel staging is conditional.** If `dist/mcp-tunnel` is not built, the binary is silently omitted (warn-only); MCP tunneling then silently unavailable in the sandbox.
- **opencode `mcp.local` inert at its Phase-1 call site.** `generateOpencodeConfig` supports the `mcp` block but the provisioning call site passes `[]`, so the opencode native declaration path is wired but not populated for tunnels yet.

## Related Decisions

- **Spec — `docs/superpowers/specs/2026-07-05-sandbox-mcp-broker-design.md`** (design D; §4.1 transport selection, §5.1 tunnel, §5.2 Option X, §5.3 mediation, §12 verification results). Archived alongside this ADR; this is the first consumer.
- **Phase-1 verification — `docs/superpowers/plans/2026-07-07-phase-1-verification.md`** (the manual docker-boundary E2E, captured separately).
- **Later phases** (Phase 2 worker enclosure, Phase 3A/3B papai catalog/vault/settings/gating, multi-server, the verification ADRs) build on this transport and reference the shared spec at its archived path.
- geofront `ADR-0004` (zero-trust network policy), `ADR-0012` (credential lifecycle), `ADR-0013` (configurable egress) — the invariants Phase 1 preserves.

## Implementation Notes

Verified present against the shipped tree via `grep`/`glob`/`read`. magi paths are under `~/Projects/yourpapai/magi/`; geofront (Rust) is a separate repo at `~/Projects/experiments/geofront/` (the task brief named it under the magi path, but the plan and the tree place it there); papai paths are in this worktree.

| File | Role | Evidence |
| --- | --- | --- |
| `~/Projects/yourpapai/magi/src/mcp-broker/tunnel.ts:1-46` | `parseTunnelArgs` + `runTunnel` (dial + `{ server }` handshake + stdin↔socket splice). | `read` confirms. |
| `~/Projects/yourpapai/magi/src/mcp-broker/tunnel-main.ts:1-10` | Executable entry; shebang + argv parse + stdio splice. | `read` confirms (shebang is `node` — see divergence). |
| `~/Projects/yourpapai/magi/src/mcp-broker/handshake.ts:1-35` | `readHandshake` — one newline-terminated JSON line → `{ serverId, rest }`. | `read` confirms. |
| `~/Projects/yourpapai/magi/src/mcp-broker/stub-responder.ts:1-77` | `serveStub` echo MCP server (`initialize`/`tools/list`/`tools/call`); hardened with `StringDecoder:40` + `toJsonRpc:20-31`. | `read` confirms. |
| `~/Projects/yourpapai/magi/src/mcp-broker/mediator.ts:1-61` | `startMediator` — listen, handshake, delegate to injected `handleConnection`; byte-loss invariant comment at `:51-57`. | `read` confirms. |
| `~/Projects/yourpapai/magi/src/mcp-broker/declare.ts:1-29` | `buildTunnelMcpServer:8` + `buildTunnelMcpServers` (CSV):22 + `TUNNEL_BIN`/`MOUNTED_SOCKET` constants:5-6. | `read` confirms. |
| `~/Projects/yourpapai/magi/src/mcp-broker/index.ts:1-11` | Barrel re-export of the Phase-1 surface (also re-exports the Phase-2/3 `gate`/`worker-client`). | `read` confirms. |
| `~/Projects/yourpapai/magi/src/acp/types.ts:21-22` | `mcpServers?: acp.McpServer[]` added to `RunAcpSessionOptions`. | `read` confirms. |
| `~/Projects/yourpapai/magi/src/acp/client.ts:74-77` | `session/new` builder loops `.withMcpServer(s)` over `opts.mcpServers ?? []`. | `read` confirms. |
| `~/Projects/yourpapai/magi/src/acp/resume.ts:67` | `session/load` passes `mcpServers: opts.mcpServers ?? []` (relocated here from `client.ts`). | `grep` confirms. |
| `~/Projects/yourpapai/magi/src/session/helpers.ts:209,237` | `mcpServers: acp.McpServer[]` on `RunRecordedTurnInput`, threaded into `runAcpSession`. | `grep` confirms. |
| `~/Projects/yourpapai/magi/src/session/lifecycle.ts:123-126` | `mcpServersFor(spec)` derives the tunnel list from `spec.mcp[].id` via `buildTunnelMcpServers`. | `read` confirms (spec-derived — see divergence). |
| `~/Projects/yourpapai/magi/src/session/turn-tracking.ts:70` | Turn calls `mcpServersFor(input.projectSpec)`. | `grep` confirms. |
| `~/Projects/yourpapai/magi/src/runtime/geofront/provisioning/opencode-config.ts:15-19,34-59` | `OpencodeMcpLocal` + `generateOpencodeConfig(..., mcpServers=[])` emits the `mcp` `local` block. | `read` confirms. |
| `~/Projects/yourpapai/magi/src/runtime/geofront/provisioning/secret-stager.ts:43` | Calls `generateOpencodeConfig(baseUrl, model, [])` — inert `[]` (see divergence). | `grep` confirms. |
| `~/Projects/yourpapai/magi/src/runtime/geofront/provisioning/plan.ts:8-12,58-61` | Conditional staging of `dist/mcp-tunnel` → `/usr/local/bin/mcp-tunnel` (mode `755`), warn-if-missing. | `grep` confirms. |
| `~/Projects/yourpapai/magi/package.json:21` | `build:mcp-tunnel` = `bun build ./src/mcp-broker/tunnel-main.ts --target=node --outfile ./dist/mcp-tunnel`. | `grep` confirms (no `--compile` — see divergence). |
| `~/Projects/yourpapai/magi/src/runtime/geofront/geofront-runtime.ts:152-161` | Apparatus gated on `spec.mcp`; passes `--mcp-mount apparatus.mcpSocketPath` to `workspace up`. | `read` confirms (apparatus is the Phase-2 worker — see divergence). |
| `~/Projects/yourpapai/magi/tests/mcp-broker/{tunnel,handshake,stub-responder,mediator,transport-e2e,declare}.test.ts` | Phase-1 test suites (transport-e2e is the round-trip proof). | `glob` confirms. |
| `plugins/acp/tools.ts:28-41` | `RuntimeContext.codingSecrets.resolveMcpServers()` / `resolveMcpTokens()`. | `read` confirms. |
| `plugins/acp/tools.ts:133-159` | `McpUpstream` type + `buildSessionProjectSpec` spreads `mcp` onto the project spec. | `read` confirms. |
| `plugins/acp/session-tools.ts:92-96` | `resolveMcpServers()` → `buildSessionProjectSpec(...)` (papai→magi `mcp` contract call site). | `grep` confirms. |
| `plugins/acp/continue-tool.ts:39-42` | Follow-up endpoint is fail-closed (does not resend `mcp`). | `grep` confirms. |
| `~/Projects/experiments/geofront/crates/cli/src/cli/root.rs:47-49,77-89` | Global `--mcp-mount <SOCKET>` flag + `parses_mcp_mount_flag` test. | `read` confirms. |
| `~/Projects/experiments/geofront/crates/cli/src/app.rs:22` | Threads `mcp_mount: cli.mcp_mount.clone()`. | `grep` confirms. |
| `~/Projects/experiments/geofront/crates/cli/src/renderer/facade.rs:29,78-79` | Config field + `mcp_mount()` accessor. | `grep` confirms. |
| `~/Projects/experiments/geofront/crates/core/src/runtime/{plan.rs:39,113-120, types.rs:361-362, workspace/agent.rs:59, workspace/command.rs:44,88}` | `mcp_mount` threaded through the core plan/types/workspace command. | `grep` confirms. |
| `~/Projects/experiments/geofront/crates/runtime-docker/src/agent.rs:32,213,234-236` | `DEFAULT_CONTAINER_MCP_SOCKET_PATH = /run/magi/mcp.sock` + `push_mount` when `mcp_mount` present. | `read` confirms. |
| `~/Projects/experiments/geofront/crates/runtime-docker/src/agent_mounts.rs:34` | Mount assembly consumes `spec.mcp_mount`. | `grep` confirms. |
| `~/Projects/experiments/geofront/crates/runtime-docker/tests/agent_container/mcp_mounts.rs:18-173` | Mount tests: present, `omits_mcp_mount_when_not_configured:150`, `rejects_non_socket_mcp_mount_before_container_creation:120`. | `grep` confirms. |
| `docs/superpowers/plans/2026-07-07-phase-1-verification.md` | Manual docker-boundary E2E: container↔socket `tools/call` round-trip; documents macOS cross-kernel `ECONNREFUSED`. | `read` confirms. |

Plan-vs-implementation notes:

- **The tunnel ships as a node-bundled script, not a compiled bun binary.** The plan (Task 2/10) specified `#!/usr/bin/env bun` and `bun build --compile --target=bun-linux-x64 --outfile`. Shipped is `#!/usr/bin/env node` (`tunnel-main.ts:1`) and `bun build ./src/mcp-broker/tunnel-main.ts --target=node --outfile ./dist/mcp-tunnel` (`package.json:21`) — no `--compile`, no arch pin. The verification notes attribute this to commit `85a8d82` ("node-bundle the tunnel + stage only when built — avoid 100MB unconditional stage"): a compiled bun runtime blob was too heavy to stage unconditionally, so the tunnel is a small (~1.2 KB) node script. Functionally equivalent (still a stdio child the agent spawns); `--target=node` requires a node runtime in the sandbox image rather than being self-contained.
- **Tunnel staging is conditional, not unconditional.** The plan (Task 10) appended the `copyFiles` entry unconditionally. Shipped `plan.ts:58-61` stages `/usr/local/bin/mcp-tunnel` only when the built binary exists, and warns (rather than fails) when it is missing — so an unbuilt tunnel silently degrades to "MCP unavailable" instead of breaking provisioning. This pairs with the node-bundle decision above.
- **The stub responder was hardened beyond the plan.** Shipped uses a `StringDecoder` (`stub-responder.ts:40`) so a multi-byte UTF-8 sequence split across chunks decodes intact instead of producing U+FFFD, and a `toJsonRpc` validator (`:20-31`) instead of the plan's raw `JSON.parse() as JsonRpc`. Intent (echo) unchanged.
- **The mediator carries a load-bearing byte-loss invariant.** `mediator.ts:51-57` documents that no `await` (or any macrotask gap) may be inserted between `readHandshake` and `conn.pipe(inbound)` — `readHandshake` removes its `data` listener on resolution, pausing the socket, and a macrotask gap before re-attaching a consumer can drop bytes. A byte-loss bug was discovered and fixed during implementation; the comment is the guardrail.
- **Session MCP-server sourcing is spec-derived, not a constant list.** The plan (Task 8) said "source it from a constant list (empty by default; the E2E test sets one)". Shipped derives the list from the project spec: `mcpServersFor(spec)` (`lifecycle.ts:123-126`) maps `spec.mcp[].id` to tunnel declarations via `buildTunnelMcpServers(csv)`, called from `turn-tracking.ts:70`. This is the Phase-3A derivation hook already present; the seam (`mcpServers` on `RunAcpSessionOptions`/`RunRecordedTurnInput`) is exactly as planned.
- **The `session/load` threading relocated to `resume.ts`.** The plan (Task 7 Step 6) edited `client.ts:163`. The load path has since been refactored into `src/acp/resume.ts:67`, which carries the same `mcpServers: opts.mcpServers ?? []`. Intent preserved; site moved.
- **The opencode `mcp.local` path is wired but inert at its Phase-1 call site.** `generateOpencodeConfig` accepts and emits the `mcp` block (`opencode-config.ts:52-58`), but `secret-stager.ts:43` — the only caller — passes `[]`. The plan (Task 9 Step 3) intended to thread the tunnel list through from the provisioning plan; that threading did not land at this call site in Phase 1, so the opencode native declaration is not populated for tunnels here (the ACP `mcpServers` path is the live one).
- **`geofront-runtime.ts` now stands up the Phase-2 worker apparatus, not the Phase-1 stub.** The plan (Task 11) wired `handleConnection: (id, inbound, outbound) => serveStub(...)`. Shipped `geofront-runtime.ts:156` calls `startMcpApparatus(...)` (`src/runtime/geofront/mcp-apparatus.ts`), whose `handleConnection` is `makeWorkerHandleConnection(...)` (`mcp-apparatus.ts:128`) — the Phase-2 credential-holding worker enclosure, not `serveStub`. The Phase-1 stub path still exists and is what the automated `transport-e2e.test.ts` and the verification doc exercise; the production `launch` path has simply advanced to Phase 2 in the same file.
- **geofront added pre-flight socket validation and permission reasoning beyond the plan.** `rejects_non_socket_mcp_mount_before_container_creation` (`tests/agent_container/mcp_mounts.rs:120`) rejects a non-socket mount before container creation, and `agent.rs:232-233` documents that the broker socket and the runtime process share the resolved non-root host uid, so the `0600` socket stays private without relaxing bind-mount permissions (the plan's open question about `0660`/`0666` was resolved by uid-sharing instead).
- **The `mcp-broker` directory now also contains Phase-2/3 modules** (`gate.ts`, `gate-line.ts`, `server-router.ts`, `worker/`, `worker-client.ts`) and the barrel re-exports them; these are out of scope for Phase 1 and are attributed to the later sandbox-phase ADRs.

The source plan `docs/superpowers/plans/2026-07-06-sandbox-mcp-broker-phase-1.md` and the **shared** design spec `docs/superpowers/specs/2026-07-05-sandbox-mcp-broker-design.md` are archived to `docs/archive/` alongside this ADR. This ADR is the **first** consumer of that shared spec and therefore archives it; the later sandbox-phase ADRs (Phase 2 / 3A / 3B) and the verification ADRs reference the spec at its archived path `docs/archive/2026-07-05-sandbox-mcp-broker-design.md`.
