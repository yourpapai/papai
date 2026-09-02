## 1. Red: confirm the lint baseline

- [x] 1.1 Run `bun run lint` and confirm exactly the three findings the change targets:
      `sdd-runner/src/event-schemas.ts:90` (`no-redeclare`, `DoneEvent`),
      `sdd-runner/src/orchestrator.ts:59` (`no-redeclare`, `RunResumeResult`),
      `tests/review-loop/test-helpers.ts:177` (`no-unused-vars`, bare `_`)

      > Observed pre-edit this session: `bun run lint` (oxlint 1.80.0) failed with exactly
      > those three diagnostics. Before apply began, the three fixes were found already
      > applied in the worktree by external edits, matching design D1–D3 exactly; verification
      > below is against those edits.

## 2. Fix the three findings

- [x] 2.1 In `sdd-runner/src/event-schemas.ts`, rename the Zod const `DoneEvent` (line 90) to
      `DoneEventSchema` and update its in-file references (line 244 union member, line 274
      `DoneEvent.extend(StampShape)`). The `export type DoneEvent` (line 294) keeps its name.
      Verify: `bun run lint` reports no finding for `event-schemas.ts`
- [x] 2.2 In `sdd-runner/src/orchestrator.ts`, delete the duplicate `RunResumeResult` interface
      (lines 67–73), keeping the first declaration. Verify: `bun run lint` reports no finding
      for `orchestrator.ts`
- [x] 2.3 In `tests/review-loop/test-helpers.ts`, rename the `append(_: TraceEvent)` parameter
      (line 177) to `_event`. Verify: `bun run lint` exits 0

      > Verified together: `bun run lint` with oxlint 1.80.0 exits 0 — zero findings, so no
      > finding for any of the three files. Diffs inspected: edits match D1/D2/D3 exactly.

## 3. Verify no collateral damage

- [x] 3.1 Run `bun run typecheck` and `bun test sdd-runner tests/review-loop` — all pass with
      the renamed const and deleted duplicate interface
- [x] 3.2 Run `bun run knip` — strict mode stays green (no newly-unused export after the
      rename/deletion)

## 4. Full gates and wrap-up

- [x] 4.1 Run full `bun test`, `bun run typecheck`, `bun run lint` — all green

      > lint exit 0 (oxlint 1.80.0), typecheck exit 0. Full suite: 18267 pass / 1 fail — the
      > fail is the pre-existing `tests/chat/telegram/index.test.ts` resolveUserId timeout
      > (sandbox blackholes api.telegram.org; fails identically on non-PR branches, unrelated
      > to these edits).
- [x] 4.2 Confirm no docs updates are needed (`docs/architecture/commands.md` unchanged — the
      lint pipeline behavior itself did not change), then commit the three code fixes together
      with this change folder per the repo's artifact-commit convention
- [ ] 4.3 After merge to master, trigger `@dependabot rebase` on PR #398 so the bump rebases
      onto these fixes, and confirm the PR's lint leg goes green
