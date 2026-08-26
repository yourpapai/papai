# Tasks — git-fixture-template

## 1. Helper (TDD)

- [ ] 1.1 Write failing `tests/review-loop/git-fixture.test.ts` pinning the helper contract: requesting a fixture returns a repo whose `git log` has the template commit and whose commits succeed with no per-test identity setup; two fixtures are fully isolated (mutating one leaves the other's HEAD/branches/tree unchanged); construction spawns no git process (assert via an injected spawn probe or by patching `execFile` through a DI seam in the helper); `git config gc.auto` reads 0; a `git worktree add` on a copy succeeds and behaves as from a built repo. SPDX header. Verify: `bun test tests/review-loop/git-fixture.test.ts` red on the missing module.
- [ ] 1.2 Implement `tests/review-loop/git-fixture.ts` (lazy per-worker template: init + identity + one commit + `gc.auto=0`; `fs.cpSync(recursive)` per request; DI seam for the git-call layer so tests can assert the no-spawn construction). Verify: the helper test green; `bun run typecheck`/`lint` clean.

## 2. Pilot conversion + evidence

- [ ] 2.1 Record the pilot's before numbers from the persisted junit report (`worker-pool.test.ts`: in-test seconds, 11 cases) in this file. Convert `setupPrimary` in `tests/review-loop/worker-pool.test.ts` to the helper (keep `createWorktree` real and unchanged; assertions untouched). Verify: `bun test tests/review-loop/worker-pool.test.ts` green standalone.
- [ ] 2.2 Full `bun run test` on a quiet host; record the pilot's after numbers (in-test seconds, 11 cases — case count must be identical) plus suite in-test total before/after in this file. Verify: recorded delta matches the survey's extrapolation band for the pilot file (~40–50 % of its git share) within run noise.
- [ ] 2.3 `bun check` green; SPDX on the two new files. Verify: `rg --files-without-match "SPDX-License-Identifier" tests/review-loop/git-fixture.ts tests/review-loop/git-fixture.test.ts` prints nothing; `bun check` exits 0.
