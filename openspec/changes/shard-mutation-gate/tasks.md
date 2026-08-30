# Tasks — Shard the mutation PR gate

Ordered test-first: each implementation task is preceded by the failing test that pins it. Sections
1–4 are script-side and observable through their own tests; section 5 changes CI topology only after
that. See design.md — Migration Plan.

## 1. Cost estimation and division (pure)

- [x] 1.1 Write failing tests for per-file weight estimation — a line-count-derived weight, a
      documented default when the source cannot be read, and a floor so no weight is zero or
      negative; verify with `bun test tests/scripts/mutation/shard-weights.test.ts`
- [x] 1.2 Implement the weight estimator in `scripts/mutation/shard-weights.ts`; verify with
      `bun test tests/scripts/mutation/shard-weights.test.ts`
- [x] 1.3 Write failing tests for shard-count sizing covering every bound in the
      `mutation-shard-planning` spec: work-proportional count, the `max(B, maxWeight)` term, the cap,
      never more shards than targets, the single-shard threshold, and the empty measurement set;
      verify with `bun test tests/scripts/mutation/shard-sizing.test.ts`
- [x] 1.4 Implement sizing as a pure function of (weights, budget, cap, threshold); verify with
      `bun test tests/scripts/mutation/shard-sizing.test.ts`
- [x] 1.5 Write failing tests for cost-weighted assignment — LPT balance when costs differ by an
      order of magnitude, every target assigned exactly once, no empty shard, deterministic output
      for a given input; verify with `bun test tests/scripts/mutation/shard-assign.test.ts`
- [x] 1.6 Implement the assignment function; verify with
      `bun test tests/scripts/mutation/shard-assign.test.ts`
- [x] 1.7 Write and satisfy a test pinning the spec's verdict-independence property: the same target
      set assigned across 1 and across k shards yields the same union of targets and the same gate
      input; verify with `bun test tests/scripts/mutation/shard-assign.test.ts`

## 2. Plan command

- [x] 2.1 Write failing tests for the plan manifest shape — planned targets, reused entries, per-shard
      assignments, and the budget inputs used — including the nothing-to-measure case; verify with
      `bun test tests/scripts/mutation/shard-plan-command.test.ts`
- [x] 2.2 Implement a plan-only mode over the existing target selection and reuse split, emitting the
      manifest without invoking Stryker; verify with
      `bun test tests/scripts/mutation/shard-plan-command.test.ts`
- [x] 2.3 Write failing tests that the plan serializes the coverage map for shard consumption and
      that a shard injecting it performs no coverage spawning; verify with
      `bun test tests/scripts/mutation/shard-coverage-handoff.test.ts`
- [x] 2.4 Implement coverage-map publication and the shard-side reader over the existing
      `PairedRunDeps.buildMap` seam, including the spec's fallback when the shared map is
      unavailable; verify with `bun test tests/scripts/mutation/shard-coverage-handoff.test.ts`
- [x] 2.5 Add estimated-versus-actual logging per shard assignment (design.md — Risks, estimate
      drift); verify with `bun test tests/scripts/mutation/shard-plan-command.test.ts`

## 3. Shard measurement command

- [x] 3.1 Write failing tests that a shard measures only its assigned targets and emits `perFile`,
      `skipped` and `errored`, and that it exits 0 on a low score; verify with
      `bun test tests/scripts/mutation/shard-measure.test.ts`
- [x] 3.2 Implement the shard measurement entrypoint over `pairedRun`; verify with
      `bun test tests/scripts/mutation/shard-measure.test.ts`

## 4. Gate combination and reconciliation

- [x] 4.1 Write failing tests for the `mutation-gate` delta's reconciliation requirement — a lost
      shard fails naming its targets, a silently empty result set fails, and a complete set gates
      normally through the existing checks; verify with
      `bun test tests/scripts/mutation/shard-reconcile.test.ts`
- [x] 4.2 Implement reconciliation of the plan manifest against combined shard results, failing on
      any missing planned target; verify with
      `bun test tests/scripts/mutation/shard-reconcile.test.ts`
- [x] 4.3 Write failing tests for the persistence requirement — a failing verdict still records every
      shard's measurements, one failed shard leaves the others' scores recorded and its own targets
      re-measurable, and the measured-versus-reused report spans the whole run; verify with
      `bun test tests/scripts/mutation/shard-reconcile.test.ts`
- [x] 4.4 Implement the combine-and-gate command reusing `combineIncrementalResult` (its `fresh`
      input widened to the three fields it reads, so shard scores need no fabricated report paths)
      and `resolveChangedFilesGates` unmodified, recording before gating; verify with
      `bun test tests/scripts/mutation/shard-reconcile.test.ts`
- [x] 4.5 Verify `--no-score-cache`, `--update-baseline` and the single-shard path are behaviourally
      unchanged, including the baseline seed path; verify with
      `bun test tests/scripts/mutation/ tests/scripts/mutation/stryker-config.test.ts`

## 5. CI wiring

- [x] 5.1 Replace the `mutation-testing` job with plan → matrix → gate, moving the `if: always()`
      score-cache save to the gate job and keeping the gate job as the sole cache writer; verify with
      `bun workflows:lint`
- [x] 5.2 Confirm the `mutation-baseline` job is untouched and still runs single-process; verify with
      `bun workflows:lint` and by reading the job definition
- [x] 5.3 Validate end-to-end on a real branch: one run whose measurement set is below the threshold
      (expect exactly one shard) and one large enough to fan out (expect a sized matrix and a
      combined whole-branch verdict); verify by comparing the gate verdict and per-file scores
      against a `k = 1` run of the same commit

## 6. Documentation and full verification

- [ ] 6.1 Document the division rule, its constants, and the plan/shard/gate topology in
      `scripts/mutation/README.md`; verify by reading it back against the
      `mutation-shard-planning` spec
- [ ] 6.2 Update the mutation-testing paragraph in `CLAUDE.md` — Testing Notes and note the
      distributed-measurement contract in
      `docs/adr/0424-incremental-mutation-measurement-with-whole-branch-gate.md`; verify with
      `bun run format:check`
- [ ] 6.3 Run `bun test`, `bun run typecheck`, `bun run lint` and `bun workflows:lint`; confirm all
      pass and that no `docs/architecture/*.md` page describing CI topology is left stale
