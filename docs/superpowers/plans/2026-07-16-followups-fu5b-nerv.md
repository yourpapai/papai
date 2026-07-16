<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# FU5b: Self-Review Pass-2 (Auto-Fix Before MR) — nerv Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Components A/B/C of FU5b — tag the self-review pass-1 turn, branch on its parsed
`Status`/`Review` verdict, and dispatch a `self_review_fix` pass-2 turn before the task proceeds to the MR.

**⚠️ HEADLINE FINDING — read before executing anything.** As of nerv `main` @ `279a9b3` (2026-07-16), **this
feature is already fully implemented and tested**, under a different local designation (`SS-03`/`SS-05`, commits
`8c3736b`, `c8af9ea`, `06fedb3`, `9cf06ab`) that predates this plan's authoring but postdates the FU5b spec's
"ground truth" read (2026-07-13/16). The spec's premise — _"pass-1 … never acts on the result"_ — no longer holds
against the checked-out code. Every Testing-strategy bullet in the spec, and every behavior in Components A/B/C,
has a real, passing test today. **There is no failing test to write and no missing code to add.** This plan is
therefore **not a build plan** — it is a reconciliation plan: it maps every spec component/decision onto the exact
existing code+tests (Tasks 1–4, framed as verification, each runnable now with a real `PASS`), and calls out the
one place where the shipped design **deliberately diverges** from the spec's Decision of Record #5 (Task 5, a
genuine open decision, not a code gap).

**Architecture (as shipped):** the spec's proposed new `TaskRepository.selfReviewPhase?: 'reviewing'|'fixing'|'done'`
field does **not** exist and was not added — the shipped code reuses the pre-existing `TaskRepo.pendingFollowUp?:
{ kind: FollowUpKind }` marker (`FollowUpKind = 'self_review' | 'self_review_fix' | 'review' | 'ci' | 'chat'`,
`src/db/models/Task.ts:22,26-28,58`) for the same disambiguation purpose. It is semantically equivalent to the
spec's 3-state phase for the branches FU5b needs (`reviewing` ≈ `pendingFollowUp.kind === 'self_review'`, `fixing`
≈ `'self_review_fix'`, `done` ≈ `pendingFollowUp === undefined`), so no new schema field was needed.

**Tech Stack:** Bun/TypeScript, Mongoose, Vitest (`npx vitest run <path>`), the existing `Handler`/`WorkItem`/queue
plumbing in `src/supervisor/`.

---

## File map (spec component → real file, current state)

| Spec ask                                                               | Real file                                                                                                                                                                                                                                                                                  | Status                                                                                                    |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| Component A: `selfReviewPhase` field + enqueue guard + dispatch marker | `src/db/models/Task.ts:22,26-28,58,108-110,126` (`FollowUpKind`/`PendingFollowUp`), `src/supervisor/foundationHandlers.ts:173-187` (enqueue), `src/supervisor/selfReviewHandlers.ts:57` (marker set)                                                                                       | **Done**, via `pendingFollowUp.kind`, not a new field                                                     |
| Component B: branch on pass-1 `Status`/`Review`                        | `src/supervisor/foundationHandlers.ts:105-149` (SS-03 loop-pin comment block, SS-05 routing at :128-148)                                                                                                                                                                                   | **Done**                                                                                                  |
| Component C: `self_review_fix` work-kind + handler                     | `src/domain/workPayloads.ts:37-44` (`SelfReviewFixPayload`), `src/db/models/WorkItem.ts:3` (`WORK_KINDS`), `src/domain/idempotencyKeys.ts:48-54` (`selfReviewFixIdempotencyKey`), `src/supervisor/selfReviewFixHandlers.ts` (`makeSelfReviewFixHandler`), `src/index.ts:71` (registration) | **Done**                                                                                                  |
| `generateSelfReviewFixPrompt` reuse                                    | `src/services/prompts.ts:982-999`                                                                                                                                                                                                                                                          | **Done** — used at `selfReviewFixHandlers.ts:40`, no longer unused as the spec's ground-truth read stated |

