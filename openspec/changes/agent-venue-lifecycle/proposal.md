# One active venue per lifecycle — issue until the PR opens, PR forever after

## Goal

The opencode-agent pipeline (GitHub Actions issue agent) gets exactly one active conversation venue per issue at any moment: the **issue** until a pull request exists, the **pull request** from the moment it opens — including the run that opens it — and forever after, whether that PR is open, merged, or closed without merge. Every trigger is judged against the active venue and every report-emitting site writes to it through one decision point; the inactive surface goes fully quiet (no runs started, no comments, no reactions).

Today the surface is ambiguous, verified in code:
- Issue comments (slash and plain) still start work after the PR exists — `applyTrigger` has no venue gate; plain issue comments post-PR even buy classifier turns (`src/triggers.ts:76-90`).
- Plain PR comments are dropped before lookup (`PR_NO_COMMAND`, `src/pr-trigger.ts:161-168`; mirrored by the workflow's slash-body filter in `agent-pipeline.yml`).
- The PR-opening run posts its delivery report as the **last** comment on the issue, because `ReplyBuffer.begin` fixes the surface from the state the run *entered* on (`src/reply-buffer.ts:147`) — the documented "one-comment lag" that exists only so `readThread` can learn `prNumber` from the issue's newest block (`src/orchestrator.ts:114-124`).
- Merged/closed PRs refuse every comment (`PR_NOT_OPEN`, `src/pr-trigger.ts:177-179`), while `/follow-up` alone is carved out to the issue (`commandSurface`, `src/feedback-target.ts:68`) — so `/follow-up` on a merged PR works only from the issue, and `/ask` on a merged PR is pointed to a PR that then refuses it.

## Venue matrix (pinned by tests)

| Lifecycle stage | Surface | Type | Run triggered? | Response lands |
|---|---|---|---|---|
| pre-PR | issue | slash | yes | issue |
| pre-PR | issue | plain | classifier → per intent | issue |
| post-PR (open **or** merged **or** closed) | issue | slash | **no — dropped** | nothing (quiet) |
| post-PR (open/merged/closed) | issue | plain | **no — dropped** | nothing (quiet) |
| post-PR (open/merged/closed) | PR | slash | yes | PR |
| post-PR (open/merged/closed) | PR | plain | classifier → per intent | PR |
| foreign/PR the agent didn't open | PR | any | no (`PR_FOREIGN_REPOSITORY` / `PR_NOT_AGENT_BRANCH` stay) | — |

Transition moment: the delivery run's one comment (report + the `AGENT_STATE` block first recording `prNumber`) is the **first comment on the PR**, not the last on the issue. Issues that never get a PR behave exactly as today.

## Intended behaviour change

1. **Trigger venue gate (one decision point).** In `applyTrigger`, before any routing: an issue-surface event while the restored state has `prNumber !== null` is dropped — warn log only, no model turn, no comment, no reaction, persisted state untouched. This is the "hard rule with teeth": commands typed on the issue after the PR exists are **silently dead**, not pointed elsewhere (recorded assumption A1 — the issue demands "issue comments no longer start runs" and "fully quiet", and calls today's pointer replies a hint). This retires `commandSurface`'s origin refusal, `commandBelongsOnPr`, `renderCommandElsewhere`, the `commandPointer` hint line, and the `/follow-up` issue-surface carve-out (issue #441's exception — "no fallback to the issue").
2. **PR door admits plain comments; merged/closed PRs stay resolvable.** `PR_NO_COMMAND` and `PR_NOT_OPEN` are retired from `resolvePullRequestTrigger`; fork guard and `PR_NOT_AGENT_BRANCH` stay. A plain PR comment on the agent's PR buys the same intent classification a plain issue comment gets pre-PR (clarify default, waiting-phase question default, steering in `REVIEW_AND_MUTATE`) — assumption A2, reading the issue's "reacts to comments… slash commands and plain replies alike" symmetrically and its problem bullet #2. Cost, documented: the workflow's PR-comment arm drops its slash-body filter, so every PR comment repo-wide boots `resolve` + one head lookup (non-agent branches resolve to an empty issue number and never boot the agent job).
3. **Command acceptance on merged/closed PRs** is decided by the existing state-level predicates (`COMMAND_APPLIES`, transition table) — `/follow-up` and `/review` apply in a delivered `COMPLETE` state regardless of PR state; refusals echo on the PR. The red-CI door (`settledPullRequest`) is unchanged (assumption A3: the issue's matrix is about comments).
4. **Restore no longer bootstraps from the issue's newest block.** `readThread` resolves `prNumber` from the event payload (`pull-request`, `pr-merged` kinds), else the newest issue block (legacy path), else `findPullRequest(agent/issue-<n>)` (one API call; `state: 'all'`, newest — already exists for the CI door). Issue-first merge order and newest-wins are preserved; no `STATE_VERSION` bump. The venue-dead issue path drops before reading the PR thread.
5. **Write target resolved at flush.** `ReplyBuffer.flush` calls `feedbackTarget(latest ?? entry)` instead of `feedbackTarget(entry)` — `prNumber` is set once and never cleared, so the target is monotone; the lag's structural reason is gone (the scan has a new way in). Every report-emitting site (triage, spec, plan, implement, review loop, CI-failure, answers) already rides this one buffer, so `feedbackTarget` remains the single write-target function — no per-site special cases. Reactions keep following the triggering comment (assumption A4: an emoji is not output; the 👀/🚀 on the `/approve` that opened the PR stay on the issue).
6. **Workflow mirror.** `agent-pipeline.yml`: PR-comment arm loses the body filter; issue-comment arm gains a PR-existence lookup in `resolve` (gated to `issue_comment`, never `issues.opened`) so a post-PR issue comment never boots the agent runner; the in-process gate (1) stays as the authority. The workflow's fallback infra comment stays on the issue by design (it fires when no state could be restored). `workflow.test.ts` differential pins updated.

## Files to touch

- `opencode-agent/src/triggers.ts` — venue gate; unify PR/issue command + plain routing (`applyPullRequestCommand` folds into the shared conversation path).
- `opencode-agent/src/pr-trigger.ts` — retire `PR_NO_COMMAND` / `PR_NOT_OPEN`; rewrite the ordering doctrine (the head lookup is no longer command-gated).
- `opencode-agent/src/comment-intent.ts` — the three classifiers read `commentBody` off pull-request events too.
- `opencode-agent/src/orchestrator.ts` — `readThread` prNumber resolution (payload → block → `findPullRequest`).
- `opencode-agent/src/reply-buffer.ts` — flush-time `feedbackTarget`.
- `opencode-agent/src/feedback-target.ts` — `commandSurface` reduced/retired with the venue rule; `feedbackTarget` unchanged.
- `opencode-agent/src/run-post.ts`, `src/run-report.ts` — retire `commandPointer` / `renderCommandElsewhere`.
- `.github/workflows/agent-pipeline.yml` — arm conditions + `resolve` lookup.
- Tests: new `tests/opencode-agent/venue.test.ts` (the table-driven matrix above, including the transition moment and merged/closed cases, asserting both "was a run triggered" and "where the response landed" via persisted state); updates to `triggers`, `pr-trigger`, `feedback-target`, `orchestrator`, `comment-intent`, `guardrails`, `workflow`, `follow-up` suites — note the follow-up suite's "plain comment on a delivered PR still buys nothing" and the `commandSurface` carve-out pins are deliberately reversed here.
- Docs: `opencode-agent/CLAUDE.md` + `README.md` surface-rule sections.

## Verification

TDD: write `venue.test.ts` red first (matrix cells), then implement. Full gates green before finishing: `bun test`, `bun run typecheck`, `bun run lint`, `bun check:full`. The final report must name where the venue decision lives, the matrix covered, and maintainer-visible changes.

## Maintainer-visible behaviour changes

- After the PR opens, the issue thread is dead: comments there (commands included) do nothing at all — no reply, no reaction, no run. All commands, reports, review output and CI-failure notices appear on the PR, including on merged and closed PRs.
- `/follow-up` must now be typed on the PR (including a merged one); the issue no longer accepts it.
- The delivery report becomes the PR's first comment.
- Ordinary (non-slash) PR comments now engage the agent (answers, steering) instead of being ignored.
- Cost: every PR comment in the repo boots the cheap `resolve` job + one API call; issue comments gain one PR-existence lookup in `resolve`.

## Out of scope

Red-CI-run behaviour on settled PRs; the workflow fallback comment's surface; any persisted-state shape change (no `STATE_VERSION` bump; rollback is one-way in the same narrow sense as D4 — older code reading only the issue misses PR-thread blocks).
