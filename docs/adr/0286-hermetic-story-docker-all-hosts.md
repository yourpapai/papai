<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0286: Docker-Only Hermetic Story Execution on All Supported Hosts

## Status

Implemented (with divergence)

## Date

2026-07-14

## Context

ADR-0283 shipped the first OS-enforced sandbox for Tier 0 stories as a **dual-platform** model: a native `sandbox-exec` (Seatbelt) backend on Darwin and a pinned-image Docker backend on Linux. The Darwin backend hit a structural dead end within two days. Bun 1.3.13 statically resolves scoped packages by **enumerating ancestor directories above `appRoot`** under macOS Seatbelt, even when `app/node_modules` is a real immutable directory. Granting those temporary-directory ancestor reads would violate the session-only read boundary that Seatbelt was meant to enforce; the boundary and the resolver could not be reconciled. ADR-0285 was written the same day to work around that defect with a per-run app-local dependency copy, but the workaround copied ~609 MB per invocation and existed only because the native backend did.

This plan (`docs/superpowers/plans/2026-07-14-hermetic-story-docker-all-hosts.md`) and its design (`docs/superpowers/specs/2026-07-14-hermetic-story-docker-all-hosts-design.md`) proposed to dissolve the Darwin-specific problem entirely by **retiring the Seatbelt backend and selecting the existing pinned Linux Docker sandbox on every supported host OS**. The Linux container already provided the required OS boundary through Docker Desktop on non-Linux hosts; the hardened OCI contract (read-only root, `--network none`, `--cap-drop ALL`, `no-new-privileges`, `--pids-limit 128`, `--ipc none`, host UID:GID) was unchanged. With the native backend gone, the Darwin ancestor-enumeration defect that motivated ADR-0285 vanished, and the per-run copy could be replaced three days later by the zero-copy read-only bind mount (ADR-0225).

The plan's stated goal was: *Run every production story child through the pinned Linux Docker sandbox on every host OS, with no native fallback.* Backend selection becomes Docker-only and host-independent, the existing fail-closed Docker/Bun-version preflight runs before every session on all hosts, candidate evidence always records `linux-docker`, and the `sandbox-exec` code may remain only as test/diagnostic scaffolding — never selectable by normal story execution.

## Decision Drivers

- **Retire the unfixable Darwin backend.** Seatbelt could not satisfy both Bun's scoped-package ancestor enumeration and the session-only read boundary; the only way to close the defect was to stop selecting the native backend for production story runs.
- **One backend, every host.** The Linux container already works through Docker Desktop on macOS; selecting it uniformly removes a platform branch and the per-platform defect surface it creates.
- **Fail closed, no native fallback.** Missing Docker, an inaccessible daemon, or a pinned-image version mismatch must abort with exit 2 before session creation, fixture discovery, or child spawn — never silently degrade to a JavaScript-only guard or a native sandbox.
- **Backend selection must not double as a Docker-availability probe.** `selectStorySandboxBackend()` resolves *which* backend; a separate preflight (`assertLinuxStorySandboxBackend`) verifies Docker is actually reachable and runs the exact pinned Bun. The two concerns stay separate.
- **Evidence records the converged backend.** Candidate manifests write `sandboxBackend: 'linux-docker'` on every host; historical baselines retain the optional omission and comparison ignores it.
- **No contract loosening.** The hardened OCI policy (mounts, capabilities, network/IPC, UID:GID, PID limits) is unchanged; this decision only changes *which* backend is selected, not *what* the container enforces.

## Considered Options

### Option 1 — Docker-only on every supported host, retire native selection (chosen)

Replace platform branching in `selectStorySandboxBackend()` with `linux-docker` for every supported host; call `assertLinuxStorySandboxBackend()` before session creation, fixture discovery, or child spawn on every host; record `linux-docker` in candidate manifests; document Docker/Docker Desktop as a prerequisite on every host with exit-2 fail-closed behavior.

- **Pros:** dissolves the Seatbelt ancestor-enumeration defect at its root (the native backend is no longer selectable); gives every host the same kernel-enforced boundary and identical Bun 1.3.13 runtime; unblocks the zero-copy dependency model that ADR-0285's per-run copy was blocking; simplifies the backend contract to a single code path.
- **Cons:** Docker (Desktop) becomes a hard prerequisite for every local `bun test:stories` run — real contributor friction, accepted deliberately; the POSIX UID:GID requirement of the existing Docker backend is not satisfiable on Windows without further work, so the "every host" claim cannot honestly include `win32` as shipped.

### Option 2 — Keep the dual-platform model and widen the Seatbelt profile

Grant the Darwin profile reads up the temporary-directory chain so Bun's scoped-package enumeration succeeds.

