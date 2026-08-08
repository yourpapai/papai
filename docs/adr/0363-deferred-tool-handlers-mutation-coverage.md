<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0363: Deferred-Tool-Handlers Mutation Coverage — Test-Only Kills via Tracked Logger and Cache-Busted Re-Import

## Status

Accepted

## Date

2026-08-08

## Context

`src/deferred-prompts/tool-handlers.ts` — the tool-facing execution layer behind the reminder/alert tools (`executeCreate`, `executeList`, `executeGet`, `executeUpdate`, `executeCancel`), which validates schedule-vs-condition inputs, compiles rrule specs, emits `deferred:*` events, and logs structured metadata — had a ratcheted mutation floor of 0.5805243445692884 in `scripts/mutation/baseline.json`. A paired Stryker probe measured 267 mutants with survivors clustered in three areas: (1) behavioral error paths and event gating — input guards (`schedule` + `condition` both/neither, past `fire_at`, invalid timezone, uncomputable rrule), update field handling per prompt type, cancel/get not-found paths; (2) logging metadata — every `log.debug` entry call and `log.info` success call with its exact metadata object; (3) store-null branches — `updateScheduledPrompt`/`updateAlertPrompt` returning `null` after the prompt was resolved (L211/L237).

Two structural constraints shaped the approach. First, `tool-handlers.ts` binds `const log = logger.child({ scope: 'deferred:tools' })` at module load, so a logger mock installed after import never reaches the binding — the module must be re-evaluated after the mock is in place. Second, the store-null branches are unreachable through the public API without mocking the `scheduled.js`/`alerts.js` store boundary, and the global preload (`tests/mock-reset.ts`) restores real modules in a global `beforeEach`, so such mocks must be installed inside test bodies.

The design spec (`docs/superpowers/specs/2026-08-04-deferred-tool-handlers-mutation-design.md`) and implementation plan (`docs/superpowers/plans/2026-08-04-deferred-tool-handlers-mutation.md`) define the fix; this ADR records the decisions.

## Decision Drivers

- **Test-only change.** No `src/` edits except one approved exception: characterization tests exposed that `updateAlertPrompt` in `src/deferred-prompts/alerts.ts` threw drizzle's `No values to set` when an alert update carried only an invalid `execution` payload, so it gained the same empty-set guard `updateScheduledPrompt` already had.
- **Behavioral assertions are exact.** Error strings use `toBe`/`toEqual`/`toContainEqual`; substrings only where the message embeds a zod payload (`'Invalid condition:'` prefix).
- **Characterization discipline.** Every new test asserts existing behavior and must pass on first run; a failure means the expectation is wrong, not the source.
- **Logging metadata is in scope here** (unlike wording-only survivors elsewhere): the metadata objects (`{ id, userId, type }` etc.) are behavioral — wrong keys or values are real observability regressions.
- **No wall-clock assertions** (repo policy); all dates are fixed strings far in the past/future.
- **Documented residuals.** The only accepted survivors are unreachable/dead code: L77 (3 mutants, dead NaN guard), L78 `<=` vs `<` (1), L123 (4, unreachable `utcToLocal` fallback) — ceiling (155+104)/267 ≈ 0.970.

## Considered Options

### Option 1 — Extend the existing suite + one logging/store-mock file (chosen)

Append behavioral describes (create guards, rrule edge cases, alert create/get, scheduled/alert update fields, cancel paths) to `tests/deferred-prompts/tool-handlers.test.ts`, which already tests the public API against a real in-memory DB. Create a second file `tests/deferred-prompts/tool-handlers-logging.test.ts` that installs a tracked logger mock (`createTrackedLoggerMock`) via `mock.module('../../src/logger.js', ...)` in `beforeEach` and re-imports the handlers through a cache-busting query (`?test=${crypto.randomUUID()}`, pattern from `tests/coding-credentials/redaction-log.test.ts`) so the module-load `logger.child` binding resolves the mock. Store-null tests in the same file spread the real `scheduled.js`/`alerts.js` module and override only the update function, installing the mock inside the test body (after the global `beforeEach` restore) and importing handlers immediately after. Pair both files with the source in `scripts/mutation/overrides.json` and ratchet `baseline.json` to the measured score.

- **Pros:** kills all behavioral, logging-metadata, and store-null survivors (score 0.58 → 0.9551, at the documented residual ceiling); the tracked-logger + cache-bust pattern is already proven in the repo; narrow store mocks (spread-real, override-one) avoid reimplementing the store contract; per-file worker isolation keeps the store mocks from leaking into other suites.
- **Cons:** cache-busted dynamic imports are a subtle mechanism that future readers must understand (mitigated by an explanatory comment at the top of the logging file); exact log-metadata assertions couple tests to the logging contract.

### Option 2 — Refactor for injectable logger/store (rejected)

Pass the child logger and store functions through an injected deps object so tests could substitute them without module mocking.

