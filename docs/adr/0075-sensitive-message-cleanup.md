<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0075: Sensitive Message Cleanup During Setup/Config

## Status

Implemented

## Date

2026-04-18

## Context

When users enter API keys and tokens during `/setup` or `/config` flows, plaintext values appear as regular chat messages and the bot echoes them back in confirmation replies. This creates security concerns:

1. **Plaintext persistence**: API keys (`kaneo_apikey`, `youtrack_token`, `llm_apikey`) persist in chat history on all platforms
2. **Double exposure**: The bot echoes the raw value in confirmation messages, creating a second copy of the secret
3. **Platform asymmetry**: Different chat platforms have different capabilities for message deletion:
   - **Mattermost**: Bot can delete user posts in DMs via `DELETE /api/v4/posts/{post_id}`
   - **Telegram**: Bot API does not allow deleting user messages in private chats
   - **Discord**: Bot API does not allow deleting user messages in DMs

The team needed a cross-platform solution that maximizes security where possible while gracefully degrading on platforms with limitations.

## Decision Drivers

- **Must delete user messages containing secrets** on platforms that support it
- **Must warn users to manually delete messages** on platforms that don't support bot-initiated deletion
- **Must never echo raw sensitive values** in bot confirmation messages
- **Should show upfront warning** at the start of `/setup` or `/config` when the platform lacks deletion support
- **Should minimize user friction** — automatic deletion is preferred over manual action
- **Must be capability-driven** rather than platform-name-driven to support future adapters

## Considered Options

### Option 1: Platform-Specific Branching

Hard-code behavior per platform name (e.g., `if (platform === 'mattermost') ...`).

- **Pros**: Simple to implement, explicit per-platform logic
- **Cons**: Violates capability-based architecture, doesn't scale to new adapters, scatters platform knowledge throughout codebase

### Option 2: Capability-Based Message Deletion (Selected)

Add a `messages.delete` capability and `deleteMessage` method to the chat layer. Integration layers attempt deletion or append warnings based on capability detection.

- **Pros**: Consistent with existing capability architecture, adapts to new platforms automatically, maintains clean separation of concerns
- **Cons**: Requires extending multiple result types and handler signatures, more files touched

### Option 3: Modal/Dialog Input Collection

Use Discord Modals, Mattermost Interactive Dialogs, or Telegram Mini Apps for secure input collection.

- **Pros**: Most secure — secrets never appear in chat history, native platform UI
- **Cons**: Complex multi-platform implementation, significant scope increase, not all platforms support this equally

### Option 4: External Secure Storage Integration

Integrate with a secrets manager (e.g., HashiCorp Vault, AWS Secrets Manager) for config storage.

- **Pros**: Enterprise-grade secret management, audit trails, rotation support
- **Cons**: Massive infrastructure change, out of scope for this security improvement, adds operational complexity

## Decision

We will implement **Option 2: Capability-Based Message Deletion**.

The solution extends the existing capability system with:

1. **New capability**: `messages.delete` — declared by Mattermost, absent from Telegram and Discord
2. **New ReplyFn method**: `deleteMessage(messageId: string): Promise<void>` — only available when capability is present
3. **New helper**: `isSensitiveKey()` exported from `config.ts` to check if a config key is sensitive
4. **Result type extensions**: `isSensitiveKey?: boolean` flag added to `EditorProcessResult` and `WizardProcessResult`
5. **Masked confirmations**: Bot replies mask sensitive values using `maskValue()` instead of echoing raw text
6. **Integration layer coordination**: Both `config-editor-integration.ts` and `wizard-integration.ts` handle the delete-or-warn logic
7. **Upfront warnings**: `/setup` and `/config` commands warn users on non-deleting platforms before input begins

## Rationale

This approach was selected because:

1. **Leverages existing patterns**: The capability system (introduced in ADR-0058) already handles platform feature variance
2. **Minimal user friction**: Automatic deletion where supported; clear guidance where not
3. **Defense in depth**: Even on non-deleting platforms, secrets are masked in bot replies
4. **Scalable**: Future adapters automatically get correct behavior by declaring or omitting the capability
5. **Implementation scope is bounded**: ~400 lines of changes across existing modules, no new dependencies

