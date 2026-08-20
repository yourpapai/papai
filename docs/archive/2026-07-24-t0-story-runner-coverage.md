<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# T0 Story-Runner Line Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collect real `src/` line/function coverage from the single sandboxed T0 story run, then gate it against a committed, ratcheting floor.

**Architecture:** The story runner spawns one sandboxed `bun test` child over all story files. When `--coverage` is passed, the child writes lcov into the writable session temp dir; the runner copies + SF-normalizes the one lcov to `reports/stories/coverage/lcov.info`, computes aggregate totals with Item 1's `parseLcovTotals`, and fails the run if below `scripts/story/coverage-floor.json`. A local `coverage:ratchet:stories` command raises the floor from green runs.

**Tech Stack:** Bun test runner, Bun coverage (`--coverage --coverage-reporter=lcov --coverage-dir`), TypeScript (strict), Zod v4, Docker story sandbox.

## Global Constraints

- Runtime **Bun**; validation **Zod v4**; strict TypeScript; **use `.js` extension in import paths**.
- **Prerequisite — Item 1's `scripts/coverage/ratchet-lib.ts` must be landed first.** This plan imports `parseLcovTotals`, `nextFloor`, and the `CoverageMetric` type from it. If Item 1 is not yet merged, land its Task 1 (ratchet library) before starting here.
- `CoverageMetric.pct` is a **0..1 fraction**; every floor value is a fraction (`0.50`, `0.90`), never a percentage.
- Coverage is **opt-in**: the default `bun test:stories` (no `--coverage`) must remain byte-for-byte unchanged in behavior.
- Every new `.ts` file starts with the 4-line SPDX header:
  ```ts
  // SPDX-License-Identifier: BUSL-1.1
  // Copyright (c) 2026 Dmitriy Lazarev
  // Use of this software is governed by the Business Source License 1.1.
  // See LICENSE in the project root for details.
  ```
- **Never** add lint-disable or type-ignore comments; a `max-lines` failure is a design signal to split, not to game.
- Error extraction: `error instanceof Error ? error.message : String(error)`.
- The T0 floor starts provisional-low (`0.50 / 0.50`) because the number is unmeasured; **Item 5 (fix 3 failing tests)** is the prerequisite for a green run before running `coverage:ratchet:stories` to lock the real floor.

---

### Task 1: lcov SF-path normalization

**Files:**
- Create: `scripts/coverage/normalize-lcov.ts`
- Test: `tests/scripts/story-coverage-normalize.test.ts`

**Interfaces:**
- Produces: `normalizeLcov(text: string): string` — rewrites every `SF:` line to a repo-relative path by stripping a leading `/session/app/` (container cwd) or `./` prefix; all other lines pass through unchanged.

- [ ] **Step 1: Write the failing test**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import { normalizeLcov } from '../../scripts/coverage/normalize-lcov.js'

