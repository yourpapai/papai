# Codeindex Portability And Test Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make external `codeindex` integration reproducible from a clean `papai` clone and fix the leaking `message-queue` Bun module mock reset.

**Architecture:** Add a small repo-owned `codeindex` wrapper under `scripts/` that resolves the external repo from `CODEINDEX_DIR` or the canonical sibling checkout `../codeindex`, then route all `papai` process-based `codeindex` entrypoints through that wrapper. Keep `codeindex` package imports deterministic by switching the dependency to `file:../codeindex`, and fix the mock leak by restoring `../src/message-queue/index.js` from the global preload before each test.

**Tech Stack:** Bun, TypeScript, `node:path`, `node:fs`, `node:child_process`, JSON config files, Bun test runner.

**Spec:** `docs/superpowers/specs/2026-05-14-codeindex-portability-and-test-isolation-design.md`

**Execution Note:** Commit steps are included for teams that want granular history. During actual execution, only run the commit steps if the user has explicitly asked for commits in that session.

---

## Scope Check

This should stay as one implementation plan. The wrapper, package dependency, JSON config rewiring, plugin process rewiring, and the preload restoration bug all serve the same portability-and-isolation goal. Splitting them would make later tasks guess command shapes and verification expectations.

## File Structure

- Create: `scripts/codeindex-cli-support.ts`
  Pure path resolution and spawn-spec helpers for the external `codeindex` CLI.
- Create: `scripts/codeindex-cli.ts`
  Thin Bun entrypoint that delegates to `codeindex` with inherited stdio and actionable missing-repo errors.
- Create: `tests/scripts/codeindex-cli.test.ts`
  Deterministic tests for sibling-path defaulting, `CODEINDEX_DIR` override, missing-repo failure messaging, and wrapper spawn behavior.
- Create: `tests/scripts/codeindex-portability.test.ts`
  Regression coverage for package/config/plugin/doc surfaces so absolute paths and `link:codeindex` do not return.
- Modify: `package.json`
  Switch `codeindex` dev dependency to `file:../codeindex` and route codeindex scripts through the wrapper.
- Modify: `bun.lock`
  Refresh lockfile after the dependency source change.
- Modify: `.mcp.json`
  Route MCP startup through `scripts/codeindex-cli.ts`.
- Modify: `opencode.json`
  Route OpenCode MCP startup through `scripts/codeindex-cli.ts`.
- Modify: `.opencode/plugins/codeindex-reindex.ts`
  Spawn the wrapper instead of a machine-specific external path.
- Modify: `.pi/extensions/codeindex-reindex/index.ts`
  Reuse the wrapper for the parallel reindex extension so both integration surfaces stay consistent.
- Modify: `docs/guides/codeindex-verification.md`
  Replace absolute-path CLI examples and remedies with wrapper-based commands and `CODEINDEX_DIR` guidance.
- Modify: `tests/mock-reset.ts`
  Restore `../src/message-queue/index.js` before each test.
- Modify: `tests/index.test.ts`
  Add a regression that proves the real `message-queue` module surface comes back after a prior mocked test.

---

### Task 1: Add A Portable Codeindex Wrapper

**Files:**

- Create: `tests/scripts/codeindex-cli.test.ts`
- Create: `scripts/codeindex-cli-support.ts`
- Create: `scripts/codeindex-cli.ts`

- [ ] **Step 1: Write the failing wrapper tests**

