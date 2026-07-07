<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Sandbox MCP Broker — Phase 2 verification (worker-bundle integrated check + Linux E2E handoff)

Date: 2026-07-07
Repo under test: `~/Projects/yourpapai/magi` (branch `main`, HEAD `d88419c` — "feat(mcp-worker): launch worker enclosure as the mediator downstream when MCP enabled")
Environment: macOS, node v24.15.0 on host, Docker 29.4.0 (OrbStack context) available but **not used** for Part A (Part A runs the compiled bundle directly under host `node`, no container). No LLM credentials were used or needed.

**Spec:** `docs/superpowers/specs/2026-07-05-sandbox-mcp-broker-design.md` (§5.4 worker, §10 threats, §12.3 launch gate).
**Plan:** `docs/superpowers/plans/2026-07-07-sandbox-mcp-broker-phase-2.md` (Task 11 — docker-boundary verification).

---

## Part A — integrated worker-bundle check (real TLS verification)

**Goal:** prove the _compiled_ `dist/mcp-worker` bundle works end-to-end as one artifact (env config → stdio ndjson bridge → hardened outbound → opaque response + credential), with **real TLS certificate verification** — i.e. beyond what the unit tests cover, since `tests/mcp-broker/worker/outbound.test.ts` always passes `insecureTlsForTest: true` to talk to its self-signed loopback mock. This run uses no such escape hatch; trust is established the same way a production deployment would, via `NODE_EXTRA_CA_CERTS`.

### Setup

```bash
cd ~/Projects/yourpapai/magi && bun run build:mcp-worker
```

Result: `bun build ./src/mcp-broker/worker/worker-main.ts --target=node --outfile ./dist/mcp-worker` → **4.0 KB**, single entry point, `#!/usr/bin/env node` shebang (bundled 4 modules: `bridge.ts`, `config.ts`, `outbound.ts`, `worker-main.ts`).

Self-signed cert for `localhost` (used as its own trust anchor, since it's self-signed) generated in a scratch dir outside both repos:

```bash
mkdir -p /tmp/mcp-p2-verify && cd /tmp/mcp-p2-verify
openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -days 2 -nodes \
  -subj "/CN=localhost" -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
```

Mock upstream MCP server (`node:https`, requires `Authorization: Bearer testtoken`, echoes the request body opaquely as a `tools/call` JSON-RPC result), started on `127.0.0.1:8443` and reached via the URL host `https://localhost:8443/` (matching the cert's CN/SAN):

```bash
node mock-upstream.mjs 8443   # backgrounded; logs "mock-upstream listening on https://127.0.0.1:8443"
```

### Positive check — trusted CA, real credential, real TLS handshake

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"echo","arguments":{"hello":"world"}}}' \
  | NODE_EXTRA_CA_CERTS=/tmp/mcp-p2-verify/cert.pem \
    MAGI_MCP_UPSTREAM_URL="https://localhost:8443/" \
    MAGI_MCP_UPSTREAM_TOKEN='Bearer testtoken' \
    MAGI_ALLOWED_MCP_HOSTS=localhost \
    node ~/Projects/yourpapai/magi/dist/mcp-worker
```

**Observed stdout (exit 0):**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "echoed:{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"echo\",\"arguments\":{\"hello\":\"world\"}}}"
      }
    ]
  }
}
```

The mock upstream's handler returns HTTP 401 whenever the `Authorization` header doesn't match `Bearer testtoken` (verified by reading its source, `mock-upstream.mjs`); getting back a 200 opaque echoed body rather than the `{"error":"unauthorized"}` shape confirms the worker injected the correct credential header. This is the compiled bundle running config-parse → ndjson stdin read → hardened outbound POST with real TLS cert verification (trusted only because `NODE_EXTRA_CA_CERTS` names the self-signed cert as a CA) → opaque response written to stdout, unparsed end to end. **PASS.**