- **Pros:** removes the cache-bust mechanism; more conventional DI.
- **Cons:** modifies production code purely for testability — the churn the plan rules out; the module-load child-logger pattern is used consistently across the codebase and singling out this file diverges from convention.

### Option 3 — Skip logging/store-null clusters (rejected)

Cover only behavioral paths and accept logging/store-null mutants as survivors, settling for a lower score (~0.75).

- **Pros:** no module mocking needed.
- **Cons:** leaves structured-logging metadata (an observability contract other tooling depends on) unprotected, and leaves reachable error branches untested; the residual set is supposed to be unreachable code, not deliberate gaps.

## Decision

Adopt Option 1. Extend `tests/deferred-prompts/tool-handlers.test.ts` with the behavioral describes; create `tests/deferred-prompts/tool-handlers-logging.test.ts` with the tracked-logger, cache-busted re-import pattern for logging-metadata and store-null tests; accept the single approved source exception (empty-set guard in `updateAlertPrompt`); pair both test files in `scripts/mutation/overrides.json` and ratchet `scripts/mutation/baseline.json` to the measured 0.9550561797752809.

## Consequences

### Positive

- Paired mutation score for `src/deferred-prompts/tool-handlers.ts` raised from 0.5805 to 0.9551, essentially at the documented 0.970 ceiling; the per-file ratchet gate now blocks regressions in all input guards, update field handling, event gating, and cancel/get paths.
- The exact error-string contract the LLM sees on rejection is pinned as executable documentation.
- Structured logging metadata (`{ id, userId, type }` on create/cancel, `{ userId, count }` on list, debug entry args) is now asserted, protecting the observability contract.
- The store-null error path (`update*` returning null → `'Reminder or alert not found.'`) is covered via narrow spread-real mocks.
- The `updateAlertPrompt` empty-set guard fixes a real crash (drizzle `No values to set`) surfaced by characterization tests.

### Negative

- The cache-busted dynamic import pattern (`?test=<uuid>`) is non-obvious; readers must understand why a static import would bind the real logger (mitigated by the file-header comment).
- Log-metadata and error-string assertions couple tests to exact wording; changing messages requires test updates (accepted: these are the model/operator-facing contracts).
- Store mocks must be installed inside test bodies because the global preload restores real modules in `beforeEach` — a test-ordering subtlety future edits must preserve.

### Risks

- The invalid-`execution` "ignored" assertions feed schema-invalid payloads; a tightening of the input schema could change behavior and break them. Mitigation: the lint-safe widen-then-delete construction is commented in the test.
- Probe and CI paired numbers can diverge; the recorded floor comes from the official paired runner (`bun test:mutate:file src/deferred-prompts/tool-handlers.ts`).

## Implementation Notes

- `importHandlers()` (cache-busted import helper), `tracked` (tracked logger), `USER_ID`, and `infoArgs`/`debugArgs` are defined once in the logging file and reused by both describes; the global `mock-reset.ts` `beforeEach` runs before the suite's own `beforeEach` re-installs the tracked mock.
- The lint-safe way to feed a payload missing `delivery_brief` is widen + `delete` rather than `as unknown as`, because oxlint `no-unsafe-type-assertion` blocks narrowing casts.
- Verified: `bun test tests/deferred-prompts/tool-handlers.test.ts tests/deferred-prompts/tool-handlers-logging.test.ts` → 53 pass, 0 fail; `baseline.json` holds 0.9550561797752809; `overrides.json` pairs both test files.

## Implementation Status

Implemented. All seven test clusters exist across the two files, both files run green (53 tests), the `alerts.ts` empty-set guard is in place (src/deferred-prompts/alerts.ts:147), and the mutation floor is ratcheted.

## Related Decisions

- ADR-0342: Mutation Gate Becomes a Pure Regression Ratchet — defines the baseline mechanics this change ratchets under.
- ADR-0361: Create-Recurring-Task Mutation Coverage — sibling test-only mutation-coverage effort.
- ADR-0354: History Mutation Coverage — same test-side mutant-killing approach applied to `src/history.ts`.
- ADR-0302: Remove Deferred-Prompt Modes — prior deferred-prompts surface change.
- ADR-0349: Rename Deferred-Prompt Tool Surface to Reminders/Alerts — naming context for the same module.

## References

- Spec: `docs/superpowers/specs/2026-08-04-deferred-tool-handlers-mutation-design.md`
- Plan: `docs/superpowers/plans/2026-08-04-deferred-tool-handlers-mutation.md`
- Source: `src/deferred-prompts/tool-handlers.ts`; tests: `tests/deferred-prompts/tool-handlers.test.ts`, `tests/deferred-prompts/tool-handlers-logging.test.ts`
- Cache-bust pattern: `tests/coding-credentials/redaction-log.test.ts`; tracked logger: `tests/utils/logger-mock.ts`
