# Design: sdd-runner-session-removal

## Context

See proposal.md — Why. Run rows come from `.sdd-runner/runs/<id>/` dirs
(`session-list.ts`); every per-run artifact (state, events, session ledger,
transcripts, task record) lives inside that one directory — there is no
cross-run index to reconcile. The stop-controller already owns liveness:
`runHasLiveOwner` reads the run's holder PID (absence reads as dead), and
`stopRun` settles ownerless running runs to `stopped`/`aborted` instantly.
This change lands after `sdd-runner-session-manager`, whose loop shell hosts
the new action.

## Goals / Non-Goals

Goals: one keystroke from row to a named confirmation to a gone row; a guard
that cannot delete a run a live process owns; nothing outside the run dir is
ever touched.

Non-Goals (design-level): archive/trash, bulk delete, undo (proposal
Non-goals); changing stop semantics or the session-list projection.

## Decisions

- **Guard = fresh status read AND owner liveness.** At delete time (after
  confirmation), re-read `state.json` and refuse when status is `running` OR
  `runHasLiveOwner` is true; the notice points at calm-stop (which settles
  ownerless runs immediately, so the escape hatch always works). The
  rendered row is never trusted — it can be arbitrarily stale. Alternative
  rejected: status-only guard — a stale 'completed' row could mask a
  re-running process; the holder check closes exactly that hole with
  machinery that already exists.
- **Hard delete via `fs.rm(runDir, { recursive: true })`** in a small removal
  module (`remove-run.ts`) owning guard + delete, DI-friendly for tests
  (inject state reader, liveness, and an fs seam). Alternative declined:
  archive to `runs/.trash/` — keeps dead weight forever and invents a second
  storage location; un-decline only if cost-history loss on dead runs
  actually hurts.
- **Confirmation as a reducer sub-state, like the gate's flows.** `(d)` on a
  deletable row enters a confirm view naming `changeName` + runId; `y`
  executes, any other key cancels back to the list with cursor preserved.
  No y/n flags, no countdown — the picker pattern (pure reducer action,
  scripted-key tests) extends naturally.
- **Deletion outcome flows through the manager loop.** The delete action is
  one more `SessionTargetAction` executed by `executeSessionTarget`'s
  harness seam; success or refusal renders as notice → any key → refreshed
  list (rows re-read, so the row vanishes without special-casing).
- **Spec stacking.** This delta's MODIFIED text includes the manager loop's
  language because it stacks on `sdd-runner-session-manager`'s unarchived
  delta; archive order MUST be manager → removal, and the merged requirement
  must read as current truth afterward.

## Risks / Trade-offs

- [TOCTOU: owner spawns between guard and rm] → the window is one
  confirmation wide; a run starting concurrently recreates its dir, which
  reads as a fresh run — no partial-dir deletion path exists because rm
  happens once, after the guard, and starters create-then-own. Accept the
  microscopic race; note it in the module doc.
- [Deleting a stopped run discards resumability + cost history] →
  deliberate, confirmed twice (action + named confirmation); Non-goal
  records the un-decline path.
- [Mutation gate on the removal module] → guard branches get per-branch
  tests (running, live-owner, terminal, stopped) from the start.

## Migration Plan

Single PR after `sdd-runner-session-manager` archives. No persisted-state
migration; nothing to roll back beyond revert (deleted runs are not
recoverable by design — the confirmation is the safety).

## Open Questions

- Whether the confirm view also shows token/cost totals as a "what you're
  losing" hint — cosmetic, safe to settle during implementation.