Create `tests/scripts/codeindex-cli.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test'

import { buildCodeindexSpawnSpec, resolveCodeindexPaths } from '../../scripts/codeindex-cli-support.js'
import { runCodeindexCli } from '../../scripts/codeindex-cli.js'

describe('codeindex CLI support', () => {
  test('defaults to sibling ../codeindex when CODEINDEX_DIR is unset', () => {
    const result = resolveCodeindexPaths({
      repoRoot: '/tmp/yourpapai/papai',
      env: {},
      pathExists: (filePath) =>
        filePath === '/tmp/yourpapai/codeindex/package.json' || filePath === '/tmp/yourpapai/codeindex/src/cli.ts',
    })

    expect(result).toEqual({
      repoDir: '/tmp/yourpapai/codeindex',
      cliPath: '/tmp/yourpapai/codeindex/src/cli.ts',
    })
  })

  test('prefers CODEINDEX_DIR when provided', () => {
    const result = resolveCodeindexPaths({
      repoRoot: '/tmp/yourpapai/papai',
      env: { CODEINDEX_DIR: '/opt/tools/codeindex' },
      pathExists: (filePath) =>
        filePath === '/opt/tools/codeindex/package.json' || filePath === '/opt/tools/codeindex/src/cli.ts',
    })

    expect(result).toEqual({
      repoDir: '/opt/tools/codeindex',
      cliPath: '/opt/tools/codeindex/src/cli.ts',
    })
  })

  test('throws an actionable error when the repo is missing', () => {
    expect(() =>
      resolveCodeindexPaths({
        repoRoot: '/tmp/yourpapai/papai',
        env: {},
        pathExists: () => false,
      }),
    ).toThrow('Set CODEINDEX_DIR or clone the sibling repo at ../codeindex')
  })

  test('builds a bun run spawn spec for delegated subcommands', () => {
    const result = buildCodeindexSpawnSpec(['stats'], {
      repoRoot: '/tmp/yourpapai/papai',
      env: {},
      pathExists: (filePath) =>
        filePath === '/tmp/yourpapai/codeindex/package.json' || filePath === '/tmp/yourpapai/codeindex/src/cli.ts',
    })

    expect(result).toEqual({
      command: 'bun',
      args: ['run', '/tmp/yourpapai/codeindex/src/cli.ts', 'stats'],
      cwd: '/tmp/yourpapai/papai',
      repoDir: '/tmp/yourpapai/codeindex',
      cliPath: '/tmp/yourpapai/codeindex/src/cli.ts',
    })
  })
})

describe('runCodeindexCli', () => {
  test('spawns bun with inherited stdio and returns the child exit code', async () => {
    const spawnCalls: Array<{ command: string; args: string[]; cwd: string; stdio: string }> = []

    const exitCode = await runCodeindexCli(['reindex'], {
      repoRoot: '/tmp/yourpapai/papai',
      env: {},
      pathExists: (filePath) =>
        filePath === '/tmp/yourpapai/codeindex/package.json' || filePath === '/tmp/yourpapai/codeindex/src/cli.ts',
      spawnChild: (command, args, options) => {
        spawnCalls.push({
          command,
          args: [...args],
          cwd: options.cwd,
          stdio: options.stdio,
        })

        return {
          once(event, handler) {
            if (event === 'exit') handler(0)
            return this
          },
        } as unknown as ReturnType<typeof import('node:child_process').spawn>
      },
      writeStderr: () => undefined,
    })

    expect(exitCode).toBe(0)
    expect(spawnCalls).toEqual([
      {
        command: 'bun',
        args: ['run', '/tmp/yourpapai/codeindex/src/cli.ts', 'reindex'],
        cwd: '/tmp/yourpapai/papai',
        stdio: 'inherit',
      },
    ])
  })
})
```

- [ ] **Step 2: Run the wrapper tests and confirm they fail**

Run:

```bash
bun test tests/scripts/codeindex-cli.test.ts
```

Expected: FAIL because `../../scripts/codeindex-cli-support.js` and `../../scripts/codeindex-cli.js` do not exist yet.

- [ ] **Step 3: Implement the shared path resolver and Bun wrapper**

Create `scripts/codeindex-cli-support.ts`:

```typescript
import { existsSync } from 'node:fs'
import path from 'node:path'

export interface CodeindexResolutionInput {
  readonly repoRoot?: string
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly pathExists?: (filePath: string) => boolean
}

export interface ResolvedCodeindexPaths {
  readonly repoDir: string
  readonly cliPath: string
}

export interface CodeindexSpawnSpec extends ResolvedCodeindexPaths {
  readonly command: 'bun'
  readonly args: readonly string[]
  readonly cwd: string
}

const DEFAULT_REPO_ROOT = path.resolve(import.meta.dir, '..')

const requiredPaths = (repoDir: string): Readonly<{ packageJsonPath: string; cliPath: string }> => ({
  packageJsonPath: path.join(repoDir, 'package.json'),
  cliPath: path.join(repoDir, 'src', 'cli.ts'),
})

export const resolveCodeindexPaths = (input: CodeindexResolutionInput = {}): ResolvedCodeindexPaths => {
  const repoRoot = input.repoRoot ?? DEFAULT_REPO_ROOT
  const env = input.env ?? process.env
  const pathExists = input.pathExists ?? existsSync
  const configuredDir = env['CODEINDEX_DIR']?.trim()
  const repoDir = path.resolve(
    configuredDir === undefined || configuredDir === '' ? path.join(repoRoot, '..', 'codeindex') : configuredDir,
  )
  const { packageJsonPath, cliPath } = requiredPaths(repoDir)

  if (!pathExists(packageJsonPath) || !pathExists(cliPath)) {
    throw new Error(
      [`codeindex repo not found at ${repoDir}`, 'Set CODEINDEX_DIR or clone the sibling repo at ../codeindex'].join(
        '\n',
      ),
    )
  }

  return { repoDir, cliPath }
}

export const buildCodeindexSpawnSpec = (
  argv: readonly string[],
  input: CodeindexResolutionInput = {},
): CodeindexSpawnSpec => {
  const repoRoot = input.repoRoot ?? DEFAULT_REPO_ROOT
  const { repoDir, cliPath } = resolveCodeindexPaths({ ...input, repoRoot })

  return {
    command: 'bun',
    args: ['run', cliPath, ...argv],
    cwd: repoRoot,
    repoDir,
    cliPath,
  }
}
```

