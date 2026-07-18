<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0225: Hermetic Story Execution — Docker-Only OS Sandbox with Immutable Snapshots

## Status

Implemented

## Date

2026-07-17

## Context

The Tier 0 story suite (`tests/stories/`) exists to prove end-to-end behavior through
the real production composition (runtime, DB migrations, bot pipeline, LLM tool loop,
plugins, settings HTTP) and to qualify architectural refactors via a frozen-harness
compatibility check. By mid-2026 that purpose was undermined by four execution-integrity
defects:

1. **Non-reproducible bytes.** Only the harness was snapshotted; the candidate runtime
   (`src/`, `plugins/`, package metadata) was read live from the worktree, so worktree
   mutation during a run changed which bytes executed.
2. **A guard that was not a boundary.** The JavaScript monkey-patch I/O guard had
   confirmed native-loader, Bun-runtime, glob, symlink-race, and copy-dereference
   bypasses (`docs/superpowers/plans/2026-07-13-hermetic-story-process-sandbox-phase-1.md`).
3. **Seatbelt dead end.** A native macOS `sandbox-exec` backend was built, but Bun
   1.3.13 statically resolves scoped packages by enumerating temporary-directory
   ancestors under Seatbelt even with app-local `node_modules` — unfixable without
   violating the session-only read boundary.
4. **A 60-second setup for a 2.5-second suite.** The app-local dependency workaround
   copied ~609 MB and ran six full-tree SHA-256 passes per invocation.

The branch iterated through five designs in four days; this ADR freezes the final state
and records the supersession chain so the discarded paths (Seatbelt backend, app-local
copy) are not re-attempted.

## Decision

**Tier 0 stories execute from an immutable, manifest-hashed snapshot inside a mandatory,
digest-pinned, networkless Docker container on every supported host.**

1. **Immutable session snapshot.** Every run captures the frozen harness inputs and the
   runtime inputs (`src/`, `plugins/`, `public/`, `package.json`, `bun.lock`) into a
   sealed per-run session (`scripts/story/snapshot.ts`, `session.ts`). Manifest v4
   records commit, Bun version, seed, harness tree hash, runtime-inputs tree hash,
   dependency key + tree fingerprint, and sandbox backend separately
   (`scripts/story/manifest.ts`); integrity is verified before and after the child.
2. **Docker-only OS sandbox.** `selectStorySandboxBackend()` always selects
   `linux-docker`; `assertLinuxStorySandboxBackend()` preflights `docker version` and
   the pinned image (`oven/bun:1.3.13@sha256:8741…`) before session creation
   (`scripts/story/sandbox.ts`). Missing Docker or a version mismatch fails closed with
   exit 2 — there is no native or JS-guard fallback. The container runs with a read-only
   root filesystem, `--network none`, `--cap-drop ALL`, `no-new-privileges`,
   `--pids-limit 128`, `--ipc none`, as the host UID:GID; only the session `tmp/` and
   exact pre-created report files are writable.
3. **Zero-copy, platform-pure dependency cache.** A sealed, lock-keyed cache lives
   outside the checkout (`~/.cache/papai-story-dependencies`), populated with
   `bun install --frozen-lockfile --os=<image os> --cpu=<image arch>` so a macOS host
   installs the Linux optional-dependency closure (`scripts/story/dependencies*.ts`).
   The verified entry is exposed to the child as a **read-only bind mount** at
   `/session/app/node_modules`; cache-hit verification checks structure and seal only —
   the trusted parent re-hashing its own user-owned cache is outside the threat model
   (the child is the untrusted party).
4. **JS I/O guard demoted to diagnostics.** It stays deny-by-default for reads and
   writes, names scenarios/phases/operations, and detects leaks, but hard hermeticity is
   proven by `tests/stories/sandbox/process-boundary.test.ts`: eight escape operations
   (file import, native stat, glob, network, stream race, cp-dereference, write,
   dependency-mount write) must fail inside the sandbox while a direct unsandboxed
   control passes.
5. **CI and qualification policy.** Every pull request runs sandbox preflight →
   process-boundary proof → contracts → stories with `PAPAI_REQUIRE_STORY_SANDBOX=1`
   (`.github/workflows/ci.yml`); a nightly stress lane (`story-stress.yml`) runs
   `--rerun-each 10 --randomize` with no retries as evidence only.
   `bun test:stories:compat` compares frozen harness bytes against a git ref and remains
   the refactor-qualification gate; baseline comparison deliberately ignores dependency
   and backend evidence.

