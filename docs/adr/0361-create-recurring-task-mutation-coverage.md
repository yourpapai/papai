<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0361: Create-Recurring-Task Mutation Coverage — Test-Only Kills via DI Injection and Schema-Direct Assertions

## Status

Accepted

## Date

2026-08-03

## Context

`src/tools/create-recurring-task.ts` — the LLM-facing tool that validates the schedule/trigger combination, compiles the recurrence in the user's timezone, and shapes the result the model reads back — had a ratcheted mutation floor of 0.165 in `scripts/mutation/baseline.json`, the weakest user-facing tool file in `src/`. A paired Stryker run on 2026-08-03 measured 104 mutants: 50 killed, 54 survived, score 0.481 (the existing 113-line companion test covered only DTSTART anchoring).

The survivors clustered in four behavioral areas: the `superRefine` validation rules at L49/L56 (6 ConditionalExpression + 2 LogicalOperator + 2 ObjectLiteral + 2 ArrayDeclaration + 6 StringLiteral), the compile branch `triggerType === 'cron' && schedule !== undefined` at L73, the result-mapping fallback at L113 (4 ConditionalExpression + 2 LogicalOperator), and the `priority`/`triggerType` enum declarations at L36/L41 (2 ArrayDeclaration + 7 StringLiteral). These are real behavioral risks — validation bypass, wrong schedule description — not wording. 18 further survivors (`.describe()` prose, logger scope, log message/metadata strings) were explicitly accepted as out of scope.

The design spec (`docs/superpowers/specs/2026-08-03-create-recurring-task-mutation-design.md`) and implementation plan (`docs/superpowers/plans/2026-08-03-create-recurring-task-mutation.md`) define the fix; this ADR records the decisions.

## Decision Drivers

- **Kill behavioral mutants, accept wording mutants.** Conditional/operator/array mutants in validation, compilation, and result mapping must die; `.describe()` prose and log strings are accepted survivors — asserting them couples tests to wording with low real value.
- **Test-only change.** The file is already DI-friendly (`CreateRecurringTaskDeps`); no production code, `baseline.json`, or `overrides.json` is modified. The CI master seed ratchets the floor monotonically.
- **Follow the file's established pattern.** DI injection, `setCachedConfig('user-1', 'timezone', ...)`, and `mockLogger()` are already in use; new tests extend the same file rather than creating a second suite.
- **Assert through the schema and execute path, not internals.** Validation tests drive `tool.inputSchema.safeParse`; branch and mapping tests drive `tool.execute` with injected deps and capture what the store received.
- **Respect repo lint constraints.** Type assertions and non-null assertions are forbidden, so `inputSchema` access goes through an `isSafeParseable` type guard, and closure capture keeps TS narrowing valid without `!`.

## Considered Options

### Option 1 — Four focused describe blocks in the existing test file (chosen)

Add four describe blocks to `tests/tools/create-recurring-task.test.ts`, leaving the 3 existing DTSTART tests untouched: (1) input validation via `inputSchema.safeParse` with exact issue `message`/`path` assertions plus full enum sweeps; (2) compile branch via `execute` with schema-invalid inputs called directly (on_complete + schedule, cron without schedule) to pin both operands of the L73 `&&` guard; (3) result mapping via injected `RecurringTaskRecord`s asserting `schedule` description, fallback string, and `nextRun` timezone conversion; (4) failure propagation asserting the store's error rethrows. Verified by a paired Stryker run: killed=86, survived=18, score 0.8269.

- **Pros:** kills ~36 of 54 survivors, raising the paired score from 0.481 to 0.83; zero production churn; every block maps to a named line cluster so a surviving mutant identifies its missing test; the two deliberately schema-invalid `execute` calls kill sub-condition mutants that schema-valid inputs cannot reach; failure-path test locks the catch/rethrow contract at trivial cost.
- **Cons:** exact validation-message assertions couple tests to LLM-facing wording; the `Europe/Berlin` nextRun assertion depends on Bun ICU data; calling `execute` with schema-invalid inputs bypasses the validation layer the rest of the suite respects.

### Option 2 — Maximal kill: assert `.describe()` and log prose too (rejected)

Extend assertions to the 18 accepted survivors, pushing toward ~0.95.

- **Pros:** highest possible score.
- **Cons:** couples tests to wording tweaks with low behavioral value; rejected at design approval in favor of the behavioral-only scope.

