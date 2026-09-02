<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design: log-fidelity

## Context

See `proposal.md — Why`. Grounding evidence: the C7 harvested M-run log
(`tests/afk-runner/fixtures/live/mutation-floor-hardening-live/events.ndjson`) shows both double-`round_open`
shapes — same-round resume (seq 195/202) and extend-at-final re-entry (seq 605/607, 7 ms apart); a third shape
(escalation retry re-entry) follows from the same code path. sdd-runner's resume flow
(`sdd-runner/src/resume-flow.ts:144 reportResumeDecision`) is the frozen reference producer.

## Goals / Non-Goals

**Goals**: one invariant that closes all three double shapes; one producer that makes every resume invocation
log-visible; zero fold/schema/memo changes; file-disjointness from `gate-settle-robustness` (R1).

**Non-Goals** (beyond the proposal's): no change to the extend mover in `gate-settle.ts` or the owed-mover
recovery in `drive/resume.ts` — both are *correct under* the invariant (they open rounds that are not open);
no new persisted state; no new dependencies.

## Decisions

**D1 — Event taxonomy drives the fix shape.** State-shaped events (`round_open`, `round_close`, gate
presented/answered) mean transitions and get fold-derived owedness; fact-shaped events (findings, convergence,
`resume`) are timestamped points where idempotency is meaningless. Only the state-shaped no-op is suppressed;
re-run rounds keep emitting their work-shaped facts (D7 keeps the tolerance story symmetric).

**D2 — The owedness invariant and its placement.** `round_open{r, cap}` is owed iff
`context.round?.current !== r || context.round?.cap !== effectiveCap` against the work-entry fold. The
condition derives inside `reviewResumeEntry` (`drive/resume.ts` — already pure over fold + ledger) and rides
the entry (`ReviewEntry` gains the fold's round snapshot); `runRound` compares before emitting. The drive loop
re-folds per bracket, so `io.context` is fresh per work invocation: recursion into r+1 always clears the
comparison; same-round re-entries (resume, extend re-entry, escalation retry) skip; a cap amendment on an open
round still emits (the cap clause is *defensive* — afk's steer wiring reads the entry fold, so within-invocation
cap changes cannot occur today; the clause guards rewiring). *Alternative rejected*: suppressing in the fold —
the fold is frozen parity surface and the defect is emission-side.

**D3 — Producer keyed on invocation, at run level.** Emitting where the ledger session is consumed
(`runReviewWork`) is dishonest: the work module cannot distinguish a resume boot from a same-process
continuation, and same-process escalation retries *do* see in-flight (`killed`) ledger lines
(`agent-layer.ts` settles failures as `killed`; `latestInFlight` counts `spawned|killed`) — the narrow scope
would mislabel retries as resumes. The producer therefore lives in `resumeRun`, keyed on the invocation itself.
`resume` has no live-holder refusal today (`parkResumedRun` overwrites the holder); per-invocation emission
matches that reality.

**D4 — Emit ordering: post-recovery, pre-branch.** The event lands immediately after `resumeInputs` returns
(owed-recovery complete) and before the parked/drivable branch, so parked-gate and terminal resumes emit too.
Pre-recovery emission was rejected: W5/W6 resumes sit at the *failed stage* before healing (the escalation
presentation never landed) and would misclassify as `stage-rebuild, <stage>` when the resume actually presents
a gate; post-recovery classifies truthfully, and the event can never be lost — heals happen inside
`resumeInputs`, completion only happens later in `driveRun`. Chronology (heals-then-resume) is accepted: the
resume process is the only possible healer (holder semantics).

**D5 — The path table, over post-recovery fold + ledger.** Mirrors sdd-runner's
`resolveResumeDecision` taxonomy re-keyed to fold position (sdd needed `driver.status().artifacts` only
because its replay lacked positions):

| post-recovery fold | event |
|---|---|
| position `gate.awaiting` (incl. recovery-completed terminals) | `artifact-skip, gate` |
| position `review`, round `null` | `artifact-skip, review` |
| position `review`, open round, ledger in-flight | `session-continuation, review, session` |
| position `review`, open round, no in-flight | `stage-rebuild, review` |
| intake / draft / decompose / atomicity | `stage-rebuild, <stage>` |

`gate` is a valid `StageId` and the `artifact-skip, gate` shape is corpus-proven
(`resume-artifact-skip-gate.ndjson`). Documented divergence: an intake crash resume with existing scaffolding
reports `stage-rebuild, intake` (position-honest) where sdd's artifact inference said `artifact-skip` — the
intake bracket genuinely re-opens and idempotence closes it fast.

**D6 — Deliberate copy divergence, landed under guard.** `review-loop.ts` is a copy of frozen sdd-runner code,
and sdd-runner doubles on resume too (`resumeFromPoint` → `startRound = decision.round` → unconditional emit)
— the defect is inherited, not introduced. The divergence is recorded here per the copy-closure convention and
lands while the parity oracle still replays the frozen corpus (emission changes never touch folds).

**D7 — Safety profile (verified).** Kernel fold leaves `resume` unmapped (tolerated); legacy fold has no
handler (no-op) — proven by the `s-depth-calm-stop-resume` scenario passing parity today with the event in it.
`round_open` handling is last-write-wins in both folds and stays so — duplicate tolerance remains load-bearing
for frozen logs. Memo/report unaffected: `autoExtendsUsed` counts auto-decision records
(`memo-project.ts:108`), `report` counts rounds via `Math.max`. `resume-equivalence.test.ts` asserts memo
equality, not event streams. Frozen fixtures keep their doubles; `under-budget-retry-synthetic`'s documented
meaning flips from "legitimate shape" to "tolerated history".

**D8 — F-A4 recorded, not fixed.** Same-process escalation retries consume `killed` ledger sessions as
continuations (consequence of D3's evidence). Possibly deliberate — continuing a killed session keeps its
cached context (the C7 cache-economics shape) — but unproven. Out of scope here; recorded for the C8 live
cycle to exercise and for a possible follow-up fixture proving it deliberate.

## Risks / Trade-offs

- [R1's landed design adds a new re-entry-into-open-round shape (re-present → extend → re-entry)] →
  **verified at apply time** (`gate-settle-robustness/design.md` re-read): the only round-opening producer in
  its landed shapes is the extend mover — D5's owed-exit heal appends `stage_exit` events only, D4's deadline
  ladder re-run settles through the same extend mover (the canonical absorbed shape: mover emits, review's
  re-entry skips), re-presentation (v+1) touches no rounds, and the already-answered guard appends nothing.
  Every `round_open` lands in the log before the drive invokes review work, so the entry fold always carries
  it; no re-entry path bypasses the invariant.
- [Terminal-row reachibility (recovery-completes-the-run) is untested] → landed as the apply-time drill:
  W3 truncation + the default (R1-approving) shape; `resume-event.test.ts` asserts the `artifact-skip, gate`
  event after the healed settle. Implementation note recorded with it: pre-existing terminals map to the same
  `artifact-skip, gate` row (a completed run's terminal derives from `gate.answered`), so the table needs no
  pre-recovery fold plumbing.
- [Emission skip could hide a future cap bump] → the cap clause in the predicate emits on any cap change;
  defensive by D2.

## Migration Plan

None. The log format is unchanged; no backfill; frozen logs replay identically. Rollback is a revert — frozen
corpus and folds are untouched either way.

## Open Questions

- C8 visibility bar: log-only or also a `report` resume line (lean log-only — renderer parity is U8's TUI
  re-host; decidable at C8 without touching this design).
- F-A4's eventual filing (observation note vs proving fixture) — deferred with D8.

## TDD / hooks

All edits sit under `afk-runner/src/**` (Write/Edit TDD hooks, red-first). Order: emission-count reds
(extend-cycle, kill/resume drill, escalation retry) → owedness implementation → producer reds (path-table
rows, ordering, terminal row) → producer implementation → scenario sibling fixture + inventory row → docs.
