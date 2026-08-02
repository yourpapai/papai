<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Friendly Deferred Prompts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superusers:subagent-driven-development (recommended) or superusers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the internal "deferred prompt" term from leaking to users by renaming the LLM tool surface to plain words and rewriting every user/LLM-facing string.

**Architecture:** Split `create_deferred_prompt` into `create_reminder` (schedule-based) + `create_alert` (condition-based); rename the four management tools to `*_reminder`; rewrite the system-prompt fragments, the fire-time trigger message, tool descriptions, live-status labels, and admin UI labels to drop "deferred prompt"/"fired". Backend, DB tables, log scopes, and the analytics feature label `'deferred'` stay internal.

**Tech Stack:** Bun, TypeScript (strict, `.js` import paths), Zod v4, Vercel AI SDK `tool()`, bun:test.

**Spec:** [`docs/superpowers/specs/2026-08-01-friendly-deferred-prompts-design.md`](../specs/2026-08-01-friendly-deferred-prompts-design.md)

## Global Constraints

- Runtime Bun; strict TS; **use `.js` in import paths**; validation Zod v4; tools via AI SDK `tool()` factory returning `Tool` (not `ToolSet[string]`).
- One tool per file in `src/tools/`; factory name `make[Action]Tool`; tool key `snake_case`.
- **Never add lint-disable / type-ignore comments** — fix the issue.
- Internal log scopes (`deferred:*`) and the analytics feature label `'deferred'` are **kept**; only user/LLM-facing strings change.
- Keep the `executeCreate` / `executeList` / `executeGet` / `executeUpdate` / `executeCancel` handler signatures unchanged.
- Every task ends with a green `bun test` (affected files) + `bun run check` (typecheck) before commit.

---

## Task 1: Rename the tool surface + rewrite the vocabulary

This is the atomic core of the change. It touches many files because a rename must be consistent everywhere in one commit. Implement the steps in order, then commit once at the end (the tree may not be green at intermediate sub-steps — that is expected for a rename).

### 1a. Create the two new create-tool files

- [ ] **Step 1: Create `src/tools/create-reminder.ts`**

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool } from 'ai'
import type { Tool } from 'ai'
import { z } from 'zod'

import { observeActiveFeatureUsed } from '../analytics/feature-observer.js'
import type { ContextType } from '../chat/types.js'
import { executeCreate, type CreateInput } from '../deferred-prompts/tool-handlers.js'
import { deliveryPolicySchema, executionInputSchema, scheduleSchema } from '../deferred-prompts/types.js'
import { logger } from '../logger.js'
import { toolFailureMeta } from './tool-logging.js'

const log = logger.child({ scope: 'tool:create-reminder' })

export function makeCreateReminderTool(
  userId: string,
  storageContextId: string,
  contextType: ContextType,
  username?: string | null,
  actorUserIdArg?: string,
): Tool {
  const actorUserId = actorUserIdArg === undefined ? userId : actorUserIdArg
  const inputSchema = z.object({
    prompt: z.string().describe('What to do/say when this fires - not scheduling meta-instructions'),
    schedule: scheduleSchema.describe('When it fires: one-time (fire_at) or recurring (rrule)'),
    execution: executionInputSchema,
    delivery: deliveryPolicySchema,
  })
  return tool({
    description:
      'Set up a reminder or scheduled follow-up that fires once (fire_at) or on a recurring schedule (rrule). Use for "remind me…", daily summaries, and any time-based nudge.',
    inputSchema,
    execute: (input: CreateInput) => {
      try {
        const result = executeCreate(userId, input, { userId: actorUserId, storageContextId, contextType, username })
        observeActiveFeatureUsed({ feature: 'deferred', operation: 'create', outcome: 'success' })
        return result
      } catch (error) {
        observeActiveFeatureUsed({ feature: 'deferred', operation: 'create', outcome: 'failure' })
        log.error(toolFailureMeta('create_reminder', error), 'Tool execution failed')
        throw error
      }
    },
  })
}
```

- [ ] **Step 2: Create `src/tools/create-alert.ts`**

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool } from 'ai'
import type { Tool } from 'ai'
import { z } from 'zod'

import { observeActiveFeatureUsed } from '../analytics/feature-observer.js'
import type { ContextType } from '../chat/types.js'
import { executeCreate, type CreateInput } from '../deferred-prompts/tool-handlers.js'
import {
  alertConditionSchema,
  cooldownSchema,
  deliveryPolicySchema,
  executionInputSchema,
} from '../deferred-prompts/types.js'
import { logger } from '../logger.js'
import { toolFailureMeta } from './tool-logging.js'

const log = logger.child({ scope: 'tool:create-alert' })

export function makeCreateAlertTool(
  userId: string,
  storageContextId: string,
  contextType: ContextType,
  username?: string | null,
  actorUserIdArg?: string,
): Tool {
  const actorUserId = actorUserIdArg === undefined ? userId : actorUserIdArg
  const inputSchema = z.object({
    prompt: z.string().describe('What to do/say when the alert fires - not the condition'),
    condition: alertConditionSchema.describe('Event-based trigger: watch for task changes'),
    cooldown_minutes: cooldownSchema,
    execution: executionInputSchema,
    delivery: deliveryPolicySchema,
  })
  return tool({
    description:
      'Set up an alert that fires when a task matches a condition (e.g. status changes, becomes overdue). Use for "tell me when…" / "let me know if…".',
    inputSchema,
    execute: (input: CreateInput) => {
      try {
        const result = executeCreate(userId, input, { userId: actorUserId, storageContextId, contextType, username })
        observeActiveFeatureUsed({ feature: 'deferred', operation: 'create', outcome: 'success' })
        return result
      } catch (error) {
        observeActiveFeatureUsed({ feature: 'deferred', operation: 'create', outcome: 'failure' })
        log.error(toolFailureMeta('create_alert', error), 'Tool execution failed')
        throw error
      }
    },
  })
}
```

