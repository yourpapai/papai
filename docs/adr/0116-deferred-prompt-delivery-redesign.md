# ADR-0116: Deferred Prompt Delivery Redesign

## Status

Accepted

## Context

ADR-0030 introduced the unified deferred-prompts system with `scheduled_prompts` and `alert_prompts` tables. At that time, both tables used a single `user_id` column that served dual duty as both the creator identity and the delivery target. The proactive send surface on `ChatProvider` was `sendMessage(userId: string, markdown: string): Promise<void>` — meaning every deferred prompt was delivered to a user DM regardless of where it was created.

This became a problem when group chat support (ADR-0018, ADR-0059) expanded. Users creating deferred prompts inside Telegram groups, Mattermost channels, or Discord channels saw those prompts fire into their personal DMs instead of the originating group thread or channel. The system had no way to remember the original conversational context, and no concept of whether a prompt was personal or meant to be shared with the whole group.

Additionally, the existing architecture conflated two concerns that needed to be separated:

1. **Creator identity**: drives config lookup (LLM API keys, model preferences, timezone), ownership checks, and access control for list/update/cancel.
2. **Delivery context**: drives outbound routing, conversation history, tool context, and mention policy.

When these are the same (DM-created prompt), the conflation is harmless. When they differ (group-created prompt), it leads to wrong-context delivery, broken tool routing, and missing mention behavior.

## Decision Drivers

- **Same-context delivery**: Prompts created in a group should fire back into that group by default.
- **Thread preservation**: Prompts created inside a thread/topic should stay in that thread when the platform supports it.
- **Personal vs shared**: A personal reminder inside a group should mention only the creator; a shared alert should be visible to everyone without a mention.
- **Cross-provider consistency**: Telegram, Mattermost, and Discord should follow the same semantics, with only rendering differing.
- **Creation-time authority**: Mention targets and audience classification must be decided at creation time and stored immutably; fire-time must not reclassify.
- **Separation of concerns**: Creator config and delivery destination must be independent.

## Considered Options

### Option 1: Patch the existing DM-only flow

Add ad-hoc group-ID capture in tool handlers and pass it through pollers as an optional override.

- **Pros**: Minimal schema change, quick to implement.
- **Cons**: Does not fix the architectural conflation of creator and delivery; mention behavior remains undefined; future proactive systems would repeat the same problem.
- **Verdict**: Rejected — patches the symptom, not the design flaw.

### Option 2: Separate creator-only and delivery-only columns without renaming

Keep `user_id` as-is, add `delivery_context_id` as a new column.

- **Pros**: Small migration; preserves existing semantics.
- **Cons**: Leaves the ambiguous `user_id` meaning "maybe creator, maybe delivery" — exactly the dual-duty problem the spec intended to solve.
- **Verdict**: Rejected — violates the explicit design goal of removing conflated fields.

### Option 3: Full redesign with explicit creator fields and delivery columns

Rename `user_id` → `created_by_user_id`, add explicit delivery columns, introduce a shared `DeferredDeliveryTarget` contract, and update the `ChatProvider.sendMessage` surface.

- **Pros**: Clear separation, reusable contract for future proactive systems, deterministic behavior, cross-provider consistency.
- **Cons**: Larger migration; all CRUD and poller logic must change; all provider adapters must implement the new contract.
- **Verdict**: Accepted — addresses the root cause and provides a stable contract going forward.

## Decision

We will redesign the deferred prompt delivery model with an explicit creator-vs-delivery separation and a unified delivery contract shared by scheduled prompts and alerts.

### 1. Unified Deferred Delivery Contract

Introduce a shared type used by both deferred prompt types, the chat provider interface, and the tool creation flow:

```typescript
type DeferredAudience = 'personal' | 'shared'

type DeferredDeliveryTarget = {
  contextId: string
  contextType: 'dm' | 'group'
  threadId: string | null
  audience: DeferredAudience
  mentionUserIds: string[]
  createdByUserId: string
  createdByUsername: string | null
}
```

This contract is attached to both `ScheduledPrompt` and `AlertPrompt` domain types as `deliveryTarget`.

### 2. Database Migration

Rename legacy `user_id` columns to `created_by_user_id` and add explicit delivery columns to both `scheduled_prompts` and `alert_prompts`:

- `created_by_user_id`
- `created_by_username`
- `delivery_context_id`
- `delivery_context_type`
- `delivery_thread_id`
- `audience`
- `mention_user_ids` (JSON text)

The migration drops indexes on the old `user_id` column and creates new indexes on `created_by_user_id`.

### 3. Chat Provider Interface

Change `ChatProvider.sendMessage` from:

```typescript
sendMessage(userId: string, markdown: string): Promise<void>
```

to:

```typescript
sendMessage(target: DeferredDeliveryTarget, markdown: string): Promise<void>
```

All three providers implement this contract:

- **Telegram**: DM, group, and topic delivery; native `text_mention` entities for personal audience.
- **Mattermost**: DM, channel, and thread (root-id) delivery; username-based mention prefix for personal audience.
- **Discord**: DM and channel delivery; `<@id>` mention prefix for personal audience; no thread delivery (current project limitation).

### 4. Creation-Time Audience Classification

When a deferred prompt is created in a group context, the tool creation flow decides:

- `audience`: `personal` or `shared`
- `mentionUserIds`: users to mention (for `personal` only; empty for `shared`)

These values are stored with the deferred prompt and are authoritative at fire time. The poller and LLM execution layer never re-decide audience or mention targets.

### 5. Execution Context Resolution

At fire time, resources are resolved independently:

| Resource                             | Source                              |
| ------------------------------------ | ----------------------------------- |
| LLM config, task-provider config     | `createdByUserId`                   |
| Access control (list/update/cancel)  | `createdByUserId`                   |
| Conversation history                 | `deliveryTarget.contextId` + thread |
| Tool context (`makeTools` arguments) | `deliveryTarget`                    |
| Mention targets                      | `deliveryTarget.mentionUserIds`     |
| Final outbound send                  | `deliveryTarget`                    |

### 6. Poller Grouping

Prompts are grouped by delivery key (`createdByUserId + contextId + contextType + threadId + audience + mentionUserIds`), not by creator alone. This prevents incorrect merging of:

- DM and group prompts from the same creator
- Prompts targeting different groups or threads
- Prompts with different mention policies

## Implementation

### Key Files Changed

- `src/chat/deferred-target.ts` — new shared delivery types (`DeferredAudience`, `DeferredDeliveryTarget`)
- `src/chat/types.ts` — `ChatProvider.sendMessage` updated to accept `DeferredDeliveryTarget`
- `src/db/migrations/025_deferred_prompt_delivery_targets.ts` — renames `user_id` and adds delivery columns
- `src/db/deferred-schema.ts` — updated schema definitions with creator and delivery fields
- `src/deferred-prompts/types.ts` — `DeferredPromptDelivery`, `DeferredPromptDeliveryInput`, `deliveryPolicySchema`
- `src/deferred-prompts/scheduled.ts` — CRUD with explicit `createdByUserId` and `deliveryTarget`
- `src/deferred-prompts/alerts.ts` — CRUD with explicit `createdByUserId` and `deliveryTarget`
- `src/deferred-prompts/tool-handlers.ts` — `buildDeliveryInput`, `executeCreate` with creation context
- `src/deferred-prompts/poller.ts` — grouping by delivery target, sending to stored target
- `src/deferred-prompts/poller-groups.ts` — delivery-key grouping function
- `src/deferred-prompts/proactive-llm.ts` — `DeferredExecutionContext` (creator + delivery), full tool/history routing
- `src/tools/create-deferred-prompt.ts` — tool schema includes `delivery`; passes context to handlers
- `src/chat/telegram/reply-helpers.ts` — `buildTelegramMentionPrefix` with `text_mention` entities
- `src/chat/mattermost/index.ts` — DM/channel/thread branching with mention prefix
- `src/chat/discord/send-message.ts` — DM/channel branching with `<@id>` mentions

### Condition Schema for Tool Delivery Input

```typescript
const deliveryPolicySchema = z
  .object({
    audience: z.enum(['personal', 'shared']),
    mention_user_ids: z.array(z.string()),
  })
  .optional()
```

Omitting `delivery` in a DM context defaults to DM delivery. In a group context, the LLM must explicitly choose.

## Consequences

### Positive

- Deferred prompts fire back into the original group/channel/thread by default.
- Personal and shared semantics are explicit, deterministic, and stored at creation time.
- Mention behavior is chosen once and rendered per-provider at fire time.
- The `DeferredDeliveryTarget` contract is reusable by future proactive systems.
- Creator-owned config no longer incorrectly forces DM-scoped tool context.

### Negative

- Migration renames columns and drops legacy indexes; requires fresh test DB.
- All three provider adapters had to be updated simultaneously.
- Consumer code that previously assumed a `string` user ID for `sendMessage` had to migrate.
- Alerts still group by `createdByUserId` for task-fetching efficiency (multiple alerts for same creator share one task fetch), but execute individually to their stored delivery targets.

### Mitigations

- Migration is additive/rename-only; existing records fall back to DM behavior via code-level defaults.
- The `DeferredDeliveryTarget` contract is simple enough to adopt for new proactive features.
- Test helpers (`createMockChatWithSentMessages`) were updated to capture structured target metadata, not just user IDs.

## Related Decisions

- [ADR-0018: Group Chat Support](0018-group-chat-support.md) — provider abstraction enabling group contexts
- [ADR-0030: Deferred Prompts System](0030-deferred-prompts-system.md) — original deferred prompt abstraction; delivery was DM-only
- [ADR-0059: Thread-Aware Group Chat](0059-thread-aware-group-chat.md) — thread-scoped storage context enabling topic-level delivery
- [ADR-0060: User Identity Mapping](0060-user-identity-mapping.md) — needed for correct mention target resolution across providers

## Migration Notes

Migration `025` renames `user_id` → `created_by_user_id` in both deferred prompt tables and adds 7 new delivery columns. Existing records are backward-compatible: the CRUD mappers fall back to DM delivery when delivery columns are null, and a `dmTarget(userId)` helper provides the default shape.

## References

- Design spec: `docs/superpowers/specs/2026-04-19-deferred-prompt-delivery-design.md`
- Implementation plan: `docs/superpowers/plans/2026-04-19-deferred-prompt-delivery-implementation.md`
