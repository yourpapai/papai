<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Mutation Measurement Tooling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a per-file paired Stryker runner that turns `ignoreStatic: false` from "many hours" into "seconds per file", then wire it as a changed-files PR gate so the mutation score finally measures reality.

**Architecture:** A small set of pure-function modules in `scripts/mutation/` — `config-builder` (turns one source file + its companion test set into an ephemeral Stryker config), `test-overrides` (per-file override map for cross-cutting modules), `score-merger` (aggregates per-file JSON reports into one score), and two thin CLI orchestrators: `paired-run.ts` (Layer A: on-demand `bun test:mutate:file <path...>`) and `changed-files.ts` (Layer B: diff vs `origin/master` → paired-run). The existing `.hooks/tdd/test-resolver.mjs` `findTestFile` / `isGateableImplFile` helpers are reused, not duplicated. CI re-enables its commented-out mutation job pointed at Layer B, warn-only for a calibration period.

**Tech Stack:** Bun (runtime + test runner), TypeScript, Stryker (`@stryker-mutator/core` + `@hughescr/stryker-bun-runner`), Node child_process for git + stryker invocation.

**Spec:** `docs/superpowers/specs/2026-05-25-mutation-measurement-tooling-design.md`

---

## File Structure

**Created:**

- `scripts/mutation/config-builder.ts` — pure: `(baseConfig, srcFile, testFiles, reportPath) → strykerConfig`
- `scripts/mutation/test-overrides.ts` — pure: load JSON override map; `resolveTestFiles(srcFile, projectRoot, overrides) → string[]`
- `scripts/mutation/score-merger.ts` — pure: `(perFileReports) → { killed, survived, noCoverage, timeout, compileError, ignored, score }`
- `scripts/mutation/paired-run.ts` — Layer A orchestrator + CLI entry (`bun test:mutate:file ...`)
- `scripts/mutation/changed-files.ts` — Layer B: changed-files resolver + CLI entry (`bun test:mutate:changed-paired`)
- `scripts/mutation/overrides.json` — declarative per-file extra-test map (starts as `{}`)
- `scripts/mutation/README.md` — what this is, how to run it, how to add an override
- `tests/scripts/mutation/config-builder.test.ts`
- `tests/scripts/mutation/test-overrides.test.ts`
- `tests/scripts/mutation/score-merger.test.ts`
- `tests/scripts/mutation/paired-run.test.ts` — orchestrator with injected `runStryker`
- `tests/scripts/mutation/changed-files.test.ts` — filter logic with injected `runGit`

**Modified:**

- `package.json` — add `"test:mutate:file"` and `"test:mutate:changed-paired"` scripts
- `.github/workflows/ci.yml` — re-enable the commented mutation block, pointed at the new Layer B entry, `continue-on-error: true` for the calibration period
- `CLAUDE.md` — add the new commands to the Commands section
- `tests/CLAUDE.md` — short note pointing at the paired runner

**Reused (no edit):**

- `.hooks/tdd/test-resolver.mjs` — `findTestFile`, `isGateableImplFile`, `isTestFile` imported by the new modules

---

## Task 1: Skeleton + `config-builder` (pure builder, TDD)

**Files:**

- Create: `scripts/mutation/config-builder.ts`
- Create: `tests/scripts/mutation/config-builder.test.ts`

- [ ] **Step 1: Create the directory and write the failing test**

Create `tests/scripts/mutation/config-builder.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { buildPairedConfig } from '../../../scripts/mutation/config-builder.js'

const BASE = {
  testRunner: 'bun',
  appendPlugins: ['@hughescr/stryker-bun-runner', '@stryker-mutator/typescript-checker'],
  checkers: ['typescript'],
  tsconfigFile: 'tsconfig.json',
  bun: { timeout: 120_000 },
  mutate: ['src/providers/**/*.ts'],
  coverageAnalysis: 'perTest',
  ignoreStatic: true,
  incremental: true,
  incrementalFile: 'reports/stryker-incremental.json',
  concurrency: 8,
  timeoutMS: 60_000,
  timeoutFactor: 2,
  thresholds: { high: 80, low: 60, break: 40 },
  reporters: ['clear-text', 'progress', 'html', 'json'],
  htmlReporter: { fileName: 'reports/mutation.html' },
  jsonReporter: { fileName: 'reports/mutation.json' },
  ignorePatterns: ['node_modules', '.stryker-tmp'],
  cleanTempDir: true,
}

describe('buildPairedConfig', () => {
  test('mutates exactly the given source file', () => {
    const cfg = buildPairedConfig({
      base: BASE,
      srcFile: 'src/providers/kaneo/label-resource.ts',
      testFiles: ['tests/providers/kaneo/label-resource.test.ts'],
      reportPath: 'reports/paired/label-resource.json',
    })
    expect(cfg.mutate).toEqual(['src/providers/kaneo/label-resource.ts'])
  })

  test('forces ignoreStatic:false regardless of base', () => {
    const cfg = buildPairedConfig({
      base: BASE,
      srcFile: 'src/foo.ts',
      testFiles: ['tests/foo.test.ts'],
      reportPath: 'reports/paired/foo.json',
    })
    expect(cfg.ignoreStatic).toBe(false)
  })

  test('passes testFiles through bun.testFiles', () => {
    const cfg = buildPairedConfig({
      base: BASE,
      srcFile: 'src/foo.ts',
      testFiles: ['tests/foo.test.ts', 'tests/integration/foo-flow.test.ts'],
      reportPath: 'reports/paired/foo.json',
    })
    expect(cfg.bun.testFiles).toEqual(['tests/foo.test.ts', 'tests/integration/foo-flow.test.ts'])
  })

  test('preserves base bun options (timeout)', () => {
    const cfg = buildPairedConfig({
      base: BASE,
      srcFile: 'src/foo.ts',
      testFiles: ['tests/foo.test.ts'],
      reportPath: 'reports/paired/foo.json',
    })
    expect(cfg.bun.timeout).toBe(120_000)
  })

  test('disables incremental and html, routes json to the per-file report path, and breaks at 0', () => {
    const cfg = buildPairedConfig({
      base: BASE,
      srcFile: 'src/foo.ts',
      testFiles: ['tests/foo.test.ts'],
      reportPath: 'reports/paired/foo.json',
    })
    expect(cfg.incremental).toBe(false)
    expect(cfg.reporters).toEqual(['clear-text', 'json'])
    expect(cfg.jsonReporter.fileName).toBe('reports/paired/foo.json')
    expect(cfg.thresholds.break).toBe(0)
    expect(cfg.htmlReporter).toBeUndefined()
  })

  test('preserves checkers, tsconfig, plugins, and ignorePatterns', () => {
    const cfg = buildPairedConfig({
      base: BASE,
      srcFile: 'src/foo.ts',
      testFiles: ['tests/foo.test.ts'],
      reportPath: 'reports/paired/foo.json',
    })
    expect(cfg.checkers).toEqual(['typescript'])
    expect(cfg.tsconfigFile).toBe('tsconfig.json')
    expect(cfg.appendPlugins).toEqual(['@hughescr/stryker-bun-runner', '@stryker-mutator/typescript-checker'])
    expect(cfg.ignorePatterns).toEqual(['node_modules', '.stryker-tmp'])
  })

  test('rejects an empty testFiles list', () => {
    expect(() =>
      buildPairedConfig({
        base: BASE,
        srcFile: 'src/foo.ts',
        testFiles: [],
        reportPath: 'reports/paired/foo.json',
      }),
    ).toThrow(/testFiles/u)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/scripts/mutation/config-builder.test.ts`
