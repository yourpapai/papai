# Proactive Group Messaging Design

**Date:** 2026-04-13
**Status:** Proposed

## Problem

The entire proactive messaging system (deferred prompts, alerts, scheduled
messages) is DM-only. Every layer — data model, chat providers, poller,
tools — is scoped to `userId` with no group/channel concept. Users cannot
create deferred prompts or alerts that fire into group chats.

## Decision Summary

- **Approach:** Unified Target Abstraction (Approach B) — replace the
  `userId`-centric model with a `DeliveryTarget` abstraction throughout
  the pipeline
- **Group identity:** Group-scoped — groups own their config/credentials,
  prompts execute against group context
- **Targeting:** Implicit — prompts fire where they were created (DM
  prompt → DM, group prompt → group)
- **Execution modes:** All three (lightweight, context, full) available
  in groups
- **Permissions:** Any authorized user can create/manage prompts in a group
- **Mentions:** No system-level mentions — the LLM handles mentions
  naturally if the prompt text requests it
- **Limits:** Same limits as DMs, no special group treatment

## Design

### DeliveryTarget Type

```typescript
type DeliveryTarget = {
  contextId: string // userId for DMs, groupId for groups
  contextType: 'dm' | 'group'
}
```

This replaces bare `userId: string` parameters throughout the proactive
messaging pipeline.

### Database Migration

Single migration file. All three tables are updated:

**`scheduled_prompts`:**

- Rename `user_id` → `context_id`
- Add `context_type TEXT NOT NULL DEFAULT 'dm'`
- Add `created_by_user_id TEXT NOT NULL DEFAULT ''`
- Backfill: `created_by_user_id = context_id` for existing rows
- Update indices to use new column names

**`alert_prompts`:**

- Same three changes as `scheduled_prompts`
- Same backfill logic

**`task_snapshots`:**

- Rename `user_id` → `context_id`
- No `context_type` needed (snapshots are keyed by context only)

**`created_by_user_id` rationale:** In DMs, the creator and target are the
same user. In groups, the target is the group but we still need to track
who created the prompt — for listing ("show my prompts"), cancellation
(only creator can cancel), and audit logging.

### ChatProvider Interface Change

**Before:**

```typescript
sendMessage(userId: string, markdown: string): Promise<void>
```

**After:**

```typescript
sendMessage(target: DeliveryTarget, markdown: string): Promise<void>
```

### Chat Adapter Implementations

**Telegram:** No logic change. Grammy's `bot.api.sendMessage(chatId, ...)`
already accepts any chat ID (user, group, supergroup). Both DM and group
paths call `parseInt(contextId, 10)`.

**Mattermost:**

- DM: `getOrCreateDmChannel(contextId)` then post (unchanged)
- Group: post directly to `contextId` as `channel_id` — Mattermost groups
  already use channel IDs as `contextId`

**Discord:**

- DM: `client.users.fetch(contextId)` → `createDM()` → send (unchanged)
- Group: `client.channels.fetch(contextId)` → send to channel

**Thread handling:** Group prompts post as new top-level messages. No
thread targeting — proactive messages don't have a thread context to
reply into.

### Deferred Prompt Domain Types

```typescript
type ScheduledPrompt = {
  type: 'scheduled'
  id: string
  contextId: string // was userId
  contextType: ContextType // new
  createdByUserId: string // new
  prompt: string
  fireAt: string
  cronExpression: string | null
  status: 'active' | 'completed' | 'cancelled'
  createdAt: string
  lastExecutedAt: string | null
  executionMetadata: ExecutionMetadata
}

type AlertPrompt = {
  type: 'alert'
  id: string
  contextId: string // was userId
  contextType: ContextType // new
  createdByUserId: string // new
  prompt: string
  condition: AlertCondition
  status: 'active' | 'cancelled'
  createdAt: string
  lastTriggeredAt: string | null
  cooldownMinutes: number
  executionMetadata: ExecutionMetadata
}
```

### CRUD Function Signature Changes

All functions in `scheduled.ts` and `alerts.ts` change from `userId`
parameter to `contextId` + `contextType` + `createdByUserId` where
applicable:

- `createScheduledPrompt(contextId, contextType, createdByUserId, prompt, schedule, metadata?)`
- `listScheduledPrompts(contextId, status?, createdByUserId?)` — list by
  context; optional `createdByUserId` filter so users can list only their
  own prompts in a group, or omit to list all prompts in the context