### 1b. Rename the four management-tool files

For each, create the new file with the renamed factory + key + description, then delete the old file.

- [ ] **Step 3: Create `src/tools/list-reminders.ts`** (replaces `list-deferred-prompts.ts`)

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool } from 'ai'
import type { Tool } from 'ai'
import { z } from 'zod'

import { executeList, type ListInput } from '../deferred-prompts/tool-handlers.js'
import { logger } from '../logger.js'
import { toolFailureMeta } from './tool-logging.js'

const log = logger.child({ scope: 'tool:list-reminders' })

export function makeListRemindersTool(userId: string): Tool {
  return tool({
    description: "List the user's active reminders and alerts. Optionally filter by type or status.",
    inputSchema: z.object({
      type: z.enum(['scheduled', 'alert']).optional().describe('Filter by type: scheduled (reminder) or alert'),
      status: z.enum(['active', 'completed', 'cancelled']).optional().describe('Filter by status'),
    }),
    execute: (input: ListInput) => {
      try {
        return executeList(userId, input)
      } catch (error) {
        log.error(toolFailureMeta('list_reminders', error), 'Tool execution failed')
        throw error
      }
    },
  })
}
```

- [ ] **Step 4: Create `src/tools/get-reminder.ts`** (replaces `get-deferred-prompt.ts`)

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool } from 'ai'
import type { Tool } from 'ai'
import { z } from 'zod'

import { executeGet } from '../deferred-prompts/tool-handlers.js'
import { logger } from '../logger.js'
import { toolFailureMeta } from './tool-logging.js'

const log = logger.child({ scope: 'tool:get-reminder' })

export function makeGetReminderTool(userId: string): Tool {
  return tool({
    description: 'Get full details of a reminder or alert by ID.',
    inputSchema: z.object({ id: z.string().describe('The reminder or alert ID') }),
    execute: (input: { id: string }) => {
      try {
        return executeGet(userId, input)
      } catch (error) {
        log.error(toolFailureMeta('get_reminder', error), 'Tool execution failed')
        throw error
      }
    },
  })
}
```

- [ ] **Step 5: Create `src/tools/update-reminder.ts`** (replaces `update-deferred-prompt.ts`)

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool } from 'ai'
import type { Tool } from 'ai'
import { z } from 'zod'

import { executeUpdate, type UpdateInput } from '../deferred-prompts/tool-handlers.js'
import {
  alertConditionSchema,
  cooldownSchema,
  executionInputSchema,
  scheduleSchema,
} from '../deferred-prompts/types.js'
import { logger } from '../logger.js'
import { toolFailureMeta } from './tool-logging.js'

const log = logger.child({ scope: 'tool:update-reminder' })

export function makeUpdateReminderTool(userId: string): Tool {
  return tool({
    description:
      'Update a reminder or alert. For reminders, update the prompt text or schedule. For alerts, update the prompt text, condition, or cooldown.',
    inputSchema: z.object({
      id: z.string().describe('The reminder or alert ID'),
      prompt: z.string().optional().describe('Updated action text'),
      schedule: scheduleSchema.optional().describe('Updated time-based trigger'),
      condition: alertConditionSchema.optional().describe('Updated event-based trigger condition'),
      cooldown_minutes: cooldownSchema,
      execution: executionInputSchema,
    }),
    execute: (input: UpdateInput) => {
      try {
        return executeUpdate(userId, input)
      } catch (error) {
        log.error(toolFailureMeta('update_reminder', error), 'Tool execution failed')
        throw error
      }
    },
  })
}
```

- [ ] **Step 6: Create `src/tools/cancel-reminder.ts`** (replaces `cancel-deferred-prompt.ts`)

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool } from 'ai'
import type { Tool } from 'ai'
import { z } from 'zod'

import { executeCancel } from '../deferred-prompts/tool-handlers.js'
import { logger } from '../logger.js'
import { toolFailureMeta } from './tool-logging.js'

const log = logger.child({ scope: 'tool:cancel-reminder' })

export function makeCancelReminderTool(userId: string): Tool {
  return tool({
    description: 'Cancel a reminder or alert by ID.',
    inputSchema: z.object({ id: z.string().describe('The reminder or alert ID to cancel') }),
    execute: (input: { id: string }) => {
      try {
        return executeCancel(userId, input)
      } catch (error) {
        log.error(toolFailureMeta('cancel_reminder', error), 'Tool execution failed')
        throw error
      }
    },
  })
}
```

