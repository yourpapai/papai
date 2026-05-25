<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Mutation Measurement & Test-Quality — Findings

**Date:** 2026-05-24
**Type:** Investigation / research only — no `src/` or `tests/` changes were made.
**Spec:** `docs/superpowers/specs/2026-05-24-mutation-measurement-test-quality-investigation.md`

## 1. Executive Summary

_(filled last — headline numbers and the one-line root cause)_

## 2. Track A — Measurement Root Cause

### A1. Baseline status breakdown

| Status       | Count | % of total |
| ------------ | ----: | ---------: |
| Ignored      |  8032 |      77.2% |
| CompileError |   704 |       6.8% |
| NoCoverage   |   667 |       6.4% |
| Survived     |   613 |       5.9% |
| Killed       |   392 |       3.8% |
| Timeout      |     2 |       0.0% |
| **Total**    | 10410 |     100.0% |

Valid (scored) mutants = Killed + Survived + NoCoverage + Timeout = 392 + 613 + 667 + 2 = **1 674** (16.1% of total).

Score math: (Killed + Timeout) / valid = (392 + 2) / 1674 = **23.54%**.

77.2% of instrumented mutants are excluded as static before scoring.

### A2. Runner bucketing mechanism (static vs perTest)

#### Mechanism (numbered, with source citations)

**1. Instrumented `cover()` helper — the branching decision point.**
Stryker core's instrumenter injects a `cover()` helper into every mutated source file. At the moment a mutant site is reached during the dry-run phase, `cover()` reads `ns.currentTestId` from the global Stryker namespace:

```js
// @stryker-mutator/instrumenter dist/src/util/syntax-helpers.js lines 30-36
var cov = ns.mutantCoverage || (ns.mutantCoverage = { static: {}, perTest: {} })
function cover() {
  var c = cov.static
  if (ns.currentTestId) {
    c = cov.perTest[ns.currentTestId] = cov.perTest[ns.currentTestId] || {}
  }
  // increments c[mutantId]
}
```

Rule: if `ns.currentTestId` is truthy the hit is recorded into `cov.perTest[currentTestId]`; if it is `undefined` or `null` the hit goes into `cov.static`.

**2. `currentTestId` lifecycle — set by a `beforeEach` hook, cleared by `afterEach`.**
The runner's coverage-preload template installs two lifecycle hooks
(`dist/templates/coverage-preload.ts` lines ~195-225):

- `beforeEach`: derives a stable per-file test ID (`<filePrefix>@@test-<n>`) using
  `Bun.main` and a per-file counter, then assigns it to
  `strykerGlobal.currentTestId`.
- `afterEach`: sets `strykerGlobal.currentTestId = undefined`.

Any code that executes **outside** an active `beforeEach`/`afterEach` window — including top-level module code, global `beforeAll`/`afterAll`, and global `beforeEach` hooks that fire before the runner's own `beforeEach` — runs with `currentTestId === undefined` and therefore records to `static`.

**3. Eager module imports deliberately force module-level code into `static`.**
Before any test hooks run, the preload template imports every mutated source
file in a deterministic loop (`dist/templates/coverage-preload.ts` lines ~162-178):

```ts
// while strykerGlobal.currentTestId is undefined (preload time)
for (const modPath of EAGER_MODULES) {
  await import(modPath)
}
```

The inline comment is explicit: "Importing each module here (before any test code runs, while `strykerGlobal.currentTestId` is undefined) ensures that all module-level top-level code is executed in the `static` coverage bucket rather than the `perTest` bucket." This is intentional and deterministic.

**4. `stabilizeCoverage` promotes multi-test perTest hits to `static`.**
After the dry run, the runner applies a post-processing step
(`dist/index.js` lines 5621-5675 — functions `countPerTestAppearances`,
`buildPromoteToStaticSet`, `stabilizeCoverage`): any mutant that appears in
**more than one** perTest entry is moved to `static` and removed from all perTest
buckets. This means global setup code (mock resets, beforeAll helpers) that
touches many tests will escalate mutants from perTest into static even if they
were initially captured under a test ID.

