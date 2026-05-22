<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0019: Recurring Task Automation (Phase 08)

## Status

Accepted

## Date

2026-03-20

## Context

Teams and individuals regularly lose track of routine work: weekly check-ins, monthly audits, per-sprint retro tasks, and completion-triggered follow-ups all require manual re-creation. Before Phase 08, papai had no mechanism to create tasks automatically on a schedule or in response to task completion. Users had to remember to create the same tasks repeatedly and could not delegate that responsibility to the bot.

Two scheduling patterns were needed:

1. **Fixed-schedule (cron)**: a task is created at a predictable calendar cadence regardless of whether the previous occurrence was completed (e.g. "every Monday at 09:00").
2. **On-completion**: a new task is created immediately when the current instance is marked done, enabling "never more than one open" workflows (e.g. a kanban replenishment cycle).

Both patterns required persistent storage of the template definition, a scheduler that survives bot restarts with low overhead, and LLM tools that allow users to manage the lifecycle (create, list, pause, resume, skip, update, delete) via natural language.

## Decision Drivers

- Zero-configuration recurring tasks: the bot creates instances without user intervention
- Both fixed-schedule and completion-triggered patterns must be supported
- Templates must inherit metadata (title, description, priority, assignee, labels, status) to every generated task instance
- Pause, skip, and resume operations must be cleanly separable; stopping must be permanent
- Resuming a paused series must offer optional backfill of missed occurrences
- Cron expressions must be validated before reaching the database
- No new runtime dependencies with heavy footprints; Bun compatibility is mandatory
- The scheduler must not block the event loop or crash the bot on individual task failures

## Considered Options

### Scheduling library

| Library          | Bun support | Dependencies           | Notes                                                                                |
| ---------------- | ----------- | ---------------------- | ------------------------------------------------------------------------------------ |
| **croner**       | Yes         | Zero                   | TypeScript-native, MIT, actively maintained through 2025, provides `Cron.validate()` |
| `node-cron`      | Partial     | Node-specific overhead | More popular but carries Node API assumptions                                        |
| `cron`           | Limited     | `luxon`                | Heavier bundle due to date library dependency                                        |
| `toad-scheduler` | Yes         | Zero                   | Interval-only, no cron expression support                                            |

### Architectural pattern for scheduling

| Option                                               | Description                                                     | Trade-offs                                                                                                   |
| ---------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| **DB-backed polling with `setInterval`**             | A periodic tick queries the DB for due templates and fires them | No external process; restarts clean up automatically; at most one tick delay; simple                         |
| In-process event-driven scheduler (`croner`)         | Each template gets an in-process `Cron` job object              | Lower latency for exact-minute firing; requires re-registering all jobs after every restart                  |
| External cron service (OS cron / Kubernetes CronJob) | An out-of-process runner triggers the bot via HTTP              | No in-process state; operationally complex; not compatible with the project's single-binary deployment model |

### Data model

| Option                                                                 | Description                                                                                                  |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| **Single `recurring_tasks` table**                                     | Template definition, schedule, and state in one table; occurrences tracked only in the external task tracker |
| Two tables (`recurring_task_templates` + `recurring_task_occurrences`) | Explicit occurrence audit trail; enables completion-hook lookup                                              |

## Decision

1. **No external scheduling library**: implement a zero-dependency custom cron parser (`src/cron.ts`) covering the standard 5-field format (minute, hour, day-of-month, month, day-of-week), with step values, ranges, and comma lists. This eliminates the `croner` runtime dependency entirely.
2. **DB-backed polling scheduler** (`src/scheduler.ts`): a `setInterval` fires every 60 seconds. Each tick calls `getDueRecurringTasks()` — a Drizzle query on the `(enabled, next_run)` index — and creates task instances for any overdue templates. After execution, `markExecuted()` advances `next_run` using the custom parser.
3. **Single `recurring_tasks` table** (migration 009): one table holds the template definition and schedule state. The separate `recurring_task_occurrences` table from the original plan was not implemented; the completion hook was also not implemented.
4. **7 LLM tools** registered unconditionally (no provider capability gate): `create_recurring_task`, `list_recurring_tasks`, `update_recurring_task`, `delete_recurring_task`, `pause_recurring_task`, `resume_recurring_task`, `skip_recurring_task`.
5. **Scheduler uses `enabled` boolean** instead of a `status` enum: `enabled='1'` means active, `enabled='0'` means paused. There is no explicit `cancelled` state; `delete_recurring_task` performs a hard delete.
6. **Timezone support**: the custom cron parser accepts an IANA timezone string (stored per-template, defaults to `'UTC'`). Missed-occurrence computation and next-run calculation both pass the timezone through `Intl.DateTimeFormat`.
7. **User notification**: when the scheduler fires a task, it calls `chatProvider.sendMessage(userId, ...)` to inform the user. This requires the scheduler to hold a reference to the `ChatProvider` instance (`src/scheduler.ts: chatProviderRef`).

