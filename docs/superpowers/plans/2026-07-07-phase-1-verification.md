<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Sandbox MCP Broker — Phase 1 docker-boundary transport verification

Date: 2026-07-07
Repo under test: `~/Projects/yourpapai/magi` (branch `main`, HEAD `ee7abdc`)
Environment: macOS, Docker context `orbstack` (OrbStack 2.2.1, docker 29.4.0), node v24 on host, node:22-alpine / oven/bun:latest images in containers. No LLM credentials were used or needed — this test only exercises the transport mechanism (T10 tunnel, T11 mediator+stub, T12 bind-mount), not a real coding agent.

## What was tested

That a process **inside a container**, dialing a unix socket that is **bind-mounted** into the container (the mechanism behind geofront's `--mcp-mount`), can round-trip an MCP `tools/call` through the compiled `mcp-tunnel` binary to a mediator + stub responder and back, using magi's real shipped modules (`src/mcp-broker/{tunnel.ts,tunnel-main.ts,mediator.ts,stub-responder.ts,handshake.ts,index.ts}`) — unmodified.

## Step 1 — build the tunnel bundle

```bash
cd ~/Projects/yourpapai/magi
bun run build:mcp-tunnel
file dist/mcp-tunnel
```

Result: `bun build ./src/mcp-broker/tunnel-main.ts --target=node --outfile ./dist/mcp-tunnel` → **1.19 KB**, single entry point. `file` reported `a /usr/bin/env node script text executable, ASCII text` — a small node script, not a bundled runtime blob. Confirms the earlier repo history (`85a8d82 fix(mcp-broker): node-bundle the tunnel + stage only when built (avoid 100MB unconditional stage)`) is holding.

## Step 2 — attempt 1: host-process mediator + `-v <macOS-socket>:<container-path>` (as literally specified)

Started a bun script on the **macOS host** importing magi's real `startMediator`/`serveStub` from `src/mcp-broker/index.js`, listening on `/tmp/mcp-e2e/mcp.sock`. Confirmed the socket appeared (`srwxr-xr-x`) and that connecting to it directly from the host via `nc -U` round-tripped a full `tools/call` correctly (mediator+stub logic itself is correct in isolation).

Then ran, per the assignment's exact command:

```bash
docker run --rm \
  -v /tmp/mcp-e2e/mcp.sock:/run/magi/mcp.sock \
  -v ~/Projects/yourpapai/magi/dist/mcp-tunnel:/usr/local/bin/mcp-tunnel:ro \
  --entrypoint sh \
  node:22-alpine -lc \
  '(printf "%s\n" "{\"jsonrpc\":\"2.0\",\"id\":7,\"method\":\"tools/call\",\"params\":{\"name\":\"echo\",\"arguments\":{\"hi\":\"there\"}}}"; sleep 1) | node /usr/local/bin/mcp-tunnel --server echo --socket /run/magi/mcp.sock'
```

**Result: FAIL.** Container stdout: nothing. Stderr: `mcp-tunnel: connect ECONNREFUSED /run/magi/mcp.sock`.

### Root-cause debugging (found something real, not faked)

- `docker context show` → `orbstack`; `docker info` → `Operating System: OrbStack`, `Kernel Version: 7.0.11-orbstack-...`. Docker/containers run inside OrbStack's own Linux VM, not on the macOS kernel directly.
- Inside the container, `stat /run/magi/mcp.sock` correctly reports `File: ... IO Block: 4096 socket` — the special-file **type** is faithfully mirrored across the bind mount.
- But `lsof /tmp/mcp-e2e/mcp.sock` on the host, both before and after two separate docker attempts (one mounting the file directly, one mounting the parent directory), showed **only the original host bun process** holding the socket — zero connection attempts ever reached it. The host mediator process log (`mediator listening on /tmp/mcp-e2e/mcp.sock`) never gained a second line (no "connection" activity), confirming the container-side `connect()` never reached the real host-bound socket at all.
- Control test: bind-mounting a **regular file** (`dist/mcp-tunnel`) from the same macOS path into the same container worked perfectly (`head -c 60` printed real file contents) — so generic host→container bind mounts of file _content_ are fine; it is specifically a **live AF_UNIX socket** that doesn't forward.

**Conclusion:** this is a known class of limitation of VM-based container runtimes on macOS (Docker Desktop and OrbStack alike): the shared-filesystem layer (virtiofs/gRPC-FUSE-style) that implements bind mounts mirrors regular file _data_ and preserves special-file _type_ metadata, but it does not — and architecturally cannot, without an explicit relay — splice a `connect()` syscall executed by a process in the Linux VM through to a socket actually bound in the macOS host kernel. (Docker Desktop's docker.sock/ssh-agent forwarding "just works" only because Docker Desktop hardcodes an explicit vsock-based proxy for those specific paths — it is not a generic bind-mount capability.) On a real Linux host (which is what geofront targets in production/CI — a native Linux docker daemon with no VM boundary between "host process" and "container"), a bind-mounted host unix socket **is** a live kernel object shared with the container process, and this failure mode does not apply. This is a dev-environment artifact of testing on macOS via OrbStack, not a code defect in T10/T11/T12 — but it is a real, useful finding: **local Phase-1 dev/testing on this machine cannot use a bare macOS-host-process mediator + docker bind-mount; it requires either a Linux host/CI runner, or (as done below) keeping both the mediator and the mounted socket within the same container-runtime kernel.**

## Step 3 — attempt 2: same-kernel variant (mediator run in a container, socket in a docker volume, tunnel run in a separate container)

To still validate the actual transport mechanism (T10 tunnel binary, T11 mediator+stub, and T12's bind-mount-a-socket-into-a-container mechanism) honestly — without the macOS/OrbStack VM-crossing artifact — the mediator was moved into a container so the socket lives natively inside the same kernel the tunnel container also runs in (this is the same relationship geofront's production target has: one Linux host, one Linux kernel, no VM hop):

```bash
docker volume create mcp-e2e-vol

docker run --rm -d --name mcp-e2e-mediator \
  -v ~/Projects/yourpapai/magi/src:/magi-src:ro \
  -v mcp-e2e-vol:/vol \
  -w /magi-src \
  oven/bun:latest \
  bun -e "
import { startMediator, serveStub } from '/magi-src/mcp-broker/index.js'
const sock = '/vol/mcp.sock'
const m = await startMediator(sock, { handleConnection: (id, i, o) => serveStub(id, i, o) })
console.error('mediator listening on', sock)
await new Promise(() => {})
"
```

This imports magi's real, unmodified `src/mcp-broker` modules (bind-mounted read-only) and confirmed listening (`docker logs` → `mediator listening on /vol/mcp.sock`; a throwaway `alpine` container listing the volume showed `srwxr-xr-x ... mcp.sock`).

Then the tunnel ran in a **separate** container, with the volume (containing the live socket) and the compiled `mcp-tunnel` binary (a regular-file host bind mount, per the control test above) both bind-mounted in — exactly mirroring the assignment's container invocation, just pointed at the volume-backed socket path:

```bash
docker run --rm \
  -v mcp-e2e-vol:/run/magi \
  -v ~/Projects/yourpapai/magi/dist/mcp-tunnel:/usr/local/bin/mcp-tunnel:ro \
  --entrypoint sh \
  node:22-alpine -lc \
  '(printf "%s\n" "{\"jsonrpc\":\"2.0\",\"id\":7,\"method\":\"tools/call\",\"params\":{\"name\":\"echo\",\"arguments\":{\"hi\":\"there\"}}}"; sleep 1) | node /usr/local/bin/mcp-tunnel --server echo --socket /run/magi/mcp.sock'
```

**Observed container stdout:**

```
{"jsonrpc":"2.0","id":7,"result":{"content":[{"type":"text","text":"{\"server\":\"echo\",\"echo\":{\"hi\":\"there\"}}"}]}}
```

Re-ran with a different id/payload (`id":42`, `{"foo":"bar"}`) to rule out a fluke — got back the matching echoed response with `id":42` and `{\"foo\":\"bar\"}`.

**Round-trip assertion:** id `7` (and separately `42`) round-tripped correctly; the payload matches the stub's expected echo shape `{server:"echo", echo:{hi:"there"}}` exactly. **PASS.**

## INV-2 spot check

The tunnel container reached the mediator **only** via a bind-mounted unix socket path (`/run/magi/mcp.sock`, backed by a docker volume in the passing variant; a macOS file path in the failed literal-spec variant) — the tunnel dials a filesystem socket path, never a TCP/IP address or DNS name, and neither `docker run` invocation published ports, set `--network`, or otherwise configured network egress. Both containers ran with Docker's default bridge networking untouched; **zero network egress was added or used** by this crossing. This holds for both attempts (the failed one failed for a _filesystem-mount_ reason, not a network one, which independently corroborates that no network path was involved).

## Summary

| Aspect                                                                      | Result                                                                                                                                                                                                                                                    |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tunnel bundle size/shape                                                    | PASS — 1.19 KB node script                                                                                                                                                                                                                                |
| Literal macOS-host-process + `-v hostSocket:containerPath`                  | **FAIL** in this OrbStack/macOS dev environment — `ECONNREFUSED`, root-caused to VM-boundary limitation on live AF_UNIX socket bind mounts (not a magi code defect; expected to work on native Linux hosts, which is geofront's actual production target) |
| Same-kernel (container-to-container via docker volume) transport round-trip | **PASS** — full `tools/call` round-trip via the real, unmodified `mcp-tunnel` binary + `mediator.ts` + `stub-responder.ts` + `handshake.ts`, reproduced twice with different ids/payloads                                                                 |
| INV-2 (no network egress added by the crossing)                             | Confirmed — unix socket path only, default docker networking, no ports/`--network` used                                                                                                                                                                   |

**Overall: DONE_WITH_CONCERNS.** The transport mechanism itself (T10 tunnel, T11 mediator/stub) is verified working correctly across a real container boundary. T12 (bind-mount) is verified as a mechanism, but the specific host-macOS-process → container topology requested in the assignment does not work on this OrbStack/macOS dev machine due to a virtiofs-class VM-boundary limitation on live unix-socket forwarding (control-tested and confirmed via `lsof`/mediator-log evidence of zero connection attempts, plus a regular-file-mount control that succeeded). This should be re-verified on a native Linux host/CI runner where geofront actually deploys sandboxes, since that topology has no VM hop between the host process and the docker daemon. No LLM was used; no credentials were touched.

## Cleanup performed

- `docker stop mcp-e2e-mediator` (auto-removed, `--rm`)
- `docker volume rm mcp-e2e-vol`
- `rm -rf /tmp/mcp-e2e` (scratch host mediator script + socket)
- `rm -rf ~/Projects/yourpapai/magi/dist` (gitignored build output, not committed)
- `git status` in magi confirmed clean afterward
