<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Mutation-Improve Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the three remaining deferred items from PR #222 by hardening the `mutation-improve` runner: complete `parseCliArgs` coverage (+ fix a `NaN`-threshold leak), decouple the score-reader retry from foreign error-message wording via a typed error, and add a cross-workspace contract guard for the review-loop surface mutation-improve consumes.

**Architecture:** Three independent, test-first edits bundled in one PR. (1) Parser: export `DEFAULT_CONFIG_PATH`, add a `Number.isFinite` guard to `--threshold=`, extend `cli.test.ts` with the missing branches. (2) Typed error: `readStrykerReport` throws a new exported `ReportReadError`; `measureMutationScore` retries on `instanceof ReportReadError || err.code === 'ENOENT'` instead of a message regex. (3) Contract: extend `contracts.test.ts` with a behavioral tier (LiveRenderer passthrough, createShellExec+runBuildCheck round-trip) and a runtime inventory tier of the consumed review-loop symbols. No facade, no new workspace, no runtime behavior change.

**Tech Stack:** Bun + `bun:test`, TypeScript (strict, `.js` import paths), Zod v4, oxlint/oxfmt, Stryker. Workspace scripts: `bun run mutation-improve:{test,typecheck,lint,format:check}`.

## Global Constraints

Copied verbatim from the spec / repo conventions; every task implicitly includes these.

- **No runtime behavior change:** the score-reader retry's *trigger set* is preserved exactly (same inputs retry, same inputs propagate); only the detection mechanism changes.
- **No new facade module, no new shared workspace** — `cli.ts` keeps its direct review-loop imports.
- **License header:** every new/modified source and test file keeps the verbatim `SPDX-License-Identifier: BUSL-1.1` block already present; do not alter existing headers.
- **Import paths:** use `.js` extensions in all relative imports.
- **Never add `lint-disable` / `type-ignore` comments** — hook policy blocks them; fix the underlying issue.
- **Error extraction:** `error instanceof Error ? error.message : String(error)`.
- **No comments added to source unless a given step's code block includes them** (repo convention). The code blocks below that contain `// …` comments are intentional and must be copied verbatim.
- **Test isolation:** no real `git`/`opencode`/Stryker in unit tests (the existing `cli.test.ts` `resetRunWorktrees` block is the documented exception; a Tier-A `sh -c true`/`false` round-trip is permitted and consistent with it). Temp dirs use `makeTempDir` / `cleanupTempDirs` from `tests/mutation-improve/test-helpers.ts`.
- **Commit style:** conventional commits with scope, e.g. `test(mutation-improve): …`, `feat(mutation): …`, `refactor(mutation-improve): …`.
- **TDD ordering rule used throughout:** when a test must reference a new symbol by identity (e.g. `toThrow(ReportReadError)` or `toBe(DEFAULT_CONFIG_PATH)`), the symbol's *declaration* lands first as inert plumbing (an exported class that is not yet thrown, or an exported const already in use internally); the test then goes red on *behavior*, and the subsequent step wires the behavior that turns it green. This avoids module-load errors masquerading as red signals.

---

## File Structure

| File | Responsibility | Change |
| --- | --- | --- |
| `mutation-improve/src/cli.ts` | arg parsing + composition root | export `DEFAULT_CONFIG_PATH`; add `Number.isFinite` guard to `--threshold=` branch |
| `tests/mutation-improve/cli.test.ts` | parser unit tests | add coverage cases (unknown arg, missing value, non-integer count, non-numeric threshold, default path) |
| `scripts/mutation/json-readers.ts` | read + validate Stryker JSON report | add exported `ReportReadError` class; `readStrykerReport` throws it on bad shape |
| `mutation-improve/src/score-reader.ts` | run Stryker, parse report, retry once | replace message-regex retry with `isRetryable(error)` typed predicate |
| `tests/mutation-improve/score-reader.test.ts` | score-reader + readStrykerReport unit tests | rewrite the two string-based retry tests to typed fixtures; add ENOENT-code retry test + plain-Error no-retry test + `ReportReadError` assertion |
| `tests/mutation-improve/contracts.test.ts` | cross-workspace contract guard | add behavioral (Tier A) + inventory (Tier B) `describe('review-loop surface contract')` block |

