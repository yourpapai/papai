# test-consolidation-speed-evidence

## Why

The `tests-consolidation` pilot proved consolidation is possible without losing assertions (226 runner cases → 8, every assertion verbatim, all gates green), but its wall-time result was flat — expected, since all four pilot files were pure-function suites whose marginal runner cost is ~0.16 ms/case. The open decision question — "does consolidation make the suite run faster, and by how much?" — therefore remains unanswered: the hypothesis's predicted payoff lives in hook-heavy suites (`setupTestDb`, mocks; measured 5–11 ms/test on `tests/auth.test.ts`), which the pilot deliberately excluded. No current instrument can answer it: the audit counts cases but not per-case time, and `test:slowest` reports per-file in-test totals without attributing them to case structure.

## What Changes

- A paired benchmark harness (`scripts/test-audit/benchmark.ts` + `bun run test:benchmark`): generates matched N-per-value-case vs 1-grouped-`assertEach` synthetic files across hook classes (no hooks, cheap `beforeEach`, `setupTestDb`, mock-heavy), runs them through the real runner, and reports median ± IQR per-case marginal cost by hook class, persisted to `reports/test-audit/benchmark.json`.
- A population projection (`scripts/test-audit/project.ts` or a benchmark flag): joins the benchmark's per-case cost with the audit's population counts (hook-bearing files × case counts × single-assert share) to produce the decision number — "consolidating all eligible hook-heavy cases saves ≈ X s = Y% of CI serial time", with the eligible fraction derived from conservative heuristics (same-fixture grouping rules) rather than assumed.
- Evidence recorded in the change's artifacts, cited by any future rollout change; no real test suite is rewritten, no gate or threshold is touched.
- The `tests-consolidation` speed findings (pilot wall-time flat; per-class costs from this benchmark) become the cited pair for the "worth rolling out?" decision the pilot deferred.

## Capabilities

### New Capabilities

- `test-consolidation-speed-evidence`: governs the benchmark that measures consolidation's runtime effect — what the benchmark SHALL measure (paired per-case marginal cost by hook class, on the real runner), how it SHALL avoid bias (identical assertions in both arms, repeats with median ± IQR, no gate or suite modification), and what the projection SHALL report (population-joined savings estimate with its eligibility assumptions stated).

### Modified Capabilities

- None. `test-case-consolidation` (change `tests-consolidation`, not yet archived) is untouched: its rollout gate already requires per-file audit evidence for follow-on rewrites, and this change produces evidence only — it rewrites no file the rollout gate covers.

## Impact

- Code: new `scripts/test-audit/benchmark.ts` (+ `project.ts` or a projection mode in the benchmark CLI), a `"test:benchmark"` script in `package.json`, new tests under `tests/scripts/test-audit/` for the harness's generator and analysis functions (DI over the same injected-fs interface as the audit). Generated benchmark files live under an ignored temp/reports tree and never join `bun test` discovery.
- No runtime/product code; no test-suite rewrites; no frozen-file edits; coverage/mutation gates untouched (a scripts-only + package.json diff selects no changed-file mutation target).
- Known coupling: adding a `package.json` script edits a file that `score-fingerprint.ts` hashes whole, one-time invalidating carried-over mutation score caches on other branches (same budgeted consequence as `tests-consolidation`'s `test:audit`).

## Non-goals

- No consolidation of any real suite — rollout stays evidence-gated per the `test-case-consolidation` spec; this change produces the evidence, not the rollout.
- No wall-time target or savings claim baked in — the benchmark's outcome is whatever it measures, including "hook amortization is smaller than the 5–11 ms upper bound suggested".
- No CI wiring for the benchmark (deferrable, mirroring `test:audit`'s open question); no changes to the test runner, wrapper, or report pipeline (`lighter-unit-tests-under-load` owns those).
