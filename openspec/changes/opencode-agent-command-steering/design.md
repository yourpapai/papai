<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev. Use of this software is governed by the Business Source License 1.1. See LICENSE in the project root for details. -->

## Context

See proposal.md — the command layer is signal-only today (`commands.ts` parses arguments, only `/ask` and `/changes` read them), and no handler touches the base branch after branch birth (`ensureBranch` in `git.ts` uses base only when the remote branch does not exist). The one conflict machine in the tree is review-loop's internal worktree merge. Two existing seams carry this change: `applyCommand`'s `/ask` branch (`triggers.ts`) is the non-moving side-operation precedent, and `commit-repair.ts` is the bounded model-repair-loop precedent. No papai scope model is involved: nothing here keys a storage/config context, no platform or task instance, no DB.

## Goals / Non-Goals

**Goals:**

- `/retry <note>` / `/continue <note>` arguments reach the resumed handler's prompt.
- `/sync` merges base into the agent branch from any PR-bearing state, without moving state.
- Every failure of `/sync` reports a remedy and leaves all existing triggers working.

**Non-Goals:** (proposal Non-goals plus design-level boundaries)

- No new phase, transition-table row, `PHASES` member, or presentation-table entry — that is what "non-moving" buys.
- No change to `ensureBranch`, `commitAll`, `stageAllowed`, `diff-guard` or `protected-paths` — the merge path is separate, not an exemption threaded through the commit path.

## Decisions

### D1 — Steering notes ride the existing argument, via one prompt-section helper

`PhaseInput` already carries the parsed command; the resumed handlers (implement from `resumeFrom`, continuation from `INCOMPLETE`) read `command.argument` when the command is `/retry`/`/continue`. One helper — the `findHandoff` pattern, a render function beside the prompts that use it — wraps the note into the enveloped prompt with fixed framing text: *guidance from the maintainer; the plan and change folder remain truth; `/changes` is the re-plan channel*. The framing constant is asserted by the same `instructions.test.ts` pattern that pins `MINIMALITY_RULE` and `PROTECTED_PATHS_RULE`, so a softened copy fails. No persistence: the note's lifetime is the prompt (spec: "Notes are not persisted state"). Alternative declined: a persisted `AGENT_NOTE` block — a second artefact channel for text that is consumed once, and one more block the restore scan walks past.

### D2 — `/sync` is the `/ask` shape: checked before the signal, absent from the transition table

`applyCommand` gains a branch beside the `/ask` one: `/sync` runs the side-op handler and returns without consulting `COMMAND_SIGNALS`. `COMMAND_APPLIES` grows a second row with `/review`'s exact predicate (`state.prNumber !== null`), so `acceptedCommands`' offer and the gate cannot drift. This dissolves every park/resume question: no phase moves, so the "no handler phase without a re-entering trigger" invariant holds trivially, `attempts` and per-PR budgets are untouched by construction, and `/sync` is its own resume point (type it again). Alternative declined: a `SYNC` signal into a `CI_FIX`-style phase — buys a resume point nobody needs and costs a transition row set, a presentation entry, an `OUT_OF_TIME` acceptance question, and a persisted-shape review.

### D3 — One handler module, three new `Git` operations, nothing through `commitAll`

`src/phases/sync.ts` (the `answer.ts` precedent: a handler that is not a phase). Sequence: `ensureBranch(branch, base)` → `mergeBase(base)` → on clean, `push`; on conflict, repair rounds → `completeMerge()` → `push`; on exhaustion, `abortMerge()` and report. The `Git` interface gains `mergeBase(base): Promise<MergeOutcome>`, `completeMerge()`, `abortMerge()` — separate operations rather than flags on `commitAll` because their failure modes differ (a merge conflict is an outcome, not an error) and because `commitAll`'s contract (`stageAllowed`, diff-guard caps, `CommitOutcome`) judges agent-authored change sets; base's own content is not one, and `stageAllowed` dropping base's `.github/workflows/` edits would silently un-merge them (spec: "Merged base content is preserved verbatim"). Merge-commit identity follows `commit-identity.ts` unchanged — `/sync` is human-triggered, so the sender authors the merge, like every other commit a run pushes. Conflict-path extraction mirrors review-loop's `MergeConflictError` file list (`git diff --name-only --diff-filter=U`).

