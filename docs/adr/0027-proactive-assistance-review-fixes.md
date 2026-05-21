<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0027: Proactive Assistance Review Fixes

## Status

Accepted

## Date

2026-03-22

## Context

Post-implementation review of Phase 7 (Proactive Assistance) identified 13 issues across severity levels. The most critical was a Drizzle schema mismatch where `overdueDaysNotified` was declared as `text()` but the DDL and all consumers expected `integer()`, causing silent type coercion. Other findings included duplicated constants and functions (`TERMINAL_STATUS_SLUGS`, `isTerminalStatus`, `fetchAllTasks`) across `service.ts` and `briefing.ts`, a missing `checkBlocked` alert (US7 from the original plan), the `get_briefing` tool incorrectly marking briefings as delivered in `user_briefing_state` (preventing the next scheduled briefing), `suggestActions` mutating input arrays via `.sort()`, a custom `ReminderNotFoundError` class diverging from the project's `AppError` pattern, missing `ReminderStatus` type enforcement, incomplete briefing sections, scheduler test isolation issues from `spyOn` leakage, and the `_briefingJobs` internal map being exported directly instead of through an accessor.

## Decision Drivers

- A schema mismatch between Drizzle type declarations and runtime usage causes silent bugs that bypass TypeScript's type system.
- Code duplication across `service.ts` and `briefing.ts` creates divergence risk when terminal status definitions or task-fetching logic change.
- The `checkBlocked` alert (US7) was specified in the Phase 7 plan but not implemented, leaving a gap in proactive notifications for blocked tasks approaching their deadline.
- The `get_briefing` tool updating `user_briefing_state` meant that manually requesting a briefing suppressed the next scheduled delivery, a correctness bug.
- Inconsistent error types (`ReminderNotFoundError` vs `AppError`) split the error handling path, requiring callers to check for two unrelated patterns.
- Scheduler tests using a file-scoped `spyOn(globalThis, 'setInterval')` accumulated call counts across tests, causing false passes or failures depending on execution order.

## Considered Options

### Option 1: Address issues incrementally across future phases

Defer non-critical fixes to subsequent phases and only fix the schema mismatch and `get_briefing` state bug now.

- **Pros**: Smaller change set, lower risk of regressions.
- **Cons**: Duplicated code continues to diverge. Missing `checkBlocked` remains undelivered. Test isolation issues persist, masking real failures. Technical debt accumulates.

### Option 2: Comprehensive single-pass fix of all review findings (chosen)

Fix all 13 issues in a single coordinated pass, organized into 7 phases with explicit dependency ordering.

- **Pros**: Eliminates all known issues at once. Dependency ordering (shared utilities first, then consumers) prevents partial fixes. Test coverage is added alongside each implementation change. No deferred debt.
- **Cons**: Larger change set touching 8 source files and 5 test files. Requires careful sequencing to avoid intermediate breakage.

## Decision

All review findings were addressed in a single implementation pass across 7 phases:

1. **Shared utilities extraction (F3, F4)** -- Created `src/proactive/shared.ts` as the single source of truth for `TERMINAL_STATUS_SLUGS`, `isTerminalStatus`, and `fetchAllTasks`. Updated `service.ts` and `briefing.ts` to import from the shared module, removing their local duplicates.

2. **Schema and type fixes (F1, F2)** -- Changed `overdueDaysNotified` in `src/db/schema.ts` from `text('overdue_days_notified').default('0')` to `integer('overdue_days_notified').default(0)`. Removed all `Number.parseInt` and `String()` conversions in `service.ts`. Added `ReminderStatus` type to `src/proactive/types.ts` and applied it in `reminders.ts`.

3. **`checkBlocked` implementation (F5)** -- Added `checkBlocked` to `service.ts`, checking tasks due within one day for unresolved `blocked_by` relations via `provider.getTask()`. Wired into `runAlertCycle` as a separate async pass after the synchronous alert checks. Short-circuits when the provider lacks `tasks.relations` capability.

4. **Briefing fixes (F6, F7, F8)** -- Added "Recently Updated" section to `buildSections` using `alert_state` rows with recent `lastStatusChangedAt`. Split `generate()` from state updates: `generate()` produces briefing content without side effects; `generateAndRecord()` wraps it with the `user_briefing_state` upsert. The `get_briefing` tool calls `generate()` directly; the scheduler and catch-up hook call `generateAndRecord()`. Replaced `.sort()` with `.toSorted()` in `suggestActions` to prevent input mutation.

