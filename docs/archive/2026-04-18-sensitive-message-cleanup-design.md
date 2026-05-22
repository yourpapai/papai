<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Sensitive Message Cleanup During Setup/Config

**Date:** 2026-04-18
**Status:** Proposed
**Scope:** Auto-delete or warn about user messages containing sensitive data during `/setup` and `/config` flows.

## Summary

When users enter API keys and tokens during `/setup` or `/config`, plaintext values appear as regular chat messages and the bot echoes them back in confirmation replies. This design adds platform-aware message deletion where possible, redacts sensitive values in bot replies, and warns users on platforms where automatic deletion is not supported.

## Motivation

Users paste API keys (`kaneo_apikey`, `youtrack_token`, `llm_apikey`) into chat during setup. These values persist in chat history on all platforms. The bot currently echoes the raw value back in its confirmation message (e.g. `New value: \`sk-abc123...\``), creating a second copy of the secret in chat.

Platform constraints vary:

- **Mattermost**: Bot can delete user posts in DMs via `DELETE /api/v4/posts/{post_id}`.
- **Telegram**: Bot API does not allow deleting user messages in private chats.
- **Discord**: Bot API does not allow deleting user messages in DMs.

The design must handle all three platforms appropriately.

## Goals

- Delete user messages containing sensitive values on platforms that support it (Mattermost).
- Warn users to manually delete their messages on platforms that do not support bot-initiated deletion (Telegram, Discord).
- Never echo raw sensitive values in bot confirmation messages.
- Show an upfront warning at the start of `/setup` or `/config` when the platform lacks deletion support.
- Show a per-field reminder after each sensitive value is entered on non-deleting platforms.

## Non-Goals

- Implement modal/dialog input collection (Discord Modals, Mattermost Interactive Dialogs, Telegram Mini Apps). This is a future improvement.
- Encrypt or otherwise protect config values at rest.
- Change how config values are stored or transmitted to the task provider.
- Handle sensitive data in non-setup/config flows (e.g. tool calls that might return secrets).

## Architecture

### New capability: `messages.delete`

Add `'messages.delete'` to the `ChatCapability` union in `src/chat/types.ts`.

Only the Mattermost adapter declares this capability. Telegram and Discord cannot delete user messages in DMs, so they do not declare it.

### New `ReplyFn` method: `deleteMessage`

Add an optional `deleteMessage(messageId: string): Promise<void>` method to `ReplyFn`. This is capability-gated like `redactMessage` — only present when the adapter supports `'messages.delete'`.

The method deletes a message by its platform-specific `messageId`. It is fire-and-forget: failures are logged but do not disrupt the setup flow.

### New exported helper: `isSensitiveKey`

Export a function from `src/config.ts` that checks whether a config key is in the existing `SENSITIVE_KEYS` set:

```typescript
export function isSensitiveKey(key: ConfigKey): boolean {
  return SENSITIVE_KEYS.has(key)
}
```

### Result type extensions

Add an `isSensitiveKey: boolean` field to:

- `EditorProcessResult` in `src/config-editor/types.ts`
- `WizardProcessResult` in `src/wizard/types.ts`

Both handlers set this flag when the key being processed is sensitive.

### Redact bot confirmation messages

**Config editor** (`src/config-editor/handlers.ts`): Replace the raw value echo at line 249 with `maskValue()`:

```
Before: New value: `${text.trim()}`
After:  New value: `****${last4}`
```

**Wizard** (`src/wizard/engine.ts`): The existing `getNextPrompt` already uses `maskValue()` for existing values. No change needed there.

### Delete or warn after sensitive input

The integration layers (`src/chat/config-editor-integration.ts` and `src/wizard-integration.ts`) are the coordination points. After a sensitive value is handled:

1. If `reply.deleteMessage` is available, call it with `msg.messageId` to delete the user's message.
2. If `reply.deleteMessage` is not available, append a per-field warning to the bot's reply: `"Remember to delete your previous message containing the secret value."`

