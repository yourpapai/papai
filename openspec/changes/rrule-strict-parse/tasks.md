# rrule-strict-parse — tasks

## 1. Census (before code)

- [x] 1.1 Run the read-only census from design D2 against a production-shaped DB: count `recurring_tasks` rows whose `rrule` contains both `COUNT=` and `UNTIL=`; record the result in the PR. Nonzero result pauses this change in favor of a normalization proposal.
  - Result (2026-09-01, main-checkout dev DB, readonly): 0 total rows, 0 with rrule, 0 COUNT+UNTIL, 0 DATE-valued UNTIL. Worktree `papai.db` is an unmigrated stub. Production DB re-check still owed at PR time (no production access from this sandbox).

## 2. Tests first (TDD)

- [x] 2.1 Add strict-rejection cases to `tests/recurrence/recurrence.test.ts`: compiled recurrence with COUNT+UNTIL → `parseRrule` returns `{ ok: false }` with a reason string; no iterator produced.
- [x] 2.2 Add DATE-valued `UNTIL` rejection case: rule string with `DTSTART;TZID=…` and bare-DATE `UNTIL` → `{ ok: false }`.
- [x] 2.3 Add no-throw degrade cases: `nextOccurrence` returns `null` and `occurrencesBetween` returns `[]` for the rejecting rules, with the warn path exercised (mockLogger from `tests/utils/test-helpers.ts`).

## 3. Implementation

- [x] 3.1 In `src/recurrence/recurrence.ts` `parseRrule`, construct `RRuleTemporal` with `strict: true` (design D1). No other code changes.

## 4. Verification

- [x] 4.1 `bun run test tests/recurrence tests/types` — all pass, including the pre-existing shape-coverage suites (`equivalence.test.ts`, `spec-schema.test.ts`, `cron-to-rrule.test.ts`, `tests/types/recurrence.test.ts`) unchanged, pinning that papai's emitted rule shapes stay valid.
- [x] 4.2 `bun run test src/recurring src/deferred-prompts tests/recurring*` (or `test:affected --base=master`) — scheduler/poller consumers degrade correctly; no new failures.
- [x] 4.3 `bun run typecheck && bun run lint` — clean (mind the oxlint findings tracked separately from PR #398; this change must not add new ones).
- [x] 4.4 `bun test:mutate:changed` — `src/recurrence/recurrence.ts` mutation score holds or improves its ratchet record; update baseline if new kills raise it.
  - `test:mutate:changed` selected zero targets (edit uncommitted vs origin/master); measured directly with `test:mutate:file src/recurrence/recurrence.ts`: score 0.8347 (killed=101, survived=18, noCoverage=2). No baseline record exists for the file, so no floor to regress; this measure seeds it.
