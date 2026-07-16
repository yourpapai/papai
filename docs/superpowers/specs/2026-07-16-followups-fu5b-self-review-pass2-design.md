<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Follow-ups · FU5b: Self-Review Pass-2 (Auto-Fix Before MR) (design)

> **Context.** Sixth sub-project of the post-migration follow-ups program; the second of the three un-dropped
> features. nerv already has a self-review pass-1 (it asks the agent to review its own work) but **never acts on
> the result**. FU5b adds the missing act-on-findings step: parse the review verdict and, if it flagged issues,
> dispatch a fix turn before the work proceeds to the MR.
>
> **Repos touched.** `nerv` only. **magi: no code** (it sees ordinary `follow-up` calls). **papai: no code.**
>
> **Ground truth.** All file:line anchors below were read directly (2026-07-13/16) in the kiss/nerv/magi repos.

## Premise (what the investigation established)

- **Pass-1 exists and is fire-and-forget.** `makeSelfReviewHandler` (`nerv/src/supervisor/selfReviewHandlers.ts:26-54`)
  dispatches `generateSelfReviewPrompt(task.prompt, [{subdir, commitHash}], outputLanguage)` (`prompts.ts:885-977`)
  as a `magi.followUp` on the **same** session that wrote the code, sets `lastActivity`, and returns — **no status
  change, no branching on outcome.** Its own docstring (`selfReviewHandlers.ts:1-24`) names the gap: _"this handler
  implements pass 1 only … Pass 2 (`generateSelfReviewFixPrompt`, fed with the actual review issues text) needs
  that completion result …"_.
- **The result already reaches nerv — it's just not read as a review.** The self-review turn's completion flows
  through the generic path in `makeReconcileHandler` (`foundationHandlers.ts:146-156`), which runs
  `parsePromptResult` → reads `Title`/`Description`/`Reply`. But self-review's result format
  (`RESULT_FORMAT_SELF_REVIEW`, `prompts.ts:873-876`) emits **`Status`/`Review`**, so those generic fields come back
  `undefined` and the structured `Review` (issues) text — although parsed into `fields['Review']` (a
  `KNOWN_RESULT_FIELDS` entry) — **is read by nothing.** No field on `TaskRepository` (`db/models/Task.ts:20-40`)
  even marks a completion as belonging to a self-review turn.
- **"pass-2" = kiss's auto-fix step, verbatim.** Roadmap (`docs/superpowers/specs/2026-07-11-kiss-to-papai-migration-roadmap-design.md:223`):
  _"**Self-review pass-2** (auto-fix before MR)."_ kiss (`kiss/src/agents/SelfReview.ts:35-129`): pass-1 review turn
  → parse `Status`/`Review` → if issues, pass-2 = `generateSelfReviewFixPrompt(reviewIssues, gitlabUserName)` on the
  main session → a second commit → push. **Single round, no re-verify loop** (kiss's `AUTO_FIX_RETRIES=9` is a
  retry-on-execution-failure budget, not a review-round cap). `generateSelfReviewFixPrompt` **already exists in
  nerv** (`prompts.ts:982-999`) and is unused.
- **The roadmap's blocker is smaller than stated.** It's named three times as _"needs magi synchronous follow-up
  read-back"_ (roadmap:223, `selfReviewHandlers.ts:1-24`, `kiss-to-nerv-parity-matrix.md:186-189`). But nerv's async
  reconcile-poll already delivers and parses the turn result; the only true gap is **tagging** which turn is a
  self-review. So FU5b is nerv-only — no magi change.
- **The re-cycle risk is real.** `review ⇄ coding` is a legal, already-used cycle (`domain/stateMachine.ts:3-10`);
  a fresh transition into `review` re-fires the pass-1 enqueue (`foundationHandlers.ts:128-142`) because the
  `WorkItem` dedupe index is active only while `pending`/`processing` (`db/models/WorkItem.ts:45-49`). Without a
  guard, review→fix→review would ping-pong. FU5b adds a per-repo phase guard so self-review runs exactly once.

## Decisions of record

1. **nerv-only, reconcile tagging.** Tag the pending self-review turn on the repo; parse `Status`/`Review` on its
   completion in reconcile; dispatch the fix if issues. No magi change.
2. **Single round (kiss parity).** One review, one conditional fix, then stop. A per-repo `selfReviewPhase` guard
   prevents the review⇄coding cycle from re-firing self-review; the fix is **not** re-reviewed.
3. **Reuse existing pieces:** `generateSelfReviewFixPrompt`, the WorkItem+dedupe pattern, FU3's `item._id`
   idempotency keys, FU5a's `isOverBudget` gate.
4. **Rides `Project.selfReviewEnabled`** (`db/models/Project.ts:44,73`, default `true`), stays **single-repo**
   (`taskRepositories[0]`, matching pass-1), and **cost is already handled** — the review + fix turns accumulate
   `usageUsd` via FU5a and are gated by `isOverBudget`.