No other files change.

---

## Task 1: Harden `parseCliArgs` (NaN guard + coverage)

**Files:**
- Modify: `mutation-improve/src/cli.ts:38` (export `DEFAULT_CONFIG_PATH`), `mutation-improve/src/cli.ts:69-72` (`--threshold=` branch)
- Test: `tests/mutation-improve/cli.test.ts`

**Interfaces:**
- Produces: newly exported `export const DEFAULT_CONFIG_PATH` (string) from `cli.ts`; `parseCliArgs(['--threshold=abc'])` now throws instead of returning `flags.threshold = NaN`.

- [ ] **Step 1: Write the failing NaN test + three characterization tests (no new symbol referenced)**

Append to the existing `describe('cli parseCliArgs')` block in `tests/mutation-improve/cli.test.ts`. These four need no new imports — `parseCliArgs` is already imported:

```typescript
  test('rejects non-numeric --threshold', () => {
    expect(() => parseCliArgs(['--threshold=abc'])).toThrow(/threshold/iu)
  })

  test('throws on unknown argument', () => {
    expect(() => parseCliArgs(['--bogus'])).toThrow(/Unknown argument/u)
  })

  test('throws when a value-taking flag is missing its value', () => {
    for (const flag of ['--config', '--count', '--base', '--resume-run']) {
      expect(() => parseCliArgs([flag])).toThrow(`Missing value for ${flag}`)
    }
  })

  test('rejects fractional and non-numeric --count', () => {
    expect(() => parseCliArgs(['--count', '3.5'])).toThrow()
    expect(() => parseCliArgs(['--count', 'abc'])).toThrow()
  })
```

- [ ] **Step 2: Run tests to verify the NaN case fails (rest pass as characterization)**

Run: `bun test tests/mutation-improve/cli.test.ts`
Expected: the `rejects non-numeric --threshold` test FAILS (`Number('abc')` is `NaN`, no throw today); the other three new tests PASS — they exercise already-throwing branches (`cli.ts:48`, `cli.ts:64`, `cli.ts:91`) and are characterization pins.

- [ ] **Step 3: Implement the NaN guard**

In `mutation-improve/src/cli.ts`, change the `--threshold=` branch from:

```typescript
    if (arg.startsWith('--threshold=')) {
      flags.threshold = Number(arg.slice('--threshold='.length))
      continue
    }
```

to:

```typescript
    if (arg.startsWith('--threshold=')) {
      const threshold = Number(arg.slice('--threshold='.length))
      if (!Number.isFinite(threshold)) throw new Error('--threshold must be a finite number')
      flags.threshold = threshold
      continue
    }
```

- [ ] **Step 4: Run tests to verify the NaN case now passes**

Run: `bun test tests/mutation-improve/cli.test.ts`
Expected: PASS (all parser tests green).

- [ ] **Step 5: Export `DEFAULT_CONFIG_PATH` and add the default-path characterization test**

In `mutation-improve/src/cli.ts`, change the module-local const:

```typescript
const DEFAULT_CONFIG_PATH = path.join(import.meta.dir, '..', 'config.json')
```

to:

```typescript
export const DEFAULT_CONFIG_PATH = path.join(import.meta.dir, '..', 'config.json')
```

In `tests/mutation-improve/cli.test.ts`, update the existing import:

```typescript
import { parseCliArgs, resetRunWorktrees } from '../../mutation-improve/src/cli.js'
```

to:

```typescript
import { DEFAULT_CONFIG_PATH, parseCliArgs, resetRunWorktrees } from '../../mutation-improve/src/cli.js'
```

and append to the `describe('cli parseCliArgs')` block:

```typescript
  test('uses the default config path when --config is absent', () => {
    expect(parseCliArgs([]).configPath).toBe(DEFAULT_CONFIG_PATH)
  })
```

