<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0263: Sandbox MCP Broker — Phase 2 Verification

## Status

Implemented

## Date

2026-07-07

## Context

ADR-0260 shipped **Phase 1** of the sandbox MCP broker — the stdio transport slice of design D — and ADR-0262 verified that transport across a real container boundary. Phase 2 adds the **second enclosure on top of that transport**: the credential-holding `mcp-worker` that replaces the inert Phase-1 stub as the mediator's downstream. The worker is the component that finally reaches the real network — so its own enclosure is where the invariants get sharpest: a real upstream URL, a real credential, and real TLS, all while the agent sandbox gains **zero new egress** and the credential never enters it.

This ADR's source plan (`docs/superpowers/plans/2026-07-07-phase-2-verification.md`) is a **verification report, not a feature**: it drives the _compiled_ `dist/mcp-worker` bundle — not a re-implementation, not a unit test fixture — as a standalone Node process with production-shaped env (no `insecureTlsForTest` escape hatch) to close the one gap the automated suite cannot cover. That gap is real TLS certificate verification: `tests/mcp-broker/worker/outbound.test.ts` always passes `insecureTlsForTest: true` to talk to its self-signed loopback mock, so the unit suite never exercises the production trust path. The verification establishes trust the way a production deployment would — via `NODE_EXTRA_CA_CERTS` naming a self-signed cert as a CA — and then proves both that a trusted cert is accepted and that an untrusted one is rejected, in the compiled artifact.

The shared design (`docs/archive/2026-07-05-sandbox-mcp-broker-design.md`, "design D"; §5.4 worker, §10 threats, §12.3 launch gate) is the spec; the Phase-2 implementation plan is `docs/superpowers/plans/2026-07-07-sandbox-mcp-broker-phase-2.md` (this verification is its Task 11, the docker-boundary verification). No LLM credentials and no real coding agent were involved. The environment was macOS with node v24.15.0 on the host (Docker/OrbStack available but **not** used for the Part-A checks, which run the compiled bundle directly under host `node`); the repo under test was `~/Projects/yourpapai/magi` branch `main`, HEAD `d88419c`.

## Decision Drivers

- **Real TLS CA validation in the compiled artifact.** The production outbound path (`makeOutbound(cfg, {})`, no `insecureTlsForTest`) must perform genuine certificate verification — accepting a CA-trusted cert and refusing an untrusted one — in the bundle that actually ships, not just in source the unit tests stub out.
- **Fail-closed when the upstream host is not allowlisted.** A non-allowlisted upstream must refuse to start at all (config validated synchronously at module load, before stdin is read), not merely fail individual calls. SSRF containment must be load-bearing, not advisory.
- **The worker is sourced from the spec, not from env.** Per the design and ADR-0260's worker-client wiring, the worker is launched as a non-agent `Other` enclosure driven over the same `--acp` relay as a coding agent; the agent's own egress and config mounts are unchanged (INV-2 byte-identical).
- **Zero new egress.** The verification must not introduce any network path the production worker wouldn't use; the agent sandbox gains nothing.
- **Reproducibility / same shipped code.** The bundle under test is the real `bun run build:mcp-worker` output; a pass is evidence about the shipped artifact, not a fixture. Honest failure reporting: anything that cannot be exercised in this environment is root-caused and handed off, not hand-waved.

## Considered Options

### Option 1 — Compiled worker-bundle direct check under host node, real TLS via `NODE_EXTRA_CA_CERTS` (chosen)

Build `dist/mcp-worker`, point it at a self-signed `https://localhost` mock upstream whose cert is trusted only because `NODE_EXTRA_CA_CERTS` names it, run one positive check (trusted CA + correct credential → opaque echoed response) and two negative checks (upstream host not in `MAGI_ALLOWED_MCP_HOSTS` → process refuses to start; untrusted cert with no `NODE_EXTRA_CA_CERTS` → outbound fails closed).

