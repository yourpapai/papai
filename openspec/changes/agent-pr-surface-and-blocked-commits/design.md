<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design: A blocked commit is reported, and the pull request is the surface

## Context

See `proposal.md` — Why. Two constraints shape everything below.

`stageAllowed` (`git-commit.ts`) is the mechanism and stays one: it drops rather
than refuses, and reverts the working-tree copy so the next `git add --all`
cannot re-stage it. Nothing here weakens that. What changes is that its verdict
stops being swallowed by `commitAll`'s `StagedTotals | null`, where `null`
currently means both "the tree was clean" and "everything the turn wrote was
refused".

`findLatestState` scans exactly one thread, which is the entire reason
`feedback-target.ts` splits "where a run speaks" from "where it remembers". The
surface move cannot be done by relocating comments alone; the scan has to follow
them, or the record silently stops being restorable.

## Goals / Non-Goals

**Goals:**

- A caller of `commitAll` can tell a clean tree from a blocked one, and name
  what was blocked.
- Every comment a run makes lands where the maintainer is reading, with the
  record still restorable from a single, ordered read.
- A round that pushed nothing says so in terms a maintainer can act on.

**Non-Goals:**

- Any change to what `PROTECTED_PREFIXES` contains.
- Isolating `runCheckLoop` from the repair turn's own side effects (see Risks).
- A new model turn to tell the agent its edit was dropped (see Decision 3).

## Decisions

### D1 — `commitAll` returns a discriminated union, mirroring `Salvage`

`Promise<StagedTotals | null>` becomes a three-member union in the shape
`salvageAll` already uses: `{ kind: 'clean' }`, `{ kind: 'committed'; totals;
dropped }`, `{ kind: 'blocked'; dropped }`. `salvageAll`'s comment already
states the principle — "its return type is the point" — and this is the same
argument one function over: clean, blocked and committed-with-a-partial-drop are
three ordinary outcomes that each earn a different sentence.

`dropped` rides on the `committed` member too, because a partial drop is the
case most likely to mislead: work was pushed, so every existing signal reads as
success, while part of the fix silently is not there.

*Alternative rejected:* a second `commitAll` variant, or an out-parameter. Both
leave `null` ambiguous at the call sites that don't opt in, which is exactly the
defect.

*Cost:* touches every caller — `implement-commit.ts`, `phases/ci-fix.ts`,
`phases/review.ts`, `commit-repair.ts`. `changedLines` continues to ride out on
the `committed` member, so the state block is unaffected.

### D2 — The prompts state the rule in every phase that can write files

`CI_FIX_INSTRUCTIONS` and `plan-draft.ts`'s two instruction blocks gain the
clause `IMPLEMENT_INSTRUCTIONS` carries. The prompts remain the courtesy and
`stageAllowed` remains the mechanism — this only closes the gap where the phase
most likely to want a workflow edit was the one never told.

### D3 — The drop is carried forward as prompt text, not as a model turn