- **Pros:** no backend retirement; preserves a native option for contributors without Docker.
- **Cons:** abandons the session-only read boundary — the entire point of the OS sandbox; the design explicitly rejected granting temporary-directory ancestors, worktree, `HOME`, or the cache root; the defect is structural in Bun's resolver, not in the profile, so future Bun versions could revive it.

### Option 3 — Docker on Darwin, keep Seatbelt as an opt-in fallback

Select Docker on Darwin by default but leave `sandbox-exec` selectable for contributors without Docker.

- **Pros:** preserves an escape hatch for Docker-less local runs.
- **Cons:** the fallback is the very backend whose boundary cannot be enforced; an opt-in path to a broken boundary is worse than none, because it invites runs that look hermetic but are not. The plan's driver was fail-closed-or-Docker, with no middle ground.

## Decision

The chosen Option 1 shipped. What landed:

1. **Docker-only backend selection** (`scripts/story/sandbox.ts:25-33`). `selectStorySandboxBackend()` returns `'linux-docker'` for every supported platform; the `aix`/`freebsd`/`openbsd`/`sunos` set throws `not implemented`. There is no `darwin`-native branch and no `sandbox-exec` selection path.
2. **Mandatory preflight before session creation** (`scripts/story/test-stories.ts:237-239,266-270`). `preflightStorySandbox()` calls `selectStorySandboxBackend()` and then `assertLinuxStorySandboxBackend()`, and is invoked *before* `createStoryRunnerSession()` — so a Docker or pinned-image failure aborts with exit 2 before any session, fixture discovery, or spawn.
3. **Fail-closed Docker/Bun-version preflight** (`scripts/story/sandbox.ts:247-256`). `assertLinuxStorySandboxBackend()` runs `docker version` and the pinned image's `--version`; a nonzero exit or any version other than `1.3.13` throws, and `runStoryTests()` catches that to return exit 2 (`scripts/story/test-stories.ts:136-143`).
4. **No native command emitted** (`scripts/story/sandbox.ts:227-230`). `buildStorySandboxCommand()` selects the backend then delegates to `buildLinuxStorySandboxCommand()`; the suite asserts no `sandbox-exec` appears in any production command (`tests/scripts/story-sandbox.test.ts:154-165`).
5. **Candidate evidence records `linux-docker`** (`scripts/story/manifest.ts:65,76,87,222`). The manifest schema's `SandboxBackendSchema` is `z.enum(['linux-docker'])`; candidate assembly defaults to `selectStorySandboxBackend(process.platform)` when no backend is passed; baselines omit it and comparison ignores the absence (`tests/scripts/story-manifest.test.ts:299-309`).
6. **Process-boundary proof is Docker-only and host-independent** (`tests/stories/sandbox/process-boundary.test.ts`). The eight-operation escape suite (file import, native stat, glob, network, stream race, cp-dereference, write, dependency-mount write) runs through the real sandboxed child launcher and reports the Docker backend without inspecting the host platform.
7. **Documentation records Docker-on-all-supported-hosts** (`docs/architecture/commands.md:31`). The hermetic-qualification section states the launcher runs the pinned OCI image on every supported host, that there is no native-sandbox fallback, that preflight verifies Docker and the exact Bun version before any child, and that unsupported platforms fail closed rather than degrading to JavaScript-only isolation.

## Consequences

### Positive

- The Seatbelt ancestor-enumeration defect is gone at its source: the native backend is no longer selectable for production story runs, so the boundary violation it required cannot occur.
- Every supported host gets the same kernel-enforced boundary (read-only mounts, no network/IPC, dropped capabilities, no-new-privileges, host UID:GID, PID limits) and the identical pinned Bun 1.3.13 runtime, giving CI/dev parity.
- Unblocking the native-backend retirement let the zero-copy read-only bind mount (ADR-0225) replace ADR-0285's ~609 MB per-run copy three days later.
- The process-boundary suite proves the boundary non-vacuously: every escape class that defeated the JavaScript I/O guard now fails at the OS, on the same backend every host uses.
- Candidate manifests make the converged backend auditable: every report carries `sandboxBackend: 'linux-docker'`, so a baseline comparison can detect a regression to a native or JS-only path.

### Negative

- **Docker (Desktop) is a hard prerequisite for every local `bun test:stories` run.** There is no lighter local mode and no native fallback; a contributor without Docker cannot run the hermetic lane. Accepted deliberately as the price of a real boundary.
- **Windows does not select Docker as the plan specified.** The plan's Task 1 Step 1 required `selectStorySandboxBackend('win32')` to return `'linux-docker'`; the shipped implementation throws an actionable unsupported-host error instead (see Divergence below and ADR-0225's open Windows follow-up).
- **The `sandbox-exec` diagnostic scaffolding lingers.** The plan allowed native code to remain as test/diagnostic; any residual Seatbelt references are inert (never selected by `selectStorySandboxBackend`) but are surface area a future contributor must recognize as dead.

