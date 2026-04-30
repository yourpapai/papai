# Recurring-Task Tool RRULE Schema Migration

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the semantic schedule object (`{ frequency, time, days_of_week, day_of_month }`) in `create_recurring_task` and `update_recurring_task` tools with the same `rruleInputSchema` already used by deferred-prompt tools, so both tool families share a single RRULE-based recurrence API.

**Architecture:** The storage layer (DB columns `rrule`/`dtstartUtc`) is already unified. Only the LLM-facing input schema and the translation layer change. `recurrenceSpecToRrule` (already used by deferred-prompt tools) becomes the single compilation path. `semanticScheduleToCompiled` is removed as dead code. `dtstart` is injected synthetically at call time (`new Date().toISOString()`) — not exposed to the LLM — matching the deferred-prompt pattern exactly.

**Tech Stack:** Bun, TypeScript strict, Zod v4, Vercel AI SDK `tool()`, `rruleInputSchema` from `src/deferred-prompts/types.ts`, `recurrenceSpecToRrule` from `src/recurrence.ts`.

---

## File Map

| File                                        | Change                                                                                                                                       |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/tools/create-recurring-task.ts`        | Replace `schedule` schema (semantic → RRULE), remove `timezone` top-level field, swap `semanticScheduleToCompiled` → `recurrenceSpecToRrule` |
| `src/tools/update-recurring-task.ts`        | Same schema replacement, remove top-level `timezone` field (it moves inside schedule), swap translator                                       |
| `src/utils/datetime.ts`                     | Delete `SemanticSchedule` type, `semanticScheduleToCompiled`, and all private helpers only used by it                                        |
| `src/system-prompt.ts`                      | Rewrite `RECURRING TASKS` section (lines 49–62) to RRULE vocabulary                                                                          |
| `tests/tools/recurring-tools.test.ts`       | Rewrite 4 test inputs from semantic schedule shape to RRULE shape                                                                            |
| `tests/tools/update-recurring-task.test.ts` | Rewrite 2 test inputs from semantic schedule shape to RRULE shape, remove `timezone` top-level input                                         |

**Do not touch:**

- `src/recurrence/recurrence.ts` — correct as-is
- `src/recurrence.ts` — re-export barrel, no changes
- `src/types/recurrence.ts` — `recurrenceSpecSchema` stays (used by spec tests)
- `src/deferred-prompts/` — no changes
- DB layer / migrations — already on `rrule`/`dtstartUtc`

---

## Hook Ordering Note

The TDD hooks enforce Red → Green. For schema migrations the cycle is:

1. Update `src/` file (test-first gate accepts existing test coverage; write proceeds; existing tests become Red)
2. Update test file immediately after (tests become Green; hook verifies pass)

Do **not** attempt to update test files before src — the test-file-edit hook verifies the changed test passes and will block edits that introduce newly failing assertions.

---

## Task 1 — Migrate `create-recurring-task.ts`

**Files:**

- Modify: `src/tools/create-recurring-task.ts`
- Modify: `tests/tools/recurring-tools.test.ts` (create-tool section only)

### Step 1.1 — Update the source

Replace the full content of `src/tools/create-recurring-task.ts`:

```typescript
import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { getConfig } from '../config.js'
import { logger } from '../logger.js'
import { describeCompiledRecurrence, recurrenceSpecToRrule } from '../recurrence.js'
import { createRecurringTask as defaultCreateRecurringTask } from '../recurring.js'
import { rruleInputSchema } from '../deferred-prompts/types.js'
import type { RecurringTaskInput, RecurringTaskRecord, TriggerType } from '../types/recurring.js'
import { utcToLocal } from '../utils/datetime.js'

export interface CreateRecurringTaskDeps {
  createRecurringTask: (input: RecurringTaskInput) => RecurringTaskRecord
}

const defaultDeps: CreateRecurringTaskDeps = {
  createRecurringTask: defaultCreateRecurringTask,
}

const log = logger.child({ scope: 'tool:create-recurring-task' })

