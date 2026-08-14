<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Tasks: A blocked commit is reported, and the pull request is the surface

Ordered so D1–D3 (the loop that motivated the change) ship without touching the
restore path. Each group is independently verifiable and commits on its own.

## 1. The prompts state the rule (D2)

- [ ] 1.1 Failing test: `CI_FIX_INSTRUCTIONS` and `plan-draft.ts`'s two
      instruction blocks each mention `.github/workflows/`. Assert against all
      four instruction constants at once so a fifth phase cannot be added
      without the rule. `bun test tests/opencode-agent/prompts.test.ts`
- [ ] 1.2 Add the clause to `CI_FIX_INSTRUCTIONS` (`phases/ci-fix.ts`),
      `PROPOSE_INSTRUCTIONS` and `PROPOSE_FILES_INSTRUCTIONS`
      (`phases/plan-draft.ts`), wording it as `IMPLEMENT_INSTRUCTIONS` does —
      the rule, plus "say in your reply exactly what a maintainer should apply
      by hand". `bun test tests/opencode-agent/prompts.test.ts`

## 2. `commitAll` reports what it dropped (D1)

- [ ] 2.1 Failing test: `commitAll` answers `blocked` with the dropped paths
      when a turn wrote only `.github/workflows/…`, `clean` for an untouched
      tree, and `committed` carrying both totals and a non-empty `dropped` for a
      partial drop. `bun test tests/opencode-agent/git-commit.test.ts`
- [ ] 2.2 Replace `StagedTotals | null` with the three-member union in
      `git-commit.ts`, mirroring `Salvage`'s shape and its comment's reasoning.
      `bun run typecheck`
- [ ] 2.3 Update every caller — `phases/implement-commit.ts`, `phases/ci-fix.ts`,
      `phases/review.ts`, `commit-repair.ts` — keeping `changedLines` riding out
      on the `committed` member so the state block is unchanged. Assert the
      state block still records `changedLines` after a partial drop.
      `bun test tests/opencode-agent/phases.test.ts && bun run typecheck`

## 3. The CI-fix report tells the truth (D3, D6)

- [ ] 3.1 Failing test: `renderCiReport` names the blocked file and says a
      maintainer must apply it by hand; it never prints "nothing changed" when
      `dropped` is non-empty; and with nothing pushed it scopes the green
      verdict to the job rather than the branch.
      `bun test tests/opencode-agent/phases.test.ts`
- [ ] 3.2 Rewrite `renderCiReport` against the union from 2.2. Keep the two
      run links and the attempt counter as they are.
      `bun test tests/opencode-agent/phases.test.ts`
- [ ] 3.3 Failing test: a dropped path is recorded in `AGENT_STATE`, and the
      next round's CI-fix prompt names it as already blocked. Assert the
      persisted state, not just the rendered prompt.
      `bun test tests/opencode-agent/phases.test.ts`
- [ ] 3.4 Carry the dropped path through the state block and into
      `buildCiFixPrompt`. Additive field with a default — no `STATE_VERSION`
      bump. `bun test tests/opencode-agent/state.test.ts && bun run typecheck`

## 4. The pull request becomes the surface (D4)

- [ ] 4.1 Failing test: with `prNumber` set, `postAndAppend` writes body and
      block to the pull request; with it null, to the issue. Assert the number
      the transport was called with. `bun test tests/opencode-agent/report.test.ts`
- [ ] 4.2 Point `postAndAppend` at `feedbackTarget(state)`.
      `bun test tests/opencode-agent/report.test.ts`
- [ ] 4.3 Failing test: `findLatestState` restores from a block written to the
      pull request, takes the newest across both threads by creation time, and
      still restores an issue-only history unchanged (the in-flight case).
      `bun test tests/opencode-agent/state.test.ts`
- [ ] 4.4 Implement the two-pass scan in `state-manager.ts`: issue first, then
      the thread its newest block names, merged by creation time. One extra
      read, and only once a pull request exists.
      `bun test tests/opencode-agent/state.test.ts`
- [ ] 4.5 Failing test: `renderThread` merges both threads in order and still
      drops `AGENT_STATUS`-marked comments before the window is taken.
      `bun test tests/opencode-agent/prompt-budget.test.ts`
- [ ] 4.6 Merge both threads in `renderThread`, filtering by marker as now.
      `bun test tests/opencode-agent/prompt-budget.test.ts`
- [ ] 4.7 Collapse `postAnswer`'s pull-request branch into the general rule,
      leaving only the `persistState` half it still needs. Assert an answer
      posts once, carries no block, and still records the spend.
      `bun test tests/opencode-agent/report.test.ts`

## 5. The review loop's push is guarded (D5)

- [ ] 5.1 Failing test: `review-push.ts` reverts a protected path the loop
      committed and pushes the rest; an untouched-by-protected-paths branch
      pushes unchanged. `bun test tests/opencode-agent/review.test.ts`
- [ ] 5.2 Diff against the last pushed sha before pushing, commit the revert of
      just those paths, and report what was reverted.
      `bun test tests/opencode-agent/review.test.ts`

## 6. Verification and docs

- [ ] 6.1 Restate the two affected local rules in `opencode-agent/CLAUDE.md` —
      the protected-paths rule (drops are now reported, not only logged) and the
      surface rule (the pull request carries the record too, and the scan reads
      both threads) — and update `opencode-agent/README.md` where it describes
      where a run comments.
- [ ] 6.2 Full gate: `bun test`, `bun run typecheck`, `bun run lint`,
      `bun run format:check`.
- [ ] 6.3 `bun run test:mutate:changed` — the per-file ratchet is blocking in
      CI, and this change rewrites branch-heavy renderers and a scan.
