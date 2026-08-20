# Task 4 Report: Delivery governance kill switch and retry story

Date: 2026-08-05
Commit: `0f2df1f7e test(stories): cover aggregate delivery kill switch and retry`

## Modified files

- `tests/stories/analytics/aggregate-delivery.story.test.ts` — added imports (`computeRetryDelayMs`, `ANALYTICS_KILL_SWITCH_ENV`); appended `SCN-analytics-aggregate-delivery-governance` scenario using the reconciled fixed-world-clock shape (`world.clock.now().getTime()`, `given.analyticsRuntime('governed')` before the settings session, `completeUtcDay(nowMs)`); kill-switch env mutation is set inside `try` and restored via `Reflect.deleteProperty` in `finally`.
- `tests/stories/catalog/coverage.ts` — added `SCN-analytics-aggregate-delivery-governance` to `CATALOG_SCENARIO_IDS` (after the Task 3 id), added its executable record (`verifiedAt: '2026-08-04'`, `provingTier: '0'`) after the Task 3 record, and extended `CATALOG_SOURCE` with `'; extended 2026-08-04 with 4 aggregate delivery (@0) ids (analytics-aggregate-delivery-coverage)'`.
- `tests/stories/harness/catalog-coverage.test.ts` — ratcheted scenario counts 232→233 (two assertions) and executable counts 210→211 (two assertions).
- `tests/scripts/story-coverage-totals.test.ts` — updated totals to `total: 233, executable: 211, pending: 22, T0 162` and the formatted line to `211/233 executable (T0 162, ...)`. The file had not been touched by Tasks 1–3 (still expected 201/223/T0 152), so this is the cumulative update the brief mandates.

## Exact test commands and results

### RED (Step 2)

`bun test:stories --fixture tests/stories/analytics/aggregate-delivery.story.test.ts`
→ exit 0; **4 pass / 0 fail** (all four scenarios, including the new governance one).

`bun test:stories:contracts`
→ exit 1; 443 pass / **1 fail**: `story catalog census > every Tier 0 story scenario is claimed by a record or declared supporting`, diff naming exactly `tests/stories/analytics/aggregate-delivery.story.test.ts#SCN-analytics-aggregate-delivery-governance: ...`. Expected census failure confirmed.

### GREEN (Step 4)

- `bun test:stories --fixture tests/stories/analytics/aggregate-delivery.story.test.ts` → exit 0; 4 pass / 0 fail, 54 expect() calls.
- `bun test:stories:contracts` → exit 0; 444 pass / 0 fail, 1777 expect() calls.
- `bun test tests/scripts/story-coverage-totals.test.ts` → exit 0; 2 pass / 0 fail (211/233, T0 162).

### Final verification

- Story fixture: exit 0, four passing scenarios. ✓
- `bun test:stories:contracts`: exit 0. ✓
- `bun test tests/scripts/story-coverage-totals.test.ts`: exit 0 with 211/233 and T0 162. ✓
- `bun run typecheck && bun run lint`: exit 0 (after fix below). ✓
- Pre-commit hook (lint, typecheck, format:check, license-headers): 4/4 passed on commit. ✓
- `git status --short`: only `M docs/superpowers/plans/2026-08-04-analytics-aggregate-delivery-coverage.md` (pre-existing plan revision, untouched) and `?? docs/superpowers/plans/2026-08-04-global-refactor-coverage-foundation.md` (pre-existing untracked plan, untouched); nothing uncommitted under `tests/` or `src/`. ✓
- Forbidden imports check (`snapshot`, `verifySinkVersion`, `runDeriveJob`, `runIntentDerivation`, `runBackfillJob`, `src/analytics/rekey/`): none in the story file. ✓
- `bun test:stories:coverage`: **exit 1** — see Concerns. ✗

## RED/GREEN narrative

1. RED: appended the governance scenario first; all 4 scenarios passed but the catalog census contract failed naming the new scenario id — the expected temporary census failure.
2. GREEN: registered the catalog record + id + `CATALOG_SOURCE` extension, ratcheted harness counts 232→233 / 210→211, updated totals expectations to 211/233 (T0 162). All three commands then exited 0.
3. During verification, typecheck+lint flagged the brief's `then` destructure as unused (TS6133 / no-unused-vars). Removed `then` from the destructure (matching the first scenario's `{ given, when, world }` shape); re-ran typecheck/lint (exit 0) and the story fixture (4 pass). This is a minimal, forced deviation from the brief's literal snippet — the plan's reconciled instruction emphasized destructuring `world`, which is retained.
4. The pre-commit format hook rewrapped one over-long `toMatchObject` line (content-neutral); re-staged and committed.

## Self-review

- Scenario body follows the brief verbatim except the `then` destructure removal and the formatter's line wrap.
- Kill-switch env var is restored in `finally` via `Reflect.deleteProperty`, satisfying the harness no-net-env-mutation guard (story run passed, which enforces this).
- All worker timestamps derive from `world.clock.now().getTime()`; `retryNow = nowMs`; bounded-retry assertions use `computeRetryDelayMs(0)` exactly as specified.
- Commit contains exactly the four Task 4 files; the uncommitted plan revision and untracked plan were not staged or modified.
- No production (`src/`) code was added or changed; per TDD the failing contract test (census) preceded the catalog registration.

## Concerns

- **`bun test:stories:coverage` fails on this branch, independent of Task 4**: measured lines 68.71% (floor 71.00%), functions 65.87% (floor 70.00%); all 175 story tests pass — only the floor gate fails. Task 4 changed no production bytes and only added a story (which can only raise coverage), so HEAD~1 measures ≤ the same values; the shortfall pre-dates this task (likely introduced or exposed by earlier branch work). I did not lower the floor or touch production code to chase it, as both are out of scope. This needs a separate decision: either raise story reachability (more scenarios importing uncovered modules) or re-baseline the floor via `bun coverage:ratchet:stories` from a sanctioned green run.
- Brief snippet deviated in one detail: `then` removed from the governance scenario destructure because typecheck+lint (TS6133 / no-unused-vars) fail otherwise; `world` destructure retained as the reconciled plan requires.