## Consequences

### Positive

- **Reduced secret exposure**: Messages containing API keys are deleted on Mattermost
- **Clear user guidance**: Users on Telegram/Discord know to manually delete messages
- **Consistent security model**: Same patterns apply to config editor and wizard flows
- **Capability-driven**: No platform-name hardcoding, supports future adapters
- **Masked confirmations**: Even if a message is missed, the bot reply doesn't expose the secret

### Negative

- **User confusion**: Telegram/Discord users may not notice the warning or remember to delete
- **Best-effort deletion**: Failures are logged but not surfaced to users (to avoid disrupting flow)
- **No audit trail**: Deleted messages are gone from Mattermost with no recovery option
- **Wider API surface**: `messageId` parameter must be passed through more layers

### Risks

- **Silent deletion failures**: Network issues could leave secrets in chat without user awareness
  - **Mitigation**: Log failures at `warn` level; deletion is fire-and-forget but observable in logs
- **Message ID absence**: Some adapters may not populate `messageId` in edge cases
  - **Mitigation**: Delete is conditional on both capability AND messageId presence
- **Race conditions**: User sends multiple messages before bot processes
  - **Mitigation**: Only the specific message containing the secret is targeted for deletion

## Implementation Evidence

Verified in codebase (as of implementation completion):

1. **`src/chat/types.ts`**: `ChatCapability` union includes `'messages.delete'`; `ReplyFn` partial includes `deleteMessage`
2. **`src/chat/capabilities.ts`**: `supportsMessageDeletion()` helper exported
3. **`src/config.ts`**: `isSensitiveKey()` function exported; `SENSITIVE_KEYS` set defined
4. **`src/config-editor/types.ts`**: `EditorProcessResult` includes `isSensitiveKey?: boolean`
5. **`src/wizard/types.ts`**: `WizardProcessResult` includes `isSensitiveKey?: boolean`
6. **`src/chat/mattermost/metadata.ts`**: Declares `'messages.delete'` capability
7. **`src/chat/mattermost/reply-helpers.ts`**: Implements `deleteMessage` using `DELETE /api/v4/posts/{post_id}`
8. **`src/config-editor/handlers.ts`**: Masks sensitive values in confirmation; sets `isSensitiveKey` flag
9. **`src/wizard/engine.ts`**: Sets `isSensitiveKey` flag based on completed step key
10. **`src/chat/config-editor-integration.ts`**: Deletes messages or appends warnings for sensitive config edits
11. **`src/wizard-integration.ts`**: Deletes messages or appends warnings for sensitive wizard steps
12. **`src/commands/setup.ts`**: Sends upfront warning when `!supportsMessageDeletion(chat)`
13. **`src/commands/config.ts`**: Sends upfront warning when `!supportsMessageDeletion(chat)`
14. **`tests/`**: Unit tests cover `isSensitiveKey()`, config-editor masking, wizard flag setting, and integration layer delete/warn behavior

## Related Decisions

- **ADR-0058**: Provider Capability Architecture — established the capability system used here
- **ADR-0042**: Bot Configuration Wizard UX — the wizard flow that benefits from this protection
- **ADR-0069**: DM-Only Group Settings — related to `/setup` and `/config` command flows

## References

- Implementation Plan: `docs/archive/2026-04-18-sensitive-message-cleanup-plan.md`
- Design Spec: `docs/archive/2026-04-18-sensitive-message-cleanup-design.md`
- Mattermost API: [Delete Post](https://api.mattermost.com/#tag/posts/operation/DeletePost)
- Telegram Bot API: [deleteMessage limitations](https://core.telegram.org/bots/api#deletemessage) (bot can only delete its own messages in private chats)
- Discord.js: [Message.delete()](https://discord.js.org/#/docs/discord.js/main/class/Message?scrollTo=delete) (bots cannot delete other users' DMs)