- **Pros:** exercises the actual compiled artifact end to end (config parse → ndjson stdin bridge → hardened outbound with real TLS → credential injection → opaque response), closing the precise gap the `insecureTlsForTest` unit suite leaves; the mock's 401-on-mismatch behavior independently confirms the credential header was injected; runs on the macOS host with no container, so it is not gated on the Phase-1 cross-kernel socket limitation.
- **Cons:** does not cross the container boundary or exercise real geofront enclosures — it validates the worker's own logic, not the `tunnel → mediator → worker` chain; the self-signed cert is its own trust anchor (acceptable because the goal is to prove verification _happens_, not to model a specific public CA).

### Option 2 — Rely solely on the existing `insecureTlsForTest: true` unit suite

Treat `tests/mcp-broker/worker/outbound.test.ts` (and `config.test.ts`, `enclosure.test.ts`) as sufficient evidence and skip the compiled-artifact check.

- **Pros:** zero new manual work; the unit suite already covers config fail-closed, connection teardown, timeout, redirect-inertness, opacity, and credential isolation.
- **Cons:** the unit suite deliberately disables TLS verification (`insecureTlsForTest: true`) to talk to its loopback self-signed mock, so it can never prove the production path verifies certificates at all — exactly the property a credential-holding outbound component must have. The "no bug found" claim would be about source, not the shipped artifact.

### Option 3 — Full-chain E2E on native Linux/CI now

Spin up the real `agent → mcp-tunnel → --mcp-mount socket → mediator → worker-client → worker enclosure → hardened outbound → mock upstream` chain in real geofront enclosures, verifying INV-1 (credential isolation across both enclosures), INV-2 (agent egress byte-identical), SSRF containment at the kernel layer, and the two-enclosure cost.

- **Pros:** the only topology that proves the whole broker end to end in real kernel-enforced enclosures; the production target.
- **Cons:** blocked on this machine — the `--mcp-mount` bind-mount crossing is same-kernel-only (the Phase-1 finding, ADR-0262 / spec §5.2), and real geofront enclosures (`proxy_container` + iptables + dnsmasq) don't spin up cleanly in this macOS dev environment. Attempting it here would reproduce the Phase-1 `ECONNREFUSED` rather than produce a pass. It is recorded as a handoff (the plan's Part B), to be executed on native Linux/CI.

## Verification Outcome

**Overall: DONE — Part A PASS; full-chain E2E (Part B) deferred to Linux/CI as a documented handoff.** Option 1 was chosen and executed; Option 2 was explicitly rejected as leaving the load-bearing TLS property unverified; Option 3 is the documented handoff. The worker's own leg is verified kernel-agnostic on this machine; the full `tunnel → mediator → worker` chain still needs a native Linux host. Headline findings:

1. **Part A — compiled-bundle positive check: PASS.** A `tools/call` frame piped into the standalone worker process (env: `MAGI_MCP_UPSTREAM_URL=https://localhost:8443/`, `MAGI_MCP_UPSTREAM_TOKEN='Bearer testtoken'`, `MAGI_ALLOWED_MCP_HOSTS=localhost`, `NODE_EXTRA_CA_CERTS=<self-signed cert>`) returned the mock upstream's opaque echoed `result.content` (exit 0). The mock returns HTTP 401 on any `Authorization` mismatch, so getting back a 200 echoed body — not the `{"error":"unauthorized"}` shape — independently confirms the credential header was injected correctly. This is the full config-parse → ndjson stdin bridge → hardened outbound POST with **real** TLS handshake → opaque-response-written-to-stdout path, unparsed end to end.
2. **Part A — fail-closed config (negative a): PASS.** With `MAGI_ALLOWED_MCP_HOSTS=other-host.example` (upstream host `localhost` not allowlisted), the process threw `mcp-worker: upstream host localhost not in MAGI_ALLOWED_MCP_HOSTS` at `parseWorkerConfig` (`dist/mcp-worker:62`) and exited 1 **before any stdin was read** — `parseWorkerConfig` runs synchronously at module load, so a non-allowlisted upstream refuses to start rather than failing individual calls.
3. **Part A — real TLS rejection (negative b): PASS.** The positive command run **without** `NODE_EXTRA_CA_CERTS` produced empty stdout and `mcp-worker: fetch failed` (exit 1). Reproduced directly against Node's `fetch`, the underlying error is `DEPTH_ZERO_SELF_SIGNED_CERT` — Node's standard TLS chain-verification failure for an untrusted self-signed leaf — confirming the production path really does refuse an untrusted cert rather than silently downgrading.
4. **Bundle shape confirmed.** `bun run build:mcp-worker` produces a **4.0 KB** single-entry `#!/usr/bin/env node` bundle (4 modules: `bridge.ts`, `config.ts`, `outbound.ts`, `worker-main.ts`) — a node script, consistent with the Phase-1 node-bundle decision (commit `85a8d82`, already noted in ADR-0260).
5. **Runtime-shim no-op investigated, not assumed.** `outbound.ts` passes Bun's native `fetch(url, { tls: {...} })` option because Bun's `undici` shim no-ops the `Agent`/`ProxyAgent` controls; under Node that `tls` key is simply an unrecognized, ignored fetch-init property. This does not weaken production: the `tls` override is only ever passed with `insecureTlsForTest: true` (test-only, never set by `worker-main.ts`), and Node's default fetch already verifies certs and honors `NODE_EXTRA_CA_CERTS` regardless. The positive + negative checks confirm the _effective_ behavior (verify by default, trust only what `NODE_EXTRA_CA_CERTS` names) matches the code's intent — checked directly rather than assumed.
6. **Part B — full-chain E2E: documented handoff, not executed on macOS.** The 10-step Linux/CI procedure (build both binaries, point at the `--mcp-mount` geofront branch, drive a real coding session, then verify INV-1 by `docker exec` env-grep in both enclosures + shredded `.magi-private`, INV-2 by byte-diff of the agent egress allowlist, SSRF by a non-allowlisted/metadata-address redirect, plus the two-enclosure cost measurement per spec §12.3) is recorded in the plan. It was not run here because the `--mcp-mount` crossing and real geofront enclosures are same-kernel-only (Phase-1 finding).

## Consequences

### Positive

- The Phase-2 worker enclosure — the component that finally holds the credential and reaches the real network — is verified to perform genuine TLS certificate verification (accept trusted / reject untrusted) and fail-closed config allowlisting in the **compiled artifact that ships**, closing the gap the `insecureTlsForTest` unit suite leaves.
- The worker leg is **kernel-agnostic**: `docker exec`-style `--acp` relay crosses via exec, not a bind-mounted socket, so the worker's own logic does not depend on the Phase-1 same-kernel constraint and could be validated on macOS without Linux.
- Fail-closed is load-bearing: a non-allowlisted upstream aborts at module load before stdin is touched, so SSRF containment cannot be bypassed by a late or malformed request.
- Credential isolation and the full outbound security surface (teardown, timeout, redirect-inertness, opacity, agent egress byte-identical, no-agent-config-mounts for the `Other` kind) are independently covered by the existing magi + geofront automated suites (all green as of HEAD `d88419c`), corroborating the manual check.
- The handoff is honest and reusable: the Linux full-chain procedure is written down step-by-step with explicit per-invariant acceptance criteria, rather than left as "verify later."

### Negative

- The full `tunnel → mediator → worker` chain — the thing that actually proves the two enclosures compose — is **not** exercised on this machine; it is a documented handoff to native Linux/CI, not a pass recorded here.
- Real geofront enclosures (`proxy_container` + iptables + dnsmasq) are not spun up in this dev environment, so the kernel-enforced egress layer of SSRF containment is verified only at the in-code/worker layer, not at the network layer.
- The macOS dev environment cannot run the same-kernel `--mcp-mount` crossing (the Phase-1 finding carries forward), so local end-to-end Phase-2 testing requires Linux.

### Risks

- **The full broker chain is unverified until Linux/CI runs Part B.** A regression in the `tunnel → mediator → worker-client → worker` composition (e.g., a byte-loss across the mediator seam, or a credential leak into the agent enclosure) would only be caught at manual Linux sign-off, not in routine CI on this machine.
- **Deferred full-chain is a security-significant gap.** Until INV-1 (credential absent from the agent enclosure), INV-2 (agent egress byte-identical), and kernel-layer SSRF are checked on Linux with real geofront enclosures, the worker's own correctness (verified here) is necessary but not sufficient evidence for the whole broker's invariants.
- **No real upstream protocol exercise.** The mock is a trivial opaque echoer; a real MCP server with streaming, batching, or non-trivial framing is not exercised. (Opacity by construction mitigates this — the worker never parses the body — but it remains a coverage boundary.)

