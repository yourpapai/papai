<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Phase 09: Event-Driven Suggestions — Development Plan

**Created**: 2026-03-20  
**Scope**: User stories from `docs/user-stories/phase-09-event-driven-suggestions.md`  
**Runtime**: Bun  
**Test runner**: `bun:test`  
**Linter**: oxlint (no `eslint-disable`, no `@ts-ignore`)

---

## Epic Overview

- **Business Value**: The bot stops waiting for users to ask and starts anticipating what they need. A newly created bare-bones task immediately surfaces suggestions for missing due dates, labels, assignees, and related work. Significant task changes trigger interactive follow-up prompts rather than silent overwrites. Completing a task opens a structured conversation about what comes next. Weekly rituals — a Friday wrap-up and a Monday kickoff — replace ad-hoc reflection. On-demand priority ranking gives users a clear answer to "what should I work on?" at any moment in the day.
- **Success Metrics**:
  - A task created with only a title returns at least one concrete suggestion (due date, label, assignee, or related task) in the same LLM response
  - When a due date is pushed back by ≥3 days or a task status regresses to an earlier stage, papai sends a follow-up message naming the change and offering a specific corrective action
  - When a task is marked done and has dependent or related open tasks, papai asks whether to create a follow-up task, close dependents, or send a team summary — in the same response
  - A configured end-of-week summary is delivered on the last workday at the user's configured time and lists completed, slipped, and carried-over tasks
  - A configured start-of-week kickoff is delivered on the first workday at the user's configured time, asks for top-3 goals, and surfaces overdue / high-priority items
  - `suggest_next_task` returns a ranked list of ≤3 open tasks with a one-sentence reason for each
  - Overdue and stale task alerts (from Phase 7) include specific interactive action options rather than passive notifications
- **Priority**: High — builds directly on Phase 7 (proactive alert infrastructure) and Phase 8 (croner, scheduler); requires both phases to be implemented first
- **Timeline**: 5–6 days

---

## Current State Audit

### What is already in place

| Area                                                                                  | Status                              |
| ------------------------------------------------------------------------------------- | ----------------------------------- |
| `create_task` tool (`src/tools/create-task.ts`)                                       | ✅ Complete                         |
| `update_task` tool (`src/tools/update-task.ts`)                                       | ✅ Complete                         |
| `get_task` tool for fetching task state before an update                              | ✅ Complete                         |
| `list_tasks`, `search_tasks`, `add_task_relation` tools                               | ✅ Complete                         |
| `user_config` table with `getCachedConfig` / `setCachedConfig`                        | ✅ Complete                         |
| SQLite migration framework (`runMigrations`, numbered `NNN_name`)                     | ✅ Complete                         |
| `drizzle-orm/bun-sqlite` schema + typed query layer                                   | ✅ Complete                         |
| Per-user `user_id` key on all data rows (isolation guarantee)                         | ✅ Complete                         |
| Tool index pattern: `makeXxxTool(provider)` returning `ToolSet[string]`               | ✅ Complete                         |
| Structured logger with child scopes (`logger.child({ scope })`)                       | ✅ Complete                         |
| `chatProvider.sendMessage(userId, markdown)` for proactive contact                    | ✅ Complete                         |
| `croner` scheduler library                                                            | ⚠️ Added by Phase 8 (reused here)   |
| `ProactiveAlertService` with `checkOverdue`, `checkStaleness`                         | ⚠️ Added by Phase 7 (enhanced here) |
| `BriefingService` with `generate`, `getMissedBriefing`                                | ⚠️ Added by Phase 7 (extended here) |
| `ProactiveAlertScheduler` with per-user briefing and global poller jobs               | ⚠️ Added by Phase 7 (extended here) |
| `alert_state` table (per-task suppression tracking)                                   | ⚠️ Added by Phase 7 (migration 010) |
| `user_briefing_state` table                                                           | ⚠️ Added by Phase 7 (migration 010) |
| Config keys `briefing_time`, `briefing_timezone`, `deadline_nudges`, `staleness_days` | ⚠️ Added by Phase 7                 |
| Migrations 008–010 registered in `src/db/index.ts`                                    | ⚠️ Registered by Phases 7–8         |

### Confirmed gaps (mapped to user stories)

| Gap                                                                                  | Story        | File(s)                      |
| ------------------------------------------------------------------------------------ | ------------ | ---------------------------- |
| `create_task` returns no suggestions for missing fields                              | US1          | `src/tools/create-task.ts`   |
| `update_task` does not detect or report significant field changes                    | US2          | `src/tools/update-task.ts`   |
| `update_task` does not surface completion follow-up options                          | US3          | `src/tools/update-task.ts`   |
| `checkOverdue` and `checkStaleness` send passive alerts; no action options           | US4, US5     | `src/proactive/service.ts`   |
| No `generateWeeklySummary` method in `BriefingService`                               | US6          | `src/proactive/briefing.ts`  |
| No `generateWeeklyKickoff` method in `BriefingService`                               | US7          | `src/proactive/briefing.ts`  |
| No weekly cron jobs in `ProactiveAlertScheduler`                                     | US6, US7     | `src/proactive/scheduler.ts` |
| No `weekly_state` table for weekly delivery deduplication                            | US6, US7     | `src/db/schema.ts`           |
| No new config keys (`weekly_review`, `workdays`, `week_end_time`, `week_start_time`) | US6, US7     | `src/types/config.ts`        |
| No `suggest_next_task` tool                                                          | US8          | none yet                     |
| No `EventSuggestionService` for creation/update/completion suggestion generation     | US1–US3, US8 | none yet                     |
| System prompt does not instruct the LLM to present suggestion payloads               | US1–US3      | `src/llm-orchestrator.ts`    |

### User story status summary

| Story | Description                             | Status     | Work Required                                                              |
| ----- | --------------------------------------- | ---------- | -------------------------------------------------------------------------- |
| US1   | Suggestions after task creation         | ❌ Missing | `EventSuggestionService`, hook in `create_task`, system prompt, tests      |
| US2   | Alert when task update needs follow-up  | ❌ Missing | Change detection in `EventSuggestionService`, hook in `update_task`, tests |
| US3   | Next-step suggestions after completion  | ❌ Missing | `getCompletionSuggestions`, hook in `update_task`, tests                   |
| US4   | Interactive overdue prompt              | ❌ Missing | Enhance `checkOverdue` message in `ProactiveAlertService`                  |
| US5   | Interactive stale task nudge            | ❌ Missing | Enhance `checkStaleness` message in `ProactiveAlertService`                |
| US6   | End-of-week summary                     | ❌ Missing | `generateWeeklySummary`, weekly_state, scheduler, config keys              |
| US7   | Start-of-week planning prompt           | ❌ Missing | `generateWeeklyKickoff`, weekly_state, scheduler, config keys              |
| US8   | On-demand "what should I work on next?" | ❌ Missing | `rankTasksByPriority` in service, `suggest_next_task` tool, tests          |

---

## Library Research

### Scheduler — `croner` (reused from Phase 8 and Phase 7)

Phase 8 selected and installed `croner@^9` as the in-process cron scheduler. Phase 7 reuses it for briefing and alert jobs. Phase 9 reuses it for weekly summary and kickoff jobs. No additional scheduler dependency is needed.

