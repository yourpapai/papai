<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0283: Hermetic Story Process Sandbox — Phase 1 (Required OS Sandbox)

## Status

Implemented (with divergence)

## Date

2026-07-13

## Context

ADR-0282 established the hermetic Tier 0 story harness: an in-process composition root, deterministic boundary kit, a walking-skeleton corpus, a frozen compatibility manifest, and a hermetic runner. Its hermeticity enforcement, however, was a JavaScript monkey-patch I/O guard — a deny-by-default wrapper over global `fetch`, process/socket exports, and filesystem writes. That guard had **confirmed bypasses**: the native module loader, Bun runtime file APIs, `Bun.Glob`, symlink-race traversal, and `cp(..., { dereference: true })` all escaped the JavaScript layer, so a green run proved nothing about process-level isolation. ADR-0282 documented this as a known limitation and deferred the structural fix.

This plan closed that gap with the first OS-enforced sandbox for Tier 0 stories. Its **goal** was to execute every Tier 0 story inside a *required* OS sandbox using declared immutable source and dependency inputs, with **no weaker fallback**. The parent creates one runner-owned session containing a read-only `app/` source/harness snapshot, a verified lock-keyed `node_modules` dependency snapshot, a writable `tmp/`, and pre-created report files; the child runs from `app/`; a platform backend enforces the session contract — `sandbox-exec` on Darwin and a pinned Bun OCI image on Linux CI. A missing backend, a dependency-cache mismatch, an unsafe mount, a failed integrity check, or a sandbox setup failure exits before test discovery. The JavaScript I/O guards are explicitly demoted to scenario diagnostics; the hard-hermeticity acceptance evidence moves to process-sandbox probes that prove each known bypass class fails at the OS boundary.

The design (`docs/superpowers/specs/2026-07-13-hermetic-story-process-sandbox-design.md`) superseded the filesystem-enforcement portion of the earlier hardening-and-tiering design, declaring that JavaScript I/O guards "are not a security boundary and must not claim to enforce hermeticity on their own."

## Decision Drivers

- **Hard isolation, not monkey-patch defense.** The boundary must be enforced by the operating system (kernel namespace / Seatbelt policy), not by JavaScript wrappers the runtime can bypass natively.
- **No weaker fallback.** An unsupported host, a missing backend, a dependency-cache mismatch, or an integrity failure must fail before test discovery — never silently degrade to an unsandboxed run.
- **Immutable, attributable inputs.** Source bytes, the dependency closure, and the sandbox backend must be captured before launch, verified before spawn and after exit, and recorded in the report manifest so a run is reproducible and attributable.
- **Lock-keyed dependencies without per-run copies.** The ~609 MB dependency tree must be installed once per `package.json` + `bun.lock` + Bun version into a sealed, read-only cache entry and exposed to the child, not copied for every invocation.
- **JS guard demoted honestly.** Existing wrapper tests survive as regression/diagnostic coverage; the hard-hermeticity claim is proven only by executable process-sandbox probes, not by the guard.
- **Fail-closed on every contract violation.** Unsafe mounts, non-regular files, symlink escape, corrupt cache manifests, and version mismatches each abort with a diagnostic before the child is launched.
- **CI must prove it.** Every pull request runs the Linux sandbox lane; a scheduled/manual stress lane reuses the identical backend with no retries.

## Considered Options

### Option 1 — dual-platform OS sandbox (macOS Seatbelt + Linux Docker), required, no fallback (chosen)

Build `sandbox-exec` profile generation for Darwin and a pinned-image Docker command for Linux; a runner-owned session owns `app/`, `node_modules`, `tmp/`, and report files; the launcher selects a backend by platform and fails hard where none exists; JS guards become diagnostics.

