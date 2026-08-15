<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Tasks: Shape review-loop fixes toward the minimum

## 1. Fix instruction contract

- [x] 1.1 Add failing cases to `tests/review-loop/prompt-templates.test.ts` asserting that
      `buildFixPrompt` requires the minimality ladder *after* comprehension (must it exist, is it
      already here, can it be one line), then implement it in
      `review-loop/src/prompt-templates.ts`. Assert the contract, not the wording — match on the
      required obligations, so rewording the prompt does not fail the suite.
      Verify: `bun test tests/review-loop/prompt-templates.test.ts`
- [x] 1.2 Extend those cases to `buildRetryFixPrompt` and
      `buildRetryFixWithInspectorFeedbackPrompt` — a retry carries the same ladder as the first
      attempt — then implement.
      Verify: `bun test tests/review-loop/prompt-templates.test.ts`
- [x] 1.3 Add a failing case that `buildFixPrompt` requires non-trivial logic to leave one
      runnable check in the tree, and that transient reproduction does not satisfy it, then
      implement.
      Verify: `bun test tests/review-loop/prompt-templates.test.ts`
- [x] 1.4 Add a failing case that `buildFixPrompt` forbids authoring architecture prose and
      directs the fixer to report the gap in `reasoning` instead, extending the existing
      plan/spec prohibition, then implement.
      Verify: `bun test tests/review-loop/prompt-templates.test.ts`

## 2. Path-aware diff read

- [ ] 2.1 Write failing cases in `tests/review-loop/diff-stats.test.ts` for a new path-aware
      export over the same `git diff --numstat` output: it returns changed paths, tolerates
      renames and binary (`-`/`-`) rows, and returns empty for empty output. Assert in the same
      file that `parseNumstat`, `DiffStats` and `measureDiffSince` keep their current shapes —
      `mutation-improve` imports them and its `reportMergeDiff` swallows failures, so a breaking
      change there is silent. Then implement additively in `review-loop/src/diff-stats.ts`.
      Verify: `bun test tests/review-loop/diff-stats.test.ts`
- [ ] 2.2 Write a failing case that a changed path is classified as a test path using the
      repository's own implementation-to-test mapping rather than a rule private to the loop,
      then implement.
      Verify: `bun test tests/review-loop/diff-stats.test.ts`
- [ ] 2.3 Confirm `mutation-improve` still builds and passes against the changed module.
      Verify: `bun run mutation-improve:typecheck && bun test tests/mutation-improve`

## 3. Recording the signal

- [ ] 3.1 Write failing cases in `tests/review-loop/issue-processor-attempts.test.ts` (or the
      commit-attempt suite, following the local pattern) that an accepted fix whose diff touched
      no test path is still committed and merged, and that the issue's remaining retry budget is
      unchanged. Then record the boolean on the accepted fix.
      Verify: `bun test tests/review-loop/issue-processor-attempts.test.ts`
- [ ] 3.2 Write a failing case that an unavailable or failing diff measurement leaves the fix
      unaffected and is reported as absent rather than as a satisfied check, then implement.
      Verify: `bun test tests/review-loop/issue-processor-attempts.test.ts`
- [ ] 3.3 Write failing cases in `tests/review-loop/trace-log.test.ts` and
      `tests/review-loop/summary.test.ts` that the signal reaches `metrics.json` and the run
      summary, and that an older `metrics.json` without the field still parses. Then implement.
      Verify: `bun test tests/review-loop/trace-log.test.ts tests/review-loop/summary.test.ts`

## 4. Documentation and full gate

- [ ] 4.1 Update `review-loop/CLAUDE.md` with the fix instruction contract and the advisory
      signal, and add an ADR recording why the inspector was rejected as the host — the unified
      `MAX_ATTEMPTS = 2` would discard a correct-but-oversized fix — cross-referencing ADR-0303.
      Verify: `bun run format:check`
- [ ] 4.2 Run the full gate and fix anything it surfaces.
      Verify: `bun run test && bun run typecheck && bun run lint && bun run review-loop:test`