### Option 3 — Refactor-then-test (rejected)

Restructure the tool (e.g. extract validation/compilation into injectable units) before adding tests.

- **Pros:** could make some branches more directly testable.
- **Cons:** the file is already DI-friendly; no structural change is needed to reach the target score, and modifying production code purely for tests is the churn the plan rules out.

## Decision

Adopt Option 1. Extend `tests/tools/create-recurring-task.test.ts` with the four describe blocks and the `isSafeParseable` type guard; assert existing, correct behavior only; verify with the official paired runner (`bun test:mutate:file src/tools/create-recurring-task.ts`) that the behavioral clusters die; leave `scripts/mutation/baseline.json` untouched so the CI master seed raises the floor.

## Consequences

### Positive

- Paired mutation score for `src/tools/create-recurring-task.ts` raised from 0.481 to 0.8269 (killed=86, survived=18); the PR gate now blocks regressions in validation rules, enum membership, the compile branch, and result mapping.
- The superRefine issue contract (`code: 'custom'`, exact messages, `path: ['schedule']`) is pinned as executable documentation of what the LLM sees on rejection.
- Enum membership for all five `priority` values and both `triggerType` values is now validated.
- The remaining 18 survivors are an explicit, documented acceptance (describe/log prose), not silent debt.

### Negative

- Tests assert exact validation-message strings; wording changes to LLM-facing error text require test updates (accepted: the messages are the model's recovery contract and the mutation gate counts the string mutants).
- The `nextRun` Europe/Berlin expectation relies on Bun's ICU timezone data (June is always CEST, no DST edge).
- Two tests deliberately bypass schema validation by calling `execute` directly with invalid input combinations; readers must understand this pins the L73 guard operands rather than endorsing invalid input.

### Risks

- A future change to `describeCompiledRecurrence` output wording breaks the result-mapping assertions. Mitigation: the plan instructs aligning the expectation to the actual value without touching source.
- Probe and CI paired numbers can diverge; the recorded floor comes from the official runner on master, and the regression-only ratchet means the score can only raise it. Mitigation: none needed beyond the existing seed mechanism.

## Implementation Notes

- The first mutation run exposed two sub-condition survivors the original tests missed — L73 right operand (`schedule !== undefined` → `true`) and L113 left operand (`record.triggerType === 'cron'` → `true`) — killed by adding the cron-without-schedule compile test and by keeping `rrule`/`dtstartUtc` populated in the on_complete fallback test.
- `isSafeParseable` type guard mirrors `tests/utils/test-helpers.ts`; repo lint forbids casting `tool.inputSchema`, and the `const exec = tool.execute` capture keeps narrowing valid inside the throwing closure without `!`.
- Result-mapping tests use `toMatchObject` and `as const` to satisfy the repo's `pedantic: error` oxlint config (no narrowing casts from `unknown`, no async functions without `await`).
- Verified: 21 tests pass (`bun test tests/tools/create-recurring-task.test.ts`), lint/typecheck clean; the 18 accepted survivors are `.describe()` prose, the logger scope string, and log message/metadata strings/objects at L29, L33–L46, L68, L99, L144.

## Implementation Status

Implemented. `tests/tools/create-recurring-task.test.ts` contains the `isSafeParseable` helper and all four describe blocks (`input validation`, `compile branch`, `result mapping`, `failure propagation`); 21 tests pass, matching the plan's final expected count. No `src/` files were modified.

## Related Decisions

- ADR-0354: History Mutation Coverage — same test-side mutant-killing approach applied to `src/history.ts`.
- ADR-0342: Mutation Gate Becomes a Pure Regression Ratchet — defines the baseline mechanics (`seedMerge`, monotonic floor) this change ratchets under.
- ADR-0334: Plugin Test Quality — Behavior-Only Mutation Survivors — same behavior-only survivor philosophy.
- ADR-0328: Stryker Drop TypeScript Checker / TS7 Unblock — mutation-tooling context for the same stack.

## References

- Spec: `docs/superpowers/specs/2026-08-03-create-recurring-task-mutation-design.md`
- Plan: `docs/superpowers/plans/2026-08-03-create-recurring-task-mutation.md`
- Source: `src/tools/create-recurring-task.ts`; tests: `tests/tools/create-recurring-task.test.ts`
