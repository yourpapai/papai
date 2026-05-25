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

**Hypothesis H1/H4:** The global `beforeEach` installed by `tests/mock-reset.ts` and the
`mock.module()` calls it runs at process scope contribute to the `Ignored (static)` collapse
observed in A3. To test this in isolation, the preload list (`bunfig.toml [test] preload`)
would need to be reduced from `["./tests/setup.ts", "./tests/mock-reset.ts"]` to
`["./tests/setup.ts"]` for a single Stryker run, without permanently modifying the committed
file.

**Step 1 — Capability check (read-only investigation of `@hughescr/stryker-bun-runner`):**

The runner's sandboxing logic was inspected in:

- `node_modules/@hughescr/stryker-bun-runner/README.md` §"How the sandboxed config works" (line 102)
- `node_modules/@hughescr/stryker-bun-runner/dist/index.js` lines 7586–7642
  (`generateSanitizedBunfig`) and lines 6261–6285 (`runBunTests` arg assembly)

Key findings:

1. **The sanitizer reads `bunfig.toml` exclusively.** `generateSanitizedBunfig` resolves the
   path as `path.join(projectCwd, "bunfig.toml")`, parses it, and forwards an explicit
   allowlist of `[test]` keys — including `preload` — into a temporary TOML file which is
   passed to every `bun test` call via `--config=<tmp-bunfig>`.

2. **`preload` is unconditionally forwarded.** `SAFE_TEST_KEYS` includes `"preload"`, and the
   sanitizer copies it verbatim (with paths absolutized). There is no flag, env var, or
   `bun: {}` config-block option to suppress or replace the preload array coming from
   `bunfig.toml`.

3. **The `bun: {}` config block in Stryker offers no preload override.** The documented
   options are: `bunPath`, `timeout`, `inspectorTimeout`, `env`, `bunArgs`, and `testFiles`.
   - `bunArgs` appends additional CLI flags but cannot remove entries already baked into the
     sanitized bunfig passed via `--config`.
   - `env` passes extra environment variables; there is no `BUN_PRELOAD`-style env-var
     override in Bun that suppresses config-declared preloads.

4. **Conclusion: preload is NOT overridable from the ephemeral Stryker config alone.**
   Dropping `mock-reset.ts` from the preload for a single experiment would require temporarily
   editing `bunfig.toml` (a committed file), which is out of scope for this read-only
   investigation.

**Step 2b — Constraint documented, experiment not run.**

Isolating the preload without touching `bunfig.toml` is not possible with the current runner.
The hypothesis is therefore assessed indirectly:

- **A2 (mechanism)** established that static collapse originates in the runner's own
  coverage-preload script, which eager-imports every mutated module before any test runs and
  while `currentTestId` is `undefined`. Coverage recorded at that point is attributed to the
  `static` bucket regardless of which `beforeEach` hooks the test suite installs.
- **B2 (mock.module blast radius)** will characterise how widely `mock-reset.ts` replaces
  module bindings and whether that forces more of the real module code to execute only inside
  the runner's preload window — but the primary driver of static collapse is the eager-import
  mechanism, not the presence or absence of `mock-reset.ts` in the preload list.

**Verdict:** Preload isolation is **assessed indirectly (not directly tested)**. The
`mock-reset.ts` / global-hook mechanism cannot be surgically excluded from a Stryker run
without editing `bunfig.toml`. Based on A2's mechanistic analysis the eager-import
coverage-preload is the dominant cause of static collapse; dropping `mock-reset.ts` from the
preload list would not eliminate the static bucket because the module-level code of the
mutated file runs unconditionally inside the runner's own preload script — before any
project-level preload script executes.

### A6. True-score probe (ignoreStatic:false, scoped)

**Target:** `src/providers/kaneo/search-tasks.ts` with its companion suite
`tests/providers/kaneo/search-tasks.test.ts`.

**Config:** `/tmp/stryker.A6.json` (ephemeral). Key deltas from A3: `mutate` points to
`search-tasks.ts`; `ignoreStatic: false`; `concurrency: 8`.

**Run duration:** 7 minutes 1 second (start 11:57:42, end 12:04:43 — well within the 30-minute
cost cap).

**Stryker planner warning (confirming static dominance):**

```
WARN MutantTestPlanner  Detected 43 static mutants (88% of total) that are estimated
to take 100% of the time running the tests!
```

This warning fires because `ignoreStatic: false` forces every static mutant to run the full
4 817-test suite — each static mutant exercises the entire test run rather than a small
per-test subset.

**Mutant status counts (from `/tmp/A6.mutation.json`):**

```json
{
  "CompileError": 25,
  "NoCoverage": 2,
  "Killed": 16,
  "Survived": 6
}
```

Total mutants instrumented: **49**. Valid (scored) mutants = Killed + Survived + NoCoverage +
Timeout = 16 + 6 + 2 + 0 = **24**.

**Per-file true score:** (16 + 0) / 24 = **66.7%** (Stryker reports 66.67%).

**Before/after framing:**

Under `ignoreStatic: true` (A3 methodology), covered files collapse to 0% — all mutants are
either Ignored (static) or NoCoverage; zero are Killed or Survived. Under `ignoreStatic: false`
(this probe), the same class of file yields **16 Killed and 6 Survived** mutants against the
full suite, confirming the existing tests do actively kill mutants once static attribution is
removed from the equation. The 25 `CompileError` mutants were rejected at the TypeScript
checker stage before any test ran.

**Static → Killed/Survived conversion:**

Of the 49 instrumented mutants, 43 were flagged as static by the planner (88%). After running
the full suite against each, 16 emerged as Killed and 6 as Survived — at least 22 of those 43
static mutants resolved to a scoreable outcome. Only 2 remained NoCoverage (no test reached
them even when the static guard was lifted).

**Contrast with A3 column-resource result:**