5. **`selfReviewPhase` is sticky at `done` per task** (kiss's once-per-run). A later legitimate re-entry into
   `review` for an external reason (review-comment / CI-fix) is handled by its own handlers and does not re-trigger
   self-review.

---

## Component A — tag the self-review turn (nerv)

Add a per-repo `selfReviewPhase?: 'reviewing' | 'fixing' | 'done'` to `TaskRepository` (`db/models/Task.ts`
interface + schema; absent = not started).

- **Enqueue guard** — the pass-1 enqueue in `makeReconcileHandler` (`foundationHandlers.ts:128-142`, on
  `statusChanging && target === 'review'` + `project.selfReviewEnabled`) fires **only when the repo's
  `selfReviewPhase` is absent**, so self-review runs once per task and the review⇄coding re-cycle can't re-trigger it.
- **Dispatch marker** — `makeSelfReviewHandler`, when it dispatches pass-1, sets `repo.selfReviewPhase = 'reviewing'`
  (persisted alongside the existing `lastActivity` save). This marks "the next session completion for this repo is
  the self-review pass-1 result."

## Component B — branch on the pass-1 result (nerv)

In `makeReconcileHandler`, when a session **completion** is observed for a repo whose `selfReviewPhase === 'reviewing'`,
parse the completion text with the self-review lens (`fields['Status']`/`fields['Review']` from the same
`parsePromptResult` already run at `foundationHandlers.ts:146-156`) instead of the generic `Title/Description/Reply`:

- `Status === 'approve'` — or unparseable / missing / no `Review` issues (the **safe default**, never block) → set
  `selfReviewPhase = 'done'`; proceed normally (task → `review`, no fix).
- `Status ∈ {approve_with_comments, request_changes}` → enqueue a `self_review_fix` WorkItem carrying the `Review`
  issues text; set `selfReviewPhase = 'fixing'`.

When a completion is observed for a repo whose `selfReviewPhase === 'fixing'` (the fix turn finished) → set
`selfReviewPhase = 'done'`; proceed normally. The fix is **not** re-reviewed (single round).

## Component C — the fix turn (nerv)

A new work-kind `self_review_fix`:

- **Payload** `SelfReviewFixPayload { projectPath: string; reviewIssues: string }` (`domain/workPayloads.ts`).
- **Enqueue** from Component B with `dedupeKey = `selfreviewfix:${taskId}`` (single active fix per task).
- **Handler** `makeSelfReviewFixHandler` (`src/supervisor/selfReviewHandlers.ts` or a sibling): looks up the repo by
  `projectPath`, bails (log, no-throw) if no `magiSessionId`, checks `isOverBudget` → `applyCostCapBreach` (the same
  gate as the other dispatch sites, per FU5a), then dispatches
  `magi.followUp(repo.magiSessionId, generateSelfReviewFixPrompt(payload.reviewIssues, botUsername), credentials,
selfReviewFixIdempotencyKey(taskId, projectPath, item._id.toString()))`. Registered in the worker's handler map
  alongside the others.
- **New idempotency key** `selfReviewFixIdempotencyKey(taskId, projectPath, workItemId)` →
  `${taskId}:${projectPath}:selfreviewfix:${workItemId}` (`domain/idempotencyKeys.ts`, mirroring the FU3 keys).

The fix turn is an ordinary `follow-up`; its own completion returns through the generic path, harmlessly, once
`selfReviewPhase` is `done`.

---

## Cross-repo contract summary

None. FU5b is entirely nerv-internal: a new `TaskRepository.selfReviewPhase` field, a new `self_review_fix`
work-kind + handler + idempotency key, and reconcile branching. magi sees only ordinary `follow-up` calls (no new
endpoint, no semantics change); papai is untouched.

## Testing strategy

- **Enqueue guard:** pass-1 enqueues on first transition into `review`; does NOT re-enqueue when `selfReviewPhase` is
  already set (no ping-pong across the review⇄coding cycle).
- **Branch — approve:** a `Status: approve` completion sets `selfReviewPhase='done'`, enqueues no fix, task proceeds.
- **Branch — issues:** `request_changes` / `approve_with_comments` enqueues a `self_review_fix` WorkItem carrying the
  `Review` text and sets `selfReviewPhase='fixing'`.
- **Branch — unparseable:** a completion with no parseable `Status` defaults to `done` (never blocks the task).
- **Fix handler:** dispatches `generateSelfReviewFixPrompt` with the issues, gated by `isOverBudget` (over budget →
  breach, no dispatch), idempotent by `item._id`; no-session → no-op.
- **Single round:** after the fix turn completes (`fixing` → `done`), self-review does NOT run again.
- **End-to-end lifecycle:** create → code → review → self-review(issues) → fix → done, asserting no unbounded
  review/fix ping-pong and the phase transitions in order.

## Out of scope / deferred

- Any **magi change** / synchronous read-back (nerv-only chosen).
- **N-round iterate-until-clean** (single round chosen — kiss parity).
- **Multi-repo self-review** (stays `taskRepositories[0]`; FU5c territory).
- Wiring **`selfReviewEnabled` into papai settings / `coding_guardrails`** (a separate leftover P3 config-importer
  item; FU5b uses the existing DB field, default `true`).
- **Cost accounting** for the extra turns — already handled by FU5a (accumulation + gate).

## Open assumptions (resolve during planning)

- The exact reconcile splice point where a `selfReviewPhase`-tagged completion is detected vs. the generic
  completion handling (`foundationHandlers.ts:146-156`) — confirm reconcile has the completion text (`cleanOutput`)
  in scope at that branch, and that tagging by `selfReviewPhase` reliably disambiguates the pass-1/fix turn from a
  normal coding-turn completion (i.e. that a `reviewing`-phase repo's next observed completion is always the
  self-review turn, never an interleaved unrelated coding completion for the same repo).
- The exact `Status` values `RESULT_FORMAT_SELF_REVIEW` emits (`approve` / `approve_with_comments` /
  `request_changes`) — confirm against `prompts.ts:873-876` so the branch matches real output; decide the mapping
  for any other/blank value (default → `done`, non-blocking).
- Whether `self_review_fix`'s own completion needs any special handling or is safely absorbed by the generic path
  once `selfReviewPhase` is `done` (expected: safe — its result format is the ordinary fix format the generic path
  already tolerates).
- `botUsername` availability in the fix handler's scope for `generateSelfReviewFixPrompt` (the same value pass-1 and
  the review/CI handlers already use — confirm the `HandlerCtx`/config source).