- `getScheduledPrompt(id, contextId)` — context-scoped retrieval
- `cancelScheduledPrompt(id, createdByUserId)` — creator-scoped cancel
- `getScheduledPromptsDue()` — returns prompts with full target info

Same pattern for alert CRUD functions.

### Tool Handler Changes

Tool schemas (`create_deferred_prompt`, `update_deferred_prompt`) remain
unchanged — no user-facing parameter additions. The context comes from the
incoming message:

```typescript
function executeCreate(
  contextId: string,
  contextType: ContextType,
  createdByUserId: string,
  input: CreateInput,
): CreateResult
```

The tool execution wrapper already has access to `storageContextId` and
`contextType` from the message processing pipeline — these get threaded
through to the handler.

### Poller Changes

**Scheduled poll (`pollScheduledOnce`):**

- `getScheduledPromptsDue()` returns prompts with `contextId`,
  `contextType`, and `createdByUserId`
- Groups by `DeliveryTarget` (contextId + contextType) instead of userId
- Builds provider from `contextId` config (group's credentials in group
  context)
- Delivers via `chat.sendMessage({ contextId, contextType }, response)`

**Alert poll (`pollAlertsOnce`):**

- Same grouping by `DeliveryTarget`
- Task fetching uses group's provider config
- All alerts in the same group share one provider instance per poll cycle
- Delivers via `chat.sendMessage({ contextId, contextType }, response)`

### Execution Context Resolution

| Resource                  | DM                          | Group                                      |
| ------------------------- | --------------------------- | ------------------------------------------ |
| Config (LLM keys, tokens) | `getConfig(contextId, key)` | `getConfig(contextId, key)` — group config |
| Conversation history      | User's DM history           | Group's conversation history               |
| Facts/memory              | User's facts                | Group's facts                              |
| Task provider             | From user's config          | From group's config                        |

The project already uses `storageContextId` throughout `bot.ts` for
history and config, so this aligns naturally.

### Alert-Specific Details

**Task fetching:** The alert poller builds a task provider from the
group's config. All active alerts for a group share the same provider
instance, so tasks are fetched once per group per poll cycle.

**Snapshots:** Keyed by `contextId`. Multiple users' alerts in the same
group share the same snapshot pool. This is correct — same credentials
yield the same task data, so all alerts should see consistent state.

**Conditions (filters):** Stored per-alert-prompt. Each alert has its own
condition tree, evaluated independently against the shared task set and
snapshots.

**Cooldown:** Per-alert-prompt, not per-group. Two alerts in the same
group fire independently.

**Edge case:** If the group has no task tracker config, alert creation
with `full` mode fails at creation time with a clear error.

## Files Affected

| Layer                  | What Changes                                 | Files                                   |
| ---------------------- | -------------------------------------------- | --------------------------------------- |
| Types                  | New `DeliveryTarget` type                    | `src/chat/types.ts`                     |
| DB schema              | `user_id` → `context_id`, add columns        | `src/db/schema.ts`, new migration       |
| ChatProvider interface | `sendMessage(target, markdown)`              | `src/chat/types.ts`                     |
| Telegram adapter       | Update signature (logic unchanged)           | `src/chat/telegram/index.ts`            |
| Mattermost adapter     | Branch on `contextType`                      | `src/chat/mattermost/index.ts`          |
| Discord adapter        | Branch on `contextType`                      | `src/chat/discord/index.ts`             |
| Deferred prompt types  | Add context fields to domain types           | `src/deferred-prompts/types.ts`         |
| Scheduled CRUD         | `contextId`/`contextType` params             | `src/deferred-prompts/scheduled.ts`     |
| Alert CRUD             | Same                                         | `src/deferred-prompts/alerts.ts`        |
| Snapshots              | `userId` → `contextId`                       | `src/deferred-prompts/snapshots.ts`     |
| Tool handlers          | Receive context from message pipeline        | `src/deferred-prompts/tool-handlers.ts` |
| Poller                 | Group by target, build provider from context | `src/deferred-prompts/poller.ts`        |
| Execution pipeline     | Load config/history by `contextId`           | `src/deferred-prompts/proactive-llm.ts` |
| Announcements          | Wrap userId in DeliveryTarget                | `src/announcements.ts`                  |
| Tests                  | Update mocks/assertions                      | `tests/`                                |

## Not In Scope

- **Tool schema changes** — no user-facing parameter additions
- **Group config setup** — separate concern (how groups get their
  LLM keys / tracker tokens configured)
- **Mention/notification behavior** — handled naturally by LLM prompt
  content
- **Thread targeting for proactive messages** — group prompts post as
  top-level messages