## Rationale

**Custom cron parser over croner**: the plan recommended `croner` as the scheduling library. The implementation instead ships a custom parser in `src/cron.ts` (~289 lines). This choice eliminates an npm dependency entirely, gives full control over parsing semantics, integrates with the custom `Intl.DateTimeFormat`-based timezone handling, and avoids any Bun compatibility risk. The trade-off is that the implementation covers only the subset of cron syntax required by the use case (no `@reboot`, no 6-field seconds, no `L`/`W` extensions), which is acceptable given the scope.

**Polling over event-driven per-template jobs**: a 60-second polling interval was chosen over registering individual `Cron` job objects per template. Polling is simpler to reason about, requires no in-memory job registry that must be rebuilt on every restart, and has acceptable latency for task-creation workflows where sub-minute precision is not a product requirement.

**Single table over two tables**: the original plan proposed `recurring_task_templates` and `recurring_task_occurrences` as separate tables. The implementation uses a single `recurring_tasks` table. The occurrence table was intended to power the on-completion hook (looking up which template owns a given task ID). Since the completion hook was not implemented, the second table was not needed, and a simpler schema was chosen.

**Hard delete over cancelled status**: the plan proposed a `status='cancelled'` state so that stopped series remain in the database for audit purposes. The implementation uses hard delete via `DELETE FROM recurring_tasks`, which simplifies queries (no status filter needed for active templates) at the cost of losing history for cancelled series.

**`enabled` flag over `status` enum**: paused and active states are represented as `enabled='0'` and `enabled='1'` (stored as TEXT to stay consistent with other boolean columns in the schema), rather than a three-value enum. This is simpler and sufficient given that the cancelled state was replaced by hard delete.

## Consequences

### Positive

- Recurring tasks are created automatically without user intervention for both cron-schedule and (for `on_complete` templates) manual-resume workflows
- Zero new npm runtime dependencies: the cron parser, scheduler, and all tools are implemented in-project TypeScript
- IANA timezone support means schedules fire at the correct local time for users in any timezone
- Missed-occurrence backfill is implemented: on resume, `allOccurrencesBetween()` computes all missed slots and `createMissedTasks()` creates them in sequence, capped at 100 per call
- The `update_recurring_task` tool allows any template field to be changed without deleting and recreating the series; changing `cronExpression` immediately recomputes `next_run`
- Confirmation guard in `delete_recurring_task`: the tool requires a `confidence` parameter (0–1) and returns a confirmation prompt if confidence < 0.85, preventing accidental permanent deletion
- User notification on each fired occurrence via `ChatProvider.sendMessage`

### Negative

- **No completion hook**: the `on_complete` trigger type is stored and exposed to the LLM, but no code in `update-task.ts` fires `fireOccurrence` when a task is marked done. `on_complete` templates require manual resume via the `resume_recurring_task` tool.
- **60-second granularity**: the polling interval means cron schedules fire within 60 seconds of their specified time, not at the exact minute. This is acceptable for task-creation workflows but would be too coarse for time-sensitive automation.
- **No duplicate-fire guard**: if the bot restarts mid-tick-window, a due template may be fired twice. The `last_run` column is updated after task creation but there is no transaction that atomically checks-and-sets before creating the external task.
- **In-process scheduler state**: `chatProviderRef` is a module-level variable in `src/scheduler.ts`. If the `ChatProvider` is replaced (e.g. during a reconfiguration), the reference must be explicitly updated, or notifications will be silently lost.
- **Hard delete loses history**: cancelled recurring task series leave no record. There is no way to review or restore a deleted series.
- **Custom cron parser subset**: the parser does not support `@reboot`, 6-field (seconds) expressions, or the `L`/`W` day-of-month extensions. LLM-generated expressions using those features will fail validation silently (returning `null` from `parseCron`).

## Implementation Status

**Status**: Implemented (with divergence)

Evidence:

- `src/cron.ts` — custom zero-dependency cron parser: `parseCron`, `nextCronOccurrence`, `allOccurrencesBetween`, `describeCron`. No `croner` package is present in `package.json`; the plan's recommended library was not used.
- `src/scheduler.ts` — `startScheduler(chatProvider)` starts a 60-second `setInterval` tick. `tick()` calls `getDueRecurringTasks()` and `executeRecurringTask()` per due record. `stopScheduler()` clears the interval. `createMissedTasks()` handles backfill. No per-template `Cron` job objects; no `Map<templateId, Cron>` registry.
- `src/recurring.ts` — flat module (not a `src/recurring/` subdirectory as planned): exports `createRecurringTask`, `getRecurringTask`, `listRecurringTasks`, `updateRecurringTask`, `pauseRecurringTask`, `resumeRecurringTask`, `skipNextOccurrence`, `deleteRecurringTask`, `getDueRecurringTasks`, `markExecuted`.
- `src/db/schema.ts` lines 72–104 — single `recurringTasks` table; no `recurringTaskOccurrences` table.
- `src/db/migrations/009_recurring_tasks.ts` — migration 009 creates `recurring_tasks` with indexes `idx_recurring_tasks_user` and `idx_recurring_tasks_enabled_next`. No `recurring_task_occurrences` table created.
- `src/db/index.ts` lines 13 and 49 — `migration009RecurringTasks` imported and registered as the final entry in `MIGRATIONS`.
- `src/tools/create-recurring-task.ts` — `makeCreateRecurringTaskTool(userId)`: validates cron expression via `parseCron`, calls `createRecurringTask`, returns human-readable schedule via `describeCron`.
- `src/tools/list-recurring-tasks.ts` — `makeListRecurringTasksTool(userId)`: returns all templates for the user with schedule description.
- `src/tools/update-recurring-task.ts` — `makeUpdateRecurringTaskTool()`: updates any template field; recomputes `next_run` when `cronExpression` changes.
- `src/tools/delete-recurring-task.ts` — `makeDeleteRecurringTaskTool()`: confidence-gated hard delete.
- `src/tools/pause-recurring-task.ts` — `makePauseRecurringTaskTool()`: sets `enabled='0'`.
- `src/tools/resume-recurring-task.ts` — `makeResumeRecurringTaskTool()`: sets `enabled='1'`, optionally calls `createMissedTasks`.
- `src/tools/skip-recurring-task.ts` — `makeSkipRecurringTaskTool()`: advances `next_run` by one cron interval without creating a task.
- `src/tools/update-task.ts` — no completion hook present; `makeUpdateTaskTool(provider)` signature unchanged; no `recurringService` parameter.
- `src/types/recurring.ts` — `TriggerType = 'cron' | 'on_complete'`; `RecurringTaskInput`; `RecurringTaskRecord`. Types live in `src/types/` not `src/recurring/types.ts` as planned.

### Key divergences from the plan

| Area                  | Plan                                                                                     | Implementation                                                                        |
| --------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Scheduling library    | `croner@^9`                                                                              | Custom cron parser in `src/cron.ts` (zero deps)                                       |
| Scheduler design      | Per-template `Cron` job objects, `Map<templateId, Cron>`                                 | Single `setInterval` polling every 60 seconds                                         |
| File structure        | `src/recurring/{index,scheduler,service,tools,types}.ts`                                 | Flat: `src/recurring.ts`, `src/scheduler.ts`, `src/cron.ts`, `src/types/recurring.ts` |
| DB tables             | Two tables: `recurring_task_templates` + `recurring_task_occurrences`                    | One table: `recurring_tasks`                                                          |
| Column naming         | `schedule_type`, `status`, `skip_next`, `backfill_mode`, `last_fired_at`, `next_fire_at` | `trigger_type`, `enabled`, `catch_up`, `last_run`, `next_run`                         |
| Template status model | `status` enum: `active \| paused \| cancelled`                                           | `enabled` boolean; no cancelled state (hard delete)                                   |
| Completion hook       | `update_task` triggers `fireOccurrence` on status = done/completed/closed/resolved       | Not implemented; `on_complete` templates require manual resume                        |
| Stop/cancel           | `stop_recurring_task` sets `status='cancelled'`                                          | `delete_recurring_task` performs hard delete with confidence guard                    |
| Pause/resume          | Single `pause_recurring_task` tool with `action` field                                   | Separate `pause_recurring_task` and `resume_recurring_task` tools                     |
| 5 planned tools       | `create`, `list`, `skip_next_occurrence`, `pause` (with resume), `stop`                  | 7 actual tools: `create`, `list`, `update`, `delete`, `pause`, `resume`, `skip`       |
| Backfill cap          | 10 occurrences maximum                                                                   | 100 occurrences maximum (via `allOccurrencesBetween` default)                         |
| Timezone              | UTC-only (`timezone: 'UTC'` in croner)                                                   | Per-template IANA timezone stored in `timezone` column                                |
| Migration number      | 009                                                                                      | 009 (matches)                                                                         |

## Related Decisions

- **ADR-0010** (Drizzle ORM for Database Access) — the `recurringTasks` table is defined with `sqliteTable` and queried via Drizzle throughout `src/recurring.ts`; migration 009 follows the numbered migration convention established in ADR-0010.
- **ADR-0016** (Conversation Persistence and Context Management) — the same SQLite database and migration framework are shared; the scheduler's `getDueRecurringTasks()` query runs against the same Drizzle instance as conversation history queries.

## Related Plans

- `/Users/ki/Projects/experiments/papai/docs/plans/done/2026-03-20-phase-08-recurring-work-automation.md`
