<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Silent PostToolUse + Stop-Gated Full Check — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate per-edit token cost from PostToolUse hooks by shifting all quality enforcement to a single Stop hook that runs `bun check:full`.

**Architecture:** PostToolUse becomes lightweight (only static checks). A new Stop hook runs `bun check:full` when the LLM finishes. A session-scoped `needsRecheck` flag coordinates PreToolUse and Stop to provide an escape hatch for user interrupts.

**Tech Stack:** Node.js (ESM `.mjs`), Bun test runner, `execFileSync` for check execution.

---

## File Structure

| File                                                 | Action | Responsibility                                           |
| ---------------------------------------------------- | ------ | -------------------------------------------------------- |
| `.hooks/tdd/session-state.mjs`                       | Modify | Add `needsRecheck` field with getter/setter              |
| `.hooks/tdd/checks/check-full.mjs`                   | Modify | Parse output into concise failure summary                |
| `.hooks/tdd/checks/parse-check-output.mjs`           | Create | Extract structured failure data from `check:full` output |
| `.claude/hooks/stop.mjs`                             | Create | Stop hook orchestrator                                   |
| `.claude/hooks/pre-tool-use.mjs`                     | Modify | Remove baseline/surface, add `setNeedsRecheck(true)`     |
| `.claude/hooks/post-tool-use.mjs`                    | Modify | Remove test run and surface diff                         |
| `.claude/settings.json`                              | Modify | Register Stop hook                                       |
| `.hooks/tests/tdd/session-state.test.ts`             | Modify | Add tests for `needsRecheck`                             |
| `.hooks/tests/tdd/checks/parse-check-output.test.ts` | Create | Test output parser                                       |
| `.hooks/tests/tdd/checks/check-full.test.ts`         | Create | Test check-full summary format                           |

---

### Task 1: Add `needsRecheck` to SessionState

**Files:**

- Modify: `.hooks/tdd/session-state.mjs`
- Test: `.hooks/tests/tdd/session-state.test.ts`

- [ ] **Step 1: Write the failing tests**

Add these tests to the existing `SessionState` describe block in `.hooks/tests/tdd/session-state.test.ts`:

```ts
test('getNeedsRecheck returns true initially', () => {
  const state = new SessionState('recheck-init', tempDir)
  expect(state.getNeedsRecheck()).toBe(true)
})

test('setNeedsRecheck persists false', () => {
  const state = new SessionState('recheck-set', tempDir)
  state.setNeedsRecheck(false)
  expect(state.getNeedsRecheck()).toBe(false)
})

test('setNeedsRecheck persists true after being set to false', () => {
  const state = new SessionState('recheck-toggle', tempDir)
  state.setNeedsRecheck(false)
  state.setNeedsRecheck(true)
  expect(state.getNeedsRecheck()).toBe(true)
})

test('needsRecheck survives reload', () => {
  const sessionId = 'recheck-persist'
  const first = new SessionState(sessionId, tempDir)
  first.setNeedsRecheck(false)

  const second = new SessionState(sessionId, tempDir)
  expect(second.getNeedsRecheck()).toBe(false)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test .hooks/tests/tdd/session-state.test.ts`
Expected: FAIL — `state.getNeedsRecheck is not a function`

- [ ] **Step 3: Implement `needsRecheck` in SessionState**

In `.hooks/tdd/session-state.mjs`, add `needsRecheck: true` to the `#createEmptyState()` return value (at `.hooks/tdd/session-state.mjs:96-103`):

```js
  #createEmptyState() {
    return {
      writtenTests: [],
      pendingFailure: null,
      surfaceSnapshots: new Map(),
      mutationSnapshots: new Map(),
      sessionMutationBaseline: null,
      needsRecheck: true,
    }
  }
```

Add getter and setter methods after `clearPendingFailure()` (after `.hooks/tdd/session-state.mjs:160-164`):

```js
  getNeedsRecheck() {
    this.#ensureLoaded()
    return this.#state.needsRecheck
  }

  setNeedsRecheck(value) {
    this.#ensureLoaded()
    this.#state.needsRecheck = value
    this.#persist()
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test .hooks/tests/tdd/session-state.test.ts`
Expected: PASS — all tests green

- [ ] **Step 5: Commit**

