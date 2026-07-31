<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0262: Sandbox MCP Broker — Phase 1 Verification

## Status

Implemented

## Date

2026-07-07

## Context

ADR-0260 shipped **Phase 1** of the sandbox MCP broker — the `agent → mcp-tunnel (stdio) → bind-mounted host unix socket → magi-main mediator → stub responder → back` transport slice of design D — across magi + geofront, with the papai-side `projectSpec.mcp` declaration contract in place. Phase 1's Task 13 (the real docker-boundary end-to-end) was intentionally deferred to a separate manual-verification effort and captured in `docs/superpowers/plans/2026-07-07-phase-1-verification.md` (this ADR's source plan). That plan is itself a **verification report**, not a feature: it drives the compiled `mcp-tunnel` binary through a real container boundary using magi's unmodified shipped modules (`src/mcp-broker/{tunnel.ts, tunnel-main.ts, mediator.ts, stub-responder.ts, handshake.ts, index.ts}`) to validate the transport-isolation invariants the shared design (`docs/archive/2026-07-05-sandbox-mcp-broker-design.md`, "design D") rests on.

This ADR records the outcome of that verification. No LLM credentials and no real coding agent were involved — the test exercises only the transport mechanism (the T10 tunnel, the T11 mediator + stub, and the T12 bind-mount-a-socket-into-a-container mechanism), feeding a canned `tools/call` JSON-RPC frame into the tunnel's stdin.

The environment was macOS with Docker context `orbstack` (OrbStack 2.2.1, docker 29.4.0), node v24 on the host, and `node:22-alpine` / `oven/bun:latest` images in the containers; the repo under test was `~/Projects/yourpapai/magi` branch `main`, HEAD `ee7abdc`.

## Decision Drivers

- **INV-2 — deny-by-default egress, byte-identical.** The agent must reach the broker **only** through a bind-mounted unix socket path; the session egress allowlist must be provably unchanged. The verification must demonstrate the crossing uses a filesystem socket, never a TCP/IP address / DNS name, with no published ports or `--network` overrides.
- **Socket-only downstream path.** The crossing under test is precisely geofront's `--mcp-mount` mechanism: a host unix socket bind-mounted into the sandbox at `/run/magi/mcp.sock`, which the tunnel dials. The verification must exercise that file-as-a-live-socket bind-mount, not a network stand-in.
- **Reproducibility / same shipped code.** The round-trip must be driven through magi's real, unmodified Phase-1 modules — not a re-implementation — so a pass is evidence about the shipped binary, not a fixture.
- **Honest failure reporting.** Any topology that cannot be exercised in the test environment must be root-caused (with a control test) rather than hand-waved, and clearly distinguished from a code defect.
- **Production-target alignment.** The topology that matters is the one geofront actually deploys — a native Linux docker daemon where the host process and the sandbox share a kernel — so the verification must assess results against that target, not against a macOS dev convenience.

## Considered Options

### Option 1 — Literal host-macOS-process mediator + `-v <hostSocket>:<containerPath>` (the topology as literally assigned)

Run `startMediator`/`serveStub` as a plain process on the macOS host listening on `/tmp/mcp-e2e/mcp.sock`, then `docker run -v /tmp/mcp-e2e/mcp.sock:/run/magi/mcp.sock ...` invoking the staged `mcp-tunnel` inside the container — exactly the command the Phase-1 plan's Task 13 specified.

- **Pros:** matches the production relationship most directly on paper (a host-resident mediator, a container-resident tunnel, one bind-mount); single container; simplest invocation.
- **Cons:** only works when the host process and the docker daemon share a kernel. On this macOS/OrbStack machine the docker daemon runs inside OrbStack's Linux VM, so the host-bound socket lives in a different kernel from the container's `connect()` — the virtiofs/gRPC-FUSE shared-filesystem layer mirrors regular file *data* and preserves special-file *type* metadata but cannot splice a `connect()` across the VM boundary. Observed as `ECONNREFUSED /run/magi/mcp.sock` with zero connection attempts ever reaching the host process (`lsof` + mediator-log evidence). A regular-file bind-mount control from the same host path succeeds, isolating the failure to *live AF_UNIX socket forwarding*, not to bind-mounts generally.