Create `scripts/codeindex-cli.ts`:

```typescript
import { spawn } from 'node:child_process'

import { buildCodeindexSpawnSpec, type CodeindexResolutionInput } from './codeindex-cli-support.js'

export interface RunCodeindexCliDeps extends CodeindexResolutionInput {
  readonly spawnChild?: typeof spawn
  readonly writeStderr?: (message: string) => void
}

export const runCodeindexCli = async (argv: readonly string[], deps: RunCodeindexCliDeps = {}): Promise<number> => {
  const spawnChild = deps.spawnChild ?? spawn
  const writeStderr = deps.writeStderr ?? ((message: string) => process.stderr.write(message))

  let spec
  try {
    spec = buildCodeindexSpawnSpec(argv, deps)
  } catch (error) {
    writeStderr(`${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }

  return await new Promise<number>((resolve, reject) => {
    const child = spawnChild(spec.command, [...spec.args], {
      cwd: spec.cwd,
      stdio: 'inherit',
    })

    child.once('error', reject)
    child.once('exit', (code) => {
      resolve(code ?? 1)
    })
  })
}

if (import.meta.main) {
  const exitCode = await runCodeindexCli(process.argv.slice(2))
  process.exit(exitCode)
}
```

- [ ] **Step 4: Run the wrapper tests and confirm they pass**

Run:

```bash
bun test tests/scripts/codeindex-cli.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the wrapper task**

```bash
git add tests/scripts/codeindex-cli.test.ts scripts/codeindex-cli-support.ts scripts/codeindex-cli.ts
git commit -m "build: add portable codeindex wrapper"
```

---

### Task 2: Rewire Repo Surfaces To The Portable Wrapper

**Files:**

- Create: `tests/scripts/codeindex-portability.test.ts`
- Modify: `package.json`
- Modify: `bun.lock`
- Modify: `.mcp.json`
- Modify: `opencode.json`
- Modify: `.opencode/plugins/codeindex-reindex.ts`
- Modify: `.pi/extensions/codeindex-reindex/index.ts`
- Modify: `docs/guides/codeindex-verification.md`

- [ ] **Step 1: Write the failing portability regression test**

Create `tests/scripts/codeindex-portability.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const REPO_ROOT = path.resolve(import.meta.dir, '../..')

const readRepoFile = (relativePath: string): string => readFileSync(path.join(REPO_ROOT, relativePath), 'utf8')

describe('codeindex portability wiring', () => {
  test('uses a declared local dependency instead of hidden bun link state', () => {
    const packageJson = readRepoFile('package.json')

    expect(packageJson).toContain('"codeindex": "file:../codeindex"')
    expect(packageJson).not.toContain('"codeindex": "link:codeindex"')
    expect(packageJson).toContain('"codeindex:index": "bun run scripts/codeindex-cli.ts index"')
    expect(packageJson).toContain('"codeindex:reindex": "bun run scripts/codeindex-cli.ts reindex"')
    expect(packageJson).toContain('"codeindex:stats": "bun run scripts/codeindex-cli.ts stats"')
  })

  test('routes config and extensions through the wrapper without absolute codeindex paths', () => {
    const mcpConfig = readRepoFile('.mcp.json')
    const openCodeConfig = readRepoFile('opencode.json')
    const reindexPlugin = readRepoFile('.opencode/plugins/codeindex-reindex.ts')
    const piExtension = readRepoFile('.pi/extensions/codeindex-reindex/index.ts')

    expect(mcpConfig).toContain('"scripts/codeindex-cli.ts"')
    expect(openCodeConfig).toContain('"scripts/codeindex-cli.ts"')
    expect(reindexPlugin).toContain("['run', 'scripts/codeindex-cli.ts', 'reindex']")
    expect(piExtension).toContain("['run', 'scripts/codeindex-cli.ts', 'reindex']")

    const staleAbsolutePath = '/Users/ki/Projects/papai/codeindex/src/cli.ts'
    expect(mcpConfig).not.toContain(staleAbsolutePath)
    expect(openCodeConfig).not.toContain(staleAbsolutePath)
    expect(reindexPlugin).not.toContain(staleAbsolutePath)
    expect(readRepoFile('docs/guides/codeindex-verification.md')).not.toContain(staleAbsolutePath)
  })

  test('documents wrapper usage and CODEINDEX_DIR remediation', () => {
    const verificationGuide = readRepoFile('docs/guides/codeindex-verification.md')

    expect(verificationGuide).toContain('bun run scripts/codeindex-cli.ts stats')
    expect(verificationGuide).toContain('CODEINDEX_DIR')
    expect(verificationGuide).toContain('clone the sibling repo at ../codeindex')
  })
})
```