const inputSchema = z.object({
  title: z.string().describe('Title for each generated task'),
  projectId: z.string().describe('Project ID — call list_projects first to obtain this'),
  description: z.string().optional().describe('Description for each generated task'),
  priority: z.enum(['no-priority', 'low', 'medium', 'high', 'urgent']).optional().describe('Priority level'),
  status: z.string().optional().describe("Initial status for each generated task (e.g. 'to-do')"),
  assignee: z.string().optional().describe('Assignee for each generated task'),
  labels: z.array(z.string()).optional().describe('Label IDs to apply to each generated task'),
  triggerType: z
    .enum(['cron', 'on_complete'])
    .describe("'cron' for fixed schedule, 'on_complete' for after-completion"),
  schedule: rruleInputSchema
    .optional()
    .describe("Schedule for 'cron' triggerType. Call get_current_time first to obtain the user's IANA timezone."),
  catchUp: z.boolean().optional().describe('Create missed occurrences on resume. Default: false'),
})

type Input = z.infer<typeof inputSchema>

function executeCreate(userId: string, input: Input, deps: CreateRecurringTaskDeps): unknown {
  log.debug({ userId, title: input.title, triggerType: input.triggerType }, 'Creating recurring task')

  if (input.triggerType === 'cron' && input.schedule === undefined) {
    return { error: "schedule is required when triggerType is 'cron'" }
  }

  const compiled =
    input.triggerType === 'cron' && input.schedule !== undefined
      ? recurrenceSpecToRrule({ ...input.schedule, dtstart: new Date().toISOString() })
      : undefined

  const record = deps.createRecurringTask({
    userId,
    title: input.title,
    projectId: input.projectId,
    description: input.description,
    priority: input.priority,
    status: input.status,
    assignee: input.assignee,
    labels: input.labels,
    triggerType: input.triggerType satisfies TriggerType,
    rrule: compiled?.rrule,
    dtstartUtc: compiled?.dtstartUtc,
    catchUp: input.catchUp,
    timezone: compiled?.timezone ?? getConfig(userId, 'timezone') ?? 'UTC',
  })

  const schedule =
    record.triggerType === 'cron' && record.rrule !== null && record.dtstartUtc !== null
      ? describeCompiledRecurrence({ rrule: record.rrule, dtstartUtc: record.dtstartUtc, timezone: record.timezone })
      : 'after completion of current instance'

  log.info({ id: record.id, title: input.title, schedule }, 'Recurring task created via tool')

  return {
    id: record.id,
    title: record.title,
    projectId: record.projectId,
    triggerType: record.triggerType,
    schedule,
    nextRun: utcToLocal(record.nextRun, record.timezone),
    enabled: record.enabled,
  }
}

