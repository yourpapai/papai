<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Hermetic Story Hardening Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every Tier 0 story execute against immutable candidate runtime inputs and fail closed on undeclared filesystem reads as well as writes.

**Architecture:** Capture two independent input trees before the child starts: the existing frozen harness tree and a runtime tree containing the candidate `src/`, `plugins/`, package metadata, lockfile, and any present `public/` assets. Materialize both as read-only regular files in one snapshot and run the child from that snapshot. The in-child I/O guard receives the snapshot root and scenario temp root as its only application-readable roots; ordinary Bun dependency loading remains outside JavaScript filesystem wrappers.

**Tech Stack:** Bun, Bun test, TypeScript, Zod v4, Node filesystem APIs, GitHub Actions.

---

## File structure

- Modify: `scripts/story-manifest-candidate.ts` — capture regular files from declared runtime roots as well as frozen harness inputs.
- Modify: `scripts/story-manifest.ts` — represent runtime-input hashes separately from the compatibility-protected harness tree.
- Modify: `scripts/story-runner-snapshot.ts` — materialize runtime files instead of live `src`/`plugins` symlinks and verify both input groups.
- Modify: `scripts/test-stories.ts` — launch snapshot-backed stories with snapshot cwd and pass the execution-root marker.
- Modify: `scripts/story-runner-environment.ts` — carry only the execution-root marker needed by the preload.
- Modify: `tests/stories/preload.ts` — install the guard before scenario test support loads and validate the execution-root marker.
- Modify: `tests/stories/harness/io-guard.ts` and `tests/stories/harness/io-guard-filesystem.ts` — model readable roots and guard all supported read surfaces.
- Modify: `tests/stories/harness/io-guard-probe.ts` and `tests/stories/harness/io-guard.test.ts` — prove allowed snapshot reads and rejected host reads.
- Modify: `tests/scripts/story-manifest.test.ts`, `tests/scripts/story-runner-snapshot.test.ts`, and `tests/scripts/test-stories.test.ts` — characterize manifest, snapshot, and launcher behavior.
- Modify: `.github/workflows/ci.yml`; create `.github/workflows/story-stress.yml` — run Tier 0.1/Tier 0 on PRs and the no-retry stress lane on schedule/manual dispatch.

### Task 1: Define and characterize runtime input capture

**Files:**

- Modify: `scripts/story-manifest-candidate.ts`
- Modify: `scripts/story-manifest.ts`
- Test: `tests/scripts/story-manifest.test.ts`

- [ ] **Step 1: Write failing manifest tests for runtime inputs.** Add fixture files `src/runtime.ts`, `plugins/example/plugin.json`, `package.json`, `bun.lock`, and `public/settings.js`. Assert the candidate manifest has a `runtimeInputs` object with sorted POSIX paths and SHA-256 hashes; assert a changed runtime file changes only `runtimeInputs.treeHash`, not the frozen harness `treeHash`.

```typescript
expect(manifest.runtimeInputs.files.map(({ path }) => path)).toEqual([
  'bun.lock',
  'package.json',
  'plugins/example/plugin.json',
  'public/settings.js',
  'src/runtime.ts',
])
expect(manifest.runtimeInputs.treeHash).not.toBe(rebuilt.runtimeInputs.treeHash)
expect(manifest.treeHash).toBe(rebuilt.treeHash)
```

- [ ] **Step 2: Run the focused test and verify it fails because `runtimeInputs` is absent.**

Run: `bun test tests/scripts/story-manifest.test.ts --test-name-pattern 'runtime inputs'`

Expected: FAIL with a missing `runtimeInputs` property or matcher mismatch.

- [ ] **Step 3: Add a reusable regular-file capture path.** In `story-manifest-candidate.ts`, add an exported runtime-root selector for `src`, `plugins`, `package.json`, `bun.lock`, and optional `public`. It must reject missing required roots, symlinks, and special files; preserve the existing `O_NOFOLLOW`, directory-identity, raw-byte, and POSIX-sort guarantees. Return `LoadedStoryFile[]` so the snapshot can reuse exactly the captured bytes.