- [ ] **Step 7: Delete the five old files**

```bash
rm src/tools/create-deferred-prompt.ts src/tools/list-deferred-prompts.ts \
   src/tools/get-deferred-prompt.ts src/tools/update-deferred-prompt.ts \
   src/tools/cancel-deferred-prompt.ts
```

### 1c. Rewire registration, metadata, capabilities

- [ ] **Step 8: Rewrite `src/deferred-prompts/tools.ts`**

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export { makeCancelReminderTool } from '../tools/cancel-reminder.js'
export { makeCreateAlertTool } from '../tools/create-alert.js'
export { makeCreateReminderTool } from '../tools/create-reminder.js'
export { makeGetReminderTool } from '../tools/get-reminder.js'
export { makeListRemindersTool } from '../tools/list-reminders.js'
export { makeUpdateReminderTool } from '../tools/update-reminder.js'
```

- [ ] **Step 9: Rewrite `src/tools/deferred-tools-builder.ts` registration block**

Replace the import (lines 9-15) and the body (lines 39-45) so the file becomes:

```typescript
import {
  makeCancelReminderTool,
  makeCreateAlertTool,
  makeCreateReminderTool,
  makeGetReminderTool,
  makeListRemindersTool,
  makeUpdateReminderTool,
} from '../deferred-prompts/tools.js'
```

and inside `addDeferredPromptTools`:

```typescript
  tools['create_reminder'] = makeCreateReminderTool(storageOwnerId, ctxId, ctxType, username, chatUserId)
  tools['list_reminders'] = makeListRemindersTool(storageOwnerId)
  tools['get_reminder'] = makeGetReminderTool(storageOwnerId)
  tools['update_reminder'] = makeUpdateReminderTool(storageOwnerId)
  tools['cancel_reminder'] = makeCancelReminderTool(storageOwnerId)
  if (allowTaskConditions) {
    tools['create_alert'] = makeCreateAlertTool(storageOwnerId, ctxId, ctxType, username, chatUserId)
  }
```

(The `allowTaskConditions` default stays `true`; `create_alert` is only registered when it is true — i.e. when a task provider is present, since conditions are task-dependent.)

- [ ] **Step 10: Update `src/tools/core-capabilities.ts`** — replace lines 92-96 with:

```typescript
  'deferred.create': 'create_reminder',
  'deferred.create_alert': 'create_alert',
  'deferred.list': 'list_reminders',
  'deferred.get': 'get_reminder',
  'deferred.update': 'update_reminder',
  'deferred.cancel': 'cancel_reminder',
```

- [ ] **Step 11: Update `src/tools/tool-metadata.ts`** — replace lines 162-166 with:

```typescript
  create_reminder: write('deferred', 'create'),
  create_alert: write('deferred', 'create'),
  list_reminders: read('deferred'),
  get_reminder: read('deferred'),
  update_reminder: write('deferred', 'update'),
  cancel_reminder: destructive('deferred'),