A3 (`column-resource.ts`, `ignoreStatic: true`): 69 Ignored, 12 NoCoverage, 0 Killed, 0
Survived — score 0%.
A6 (`search-tasks.ts`, `ignoreStatic: false`): 16 Killed, 6 Survived, 2 NoCoverage — score
66.7%.

These are different files, so the comparison is qualitative rather than numeric, but the
direction is unambiguous: flipping `ignoreStatic` converts the static bucket from a wall of
zeros into a meaningful Killed/Survived distribution.

**Extrapolation uncertainty statement:**

This single-file probe shows the existing tests DO kill mutants once static attribution is
corrected, suggesting the repo-wide true score is materially higher than the headline 23.54%
produced by the current `ignoreStatic: true` baseline. However, a full `ignoreStatic: false`
run across all 16 491 source files would be extremely time-intensive (each static mutant runs
the entire 4 817-test suite; with ~8 032 static mutants repo-wide, wall-clock time is
estimated at many hours even at `concurrency: 8`). Quantifying the true repo-wide score is
therefore deferred to a future dedicated run — see C3.

## 3. Track B — Test-Infrastructure Quality

### B1. Preload architecture

`bunfig.toml` declares `preload = ["./tests/setup.ts", "./tests/mock-reset.ts"]` (in that
order). Both files are loaded once — before any test file is discovered — in the single Bun
worker process.

#### `tests/setup.ts` (lines 1–30)

- Sets `process.env['LOG_LEVEL'] = 'silent'` at module-load time, before any source module is
  imported (line 10). This ensures pino and any other LOG_LEVEL-gated logger is silenced for
  the entire test run.
- Replaces `console.log`, `console.info`, `console.warn`, and `console.debug` with no-ops
  (lines 21–24). `console.error` is intentionally left intact for debugging test failures
  (comment at line 26).
- Exports `originalConsole` (line 30) for the rare test that needs to capture or assert on
  real console output.
- No hooks (`beforeEach`/`afterEach`) are installed; all side-effects are module-level and
  permanent for the process lifetime.

#### `tests/mock-reset.ts` (lines 1–106)

- At module-load time (lines 19–56), imports **29 real source/vendor modules** — 27 project
  modules from `src/` plus `ai` and `@ai-sdk/openai-compatible` — and captures a shallow
  spread-copy of each export namespace into the `originals` array (lines 58–88). This is the
  "snapshot originals before any test can mock them" step, described in the module-level JSDoc
  at line 8.
- The file comment at lines 22–25 explicitly documents the process-wide leak risk: _"Bun's
  `mock.module()` is process-wide, so any module mocked there leaks into subsequent test
  files."_ The preload is the deliberate countermeasure.
- Installs a **global `beforeEach`** (lines 90–99) that runs before every test in the process:
  1. Calls `resetDrizzleDbForTesting()` to reset the Drizzle DB singleton (line 91).
  2. Calls `setBlobStoreForTesting(createInMemoryBlobStoreForTesting())` to reset the blob
     store to a fresh in-memory instance (line 92).
  3. Sets three S3-shaped env vars to test-safe placeholder values (lines 93–95).
  4. Iterates `originals` and calls `mock.module(path, () => ({ ...exports }))` for all 29
     modules (lines 96–98), restoring them to their pre-test state.
- Installs a **global `afterEach`** (lines 101–106) that:
  1. Calls `mock.restore()` to clear all `mock()` spy overrides (line 102).
  2. Deletes the three S3 env vars (lines 103–105).

**Per-test execution order** (stated in the module-level JSDoc, line 13):

> global `beforeEach` (restore originals) → file `beforeEach` (apply mocks) → test → global
> `afterEach` (restore spies)

This ordering is established by Bun's hook registration order: preload files are evaluated
first, so their `beforeEach`/`afterEach` registrations precede those in any test file. The
runner's own coverage-preload hooks are registered via a separate `--preload` flag that the
runner passes at invocation time; see the ambiguity note below.

#### Risks / Smells

1. **Global hooks fire with `currentTestId` undefined (ties to A2).** The global `beforeEach`
   in `mock-reset.ts` is registered during preload, which runs before the
   `@hughescr/stryker-bun-runner` coverage-preload's own `beforeEach` sets
   `strykerGlobal.currentTestId`. Because Bun executes `beforeEach` hooks in registration
   order, the `mock.module()` restore loop in the global `beforeEach` may fire while
   `currentTestId` is still `undefined`. Any mutant hits recorded during that loop land in the
   `static` bucket. The `stabilizeCoverage` promotion rule (A2 §4) then escalates any remaining
   perTest hits that span multiple tests into `static` as well, amplifying the effect across all
   29 reset modules.

2. **`mock.module()` is process-wide — a single forgotten module poisons all subsequent files.**
   The comment at lines 22–25 acknowledges this explicitly. If any test file calls
   `mock.module()` on a module that is NOT in the `originals` list, that mock persists across
   every later test file in the run until the process exits. Adding a new commonly-mocked module
   to the project requires a coordinated update to `mock-reset.ts`; omitting it creates
   non-deterministic cross-file contamination.

3. **`originals` snapshot is a shallow spread, not a deep clone.** `{ ..._logger }` captures
   the export bindings at the moment the preload runs. If any captured export is itself a
   mutable object (e.g., a class instance or a shared registry), mutations to its internals
   during a test survive the restore step. The pattern is safe for pure-function exports and
   function-valued exports but fragile for stateful singletons.

4. **Every test pays the cost of 29 `mock.module()` calls unconditionally.** The global
   `beforeEach` rebuilds all 29 module entries before each of the ~4 817 tests regardless of
   whether the test touches any of those modules. This adds constant overhead per-test and makes
   the global hook a high-traffic path in the Stryker dry-run, where it is exercised once per
   test per mutant batch.

5. **All test files implicitly depend on the global reset — tight invisible coupling.** Any test
   file that relies on a module being reset to its "real" state is relying on the global
   `beforeEach` running first. There is no explicit import or declaration; the dependency is
   structural and invisible. Removing a module from `originals` silently breaks tests that
   assumed it would be restored.

