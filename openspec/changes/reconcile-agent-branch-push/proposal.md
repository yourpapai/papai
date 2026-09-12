## Why

Run 32374999214 (PR #313) failed in `CODE_REVIEW` after a 3-hour review loop: `git push -u origin agent/issue-305` was rejected (`fetch first`). Root cause, reconstructed from the run log and branch history: a maintainer pushed to `agent/issue-305` *mid-run* (merge commit `1f7ce71b` at 14:42:22, parents: the maintainer's own commit and the agent's already-pushed fix `88dfb8a6`). The pipeline fetched the branch exactly once (`ensureBranch`, 13:34:35) and every later push assumed the remote had not moved. Result: five mid-loop fixes were silently unpushed (warn-only, "the final push tries again"), the final push failed the run, and the invited `/retry` re-runs a ~1M-token review loop from scratch — for a git bookkeeping issue. Without a fix, every long phase sharing `agent/issue-<n>` with a human (review is hours by design) fails this way whenever the human pushes.

## What Changes

- `Git.push` (opencode-agent `src/git.ts`) becomes a reconciling push for agent branches: before pushing, fetch the branch; if `origin/<branch>` has commits local HEAD does not contain, merge them (`--no-edit`, abort cleanly on conflict naming the conflicted paths) and push the merged result. Never force-push.
- A merge conflict during reconciliation is reported as a diagnosis (conflicted paths named), not git's opaque `fetch first` hint.
- All existing push call sites (`review-push.ts`, `implement-commit.ts`, `ci-fix.ts`, `plan.ts`, `triage.ts`, `salvage.ts`) get this behavior through the one `Git.push` seam; no per-phase changes. `archive.ts` (pushes the base branch) and `resetBranchToBase` (deliberate force-reset) are unchanged.

## Capabilities

### New Capabilities

- `agent-branch-push-reconciliation`: how the GitHub Actions agent pushes to `agent/issue-<n>` when the remote branch advanced since the phase's `ensureBranch` fetch — reconcile-by-merge before every push, conflict surfaced as a named-path failure, human commits never discarded. Without it, any human push during a multi-hour phase makes every subsequent push fail (mid-loop fixes lost with the runner, run parked in `FAILED` inviting a full-loop `/retry`).

### Modified Capabilities

None. `agent-commit-identity` (author/committer stamping) and the review-phase rules in `opencode-agent/CLAUDE.md` are untouched; no existing spec covers the push path.

## Non-goals

- Rebasing local commits instead of merging (a rebase rewrites what the review loop's `primary` branch shares history with; merge preserves both lines and matches what the human did in the incident).
- Re-fetching inside `ensureBranch` more often — the failure is not a stale checkout, it is pushes that never reconcile.
- Retry loops beyond one reconcile attempt per push; the existing per-call-site failure semantics (warn mid-loop, fatal final push) stand.
- Any papai runtime change: no platform/task instance, config-context, storage-context, or `tool_prefs` impact — this is entirely inside the `opencode-agent/` CI pipeline.
- Teaching `review-loop/` about remotes (the credential must stay on the pipeline side of the pipe).

## Impact

- Code: `opencode-agent/src/git.ts` (`push`, new reconcile helper), tests in `tests/opencode-agent/`.
- Docs: `opencode-agent/CLAUDE.md` (push-path rule), no `docs/architecture/*.md` — the incident and fix live in the workspace docs.
- No new dependencies; plain git argv through the existing `CommandRunner` with the existing per-invocation credential env.