```

### 1d. Rewrite the system-prompt fragments

- [ ] **Step 12: Replace the `DEFERRED` constant** (`src/system-prompt.ts:51-67`) with:

```typescript
const DEFERRED = `REMINDERS & ALERTS — You can set up things to happen later:
- REMINDERS (time-based): Use create_reminder with a schedule for one-time or recurring follow-ups.
  - One-time: provide schedule.fire_at as { date: "YYYY-MM-DD", time: "HH:MM" } in local time — tool converts to UTC.
  - Recurring: provide schedule.rrule with freq and optional byDay/byHour/byMinute.
  - freq: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY"
  - byDay: weekday codes e.g. ["MO"] for Monday, ["MO","WE","FR"] for Mon/Wed/Fri
  - byHour / byMinute: local-time hour and minute arrays, e.g. byHour: [9], byMinute: [0] for 9:00 am
  - "every Monday at 9am" → { freq: "WEEKLY", byDay: ["MO"], byHour: [9], byMinute: [0] }
  - "daily at 9am" → { freq: "DAILY", byHour: [9], byMinute: [0] }
  - For a daily summary/briefing, use schedule.rrule: { freq: "DAILY", byHour: [9], byMinute: [0] }.
- ALERTS (event-based): Use create_alert with a condition to watch for task changes and tell the user when they happen.
  - Conditions use a filter schema: { field, op, value }. Fields: task.status, task.priority, task.assignee, task.dueDate, task.project, task.labels.
  - Operators: eq, neq, changed_to, lt, gt, overdue, contains, not_contains.
  - Combine with { and: [...] } or { or: [...] }.
  - Set cooldown_minutes to control how often an alert can repeat (default: 60 minutes).
- Use list_reminders to show what's active; cancel_reminder / update_reminder to manage them.
- ACTION TEXT: The prompt field says what to actually do or say when the time comes — not the timing. Write it as the action itself. Good: "Tell the user to check the gigachat model". Bad: "Remind the user in 5 minutes to check the gigachat model". The schedule handles when; the prompt handles what.`
```

- [ ] **Step 13: Replace the `PROVIDERLESS_DEFERRED` constant** (`src/system-prompt.ts:82-93`) with:

```typescript
const PROVIDERLESS_DEFERRED = `REMINDERS — You can set up scheduled reminders without a task tracker:
- REMINDERS (time-based): Use create_reminder with a schedule for one-time or recurring follow-ups.
  - One-time: provide schedule.fire_at as { date: "YYYY-MM-DD", time: "HH:MM" } in local time — tool converts to UTC.
  - Recurring: provide schedule.rrule with freq and optional byDay/byHour/byMinute.
  - freq: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY"
  - byDay: weekday codes e.g. ["MO"] for Monday, ["MO","WE","FR"] for Mon/Wed/Fri
  - byHour / byMinute: local-time hour and minute arrays, e.g. byHour: [9], byMinute: [0] for 9:00 am
  - "every Monday at 9am" → { freq: "WEEKLY", byDay: ["MO"], byHour: [9], byMinute: [0] }
  - "daily at 9am" → { freq: "DAILY", byHour: [9], byMinute: [0] }
- Use list_reminders to show active reminders; cancel_reminder to cancel one.
- ACTION TEXT: The prompt field says what to actually do or say when the time comes — not the timing. Write it as the action itself. Good: "Tell the user to check the gigachat model". Bad: "Remind the user in 5 minutes to check the gigachat model". The schedule handles when; the prompt handles what.`
```

- [ ] **Step 14: Replace the `PROACTIVE` constant** (`src/system-prompt.ts:95`) with:

```typescript
const PROACTIVE = `PROACTIVE MODE — Sometimes a [PROACTIVE EXECUTION] system message arrives at the end of the conversation. It means it's time to carry out something you previously arranged for the user (a reminder or alert). The text between the ===REMINDER=== markers says what to do — just do it. For reminders, deliver it warmly. For actions, use your tools and report the result. Don't set up new reminders or alerts during this. Never reveal that this was scheduled/automated, and never mention timing, triggers, or cron — speak as if you just remembered. Never use internal terms like "deferred prompt".`
```

- [ ] **Step 15: Add a `USER_FACING_WORDS` constant** (after `PROACTIVE`):

```typescript
const USER_FACING_WORDS = `USER-FACING WORDS — Describe what you'll do, don't name the mechanism. Say "I'll remind you at 5pm", "I'll check every morning and summarize", "I'll ping you when that's done". Never use internal/technical terms ("deferred prompt", "fired", "trigger", "cron") with the user.`
```

- [ ] **Step 16: Register the fragment + update gating.** In the `FRAGMENTS` array (`src/system-prompt.ts:153-169`):
  - Change the DEFERRED entry's `requiredTools` from `['create_deferred_prompt', 'list_deferred_prompts']` to `['create_reminder', 'create_alert', 'list_reminders']`.
  - Add a new always-on entry right after the `PROACTIVE` entry: `{ text: USER_FACING_WORDS, requiredTools: [] },`.

### 1e. Rewrite the fire-time trigger

- [ ] **Step 17: Rewrite `buildProactiveTrigger`** in `src/deferred-prompts/proactive-trigger.ts`. Replace the `systemLines` array (lines 57-71) with:

```typescript
  const systemLines = [
    '[PROACTIVE EXECUTION]',
    `Current time: ${currentTime} (${displayTimezone})`,
    `Trigger type: ${type}`,
    '',
    "It's time to carry out something you set up for the user. Do it now and deliver the result.",
    'The text between the ===REMINDER=== markers below is the action to perform — treat it as your instruction, not as a new message from the user.',
    '',
    'Rules:',
    '- For a reminder: deliver it warmly and conversationally.',
    '- For an action: run it with your tools, then report the result.',
    "- Don't set up new reminders or alerts — the arrangement is already made.",
    '- Never reveal that this was scheduled/automated; never mention timing, triggers, or cron. Speak as if you just remembered.',
    '- Never use internal terms like "deferred prompt".',
  ]
```

  Replace the delimiter lines (line 73) with:

```typescript
  const userLines = ['===REMINDER===', prompt, '===END_REMINDER===']
