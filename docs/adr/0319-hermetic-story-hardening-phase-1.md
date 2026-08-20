<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0319: Hermetic Story Hardening Phase 1 — Immutable Runtime Inputs and Deny-by-Default Reads

## Status

Accepted

## Date

2026-07-13

## Context

ADR-0282 established the hermetic Tier 0 story harness with a frozen harness tree captured into a compatibility manifest, but the snapshot only froze the *harness* inputs: the child executed against the candidate worktree's live `src/` and `plugins/` via symlinks, and the in-child JavaScript I/O guard enforced writes while leaving reads outside the scenario temp root allowed (`Bun.file` outside-root reads were explicitly permitted).

That produced two concrete weaknesses. First, mutating production source mid-run changed which bytes executed — a green run proved nothing about a specific code revision, and the run was neither reproducible nor attributable. Second, fail-closed-on-writes but allow-on-reads meant a scenario could silently read arbitrary host files (credentials, the repository, other worktrees) with no diagnostic.

This plan (`docs/superpowers/plans/2026-07-13-hermetic-story-hardening-phase-1.md`) closed both gaps: capture the candidate runtime inputs into the manifest, materialize them as immutable regular files in the execution snapshot, run the child from the snapshot, and deny undeclared filesystem reads.

## Decision Drivers

- **Immutable, attributable runtime inputs.** Candidate `src/`, `plugins/`, package metadata, the lockfile, and any `public/` assets must be captured as raw bytes before the child starts and recorded with SHA-256 hashes, so a run executes exactly one code revision.
- **Frozen-harness compatibility must survive candidate refactors.** Runtime-input hashes are recorded for evidence but deliberately excluded from `compareStoryManifests` — a qualified refactor changes production code and must not invalidate the frozen-harness proof.
- **Fail closed on undeclared reads as well as writes.** The in-child guard must reject reads outside an explicit allowlist (execution snapshot root + scenario temp root) on every supported surface — sync/callback/promise `readFile`, `readdir`, `opendir`, `stat`/`lstat`, `realpath`, `access`, `createReadStream`, read-only `open`, and `Bun.file` content methods — and resolve symlinks through the nearest existing ancestor.
- **Snapshot-only execution.** The child runs with `cwd` at the snapshot root and an absolute `PAPAI_STORY_EXECUTION_ROOT` marker; the preload installs the guard before any scenario support loads and rejects a missing, non-absolute, or non-directory marker.
- **CI must enforce it.** Tier 0.1 contracts run before Tier 0 on every pull request; a scheduled/manual stress lane re-runs stories ten times with no retries, and `0Q` qualification baselines apply only to explicit refactors.

## Considered Options

### Option 1 — hybrid snapshot + hardened read/write boundary (chosen)

Capture two independent input trees (frozen harness + runtime inputs), materialize both as read-only regular files in one snapshot, run the child from that snapshot, and extend the JavaScript guard with canonical `readRoots` covering all read surfaces.

- **Pros:** mid-run worktree mutation cannot change executed bytes; runtime hashes make runs attributable without breaking refactor compatibility; reads fail closed with scenario/phase/operation diagnostics; no new runtime dependencies.
- **Cons:** the boundary is still a JavaScript monkey-patch — the native module loader and Bun runtime APIs remain bypass classes, so this hardens but does not prove process-level isolation (addressed structurally by ADR-0283/ADR-0225).

### Option 2 — record runtime hashes but keep live-source symlinks

Extend the manifest with `runtimeInputs` but continue bridging `src`/`plugins` into the snapshot as symlinks to the live worktree.

- **Pros:** smaller snapshot materialization; no duplicate-path handling.
- **Cons:** rejected — the manifest would attest to bytes the child does not actually execute once the worktree changes, making the evidence meaningless.

### Option 3 — full container/VM isolation per story

Treat each story as a black-box process in a container for this phase.

