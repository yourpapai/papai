<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Tasks: Incremental mutation measurement with a whole-branch gate

## 1. Score arithmetic

- [ ] 1.1 Write failing cases in `tests/scripts/mutation/score-merger.test.ts` for
      `combineMergedScores` — empty input is all zeros with `score: 0` (not `NaN`); two files
      with **different** mutant counts pool their counts and recompute
      `(killed + timeout) / scored`, so an averaging implementation fails — then implement
      `combineMergedScores` in `scripts/mutation/score-merger.ts`.
      Verify: `bun test tests/scripts/mutation/score-merger.test.ts`
- [ ] 1.2 Write failing cases for `isMergedScore` (accepts a real score; rejects missing fields,
      `NaN`, `Infinity`), then implement it in the same module — it guards cache
      deserialization.
      Verify: `bun test tests/scripts/mutation/score-merger.test.ts`

## 2. Fingerprint

- [ ] 2.1 Write failing `tests/scripts/mutation/score-fingerprint.test.ts` covering: identical
      output across two independently-constructed dep sets (no dependence on mtime or absolute
      paths); changes on source-content edit, on any candidate test's content, on a *new* test
      importing the source, on `overrides.json` / `stryker.config.json` / `bun.lock` / any
      `scripts/mutation/*.ts`, and on a `SCORE_FINGERPRINT_VERSION` bump; unchanged when an
      unrelated test is edited; an absent candidate hashes deterministically rather than
      throwing; an override target outside the candidate universe participates.
      Verify: `bun test tests/scripts/mutation/score-fingerprint.test.ts` (fails)
- [ ] 2.2 Implement `scripts/mutation/score-fingerprint.ts` — `SCORE_FINGERPRINT_VERSION`,
      `computeToolchainFingerprint`, `computeSourceFingerprint`, `createDefaultFingerprintDeps` —
      reusing `listCandidateTests` / `createCandidateContext` (`scripts/mutation/coverage-map.ts:96,162`)
      and `findTestFile`, with one caller-owned content cache so each test file is read once.
      Add the comment explaining why `scripts/test/fingerprint.ts` is deliberately not reused.
      Verify: `bun test tests/scripts/mutation/score-fingerprint.test.ts`

## 3. Score cache

- [ ] 3.1 Write failing `tests/scripts/mutation/score-cache.test.ts`: round-trip through
      set/flush/reopen; `get` misses on fingerprint mismatch; malformed JSON reads as empty
      without throwing; an entry with a non-numeric `merged.score` misses without poisoning its
      siblings; an entry missing `fingerprint` misses; write failures are swallowed; pruning
      drops entries past the retention window and keeps the rest; `flush` no-ops when nothing
      was set.
      Verify: `bun test tests/scripts/mutation/score-cache.test.ts` (fails)
- [ ] 3.2 Implement `scripts/mutation/score-cache.ts` (`SCORE_CACHE_FILE`, `SCORE_CACHE_VERSION`,
      `ScoreCacheEntry`, `openScoreCache`) mirroring the fail-open, batched-write posture of
      `scripts/mutation/coverage-cache.ts:32`, with the fingerprint check inside `get` so no
      call site can skip it.
      Verify: `bun test tests/scripts/mutation/score-cache.test.ts`

## 4. Gate extraction (unblocks the line budget)

- [ ] 4.1 Move `resolveErroredGate` and `reportGates` out of `scripts/mutation/changed-files.ts`
      into a new `scripts/mutation/gates.ts`, converting the latter into a pure
      `resolveChangedFilesGates(...) -> { exitCode, message }` with `console.error` hoisted to
      `main`; add `tests/scripts/mutation/gates.test.ts` and update the import in
      `tests/scripts/mutation/changed-files.test.ts:17`. Behavior must be unchanged.
      Verify: `bun test tests/scripts/mutation/ && bun run lint`
- [ ] 4.2 Add a case to `tests/scripts/mutation/baseline.test.ts` pinning that `resolveRatchet`
      accepts a bare `PerFileScore` (no `configPath` / `reportPath`), then widen the gate input
      type to `GateInput`.
      Verify: `bun test tests/scripts/mutation/baseline.test.ts && bun run typecheck`

## 5. Incremental split and combine

- [ ] 5.1 Write failing `tests/scripts/mutation/incremental-run.test.ts` for
      `planIncrementalRun` (all-miss / all-hit / mixed), `combineIncrementalResult` (unions
      `perFile`; produces a **pooled** merged score from two files of different mutant counts;
      zero-fresh-plus-one-reused equals the reused merged; a reused `scored === 0` lands in
      `perFile` without moving the aggregate) and `formatIncrementalPlan` (emits score and
      measurement time per reused file, and a miss reason per measured file).
      Verify: `bun test tests/scripts/mutation/incremental-run.test.ts` (fails)