- [ ] **Step 6: Run tests to verify the default-path test passes**

Run: `bun test tests/mutation-improve/cli.test.ts`
Expected: PASS.

- [ ] **Step 7: Typecheck + lint + format**

Run: `bun run mutation-improve:typecheck && bun run mutation-improve:lint && bun run mutation-improve:format:check`
Expected: clean (`DEFAULT_CONFIG_PATH` is consumed by the test, so knip sees the export as used).

- [ ] **Step 8: Commit**

```bash
git add mutation-improve/src/cli.ts tests/mutation-improve/cli.test.ts
git commit -m "test(mutation-improve): cover parseCliArgs edge cases and guard non-numeric --threshold"
```

---

## Task 2: Add `ReportReadError` to `json-readers`

**Files:**
- Modify: `scripts/mutation/json-readers.ts` (new exported class; `readStrykerReport` throws it)
- Test: `tests/mutation-improve/score-reader.test.ts` (no dedicated `json-readers` test home exists; `readStrykerReport` is the boundary score-reader depends on — see spec "Testing strategy")

**Interfaces:**
- Produces: `export class ReportReadError extends Error` in `scripts/mutation/json-readers.ts`; `readStrykerReport(path)` throws `ReportReadError` (not plain `Error`) when the parsed JSON is not a Stryker report. Consumed by Task 3.

- [ ] **Step 1: Declare the `ReportReadError` class (inert plumbing — not thrown yet) and write the tests**

In `scripts/mutation/json-readers.ts`, add the exported class immediately above `readStrykerReport` (do not change `readStrykerReport` yet — it still throws plain `Error`):

```typescript
export class ReportReadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ReportReadError'
  }
}
```

In `tests/mutation-improve/score-reader.test.ts`, add the Node imports at the top (after the existing `import` lines) and extend the json-readers import to pull in the two new symbols:

```typescript
import { rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
```

```typescript
import { ReportReadError, readStrykerReport } from '../../scripts/mutation/json-readers.js'
```

Add a new describe block at the bottom of the file:

```typescript
describe('readStrykerReport (json-readers contract)', () => {
  test('throws ReportReadError when the parsed JSON is not a Stryker report', () => {
    const tmpFile = `${tmpdir()}/mi-not-a-report-${Date.now()}.json`
    // `files` must be a record; an array is not a valid Stryker report shape
    writeFileSync(tmpFile, JSON.stringify({ files: [] }))
    try {
      expect(() => readStrykerReport(tmpFile)).toThrow(ReportReadError)
    } finally {
      rmSync(tmpFile, { force: true })
    }
  })

  test('returns the report when the shape is valid', () => {
    const tmpFile = `${tmpdir()}/mi-valid-${Date.now()}.json`
    writeFileSync(tmpFile, JSON.stringify({ files: { 'src/x.ts': { mutants: [{ status: 'Killed' }] } } }))
    try {
      expect(readStrykerReport(tmpFile).files?.['src/x.ts'].mutants?.length).toBe(1)
    } finally {
      rmSync(tmpFile, { force: true })
    }
  })
})
```

- [ ] **Step 2: Run tests to verify the typed-error case fails on behavior**

Run: `bun test tests/mutation-improve/score-reader.test.ts`
Expected: the `throws ReportReadError` test FAILS — `readStrykerReport` still throws a plain `Error`, so `toThrow(ReportReadError)` does not match. (The "returns the report" test passes already.) The file loads cleanly because `ReportReadError` now exists (Step 1 declared it).

- [ ] **Step 3: Wire `readStrykerReport` to throw `ReportReadError`**

In `scripts/mutation/json-readers.ts`, change only the throw inside `readStrykerReport` (keep the message string identical for log-grepping humans):

```typescript
export const readStrykerReport = (reportPath: string): StrykerReport => {
  const parsed: unknown = JSON.parse(fs.readFileSync(reportPath, 'utf8'))
  if (!isStrykerReport(parsed)) {
    throw new Error(`${reportPath} must contain a Stryker JSON report object`)
  }
  return parsed
}
```