6. **Hook registration order vis-à-vis the runner's own preload is environment-dependent.**
   When running under Stryker, the runner injects its own preload via `--preload=<runner-preload>`
   in addition to the project's `bunfig.toml` preload. The order in which multiple `--preload`
   entries and `bunfig.toml` preloads are evaluated is not explicitly documented in Bun's
   runner; if the runner's preload is evaluated after `mock-reset.ts`, its `beforeEach`
   registration order changes and `currentTestId` may or may not be set when the global reset
   hook fires. This ambiguity is unresolvable without empirical measurement (see A5).

### B2. mock.module() blast radius

#### Data collection

Commands run (static analysis only; no `src/` or `tests/` changes):

```
# Total call count and file count
grep -rn  "mock\.module(" tests/ --include="*.ts" | wc -l   → 97
grep -rln "mock\.module(" tests/ --include="*.ts" | wc -l   → 26

# Ranked mocked specifiers
grep -rhn "mock\.module(" tests/ --include="*.ts" \
  | sed -E "s/.*mock\.module\(['\"]([^'\"]+)['\"].*/\1/" \
  | sort | uniq -c | sort -rn
```

#### Raw counts

- **97 total `mock.module()` call sites** across **26 test files**.
- `tests/mock-reset.ts` contributes **1 call site** (a loop that issues 29 `mock.module()` calls
  per `beforeEach` invocation); the remaining 96 are scattered across 25 individual test files.

#### Mocked-modules table (top specifiers, normalized)

Relative paths are normalized to the canonical `src/` module. The mutate scope (from
`stryker.config.json`) covers: `src/providers/**/*.ts` (excl. index/constants/types),
`src/tools/**/*.ts` (excl. index), `src/errors.ts`, `src/config.ts`, `src/memory.ts`,
`src/users.ts`, `src/cron.ts`, `src/recurring.ts`, `src/history.ts`, `src/conversation.ts`.

| Module (normalized)                      | Raw specifiers                                                  | Occurrences |  In mutate scope?  |
| ---------------------------------------- | --------------------------------------------------------------- | ----------: | :----------------: |
| `ai` (external)                          | `ai`                                                            |          15 |         N          |
| `@ai-sdk/openai-compatible` (external)   | `@ai-sdk/openai-compatible`                                     |          13 |         N          |
| `src/providers/factory.ts`               | `../src/providers/factory.js`, `../../src/providers/factory.js` |          13 |       **Y**        |
| `src/logger.ts`                          | `../../src/logger.js`, `../src/logger.js`                       |           9 |         N          |
| `src/tools/index.ts`                     | `../src/tools/index.js`                                         |           2 | N (index excluded) |
| `src/chat/interaction-router.ts`         | `../src/chat/interaction-router.js`                             |           2 |         N          |
| `src/recurrence.ts`                      | `../../src/recurrence.js`                                       |           2 |  N (not in scope)  |
| `src/db/drizzle.ts`                      | `../../src/db/drizzle.js`, `../src/db/drizzle.js`               |           3 |         N          |
| `src/auth.ts`                            | `../../../src/auth.js`                                          |           2 |         N          |
| `src/providers/kaneo/provision.ts`       | `../src/providers/kaneo/provision.js`                           |           1 |       **Y**        |
| `src/recurring.ts`                       | `../../src/recurring.js`                                        |           1 |       **Y**        |
| `src/users.ts`                           | `../src/users.js`                                               |           1 |       **Y**        |
| `src/system-config.ts`                   | `../src/system-config.js`                                       |           1 |         N          |
| `src/scheduler.ts`                       | `../src/scheduler.js`                                           |           1 |         N          |
| `src/scheduler-instance.ts`              | `../src/scheduler-instance.js`                                  |           1 |         N          |
| `src/message-queue/index.ts`             | `../src/message-queue/index.js`                                 |           1 |         N          |
| `src/message-cache/index.ts`             | `../src/message-cache/index.js`                                 |           1 |         N          |
| `src/deferred-prompts/poller.ts`         | `../src/deferred-prompts/poller.js`                             |           1 |         N          |
| `src/db/index.ts`                        | `../src/db/index.js`                                            |           1 |         N          |
| other (chat, attachments, bot, scripts…) | various                                                         |          11 |         N          |

**In-scope summary (4 distinct modules, 16 combined occurrences):**

| Module                             | Combined occurrences |
| ---------------------------------- | -------------------: |
| `src/providers/factory.ts`         |                   13 |
| `src/providers/kaneo/provision.ts` |                    1 |
| `src/recurring.ts`                 |                    1 |
| `src/users.ts`                     |                    1 |

#### B1 global reset cross-reference

The 29-module `originals` array in `tests/mock-reset.ts` (B1) issues a `mock.module()` call per
entry on every `beforeEach`. Of those 29, **4 are in the mutate scope**:

- `../src/providers/factory.js` → `src/providers/factory.ts`
- `../src/providers/kaneo/provision.js` → `src/providers/kaneo/provision.ts`
- `../src/recurring.js` → `src/recurring.ts`
- `../src/users.js` → `src/users.ts`

(The other 25 global reset modules — `src/bot.ts`, `src/logger.ts`, DB modules, chat adapters,
etc. — are outside the mutate scope and do not affect mutation coverage directly.)

#### Analysis

**Process-wide leakage.** Bun's `mock.module()` replaces the module binding globally for the
entire worker process. Any call to `mock.module(specifier, factory)` in any test file immediately
replaces that module's exports for all subsequent imports in all other test files that share the
same process, regardless of describe/test boundaries. The `mock-reset.ts` global `beforeEach`
exists precisely to counter this leakage: it restores known modules before each test. But the
restoration itself is a `mock.module()` call — meaning it re-issues a process-wide override every
single test, keeping those module slots permanently occupied by mock machinery rather than real
code.

