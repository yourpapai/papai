## Why

C4 left afk-runner deciding but never finishing: a converged run parks `awaiting-tail` before `stage_enter(decompose)` (the loop only enters successors that declare work), the final gate has no presentation work module (C4's recorded non-goal), finals park as `awaiting-tail` with the memo forever `running`, and there is no report. C5 lands the tail — decompose, atomicity, finals, report — making a run completable end-to-end and "parity complete": the derived `state.json` memo reaches full field parity with sdd-runner's, proven against the surviving originals.

## What Changes

- **Tail work modules**: decompose (decomposer agent writes tasks.md, 2-attempt `validateStrict` retry) and atomicity (depth-gated — S skips the bracket entirely, corpus-faithful). Tail re-runs after extend/veto-at-final are legacy-faithful (`extend-round.ts:84` re-runs the tail unconditionally).
- **Final-gate presentation as the last act of the tail's work module** (review's early-gate precedent): render gate file **first**, then append `stage_enter(gate)` → `presented` → ladder; the bracket's trailing exit lands from `gate.awaiting`. No loop edits.
- **Outcome-dependent settle ordering at final gates** (probe-proven misfire guard): approve = `exit(gate)` → `answered` (the completed edge fires); extend/veto = `answered` → `exit(gate)` → mover (uniform exit-first wrongly completes the run — legacy is immune only because no final-gate extend exists in the corpus); abort = `answered`.
- **Kernel graph completions** (all new-logs-only, parity-safe, guard-equivalence-proven over all 15 fixtures): `decompose → gate` edge (S runs), `allStagesDone` reshaped to `gate done && no active stages` (S completion is graph-impossible today — the map is pre-initialized all-pending in both folds), self-loops on decompose/atomicity **and intake** (mid-stage crash-resume empirically throws a boundary refusal today).
- **Crash-window recovery**: owed-presentation resume (awaiting + map-gate-active + record null/stale → append the owed `presented` at the file-scan version + re-run ladder) and owed-mover detection gated on map signals (kills the phantom `round_open` misfire). Without them: infinite 1s waiter loop / phantom extended round (both probe-proven).
- **Finals**: `snapshot.status === 'done'` parks `final` (new vocabulary); memo writes terminal statuses (releases session ids); resume-of-completed prints a report pointer. `awaiting-tail` retires as unreachable.
- **Report**: `report.ts` port (facts + gains/commits) as a passive `afk-runner report <runId>` command.
- **Parity complete**: five synthetic fixtures (pre-validated — legacy-fold identical, one red-until-edge TDD seed) + memo-parity oracle against surviving original `state.json`s (gate-null-at-terminal, last-stage-not-position, updatedAt-tolerance encoded).

## Capabilities

### New Capabilities

- `afk-runner-tail`: tail-of-pipeline lifecycle — decompose/atomicity work, final-gate presentation, outcome-ordered settlement, crash-window recovery, finals/memo/report. Sibling of `afk-runner-kernel`/`afk-runner-think-half`/`afk-runner-gate` (complete-but-unarchived). Without it: no run can reach `completed`, terminal runs memo as `running` and block their session ids forever, and depth-S runs are completable by neither system's guard.

### Modified Capabilities

- None in `openspec/specs/` — afk capabilities are not yet archived; kernel/gate requirements hold and are exercised, not weakened.

## Impact

- Code: `afk-runner/src/**` (three graph edits + guard, tail work modules, seam extend branch, resume recovery, finals vocabulary, memo projection, report + CLI), `tests/afk-runner/**` (five fixtures, memo oracle, crash-window drills). No `sdd-runner/` changes — copies only.
- Docs: `docs/architecture/afk-runner.md` (C5 row, layout, park vocabulary).
- No platform/task-instance or config-context surface; repo-local run dirs (compliance inherited).

## Non-goals

- Failure-event vocabulary / `StageHaltError` handling beyond propagating as today (`failed` memo status, retry budgets) — C6.
- PR creation or push: the report's PR-body mode prints text only; any `gh` integration is C7's call.
- `plan`-mode gates and child-actor execution — U2; memo projects the dormant fields, no producer.
- TUI rendering (U8), gate reopen, snapshot memo (U7).
- Fixing sdd-runner's intake self-loop gap — sdd-runner stays frozen; the intake fix lands in afk's graph only.