- [ ] **Step 2: Run the portability test and confirm it fails**

Run:

```bash
bun test tests/scripts/codeindex-portability.test.ts
```

Expected: FAIL because the repo still references `link:codeindex`, absolute `codeindex` paths, and stale verification commands.

- [ ] **Step 3: Rewire package, configs, extensions, and docs**

Update `package.json`:

```json
{
  "scripts": {
    "codeindex:index": "bun run scripts/codeindex-cli.ts index",
    "codeindex:reindex": "bun run scripts/codeindex-cli.ts reindex",
    "codeindex:stats": "bun run scripts/codeindex-cli.ts stats"
  },
  "devDependencies": {
    "codeindex": "file:../codeindex"
  }
}
```

Update `.mcp.json`:

```json
{
  "mcpServers": {
    "codeindex": {
      "command": "bun",
      "args": ["run", "scripts/codeindex-cli.ts", "mcp"],
      "cwd": ".",
      "lifecycle": "lazy",
      "directTools": true
    }
  }
}
```

Update `opencode.json`:

```json
{
  "mcp": {
    "codeindex": {
      "type": "local",
      "enabled": true,
      "command": ["bun", "run", "scripts/codeindex-cli.ts", "mcp"]
    }
  }
}
```

Update `.opencode/plugins/codeindex-reindex.ts`:

```typescript
const timeout = setTimeout(() => {
  debounceMap.delete(sessionID)
  const child = spawn('bun', ['run', 'scripts/codeindex-cli.ts', 'reindex'], {
    cwd: directory,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  })
  child.unref()
  child.stdout?.on('data', () => undefined)
  child.stderr?.on('data', () => undefined)
}, 600)
```

Update `.pi/extensions/codeindex-reindex/index.ts`:

```typescript
const defaultDeps: ReindexDeps = {
  schedule: (delayMs, run) => setTimeout(run, delayMs),
  cancel: (token) => {
    clearTimeout(token)
  },
  spawnReindex: (cwd) => {
    const child = spawn('bun', ['run', 'scripts/codeindex-cli.ts', 'reindex'], {
      cwd,
      stdio: 'ignore',
      detached: true,
    })
    child.unref()
  },
  toRelativePath: (filePath, cwd) => (filePath.startsWith('/') ? filePath.slice(`${cwd}/`.length) : filePath),
  getExtension: (filePath) => {
    const dotIndex = filePath.lastIndexOf('.')
    if (dotIndex < 0) return ''
    return filePath.slice(dotIndex)
  },
}
```

Update `docs/guides/codeindex-verification.md` command examples and remedies to use wrapper commands such as:

```bash
bun run scripts/codeindex-cli.ts stats
printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}\n' | timeout 5 bun run scripts/codeindex-cli.ts mcp
bun run scripts/codeindex-cli.ts symbol "makeCreateTaskTool"
```

and update failure remedies to mention:

```text
Set CODEINDEX_DIR or clone the sibling repo at ../codeindex
```

Then refresh the lockfile:

```bash
bun install
```

- [ ] **Step 4: Run the portability regressions and targeted smoke checks**

Run:

```bash
bun test tests/scripts/codeindex-cli.test.ts tests/scripts/codeindex-portability.test.ts
bun run codeindex:stats
```

Expected: both test files PASS, and `bun run codeindex:stats` prints JSON stats using the sibling `../codeindex` checkout or `CODEINDEX_DIR` override.

- [ ] **Step 5: Commit the portability rewiring task**

```bash
git add tests/scripts/codeindex-portability.test.ts package.json bun.lock .mcp.json opencode.json .opencode/plugins/codeindex-reindex.ts .pi/extensions/codeindex-reindex/index.ts docs/guides/codeindex-verification.md
git commit -m "build: make codeindex integration portable"
```