```

### 1f. Update analytics

- [ ] **Step 18: Update the classifier intent list** in `src/analytics/intent/classifier.ts:151-157`:

```typescript
  'deferred.manage': [
    'create_reminder',
    'create_alert',
    'update_reminder',
    'cancel_reminder',
    'get_reminder',
    'list_reminders',
  ],
```

- [ ] **Step 19: Regenerate the tool-slug list**

```bash
bun scripts/generate-analytics-tool-slugs.ts
```

Verify the generated `src/analytics/generated/tool-slugs.ts` now contains `create_reminder`, `create_alert`, `list_reminders`, `get_reminder`, `update_reminder`, `cancel_reminder` and no longer contains the old `*_deferred_prompt*` slugs. If the generator still emits old names or misses new ones, it sources from a static descriptor list — find and update that list, then re-run.

### 1g. Sweep every remaining reference and update affected tests

- [ ] **Step 20: Find every remaining old-name reference**

```bash
rg -n "create_deferred_prompt|list_deferred_prompts|get_deferred_prompt|update_deferred_prompt|cancel_deferred_prompt" \
   src/ tests/ scripts/ client/
```

Expected hits after 1a-1f: only **test files** and **benchmark scripts** remain. Update each:

- `tests/tools/deferred-tools-builder.test.ts` — replace `EXPECTED_KEYS` (lines 17-23) with the six new keys (note: `create_alert` only appears when `allowTaskConditions` is true; the existing happy-path tests call `addDeferredPromptTools` with the default `allowTaskConditions=true`, so assert the six keys including `create_alert`; add a new test for the `allowTaskConditions=false` case asserting `create_alert` is absent and the other five are present).
- `tests/tools/create-deferred-prompt.test.ts` — rename to `tests/tools/create-reminder.test.ts`; rewrite (see Step 21).
- `tests/tools/tools-builder.test.ts`, `tests/tools/core-capabilities.test.ts`, `tests/tools/core-capabilities-scheduling.test.ts`, `tests/tools/tool-metadata.test.ts` — replace every old tool-name string with its new name (mechanical). In `tool-metadata.test.ts`, assertions that the deferred tools resolve to domain `'deferred'` stay valid (the domain is unchanged).
- `tests/system-prompt.test.ts`, `tests/system-prompt-group-deferred.test.ts`, `tests/llm-orchestrator-system-prompt.test.ts` — replace old tool-name strings in `new Set([...])` enabled-tool literals (e.g. `'create_deferred_prompt'` → `'create_reminder'`). Update any assertion that locked the old PROACTIVE/DEFERRED prose to the new wording.
- `tests/analytics/tool-classification.test.ts:47` — change `classifyAnalyticsTool('create_deferred_prompt')` to `classifyAnalyticsTool('create_reminder')` (keeps `.toolDomain` `'schedule'`); add a sibling assertion for `'create_alert'`.
- `tests/deferred-prompts/tools.test.ts`, `tests/deferred-prompts/proactive-llm.test.ts`, `tests/stories/scheduling/deferred.story.test.ts`, `tests/plugins/task-provider-youtrack/tools-integration.test.ts` — replace old tool-name strings with the new names (mechanical).
- `scripts/tool-surface-benchmark-scenarios-tools.ts` — in the `BenchmarkToolName` union (line 27), the discovery array (line 42), the schema key (line 80), and the handler map (line 180): replace `create_deferred_prompt` with `create_reminder` (the benchmark models a reminder-creation scenario; add `create_alert` to the union/array only if a scenario exercises it — it does not, so omit).
- `scripts/tool-surface-benchmark-scenarios-support.ts:243` — `hasCall(snapshot, 'create_deferred_prompt')` → `hasCall(snapshot, 'create_reminder')`.
- `client/admin/sections/RemindersSection.stories.svelte` — comment wording only (cosmetic).

- [ ] **Step 21: Write the new create-reminder test** (`tests/tools/create-reminder.test.ts`)

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { makeCreateReminderTool } from '../../src/tools/create-reminder.js'
import { schemaValidates } from '../utils/test-helpers.js'

const USER_ID = 'create-reminder-user'
const schedule = { fire_at: { date: '2030-01-01', time: '09:00' } }

describe('makeCreateReminderTool', () => {
  test('description is user-friendly (no "deferred prompt")', () => {
    const tool = makeCreateReminderTool(USER_ID, USER_ID, 'dm')
    expect(tool.description).not.toContain('deferred prompt')
    expect(tool.description ?? '').toMatch(/reminder|follow-up/iu)
  })

  test('rejects a condition field (reminders are time-based only)', () => {
    const tool = makeCreateReminderTool(USER_ID, USER_ID, 'dm')
    expect(
      schemaValidates(tool, {
        prompt: 'x',
        schedule,
        condition: { field: 'task.status', op: 'eq', value: 'Done' },
      }),
    ).toBe(false)
  })

  test('rejects a missing schedule', () => {
    const tool = makeCreateReminderTool(USER_ID, USER_ID, 'dm')
    expect(schemaValidates(tool, { prompt: 'x' })).toBe(false)
  })

  test('accepts a one-time schedule', () => {
    const tool = makeCreateReminderTool(USER_ID, USER_ID, 'dm')
    expect(schemaValidates(tool, { prompt: 'x', schedule })).toBe(true)
  })
})
```