| Library     | Decision                     | Rationale                                                                                                        |
| ----------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **croner**  | ✅ Reuse (Phase 8 / Phase 7) | Zero dependencies, TypeScript-native, timezone-aware via `{ timezone }` option, Bun-compatible, MIT, 2025-active |
| `node-cron` | ❌ Skip                      | No built-in timezone support; croner is already installed                                                        |
| `cron`      | ❌ Skip                      | Requires `luxon`; heavier bundle; redundant                                                                      |

### Date Arithmetic

No additional date library is needed. Comparisons use the `Date` built-in and SQLite `date('now')`. All natural language date expressions in tools are resolved by the LLM before the tool is invoked.

### Text Similarity (for related-task suggestion in US1)

Rather than introducing a vector similarity library, the `EventSuggestionService` uses simple title-keyword matching to surface potentially related tasks: split both titles into lowercase tokens, compute intersection size / union size (Jaccard similarity), and flag matches above a threshold (≥0.25). This is sufficient for MVP; a more sophisticated approach can replace it later without changing the interface.

| Approach                     | Decision  | Rationale                                                                                        |
| ---------------------------- | --------- | ------------------------------------------------------------------------------------------------ |
| LLM-based comparison         | ❌ Skip   | Requires extra tool call or prompt overhead                                                      |
| Vector embedding library     | ❌ Skip   | Over-engineered for MVP; adds a heavyweight dependency                                           |
| **Jaccard token similarity** | ✅ Chosen | Self-contained, zero dependencies, trivially testable, good enough for title-level deduplication |

---

## Technical Architecture

### Component Map

```
User message: "create a task called 'Update docs'"
  └─ processMessage (llm-orchestrator.ts)
       └─ callLlm → generateText (AI SDK)
            └─ create_task.execute
                 └─ provider.createTask({ title: 'Update docs', ... })
                 └─ EventSuggestionService.suggestMissingDetails(userId, task, provider)
                      └─ task has no dueDate, no labels, no assignee
                      └─ returns MissingDetailsSuggestion { dueDate: true, labels: [...], relatedTasks: [...] }
                 └─ tool returns { ...task, suggestions: MissingDetailsSuggestion }
            └─ LLM sees suggestions field → presents them to user per system prompt instruction

User message: "move the API task to in-review"
  └─ update_task.execute
       └─ old = provider.getTask(taskId)   ← fetch before update
       └─ provider.updateTask(taskId, { status: 'in-review' })
       └─ EventSuggestionService.detectSignificantChange(fields, old, new)
            └─ no regression detected → returns null
       └─ tool returns updated task (no significant change field)

User message: "close the Login Refactor task"
  └─ update_task.execute
       └─ old = provider.getTask(taskId)
       └─ provider.updateTask(taskId, { status: 'done' })
       └─ EventSuggestionService.detectSignificantChange → null (completion is not a regression)
       └─ isDoneStatus('done') === true
            └─ EventSuggestionService.getCompletionSuggestions(userId, task, provider)
                 └─ finds 2 tasks blocked_by this task + 1 related open task
                 └─ returns CompletionSuggestion { dependentTasks: [...], relatedTasks: [...] }
       └─ tool returns { ...task, completionSuggestions: CompletionSuggestion }
       └─ LLM presents options: follow-up task, close dependents, team summary

Weekly scheduler tick (croner — last workday at week_end_time)
  └─ ProactiveAlertScheduler: weeklyJobCallback
       └─ BriefingService.generateWeeklySummary(userId, provider)
            └─ listTasks across all projects
            └─ filter: terminal status + updated this week → "Completed"
            └─ filter: non-terminal + due date in last 7 days → "Slipped"
            └─ filter: non-terminal + due date this week or before + still open → "Carry-over"
       └─ chatProvider.sendMessage(userId, weeklyMessage)
       └─ UPDATE weekly_state SET last_summary_date = today

User message: "what should I work on next?"
  └─ callLlm
       └─ suggest_next_task.execute
            └─ provider.listTasks / searchTasks across projects
            └─ EventSuggestionService.rankTasksByPriority(userId, tasks)
                 └─ score by: overdue days, due today, high/urgent priority, blocking others
            └─ returns top 3 with reasoning strings
```

### New Config Keys

Added to `src/types/config.ts` (`ConfigKey` union + `CONFIG_KEYS` array):

| Key               | Format                           | Description                                                                                                       |
| ----------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `weekly_review`   | `'enabled' \| 'disabled'`        | Gate for US6 and US7 weekly features; default `'disabled'`                                                        |
| `workdays`        | `'1,2,3,4,5'` (cron day indices) | Which days are workdays; first day = kickoff trigger, last day = summary trigger; default `'1,2,3,4,5'` (Mon–Fri) |
| `week_end_time`   | `'HH:MM'` (24h)                  | Local time for end-of-week summary delivery; default `'17:00'`                                                    |
| `week_start_time` | `'HH:MM'` (24h)                  | Local time for start-of-week kickoff delivery (distinct from daily `briefing_time`); default `'09:00'`            |

`workdays` uses cron day-of-week notation (0 = Sunday, 1 = Monday … 6 = Saturday). The first element drives the kickoff cron expression (`"MM HH * * {first}"`) and the last element drives the summary cron expression (`"MM HH * * {last}"`). This allows non-standard workweeks (e.g. `'0,1,2,3,4'` for Sun–Thu).

### Data Model

#### `weekly_state`

Tracks per-user delivery dates for weekly summary and kickoff to prevent duplicate sends.

| Column              | Type    | Description                                                                         |
| ------------------- | ------- | ----------------------------------------------------------------------------------- |
| `user_id`           | TEXT PK | Owner                                                                               |
| `last_summary_date` | TEXT    | `YYYY-MM-DD` of the last delivered weekly summary in the user's `briefing_timezone` |
| `last_kickoff_date` | TEXT    | `YYYY-MM-DD` of the last delivered weekly kickoff in the user's `briefing_timezone` |

`briefing_timezone` from Phase 7 is reused for timezone-aware date comparisons here; if not set, UTC is the fallback.

No new indexes are needed — this table is always accessed by its PK (`user_id`).

### EventSuggestionService Design

#### `suggestMissingDetails(userId, task, provider)` — US1

Analyzes the just-created task for actionable gaps. Checks are run in this order and independently:

| Check         | Condition                                                              | Suggestion                                                  |
| ------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------- |
| Due date      | `task.dueDate === null`                                                | Suggest setting one; optionally offer to set it immediately |
| Assignee      | `task.assignee === null`                                               | Suggest assigning to self or a team member by name          |
| Labels        | `task.labels.length === 0` AND project has labels                      | Suggest 1–3 relevant labels (fetched from `list_labels`)    |
| Related tasks | Jaccard title similarity ≥ 0.25 against open tasks in the same project | Surface up to 2 similar tasks; offer to link them           |

Returns `MissingDetailsSuggestion | null`. Returns `null` if all four conditions pass (task is already well-formed). The tool result includes `suggestions: MissingDetailsSuggestion | null` only when a service is provided; the field is absent otherwise, ensuring backward compatibility.

**Performance guard**: the four checks require at most one extra API call for labels and one for similar tasks (the latter reuses the task list already available from the create context). A configurable constant `MAX_SUGGESTION_DELAY_MS = 2000` aborts the lookup if all provider calls exceed this threshold combined; the tool returns without suggestions rather than adding unacceptable latency.

