<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0030: Deferred Prompts System

## Status

Accepted (Supersedes ADR-0026)

## Context

The original proactive assistance system (ADR-0026) introduced reminders, briefings, and alerts as separate concerns with:

- `reminders` table for one-time and recurring notifications
- `user_briefing_state` table for morning briefing delivery tracking
- `alert_state` table for per-task alert suppression
- 8 different LLM tools for various CRUD operations
- 3 separate polling loops with different cadences
- Hardcoded alert check functions for specific conditions

While functional, this architecture had limitations:

1. **Fragmented UX**: Users needed different tools for reminders vs alerts vs briefings
2. **Rigid alert conditions**: Only 5 hardcoded alert types (deadline nudge, due today, overdue, stale, blocked)
3. **Complex state management**: Three tables with overlapping concerns
4. **Inflexible scheduling**: Reminders only, no conditional triggering
5. **Bypassed LLM**: Briefings were pre-generated, not leveraging the LLM's reasoning

We needed a unified abstraction that treats all deferred interactions as "prompts" - either scheduled (time-based) or alert (condition-based) - executed by the LLM with full tool access.

## Decision Drivers

- **Unified abstraction**: One concept for all deferred interactions
- **Flexible conditions**: User-defined alert conditions, not hardcoded
- **LLM execution**: All deferred prompts invoke the LLM for dynamic responses
- **Deterministic evaluation**: Alert conditions use a well-defined filter schema
- **Simpler state**: Fewer tables, clearer responsibilities
- **Full tool access**: Deferred prompts can use any available tool

## Considered Options

### Option 1: Extend existing proactive system

- **Pros**: Incremental change, preserves existing data
- **Cons**: Deepens technical debt, doesn't solve fragmentation
- **Verdict**: Rejected - would compound architectural issues

### Option 2: Parallel system with migration path

- **Pros**: Zero downtime migration, gradual adoption
- **Cons**: Complex dual-system period, increased maintenance
- **Verdict**: Rejected - unnecessary complexity for pre-1.0 software

### Option 3: Clean replacement (deferred prompts)

- **Pros**: Clean architecture, unified abstraction, simpler code
- **Cons**: Breaking change, requires dropping old tables
- **Verdict**: Accepted - appropriate for current maturity level

## Decision

Replace the proactive assistance system with a unified "deferred prompts" abstraction:

1. **Two tables** instead of three:
   - `scheduled_prompts`: time-based execution (one-shot or cron recurring)
   - `alert_prompts`: condition-based execution with filter schema
2. **Task snapshots table** (`task_snapshots`) for change detection:
   - Captures task field values over time
   - Enables `changed_to` operator in conditions
   - Composite primary key: `(user_id, task_id, field)`

3. **Unified LLM tools** (5 instead of 8):
   - `create_deferred_prompt` - creates either scheduled or alert prompt
   - `list_deferred_prompts` - returns both types with filtering
   - `get_deferred_prompt` - fetches by ID from either table
   - `update_deferred_prompt` - modifies prompt properties
   - `cancel_deferred_prompt` - soft-delete from either table

4. **Deterministic condition schema**:
   - Fields: `task.status`, `task.priority`, `task.assignee`, `task.dueDate`, `task.project`, `task.labels`
   - Operators: `eq`, `neq`, `changed_to`, `lt`, `gt`, `overdue`, `contains`, `not_contains`
   - Combinators: `and`, `or` (nested arbitrarily)
   - Validated with Zod schema

5. **Two polling loops**:
   - Scheduled poller: 60s interval, executes due prompts
   - Alert poller: 5min interval, evaluates conditions against task snapshots

6. **LLM execution**: All deferred prompts invoke `generateText()` with the user's full tool set, allowing dynamic responses based on current state.

## Implementation

### Database Schema (Migration 013)