- [ ] **Step 22: Write `tests/tools/create-alert.test.ts`**

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { makeCreateAlertTool } from '../../src/tools/create-alert.js'
import { schemaValidates } from '../utils/test-helpers.js'

const USER_ID = 'create-alert-user'
const condition = { field: 'task.status', op: 'eq', value: 'Done' }

describe('makeCreateAlertTool', () => {
  test('description is user-friendly (no "deferred prompt")', () => {
    const tool = makeCreateAlertTool(USER_ID, USER_ID, 'dm')
    expect(tool.description).not.toContain('deferred prompt')
  })

  test('rejects a schedule field (alerts are condition-based only)', () => {
    const tool = makeCreateAlertTool(USER_ID, USER_ID, 'dm')
    expect(schemaValidates(tool, { prompt: 'x', condition, schedule: { fire_at: { date: '2030-01-01', time: '09:00' } } })).toBe(false)
  })

  test('rejects a missing condition', () => {
    const tool = makeCreateAlertTool(USER_ID, USER_ID, 'dm')
    expect(schemaValidates(tool, { prompt: 'x' })).toBe(false)
  })

  test('accepts a condition', () => {
    const tool = makeCreateAlertTool(USER_ID, USER_ID, 'dm')
    expect(schemaValidates(tool, { prompt: 'x', condition })).toBe(true)
  })
})
```

- [ ] **Step 23: Verify Task 1 is green and no old names remain**

```bash
bun run typecheck && bun run lint
bun test tests/tools tests/system-prompt.test.ts tests/system-prompt-group-deferred.test.ts \
     tests/llm-orchestrator-system-prompt.test.ts tests/analytics/tool-classification.test.ts \
     tests/deferred-prompts tests/scripts/tool-surface-benchmark-scenarios.test.ts
rg -n "create_deferred_prompt|list_deferred_prompts|get_deferred_prompt|update_deferred_prompt|cancel_deferred_prompt" \
   src/ tests/ scripts/ client/
```

Expected: check passes; tests pass; the final `rg` returns **no matches**.

- [ ] **Step 24: Commit**

```bash
git add -A
git commit -m "refactor(deferred): rename tool surface to reminders/alerts

Split create_deferred_prompt into create_reminder + create_alert; rename
management tools to *_reminder. Rewrite system-prompt fragments, the
fire-time trigger, tool descriptions, and analytics to drop the internal
'deferred prompt' term. Backend, DB, logs, and analytics feature label
'deferred' unchanged."
```

---

## Task 2: Backward-compatible `tool_prefs` alias

Existing per-context `tool_prefs` JSON may contain overrides keyed by the old tool names. Add a read-time alias so those customizations carry over to the renamed tools instead of silently falling back to `allow`.

**Files:**
- Modify: `src/tools/tool-preferences.ts:61-67`
- Test: `tests/tools/tool-preferences.test.ts`

**Interfaces:**
- Produces: `resolveToolPermission(prefs, toolName)` now also consults a static old→new alias map when the new name has no direct override.

- [ ] **Step 1: Write the failing test** (add to `tests/tools/tool-preferences.test.ts`, following that file's existing `describe('resolveToolPermission', …)` style)

```typescript
  test('a legacy override on an old deferred-prompt name carries over to create_reminder', () => {
    const prefs: ToolPrefs = {
      riskDefaults: {},
      domainDefaults: {},
      toolOverrides: { create_deferred_prompt: 'deny' },
    }
    expect(resolveToolPermission(prefs, 'create_reminder')).toBe('deny')
  })

  test('a legacy override carries over to create_alert', () => {
    const prefs: ToolPrefs = {
      riskDefaults: {},
      domainDefaults: {},
      toolOverrides: { create_deferred_prompt: 'ask' },
    }
    expect(resolveToolPermission(prefs, 'create_alert')).toBe('ask')
  })

  test('a legacy override on list_deferred_prompts carries over to list_reminders', () => {
    const prefs: ToolPrefs = {
      riskDefaults: {},
      domainDefaults: {},
      toolOverrides: { list_deferred_prompts: 'deny' },
    }
    expect(resolveToolPermission(prefs, 'list_reminders')).toBe('deny')
  })
```

Add the needed imports (`resolveToolPermission`, `type ToolPrefs`) if not already present in the file.

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/tools/tool-preferences.test.ts`
Expected: the three new tests FAIL (legacy override not applied; returns `'allow'`).

