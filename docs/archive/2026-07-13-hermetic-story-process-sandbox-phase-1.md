<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Process-Isolated Hermetic Stories — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute every Tier 0 story inside a required OS sandbox using declared immutable source and dependency inputs, with no weaker fallback.

**Architecture:** The parent creates a session containing a read-only `app/` snapshot, a verified lock-keyed `node_modules` snapshot, a writable `tmp/`, and pre-created report files. The child runs from `app/`; a platform backend enforces the session contract (`sandbox-exec` on Darwin and a pinned Bun OCI image on Linux CI). JavaScript I/O guards remain scenario diagnostics, while process-sandbox probes are the hard-hermeticity acceptance evidence.

**Tech Stack:** Bun 1.3.13, TypeScript, Zod v4, Node filesystem APIs, `sandbox-exec`, Docker, GitHub Actions.

---

## Approved design

Implement [the approved process-sandbox design](../specs/2026-07-13-hermetic-story-process-sandbox-design.md). There is no unsupported-platform or JavaScript-only execution mode. A missing backend, a dependency-cache mismatch, an unsafe mount, a failed integrity check, or sandbox setup failure exits before test discovery.

The Linux backend uses the pinned manifest-list image:

```text
docker.io/oven/bun:1.3.13@sha256:87416c977a612a204eb54ab9f3927023c2a3c971f4f345a01da08ea6262ae30e
```

The implementation must verify that image's `bun --version` is exactly `1.3.13` before it is accepted as a backend runtime.

## Branch reconciliation

Comparison base: `cde8a7649c120f1237e77f37cec5eefc02adbf9a` (`docs(testing): design hermetic story hardening tiers`). The older untracked plan `2026-07-13-hermetic-story-hardening-phase-1.md` is superseded by this file; do not execute it.

| Changed file                                                                 | Original-plan task | Reconciliation                               | Disposition in this plan                                                                      |
| ---------------------------------------------------------------------------- | ------------------ | -------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `scripts/story-manifest-baseline.ts`                                         | 1                  | In-plan, divergent v3 runtime capture        | Retain; extend with dependency metadata in Task 1.                                            |
| `scripts/story-manifest-candidate.ts`                                        | 1                  | In-plan, divergent v3 runtime capture        | Retain; extend with dependency metadata in Task 1.                                            |
| `scripts/story-manifest-runtime.ts`                                          | 1                  | In-plan, divergent runtime hashing           | Retain; add dependency fingerprint schema in Task 1.                                          |
| `scripts/story-manifest.ts`                                                  | 1                  | In-plan, partial                             | Retain source compatibility comparison; add dependency manifest fields in Task 1.             |
| `tests/scripts/story-manifest.test.ts`                                       | 1                  | In-plan, partial                             | Retain runtime tests; add dependency-manifest tests in Task 1.                                |
| `scripts/story-runner-snapshot.ts`                                           | 2                  | In-plan, partial immutable source snapshot   | Refactor into session-owned `app/` materialization in Task 2.                                 |
| `scripts/story-runner-snapshot-topology.ts`                                  | 2                  | In-plan, accurate topology checking          | Retain and invoke from the session verifier in Task 2.                                        |
| `tests/scripts/story-runner-snapshot.test.ts`                                | 2                  | In-plan, partial                             | Retain existing source tests; add session layout tests in Task 2.                             |
| `scripts/test-stories.ts`                                                    | 3                  | In-plan, partial snapshot cwd/report routing | Refactor child launch through the sandbox backend in Task 5.                                  |
| `scripts/story-runner-arguments.ts`                                          | 3                  | In-plan, partial report containment          | Refactor report-file mapping to session paths in Task 2.                                      |
| `tests/scripts/test-stories.test.ts`                                         | 3                  | In-plan, partial                             | Retain launcher regressions; add backend command and report-copy assertions in Tasks 2 and 5. |
| `tests/stories/harness/io-guard.ts`                                          | 4                  | In-plan but insufficient as hard enforcement | Retain only as diagnostics in Task 5; remove hard-security claims.                            |
| `tests/stories/harness/io-guard-filesystem.ts`                               | 4                  | In-plan but insufficient as hard enforcement | Retain scenario-write/resource checks; do not grow native read interception.                  |
| `tests/stories/harness/io-guard-probe.ts`                                    | 4                  | In-plan, divergent                           | Move hard-boundary probes to process-sandbox fixtures in Task 6.                              |
| `tests/stories/harness/io-guard.test.ts`                                     | 4                  | In-plan, divergent                           | Keep wrapper regressions as diagnostics; add no hard-boundary claim in Task 5.                |
| `docs/superpowers/specs/2026-07-13-hermetic-story-process-sandbox-design.md` | New                | Out-of-plan, on-goal and approved            | Governing design for all tasks below.                                                         |