**Non-goals** (unchanged): replacing provider-real, platform-integrated, or operational
tiers; treating a JavaScript monkey patch as security isolation; running a weaker test
mode on an unsupported host; expanding story coverage (delivery phases 2–5 of the
hardening design remain open work).

### Supersession chain

| Design (docs/superpowers/specs/)                                 | Fate                                                                                    |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 2026-07-13 hermetic hardening and tiering                        | Snapshot/manifest portion kept; filesystem-enforcement portion superseded by OS sandbox |
| 2026-07-13 process sandbox (Seatbelt on macOS + Docker on Linux) | Seatbelt backend retired after two days by the Docker-only decision                     |
| 2026-07-14 app-local dependencies                                | Superseded by zero-copy bind mount once Seatbelt was gone                               |
| 2026-07-14 Docker on all hosts                                   | Adopted; backend selection and preflight as specified                                   |
| 2026-07-17 zero-copy dependencies                                | Adopted; final dependency-exposure model                                                |

## Consequences

### Positive

- Every run executes exactly the declared bytes: snapshot, sealed dependencies, and
  pinned image make runs reproducible and attributable via the manifest.
- The isolation boundary is kernel-enforced (read-only mounts, no network/IPC, dropped
  capabilities) and proven non-vacuous by the boundary suite — the bypass classes that
  defeated the JS guard now fail at the OS.
- Identical Bun 1.3.13 runtime on every host gives CI/dev parity; cache-hit runs add
  ~zero dependency setup (the measured 60 s copy is gone).
- `--compat` plus the nightly no-retry stress lane give refactor qualification and
  flakiness evidence, which is the foundation the suite's coverage expansion (phases
  2–5) can build on.

### Negative / Risks

- **Docker (Desktop) is a hard prerequisite for every local `bun test:stories` run** —
  real contributor friction, accepted deliberately; there is no lighter local mode.
- **Windows is documented as supported via Docker Desktop but currently is not:**
  `resolveLinuxStorySandboxUser` requires `process.getuid/getgid` and is called
  unconditionally (`scripts/story/sandbox.ts`), so Windows hosts fail despite
  `selectStorySandboxBackend` accepting `win32`. Follow-up required (or doc correction).
- **No dependency-cache eviction**: each lockfile/platform change adds a ~1.2 GB entry
  indefinitely; a GC policy is owed.
- The pinned image digest is repeated in `sandbox.ts` and both workflows — a manual,
  error-prone bump.
- Defense-in-depth partially duplicates container guarantees (per-run double hashing of
  the read-only app tree detects only host-side mutation); accepted as a cost, noted by
  the zero-copy design itself.
- Execution integrity is now strong, but the suite proves only the covered behavior
  slice (19 of 126 catalog scenarios executable); this ADR does not claim feature
  completeness.

## Related Decisions

- ADR-0003: E2E Test Harness with Docker Compose (Tier 1 provider-real lane; unaffected).
- ADR-0050: E2E Planning Workflow with Realism Tiers (tier model this decision slots into as Tier 0/0.1/0Q).
- ADR-0054: Guardrail-First Mock Isolation for Bun Tests (JS-guard lineage; its guardrail role survives here as diagnostics).

## References

- Specs: `docs/superpowers/specs/2026-07-13-hermetic-story-hardening-and-tiering-design.md`,
  `2026-07-13-hermetic-story-process-sandbox-design.md`,
  `2026-07-14-hermetic-story-app-local-dependencies-design.md`,
  `2026-07-14-hermetic-story-docker-all-hosts-design.md`,
  `2026-07-17-hermetic-story-zero-copy-dependencies-design.md`
- Plans: `docs/superpowers/plans/2026-07-13-hermetic-story-hardening-phase-1.md`,
  `2026-07-13-hermetic-story-process-sandbox-phase-1.md`,
  `2026-07-14-hermetic-story-app-local-dependencies.md`,
  `2026-07-14-hermetic-story-docker-all-hosts.md`
- Branch: `codex/hermetic-e2e-harness`; verified green (`bun test:stories`: 30 pass / 0 fail, sandboxed).