A dropped path is recorded in `AGENT_STATE` and named in the next round's
prompt ("a previous round's fix was blocked at `<path>`; it cannot be pushed —
do not re-derive it"). No extra turn is spent telling the model its edit was
dropped.

Rationale: the useful audience is the maintainer, and the report already reaches
them. A turn spent saying "your edit was blocked" buys advice the report gives
for free, and when the fix is entirely a workflow edit — as in run 31779566286 —
there is no other action for the model to take.

*Not `commitWithRepair`:* only a `GitError` is repaired there, deliberately. A
protected-path drop is not a rejected commit; the commit succeeds, or there is
nothing left to commit. Routing it through the repair rounds would blur the one
distinction that keeps "no number of rounds may talk this into committing a
staged credential" true.

### D4 — Once a pull request exists, comments and the scan both move to it

`postAndAppend` writes to `feedbackTarget(state)` rather than to
`input.issue.number`, so body **and** block land on the pull request once
`prNumber` is set. The objection this used to face — a block there is a second
source of truth the scan cannot see — is answered by moving the scan, not by
splitting the write.

Restore becomes two passes: scan the issue, and if the newest block there names
a `prNumber`, scan that thread too and take the newest block across both,
ordered by creation time. The issue thread always carries blocks from before the
pull request existed, including the one that first recorded `prNumber`, so the
first pass can always bootstrap the second. The extra API call happens only
after a pull request exists. `renderThread` merges the same two threads, so the
model's conversation window follows the conversation.

*Alternative rejected:* render on the pull request and keep the record on the
issue through `persistState`. It is the `postAnswer` precedent, but that path
rewrites the newest block **in place** — which is correct for an answer, whose
whole point is that it changes nothing but the spend, and wrong for a record.
Blocks appending in order is load-bearing: `findHandoff` and the report reads
walk newest-first and rely on a superseded block still being there. It would
also make a best-effort channel the only durable state write.

*Consequence:* `postAnswer`'s special case collapses into the general rule and
can be simplified to the state-rewrite half.

### D5 — The review loop's push is guarded by reverting, not by refusing

The loop commits in its own worktree and merges; `review-push.ts` pushes the
branch, so `stageAllowed` never sees those files and a workflow edit fails the
**push** — losing every finding the loop made.

Before pushing, `review-push.ts` diffs the branch against the last pushed sha,
and if the new commits touch a protected path, commits a revert of just those
paths and pushes that. This keeps `stageAllowed`'s principle — drop rather than
refuse, because refusing here loses exactly the work the remote would have
lost — and reports what it reverted.

*Alternative rejected:* pass the protected prefixes into the generated
`review-loop.json` so the loop's own commits never contain them.
`ReviewLoopConfigSchema` (`review-loop/src/config.ts`) has no exclusion option,
so this route means changing a second workspace to serve one caller's privilege
constraint — and the guard would then live where the pipeline cannot enforce it.
The pre-push check keeps the rule on the side of the boundary that owns the
credential, which is the same reason the push itself is not inside the loop.

### D6 — A green verdict is reported as scoped, not as a fact about the branch

When nothing was pushed, the report no longer presents `outcome.passed` as the
branch's state. It says the checks passed **in this job** and that the branch is
unchanged. This is wording, not isolation: see Risks.

## Risks / Trade-offs

- **A repair turn can make checks pass by mutating its own runner, and the loop
  cannot tell.** Run 31779566286 hand-ran `bun run build:client` and
  `docker pull` before its final round, so "✅ green after 2 rounds" described a
  runner, not a tree. → D6 makes the wording honest. Real isolation is out of
  scope and left as a follow-up; without it, a green verdict on an unpushed
  round remains weak evidence.
- **The two-thread scan doubles the surface a malformed block can come from.** A
  state block is attacker-editable text on both pages now. → The existing schema
  parse and `Object.hasOwn` reads are unchanged and apply to both; the merge is
  by creation time only, with no trust in which page a block came from.
- **In-flight issues span the move.** An issue mid-run when this ships has its
  newest block on the issue and its next block on the pull request. → The
  two-pass scan reads both by construction, so no migration and no
  `STATE_VERSION` bump is needed. Rollback re-reads the issue thread and would
  miss blocks written to the pull request in the interim — one-way in the same
  narrow sense `INCOMPLETE` was.
- **The issue thread goes quiet after delivery.** Someone watching only the
  issue sees the conversation stop. → `commandPointer` already names the pull
  request on every comment before the move, so the last thing the issue says is
  where to look.
- **A blocked round still spends a `ciAttempt`.** Chosen deliberately: the round
  cost tokens, and the budget exists to stop a branch bouncing off CI forever. →
  The report now names the blocking file, so the spend is explicable rather than
  looking like three identical no-ops.

## Migration Plan

No data migration and no `STATE_VERSION` bump — D4's scan reads both threads, so
existing blocks restore unchanged. Ship D1–D3 first: they are independently
verifiable, fix the loop that motivated the change, and touch none of the
restore path. D4 lands second and is the only step with a rollback caveat. D5
lands last and is independent of both.

## Open Questions

None. The one that mattered — whether `review-loop/` could exclude paths itself —
is settled in D5: its config schema has no such option.