Original Task 1 source capture, Task 2 source materialization, and Task 3 snapshot cwd are useful groundwork but are not marked complete until Task 6 validates them through the OS boundary. Original Task 4 is deliberately superseded: its API wrappers have confirmed native loader, Bun runtime, glob, symlink-race, and copy-dereference bypasses.

## File structure

- Create: `scripts/story-dependency-snapshot.ts` — creates, seals, fingerprints, and acquires lock-keyed dependency cache entries.
- Create: `scripts/story-runner-session.ts` — owns session layout, source snapshot integration, report-file mapping, and cleanup.
- Create: `scripts/story-sandbox.ts` — platform-independent sandbox request/result contract and backend selection.
- Create: `scripts/story-sandbox-macos.ts` — creates the Darwin `sandbox-exec` profile and command.
- Create: `scripts/story-sandbox-linux.ts` — creates the Docker command using the pinned Bun image and restricted mounts.
- Create: `tests/scripts/story-dependency-snapshot.test.ts` — dependency cache and fingerprint contracts.
- Create: `tests/scripts/story-runner-session.test.ts` — session layout, temp/report mapping, and integrity contracts.
- Create: `tests/scripts/story-sandbox.test.ts` — backend selection and sandbox command/profile contracts.
- Create: `tests/stories/sandbox/process-boundary.test.ts` — child-process probes for native import, Bun APIs, glob, network, symlink traversal, and writes.
- Modify: `scripts/story-manifest*.ts` — record dependency key/fingerprint without changing frozen-harness compatibility semantics.
- Modify: `scripts/story-runner-snapshot.ts` and `scripts/story-runner-snapshot-topology.ts` — materialize `session/app` and verify captured source inputs.
- Modify: `scripts/story-runner-arguments.ts`, `scripts/story-runner-environment.ts`, and `scripts/test-stories.ts` — create a session, translate report arguments, and spawn through a required backend.
- Modify: `tests/stories/harness/io-guard*.ts` — consume the runner-provided session temp root and describe JavaScript guarding as diagnostics only.
- Modify: `.github/workflows/ci.yml`, create `.github/workflows/story-stress.yml`, and modify `docs/architecture/commands.md` — run the Linux sandbox lane on every PR and stress it on schedule/manual dispatch.

### Task 1: Add a verified, lock-keyed dependency snapshot

**Files:**

- Create: `scripts/story-dependency-snapshot.ts`
- Create: `tests/scripts/story-dependency-snapshot.test.ts`
- Modify: `scripts/story-manifest.ts`
- Modify: `scripts/story-manifest-candidate.ts`
- Modify: `scripts/story-manifest-baseline.ts`
- Modify: `tests/scripts/story-manifest.test.ts`

- [x] **Step 1: Write failing dependency-cache tests.** Cover a cache miss that invokes Bun with `install --frozen-lockfile --backend=copyfile`, a key change when `package.json`, `bun.lock`, or Bun version changes, a corrupt sealed entry rejection, and a cache hit that does not invoke Bun.

```typescript
expect(snapshot).toMatchObject({
  key: expect.stringMatching(/^[a-f0-9]{64}$/),
  root: path.join(cacheRoot, expectedKey, 'node_modules'),
  treeHash: expect.stringMatching(/^[a-f0-9]{64}$/),
})
expect(spawn).toHaveBeenCalledWith('bun', ['install', '--frozen-lockfile', '--backend=copyfile'], expect.anything())
```

- [x] **Step 2: Run the focused test and confirm the module is absent.**

Run: `bun test tests/scripts/story-dependency-snapshot.test.ts`

Expected: FAIL because `scripts/story-dependency-snapshot.ts` does not exist.

- [x] **Step 3: Implement sealed cache acquisition.** Define the exact public contract below. Hash raw `package.json`, raw `bun.lock`, and `bunVersion` with NUL separators; install into a unique staging directory; reject non-regular files and symlinks escaping its `node_modules`; hash sorted POSIX paths and raw content; atomically rename only after writing `manifest.json`; chmod the entry read-only.