becomes:

```typescript
export const readStrykerReport = (reportPath: string): StrykerReport => {
  const parsed: unknown = JSON.parse(fs.readFileSync(reportPath, 'utf8'))
  if (!isStrykerReport(parsed)) {
    throw new ReportReadError(`${reportPath} must contain a Stryker JSON report object`)
  }
  return parsed
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/mutation-improve/score-reader.test.ts`
Expected: PASS (both `readStrykerReport` contract cases green; the existing score-reader tests still pass — `ReportReadError extends Error`, so any `instanceof Error` assertions still hold).

- [ ] **Step 5: Regression-check scripts/mutation consumers**

`readStrykerReport` is also imported by `scripts/mutation/paired-run.ts`; confirm nothing there string-matches the old message.

Run: `bun test tests/scripts/mutation/paired-run.test.ts`
Expected: PASS (paired-run lets the error propagate; the only retry-keying consumer is score-reader, rewritten in Task 3).

- [ ] **Step 6: Typecheck + lint + format**

Run: `bun run mutation-improve:typecheck && bun run mutation-improve:lint && bun run mutation-improve:format:check`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add scripts/mutation/json-readers.ts tests/mutation-improve/score-reader.test.ts
git commit -m "feat(mutation): throw typed ReportReadError from readStrykerReport"
```

---

## Task 3: Decouple score-reader retry from error wording

**Files:**
- Modify: `mutation-improve/src/score-reader.ts:19-40` (`measureMutationScore` + new `isRetryable`)
- Test: `tests/mutation-improve/score-reader.test.ts` (rewrite the two existing string-based retry tests; add ENOENT-code + plain-Error cases)

**Interfaces:**
- Consumes: `ReportReadError` from `scripts/mutation/json-readers.js` (Task 2 declared and exported it).
- Produces: `measureMutationScore` unchanged signature; retry now keyed on `isRetryable(error)`.

**Behavioral contract (must be preserved):** report-missing (`ENOENT`) → retry; wrong-shape (`ReportReadError`) → retry; `JSON.parse` SyntaxError and any other error → propagate; non-zero Stryker exit → propagate without retry (already handled before the read).

- [ ] **Step 1: Rewrite the two existing string-based retry tests to typed fixtures**

The import for `ReportReadError` already exists in this file from Task 2. In `tests/mutation-improve/score-reader.test.ts`, replace the existing `retries exec once…` test:

```typescript
  test('measureMutationScore retries exec once when the report read throws, then succeeds', async () => {
    const exec = mock(successfulExec)
    const readReport = mock((): StrykerReport => reportWith(10, 0)).mockImplementationOnce((): StrykerReport => {
      throw new Error('malformed')
    })
    const score = await measureMutationScore({ exec, readReport }, 'reports/paired', 'src/foo.ts')
    expect(exec).toHaveBeenCalledTimes(2)
    expect(score).toBe(1)
  })
```

with (first read throws a typed `ReportReadError`, retry succeeds):

```typescript
  test('measureMutationScore retries exec once when the report read throws ReportReadError, then succeeds', async () => {
    const exec = mock(successfulExec)
    const readReport = mock((): StrykerReport => reportWith(10, 0)).mockImplementationOnce((): StrykerReport => {
      throw new ReportReadError('shape')
    })
    const score = await measureMutationScore({ exec, readReport }, 'reports/paired', 'src/foo.ts')
    expect(exec).toHaveBeenCalledTimes(2)
    expect(score).toBe(1)
  })
```

Replace the existing `throws after a failed retry` test:

```typescript
  test('measureMutationScore throws after a failed retry', async () => {
    const exec = mock(successfulExec)
    await expect(
      measureMutationScore(
        {
          exec,
          readReport: (): StrykerReport => {
            throw new Error('still malformed')
          },
        },
        'reports/paired',
        'src/foo.ts',
      ),
    ).rejects.toThrow(/malformed|stryker/iu)
  })