### Risks

- **Windows support is deferred, not designed.** The Docker backend requires POSIX `getuid`/`getgid` (`resolveLinuxStorySandboxUser`, `scripts/story/sandbox.ts:67-72`), which Windows lacks; enabling `win32` would need a UID:GID synthesis strategy that has not been designed or tested. A future change that simply removes the `win32` throw without that strategy would push the failure to `resolveLinuxStorySandboxUser` with a worse message.
- **Docker-version drift.** The preflight pins Bun `1.3.13` and the image digest (`scripts/story/sandbox-image.txt`); a Docker Desktop upgrade that changes default networking or mount semantics could weaken the boundary without tripping the version check. The process-boundary suite is the mitigation, not the version pin alone.
- **Backend-selection bypass.** Any code path that spawns a story child without going through `preflightStorySandbox()` would skip the Docker availability/version check. The single-entry-point runner design (`runStoryTests` → `executeStoryTests` → `preflightStorySandbox` before `createSession`) is the structural guard; a second entry point would need its own preflight call.

## Related Decisions

- **ADR-0225** — Hermetic Story Execution — Docker-Only OS Sandbox with Immutable Snapshots. The umbrella decision that freezes the converged state; its supersession table records "2026-07-14 Docker on all hosts — Adopted; backend selection and preflight as specified." This ADR is the per-plan record for that table row. ADR-0225 also carries the open Windows follow-up that motivates this ADR's divergence.
- **ADR-0283** — Hermetic Story Process Sandbox, Phase 1. Shipped the dual-platform (Seatbelt + Docker) model whose Darwin defect this decision retires; ADR-0283's Task 3 (Seatbelt backend) was built and removed for the same ancestor-enumeration reason.
- **ADR-0282** — Hermetic E2E Master Baseline. Established the runner-owned session (`app/`, `tmp/`, reports) and the JavaScript I/O guard whose bypasses the OS sandbox this decision converges on addressed.
- **ADR-0285** — App-Local Story Dependencies (Per-Run Copy/Seal). Not Implemented; its per-run copy existed only to work around the Seatbelt defect this decision retired, and was superseded three days later by ADR-0225's zero-copy bind mount.

## Implementation Notes

Verified present against the shipped tree via `grep`/`glob`/`read`.

| File | Role | Evidence |
| --- | --- | --- |
| `scripts/story/sandbox.ts:11` | `StorySandboxBackend = 'linux-docker'` — the native backend type is gone; only Docker survives. | `read` confirms. |
| `scripts/story/sandbox.ts:13` | `UNSUPPORTED_PLATFORMS` set: `aix`, `freebsd`, `openbsd`, `sunos`. | `read` confirms. |
| `scripts/story/sandbox.ts:25-33` | `selectStorySandboxBackend()` throws on `win32` with an actionable unsupported-host error, throws on the unsupported set, and returns `'linux-docker'` for every other platform. No `darwin`-native branch. | `read` confirms. |
| `scripts/story/sandbox.ts:227-230` | `buildStorySandboxCommand()` selects the backend then delegates to `buildLinuxStorySandboxCommand()`; there is no native command construction path. | `read` confirms. |
| `scripts/story/sandbox.ts:247-256` | `assertLinuxStorySandboxBackend()` preflights `docker version` and the pinned image's Bun `--version`; a nonzero exit or a version other than `1.3.13` throws. | `read` confirms. |
| `scripts/story/sandbox.ts:41` | `STORY_SANDBOX_LINUX_IMAGE` loaded from `sandbox-image.txt` — single-sourced digest, matching the design's runtime contract. | `read` confirms; `scripts/story/sandbox-image.txt` holds `docker.io/oven/bun:1.3.13@sha256:87416c977a…`. |
| `scripts/story/sandbox.ts:67-72` | `resolveLinuxStorySandboxUser()` requires POSIX `getuid`/`getgid` — the reason `win32` cannot be admitted without further work. | `read` confirms. |
| `scripts/story/test-stories.ts:123` | `defaultDependencies()` wires `assertLinuxSandboxBackend: assertLinuxStorySandboxBackend` — the preflight is injected for testability, exactly as the plan's Task 1 Step 1 required. | `read` confirms. |
| `scripts/story/test-stories.ts:237-240` | `preflightStorySandbox(dependencies)` runs **before** `createSession` — the plan's "before session creation" ordering is honored. | `read` confirms. |
| `scripts/story/test-stories.ts:266-270` | `preflightStorySandbox()` calls `selectStorySandboxBackend()` then `assertLinuxStorySandboxBackend()`; both concerns are separated as the design required. | `read` confirms. |
| `scripts/story/test-stories.ts:136-143` | `runStoryTests()` catches a preflight throw and returns exit 2 — the fail-closed exit code the design specified. | `read` confirms. |
| `scripts/story/manifest.ts:65,76,87,138,143,222` | `SandboxBackendSchema = z.enum(['linux-docker'])`; candidate and baseline schemas carry optional `sandboxBackend`; `buildCandidateStoryManifest` defaults to `selectStorySandboxBackend(process.platform)` when unset. | `read` confirms. |
| `tests/scripts/story-sandbox.test.ts:140-142` | `selects the Docker backend on %s` for `darwin` and `linux`. | `read` confirms. |
| `tests/scripts/story-sandbox.test.ts:144-146` | `fails closed on unsupported %s` for `aix`, `freebsd`, `openbsd`. | `read` confirms. |
| `tests/scripts/story-sandbox.test.ts:148-152` | `rejects win32 with an actionable unsupported-host error` — the divergence assertion (see below). | `read` confirms. |
| `tests/scripts/story-sandbox.test.ts:154-165` | `builds a Docker command on %s with no native sandbox fallback` for `darwin` and `linux`; asserts `command[0] === 'docker'` and `not.toContain('sandbox-exec')`. | `read` confirms. |
| `tests/scripts/story-sandbox.test.ts:276-283` | `fails closed when Docker is unavailable or the image Bun version differs` — preflight exit/version proof. | `read` confirms. |
| `tests/scripts/story-manifest.test.ts:299-309` | Candidate manifest records `sandboxBackend: 'linux-docker'`; baseline omits it; comparison does not throw. | `read` confirms. |
| `tests/stories/sandbox/process-boundary.test.ts:45-46,242-275` | Boundary suite classifies Docker mode via `classifyStorySandboxDockerMode` and proves all eight escape operations fail through the real sandboxed child launcher. | `read` confirms. |
| `docs/architecture/commands.md:31` | Documents the pinned OCI image on every supported host (Linux + macOS via Docker Desktop; Windows not supported yet and fails closed), no native fallback, preflight before session/discovery/spawn, exit-2 fail-closed, and that candidate manifests always record `linux-docker`. | `read` confirms. |

