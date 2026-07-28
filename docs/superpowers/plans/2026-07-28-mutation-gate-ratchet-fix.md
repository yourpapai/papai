<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Mutation gate ratchet fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the mutation PR gate into a pure regression ratchet (no 0.5 floor; first-touch warns and seeds), with auto-discovered covering tests and a master CI job that seeds changed-files into `baseline.json` after merge — so broad PRs stop cliffing at 0.5 on never-baselined core files.

**Architecture:** Phase A (unblock) drops the floor in `resolveRatchet` and the gate CLI + fixes the misleading JSDoc/comment. Phase B adds accurate test selection (coverage-derived test sets via a per-test-file coverage map) and a `seedMerge`-based master job that measures changed-files broadly and persists first-touch scores.

**Tech Stack:** Bun, TypeScript (strict, `.js` import paths), `bun:test`, Stryker + `@hughescr/stryker-bun-runner`. Scripts under `scripts/mutation/`; tests under `tests/scripts/mutation/` (DI-first).

## Global Constraints

- Runtime **Bun**; strict TypeScript; **use `.js` extension in import paths**.
- **Never add `lint-disable` / `type-ignore` comments** — hook policy blocks them.
- `max-lines` / `max-lines-per-function` failures are a design signal — split, don't compress.
- DI-first tests; preload `tests/mock-reset.ts`; no per-file `afterAll(() => mock.restore())`.
- Commits run the write-hook (lint + typecheck + format:check + license-headers); run tests manually.
- Test runner: `bun test <path>` (filter `-t "<name>"`); full suite `bun run test`.
- Gate/seeder scripts are pure/DI-first — never spawn real Stryker/bun from unit tests; inject the runner.

---

## File Structure

Modified:
- `scripts/mutation/baseline.ts` — `resolveRatchet` loses the floor (Phase A); add `seedMerge` (Phase B).
- `scripts/mutation/changed-files.ts` — drop floor plumbing; add first-touch WARN (Phase A); add `--update-baseline` changed-files seed path (Phase B).
- `.github/workflows/ci.yml` — fix the misleading comment (Phase A); switch master job to the changed-files seed (Phase B).
- `scripts/mutation/paired-run.ts` / `scripts/mutation/test-overrides.ts` — consume the coverage map (Phase B).
- `scripts/mutation/README.md` — document the new policy.

New:
- `scripts/mutation/coverage-map.ts` — `{sourceFile → testFiles}` via per-test-file coverage, candidate-narrowed + cached (Phase B).

Tests:
- `tests/scripts/mutation/baseline.test.ts`, `changed-files.test.ts`, `paired-run.test.ts`, `test-overrides.test.ts` (updated); new `coverage-map.test.ts`.

---

## Task 1: `resolveRatchet` — drop the floor (regression-only) + fix JSDoc

**Files:**
- Modify: `scripts/mutation/baseline.ts:10-16` (JSDoc), `:80-95` (`resolveRatchet`)
- Test: `tests/scripts/mutation/baseline.test.ts:70-119`

**Interfaces:**
- Produces: `resolveRatchet(perFile, baseline): RatchetResult` — signature loses the `floor` param. A file with no baseline entry is skipped (not a regression). `RatchetRegression.threshold` = the recorded baseline.

- [ ] **Step 1: Update the failing test first**

In `tests/scripts/mutation/baseline.test.ts`, replace the floor-based `resolveRatchet` block (lines ~70-119) with regression-only cases. Remove the `floor` argument from every call:

```typescript
describe('resolveRatchet', () => {
  it('passes when every baselined file meets its baseline', () => {
    const baseline = { 'src/a.ts': 0.5 }
    const perFile = [score('src/a.ts', 0.6)]
    expect(resolveRatchet(perFile, baseline)).toEqual({ exitCode: 0, regressions: [] })
  })

  it('flags a baselined file that dropped below its baseline', () => {
    const baseline = { 'src/a.ts': 0.5 }
    const perFile = [score('src/a.ts', 0.4)]
    expect(resolveRatchet(perFile, baseline).regressions).toEqual([
      { sourceFile: 'src/a.ts', score: 0.4, threshold: 0.5 },
    ])
  })

  it('does NOT flag a baselined file held to a sub-0.5 baseline (no floor)', () => {
    const baseline = { 'src/legacy.ts': 0.2 }
    const perFile = [score('src/legacy.ts', 0.25)]
    expect(resolveRatchet(perFile, baseline).exitCode).toBe(0)
  })

  it('does NOT flag an unbaselined (first-touch) file regardless of score', () => {
    const perFile = [score('src/new.ts', 0.0), score('src/other-new.ts', 0.49)]
    expect(resolveRatchet(perFile, {})).toEqual({ exitCode: 0, regressions: [] })
  })

  it('skips files with no scoreable mutants', () => {
    const baseline = { 'src/a.ts': 0.5 }
    const perFile = [{ sourceFile: 'src/a.ts', merged: { score: 0, scored: 0, killed: 0, survived: 0, noCoverage: 0, timeout: 0, pending: 0 } }]
    expect(resolveRatchet(perFile, baseline)).toEqual({ exitCode: 0, regressions: [] })
  })
})
```