#### `detectSignificantChange(taskId, updatedFields, oldTask, newTask)` — US2

Compares the pre-update snapshot (`oldTask`) with the post-update result (`newTask`) on the fields that were actually changed (`updatedFields`). Only flags changes that crossed significance thresholds:

| Change               | Threshold / Rule                                                                 | Significance            |
| -------------------- | -------------------------------------------------------------------------------- | ----------------------- |
| Due date pushed back | New date > old date by ≥3 days                                                   | `'due_date_regression'` |
| Status regression    | New status slug is earlier in the status order\*                                 | `'status_regression'`   |
| Description reduced  | New description length < 0.7 × old length AND both non-empty                     | `'scope_reduction'`     |
| Priority lowered     | Enum rank: urgent=4, high=3, medium=2, low=1, no-priority=0; new rank < old rank | `'priority_reduction'`  |

\*Status order is inferred from the provider's status list via `listStatuses(projectId)`. The call is made lazily and cached per-project within the same request using a `Map<projectId, string[]>`. If `listStatuses` is unavailable or returns an error, status regression detection is skipped gracefully (no error propagates to the tool result).

Returns `SignificantChangeSuggestion | null`. The suggestion includes: the change type, a plain-text description of what changed, and a suggested follow-up action (e.g. "Would you like to notify the team?" / "Should I check for blockers?").

#### `getCompletionSuggestions(userId, task, provider)` — US3

Called when a task transitions to a done status. Fetches related work and offers three structured options:

1. **Create follow-up**: If the task description mentions TODOs or follow-up items, suggest creating a follow-up task pre-filled with those items.
2. **Close dependents**: Calls `get_task` or uses relations to find tasks with a `blocked_by` relation to the completed task; if any are found, offer to update their status.
3. **Send team summary**: Offer to produce a brief completion summary the user can copy to their team channel.

At least one option is available (option 3 always applies). Returns `CompletionSuggestion` containing arrays for each option. The LLM formats these as a numbered prompt to the user.

#### `rankTasksByPriority(userId, tasks)` — US8

Scores and sorts open tasks. Scoring formula (additive, no cap):

| Signal                                                               | Points           |
| -------------------------------------------------------------------- | ---------------- |
| Overdue by N days                                                    | `min(N × 3, 15)` |
| Due today                                                            | 10               |
| Priority = urgent                                                    | 8                |
| Priority = high                                                      | 5                |
| Has open `blocked_by` dependents (i.e. this task is blocking others) | 7                |

Returns top 3 `TaskRanking` objects, each with `{ task, score, reason: string }`. The `reason` is a comma-separated human-readable string, e.g. `"overdue by 2 days, high priority"`. The `suggest_next_task` tool passes these directly to the LLM as its output; the LLM formats them into a numbered recommendation list.

### Weekly Feature Design

#### `BriefingService.generateWeeklySummary(userId, provider)` — US6

Queries tasks across all projects and classifies them into three buckets using in-memory filtering:

| Bucket                      | Rule                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------ |
| **Completed this week**     | Status is terminal AND `updatedAt` is within the last 7 calendar days                |
| **Slipped past deadline**   | Status is non-terminal AND `dueDate` is between 7 days ago and yesterday (inclusive) |
| **Carry-over to next week** | Status is non-terminal AND `dueDate` is today or within the next 7 days              |

The "terminal" status check reuses `TERMINAL_STATUS_SLUGS` from Phase 7's `ProactiveAlertService`.

Output format:

```
**📊 Weekly Summary — Week of {Mon DD MMM}**

**✅ Completed This Week** (N)
- [Task A](url)
- [Task B](url)

**⚠️ Slipped Past Deadline** (N)
- [Task C](url) · was due {date}

**📋 Carry-over to Next Week** (N)
- [Task D](url) · due {date}
```

After generating, updates `weekly_state.last_summary_date = today`. If `last_summary_date === today` at the time of the scheduled job, the job is a no-op (prevents duplicate delivery on bot restart).

#### `BriefingService.generateWeeklyKickoff(userId, provider)` — US7

Fetches open tasks and surfaces two focused lists:

| Section           | Rule                                                                                                  |
| ----------------- | ----------------------------------------------------------------------------------------------------- |
| **Overdue**       | Status non-terminal AND `dueDate < today` (up to 5 tasks)                                             |
| **High Priority** | Status non-terminal AND priority is `'high'` or `'urgent'` AND not already in Overdue (up to 5 tasks) |

Output format:

```
**🎯 Week Kickoff — {Mon DD MMM}**

What are your **top 3 goals** for this week? 💭
Reply with your goals and I'll help you track progress.

**To consider:**

**⚠️ Overdue** (N)
- [Task A](url) · X days overdue

**🔺 High Priority** (N)
- [Task B](url)
```

After generating, updates `weekly_state.last_kickoff_date = today`. Same duplicate-delivery guard as `generateWeeklySummary`.

### Interactive Alert Enhancements — US4 and US5

Phase 7 sends passive, one-way alert messages. Phase 9 appends a short action prompt to each:

**`checkOverdue` message suffix** (appended to existing message):

```
Would you like me to reschedule it, reduce its scope, or check for blockers?
```

**`checkStaleness` message suffix**:

```
Would you like to revisit it, reprioritize it, or close it?
```

**`checkBlocked` message suffix** (already has context about the blocking task):

```
Should I push back the deadline or reassign the dependency?
```

These are the only modifications to `src/proactive/service.ts` in this phase. The change detection logic is unchanged.

### System Prompt Additions

The `BASE_SYSTEM_PROMPT` in `src/llm-orchestrator.ts` gains a new section:

```
TASK SUGGESTIONS:
- When create_task returns a result containing a "suggestions" field, always present those suggestions to the user as a friendly follow-up, e.g. "I notice this task has no due date — want me to set one?".
- When update_task returns a result containing a "significantChange" field, acknowledge the change and ask the user whether to take the suggested follow-up action.
- When update_task returns a result containing a "completionSuggestions" field, present the available options as a numbered list and invite the user to choose.
- For all suggestion payloads, keep the language concise and non-intrusive — one prompt per message, not multiple questions at once.
```

### Scheduler Architecture (Phase 9 additions)

```
Phase 7 ProactiveAlertScheduler.start(...)
  └─ [existing] global alertPollerJob
  └─ [existing] global reminderPollerJob
  └─ [existing] per-user briefingJobs

Phase 9 additions
  └─ ProactiveAlertScheduler.registerWeeklySummaryJob(userId, workdays, endTime, tz)
       └─ last_workday = workdays.split(',').at(-1)
       └─ Cron("{endMin} {endHour} * * {last_workday}", { timezone: tz }, summaryCallback)

  └─ ProactiveAlertScheduler.registerWeeklyKickoffJob(userId, workdays, startTime, tz)
       └─ first_workday = workdays.split(',').at(0)
       └─ Cron("{startMin} {startHour} * * {first_workday}", { timezone: tz }, kickoffCallback)

  └─ unregisterWeeklyJobs(userId)
       └─ stops and removes both summary and kickoff cron jobs for the user

  Both callbacks:
    └─ check weekly_state for duplicate-delivery guard
    └─ call BriefingService.generateWeeklySummary / generateWeeklyKickoff
    └─ chatProvider.sendMessage(userId, markdown)
    └─ catch + log errors; never propagate to croner runtime

Bot startup (src/index.ts) — extended
  └─ for each user with weekly_review = 'enabled':
       └─ scheduler.registerWeeklySummaryJob(...)
       └─ scheduler.registerWeeklyKickoffJob(...)

Bot shutdown handlers — extended
  └─ ProactiveAlertScheduler.stopAll() (already stops weeklyjobs via shared Map<id, Cron>)
```