5. **Error pattern consolidation (F9)** -- Removed `ReminderNotFoundError` class. Replaced with `providerError.notFound('reminder', reminderId)` from the existing `AppError` pattern. Updated `handleReminderError` in `tools.ts` to use `isAppError` checks.

6. **Scheduler fixes (F10, F11, F12)** -- Replaced the exported `_briefingJobs` map with a `getBriefingJobCount()` accessor. Fixed test isolation by scoping `setInterval` spies per-test with `beforeEach`/`afterEach` restore. Added initial `void pollAlerts()` call alongside `void pollReminders()` at startup.

7. **Test coverage gaps (F13)** -- Added tests for `runAlertCycleForAllUsers`, `checkBlocked` (6 cases), `buildSections` "Recently Updated" section, `get_briefing` no-state-update verification, scheduler delivery and error handling, and `AppError` pattern assertions in reminder tests.

## Rationale

A single-pass approach was chosen because many fixes share dependencies: extracting shared utilities (Phase 1) must precede `checkBlocked` implementation (Phase 3) and briefing updates (Phase 4). Fixing them together ensures no intermediate state where half the codebase uses the old pattern and half the new. The `integer()` schema fix requires no SQLite migration because SQLite's type affinity reads existing `'0'` string values as integer `0`. Separating `generate()` from `generateAndRecord()` follows the single-responsibility principle: the briefing content function has no side effects, making it safe for both manual tool invocation and scheduled delivery.

## Consequences

### Positive

- `TERMINAL_STATUS_SLUGS`, `isTerminalStatus`, and `fetchAllTasks` each exist in exactly one location (`src/proactive/shared.ts`), eliminating divergence risk.
- The `overdueDaysNotified` column is typed as `integer` in Drizzle, matching the DDL and runtime usage; no string-number coercion code remains.
- `checkBlocked` delivers US7: users receive alerts when a task due in one day or less has an unresolved blocker.
- Manual briefing requests via `get_briefing` no longer suppress the next scheduled briefing delivery.
- All reminder error handling uses the project's `AppError` discriminated union; no custom error classes exist in the proactive module.
- `ReminderStatus` type prevents invalid status string literals at compile time.
- Scheduler tests are isolated per-test, preventing false passes from accumulated spy state.
- `suggestActions` is side-effect-free; callers can reuse input section arrays safely.

### Negative

- `checkBlocked` introduces N+1 `provider.getTask()` calls (one per blocked relation per task due within one day). This is mitigated by the small subset of tasks that qualify (due tomorrow or sooner, non-terminal, with relations), but could become a concern with large task counts.
- The "Newly Assigned" briefing section remains unimplemented because `TaskListItem` does not carry `createdAt`. This is documented as a known limitation.
- The "Recently Updated" section depends on `alert_state` data, which is only populated for tasks that have triggered alerts. Tasks with status changes that never triggered an alert will not appear.

## Implementation Status

**Status**: Implemented

Evidence:

- `src/proactive/shared.ts` exists and exports `TERMINAL_STATUS_SLUGS`, `isTerminalStatus`, and `fetchAllTasks`.
- `src/db/schema.ts` declares `overdueDaysNotified: integer('overdue_days_notified').default(0)`.
- `src/proactive/types.ts` exports `ReminderStatus`; `src/proactive/reminders.ts` imports and uses it.
- `src/proactive/service.ts` exports `checkBlocked` and calls it from `runAlertCycle`.
- `src/proactive/briefing.ts` exports both `generate()` (no state update) and `generateAndRecord()` (with state update).
- `src/proactive/scheduler.ts` exports `getBriefingJobCount()` instead of `_briefingJobs`; calls `generateAndRecord()` for scheduled briefings; calls `void pollAlerts()` on startup.
- No `ReminderNotFoundError` class exists in `src/`.
- Test files `tests/proactive/service.test.ts`, `tests/proactive/briefing.test.ts`, `tests/proactive/scheduler.test.ts`, `tests/proactive/tools.test.ts`, and `tests/proactive/reminders.test.ts` cover all new and modified behavior.

## Related Decisions

- [ADR-0020: Error Classification Improvements](0020-error-classification-improvements.md) -- established the `AppError` discriminated union and `providerError` constructors that this ADR consolidates `ReminderNotFoundError` into.

## Related Plans

- `/docs/plans/done/2026-03-22-phase-07-review-fixes.md`
- `/docs/plans/done/2026-03-20-phase-07-proactive-assistance.md` (original Phase 7 plan that this review fixes address)
