// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Phase, TransitionSignal } from './types.js'

/**
 * The transition table itself: one row per phase, one column per signal, and
 * the audit of every row and every deliberate absence.
 *
 * Split from `transitions.ts` — the file reached `max-lines` the day a second
 * re-entry arrived — along the seam its own module doc had already drawn: the
 * table is policy a maintainer reads, the mechanics that consult it are stable
 * plumbing. Nothing here executes; `canTransition` and `transition` look rows
 * up, which is what keeps this file a leaf.
 */

/**
 * Where each signal leads. Signals absent from a phase's row are rejected, so a
 * command arriving in the wrong phase is a loud no-op rather than a silent
 * corruption of the persisted state.
 *
 * `ANSWERED` is deliberately not in this table at all — see `transition` in
 * `transitions.ts`, which reads this table. Every entry here names a phase the
 * machine *moves to*; a signal that leaves the phase alone has no business
 * being expressed as a row per phase.
 *
 * `CI_FAILED` appears in exactly two rows, and the four absences are the
 * decision rather than an oversight. A red run is worth acting on only where
 * the branch is already pushed *and* no job of this pipeline is working it:
 * `COMPLETE` is the ordinary case, and `PR_DELIVERY` is the genuine race.
 * Phase 3 pushes the branch and posts a state block naming `PR_DELIVERY`
 * before phase 4 opens the pull request, and a delivery that dies after the
 * pull request exists leaves exactly that block behind — so the branch is live,
 * the checks are red, and the row that used to be missing had `applyCiTrigger`
 * refuse the run, post nothing and spend nothing. Silence is the failure mode
 * the whole CI path is built around, so it was the wrong row to leave out.
 *
 * The four phases before the branch exists — `INIT_OR_CLARIFY`, `DESIGN_SPEC`,
 * `PLANNING`, `PLAN_REVIEW` — have nothing pushed to repair, and
 * `handleCiFix` would happily run the configured checks against a branch cut
 * fresh from the base and commit the base's own failures onto the issue.
 *
 * `REVIEW_AND_MUTATE` and `CI_FIX` are out because the machine never persists
 * them: a state block is written only when a handler posts, and both of those
 * handlers post the phase they moved *to* (`PR_DELIVERY`, `COMPLETE`). A red
 * run appearing to find one is reading a hand-edited block, and honouring it
 * would put a second agent job on a branch another job is mid-commit on. The
 * workflow's concurrency group (`opencode-agent-<branch>`,
 * `cancel-in-progress: false`) does queue those two runs rather than overlap
 * them — but it keys a CI run off `workflow_run.head_branch` and an issue run
 * off `agent/issue-<n>`, so it holds only while those two strings agree, which
 * is a narrow coincidence to hang a push race on rather than a proof.
 *
 * `FAILED` is deliberately absent and is the close call, because there the
 * branch *is* pushed, a pull request may well be open, and its checks do go red
 * with nobody acting. It stays out because `FAILED`'s entire content is a
 * recorded pipeline failure plus the `resumeFrom` that undoes it, and
 * `CI_FAILED` is a forward move: it would reset `attempts`, and it would leave
 * `FAILED` for a phase where `/retry` is refused — `resumeFrom` survives the
 * move but nothing can ever act on it again — so a fix that went green would
 * land the issue in `COMPLETE`, announcing success for a pipeline that never
 * finished delivering. Nor is this the silence the `PR_DELIVERY` row is about:
 * a failed run has already posted "this failed, reply `/retry`", and that
 * `/retry` resumes the phase that broke, delivers, and reaches `COMPLETE`,
 * where the next red run is picked up as usual. The red checks are deferred
 * behind a maintainer, not abandoned.
 *
 * `REVIEW_REQUESTED` names exactly one row, and its absences are the same audit
 * with one answer changed. The four phases before the branch exists have nothing
 * to review; `REVIEW_AND_MUTATE`, `CODE_REVIEW` and `CI_FIX` are never
 * persisted, so a `/review` appearing to find one is reading a hand-edited block
 * and honouring it would put a second job on a branch another is mid-commit on;
 * and `FAILED` is parked under a comment asking for `/retry`, where reviewing a
 * delivery that did not finish reviews a branch nobody has claimed is complete.
 *
 * `PR_DELIVERY` is the one that differs from `CI_FAILED`, deliberately. That row
 * exists because a refused red run is **silent** — nothing posted, nothing
 * spent, and a maintainer with no way to learn the run was dropped. A refused
 * `/review` answers on the issue through `refuseCommand`, naming what the phase
 * does accept, so there is no silence to fix; and in `PR_DELIVERY` the pull
 * request may not exist yet, which is precisely what the review reports against.
 *
 * `INCOMPLETE` carries an empty row for the reason `FAILED` does: both signals that
 * reach it — `OUT_OF_TIME` in, `CONTINUE` out — are explicit branches in
 * `transition`, neither being a plain forward move. Its two absences are that
 * same audit again: `CI_FAILED` and `REVIEW_REQUESTED` stay out even though the
 * branch *is* pushed there, the one condition those rows normally want, because the
 * work is by definition unfinished and CI-fixing or reviewing a half-done increment
 * is worse than waiting for the `/continue` that finishes it.
 */
export const TRANSITIONS: Record<Phase, Partial<Record<TransitionSignal, Phase>>> = {
  INIT_OR_CLARIFY: { NEEDS_CLARIFICATION: 'INIT_OR_CLARIFY', CAPTURED: 'DESIGN_SPEC' },
  DESIGN_SPEC: { CHANGES_REQUESTED: 'INIT_OR_CLARIFY', APPROVED: 'PLANNING' },
  PLANNING: { PLAN_POSTED: 'PLAN_REVIEW' },
  PLAN_REVIEW: { CHANGES_REQUESTED: 'PLANNING', APPROVED: 'REVIEW_AND_MUTATE' },
  // D6 — steering-drift: a scope-affecting comment mid-implementation routes to PLANNING.
  REVIEW_AND_MUTATE: { CHANGES_REQUESTED: 'PLANNING', CHANGES_COMMITTED: 'PR_DELIVERY' },
  PR_DELIVERY: { PR_OPENED: 'COMPLETE', CI_FAILED: 'CI_FIX' },
  CODE_REVIEW: { REVIEW_DONE: 'COMPLETE' },
  CI_FIX: { CI_FIXED: 'COMPLETE' },
  // D7 — archive door: merged PR → ARCHIVE → COMPLETE. Never persisted as waiting.
  ARCHIVE: { ARCHIVED: 'COMPLETE' },
  COMPLETE: { CI_FAILED: 'CI_FIX', REVIEW_REQUESTED: 'CODE_REVIEW', PR_MERGED: 'ARCHIVE' },
  FAILED: {},
  INCOMPLETE: {},
}