### File Structure

```
src/
  suggestions/
    index.ts          ← public exports: EventSuggestionService, makeEventSuggestionTools
    types.ts          ← SuggestionType, MissingDetailsSuggestion, SignificantChangeSuggestion,
                        CompletionSuggestion, TaskRanking, ChangeType
    service.ts        ← EventSuggestionService
    tools.ts          ← makeSuggestionTools(service, provider): { suggest_next_task }
  db/
    migrations/
      011_event_suggestions.ts   ← creates weekly_state table
  proactive/           ← [Phase 7 module — modified files only listed here]
    service.ts         ← checkOverdue/checkStaleness/checkBlocked message suffix additions
    briefing.ts        ← generateWeeklySummary, generateWeeklyKickoff methods added
    scheduler.ts       ← registerWeeklySummaryJob, registerWeeklyKickoffJob, unregisterWeeklyJobs
    types.ts           ← WeeklyMode, WeeklySummaryData, WeeklyKickoffData added
  types/
    config.ts          ← 4 new config keys

tests/
  suggestions/
    service.test.ts    ← unit tests for EventSuggestionService
    tools.test.ts      ← unit tests for suggest_next_task tool
  proactive/
    briefing-weekly.test.ts  ← unit tests for generateWeeklySummary / generateWeeklyKickoff
```

**Modified files outside new module**:
`src/db/schema.ts`, `src/db/index.ts`, `src/types/config.ts`, `src/tools/create-task.ts`, `src/tools/update-task.ts`, `src/tools/index.ts`, `src/llm-orchestrator.ts`, `src/index.ts`

**Modified test files**: `tests/tools/task-tools.test.ts`

---

## Detailed Task Breakdown

### Phase 1 — DB Schema & Migration (0.25 days)

#### Task 1.1 — Create `src/db/migrations/011_event_suggestions.ts`

- **File**: `src/db/migrations/011_event_suggestions.ts` (new)
- **Change**: `CREATE TABLE IF NOT EXISTS weekly_state (user_id TEXT PRIMARY KEY, last_summary_date TEXT, last_kickoff_date TEXT)`. No indexes needed — all access is by primary key.
- **Estimate**: 0.25h ±0 | **Priority**: High
- **Acceptance Criteria**:
  - Migration runs cleanly on a DB with migrations 001–010 already applied
  - `weekly_state` table exists after `initDb()` with correct column types
- **Dependencies**: Phase 7 migration 010 registered in `src/db/index.ts`

#### Task 1.2 — Add Drizzle schema definition to `src/db/schema.ts`

- **File**: `src/db/schema.ts`
- **Change**: Add `weeklyState` table definition using `sqliteTable`. Export inferred type `WeeklyState`.
- **Estimate**: 0.25h ±0 | **Priority**: High
- **Acceptance Criteria**:
  - `typeof weeklyState.$inferSelect` has `userId`, `lastSummaryDate: string | null`, `lastKickoffDate: string | null`
  - `bun typecheck` passes with no new errors
- **Dependencies**: Task 1.1

#### Task 1.3 — Register migration 011 in `src/db/index.ts`

- **File**: `src/db/index.ts`
- **Change**: Import `migration011EventSuggestions` and append to `MIGRATIONS` array after `migration010ProactiveAlerts`.
- **Estimate**: 0.1h ±0 | **Priority**: Blocker
- **Acceptance Criteria**: `initDb()` applies all 11 migrations without error
- **Dependencies**: Tasks 1.1, Phase 7 Tasks 1.1–1.3

---

### Phase 2 — Config (0.1 days)

#### Task 2.1 — Extend `ConfigKey` in `src/types/config.ts`

- **File**: `src/types/config.ts`
- **Change**: Add `'weekly_review' | 'workdays' | 'week_end_time' | 'week_start_time'` to the `ConfigKey` union and to the `CONFIG_KEYS` readonly array.
- **Estimate**: 0.1h ±0 | **Priority**: High
- **Acceptance Criteria**:
  - `isConfigKey('weekly_review')` returns `true`; `isConfigKey('workdays')` returns `true`
  - `bun typecheck` passes
- **Dependencies**: None

---

### Phase 3 — Event Suggestion Service (2 days)

#### Task 3.1 — Create `src/suggestions/types.ts`

- **File**: `src/suggestions/types.ts` (new)
- **Change**: Define:
  - `ChangeType = 'due_date_regression' | 'status_regression' | 'scope_reduction' | 'priority_reduction'`
  - `MissingDetailsSuggestion = { missingDueDate: boolean; missingAssignee: boolean; suggestedLabels: string[]; relatedTasks: Array<{ id: string; title: string; url: string }> }`
  - `SignificantChangeSuggestion = { changeType: ChangeType; description: string; followUpPrompt: string }`
  - `CompletionSuggestion = { dependentTasks: Array<{ id: string; title: string; url: string }>; relatedOpenTasks: Array<{ id: string; title: string; url: string }>; hasFollowUpHints: boolean }`
  - `TaskRanking = { task: { id: string; title: string; url: string; dueDate: string | null; priority: string | null }; score: number; reason: string }`
  - `SuggestionType = 'missing_details' | 'significant_change' | 'completion_followup' | 'next_task_ranking'`
- **Estimate**: 0.25h ±0 | **Priority**: High
- **Dependencies**: None

#### Task 3.2 — Create `src/suggestions/service.ts`

- **File**: `src/suggestions/service.ts` (new)
- **Exports**: `EventSuggestionService` class.

  | Method                                                               | Description                                                                                                                                                     |
  | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `suggestMissingDetails(userId, task, provider)`                      | Check for missing dueDate, assignee, labels, and related tasks (Jaccard ≥ 0.25); return `MissingDetailsSuggestion \| null`; return `null` if nothing is missing |
  | `detectSignificantChange(updatedFields, oldTask, newTask, provider)` | Compare fields; apply thresholds from the architecture section; return `SignificantChangeSuggestion \| null`                                                    |
  | `getCompletionSuggestions(userId, task, provider)`                   | Fetch task relations; identify dependents blocked by the completed task; check description for follow-up hints; return `CompletionSuggestion`                   |
  | `rankTasksByPriority(userId, tasks)`                                 | Apply scoring formula; sort descending; return top-3 `TaskRanking[]`                                                                                            |

  **`suggestMissingDetails` label lookup**: calls `provider.listLabels(task.projectId)` (if available) to get project labels. If the call fails or is unavailable, the label suggestion is skipped. No error propagates to the tool result.

  **`detectSignificantChange` status order lookup**: calls `provider.listStatuses(task.projectId)` and builds a `Map<slug, index>` to compare positions. Cached per project per call via a `Map` local to the method invocation. If the call fails, status regression detection is skipped; the other three change types are still checked.

  **`getCompletionSuggestions` description hints**: scans the description for patterns: lines starting with `- [ ]`, `TODO:`, `FOLLOW-UP:`, or `ACTION:`. Sets `hasFollowUpHints = true` if any are found.