```bash
git add .hooks/tdd/session-state.mjs .hooks/tests/tdd/session-state.test.ts
git commit -m "feat(hooks): add needsRecheck flag to SessionState"
```

---

### Task 2: Create check output parser

**Files:**

- Create: `.hooks/tdd/checks/parse-check-output.mjs`
- Create: `.hooks/tests/tdd/checks/parse-check-output.test.ts`

The parser extracts structured failure info from `bun check:full` output. The output format from `scripts/check.sh` looks like:

```
✗ lint failed (exit code 1):
---
<file paths and error details>
---

✗ test failed (exit code 1):
---
<test failure details>
---

Summary of executed checks:
✓ typecheck
✓ format:check
✗ lint
✗ test

2/4 checks passed, 2 failed
```

- [ ] **Step 1: Write the failing tests**

Create `.hooks/tests/tdd/checks/parse-check-output.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'

import { parseCheckOutput } from '../../tdd/checks/parse-check-output.mjs'

describe('parseCheckOutput', () => {
  test('returns null for empty output', () => {
    expect(parseCheckOutput('')).toBeNull()
  })

  test('returns null when all checks pass', () => {
    const output = [
      '',
      'Summary of executed checks:',
      '✓ lint',
      '✓ typecheck',
      '✓ format:check',
      '✓ knip',
      '✓ test',
      '✓ test:client',
      '✓ duplicates',
      '',
      '7/7 checks passed, 0 failed',
    ].join('\n')
    expect(parseCheckOutput(output)).toBeNull()
  })

  test('extracts single failed check with files', () => {
    const output = [
      '✗ lint failed (exit code 1):',
      '---',
      'src/foo.ts:10:5  Error: Unexpected any. (no-implicit-any)',
      'src/bar.ts:20:1  Error: Unused variable. (no-unused-vars)',
      '---',
      '',
      'Summary of executed checks:',
      '✗ lint',
      '',
      '0/1 checks passed, 1 failed',
    ].join('\n')
    const result = parseCheckOutput(output)
    expect(result).not.toBeNull()
    expect(result).toEqual([{ check: 'lint', files: ['src/foo.ts', 'src/bar.ts'] }])
  })

  test('extracts multiple failed checks', () => {
    const output = [
      '✗ lint failed (exit code 1):',
      '---',
      'src/a.ts:1:1  Error',
      '---',
      '✗ typecheck failed (exit code 1):',
      '---',
      'src/b.ts(10,5): error TS2345: Argument of type',
      '---',
      '',
      'Summary of executed checks:',
      '✗ lint',
      '✗ typecheck',
      '',
      '0/2 checks passed, 2 failed',
    ].join('\n')
    const result = parseCheckOutput(output)
    expect(result).toEqual([
      { check: 'lint', files: ['src/a.ts'] },
      { check: 'typecheck', files: ['src/b.ts'] },
    ])
  })

  test('deduplicates files within a check', () => {
    const output = [
      '✗ lint failed (exit code 1):',
      '---',
      'src/foo.ts:1:1  Error 1',
      'src/foo.ts:2:1  Error 2',
      'src/bar.ts:3:1  Error 3',
      '---',
      '',
      'Summary of executed checks:',
      '✗ lint',
      '',
      '0/1 checks passed, 1 failed',
    ].join('\n')
    const result = parseCheckOutput(output)
    expect(result).toEqual([{ check: 'lint', files: ['src/bar.ts', 'src/foo.ts'] }])
  })

  test('handles failed check with no parseable files', () => {
    const output = [
      '✗ knip failed (exit code 1):',
      '---',
      'Unused exports:',
      '  some-symbol',
      '---',
      '',
      'Summary of executed checks:',
      '✗ knip',
      '',
      '0/1 checks passed, 1 failed',
    ].join('\n')
    const result = parseCheckOutput(output)
    expect(result).toEqual([{ check: 'knip', files: [] }])
  })

  test('handles test failures with file paths in bun test output', () => {
    const output = [
      '✗ test failed (exit code 1):',
      '---',
      '✗ tests/unit/foo.test.ts > foo > should work',
      '✗ tests/unit/bar.test.ts > bar > should fail',
      '---',
      '',
      'Summary of executed checks:',
      '✗ test',
      '',
      '0/1 checks passed, 1 failed',
    ].join('\n')
    const result = parseCheckOutput(output)
    expect(result).toEqual([{ check: 'test', files: ['tests/unit/bar.test.ts', 'tests/unit/foo.test.ts'] }])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test .hooks/tests/tdd/checks/parse-check-output.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the parser**

Create `.hooks/tdd/checks/parse-check-output.mjs`:

```js
const FILE_PATH_PATTERN = /^((?:src|tests|client)\/[^\s:,(]+)/m

const SECTION_RE = /^✗ (\S+) failed \(exit code \d+\):\n---\n([\s\S]*?)\n---/gm

/**
 * @typedef {Object} CheckFailure
 * @property {string} check
 * @property {string[]} files
 */

/**
 * @param {string} output
 * @returns {CheckFailure[] | null}
 */
export function parseCheckOutput(output) {
  if (!output) return null

  const failures = []
  let match

  while ((match = SECTION_RE.exec(output)) !== null) {
    const check = match[1]
    const body = match[2]
    const files = new Set()

    for (const line of body.split('\n')) {
      FILE_PATH_PATTERN.lastIndex = 0
      const fileMatch = FILE_PATH_PATTERN.exec(line)
      if (fileMatch) {
        files.add(fileMatch[1])
      }
    }

    failures.push({ check, files: [...files].sort() })
  }

  if (failures.length === 0) return null
  return failures
}
```

Note: the `FILE_PATH_PATTERN` regex matches lines starting with paths under `src/`, `tests/`, or `client/` — the project's source directories. The `SECTION_RE` regex captures each `✗ <check> failed` block delimited by `---` separators, matching the format produced by `scripts/check.sh`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test .hooks/tests/tdd/checks/parse-check-output.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add .hooks/tdd/checks/parse-check-output.mjs .hooks/tests/tdd/checks/parse-check-output.test.ts
git commit -m "feat(hooks): add check output parser for concise failure summaries"
```

---

### Task 3: Rework check-full to produce concise summaries

**Files:**

- Modify: `.hooks/tdd/checks/check-full.mjs`
- Create: `.hooks/tests/tdd/checks/check-full.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `.hooks/tests/tdd/checks/check-full.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'

import { formatCheckResult } from '../../tdd/checks/check-full.mjs'

describe('formatCheckResult', () => {
  test('formats single failure', () => {
    const result = formatCheckResult([{ check: 'lint', files: ['src/foo.ts', 'src/bar.ts'] }])
    expect(result).toBe(
      '`bun check:full` found issues. Fix before stopping:\n\n' +
        '- lint: 2 files (src/foo.ts, src/bar.ts)\n\n' +
        'Run `bun check:full` for details.',
    )
  })

  test('formats multiple failures', () => {
    const result = formatCheckResult([
      { check: 'lint', files: ['src/a.ts'] },
      { check: 'typecheck', files: ['src/b.ts'] },
      { check: 'test', files: ['tests/c.test.ts', 'tests/d.test.ts'] },
    ])
    expect(result).toBe(
      '`bun check:full` found issues. Fix before stopping:\n\n' +
        '- lint: 1 file (src/a.ts)\n' +
        '- typecheck: 1 file (src/b.ts)\n' +
        '- test: 2 files (tests/c.test.ts, tests/d.test.ts)\n\n' +
        'Run `bun check:full` for details.',
    )
  })

  test('formats failure with no parseable files', () => {
    const result = formatCheckResult([{ check: 'knip', files: [] }])
    expect(result).toBe(
      '`bun check:full` found issues. Fix before stopping:\n\n' +
        '- knip: issues found (no file paths detected)\n\n' +
        'Run `bun check:full` for details.',
    )
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test .hooks/tests/tdd/checks/check-full.test.ts`
Expected: FAIL — `formatCheckResult is not exported`

- [ ] **Step 3: Add `formatCheckResult` and update `checkFull`**

In `.hooks/tdd/checks/check-full.mjs`, add the import and new function, then update `checkFull` to use the parser:

```js
import { execFileSync } from 'node:child_process'

import { parseCheckOutput } from './parse-check-output.mjs'

export function formatCheckResult(failures) {
  const lines = failures.map(({ check, files }) => {
    if (files.length === 0) {
      return `- ${check}: issues found (no file paths detected)`
    }
    const label = files.length === 1 ? 'file' : 'files'
    return `- ${check}: ${files.length} ${label} (${files.join(', ')})`
  })

  return (
    '`bun check:full` found issues. Fix before stopping:\n\n' +
    lines.join('\n') +
    '\n\nRun `bun check:full` for details.'
  )
}

export function checkFull(ctx) {
  try {
    const { cwd } = ctx
    execFileSync('bun', ['run', 'check:full'], {
      cwd,
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 300_000,
    })
    return null
  } catch (err) {
    const output = err instanceof Error && 'stdout' in err ? (err.stdout ?? '') : ''
    const stderr = err instanceof Error && 'stderr' in err ? (err.stderr ?? '') : ''
    const rawOutput = output || stderr || (err instanceof Error ? err.message : String(err))

    const failures = parseCheckOutput(rawOutput)
    if (failures) {
      return {
        decision: 'block',
        reason: formatCheckResult(failures),
      }
    }

    return {
      decision: 'block',
      reason: '`bun check:full` failed. Run it for details.',
    }
  }
}
```

Note: `execFileSync` args changed from `['run', 'check:full', '|', 'tail', '-n', '10']` to `['run', 'check:full']` — the pipe trick doesn't work in `execFileSync` (it's not a shell). The full output is now captured for parsing.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test .hooks/tests/tdd/checks/check-full.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add .hooks/tdd/checks/check-full.mjs .hooks/tests/tdd/checks/check-full.test.ts
git commit -m "feat(hooks): concise failure summary from check:full output"
```

---

### Task 4: Create Stop hook orchestrator

**Files:**

- Create: `.claude/hooks/stop.mjs`

- [ ] **Step 1: Implement the Stop hook**

Create `.claude/hooks/stop.mjs`:

```js
import fs from 'node:fs'

import { checkFull } from '../../.hooks/tdd/checks/check-full.mjs'
import { getSessionsDir } from '../../.hooks/tdd/paths.mjs'
import { SessionState } from '../../.hooks/tdd/session-state.mjs'

try {
  const ctx = JSON.parse(fs.readFileSync('/dev/stdin', 'utf8'))
  const { session_id, cwd } = ctx

  const state = new SessionState(session_id, getSessionsDir(cwd))

  if (!state.getNeedsRecheck()) {
    state.setNeedsRecheck(true)
    process.exit(0)
  }

  const result = checkFull(ctx)

  if (result) {
    state.setNeedsRecheck(false)
    console.log(JSON.stringify({ decision: 'block', reason: result.reason }))
  }
} catch (err) {
  console.error(
    JSON.stringify({
      level: 'error',
      msg: 'Stop hook execution failed',
      error: err instanceof Error ? err.message : String(err),
    }),
  )
}

process.exit(0)
```

Flow:

1. If `needsRecheck` is `false` → LLM was blocked and did nothing → user interrupt → reset flag to `true`, allow stop.
2. If `needsRecheck` is `true` → run `checkFull`.
3. If failures → set `needsRecheck = false` (so next Stop without intervening PreToolUse = allow stop), block with reason.
4. If clean → allow stop.

- [ ] **Step 2: Commit**

```bash
git add .claude/hooks/stop.mjs
git commit -m "feat(hooks): add Stop hook with full-check gate and interrupt escape hatch"
```

---

### Task 5: Update PreToolUse hook

**Files:**

- Modify: `.claude/hooks/pre-tool-use.mjs`

- [ ] **Step 1: Remove baseline capture and surface snapshot, add needsRecheck**

In `.claude/hooks/pre-tool-use.mjs`, remove the `getSessionBaseline` and `snapshotSurface` imports and calls. Add `setNeedsRecheck`.

The new file:

```js
import fs from 'node:fs'

import { enforceTdd } from '../../.hooks/tdd/checks/enforce-tdd.mjs'
import { enforceWritePolicy } from '../../.hooks/tdd/checks/enforce-write-policy.mjs'
import { getSessionsDir } from '../../.hooks/tdd/paths.mjs'
import { SessionState } from '../../.hooks/tdd/session-state.mjs'

try {
  const ctx = JSON.parse(fs.readFileSync('/dev/stdin', 'utf8'))

  const writePolicy = enforceWritePolicy(ctx)
  if (writePolicy) {
    console.log(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: writePolicy.reason,
        },
      }),
    )
    process.exit(0)
  }

  const gate = enforceTdd(ctx)
  if (gate) {
    console.log(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: gate.reason,
        },
      }),
    )
    process.exit(0)
  }

  const state = new SessionState(ctx.session_id, getSessionsDir(ctx.cwd))
  state.setNeedsRecheck(true)
} catch (err) {
  console.error(
    JSON.stringify({
      level: 'error',
      msg: 'Hook execution failed',
      error: err instanceof Error ? err.message : String(err),
    }),
  )
}

process.exit(0)
```

- [ ] **Step 2: Commit**

```bash
git add .claude/hooks/pre-tool-use.mjs
git commit -m "refactor(hooks): remove baseline/surface from PreToolUse, add needsRecheck flag"
```

---

### Task 6: Update PostToolUse hook

**Files:**

- Modify: `.claude/hooks/post-tool-use.mjs`

- [ ] **Step 1: Remove test run and surface diff**

The new file:

```js
import fs from 'node:fs'

import { trackTestWrite } from '../../.hooks/tdd/checks/track-test-write.mjs'
import { verifyTestImport } from '../../.hooks/tdd/checks/verify-test-import.mjs'

try {
  const ctx = JSON.parse(fs.readFileSync('/dev/stdin', 'utf8'))

  trackTestWrite(ctx)

  const importResult = verifyTestImport(ctx)
  if (importResult) {
    console.log(JSON.stringify(importResult))
    process.exit(0)
  }
} catch (err) {
  console.error(
    JSON.stringify({
      level: 'error',
      msg: 'Hook execution failed',
      error: err instanceof Error ? err.message : String(err),
    }),
  )
}

process.exit(0)
```

- [ ] **Step 2: Commit**

```bash
git add .claude/hooks/post-tool-use.mjs
git commit -m "refactor(hooks): remove per-edit test run and surface diff from PostToolUse"
```

---

### Task 7: Register Stop hook in settings

**Files:**

- Modify: `.claude/settings.json`

- [ ] **Step 1: Add Stop hook entry**

The new `.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "node .claude/hooks/pre-bash.mjs"
          }
        ]
      },
      {
        "matcher": "Write|Edit|MultiEdit",
        "hooks": [
          {
            "type": "command",
            "command": "node .claude/hooks/pre-tool-use.mjs",
            "timeout": 200,
            "statusMessage": "TDD checks (pre-edit)..."
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Write|Edit|MultiEdit",
        "hooks": [
          {
            "type": "command",
            "command": "node .claude/hooks/post-tool-use.mjs",
            "timeout": 200,
            "statusMessage": "TDD checks (post-edit)..."
          }
        ]
      }
    ],
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "node .claude/hooks/stop.mjs",
            "timeout": 300,
            "statusMessage": "Running full check..."
          }
        ]
      }
    ]
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add .claude/settings.json
git commit -m "feat(hooks): register Stop hook in settings"
```

---

### Task 8: Verify end-to-end

- [ ] **Step 1: Run the full test suite**

Run: `bun test`
Expected: All existing tests pass (hook tests are not part of `bun test` — they run separately)

- [ ] **Step 2: Run hook tests**

Run: `bun test .hooks/tests/`
Expected: All hook tests pass, including new `needsRecheck`, `parse-check-output`, and `formatCheckResult` tests

- [ ] **Step 3: Run full check**

Run: `bun check:full`
Expected: All checks pass (no regressions from the changes)

- [ ] **Step 4: Manual smoke test**

Trigger a Claude session, make a file edit, verify:

1. PostToolUse runs fast (no test execution)
2. When Claude stops, the Stop hook fires and runs check:full
3. If check:full passes, Claude stops normally
4. If check:full fails, Claude is blocked with a concise summary
5. If the user interrupts after a block, the second Stop allows Claude to stop

- [ ] **Step 5: Final commit (if any fixes needed)**

```bash
git add -A
git commit -m "fix(hooks): address e2e verification findings"
```