describe('normalizeLcov', () => {
  it('strips the /session/app/ container prefix from SF lines', () => {
    const input = ['TN:', 'SF:/session/app/src/tools/registry.ts', 'DA:1,1', 'end_of_record'].join('\n')
    expect(normalizeLcov(input)).toContain('SF:src/tools/registry.ts')
    expect(normalizeLcov(input)).not.toContain('/session/app/')
  })

  it('passes an already-relative SF path through unchanged', () => {
    const input = 'SF:src/index.ts\nDA:1,1\nend_of_record'
    expect(normalizeLcov(input)).toBe(input)
  })

  it('strips a leading ./ prefix', () => {
    expect(normalizeLcov('SF:./src/a.ts')).toBe('SF:src/a.ts')
  })

  it('leaves non-SF lines and non-src prefixes intact', () => {
    const input = 'DA:5,0\nSF:plugins/acp/index.ts\nFNDA:2,foo'
    expect(normalizeLcov(input)).toBe(input)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/scripts/story-coverage-normalize.test.ts`
Expected: FAIL — `Cannot find module '../../scripts/coverage/normalize-lcov.js'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

const SESSION_APP_PREFIX = /^\/session\/app\//u
const RELATIVE_PREFIX = /^\.\//u

function normalizeSourceFile(line: string): string {
  const file = line.slice('SF:'.length).replace(SESSION_APP_PREFIX, '').replace(RELATIVE_PREFIX, '')
  return `SF:${file}`
}

export function normalizeLcov(text: string): string {
  return text
    .split('\n')
    .map((line) => (line.startsWith('SF:') ? normalizeSourceFile(line) : line))
    .join('\n')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/scripts/story-coverage-normalize.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/coverage/normalize-lcov.ts tests/scripts/story-coverage-normalize.test.ts
git commit -m "feat(coverage): lcov SF-path normalization for story runner"
```

---

### Task 2: Story coverage floor + gate evaluator

**Files:**
- Create: `scripts/story/coverage-floor.json`
- Create: `scripts/coverage/story-coverage-gate.ts`
- Test: `tests/scripts/story-coverage-gate.test.ts`

**Interfaces:**
- Consumes: `parseLcovTotals`, `CoverageMetric` from `scripts/coverage/ratchet-lib.js` (Item 1).
- Produces:
  - `STORY_COVERAGE_FLOOR_PATH = 'scripts/story/coverage-floor.json'`
  - `type CoverageFloor = { lines: number; functions: number }`
  - `parseCoverageFloor(json: string): CoverageFloor` (Zod-validated, fractions in `[0,1]`)
  - `readCoverageFloor(filePath: string): Promise<CoverageFloor>`
  - `type StoryCoverageEvaluation = { lines: CoverageMetric; functions: CoverageMetric; floor: CoverageFloor; pass: boolean; failures: readonly string[] }`
  - `evaluateStoryCoverage(lcov: string, floor: CoverageFloor): StoryCoverageEvaluation`
  - `formatStoryCoverageEvaluation(evaluation: StoryCoverageEvaluation): string`

- [ ] **Step 1: Create the committed floor file**

Create `scripts/story/coverage-floor.json`:

```json
{ "lines": 0.5, "functions": 0.5 }
```

- [ ] **Step 2: Write the failing test**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import {
  evaluateStoryCoverage,
  formatStoryCoverageEvaluation,
  parseCoverageFloor,
} from '../../scripts/coverage/story-coverage-gate.js'

const LCOV = [
  'SF:src/a.ts',
  'FNF:2',
  'FNH:2',
  'DA:1,1',
  'DA:2,1',
  'DA:3,1',
  'DA:4,0',
  'LF:4',
  'LH:3',
  'end_of_record',
].join('\n')

describe('parseCoverageFloor', () => {
  it('accepts fractional line/function floors', () => {
    expect(parseCoverageFloor('{ "lines": 0.5, "functions": 0.5 }')).toEqual({ lines: 0.5, functions: 0.5 })
  })

  it('rejects out-of-range floors', () => {
    expect(() => parseCoverageFloor('{ "lines": 1.5, "functions": 0.5 }')).toThrow()
  })
})

describe('evaluateStoryCoverage', () => {
  it('passes when totals meet the floor', () => {
    const result = evaluateStoryCoverage(LCOV, { lines: 0.5, functions: 0.5 })
    expect(result.pass).toBe(true)
    expect(result.failures).toEqual([])
    expect(result.lines).toEqual({ found: 4, hit: 3, pct: 0.75 })
  })

  it('fails and lists the metric when below the floor', () => {
    const result = evaluateStoryCoverage(LCOV, { lines: 0.9, functions: 0.5 })
    expect(result.pass).toBe(false)
    expect(result.failures.join(' ')).toContain('lines')
  })

  it('formats a human-readable summary', () => {
    const text = formatStoryCoverageEvaluation(evaluateStoryCoverage(LCOV, { lines: 0.5, functions: 0.5 }))
    expect(text).toContain('75.00%')
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test tests/scripts/story-coverage-gate.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Write minimal implementation**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { readFile } from 'node:fs/promises'

import { z } from 'zod'

import { type CoverageMetric, parseLcovTotals } from './ratchet-lib.js'

export const STORY_COVERAGE_FLOOR_PATH = 'scripts/story/coverage-floor.json'

const CoverageFloorSchema = z.object({
  lines: z.number().min(0).max(1),
  functions: z.number().min(0).max(1),
})

export type CoverageFloor = z.infer<typeof CoverageFloorSchema>

export function parseCoverageFloor(json: string): CoverageFloor {
  return CoverageFloorSchema.parse(JSON.parse(json))
}

export async function readCoverageFloor(filePath: string): Promise<CoverageFloor> {
  return parseCoverageFloor(await readFile(filePath, 'utf8'))
}

export type StoryCoverageEvaluation = Readonly<{
  lines: CoverageMetric
  functions: CoverageMetric
  floor: CoverageFloor
  pass: boolean
  failures: readonly string[]
}>

function pct(value: number): string {
  return `${(value * 100).toFixed(2)}%`
}

export function evaluateStoryCoverage(lcov: string, floor: CoverageFloor): StoryCoverageEvaluation {
  const totals = parseLcovTotals(lcov)
  const failures: string[] = []
  if (totals.lines.pct < floor.lines) failures.push(`lines ${pct(totals.lines.pct)} < floor ${pct(floor.lines)}`)
  if (totals.functions.pct < floor.functions) {
    failures.push(`functions ${pct(totals.functions.pct)} < floor ${pct(floor.functions)}`)
  }
  return { lines: totals.lines, functions: totals.functions, floor, pass: failures.length === 0, failures }
}

export function formatStoryCoverageEvaluation(evaluation: StoryCoverageEvaluation): string {
  const header = `T0 story coverage: lines ${pct(evaluation.lines.pct)} (floor ${pct(evaluation.floor.lines)}), functions ${pct(evaluation.functions.pct)} (floor ${pct(evaluation.floor.functions)})`
  if (evaluation.pass) return `${header} — OK`
  return `${header}\n  BELOW FLOOR: ${evaluation.failures.join('; ')}`
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test tests/scripts/story-coverage-gate.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add scripts/story/coverage-floor.json scripts/coverage/story-coverage-gate.ts tests/scripts/story-coverage-gate.test.ts
git commit -m "feat(coverage): T0 story coverage floor + gate evaluator"
```

---

### Task 3: `--coverage` runner flag

**Files:**
- Modify: `scripts/story/cli.ts:37-45` (type), `:47-57` (state), `:106-122` (finalize), `:124-135,147-152` (parse)
- Test: `tests/scripts/story-runner-coverage-cli.test.ts`

**Interfaces:**
- Produces: `ParsedStoryRunnerArguments` gains `coverage: boolean`. `--coverage` is a runner-level boolean (NOT forwarded to the child's bun args here — Task 5 appends the actual coverage flags). Default `false`.

- [ ] **Step 1: Write the failing test**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import { parseStoryRunnerArguments } from '../../scripts/story/cli.js'

describe('parseStoryRunnerArguments --coverage', () => {
  it('defaults coverage to false', () => {
    expect(parseStoryRunnerArguments([]).coverage).toBe(false)
  })

  it('sets coverage true and does not forward --coverage to the child', () => {
    const parsed = parseStoryRunnerArguments(['--coverage'])
    expect(parsed.coverage).toBe(true)
    expect(parsed.forwarded).not.toContain('--coverage')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/scripts/story-runner-coverage-cli.test.ts`
Expected: FAIL — `coverage` is not a property / `--coverage` throws "Unsupported story runner argument".

- [ ] **Step 3: Implement**

In `scripts/story/cli.ts`, add `coverage: boolean` to the `ParsedStoryRunnerArguments` type (after `manifestOnly: boolean`):

```ts
export type ParsedStoryRunnerArguments = Readonly<{
  forwarded: readonly string[]
  fixture?: string
  compat: boolean
  contracts: boolean
  baselineRef?: string
  manifestOnly: boolean
  coverage: boolean
  seed: number
}>
```

Add `coverage: boolean` to `ArgumentState` (after `manifestOnly: boolean`):

```ts
  manifestOnly: boolean
  coverage: boolean
```

In `finalizeArguments`, add to the returned object (after `manifestOnly: state.manifestOnly,`):

```ts
    coverage: state.coverage,
```

In `parseStoryRunnerArguments`, initialize state (after `manifestOnly: false,`):

```ts
    coverage: false,
```

Extend the boolean-flag branch (currently `if (argument === '--compat' || argument === '--manifest-only' || argument === '--contracts')`) to also accept `--coverage`:

```ts
    if (
      argument === '--compat' ||
      argument === '--manifest-only' ||
      argument === '--contracts' ||
      argument === '--coverage'
    ) {
      if (argument === '--compat') state.compat = true
      else if (argument === '--manifest-only') state.manifestOnly = true
      else if (argument === '--contracts') state.contracts = true
      else state.coverage = true
      continue
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/scripts/story-runner-coverage-cli.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Verify existing CLI tests still pass**

Run: `bun test tests/scripts/story-runner-integers.test.ts tests/scripts/test-stories.test.ts`
Expected: PASS (no regressions).

- [ ] **Step 6: Commit**

```bash
git add scripts/story/cli.ts tests/scripts/story-runner-coverage-cli.test.ts
git commit -m "feat(story-runner): add --coverage flag to CLI parser"
```

---

### Task 4: Sandbox `--coverage-dir=` path translation

**Files:**
- Modify: `scripts/story/sandbox.ts:150` (`translateLinuxCommandArgument` prefix list)
- Test: `tests/scripts/story-sandbox.test.ts` (extend)

**Interfaces:**
- Produces: the Linux sandbox command translator rewrites a `--coverage-dir=<hostTempPath>` argument so the value maps to `/session/tmp/coverage`, exactly as it already does for `--config=` and `--reporter-outfile=`.

- [ ] **Step 1: Write the failing test**

Add to `tests/scripts/story-sandbox.test.ts` (follow the file's existing `buildStorySandboxCommand`/`buildLinuxStorySandboxCommand` usage; adapt the harness call to match the existing tests in that file):

```ts
it('translates --coverage-dir under tempRoot to the container temp path', () => {
  const command = buildStorySandboxCommand({
    platform: 'linux',
    appRoot: '/host/app',
    dependencyRoot: '/host/app/node_modules',
    tempRoot: '/host/tmp',
    reportPaths: [],
    bunExecutable: '/host/app/bun',
    command: ['/host/app/bun', 'test', '--coverage-dir=/host/tmp/coverage'],
  })
  expect(command).toContain('--coverage-dir=/session/tmp/coverage')
  expect(command).not.toContain('--coverage-dir=/host/tmp/coverage')
})
```

> Note: if `buildStorySandboxCommand` in this file is invoked through a different helper/shape, mirror the surrounding tests exactly — the assertion (`--coverage-dir=/session/tmp/coverage` present, host path absent) is what matters.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/scripts/story-sandbox.test.ts`
Expected: FAIL — the argument is passed through untranslated (still `/host/tmp/coverage`).

- [ ] **Step 3: Implement**

In `scripts/story/sandbox.ts`, add `--coverage-dir=` to the prefix loop in `translateLinuxCommandArgument`:

```ts
  for (const prefix of ['--config=', '--reporter-outfile=', '--coverage-dir=']) {
    if (argument.startsWith(prefix)) {
      return `${prefix}${translateLinuxSessionPath(argument.slice(prefix.length), appRoot, tempRoot, reports)}`
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/scripts/story-sandbox.test.ts`
Expected: PASS (new test + existing sandbox tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/story/sandbox.ts tests/scripts/story-sandbox.test.ts
git commit -m "feat(story-sandbox): translate --coverage-dir to container temp path"
```

---

### Task 5: Child command appends coverage flags

**Files:**
- Modify: `scripts/story/child.ts:40-60` (`childCommand`)
- Test: `tests/scripts/story-child-coverage.test.ts`

**Interfaces:**
- Consumes: `ParsedStoryRunnerArguments.coverage` (Task 3), `session.tempRoot`.
- Produces: when `parsed.coverage` is true, the child `bun test` command includes `--coverage`, `--coverage-reporter=lcov`, and `--coverage-dir=<tempRoot>/coverage`; when false the command is unchanged.

- [ ] **Step 1: Write the failing test**

`spawnStorySandboxedChild` accepts an injectable `spawn` and `buildSandboxCommand`; use an identity `buildSandboxCommand` (returns the raw command) and a capturing `spawn` to inspect the child command.

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import { parseStoryRunnerArguments } from '../../scripts/story/cli.js'
import { spawnStorySandboxedChild } from '../../scripts/story/child.js'
import type { StoryRunnerSession } from '../../scripts/story/session.js'

function fakeSession(): StoryRunnerSession {
  return {
    root: '/s',
    appRoot: '/s/app',
    dependencyRoot: '/s/app/node_modules',
    tempRoot: '/s/tmp',
    manifest: { files: [] } as unknown as StoryRunnerSession['manifest'],
    childReporterArguments: [],
    childReportPaths: [],
    reportPaths: [],
    verifyIntegrity: () => Promise.resolve(),
    copyReports: () => Promise.resolve(),
    copyCoverage: () => Promise.resolve(false),
    cleanup: () => Promise.resolve(),
  }
}

function captureCommand(parsedArgs: readonly string[]): readonly string[] {
  let captured: readonly string[] = []
  spawnStorySandboxedChild(
    parseStoryRunnerArguments(parsedArgs),
    {
      env: {},
      spawn: (command) => {
        captured = command
        return { exited: Promise.resolve(0), kill: () => {} }
      },
      buildSandboxCommand: (request) => request.command,
      platform: 'linux',
      bunExecutable: '/s/app/bun',
    },
    ['tests/stories/a.story.test.ts'],
    fakeSession(),
  )
  return captured
}

describe('spawnStorySandboxedChild coverage flags', () => {
  it('omits coverage flags without --coverage', () => {
    const command = captureCommand([])
    expect(command).not.toContain('--coverage')
  })

  it('appends coverage flags with --coverage', () => {
    const command = captureCommand(['--coverage'])
    expect(command).toContain('--coverage')
    expect(command).toContain('--coverage-reporter=lcov')
    expect(command).toContain('--coverage-dir=/s/tmp/coverage')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/scripts/story-child-coverage.test.ts`
Expected: FAIL — coverage flags absent (and the `copyCoverage` member does not yet exist on the type; that lands in Task 6, so this test file also drives that. If TS complains here, proceed — Task 6 adds the member; re-run after Task 6).

> To keep this task independently green, add `copyCoverage: () => Promise.resolve(false),` to the fake now (as shown); the `StoryRunnerSession` type gains the member in Task 6. If your executor runs tasks strictly in order and the type lacks the member, temporarily cast the fake `as StoryRunnerSession` — Task 6 removes the need.

- [ ] **Step 3: Implement**

In `scripts/story/child.ts`, extend `childCommand` to append coverage flags before `...files`:

```ts
function childCommand(
  parsed: ParsedStoryRunnerArguments,
  session: StoryRunnerSession,
  bunExecutable: string,
  files: readonly string[],
): readonly string[] {
  return [
    bunExecutable,
    'test',
    `--config=${path.join(session.appRoot, 'scripts/snapshot-bunfig.toml')}`,
    '--path-ignore-patterns',
    '',
    '--preload',
    path.join(session.appRoot, 'tests/setup.ts'),
    '--preload',
    path.join(session.appRoot, 'tests/mock-reset.ts'),
    ...(parsed.contracts ? [] : ['--preload', path.join(session.appRoot, 'tests/stories/preload.ts')]),
    ...session.childReporterArguments,
    ...(parsed.coverage
      ? ['--coverage', '--coverage-reporter=lcov', `--coverage-dir=${path.join(session.tempRoot, 'coverage')}`]
      : []),
    ...files,
  ]
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/scripts/story-child-coverage.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/story/child.ts tests/scripts/story-child-coverage.test.ts
git commit -m "feat(story-runner): emit bun coverage flags in the sandboxed child"
```

---

### Task 6: Copy + normalize the child lcov out of the session

**Files:**
- Modify: `scripts/story/reports.ts` (add `STORY_COVERAGE_LCOV_PATH`, `copyStoryCoverage`, and an optional transform on `copyReport`)
- Modify: `scripts/story/session.ts:30-41` (type), `:203-209` (materialize return)
- Test: `tests/scripts/story-reports.test.ts` (extend)

**Interfaces:**
- Consumes: `normalizeLcov` (Task 1).
- Produces:
  - `STORY_COVERAGE_LCOV_PATH = 'reports/stories/coverage/lcov.info'` (in `reports.ts`).
  - `copyStoryCoverage(source: string, destination: string, liveRoot: string, fs: SessionFileSystem): Promise<boolean>` — returns `false` if the source lcov is absent (coverage not produced), else copies with `normalizeLcov` applied and returns `true`.
  - `StoryRunnerSession.copyCoverage(): Promise<boolean>`.

- [ ] **Step 1: Write the failing test**

Add to `tests/scripts/story-reports.test.ts` (reuse the file's existing temp-dir + real-`fs` harness; the helpers below assume node `fs/promises` is available in that suite — mirror how `copyReports` is exercised there):

```ts
it('copyStoryCoverage normalizes SF paths and writes the destination', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'papai-cov-'))
  const source = join(dir, 'lcov.info')
  const dest = join(dir, 'out', 'lcov.info')
  await writeFile(source, 'SF:/session/app/src/x.ts\nDA:1,1\nend_of_record')
  const copied = await copyStoryCoverage(source, dest, dir, sessionFs)
  expect(copied).toBe(true)
  expect(await readFile(dest, 'utf8')).toContain('SF:src/x.ts')
})

it('copyStoryCoverage returns false when the source is missing', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'papai-cov-'))
  const copied = await copyStoryCoverage(join(dir, 'missing.info'), join(dir, 'out.info'), dir, sessionFs)
  expect(copied).toBe(false)
})
```

> `sessionFs` here is the same `SessionFileSystem` implementation the existing `copyReports` tests use in this file. If the file builds it inline, reuse that; otherwise construct it from `node:fs/promises` as the other tests do.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/scripts/story-reports.test.ts`
Expected: FAIL — `copyStoryCoverage` is not exported.

- [ ] **Step 3: Implement in `reports.ts`**

Add the import at the top of `scripts/story/reports.ts`:

```ts
import { normalizeLcov } from '../coverage/normalize-lcov.js'
```

Add the constant near `STORY_JUNIT_REPORT_PATH`:

```ts
export const STORY_COVERAGE_LCOV_PATH = 'reports/stories/coverage/lcov.info'
```

Add an optional `transform` parameter to `copyReport` (thread it into the write):

```ts
async function copyReport(
  source: string,
  destination: string,
  liveRoot: string,
  fs: SessionFileSystem,
  transform?: (data: Uint8Array) => Uint8Array,
): Promise<void> {
  await assertRegularFile(source, fs)
  await assertSafeDestination(liveRoot, destination, fs)
  await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 })
  await assertSafeDestination(liveRoot, destination, fs)
  const input = await fs.open(source, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const output = await fs.open(
      destination,
      constants.O_CREAT | constants.O_TRUNC | constants.O_WRONLY | constants.O_NOFOLLOW,
      0o600,
    )
    try {
      await assertOpenedDestination(output, destination, liveRoot, fs)
      const data = await input.readFile()
      await output.writeFile(transform ? transform(data) : data)
    } finally {
      await output.close()
    }
  } finally {
    await input.close()
  }
}
```

Add `copyStoryCoverage` (existence check via `lstat`, then a transforming `copyReport`):

```ts
async function coverageSourceExists(source: string, fs: SessionFileSystem): Promise<boolean> {
  try {
    return (await fs.lstat(source)).isFile()
  } catch {
    return false
  }
}

export async function copyStoryCoverage(
  source: string,
  destination: string,
  liveRoot: string,
  fs: SessionFileSystem,
): Promise<boolean> {
  if (!(await coverageSourceExists(source, fs))) return false
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  await copyReport(source, destination, liveRoot, fs, (data) => encoder.encode(normalizeLcov(decoder.decode(data))))
  return true
}
```

- [ ] **Step 4: Implement in `session.ts`**

Add the import (extend the existing `./reports.js` import list):

```ts
import {
  copyReports,
  copyStoryCoverage,
  createReportFiles,
  reporterMappings,
  STORY_COVERAGE_LCOV_PATH,
  type ReportMapping,
  type SessionFileSystem,
  verifyReportFiles,
} from './reports.js'
```

Add to the `StoryRunnerSession` type (after `copyReports(): Promise<void>`):

```ts
  copyCoverage(): Promise<boolean>
```

Add to the object returned by `materializeSession` (after the `copyReports:` line):

```ts
      copyCoverage: (): Promise<boolean> =>
        copyStoryCoverage(
          path.join(tempRoot, 'coverage', 'lcov.info'),
          path.join(options.root, STORY_COVERAGE_LCOV_PATH),
          options.root,
          fs,
        ),
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test tests/scripts/story-reports.test.ts tests/scripts/story-runner-session.test.ts tests/scripts/story-child-coverage.test.ts`
Expected: PASS (the child test's `copyCoverage` fake now matches the type).

- [ ] **Step 6: Commit**

```bash
git add scripts/story/reports.ts scripts/story/session.ts tests/scripts/story-reports.test.ts
git commit -m "feat(story-runner): copy + normalize child lcov via session.copyCoverage"
```

---

### Task 7: Wire collection + gate into the runner

**Files:**
- Modify: `scripts/story/test-stories.ts:9-20` (imports), `:255-261` (post-child wiring)
- Modify: `package.json:52` (add `test:stories:coverage` script)
- Test: `tests/scripts/test-stories.test.ts` (extend)

**Interfaces:**
- Consumes: `parsed.coverage` (Task 3), `session.copyCoverage` (Task 6), `evaluateStoryCoverage`/`readCoverageFloor`/`formatStoryCoverageEvaluation`/`STORY_COVERAGE_FLOOR_PATH` (Task 2), `STORY_COVERAGE_LCOV_PATH` (Task 6).
- Produces: when `--coverage` is set and the child succeeded, a below-floor coverage result forces a non-zero exit code; the aggregate is printed either way. When the child already failed, its exit code is preserved (coverage is still copied + printed).

- [ ] **Step 1: Write the failing test**

Extend `tests/scripts/test-stories.test.ts`. Mirror the existing dependency-injection harness in that file (it already fakes `spawn`, `createStoryRunnerSession`, etc.). Drive `runStoryTests(['--coverage'])` with a fake session whose `copyCoverage` resolves `true` and whose live coverage file the test pre-writes below the floor, asserting the returned exit code is non-zero. Concretely, assert:

```ts
it('fails the run when --coverage totals are below the floor', async () => {
  // Arrange a fake session (copyReports/copyCoverage resolve; child exits 0)
  // and write reports/stories/coverage/lcov.info under the runner cwd with
  // totals below scripts/story/coverage-floor.json.
  const exitCode = await runStoryTests(['--coverage'], depsWithFakeSession)
  expect(exitCode).not.toBe(0)
})

it('does not gate coverage without --coverage', async () => {
  const exitCode = await runStoryTests([], depsWithFakeSession)
  expect(exitCode).toBe(0)
})
```

> Use the file's existing fake-session/deps builder. The key behavioral assertions are: `--coverage` + below-floor → non-zero; no `--coverage` → unchanged.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/scripts/test-stories.test.ts`
Expected: FAIL — no gate; `--coverage` run returns the child's `0`.

- [ ] **Step 3: Implement imports**

In `scripts/story/test-stories.ts`, add:

```ts
import { readFile } from 'node:fs/promises'

import {
  evaluateStoryCoverage,
  formatStoryCoverageEvaluation,
  readCoverageFloor,
  STORY_COVERAGE_FLOOR_PATH,
} from '../coverage/story-coverage-gate.js'
import { STORY_COVERAGE_LCOV_PATH } from './reports.js'
```

(Adjust the existing `./reports.js` / `./coverage-totals.js` import groupings to keep them tidy; `STORY_COVERAGE_LCOV_PATH` may be added to the existing `reports.js` import if one exists.)

- [ ] **Step 4: Implement the post-child wiring**

Replace the tail of the `withSessionLifecycle` callback in `executeStoryTests`:

```ts
    const child = spawnStorySandboxedChild(parsed, dependencies, files, session)
    lifecycle.attachChild(child)
    const exitCode = await waitForChild(child)
    await session.verifyIntegrity()
    await session.copyReports()
    if (!parsed.coverage) return exitCode
    return await gateStoryCoverage(dependencies, session, exitCode)
```

Add the helper function (near `executeStoryTests`):

```ts
async function gateStoryCoverage(
  dependencies: RunnerDependencies,
  session: StoryRunnerSession,
  childExitCode: number,
): Promise<number> {
  const copied = await session.copyCoverage()
  if (!copied) {
    console.warn('T0 coverage requested but no lcov was produced by the child run')
    return childExitCode
  }
  const lcov = await readFile(path.join(dependencies.cwd, STORY_COVERAGE_LCOV_PATH), 'utf8')
  const floor = await readCoverageFloor(path.join(dependencies.cwd, STORY_COVERAGE_FLOOR_PATH))
  const evaluation = evaluateStoryCoverage(lcov, floor)
  console.log(formatStoryCoverageEvaluation(evaluation))
  if (!evaluation.pass && childExitCode === 0) return 1
  return childExitCode
}
```

- [ ] **Step 5: Add the package.json script**

In `package.json`, after `"test:stories"`:

```json
    "test:stories:coverage": "bun scripts/story/test-stories.ts --coverage",
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun test tests/scripts/test-stories.test.ts`
Expected: PASS (gate bites with `--coverage`; unchanged without).

- [ ] **Step 7: Commit**

```bash
git add scripts/story/test-stories.ts package.json tests/scripts/test-stories.test.ts
git commit -m "feat(story-runner): collect + gate T0 coverage when --coverage is set"
```

---

### Task 8: `coverage:ratchet:stories` command

**Files:**
- Create: `scripts/coverage/ratchet-stories.ts`
- Modify: `package.json` (add `coverage:ratchet:stories`)
- Test: `tests/scripts/story-coverage-ratchet.test.ts`

**Interfaces:**
- Consumes: `parseLcovTotals`, `nextFloor` from `ratchet-lib.js`; `parseCoverageFloor`, `STORY_COVERAGE_FLOOR_PATH` from `story-coverage-gate.js`; `STORY_COVERAGE_LCOV_PATH` from `reports.js`.
- Produces: `computeRatchetedFloor(lcov: string, current: CoverageFloor, epsilon: number): CoverageFloor` (pure, never lowers a value) and a CLI entry that rewrites `scripts/story/coverage-floor.json` when coverage improved.
- Constants: `EPSILON = 0.005`.

- [ ] **Step 1: Write the failing test**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import { computeRatchetedFloor } from '../../scripts/coverage/ratchet-stories.js'

const LCOV = ['SF:src/a.ts', 'FNF:1', 'FNH:1', 'DA:1,1', 'DA:2,1', 'LF:2', 'LH:2', 'end_of_record'].join('\n')

describe('computeRatchetedFloor', () => {
  it('raises the floor toward measured coverage minus epsilon', () => {
    const next = computeRatchetedFloor(LCOV, { lines: 0.5, functions: 0.5 }, 0.005)
    expect(next.lines).toBeGreaterThan(0.5)
    expect(next.functions).toBeGreaterThan(0.5)
  })

  it('never lowers an existing floor', () => {
    const next = computeRatchetedFloor(LCOV, { lines: 0.99, functions: 0.99 }, 0.005)
    expect(next.lines).toBe(0.99)
    expect(next.functions).toBe(0.99)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/scripts/story-coverage-ratchet.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { readFile, writeFile } from 'node:fs/promises'

import { nextFloor, parseLcovTotals } from './ratchet-lib.js'
import { type CoverageFloor, parseCoverageFloor, STORY_COVERAGE_FLOOR_PATH } from './story-coverage-gate.js'
import { STORY_COVERAGE_LCOV_PATH } from '../story/reports.js'

const EPSILON = 0.005

export function computeRatchetedFloor(lcov: string, current: CoverageFloor, epsilon: number): CoverageFloor {
  const totals = parseLcovTotals(lcov)
  return {
    lines: nextFloor(current.lines, totals.lines.pct, epsilon),
    functions: nextFloor(current.functions, totals.functions.pct, epsilon),
  }
}

async function main(): Promise<void> {
  const lcov = await readFile(STORY_COVERAGE_LCOV_PATH, 'utf8')
  const current = parseCoverageFloor(await readFile(STORY_COVERAGE_FLOOR_PATH, 'utf8'))
  const next = computeRatchetedFloor(lcov, current, EPSILON)
  if (next.lines === current.lines && next.functions === current.functions) {
    console.log('T0 coverage floor unchanged.')
    return
  }
  await writeFile(STORY_COVERAGE_FLOOR_PATH, `${JSON.stringify(next)}\n`)
  console.log(`T0 coverage floor raised to lines ${next.lines}, functions ${next.functions}. Commit the change.`)
}

if (import.meta.main) await main()
```

- [ ] **Step 4: Add the package.json script**

```json
    "coverage:ratchet:stories": "bun scripts/coverage/ratchet-stories.ts",
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test tests/scripts/story-coverage-ratchet.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add scripts/coverage/ratchet-stories.ts package.json tests/scripts/story-coverage-ratchet.test.ts
git commit -m "feat(coverage): coverage:ratchet:stories raises the T0 floor from green runs"
```

---

### Task 9: CI wiring + docs

**Files:**
- Modify: `.github/workflows/ci.yml:127-136` (stories job)
- Modify: `tests/CLAUDE.md`
- Verify: `scripts/snapshot-bunfig.toml` does not exclude `src/` from coverage

- [ ] **Step 1: Verify snapshot config does not suppress src coverage**

Run: `grep -n "coverage" scripts/snapshot-bunfig.toml || echo "no coverage keys (defaults apply)"`
Expected: no `coveragePathIgnorePatterns`/`coverageSkipTestFiles=false` that would drop `src/`. If any coverage key excludes `src/`, note it and stop — the design assumes bun defaults (`coverageSkipTestFiles=true`, no src exclusions). Bun counts loaded `src/` files by default.

- [ ] **Step 2: Point the stories job at the coverage run**

In `.github/workflows/ci.yml`, change the "Run hermetic full-stack stories" step (line ~127-130):

```yaml
      - name: Run hermetic full-stack stories
        env:
          PAPAI_REQUIRE_STORY_SANDBOX: '1'
        run: bun test:stories:coverage
```

The existing "Upload story reports" step (`path: reports/stories/**`) already captures `reports/stories/coverage/lcov.info` — no new upload step needed.

- [ ] **Step 3: Document in `tests/CLAUDE.md`**

Add a short subsection (place it near the story-runner / tiers guidance):

```markdown
### T0 story-lane line coverage

`bun test:stories:coverage` runs the hermetic story lane with `--coverage`,
copies the sandbox child's lcov to `reports/stories/coverage/lcov.info`, and
fails the run if `src/` line/function coverage drops below the committed floor in
`scripts/story/coverage-floor.json` (starts at `0.50/0.50`, unmeasured). This is
the refactor-resilient tier's own reachability number, separate from the
in-process floor in `bunfig.toml` (see the CI line-coverage floor). Raise it from
a green run with `bun coverage:ratchet:stories`, then commit the JSON change. CI
runs the coverage variant in the `stories` job and never writes the floor.
```

- [ ] **Step 4: Validate config + license headers**

Run: `bun run check:full`
Expected: PASS (lint, typecheck, license-headers, format all green).

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml tests/CLAUDE.md
git commit -m "ci(stories): run T0 story lane with coverage gate; document floor"
```

---

## Post-implementation (deferred to Item 5 landing)

After Item 5 makes the suite green and a first `bun test:stories:coverage` run
succeeds locally with Docker:

- [ ] Run `bun test:stories:coverage` and capture the measured T0 line/function %.
- [ ] Run `bun coverage:ratchet:stories` to tighten `scripts/story/coverage-floor.json` from `0.50/0.50` to the real baseline.
- [ ] Commit the tightened floor: `git commit -am "chore(coverage): lock T0 floor to measured baseline"`.

## Self-Review

- **Spec coverage:** collection (Tasks 3–5), extraction+normalization (Tasks 1, 6), totals/floor/gate (Tasks 2, 7), CI+artifact (Task 9), ratchet (Task 8), docs (Task 9), cross-item interactions — snapshot-bunfig verified in Task 9 Step 1; Item 1 `bunfig.toml` independence is inherent (story child uses `snapshot-bunfig.toml`), noted in the spec. Single-child reality (no merge) reflected throughout.
- **Placeholder scan:** no TBD/TODO; every code step carries complete code. The two test tasks that reuse existing harnesses (Tasks 6, 7) point to the concrete file's existing DI pattern with explicit assertions rather than re-inventing the harness — acceptable because the fixture is already established in-repo and reproducing it verbatim risks drift.
- **Type consistency:** `CoverageFloor = { lines: number; functions: number }` identical across Tasks 2, 8; `CoverageMetric`/`parseLcovTotals`/`nextFloor` reused from `ratchet-lib.js` with Item 1's signatures; `copyCoverage(): Promise<boolean>` matches between Tasks 5 (fake), 6 (impl), 7 (consumer); constants `STORY_COVERAGE_LCOV_PATH` / `STORY_COVERAGE_FLOOR_PATH` defined once and imported everywhere. Floor values are fractions throughout.