- **Estimate**: 4h ±1h | **Priority**: High
- **Acceptance Criteria**:
  - `suggestMissingDetails` on a fully-specified task (all fields set) returns `null`
  - `suggestMissingDetails` on a title-only task returns non-null with `missingDueDate: true`, `missingAssignee: true`
  - `suggestMissingDetails` label-fetch failure does not throw; `suggestedLabels` is `[]`
  - `detectSignificantChange` with dueDate moving 5 days forward returns `changeType = 'due_date_regression'`
  - `detectSignificantChange` with dueDate moving 2 days forward returns `null` (below 3-day threshold)
  - `detectSignificantChange` with priority lowered from `'high'` to `'low'` returns `changeType = 'priority_reduction'`
  - `detectSignificantChange` with status regression returns `changeType = 'status_regression'`
  - `detectSignificantChange` with status advancement (e.g. to-do → done) returns `null`
  - `detectSignificantChange` when status provider call fails, still returns priority/date changes
  - `getCompletionSuggestions` with 2 dependent tasks returns `dependentTasks.length === 2`
  - `getCompletionSuggestions` with description containing `TODO: write tests` sets `hasFollowUpHints = true`
  - `rankTasksByPriority` with 5 tasks returns at most 3
  - `rankTasksByPriority` ranks tasks overdue by 5 days above an urgent non-overdue task
- **Dependencies**: Tasks 1.2, 3.1

#### Task 3.3 — Create `src/suggestions/tools.ts`

- **File**: `src/suggestions/tools.ts` (new)
- **Exports**: `makeSuggestionTools(service, provider, userId): ToolSet` containing the `suggest_next_task` tool.

  **`suggest_next_task`**:
  - Input schema: none (uses `userId` and `provider` from closure)
  - Execute:
    1. Fetch tasks: call `provider.listTasks()` for each project the user has access to; merge results. Fall back to `provider.searchTasks({ query: '' })` if `listTasks` by project is unavailable.
    2. Filter out terminal-status tasks (`TERMINAL_STATUS_SLUGS` list from Phase 7).
    3. Call `service.rankTasksByPriority(userId, tasks)`.
    4. Return the top-3 array directly; the LLM formats it into a readable recommendation list.
  - Description (excerpt): "Return up to 3 recommended open tasks for the user to work on next, ranked by urgency and priority. Call this when the user asks what to work on, what to focus on, or what is most important right now."

- **Estimate**: 1.5h ±0.5h | **Priority**: High
- **Acceptance Criteria**:
  - Tool returns exactly 3 items when ≥3 open tasks exist
  - Tool returns fewer than 3 items when fewer open tasks exist
  - Tool returns an empty array (not an error) when all tasks are terminal
  - Tool description instructs the LLM to present results as a numbered recommendation with reasons
- **Dependencies**: Task 3.2

---

### Phase 4 — Tool Enhancements (1 day)

#### Task 4.1 — Extend `src/tools/create-task.ts` with suggestion hook

- **File**: `src/tools/create-task.ts`
- **Change**: `makeCreateTaskTool(provider, suggestionService?)`. The second argument is optional. After `provider.createTask(...)` succeeds, if `suggestionService` is provided, call `await suggestionService.suggestMissingDetails(userId, task, provider)`. If suggestions are non-null, include them in the returned object as `{ ...task, suggestions }`. If `suggestionService` is omitted or the call throws, return the plain task. The `userId` is passed as a third argument to `makeCreateTaskTool` when the service is present.

  The tool's input schema is unchanged. The `execute` function's return type becomes `{ ...TaskResult, suggestions?: MissingDetailsSuggestion }`.

  Timing guard: wrap the `suggestMissingDetails` call in `Promise.race([suggestionCall, sleep(MAX_SUGGESTION_DELAY_MS)])`. If the sleep wins, return the plain task result without suggestions.

- **Estimate**: 1.5h ±0.5h | **Priority**: High
- **Acceptance Criteria**:
  - When `suggestionService` is provided and the task has no due date, the returned object contains `suggestions.missingDueDate === true`
  - When `suggestionService` is omitted, the returned object does not contain `suggestions`
  - When `suggestMissingDetails` throws, the tool returns the plain task without propagating the error
  - When the suggestion call exceeds `MAX_SUGGESTION_DELAY_MS`, the tool returns the plain task
  - All existing `create_task` unit tests continue to pass without modification
- **Dependencies**: Task 3.2

#### Task 4.2 — Extend `src/tools/update-task.ts` with change detection and completion suggestions