```sql
-- Scheduled prompts (time-based)
CREATE TABLE scheduled_prompts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  prompt TEXT NOT NULL,
  fire_at TEXT NOT NULL,
  cron_expression TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT DEFAULT (datetime('now')) NOT NULL,
  last_executed_at TEXT
);

-- Alert prompts (condition-based)
CREATE TABLE alert_prompts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  prompt TEXT NOT NULL,
  condition TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT DEFAULT (datetime('now')) NOT NULL,
  last_triggered_at TEXT,
  cooldown_minutes INTEGER NOT NULL DEFAULT 60
);

-- Task snapshots for change detection
CREATE TABLE task_snapshots (
  user_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  field TEXT NOT NULL,
  value TEXT NOT NULL,
  captured_at TEXT DEFAULT (datetime('now')) NOT NULL,
  PRIMARY KEY (user_id, task_id, field)
);

-- Drop old proactive tables
DROP TABLE IF EXISTS reminders;
DROP TABLE IF EXISTS user_briefing_state;
DROP TABLE IF EXISTS alert_state;
```

### Condition Evaluation

Alert conditions use a recursive evaluator:

```typescript
type AlertCondition =
  | { field: string; op: string; value?: string | number }
  | { and: AlertCondition[] }
  | { or: AlertCondition[] }

function evaluateCondition(condition: AlertCondition, task: Task, snapshots: Map<string, string>): boolean
```

The `changed_to` operator compares current value against the snapshot, enabling "notify when status changes to done" use cases.

### Poller Implementation

Two independent polling loops in `src/deferred-prompts/poller.ts`:

1. **ScheduledPoller** (60s):
   - Queries `scheduled_prompts` where `fire_at <= now()` and `status = 'active'`
   - For each due prompt: invoke LLM with prompt text, mark executed
   - For recurring prompts: advance `fire_at` using cron expression

2. **AlertPoller** (5min):
   - Fetches active alert prompts with cooldown check
   - For each user's tasks: evaluate conditions against snapshots
   - On match: invoke LLM with prompt text, update `last_triggered_at`
   - Update snapshots for change detection on next cycle

### Tool Routing

The 5 unified tools route to appropriate CRUD functions based on context:

```typescript
// create_deferred_prompt accepts either:
{ prompt: string, schedule: { fire_at: string, cron?: string } }
// OR
{ prompt: string, condition: AlertCondition, cooldown_minutes?: number }
```

## Consequences

### Positive

- **Unified mental model**: Everything is a "prompt" - either scheduled or conditional
- **User-defined conditions**: Not limited to 5 hardcoded alert types
- **LLM-powered responses**: Dynamic, contextual responses instead of static messages
- **Simpler schema**: 3 tables with clear responsibilities vs 3 overlapping tables
- **Fewer tools**: 5 unified tools vs 8 specialized tools
- **Full tool access**: Deferred prompts can create tasks, send messages, etc.
- **Deterministic evaluation**: Conditions evaluated consistently, no LLM hallucination

### Negative

- **Breaking change**: Old proactive data lost (dropped tables)
- **More complex conditions**: Users must understand filter schema
- **Snapshot storage overhead**: Every task field tracked per user
- **Cooldown complexity**: Alert prompts need cooldown to prevent spam

### Mitigations

- Pre-1.0 breaking changes are acceptable
- LLM guidance explains condition syntax naturally
- Snapshots cleaned up when tasks archived
- 60min default cooldown prevents alert storms

## Related Decisions

- **ADR-0026: Proactive Assistance** (Superseded) - Original implementation with 3 tables and 8 tools
- **ADR-0016: Conversation Persistence** - Shared database patterns
- **ADR-0019: Recurring Task Automation** - Cron scheduling patterns reused

## Migration Notes

The deferred prompts migration (013) drops the proactive tables from ADR-0026:

- `reminders` → replaced by `scheduled_prompts`
- `user_briefing_state` → no longer needed (briefings are now scheduled prompts)
- `alert_state` → replaced by `task_snapshots` + `alert_prompts`

Users will need to recreate any reminders or alerts after upgrade.

## References

- Implementation plan: `docs/plans/done/2026-03-23-deferred-prompts-implementation.md`
- Schema: `src/db/schema.ts` (scheduledPrompts, alertPrompts, taskSnapshots)
- Implementation: `src/deferred-prompts/*.ts`
- Migration: `src/db/migrations/013_deferred_prompts.ts`
