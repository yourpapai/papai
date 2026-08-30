# Proposal: sdd-runner-session-removal

## Why

The session list only ever grows: aborted strays (the 2026-08-22 intake
incident row is still pinned there), completed runs, and failed experiments
accumulate forever because `sdd-runner-session-picker` deliberately declined
deletion ("not needed to make selection usable"). With the session screen
becoming the home surface (`sdd-runner-session-manager`), dead rows are pure
noise on every visit; the operator has no verb at all — removal means
hand-deleting directories under `.sdd-runner/runs/`.

## What Changes

- A delete row action on the session screen (landing in the manager shell
  shaped by `sdd-runner-session-manager`): selecting it enters an explicit
  confirmation naming the session; confirming removes the run; declining or
  cancelling returns to the list untouched.
- Removal deletes the run directory (hard delete). Refusal guard: only rows
  whose persisted status is terminal or stopped are deletable; a running row
  (including gate-pending or stop-requested) SHALL be refused with a notice
  pointing at calm-stop — the guard is evaluated against freshly-read
  persisted state at delete time, not the possibly-stale rendered row.
- A deleted session disappears from the screen immediately and its name
  becomes reusable by the task-name identity rules (a later session may take
  the bare slug).

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `sdd-runner-cli`: the "Interactive session screen on a terminal"
  requirement (as modified by the pending `sdd-runner-session-picker` and
  `sdd-runner-session-manager` deltas) gains the delete action and its
  guard/confirmation behavior. Without it, list hygiene is impossible
  without out-of-band filesystem surgery, and nothing else covers it — the
  CLI surface has no removal verb by design.

No platform instances, task instances, or config-context scopes are affected;
all state is runner-local under `.sdd-runner/` keyed by run id.

## Impact

- Code: `sdd-runner/src/tui-session-screen.ts` (delete + confirm reducer
  states), a small removal module (guard + directory delete),
  `session-flow.ts` (delete action routing), harness seam in `index.ts`.
- Specs: `openspec/specs/sdd-runner-cli/spec.md` via delta. Docs:
  `docs/architecture/sdd-pipeline.md` (session screen key surface). Tests:
  `tests/sdd-runner/tui-session-screen.test.ts`, new removal-module tests.

## Non-goals

- Archive/trash semantics — declined; the durable asset (OpenSpec change
  dir, git history) lives outside the run dir, and cost-history loss on
  dead runs is accepted. Un-decline later if it hurts.
- Bulk/multi-select deletion and `sdd rm`-style CLI verbs — declined; the
  screen is the surface.
- Undo after confirmation — declined; confirmation is the undo.
- Deleting anything outside `.sdd-runner/runs/<runId>/` — never.