No files need to be created or modified to satisfy Components A/B/C. `git -C nerv status --short` was empty before
and remains empty after this investigation (read-only; nothing was committed or left dirty).

---

## Resolved open assumptions (from real code, with exact quotes)

**1. Reconcile completion path + splice point.**
`makeReconcileHandler` (`foundationHandlers.ts:53-222`) loops per-repo (`:62-149`). Completion text **is** in scope
at the branch point: `session.lastMessage` is read straight off the freshly-fetched magi session (`:64`,
`applyMagiSession(repo, session)` at `:65`), and the self-review branch parses it directly:

```ts
// foundationHandlers.ts:128-148
if (session.status === 'done' && repo.pendingFollowUp?.kind === 'self_review') {
  const { fields } = parsePromptResult(session.lastMessage ?? '')
  const reviewStatus = (fields['Status'] ?? '').trim().toLowerCase()
  const reviewIssues = (fields['Review'] ?? '').trim()
  if (reviewStatus !== 'approve' && reviewIssues) {
    await queue.enqueueOnce({
      taskId: task._id,
      kind: 'self_review_fix',
      dedupeKey: `selfreviewfix:${task._id.toString()}:${repo.projectPath}`,
      payload: { projectPath: repo.projectPath, reviewIssues },
    })
  }
  repo.pendingFollowUp = undefined
} else if (session.status === 'done' && repo.pendingFollowUp?.kind === 'self_review_fix') {
  repo.pendingFollowUp = undefined // two-pass bound: never re-review
} else if (
  (session.status === 'failed' || session.status === 'cancelled') &&
  (repo.pendingFollowUp?.kind === 'self_review' || repo.pendingFollowUp?.kind === 'self_review_fix')
) {
  repo.pendingFollowUp = undefined // pass crashed; the guard already kept the task in review
}
```

Splice point: this `self_review`/`self_review_fix` branch sits **inside the per-repo loop, immediately after** the
generic branch/PR-field mapping (`:64-124`, including the SS-03 loop-pin at `:113-119` that forces `mapped =
'review'` while a self-review pass is in flight) and **before** the loop closes (`:149`). It runs on the SAME
per-repo iteration as — but as a _separate, additional_ branch from — the generic `resultMessage`/`replyMarkdown`
handling that happens later, once, after the loop (`:191-201`, using `parsePromptResult` again on the
task-level `resultMessage`). It is **not** a replacement for the generic Title/Description/Reply path; both run.
The generic path harmlessly no-ops for a self-review completion because `Title`/`Description`/`Reply` are absent
from a `RESULT_FORMAT_SELF_REVIEW` block, so `hasValidResultFields(fields)` (consumed at `:194`) returns false and
no `replyMarkdown` is built.