## Related Decisions

- **ADR-0260: Sandbox MCP Broker — Phase 1 (Stdio Transport)** — the feature whose transport this builds on; its Phase-1 stub downstream is what Phase 2 replaces with the credential-holding worker verified here.
- **ADR-0262: Sandbox MCP Broker — Phase 1 Verification** — the sibling verification that root-caused the same-kernel `--mcp-mount` constraint this report inherits (and works around by validating the worker leg directly).
- **Shared design spec — `docs/archive/2026-07-05-sandbox-mcp-broker-design.md`** (design D; §5.4 worker, §10 threats, §12.3 launch gate). Archived alongside ADR-0260; this verification is the §12 evidence for the Phase-2 worker enclosure.
- **ADR-0264: Sandbox MCP Broker — Phase 2 (Worker Enclosure)** (forward reference) — the Phase-2 implementation ADR, whose Task 11 (docker-boundary verification) is the work recorded here.
- **ADR-0273: Sandbox MCP Broker — Phase 3a Verification** (forward reference) — the Phase-3a verification, which adds the papai catalog/vault/settings/gating layer and must re-confirm the invariants once the broker is driven end to end through the full papai → magi → geofront stack on Linux.

## Implementation Notes

Evidence is the verification report itself (`docs/superpowers/plans/2026-07-07-phase-2-verification.md`, archived alongside this ADR); section/line citations refer to that report. The magi test files the report cites were sanity-checked present READ-ONLY under `~/Projects/yourpapai/magi/` (`tests/mcp-broker/worker/{config,outbound,enclosure}.test.ts`, `tests/mcp-broker/worker-client.test.ts`, `tests/runtime/geofront/geofront-runtime.test.ts` — all present), and the geofront tests under `~/Projects/experiments/geofront/` (`crates/runtime-docker/tests/agent_container.rs`) are present. No papai source was modified for this verification; the papai-side declaration contract (`buildSessionProjectSpec` spreads `mcp` onto the project spec only when populated) was already verified in ADR-0260/0262 and is unchanged.