### Negative check (a) — config fail-closed when the upstream host isn't allowlisted

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call", ...}' \
  | NODE_EXTRA_CA_CERTS=/tmp/mcp-p2-verify/cert.pem \
    MAGI_MCP_UPSTREAM_URL="https://localhost:8443/" \
    MAGI_MCP_UPSTREAM_TOKEN='Bearer testtoken' \
    MAGI_ALLOWED_MCP_HOSTS=other-host.example \
    node ~/Projects/yourpapai/magi/dist/mcp-worker
```

**Observed:** uncaught exception, exit code 1, before any stdin was read:

```
Error: mcp-worker: upstream host localhost not in MAGI_ALLOWED_MCP_HOSTS
    at parseWorkerConfig (file:///Users/ki/Projects/yourpapai/magi/dist/mcp-worker:62:11)
```

`parseWorkerConfig` runs synchronously at module load (`worker-main.ts` line 6, before `runBridge` is ever called), so a non-allowlisted upstream refuses to start at all rather than merely failing individual calls. **PASS (fail-closed confirmed).**

### Negative check (b) — real TLS verification rejects an untrusted self-signed cert

Same command as the positive check, but **without** `NODE_EXTRA_CA_CERTS`:

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call", ...}' \
  | MAGI_MCP_UPSTREAM_URL="https://localhost:8443/" \
    MAGI_MCP_UPSTREAM_TOKEN='Bearer testtoken' \
    MAGI_ALLOWED_MCP_HOSTS=localhost \
    node ~/Projects/yourpapai/magi/dist/mcp-worker
```

**Observed stdout: empty. Stderr:**

```
mcp-worker: fetch failed
```

Exit code 1. No success response was ever printed — the outbound call failed closed. To confirm this is genuinely a **certificate-verification** rejection (not some other network failure masked by the same generic message), the same TLS handshake was reproduced directly against Node's `fetch` outside the bundle:

```
ERROR: fetch failed CAUSE: self-signed certificate; if the root CA is installed locally,
try running Node.js with --use-system-ca DEPTH_ZERO_SELF_SIGNED_CERT
```

`DEPTH_ZERO_SELF_SIGNED_CERT` is Node's standard TLS chain-verification error for an untrusted self-signed leaf — i.e. the production path (`makeOutbound(cfg, {})`, no `insecureTlsForTest`) really does perform full certificate verification and really does refuse an untrusted cert; it does not silently downgrade or ignore this in the compiled artifact. **PASS (fail-closed TLS confirmed).**

### A note on the runtime shim (checked, not a bug)

`src/mcp-broker/worker/outbound.ts` uses Bun's native `fetch(url, { tls: {...} })` rather than `undici`'s `Agent`/`ProxyAgent`, because (per its own comment) Bun's `undici` shim no-ops those TLS/dispatcher controls. Since the compiled bundle here is executed under **Node**, not Bun, that `tls` option is simply an extra, unrecognized fetch-init property under Node's own `undici`-based fetch — Node ignores it rather than erroring. This does not weaken anything in production: the `tls` override is only ever passed with `insecureTlsForTest: true` (test-only, never set by `worker-main.ts`), and Node's default fetch already performs real certificate verification and already honors `NODE_EXTRA_CA_CERTS` independent of that option. Both the positive and negative checks above confirm the _effective_ behavior (verify by default, trust only what `NODE_EXTRA_CA_CERTS` names) is identical to what the code intends — checked directly rather than assumed.

### Cleanup

```bash
kill <mock-upstream PID>
rm -rf ~/Projects/yourpapai/magi/dist   # gitignored build output, not committed
rm -rf /tmp/mcp-p2-verify              # scratch cert + mock server + logs
```

`git status` in magi confirmed clean afterward (nothing to commit; `dist/` is gitignored).

### Part A summary

| Check                                                              | Result                                                                                                          |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| Bundle shape (`dist/mcp-worker`)                                   | PASS — 4.0 KB, `#!/usr/bin/env node`, 4 modules bundled                                                         |
| Positive: trusted CA, correct credential, real upstream            | **PASS** — opaque echoed response returned, credential header confirmed via the mock's 401-on-mismatch behavior |
| Negative (a): allowlist doesn't contain the upstream host          | **PASS** — exits 1 before touching stdin (config fail-closed)                                                   |
| Negative (b): untrusted self-signed cert, no `NODE_EXTRA_CA_CERTS` | **PASS** — outbound call fails (`DEPTH_ZERO_SELF_SIGNED_CERT`), no success response emitted                     |

**Overall Part A: PASS.** No bug found in the compiled bundle; the Bun-fetch-under-Node `tls`-option no-op was investigated and confirmed harmless (see note above) rather than assumed.

---

## What's covered by the existing test suite

The following invariants and behaviors are already exercised by magi's automated tests (all green as of HEAD `d88419c`; not re-run here since Part A's goal was the _compiled-artifact_ gap, not re-deriving unit coverage):