Trigger for "a completion just happened": **`session.status === 'done'`** (magi's own terminal-success status for
the child session), not a task-level status transition — this is deliberate, since Component A's loop-pin (`:113-
119`) keeps the _task_-level `mapped` status pinned at `'review'` throughout the self-review pass, so a task-status
transition can't be used as the trigger; only the repo's own `session.status` can.

**2. `RESULT_FORMAT_SELF_REVIEW` Status values.**
`prompts.ts:876-879`:

```ts
export const RESULT_FORMAT_SELF_REVIEW = [
  'Status: <approve | approve_with_comments | request_changes>',
  'Review: <issues text. Leave empty if Status=approve>',
].join('\n')
```

Three literal values: `approve`, `approve_with_comments`, `request_changes`. The shipped branch mapping
(`foundationHandlers.ts:132`) is **`reviewStatus !== 'approve' && reviewIssues`** — i.e. it does not special-case
`approve_with_comments` vs `request_changes`; both fall into "fix" _only if_ `Review` text is non-empty, and
`approve` (or any other/blank/unparseable value) with no issues text always defaults to "no fix, mark done" — this
matches the spec's required safe default ("unparseable / missing / no Review issues → never block"). Confirmed by
test `SS-05: an unparseable self_review verdict clears the marker and enqueues nothing`
(`tests/supervisor/foundationHandlers.test.ts:919`).

`generateSelfReviewFixPrompt` signature, confirmed at `prompts.ts:988`:

```ts
export function generateSelfReviewFixPrompt(reviewIssues: string, gitlabUserName: string): string
```

Contrary to the spec's ground-truth note ("already exists … and is unused"), it **is** used — at
`selfReviewFixHandlers.ts:40`, wrapped in `prependOperatingInstructions(task.outputLanguage, …)`.

**3. `parsePromptResult` / field extraction.**
`prompts.ts:562-575` (`KNOWN_RESULT_FIELDS`) includes both `'Status'` and `'Review'`. `parsePromptResult(result,
secrets?)` (`prompts.ts:780-830`) returns `{ fields: Record<string,string>, cleanOutput: string }` by regex-matching
a `[RESULT]…[/RESULT]` block and only capturing lines whose key is in `KNOWN_RESULT_FIELDS`; `fields['Status']` and
`fields['Review']` are read exactly this way at `foundationHandlers.ts:130-131` (quoted above).

**4. `botUsername` source in a handler.**
`makeSelfReviewFixHandler(gitlabUserName: string = 'nerv-agent')` (`selfReviewFixHandlers.ts:20`) takes the bot
username as a plain constructor argument, not from `HandlerCtx`. It's wired at registration time in
`src/index.ts:71`: `registry.register('self_review_fix', makeSelfReviewFixHandler(cfg.botUsername))` — the same
`cfg.botUsername` config value used for `review_comment`/`pipeline_failure` at `index.ts:95-96`. (Pass-1's
`makeSelfReviewHandler` doesn't need a username at all — `generateSelfReviewPrompt` takes no username argument.)

**5. WorkItem kind registration.**
`WORK_KINDS` (`src/db/models/WorkItem.ts:3`): `['review_comment', 'pipeline_failure', 'chat_instruction',
'reconcile', 'self_review', 'self_review_fix']` — both kinds already present. `WorkPayload`-equivalent union lives
as separate named interfaces in `src/domain/workPayloads.ts`, not a discriminated union; the relevant ones:

```ts
// workPayloads.ts:31-44
export interface SelfReviewPayload {
  projectPath: string
  mrIid?: number
}
export interface SelfReviewFixPayload {
  projectPath: string
  reviewIssues: string
}
```

Handler registration (`src/index.ts:70-71`):

```ts
registry.register('self_review', makeSelfReviewHandler())
registry.register('self_review_fix', makeSelfReviewFixHandler(cfg.botUsername))
```

Both are registered **unconditionally** (a comment at `index.ts:67-69` notes `self_review` must not be gated behind
forge-connection config, since its trigger is `project.selfReviewEnabled`, independent of nerv's own forge access).

**6. Disambiguation safety.**
The spec's stated risk — a `reviewing`-phase repo's next completion might be an unrelated interleaved coding
completion — is mitigated exactly as the spec suggested ("record the pending self-review … turn so the branch only
fires for the right session"): `repo.pendingFollowUp = { kind: 'self_review' }` is set at dispatch time
(`selfReviewHandlers.ts:57`) on the **same repo record** whose `magiSessionId` was just repointed to the review
child session (`:56`). Since a repo has exactly one live `magiSessionId` at a time and follow-ups repoint it
in-place, `session.status === 'done'` observed for that repo **is** the completion of whichever child the marker
names — there is no concurrent second session on the same repo to interleave with. This is reinforced by the SS-03
loop-pin (`foundationHandlers.ts:113-119`): while `pendingFollowUp.kind` is `self_review`/`self_review_fix`, the
task-level mapped status is forced to stay `'review'`, so no other work (e.g. a fresh `review_comment` follow-up,
which only fires on tasks already sitting in `review` via the forge-poll sweep) can repoint the same repo's
`magiSessionId` out from under the in-flight self-review pass. Confirmed by test `non-self_review marker (review
fix) is NOT guarded: a running child drives the task review→coding (follow-up now observed)`
(`tests/supervisor/foundationHandlers.test.ts:982`), which exists specifically to show the guard is scoped to
self-review markers only, not a blanket freeze.

---

## Decision-of-record cross-check (spec §"Decisions of record" vs. shipped code)

| #   | Spec decision                                                                                                                      | Shipped reality                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | nerv-only, reconcile tagging, no magi change                                                                                       | ✅ matches — `pendingFollowUp` tagging + reconcile branch, magi only sees `followUp` calls                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 2   | Single round (kiss parity); fix is not re-reviewed                                                                                 | ✅ matches — `foundationHandlers.ts:141-142` clears the marker on `self_review_fix` completion unconditionally, "two-pass bound: never re-review"                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 3   | Reuse `generateSelfReviewFixPrompt`, WorkItem+dedupe, FU3 `item._id` idempotency keys, FU5a `isOverBudget` gate                    | ✅ matches — `selfReviewFixHandlers.ts:29-42` uses `isOverBudget`/`applyCostCapBreach` and `selfReviewFixIdempotencyKey(taskId, projectPath, item._id.toString())`                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 4   | Rides `Project.selfReviewEnabled` (default `true`), single-repo (`taskRepositories[0]`)                                            | ✅ matches — `foundationHandlers.ts:174-186` reads `project?.selfReviewEnabled` and only ever touches `task.taskRepositories[0]`                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 5   | **`selfReviewPhase` is sticky at `done` per task** — a later legitimate re-entry into `review` does **not** re-trigger self-review | ⚠️ **diverges.** The shipped code has no per-task "already reviewed once, forever" sticky flag. `idempotencyKeys.ts:39-42` states the shipped intent explicitly: _"a `review -> coding -> review` cycle re-enqueues a FRESH WorkItem for each self-review pass, and each one legitimately needs its own key."_ The enqueue guard at `foundationHandlers.ts:173` fires on every fresh `statusChanging && target === 'review'` transition, with no memory of a prior self-review having already run on this task. See Task 5 below — this needs a product decision, not a silent "already done." |

---

## Tasks (verification, not build — see headline finding)

Because no code is missing, each task below **replaces** "write a failing test → implement" with "run the exact
already-passing test(s) that cover this spec requirement, and read the exact code that satisfies it." Every command
is real and was executed during this plan's authoring. If any command's actual output ever stops matching what's
recorded here, that is a real regression — file it as a bug against `main`, not against this plan.

### Task 1: Verify Component A — tag the self-review turn (dispatch marker + enqueue guard)

**Files (read-only, already correct):**

- `src/db/models/Task.ts:22,26-28,58,108-110,126` — `FollowUpKind`, `PendingFollowUp`, `pendingFollowUp` field + schema
- `src/supervisor/selfReviewHandlers.ts:32-61` — `makeSelfReviewHandler` sets `repo.pendingFollowUp = { kind: 'self_review' }` at `:57`, alongside `task.lastActivity`/`task.save()` at `:59-60`
- `src/supervisor/foundationHandlers.ts:173-187` — enqueue guard (fires only on a fresh `statusChanging && target === 'review'` transition, gated on `project?.selfReviewEnabled`)
- Test: `tests/supervisor/foundationHandlers.test.ts:565-639`, `tests/supervisor/selfReviewHandler.test.ts:31-71`

- [ ] **Step 1: Run the enqueue-guard tests**

Run:

```bash
cd /Users/ki/Projects/yourpapai/nerv
npx vitest run tests/supervisor/foundationHandlers.test.ts -t "self_review"
```

Expected: `PASS` — includes `transitioning to review with a selfReviewEnabled project enqueues exactly one
self_review, and a second reconcile does not duplicate it`, `transitioning to review WITHOUT a selfReviewEnabled
project does not enqueue self_review`, `transitioning to review with no Project registry available … does not
enqueue self_review`, and the four `self_review guard: …` cases (`:775-871`).

- [ ] **Step 2: Run the pass-1 dispatch-marker tests**

Run:

```bash
cd /Users/ki/Projects/yourpapai/nerv
npx vitest run tests/supervisor/selfReviewHandler.test.ts
```

Expected: `PASS`, 5 tests — `happy path: sends a self-review follow-up prompt …` (`:31`), `threads the task's
configured outputLanguage …` (`:72`), `no session: does not call followUp …` (`:97`), `passes a per-dispatch
idempotencyKey keyed on item._id … distinct across two self-review cycles` (`:116`), `over budget: skips the
dispatch …` (`:146`).

- [ ] **Step 3: Confirm no code change needed**

Re-read `selfReviewHandlers.ts:32-61` and `foundationHandlers.ts:173-187` against Component A's spec text
(tag on dispatch; guard fires once per fresh transition into `review`; gated on `selfReviewEnabled`; single-repo
`taskRepositories[0]`). All three requirements are met by the code as-is — no edit required. If you were tempted to
add a `selfReviewPhase` field per the spec's literal wording, don't: it would duplicate `pendingFollowUp.kind`,
which already carries the same disambiguation signal and is what the loop-pin (`:113-119`) and SS-05 routing
(`:128-148`) already key off of.

- [ ] **Step 4: No commit** — nothing changed. `git status --short` must remain empty.

---

### Task 2: Verify Component C — `self_review_fix` work-kind + payload + idempotency key + handler + registration

**Files (read-only, already correct):**

- `src/domain/workPayloads.ts:37-44` — `SelfReviewFixPayload { projectPath: string; reviewIssues: string }`
- `src/db/models/WorkItem.ts:3` — `'self_review_fix'` in `WORK_KINDS`
- `src/domain/idempotencyKeys.ts:48-54` — `selfReviewFixIdempotencyKey(taskId, projectPath, workItemId) => \`${taskId}:${projectPath}:selfreviewfix:${workItemId}\``
- `src/supervisor/selfReviewFixHandlers.ts` — `makeSelfReviewFixHandler(gitlabUserName = 'nerv-agent')`
- `src/index.ts:71` — `registry.register('self_review_fix', makeSelfReviewFixHandler(cfg.botUsername))`
- Test: `tests/supervisor/selfReviewFixHandler.test.ts`, `tests/db/selfReviewFixEnums.test.ts`