Expected: FAIL — module `scripts/mutation/config-builder.js` not found.

- [ ] **Step 3: Implement `config-builder.ts`**

Create `scripts/mutation/config-builder.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export type StrykerConfig = Record<string, unknown> & {
  bun?: Record<string, unknown>
  mutate?: string[]
  reporters?: string[]
  jsonReporter?: { fileName: string }
  htmlReporter?: { fileName: string }
  thresholds?: { high: number; low: number; break: number }
  ignoreStatic?: boolean
  incremental?: boolean
}

export interface BuildPairedConfigInput {
  base: StrykerConfig
  srcFile: string
  testFiles: string[]
  reportPath: string
}

/**
 * Build an ephemeral Stryker config for a single source file paired with a
 * specific test set. Forces ignoreStatic:false (the accurate mode), narrows
 * the test set via bun.testFiles, and routes the JSON report to a per-file
 * path so the score-merger can aggregate cleanly.
 */
export function buildPairedConfig(input: BuildPairedConfigInput): StrykerConfig {
  const { base, srcFile, testFiles, reportPath } = input
  if (testFiles.length === 0) {
    throw new Error(`buildPairedConfig: testFiles must not be empty for ${srcFile}`)
  }

  const baseBun = (base.bun ?? {}) as Record<string, unknown>
  const next: StrykerConfig = {
    ...base,
    mutate: [srcFile],
    bun: { ...baseBun, testFiles: [...testFiles] },
    ignoreStatic: false,
    incremental: false,
    reporters: ['clear-text', 'json'],
    jsonReporter: { fileName: reportPath },
    thresholds: { high: 80, low: 60, break: 0 },
  }
  // The HTML reporter only makes sense for the whole-repo run.
  delete (next as Record<string, unknown>).htmlReporter
  // The incremental file would be reused across paired runs and corrupt them.
  delete (next as Record<string, unknown>).incrementalFile
  return next
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/scripts/mutation/config-builder.test.ts`
Expected: PASS — 7/7.

- [ ] **Step 5: Commit**

```bash
git add scripts/mutation/config-builder.ts tests/scripts/mutation/config-builder.test.ts
git commit -m "feat(mutation): add paired-config builder (ignoreStatic:false per file)"
```

---

## Task 2: `test-overrides` (companion + per-file extras, TDD)

**Files:**