- **Config fail-closed** — `tests/mcp-broker/worker/config.test.ts` (`parseWorkerConfig`): throws on a non-allowlisted host, an empty allowlist, and a non-`https` URL; honors a custom credential header name.
- **Outbound empirical security properties** — `tests/mcp-broker/worker/outbound.test.ts` (`makeOutbound`, all against a real `node:https` self-signed-cert mock, `insecureTlsForTest: true`):
  - credential injected at the header + opaque response returned unparsed;
  - non-allowlisted host refused;
  - **connection-teardown**: a leaky upstream that streams past the size cap is proven to have its TCP connection actually closed (`req.socket.on('close')` on the server side), not just its promise rejected — a regression test for a prior DoS-shaped bug (`5e98ac5`);
  - **timeout**: a hanging upstream is aborted within the configured `timeoutMs`;
  - **redirect-inert**: `redirect: 'manual'` means a 3xx from a compromised/misconfigured upstream is returned inert, never chased (code-level, exercised implicitly by the fixed `redirect` option — no code path in `outbound.ts` follows a `Location` header);
  - **proxy**: `HTTPS_PROXY`/`https_proxy` is honored via Bun's native fetch (documented in `outbound.ts`'s comment on why `undici`'s `Agent`/`ProxyAgent` were rejected — Bun's own `undici` shim no-ops them);
  - **opaque**: response bodies are reassembled by byte/stream decoding only, never `JSON.parse`d.