- **Pros:** kernel-enforced isolation on both contributor hosts and CI; the known JavaScript bypass classes (native import, Bun APIs, glob, symlink race, cp-dereference) are rejected at the OS; immutable inputs make runs reproducible and attributable via the manifest; lock-keyed dependency cache removes the per-run copy.
- **Cons:** two backend codepaths to maintain; `sandbox-exec` requires hand-built Seatbelt policy including platform-runtime path allowances; Docker is a hard prerequisite on Linux CI; macOS Seatbelt must permit Bun's module resolver without leaking the session-only read boundary.

### Option 2 — keep hardening the JavaScript I/O guard

Add native API monkey patches until the bypass classes close at the JavaScript layer.

- **Pros:** no process/backend model; smallest infrastructure footprint; works in-process everywhere.
- **Cons:** the design explicitly rejected this — confirmed bypasses (native loader, Bun runtime, glob, symlink race, copy-dereference) make a complete JavaScript interception layer infeasible; "treat a JavaScript monkey patch as security isolation" is a stated non-goal. The original Task 4 of this plan's predecessor was deliberately superseded for this reason.

### Option 3 — subprocess/container black-box for every story

Launch the real executable per story in a container, treating stories as black-box integration runs.

- **Pros:** exercises the true entry point in full isolation.
- **Cons:** incompatible with the in-process deterministic harness (ADRs 0282/0003): deterministic clocks, identifiers, per-scenario reset, and rich failure traces become hard; too slow for a broad pull-request tier. Rejected as the main tier; a small provider-real smoke tier keeps that value separately.

## Decision

The chosen Option 1 landed across a verified dependency snapshot, a runner-owned session, two OS backends, runner integration, a process-boundary proof suite, and CI/stress policy. What shipped:

1. **Lock-keyed dependency snapshot** (`scripts/story/dependencies.ts`). `acquireStoryDependencySnapshot()` reads raw `package.json`, `bun.lock`, workspace manifests, and the Bun version, derives a 64-hex cache key, installs into a staging directory with `bun install --frozen-lockfile --backend=copyfile`, rejects non-regular files and symlinks escaping `node_modules`, hashes sorted POSIX paths + content into a tree fingerprint, writes `manifest.json`, and atomically renames + chmod-read-only the sealed entry.
2. **Strict optional manifest fields** (`scripts/story/manifest.ts`). `dependencySnapshot` (key/treeHash/bunVersion) and `sandboxBackend` are strict-optional on the v4 manifest; candidate capture populates both, baseline capture omits both (a baseline reads committed Git blobs and never installs), and `compareStoryManifests()` ignores either direction so compatibility qualification stays frozen-harness-only.
3. **Runner-owned session** (`scripts/story/session.ts`). `createStoryRunnerSession()` materializes captured inputs under `session/app` from bytes only, exposes the verified dependency entry, creates `session/tmp` mode `0700`, pre-creates exact report files, verifies source + dependency integrity before and after the child, copies reports only after verification, and always cleans up the outer session after all child work settles.
4. **Darwin `sandbox-exec` backend** (Task 3 — **built then retired**; see Consequences and ADR-0225). A native Seatbelt profile was generated to deny default, deny `network*`, permit platform runtime paths and the canonical Bun executable, allow reads from `appRoot`/`dependencyRoot`, and allow writes only to session temp and exact report literals. This backend was later removed because Bun 1.3.13 statically resolves scoped packages by enumerating temporary-directory ancestors under Seatbelt — unfixable without violating the session-only read boundary.
5. **Linux OCI Docker backend** (`scripts/story/sandbox.ts`). `buildLinuxStorySandboxCommand()` executes the digest-pinned image `docker.io/oven/bun:1.3.13@sha256:8741…` directly with `--read-only`, `--network none`, `--cap-drop ALL`, `--security-opt no-new-privileges`, `--pids-limit 128`, `--ipc none`, as the host UID:GID; only `app/` (read-only), the dependency `node_modules` (read-only), `tmp/` (read-write), and exact report files are mounted; the child runs `bun --no-env-file test …` with `TMPDIR=/session/tmp`, `HOME=/session/tmp`, and `PAPAI_STORY_EXECUTION_ROOT=/session/app`.
6. **Fail-closed backend selection** (`scripts/story/sandbox.ts`). `selectStorySandboxBackend()` selects the backend by platform; `assertLinuxStorySandboxBackend()` preflights `docker version` and the image's `bun --version === 1.3.13` before session creation; missing Docker or a version mismatch fails with exit 2. Unsupported platforms fail with a diagnostic.
7. **Runner routed through the sandbox** (`scripts/story/test-stories.ts`). `executeStoryTests()` creates a session, verifies integrity before spawn, attaches the sandboxed child to existing signal forwarding, verifies integrity after exit, copies reports only after verification, and always cleans the session. `--manifest-only` stays free of child/sandbox startup.
8. **JS I/O guard demoted to diagnostics** (`tests/stories/harness/io-guard*.ts`). The guard stays deny-by-default for reads/writes, names scenarios/phases/operations, and detects leaks, but its tests now describe it as diagnostics; hard hermeticity is proven by the process-sandbox boundary suite, not by the guard.
9. **Process-boundary acceptance suite** (`tests/stories/sandbox/process-boundary.test.ts`). Eight escape operations — `file-import`, `bun-stat`, `bun-glob`, `network`, `stream-race`, `cp-dereference`, `write`, and `dependency-mount-write` — run as actual sandboxed children through the real launcher; each must exit non-zero inside the sandbox while a direct unsandboxed control passes.
10. **CI and stress policy** (`.github/workflows/ci.yml`, `story-stress.yml`). The `stories` job (`ubuntu-24.04`) verifies the Linux sandbox image, proves the process boundary, runs the harness contracts, and runs the story coverage lane — each with `PAPAI_REQUIRE_STORY_SANDBOX=1`; reports upload on `always()`. A nightly/manual `story-stress` workflow runs the identical backend once with no retries.

