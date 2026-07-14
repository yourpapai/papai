<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Docker-only hermetic story execution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run every production story child through the pinned Linux Docker sandbox on every host OS, with no native fallback.

**Architecture:** Backend selection is Docker-only and host-independent. The existing fail-closed Docker/Bun-version preflight runs before every session on all hosts; the hardened OCI contract remains unchanged. Candidate evidence always records `linux-docker`.

**Tech Stack:** Bun, TypeScript, Docker/Docker Desktop, GitHub Actions, Bun test.

---

### Task 1: Select Docker on every supported host

**Files:**

- Modify: `scripts/story-sandbox.ts`
- Modify: `scripts/test-stories.ts`
- Modify: `tests/scripts/story-sandbox.test.ts`
- Modify: `tests/scripts/test-stories.test.ts`

- [ ] **Step 1: Write failing host-selection and preflight tests.** Assert Darwin, Linux, and Windows select `linux-docker`; unsupported hosts throw. Assert Darwin-host `runStoryTests()` invokes injected Docker preflight before session creation and returns `2` without spawn when preflight rejects.

```ts
for (const platform of ['darwin', 'linux', 'win32'] as const)
  expect(selectStorySandboxBackend(platform)).toBe('linux-docker')
await expect(runStoryTests([], { platform: 'darwin', assertLinuxSandboxBackend: failingPreflight })).resolves.toBe(2)
expect(createSession).not.toHaveBeenCalled()
expect(spawn).not.toHaveBeenCalled()
```

- [ ] **Step 2: Run red.** Run `bun test tests/scripts/story-sandbox.test.ts tests/scripts/test-stories.test.ts --test-name-pattern 'Docker|Darwin|Windows|preflight'`; expect failure because Darwin selects Seatbelt and Windows is unsupported.

- [ ] **Step 3: Implement Docker-only selection.** Replace platform branching with `linux-docker` for every supported host. Preserve explicit unsupported-host errors; do not use host platform as a Docker-availability check. Call `assertLinuxSandboxBackend` for every non-manifest-only run before session/discovery/spawn.

```ts
export function selectStorySandboxBackend(platform: NodeJS.Platform): StorySandboxBackend {
  if (platform === 'aix' || platform === 'freebsd' || platform === 'openbsd')
    throw new Error(`Story sandbox backend is not implemented for ${platform}`)
  return 'linux-docker'
}
```

- [ ] **Step 4: Block native production selection.** Update runner tests so macOS/Windows commands begin `docker run` and contain no `sandbox-exec`. Isolated Seatbelt diagnostic tests may remain, but cannot be selected by normal story execution.

```ts
expect(spawn).toHaveBeenCalledWith(expect.arrayContaining(['docker', 'run']), expect.any(Object))
expect(spawn.mock.calls.flatMap(([command]) => command).not.toContain('sandbox-exec')
```

- [ ] **Step 5: Verify and commit.** Run `bun test tests/scripts/story-sandbox.test.ts tests/scripts/test-stories.test.ts` (PASS), then `bun run typecheck && bun run lint && git diff --check` (all exit 0). Commit with `git add scripts/story-sandbox.ts scripts/test-stories.ts tests/scripts/story-sandbox.test.ts tests/scripts/test-stories.test.ts && git commit -m "test(stories): require Docker sandbox on all hosts"`.

### Task 2: Record Docker-only evidence and prove portable execution

**Files:**

- Modify: `scripts/story-manifest.ts`
- Modify: `scripts/story-manifest-candidate.ts`
- Modify: `tests/scripts/story-manifest.test.ts`
- Modify: `tests/stories/sandbox/process-boundary.test.ts`
- Modify: `docs/architecture/commands.md`

- [ ] **Step 1: Write failing evidence/acceptance tests.** Assert candidate manifests from Darwin/Windows runner fixtures record `sandboxBackend: 'linux-docker'`; historical baseline validation/comparison still accepts omitted backend. Assert process-boundary result reports Docker backend without inspecting host platform.

```ts
expect(candidate.sandboxBackend).toBe('linux-docker')
expect(compareManifestToBaseline(candidate, baselineWithoutBackend)).toEqual([])
expect(boundaryResult.backend).toBe('linux-docker')
```

- [ ] **Step 2: Run red.** Run `bun test tests/scripts/story-manifest.test.ts tests/stories/sandbox/process-boundary.test.ts`; expect failure until candidate assembly receives Docker-only selection for every host fixture.

- [ ] **Step 3: Propagate evidence.** Candidate creation receives selected production backend and writes `linux-docker`; baseline manifests retain optional historical omission and comparison ignores it. Never write a host-native backend value.

- [ ] **Step 4: Update documentation.** State Docker/Docker Desktop is required on all hosts, explain pinned-image preflight/no native fallback/app-local dependency runtime, and document exit-2 failure before session startup if Docker is unavailable.

- [ ] **Step 5: Verify and commit.** Run `PAPAI_REQUIRE_STORY_SANDBOX=1 bun test:stories:contracts` (PASS), `CI=true PAPAI_REQUIRE_STORY_SANDBOX=1 bun test:stories` (PASS), and `bun run typecheck && bun run lint && git diff --check` (all exit 0). Commit with `git add scripts/story-manifest.ts scripts/story-manifest-candidate.ts tests/scripts/story-manifest.test.ts tests/stories/sandbox/process-boundary.test.ts docs/architecture/commands.md && git commit -m "docs(stories): require Docker sandbox on every host"`.
