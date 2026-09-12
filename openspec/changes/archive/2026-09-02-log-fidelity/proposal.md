<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

## Why

C7's live proof left two log-fidelity holes in afk-runner's event log — the engine's sole truth. **F-A1 (under-scoped as filed)**: `round_open` is re-appended on *any* re-entry into an already-open round — same-round resume as filed, plus extend re-entry and escalation retry, both confirmed live in the harvested M-run log (seq 605/607, 7 ms apart). **F-A2**: the `resume{session-continuation}` event has a schema and fixtures but no producer, so resumptions are visible only through the session ledger, never in the log. The C8 second live cycle requires resume events visible; U9/R5 (sdd-runner deletion) makes this log the only surviving record.

## What Changes

- **`round_open` owedness invariant**: a review round emits `round_open{round, cap}` iff the event changes the folded round state (round number or cap differs from the entry fold). The condition derives inside `reviewResumeEntry` (already pure over fold + session ledger) and rides the entry to the emission site in `runRound`. New logs stop double-counting round opens on resume, extend re-entry, and escalation retry; frozen logs and both folds are unchanged (duplicate tolerance stays load-bearing for history).
- **`resume` event producer**: every `afk-runner resume` invocation appends exactly one `resume{path, stage, session?}` after owed-recovery and before the drive/park branch, classified by a path table over the post-recovery fold plus session ledger — sdd-runner's `reportResumeDecision` semantics re-keyed to fold-derived position.

## Capabilities

### New Capabilities

- `afk-runner-log-fidelity`: emission idempotence for state-shaped round events, and the resume-invocation producer. Without it: live logs double-count round opens on every extend/resume/retry re-entry (C8 round accounting and audit read noisy), and resumptions — including the W3/W5/W6 crash-window recoveries — leave no log trace, defeating the fold-as-truth audit story.

### Modified Capabilities

- None. The afk-runner family grows by addition (`afk-runner-kernel` covers fold mechanics; `afk-runner-recovery` covers owed-event *healing* — this change is the mirror discipline on the *emission* side; no existing capability covers either). The archived `sdd-runner-*` specs are frozen history, untouched.

## Impact

- **Code**: `afk-runner/src/work/review-loop.ts` (emission guard), `afk-runner/src/drive/resume.ts` + `afk-runner/src/work/review.ts` (entry plumbing), `afk-runner/src/run.ts` (producer). File-disjoint from `gate-settle-robustness` (R1); the extend mover in `gate-settle.ts` is documented as invariant-correct, not edited.
- **Docs**: `docs/architecture/afk-runner.md`; the scenarios README row for `under-budget-retry-synthetic` (meaning flips from "legitimate shape" to "tolerated history").
- **No chat/platform surface, no config-context impact** (engine workspace; no platform or task instances involved).
- **Tests**: `tests/afk-runner/` work-module suites (emission counts), producer suite, one new scenario fixture + inventory row.

## Non-goals

- Suppressing duplicated work-shaped events (`finding`/`convergence`/`round_close` on re-run rounds) — the work genuinely re-happened; only state-shaped no-ops are suppressed.
- `report`/TUI rendering of resume lines — surface work belongs to U8's TUI re-host.
- `artifact-skip` inference via openspec-driver artifact status — the fold's position subsumes sdd-runner's artifact-based point derivation.
- F-A4 (same-process escalation retries consuming `killed` ledger sessions) — recorded in design as an observation, deliberately not fixed here.
- Any fold or schema change: `round_open` stays last-write-wins in both folds; `resume` stays unmapped/tolerated in the kernel fold.