- **Pros:** kernel-enforced isolation for both reads and writes.
- **Cons:** rejected for this phase as incompatible with the in-process deterministic harness (clocks, identifiers, per-scenario reset, rich failure traces) and too slow for a per-PR tier; pursued separately as the process-sandbox line of work.

## Decision

Adopt Option 1. What shipped:

1. **Runtime-input capture in the manifest** (`scripts/story/manifest.ts`). Strict Zod `RuntimeInputManifestSchema` records sorted POSIX paths with SHA-256 hashes and a `runtimeInputs.treeHash` alongside the frozen harness `treeHash`; `compareStoryManifests` intentionally compares only frozen-harness files, harness tree hash, and scenario metadata.
2. **Snapshot materialization of both input groups** (`scripts/story/snapshot.ts`, `snapshot-integrity.ts`). Live-source bridges were removed; captured harness and runtime files are written as read-only regular files, duplicate paths are rejected before materialization, `verifyIntegrity()` covers both manifests, and `src`/`plugins`/`public` directories are hardened recursively.
3. **Snapshot-backed execution** (`scripts/story/test-stories.ts`, `tests/stories/preload.ts`). Snapshot mode spawns the child with `cwd === snapshot.root` and an absolute `PAPAI_STORY_EXECUTION_ROOT`; the preload installs the guard before other setup and rejects a missing, non-absolute, or non-directory marker; contract mode keeps the repository-root cwd with no marker.
4. **Deny-by-default read boundary** (`tests/stories/harness/io-guard*.ts`). `FilesystemBoundary` gained canonical `readRoots`; `assertGuardedReadPath` resolves symlinks through the nearest existing ancestor and accepts only paths inside allowlisted roots; guards wrap every supported read surface including read-only `open` and all `Bun.file` content methods; writes must remain inside the temp root even for paths readable from the snapshot.
5. **CI policy** (`.github/workflows/ci.yml`, `story-stress.yml`). Tier 0.1 contracts run before Tier 0 on every PR; `story-stress.yml` runs `bun test:stories:stress` (ten randomized repetitions, no retries) on a daily UTC schedule and manual dispatch, uploading `reports/stories/**` with `if: always()`; `docs/architecture/commands.md` documents the policy and the dual-hash `manifest.json` evidence shape.

## Consequences

### Positive

- Every Tier 0 story executes against immutable candidate runtime inputs; mutating the worktree mid-run cannot change which bytes execute, and tampering with either input group fails `verifyIntegrity()`.
- Undeclared host filesystem reads now fail closed with the scenario name, phase, and operation in every rejection — the previous outside-root read allowance is gone.
- Runtime-input hashes are published in `reports/stories/manifest.json` while compatibility comparisons stay frozen-harness-only, so qualified refactors remain valid.
- Tier 0.1/Tier 0 enforcement on every PR plus the no-retry stress lane make regressions in the boundary visible on a schedule.

### Negative

- Snapshot materialization now copies the runtime tree per run and must reject duplicate paths and harden directories, adding launcher complexity and setup latency.
- The read boundary is a JavaScript-layer control: native loading and Bun runtime APIs can still bypass it, so it is diagnostic hardening rather than OS-enforced isolation — the structural fix was delivered separately by the process-sandbox work (ADR-0283, ADR-0225), which later demoted these guards to diagnostics.
- Ledger and task/context coverage were deliberately deferred to follow-up plans, leaving the corpus breadth unchanged by this phase.

## Related Decisions

- ADR-0282: Hermetic E2E master baseline — established the frozen harness tree and compatibility manifest this decision extends.
- ADR-0283: Hermetic Story Process Sandbox Phase 1 — superseded the enforcement role of the JavaScript I/O guard with an OS-level sandbox.
- ADR-0225: Hermetic story execution Docker sandbox — the pinned Linux backend used by the stress lane.

## References

- Plan: `docs/superpowers/plans/2026-07-13-hermetic-story-hardening-phase-1.md`
- Evidence shape: `docs/architecture/commands.md` (Tier 0.1 / Tier 0 / stress policy)