```

with (both reads throw `ReportReadError`; retry fires then propagates the typed error):

```typescript
  test('measureMutationScore throws the typed error after a failed retry', async () => {
    const exec = mock(successfulExec)
    await expect(
      measureMutationScore(
        {
          exec,
          readReport: (): StrykerReport => {
            throw new ReportReadError('shape')
          },
        },
        'reports/paired',
        'src/foo.ts',
      ),
    ).rejects.toBeInstanceOf(ReportReadError)
    expect(exec).toHaveBeenCalledTimes(2)
  })
```

- [ ] **Step 2: Add the ENOENT-code retry test and the plain-Error no-retry test**

Append inside `describe('score-reader')`:

```typescript
  test('measureMutationScore retries when the report read throws an ENOENT-coded error', async () => {
    const exec = mock(successfulExec)
    const enoent = Object.assign(new Error('not found'), { code: 'ENOENT' })
    const readReport = mock((): StrykerReport => reportWith(6, 0)).mockImplementationOnce((): StrykerReport => {
      throw enoent
    })
    const score = await measureMutationScore({ exec, readReport }, 'reports/paired', 'src/foo.ts')
    expect(exec).toHaveBeenCalledTimes(2)
    expect(score).toBe(1)
  })

  test('measureMutationScore does NOT retry on a plain (non-typed, non-ENOENT) error and propagates it', async () => {
    const exec = mock(successfulExec)
    await expect(
      measureMutationScore(
        {
          exec,
          readReport: (): StrykerReport => {
            throw new Error('boom')
          },
        },
        'reports/paired',
        'src/foo.ts',
      ),
    ).rejects.toThrow('boom')
    expect(exec).toHaveBeenCalledTimes(1)
  })
```

- [ ] **Step 3: Run tests to verify the retry-case failures against the current regex impl**

Run: `bun test tests/mutation-improve/score-reader.test.ts`
Expected: RED on three cases —
- `retries once … ReportReadError` fails: the regex `/enoent|malformed|must contain a stryker/iu` does not match message `'shape'`, so today it does **not** retry → `exec` is called once, not twice, and the `ReportReadError` propagates instead of returning `1`.
- `throws the typed error after a failed retry` fails: same non-retry → `exec` called once, not twice.
- `retries … ENOENT-coded error` fails: the mocked error's *message* is `'not found'` (no `enoent` substring), so the message-regex does not match → no retry → `exec` once, not twice. (This is the crux: the old impl keyed on message text; the new impl will key on `.code`.)

The `does NOT retry on a plain error` test PASSES under the current regex too (a plain `Error('boom')` never matched) — it is the behavioral-preservation guard carried forward unchanged.

- [ ] **Step 4: Implement `isRetryable` and use it**

In `mutation-improve/src/score-reader.ts`, change the top import from:

```typescript
import { readStrykerReport } from '../../scripts/mutation/json-readers.js'
```

to:

```typescript
import { ReportReadError, readStrykerReport } from '../../scripts/mutation/json-readers.js'
```

Add the predicate above `measureMutationScore` (after the `MeasureDeps` interface):

```typescript
function isRetryable(error: unknown): boolean {
  if (error instanceof ReportReadError) return true
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === 'ENOENT'
  )
}
```

Replace the `catch` block of `measureMutationScore` (currently the regex):

```typescript
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/enoent|malformed|must contain a stryker/iu.test(message)) {
      const retried = await attempt()
      return retried
    }
    throw error
  }
```

with:

```typescript
  } catch (error) {
    if (isRetryable(error)) {
      return attempt()
    }
    throw error
  }
```

- [ ] **Step 5: Run tests to verify all pass**

Run: `bun test tests/mutation-improve/score-reader.test.ts`
Expected: PASS (all five score-reader retry cases + the two json-readers contract cases from Task 2 green).

- [ ] **Step 6: Typecheck + lint + format**

Run: `bun run mutation-improve:typecheck && bun run mutation-improve:lint && bun run mutation-improve:format:check`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add mutation-improve/src/score-reader.ts tests/mutation-improve/score-reader.test.ts
git commit -m "refactor(mutation-improve): key score-reader retry off typed error instead of message text"
```