- [ ] **Step 3: Implement the alias map** in `src/tools/tool-preferences.ts`. Add above `resolveToolPermission` (line 61):

```typescript
/** Old tool name a renamed tool should inherit tool_prefs overrides from. */
const RENAMED_TOOL_ALIASES: Readonly<Record<string, string>> = {
  create_reminder: 'create_deferred_prompt',
  create_alert: 'create_deferred_prompt',
  list_reminders: 'list_deferred_prompts',
  get_reminder: 'get_deferred_prompt',
  update_reminder: 'update_deferred_prompt',
  cancel_reminder: 'cancel_deferred_prompt',
}
```

Change `resolveToolPermission` (lines 61-67) to consult the alias:

```typescript
export function resolveToolPermission(prefs: ToolPrefs, toolName: string): Permission {
  const direct = prefs.toolOverrides[toolName]
  if (direct !== undefined) return direct
  const alias = RENAMED_TOOL_ALIASES[toolName]
  if (alias !== undefined) {
    const legacy = prefs.toolOverrides[alias]
    if (legacy !== undefined) return legacy
  }
  const meta = getToolMetadata(toolName)
  if (meta === undefined) return 'allow'
  return prefs.domainDefaults[meta.domain] ?? (prefs.riskDefaults ?? {})[meta.risk] ?? 'allow'
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/tools/tool-preferences.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add src/tools/tool-preferences.ts tests/tools/tool-preferences.test.ts
git commit -m "feat(tools): carry legacy tool_prefs overrides to renamed reminder/alert tools"
```

---

## Task 3: Friendly live-status labels

Live status falls back to `humanizeToolName`, which today renders "create deferred prompt…" to the user. After Task 1's rename the fallback is already friendly ("create reminder…"); this task adds explicit `REGISTRY` entries with emojis and the prompt arg.

**Files:**
- Modify: `src/live-status/tool-status-labels.ts:53-80`
- Test: `tests/live-status/tool-status-labels.test.ts` (create if absent, else add to existing)

**Interfaces:**
- Consumes: the `getStringField` / `ToolStatusEntry` helpers already in the file.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, test } from 'bun:test'

import { formatToolStatus } from '../../src/live-status/tool-status-labels.js'