Plan-vs-implementation notes:

- **Files moved under `scripts/story/`.** The plan edited flat paths (`scripts/story-sandbox.ts`, `scripts/test-stories.ts`, `scripts/story-manifest.ts`, `scripts/story-manifest-candidate.ts`). Shipped, the runner was reorganized into the `scripts/story/` package by ADR-0282/0283: `scripts/story/sandbox.ts`, `scripts/story/test-stories.ts`, `scripts/story/manifest.ts`. The plan's `scripts/story-manifest-candidate.ts` has no direct counterpart; candidate assembly is folded into `scripts/story/manifest.ts` (`buildCandidateStoryManifest`). Intent is preserved verbatim; only the layout differs.
- **`win32` diverges from the plan's explicit requirement.** Task 1 Step 1 asserted `selectStorySandboxBackend('win32') === 'linux-docker'`. Shipped, `win32` throws `Story sandbox is not supported on Windows: the linux-docker backend requires a POSIX host uid/gid. Run the story suite on Linux or macOS with Docker (see docs/architecture/commands.md).` The divergence was introduced deliberately in commit `ca8d2de45` ("fix(stories): fail closed with actionable error on Windows hosts", 2026-07-19), five days after this plan, because `resolveLinuxStorySandboxUser` requires `process.getuid`/`getgid` (absent on Windows). ADR-0225's Consequences record this as an open Windows follow-up. The plan's core goal — Docker-only, no native fallback, on every supported host — is met; the disagreement is whether `win32` is a "supported host" for the Docker backend, and the implementation answers no until a UID:GID synthesis strategy exists.
- **The runner's preflight is split into two concerns as designed, but lives in `test-stories.ts`, not `sandbox.ts`.** The plan's Task 1 implied the preflight call site would be in the runner module; `preflightStorySandbox()` is in `scripts/story/test-stories.ts:266-270` and calls into `sandbox.ts`. The separation (selection vs. availability) the design required is honored.
- **`sandbox-exec` is absent from the production code path.** The plan allowed native code to remain as diagnostic scaffolding; no `sandbox-exec` token appears in `scripts/story/sandbox.ts` or any production command, and the suite asserts its absence (`tests/scripts/story-sandbox.test.ts:163`). Any residual Seatbelt references are inert.
- **The manifest evidence test landed alongside ADR-0283/0225.** Task 2's `candidate.sandboxBackend === 'linux-docker'` assertion (`tests/scripts/story-manifest.test.ts:299-309`) shipped with the manifest-v4 work; the baseline-omission and comparison-ignores-it behavior matches the plan verbatim.

The source plan `docs/superpowers/plans/2026-07-14-hermetic-story-docker-all-hosts.md` and design `docs/superpowers/specs/2026-07-14-hermetic-story-docker-all-hosts-design.md` are archived alongside this ADR to `docs/archive/`.