---

## Task 4: Cross-workspace contract guard

**Files:**
- Modify: `tests/mutation-improve/contracts.test.ts`
- No source changes.

**Interfaces:**
- Consumes (asserts presence/shape of): `runAgent` (`review-loop/src/agent-runner.js`); `createShellExec`, `runBuildCheck` (`review-loop/src/build-checker.js`); `LiveRenderer` (`review-loop/src/live-renderer.js`); `realSpawn` (`review-loop/src/spawn.js`); `createWorktree`, `detectGitRoot`, `execGit`, `mergeWorktree`, `removeWorktree`, `resetWorktree` (`review-loop/src/worktree.js`). These are exactly the symbols `mutation-improve/src/{cli,config,pipeline}.ts` import today.

**Design note (honesty):** TypeScript already catches symbol removal/rename and most signature/return-shape drift at the call sites in `cli.ts`/`pipeline.ts`. This contract test's added value is (a) behavioral pinning of the two cheap-to-exercise symbols (`LiveRenderer.log` passthrough; `createShellExec`+`runBuildCheck` exit→passed mapping) and (b) a co-located, explicit **inventory** of the consumed surface so drift is surfaced in mutation-improve's own gate even if a future refactor stops reading a field at a call site. review-loop's own suite (`tests/review-loop/**`) remains the behavioral authority for the git-/opencode-requiring symbols.

- [ ] **Step 1: Write the contract tests**

In `tests/mutation-improve/contracts.test.ts`, update the imports. The file currently begins:

```typescript
import { describe, expect, test } from 'bun:test'

import { ResultSchema } from '../../mutation-improve/src/result-schema.js'
import { SelectionSchema } from '../../mutation-improve/src/selection-schema.js'
```

Change to:

```typescript
import { afterEach, describe, expect, test } from 'bun:test'

import { runAgent } from '../../review-loop/src/agent-runner.js'
import { createShellExec, runBuildCheck } from '../../review-loop/src/build-checker.js'
import { LiveRenderer } from '../../review-loop/src/live-renderer.js'
import { realSpawn } from '../../review-loop/src/spawn.js'
import {
  createWorktree,
  detectGitRoot,
  execGit,
  mergeWorktree,
  removeWorktree,
  resetWorktree,
} from '../../review-loop/src/worktree.js'
import { ResultSchema } from '../../mutation-improve/src/result-schema.js'
import { SelectionSchema } from '../../mutation-improve/src/selection-schema.js'
import { cleanupTempDirs, makeTempDir } from './test-helpers'

afterEach(cleanupTempDirs)
```

Append a new describe block at the end of the file:

```typescript
describe('review-loop surface contract', () => {
  test('Tier A — LiveRenderer.log writes the message through to the stream', () => {
    const written: string[] = []
    const sink = {
      write: (chunk: string): boolean => {
        written.push(chunk)
        return true
      },
    }
    new LiveRenderer(sink).log('hello')
    expect(written.join('')).toBe('hello\n')
  })

  test('Tier A — createShellExec + runBuildCheck map exit 0 → passed and non-zero → failed', async () => {
    const dir = makeTempDir('contract-build-')
    const passed = await runBuildCheck({ exec: createShellExec(dir, 'true') })
    expect(passed.passed).toBe(true)
    const failed = await runBuildCheck({ exec: createShellExec(dir, 'false') })
    expect(failed.passed).toBe(false)
  })

  test('Tier B — consumed concrete symbols are exported and callable', () => {
    // Inventory of the review-loop surface mutation-improve consumes today.
    // Behavioral authority for the git/opencode-requiring functions lives in
    // tests/review-loop/**; this asserts presence + callability so removal or
    // export-shape drift fails loudly in mutation-improve's own gate.
    expect(typeof runAgent).toBe('function')
    expect(typeof realSpawn).toBe('function')
    expect(typeof createWorktree).toBe('function')
    expect(typeof execGit).toBe('function')
    expect(typeof mergeWorktree).toBe('function')
    expect(typeof removeWorktree).toBe('function')
    expect(typeof resetWorktree).toBe('function')
    expect(typeof detectGitRoot).toBe('function')
  })
})
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `bun test tests/mutation-improve/contracts.test.ts`
Expected: PASS (all symbols are exported today; `sh -c true` exits 0, `sh -c false` exits non-zero; `LiveRenderer` in non-TTY mode writes `${msg}\n` via `writeSafe` → `stream.write`).

- [ ] **Step 3: Typecheck + lint + format**

Run: `bun run mutation-improve:typecheck && bun run mutation-improve:lint && bun run mutation-improve:format:check`
Expected: clean. (All newly imported symbols are used by the assertions, so knip / `no-unused-vars` are satisfied. The `sink` literal matches `RendererStream` because `write` returns `boolean` and `isTTY`/`columns` are optional.)

- [ ] **Step 4: Commit**

```bash
git add tests/mutation-improve/contracts.test.ts
git commit -m "test(mutation-improve): pin consumed review-loop surface via contract tests"
```

---

## Final verification

After all four tasks land on the branch:

- [ ] **Full workspace gate**

Run: `bun run mutation-improve:test && bun run mutation-improve:typecheck && bun run mutation-improve:lint && bun run mutation-improve:format:check`
Expected: all green.

- [ ] **review-loop unaffected**

Run: `bun run review-loop:test`
Expected: green (no shared-file change in this PR — `review-loop/src/worktree.ts` is untouched this round).

- [ ] **scripts/mutation regression**

Run: `bun test tests/scripts/mutation`
Expected: PASS (the `ReportReadError` change is consumed only by score-reader, already covered).

- [ ] **Root check**

Run: `bun check:full`
Expected: clean (lint/typecheck/format/knip).

- [ ] **Behavioral-preservation spot check**

Open `tests/mutation-improve/score-reader.test.ts` and confirm the five cases enumerate every prior retry trigger: `ENOENT`-coded (report missing) and `ReportReadError` (wrong shape) retry; non-zero Stryker exit (existing `mutation run failed` test), `JSON.parse` SyntaxError, and any other plain error propagate. The `does NOT retry on a plain error` test is the explicit guard against re-introducing over-broad retry.

## Self-review notes (plan author)

- **Spec coverage:** Stream 1 → Task 1; Stream 2 → Tasks 2 + 3; Stream 3 → Task 4. The already-shipped `--reset-worktree` item is intentionally absent. Every spec section maps to a task.
- **TDD ordering:** Tasks 1 and 2 each declare a new exported symbol (`DEFAULT_CONFIG_PATH`, `ReportReadError`) as inert plumbing *before* the test that references it by identity, so the red signal is behavioral (a failing assertion), not a module-load error. The Global Constraints codify this rule.
- **Type consistency:** `ReportReadError` is declared in Task 2 and imported by Task 3's `score-reader.ts` and by both test files — name identical everywhere. `DEFAULT_CONFIG_PATH` exported in Task 1 and imported by the Task 1 test. `isRetryable`, `attempt`, `MeasureDeps` names match the existing file.
- **Typecheck hazards handled:** the Tier-A `sink.write` returns `boolean` (matches `RendererStream.write`), avoiding the `number`-not-assignable-to-`boolean` error that `written.push(chunk)` would cause.
- **Placeholder scan:** all steps contain real code/commands; no TBD/TODO/"add error handling". Two existing tests are shown with exact before/after because the engineer must rewrite them rather than write fresh.
- **Known TDD nuance:** Task 1 ships three characterization tests that pass immediately (they pin already-throwing branches) alongside one true red→green test (the NaN guard). Task 3 Step 3's red signal is three cases (the two `ReportReadError` retry cases + the ENOENT-code case); the plain-Error no-retry test passes under both old and new impl by design (behavioral preservation guard).
