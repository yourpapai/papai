# Tasks — test-consolidation-speed-evidence

This file is also the change's evidence ledger (design D4): the per-class benchmark table (median ±
IQR), the projection's bounds and heuristic midpoint, and the go/no-go reading are recorded here when
the producing runs complete. `reports/` is gitignored — numbers are copied in at run time.

## 1. Harness core (design D1/D3, TDD)

- [x] 1.1 Write failing `tests/scripts/test-audit/benchmark.test.ts` pinning the generator contract: paired spread/grouped arms per hook class differ **only** in case structure (same N inputs, same assertions, same imports); arms carry the class's hook (none / cheap `beforeEach` / `setupTestDb` / mock-heavy); generated paths sit under `reports/test-audit/bench/` and outside `bun test` discovery and the audit scan set; a `heuristicVersion`-style class manifest is emitted. SPDX header. Verify: `bun test tests/scripts/test-audit/benchmark.test.ts` fails on the missing module (red).
- [x] 1.2 Write failing tests for the JUnit parser: derives per-arm in-test totals and per-case counts from fixture JUnit text; median ± IQR over repeats; per-case marginal cost = (spread − grouped) / N. Verify: same file still red for the parser module.
- [x] 1.3 Implement the pure core in `scripts/test-audit/benchmark.ts` (generator, parser, analysis) with the spawn step behind a `RunDeps` seam — no world-touching outside it. Verify: `bun test tests/scripts/test-audit/benchmark.test.ts` green.

## 2. CLIs and projection (design D1/D2)

- [x] 2.1 Implement the benchmark CLI wiring (real fs, `Bun.spawn` running `bun test --reporter-outfile` serially per arm, repeats flag) and add `"test:benchmark"` to `package.json`. Verify: `bun run test:benchmark` exits 0, writes `reports/test-audit/benchmark.json` (per-class median ± IQR, bun version, repeats, class fixture sources), modifies no test file / runner config / gate, and a full-suite case count is unchanged.
- [x] 2.2 Write failing tests for the projection: joins persisted benchmark + audit artifacts into per-class candidate counts (hook-signature detection over the audit scan set), upper bound (all single-or-zero-assert cases in hook files) and lower bound (0) plus the stated midpoint heuristic (tests-consolidation D4 static eligibility rule), savings seconds vs serial in-test time, and "requires per-file eligibility review" lines for un-assessable populations. Verify: red before implementation.
- [x] 2.3 Implement `scripts/test-audit/project.ts` (reads `benchmark.json` + `fragmentation.json`, prints + writes the projection). Verify: `bun run test:benchmark -- --project` (or the wired equivalent) reproduces the projection from the persisted artifacts.

## 3. Evidence and wrap-up (design D4 / Migration steps 3–4)

- [x] 3.1 Run the benchmark on a quiet host (shared-host rules; record load shape) and record into this file: the per-class table (median ± IQR per-case marginal cost), calibrated against the `auth.test.ts` 5–11 ms/test anchor, plus the explicit pilot-pair statement (pure class ≈ 0 from the pilot; the grouped mechanism itself is free). Verify: re-running `bun run test:benchmark` reproduces the recorded medians within their IQRs.
- [x] 3.2 Run the projection and record: per-class candidates, bounds, heuristic midpoint, projected seconds vs serial in-test time, and the named review-required populations. Verify: recomputation from the persisted `benchmark.json` + `fragmentation.json` matches every recorded row.
- [x] 3.3 Record the go/no-go reading for speed-driven rollout in this file (valid either way; if every hook class measures < ~1 ms/case, the reading is "not worth rolling out for speed"). Verify: the reading cites the recorded numbers, not assumptions.
- [x] 3.4 SPDX headers on all new files; `bun check:full` green (or failures read from `reports/checks/` and dispositioned — load-class flakes re-run file-by-file per the shared-host rule). Verify: `rg --files-without-match "SPDX-License-Identifier" scripts/test-audit/benchmark.ts scripts/test-audit/project.ts tests/scripts/test-audit/benchmark.test.ts` prints nothing; `bun check` exits 0.

## 3.e Evidence ledger (recorded 2026-08-25, this tree at ad52d8245)

### Benchmark (task 3.1)

`bun run test:benchmark` — bun 1.3.13, 5 repeats, 100 inputs/arm, 12-core host,
load 3.86/6.86/9.68 (1/5/15-min) at run start, captured in a quiet window after
waiting out a load-8–12 spike from other agents on the shared host. Persisted at
`reports/test-audit/benchmark.json` (class manifest v1).