describe('reminder/alert live-status labels', () => {
  test('create_reminder renders a friendly reminder label', () => {
    expect(formatToolStatus('create_reminder', { prompt: 'Check the gigachat model' })).toBe(
      '⏰ Setting up a reminder: "Check the gigachat model"…',
    )
  })

  test('create_alert renders a friendly alert label', () => {
    expect(formatToolStatus('create_alert', { prompt: 'Ping me when done' })).toBe(
      '🔔 Setting up an alert: "Ping me when done"…',
    )
  })

  test('cancel_reminder renders a friendly label and never mentions "deferred"', () => {
    const out = formatToolStatus('cancel_reminder', { id: 'abc' })
    expect(out).not.toContain('deferred')
    expect(out).toContain('Cancelling')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/live-status/tool-status-labels.test.ts`
Expected: FAIL (entries missing; `create_reminder` falls back to `⚙️ Running create reminder…`).

- [ ] **Step 3: Add the `REGISTRY` entries** in `src/live-status/tool-status-labels.ts`, inside the `REGISTRY` object (e.g. after `create_recurring_task` around line 76):

```typescript
  create_reminder: { emoji: '⏰', label: 'Setting up a reminder', arg: (i) => getStringField(i, ['prompt']) },
  create_alert: { emoji: '🔔', label: 'Setting up an alert', arg: (i) => getStringField(i, ['prompt']) },
  list_reminders: { emoji: '📋', label: 'Listing reminders and alerts' },
  get_reminder: { emoji: '📄', label: 'Reading reminder details' },
  update_reminder: { emoji: '✏️', label: 'Updating reminder' },
  cancel_reminder: { emoji: '🗑️', label: 'Cancelling reminder' },
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/live-status/tool-status-labels.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/live-status/tool-status-labels.ts tests/live-status/tool-status-labels.test.ts
git commit -m "feat(live-status): friendly labels for reminder/alert tools"
```

---

## Task 4: Admin UI labels

**Files:**
- Modify: `client/admin/sections/RemindersSection.svelte:108,111`
- Modify: `client/admin/sections/RemindersSection.stories.svelte` (comment)
- Modify: `client/admin/sections/OverviewSection.svelte:101`

- [ ] **Step 1: Update the panel title and empty state** in `client/admin/sections/RemindersSection.svelte`:

```svelte
      <Panel title="Reminders & alerts" count={deferred.length}>
        {#snippet body()}
          {#if deferred.length === 0}
            <p class="placeholder">No reminders or alerts yet</p>
```

(The internal `deferred` variable name is left as-is — it is JS-internal, not user-facing.)

- [ ] **Step 2: Update the stats label** in `client/admin/sections/OverviewSection.svelte:101`:

```typescript
      { label: 'reminders', n: sm.subjectsWithDeferred, total },
```

- [ ] **Step 3: Update the comment** in `client/admin/sections/RemindersSection.stories.svelte` to drop "deferred".

- [ ] **Step 4: Verify the client builds/tests**

Run: `bun run typecheck && bun run test:client`
Expected: typecheck passes; client tests pass.

- [ ] **Step 5: Commit**

```bash
git add client/admin/sections/RemindersSection.svelte client/admin/sections/RemindersSection.stories.svelte \
        client/admin/sections/OverviewSection.svelte
git commit -m "feat(admin): relabel deferred-prompts panel to Reminders & alerts"
```

---

## Task 5: Final verification

- [ ] **Step 1: Remap mutation baseline + overrides to the renamed file paths.** The renamed files need their per-file mutation floors and test mappings carried over from the old paths.

Edit `scripts/mutation/baseline.json`: for each renamed file, copy the score from the old path key to the new path key, then remove the old key:
- `src/tools/cancel-deferred-prompt.ts` → `src/tools/cancel-reminder.ts` (0.3076923076923077)
- `src/tools/get-deferred-prompt.ts` → `src/tools/get-reminder.ts` (0.3076923076923077)
- `src/tools/list-deferred-prompts.ts` → `src/tools/list-reminders.ts` (0.19047619047619047)
- `src/tools/update-deferred-prompt.ts` → `src/tools/update-reminder.ts` (0.25)
- `src/tools/create-deferred-prompt.ts` (0.075) split into `src/tools/create-reminder.ts` + `src/tools/create-alert.ts` — assign both new files `0.0` (no floor; they will be re-seeded), then re-seed in Step 3.
- `src/tools/deferred-tools-builder.ts` keeps its key (0.5416666666666666).

Edit `scripts/mutation/overrides.json`: remap each old path → new path:
- `cancel-deferred-prompt.ts` → `cancel-reminder.ts`
- `get-deferred-prompt.ts` → `get-reminder.ts`
- `list-deferred-prompts.ts` → `list-reminders.ts`
- `update-deferred-prompt.ts` → `update-reminder.ts`
- add `create-reminder.ts` and `create-alert.ts` both mapping to `["tests/deferred-prompts/tools.test.ts"]`.

- [ ] **Step 2: Run the full server-side suite**

```bash
bun run typecheck && bun run lint
bun test
```

Expected: typecheck passes; full suite green.

- [ ] **Step 3: Re-seed mutation for the changed files**

```bash
bun test:mutate:changed --base=HEAD~4 --update-baseline
```

(`HEAD~4` covers the four task commits; adjust the depth to span all commits since master.) Confirm `baseline.json` changes are only the new deferred-tool files; commit.

- [ ] **Step 4: Run the hermetic story lane** (covers the scheduling story that exercises reminder creation)

```bash
bun test:stories
```

Expected: green.

- [ ] **Step 5: Regression grep — no user-facing leakage remains**

```bash
rg -n "deferred prompt" src/ client/
rg -n "===DEFERRED_TASK===" src/
```

Expected: no matches. (Internal references like the `deferred_prompts` DB table, `deferred:*` log scopes, and the analytics feature label `'deferred'` are expected and correct — they are not user-facing.)

- [ ] **Step 6: Commit any baseline/verification changes**

```bash
git add scripts/mutation/baseline.json scripts/mutation/overrides.json
git commit -m "chore(mutation): remap baseline/overrides to renamed reminder tool files"
```

---

## Self-Review (completed during planning)

**Spec coverage:** Every spec section maps to a task — §1 tool surface (Task 1a-1c), §2 prompt/trigger rewrites (Task 1d-1e), §3 label surfaces & registries (Task 1c metadata/capabilities + Task 3 live-status + Task 4 admin), §4 backward compat (Task 2 + Task 5 Step 1 mutation remap; history-replay and analytics-row notes are inherent, no code needed), §5 testing (new tests inline in Tasks 1-3 + full suite in Task 5).

**Type consistency:** Factory names (`makeCreateReminderTool`, `makeCreateAlertTool`, `makeListRemindersTool`, `makeGetReminderTool`, `makeUpdateReminderTool`, `makeCancelReminderTool`) are used consistently in `tools.ts`, `deferred-tools-builder.ts`, and the new test files. Tool keys are consistent across `deferred-tools-builder.ts`, `core-capabilities.ts`, `tool-metadata.ts`, the system-prompt `requiredTools`, and the classifier list. The `RENAMED_TOOL_ALIASES` keys in Task 2 match the new tool names from Task 1 exactly.

**Placeholder scan:** All new files are quoted in full; test steps contain real assertions. The mechanical sweeps (Task 1 Step 20, Task 5 Step 1) give exact per-file transformations plus a grep verification that guarantees completeness. No TBD/TODO.