### D4 — Repair loop clones the `commit-repair` doctrine

Bounded by `AGENT_SYNC_REPAIR_MAX_ROUNDS` (`boundedInt`, default 3, the same `ROUND_RANGE` family as `AGENT_COMMIT_REPAIR_MAX_ROUNDS` in `config.ts`). Each round: prompt carries the conflicted paths and the marked regions, and **forbids the model to run git** — the pipeline alone completes the merge, exactly as `commit-repair.ts` refuses the model `--no-verify`. The token ceiling is asked before each round (`withinBudget`, the `applyIntent` rule: never pay to learn what a refusal would say); the clean path spends nothing, so `/sync` works at the ceiling. No persisted `syncAttempts` — `/sync` is human-initiated like `/ask`; the per-PR counter doctrine covers automatic doors and expensive loops, and this is neither.

### D5 — Push-refusal translation joins `errors.ts`

The workflows-permission refusal a base-merge can trigger is translated beside `pullRequestForbiddenError`: matched on GitHub's known sentence, never the bare status, and the remedy names the code host's own update-branch control (a maintainer performing the same merge passes by construction). The matcher stays single-sentence narrow — the same 403 covers conditions with different remedies, and widening it sends a maintainer to fix a thing that was never the problem.

### D6 — Reply and spend surfaces reuse the two existing writes

The sync reply is `postAnswer`'s write — a plain comment on the trigger surface, no block, deliberately not a record (spec: "Sync replies carry no record"). If a repair turn paid tokens, the newest state block is rewritten in place via `state-persist.ts` (the `readAndSkip` precedent). Concurrency needs nothing: a pull-request comment resolves through the same job/branch-keyed concurrency group every command door shares, so a `/sync` queues behind a live job on the branch rather than racing it.

### D7 — Workflow arm and vocabulary move together

`SLASH_COMMANDS` gains `/sync`; the workflow's pull-request arm gains the `contains(..., '/sync')` clause. `workflow.test.ts` already checks the arm against `SLASH_COMMANDS`, so the vocabulary and the runner-boot filter cannot drift — adding the command without the YAML fails that test, which is the intended order of work.

## Risks / Trade-offs

- [Repair turn edits markers wrongly and pushes a semantically broken resolution] → the merge only resolves syntactically; the push fires CI, and the red-CI door already routes to `CI_FIX` with its own budgets. Report wording says the resolution is unverified by checks.
- [Large drift makes a huge merge commit] → it is base's own reviewed content; the alternative (rebase) was declined in the proposal for review-loop composition.
- [Base moved workflows and the push is refused] → D5 translation; nothing is lost (merge is local until pushed; a retry after a maintainer update-branch merges cleanly or conflicts afresh).
- [`/sync` typed while another job is queued on the branch] → serialized by the existing concurrency group; the second run re-restores from the block the first posted.
- [A maintainer expects `/sync` to also re-run checks] → the reply names what was done; check runs fire from the push itself, and failures arrive through the red-CI door.

## Migration Plan

No persisted shape changes: `SLASH_COMMANDS` is not persisted, the state block gains no field, no `STATE_VERSION` bump, nothing in flight is stranded. Rollback is a revert — `/sync` degrades to an unknown-command refusal and notes stop being read, both silently benign.

## TDD / Hook Interactions

New files under `opencode-agent/src/` and `tests/opencode-agent/` ride the Write/Edit TDD hook pipeline like all others. Test-first order: (1) `commands.test.ts` — vocabulary, predicate, `acceptedCommands` offer; (2) `triggers` dispatch — `/sync` bypasses the signal, refusal without PR; (3) `phases/sync` outcomes against a stub `Git` — clean/up-to-date/conflict/exhausted/over-budget, each asserting the **persisted state** is unchanged (the workspace rule); (4) `git` merge ops against fixture repositories; (5) prompt-constant assertions (`instructions.test.ts` pattern) for note framing and the forbidden-git rule; (6) `workflow.test.ts` forcing the YAML arm. Final task runs the full `bun test`, `typecheck`, `lint`, and updates `opencode-agent/README.md` + `opencode-agent/CLAUDE.md`.