```typescript
export type StoryDependencySnapshot = Readonly<{
  key: string
  root: string
  treeHash: string
}>

export async function acquireStoryDependencySnapshot(
  options: Readonly<{
    projectRoot: string
    cacheRoot: string
    bunVersion: string
  }>,
): Promise<StoryDependencySnapshot>
```

- [x] **Step 4: Extend the runtime manifest without making historical baseline capture install dependencies.** Add a strict optional `dependencySnapshot` object to `StoryManifestSchema`. `captureCandidateStoryInputs()` and every executable candidate manifest must populate it; `buildBaselineStoryManifest()` must omit it because a baseline comparison reads committed Git blobs and must never install or use a historical dependency tree. `compareStoryManifests()` must ignore the field in either direction.

```typescript
dependencySnapshot: z.object({
  key: z.string().regex(/^[a-f0-9]{64}$/),
  treeHash: z.string().regex(/^[a-f0-9]{64}$/),
  bunVersion: z.string().min(1),
})
  .strict()
  .optional()
```

Increment the manifest version; assert that candidate reports include the field, baseline manifests are still strict-schema valid without it, and compatibility comparisons deliberately ignore it alongside candidate runtime inputs.

- [x] **Step 5: Run focused cache and manifest tests.**

Run: `bun test tests/scripts/story-dependency-snapshot.test.ts tests/scripts/story-manifest.test.ts`

Expected: PASS; a cache key or tree-hash mismatch fails before any sandbox child is launched.

- [x] **Step 6: Commit the dependency snapshot.**

```bash
git add scripts/story-dependency-snapshot.ts scripts/story-manifest.ts scripts/story-manifest-candidate.ts scripts/story-manifest-baseline.ts tests/scripts/story-dependency-snapshot.test.ts tests/scripts/story-manifest.test.ts
git commit -m "test(stories): snapshot locked dependencies"
```

### Task 2: Build one verified story-runner session

**Files:**

- Create: `scripts/story-runner-session.ts`
- Create: `tests/scripts/story-runner-session.test.ts`
- Modify: `scripts/story-runner-snapshot.ts`
- Modify: `scripts/story-runner-snapshot-topology.ts`
- Modify: `scripts/story-runner-arguments.ts`
- Modify: `tests/scripts/story-runner-snapshot.test.ts`
- Modify: `tests/scripts/test-stories.test.ts`

- [x] **Step 1: Write failing session-layout tests.** Assert a session has `app/`, `node_modules`, `tmp/`, and only the requested pre-created report files; assert `app/` is read-only, `tmp/` is writable, `node_modules` targets the verified cache entry, and cleanup removes the complete session after all child work settles.

```typescript
expect(session).toMatchObject({
  appRoot: path.join(session.root, 'app'),
  tempRoot: path.join(session.root, 'tmp'),
  childReportPaths: [path.join(session.root, 'reports', 'junit.xml')],
})
expect(lstatSync(path.join(session.root, 'node_modules')).isSymbolicLink()).toBe(true)
```

- [x] **Step 2: Run the focused test and confirm it fails.**

Run: `bun test tests/scripts/story-runner-session.test.ts`

Expected: FAIL because no session creator exists.

- [x] **Step 3: Implement session creation and report translation.** Materialize existing captured inputs under `session/app` from bytes only; use the verified dependency entry as `session/node_modules`; create `session/tmp` mode `0700`; translate each permitted live `reports/stories/<basename>.xml` argument to a pre-created `session/reports/<basename>.xml` file. Reject nested names, symlinks, missing `.xml` suffixes, or duplicate report targets. Return a `copyReports()` method that copies completed files to the live report directory after the child exits.

```typescript
export type StoryRunnerSession = Readonly<{
  root: string
  appRoot: string
  tempRoot: string
  manifest: StoryManifest
  childReporterArguments: readonly string[]
  verifyIntegrity(): Promise<void>
  copyReports(): Promise<void>
  cleanup(): Promise<void>
}>
```

- [x] **Step 4: Refactor source snapshot ownership.** Change `createCandidateStorySnapshot()` to materialize into the session's `appRoot` instead of creating an independent worktree sibling. Keep its regular-file, directory, symlink, and topology verification; make only `StoryRunnerSession.cleanup()` remove the outer session.