## Consequences

### Positive

- The plan's central goal — a *required* OS sandbox with no weaker fallback — shipped: every Tier 0 story runs inside a kernel-enforced boundary (read-only mounts, no network/IPC, dropped capabilities), and the bypass classes that defeated the JavaScript guard now fail at the operating system.
- Immutable, sealed inputs (captured source + lock-keyed dependency closure + pinned image) make each run reproducible and attributable via the manifest, so worktree mutation during a run cannot change which bytes execute.
- The lock-keyed dependency cache removes the per-run ~609 MB copy while keeping the dependency closure explicit, immutable to the child, and recorded in the manifest.
- The process-boundary suite makes the isolation claim non-vacuous and regression-proof: it exercises the real launcher and the eight known escape operations, so a future regression in backend policy is caught directly.
- The JS guard demotion is honest: diagnostics and scenario-write checks survive, but no test or doc claims JavaScript enforcement as a security boundary.

### Negative

- **The macOS `sandbox-exec` backend (Task 3) was built and then retired.** Bun 1.3.13's static scoped-package resolution enumerates temporary-directory ancestors under Seatbelt, which cannot be permitted without leaking the session-only read boundary. After roughly two days the dual-platform model was abandoned in favor of Docker-on-all-hosts (ADR-0225). The shipped tree has no `story-sandbox-macos` module; the only surviving `sandbox-exec` reference is a negative test assertion.
- **Docker (Desktop) became a hard prerequisite for local Tier 0 runs** — real contributor friction, accepted deliberately. macOS contributors now run the same Linux container as CI rather than a native Seatbelt profile.
- **Scripts were reorganized into a `scripts/story/` package.** The plan named flat files (`scripts/story-dependency-snapshot.ts`, `scripts/story-runner-session.ts`, `scripts/story-sandbox*.ts`); shipped consolidates the whole runner (`dependencies*.ts`, `session.ts`, `sandbox.ts`, `manifest.ts`, `snapshot.ts`, `test-stories.ts`, …). The tests still carry the plan's flat names under `tests/scripts/`.
- **The dependency key gained a platform dimension** beyond the plan's `package.json` + `bun.lock` + Bun version: the install runs with `--os`/`--cpu` flags so a macOS host installs the Linux optional-dependency closure the container needs. This is the zero-copy dependency model finalized by ADR-0225, not the plan's symlink-to-cache design.
- The manifest advanced to version 4 (the plan anticipated an increment; the surrounding hardening took it further with split runtime-inputs and symlink-kind entries).