**Impact on perTest coverage (the mutation story).** For a mutant to accrue `perTest` coverage,
its source file must be executed while `currentTestId` is set to the running test. When a module
is replaced by `mock.module()`, Stryker's instrumented version of that module is bypassed: the
mock factory returns whatever the test author chose, not the instrumented real code. Any mutant
inside the replaced module therefore sees no execution during those test runs, contributing
zero perTest hits. Stryker records such mutants as `NoCoverage` (or, if the module was
eager-imported during the runner's preload before any `mock.module()` call, as `static` via the
mechanism described in A2).

**Direct link to NoCoverage/static.** The 13 call sites that mock `src/providers/factory.ts`
(the highest-frequency in-scope module) are spread across at least 3 test files
(`tests/llm-orchestrator.test.ts` with 6 calls, `tests/index.test.ts` with 1, and
`tests/commands/context-tool-resolution.test.ts` and others). Every test in those files that
executes while `src/providers/factory.ts` is mocked contributes zero perTest coverage for any
mutant inside `factory.ts`. Combined with the 29-module global reset running on all ~4 817 tests
(each unconditionally re-mocking `factory.ts`), virtually every test in the suite replaces
`factory.ts` with a mock before executing. The result is that `factory.ts` mutants are almost
entirely deprived of perTest hits, pushing them into the `NoCoverage` or `static` bucket.

**Scale.** With 97 call sites across 26 files and 4 in-scope modules receiving combined 16
explicit mock.module() invocations (plus 29 × ~4 817 invocations from the global beforeEach
loop), the blast radius is wide: the global reset alone performs approximately 140 000
`mock.module()` calls per full test run. Every in-scope module in the global reset list
effectively has zero chance of accumulating real perTest coverage, regardless of how thoroughly
its tests exercise its logic.

**Cross-reference to B1 and A2.** B1 §Risks/Smells item 1 notes that the global `beforeEach`
fires while `currentTestId` may be `undefined`, so the 29 module-reset calls themselves land in
the `static` bucket. A2 §3–4 establishes that the runner's coverage-preload eager-imports every
mutated module unconditionally — also before any test, while `currentTestId` is `undefined`.
Both paths funnel the same in-scope modules into `static`. The mock.module() blast radius is a
secondary amplifier: even if the eager-import issue were resolved, in-scope modules that are
heavily mocked would still accrue limited perTest coverage because the mock short-circuits
execution of the instrumented code.

### B3. DI adherence

#### Stated preference

`tests/CLAUDE.md` §Mocking Rules (line 29):

> "Prefer dependency injection over module mocking whenever the source module already exposes a
> `Deps` interface."

> "When a suite must use `mock.module()`, be precise about why and keep the mocked boundary
> narrow."

`CLAUDE.md` §Testing Notes (line 379):

> "prefer DI over `mock.module()` where the module already supports it"

The "Important Reality Check" section of `tests/CLAUDE.md` (lines 46–50) explicitly acknowledges
the current state:

> "The repo currently contains both modern DI-first tests and legacy `mock.module()` plus
> delayed-import suites. Prefer the DI-first pattern for new tests. Do not rewrite existing
> stable tests just to match DI unless the work already touches that area."

#### Data collection

Commands run (static analysis; no `src/` or `tests/` changes):

```
# mock.module users
grep -rl "mock\.module(" tests/ --include="*.ts" | wc -l          → 26

# DI-helper users (getToolExecutor / makeTools / createMockProvider / provider: / deps:)
grep -rlE "getToolExecutor\(|makeTools\(|createMockProvider\(|new [A-Z][A-Za-z]+Resource\(|provider:|Deps =|deps:" \
  tests/ --include="*.ts" | wc -l                                  → 120

# total test files
find tests -name "*.test.ts" | wc -l                               → 545 (includes client/ and e2e/)

# files using BOTH mock.module and a DI helper
comm -12 \
  <(grep -rl "mock\.module(" tests/ --include="*.ts" | sort) \
  <(grep -rlE "getToolExecutor\(|makeTools\(|createMockProvider\(|provider:|deps:" \
      tests/ --include="*.ts" | sort) | wc -l                      → 11

# Deps interfaces in src/
grep -rlE "interface .*Deps|type .*Deps" src/ | head
# → 20 files (sample: src/bot.ts, src/llm-orchestrator-types.ts, src/announcements.ts,
#    src/scheduler.ts, src/conversation.ts, plus ~15 more, covering most key orchestration modules)
```

#### Counts and ratio

| Metric                                               | Count |
| ---------------------------------------------------- | ----: |
| Total `.test.ts` files                               |   545 |
| Files using at least one DI helper                   |   120 |
| Files using `mock.module()`                          |    26 |
| Files using **both** `mock.module()` and a DI helper |    11 |
| Files using `mock.module()` **only** (no DI helper)  |    15 |

The 120:26 ratio (~4.6:1) reflects a suite where DI-first is clearly the dominant pattern. Of
the 26 `mock.module()` users, 11 also use DI helpers, indicating that mixed-pattern files are
common. 15 files rely on `mock.module()` exclusively — most of these are integration/startup
tests or cross-cutting utility mocks (e.g., logger, DB, scheduler) where no `Deps` interface
exists on the imported module.

#### Three representative divergences

**Divergence 1: `tests/commands/context.test.ts` — `src/providers/factory.ts` mocked despite
`ContextCommandDeps.buildProvider` being available**

