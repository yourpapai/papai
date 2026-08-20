<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Tasks: Let the reviewer report over-engineering

## 1. The kind, and an older ledger that still loads

- [x] 1.1 Write failing cases in `tests/review-loop/issue-schema.test.ts` that an issue
      carries `kind: 'defect' | 'cleanup'`, that a payload omitting it parses as `defect`,
      and that a value outside the two is rejected. Then add the field to
      `review-loop/src/issue-schema.ts` as optional-on-read with a `defect` default.
      Verify: `bun test tests/review-loop/issue-schema.test.ts`
- [x] 1.2 Write a failing case in `tests/review-loop/issue-ledger.test.ts` that a ledger
      written before this change (no `kind` on any issue) loads and reads as all-defects,
      then confirm the read path satisfies it.
      Verify: `bun test tests/review-loop/issue-ledger.test.ts`
- [x] 1.3 Write a failing case that a fixer result asserting a different kind leaves the
      recorded kind unchanged, then implement.
      Verify: `bun test tests/review-loop/issue-ledger.test.ts`

## 2. Ordering

- [x] 2.1 Write failing cases in `tests/review-loop/issue-processor.test.ts`: a cleanup
      citing a caller is dispatched after a defect reporting no exposure; two cleanups
      order between themselves by exposure exactly as two defects do. Assert the existing
      exposure-ordering cases still pass unchanged. Then make `orderByExposure` sort on
      kind first with the existing exposure comparator as the tiebreak.
      Verify: `bun test tests/review-loop/issue-processor.test.ts`
- [x] 2.2 Write a failing case that a run stopped with issues pending leaves cleanups
      unfixed before defects, then confirm it follows from 2.1 without further change.
      Verify: `bun test tests/review-loop/issue-processor.test.ts`

## 3. Severity cap on ingest

- [x] 3.1 Write failing cases that a cleanup arriving at `critical` or `high` is recorded
      as `medium`, that a cleanup at `low` is left alone, and that a defect at `critical`
      is untouched. Then clamp on the ingest path — not in the prompt alone
      (`design.md` D4).
      Verify: `bun test tests/review-loop/review-round.test.ts`

## 4. Reviewer prompt

- [x] 4.1 Add failing cases to `tests/review-loop/prompt-templates.test.ts` that
      `buildReviewPrompt` admits the five kinds by name, requires a named replacement for
      each, requires `kind` on every issue, and states the medium cap. Assert the
      obligations, not the wording. Then implement in `buildReviewPrompt`.
      Verify: `bun test tests/review-loop/prompt-templates.test.ts`
- [x] 4.2 Add a failing case that the existing exclusions survive — style, naming, and
      "correct but I would write it differently" are still out of scope, and a cleanup
      with no nameable replacement is to be omitted rather than reported. Then implement.
      Verify: `bun test tests/review-loop/prompt-templates.test.ts`
- [x] 4.3 Confirm the issue JSON schema in the prompt matches `issue-schema.ts` after the
      `kind` addition — the prompt embeds the schema as a literal and the two drift
      silently.
      Verify: `bun test tests/review-loop/prompt-templates.test.ts tests/review-loop/issue-schema.test.ts`

## 5. Per-kind counts

- [x] 5.1 Write failing cases in `tests/review-loop/trace-log.test.ts` and
      `tests/review-loop/summary.test.ts` that defect and cleanup counts are reported
      separately in `metrics.json` and the run summary, and that a run admitting no
      cleanups reads as it did before. Then implement.
      Verify: `bun test tests/review-loop/trace-log.test.ts tests/review-loop/summary.test.ts`
- [x] 5.2 Write a failing case that the `Checks left behind:` line reports per kind, so a
      cleanup deleting code does not depress the defect ratio (`design.md` D5), then
      implement.
      Verify: `bun test tests/review-loop/summary.test.ts`

## 6. Documentation and full gate

- [x] 6.1 Add a "Deletion findings" section to `review-loop/CLAUDE.md` covering the closed
      set, the mandatory replacement, kind-then-exposure ordering, and the medium cap.
      Note the open question on `shrink` from `design.md`.
      Verify: `bun run format:check`
- [x] 6.2 Run the full gate and fix anything it surfaces.
      Verify: `bun run test && bun run typecheck && bun run lint && bun run review-loop:test`