### Risks

- **Seatbelt path is documented as dead but not yet re-attempted.** ADR-0225 records the supersession chain explicitly so the discarded macOS/app-local paths are not re-explored; a future Bun version that changes scoped-package resolution could make a native backend viable again, but that decision belongs to a new ADR.
- **Pinned image digest is repeated** across the sandbox module and both workflows — a manual, error-prone bump (a risk ADR-0225 also notes).
- **No dependency-cache eviction policy** shipped under this plan; each lockfile/platform change adds an entry indefinitely (GC owed; ADR-0225 notes the same).
- **The process-boundary suite is Docker-gated.** `test.skipIf(docker unavailable)` means a host without Docker silently skips the boundary proof; CI requires `PAPAI_REQUIRE_STORY_SANDBOX=1` to keep the proof mandatory there.
- **Windows claims support but does not work.** `selectStorySandboxBackend` rejects `win32` with a diagnostic, but `resolveLinuxStorySandboxUser` requires POSIX uid/gid; ADR-0225 records the follow-up.

## Related Decisions

- **ADR-0282** — Hermetic E2E Master Baseline. Established the in-process harness, deterministic boundary kit, frozen manifest, and JS I/O guard whose bypasses this plan closed structurally; this ADR records the OS-enforcement layer that ADR-0282 explicitly deferred.
- **ADR-0225** — Hermetic Story Execution — Docker-Only OS Sandbox with Immutable Snapshots. **Supersedes** this plan's Task 3 (macOS Seatbelt backend, retired) and Task 4's dependency model (replaced by the zero-copy bind mount). ADR-0225 records the full supersession chain across five designs in four days; this ADR captures the phase-1 dual-platform starting point that ADR-0225 narrowed to Docker-only.
- **ADR-0050** — E2E Planning Workflow with Realism Tiers; the tier model this decision slots into as the hermetic Tier 0 enforcement layer.
- **ADR-0054** — Guardrail-First Mock Isolation for Bun Tests; the JS-guard lineage whose diagnostics role survives here (and which ADR-0225 demotes further).

## Implementation Notes

Verified present against the shipped tree via `grep`/`glob`/`read`.