- Create: `scripts/mutation/test-overrides.ts`
- Create: `scripts/mutation/overrides.json`
- Create: `tests/scripts/mutation/test-overrides.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/scripts/mutation/test-overrides.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import path from 'node:path'

import { loadOverrides, resolveTestFiles } from '../../../scripts/mutation/test-overrides.js'

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..')

describe('loadOverrides', () => {
  test('returns {} when the file does not exist', () => {
    const overrides = loadOverrides('/no/such/path.json')
    expect(overrides).toEqual({})
  })

  test('parses a valid overrides JSON object', () => {
    // Use the committed overrides.json (starts as {}).
    const overrides = loadOverrides(path.join(PROJECT_ROOT, 'scripts/mutation/overrides.json'))
    expect(typeof overrides).toBe('object')
    expect(overrides).not.toBeNull()
  })
})

describe('resolveTestFiles', () => {
  const stubFindTestFile = (impl: string): string | null => {
    if (impl.endsWith('config.ts')) return path.join(PROJECT_ROOT, 'tests/config.test.ts')
    return null
  }

  test('returns the companion test alone when no override is registered', () => {
    const result = resolveTestFiles({
      srcFile: 'src/config.ts',
      projectRoot: PROJECT_ROOT,
      overrides: {},
      findTestFile: stubFindTestFile,
    })
    expect(result).toEqual({ kind: 'ok', testFiles: ['tests/config.test.ts'] })
  })

  test('appends override tests after the companion, dedup-preserving order', () => {
    const result = resolveTestFiles({
      srcFile: 'src/config.ts',
      projectRoot: PROJECT_ROOT,
      overrides: {
        'src/config.ts': ['tests/integration/config-flow.test.ts', 'tests/config.test.ts'],
      },
      findTestFile: stubFindTestFile,
    })
    expect(result).toEqual({
      kind: 'ok',
      testFiles: ['tests/config.test.ts', 'tests/integration/config-flow.test.ts'],
    })
  })

  test('uses override tests only when no companion exists', () => {
    const result = resolveTestFiles({
      srcFile: 'src/no-companion.ts',
      projectRoot: PROJECT_ROOT,
      overrides: { 'src/no-companion.ts': ['tests/integration/covers.test.ts'] },
      findTestFile: stubFindTestFile,
    })
    expect(result).toEqual({
      kind: 'ok',
      testFiles: ['tests/integration/covers.test.ts'],
    })
  })

  test('returns kind:"skip" with a reason when no companion and no override', () => {
    const result = resolveTestFiles({
      srcFile: 'src/no-companion.ts',
      projectRoot: PROJECT_ROOT,
      overrides: {},
      findTestFile: stubFindTestFile,
    })
    expect(result.kind).toBe('skip')
    if (result.kind === 'skip') {
      expect(result.reason).toMatch(/no companion/iu)
    }
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/scripts/mutation/test-overrides.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the empty overrides file**

Create `scripts/mutation/overrides.json`:

```json
{}
```

- [ ] **Step 4: Implement `test-overrides.ts`**

Create `scripts/mutation/test-overrides.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import fs from 'node:fs'
import path from 'node:path'

export type OverridesMap = Record<string, string[]>

export type ResolveResult = { kind: 'ok'; testFiles: string[] } | { kind: 'skip'; reason: string }