export function makeCreateRecurringTaskTool(
  userId: string,
  deps: CreateRecurringTaskDeps = defaultDeps,
): ToolSet[string] {
  return tool({
    description:
      'Set up a recurring task that is automatically created on a schedule (cron) or after completion. Call list_projects first.',
    inputSchema,
    execute: (input) => {
      try {
        return executeCreate(userId, input, deps)
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : String(error), tool: 'create_recurring_task' },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
```

- [ ] Apply this change to `src/tools/create-recurring-task.ts`.

### Step 1.2 — Run existing tests (expect failures)

```bash
cd /Users/ki/Projects/experiments/papai/.worktrees/implement-rrule-adoption-fRrRE
bun test tests/tools/recurring-tools.test.ts 2>&1 | grep -E '(FAIL|PASS|error)' | head -20
```

Expected: 3–4 test failures in `makeCreateRecurringTaskTool` describe block (semantic schedule shape no longer accepted by schema).

### Step 1.3 — Update create-tool tests in `tests/tools/recurring-tools.test.ts`

Find and replace the four tests that pass a semantic `schedule` object in the `makeCreateRecurringTaskTool` describe block. The changes are **input shape only** — output assertions are unchanged.

**Test: "converts semantic schedule to cron expression"** — replace the `execute` call input:

```typescript
// OLD:
{
  title: 'Monday standup',
  projectId: 'p1',
  triggerType: 'cron',
  schedule: { frequency: 'weekly', time: '09:00', days_of_week: ['mon'] },
}

// NEW:
{
  title: 'Monday standup',
  projectId: 'p1',
  triggerType: 'cron',
  schedule: { freq: 'WEEKLY', byDay: ['MO'], byHour: [9], byMinute: [0], timezone: 'UTC' },
}
```

The output assertion `expect(result).toHaveProperty('schedule', 'at 09:00 UTC on Monday')` stays unchanged.

**Test: "on_complete triggerType ignores schedule when both provided"** — replace the `execute` call input:

```typescript
// OLD:
{
  title: 'Test',
  projectId: 'p-1',
  triggerType: 'on_complete',
  schedule: { frequency: 'weekly', time: '09:00', days_of_week: ['mon'] },
}

// NEW:
{
  title: 'Test',
  projectId: 'p-1',
  triggerType: 'on_complete',
  schedule: { freq: 'WEEKLY', byDay: ['MO'], byHour: [9], byMinute: [0], timezone: 'UTC' },
}
```

**Test: "re-throws when createRecurringTask throws"** — replace the `execute` call input:

```typescript
// OLD:
{
  title: 'Task',
  projectId: 'p1',
  triggerType: 'cron',
  schedule: { frequency: 'weekly', time: '09:00', days_of_week: ['mon'] },
}

// NEW:
{
  title: 'Task',
  projectId: 'p1',
  triggerType: 'cron',
  schedule: { freq: 'WEEKLY', byDay: ['MO'], byHour: [9], byMinute: [0], timezone: 'UTC' },
}
```

**Test: "returns nextRun converted to user local time"** — replace the `execute` call input:

```typescript
// OLD:
{
  title: 'Daily',
  projectId: 'p1',
  triggerType: 'cron',
  schedule: { frequency: 'daily', time: '17:00' },
}

// NEW (note: timezone must be provided; test sets timezone to 'Asia/Karachi' via setCachedConfig
// but that is only used as fallback for on_complete — for cron, timezone comes from schedule):
{
  title: 'Daily',
  projectId: 'p1',
  triggerType: 'cron',
  schedule: { freq: 'DAILY', byHour: [17], byMinute: [0], timezone: 'Asia/Karachi' },
}
```

- [ ] Apply these four input-shape changes to `tests/tools/recurring-tools.test.ts`.

### Step 1.4 — Verify create-tool tests pass

```bash
bun test tests/tools/recurring-tools.test.ts --reporter=verbose 2>&1 | grep -E '(✓|✗|PASS|FAIL)'
```

Expected: all tests in `makeCreateRecurringTaskTool` describe block pass.

### Step 1.5 — Commit

```bash
git add src/tools/create-recurring-task.ts tests/tools/recurring-tools.test.ts
git commit -m "$(cat <<'EOF'
feat(tools): migrate create_recurring_task to RRULE schedule schema

Replaces the semantic schedule object (frequency/time/days_of_week) with
the same rruleInputSchema already used by deferred-prompt tools. dtstart
is injected synthetically at call time, matching the deferred-prompt
pattern. semanticScheduleToCompiled is no longer called from this tool.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2 — Migrate `update-recurring-task.ts`

**Files:**

- Modify: `src/tools/update-recurring-task.ts`
- Modify: `tests/tools/update-recurring-task.test.ts`
- Modify: `tests/tools/recurring-tools.test.ts` (update-tool section only)

### Step 2.1 — Update the source

Replace the full content of `src/tools/update-recurring-task.ts`:

```typescript
import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { logger } from '../logger.js'
import { recurrenceSpecToRrule } from '../recurrence.js'
import {
  getRecurringTask as defaultGetRecurringTask,
  updateRecurringTask as defaultUpdateRecurringTask,
} from '../recurring.js'
import { rruleInputSchema } from '../deferred-prompts/types.js'
import type { RecurringTaskRecord } from '../types/recurring.js'
import { utcToLocal } from '../utils/datetime.js'

const log = logger.child({ scope: 'tool:update-recurring-task' })

export interface UpdateRecurringTaskDeps {
  getRecurringTask: (id: string) => RecurringTaskRecord | null
  updateRecurringTask: (id: string, updates: Record<string, unknown>) => RecurringTaskRecord | null
}

const defaultDeps: UpdateRecurringTaskDeps = {
  getRecurringTask: (...args) => defaultGetRecurringTask(...args),
  updateRecurringTask: (...args) => defaultUpdateRecurringTask(...args),
}

const inputSchema = z.object({
  recurringTaskId: z.string().describe('ID of the recurring task definition to update'),
  title: z.string().optional().describe('New title'),
  description: z.string().optional().describe('New description'),
  priority: z.enum(['no-priority', 'low', 'medium', 'high', 'urgent']).optional().describe('New priority'),
  status: z.string().optional().describe('New initial status'),
  assignee: z.string().optional().describe('New assignee'),
  labels: z.array(z.string()).optional().describe('New label IDs'),
  schedule: rruleInputSchema
    .optional()
    .describe("Updated schedule. Call get_current_time first to obtain the user's IANA timezone."),
  catchUp: z.boolean().optional().describe('Whether to create missed occurrences on resume'),
})

type Input = z.infer<typeof inputSchema>

function executeUpdate(userId: string, input: Input, deps: UpdateRecurringTaskDeps): unknown {
  const { recurringTaskId, title, description, priority, status, assignee, labels, schedule, catchUp } = input
  log.debug({ recurringTaskId }, 'Updating recurring task')

  const existing = deps.getRecurringTask(recurringTaskId)
  if (existing === null) {
    log.warn({ recurringTaskId }, 'Recurring task not found for update')
    return { error: 'Recurring task not found' }
  }

  const compiled =
    schedule === undefined ? undefined : recurrenceSpecToRrule({ ...schedule, dtstart: new Date().toISOString() })

  const updated = deps.updateRecurringTask(recurringTaskId, {
    title,
    description,
    priority,
    status,
    assignee,
    labels,
    rrule: compiled?.rrule,
    dtstartUtc: compiled?.dtstartUtc,
    timezone: compiled?.timezone,
    catchUp,
  })

  if (updated === null) {
    log.warn({ recurringTaskId }, 'Recurring task not found for update')
    return { error: 'Recurring task not found' }
  }

  log.info({ id: updated.id, title: updated.title }, 'Recurring task updated via tool')
  return {
    id: updated.id,
    title: updated.title,
    projectId: updated.projectId,
    enabled: updated.enabled,
    nextRun: utcToLocal(updated.nextRun, updated.timezone),
  }
}

export function makeUpdateRecurringTaskTool(
  userId: string,
  deps: UpdateRecurringTaskDeps = defaultDeps,
): ToolSet[string] {
  return tool({
    description:
      'Update a recurring task definition (title, description, priority, assignee, labels, schedule, catch-up setting).',
    inputSchema,
    execute: (input) => {
      try {
        return executeUpdate(userId, input, deps)
      } catch (error) {
        log.error(
          {
            error: error instanceof Error ? error.message : String(error),
            recurringTaskId: input.recurringTaskId,
            tool: 'update_recurring_task',
          },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
```

- [ ] Apply this change to `src/tools/update-recurring-task.ts`.

### Step 2.2 — Run existing tests (expect failures)

```bash
bun test tests/tools/recurring-tools.test.ts tests/tools/update-recurring-task.test.ts 2>&1 | grep -E '(FAIL|✗)' | head -20
```

Expected: failures in `makeUpdateRecurringTaskTool` sections (semantic schedule shape and top-level `timezone` field no longer accepted).

### Step 2.3 — Update update-tool test in `tests/tools/recurring-tools.test.ts`

In the `makeUpdateRecurringTaskTool` describe block, replace the test **"converts semantic schedule to rrule when updating"**:

```typescript
test('converts RRULE schedule input to compiled recurrence when updating', async () => {
  updateRecurringTaskResult = makeRecord()
  const tool = makeUpdateRecurringTaskTool('user-1', updateRecurringTaskDeps)
  if (!tool.execute) throw new Error('Tool execute is undefined')
  await tool.execute(
    {
      recurringTaskId: 'rec-1',
      schedule: { freq: 'WEEKLY', byDay: ['MO'], byHour: [9], byMinute: [0], timezone: 'UTC' },
    },
    toolCtx,
  )
  expect(updateRecurringTaskCalls[0]?.updates).toHaveProperty('rrule', 'FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=0')
})
```

- [ ] Apply this change to `tests/tools/recurring-tools.test.ts`.

### Step 2.4 — Update timezone-resolution tests in `tests/tools/update-recurring-task.test.ts`

The two tests that previously relied on a top-level `timezone` input field and semantic schedule become:

```typescript
test('uses schedule.timezone for RRULE compilation', async () => {
  getRecurringTaskResult = makeRecord({ timezone: 'America/New_York' })
  deps.updateRecurringTask = (id, updates): RecurringTaskRecord | null => {
    updateRecurringTaskCalls.push({ id, updates })
    return makeRecord({ timezone: 'America/New_York' })
  }

  const tool = makeUpdateRecurringTaskTool('user-1', deps)
  if (!tool.execute) throw new Error('Tool execute is undefined')

  await tool.execute(
    {
      recurringTaskId: 'rec-1',
      schedule: { freq: 'DAILY', byHour: [9], byMinute: [0], timezone: 'America/New_York' },
    },
    toolCtx,
  )

  const call = updateRecurringTaskCalls[0]
  expect(call).toBeDefined()
  expect(call?.updates['rrule']).toContain('BYHOUR=9')
  expect(call?.updates['timezone']).toBe('America/New_York')
})

test('schedule.timezone in RRULE input is used verbatim regardless of existing task timezone', async () => {
  getRecurringTaskResult = makeRecord({ timezone: 'America/New_York' })
  deps.updateRecurringTask = (id, updates): RecurringTaskRecord | null => {
    updateRecurringTaskCalls.push({ id, updates })
    return makeRecord()
  }

  const tool = makeUpdateRecurringTaskTool('user-1', deps)
  if (!tool.execute) throw new Error('Tool execute is undefined')

  await tool.execute(
    {
      recurringTaskId: 'rec-1',
      schedule: { freq: 'DAILY', byHour: [9], byMinute: [0], timezone: 'UTC' },
    },
    toolCtx,
  )

  const call = updateRecurringTaskCalls[0]
  expect(call?.updates['rrule']).toContain('BYHOUR=9')
  expect(call?.updates['timezone']).toBe('UTC')
})
```

- [ ] Replace the two old timezone tests in `tests/tools/update-recurring-task.test.ts` with the two tests above.

### Step 2.5 — Verify all update-tool tests pass

```bash
bun test tests/tools/recurring-tools.test.ts tests/tools/update-recurring-task.test.ts --reporter=verbose 2>&1 | grep -E '(✓|✗|PASS|FAIL)'
```

Expected: all tests pass.

### Step 2.6 — Commit

```bash
git add src/tools/update-recurring-task.ts tests/tools/recurring-tools.test.ts tests/tools/update-recurring-task.test.ts
git commit -m "$(cat <<'EOF'
feat(tools): migrate update_recurring_task to RRULE schedule schema

Removes the top-level timezone field and semantic schedule from the
update tool input. timezone is now part of schedule.timezone (RRULE
object). dtstart injected synthetically at call time.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3 — Remove dead code from `src/utils/datetime.ts`

**Files:**

- Modify: `src/utils/datetime.ts`

`semanticScheduleToCompiled` has no callers after Tasks 1–2. Remove it and all helpers that exist solely to support it.

### Step 3.1 — Run the full test suite first

```bash
bun test 2>&1 | tail -10
```

Expected: all tests pass (confirming no other callers of the dead code).

### Step 3.2 — Delete dead exports and helpers

Remove the following from `src/utils/datetime.ts` (lines 6–114):

- `SemanticSchedule` type (lines 6–12)
- `SemanticDay` type (line 14)
- `RRULE_DAY_MAP` constant (lines 16–24)
- `buildByDay` function (line 71)
- `semanticFreqToRruleFreq` function (lines 73–77)
- `semanticByDay` function (lines 79–88)
- `buildDtstartUtc` function (lines 64–67)
- `semanticScheduleToCompiled` function (lines 96–114)
- The now-unused import: `recurrenceSpecToRrule` from `'../recurrence.js'` (line 4)

The file after editing should contain only:

```typescript
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'

/**
 * Convert a local date+time in a named IANA timezone to a UTC ISO string.
 *
 * Uses date-fns-tz `fromZonedTime` which handles DST correctly. Falls back
 * to treating the time as UTC when the timezone identifier is invalid.
 */
export const localDatetimeToUtc = (date: string, time: string | undefined, timezone: string): string => {
  const localStr = `${date}T${time ?? '00:00'}:00`
  try {
    const utcDate = fromZonedTime(localStr, timezone)
    if (Number.isNaN(utcDate.getTime())) {
      return new Date(`${localStr}Z`).toISOString()
    }
    return utcDate.toISOString()
  } catch {
    return new Date(`${localStr}Z`).toISOString()
  }
}

/**
 * Convert a UTC ISO string to a naive local datetime string ("YYYY-MM-DDTHH:MM:SS")
 * for display back to the LLM. No Z suffix — signals local time.
 *
 * Returns null/undefined unchanged. Falls back to the original string
 * when the input cannot be parsed.
 */
export const utcToLocal = (utcIso: string | null | undefined, timezone: string): string | null | undefined => {
  if (utcIso === null || utcIso === undefined) return utcIso
  try {
    return formatInTimeZone(new Date(utcIso), timezone, "yyyy-MM-dd'T'HH:mm:ss")
  } catch {
    return utcIso
  }
}
```

- [ ] Apply this trimmed version to `src/utils/datetime.ts`.

### Step 3.3 — Verify tests still pass

```bash
bun test 2>&1 | tail -10
```

Expected: all tests pass (no existing test covered `semanticScheduleToCompiled` directly).

### Step 3.4 — Commit

```bash
git add src/utils/datetime.ts
git commit -m "$(cat <<'EOF'
refactor(datetime): remove semanticScheduleToCompiled and its helpers

Dead code after both recurring-task tools migrated to rruleInputSchema.
The two remaining exports (localDatetimeToUtc, utcToLocal) are unchanged.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4 — Update system prompt

**Files:**

- Modify: `src/system-prompt.ts` (lines 49–62)

### Step 4.1 — Update source

Replace lines 49–62 (the `RECURRING TASKS` block) in `src/system-prompt.ts`:

```
RECURRING TASKS — The user can set up tasks that repeat automatically:
- "cron" trigger: Use create_recurring_task with triggerType "cron" and a schedule object.
  - Call get_current_time first to obtain the user's IANA timezone; set schedule.timezone to that value.
  - schedule.freq: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY"
  - schedule.byDay: weekday codes e.g. ["MO"] for Monday, ["MO","WE","FR"] for Mon/Wed/Fri
  - schedule.byHour / schedule.byMinute: local-time arrays, e.g. byHour: [9], byMinute: [0] for 9:00 am
  - schedule.interval: optional, e.g. interval: 2 with freq "WEEKLY" = every 2 weeks
  - schedule.byMonthDay: optional day-of-month array, e.g. [1] for the 1st of each month
  - Examples: "every Monday at 9am" → { freq: "WEEKLY", byDay: ["MO"], byHour: [9], byMinute: [0], timezone: "<tz>" }
  - "weekdays at 9am" → { freq: "WEEKLY", byDay: ["MO","TU","WE","TH","FR"], byHour: [9], byMinute: [0], timezone: "<tz>" }
  - "1st of each month at 10am" → { freq: "MONTHLY", byMonthDay: [1], byHour: [10], byMinute: [0], timezone: "<tz>" }
- "on_complete" trigger: creates the next task only after the current one is marked done. Use triggerType "on_complete" (no schedule needed).
- Use list_recurring_tasks to show all recurring definitions. Use pause/resume/skip/delete tools to manage them.
- When resuming, set createMissed=true to retroactively create tasks for missed cycles during the pause.
- When the user says "stop" or "cancel" a recurring task, use delete_recurring_task.
- When they say "pause", use pause_recurring_task. When "skip the next one", use skip_recurring_task.
```

- [ ] Apply this replacement to `src/system-prompt.ts`.

### Step 4.2 — Run the full suite

```bash
bun test 2>&1 | tail -10
```

Expected: all tests pass (system prompt is tested only for structure/build, not content).

### Step 4.3 — Typecheck

```bash
bun typecheck 2>&1 | tail -20
```

Expected: no errors.

### Step 4.4 — Lint

```bash
bun lint src/system-prompt.ts src/tools/create-recurring-task.ts src/tools/update-recurring-task.ts src/utils/datetime.ts 2>&1
```

Expected: no errors.

### Step 4.5 — Commit

```bash
git add src/system-prompt.ts
git commit -m "$(cat <<'EOF'
docs(system-prompt): align RECURRING TASKS section to RRULE vocabulary

Replaces semantic schedule docs (frequency/time/days_of_week) with the
same RRULE field names (freq/byDay/byHour/byMinute/timezone) now used
by the tool input schema. Matches the DEFERRED PROMPTS section style.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Final Verification

```bash
bun test && bun typecheck && bun lint
```

Expected: all green.