| hook class        | median ms/case | IQR   | fixture source                                              | spread → grouped in-test (per repeat) |
| ----------------- | -------------- | ----- | ----------------------------------------------------------- | ------------------------------------- |
| none              | 0.259          | 0.015 | none                                                        | ~26–31 ms → ~2–5 ms                   |
| cheap-before-each | 0.253          | 0.022 | synthetic (8-object fixture build per case)                 | ~27–32 ms → ~4–5 ms                   |
| setup-test-db     | 0.555          | 0.058 | real: `setupTestDb` (frozen helper, snapshot path)          | ~108–116 ms → ~52–57 ms               |
| mock-heavy        | 2.020          | 0.248 | real: `mockLogger`+`setupTestDb`+`seedCommonTestPlatformInstances` (auth.test.ts beforeEach shape) | ~285–314 ms → ~88–94 ms |

Reproducibility: an earlier full run at load 8.42/12 (mechanics verification) measured
0.259 / 0.261 / 0.572 / 1.968 ms/case medians — every class reproduces the recorded
median within its IQR (Δ 0.000 / 0.008 / 0.017 / 0.052 vs IQR 0.015 / 0.022 / 0.058 / 0.248).

Calibration vs the `auth.test.ts` anchor (5–11 ms/test in-test, measured on a 4-vCPU
CI-class container in `lighter-unit-tests-under-load`): the mock-heavy class — auth's
exact beforeEach shape — pays ~2.9 ms/test in the spread arm on this 12-core quiet host
(~285–314 ms / 100 cases), consistent with the anchor's lower end scaled for the faster
host. The per-case **marginal** (what one grouped row saves: 2.020 ms/case) is the part
of that per-test cost consolidation removes; the rest (~0.9 ms/case, the grouped arm's
~90 ms / 100 rows) is fixture work a real grouped case still pays once per group, not per row.

Pilot pair (change `tests-consolidation`, PR #356): the pilot's four pure-function files
went 226 → 8 runner cases with per-file wall flat (0.63–0.66 s before/after) — consistent
with this benchmark's `none` class at 0.259 ms/case (218 removed cases ≈ 57 ms per file,
invisible at file granularity). The grouped mechanism itself is free: every class's
grouped arm executes the same 100 assertions in one case at a fraction of the spread
arm's in-test time, and no class measures a negative marginal — grouping never costs more.

### Projection (task 3.2)

`bun run test:benchmark -- --project` from the persisted `benchmark.json` (table above),
`fragmentation.json` (heuristic v2: 1507 files, 15 784 cases, 47.4% single-or-zero-assert),
serial in-test total **139.6 s** (sum of `<testcase>` durations, `reports/test/last-run.junit.xml`
from a green serial full run: 16 301 tests / 1 553 files, 0 fail). Two consecutive runs
produce byte-identical `reports/test-audit/projection.json` — recomputation from the
persisted artifacts matches every row below.

| class            | candidates (files) | upper = single-or-zero | midpoint (static-clean) | savings upper | savings midpoint |
| ---------------- | ------------------ | ---------------------- | ----------------------- | ------------- | ---------------- |
| none             | 7 886 (770)        | 4 128                  | 3 639                   | 1.069 s       | 0.943 s          |
| cheap-before-each | 2 823 (235)       | 1 280                  | 294                     | 0.324 s       | 0.075 s          |
| setup-test-db    | 616 (107)          | 167                    | 146                     | 0.093 s       | 0.081 s          |
| mock-heavy       | 4 459 (395)        | 1 910                  | 0                       | 3.858 s       | 0.000 s          |
| **total**        | 15 784 (1 507)     | 7 485                  | 4 079                   | **5.344 s = 3.83 %** | **1.098 s = 0.79 %** |

Review-required populations (named, not folded into savings): `mock-heavy` 1 910 cases
in 395 files (every mock-bearing file fails the D4 static rule by construction);
`cheap-before-each` 986 cases in 160 files; `none` 489 cases in 49 files;
`setup-test-db` 21 cases in 4 files. Eligibility assumptions print with the projection
(heaviest-first classification; upper = all single-or-zero-assert cases; lower = 0;
midpoint = tests-consolidation D4 static rule; serial denominator only).

### Go/no-go reading (task 3.3)

**Not worth rolling out for speed.** The recorded numbers, not assumptions: the only
class above the ~1 ms/case design threshold is `mock-heavy` (2.020 ms/case), and its
entire statically-assessable population is review-required (midpoint 0.0 s) — even its
no-screening upper bound is 3.858 s. The statically-clearable midpoint across all classes
is **1.098 s = 0.79 %** of the 139.6 s serial in-test total, and the absolute ceiling
(every single-or-zero-assert case in every class, no eligibility judgment at all) is
**5.344 s = 3.83 %**. `setup-test-db` (0.555 ms/case) sits below the threshold, and the
`none`/`cheap` classes measure at the runner floor (0.259/0.253 ms/case), matching the
pilot's flat wall time. A ceiling under 6 s against a ~2.5-min serial suite fails any
speed-driven cost/benefit; consolidation in this repo, if pursued at all, rests on
non-speed grounds (readability, case-count noise), with rollout staying per-file
evidence-gated per the `test-case-consolidation` spec.