- [ ] **Step 1: Run the fix-handler unit tests**

Run:

```bash
cd /Users/ki/Projects/yourpapai/nerv
npx vitest run tests/supervisor/selfReviewFixHandler.test.ts
```

Expected: `PASS`, 4 tests — `dispatches the fix prompt as a follow-up, repoints magiSessionId to the child, marks
self_review_fix, and is silent` (`:16`), `threads the task's outputLanguage into the fix prompt via the
operating-instructions preamble` (`:46`), `no session: does not call followUp and does not throw` (`:67`), `over
budget: skips dispatch, cancels the session, fails the task, and notifies` (`:83`).

- [ ] **Step 2: Run the schema/enum tests**

Run:

```bash
cd /Users/ki/Projects/yourpapai/nerv
npx vitest run tests/db/selfReviewFixEnums.test.ts
```

Expected: `PASS`, 2 tests — `accepts a WorkItem with kind self_review_fix` (`:12`), `accepts a TaskRepo
pendingFollowUp marker of kind self_review_fix` (`:22`).

- [ ] **Step 3: Confirm the isOverBudget gate + item.\_id idempotency key match FU5a/FU3 conventions**

Read `selfReviewFixHandlers.ts:29-42`:

```ts
if (isOverBudget(task)) {
  await applyCostCapBreach(task, magi, papai)
  return
}
const credentials = resolveMagiCredentials(projects?.getByContextId(task.contextRef.contextId), magiDefaults ?? {})
const fixPrompt = prependOperatingInstructions(
  task.outputLanguage,
  generateSelfReviewFixPrompt(payload.reviewIssues, gitlabUserName),
)
const idempotencyKey = selfReviewFixIdempotencyKey(task._id.toString(), repo.projectPath, item._id.toString())
const child = await magi.followUp(repo.magiSessionId, fixPrompt, credentials, idempotencyKey)
await tasks.recordFollowUpChildSession(task._id, repo.projectPath, child.id, 'self_review_fix')
```

