## Why

The afk-runner pipeline proves the think-half end to end (two live cycles, 7 runs at C8) but stops at the final gate: it plans a `tasks.md` and parks `completed` with the work unimplemented — execution is hand-done beside the pipeline. The re-scored ledger's single `next` (U3) is exactly this: the first execution-half change needs `implement` / `verify` / `release` states on the graph so agents execute a task list, not just draft it.

## What Changes

- Three new graph states after the final gate — `implement`, `verify`, `release` — declared as work modules + outcome→successor data in the house shape; the drive loop is untouched.
- Execution is opt-in per run: `start --execute` appends one additive birth event (`execution armed`); a planning-only run behaves exactly as today (execution stages stay forever pending, final approval still completes).
- On an execution-armed run, final-gate approval appends a mover into `implement` instead of completing; `implement` walks `tasks.md` items sequentially (per-task implementer spawn under the repo's opencode TDD write hooks, per-task affected checks, per-task slice commits mechanizing "checkbox state lands in the same commit as the work"); `verify` runs the repo gate set at the boundary — a red suite is a normal outcome routing back into `implement` with the failure output as fix context, attempt-bounded fold-derivably (over-bound = declared `exhausted`, riding the C6 escalation gate unchanged); `release` presents a release gate on the C4/C5 stack — approve completes via the existing `allStagesDone` edge, veto re-enters `implement` with redirects, extend is rejected.
- New additive fact events (`execution`, `task`) folded into context; memo gains an optional `tasks` projection; pre-U3 logs and memos fold/parse unchanged.
- The implementer spawn seam re-widens the agent write guard in its own terms: repo tree writable, sibling change folders still violations; guard tests re-pinned.
- New spec home `afk-runner-execution` (satellite, the `afk-runner-tail` pattern).

## Capabilities

### New Capabilities

- `afk-runner-execution`: the execution-half contracts — state work, task walk, fix loop, widened write guard, release gate, execution resume/conformance. Without it the pipeline cannot execute anything: every run ends at a final gate with unimplemented tasks (the U3 gap the ledger names).

### Modified Capabilities

- `afk-runner-pipeline`: stage sequence extends past the final gate for execution-armed runs; `completed` additionally arrives via release approval; gate disclosures name execution consequences. Without the delta the sequence spec forbids the new completion path.
- `afk-runner-tail`: outcome-ordered settlement — execution-armed final approval appends the implement mover rather than completing on the answer; the tail's presentation choreography is reused by release. Existing coverage extended rather than duplicated.
- `afk-runner-kernel`: golden replay parity is restated over the legacy stage vocabulary (execution stages are kernel-only map entries); `StageId` widens additively.
- `afk-runner-cli`: `start` gains `--execute`; the command-doc flag pin covers it.
- `afk-runner-output`: memo gains the `tasks` projection; report renders execution facts.
- `afk-runner-runs`: status renders execution position and task progress.

## Impact

- Code: `afk-runner/src/` (graph states, work modules, event schemas, kernel map, settle seam, agent-layer guard, CLI, memo/report); tests under `tests/afk-runner/` (new execution fixtures, synthetic-marked; parity harness unchanged over historical logs).
- No platform/task instances, no DB, no scope-model state: run state stays workdir-scoped; the only new writes into the repo tree are the implementer's guarded edits and the runner's slice commits.
- Docs: `docs/architecture/afk-runner.md`, `docs/architecture/sdd-pipeline.md`.
- Declined (Non-goals): branch push / PR creation (R5 reversibility, no credentials — `report --pr` stays the passive surface); composite/child-run execution (U2 parked — the `plan`/`children` layer stays dormant); auto-decided release gates; parallel task execution; new failure kinds or settle outcomes (C6/C4 stacks reused as-is).

## Non-goals

- Pushing branches or creating PRs from the runner — release ends PR-ready with a pointer; push stays operator-side.
- Child-run/composite execution (U2) — sequential in-run tasks only; the plan/children data layer gets no producer.
- Auto-deciding release gates (ladder participation may come later on evidence).
- Parallel or interleaved task execution.
- New failure kinds, settle outcomes, or budget semantics — the C6 taxonomy, per-stage budget, and escalation gate are reused unchanged.