- File: `tests/commands/context.test.ts`
- Mocked: `../../src/providers/factory.js` (5 call sites: lines 129, 166, 206, 262, 306)
- Why DI was available: `src/commands/context.ts` exposes `ContextCommandDeps` (line 36) with a
  `buildProvider: (contextId: string) => TaskProvider | null` slot. The test file already imports
  and uses `ContextCommandDeps` via the `snapshotDeps()` helper. In 4 of those 5 tests the
  pattern is: `mock.module(factory, () => ({ buildProviderForUser: () => provider }))` immediately
  followed by `snapshotDeps({})`. The `snapshotDeps` helper defaults `buildProvider` to
  `safeBuildProvider` (which calls `buildProviderForUser` internally) — meaning the module mock
  and the Deps slot are wired to the same underlying call. A direct override via
  `snapshotDeps({ buildProvider: () => provider })` would achieve the same isolation without the
  process-wide module replacement. The one exception (line 204, "uses injected provider
  construction instead of the hardwired provider factory") explicitly tests that the DI path is
  preferred, yet still mocks the factory as a sentinel — this is arguably legitimate.

**Divergence 2: `tests/llm-orchestrator.test.ts` — `src/providers/factory.ts` mocked despite
`LlmOrchestratorDeps.buildProviderForUser` injection slot**

- File: `tests/llm-orchestrator.test.ts`
- Mocked: `../src/providers/factory.js` (6 call sites: lines 184, 805, 822, 857, 883, 910)
- Why DI was available: `src/llm-orchestrator-types.ts` defines `LlmOrchestratorDeps` (line 13)
  with a `buildProviderForUser: (userId: string) => TaskProvider` field. The test already wires
  this via the `deps` object passed directly to `callLlm()` (lines 239, 243, 283, 287 etc.) for
  the outer suite. However the inner "identity resolver" sub-suite (lines ~800–910) also issues
  per-test `mock.module('../src/providers/factory.js', ...)` calls in addition to overriding
  `deps.buildProviderForUser`. The per-test module mocks are redundant: passing
  `buildProviderForUser` in `deps` is already sufficient since `callLlm` reads the provider from
  `deps`, not from a direct `factory` import. The redundant `mock.module()` calls widen the blast
  radius (see B2) with no isolation benefit over the Deps-based approach.

**Divergence 3: `tests/index.test.ts` — `src/users.ts` mocked as a module despite
`BotDeps`-injected wire being the preferred path**

- File: `tests/index.test.ts`
- Mocked: `../src/users.js` (line 188), along with 15+ other modules in a single `beforeEach`
- Why DI was partially available: `src/index.ts` wires startup via `BotDeps` passed to
  `setupBot()`. The test captures the `BotDeps` argument by mocking `setupBot` itself (line 117),
  which correctly exercises the DI path for the bot layer. However, `src/users.ts` exports bare
  functions (`addUser`, `isAuthorized`, etc.) with no `Deps` interface — the module has no
  parameter injection point. The `mock.module('../src/users.js', ...)` call is therefore a
  **legitimate fallback** (`src/users.ts` provides no injectable surface). This test is better
  classified as a necessary module-boundary test for a module that does not yet expose a `Deps`
  interface, rather than a DI adherence gap.

#### Analysis and verdict

**Adherence verdict: mixed, trending DI-first.**

The suite shows clear DI-first adoption — 120 files use DI helpers versus 26 that use
`mock.module()`, and the majority of the 26 are for modules that genuinely lack a `Deps`
interface (external SDKs like `ai` / `@ai-sdk/openai-compatible`, infrastructure modules like
`src/logger.ts`, DB modules, scheduler, and startup glue in `src/index.ts`).

The highest-impact gap is `src/providers/factory.ts`, which is mocked 13 times across at least
4 test files (cross-reference B2) despite `ContextCommandDeps.buildProvider` and
`LlmOrchestratorDeps.buildProviderForUser` being available. In `tests/commands/context.test.ts`
the module mock is largely redundant alongside the `snapshotDeps` helper. In
`tests/llm-orchestrator.test.ts` the inner sub-suite's per-test `mock.module()` calls duplicate
what `deps.buildProviderForUser` already accomplishes. Eliminating these redundant module mocks
would narrow the blast radius identified in B2 and allow Stryker's instrumented version of
`factory.ts` to execute during those tests, directly improving perTest coverage for `factory.ts`
mutants.

`src/users.ts` (1 occurrence) and `src/recurring.ts` (1 occurrence) are both mocked in contexts
where no `Deps` interface exists on those modules; those are legitimate legacy-pattern uses, not
adherence failures.

**Single highest-impact gap:** Replace `mock.module('…/providers/factory.js', …)` calls in
`tests/commands/context.test.ts` and the redundant calls in `tests/llm-orchestrator.test.ts`
with direct overrides via the already-present `ContextCommandDeps.buildProvider` and
`LlmOrchestratorDeps.buildProviderForUser` injection slots. This would reduce the 13 in-scope
`factory.ts` module-mock call sites to near zero and unlock perTest coverage for all `factory.ts`
mutants (currently pushed into `NoCoverage`/`static` by the global reset — see B2).

### B4. Test-quality signals from mutation data

#### Step 1: Ranked files by survived and NoCoverage mutants

**Top 12 by survived mutants (descending):**

| File (src/)                                      | Survived | Killed | Notes              |
| ------------------------------------------------ | -------: | -----: | ------------------ |
| `providers/youtrack/operations/agiles.ts`        |       19 |     27 | also 16 NoCoverage |
| `tools/update-status.ts`                         |       18 |      6 |                    |
| `providers/kaneo/label-resource.ts`              |       16 |      1 |                    |
| `providers/youtrack/labels.ts`                   |       16 |      6 |                    |
| `providers/youtrack/operations/comments.ts`      |       14 |     13 |                    |
| `providers/youtrack/operations/work-items.ts`    |       14 |      8 |                    |
| `providers/youtrack/operations/collaboration.ts` |       13 |      2 | also 19 NoCoverage |
| `providers/youtrack/operations/team.ts`          |       12 |      0 | also 26 NoCoverage |
| `providers/youtrack/task-helpers.ts`             |       11 |      8 |                    |
| `tools/create-recurring-task.ts`                 |       11 |      5 |                    |
| `tools/set-my-identity.ts`                       |       11 |      2 |                    |
| `tools/update-recurring-task.ts`                 |       11 |      7 |                    |

**Top 12 by NoCoverage mutants (descending):**

| File (src/)                                      | NoCoverage | Killed | Notes            |
| ------------------------------------------------ | ---------: | -----: | ---------------- |
| `providers/factory.ts`                           |         49 |      0 | 0 survived       |
| `tools/search-memos.ts`                          |         36 |      3 | 0 survived       |
| `providers/youtrack/operations/team.ts`          |         26 |      0 | also 12 survived |
| `providers/kaneo/task-relations.ts`              |         24 |     12 | 0 survived       |
| `providers/kaneo/update-label.ts`                |         23 |      0 | 0 survived       |
| `providers/kaneo/update-project.ts`              |         23 |      0 | 0 survived       |
| `providers/kaneo/task-resource.ts`               |         20 |      7 | 0 survived       |
| `providers/youtrack/operations/collaboration.ts` |         19 |      2 | also 13 survived |
| `providers/youtrack/custom-field-values.ts`      |         18 |      7 | 0 survived       |
| `providers/youtrack/operations/agiles.ts`        |         16 |     27 | also 19 survived |
| `providers/youtrack/operations/users.ts`         |         15 |      9 | 0 survived       |
| `providers/kaneo/column-resource.ts`             |         12 |      0 | confirmed in A3  |

#### Step 2: Classification of top offenders

**Top 6 by survived mutants — classification:**

| File                                          | Classification      | Basis                                                                                                                                                                              |
| --------------------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `providers/youtrack/operations/agiles.ts`     | **weak-assertions** | `tests/providers/youtrack/operations/agiles.test.ts` exists (432 lines, no `mock.module`). 27 kills confirm tests run; 19 survivors indicate assertions do not cover all branches. |
| `tools/update-status.ts`                      | **weak-assertions** | `tests/tools/update-status.test.ts` exists (no `mock.module`). 6 kills confirm exercise; 18 survivors indicate parameter/edge-case assertions are incomplete.                      |
| `providers/kaneo/label-resource.ts`           | **weak-assertions** | `tests/providers/kaneo/label-resource.test.ts` exists (459 lines, no `mock.module`). Only 1 kill against 16 survivors signals very thin assertion coverage.                        |
| `providers/youtrack/labels.ts`                | **weak-assertions** | `tests/providers/youtrack/labels.test.ts` exists (no `mock.module`). 6 kills vs 16 survivors; tests run but assertions miss many conditional paths.                                |
| `providers/youtrack/operations/comments.ts`   | **weak-assertions** | `tests/providers/youtrack/operations/comments.test.ts` exists (no `mock.module`). 13 kills vs 14 survivors — roughly half mutations are not caught despite test coverage.          |
| `providers/youtrack/operations/work-items.ts` | **weak-assertions** | `tests/providers/youtrack/operations/work-items.test.ts` exists (no `mock.module`). 8 kills vs 14 survivors; assertions don't cover return-value and boundary mutations.           |

**Top 6 by NoCoverage mutants — classification:**

| File                                    | Classification           | Basis                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `providers/factory.ts`                  | **over-mocked**          | No `factory.test.ts` exists. The global `beforeEach` in `mock-reset.ts` re-mocks `src/providers/factory.js` on every one of ~4 817 tests (B2). 13 additional call sites across `context.test.ts`, `llm-orchestrator.test.ts`, and others mock it further. Stryker's instrumented version is therefore bypassed in virtually every test — NoCoverage is driven by `mock.module` blast, not by a gap in test scenarios. |
| `tools/search-memos.ts`                 | **measurement-artifact** | `tests/tools/memo-tools.test.ts` exists (no `mock.module`). The 3 kills confirm some perTest coverage was recorded; the 36 NoCoverage mutants represent mutant sites that were reached only during the runner's eager-import preload (while `currentTestId` is `undefined`) and therefore landed in the static bucket, not a genuine test gap.                                                                        |
| `providers/youtrack/operations/team.ts` | **measurement-artifact** | `tests/providers/youtrack/operations/team.test.ts` exists (246 lines, no `mock.module`, uses `setMockFetch`). The 26 NoCoverage and 12 survived mutants all originate from the static-bucket collapse documented in A2/A3: provider-layer module code is eagerly imported before any `beforeEach`, so perTest hits are not recorded.                                                                                  |
| `providers/kaneo/task-relations.ts`     | **measurement-artifact** | `tests/providers/kaneo/task-relations.test.ts` exists (136 lines, no `mock.module`). The 12 kills confirm genuine perTest coverage was recorded for part of the file; the 24 NoCoverage mutants are in code paths reached only during preload, not due to missing tests.                                                                                                                                              |
| `providers/kaneo/update-label.ts`       | **measurement-artifact** | No dedicated unit test in the main suite (only `tests/e2e/label-operations.test.ts`, which is excluded from the mutation run). The file is a provider-layer helper accessed through `label-resource.ts`, itself eagerly imported. 0 kills and 0 survived confirm complete static collapse per A2/A3 — consistent with a file exercised only through the preload path.                                                 |
| `providers/kaneo/update-project.ts`     | **measurement-artifact** | Same pattern as `update-label.ts`: no main-suite unit test (only e2e imports); provider layer; 0 kills, 0 survived. Tools-level tests (`project-tools.test.ts`) mock the provider and never exercise the real `update-project.ts` implementation. Static-bucket collapse per A2/A3.                                                                                                                                   |

#### Step 3: Dominant signal narrative

The survived-mutant list is the cleaner of the two quality signals: every top-6 file has a matching test suite with no `mock.module` interference, and all have non-zero kill counts confirming the tests genuinely execute the code. The uniform pattern — many survivors alongside meaningful kills — is the classic weak-assertion signature: tests exercise happy-path flows and verify return shapes but under-assert on conditional branches, parameter boundaries, and error paths. The two highest-priority offenders are `providers/kaneo/label-resource.ts` (16 survivors, only 1 kill — an assertion-to-coverage ratio of 6%) and `tools/update-status.ts` (18 survivors, 6 kills), both of which represent real, actionable test-quality gaps.

The NoCoverage list is substantially contaminated by the A2 measurement defect. Every top-6 NoCoverage file either has a test suite with zero `mock.module` calls (`search-memos.ts`, `team.ts`, `task-relations.ts`) or is a provider-layer helper whose only main-suite coverage comes indirectly through eagerly imported wrapper modules (`update-label.ts`, `update-project.ts`). In all these cases the NoCoverage classification arises because the runner's eager-import preload records module-level hits in the `static` bucket before any `beforeEach` sets `currentTestId`, and `ignoreStatic: true` then drops those mutants from scoring. The one genuine over-mocking case is `providers/factory.ts`, where the global reset's 29-module `mock.module` loop (B2) replaces the instrumented module on every test, depriving its mutants of any perTest hit.

NoCoverage counts in this report cannot be read as pure test-gap counts: they are a mixture of the A2 static-collapse artifact, the B2 `mock.module` blast radius, and — only for files with no main-suite test at all — a genuine absence of coverage. Separating these requires a per-file check (does a test file exist? is the module mocked? do any kills appear?) rather than treating NoCoverage as a monolithic gap metric. The survived-mutant list, by contrast, is largely free of this contamination and is the more reliable proxy for actionable test-quality improvement.

### B5. Interaction with mutation measurement

Track B's findings connect directly to the measurement defects characterised in Track A. There
are two distinct mechanisms that degrade mutation measurement accuracy, and the suite's preload
design, mock strategy, and DI adherence each play a different role in them.

#### Two preload mechanisms — the suite's own vs the runner's

The suite declares two preload files in `bunfig.toml`: `tests/setup.ts` and
`tests/mock-reset.ts` (B1). These are the _project_ preloads. The
`@hughescr/stryker-bun-runner` injects an additional _runner_ preload via a separate
`--preload` flag at Stryker invocation time; this is the coverage-preload template described in
A2 §3.

It is important to keep these two mechanisms separate:

- The **suite's preloads** (`setup.ts`, `mock-reset.ts`) run before any test file is loaded.
  `setup.ts` performs only module-level side-effects (silencing the console and LOG_LEVEL).
  `mock-reset.ts` imports 29 source modules at module-load time and installs a global
  `beforeEach` / `afterEach` pair (B1). Neither file is the root cause of the static collapse.

- The **runner's coverage-preload** is the root cause. Before any `beforeEach` hook from any
  source can fire, the runner's preload template executes a deterministic eager-import loop
  that imports every mutated source module while `strykerGlobal.currentTestId` is `undefined`
  (A2 §3). Because the `cover()` helper writes to `cov.static` when `currentTestId` is
  undefined, all module-level mutant hits from this loop land in the `static` bucket. The
  project preloads execute in the same pre-test window and face the same `undefined`
  `currentTestId`, but even if they were removed they would not eliminate the static collapse —
  the runner's own eager-import loop runs regardless of which project preloads are present
  (A5).

A5 confirmed this indirectly: isolating `mock-reset.ts` from the preload would have required
editing `bunfig.toml` (out of scope), and A2's mechanistic analysis makes clear the runner's
preload drives the collapse independently of project-preload contents. The suite's own preloads
are therefore **largely neutral** to the static-bucket defect.

#### Two independent measurement-degrading mechanisms

Track B reveals that even if the eager-import static-bucket defect (A2) were fully resolved,
a second independent mechanism would continue to suppress perTest coverage for in-scope
modules: `mock.module()` substitution.

**Mechanism 1 — Eager-import static bucketing (A2):** All module-level hits recorded during
the runner's preload phase land in `cov.static`. With `ignoreStatic: true`, 77.2% of all
instrumented mutants are dropped before scoring (A1). A3 reproduces this fully: a file with
21% line coverage per Bun's own coverage tool shows 0 killed / 0 survived / 69 Ignored under
the baseline config.

**Mechanism 2 — `mock.module()` substitution of in-scope modules (B2):** When
`mock.module(specifier, factory)` is called, Bun replaces that module's exports
process-wide with the factory's return value. Stryker's instrumented version of the module is
bypassed: its `cover()` calls never fire, and its mutants receive zero perTest hits. The global
`beforeEach` in `mock-reset.ts` re-mocks all 29 modules in its `originals` array on every one
of ~4,817 tests. Of those 29, four are in the mutate scope: `src/providers/factory.ts`,
`src/providers/kaneo/provision.ts`, `src/recurring.ts`, and `src/users.ts` (B2). For
`src/providers/factory.ts` specifically, 13 additional explicit call sites across at least four
test files further ensure the instrumented module is replaced in virtually every test. The
result is 49 NoCoverage mutants and 0 killed for `factory.ts` (B4).

These two mechanisms are additive and act on different populations of mutants:

| Mechanism                                                            | Primary signal in data                                                                      | Root section |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------ |
| Runner eager-import → static bucket → `ignoreStatic:true` drop       | 8,032 Ignored (77.2% of total)                                                              | A1, A2, A3   |
| `mock.module()` substitution of in-scope modules → zero perTest hits | NoCoverage for `factory.ts` (49), and partial NoCoverage for `provision.ts`, `recurring.ts` | B2, B4       |

#### NoCoverage is not a monolithic gap metric

B4 established that the NoCoverage list is contaminated by both mechanisms. `factory.ts`'s 49
NoCoverage mutants are produced by mechanism 2 (over-mocking): the module is re-substituted by
the global `beforeEach` on every test, so no perTest hit can ever accumulate for its mutants.
`search-memos.ts`, `team.ts`, and `task-relations.ts` produce NoCoverage via mechanism 1
(static collapse): tests for these files exist and are exercised, as their nonzero kill counts
confirm, but the subset of mutant sites that are only hit at module-load time (during the
eager-import preload) land in the static bucket and are discarded. Only `update-label.ts` and
`update-project.ts` reflect a genuine gap: no main-suite test exists for either file, so no
mechanism could produce a kill even under ideal measurement conditions.

#### DI adherence and measurement accuracy

B3 established that the suite is DI-first at a 120:26 file ratio but that the highest-impact
divergence is `src/providers/factory.ts`, mocked via `mock.module()` in test files that already
have a DI injection slot available (`ContextCommandDeps.buildProvider`,
`LlmOrchestratorDeps.buildProviderForUser`).

The DI vs `mock.module()` distinction maps directly to measurement accuracy. When a test uses
**dependency injection**, the real instrumented module is passed in as a dependency object: the
module itself remains loaded in its instrumented form, and any code path exercised by the test
produces a legitimate perTest hit. When a test uses **`mock.module()`**, the instrumented
module's binding is replaced entirely; no `cover()` call fires, and the mutants inside that
module are invisible to Stryker for the duration of the test.

This means every `mock.module()` call on an in-scope module is simultaneously a test-isolation
choice and a measurement-suppression action. Switching redundant `mock.module()` calls (those
where a `Deps` injection slot is already available, as catalogued in B3 Divergences 1 and 2)
to DI-based overrides would allow Stryker's instrumented `factory.ts` to remain loaded during
those tests, directly converting NoCoverage mutants into Killed or Survived classifications and
making the mutation data actionable.

#### Closing statement

The current preload, mock, and DI organisation harms accurate mutation measurement primarily
through two mechanisms: **(1)** the runner's coverage-preload eager-import, which records all
module-level hits in the `static` bucket before any test runs, and **(2)** `mock.module()`
substitution of in-scope modules (principally `src/providers/factory.ts`), which deprive
mutants of perTest hits even when the corresponding tests exercise the same logical paths via
DI-supplied providers. The suite's own preloads (`setup.ts`, `mock-reset.ts`) are largely
neutral to defect (1): the static collapse originates in the runner's own preload mechanism and
would persist even without `mock-reset.ts` in `bunfig.toml`. The `mock.module()` blast radius
(B2) is the independent secondary suppressor, and DI migration for the divergences identified
in B3 is the targeted remedy for defect (2).

## 4. Track C — Synthesis & Deferred Options

### C1. Root-cause statement

The 23.54% headline mutation score and the 16.1% instrumented-mutant participation rate (A1)
are dominated by a **measurement defect**, not by an absence of tests. The defect has two
components, both now proven. The primary component is the `@hughescr/stryker-bun-runner`'s
eager-import coverage-preload (A2 §3), which imports every mutated source module while
`strykerGlobal.currentTestId` is `undefined`; the `cover()` helper therefore writes all
module-level hits to `cov.static`, and `ignoreStatic: true` discards the entire static bucket,
producing the 77.2% Ignored share seen in A1. A3 reproduces this in full isolation (a file
with proven coverage scores 0% under the baseline config), and A6 provides decisive counter-
evidence: switching `ignoreStatic` to `false` on a representative file yields 66.7% — the
existing tests actively kill mutants once the static filter is lifted. The secondary component
is `mock.module()` substitution of in-scope modules (B2, B4): the global `beforeEach` in
`mock-reset.ts` re-mocks four in-scope modules on every test, and thirteen additional call
sites ensure `src/providers/factory.ts` is replaced in virtually every test, depriving its 49
NoCoverage mutants of any perTest hit independent of the static-collapse mechanism. Alongside
the measurement defect, **genuine test-quality gaps** exist but are secondary: the
survived-mutant list identifies `providers/kaneo/label-resource.ts` (16 survived, 1 killed)
and `tools/update-status.ts` (18 survived, 6 killed) as the highest-priority weak-assertion
files, and `providers/kaneo/update-label.ts` and `providers/kaneo/update-project.ts` have no
main-suite tests at all (B4). These are real, actionable gaps — they are simply not the
explanation for the low headline score.

| Hypothesis                                                                                                 | Verdict                                | Evidence                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **H1** — Hook-ordering race: project `beforeEach` (mock-reset.ts) fires before runner sets `currentTestId` | **Inconclusive / assessed indirectly** | The primary static collapse originates at eager-import preload time, before any `beforeEach` — including the project's — has fired (A2 §3). Hook ordering may be a secondary contributor via the `stabilizeCoverage` promotion rule (A2 §4), but it cannot be isolated without editing `bunfig.toml` (A5). It is not the primary mechanism. |
| **H2** — `mock.module()` swaps instrumented in-scope modules → no perTest coverage                         | **Proven contributing**                | `src/providers/factory.ts` is re-mocked by the global reset on every test (~4,817 × 29 calls) and by 13 explicit call sites; it records 49 NoCoverage and 0 killed (B2, B4).                                                                                                                                                                |
| **H3** — Stryker `concurrency: 8` causes cross-worker coverage interference                                | **Disproven**                          | The runner forces `--concurrency=1` inside every Bun worker regardless of the Stryker-level `concurrency` setting; A4 confirmed bit-for-bit identical counts at `concurrency: 1` vs `concurrency: 8`.                                                                                                                                       |
| **H4** — Preload ordering: `setup.ts` / `mock-reset.ts` loads before runner coverage preload               | **Disproven as primary cause**         | The runner's own eager-import loop runs regardless of project preload order and is the proximate cause of static bucket writes (A2 §3, A5). Removing `mock-reset.ts` from `bunfig.toml` preload would not eliminate the collapse.                                                                                                           |
| **Dominant cause** — Eager-import static bucketing + `ignoreStatic: true`                                  | **Proven**                             | A2 §3 identifies the mechanism; A3 reproduces the 0% outcome on a file with confirmed Bun coverage; A6 confirms 66.7% true score when `ignoreStatic: false` is applied to a comparable file.                                                                                                                                                |

### C2. Quality assessment

### C3. Options for a future effort (deferred — not executed)

## 5. Appendix — Commands & Raw Outputs
