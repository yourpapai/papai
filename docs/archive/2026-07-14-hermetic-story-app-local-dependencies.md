<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# App-local story dependencies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put sealed dependencies inside each immutable story app so Bun never reads session-parent directories.

**Architecture:** The cache stays parent-owned. Session assembly safely copies its sealed tree to `app/node_modules`, seals and hashes the finished app, and backends grant only `appRoot` plus runtime paths. Linux mounts app only; it never mounts the cache.

**Tech Stack:** Bun, TypeScript, Node filesystem APIs, Seatbelt, Docker, Bun test.

---

### Task 1: App-local sealed dependency materialization

**Files:**

- Create: `scripts/story-runner-session-dependencies.ts`
- Modify: `scripts/story-runner-session.ts`
- Modify: `tests/scripts/story-runner-session.test.ts`

- [ ] **Step 1: Add failing session tests.** Build a sealed cache fixture containing `@fixture/dependency/value.txt` and an internal symlink. Assert `session.appRoot/node_modules` is a real directory, no `session.root/node_modules` exists, its payload is readable, and cache/app-local mutations both make `verifyIntegrity()` reject.

```ts
expect(lstatSync(path.join(session.appRoot, 'node_modules')).isSymbolicLink()).toBe(false)
expect(readFileSync(path.join(session.appRoot, 'node_modules/@fixture/dependency/value.txt'), 'utf8')).toBe('captured')
expect(existsSync(path.join(session.root, 'node_modules'))).toBe(false)
```

- [ ] **Step 2: Run red.** Run `bun test tests/scripts/story-runner-session.test.ts --test-name-pattern 'app-local|dependency mutation'`; expect the current sibling-link layout to fail.

- [ ] **Step 3: Implement safe copy/seal helper.** Export `materializeSessionDependencies(sourceRoot, destinationRoot, fs)` from the new helper. Traverse with `lstat`/`readdir`, copy one regular file at a time, permit symlinks only after resolved-target containment in `sourceRoot`, reject special/dangling/escaping entries, make destination readonly, and return `hashDependencyTree(destinationRoot, fs, true)`.

```ts
export async function materializeSessionDependencies(
  source: string,
  destination: string,
  fs: SessionDependencyFileSystem,
): Promise<string> {
  await copyValidatedEntry(source, destination, source, fs)
  await makeDependencyTreeReadOnly(destination, fs)
  return hashDependencyTree(destination, fs, true)
}
```

- [ ] **Step 4: Replace links in session assembly.** Materialize source first, then cache dependencies at `appRoot/node_modules`; require its hash equals `dependency.treeHash`; remove the session-level link. Seal app only after local dependencies are readonly. Verify both app-local hash and parent cache hash before/after child execution.

- [ ] **Step 5: Verify and commit.** Run `bun test tests/scripts/story-runner-session.test.ts tests/scripts/story-dependency-snapshot.test.ts` (PASS), then commit `test(stories): materialize app-local dependencies` with the helper, session, and tests.

### Task 2: Remove cache paths from sandbox contracts

**Files:**

- Modify: `scripts/story-sandbox.ts`
- Modify: `scripts/story-sandbox-macos.ts`
- Modify: `scripts/story-sandbox-linux.ts`
- Modify: `tests/scripts/story-sandbox.test.ts`
- Modify: `tests/scripts/test-stories.test.ts`

- [ ] **Step 1: Add failing contracts.** Place `@fixture/dependency` under fixture `appRoot/node_modules`. Assert request has no `dependencyRoot`, Darwin profile has app but no cache path, Linux has no `/session/node_modules` bind mount, and scoped import succeeds in Darwin while host reads/writes fail.

```ts
expect('dependencyRoot' in request).toBe(false)
expect(profile).toContain(`(subpath "${request.appRoot}")`)
expect(profile).not.toContain(dependencyCacheRoot)
expect(command).not.toContain('dst=/session/node_modules')
```

- [ ] **Step 2: Run red.** Run `bun test tests/scripts/story-sandbox.test.ts --test-name-pattern 'Darwin|Linux'`; expect failure until request/backends no longer require sibling dependencies.

- [ ] **Step 3: Simplify the request and profiles.** Remove `dependencyRoot` from `StorySandboxRequest`, delete cache-link validation/grants on Darwin, and retain canonical app/tmp/direct-report validation. Do not grant temp parents, cache, worktree, or HOME.

```ts
export type StorySandboxRequest = Readonly<{
  platform: NodeJS.Platform
  appRoot: string
  tempRoot: string
  reportPaths: readonly string[]
  bunExecutable: string
  command: readonly string[]
}>
```

- [ ] **Step 4: Simplify Linux.** Remove dependency validation, mount, and host/container path translation; retain app readonly, tmp/report writes, UID:GID, no IPC/network, and capability restrictions. Update runner-request assertions to contain app/tmp/reports only.

- [ ] **Step 5: Verify and commit.** Run `bun run test:stories:sandbox -- --test-name-pattern 'Darwin|Linux'` (Darwin PASS; optional Linux explicit skip only if unavailable), then `CI=true PAPAI_REQUIRE_STORY_SANDBOX=1 bun run test:stories:sandbox -- --test-name-pattern Linux` (PASS). Commit `test(stories): sandbox app-local dependencies`.

### Task 3: Reopen hard-boundary acceptance

**Files:**

- Modify: `tests/stories/sandbox/process-boundary.test.ts`
- Modify: `tests/stories/harness/process-boundary.fixture.ts`
- Modify: `tests/scripts/story-manifest.test.ts`
- Modify: `docs/architecture/commands.md`

- [ ] **Step 1: Add failing app-local acceptance cases.** Make direct-child controls import `@fixture/dependency` from app-local modules before each seven-operation host-sentinel test. Assert candidate manifest evidence records `sandboxBackend` and dependency hash while baseline comparison accepts historical omission.

```ts
expect(await runDirectFixture('dependency-import')).toMatchObject({ exitCode: 0 })
expect(candidate.sandboxBackend).toBe('darwin')
```

- [ ] **Step 2: Run red.** Run `bun test tests/stories/sandbox/process-boundary.test.ts tests/scripts/story-manifest.test.ts`; expect failure until fixture paths use app-local modules.

- [ ] **Step 3: Update fixtures/docs.** Preserve direct host-sentinel controls, required Docker failure behavior, and all seven OS-denial probes. Document that the child sees sealed app-local dependencies while evidence records the cache fingerprint/backend. Do not weaken CI or stress workflows.

- [ ] **Step 4: Run final tiers and commit.** Run `PAPAI_REQUIRE_STORY_SANDBOX=1 bun test:stories:contracts`, `bun test:stories` on Darwin, `CI=true PAPAI_REQUIRE_STORY_SANDBOX=1 bun test:stories`, and `bun run typecheck && bun run lint && git diff --check`; all must pass. Commit `test(stories): verify app-local sandbox boundary`.