```typescript
export type CapturedRuntimeInputs = Readonly<{
  manifest: RuntimeInputManifest
  files: readonly LoadedStoryFile[]
}>

export async function captureCandidateRuntimeInputs(root: string): Promise<CapturedRuntimeInputs>
```

- [ ] **Step 4: Extend the story manifest without changing compatibility semantics.** Add strict Zod schemas for `runtimeInputs.files` and `runtimeInputs.treeHash`; include them in `StoryManifestSchema` and `captureCandidateStoryInputs`. Keep `compareStoryManifests` comparing only frozen harness files, harness tree hash, and scenario metadata.

```typescript
runtimeInputs: RuntimeInputManifestSchema

// Deliberately omit runtimeInputs from compareStoryManifests: candidate production
// code is expected to differ during a qualified refactor.
```

- [ ] **Step 5: Rerun the focused test and manifest contracts.**

Run: `bun test tests/scripts/story-manifest.test.ts`

Expected: PASS; existing baseline compatibility tests still show that runtime code changes do not invalidate the frozen-harness proof.

- [ ] **Step 6: Commit the manifest capture change.**

```bash
git add scripts/story-manifest-candidate.ts scripts/story-manifest.ts tests/scripts/story-manifest.test.ts
git commit -m "test(stories): record immutable runtime inputs"
```

### Task 2: Materialize and verify the complete execution snapshot

**Files:**

- Modify: `scripts/story-runner-snapshot.ts`
- Test: `tests/scripts/story-runner-snapshot.test.ts`

- [ ] **Step 1: Replace the live-source characterization test.** Rename `freezes captured harness bytes while production source remains live` to a test that mutates the candidate story and `src/live.ts` after snapshot creation. Assert snapshot reads retain `production v1` and that `verifyIntegrity()` rejects tampering with either the story or runtime copy.

```typescript
expect(readFileSync(path.join(snapshot.root, 'src/live.ts'), 'utf8')).toBe('production v1')
await expect(snapshot.verifyIntegrity()).resolves.toBeUndefined()
```

- [ ] **Step 2: Run the snapshot test and verify it fails against the current live bridge.**

Run: `bun test tests/scripts/story-runner-snapshot.test.ts --test-name-pattern 'immutable candidate runtime'`

Expected: FAIL because `snapshot.root/src/live.ts` currently resolves to the mutated candidate file.

- [ ] **Step 3: Materialize captured runtime files as regular read-only files.** Remove `addLiveBridge`. Pass both `captured.files` and `captured.runtimeInputs.files` through `writeCapturedFile`, reject duplicate paths before materialization, and include both manifests in `verifyIntegrity`. Harden `src`, `plugins`, and `public` directories using the existing recursive permission routine.

```typescript
const snapshotFiles = [...captured.files, ...captured.runtimeInputs.files]
await settleStarted(
  snapshotFiles.map((file) => writeFile(snapshotRoot, file)),
  'Story snapshot materialization failed',
)
```

- [ ] **Step 4: Extend failure-cleanup tests.** Make injected write/chmod failures target one runtime path and one harness path. Verify cleanup removes the snapshot only after all concurrent work has settled, preserving the existing signal and cleanup guarantees.

- [ ] **Step 5: Rerun snapshot contracts.**

Run: `bun test tests/scripts/story-runner-snapshot.test.ts`

Expected: PASS; no snapshot test references a live-source bridge.

- [ ] **Step 6: Commit the immutable snapshot change.**

```bash
git add scripts/story-runner-snapshot.ts tests/scripts/story-runner-snapshot.test.ts
git commit -m "test(stories): snapshot candidate runtime inputs"
```

### Task 3: Execute stories from the snapshot

**Files:**

- Modify: `scripts/test-stories.ts`
- Modify: `scripts/story-runner-environment.ts`
- Modify: `tests/stories/preload.ts`
- Test: `tests/scripts/test-stories.test.ts`
- Test: `tests/stories/harness/io-guard.test.ts`

