<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Behavior Audit — Close the Loop (Tier 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a nightly CI job that runs the behavior audit against an external LLM gateway, then publishes the resulting `stories/` snapshot to an `audit-output` orphan branch with a moving `audit-output-latest` tag — without touching any audit-pipeline code.

**Architecture:** Three new files (one GitHub workflow + two orchestration scripts) and two new test files. The audit pipeline itself is unchanged. A preflight script pings the gateway's `/models` endpoint and refuses to start on failure. After the audit, a publisher script force-pushes an orphan branch and moves a lightweight tag.

**Tech Stack:** Bun 1.3.13, TypeScript, GitHub Actions, OpenAI-compatible HTTP API, `gh` CLI / git plumbing.

**Spec:** `docs/superpowers/specs/2026-07-19-behavior-audit-close-the-loop-design.md`

---

## File Structure

| File                                                    | Responsibility                                                                           |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `.github/workflows/behavior-audit.yml`                  | Nightly cron + workflow_dispatch trigger; orchestrates preflight → audit → publish       |
| `scripts/behavior-audit/preflight.ts`                   | GETs `${BASE_URL}/models`; verifies `MODEL` is offered; exits non-zero on failure        |
| `scripts/behavior-audit/publish-snapshot.ts`            | Replaces `stories/` on the `audit-output` orphan branch; moves `audit-output-latest` tag |
| `tests/scripts/behavior-audit/preflight.test.ts`        | Unit tests for preflight: HTTP success/failure paths, env-var validation                 |
| `tests/scripts/behavior-audit/publish-snapshot.test.ts` | Unit tests for pure helpers (date stamp, commit message, branch resolution)              |

No existing files are modified.

---

## Task 1: Preflight script — happy path

**Files:**

- Create: `scripts/behavior-audit/preflight.ts`
- Create: `tests/scripts/behavior-audit/preflight.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/scripts/behavior-audit/preflight.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, mock, test } from 'bun:test'

import { runPreflight } from '../../../scripts/behavior-audit/preflight.js'

describe('preflight', () => {
  const originalFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = originalFetch
    delete process.env.BEHAVIOR_AUDIT_BASE_URL
    delete process.env.BEHAVIOR_AUDIT_MODEL
    delete process.env.OPENAI_API_KEY
  })

  test('exits 0 when gateway offers the configured model', async () => {
    process.env.BEHAVIOR_AUDIT_BASE_URL = 'https://gateway.example.com/v1'
    process.env.BEHAVIOR_AUDIT_MODEL = 'anthropic/claude-3.5-sonnet'
    process.env.OPENAI_API_KEY = 'test-key'
    globalThis.fetch = mock(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.endsWith('/models')) {
        return new Response(
          JSON.stringify({
            data: [{ id: 'anthropic/claude-3.5-sonnet' }, { id: 'openai/gpt-4o' }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      return new Response('not found', { status: 404 })
    }) as typeof fetch

    const result = await runPreflight()
    expect(result).toBe(0)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/scripts/behavior-audit/preflight.test.ts`
Expected: FAIL — `Cannot find module '../../../scripts/behavior-audit/preflight.js'`

- [ ] **Step 3: Write minimal implementation**

Create `scripts/behavior-audit/preflight.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export interface PreflightResult {
  readonly exitCode: number
  readonly message: string
}

export async function runPreflight(): Promise<number> {
  const baseUrl = process.env.BEHAVIOR_AUDIT_BASE_URL
  const model = process.env.BEHAVIOR_AUDIT_MODEL
  const apiKey = process.env.OPENAI_API_KEY

  if (baseUrl === undefined || baseUrl === '') {
    console.error('Error: BEHAVIOR_AUDIT_BASE_URL is not set')
    return 1
  }
  if (model === undefined || model === '') {
    console.error('Error: BEHAVIOR_AUDIT_MODEL is not set')
    return 1
  }
  if (apiKey === undefined || apiKey === '') {
    console.error('Error: OPENAI_API_KEY is not set')
    return 1
  }

  const url = `${baseUrl}/models`
  let response: Response
  try {
    response = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } })
  } catch (err) {
    console.error(`Error: gateway unreachable: ${err instanceof Error ? err.message : String(err)}`)
    return 1
  }

  if (response.status === 401 || response.status === 403) {
    console.error(`Error: auth rejected (HTTP ${response.status})`)
    return 1
  }
  if (!response.ok) {
    console.error(`Error: gateway returned HTTP ${response.status}`)
    return 1
  }

  let payload: { data?: ReadonlyArray<{ id?: unknown }> }
  try {
    payload = (await response.json()) as { data?: ReadonlyArray<{ id?: unknown }> }
  } catch {
    console.error('Error: gateway returned malformed JSON')
    return 1
  }

  const ids = (payload.data ?? []).map((entry) => entry.id).filter((id): id is string => typeof id === 'string')
  if (!ids.includes(model)) {
    console.error(`Error: model "${model}" not offered by gateway (available: ${ids.join(', ') || 'none'})`)
    return 1
  }

  console.log(`Preflight OK: gateway ${baseUrl} offers model ${model}`)
  return 0
}

if (import.meta.main) {
  const exitCode = await runPreflight()
  process.exit(exitCode)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/scripts/behavior-audit/preflight.test.ts`
Expected: PASS (1 test)

- [ ] **Step 5: Commit**

```bash
git add scripts/behavior-audit/preflight.ts tests/scripts/behavior-audit/preflight.test.ts
git commit -m "feat(behavior-audit): add gateway preflight script"
```

---

## Task 2: Preflight — failure paths

**Files:**

- Modify: `tests/scripts/behavior-audit/preflight.test.ts`

- [ ] **Step 1: Add failing tests for each failure path**

Append to `tests/scripts/behavior-audit/preflight.test.ts` inside the `describe` block:

```typescript
test('exits 1 when BEHAVIOR_AUDIT_BASE_URL is missing', async () => {
  process.env.BEHAVIOR_AUDIT_MODEL = 'm'
  process.env.OPENAI_API_KEY = 'k'
  globalThis.fetch = mock(async () => new Response('{}')) as typeof fetch
  expect(await runPreflight()).toBe(1)
})

test('exits 1 when BEHAVIOR_AUDIT_MODEL is missing', async () => {
  process.env.BEHAVIOR_AUDIT_BASE_URL = 'https://x/v1'
  process.env.OPENAI_API_KEY = 'k'
  globalThis.fetch = mock(async () => new Response('{}')) as typeof fetch
  expect(await runPreflight()).toBe(1)
})

test('exits 1 when OPENAI_API_KEY is missing', async () => {
  process.env.BEHAVIOR_AUDIT_BASE_URL = 'https://x/v1'
  process.env.BEHAVIOR_AUDIT_MODEL = 'm'
  globalThis.fetch = mock(async () => new Response('{}')) as typeof fetch
  expect(await runPreflight()).toBe(1)
})

test('exits 1 when fetch throws (network error)', async () => {
  process.env.BEHAVIOR_AUDIT_BASE_URL = 'https://x/v1'
  process.env.BEHAVIOR_AUDIT_MODEL = 'm'
  process.env.OPENAI_API_KEY = 'k'
  globalThis.fetch = mock(async () => {
    throw new Error('ECONNREFUSED')
  }) as typeof fetch
  expect(await runPreflight()).toBe(1)
})

test('exits 1 on HTTP 401', async () => {
  process.env.BEHAVIOR_AUDIT_BASE_URL = 'https://x/v1'
  process.env.BEHAVIOR_AUDIT_MODEL = 'm'
  process.env.OPENAI_API_KEY = 'k'
  globalThis.fetch = mock(async () => new Response('unauthorized', { status: 401 })) as typeof fetch
  expect(await runPreflight()).toBe(1)
})

test('exits 1 when model is not in response', async () => {
  process.env.BEHAVIOR_AUDIT_BASE_URL = 'https://x/v1'
  process.env.BEHAVIOR_AUDIT_MODEL = 'missing-model'
  process.env.OPENAI_API_KEY = 'k'
  globalThis.fetch = mock(
    async () =>
      new Response(JSON.stringify({ data: [{ id: 'other-model' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  ) as typeof fetch
  expect(await runPreflight()).toBe(1)
})

test('exits 1 on malformed JSON', async () => {
  process.env.BEHAVIOR_AUDIT_BASE_URL = 'https://x/v1'
  process.env.BEHAVIOR_AUDIT_MODEL = 'm'
  process.env.OPENAI_API_KEY = 'k'
  globalThis.fetch = mock(async () => new Response('not-json', { status: 200 })) as typeof fetch
  expect(await runPreflight()).toBe(1)
})
```

- [ ] **Step 2: Run the tests**

Run: `bun test tests/scripts/behavior-audit/preflight.test.ts`
Expected: PASS (all 8 tests — implementation already handles each path).

- [ ] **Step 3: Commit**

```bash
git add tests/scripts/behavior-audit/preflight.test.ts
git commit -m "test(behavior-audit): cover preflight failure paths"
```

---

## Task 3: Publish-snapshot — pure helpers

**Files:**

- Create: `scripts/behavior-audit/publish-snapshot.ts`
- Create: `tests/scripts/behavior-audit/publish-snapshot.test.ts`

- [ ] **Step 1: Write failing tests for pure helpers**

Create `tests/scripts/behavior-audit/publish-snapshot.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  buildCommitMessage,
  formatDateStamp,
  resolveBranchName,
  resolveTagName,
} from '../../../scripts/behavior-audit/publish-snapshot.js'

describe('publish-snapshot helpers', () => {
  test('formatDateStamp formats UTC date as YYYY-MM-DD', () => {
    const date = new Date('2026-07-19T03:00:00Z')
    expect(formatDateStamp(date)).toBe('2026-07-19')
  })

  test('formatDateStamp uses UTC across timezones', () => {
    const date = new Date('2026-07-19T23:30:00Z')
    expect(formatDateStamp(date)).toBe('2026-07-19')
  })

  test('resolveBranchName returns audit-output by default', () => {
    delete process.env.BEHAVIOR_AUDIT_PUBLISH_BRANCH
    expect(resolveBranchName()).toBe('audit-output')
  })

  test('resolveBranchName respects BEHAVIOR_AUDIT_PUBLISH_BRANCH', () => {
    process.env.BEHAVIOR_AUDIT_PUBLISH_BRANCH = 'custom-audit-branch'
    expect(resolveBranchName()).toBe('custom-audit-branch')
    delete process.env.BEHAVIOR_AUDIT_PUBLISH_BRANCH
  })

  test('resolveTagName returns audit-output-latest by default', () => {
    delete process.env.BEHAVIOR_AUDIT_PUBLISH_TAG
    expect(resolveTagName()).toBe('audit-output-latest')
  })

  test('buildCommitMessage formats date stamp', () => {
    expect(buildCommitMessage('2026-07-19')).toBe('chore(audit): snapshot for 2026-07-19')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/scripts/behavior-audit/publish-snapshot.test.ts`
Expected: FAIL — `Cannot find module '../../../scripts/behavior-audit/publish-snapshot.js'`

- [ ] **Step 3: Write minimal implementation**

Create `scripts/behavior-audit/publish-snapshot.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { resolve } from 'node:path'

import { STORIES_DIR } from './config.js'

export function formatDateStamp(date: Date): string {
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function resolveBranchName(): string {
  return process.env.BEHAVIOR_AUDIT_PUBLISH_BRANCH ?? 'audit-output'
}

export function resolveTagName(): string {
  return process.env.BEHAVIOR_AUDIT_PUBLISH_TAG ?? 'audit-output-latest'
}

export function buildCommitMessage(dateStamp: string): string {
  return `chore(audit): snapshot for ${dateStamp}`
}

export function resolveStoriesPath(): string {
  return STORIES_DIR
}

async function publishSnapshot(): Promise<number> {
  const storiesPath = resolveStoriesPath()
  const branch = resolveBranchName()
  const tag = resolveTagName()
  const dateStamp = formatDateStamp(new Date())

  const fs = await import('node:fs/promises')
  const constants = await import('node:fs')
  try {
    await fs.access(storiesPath, constants.constants.F_OK)
  } catch {
    console.error(`Error: no audit output to publish (${storiesPath} does not exist)`)
    return 1
  }
  const entries = await fs.readdir(storiesPath)
  if (entries.length === 0) {
    console.error(`Error: no audit output to publish (${storiesPath} is empty)`)
    return 1
  }

  console.log(`Publishing ${entries.length} entries from ${storiesPath} to branch ${branch} (tag ${tag})`)
  console.log(`Date stamp: ${dateStamp}`)
  console.log('Orphan-branch publish requires git plumbing; run within GitHub Actions.')

  return 0
}

if (import.meta.main) {
  const exitCode = await publishSnapshot()
  process.exit(exitCode)
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test tests/scripts/behavior-audit/publish-snapshot.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/behavior-audit/publish-snapshot.ts tests/scripts/behavior-audit/publish-snapshot.test.ts
git commit -m "feat(behavior-audit): add publish-snapshot script with pure helpers"
```

---

## Task 4: Publish-snapshot — git plumbing via child process

The publisher must actually push the orphan branch. To keep this testable, split the git operations into a `GitOps` interface and provide a real implementation that calls `Bun.spawn` for git. The publisher's `main` flow uses the real implementation; tests use a fake.

**Files:**

- Modify: `scripts/behavior-audit/publish-snapshot.ts`
- Modify: `tests/scripts/behavior-audit/publish-snapshot.test.ts`

- [ ] **Step 1: Add failing test for the publish flow with a fake GitOps**

Append to `tests/scripts/behavior-audit/publish-snapshot.test.ts`:

```typescript
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, mock, test } from 'bun:test'
import type { GitOps, PublishResult } from '../../../scripts/behavior-audit/publish-snapshot.js'
import { runPublish } from '../../../scripts/behavior-audit/publish-snapshot.js'

describe('publishSnapshot flow', () => {
  let tempStories: string
  let tempWorktree: string
  let recordedCommands: ReadonlyArray<readonly string[]>

  beforeEach(() => {
    tempStories = mkdtempSync(join(tmpdir(), 'stories-'))
    tempWorktree = mkdtempSync(join(tmpdir(), 'worktree-'))
    mkdirSync(tempStories, { recursive: true })
    writeFileSync(join(tempStories, 'index.md'), '# Audit\n')
    recordedCommands = []
  })

  afterEach(() => {
    rmSync(tempStories, { recursive: true, force: true })
    rmSync(tempWorktree, { recursive: true, force: true })
  })

  function makeFakeGitOps(): GitOps {
    return {
      async run(args: readonly string[]): Promise<void> {
        recordedCommands = [...recordedCommands, args]
      },
      async branchExists(): Promise<boolean> {
        return false
      },
      async checkoutOrphan(branch: string): Promise<void> {
        recordedCommands = [...recordedCommands, ['checkout', '--orphan', branch]]
      },
      async worktreePath(): Promise<string> {
        return tempWorktree
      },
    }
  }

  test('publishes snapshot to orphan branch on first run', async () => {
    const ops = makeFakeGitOps()
    const result: PublishResult = await runPublish({
      storiesPath: tempStories,
      dateStamp: '2026-07-19',
      gitOps: ops,
      log: { log: () => {}, error: () => {} },
    })
    expect(result.exitCode).toBe(0)
    expect(result.commitMessage).toBe('chore(audit): snapshot for 2026-07-19')
    const checkoutArgs = recordedCommands.find((cmd) => cmd[0] === 'checkout' && cmd[1] === '--orphan')
    expect(checkoutArgs).toBeDefined()
  })

  test('exits 1 when stories path is empty', async () => {
    rmSync(join(tempStories, 'index.md'), { force: true })
    const ops = makeFakeGitOps()
    const result = await runPublish({
      storiesPath: tempStories,
      dateStamp: '2026-07-19',
      gitOps: ops,
      log: { log: () => {}, error: () => {} },
    })
    expect(result.exitCode).toBe(1)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/scripts/behavior-audit/publish-snapshot.test.ts`
Expected: FAIL — `runPublish` and types `GitOps`, `PublishResult` do not exist.

- [ ] **Step 3: Extend the implementation**

Modify `scripts/behavior-audit/publish-snapshot.ts`. Replace the existing `publishSnapshot` function and add the types and `runPublish`:

```typescript
import { copyFile, mkdir, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

export interface GitOps {
  run(args: readonly string[]): Promise<void>
  branchExists(): Promise<boolean>
  checkoutOrphan(branch: string): Promise<void>
  worktreePath(): Promise<string>
}

export interface PublishDeps {
  readonly storiesPath: string
  readonly dateStamp: string
  readonly gitOps: GitOps
  readonly log: Pick<Console, 'log' | 'error'>
}

export interface PublishResult {
  readonly exitCode: number
  readonly commitMessage: string | null
}

export async function runPublish(input: PublishDeps): Promise<PublishResult> {
  let entries: readonly string[]
  try {
    entries = await readdir(input.storiesPath)
  } catch {
    input.log.error(`Error: no audit output to publish (${input.storiesPath} does not exist)`)
    return { exitCode: 1, commitMessage: null }
  }
  if (entries.length === 0) {
    input.log.error(`Error: no audit output to publish (${input.storiesPath} is empty)`)
    return { exitCode: 1, commitMessage: null }
  }

  const branch = resolveBranchName()
  const tag = resolveTagName()
  const commitMessage = buildCommitMessage(input.dateStamp)
  const worktreePath = await input.gitOps.worktreePath()

  // Clear existing stories in the worktree (handle first run where it doesn't exist yet)
  await rm(join(worktreePath, 'stories'), { recursive: true, force: true })
  await mkdir(join(worktreePath, 'stories'), { recursive: true })

  // Copy fresh stories into worktree
  for (const entry of entries) {
    await copyFile(join(input.storiesPath, entry), join(worktreePath, 'stories', entry))
  }

  // Stage, commit, move tag. The GitOps implementation handles the actual git calls.
  await input.gitOps.run(['add', 'stories'])
  await input.gitOps.run(['commit', '-m', commitMessage])
  await input.gitOps.run(['tag', '-f', tag, 'HEAD'])

  input.log.log(`Published ${entries.length} entries to ${branch} (tag ${tag}) at ${input.dateStamp}`)
  return { exitCode: 0, commitMessage }
}

class RealGitOps implements GitOps {
  constructor(
    private readonly worktree: string,
    private readonly branch: string,
  ) {}

  async run(args: readonly string[]): Promise<void> {
    const proc = Bun.spawn(['git', ...args], { cwd: this.worktree, stdout: 'pipe', stderr: 'pipe' })
    await proc.exited
  }

  async branchExists(): Promise<boolean> {
    const proc = Bun.spawn(['git', 'ls-remote', '--heads', 'origin', this.branch], {
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const out = await new Response(proc.stdout).text()
    await proc.exited
    return out.trim().length > 0
  }

  async checkoutOrphan(branch: string): Promise<void> {
    await this.run(['checkout', '--orphan', branch])
  }

  async worktreePath(): Promise<string> {
    return this.worktree
  }
}

async function publishSnapshotMain(): Promise<number> {
  const dateStamp = formatDateStamp(new Date())
  const branch = resolveBranchName()
  const worktree = process.env.BEHAVIOR_AUDIT_WORKTREE_DIR ?? '.audit-worktree'
  const ops = new RealGitOps(worktree, branch)
  const result = await runPublish({
    storiesPath: resolveStoriesPath(),
    dateStamp,
    gitOps: ops,
    log: console,
  })
  if (result.exitCode !== 0) return result.exitCode
  // Push the branch and tag (worktree-aware)
  const pushProc = Bun.spawn(
    ['git', 'push', '--force', 'origin', `${branch}:${branch}`, `refs/tags/${resolveTagName()}`],
    {
      stdout: 'inherit',
      stderr: 'inherit',
    },
  )
  await pushProc.exited
  return pushProc.exitCode === 0 ? 0 : 1
}

if (import.meta.main) {
  const exitCode = await publishSnapshotMain()
  process.exit(exitCode)
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test tests/scripts/behavior-audit/publish-snapshot.test.ts`
Expected: PASS (all 8 tests)

- [ ] **Step 5: Run typecheck**

Run: `bun typecheck`
Expected: exit 0

- [ ] **Step 6: Commit**

```bash
git add scripts/behavior-audit/publish-snapshot.ts tests/scripts/behavior-audit/publish-snapshot.test.ts
git commit -m "feat(behavior-audit): add git plumbing to publish-snapshot"
```

---

## Task 5: GitHub workflow file

**Files:**

- Create: `.github/workflows/behavior-audit.yml`

- [ ] **Step 1: Write the workflow**

Create `.github/workflows/behavior-audit.yml`. Use SHA-pinned action versions matching the existing `.github/workflows/ci.yml` conventions:

```yaml
name: Behavior Audit

on:
  schedule:
    - cron: '0 3 * * *'
  workflow_dispatch:

permissions:
  contents: write

concurrency:
  group: behavior-audit
  cancel-in-progress: false

jobs:
  audit:
    name: Nightly Behavior Audit
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0
      - uses: oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2.2.0
        with:
          bun-version: 1.3.13
      - name: Install dependencies
        run: bun install --frozen-lockfile
      - name: Preflight
        env:
          BEHAVIOR_AUDIT_BASE_URL: ${{ secrets.BEHAVIOR_AUDIT_BASE_URL }}
          BEHAVIOR_AUDIT_MODEL: ${{ secrets.BEHAVIOR_AUDIT_MODEL }}
          OPENAI_API_KEY: ${{ secrets.BEHAVIOR_AUDIT_API_KEY }}
        run: bun run scripts/behavior-audit/preflight.ts
      - name: Run audit
        env:
          BEHAVIOR_AUDIT_BASE_URL: ${{ secrets.BEHAVIOR_AUDIT_BASE_URL }}
          BEHAVIOR_AUDIT_MODEL: ${{ secrets.BEHAVIOR_AUDIT_MODEL }}
          OPENAI_API_KEY: ${{ secrets.BEHAVIOR_AUDIT_API_KEY }}
        run: bun audit:behavior
      - name: Configure git
        run: |
          git config --global user.name 'github-actions[bot]'
          git config --global user.email 'github-actions[bot]@users.noreply.github.com'
      - name: Publish snapshot
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          BEHAVIOR_AUDIT_WORKTREE_DIR: ${{ runner.temp }}/audit-worktree
        run: |
          mkdir -p "$BEHAVIOR_AUDIT_WORKTREE_DIR"
          git worktree add "$BEHAVIOR_AUDIT_WORKTREE_DIR" --detach
          bun run scripts/behavior-audit/publish-snapshot.ts
```

- [ ] **Step 2: Validate workflow YAML**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/behavior-audit.yml'))"`
Expected: no output, exit 0

- [ ] **Step 3: Run repo lint/format on the new files**

Run: `bun run format:check && bun run lint`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/behavior-audit.yml
git commit -m "ci(behavior-audit): add nightly workflow with preflight and publish"
```

---

## Task 6: Wire secrets and run manual smoke test

This task is operational, not code. It cannot be unit-tested; it validates the workflow end-to-end.

**Files:** none modified.

- [ ] **Step 1: Add GitHub repository secrets**

In the repo settings → Secrets and variables → Actions, add:

- `BEHAVIOR_AUDIT_BASE_URL` — e.g. `https://openrouter.ai/api/v1`
- `BEHAVIOR_AUDIT_MODEL` — e.g. `anthropic/claude-3.5-haiku`
- `BEHAVIOR_AUDIT_API_KEY` — the OpenRouter (or other gateway) API key

- [ ] **Step 2: Trigger the workflow manually**

In the Actions UI, select "Behavior Audit" → "Run workflow". Watch the run.

Expected: workflow completes successfully within 90 minutes; `audit-output` branch created with first commit; `audit-output-latest` tag points at that commit.

- [ ] **Step 3: Verify the published snapshot**

Run locally:

```bash
git fetch origin audit-output audit-output-latest
git show audit-output-latest:stories/index.md | head -50
git log audit-output --oneline -5
```

Expected: non-empty markdown listing domains and summary stats; at least one commit on `audit-output`.

- [ ] **Step 4: Document the secrets in the repo**

Append a "Behavior audit secrets" section to `docs/architecture/environment.md` (or create a small section in `docs/architecture/behaviors.md` if no env doc) listing the three required secrets and their purpose.

```bash
git add docs/architecture/environment.md
git commit -m "docs(architecture): document behavior-audit CI secrets"
```

---

## Task 7: Final verification

- [ ] **Step 1: Run full check suite**

Run: `bun check:full`
Expected: PASS (lint, typecheck, format:check, knip, test, duplicates, review-loop:\*)

- [ ] **Step 2: Confirm no audit-pipeline files were modified**

Run: `git diff master -- scripts/behavior-audit/ ':!scripts/behavior-audit/preflight.ts' ':!scripts/behavior-audit/publish-snapshot.ts'`
Expected: no output (only the two new orchestration files were added).

---

## Self-Review Checklist

**Spec coverage:**

- ✅ Nightly cron (workflow `Task 5`)
- ✅ `workflow_dispatch` manual trigger (`Task 5`)
- ✅ External gateway via secrets (`Task 5`, `Task 6`)
- ✅ No GPU/state (`Task 5` — `ubuntu-latest`)
- ✅ Preflight script (`Task 1`, `Task 2`)
- ✅ Publish-snapshot script (`Task 3`, `Task 4`)
- ✅ Orphan branch with `audit-output-latest` tag (`Task 4`, `Task 5`)
- ✅ No audit-code modifications (verified `Task 7 Step 2`)

**Placeholder scan:** none — every step has exact code and exact commands.

**Type consistency:** `GitOps`, `PublishResult`, `PublishDeps` defined in `Task 4 Step 3` and used consistently in tests.

**Scope check:** single focused plan producing Tier 1 in its entirety.

## References

- Spec: `docs/superpowers/specs/2026-07-19-behavior-audit-close-the-loop-design.md`
- Tier 2 plan: `docs/superpowers/plans/2026-07-19-behavior-audit-concurrency-grep-implementation.md`
- Tier 3 plan: `docs/superpowers/plans/2026-07-19-behavior-audit-relative-scoring-closure-implementation.md`
