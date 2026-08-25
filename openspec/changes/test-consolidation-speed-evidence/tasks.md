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

- [ ] 3.1 Run the benchmark on a quiet host (shared-host rules; record load shape) and record into this file: the per-class table (median ± IQR per-case marginal cost), calibrated against the `auth.test.ts` 5–11 ms/test anchor, plus the explicit pilot-pair statement (pure class ≈ 0 from the pilot; the grouped mechanism itself is free). Verify: re-running `bun run test:benchmark` reproduces the recorded medians within their IQRs.
- [ ] 3.2 Run the projection and record: per-class candidates, bounds, heuristic midpoint, projected seconds vs serial in-test time, and the named review-required populations. Verify: recomputation from the persisted `benchmark.json` + `fragmentation.json` matches every recorded row.
- [ ] 3.3 Record the go/no-go reading for speed-driven rollout in this file (valid either way; if every hook class measures < ~1 ms/case, the reading is "not worth rolling out for speed"). Verify: the reading cites the recorded numbers, not assumptions.
- [ ] 3.4 SPDX headers on all new files; `bun check:full` green (or failures read from `reports/checks/` and dispositioned — load-class flakes re-run file-by-file per the shared-host rule). Verify: `rg --files-without-match "SPDX-License-Identifier" scripts/test-audit/benchmark.ts scripts/test-audit/project.ts tests/scripts/test-audit/benchmark.test.ts` prints nothing; `bun check` exits 0.
