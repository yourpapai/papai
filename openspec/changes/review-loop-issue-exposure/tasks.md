<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Tasks: Give review-loop issues an exposure artifact

## 1. Schema

- [x] 1.1 Write failing cases in `tests/review-loop/issue-schema.test.ts`: a reviewer issue
      accepts a caller citation (file, line, quoted line); accepts an explicit "none found";
      and parses when exposure is absent entirely, so state written before this change still
      loads. Then extend `ReviewerIssueSchema` in `review-loop/src/issue-schema.ts`.
      Verify: `bun test tests/review-loop/issue-schema.test.ts`
- [x] 1.2 Write failing cases that `FixerResultSchema` carries the fixer's own exposure, and
      that `VerifierDecisionSchema` does **not** — it is persisted and drives
      `mapVerifierDecisionToLedgerStatus`, and exposure must never affect status. Then implement.
      Verify: `bun test tests/review-loop/issue-schema.test.ts`

## 2. Prompt contracts

- [ ] 2.1 Add failing cases to `tests/review-loop/prompt-templates.test.ts` that
      `buildReviewPrompt` requires a caller citation or an explicit "none found", and that
      silence is not acceptable. Assert the obligation, not the wording. Then implement.
      Verify: `bun test tests/review-loop/prompt-templates.test.ts`
- [ ] 2.2 Add failing cases that `buildFixPrompt` and both retry prompts require the fixer's own
      exposure assessment, stated as independent of the reviewer's, then implement.
      Verify: `bun test tests/review-loop/prompt-templates.test.ts`

## 3. Ordering

- [ ] 3.1 Write failing cases for dispatch ordering in `tests/review-loop/issue-processor.test.ts`:
      issues with a cited caller dispatch before those without; issues exposure cannot separate
      keep their existing relative order (stable sort); a round where no issue carries exposure
      dispatches in unchanged order. Then implement in `review-loop/src/issue-processor.ts`.
      Verify: `bun test tests/review-loop/issue-processor.test.ts`
- [ ] 3.2 Write a failing case that an issue reporting no caller is still dispatched, with its
      retry budget and terminal statuses unchanged, then confirm the implementation satisfies it.
      Verify: `bun test tests/review-loop/issue-processor.test.ts`

## 4. Divergence recording

- [ ] 4.1 Write failing cases in `tests/review-loop/loop-trace.test.ts` and
      `tests/review-loop/trace-log.test.ts` that the fixer's exposure rides the `verify_complete`
      trace event alongside the fixer's severity, and that reviewer-versus-fixer divergence is
      tallied into the round metric. Then implement, following the `fixerSeverity` path.
      Verify: `bun test tests/review-loop/loop-trace.test.ts tests/review-loop/trace-log.test.ts`
- [ ] 4.2 Write a failing case that an unknown exposure on either side is not counted as a
      divergence, then implement.
      Verify: `bun test tests/review-loop/loop-trace.test.ts`
- [ ] 4.3 Write failing cases in `tests/review-loop/summary.test.ts` and the run-artifacts suite
      that the exposure distribution and divergence count appear in the summary and
      `metrics.json`, including on a stopped run — which skips `finalizeRun` but still writes
      artifacts — and that an older `metrics.json` without the fields still parses. Then implement.
      Verify: `bun test tests/review-loop/summary.test.ts tests/review-loop/run-artifacts.test.ts`

## 5. Documentation and full gate

- [ ] 5.1 Update `review-loop/CLAUDE.md` with the exposure artifact, the advisory ordering, and
      the divergence record — naming its reader: the later change that decides whether exposure
      may gate.
      Verify: `bun run format:check`
- [ ] 5.2 Run the full gate and fix anything it surfaces.
      Verify: `bun run test && bun run typecheck && bun run lint && bun run review-loop:test`