- [ ] 5.2 Implement `scripts/mutation/incremental-run.ts` — `IncrementalPlan`, `GateInput`,
      `planIncrementalRun`, `combineIncrementalResult`, `formatIncrementalPlan`,
      `createIncrementalDeps` (opens the cache once, computes the toolchain fingerprint once,
      builds one candidate context).
      Verify: `bun test tests/scripts/mutation/incremental-run.test.ts`

## 6. Wire the runner

- [ ] 6.1 Write the failing **headline** case in `tests/scripts/mutation/changed-files.test.ts`:
      baseline `{X: 0.9, Y: 0.9}`, targets `[X, Y]`, plan reuses `X@0.5` and measures `Y@0.95`.
      Assert `runPaired` is called with `sourceFiles: ['Y']` exactly, the returned `perFile`
      contains **both**, and the gate exits 1 naming `X`. Add the inverse (reused `X@0.95` ≥ 0.9
      → exit 0), the empty-`toMeasure` case (`pairedRun` not called at all, reused regression
      still fails), the raised-baseline case (reused `X@0.85` vs a floor raised to 0.90 → exit
      1), an errored file not being recorded, a reused unbaselined file still printing its
      first-touch line, and `incremental: undefined` reproducing today's behavior.
      Verify: `bun test tests/scripts/mutation/changed-files.test.ts` (fails)
- [ ] 6.2 Wire `changedFilesRun` (`scripts/mutation/changed-files.ts:144`): add
      `incremental: IncrementalDeps | undefined` to its input, partition targets, log the plan,
      skip `pairedRun` entirely when nothing needs measuring, record fresh scores **before**
      gating, iterate the union for the first-touch notice, and return `GateInput`. Write the
      cache file unconditionally, including the zero-target early return at `:147-150`.
      Verify: `bun test tests/scripts/mutation/changed-files.test.ts`
- [ ] 6.3 Add `--no-score-cache` to `parseChangedFilesCliArgs` (`:112-142`) and the usage string
      (`:263`); in `main`, construct reuse deps only when neither `--no-score-cache` nor
      `--update-baseline` is set. Add a test that `--update-baseline` never constructs reuse deps
      and that `writeScoresFile` receives fresh-only scores.
      Verify: `bun test tests/scripts/mutation/ && bun run lint && bun run typecheck`

## 7. CI

- [ ] 7.1 Add SHA-pinned `actions/cache/restore` before, and `actions/cache/save` (with
      `if: always()` and `continue-on-error: true`) after, the run step in the `mutation-testing`
      job (`.github/workflows/ci.yml:250-284`), carrying `reports/paired/score-cache.json` and
      `reports/paired/coverage-map.cache.json`. Key `mutation-scores-v1-<pr>-<sha>-<run_id>`,
      `restore-keys: mutation-scores-v1-<pr>-`. Comment why `if: always()` and
      `continue-on-error` are load-bearing, and update the `timeout-minutes: 90` comment to note
      that a cold cache is still the worst case. Leave `mutation-baseline` without a score cache.
      Verify: `bun run workflows:lint`

## 8. Docs and close-out

- [ ] 8.1 Add `docs/adr/0424-incremental-mutation-measurement-with-whole-branch-gate.md`,
      cross-referencing ADR-0342, naming the rejected "gate only the since-last-push diff"
      option, and recording the transitive-dependency hole and the frozen-timeout bias under
      Negative Consequences.
      Verify: `bun run format:check`
- [ ] 8.2 Update `scripts/mutation/README.md` (new "Incremental measurement" section: cache
      location, exact fingerprint inputs, `--no-score-cache`, how to read the measured/reused
      log, and the two ways to force a full re-measure), the `README.md` Mutation Testing
      section, `CLAUDE.md`, and `tests/CLAUDE.md`.
      Verify: `bun run format:check`
- [ ] 8.3 Manual end-to-end on a scratch branch: run `bun test:mutate:changed
      --base=origin/master` twice — the second run must reuse everything and finish in seconds;
      then touch one source file and confirm only it is measured. Then weaken a test so a file
      drops below its baseline, run the gate (fails), edit an unrelated file, and confirm the
      next run measures only the unrelated file and still fails naming the regressed one.
      Verify: the two run logs, showing the measured/reused split and the inherited failure
- [ ] 8.4 Full check-out: `bun test`, `bun run typecheck`, `bun run lint`,
      `bun run workflows:lint`.
      Verify: all green