| File | Role | Evidence |
| --- | --- | --- |
| `scripts/story/sandbox.ts:11` | `StorySandboxBackend = 'linux-docker'` — the macOS type is gone; only Docker survives. | `read` confirms. |
| `scripts/story/sandbox.ts:25-33` | `selectStorySandboxBackend()` returns `'linux-docker'` for all supported platforms; `win32`/unsupported throw a fail-closed diagnostic. | `read` confirms. |
| `scripts/story/sandbox.ts:179-225` | `buildLinuxStorySandboxCommand()` — `--read-only`, `--network none`, `--cap-drop ALL`, `--security-opt no-new-privileges`, `--pids-limit 128`, `--ipc none`, host UID:GID; mounts `app/`+`node_modules` read-only, `tmp/`+reports read-write. | `read` confirms. |
| `scripts/story/sandbox.ts:227-230` | `buildStorySandboxCommand()` always delegates to `buildLinuxStorySandboxCommand()` — no platform branch remains. | `read` confirms. |
| `scripts/story/sandbox.ts:247-256` | `assertLinuxStorySandboxBackend()` preflights `docker version` and the image's `bun --version === 1.3.13`. | `read` confirms. |
| `scripts/story/sandbox-image.txt:1` | `docker.io/oven/bun:1.3.13@sha256:87416c977a612a204eb54ab9f3927023c2a3c971f4f345a01da08ea6262ae30e` — matches the plan's pinned digest. | `read` confirms. |
| `scripts/story/session.ts:33-46` | `StoryRunnerSession` contract (`root`/`appRoot`/`dependencyRoot`/`tempRoot`/`manifest`/`childReporterArguments`/`verifyIntegrity`/`copyReports`/`cleanup`). | `read` confirms. |
| `scripts/story/session.ts:130-146` | `createStoryRunnerSession()` acquires the dependency snapshot, captures source, asserts the manifest records the selected backend, and materializes the session. | `read` confirms. |
| `scripts/story/session.ts:178-226` | `materializeSession()` — `app/` materialized from bytes, `tmp/` mode `0700`, reports pre-created, integrity verify composed from app + dependency + mountpoint checks. | `read` confirms. |
| `scripts/story/dependencies.ts:49` | `StoryDependencySnapshot = Readonly<{ key; root; treeHash }>`. | `read` confirms. |
| `scripts/story/dependencies.ts:248-256` | `acquireStoryDependencySnapshot()` — sealed cache acquisition + prune. | `read` confirms. |
| `scripts/story/dependencies.ts:270-272` | `storyDependencyCacheRoot()` → `~/.cache/papai-story-dependencies` (env-overridable). | `read` confirms. |
| `scripts/story/dependencies-install.ts:172` | Install args `['install','--frozen-lockfile','--backend=copyfile',`--os=…`,`--cpu=…`]` — the plan's `--backend=copyfile` plus the later `--os`/`--cpu` platform closure flags. | `read` confirms. |
| `scripts/story/manifest.ts:60-65` | `DependencySnapshotSchema` (key/treeHash/bunVersion) + `SandboxBackendSchema = z.enum(['linux-docker'])`. | `read` confirms. |
| `scripts/story/manifest.ts:67-78` | `StoryManifestSchema` `version: z.literal(4)`; `dependencySnapshot` + `sandboxBackend` strict-optional. | `read` confirms. |
| `scripts/story/manifest.ts:227-238` | `buildBaselineStoryManifest()` omits `dependencySnapshot`/`sandboxBackend` (baseline never installs). | `read` confirms. |
| `scripts/story/manifest.ts:240-265` | `compareStoryManifests()` compares `files`/`treeHash`/`scenarios` only — ignores dependency/backend evidence either direction. | `read` confirms. |
| `scripts/story/test-stories.ts:21,108,239,253,259-260` | Runner creates a session, verifies integrity before spawn (253) and after exit (259), copies reports only after verification (260), and always cleans up (108). | `read` confirms. |
| `scripts/story/test-stories.ts:20,268` | Runner asserts the Linux sandbox backend before running. | `read` confirms. |
| `tests/stories/sandbox/process-boundary.test.ts:17-26` | Eight boundary operations (`file-import`…`write` + `dependency-mount-write`, one beyond the plan's seven). | `read` confirms. |
| `tests/stories/sandbox/process-boundary.test.ts:45-46,176` | Docker-gated (`test.skipIf(docker unavailable)`); spawns through `buildStorySandboxCommand()`. | `read` confirms. |
| `tests/scripts/story-sandbox.test.ts:163` | Negative assertion `expect(command).not.toContain('sandbox-exec')` — proves the macOS backend is no longer generated. | `read` confirms. |
| `tests/scripts/story-dependency-snapshot.test.ts` | Dependency cache/fingerprint contracts (plan Task 1). | `glob` confirms. |
| `tests/scripts/story-runner-session.test.ts` | Session layout/integrity/report-mapping contracts (plan Task 2). | `glob` confirms. |
| `tests/stories/harness/io-guard.test.ts:47` | JS guard described as diagnostics; "process isolation is covered by the sandbox boundary suite." | `read` confirms. |
| `.github/workflows/ci.yml:105-146` | `stories` job (`ubuntu-24.04`): sandbox image verify → process-boundary proof → contracts → coverage, each with `PAPAI_REQUIRE_STORY_SANDBOX=1`; reports on `always()`. | `read` confirms. |
| `.github/workflows/story-stress.yml:55,61` | Nightly/manual stress lane, identical backend, no retries, uploads `reports/stories/**`. | `grep` confirms. |

Plan-vs-implementation notes:

- **The macOS `sandbox-exec` backend (Task 3) was built and then retired.** The plan generated a Seatbelt profile permitting platform runtime paths and the Bun executable while denying network and undeclared reads/writes. It was removed because Bun 1.3.13 statically resolves scoped packages by enumerating temporary-directory ancestors under Seatbelt, which cannot be permitted without leaking the session-only read boundary. ADR-0225 records the retirement and the move to Docker-on-all-hosts; the shipped tree has no `story-sandbox-macos` module, and `tests/scripts/story-sandbox.test.ts:163` carries a negative assertion that the command never contains `sandbox-exec`.
- **Scripts were reorganized into a `scripts/story/` package.** The plan named flat files (`scripts/story-dependency-snapshot.ts`, `scripts/story-runner-session.ts`, `scripts/story-sandbox.ts`, `scripts/story-sandbox-macos.ts`, `scripts/story-sandbox-linux.ts`, `scripts/story-runner-session.ts`). Shipped consolidates the entire runner into `scripts/story/` (`dependencies.ts`/`dependencies-install.ts`/`dependencies-cache.ts`/`dependencies-tree.ts`, `session.ts`, `sandbox.ts`, `manifest.ts`, `snapshot.ts`, `test-stories.ts`, `child.ts`, `reports.ts`, …). Intent (sealed dependency cache, session ownership, backend selection, fail-closed policy) is preserved; the macOS/Linux backends collapsed into a single Docker codepath in `sandbox.ts`.
- **The dependency model gained a platform dimension.** The plan keyed the cache on `package.json` + `bun.lock` + Bun version and exposed it via a session symlink. Shipped also keys on the target platform (`dependencies.ts:217`) and installs with `--os`/`--cpu` so a macOS host builds the Linux optional-dependency closure the container needs (`dependencies-install.ts:172`); the verified entry is exposed to the child as a read-only bind mount at `/session/app/node_modules` rather than a symlink. This is the zero-copy model finalized by ADR-0225.
- **The manifest advanced to version 4.** The plan anticipated incrementing the manifest version to carry the dependency fields; shipped is at `version: 4` with separate tree hashes for the harness, runtime inputs (file + symlink kinds), and the dependency closure, plus the `sandboxBackend` enum. ADR-0225 records this as concurrent hardening.
- **The process-boundary suite added an eighth operation.** The plan's Task 6 listed seven probes (`file-import`, `bun-stat`, `bun-glob`, `network`, `stream-race`, `cp-dereference`, `write`); shipped adds `dependency-mount-write` to prove the read-only dependency mount rejects child writes (`tests/stories/sandbox/process-boundary.test.ts:103-105`).
- **Task 6's checkboxes are unchecked in the plan file, but the work shipped.** The plan's Task 6 steps remain `- [ ]`, yet the process-boundary suite, the CI `stories` job, the nightly stress workflow, and the commands-doc update are all present and verified above. ADR-0225 independently confirms the suite runs green (30 pass / 0 fail, sandboxed).
- **The runner scripts and tests moved independently.** Implementation moved into `scripts/story/`, but the focused tests retain the plan's flat names under `tests/scripts/` (`story-sandbox.test.ts`, `story-dependency-snapshot.test.ts`, `story-runner-session.test.ts`, plus a newer `story-sandbox-image.test.ts`).

The source plan `docs/superpowers/plans/2026-07-13-hermetic-story-process-sandbox-phase-1.md` and design `docs/superpowers/specs/2026-07-13-hermetic-story-process-sandbox-design.md` are archived alongside this ADR to `docs/archive/`.
