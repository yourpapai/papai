<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design: sdd-runner pipeline completion

## Context

See `proposal.md` (Why / What). The load-bearing current state:

- `runPostReviewToGate` (`orchestrator.ts`) short-circuits on `cap-hit`:
  `presentGateAt(..., 'early')` runs **instead of** `runDecomposeStages`, so an
  early-gate presentation always means decompose never ran.
- `runGateResume` on an `approved` outcome calls `finalizeGate`
  (`gate-digest.ts`), which only stamps `status: 'completed'` and clears the
  gate — a terminus with no continuation hook.
- `resume` (`orchestrator.ts`) re-enters at `review` only; any other derived
  resume point throws `not supported yet`.
- `runExtendRound` (`extend-round.ts`) already contains the post-convergence
  path used after an extended round: decompose → atomicity (depth ≠ S) → final
  gate at version `n+1` (`runPostExtendConverged`).
- The review loop's result (`ReviewLoopResult`) carries per-round findings with
  classes (`BLOCKER`/`MATERIAL`/`NITPICK`) and resolutions (`edited` /
  `evidence-answered` / `dismissed`), persisted in `findings-N.json` /
  `resolutions-N.json` sidecars.

## Goals / Non-Goals

**Goals:**

- No completed run without `tasks.md`; approval always advances the pipeline.
- Reuse the existing post-convergence path rather than growing a second one.
- Keep the human gate as the only place unresolved BLOCKER/MATERIAL findings are
  accepted; never auto-approve those.
- Resume coverage for every stage the pipeline can halt in.

**Non-Goals:**

- Changing what the reviewer/skeptic/resolver produce per round (finding
  classes, resolution kinds) — only how the orchestrator interprets a capped
  round.
- Auto-approval policies for unattended runs (deferred; the gate stays human).
- Reworking the gate document format — copy changes only (the interaction
  overhaul is the sibling change `sdd-runner-gate-interaction`).
- Reopening already-completed historical runs.

## Decisions

### Decision 1 — Approval becomes a continuation, not a terminus

Replace the `finalizeGate(deps, state, 'completed', version)` call on the
`approved` outcome with a continuation that runs the existing post-review tail:
decompose → atomicity (depth ≠ S) → final gate at `version + 1`. Concretely,
`runGateResume` on `approved` routes into the same function `runExtendRound`
uses after convergence (today `runPostExtendConverged`), which is hoisted into a
shared stage module. `finalizeGate` is then called only when the **final** gate
is approved (or on abort at any gate).

The final gate is not skipped after an early approval: the human approved the
*design* at the early gate; the final gate is where they sign off the *task
list* (its digest renders `tasks: <done>/<total>`). Skipping it would trade one
consequence-blind approval for another.

**Alternative considered:** keep approve-means-stop and add a third gate
decision (`approve-and-continue`). Rejected: "approve" that silently amputates
output is the trap being fixed; a stop-early outcome is still available as
`abort`, which honestly records that the run did not complete.

### Decision 2 — Severity-based convergence is an orchestrator-level verdict

Where `runPostReviewToGate` currently branches on `outcome === 'cap-hit'`, it
additionally inspects the round's open findings: if none are class `BLOCKER` or
`MATERIAL` (nitpick-only, all resolved or dismissed), the branch is treated as
converged and falls through to decompose. The review loop itself keeps reporting
`cap-hit`; reclassification lives in the orchestrator so the loop's semantics
(and its sidecar formats) are untouched.

"Open" means the `ReviewLoopResult` `openBlockers` / `openMaterial` /
`openNitpicks` lists — findings raised in the final round, after that round's
resolver pass (the same lists `presentGateAt` renders from via `findingsOf`).
Resolved-then-rippled findings (a fix that spawns a smaller finding next round)
are unaffected: the ripple is a new finding in a new round and is classified on
its own merits.

**Alternative considered:** severity-based convergence inside the review loop
(a new `converged-severity` outcome). Rejected: it changes the loop's contract
and every consumer of `ReviewLoopResult`; the orchestrator branch is the
single, auditable place the cap-hit verdict is acted on.

### Decision 3 — Resume derives post-review stages from artifacts on disk

`deriveResumePoint` gains stages beyond `review`: if `tasks.md` is absent and no
final gate was presented, resume at `decompose`; if `tasks.md` exists and depth
≠ S but the atomicity report is absent, resume at `atomicity`; a pending gate
keeps the existing `gate-pending` result (the CLI directs to the gate flow).
Derivation uses the change directory plus sidecar reports — the same evidence
the stages themselves produce — so no new state fields are persisted. The
`resume` error for non-review stages is removed; each newly resumable stage
rebuilds its `StageContext` exactly as the fresh pipeline does.

**Alternative considered:** persist an explicit `nextStage` field in
`state.json`. Rejected: state.json already drifts from reality on interrupted
runs (it is saved *between* stages); artifact-derived resume points are
self-healing and need no migration.

### Decision 4 — Gate copy states consequences

The gate renderer's header lines are extended so each decision line names its
downstream effect (approve → decomposition + atomicity + final gate; extend →
one more review round, then re-gate; veto → rework + re-gate; abort → end). The
parser is untouched; this is renderer-only copy, verified by snapshot-style
assertions on the rendered markdown.

## Risks / Trade-offs

- **[Early approval now spends decompose/atomicity tokens the operator may not
  have wanted]** → Mitigation: the gate copy (Decision 4) states the cost
  bearing consequence up front; `abort` remains the no-more-spend exit; the
  final gate is a second human checkpoint before completion.
- **[Severity convergence trusts the reviewer's class assignments]** a MATERIAL
  misclassified as nitpick would slip past the early gate → Mitigation:
  classification is already human-visible in the final gate's trajectory and
  nitpick list; the final gate remains human-signed, so nothing reaches
  `completed` without human eyes on the full digest.
- **[Resume-from-artifacts may re-run a stage that completed but failed to
  record]** (e.g. crash after writing `tasks.md` before the atomicity report) →
  Mitigation: stages are idempotent by construction (decompose rewrites
  `tasks.md` wholesale; atomicity rewrites in place), so a spurious re-run is
  wasted tokens, not corruption.
- **[Breaking semantic change for anyone habituated to approve-means-stop]** →
  Mitigation: documented in `docs/architecture/sdd-pipeline.md`; the behavior
  change is announced in the gate copy itself at the moment of decision.

## Migration Plan

- No persisted-state migration: `state.json` schema is unchanged; historical
  runs (completed/aborted) are final and untouched.
- Rollout is code-only: land, run `tests/sdd-runner`, update
  `docs/architecture/sdd-pipeline.md` in the same change.
- Rollback: revert the change; in-flight gate-pending runs remain resumable by
  the previous binary because gate state and files are format-compatible.

## Open Questions

- Whether veto-driven re-gates after an early approval should re-run only the
  affected part of the tail (veto touching `specs/` already triggers the drift
  reconciler for `tasks.md`; full re-decompose is likely unnecessary). Deferrable
  — the drift machinery covers it today.