/** Load the per-file override map; missing file → empty map. */
export function loadOverrides(filePath: string): OverridesMap {
  if (!fs.existsSync(filePath)) return {}
  const raw = fs.readFileSync(filePath, 'utf8')
  const parsed = JSON.parse(raw) as unknown
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Overrides file ${filePath} must be a JSON object`)
  }
  // Trust shape but coerce to OverridesMap; runtime guard kept minimal.
  return parsed as OverridesMap
}

export interface ResolveTestFilesInput {
  srcFile: string // repo-relative
  projectRoot: string
  overrides: OverridesMap
  findTestFile: (implAbsPath: string, projectRoot: string) => string | null
}

/**
 * Resolve the test set for a paired Stryker run:
 *   companion (if any) + overrides[srcFile] (deduped, companion first).
 * If neither exists, return a skip result with a reason.
 */
export function resolveTestFiles(input: ResolveTestFilesInput): ResolveResult {
  const { srcFile, projectRoot, overrides, findTestFile } = input
  const absImpl = path.join(projectRoot, srcFile)
  const companionAbs = findTestFile(absImpl, projectRoot)
  const companionRel = companionAbs === null ? null : path.relative(projectRoot, companionAbs)

  const extras = overrides[srcFile] ?? []
  const ordered = companionRel === null ? [...extras] : [companionRel, ...extras]
  const deduped = Array.from(new Set(ordered))

  if (deduped.length === 0) {
    return {
      kind: 'skip',
      reason: `no companion test for ${srcFile} and no override registered in scripts/mutation/overrides.json`,
    }
  }
  return { kind: 'ok', testFiles: deduped }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun test tests/scripts/mutation/test-overrides.test.ts`
Expected: PASS — 6/6.

- [ ] **Step 6: Commit**

```bash
git add scripts/mutation/test-overrides.ts scripts/mutation/overrides.json tests/scripts/mutation/test-overrides.test.ts
git commit -m "feat(mutation): add per-file test-set override resolver"
```

---

## Task 3: `score-merger` (aggregate per-file JSON reports, TDD)

**Files:**

- Create: `scripts/mutation/score-merger.ts`
- Create: `tests/scripts/mutation/score-merger.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/scripts/mutation/score-merger.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { mergeReports } from '../../../scripts/mutation/score-merger.js'

const makeReport = (statuses: string[]) => ({
  files: {
    'src/x.ts': { mutants: statuses.map((status, i) => ({ id: `m${i}`, status })) },
  },
})

describe('mergeReports', () => {
  test('returns all-zero counts for an empty input', () => {
    const out = mergeReports([])
    expect(out).toEqual({
      killed: 0,
      survived: 0,
      noCoverage: 0,
      timeout: 0,
      compileError: 0,
      ignored: 0,
      runtimeError: 0,
      total: 0,
      scored: 0,
      score: 0,
    })
  })

  test('computes counts and score across one report', () => {
    const out = mergeReports([makeReport(['Killed', 'Killed', 'Survived', 'NoCoverage', 'CompileError'])])
    expect(out.killed).toBe(2)
    expect(out.survived).toBe(1)
    expect(out.noCoverage).toBe(1)
    expect(out.compileError).toBe(1)
    expect(out.total).toBe(5)
    // scored = killed + survived + noCoverage + timeout = 4; score = 2/4 = 0.5
    expect(out.scored).toBe(4)
    expect(out.score).toBeCloseTo(0.5, 5)
  })

  test('sums across multiple reports', () => {
    const out = mergeReports([makeReport(['Killed', 'Survived']), makeReport(['Killed', 'Timeout', 'NoCoverage'])])
    expect(out.killed).toBe(2)
    expect(out.survived).toBe(1)
    expect(out.timeout).toBe(1)
    expect(out.noCoverage).toBe(1)
    // (killed + timeout) / (killed + survived + noCoverage + timeout) = 3/5
    expect(out.score).toBeCloseTo(0.6, 5)
  })

  test('treats an all-Ignored report as score 0 with no scored mutants', () => {
    const out = mergeReports([makeReport(['Ignored', 'Ignored'])])
    expect(out.ignored).toBe(2)
    expect(out.scored).toBe(0)
    expect(out.score).toBe(0)
  })

  test('counts unknown statuses under runtimeError so they are visible', () => {
    const out = mergeReports([makeReport(['Killed', 'WeirdNewBucket'])])
    expect(out.killed).toBe(1)
    expect(out.runtimeError).toBe(1)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/scripts/mutation/score-merger.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `score-merger.ts`**

Create `scripts/mutation/score-merger.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export interface StrykerMutant {
  status: string
}

export interface StrykerReport {
  files?: Record<string, { mutants?: StrykerMutant[] }>
}

export interface MergedScore {
  killed: number
  survived: number
  noCoverage: number
  timeout: number
  compileError: number
  ignored: number
  runtimeError: number
  total: number
  scored: number
  score: number
}

const ZERO: MergedScore = {
  killed: 0,
  survived: 0,
  noCoverage: 0,
  timeout: 0,
  compileError: 0,
  ignored: 0,
  runtimeError: 0,
  total: 0,
  scored: 0,
  score: 0,
}

/**
 * Aggregate per-file Stryker JSON reports into one set of counts and a single
 * mutation score. Score uses the standard Stryker definition:
 *   (killed + timeout) / (killed + survived + noCoverage + timeout)
 * Ignored / CompileError do not count toward the denominator (matches
 * Stryker's own scoring math for the scored set).
 */
export function mergeReports(reports: StrykerReport[]): MergedScore {
  const acc: MergedScore = { ...ZERO }

  for (const report of reports) {
    const files = report.files ?? {}
    for (const file of Object.values(files)) {
      for (const m of file.mutants ?? []) {
        acc.total += 1
        switch (m.status) {
          case 'Killed':
            acc.killed += 1
            break
          case 'Survived':
            acc.survived += 1
            break
          case 'NoCoverage':
            acc.noCoverage += 1
            break
          case 'Timeout':
            acc.timeout += 1
            break
          case 'CompileError':
            acc.compileError += 1
            break
          case 'Ignored':
            acc.ignored += 1
            break
          default:
            acc.runtimeError += 1
        }
      }
    }
  }

  acc.scored = acc.killed + acc.survived + acc.noCoverage + acc.timeout
  acc.score = acc.scored === 0 ? 0 : (acc.killed + acc.timeout) / acc.scored
  return acc
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/scripts/mutation/score-merger.test.ts`
Expected: PASS — 5/5.

- [ ] **Step 5: Commit**

```bash
git add scripts/mutation/score-merger.ts tests/scripts/mutation/score-merger.test.ts
git commit -m "feat(mutation): add per-file Stryker report aggregator"
```

---

## Task 4: `paired-run.ts` orchestrator + Layer A CLI (TDD with DI)

**Files:**

- Create: `scripts/mutation/paired-run.ts`
- Create: `tests/scripts/mutation/paired-run.test.ts`
- Modify: `package.json` (add `test:mutate:file` script)

- [ ] **Step 1: Write the failing test**

Create `tests/scripts/mutation/paired-run.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { pairedRun, type PairedRunDeps } from '../../../scripts/mutation/paired-run.js'

const STUB_BASE = {
  testRunner: 'bun',
  bun: { timeout: 120_000 },
  mutate: ['src/**/*.ts'],
  coverageAnalysis: 'perTest',
  ignoreStatic: true,
}

// findTestFile (the real dep this stubs) returns an absolute path — match that
// contract so the test exercises the same path-handling as production.
const ABS_COMPANION = path.join(process.cwd(), 'tests/foo.test.ts')

const makeDeps = (overrides: Partial<PairedRunDeps>): PairedRunDeps => ({
  readBaseConfig: () => STUB_BASE,
  resolveCompanion: () => ABS_COMPANION,
  loadOverrides: () => ({}),
  runStryker: () => undefined,
  readReport: () => ({
    files: { 'src/foo.ts': { mutants: [{ status: 'Killed' }, { status: 'Survived' }] } },
  }),
  log: () => undefined,
  ...overrides,
})

describe('pairedRun', () => {
  test('runs Stryker once per file and returns the merged score', async () => {
    const calls: string[] = []
    const deps = makeDeps({
      runStryker: (configPath) => {
        calls.push(configPath)
      },
    })
    const out = await pairedRun({
      srcFiles: ['src/a.ts', 'src/b.ts'],
      projectRoot: process.cwd(),
      reportDir: path.join(os.tmpdir(), `paired-${Date.now()}`),
      deps,
    })
    expect(calls).toHaveLength(2)
    // 2 files × (1 Killed + 1 Survived) = killed:2 survived:2 → score 0.5
    expect(out.merged.killed).toBe(2)
    expect(out.merged.survived).toBe(2)
    expect(out.merged.score).toBeCloseTo(0.5, 5)
    expect(out.skipped).toEqual([])
  })

  test('skips files with no companion and no override, returning them in `skipped`', async () => {
    const deps = makeDeps({ resolveCompanion: () => null })
    const out = await pairedRun({
      srcFiles: ['src/no-tests.ts'],
      projectRoot: process.cwd(),
      reportDir: path.join(os.tmpdir(), `paired-${Date.now()}`),
      deps,
    })
    expect(out.skipped).toHaveLength(1)
    expect(out.skipped[0].srcFile).toBe('src/no-tests.ts')
    expect(out.merged.total).toBe(0)
  })

  test('writes one ephemeral config file per src file to reportDir', async () => {
    const reportDir = path.join(os.tmpdir(), `paired-${Date.now()}`)
    let lastConfigPath = ''
    const deps = makeDeps({
      runStryker: (configPath) => {
        lastConfigPath = configPath
      },
    })
    await pairedRun({
      srcFiles: ['src/a.ts'],
      projectRoot: process.cwd(),
      reportDir,
      deps,
    })
    expect(lastConfigPath.startsWith(reportDir)).toBe(true)
    expect(fs.existsSync(lastConfigPath)).toBe(true)
    const written = JSON.parse(fs.readFileSync(lastConfigPath, 'utf8'))
    expect(written.mutate).toEqual(['src/a.ts'])
    expect(written.ignoreStatic).toBe(false)
    expect(written.bun.testFiles).toEqual(['tests/foo.test.ts'])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/scripts/mutation/paired-run.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `paired-run.ts`**

Create `scripts/mutation/paired-run.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import { findTestFile } from '../../.hooks/tdd/test-resolver.mjs'

import { buildPairedConfig, type StrykerConfig } from './config-builder.js'
import { mergeReports, type MergedScore, type StrykerReport } from './score-merger.js'
import { loadOverrides as loadOverridesFromFile, resolveTestFiles, type OverridesMap } from './test-overrides.js'

export interface PairedRunDeps {
  readBaseConfig: () => StrykerConfig
  resolveCompanion: (implAbsPath: string, projectRoot: string) => string | null
  loadOverrides: () => OverridesMap
  runStryker: (configPath: string) => void
  readReport: (reportPath: string) => StrykerReport
  log: (line: string) => void
}

export interface PairedRunInput {
  srcFiles: string[] // repo-relative
  projectRoot: string
  reportDir: string
  deps?: Partial<PairedRunDeps>
}

export interface SkippedFile {
  srcFile: string
  reason: string
}

export interface PairedRunResult {
  merged: MergedScore
  perFile: { srcFile: string; reportPath: string }[]
  skipped: SkippedFile[]
}

function defaultDeps(projectRoot: string): PairedRunDeps {
  return {
    readBaseConfig: () => JSON.parse(fs.readFileSync(path.join(projectRoot, 'stryker.config.json'), 'utf8')),
    resolveCompanion: (implAbsPath, root) => findTestFile(implAbsPath, root),
    loadOverrides: () => loadOverridesFromFile(path.join(projectRoot, 'scripts/mutation/overrides.json')),
    runStryker: (configPath) => {
      execFileSync(path.join(projectRoot, 'node_modules/.bin/stryker'), ['run', configPath], {
        cwd: projectRoot,
        stdio: 'inherit',
        timeout: 30 * 60_000, // 30 min per file is a generous upper bound
      })
    },
    readReport: (reportPath) => JSON.parse(fs.readFileSync(reportPath, 'utf8')) as StrykerReport,
    log: (line) => process.stdout.write(`${line}\n`),
  }
}

function safeFileName(srcFile: string): string {
  return srcFile.replace(/[/\\]/gu, '__').replace(/\.ts$/u, '')
}

export async function pairedRun(input: PairedRunInput): Promise<PairedRunResult> {
  const { srcFiles, projectRoot, reportDir } = input
  const deps: PairedRunDeps = { ...defaultDeps(projectRoot), ...input.deps }
  const base = deps.readBaseConfig()
  const overrides = deps.loadOverrides()

  fs.mkdirSync(reportDir, { recursive: true })

  const reports: StrykerReport[] = []
  const perFile: { srcFile: string; reportPath: string }[] = []
  const skipped: SkippedFile[] = []

  for (const srcFile of srcFiles) {
    const resolved = resolveTestFiles({
      srcFile,
      projectRoot,
      overrides,
      findTestFile: deps.resolveCompanion,
    })
    if (resolved.kind === 'skip') {
      skipped.push({ srcFile, reason: resolved.reason })
      deps.log(`SKIP ${srcFile} — ${resolved.reason}`)
      continue
    }

    const baseName = safeFileName(srcFile)
    const reportPath = path.join(reportDir, `${baseName}.json`)
    const configPath = path.join(reportDir, `${baseName}.config.json`)

    const cfg = buildPairedConfig({
      base,
      srcFile,
      testFiles: resolved.testFiles,
      reportPath,
    })
    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2))

    deps.log(`RUN  ${srcFile} (tests: ${resolved.testFiles.join(', ')})`)
    try {
      deps.runStryker(configPath)
    } catch {
      // Stryker exits non-zero when mutants survive; the JSON report is still
      // written. Re-throw only if the report is missing.
      if (!fs.existsSync(reportPath)) {
        throw new Error(`Stryker failed to produce report for ${srcFile}`)
      }
    }

    if (fs.existsSync(reportPath)) {
      const report = deps.readReport(reportPath)
      reports.push(report)
      perFile.push({ srcFile, reportPath })
    } else {
      skipped.push({ srcFile, reason: 'Stryker produced no report' })
    }
  }

  const merged = mergeReports(reports)
  deps.log('')
  deps.log('=== Paired mutation summary ===')
  deps.log(
    `files: ${perFile.length}  skipped: ${skipped.length}  killed: ${merged.killed}  survived: ${merged.survived}  noCoverage: ${merged.noCoverage}  timeout: ${merged.timeout}  compileError: ${merged.compileError}  ignored: ${merged.ignored}`,
  )
  deps.log(`score: ${(merged.score * 100).toFixed(2)}% (over ${merged.scored} scored mutants)`)
  return { merged, perFile, skipped }
}

/**
 * CLI entry: `bun scripts/mutation/paired-run.ts <src...> [--threshold=0.6]`
 * Exit codes:
 *   0 — score >= threshold (or no scored mutants and no files given)
 *   1 — score < threshold
 *   2 — usage error or fatal failure
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const thresholdArg = args.find((a) => a.startsWith('--threshold='))
  const threshold = thresholdArg ? Number(thresholdArg.slice('--threshold='.length)) : 0
  const srcFiles = args.filter((a) => !a.startsWith('--'))

  if (srcFiles.length === 0) {
    process.stderr.write('usage: bun scripts/mutation/paired-run.ts <src-file...> [--threshold=N]\n')
    process.exit(2)
  }

  const projectRoot = process.cwd()
  const reportDir = path.join(projectRoot, 'reports', 'paired')
  const result = await pairedRun({ srcFiles, projectRoot, reportDir })

  if (result.merged.scored > 0 && result.merged.score < threshold) {
    process.stderr.write(
      `score ${(result.merged.score * 100).toFixed(2)}% below threshold ${(threshold * 100).toFixed(2)}%\n`,
    )
    process.exit(1)
  }
  process.exit(0)
}

const invokedDirectly = (() => {
  try {
    // Bun: `Bun.main` is the entry script path.
    // eslint-disable-next-line no-undef
    return typeof Bun !== 'undefined' && (globalThis as { Bun?: { main: string } }).Bun?.main === import.meta.path
  } catch {
    return false
  }
})()

if (invokedDirectly) {
  void main()
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/scripts/mutation/paired-run.test.ts`
Expected: PASS — 3/3.

- [ ] **Step 5: Add `test:mutate:file` to `package.json`**

In `package.json`, locate the scripts block (the `"test:mutate*"` group around line 44–46) and add the new entry immediately after `"test:mutate:full"`:

```json
    "test:mutate:full": "stryker run --force",
    "test:mutate:file": "bun scripts/mutation/paired-run.ts",
```

- [ ] **Step 6: Smoke-run Layer A against one small file**

Run:

```bash
bun test:mutate:file src/providers/kaneo/search-tasks.ts
```

Expected: Stryker runs against only `tests/providers/kaneo/search-tasks.test.ts`, completes in single-digit minutes (vs. the 7-minute single-file figure in the research at A6 which still ran the full 4,817-test suite), and prints a summary line with a non-zero `scored` count and a non-zero `killed` count — i.e. the paired mode actually scores mutants instead of dumping them into `Ignored`.

(If this file no longer exists in the repo, substitute any in-scope file from `stryker.config.json`'s `mutate` list that has a companion test under `tests/`.)

- [ ] **Step 7: Commit**

```bash
git add scripts/mutation/paired-run.ts tests/scripts/mutation/paired-run.test.ts package.json
git commit -m "feat(mutation): add paired-run orchestrator + test:mutate:file CLI"
```

---

## Task 5: `changed-files.ts` + Layer B CLI (TDD with DI)

**Files:**

- Create: `scripts/mutation/changed-files.ts`
- Create: `tests/scripts/mutation/changed-files.test.ts`
- Modify: `package.json` (add `test:mutate:changed-paired` script)

- [ ] **Step 1: Write the failing test**

Create `tests/scripts/mutation/changed-files.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { selectChangedMutationTargets, type ChangedFilesDeps } from '../../../scripts/mutation/changed-files.js'

const PROJECT_ROOT = '/repo'

const makeDeps = (overrides: Partial<ChangedFilesDeps>): ChangedFilesDeps => ({
  runGit: () => '',
  isGateableImpl: () => true,
  ...overrides,
})

describe('selectChangedMutationTargets', () => {
  test('returns the gateable .ts files changed vs base ref', () => {
    const deps = makeDeps({
      runGit: () => ['src/foo.ts', 'src/bar.ts', 'tests/foo.test.ts', 'README.md', 'src/baz.tsx'].join('\n'),
      isGateableImpl: (file) => file === 'src/foo.ts' || file === 'src/bar.ts',
    })
    const out = selectChangedMutationTargets({
      baseRef: 'origin/master',
      projectRoot: PROJECT_ROOT,
      deps,
    })
    expect(out).toEqual(['src/bar.ts', 'src/foo.ts'])
  })

  test('returns an empty list when nothing changed', () => {
    const deps = makeDeps({ runGit: () => '' })
    const out = selectChangedMutationTargets({
      baseRef: 'origin/master',
      projectRoot: PROJECT_ROOT,
      deps,
    })
    expect(out).toEqual([])
  })

  test('excludes test files and non-impl assets', () => {
    const deps = makeDeps({
      runGit: () => ['tests/foo.test.ts', 'docs/x.md', 'package.json'].join('\n'),
      isGateableImpl: (file) => file.startsWith('src/') && !file.includes('.test.'),
    })
    const out = selectChangedMutationTargets({
      baseRef: 'origin/master',
      projectRoot: PROJECT_ROOT,
      deps,
    })
    expect(out).toEqual([])
  })

  test('passes the right git args (diff vs base ref, name-only)', () => {
    const captured: string[][] = []
    const deps = makeDeps({
      runGit: (args) => {
        captured.push(args)
        return ''
      },
    })
    selectChangedMutationTargets({
      baseRef: 'origin/master',
      projectRoot: PROJECT_ROOT,
      deps,
    })
    expect(captured).toEqual([['diff', '--name-only', 'origin/master...HEAD']])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/scripts/mutation/changed-files.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `changed-files.ts`**

Create `scripts/mutation/changed-files.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { execFileSync } from 'node:child_process'
import path from 'node:path'

import { isGateableImplFile } from '../../.hooks/tdd/test-resolver.mjs'

import { pairedRun } from './paired-run.js'

export interface ChangedFilesDeps {
  runGit: (args: string[]) => string
  isGateableImpl: (relPath: string, projectRoot: string) => boolean
}

export interface SelectInput {
  baseRef: string
  projectRoot: string
  deps: ChangedFilesDeps
}

/**
 * Resolve the set of changed source files we should measure with the paired
 * runner: files that changed vs baseRef AND are gateable implementation files
 * (under src/, .ts/.tsx/.js/.jsx, not test files). Sorted, deduped.
 */
export function selectChangedMutationTargets(input: SelectInput): string[] {
  const { baseRef, projectRoot, deps } = input
  const raw = deps.runGit(['diff', '--name-only', `${baseRef}...HEAD`])
  const files = raw
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
  const gateable = files.filter((f) => deps.isGateableImpl(f, projectRoot))
  return Array.from(new Set(gateable)).sort()
}

function defaultDeps(): ChangedFilesDeps {
  return {
    runGit: (args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }),
    isGateableImpl: (rel, root) => isGateableImplFile(rel, root),
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const baseArg = args.find((a) => a.startsWith('--base='))
  const thresholdArg = args.find((a) => a.startsWith('--threshold='))
  const baseRef = baseArg ? baseArg.slice('--base='.length) : 'origin/master'
  const threshold = thresholdArg ? Number(thresholdArg.slice('--threshold='.length)) : 0

  const projectRoot = process.cwd()
  const targets = selectChangedMutationTargets({
    baseRef,
    projectRoot,
    deps: defaultDeps(),
  })

  if (targets.length === 0) {
    process.stdout.write(`No changed mutation targets vs ${baseRef}; nothing to measure.\n`)
    process.exit(0)
  }

  process.stdout.write(`Measuring ${targets.length} changed file(s):\n`)
  for (const t of targets) process.stdout.write(`  - ${t}\n`)

  const reportDir = path.join(projectRoot, 'reports', 'paired')
  const result = await pairedRun({ srcFiles: targets, projectRoot, reportDir })

  if (result.merged.scored > 0 && result.merged.score < threshold) {
    process.stderr.write(
      `score ${(result.merged.score * 100).toFixed(2)}% below threshold ${(threshold * 100).toFixed(2)}%\n`,
    )
    process.exit(1)
  }
  process.exit(0)
}

const invokedDirectly = (() => {
  try {
    return typeof Bun !== 'undefined' && (globalThis as { Bun?: { main: string } }).Bun?.main === import.meta.path
  } catch {
    return false
  }
})()

if (invokedDirectly) {
  void main()
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/scripts/mutation/changed-files.test.ts`
Expected: PASS — 4/4.

- [ ] **Step 5: Add `test:mutate:changed-paired` to `package.json`**

In `package.json` scripts block, immediately after the `"test:mutate:file"` entry from Task 4:

```json
    "test:mutate:file": "bun scripts/mutation/paired-run.ts",
    "test:mutate:changed-paired": "bun scripts/mutation/changed-files.ts",
```

- [ ] **Step 6: Local smoke-run**

Make a trivial edit to any in-scope `src/` file that has a companion test (e.g. add a no-op line and back out), commit nothing — just run:

```bash
git fetch origin master
bun test:mutate:changed-paired
```

Expected: the script lists the changed file(s), invokes the paired runner per file, and prints a summary line. Revert the trivial edit afterward.

- [ ] **Step 7: Commit**

```bash
git add scripts/mutation/changed-files.ts tests/scripts/mutation/changed-files.test.ts package.json
git commit -m "feat(mutation): add changed-files paired runner + test:mutate:changed-paired CLI"
```

---

## Task 6: CI wiring (re-enable mutation job, warn-only)

**Files:**

- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Re-enable the mutation block in `.github/workflows/ci.yml`**

The current file has a commented mutation job at the bottom (search for `# Mutation testing disabled in CI for now`). Replace that whole comment block with this active job:

```yaml
mutation-testing:
  name: Mutation Testing (paired, changed files)
  runs-on: ubuntu-latest
  # Warn-only during calibration. Flip continue-on-error to false once we
  # have a stable score floor (see spec §5).
  continue-on-error: true
  steps:
    - uses: actions/checkout@v4
      with:
        fetch-depth: 0 # paired runner needs origin/master to diff against
    - uses: oven-sh/setup-bun@v2
      with:
        bun-version: 1.3.13
    - name: Install dependencies
      run: bun install --frozen-lockfile
    - name: Run paired mutation testing on changed files
      run: bun test:mutate:changed-paired --base=origin/${{ github.base_ref || 'master' }}
    - name: Upload per-file mutation reports
      if: always()
      uses: actions/upload-artifact@v4
      with:
        name: mutation-paired-reports
        path: reports/paired/
        retention-days: 14
```

- [ ] **Step 2: Sanity-check the workflow with `actionlint` if available, otherwise just `yamllint` it**

Run (whichever you have):

```bash
actionlint .github/workflows/ci.yml || yamllint .github/workflows/ci.yml || echo "no linter available — visual check only"
```

Expected: no errors. (If neither linter is installed, eyeball the YAML for indentation; the file already has four similar jobs to mirror.)

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: re-enable mutation testing as warn-only paired changed-files job"
```

---

## Task 7: Documentation

**Files:**

- Create: `scripts/mutation/README.md`
- Modify: `CLAUDE.md` (Commands section)
- Modify: `tests/CLAUDE.md` (short pointer)

- [ ] **Step 1: Write `scripts/mutation/README.md`**

Create the file with this exact content:

````markdown
<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Paired mutation runner

Fast, accurate mutation testing per file. Built around the observation that
`@hughescr/stryker-bun-runner`'s eager-import preload puts ~77% of mutants into
the `static` bucket, which `ignoreStatic: true` then discards (see
`docs/research/2026-05-24-mutation-measurement-and-test-quality-findings.md`).

This tool pairs each source file with **only its companion test file** (via
`bun.testFiles`) and runs Stryker with `ignoreStatic: false`. Because the test
set is tiny, the accurate mode is cheap.

## Commands

```bash
# Measure specific files on demand:
bun test:mutate:file src/providers/kaneo/label-resource.ts src/tools/update-status.ts

# Measure everything changed vs origin/master (also used by CI):
bun test:mutate:changed-paired

# Optional threshold (exit 1 below it):
bun test:mutate:file src/foo.ts --threshold=0.6
bun test:mutate:changed-paired --base=origin/master --threshold=0.6
```

Per-file Stryker JSON reports land in `reports/paired/`.

## Companion-test resolution

The companion is resolved by `.hooks/tdd/test-resolver.mjs`:

- `src/foo/bar.ts` → `tests/foo/bar.test.ts`
- `client/debug/x.ts` → `tests/client/debug/x.test.ts`

## When a file's coverage lives elsewhere (cross-cutting)

If a source file is mostly exercised by integration or other suites rather than
its companion, register the extra tests in `scripts/mutation/overrides.json`.
The override list is **added to** the companion (or used alone if no companion
exists), e.g.:

```json
{
  "src/providers/factory.ts": ["tests/llm-orchestrator.test.ts", "tests/commands/context.test.ts"]
}
```

A file with no companion **and** no override is skipped with a warning — fix it
by either adding a companion test or registering the cross-cutting tests above.

## Relationship to the existing scripts

- `bun test:mutate` / `:changed` / `:full` — the legacy whole-repo runs against
  the broken `ignoreStatic: true` config. Kept for now as informational data,
  not as a quality gate.
- `bun test:mutate:file` / `:changed-paired` — the accurate runs from this
  tool. The CI gate uses `:changed-paired`.
````

- [ ] **Step 2: Add the two commands to `CLAUDE.md`**

In `CLAUDE.md`, find the `## Commands` section and the existing mutation entries (look for `bun test:mutate:full`). Insert two new bullets immediately after `bun test:mutate:full`:

```markdown
- `bun test:mutate:full` — force a full mutation run
- `bun test:mutate:file <paths...>` — accurate per-file paired mutation run (ignoreStatic:false + companion tests only); fast measurement that bypasses the static-bucket artifact
- `bun test:mutate:changed-paired` — paired mutation run over files changed vs `origin/master`; this is what CI uses
- `bun test:e2e` — run Docker-backed E2E tests
```

(Replace the existing pair of bullets — `test:mutate:full` and `test:e2e` — with the four-bullet block above so the two new bullets sit between them.)

- [ ] **Step 3: Add a short pointer in `tests/CLAUDE.md`**

Append a small section at the bottom of `tests/CLAUDE.md`:

```markdown
## Mutation testing

For accurate per-file mutation scores that bypass the runner's static-bucket
artifact, use `bun test:mutate:file <path>` (see `scripts/mutation/README.md`).
The legacy `bun test:mutate` is whole-repo and intentionally lenient on
measurement; the paired runner is what real quality work should use.
```

- [ ] **Step 4: Verify docs render cleanly**

Run:

```bash
bun format:check
```

Expected: no formatting issues on the new/edited files (the pre-existing untracked-doc issue noted during brainstorming is unrelated).

- [ ] **Step 5: Commit**

```bash
git add scripts/mutation/README.md CLAUDE.md tests/CLAUDE.md
git commit -m "docs(mutation): document paired runner + CLI entries"
```

---

## Task 8: Verification pass + log calibration notes

**Files:** none (verification only)

- [ ] **Step 1: Full repo-local check**

Run:

```bash
bun typecheck
bun lint
bun test tests/scripts/mutation/
```

Expected: typecheck clean for the new files; lint clean; all unit tests (Tasks 1–5) pass.

- [ ] **Step 2: End-to-end paired smoke**

Run:

```bash
bun test:mutate:file src/providers/kaneo/label-resource.ts
```

Expected: completes in single-digit minutes; summary line shows non-zero `killed` AND non-zero `survived` (the file was 16 survived / 1 killed under the broken config — paired mode should now make those survivors clearly actionable for the follow-up quality plan).

- [ ] **Step 3: Record the calibration baseline**

Capture the merged score line for two or three representative files in the PR description (e.g. one from each of providers/kaneo, providers/youtrack, tools/). These are the numbers we'll use in a follow-up PR to set a non-zero `--threshold` and flip `continue-on-error: false` in the CI job (spec §5 ratchet).

- [ ] **Step 4: Done**

The deliverables (1)–(3) from the spec are complete; (4) — strengthening `update-status.ts`, `label-resource.ts`, `update-label.ts`, `update-project.ts` — is the explicit follow-up plan and is **not** in scope here.
