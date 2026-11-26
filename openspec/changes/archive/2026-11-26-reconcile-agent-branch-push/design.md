## Context

See proposal.md — Why for the incident (run 32374999214, PR #313: a maintainer pushed merge `1f7ce71b` to `agent/issue-305` mid-review; every subsequent pipeline push was rejected non-fast-forward; five review fixes died with the runner; the run parked in `FAILED` inviting a full-loop `/retry`).

Today's push path is `Git.push` in `opencode-agent/src/git.ts:271` — `git push [-u|--no-verify] origin <branch>` — called from six sites (`review-push.ts`, `implement-commit.ts`, `ci-fix.ts`, `plan.ts`, `triage.ts`, `salvage.ts`). `ensureBranch` fetches the branch exactly once at phase entry; a review loop then runs for hours. The branch is shared with humans by design (the PR invites maintainer commits), but no push reconciles with what happened since the fetch.

## Goals / Non-Goals

**Goals:**

- One reconcile implementation at the `Git` layer; every agent-branch push call site gets it without per-phase edits.
- Preserve the existing failure semantics per call site (mid-loop warn, final push fatal).
- Keep the credential in the pipeline-side git child env only.

**Non-Goals:** (beyond proposal.md's)

- No change to `ensureBranch` semantics or call ordering.
- No change to `review-loop/` — it stays remote-blind.
- No push-retry/backoff loop; one reconcile attempt per push.

## Decisions

### D1. Reconcile inside `Git.push`, plus one explicit pre-call on the review path

`push(branch)` becomes: `git fetch origin <branch>` → if `refs/remotes/origin/<branch>` is absent, plain push (first push); if `git merge-base --is-ancestor origin/<branch> HEAD` says yes, plain push; otherwise `git merge --no-edit origin/<branch>`, then push.

On the review path an ordering wrinkle forces one extra seam: `pushIfMoved` in `phases/review-push.ts` runs `dropUnpushable` (revert protected paths, e.g. `.github/workflows/`, since a push cannot carry them) **before** the push. A reconciling merge that lands *after* that check could smuggle a protected path in from the human's line, and GitHub refuses the **whole push** for one workflow file (the issue #240 failure class). So `Git` gains `reconcile(branch)` as its own operation, `push()` calls it first (single definition), and `review-push.ts` calls `reconcile` before `dropUnpushable` — after which `push()`'s internal reconcile is an idempotent no-op (ancestor check passes). Cost: one extra fetch round-trip on the review path, sub-second.

*Alternative rejected:* reconcile only inside `push()` — smaller diff, but re-opens the per-push protected-path refusal on exactly the phase that guards against it.

### D2. Merge, never rebase, never force

A merge preserves both lines and matches what the human did in the incident (`1f7ce71b` is itself a merge of the agent's fix). A rebase would rewrite commits the review loop's `primary` branch shares history with (its publish merges `primary` into the checkout expecting shared ancestry) and rewrites what was already pushed where the human already built on it. Force-push discards human work. Merge-commit identity comes from the existing author/committer stamping, like every other commit this pipeline makes.

### D3. Conflict = abort, clean tree, named paths, `GitError`

On `CONFLICT` from the merge: read `git diff --name-only --diff-filter=U`, `git merge --abort`, throw `GitError` whose message names the conflicted paths. No new error class (one-class-per-file rule; `GitError` already carries the failing `CommandResult`). Mid-loop this degrades to today's warn; the final push fails the run with paths a maintainer can act on. Any non-conflict merge failure also aborts the merge (leaving a clean tree) before propagating.

### D4. Graceful degradation where merge cannot run

If the checkout's index is locked (the loop's own publish merge into the checkout runs `git merge` in the same repo — small contention window) or the tree is dirty, git refuses the merge; the failure propagates as today's `GitError` → warn mid-loop, fatal on the final push (which retries the whole reconcile at a quiet moment). No lock-waiting, no retry loop.

*Alternative rejected:* serialize the pipeline's reconcile against the loop's primary lock — the lock lives in the loop's process; sharing it across the pipe inverts the credential boundary for no rare-case gain.

### D5. Tests at the argv-seam, no filesystem

`Git` is built on the injected `CommandRunner`; the existing suites (`tests/opencode-agent/adapters.test.ts`, `diff-guard.test.ts`) already assert exact git argv through a fake runner. New cases follow that pattern: remote-ahead → fetch/merge-then-push sequence; ancestor → no merge; branch absent → plain push; conflict → abort + throw naming paths; never `--force`. The `review-push` ordering (reconcile before `dropUnpushable`) is asserted in the `phases.test.ts` fake, which already refuses driver calls before `ensureBranch`.

## Risks / Trade-offs

- [Reconciling merge brings human commits the agent then pushes] → Same trust domain the checkout already holds (`ensureBranch` fetched the branch at entry); protected paths are reverted by `dropUnpushable` after the explicit reconcile (D1 ordering), and `push` never force-pushes.
- [Human pushes again between reconcile and push] → Push rejected as today; mid-loop warn / final-push failure with the resume point intact. One reconcile attempt per push is the deliberate bound.
- [Merge commit confuses `pushedAt`/`changedSince` bookkeeping in `review-push`] → Both compare SHAs before/after; a merge moving HEAD only makes the next `pushIfMoved` see "moved" and push — the correct direction.
- [Existing argv assertions break (`adapters.test.ts:2555`, `diff-guard.test.ts:437`)] → Updated in the same task as the implementation; they are the contract this change deliberately edits.

## Migration Plan

Ship as one PR; no state, config, or workflow changes — the reconcile is invisible until a remote advance occurs, and no `STATE_VERSION` bump is involved. Rollback = revert the commit; behavior returns to today's (fail on non-fast-forward).

## Open Questions

None — the incident fixes the shape; the remaining unknowns (how often humans push mid-review) only affect frequency, not design.
