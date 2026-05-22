<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0055: Fix Cross-User Impersonation in Group Chats

## Status

Accepted

## Date

2025-01-21

## Context

In group chats, identity mapping was keyed on `storageContextId`, which resolves to a shared group/thread ID rather than the individual user. This meant that when one user in a group set their identity (e.g., "I'm jsmith"), subsequent identity lookups for any user in that group would resolve to the same mapping. A different user issuing "show my tasks" would see the first user's tasks.

The root cause: `makeTools` and the downstream `buildTools` function used `storageContextId` for both conversation-scoped data (history, memos, instructions) and identity-scoped data (identity mapping). In group chats, these two concerns must be separated — conversation data belongs to the group, but identity must be per-user.

## Decision Drivers

- **Security:** Cross-user impersonation is a HIGH severity issue — users could see or act on behalf of other users' task tracker identities
- **Backward compatibility:** DMs must continue to work identically (where `storageContextId` already equals the user ID)
- **Minimal blast radius:** The fix should thread a new parameter through existing interfaces rather than restructuring the tool system
- **No provider changes:** This is a bot-layer concern; providers should not need modification

## Considered Options

### Option 1: Thread `chatUserId` through the tool pipeline

Add a separate `chatUserId` field to `MakeToolsOptions`, thread it through `makeTools` → `buildTools` → identity tool factories. Keep `storageContextId` for conversation-scoped data.

- **Pros:** Minimal API surface change, clear separation of concerns, backward compatible
- **Cons:** Adds another parameter to thread through multiple call sites

### Option 2: Use a per-user identity context object

Create a `UserContext` object containing both `storageContextId` and `chatUserId`, pass this through the pipeline.

- **Pros:** Extensible for future per-user data
- **Cons:** Larger refactor, more files changed, over-engineered for the immediate fix

### Option 3: Key identity on `(storageContextId, chatUserId)` composite

Change the identity mapping table to use both fields as a composite key.

- **Pros:** No tool pipeline changes needed
- **Cons:** Couples storage layout to the bug workaround, doesn't fix the conceptual confusion at the tool layer

## Decision

Thread a separate `chatUserId` through the tool system (Option 1).

### Changes

| File                                    | Change                                                             |
| --------------------------------------- | ------------------------------------------------------------------ |
| `src/tools/types.ts`                    | Add `chatUserId?: string` to `MakeToolsOptions`                    |
| `src/tools/index.ts`                    | Extract `chatUserId` from options, fall back to `storageContextId` |
| `src/tools/tools-builder.ts`            | Rename first parameter to `chatUserId`, pass to identity tools     |
| `src/tools/set-my-identity.ts`          | Use `chatUserId` for identity mapping key                          |
| `src/tools/clear-my-identity.ts`        | Use `chatUserId` for identity mapping key                          |
| `src/llm-orchestrator.ts`               | Accept and forward `chatUserId` to `makeTools`                     |
| `src/deferred-prompts/proactive-llm.ts` | Pass `userId` as both `storageContextId` and `chatUserId`          |
| `src/bot.ts`                            | Pass `msg.user.id` as `chatUserId` to `processMessage`             |

### Backward Compatibility

- **DMs:** `chatUserId` falls back to `storageContextId` — identical behavior
- **Groups:** `chatUserId` is the actual user ID, `storageContextId` remains the group ID

## Consequences

### Positive

- Identity mappings are isolated per-user even in shared group contexts
- Clear naming distinction between `chatUserId` (who is speaking) and `storageContextId` (where data is stored)
- No provider-level changes required

### Negative

- Additional parameter threaded through orchestrator, bot, and tool layers
- Tool cache is keyed on `storageContextId` only — tools are rebuilt per-context, not per-user within a context (acceptable because identity tools capture `chatUserId` at construction time via closure)

## Implementation Status

**Implemented.** Verified in the codebase:

- `MakeToolsOptions` in `src/tools/types.ts` includes `chatUserId`
- `makeTools` in `src/tools/index.ts` extracts `chatUserId` with fallback to `storageContextId`
- `buildTools` in `src/tools/tools-builder.ts` accepts `chatUserId` as first parameter
- Identity tools (`set-my-identity.ts`, `clear-my-identity.ts`) receive and use `chatUserId`
- `processMessage` in `src/llm-orchestrator.ts` accepts and forwards `chatUserId`
- `BotDeps.processMessage` in `src/bot.ts` includes `chatUserId` parameter
- `proactive-llm.ts` passes `userId` as both `storageContextId` and `chatUserId`

## Related Decisions

- [ADR-0018: Group Chat Support](0018-group-chat-support.md) — introduced the group context that created this vulnerability
- [User Identity Mapping Design](../superpowers/specs/2026-04-10-user-identity-mapping-design.md) — broader identity mapping system design