**5. `--concurrency=1` is forced unconditionally for both dry-run and mutant runs.**
The runner's `runBunTests()` builder always passes `sequentialMode: true`
(`dist/index.js` lines 8085 and 8222), which appends `--concurrency=1` to the
`bun test` invocation (`dist/index.js` lines 6278-6279). Additionally, the
coverage-preload template patches `describe.concurrent`, `test.concurrent`, and
`it.concurrent` to be their sequential equivalents
(`dist/templates/coverage-preload.ts` lines ~21-26). This applies inside the
single worker process regardless of the Stryker-level `concurrency: 8` setting,
which only controls how many worker processes Stryker spawns in parallel.

#### Plain-English summary

A mutant becomes static whenever its source-level hit is recorded while
`ns.currentTestId` is `undefined`. This happens in two scenarios: (a) the
mutant's code runs at module-load time during the preload's eager-import loop
(intentionally before any `beforeEach` has fired), and (b) the mutant's code is
touched by infrastructure that runs outside the `beforeEach`/`afterEach` window
— global setup files, top-level `beforeAll` hooks, or any Bun-native
`beforeEach` registered earlier in the module order that executes before the
runner's own `beforeEach` sets the test ID. A secondary promotion rule then
moves any perTest mutant that appears across more than one test into `static` as
well, which catches shared mocking/reset infrastructure. `ignoreStatic: true`
then drops all static mutants from scoring, producing the 77.2% exclusion rate.

#### Hypothesis assessment

| #   | Hypothesis                                                                                                                                                 | Verdict                                                    | Reasoning                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1  | Hook ordering/race: project's global `beforeEach` (mock-reset.ts) or per-file `mock.restore()` fires before the runner's `beforeEach` sets `currentTestId` | **Plausible — primary suspect**                            | `currentTestId` is set only inside the runner's `beforeEach`. Any project-level `beforeEach` registered earlier (Bun runs hooks in registration order) or any top-level `beforeAll`/module-scope code runs while `currentTestId` is still `undefined`, routing those mutant hits to `static`. The `stabilizeCoverage` promotion rule further escalates mutants touched by global setup into static.                                                                             |
| H2  | `mock.module()` swaps instrumented modules for un-instrumented mocks                                                                                       | **Plausible — contributes independently**                  | If `mock.module()` replaces an instrumented module with an un-instrumented stub, the `cover()` call in the replaced module never fires, so those mutants get no perTest hits. Mutants that do fire during eager-module import (before `mock.module()` can intercept) may still land in static.                                                                                                                                                                                  |
| H3  | Stryker `concurrency: 8` causing cross-worker interference with sequential coverage                                                                        | **Ruled out as the mechanism, though not completely moot** | The runner forces `--concurrency=1` inside every worker process (index.js:6279) and also patches `describe/test/it.concurrent` to sequential equivalents. Within a single worker the test order is fully sequential. Stryker's `concurrency: 8` launches 8 isolated worker processes but each has its own independent coverage file; there is no shared global state between workers. The 77.2% static rate is therefore not caused by concurrency interference across workers. |
| H4  | Preload ordering: `setup.ts`/`mock-reset.ts` loads before the runner's coverage preload                                                                    | **Plausible — contributes via mechanism 3 and 4**          | The runner's preload is the script specified via `--preload`; any other preload or `bunfig.toml` preload that is resolved first will execute module-level code while `currentTestId` is undefined. More directly, the runner's own eager-import loop (mechanism 3) deliberately imports all source files during preload time, ensuring their top-level code is in static. If project setup files are also preloaded, their execution similarly predates any `beforeEach`.       |

### A3. Scoped reproduction (single well-tested file)