- [x] **Step 5: Run session, source-snapshot, and runner-argument tests.**

Run: `bun test tests/scripts/story-runner-session.test.ts tests/scripts/story-runner-snapshot.test.ts tests/scripts/test-stories.test.ts`

Expected: PASS; mutation of the live worktree or live `node_modules` cannot change session inputs.

- [x] **Step 6: Commit the session layout.**

```bash
git add scripts/story-runner-session.ts scripts/story-runner-snapshot.ts scripts/story-runner-snapshot-topology.ts scripts/story-runner-arguments.ts tests/scripts/story-runner-session.test.ts tests/scripts/story-runner-snapshot.test.ts tests/scripts/test-stories.test.ts
git commit -m "test(stories): create sealed runner sessions"
```

### Task 3: Add the Darwin `sandbox-exec` backend

**Files:**

- Create: `scripts/story-sandbox.ts`
- Create: `scripts/story-sandbox-macos.ts`
- Create: `tests/scripts/story-sandbox.test.ts`

- [x] **Step 1: Write failing Darwin command/profile tests.** Given a fixed session and Bun executable, require `sandbox-exec -p <profile> bun test ...`; assert the profile denies network, allows reads from `appRoot` and `dependencyRoot`, allows writes only to `tempRoot` and exact report files, and does not contain the candidate worktree or `HOME`.

