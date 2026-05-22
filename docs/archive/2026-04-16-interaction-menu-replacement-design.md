<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Interaction Menu Replacement Design

**Date:** 2026-04-16  
**Status:** Approved  
**Scope:** Button-driven menus should update in place instead of creating a stack of old menu messages

## Problem Statement

The current button interaction flow sends a new bot message for each menu transition.

That behavior causes interactive flows to drift downward in the chat history:

- the previous menu remains visible
- the current menu is separated from the user action that triggered it
- long configuration flows accumulate stale menus

This is most visible in:

- group settings selection
- config editor callbacks
- setup wizard button steps

The desired behavior is a single evolving menu message. When a user clicks a button, the bot should update that same menu message in place.

## Goals

1. Make button-driven menu transitions edit the clicked menu message in place
2. Keep the interaction focused on one current menu message
3. Preserve existing command and plain-text reply behavior
4. Support the platforms that already expose interactive button callbacks
5. Keep the change localized to chat interaction flows instead of adding global bot-message lifecycle state

## Non-Goals

- Deleting arbitrary historical bot messages from a session
- Replacing non-interactive command replies
- Changing Mattermost behavior beyond preserving the current fallback path
- Introducing a global "active menu message" registry
- Refactoring the config editor or wizard business logic beyond their reply surface

## Decision

The approved approach is to add interaction-scoped replacement methods to `ReplyFn` and use them only from callback-driven flows.

This is preferred over delete-and-resend because:

- Telegram and Discord both support native message updates for button interactions
- editing preserves message position and context
- no cross-session message tracking is required
- the behavior maps directly to the user's requested UX

## Design

### 1. Extend `ReplyFn` with replacement methods

Add optional methods to `ReplyFn` for in-place interaction updates:

```typescript
type ReplyFn = {
  text: (content: string, options?: ReplyOptions) => Promise<void>
  formatted: (markdown: string, options?: ReplyOptions) => Promise<void>
  file?: (file: ChatFile, options?: ReplyOptions) => Promise<void>
  typing: () => void
  redactMessage?: (replacementText: string) => Promise<void>
  buttons: (content: string, options: ButtonReplyOptions) => Promise<void>
  replaceText?: (content: string, options?: ReplyOptions) => Promise<void>
  replaceButtons?: (content: string, options: ButtonReplyOptions) => Promise<void>
  embed?: (options: EmbedOptions) => Promise<void>
}
```

These methods are optional because not every provider supports in-place interactive replacement.

### 2. Limit replacement behavior to button interaction flows

Only callback-driven routes should use the new replacement methods.

Initial command entrypoints still send a normal message:

- `/config` starts by sending the first menu
- `/setup` starts by sending the first wizard prompt

After that, button clicks replace the existing interactive message instead of sending a new one.

This preserves current command semantics while improving the interactive UX.

### 3. Telegram implementation

Telegram already carries the callback message identity through the callback query context, and grammY exposes `editMessageText` support for editing that message.

Implementation expectations:

- `replaceText` edits the callback message text and clears inline keyboard markup
- `replaceButtons` edits the callback message text and attaches a newly rendered inline keyboard
- formatting behavior should match the current `buttons` implementation so edited menus render consistently with newly sent menus

The Telegram interaction reply builder already knows:

- chat ID
- callback message ID
- thread ID when present

So no new persistence is required.

### 4. Discord implementation

Discord component interactions support updating the original interaction message directly.

Implementation expectations:

- build an interaction-aware reply surface for button callbacks
- `replaceText` edits the interaction-origin message and clears components
- `replaceButtons` edits the interaction-origin message and replaces components with the next menu state

The important design constraint is that callback-driven menu updates should use the interaction's source message, not send a follow-up message to the channel.

That keeps Discord aligned with the requested single-message menu behavior.

### 5. Mattermost behavior

Mattermost does not currently support interactive buttons in this codebase.

Therefore:

- no new replacement implementation is required there
- existing behavior remains unchanged
- replacement methods can be omitted on the Mattermost `ReplyFn`

### 6. Routing changes

Update the interaction-driven routing code to prefer replacement methods when present.

Primary targets:

- `src/group-settings/dispatch.ts`
- `src/chat/interaction-router.ts`

Detailed behavior:

- when a callback result includes buttons, prefer `reply.replaceButtons`
- when a callback result includes text only, prefer `reply.replaceText`
- if replacement methods are unavailable, fall back to `reply.buttons` or `reply.text`

This keeps business logic platform-agnostic while allowing adapters to provide better interaction UX.

### 7. Wizard behavior

Wizard button paths should also use the replacement methods.

This includes:

- confirm
- cancel
- restart
- edit
- skip actions that currently produce another button-based prompt

The result should be a single evolving wizard message after the initial entrypoint message is created.

### 8. Failure handling

Replacement should degrade gracefully.

Rules:

- if a provider does not implement replacement, send a normal follow-up message using existing behavior
- if a replacement attempt fails unexpectedly, log the failure and fall back to existing send behavior where practical
- do not introduce user-visible errors solely because an in-place update failed

The purpose of this feature is UX polish, not correctness-critical state management.

## Data Flow

### Initial command entry

1. User runs `/config` or `/setup`
2. Bot sends the first interactive message with `reply.buttons` or `reply.text`

### Callback transition

1. User clicks a button on that message
2. Adapter builds an interaction-aware `ReplyFn`
3. Router processes callback result
4. Router prefers `replaceButtons` or `replaceText`
5. Adapter edits the clicked menu message in place

## Alternatives Considered

### 1. Delete-and-resend

Rejected because it is less native, more fragile, and briefly removes the menu from the chat while the new one is sent.

### 2. Session-level active menu tracking

Rejected because the requested behavior only requires replacing the clicked message. Broader tracking would add state, cleanup rules, and failure modes without clear benefit.

### 3. Reusing `redactMessage`

Rejected because it does not provide true in-place menu navigation. It would only blank the old message and still send a new one.

## Testing Strategy

Add targeted tests for:

1. interaction routes preferring replacement methods when available
2. fallback to `reply.buttons` and `reply.text` when replacement methods are absent
3. Telegram callback reply helper editing the original menu message
4. Discord button interaction reply helper editing the original menu message
5. wizard and config editor callback flows keeping interaction output to one updated message

The tests should prove the routing decision and the adapter behavior separately.

## Open Questions

None for this version. The approved behavior is explicitly limited to replacing the clicked menu message in place.

## Summary

Implement interaction-scoped `ReplyFn` replacement methods and use them only in callback-driven menu flows. Telegram and Discord should update the clicked menu message in place. All non-interaction message flows remain unchanged, and unsupported providers retain current fallback behavior.