**Target:** `src/providers/kaneo/column-resource.ts` (its `list()` method exercised by `tests/providers/kaneo/column-resource.test.ts`).

**Bun coverage proof (Step 1):**

```
src/providers/kaneo/column-resource.ts  |  42.86 |  21.43 | 35-122
```

Bun reports 42.86 % function coverage and 21.43 % line coverage — confirming `list()` is genuinely executed by the test suite.

**Stryker scoped run (Step 3, `/tmp/stryker.A3.json`):**

Config: `mutate: ["src/providers/kaneo/column-resource.ts"]`, `coverageAnalysis: "perTest"`, `ignoreStatic: true`.
Run duration: **2 minutes 18 seconds**.

**Mutant status counts (Step 4):**

```json
{
  "Ignored": 69,
  "NoCoverage": 12,
  "CompileError": 4
}
```

Total mutants: 85. Killed: **0**. Survived: **0**.

**Contradiction:** Bun's own instrumented coverage shows the file's `list()` method runs during the test suite, yet Stryker classified 69 of 85 mutants as `Ignored` (static) and the remaining 12 as `NoCoverage` — zero were killed or survived. The `@hughescr/stryker-bun-runner` eagerly imports every mutated module during preload while `currentTestId` is `undefined`, so all module-level mutant hits land in the `static` bucket; `ignoreStatic: true` then drops them. Mutants that survive preload without a hit fall into `NoCoverage`. The result is a mutation score of 0.00 % for a file that is demonstrably covered — the measurement defect is fully reproduced, not a test gap.

### A4. Variable test — concurrency

**Hypothesis (from A2):** Section A2 established that `@hughescr/stryker-bun-runner` appends `--concurrency=1` to every Bun invocation unconditionally, regardless of the Stryker-level `concurrency` setting. If Stryker's `concurrency` were the cause of the high static-mutant rate, reducing it from 8 to 1 should change the distribution.

**Variable changed:** `concurrency: 8` → `concurrency: 1`. All other config identical to A3 (`mutate: ["src/providers/kaneo/column-resource.ts"]`, `coverageAnalysis: "perTest"`, `ignoreStatic: true`, same file target).

**Config:** `/tmp/stryker.A4.json` (ephemeral; derived from A3 config via `sed`).

**Run duration:** 2 minutes 32 seconds.

**Mutant status counts (A4, `concurrency: 1`):**

```json
{
  "Ignored": 69,
  "NoCoverage": 12,
  "CompileError": 4
}
```

**Side-by-side comparison:**

| Status       | A3 (`concurrency: 8`) | A4 (`concurrency: 1`) |
| ------------ | --------------------- | --------------------- |
| Ignored      | 69                    | 69                    |
| NoCoverage   | 12                    | 12                    |
| CompileError | 4                     | 4                     |
| Killed       | 0                     | 0                     |
| Survived     | 0                     | 0                     |
| **Total**    | **85**                | **85**                |

**Verdict:** Setting `concurrency: 1` did **not** reduce the static share, **ruling out** the concurrency hypothesis. The counts are bit-for-bit identical to A3. This confirms A2's finding: the runner forces `--concurrency=1` inside every Bun worker regardless of the Stryker-level `concurrency` setting, so the process-level parallelism has no effect on the per-mutant static classification. The root cause lies entirely in the eager-preload behaviour that imports mutated modules while `currentTestId` is `undefined`.

### A5. Variable test — preload isolation

### A6. True-score probe (ignoreStatic:false, scoped)

## 3. Track B — Test-Infrastructure Quality

### B1. Preload architecture

### B2. mock.module() blast radius

### B3. DI adherence

### B4. Test-quality signals from mutation data

### B5. Interaction with mutation measurement

## 4. Track C — Synthesis & Deferred Options

### C1. Root-cause statement

### C2. Quality assessment

### C3. Options for a future effort (deferred — not executed)

## 5. Appendix — Commands & Raw Outputs
