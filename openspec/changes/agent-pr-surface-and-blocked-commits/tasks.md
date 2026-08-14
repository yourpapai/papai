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

- [x] 1.1 Failing test: `CI_FIX_INSTRUCTIONS` and `plan-draft.ts`'s two
      instruction blocks each carry the rule. Asserted against all four
      instruction constants at once, and against a shared constant rather than
      a phrase, so a softened copy cannot pass.
      `bun test tests/opencode-agent/instructions.test.ts`
- [x] 1.2 Add the clause to `CI_FIX_INSTRUCTIONS` (`phases/ci-fix.ts`),
      `PROPOSE_INSTRUCTIONS` and `PROPOSE_FILES_INSTRUCTIONS`
      (`phases/plan-draft.ts`). Extracted as `PROTECTED_PATHS_RULE` in
      `protected-paths.ts` — the module that already owns why the rule exists —
      so all four phases share one wording.
      `bun test tests/opencode-agent/instructions.test.ts`

## 2. `commitAll` reports what it dropped (D1)

- [x] 2.1 Failing test: `commitAll` answers `blocked` with the dropped paths
      when a turn wrote only `.github/workflows/…`, `clean` for an untouched
      tree, and `committed` carrying both totals and a non-empty `dropped` for a
      partial drop. Lives in `diff-guard.test.ts`, where the `commitAll` +
      protected-path cases already are, driven through real git argv.
      `bun test tests/opencode-agent/diff-guard.test.ts`
- [x] 2.2 Replace `StagedTotals | null` with `CommitOutcome` in
      `git-commit.ts`, mirroring `Salvage`'s shape and its comment's reasoning,
      with `committedTotals`/`droppedBy` so callers need not narrow by hand.
      `bun run typecheck`
- [x] 2.3 Update every caller — `phases/implement-commit.ts`, `phases/ci-fix.ts`,
      `phases/review.ts`, `commit-repair.ts` — keeping `changedLines` riding out
      on the `committed` member so the state block is unchanged. `StepCommit`
      gains `dropped` so the implement walk can tell a blocked step from a clean
      one, which was the same `null` before.
      `bun test tests/opencode-agent/ && bun run typecheck`

## 3. The CI-fix report tells the truth (D3, D6)

- [x] 3.1 Failing test: `renderCiReport` names the blocked file and says a
      maintainer must apply it by hand; it never prints "nothing changed" when
      `dropped` is non-empty; and with nothing pushed it scopes the green
      verdict to the job rather than the branch. Driven end to end through
      `runPipeline` in the CI-fixing suite.
      `bun test tests/opencode-agent/orchestrator.test.ts`
- [x] 3.2 Rewrite `renderCiReport` against the union from 2.2. Keep the two
      run links and the attempt counter as they are. The still-red branch
      needed the same treatment — it claimed "I changed nothing" for a round
      whose fix was dropped.
      `bun test tests/opencode-agent/orchestrator.test.ts`
- [x] 3.3 Failing test: a dropped path is recorded in `AGENT_STATE`, and the
      next round's CI-fix prompt names it as already blocked. Asserted on the
      persisted state, plus that a round which pushes clears it.
      `bun test tests/opencode-agent/orchestrator.test.ts`
- [x] 3.4 Carry the dropped path through the state block (`ciBlockedPaths`) and
      into `buildCiFixPrompt`. Additive field with a default — no
      `STATE_VERSION` bump.
      `bun test tests/opencode-agent/ && bun run typecheck`

## 4. The pull request becomes the surface (D4)

- [x] 4.1 Failing test: with `prNumber` set, `postAndAppend` writes body and
      block to the pull request; with it null, to the issue. The harness gained a
      real second thread (`io.prThread`) first — a one-thread fake would have let
      the two-pass restore pass without ever doing the second read.
      `bun test tests/opencode-agent/orchestrator.test.ts`
- [x] 4.2 Point `postAndAppend` at `feedbackTarget(input.state)` — the state the
      phase *started* from, not the one it produced. Addressing it with the new
      state posted the very block that first records `prNumber` to the pull
      request it names, leaving the issue with nothing that had ever heard of it
      and the two-pass scan with no way in. The one-comment lag puts the handover
      on the issue, which is where a reader wants it.
      `bun test tests/opencode-agent/orchestrator.test.ts`
- [x] 4.3 Failing test: a later job restores from a block written to the pull
      request, and an issue-only history still restores unchanged (in-flight).
      `bun test tests/opencode-agent/orchestrator.test.ts`
- [x] 4.4 Implement the two-pass read as `readThread` in `orchestrator.ts`, not
      in `state-manager.ts`: that module takes a comment list and is pure, and
      the second *fetch* is the orchestrator's. Merged issue-then-pull-request by
      construction rather than by timestamp — every block on the pull request was
      written after the last one on the issue, and a hand-edited issue block
      loses to the machine's newer one.
      `bun test tests/opencode-agent/orchestrator.test.ts`
- [x] 4.5 Failing test: a comment made on the pull request reaches the model's
      conversation window, asserted through an `/ask` prompt rather than through
      the thread array. `bun test tests/opencode-agent/orchestrator.test.ts`
- [x] 4.6 No change needed — `renderThread` reads the thread the run assembled,
      so `readThread`'s merge reaches it. 4.5 is what proves that rather than
      assuming it.
- [x] 4.7 Reviewed and deliberately **not** collapsed. `postAnswer`'s branch is
      on the trigger, and under D4 the two now agree — `commandSurface` refuses
      issue commands once a pull request exists — but keeping it on the trigger
      says what the function is for (reply where the question was asked) rather
      than deriving it from a rule two modules away. Its doc comment was stale in
      two places and is corrected. Removed `pull-request-note.ts` instead: it
      existed solely to tell a pull-request reader which issue the report went
      to, and the report is now on the pull request.
      `bun test tests/opencode-agent/`

## 5. The review loop's push is guarded (D5)

- [x] 5.1 Failing test: `review-push.ts` reverts a protected path the loop
      committed and pushes the rest; an untouched-by-protected-paths branch
      pushes unchanged and asks git nothing extra; and the review report names
      what was reverted. `bun test tests/opencode-agent/orchestrator.test.ts`
- [x] 5.2 Diff against the sha the branch was on when the review began
      (`Git.changedSince`), revert just the protected paths as a further commit
      (`Git.revertPaths`, in the new `git-revert.ts` — the only operation here
      that undoes rather than creates), and carry them into the report.
      Best-effort: if the revert breaks, the push is the one GitHub was always
      going to refuse, where throwing would fail a review that found real
      problems. `bun test tests/opencode-agent/orchestrator.test.ts`

## 6. Verification and docs

- [x] 6.1 Restate the affected local rules in `opencode-agent/CLAUDE.md` — the
      protected-paths rule (drops are reported, not only logged; the new
      "`null` is not a verdict" rule beside it), the surface rule (the pull
      request carries the record, `readThread` reads both threads), the
      pull-request-door rule and the feedback-channel rule (`noteReview` gone,
      `dropUnpushable` in its place) — plus the module map for `run-post.ts` and
      `git-revert.ts`. Same in `opencode-agent/README.md`: the ephemeral-state
      section, the surface section, the file table, and "Files the agent cannot
      commit".
- [ ] 6.2 Full gate: `bun test`, `bun run typecheck`, `bun run lint`,
      `bun run format:check`.
- [ ] 6.3 `bun run test:mutate:changed` — the per-file ratchet is blocking in
      CI, and this change rewrites branch-heavy renderers and a scan.