The delete/warn logic needs access to `msg.messageId` and the `isSensitiveKey` flag from the result. The integration functions currently receive `text` and `reply` but not `messageId`. They need an additional `messageId` parameter.

### Upfront warning at flow start

When `/setup` or `/config` starts and the active platform does NOT support `'messages.delete'`, the handler sends a one-time warning before the wizard or config editor begins:

> "This platform does not support automatic deletion of messages containing secrets. Please manually delete your messages after entering API keys and tokens."

This check uses `supportsCapability(chat, 'messages.delete')` from the capabilities helper.

## Files Changed

| File                                    | Change                                                                                  |
| --------------------------------------- | --------------------------------------------------------------------------------------- |
| `src/chat/types.ts`                     | Add `'messages.delete'` to `ChatCapability`; add `deleteMessage` to `ReplyFn` partial   |
| `src/chat/capabilities.ts`              | Add `supportsDelete()` helper                                                           |
| `src/config.ts`                         | Export `isSensitiveKey()`                                                               |
| `src/config-editor/types.ts`            | Add `isSensitiveKey: boolean` to `EditorProcessResult`                                  |
| `src/config-editor/handlers.ts`         | Redact raw value in confirmation message using `maskValue()`; set `isSensitiveKey` flag |
| `src/wizard/types.ts`                   | Add `isSensitiveKey: boolean` to `WizardProcessResult`                                  |
| `src/wizard/engine.ts`                  | Set `isSensitiveKey` flag on result when step key is sensitive                          |
| `src/chat/config-editor-integration.ts` | Accept `messageId` param; delete or warn after sensitive input                          |
| `src/wizard-integration.ts`             | Accept `messageId` param; delete or warn after sensitive input                          |
| `src/bot.ts`                            | Pass `msg.messageId` to integration functions; call upfront warning helper              |
| `src/commands/setup.ts`                 | Add upfront warning when platform lacks `'messages.delete'`                             |
| `src/commands/config.ts`                | Add upfront warning when platform lacks `'messages.delete'`                             |
| `src/chat/mattermost/index.ts`          | Implement `deleteMessage` on ReplyFn                                                    |
| `src/chat/mattermost/metadata.ts`       | Add `'messages.delete'` to capability set                                               |

## Data Flow

### Config editor — sensitive key

```
User types "sk-abc123..." in chat
  → bot.ts maybeHandleSetupFlows()
    → config-editor-integration.handleConfigEditorMessage()
      → config-editor/handlers.handleEditorMessage()
        → sets isSensitiveKey=true, masks value in response
      → integration checks isSensitiveKey
        → reply.deleteMessage available? → delete user message
        → not available? → append per-field warning
    → returns true
```

### Wizard — sensitive step

```
User types "sk-abc123..." in chat
  → bot.ts maybeHandleSetupFlows()
    → wizard-integration.handleWizardMessage()
      → wizard/engine.processWizardMessage()
        → sets isSensitiveKey=true
      → integration checks isSensitiveKey
        → reply.deleteMessage available? → delete user message
        → not available? → append per-field warning
    → returns true
```

### Upfront warning

```
User runs /setup or /config
  → setup.ts or config.ts handler
    → check supportsCapability(chat, 'messages.delete')
    → not supported → send warning message
    → proceed with wizard/config editor
```

## Error Handling

- `deleteMessage` failures are logged at `warn` level and silently ignored. Deletion is best-effort and must not block the setup flow.
- Missing `messageId` on `IncomingMessage` is a no-op (some adapters may not populate it in edge cases).

## Testing

- Unit tests for `isSensitiveKey()` helper.
- Unit tests for config-editor handler confirming masked output for sensitive keys.
- Unit tests for wizard engine confirming `isSensitiveKey` flag is set.
- Unit tests for integration layers: verify delete is called when capability present, warning appended when absent.
- Mattermost adapter test: verify `deleteMessage` calls the correct API endpoint.