---

### Task 3: Restore The Real Message Queue Module Between Tests

**Files:**

- Modify: `tests/index.test.ts`
- Modify: `tests/mock-reset.ts`

- [ ] **Step 1: Add the failing regression that proves the preload reset is incomplete**

Append this test to `tests/index.test.ts` after the existing mocked-startup test:

```typescript
test('global preload restores the real message queue module before the next test', async () => {
  const messageQueueModule = await import(`../src/message-queue/index.js?post-reset=${crypto.randomUUID()}`)

  expect('registry' in messageQueueModule).toBe(true)
  expect(typeof messageQueueModule.cleanupExpiredQueues).toBe('function')
  expect(typeof messageQueueModule.flushOnShutdown).toBe('function')
})
```

- [ ] **Step 2: Run the regression and confirm it fails**

Run:

```bash
bun test tests/index.test.ts
```

Expected: FAIL on the new test because the prior `mock.module('../src/message-queue/index.js', ...)` override is still active and the imported module lacks `registry` and `cleanupExpiredQueues`.

- [ ] **Step 3: Restore the real message-queue module from the preload**

Update `tests/mock-reset.ts` imports:

```typescript
import * as _messageQueueIndex from '../src/message-queue/index.js'
```

and extend `originals`:

```typescript
const originals: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
  ['../src/logger.js', { ..._logger }],
  ['../src/message-cache/cache.js', { ..._messageCache }],
  ['../src/message-queue/index.js', { ..._messageQueueIndex }],
  ['../src/providers/kaneo/provision.js', { ..._provision }],
  ['../src/chat/interaction-router.js', { ..._interactionRouter }],
  ['ai', { ..._ai }],
  ['@ai-sdk/openai-compatible', { ..._openaiCompat }],
  ['../src/announcements.js', { ..._announcements }],
  ['../src/attachments/index.js', { ..._attachmentsIndex }],
  ['../src/attachments/staged-download.js', { ..._stagedDownload }],
  ['../src/bot.js', { ..._bot }],
  ['../src/chat/mattermost/index.js', { ..._chatMattermost }],
  ['../src/chat/registry.js', { ..._chatRegistry }],
  ['../src/chat/startup.js', { ..._chatStartup }],
  ['../src/chat/telegram/index.js', { ..._chatTelegram }],
  ['../src/db/drizzle.js', { ..._dbDrizzle }],
  ['../src/db/index.js', { ..._dbIndex }],
  ['../src/deferred-prompts/poller.js', { ..._poller }],
  ['../src/message-cache/index.js', { ..._messageCacheIndex }],
  ['../src/providers/factory.js', { ..._providersFactory }],
  ['../src/scheduler.js', { ..._scheduler }],
  ['../src/scheduler-instance.js', { ..._schedulerInstance }],
  ['../src/users.js', { ..._users }],
]
```

- [ ] **Step 4: Run the regression and the existing queue tests**

Run:

```bash
bun test tests/index.test.ts tests/message-queue/index.test.ts
```

Expected: PASS. The new regression sees `registry` and `cleanupExpiredQueues`, and the existing `message-queue` tests still pass against the real implementation.

- [ ] **Step 5: Commit the preload restoration task**

```bash
git add tests/index.test.ts tests/mock-reset.ts
git commit -m "test: restore message queue preload mocks"
```

---

## Final Verification

- [ ] Run the focused portability and preload regressions:

```bash
bun test tests/scripts/codeindex-cli.test.ts tests/scripts/codeindex-portability.test.ts tests/index.test.ts tests/message-queue/index.test.ts
```

Expected: PASS.

- [ ] Run repository checks most likely to catch portability breakage:

```bash
bun run typecheck
bun run format:check
```

Expected: PASS.

- [ ] Run the wrapper manually with both default and override resolution if both are available locally:

```bash
bun run scripts/codeindex-cli.ts stats
CODEINDEX_DIR="/absolute/path/to/codeindex" bun run scripts/codeindex-cli.ts stats
```

Expected: both commands print `codeindex` stats JSON; the second proves the env override path still works.

---

## Self-Review

- Spec coverage: wrapper creation, dependency rewiring, config/plugin/doc updates, sibling default, `CODEINDEX_DIR` override, and mock-reset restoration all map to explicit tasks.
- Placeholder scan: no `TODO`, `TBD`, or “similar to above” instructions remain.
- Type consistency: the plan uses the same `resolveCodeindexPaths`, `buildCodeindexSpawnSpec`, and `runCodeindexCli` names throughout.
