# Tasks — git-fixture-template

## 1. Helper (TDD)

- [x] 1.1 Write failing `tests/review-loop/git-fixture.test.ts` pinning the helper contract: requesting a fixture returns a repo whose `git log` has the template commit and whose commits succeed with no per-test identity setup; two fixtures are fully isolated (mutating one leaves the other's HEAD/branches/tree unchanged); construction spawns no git process (assert via an injected spawn probe or by patching `execFile` through a DI seam in the helper); `git config gc.auto` reads 0; a `git worktree add` on a copy succeeds and behaves as from a built repo. SPDX header. Verify: `bun test tests/review-loop/git-fixture.test.ts` red on the missing module.
- [x] 1.2 Implement `tests/review-loop/git-fixture.ts` (lazy per-worker template: init + identity + one commit + `gc.auto=0`; `fs.cpSync(recursive)` per request; DI seam for the git-call layer so tests can assert the no-spawn construction). Verify: the helper test green; `bun run typecheck`/`lint` clean.

## 2. Pilot conversion + evidence

- [x] 2.1 Record the pilot's before numbers from the persisted junit report (`worker-pool.test.ts`: in-test seconds, 11 cases) in this file. Convert `setupPrimary` in `tests/review-loop/worker-pool.test.ts` to the helper (keep `createWorktree` real and unchanged; assertions untouched). Verify: `bun test tests/review-loop/worker-pool.test.ts` green standalone.
- [x] 2.2 Full `bun run test` on a quiet host; record the pilot's after numbers (in-test seconds, 11 cases — case count must be identical) plus suite in-test total before/after in this file. Verify: recorded delta matches the survey's extrapolation band for the pilot file (~40–50 % of its git share) within run noise.
- [x] 2.3 `bun check` green; SPDX on the two new files. Verify: `rg --files-without-match "SPDX-License-Identifier" tests/review-loop/git-fixture.ts tests/review-loop/git-fixture.test.ts` prints nothing; `bun check` exits 0.

## Pilot evidence (`worker-pool.test.ts`)

- **Before** — persisted junit (`reports/test/last-run.junit.xml`, run 2026-08-26T17:59:05Z, parallel, git `73e515687`): **17.741 s in-test, 11 cases**, 0 fail. (The survey's 42 s figure was that same file under a *loaded* parallel run; per design D5 the recorded before is the fresh persisted-report number.)
- **After** — full `bun run test` 2026-08-27 (same host, parallel, 106 s wall): **11.775 s in-test, 11 cases** (identical count), 0 fail. **Delta −5.97 s = −33.6 %** of the file's in-test time.
- **Band check** — survey extrapolation for the pilot: git share ≈ 69 % of the file's wall × 40–50 % fixture-init share ⇒ expected ≈ −27.6 %…−34.5 %. Measured −33.6 % — inside the band.
- **Suite in-test total** — before 1 387.2 s (1 537 files) → after 1 212.4 s (1 538 files; +1 = the helper's own test file, +2.23 s). Both runs used the same discovery scope (`docs/**` already excluded in the before run). The −175 s suite delta is contention-noise-dominated (parallel runs on a shared host); the pilot file's like-for-like −6 s above is the evidence-grade number.
- **Run hygiene** — 3 failures in the after run: `tests/git-init-hint.test.ts` and `tests/plugins/context.test.ts` (both pre-existing in the before run) and `tests/sdd-runner/gate-resume-tail.test.ts` (ENOENT on a temp state.json; re-ran file-by-file — green standalone, load flake, not a regression).