- [ ] **Step 1: Add a failing launcher assertion for snapshot cwd and marker.** Extend the injected `spawn` dependency to capture options. In snapshot mode, assert `cwd === snapshot.root` and `env.PAPAI_STORY_EXECUTION_ROOT === snapshot.root`; in contract mode, keep cwd at the repository root and omit the scenario marker.

```typescript
expect(options.cwd).toBe(snapshotRoot)
expect(options.env?.PAPAI_STORY_EXECUTION_ROOT).toBe(snapshotRoot)
```

- [ ] **Step 2: Run the focused launcher test and verify it fails.**

Run: `bun test tests/scripts/test-stories.test.ts --test-name-pattern 'snapshot cwd'`

Expected: FAIL because the current child cwd is `dependencies.cwd` and no execution-root marker exists.

- [ ] **Step 3: Make snapshot mode self-contained.** In `spawnStoryChild`, use `snapshot.root` as cwd and pass an absolute `PAPAI_STORY_EXECUTION_ROOT` only for story mode. Keep parent report creation in the candidate worktree. Preserve absolute preload/test paths so Bun never falls back to live harness files.

```typescript
cwd: snapshot?.root ?? dependencies.cwd,
env: sanitizedStoryEnvironment(dependencies.env, snapshot?.root),
```

- [ ] **Step 4: Install the scenario guard first.** Reorder snapshot-mode preloads so `tests/stories/preload.ts` precedes `tests/setup.ts` and `tests/mock-reset.ts`; have the preload reject a missing, non-absolute, or non-directory execution-root marker.

- [ ] **Step 5: Rerun launcher and direct-preload contracts.**

Run: `bun test tests/scripts/test-stories.test.ts tests/stories/harness/io-guard.test.ts`

Expected: PASS; direct preload still rejects callers without the runner markers.

- [ ] **Step 6: Commit snapshot execution wiring.**

```bash
git add scripts/test-stories.ts scripts/story-runner-environment.ts tests/stories/preload.ts tests/scripts/test-stories.test.ts tests/stories/harness/io-guard.test.ts
git commit -m "test(stories): execute scenarios from frozen snapshot"
```

### Task 4: Add deny-by-default filesystem read contracts

**Files:**

- Modify: `tests/stories/harness/io-guard-probe.ts`
- Modify: `tests/stories/harness/io-guard.test.ts`
- Modify: `tests/stories/harness/io-guard-filesystem.ts`
- Modify: `tests/stories/harness/io-guard.ts`

- [ ] **Step 1: Replace the current outside-root-read allowance with failing probes.** Remove `allows Bun.file outside-root reads`. Add probes for `readFileSync`, callback `readFile`, `fs/promises.readFile`, `createReadStream`, `readdirSync`, `openSync(..., 'r')`, and `Bun.file(...).text()` targeting `${world.tempRoot}/../host.txt`. Add allowed probes that read a file in `world.tempRoot` and a fixture copied below `PAPAI_STORY_EXECUTION_ROOT`.

```typescript
scenario('rejects fs promises read outside roots', async ({ world }) => {
  phase(world)
  await readFile(`${world.tempRoot}/../host.txt`, 'utf8')
})
```

- [ ] **Step 2: Run the read probes and verify they fail for the intended reason.**

Run: `bun test tests/stories/harness/io-guard.test.ts --test-name-pattern 'read'`

Expected: the new rejection probes incorrectly exit 0 before implementation; the removed outside-root allowance is no longer present.

- [ ] **Step 3: Model read roots explicitly.** Extend `FilesystemBoundary` with canonical `readRoots`. Add `assertGuardedReadPath` that resolves symlinks through the nearest existing ancestor and accepts only a path inside an allowlisted root. `runWithScenarioIoGuard` supplies the real execution snapshot and scenario temp root. A write must still be inside the temp root even when it is readable from the snapshot.

```typescript
type FilesystemBoundary = Readonly<{
  tempRoot: string
  readRoots: readonly string[]
  allowCleanup: boolean
  writableFileDescriptors: Set<number>
}>
```

