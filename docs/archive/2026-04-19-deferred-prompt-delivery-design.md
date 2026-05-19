# Deferred Prompt Delivery Design

**Date:** 2026-04-19
**Status:** Proposed

## Problem

Deferred prompts are modeled and delivered as if they are always DM-bound.

Today, both scheduled prompts and alerts are created with creator-centric identifiers, executed with DM-scoped context, and delivered through a chat-provider surface shaped like `sendMessage(userId, markdown)`. This causes wrong behavior in Telegram groups today, and the same architectural gap exists for alerts and for non-Telegram providers.

The core design problem is not only routing. The system currently loses the original conversational destination and has no explicit model for whether a deferred prompt is personal or shared.

## Goals

- Make deferred prompts fire back into the same conversational context where they were created by default.
- Support the same conceptual behavior for scheduled prompts and alerts.
- Support the same conceptual behavior across Telegram, Mattermost, and Discord.
- Distinguish personal group deliveries from shared group deliveries.
- Decide mention targets at creation time, not at fire time.
- Keep provider-specific rendering in chat adapters instead of embedding it in deferred-prompt business logic.

## Non-Goals

- Redesign unrelated proactive systems such as version announcements or recurring-task notifications in this phase.
- Re-run LLM audience classification at fire time.
- Force identical mention syntax across providers.
- Add new user-facing tool parameters for delivery targeting unless implementation proves they are necessary.

## Approved Scope

The approved scope from brainstorming is:

1. Deferred prompts created in a DM or group should fire into the same context by default.
2. Deferred prompts created inside a thread/topic should stay in that thread/topic when the platform supports it.
3. Group deliveries should mention users only when the prompt is personal.
4. Scheduled prompts and alerts should share the same delivery model.
5. Telegram, Mattermost, and Discord should follow the same delivery semantics, with platform-specific rendering only at the adapter boundary.
6. Mention decisions should be made at creation time.
7. Mention targets should be chosen by the LLM/tool creation flow and stored with the deferred prompt.

## Key Decisions

### 1. Unified Deferred Delivery Contract

Both scheduled prompts and alerts will use one shared delivery contract.

This contract describes:

- where the deferred prompt fires
- whether the delivery is personal or shared
- who should be mentioned, if anyone
- who created and owns the deferred prompt

### 2. Creation-Time Audience Classification

Audience classification is authoritative at creation time.

When a deferred prompt is created in a group context, the LLM/tool creation flow decides whether the prompt is:

- `personal`
- `shared`

If the prompt is personal, the creation flow also decides which users should be mentioned and stores those targets with the deferred prompt.

The fire-time execution path does not re-decide audience or mention targets.

### 3. Same-Context Delivery by Default

Default delivery target is the current message context at creation time:

- DM-created prompt -> DM delivery
- group-created prompt -> same group/channel delivery
- thread-created prompt -> same thread/topic delivery when supported

### 4. Provider-Specific Mention Rendering

Business logic decides who should be mentioned.
Chat adapters decide how those mentions are rendered.

Expected provider behavior:

- Telegram: mention by user ID in Telegram-native formatted output
- Discord: mention by user ID in channel messages
- Mattermost: mention by username when available; otherwise fall back to visible non-notifying attribution

## Data Model

Introduce a shared deferred delivery shape used by both scheduled prompts and alerts.

```typescript
type DeferredAudience = 'personal' | 'shared'

type DeferredDeliveryTarget = {
  contextId: string
  contextType: 'dm' | 'group'
  threadId?: string
  audience: DeferredAudience
  mentionUserIds: string[]
  createdByUserId: string
  createdByUsername?: string | null
}
```

Attach this contract to both deferred prompt types.

### Scheduled Prompt