```typescript
expect(command.slice(0, 3)).toEqual(['sandbox-exec', '-p', expect.any(String)])
expect(profile).toContain('(deny network*)')
expect(profile).toContain(`(subpath \"${request.appRoot}\")`)
expect(profile).not.toContain(request.liveRoot)
```

- [x] **Step 2: Run the focused test and confirm it fails.**

Run: `bun test tests/scripts/story-sandbox.test.ts --test-name-pattern 'Darwin'`

Expected: FAIL because backend selection does not exist.

- [x] **Step 3: Implement the platform-independent request and Darwin backend.** The request must carry only absolute, canonical session paths plus the exact Bun command. Build a profile from escaped literals; permit platform runtime paths `/System`, `/usr/lib`, `/private/var/db/timezone`, and the canonical Bun executable directory. Deny default, deny `network*`, permit process execution, permit read-only declared inputs, and permit writes only to session temp/report literals.

```typescript
export type StorySandboxRequest = Readonly<{
  platform: NodeJS.Platform
  appRoot: string
  dependencyRoot: string
  tempRoot: string
  reportPaths: readonly string[]
  bunExecutable: string
  command: readonly string[]
}>

export function buildStorySandboxCommand(request: StorySandboxRequest): readonly string[]
```

- [x] **Step 4: Add an executable Darwin boundary fixture.** Launch a tiny Bun test through the generated profile. Assert source and dependency reads succeed; direct `file:` import outside `appRoot`, `Bun.file('/etc/hosts').text()`, `fetch()`, and a write outside `tempRoot` each exit non-zero with a sandbox denial.

- [x] **Step 5: Run backend tests on Darwin.**

Run: `bun test tests/scripts/story-sandbox.test.ts --test-name-pattern 'Darwin'`

Expected: PASS on Darwin; unsupported platform selection remains unimplemented until Task 4.

- [x] **Step 6: Commit the Darwin backend.**

```bash
git add scripts/story-sandbox.ts scripts/story-sandbox-macos.ts tests/scripts/story-sandbox.test.ts
git commit -m "test(stories): sandbox Darwin story children"
```

### Task 4: Add the Linux OCI sandbox backend

**Files:**

- Create: `scripts/story-sandbox-linux.ts`
- Modify: `scripts/story-sandbox.ts`
- Modify: `tests/scripts/story-sandbox.test.ts`

- [x] **Step 1: Write failing Linux Docker-command tests.** Require the exact image reference, `--read-only`, `--network none`, `--cap-drop ALL`, `--security-opt no-new-privileges`, `--pids-limit 128`, and only four declared mounts: app read-only, dependency `node_modules` read-only, temp read-write, and one bind mount per report file.

```typescript
expect(command).toEqual(
  expect.arrayContaining([
    'docker',
    'run',
    '--rm',
    '--read-only',
    '--network',
    'none',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    '--pids-limit',
    '128',
    'docker.io/oven/bun:1.3.13@sha256:87416c977a612a204eb54ab9f3927023c2a3c971f4f345a01da08ea6262ae30e',
  ]),
)
```

- [x] **Step 2: Run the focused test and confirm it fails.**

Run: `bun test tests/scripts/story-sandbox.test.ts --test-name-pattern 'Linux'`

Expected: FAIL because no Linux backend exists.

- [x] **Step 3: Create the direct pinned-image Docker backend.** Execute the exact pinned OCI image directly; do not introduce an unreferenced Dockerfile or mutable local image tag. The command must mount only session paths at `/session/app`, `/session/node_modules`, `/session/tmp`, and the exact report files under `/session/reports`; set `TMPDIR=/session/tmp`, set `HOME=/nonexistent`, set `PAPAI_STORY_EXECUTION_ROOT=/session/app`, and execute `bun --no-env-file test ...`. Reject missing Docker or a container Bun version other than `1.3.13` before executing tests.

- [x] **Step 4: Add Linux executable boundary fixtures.** Run the same native-import, Bun file, glob, symlink, network, and write probes from Task 3 through Docker. Assert a report file is written only through its mapped session path and copied by the parent.

- [x] **Step 5: Run Linux backend tests where Docker is available.**

Run: `bun test tests/scripts/story-sandbox.test.ts --test-name-pattern 'Linux'`

Expected: PASS with no host project, HOME, or broad temporary-directory mount.

- [x] **Step 6: Commit the Linux backend.**

```bash
git add scripts/story-sandbox.ts scripts/story-sandbox-linux.ts tests/scripts/story-sandbox.test.ts
git commit -m "test(stories): isolate Linux story children"
```

### Task 5: Route the story runner through required sandboxes

**Files:**

- Modify: `scripts/test-stories.ts`
- Modify: `scripts/story-runner-environment.ts`
- Modify: `tests/scripts/test-stories.test.ts`
- Modify: `tests/stories/harness/io-guard.ts`
- Modify: `tests/stories/harness/io-guard.test.ts`

- [x] **Step 1: Write failing runner tests.** Assert a normal story run builds a `StoryRunnerSession`, uses `buildStorySandboxCommand()`, passes only session paths in its environment, copies reports after child exit, verifies both source and dependency fingerprints before and after execution, and fails before spawn for an unsupported platform.

```typescript
expect(spawn).toHaveBeenCalledWith(
  expect.arrayContaining(['sandbox-exec']),
  expect.objectContaining({ cwd: session.appRoot, env: expect.objectContaining({ TMPDIR: session.tempRoot }) }),
)
await expect(runStoryTests([], unsupportedDependencies)).resolves.toBe(2)
expect(spawn).not.toHaveBeenCalled()
```

- [x] **Step 2: Run the focused runner test and confirm it fails.**

Run: `bun test tests/scripts/test-stories.test.ts --test-name-pattern 'sandbox session|unsupported platform'`

Expected: FAIL because the runner currently launches Bun directly from a snapshot.

- [x] **Step 3: Integrate session and sandbox lifecycle.** Replace direct snapshot creation in `executeStoryTests()` with session creation. Verify before spawn, attach the sandboxed child to existing signal forwarding, verify after exit, copy reports only after verification, and always clean the session. Keep `--manifest-only` free of child/sandbox startup.

- [x] **Step 4: Make temporary ownership explicit and demote JS guard claims.** `sanitizedStoryEnvironment()` must set `TMPDIR` to the session temp root and remove inherited `HOME`. `runWithScenarioIoGuard()` must create its scenario root beneath that `TMPDIR`; retain phase-aware diagnostics and write/resource checks. Update tests and comments to say the guard is defense in depth, not hard process isolation; do not add more native API monkey patches.

- [x] **Step 5: Run runner and guard suites.**

Run: `bun test tests/scripts/test-stories.test.ts tests/stories/harness/io-guard.test.ts`

Expected: PASS; no direct child command is allowed outside a selected sandbox backend.

- [x] **Step 6: Commit runner integration.**

```bash
git add scripts/test-stories.ts scripts/story-runner-environment.ts tests/scripts/test-stories.test.ts tests/stories/harness/io-guard.ts tests/stories/harness/io-guard.test.ts
git commit -m "test(stories): require process sandbox sessions"
```

### Task 6: Prove hard isolation and enforce the CI tiers

**Files:**

- Create: `tests/stories/sandbox/process-boundary.test.ts`
- Modify: `.github/workflows/ci.yml`
- Create: `.github/workflows/story-stress.yml`
- Modify: `docs/architecture/commands.md`

- [ ] **Step 1: Write failing process-boundary acceptance cases.** Each fixture must run as an actual sandboxed story child, not through a mocked API. Test direct `await import(fileOutsideSession)`, `Bun.file(outside).stat()`, `new Bun.Glob('*').scan({ cwd: outside })`, a `fetch()` request, `createReadStream()` after an in-root path is replaced by an outside symlink, `cp(..., { dereference: true })` across an outside symlink, and a write outside session temp/report paths.

```typescript
for (const operation of ['file-import', 'bun-stat', 'bun-glob', 'network', 'stream-race', 'cp-dereference', 'write']) {
  const result = await runSandboxFixture(operation)
  expect(result.exitCode).not.toBe(0)
  expect(result.stderr).toMatch(/deny|operation not permitted|sandbox/i)
}
```

- [ ] **Step 2: Run the acceptance test and confirm it fails before the backend integration is complete.**

Run: `bun test tests/stories/sandbox/process-boundary.test.ts`

Expected: FAIL because native operations can still escape the JavaScript guard on the current branch.

- [ ] **Step 3: Add PR CI enforcement.** In the existing `stories` job, build or pull the pinned sandbox image, run `docker version`, run `bun test:stories:contracts`, then run `bun test:stories`; both commands must select the Linux backend. Pin `runs-on: ubuntu-24.04` rather than `ubuntu-latest`; retain build artifact download and `if: always()` report upload.

- [ ] **Step 4: Add scheduled stress enforcement.** Create `story-stress.yml` with `workflow_dispatch` and `cron: '17 3 * * *'`; use the same Ubuntu version, dependency installation, build artifact download, image verification, and Linux sandbox command. Run `bun test:stories:stress` exactly once and upload `reports/stories/**` with `if: always()`.

- [ ] **Step 5: Update command documentation.** Replace the JavaScript-only hermeticity wording with the session/sandbox contract, dependency fingerprint evidence, supported backends, fail-closed unsupported platforms, and CI policy. State that Tier 0.1 and Tier 0 run through Linux isolation on every PR; stress uses the same backend scheduled/manual with no retries.

- [ ] **Step 6: Run phase verification from a clean worktree.**

Run: `bun run format:check && bun run typecheck && bun test tests/scripts/story-dependency-snapshot.test.ts tests/scripts/story-runner-session.test.ts tests/scripts/story-sandbox.test.ts tests/stories/sandbox/process-boundary.test.ts && bun test:stories:contracts && bun test:stories && bun test:stories:stress`

Expected: every command exits 0; the process-boundary cases prove OS-level rejection; reports include frozen harness hash, candidate runtime hash, dependency key/tree hash, and selected backend.

- [ ] **Step 7: Commit CI policy and evidence.**

```bash
git add tests/stories/sandbox/process-boundary.test.ts .github/workflows/ci.yml .github/workflows/story-stress.yml docs/architecture/commands.md
git commit -m "ci(stories): enforce sandboxed story tiers"
```

## Plan self-review

- The plan covers every approved design section: immutable source, immutable dependency closure, session ownership, Darwin and Linux OS backends, no fallback, guard demotion, acceptance probes, CI, stress, manifests, and evidence.
- Every changed code file since the original design commit appears in the reconciliation table. Existing source-snapshot work is retained only where it supports the new goal; the JS-wrapper hard-boundary claim is explicitly superseded.
- Dependency cache key, manifest field names, session roots, sandbox request fields, and backend mounts use the same terminology across all tasks.
- The only external runtime reference is the exact Bun OCI digest shown above; no task contains an unfilled value or a weaker fallback.

## Drift Log

| Date       | Category             | Item                                                               | Decision                                                                       |
| ---------- | -------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| 2026-07-13 | In-plan, divergent   | Original Task 4 JavaScript read boundary                           | Superseded by approved required OS sandbox; retain guard only for diagnostics. |
| 2026-07-13 | Out-of-plan, on-goal | Lock-keyed dependency snapshot and session-owned report/temp roots | Added by approved process-isolated design.                                     |
| 2026-07-13 | Out-of-plan, on-goal | Darwin `sandbox-exec` and Linux pinned OCI backends                | Added by approved process-isolated design; unsupported platforms fail closed.  |