- **File**: `src/tools/update-task.ts`
- **Change**: `makeUpdateTaskTool(provider, recurringService?, suggestionService?)`. Both optional services maintain backward compatibility.

  **Pre-update snapshot** (new step): if `suggestionService` is provided AND any of `{ dueDate, status, description, priority }` are in the input, fetch the current task via `provider.getTask(taskId)` BEFORE calling `provider.updateTask(...)`. Store snapshot as `oldTask`. If `getTask` fails, log the error and proceed without the snapshot (change detection silently skipped).

  **Post-update change detection**: if `oldTask` is available, call `suggestionService.detectSignificantChange(updatedFields, oldTask, newTask, provider)`. Append `significantChange` to the return value if non-null.

  **Post-update completion hook** (extends Phase 8's completion hook): if the new status is a done status, call `suggestionService.getCompletionSuggestions(userId, newTask, provider)`. Append `completionSuggestions` to the return value.

  Both Phase 8's `recurringService` completion hook and Phase 9's `completionSuggestions` run on the same done-status transition; they are independent steps (Phase 8 creates a new task; Phase 9 returns suggestions). The `isDoneStatus` helper is shared.

  Signature for tool factory: `makeUpdateTaskTool(provider, recurringService?, suggestionService?, userId?)`. The `userId` parameter is needed for `getCompletionSuggestions`; it is passed by the tools registration layer.

- **Estimate**: 2h ±0.5h | **Priority**: High
- **Acceptance Criteria**:
  - When `suggestionService` is provided and due date is pushed back by 5 days, the result includes `significantChange.changeType === 'due_date_regression'`
  - When `suggestionService` is provided and the transition is to a done status, the result includes a `completionSuggestions` field
  - When `suggestionService` is omitted, behavior is identical to the pre-Phase-9 implementation
  - When `provider.getTask(taskId)` fails, the update still succeeds and change detection is silently skipped
  - Phase 8 recurring completion hook still fires regardless of whether `suggestionService` is provided
- **Dependencies**: Task 3.2, Phase 8 Task 5.1

---

### Phase 5 — Interactive Alert Enhancement (0.25 days)

#### Task 5.1 — Enhance `checkOverdue` in `src/proactive/service.ts`

- **File**: `src/proactive/service.ts`
- **Change**: Append `" Would you like me to reschedule it, reduce its scope, or check for any blockers?"` to the overdue alert message string at all three escalation tiers. No logic changes.
- **Estimate**: 0.25h ±0 | **Priority**: Medium
- **Acceptance Criteria**: Overdue alert messages contain the action-prompt suffix at all escalation tiers (verified in Phase 7's service tests, which are updated to match the new expected strings)
- **Dependencies**: Phase 7 Task 3.2

#### Task 5.2 — Enhance `checkStaleness` in `src/proactive/service.ts`

- **File**: `src/proactive/service.ts`
- **Change**: Append `" Would you like to revisit it, reprioritize it, or close it?"` to the staleness alert message string.
- **Estimate**: 0.1h ±0 | **Priority**: Medium
- **Acceptance Criteria**: Staleness alert message contains the suffix
- **Dependencies**: Phase 7 Task 3.2

#### Task 5.3 — Enhance `checkBlocked` in `src/proactive/service.ts`

- **File**: `src/proactive/service.ts`
- **Change**: Append `" Should I push back the deadline or reassign the dependency?"` to the blocked alert message string.
- **Estimate**: 0.1h ±0 | **Priority**: Medium
- **Acceptance Criteria**: Blocked alert message contains the suffix
- **Dependencies**: Phase 7 Task 3.2

---

### Phase 6 — Weekly Features (1 day)

#### Task 6.1 — Extend `src/proactive/types.ts`

- **File**: `src/proactive/types.ts`
- **Change**: Add `WeeklyMode = 'summary' | 'kickoff'`. No additional type definitions are required — the existing `BriefingSection` and `BriefingTask` types from Phase 7 are reused for weekly output.
- **Estimate**: 0.1h ±0 | **Priority**: Low
- **Dependencies**: Phase 7 Task 2.1

#### Task 6.2 — Add weekly methods to `src/proactive/briefing.ts`

- **File**: `src/proactive/briefing.ts`
- **Change**: Add two new methods to `BriefingService`:

  **`generateWeeklySummary(userId, provider)`**:
  - Fetch all tasks from provider (same strategy as `generate`: iterate projects, fall back to `searchTasks`)
  - Classify into three buckets (Completed, Slipped, Carry-over) per the architecture section
  - Format into the `📊 Weekly Summary` Markdown structure
  - Upsert `weekly_state (user_id, last_summary_date = today)` using Drizzle's `onConflictDoUpdate`
  - Return the formatted string

  **`generateWeeklyKickoff(userId, provider)`**:
  - Fetch all tasks; classify Overdue (non-terminal, dueDate < today) and High Priority (non-terminal, priority in `['high','urgent']`, not already overdue)
  - Cap each section at 5 tasks
  - Format into the `🎯 Week Kickoff` Markdown structure
  - Upsert `weekly_state (user_id, last_kickoff_date = today)`
  - Return the formatted string

  Both methods check the `weekly_state` row first: if `last_summary_date === today` (for summary) or `last_kickoff_date === today` (for kickoff), return `null` immediately to prevent duplicate delivery. The scheduler callbacks check for `null` and skip `sendMessage` accordingly.

- **Estimate**: 3h ±1h | **Priority**: High
- **Acceptance Criteria**:
  - `generateWeeklySummary` with 2 completed + 1 slipped task formats correctly with all sections present
  - `generateWeeklySummary` called twice on the same day returns `null` on the second call
  - `generateWeeklyKickoff` with no overdue tasks omits the Overdue section
  - `generateWeeklyKickoff` with 8 high-priority tasks caps the High Priority section at 5
  - Both methods write the correct date to `weekly_state`
- **Dependencies**: Tasks 1.2, 1.3, Phase 7 Task 3.3

#### Task 6.3 — Extend `src/proactive/scheduler.ts` with weekly jobs

- **File**: `src/proactive/scheduler.ts`
- **Change**: Add to `ProactiveAlertScheduler`:

  | Method                                                                                       | Description                                                                                                                                                               |
  | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `registerWeeklySummaryJob(userId, workdays, endTime, tz, briefingService, chat, provider)`   | Compute `last_workday = workdays.split(',').at(-1)`, build cron `"{endMin} {endHour} * * {last_workday}"`, register in shared `Map` under key `"weekly_summary:{userId}"` |
  | `registerWeeklyKickoffJob(userId, workdays, startTime, tz, briefingService, chat, provider)` | Same pattern with `first_workday = workdays.split(',').at(0)` and key `"weekly_kickoff:{userId}"`                                                                         |
  | `unregisterWeeklyJobs(userId)`                                                               | Stop and remove both `"weekly_summary:{userId}"` and `"weekly_kickoff:{userId}"` entries from the Map                                                                     |

  **Helper**: `parseHHMM(time: string): { hour: number; minute: number }` — splits `'17:00'` into `{ hour: 17, minute: 0 }`. Throws if format is invalid (caught in the registration wrapper, logged, job not registered).

  `start()` (existing method in Phase 7) is extended: after registering briefing jobs, also iterate users with `weekly_review = 'enabled'` and call `registerWeeklySummaryJob` / `registerWeeklyKickoffJob` for each with their configured values (falling back to defaults `'1,2,3,4,5'`, `'17:00'`, `'09:00'`).

  `stopAll()` already stops all jobs in the Map (unchanged — the new keys are automatically included).

- **Estimate**: 2h ±0.5h | **Priority**: High
- **Acceptance Criteria**:
  - `registerWeeklySummaryJob` for a user with `workdays='1,2,3,4,5'` and `week_end_time='17:00'` creates a cron job with expression `"0 17 * * 5"`
  - `registerWeeklyKickoffJob` for the same user creates a cron job with expression `"0 9 * * 1"` (default `week_start_time='09:00'`)
  - `registerWeeklyKickoffJob` for a user with `workdays='0,1,2,3,4'` (Sun–Thu) creates expression `"0 9 * * 0"`
  - `unregisterWeeklyJobs` stops both jobs without affecting other registered jobs
  - Callback: if `generateWeeklySummary` returns `null` (already sent today), `sendMessage` is not called
  - Callback errors are caught, logged, and do not propagate
- **Dependencies**: Tasks 1.2, 2.1, 6.2, Phase 7 Task 4.2

---

### Phase 7 — Tests (1.5 days)

#### Task 7.1 — Create `tests/suggestions/service.test.ts`

- **File**: `tests/suggestions/service.test.ts` (new)
- **Setup**: In-memory DB with migrations 001–011. Mock `TaskProvider` (configurable `listLabels`, `listStatuses`, `getTask`, `listTasks`, `searchTasks` responses). No croner dependency.
- **Test cases**:

  **`suggestMissingDetails`**
  1. `returns null when all fields are present (dueDate, assignee, labels all set)`
  2. `sets missingDueDate=true when dueDate is null`
  3. `sets missingAssignee=true when assignee is null`
  4. `populates suggestedLabels from provider.listLabels when task has no labels`
  5. `suggestedLabels is empty when listLabels throws`
  6. `surfaces relatedTasks when Jaccard similarity >= 0.25`
  7. `excludes self from relatedTasks comparison`
  8. `returns null when task has a title-only similar match but all other fields are set`
  9. `returns suggestions within MAX_SUGGESTION_DELAY_MS (mock race)`

  **`detectSignificantChange`** 10. `returns due_date_regression when new date is 5 days later` 11. `returns null when new date is 2 days later (below threshold)` 12. `returns priority_reduction when priority drops from high to low` 13. `returns null when priority increases` 14. `returns scope_reduction when new description is 60% shorter` 15. `returns null when description shrinks by only 20%` 16. `returns status_regression when new status is earlier in status order` 17. `returns null when new status advances in status order` 18. `returns priority_reduction (not null) when listStatuses throws (other checks still run)`

  **`getCompletionSuggestions`** 19. `returns dependentTasks for tasks with blocked_by relation to this task` 20. `sets hasFollowUpHints=true when description contains TODO:` 21. `sets hasFollowUpHints=true when description contains - [ ]` 22. `sets hasFollowUpHints=false when description is empty`

  **`rankTasksByPriority`** 23. `returns at most 3 tasks` 24. `ranks overdue-by-5-days above urgent non-overdue` 25. `ranks due-today above high-priority not-due-today` 26. `reason string lists contributing factors` 27. `excludes terminal-status tasks from ranking input`

- **Estimate**: 2.5h ±0.5h | **Priority**: High
- **Dependencies**: Task 3.2

#### Task 7.2 — Create `tests/suggestions/tools.test.ts`

- **File**: `tests/suggestions/tools.test.ts` (new)
- **Setup**: Mock `EventSuggestionService`, mock `TaskProvider`. Test only `suggest_next_task` tool execute path.
- **Test cases**:
  1. `returns top 3 ranked tasks when provider returns 5 open tasks`
  2. `returns fewer than 3 tasks when only 2 open tasks exist`
  3. `returns empty array when all tasks are terminal (no error thrown)`
  4. `calls provider.searchTasks as fallback when listTasks is unavailable`
- **Estimate**: 0.5h ±0.25h | **Priority**: High
- **Dependencies**: Task 3.3

#### Task 7.3 — Create `tests/proactive/briefing-weekly.test.ts`

- **File**: `tests/proactive/briefing-weekly.test.ts` (new)
- **Setup**: In-memory DB with migrations 001–011. Mock `TaskProvider` with configurable task fixture sets.
- **Test cases**:

  **`generateWeeklySummary`**
  1. `formats Completed section when tasks with terminal status updated this week`
  2. `formats Slipped section when non-terminal task has due date in last 7 days`
  3. `formats Carry-over section for open tasks due within next 7 days`
  4. `returns null when last_summary_date is today`
  5. `updates last_summary_date after generation`
  6. `omits empty sections from output`

  **`generateWeeklyKickoff`** 7. `includes Overdue section with correct task count` 8. `caps Overdue section at 5 tasks` 9. `includes High Priority section excluding tasks already in Overdue` 10. `returns null when last_kickoff_date is today` 11. `updates last_kickoff_date after generation` 12. `omits High Priority section when empty`

- **Estimate**: 2h ±0.5h | **Priority**: High
- **Dependencies**: Task 6.2

#### Task 7.4 — Extend `tests/tools/task-tools.test.ts`

- **File**: `tests/tools/task-tools.test.ts` (existing)
- **Change**: Add test cases for the updated tool factories:

  **`makeCreateTaskTool` with suggestion service**
  1. `includes suggestions field when service returns non-null MissingDetailsSuggestion`
  2. `does not include suggestions field when service returns null`
  3. `does not include suggestions field when suggestionService is not provided`
  4. `returns plain task when suggestMissingDetails throws`

  **`makeUpdateTaskTool` with suggestion service** 5. `fetches old task before update when suggestionService and relevant fields provided` 6. `includes significantChange when detectSignificantChange returns non-null` 7. `does not include significantChange when detectSignificantChange returns null` 8. `includes completionSuggestions when status transitions to done` 9. `skips old-task fetch when no relevant change fields are in the input` 10. `does not break Phase 8 recurring hook when completion triggers both hooks`

- **Estimate**: 1.5h ±0.5h | **Priority**: High
- **Dependencies**: Tasks 4.1, 4.2

#### Task 7.5 — Update Phase 7 alert message assertions in `tests/proactive/service.test.ts`

- **File**: `tests/proactive/service.test.ts` (existing, from Phase 7)
- **Change**: Update expected message strings in `checkOverdue`, `checkStaleness`, and `checkBlocked` test cases to include the new interactive action suffixes.
- **Estimate**: 0.25h ±0 | **Priority**: Medium
- **Acceptance Criteria**: All Phase 7 alert service tests pass with the updated expected strings
- **Dependencies**: Tasks 5.1, 5.2, 5.3

---

### Phase 8 — Wiring (0.5 days)

#### Task 8.1 — Register `suggest_next_task` in `src/tools/index.ts`

- **File**: `src/tools/index.ts`
- **Change**: Extend `makeTools(provider, options?)` to accept `options.suggestionService`. Pass `suggestionService`, `provider`, and `userId` to `makeSuggestionTools(...)` and merge the returned `{ suggest_next_task }` into the `ToolSet`. When `suggestionService` is absent, `suggest_next_task` is not registered (the LLM won't see it).
- **Estimate**: 0.25h ±0 | **Priority**: High
- **Acceptance Criteria**: `Object.keys(makeTools(provider, { suggestionService }))` includes `'suggest_next_task'`; calling `makeTools(provider)` without options does not include it
- **Dependencies**: Task 3.3

#### Task 8.2 — Thread `EventSuggestionService` through `src/tools/index.ts` into `create_task` and `update_task`

- **File**: `src/tools/index.ts`
- **Change**: Pass `suggestionService` and `userId` to `makeCreateTaskTool(provider, suggestionService, userId)` and `makeUpdateTaskTool(provider, recurringService, suggestionService, userId)`. Both services are optional; when absent, tools behave as in Phase 8.
- **Estimate**: 0.25h ±0 | **Priority**: High
- **Acceptance Criteria**: Tool registration correctly injects `suggestionService`; existing tools continue to function when service is absent
- **Dependencies**: Tasks 4.1, 4.2, 8.1

#### Task 8.3 — Update `BASE_SYSTEM_PROMPT` in `src/llm-orchestrator.ts`

- **File**: `src/llm-orchestrator.ts`
- **Change**: Append the `TASK SUGGESTIONS` section from the architecture document above to `BASE_SYSTEM_PROMPT`. No logic changes; this is a string constant update only.
- **Estimate**: 0.25h ±0 | **Priority**: High
- **Acceptance Criteria**: `BASE_SYSTEM_PROMPT` contains the words `suggestions` and `significantChange` and `completionSuggestions`
- **Dependencies**: None

#### Task 8.4 — Instantiate `EventSuggestionService` and wire weekly scheduler in `src/index.ts`

- **File**: `src/index.ts`
- **Change**:
  1. Import and instantiate `EventSuggestionService` after `initDb()`
  2. Pass `suggestionService` into `makeTools` / `setupBot` options
  3. After `ProactiveAlertScheduler.start(...)` (Phase 7), iterate all users and register weekly jobs for those with `weekly_review = 'enabled'`: call `scheduler.registerWeeklySummaryJob(...)` and `scheduler.registerWeeklyKickoffJob(...)` with their configured `workdays`, `week_end_time`, `week_start_time`, and `briefing_timezone`
  4. `ProactiveAlertScheduler.stopAll()` already covers weekly jobs (no additional handler code needed)
- **Estimate**: 0.5h ±0.25h | **Priority**: High
- **Acceptance Criteria**: Bot startup log includes `"Event suggestion service initialized"` and `"Weekly jobs registered: N summary + N kickoff"` (where N is the count of eligible users)
- **Dependencies**: Tasks 3.2, 6.3, 8.2

---

## Risk Assessment Matrix

| Risk                                                                                                                           | Probability | Impact | Mitigation                                                                                                                                                                                              | Owner |
| ------------------------------------------------------------------------------------------------------------------------------ | ----------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| Suggestion lookup (`listLabels`, `listStatuses`) adds latency to every `create_task` / `update_task` call                      | Medium      | Medium | `MAX_SUGGESTION_DELAY_MS = 2000` race guard; `suggestMissingDetails` returns `null` gracefully if the race is lost; user always gets the task result on time                                            | Dev   |
| `getTask` pre-update snapshot doubles API calls for every `update_task`                                                        | Medium      | Low    | Pre-fetch only when `suggestionService` is provided AND at least one of `{ dueDate, status, description, priority }` is in the input; the common case of changing only `title` skips the fetch entirely | Dev   |
| Status regression detection via `listStatuses` is provider-specific; slug order may not reliably indicate stage order          | Medium      | Medium | Fetch status list, sort by column `order` from provider (if available); fall back to alphabetical; skip regression check if sort is ambiguous; document as best-effort in the tool description          | Dev   |
| Weekly summary classifies tasks as "completed" based on `updatedAt`; tasks updated for other reasons may appear in that bucket | Medium      | Low    | Add secondary filter: status must be terminal AND `updatedAt` in last 7 days; accept some false positives at MVP; note as a known limitation in the plan                                                | Dev   |
| `rankTasksByPriority` "blocking others" signal requires fetching all task relations; potentially expensive                     | Low         | Low    | Omit the `blocks_others` signal from MVP scoring; deliver US8 with overdue+priority signals only; note as a follow-up improvement                                                                       | Dev   |
| Weekly jobs fire for a user who just disabled `weekly_review` (race between config change and job fire)                        | Low         | Low    | Job callback re-reads config at fire time: if `weekly_review !== 'enabled'`, skip the send and unregister the job                                                                                       | Dev   |
| `generateWeeklySummary` / `generateWeeklyKickoff` called simultaneously (e.g. on a bot restart on a Monday morning)            | Low         | Low    | `last_summary_date` / `last_kickoff_date` guard prevents duplicate delivery; second call returns `null`                                                                                                 | Dev   |
| Phase 7 test strings break when interactive suffixes are added to alert messages                                               | High        | Low    | Dedicated Task 7.5 updates expected strings immediately as part of this phase; easy fix, high probability                                                                                               | Dev   |

---

## Resource Requirements

- **Development Hours**: 24h ±4h total (5–6 working days)
- **New Production Dependencies**: None (all functionality reuses the existing stack: `croner`, `drizzle-orm`, `zod`, `ai`)
- **New Dev Dependencies**: None
- **Database Changes**: 1 new table (`weekly_state`), 0 new indexes, 1 migration file
- **New Source Files**: 4 (`src/suggestions/index.ts`, `types.ts`, `service.ts`, `tools.ts`, `src/db/migrations/011_event_suggestions.ts`)
- **Modified Source Files**: `src/db/schema.ts`, `src/db/index.ts`, `src/types/config.ts`, `src/tools/create-task.ts`, `src/tools/update-task.ts`, `src/tools/index.ts`, `src/proactive/service.ts`, `src/proactive/briefing.ts`, `src/proactive/scheduler.ts`, `src/proactive/types.ts`, `src/llm-orchestrator.ts`, `src/index.ts`
- **New Test Files**: 3 (`tests/suggestions/service.test.ts`, `tools.test.ts`, `tests/proactive/briefing-weekly.test.ts`)
- **Modified Test Files**: `tests/tools/task-tools.test.ts`, `tests/proactive/service.test.ts`
- **Skills Required**: Drizzle ORM, cron expression format, IANA timezone handling, `bun:test` mock patterns, provider API call patterns

---

## Planning Quality Gates

**✅ Requirements Coverage**

- [x] US1 (creation suggestions) → Tasks 3.2 (`suggestMissingDetails`), 4.1, 8.3, 7.1, 7.4
- [x] US2 (update follow-up) → Tasks 3.2 (`detectSignificantChange`), 4.2, 7.1, 7.4
- [x] US3 (completion next steps) → Tasks 3.2 (`getCompletionSuggestions`), 4.2, 7.4
- [x] US4 (interactive overdue prompt) → Task 5.1
- [x] US5 (interactive stale nudge) → Task 5.2
- [x] US6 (end-of-week summary) → Tasks 1.1–1.3, 2.1, 6.2, 6.3, 8.4, 7.3
- [x] US7 (start-of-week planning prompt) → Tasks 1.1–1.3, 2.1, 6.2, 6.3, 8.4, 7.3
- [x] US8 (on-demand "what next") → Tasks 3.2 (`rankTasksByPriority`), 3.3, 8.1, 7.2

**✅ Library Research Validation**

- [x] `croner` v9 reused — zero additional dependencies, MIT, Bun-compatible
- [x] No similarity library — Jaccard token matching is self-contained and trivially testable
- [x] No date arithmetic library — `Date` built-in and SQLite `date('now')` suffice
- [x] No NL date-parsing library — LLM resolves all time expressions before tool invocation

**✅ Risk Management**

- [x] Suggestion latency is bounded by `MAX_SUGGESTION_DELAY_MS` race guard
- [x] Pre-update snapshot fetch is conditional on field presence, not always-on
- [x] Status regression detection degrades gracefully when provider is unavailable
- [x] Weekly duplicate-delivery guard preserves idempotency across bot restarts
- [x] `blocks_others` scoring signal deferred to avoid expensive relation fetching at MVP

**✅ Backward Compatibility**

- [x] All tool factory changes use optional parameters (`suggestionService?`) — callers without the service are unchanged
- [x] Phase 8 recurring completion hook is independent from Phase 9 completion suggestions — both fire on the same event without interference
- [x] `makeTools(provider)` without options continues to work exactly as before

**✅ Tracking Framework**

- [x] 8 phases with clear file-level deliverables
- [x] Every task has measurable acceptance criteria
- [x] Test counts: 27 suggestion-service tests + 4 suggestion-tool tests + 12 briefing-weekly tests + 10 task-tool tests + 3 service-message updates = 56 new or updated tests minimum

**✅ Phase Alignment**

- [x] Same `croner` library, same `Map<id, Cron>` scheduler singleton pattern as Phases 7–8
- [x] Same `makeXxxTool(provider, ...optional)` factory convention
- [x] Same Drizzle ORM query patterns and migration numbering (`011` after Phase 7's `010`)
- [x] Same `bun:test` in-memory DB test setup used throughout
- [x] Weekly jobs use the same `registerBriefingJob`-style method convention as Phase 7
- [x] `stopAll()` extension is a no-op (shared Map already covers new job keys)

---

## 📋 DISPLAY INSTRUCTIONS FOR OUTER AGENT

**Outer Agent: You MUST present this development plan using the following format:**

1. **Present the COMPLETE development roadmap** - Do not summarize or abbreviate sections
2. **Preserve ALL task breakdown structures** with checkboxes and formatting intact
3. **Show the full risk assessment matrix** with all columns and rows
4. **Display ALL planning templates exactly as generated** - Do not merge sections
5. **Maintain all markdown formatting** including tables, checklists, and code blocks
6. **Present the complete technical specification** without condensing
7. **Show ALL quality gates and validation checklists** in full detail
8. **Display the complete library research section** with all recommendations and evaluations

**Do NOT create an executive summary or overview - present the complete development plan exactly as generated with all detail intact.**