(Reuse the file's existing `score()` helper at lines ~16-41 for `PerFileScore` construction. Drop the two old tests "flags new file below floor" and "existing below-floor file held to own baseline" — they assert floor behavior that no longer exists.)

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/scripts/mutation/baseline.test.ts -t "resolveRatchet"`
Expected: FAIL — `resolveRatchet` still requires/signatures the `floor` arg.

- [ ] **Step 3: Implement**

In `scripts/mutation/baseline.ts`, fix the JSDoc (lines 10-16) — replace the `max(floor, baseline[file])` wording:

```typescript
/**
 * A committed map of source file -> mutation score, used as a monotonic
 * ratchet baseline. Scores only ever go up: a master run merges new per-file
 * scores via {@link ratchetMerge} / {@link seedMerge} (per-key max), and a PR
 * fails only when a changed file that already has a baseline entry drops below
 * it (see {@link resolveRatchet}). Files with no baseline entry (first-touch)
 * are not regressions — they warn and are seeded after merge.
 */
```

Replace `resolveRatchet` (lines 80-95) — drop the `floor` param and the `?? floor` fallback:

```typescript
/**
 * Compare per-file run results against the baseline. A file regresses only when
 * it has a recorded baseline entry AND its score falls below it. Files with no
 * entry (first-touch — new or never-baselined) are not regressions. Files with
 * no scoreable mutants are skipped (not measurable). Returns exit code 1 if any
 * baselined file regressed.
 */
export const resolveRatchet = (
  perFile: readonly PerFileScore[],
  baseline: BaselineMap,
): RatchetResult => {
  const regressions: RatchetRegression[] = []
  for (const entry of perFile) {
    if (entry.merged.scored === 0) continue
    const recorded = baseline[entry.sourceFile]
    if (recorded === undefined) continue
    if (entry.merged.score < recorded) {
      regressions.push({ sourceFile: entry.sourceFile, score: entry.merged.score, threshold: recorded })
    }
  }
  return { exitCode: regressions.length > 0 ? 1 : 0, regressions }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/scripts/mutation/baseline.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/mutation/baseline.ts tests/scripts/mutation/baseline.test.ts
git commit -m "refactor(mutation): resolveRatchet is regression-only (drop the floor)"
```

---

## Task 2: Gate CLI — drop floor plumbing, add first-touch WARN, fix ci.yml comment

**Files:**
- Modify: `scripts/mutation/changed-files.ts:25-34` (CLI type), `:55-60` (consts), `:110-149` (parse), `:172-213` (main/ratchet call)
- Modify: `.github/workflows/ci.yml:210-211` (comment)
- Test: `tests/scripts/mutation/changed-files.test.ts`

**Interfaces:**
- Consumes: `resolveRatchet(perFile, baseline)` (Task 1 — no floor arg).
- Produces: `changed-files.ts` no longer accepts `--ratchet-floor`; first-touch files emit a WARN line.

- [ ] **Step 1: Write the failing test**

Add to `tests/scripts/mutation/changed-files.test.ts` (mirror its DI style with `ChangedFilesRunDeps` capturing `log`). The new behavior lives in `changedFilesRun` (it has `deps.log` + the per-file results), so the WARN is observable there; the regression-exit stays in `main` (covered by Task 1's `resolveRatchet` unit tests). Thread `baseline` through `ChangedFilesRunInput` so the WARN can read it:

```typescript
it('warns on first-touch unbaselined files inside changedFilesRun', async () => {
  const logs: string[] = []
  await changedFilesRun({
    projectRoot: '<tmp>',
    reportDir: '<tmp>',
    baseRef: 'origin/master',
    baseline: { 'src/a.ts': 0.5 },          // src/new.ts is first-touch
    verbose: false,
    deps: {
      selectTargets: () => ['src/a.ts', 'src/new.ts'],
      runPaired: async () => ({
        merged: { score: 0.4, killed: 4, survived: 6, noCoverage: 0, timeout: 0, pending: 0, scored: 10 },
        perFile: [
          { sourceFile: 'src/a.ts', testFiles: [], configPath: '', reportPath: '', merged: { score: 0.4, killed: 4, survived: 6, noCoverage: 0, timeout: 0, pending: 0, scored: 10 } },
          { sourceFile: 'src/new.ts', testFiles: [], configPath: '', reportPath: '', merged: { score: 0.1, killed: 1, survived: 9, noCoverage: 0, timeout: 0, pending: 0, scored: 10 } },
        ],
        skipped: [], errored: [],
      }),
      log: (m) => { logs.push(m) },
    },
  })
  expect(logs.some((m) => m.includes('First measurement for src/new.ts'))).toBe(true)
  expect(logs.some((m) => m.includes('src/a.ts')) && logs.every((m) => !m.includes('First measurement for src/a.ts'))).toBe(true)
})
```

Update existing `changed-files.test.ts` `changedFilesRun` cases to pass `baseline: {}` (the new required field).

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/scripts/mutation/changed-files.test.ts -t "first-touch"`
Expected: FAIL — `baseline` not on `ChangedFilesRunInput` / no WARN emitted.

- [ ] **Step 3: Implement**

In `changed-files.ts`:
- Remove `DEFAULT_RATCHET_FLOOR`, the `--ratchet-floor` parsing (`floorArgs`/`floorText`/`ratchetFloor`), and `ratchetFloor`/`floor` from `ChangedFilesCliArgs`. Keep `--no-ratchet` as an opt-out if desired, but the floor value is gone.
- Add `readonly baseline: BaselineMap` to `ChangedFilesRunInput`; in `main`, load it (`const baseline = loadBaseline(...) ?? {}`) and pass it; also pass it to `resolveRatchet` (no floor arg — Task 1).
- In `changedFilesRun`, AFTER `deps.runPaired` returns the result, emit the first-touch WARN (do NOT compute the ratchet or return an exit code here — that stays in `main`):

```typescript
import type { BaselineMap } from './baseline.js'
// ...
  for (const entry of result.perFile) {
    if (entry.merged.scored === 0) continue
    if (input.baseline[entry.sourceFile] === undefined) {
      deps.log(`First measurement for ${entry.sourceFile}: score ${entry.merged.score.toFixed(4)} — seeded; future PRs enforce ≥ this.`)
    }
  }
```

- In `main`, the ratchet call becomes `resolveRatchet(result.perFile, baseline)` (drop the `parsed.ratchetFloor` arg), and the regression error message stays. The exit-code logic (return 1 on regression) is unchanged in `main`.

- [ ] **Step 4: Fix the CI comment**

In `.github/workflows/ci.yml:210-211`, replace:

```yaml
    # Blocking PR gate. The per-file ratchet in scripts/mutation/baseline.json
    # fails the run when any changed file drops below max(0.5, its baseline).
```

with:

```yaml
    # Blocking PR gate. A changed file fails only if it has a recorded baseline
    # entry in scripts/mutation/baseline.json and drops below it. Files new to
    # scope (first-touch) warn and are seeded by the master mutation-baseline job.
```

- [ ] **Step 5: Run tests + typecheck**

Run: `bun test tests/scripts/mutation/changed-files.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/mutation/changed-files.ts tests/scripts/mutation/changed-files.test.ts .github/workflows/ci.yml
git commit -m "feat(mutation): gate warns on first-touch, drops the 0.5 floor"
```

---

## Task 3: `seedMerge` — preserve-existing merge for changed-files seeding

**Files:**
- Modify: `scripts/mutation/baseline.ts` (add `seedMerge`)
- Test: `tests/scripts/mutation/baseline.test.ts`

**Interfaces:**
- Produces: `seedMerge(existing, latest): BaselineMap` — keeps ALL `existing` keys, updates/ adds each `latest` key at `Math.max(existing[key] ?? 0, latest[key])`. (Unlike `ratchetMerge`, which drops keys absent from `latest` — correct for full runs, wrong for changed-files seeding.)

- [ ] **Step 1: Write the failing test**

Add to `tests/scripts/mutation/baseline.test.ts`:

```typescript
describe('seedMerge', () => {
  it('keeps existing keys absent from latest and takes per-key max', () => {
    const existing = { 'src/a.ts': 0.5, 'src/untouched.ts': 0.7 }
    const latest = { 'src/a.ts': 0.6, 'src/new.ts': 0.3 }
    expect(seedMerge(existing, latest)).toEqual({
      'src/a.ts': 0.6,
      'src/untouched.ts': 0.7,
      'src/new.ts': 0.3,
    })
  })

  it('never lowers an existing score', () => {
    expect(seedMerge({ 'src/a.ts': 0.8 }, { 'src/a.ts': 0.2 })).toEqual({ 'src/a.ts': 0.8 })
  })

  it('returns latest unchanged when existing is empty', () => {
    expect(seedMerge({}, { 'src/a.ts': 0.4 })).toEqual({ 'src/a.ts': 0.4 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/scripts/mutation/baseline.test.ts -t "seedMerge"`
Expected: FAIL — not exported.

- [ ] **Step 3: Implement**

In `scripts/mutation/baseline.ts`, add (near `ratchetMerge`):

```typescript
/**
 * Merge a changed-files run into the baseline, PRESERVING existing keys (unlike
 * {@link ratchetMerge}, which drops keys absent from `latest` — correct for a
 * full run, wrong for a changed-files seed where most baseline files aren't
 * re-measured). Each key takes the max of existing and latest; new keys are added.
 */
export const seedMerge = (existing: BaselineMap, latest: BaselineMap): BaselineMap => {
  const out: BaselineMap = { ...existing }
  for (const [key, next] of Object.entries(latest)) {
    const prev = out[key]
    out[key] = prev === undefined ? next : Math.max(prev, next)
  }
  return out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/scripts/mutation/baseline.test.ts -t "seedMerge"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/mutation/baseline.ts tests/scripts/mutation/baseline.test.ts
git commit -m "feat(mutation): seedMerge preserves existing baseline entries"
```

---

## Task 4: Coverage map — `{sourceFile → testFiles}` via per-test-file coverage

**Files:**
- Create: `scripts/mutation/coverage-map.ts`
- Test: `tests/scripts/mutation/coverage-map.test.ts`

**Interfaces:**
- Consumes: a `runCoverage(testFile, projectRoot): ReadonlyMap<string, number>` injection that runs one test file with coverage and returns `sourceFile → lines-hit` (lines-hit > 0 ⇒ covered). The production default spawns `bun test <testFile> --coverage --coverage-reporter=lcov` and parses the lcov (mirror `.hooks/tdd/coverage.mjs:getCoverage`).
- Produces: `buildCoverageMap({ sourceFiles, projectRoot, deps }): CoverageMap` where `CoverageMap = Record<sourceFile, testFile[]>`. Candidate test universe is narrowed per-source by a static import scan (`testFileImportsImpl` from `.hooks/tdd/test-resolver.mjs`) so only plausibly-covering tests are run; results are cached by a content key (src+tests tree hash) like `.hooks/tdd/coverage-session.mjs`.

- [ ] **Step 1: Write the failing test**

`tests/scripts/mutation/coverage-map.test.ts` (DI — inject `listCandidateTests` + `runCoverage`; no real bun spawn):

```typescript
import { describe, it, expect } from 'bun:test'
import { buildCoverageMap } from '../../src/mutation/coverage-map.js'

describe('buildCoverageMap', () => {
  it('inverts per-test coverage into sourceFile -> testFiles, filtered to requested sources', () => {
    const coverageByTest = new Map<string, ReadonlyMap<string, number>>([
      ['tests/a/index.test.ts', new Map([['src/a.ts', 5], ['src/a-helpers.ts', 2]])],
      ['tests/other.test.ts', new Map([['src/unrelated.ts', 9]])],
    ])
    const map = buildCoverageMap({
      sourceFiles: ['src/a.ts', 'src/a-helpers.ts'],
      projectRoot: '/proj',
      deps: {
        listCandidateTests: (_src) => ['tests/a/index.test.ts', 'tests/other.test.ts'],
        runCoverage: (testFile) => coverageByTest.get(testFile) ?? new Map(),
      },
    })
    expect(map).toEqual({
      'src/a.ts': ['tests/a/index.test.ts'],
      'src/a-helpers.ts': ['tests/a/index.test.ts'],
    })
  })

  it('omits sources with no covering test', () => {
    const map = buildCoverageMap({
      sourceFiles: ['src/lonely.ts'],
      projectRoot: '/proj',
      deps: {
        listCandidateTests: () => ['tests/x.test.ts'],
        runCoverage: () => new Map([['src/other.ts', 1]]),
      },
    })
    expect(map).toEqual({})
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/scripts/mutation/coverage-map.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`scripts/mutation/coverage-map.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.

export type CoverageMap = Record<string, string[]>

export interface CoverageMapDeps {
  /** Tests that could plausibly cover `srcFile` (static import scan narrows the universe). */
  readonly listCandidateTests: (srcFile: string) => readonly string[]
  /** Run one test file with coverage; return sourceFile -> lines-hit (>0 means covered). */
  readonly runCoverage: (testFile: string, projectRoot: string) => ReadonlyMap<string, number>
}

export interface BuildCoverageMapInput {
  readonly sourceFiles: readonly string[]
  readonly projectRoot: string
  readonly deps: CoverageMapDeps
}

/** Build {sourceFile -> testFiles that cover it} for the requested sources. */
export function buildCoverageMap(input: BuildCoverageMapInput): CoverageMap {
  const out: CoverageMap = {}
  for (const srcFile of input.sourceFiles) {
    const candidates = input.deps.listCandidateTests(srcFile)
    const covering: string[] = []
    for (const testFile of candidates) {
      const hits = input.deps.runCoverage(testFile, input.projectRoot)
      if ((hits.get(srcFile) ?? 0) > 0) covering.push(testFile)
    }
    if (covering.length > 0) out[srcFile] = covering
    else console.error(`coverage-map: no covering test found for ${srcFile} (checked ${candidates.length} candidates)`)
  }
  return out
}
```

**Production default deps (wired in Task 5):** `listCandidateTests` = scan `tests/**/*.test.ts`, keep those whose source text statically references the source's path/exports (reuse `testFileImportsImpl` from `.hooks/tdd/test-resolver.mjs`, or a same-package heuristic). `runCoverage` = spawn `bun test <testFile> --coverage --coverage-reporter=lcov`, parse `reports/coverage/lcov.info` for `SF:`/`LH:` per source (mirror `.hooks/tdd/coverage.mjs:getCoverage`). Add a content-keyed cache file (e.g. `reports/paired/coverage-map.cache.json`) keyed by the hash of the candidate test + source file contents, invalidated on change — modeled on `.hooks/tdd/coverage-session.mjs`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/scripts/mutation/coverage-map.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/mutation/coverage-map.ts tests/scripts/mutation/coverage-map.test.ts
git commit -m "feat(mutation): coverage map builder (sourceFile -> covering tests)"
```

---

## Task 5: Wire coverage map into test selection

**Files:**
- Modify: `scripts/mutation/paired-run.ts:137-178` (`runOneFile`), `:81-100` (deps), `:190-224` (orchestration)
- Modify: `scripts/mutation/test-overrides.ts` (or a new resolver) so test set = coverage-map[src] ∪ overrides[src] ∪ (companion if no coverage entry)
- Test: `tests/scripts/mutation/paired-run.test.ts`, `tests/scripts/mutation/test-overrides.test.ts`

**Interfaces:**
- Consumes: `buildCoverageMap` (Task 4).
- Produces: each source file's paired test set is coverage-derived, with `overrides.json` unioned on top and the companion as a fallback when no covering test is found. `PairedRunDeps` gains `buildMap: (sourceFiles) => CoverageMap`.

- [ ] **Step 1: Write the failing test**

Extend a `paired-run.test.ts` case to assert a source file is mutated against a NON-companion test because the coverage map says so. Inject `buildMap` returning `{ 'src/a-helpers.ts': ['tests/a/index.test.ts'] }`; assert the generated Stryker config's `bun.testFiles` contains `tests/a/index.test.ts` (read it via the existing `readConfiguredReportPath`/config-reading helper pattern).

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/scripts/mutation/paired-run.test.ts -t "coverage map"`
Expected: FAIL — selection is still companion-only.

- [ ] **Step 3: Implement**

- Add `buildMap: (sourceFiles: readonly string[]) => CoverageMap` to `PairedRunDeps`; default builds via `buildCoverageMap` with the production deps from Task 4.
- In `pairedRun`, compute the map once over `sourceFiles` before the loop; pass it into `runOneFile`.
- In `runOneFile`/`resolveTestFiles`, resolve the test set as: `coverageMap[srcFile]` if present; else `overrides[srcFile]` + companion; else companion; else skip (unchanged skip behavior). Keep overrides ADDITIVE (union onto the coverage-derived set) so the escape hatch still works. Update `resolveTestFiles` signature to accept an optional `discovered: readonly string[]` (the coverage set).

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/scripts/mutation/`
Expected: PASS (update existing `test-overrides.test.ts`/`paired-run.test.ts` cases to pass `discovered: []` / `buildMap` where the new signature requires).

- [ ] **Step 5: Commit**

```bash
git add scripts/mutation/paired-run.ts scripts/mutation/test-overrides.ts tests/scripts/mutation/
git commit -m "feat(mutation): use coverage-derived test sets (companion as fallback)"
```

---

## Task 6: Master seed command — changed-files + seedMerge

**Files:**
- Modify: `scripts/mutation/changed-files.ts` (add `--update-baseline` path) OR `all-files.ts` (add a `--changed --base=` mode). Prefer adding `--update-baseline` to `changed-files.ts` so the seed command = `bun test:mutate:changed --base=<ref> --update-baseline`.
- Test: `tests/scripts/mutation/changed-files.test.ts`

**Interfaces:**
- Consumes: `seedMerge` (Task 3), `buildBaselineFromPerFile`.
- Produces: `--update-baseline` measures changed-files broadly, then `seedMerge`s results into `baseline.json` and writes it (preserve-existing).

- [ ] **Step 1: Write the failing test**

Assert that with `updateBaseline: true`, `main` (or a factored `seedBaseline` function) calls `seedMerge(existing, latest)` and `writeBaseline`, preserving an untouched baseline entry. Inject `runPaired` + a tmp `baseline.json`; verify the written file keeps `src/untouched.ts` and adds/updates changed entries.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/scripts/mutation/changed-files.test.ts -t "update-baseline"`
Expected: FAIL — `--update-baseline` not supported on changed-files.

- [ ] **Step 3: Implement**

Add `updateBaseline: boolean` to `ChangedFilesCliArgs` (parse `--update-baseline`). In `main`, after the paired run + ratchet, if `updateBaseline`:

```typescript
  if (parsed.updateBaseline) {
    const baselinePath = path.join(projectRoot, BASELINE_FILE)
    const existing = loadBaseline(baselinePath) ?? {}
    const latest = buildBaselineFromPerFile(result.perFile)
    const merged = seedMerge(existing, latest)
    writeBaseline(baselinePath, merged)
    console.log(`Seeded baseline written to ${BASELINE_FILE} (${Object.keys(merged).length} files)`)
  }
```

Use `seedMerge` (NOT `ratchetMerge`) so unchanged baseline entries survive. Keep the gate (ratchet) check for the PR path; the master job ignores the exit code (or run with `--no-ratchet` semantics — but the master run is on already-merged code, so the ratchet passing/failing is moot; just don't `return 1` before seeding when `updateBaseline` is set).

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/scripts/mutation/changed-files.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/mutation/changed-files.ts tests/scripts/mutation/changed-files.test.ts
git commit -m "feat(mutation): changed-files --update-baseline seeds via seedMerge"
```

---

## Task 7: CI — master job seeds changed-files broadly

**Files:**
- Modify: `.github/workflows/ci.yml:235-270` (`mutation-baseline` job)
- No unit test (workflow edit); characterize by re-reading the step.

- [ ] **Step 1: Edit the workflow**

In `.github/workflows/ci.yml`, change the master `mutation-baseline` job's run step (lines ~250-251) from:

```yaml
      - name: Run full mutation suite and ratchet baseline
        run: bun test:mutate --update-baseline
```

to measure changed-files since the previous master commit and seed:

```yaml
      - name: Seed baseline from changed files since previous master
        run: bun test:mutate:changed --base=origin/master --update-baseline
```

Rationale: the previous master commit is `origin/master` at the time the job runs on the new master push; `changed-files` diffs `origin/master...HEAD`. Because this runs AFTER the push, `HEAD` is the new master and `origin/master` is the prior — fetch-depth 0 (already set) gives the history. (If the ref math is off in practice, use `HEAD~1` as the base, but `origin/master` is correct post-push.) Keep the existing commit step (lines 252-262) unchanged — it already commits `baseline.json` via `github-actions[bot]` with `contents: write`. Update the job comment (lines 238-239) to: "On master merge: seed scripts/mutation/baseline.json with mutation scores for changed files (broad scope); existing entries are preserved."

- [ ] **Step 2: Validate YAML + command**

Run: `bun test:mutate:changed --base=origin/master --update-baseline --no-ratchet` locally is heavy (full changed-set mutation) — SKIP a full local run; instead dry-check the CLI parses the flags:

Run: `bun scripts/mutation/changed-files.ts --help 2>&1 || bun scripts/mutation/changed-files.ts --base=origin/master --update-baseline --verbose` (expect it to start, list targets, and not error on arg parsing; Ctrl-C is fine). Confirm `actionlint`/YAML lint if the repo has it (`bun run lint` may cover workflow YAML).

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci(mutation): seed baseline from changed files on master (broad scope)"
```

---

## Task 8: README + one-time catch-up note

**Files:**
- Modify: `scripts/mutation/README.md:83-99` (Ratchet gate section)
- Modify: `scripts/mutation/overrides.json` header comment (if any) — note it's now an additive escape hatch, not required.

- [ ] **Step 1: Update the README "Ratchet gate" section**

Rewrite to describe regression-only behavior, first-touch warn-and-seed, auto-discovered tests, and the master changed-files seed job. State explicitly: the 0.5 floor is gone; new/unbaselined files warn on first touch and are seeded after merge; `overrides.json` is an additive escape hatch for dynamic-import coverage gaps.

- [ ] **Step 2: Note the one-time catch-up**

Add a short "Migration" subsection: the first master run after Phase B ships seeds every recently-changed unbaselined file — a large one-time `baseline.json` diff, expected and correct. Existing companion-only baselines (undercounts) ratchet upward as files are re-measured with coverage-derived test sets.

- [ ] **Step 3: Commit**

```bash
git add scripts/mutation/README.md
git commit -m "docs(mutation): regression-only gate, auto-discovered tests, master seeding"
```

---

## Definition of done

- Phase A shipped (Tasks 1-2): the 0.5 floor is gone; first-touch files warn and don't block; JSDoc + ci.yml comment corrected. PR #200's unbaselined files become warn-only.
- Phase B shipped (Tasks 3-8): test selection is coverage-derived (companion is fallback; `overrides.json` additive); the master job seeds changed-files broadly via `seedMerge` (preserving existing entries); README updated.
- `bun run test` + `bun run typecheck` + `bun run knip` green; mutation-script unit suites (`tests/scripts/mutation/`) green.
- Spec (`docs/superpowers/specs/2026-07-28-mutation-gate-ratchet-fix-design.md`) reconciled with the `seedMerge` correction (Task 3 rationale).