| Item | Result | Evidence |
| --- | --- | --- |
| Repo/environment under test | magi `main` @ `d88419c`; macOS, node v24.15.0 host; no LLM creds; Docker available but unused for Part A (bundle run directly under host node). | report header, plan `:11-12`. |
| Spec + parent plan | spec `docs/archive/2026-07-05-sandbox-mcp-broker-design.md` (§5.4, §10, §12.3); parent plan `docs/superpowers/plans/2026-07-07-sandbox-mcp-broker-phase-2.md` (Task 11). | plan `:14-15`. |
| Worker bundle build | `bun run build:mcp-worker` → `dist/mcp-worker`, **4.0 KB**, `#!/usr/bin/env node`, 4 bundled modules (`bridge`, `config`, `outbound`, `worker-main`). | Part A setup, plan `:24-29`. |
| Self-signed trust-anchor cert (scratch dir outside both repos) | `openssl req -x509 … -subj /CN=localhost … subjectAltName=DNS:localhost,IP:127.0.0.1` in `/tmp/mcp-p2-verify`. | Part A setup, plan `:31-37`. |
| Mock upstream MCP server | `node:https` on `127.0.0.1:8443`, requires `Authorization: Bearer testtoken` (401 on mismatch), echoes request opaquely as a `tools/call` result. | Part A setup, plan `:39-43`. |
| Positive check — trusted CA + credential + real handshake | **PASS** — opaque echoed `result.content` returned (exit 0); credential confirmed via mock's 401-on-mismatch behavior. | Positive check, plan `:45-73`. |
| Negative (a) — host not in `MAGI_ALLOWED_MCP_HOSTS` | **PASS** — `Error: mcp-worker: upstream host localhost not in MAGI_ALLOWED_MCP_HOSTS` at `parseWorkerConfig` (`dist/mcp-worker:62`), exit 1 before stdin read (fail-closed at module load). | Negative check (a), plan `:75-93`. |
| Negative (b) — untrusted self-signed cert, no `NODE_EXTRA_CA_CERTS` | **PASS** — empty stdout, `mcp-worker: fetch failed`, exit 1; root cause confirmed `DEPTH_ZERO_SELF_SIGNED_CERT` via direct Node `fetch`. | Negative check (b), plan `:95-120`. |
| Runtime-shim no-op (Bun `tls` fetch option under Node) | Investigated, confirmed harmless: option only ever paired with `insecureTlsForTest: true` (test-only); Node ignores the unrecognized key and verifies by default; effective behavior matches intent. | Runtime-shim note, plan `:122-124`. |
| Part A summary table | 4/4 PASS (bundle shape; positive; negative a; negative b); no bug found. | Part A summary, plan `:136-145`. |
| Cleanup (no artifacts left) | Mock upstream killed; `rm -rf magi/dist` (gitignored) and `/tmp/mcp-p2-verify`; `git status` clean in magi. | Cleanup, plan `:127-134`. |
| Config fail-closed unit coverage | `parseWorkerConfig` throws on non-allowlisted host, empty allowlist, non-`https` URL; honors custom header — sanity-checked present at `tests/mcp-broker/worker/config.test.ts`. | "What's covered", plan `:153`. |
| Outbound security-properties unit coverage | credential injection + opacity; non-allowlisted host; connection-teardown (`5e98ac5` DoS regression); timeout; redirect-inert (`redirect: 'manual'`); proxy via native fetch; opaque reassembly — `tests/mcp-broker/worker/outbound.test.ts`. | "What's covered", plan `:154-161`. |
| Enclosure credential-isolation unit coverage | upstream token never in plan `env`; carried as staged+shredded secret `{ request, targetEnv, required }`; egress `[cfg.host]` only; worker staged `0755` only when built — `tests/mcp-broker/worker/enclosure.test.ts`. | "What's covered", plan `:162`. |
| Worker-client dumb-relay unit coverage | real byte round-trip through a fake control socket; teardown closes mediator connection on worker error — `tests/mcp-broker/worker-client.test.ts`. | "What's covered", plan `:163`. |
| Launch gating + no-leak + byte-identical non-MCP | `tests/runtime/geofront/geofront-runtime.test.ts`: no apparatus when `MAGI_MCP_TUNNEL_SERVERS` unset; worker (not stub) launched + `--mcp-mount` relay when enabled; teardown on failed agent launch. | "What's covered", plan `:164-167`. |
| geofront non-agent egress + `--acp` relay lock-in | `other_agent_container_still_gets_egress_proxy_env_and_isolation`, `other_agent_does_not_mount_agent_config`, `run_acp_session_execs_exact_non_agent_entrypoint_over_relay` — all present in `crates/runtime-docker/tests/agent_container.rs` (READ-ONLY check; the plan cites the relay test under `acp_session.rs`, but the test lives in `agent_container.rs`). | "What's covered", plan `:168-171`. |
| Full-chain E2E handoff (Part B) — not executed on macOS | 10-step native-Linux/CI procedure (build both binaries; `--mcp-mount` geofront branch; mock upstream with CA the worker trusts; drive a real session; verify INV-1 by `docker exec` env-grep + shredded `.magi-private`; INV-2 by byte-diff agent egress allowlist; SSRF via non-allowlisted/`169.254.169.254` redirect; two-enclosure cost per §12.3). | Full-chain handoff, plan `:175-200`. |
| Overall outcome | **Part A DONE — PASS** (compiled bundle: real TLS, fail-closed config, credential injection, opaque response; no bug; shim no-op confirmed harmless). **Part B DONE as a handoff** (documented, not executed — same-kernel `--mcp-mount` + real geofront enclosures need native Linux). | Overall status, plan `:204-208`. |

The source plan `docs/superpowers/plans/2026-07-07-phase-2-verification.md` is archived alongside this ADR to `docs/archive/`. Its design spec (`2026-07-05-sandbox-mcp-broker-design.md`) is a shared document already archived with ADR-0260.