```typescript
type ScheduledPrompt = {
  type: 'scheduled'
  id: string
  createdByUserId: string
  createdByUsername: string | null
  deliveryTarget: DeferredDeliveryTarget
  prompt: string
  fireAt: string
  cronExpression: string | null
  status: 'active' | 'completed' | 'cancelled'
  createdAt: string
  lastExecutedAt: string | null
  executionMetadata: ExecutionMetadata
}
```

### Alert Prompt

```typescript
type AlertPrompt = {
  type: 'alert'
  id: string
  createdByUserId: string
  createdByUsername: string | null
  deliveryTarget: DeferredDeliveryTarget
  prompt: string
  condition: AlertCondition
  status: 'active' | 'cancelled'
  createdAt: string
  lastTriggeredAt: string | null
  cooldownMinutes: number
  executionMetadata: ExecutionMetadata
}
```

## Database Design

Both `scheduled_prompts` and `alert_prompts` should store explicit delivery fields.

Recommended persisted columns:

- `delivery_context_id`
- `delivery_context_type`
- `delivery_thread_id`
- `created_by_user_id`
- `created_by_username`
- `audience`
- `mention_user_ids` as JSON text

### Deprecated Field Policy

Legacy creator-centric fields that previously doubled as delivery fields must be treated as deprecated transition-era fields.

Rules:

- new code must not use legacy `userId`-style fields as delivery fields
- delivery behavior must always read from the explicit delivery contract
- legacy names that encode old DM-only assumptions must be renamed during this redesign to explicit creator fields
- if a transitional compatibility layer is temporarily required, it must be clearly marked deprecated in code and design

Preferred end state:

- creator fields describe ownership and config resolution
- delivery fields describe outbound destination and mention policy
- no ambiguous field remains that could mean both creator and delivery target

### Migration Direction

Preferred migration shape:

- rename legacy ownership fields to explicit creator fields in this redesign
- add explicit delivery fields
- backfill delivery target for existing records to preserve current DM behavior

Backfill behavior for existing records:

- `delivery_context_id = created_by_user_id`
- `delivery_context_type = 'dm'`
- `delivery_thread_id = null`
- `audience = 'personal'`
- `mention_user_ids = []`

This preserves old runtime behavior for existing data while moving the schema to the new, explicit model.

## Delivery Architecture

The delivery pipeline for both scheduled prompts and alerts becomes:

1. User creates a deferred prompt in a DM, group, or thread.
2. Tool creation flow captures current delivery context.
3. LLM/tool creation flow decides:
   - audience: `personal` or `shared`
   - mention targets, if any
4. Deferred prompt is stored with explicit delivery target and creator metadata.
5. Poller or alert runner executes the prompt using stored context.
6. Chat adapter sends to the stored destination.
7. Chat adapter renders mentions in platform-native syntax.

Important invariant:

- creation-time inference is authoritative
- fire-time execution may use stored context for tools and history
- fire-time execution must not reclassify audience or regenerate mention targets

## Chat Provider Interface

The chat-provider proactive send surface should stop being DM-specific.

Current shape:

```typescript
sendMessage(userId: string, markdown: string): Promise<void>
```

Target shape:

```typescript
sendMessage(target: DeferredDeliveryTarget, markdown: string): Promise<void>
```

This contract is broader than deferred prompts and may later be reused by other proactive systems, but this design only requires deferred prompt adoption in this phase.

## Provider Behavior

### Telegram

- Supports DM and group delivery.
- Supports thread/topic delivery.
- Supports user mentions.
- Group personal deliveries mention stored targets.
- Group shared deliveries do not mention anyone.

### Mattermost

- Supports DM and channel delivery.
- Supports thread delivery.
- Mentions should prefer stored/known usernames.
- If username resolution is unavailable, use visible attribution text instead of failing delivery.

### Discord

- Supports DM and channel delivery.
- Current project code reports no thread-scoped support, so deferred delivery remains channel-level there for now.
- Personal group deliveries mention stored targets by user ID.
- Shared group deliveries remain plain channel posts.

## Execution Context Resolution

Deferred prompts need two distinct identities at fire time:

1. Creator identity

- used for config lookup
- used for ownership checks
- used for list/update/cancel permissions

2. Delivery context

- used for conversation history and group context
- used for tool context where same-context behavior matters
- used for outbound delivery destination

The system should therefore resolve resources as follows:

| Resource                              | Source                                                        |
| ------------------------------------- | ------------------------------------------------------------- |
| LLM and task-provider config          | `createdByUserId`                                             |
| Access control for manage/edit/cancel | `createdByUserId`                                             |
| Conversation history                  | `deliveryTarget.contextId` plus thread context when available |
| Tool context for proactive execution  | `deliveryTarget`                                              |
| Mention targets                       | `deliveryTarget.mentionUserIds`                               |
| Final outbound send                   | `deliveryTarget`                                              |

This preserves creator-owned configuration while making execution and delivery context-aware.

## Prompt-Type Behavior

### Scheduled Prompts

Scheduled prompts should:

- store delivery target at creation
- execute in stored context
- deliver to stored destination
- group poller work by creator/config context plus delivery target, not just by creator ID

This avoids incorrect merging of:

- DM and group prompts from the same creator
- prompts targeting different groups or threads
- prompts with different mention policies

### Alerts

Alerts should use the same delivery contract as scheduled prompts.

Alert-specific rules:

- task fetching still uses creator-owned config
- alert conditions remain per-alert
- cooldown remains per-alert
- delivery and mention policy come from stored delivery target

This means an alert created in a group behaves like a group alert, not like a DM alert created by the same user.

## Backward Compatibility

Backward compatibility is limited to data migration and transitional read-path safety.

Rules:

- existing deferred prompts must continue to behave as DM deliveries after migration
- legacy field semantics are deprecated and must not be used for new delivery logic
- new writes must use the explicit delivery contract only
- any temporary compatibility reads should be isolated and documented for later removal

This design does not preserve the old schema shape as a long-term API contract.

## Testing Requirements

Tests should validate behavior and policy, not only data plumbing.

Required coverage:

- scheduled prompt created in Telegram group fires in same group/topic
- alert created in Telegram group fires in same group/topic
- Discord group-created deferred prompt fires in same channel
- Mattermost group-created deferred prompt fires in same channel/thread
- personal group prompt mentions stored targets
- shared group prompt does not mention anyone
- migrated legacy deferred prompts still fire to DM
- list/update/cancel permissions still follow creator identity
- prompts with same creator but different delivery targets are not merged incorrectly in pollers
- provider adapters are tested at the formatting boundary for mention rendering

## Operational Constraints

- Mention targets are chosen at creation time and stored.
- Delivery should not fail just because one provider cannot render a strong mention in the same way as another provider.
- Mattermost may need a graceful fallback when username-based mention rendering is not possible.
- Discord remains channel-level for deferred deliveries until the project adds explicit thread support there.

## Files Expected to Change

- `src/chat/types.ts`
- `src/chat/telegram/index.ts`
- `src/chat/mattermost/index.ts`
- `src/chat/discord/index.ts`
- `src/db/schema.ts`
- new migration under `src/db/migrations/`
- `src/deferred-prompts/types.ts`
- `src/deferred-prompts/scheduled.ts`
- `src/deferred-prompts/alerts.ts`
- `src/deferred-prompts/tool-handlers.ts`
- `src/deferred-prompts/poller.ts`
- `src/deferred-prompts/proactive-llm.ts`
- deferred-prompt tests under `tests/deferred-prompts/`
- chat-provider and helper tests affected by proactive sends

## Why This Design

This design solves the current Telegram group reminder bug by fixing the actual architectural issue instead of patching one delivery path.

It gives the system:

- explicit delivery semantics
- explicit creator semantics
- explicit personal vs shared audience policy
- consistent cross-provider behavior
- deterministic mention behavior chosen once and stored

That is the smallest coherent design that addresses scheduled prompts, alerts, and provider consistency together.