- [ ] **Step 4: Guard every supported JavaScript filesystem read surface.** Add read wrappers for sync/callback/promise `readFile`, `readdir`, `opendir`, `stat`, `lstat`, `realpath`, `access`, `createReadStream`, and `open` when the flags are read-only. Update `guardedBunFile` to validate creation of a `Bun.file` handle before exposing `text`, `json`, `arrayBuffer`, `bytes`, `stream`, or `exists`.

- [ ] **Step 5: Add symlink and read-handle regression tests.** Assert a symlink inside the temp root that points outside is rejected, a file handle opened from an allowed root remains readable, and an allowed source fixture cannot be opened write-capable.

- [ ] **Step 6: Run all I/O contracts.**

Run: `bun test tests/stories/harness/io-guard.test.ts`

Expected: PASS; every rejected operation includes the scenario name, phase, and operation string.

- [ ] **Step 7: Commit the read boundary.**

```bash
git add tests/stories/harness/io-guard.ts tests/stories/harness/io-guard-filesystem.ts tests/stories/harness/io-guard-probe.ts tests/stories/harness/io-guard.test.ts
git commit -m "test(stories): deny undeclared filesystem reads"
```

### Task 5: Enforce Tier 0.1 and add the scheduled stress lane

**Files:**

- Modify: `.github/workflows/ci.yml`
- Create: `.github/workflows/story-stress.yml`
- Modify: `docs/architecture/commands.md`

- [ ] **Step 1: Add a workflow contract check.** In the existing `stories` job, name the contract command `Tier 0.1` and retain it before `bun test:stories`. Verify manually that the step order is contracts, stories, artifact upload.

- [ ] **Step 2: Add the scheduled stress workflow.** Create `story-stress.yml` with `workflow_dispatch` and a daily UTC `schedule`. Use the same pinned checkout and Bun actions as the PR job, install with `--frozen-lockfile`, download `build-output`, run `bun test:stories:stress` once, and upload `reports/stories/**` with `if: always()`.

```yaml
on:
  workflow_dispatch:
  schedule:
    - cron: '17 3 * * *'
```

- [ ] **Step 3: Document execution policy.** Update `commands.md` to state that Tier 0.1 and Tier 0 run for every PR, stress is scheduled/manual with no retries, and 0Q requires an explicit baseline only for qualification refactors.

- [ ] **Step 4: Validate workflow and documentation changes.**

Run: `bun run format:check && bun run typecheck && bun test:stories:contracts && bun test:stories`

Expected: PASS. Inspect the workflow YAML for the daily schedule, one stress invocation, and `if: always()` artifact upload.

- [ ] **Step 5: Commit CI policy.**

```bash
git add .github/workflows/ci.yml .github/workflows/story-stress.yml docs/architecture/commands.md
git commit -m "ci(stories): schedule hermetic stress qualification"
```

### Task 6: Run phase-level verification and record the evidence

**Files:**

- Modify: `docs/architecture/commands.md`

- [ ] **Step 1: Run the complete Tier 0.1 and Tier 0 suite from a clean worktree.**

Run: `bun test:stories:contracts && bun test:stories && bun test:stories:stress && bun run typecheck`

Expected: all commands exit 0; the stress run reports 10 executions of each story with no retries.

- [ ] **Step 2: Inspect published evidence.**

Run: `jq '{commit, treeHash, runtimeInputs: .runtimeInputs.treeHash, scenarios: (.scenarios | length)}' reports/stories/manifest.json`

Expected: non-empty harness and runtime tree hashes plus the current scenario count.

- [ ] **Step 3: Update command documentation with the verified artifact shape.** State that `manifest.json` contains separate frozen-harness and runtime-input hashes, and that compatibility comparisons intentionally use only the former.

- [ ] **Step 4: Commit the verification documentation.**

```bash
git add docs/architecture/commands.md
git commit -m "docs(testing): record hermetic story evidence"
```

## Plan self-review

- The plan implements the approved hybrid snapshot and hard read/write boundary before adding new coverage.
- Runtime hashes are recorded but deliberately excluded from refactor compatibility comparisons; this keeps candidate production changes valid while preventing mutable code during a single run.
- Ledger and task/context coverage are intentionally separate follow-up plans: their branch audit and behavior matrix must not be guessed while changing the security boundary.