This matches the spec's Component C requirement verbatim: budget-gated before dispatch, `item._id`-keyed
idempotency, `magi.followUp` with the fix prompt, and — via `tasks.recordFollowUpChildSession` (`src/services/
TaskService.ts:159`, the same helper `reviewHandlers.ts:89` and `ciHandlers.ts:92` use) — atomically persists the
repointed `magiSessionId` + `pendingFollowUp = { kind: 'self_review_fix' }` in one write, satisfying the "atomic
writes where mutating shared docs" convention (FU3) without a separate `task.save()` race.

- [ ] **Step 4: No commit** — nothing changed. `git status --short` must remain empty.

---

### Task 3: Verify Component B — reconcile branch on the pass-1 verdict

**Files (read-only, already correct):**

- `src/supervisor/foundationHandlers.ts:105-149` — the SS-03 loop-pin + SS-05 routing block (quoted in full under
  Assumption 1 above)
- Test: `tests/supervisor/foundationHandlers.test.ts:872-981`

- [ ] **Step 1: Run the SS-05 branch tests**

Run:

```bash
cd /Users/ki/Projects/yourpapai/nerv
npx vitest run tests/supervisor/foundationHandlers.test.ts -t "SS-05"
```

Expected: `PASS`, 7 tests (confirmed during this plan's authoring: `Test Files 1 passed | Tests 7 passed | 41
skipped`) — covering: `request_changes` → enqueues one `self_review_fix` carrying the issues + clears the marker
(`:872`); `Status approve` → enqueues nothing + clears the marker (`:897`); unparseable verdict → clears + enqueues
nothing (`:919`); `self_review_fix` completion → clears + enqueues no further work, "two-pass bound" (`:940`); a
running `self_review_fix` child stays pinned to `review` (`:963`); a non-self-review marker is _not_ guarded
(`:982`, the disambiguation-safety proof for Assumption 6).

- [ ] **Step 2: Confirm the exact `Status` mapping against `RESULT_FORMAT_SELF_REVIEW`**

Read `foundationHandlers.ts:130-132` again:

```ts
const reviewStatus = (fields['Status'] ?? '').trim().toLowerCase()
const reviewIssues = (fields['Review'] ?? '').trim()
if (reviewStatus !== 'approve' && reviewIssues) {
  /* enqueue self_review_fix */
}
```

This is a **binary** mapping — `approve` (or blank/malformed/no-issues) → no fix, `done`; anything else _with_
non-empty `Review` text → fix. It correctly folds both `approve_with_comments` and `request_changes` into "fix if
there's substance," which is a stricter, safer reading of the spec's 2-bucket branch than treating
`approve_with_comments` as non-blocking — confirm this is the desired behavior (it is: "approve with comments"
still means the reviewer found something worth noting, which the spec's testing strategy files under "Branch —
issues," not "Branch — approve").

- [ ] **Step 3: No commit** — nothing changed. `git status --short` must remain empty.

---

### Task 4: Verify the end-to-end lifecycle (review → self-review issues → fix → done, single round, no ping-pong)

**Files (read-only, already correct):**

- `src/supervisor/foundationHandlers.ts` (full reconcile handler)
- Test: `tests/supervisor/foundationHandlers.test.ts:872-981` (the SS-05 suite already chains dispatch → issues →
  fix-enqueue → fix-completion → done in sequential `it` blocks operating on the same fixture shape)

- [ ] **Step 1: Run the full foundationHandlers suite**

Run:

```bash
cd /Users/ki/Projects/yourpapai/nerv
npx vitest run tests/supervisor/foundationHandlers.test.ts
```

Expected: `PASS`, 48 tests (confirmed during this plan's authoring: `Test Files 1 passed (1)`, all 48 green,
~11s).

- [ ] **Step 2: Run the full suite to confirm no regression anywhere else**

Run:

```bash
cd /Users/ki/Projects/yourpapai/nerv
npx vitest run
```

Expected: `PASS` — confirmed during this plan's authoring: `Test Files 51 passed (51)`, `Tests 492 passed (492)`.
(Note: the task brief's stated baseline of "401 tests after FU5a" is stale relative to `main` @ `279a9b3`; the
self-review pass-2 work — commits `8c3736b`..`9cf06ab` plus surrounding SS-03/SS-04/SS-07/SS-08/SS-10 waves — has
already landed on top of it, bringing the count to 492.)

- [ ] **Step 3: Confirm single-round, no-ping-pong by re-reading the bound**

`foundationHandlers.ts:141-142` clears `pendingFollowUp` unconditionally on any `self_review_fix` completion
(`session.status === 'done'`), and nothing downstream re-enqueues `self_review` from a `self_review_fix` context —
the only `self_review` enqueue site is the fresh-transition-into-`review` guard at `:173-187`, which Task 5 below
addresses. Within a single review→fix cycle, the bound is airtight: `self_review` → (issues) → `self_review_fix` →
done, never `self_review_fix` → `self_review` again. Confirmed by test `SS-05: a self_review_fix child done clears
the marker and enqueues no further work (two-pass bound)` (`:940-957`).

- [ ] **Step 4: No commit** — nothing changed. `git status --short` must remain empty.

---

### Task 5 (decision, not implementation): resolve the Decision-of-Record #5 divergence

This is the one genuine open item this investigation surfaced — not a missing feature, but an **unresolved product
decision** between what the spec asked for and what shipped.

- **Spec (Decision of Record #5):** self-review should run **at most once per task, ever** ("sticky at `done`"). A
  later legitimate re-entry into `review` (e.g. after a human review-comment fix cycle sends the task back to
  `coding` and it returns to `review`) must **not** re-trigger self-review.
- **Shipped (`idempotencyKeys.ts:39-42`, `foundationHandlers.ts:173-187`):** self-review re-runs on **every** fresh
  transition into `review`, by design — the comment explicitly frames this as intentional ("each one legitimately
  needs its own key"), not an oversight.

Both are defensible: the spec's version bounds total self-review cost/turns per task to a hard cap of 2 extra
turns; the shipped version re-reviews genuinely new code after every re-code cycle, which is arguably more useful
(a review-comment fix is new code that deserves its own QA pass) but has no per-task cap on self-review
turns/cost (it's still bounded per _cycle_ — two turns — just not per _task_).

- [ ] **Step 1: Get a product decision** — ask whether the spec's "once per task, ever" cap is a hard requirement
      or whether the shipped "once per re-code cycle" behavior is acceptable (likely preferable; it matches how
      `review_comment`/CI-fix cycles already behave — each gets fresh handling, not a stale "already handled you once"
      flag).

- [ ] **Step 2a: If "once per task, ever" is required** — add a genuinely new, this time real, gap: a per-task
      (not per-repo) sticky flag. Minimal shape, following the existing `TaskRepo` field-add pattern:

  Add to `ITask` in `src/db/models/Task.ts` (near `notificationState`, `:92-93`):

  ```ts
  /** Set once the task's single self-review round (pass-1 + optional pass-2 fix) has fully completed.
   * Prevents a later review→coding→review re-cycle from re-triggering self-review (Decision of Record #5). */
  selfReviewDone?: boolean
  ```

  and to the task schema (mirroring `lastStaleNotificationAt`'s plain-field pattern), then:
  - guard the enqueue at `foundationHandlers.ts:176` with `&& !task.selfReviewDone`
  - set `task.selfReviewDone = true` alongside both `pendingFollowUp = undefined` clears at `:140` and `:142`

  Write the failing test first — extend `tests/supervisor/foundationHandlers.test.ts` with a case that: creates a
  task, drives it through one full self-review round (`self_review` done with `approve`, marker cleared), then
  drives a second `review`-transition (task→`coding`→`review` again) and asserts `WorkItem.countDocuments({ taskId:
t._id, kind: 'self_review' })` stays `1`, not `2`. Run it (`npx vitest run tests/supervisor/
foundationHandlers.test.ts -t "does not re-trigger"` or similar), confirm it fails against current `main`, then
  add the two-line guard + set, rerun, confirm it passes, then `bun run type-check` and commit as its own
  `feat(nerv): selfReviewDone sticky guard prevents review-cycle re-trigger (FU5b)` commit.

- [ ] **Step 2b: If the shipped "once per cycle" behavior is acceptable** — no code change. Update the FU5b spec's
      Decision of Record #5 (in `papai/docs/superpowers/specs/2026-07-16-followups-fu5b-self-review-pass2-design.md`)
      to describe the shipped behavior instead, so the spec stops contradicting `main`. (Editing the spec is a papai-
      repo doc change, out of scope for this nerv-only plan file — file it as a one-line spec-correction follow-up.)

**Do not execute Step 2a speculatively.** It is scaffolded here so the decision, once made, is a 15-minute TDD
task rather than a fresh investigation — but making the sticky-flag change without an explicit "yes, once per task"
answer would silently narrow real, already-shipped, already-tested behavior.

---

## Self-review

**Spec coverage.** Component A → Task 1. Component B → Task 3. Component C → Task 2. End-to-end lifecycle testing
bullet → Task 4. All six "Testing strategy" bullets in the spec map onto tests enumerated in Tasks 1–4 (enqueue
guard: Task 1 Step 1; approve branch: Task 3 Step 1 `Status approve` case; issues branch: Task 3 Step 1
`request_changes` case; unparseable branch: Task 3 Step 1 unparseable case; fix handler incl. budget gate +
idempotency + no-session: Task 2 Steps 1 & 3; single round: Task 3 Step 1 two-pass-bound case + Task 4 Step 3;
end-to-end: Task 4. All six "Open assumptions" resolved above with file:line quotes, not guesses.

**Placeholder scan.** No "TBD"/"implement later"/"add appropriate handling" — every step names the real command,
real file:line, and real expected output captured by actually running it during authoring. The one place this plan
withholds a concrete diff (Task 5 Step 2a) is by design — it's gated behind an explicit human decision this plan
cannot make unilaterally, and the shape given is a complete, minimal, correctly-typed field-add + two guard edits,
not a vague TODO.

**Type/name consistency.** `pendingFollowUp.kind` values (`'self_review'`, `'self_review_fix'`), `WORK_KINDS`
entries, `SelfReviewFixPayload` field names (`projectPath`, `reviewIssues`), and `selfReviewFixIdempotencyKey`'s
signature are quoted identically, once each, from the single source files that define them — cross-checked against
every place they're referenced (`foundationHandlers.ts`, `selfReviewFixHandlers.ts`, `selfReviewHandlers.ts`,
`workPayloads.ts`, `idempotencyKeys.ts`, `Task.ts`, `WorkItem.ts`, `index.ts`) and found consistent everywhere. No
naming drift found — a genuine relief given the spec proposed a field name (`selfReviewPhase`) that doesn't
actually exist in the codebase; that mismatch is called out explicitly at the top of this plan rather than
silently planned around.
