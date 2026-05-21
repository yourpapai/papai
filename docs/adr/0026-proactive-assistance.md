<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0026: Proactive Assistance (Phase 7)

## Status

Deprecated (Superseded by ADR-0030)

## Date

2026-03-20

## Context

Prior to this change, papai operated as a purely reactive assistant: it could only respond when a user sent a message. Users had no way to receive proactive notifications about upcoming deadlines, overdue tasks, daily briefings, stale work items, or personal reminders. Time-critical work fell through the cracks because the bot required the user to initiate every interaction at exactly the right moment.

The bot already had:

- A full set of task CRUD tools (`create_task`, `update_task`, `list_tasks`, `search_tasks`, `get_task`) across both Kaneo and YouTrack providers.
- Per-user SQLite-backed configuration via `getConfig`/`setConfig`.
- A numbered migration framework (`runMigrations`) with Drizzle ORM schema definitions.
- A `ChatProvider.sendMessage(userId, markdown)` method capable of bot-initiated messages.
- The `croner` scheduling library (installed by Phase 8 for recurring task automation).
- A `processMessage` entry point in the LLM orchestrator where a catch-up hook could be injected.

The gaps were:

1. No persistence layer for reminders, briefing delivery state, or per-task alert tracking (staleness, suppression windows, overdue escalation counters).
2. No services for reminder CRUD, briefing generation, or deadline/staleness/blocked-task alert cycles.
3. No scheduler to run timed jobs: per-user morning briefings, a global alert poller, and a per-minute reminder poller.
4. No LLM tools for users to create, list, cancel, snooze, or reschedule reminders, or to request a briefing on demand.
5. No first-message catch-up mechanism to deliver a missed briefing when the user's first message of the day arrives after the scheduled briefing time.

## Decision Drivers

- The bot must be able to initiate contact with the user without requiring an incoming message; this is the fundamental shift from reactive to proactive.
- Alerts must not flood the user: each alert type for a given task must have a configurable suppression window to prevent duplicate notifications.
- Overdue escalations must increase in urgency over time (soft, moderate, urgent) rather than sending identical messages daily.
- Morning briefings must respect the user's local timezone and preferred delivery time, with short and full verbosity modes.
- If a user misses a scheduled briefing and then sends a message later that day, the briefing must be delivered as a catch-up before the LLM response.
- Reminder creation must leverage the existing LLM for natural language time resolution rather than introducing a new date-parsing library.
- No new production dependencies beyond what Phase 8 already installed (`croner`).
- The scheduler must survive bot restarts: all state (reminders, briefing delivery, alert suppression) is persisted in SQLite, and scheduled jobs are re-registered from the database on startup.

## Considered Options

### Option 1: Polling scheduler with SQLite persistence (chosen)