- **Enclosure credential-isolation** — `tests/mcp-broker/worker/enclosure.test.ts` (`buildWorkerPlan`): the upstream token is never present in the plan's `env` map; it is carried exclusively as a `{ request: 'MCP_UPSTREAM_TOKEN', targetEnv: 'MAGI_MCP_UPSTREAM_TOKEN', required: true }` staged secret (the same staged+shredded `magi-init` mechanism used for coding-agent provider credentials); egress is restricted to exactly `[cfg.host]`; the worker binary is staged onto `PATH` at `0755` only when built.
- **Worker-client dumb relay** — `tests/mcp-broker/worker-client.test.ts` (`makeWorkerHandleConnection`): a real byte relay round-trip through a fake worker control socket (the fake worker transforms the line, proving the relay isn't a no-op), plus a teardown test confirming the mediator connection is closed if the worker connection errors (e.g. the worker enclosure never came up).
- **Launch gating + no-worker-leak + byte-identical non-MCP** — `tests/runtime/geofront/geofront-runtime.test.ts`:
  - `launch runs no MCP apparatus (no mediator, no worker, no --mcp-mount) when MAGI_MCP_TUNNEL_SERVERS is unset` — non-MCP sessions are byte-identical to pre-MCP behavior (only `workspace up --acp`, no mediator, no worker dir created);
  - `launch launches the worker enclosure, mounts mcp, and relays the agent tunnel to the worker (not the stub) when MCP is enabled` — asserts two independent `workspace up` invocations (agent `--acp` + worker `--acp <ctrlSocketPath>`, no `--mcp-mount` on the worker's own invocation), and that a tool call reaches the fake worker (not the Phase-1 stub);
  - `launch tears down the mcp mediator and the worker enclosure when the agent acp socket never appears (MCP enabled)` — a failed _agent_ launch does not leak the mediator's listening socket or the worker enclosure.
- **geofront non-agent `Other` + egress + `--acp` relay lock-in** (`~/Projects/experiments/geofront`, Rust):
  - `crates/runtime-docker/tests/agent_container.rs::other_agent_container_still_gets_egress_proxy_env_and_isolation` — regression test asserting a non-agent workload (`AgentKind::Other`, entrypoint `mcp-worker`) still gets the full egress-proxy env (`HTTP_PROXY`/`https_proxy`/`ISOLATION_STRICT=1`/proxy `--add-host`) and _no_ agent-specific config mounts (`.codex`, `.claude`, etc.) — the agent kind must not gate egress isolation;
  - `crates/runtime-docker/tests/agent_container.rs::other_agent_does_not_mount_agent_config` — companion assertion that a non-agent container gets none of the coding-agent config mounts;
  - `crates/runtime-docker/tests/acp_session.rs::run_acp_session_execs_exact_non_agent_entrypoint_over_relay` — regression test asserting the credential-holding `mcp-worker` binary is exec'd over the _same_ `--acp` relay as a coding agent, with its exact entrypoint/args, over non-tty `exec -i` (not `-it`) so its stdio is a clean control channel.

---

## Full-chain E2E — Linux handoff (Task 11 of the Phase-2 plan)

**Why not on macOS:** per the Phase-1 finding (spec §5.2, "Deployment constraint (verified 2026-07-07)"), the `--mcp-mount` bind-mount only forwards a live unix-socket `connect()` when magi and the sandbox containers **share a kernel** — a native Linux host, or the same VM as the docker daemon. VM-based docker on macOS (Docker Desktop / OrbStack) cannot splice that cross-kernel crossing (confirmed empirically in `docs/superpowers/plans/2026-07-07-phase-1-verification.md`: a literal host-macOS-process + bind-mount attempt gave `ECONNREFUSED`, root-caused via `lsof` to zero connection attempts ever reaching the host-bound socket, while a same-kernel container↔container variant passed). Phase 2 adds a **second** enclosure (the worker) on top of that same constraint, and real geofront enclosures (kernel-enforced `proxy_container` + iptables + dnsmasq) don't spin up cleanly in this dev environment either. The **worker leg alone** (`docker exec`-style `--acp` relay, driving a non-agent `Other` entrypoint) is kernel-agnostic — it works the same whether magi and the container share a kernel or not, because `--acp` crosses via `docker exec`, not a bind-mounted socket. That is exactly why Part A above validates the worker's own logic directly (compiled bundle, real TLS, real fail-closed config) without needing Linux, while the _tunnel → mediator → worker_ full chain needs a native-Linux host or CI runner to prove the `--mcp-mount` crossing plus real geofront enclosures end to end.

### Steps to run on native Linux / CI

1. **Build both binaries** in `~/Projects/yourpapai/magi`:
   ```bash
   bun run build:mcp-tunnel
   bun run build:mcp-worker
   ```
2. **Build/point at the geofront branch** with `--mcp-mount` support (`~/Projects/experiments/geofront`, branch `feat/mcp-mount` or wherever it landed) — a real `geofront` binary on `PATH`.
3. **Start a mock upstream MCP server**: an HTTPS server with a cert the worker enclosure will trust (either a real CA-issued cert, or stage a custom CA via the worker's provisioning — Phase 2's `buildWorkerPlan` doesn't currently thread `NODE_EXTRA_CA_CERTS`/a custom CA into the worker image, so for this handoff either use a publicly-trusted cert for the mock, or extend the worker's env/plan to add a CA bundle before this run). It must require the credential header and echo `tools/call` opaquely, exactly like Part A's mock.
4. **Configure env** for the session:
   ```bash
   export MAGI_MCP_TUNNEL_SERVERS=echo
   export MAGI_MCP_UPSTREAM_URL=https://<mock-host>/
   export MAGI_MCP_UPSTREAM_TOKEN='Bearer <test-token>'
   export MAGI_ALLOWED_MCP_HOSTS=<mock-host>
   ```
5. **Drive a real coding session** through magi's normal `/sessions` path (or a focused harness reproducing `geofront-runtime.ts`'s `launch()`), with a prompt/tool-call that exercises the declared `echo` MCP server. Confirm the transcript shows the tool call returning the mock's opaque echoed response — proving `agent → mcp-tunnel → --mcp-mount socket → mediator → worker-client → worker enclosure control socket (--acp relay) → hardened outbound → mock upstream → opaque response → back` end to end, in real geofront enclosures.
6. **Verify INV-1** (credential isolation): `docker exec` into both the **agent** enclosure and the **worker** enclosure and `env | grep -i MAGI_MCP` (or `MCP_UPSTREAM_TOKEN`) in each. Expect: present _only_ in the worker enclosure's env, absent from the agent enclosure entirely. Then confirm the worker enclosure's `.magi-private` secret manifest has been shredded post-launch (`ls -la` / attempt to read it — expect gone or empty, matching the existing coding-agent credential-shred behavior `magi-init` already performs).
7. **Verify INV-2** (agent egress unchanged): diff the agent enclosure's rendered `geofront.toml` egress allowlist against a no-MCP session's — expect **byte-identical** (no MCP host added to the _agent's_ allowlist; only the worker's separate enclosure gets `egressDomains: [cfg.host]`).
8. **Verify SSRF containment**: point `MAGI_MCP_UPSTREAM_URL` at a host **not** in `MAGI_ALLOWED_MCP_HOSTS` (or have the mock respond with a redirect to a metadata-service-shaped address, e.g. `169.254.169.254`) and confirm the call is blocked — both by the in-code fail-closed allowlist/no-redirect logic (`outbound.ts`, already covered by Part A + the outbound unit tests) **and** by the worker enclosure's kernel-enforced egress (`proxy_container`/iptables) actually refusing the connection at the network layer if the in-code check were somehow bypassed. Record which layer caught it.
9. **Measure the two-enclosure cost** (spec §12.3): compare container count and cold-start wall-clock time for an MCP-enabled session (agent enclosure + worker enclosure, each with its own egress-proxy sidecar) against a plain no-MCP session (agent enclosure only). Record both numbers; flag if the added latency/resource cost is prohibitive for interactive use.
10. **Record results** by appending to this doc (or a follow-up dated doc) with PASS/FAIL per invariant (INV-1, INV-2, SSRF) and the cost numbers, mirroring the Phase-1 verification doc's format.

---

## Overall status

**Part A: DONE — PASS.** The compiled `dist/mcp-worker` bundle, run as a standalone Node process with production-shaped env (no `insecureTlsForTest`), correctly performs config-fail-closed validation, ndjson stdio bridging, hardened outbound calls with **real** TLS certificate verification (both accepting a CA-trusted self-signed cert and rejecting an untrusted one), credential-header injection, and opaque response streaming. No bug found; one implementation detail (Bun-`fetch`'s `tls` option becoming an inert extra property under Node) was investigated and confirmed harmless rather than assumed.

**Part B: DONE.** This document records the full-chain Linux/CI handoff plan; it was not executed here because the `--mcp-mount` bind-mount crossing and real geofront enclosures are same-kernel-only (Phase-1 finding) and don't run cleanly in this macOS dev environment.