### Option 2 — Same-kernel container↔container variant (mediator in a container, socket in a docker volume, tunnel in a separate container)

Keep the mediator inside the container-runtime kernel by running it in a container against a socket that lives in a docker volume, then run the tunnel in a *separate* container with that volume and the compiled `mcp-tunnel` binary (a regular-file bind-mount) both mounted in.

- **Pros:** preserves the one-kernel relationship that geofront's production target has (one Linux host, one Linux kernel, no VM hop) while still crossing a real container boundary and a real bind-mount; still drives magi's real unmodified modules (bind-mounted read-only) and the real compiled `mcp-tunnel`; reproduces honestly and was re-run with a second payload to rule out a fluke.
- **Cons:** is not byte-for-byte the production host-process topology (the mediator is container-resident, not host-resident); it validates the *mechanism* (T10 tunnel, T11 mediator/stub, T12 socket bind-mount) rather than the exact production process placement, which must still be exercised on a native Linux host.

### Option 3 — Defer all docker-boundary verification to a native Linux/CI runner

Skip local verification entirely and rely solely on the automated `transport-e2e.test.ts` (which is in-process, no container) plus a future Linux CI step.

- **Pros:** zero risk of conflating a macOS VM artifact with a real finding; the production target is Linux anyway.
- **Cons:** leaves the container-crossing mechanism (the load-bearing T12 piece) unverified at the time of Phase-1 sign-off, and the macOS limitation is itself a useful, non-obvious finding worth recording (Option 2 captures it while still producing a pass).

## Verification Outcome

**Overall: DONE_WITH_CONCERNS.** Option 2 was chosen as the verification topology; Option 1 was attempted first (as literally assigned), failed, and was root-caused rather than abandoned. The transport mechanism is verified working correctly across a real container boundary; the specific host-macOS-process topology cannot be exercised on this machine and must be re-run on native Linux. Headline findings:

1. **Same-kernel container↔container round-trip: PASS.** A `tools/call` (`id:7`, `{hi:"there"}`) sent into the tunnel's stdin produced exactly `{"jsonrpc":"2.0","id":7,"result":{"content":[{"type":"text","text":"{\"server\":\"echo\",\"echo\":{\"hi\":\"there\"}}"}]}}`, matching the stub's echo shape. Re-run with `id:42` / `{"foo":"bar"}` produced the matching `id:42` / `{\"foo\":\"bar\"}` response — reproduced twice, ruling out a fluke. The round-trip used magi's real, unmodified `mcp-tunnel` binary + `mediator.ts` + `stub-responder.ts` + `handshake.ts`.
2. **Tunnel bundle shape confirmed.** `bun run build:mcp-tunnel` produces a **1.19 KB** `/usr/bin/env node` script (not a compiled runtime blob), consistent with commit `85a8d82` ("node-bundle the tunnel + stage only when built — avoid 100MB unconditional stage") already noted as a divergence in ADR-0260.
3. **INV-2 preserved — zero new network egress.** The tunnel container reached the mediator **only** via a bind-mounted unix socket path; neither `docker run` invocation published ports, set `--network`, or otherwise configured egress, and the tunnel dials a filesystem socket path, never a TCP/IP address or DNS name. This holds for *both* attempts — the Option-1 failure failed for a *filesystem-mount* reason, not a network one, which independently corroborates that no network path was involved.
4. **Option-1 failure root-caused to a macOS VM-boundary limitation, not a magi/geofront code defect.** On OrbStack (and Docker Desktop likewise) the docker daemon runs in a Linux VM; the virtiofs/gRPC-FUSE shared filesystem mirrors file data and special-file *type* but cannot splice a `connect()` from the VM kernel through to a socket bound in the macOS host kernel. Confirmed three ways: `stat` inside the container reported the bind-mounted file as a `socket`; `lsof` on the host socket showed only the mediator process — zero inbound connections; and a regular-file bind-mount from the same host path succeeded. (Docker Desktop's `docker.sock`/ssh-agent forwarding "just works" only because of an explicit hardcoded vsock proxy for those specific paths — it is not a generic bind-mount capability.)
5. **The mechanism is correct on the production target.** On a native Linux host — which is what geofront targets in production/CI — a bind-mounted host unix socket *is* a live kernel object shared with the container process, so the Option-1 topology has no VM hop and the failure mode does not apply. The Option-2 pass exercises exactly that one-kernel relationship.

## Consequences

### Positive

- The Phase-1 transport — the T10 tunnel, the T11 mediator + stub, and the T12 socket-bind-mount mechanism — is verified end-to-end across a real container boundary using the shipped, unmodified code, with a reproducible `tools/call` round-trip.
- INV-2 (no new network egress) is corroborated by direct observation: the crossing is a filesystem socket path with default docker networking untouched, and the Option-1 failure mode itself proves the path is non-network.
- The Phase-1 staging decision (node-bundled ~1.2 KB tunnel rather than a 100 MB compiled blob) is re-confirmed as holding in the built artifact.
- The verification is honest and reusable: it records a real, non-obvious macOS limitation with a control test, rather than papering over a failure.

### Negative

- Local Phase-1 dev/testing on macOS (OrbStack or Docker Desktop) **cannot** exercise the exact host-process topology (Option 1); developers must either use a native Linux host/CI runner or fall back to the same-kernel container↔container variant (Option 2), which validates the mechanism but not the precise production process placement.
- The host-process topology (the actual geofront production shape) is verified only by *inference* from the same-kernel variant plus the root-cause analysis, not by a direct pass on this machine.

### Risks

- **Cross-kernel deployment silently breaks the crossing (carried forward from ADR-0260 / spec §5.2).** If magi ever runs off-kernel from the sandbox, Option X fails exactly as observed here. The macOS failure is the dev-env manifestation of the production risk already flagged in ADR-0260; the mitigation (verify on native Linux/CI) is unchanged.
- **Re-verification drift.** Until a native-Linux/CI step runs the Option-1 topology automatically, a regression in the host↔container socket forwarding would only be caught at manual Linux sign-off, not in routine CI on this machine.
- **No real worker in the path.** As in ADR-0260, Phase 1 carries no credential and the stub has no real capability, so this verification says nothing about the Phase-2 credential-holding worker enclosure — that is the subject of the forward-referenced ADR-0263.

## Related Decisions

- **ADR-0260: Sandbox MCP Broker — Phase 1 (Stdio Transport)** — the feature this verification validates. Its Task 13 (real docker-boundary E2E) is the work recorded here; the node-bundle / conditional-staging divergences it notes are re-confirmed by this verification's Step 1.
- **Shared design spec — `docs/archive/2026-07-05-sandbox-mcp-broker-design.md`** (design D; §5.2 Option X deployment/kernel constraint, §12 verification results). Archived alongside ADR-0260; this verification is the §12 evidence for Phase 1.
- **ADR-0263: Sandbox MCP Broker — Phase 2 Verification** (forward reference) — the Phase-2 worker-enclosure verification, which replaces the inert stub exercised here with the credential-holding downstream and must re-confirm INV-2 once a real upstream is in the path.

## Implementation Notes

Evidence is the verification report itself (`docs/superpowers/plans/2026-07-07-phase-1-verification.md`, archived alongside this ADR); section/line citations refer to that report. The magi modules under test were already verified present against the shipped tree in ADR-0260's Implementation Notes table (`src/mcp-broker/{tunnel.ts, tunnel-main.ts, mediator.ts, stub-responder.ts, handshake.ts, index.ts}`). The papai-side declaration contract (`buildSessionProjectSpec` spreads `mcp` onto the project spec only when populated) was sanity-checked read-only at `plugins/acp/tools.ts:157` / `plugins/acp/session-tools.ts:96` and is unchanged — upstreams are threaded as declarations, never as agent egress.

| Item | Result | Evidence |
| --- | --- | --- |
| Repo/environment under test | magi `main` @ `ee7abdc`; macOS, OrbStack 2.2.1, docker 29.4.0, node v24 host; `node:22-alpine`/`oven/bun:latest` containers; no LLM creds used. | report header, plan `:11-12`. |
| Scope: real, unmodified shipped modules driven through a container boundary | `tools/call` round-trip via `src/mcp-broker/{tunnel,tunnel-main,mediator,stub-responder,handshake,index}.ts`. | "What was tested", plan `:14-16`. |
| Tunnel bundle build | `bun run build:mcp-tunnel` → `dist/mcp-tunnel`, **1.19 KB** `/usr/bin/env node` script (not a compiled blob); confirms `85a8d82`. | Step 1, plan `:20-26`. |
| Option 1 invocation (host-process mediator + `-v hostSocket:containerPath`) | **FAIL** — `mcp-tunnel: connect ECONNREFUSED /run/magi/mcp.sock`; the assignment's exact `docker run -v /tmp/mcp-e2e/mcp.sock:/run/magi/mcp.sock ...` command. | Step 2, plan `:28-43`. |
| Option 1 root cause (VM-boundary, not a code defect) | `stat` shows socket type mirrored; `lsof` shows zero inbound connections to the host socket; mediator log never gains a "connection" line; OrbStack kernel `7.0.11-orbstack-...`. | Step 2 root-cause, plan `:45-52`. |
| Control test isolating the failure to live-socket forwarding | Regular-file bind-mount of `dist/mcp-tunnel` from the same host path into the same container succeeded (`head -c 60` printed real contents). | Step 2, plan `:50`. |
| Option 2 invocation (mediator in a container, socket in `mcp-e2e-vol`, tunnel in a separate container) | Mediator run via `bun -e "import { startMediator, serveStub } from '/magi-src/mcp-broker/index.js' ..."` against `/vol/mcp.sock`; tunnel container `-v mcp-e2e-vol:/run/magi` + staged binary. | Step 3, plan `:58-86`. |
| Same-kernel round-trip — `tools/call` `id:7` `{hi:"there"}` | **PASS** — stdout `{"jsonrpc":"2.0","id":7,"result":{"content":[{"type":"text","text":"{\"server\":\"echo\",\"echo\":{\"hi\":\"there\"}}"}]}}`, matching stub echo shape. | Step 3 stdout, plan `:88-93`. |
| Reproducibility — second payload `id:42` `{foo:"bar"}` | **PASS** — matching echoed response with `id:42` / `{\"foo\":\"bar\"}`; re-run rules out a fluke. | Step 3, plan `:94-96`. |
| INV-2 spot check — no new egress | Unix socket path only; default docker bridge networking; no ports published, no `--network`; holds for both attempts (Option-1 failed for a filesystem-mount reason). | "INV-2 spot check", plan `:98-100`. |
| Mediator logic correct in isolation | Direct host `nc -U` to the host-bound mediator round-tripped a full `tools/call` before the container attempt. | Step 2, plan `:30`. |
| Overall outcome | **DONE_WITH_CONCERNS** — mechanism verified on a real kernel; macOS host-process topology blocked by virtiofs VM-boundary; re-verify on native Linux/CI. | Summary + table, plan `:102-111`. |
| Cleanup (no artifacts left) | `docker stop mcp-e2e-mediator`; `docker volume rm mcp-e2e-vol`; `rm -rf /tmp/mcp-e2e` and magi `dist/` (gitignored); `git status` clean in magi. | "Cleanup performed", plan `:113-119`. |

The source plan `docs/superpowers/plans/2026-07-07-phase-1-verification.md` is archived alongside this ADR to `docs/archive/`. Its design spec (`2026-07-05-sandbox-mcp-broker-design.md`) is a shared document already archived with ADR-0260.