A `ProactiveAlertScheduler` uses `croner` to register three categories of timed jobs: per-user briefing crons (weekdays at the user's configured time/timezone), a global daily alert poller (deadline nudges, due-today, overdue, staleness, blocked-task checks), and a global per-minute reminder poller. All state is persisted in three new SQLite tables (`reminders`, `user_briefing_state`, `alert_state`), making the system resilient to restarts.

- **Pros**: Zero new dependencies (reuses `croner` from Phase 8). SQLite persistence is consistent with the existing data layer. Per-user cron jobs handle timezone and DST transitions via croner's IANA timezone support. The per-minute reminder poller is simple and sufficient at expected scale. Alert suppression windows prevent duplicate notifications.
- **Cons**: Polling introduces a maximum one-minute delivery latency for reminders. The alert poller fetches all tasks for all opted-in users once daily, which could be slow at large scale. Per-user briefing jobs scale linearly with user count.

### Option 2: Event-driven architecture with external message queue

Use an external message queue (e.g. Redis pub/sub, BullMQ, or similar) to trigger proactive notifications based on task change events rather than polling.

- **Pros**: Near-real-time delivery. No polling overhead. Could scale horizontally.
- **Cons**: Introduces a new infrastructure dependency (Redis or equivalent), increasing operational complexity. Task tracker providers do not emit change events; the bot would still need to poll providers and then publish events, negating much of the benefit. Disproportionate complexity for a single-instance bot with a modest user base.

### Option 3: External scheduler service (cron daemon, systemd timers)

Delegate scheduling to the OS or an external cron service that invokes bot endpoints or scripts at scheduled times.

- **Pros**: Offloads scheduling to battle-tested infrastructure.
- **Cons**: Loses the per-user dynamic scheduling capability (briefing times configured at runtime). Requires additional deployment configuration. Cannot be managed from within the bot. Breaks the self-contained deployment model.

## Decision

Implemented a new `src/proactive/` module with polling-based scheduling and SQLite persistence, comprising:

1. **Database schema (migration 011)** — Three new tables:
   - `reminders`: stores one-time and recurring reminders with `fire_at`, `recurrence` (cron), and `status` (`pending`/`delivered`/`snoozed`/`cancelled`). Indexed on `(user_id)` and `(status, fire_at)`.
   - `user_briefing_state`: tracks `last_briefing_date` and `last_briefing_at` per user to prevent duplicate briefings and enable catch-up detection.
   - `alert_state`: tracks per-task alert history including `last_seen_status`, `last_status_changed_at` (for staleness detection), `last_alert_type`, `suppress_until` (for deduplication), and `overdue_days_notified` (for escalation tier tracking). Indexed on `(user_id)` and `(user_id, task_id)`.

2. **Five new config keys** — `briefing_time` (HH:MM), `briefing_timezone` (IANA), `briefing_mode` (`short`/`full`), `deadline_nudges` (`enabled`/`disabled`), `staleness_days` (numeric string).

3. **Shared utilities (`src/proactive/shared.ts`)** — `TERMINAL_STATUS_SLUGS` constant and `isTerminalStatus()` for filtering out completed/archived tasks, and `fetchAllTasks()` which fetches tasks across all projects (with a cap of 20 projects) or falls back to `searchTasks`.

4. **ReminderService (`src/proactive/reminders.ts`)** — CRUD operations for reminders: `createReminder`, `listReminders`, `cancelReminder`, `snoozeReminder`, `rescheduleReminder`, `fetchDue`, `markDelivered`, `advanceRecurrence`. All mutation methods enforce ownership by querying on `(id, user_id)`.

5. **ProactiveAlertService (`src/proactive/service.ts`)** — Alert cycle logic: `checkDeadlineNudge` (task due tomorrow), `checkDueToday`, `checkOverdue` (with three escalation tiers: soft at 1-2 days, moderate at 3-5 days, urgent at 6+ days), `checkStaleness` (inactive for >= threshold days), `checkBlocked` (unresolved blocker on task due within 1 day). Each check respects `suppress_until` to prevent duplicate alerts. `runAlertCycle` orchestrates all checks for a single user; `runAlertCycleForAllUsers` iterates over all users with `deadline_nudges = 'enabled'`.

6. **BriefingService (`src/proactive/briefing.ts`)** — Generates morning briefings with up to six sections (Due Today, Overdue, In Progress, Recently Updated, Newly Assigned, Suggested Actions). Full mode renders all sections as markdown; short mode returns a single summary line of counts. `getMissedBriefing` detects whether today's briefing was missed and generates a catch-up version with a header prefix.

7. **ProactiveAlertScheduler (`src/proactive/scheduler.ts`)** — Singleton scheduler managing three job categories via `croner`:
   - Per-user briefing crons (`"M H * * 1-5"` with the user's timezone), stored in a `Map<userId, Cron>`.
   - Global alert poller (daily at 06:00 UTC).
   - Global reminder poller (every minute), which calls `fetchDue()`, sends each due reminder via `chatProvider.sendMessage`, marks it delivered, and advances recurrence for recurring reminders.

8. **Six LLM tools (`src/proactive/tools.ts`)** — `set_reminder`, `list_reminders`, `cancel_reminder`, `snooze_reminder`, `reschedule_reminder`, `get_briefing`. All registered in the tool set via `makeProactiveTools(userId, provider)` and merged into the main tool set in `src/tools/index.ts`.

9. **First-message catch-up hook** — In `src/llm-orchestrator.ts`, `processMessage` calls `briefingService.getMissedBriefing(contextId, provider)` before invoking the LLM. If a non-null catch-up briefing is returned, it is sent via `reply.formatted()` before the LLM response.

10. **Startup and shutdown wiring** — `src/index.ts` imports the `proactiveScheduler` singleton, calls `start(chatProvider, buildProviderForUser)` after database initialization, and calls `stopAll()` in both `SIGINT` and `SIGTERM` handlers.

## Rationale

The polling scheduler with SQLite persistence was chosen because it aligns with the project's existing architectural patterns:

- **Consistency with Phase 8**: The recurring task automation (Phase 8) established the `croner`-based scheduler singleton pattern (`Map<id, Cron>`, `start`/`register`/`unregister`/`stopAll`). Reusing the same library and pattern reduces cognitive overhead and ensures both schedulers coexist cleanly in `src/index.ts`.
- **No new dependencies**: The entire proactive module is built on existing infrastructure — `croner` for scheduling, `drizzle-orm/bun-sqlite` for persistence, Zod for validation, and the `ChatProvider.sendMessage` API for bot-initiated messages.
- **SQLite resilience**: All proactive state survives bot restarts. On startup, the scheduler re-registers briefing jobs from persisted config and the reminder poller immediately picks up any reminders that came due during downtime.
- **LLM-driven time resolution**: Rather than adding a natural language date-parsing library, the `set_reminder` and `snooze_reminder` tools instruct the LLM to resolve expressions like "tomorrow at 9am" into ISO timestamps before calling the tool. This is consistent with the existing pattern where the LLM performs all interpretation and tools receive structured data.
- **Suppression windows prevent alert storms**: Each alert type has a configurable suppression window (20 hours for most alerts, 72 hours for staleness). The `alert_state.suppress_until` column ensures that even if the bot restarts mid-cycle, no duplicate alert is sent for the same task/type pair.
- **Extracted shared utilities**: `isTerminalStatus()` and `fetchAllTasks()` were extracted into `src/proactive/shared.ts` (not in the original plan) to avoid code duplication between the alert service and the briefing service. Both modules need to filter terminal tasks and fetch tasks across all projects.

## Consequences

### Positive

- The bot transforms from a purely reactive assistant into a proactive teammate, delivering time-sensitive information without requiring user initiation.
- Morning briefings are delivered at the user's chosen local time on weekdays, with timezone-aware scheduling via croner's IANA timezone support.
- Users who miss their scheduled briefing receive a catch-up version prepended to their first interaction of the day, ensuring no briefing is silently lost.
- Deadline alerts escalate in tone over time (soft, moderate, urgent), providing increasing urgency for genuinely overdue work without desensitizing users with constant high-urgency messages.
- Staleness detection identifies tasks that have not changed status within a configurable threshold, surfacing forgotten work items.
- Blocked-task alerts notify users when a task with an unresolved blocker is approaching its deadline, enabling proactive resolution.
- Reminder management is fully integrated into the LLM tool-calling flow, allowing users to create, list, snooze, reschedule, and cancel reminders via natural language.
- All proactive state is persisted in SQLite, making the system resilient to bot restarts with no lost reminders or duplicate alerts.
- The implementation adds zero new production dependencies.

### Negative

- The per-minute reminder poller introduces up to 60 seconds of delivery latency for reminders. This is acceptable for the current use case but would need rethinking for sub-minute precision requirements.
- The daily alert poller fetches all tasks for all opted-in users sequentially, with a cap of 20 projects per user. At large scale (many users, many projects), this could become slow and may need batching or caching.
- Per-user briefing cron jobs scale linearly with user count. Each user with a configured `briefing_time` gets a dedicated `Cron` instance. This is fine for dozens of users but would need a different approach for thousands.
- The `src/llm-orchestrator.ts` now imports `briefingService` directly, adding a proactive module dependency to the orchestration layer. This is an accepted trade-off for the catch-up hook's simplicity.
- The migration was numbered 011 (not 010 as planned), indicating the actual migration sequence diverged from the plan, likely due to an intervening migration added by another phase.
- The plan specified `src/proactive/types.ts` as the only shared type file, but implementation extracted shared logic (`isTerminalStatus`, `fetchAllTasks`) into a separate `src/proactive/shared.ts` file not anticipated in the plan.

## Implementation Status

**Status**: Implemented

Evidence:

### Database Schema & Migration

- `src/db/migrations/011_proactive_alerts.ts` — Creates `reminders`, `user_briefing_state`, and `alert_state` tables with all columns and indexes matching the planned data model.
- `src/db/schema.ts` — Drizzle table definitions for `reminders`, `userBriefingState`, and `alertState` with exported inferred types (`Reminder`, `UserBriefingState`, `AlertStateRow`).
- `src/db/index.ts` — `migration011ProactiveAlerts` registered in the `MIGRATIONS` array.

### Config Keys

- `src/types/config.ts` — Five new keys added to `ConfigKey` union and `CONFIG_KEYS` array: `briefing_time`, `briefing_timezone`, `briefing_mode`, `deadline_nudges`, `staleness_days`.

### Proactive Module (`src/proactive/`)

- `src/proactive/types.ts` — Type definitions: `ReminderStatus`, `AlertType`, `BriefingMode`, `BriefingSection`, `BriefingTask`, `CreateReminderParams`, `AlertCheckResult`.
- `src/proactive/shared.ts` — Shared utilities: `TERMINAL_STATUS_SLUGS`, `isTerminalStatus()`, `fetchAllTasks()`.
- `src/proactive/reminders.ts` — `ReminderService` with full CRUD, `fetchDue`, `markDelivered`, `advanceRecurrence`.
- `src/proactive/service.ts` — `ProactiveAlertService` with `checkDeadlineNudge`, `checkDueToday`, `checkOverdue` (3-tier escalation), `checkStaleness`, `checkBlocked`, `updateAlertState`, `runAlertCycle`, `runAlertCycleForAllUsers`.
- `src/proactive/briefing.ts` — `BriefingService` with `generate`, `getMissedBriefing`, `buildSections`, `formatFull`, `formatShort`, `suggestActions`.
- `src/proactive/scheduler.ts` — `ProactiveAlertScheduler` singleton with `start`, `registerBriefingJob`, `unregisterBriefingJob`, `stopAll`.
- `src/proactive/tools.ts` — Six LLM tools: `set_reminder`, `list_reminders`, `cancel_reminder`, `snooze_reminder`, `reschedule_reminder`, `get_briefing`. Exported via `makeProactiveTools(userId, provider)`.
- `src/proactive/index.ts` — Public barrel exports for all services, types, shared utilities, and tools.

### Integration Points

- `src/tools/index.ts` — Imports `makeProactiveTools` and merges proactive tools into the tool set.
- `src/llm-orchestrator.ts` — Imports `briefingService`; `processMessage` calls `getMissedBriefing` before the LLM invocation and sends catch-up via `reply.formatted()`.
- `src/index.ts` — Imports `proactiveScheduler`; calls `start(chatProvider, buildProviderForUser)` after DB init; calls `stopAll()` in `SIGINT`/`SIGTERM` handlers.

### Test Files

- `tests/proactive/service.test.ts` — Alert service tests (deadline nudge, due-today, overdue escalation tiers, staleness, blocked-task, suppression windows, terminal task filtering).
- `tests/proactive/reminders.test.ts` — Reminder CRUD tests (create, list, cancel, snooze, fetchDue, advanceRecurrence, ownership enforcement).
- `tests/proactive/briefing.test.ts` — Briefing generation tests (short/full mode, sections, missed briefing catch-up, suggestActions priority ordering).
- `tests/proactive/scheduler.test.ts` — Scheduler tests (job registration, stopAll, error handling in callbacks, reminder delivery flow).
- `tests/proactive/tools.test.ts` — Tool tests (set_reminder validation, cancel/snooze/reschedule ownership, get_briefing mode fallback).

### Divergences from Plan

- Migration numbered 011 instead of the planned 010, due to an intervening migration added between planning and implementation.
- `src/proactive/shared.ts` was added as a new file (not in the plan) to extract shared utilities (`isTerminalStatus`, `fetchAllTasks`) used by both the alert service and the briefing service.
- The scheduler's `start()` signature uses `(chatProvider, buildProviderForUser)` rather than the planned `(alertService, briefingService, reminderService, chat, provider)`, indicating the services are accessed via module-level imports rather than constructor injection.
- The `makeProactiveTools` signature is `(userId, provider)` rather than the planned `(reminderService, briefingService, scheduler)`, reflecting the same module-import pattern.

## Related Decisions

- [ADR-0016: Conversation Persistence and Context Management](0016-conversation-persistence-and-context.md) — Established the per-user SQLite persistence patterns (migration framework, Drizzle ORM schema, `user_id` isolation) that the proactive module extends with three new tables.
- [ADR-0019: Recurring Task Automation](0019-recurring-task-automation.md) — Introduced `croner` as the in-process scheduler and established the singleton scheduler pattern (`Map<id, Cron>`, `start`/`register`/`unregister`/`stopAll`) that Phase 7 reuses.
- [ADR-0010: Drizzle ORM Migration](0010-drizzle-orm-migration.md) — Defined the Drizzle ORM query layer and `sqliteTable` schema definition patterns used for the new `reminders`, `userBriefingState`, and `alertState` tables.
- [ADR-0014: Multi-Chat Provider Abstraction](0014-multi-chat-provider-abstraction.md) — Defined the `ChatProvider.sendMessage` API that enables bot-initiated proactive messages across Telegram and Mattermost.
- [ADR-0015: Enhanced Tool Capabilities](0015-enhanced-tool-capabilities.md) — Established the `makeXxxTool(provider)` tool factory pattern and capability-gated tool registration that the proactive tools follow.

## Related Plans

- `/docs/plans/done/2026-03-20-phase-07-proactive-assistance.md`
