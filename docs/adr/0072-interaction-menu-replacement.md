<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0072: Interaction Menu Replacement

## Status

Implemented

## Date

2026-04-16

## Context

Button-driven interactive menus (group-settings selectors, config editor callbacks, setup wizard steps) sent a new bot message for every menu transition. This caused menus to drift downward in chat history — the previous menu remained visible while the current one appeared below it, separating the menu from the user action that triggered it.

Long configuration flows accumulated stale menus, making the conversation harder to follow on Telegram and Discord.

## Decision Drivers

- **Single evolving menu**: Users should see one current menu message, not a stack of outdated ones
- **Platform-native behavior**: Telegram (`editMessageText`) and Discord (interaction message `edit`) both support in-place message updates natively
- **No global state**: Avoid introducing a cross-session "active menu message" registry
- **Fallback preservation**: Providers without interactive buttons (Mattermost) must keep existing behavior unchanged

## Considered Options

### Option 1: Interaction-scoped `ReplyFn` replacement methods

Add optional `replaceText` and `replaceButtons` to `ReplyFn`. Only callback-driven flows use them; initial command replies still send new messages.

- **Pros**: No global state, platform-native, localized change, clean fallback path
- **Cons**: Requires routing-level changes in dispatch and interaction-router

### Option 2: Delete-and-resend

Delete the old menu message and send a new one.

- **Pros**: Works on any platform
- **Cons**: Brief gap where no menu is visible, more fragile, less native UX

### Option 3: Reuse `redactMessage`

Blank the old message and send a new one.

- **Pros**: Minimal new code
- **Cons**: Not true in-place navigation; still creates a new message, blank old one litters chat

## Decision

Adopt **Option 1**: Add interaction-scoped replacement methods to `ReplyFn` and prefer them in callback-driven routing.

The key design constraint is that replacement is scoped to the clicked interaction message. No session-level message tracking is needed — Telegram carries the callback message identity through the grammY context, and Discord exposes the interaction-origin message directly.

## Consequences

### Positive

- Telegram and Discord menus now update in place — one evolving message per interactive flow
- No change to initial command replies (`/config`, `/setup` still send the first menu normally)
- No change to Mattermost behavior (replacement methods omitted on its `ReplyFn`)
- Routing logic (`dispatch.ts`, `interaction-router.ts`) is platform-agnostic — checks for method presence, falls back to `reply.buttons`/`reply.text`

### Negative

- Two new optional methods on `ReplyFn` increase the reply surface
- Discord structural interaction types needed a `message.edit` field addition

## Implementation Status

All 8 planned tasks implemented and verified:

| Area                        | Files                                 | Status                                                                           |
| --------------------------- | ------------------------------------- | -------------------------------------------------------------------------------- |
| `ReplyFn` type surface      | `src/chat/types.ts`                   | `replaceText` and `replaceButtons` added                                         |
| Group-selector dispatch     | `src/group-settings/dispatch.ts`      | Prefers replacement methods, falls back to `reply.buttons`/`reply.text`          |
| Interaction router          | `src/chat/interaction-router.ts`      | `replyWithTextOrReplacement` / `replyWithButtonsOrReplacement` helpers           |
| Telegram reply helpers      | `src/chat/telegram/reply-helpers.ts`  | `sendReplacementTextReply`, `sendReplacementButtonReply` using `editMessageText` |
| Telegram interaction wiring | `src/chat/telegram/index.ts`          | Replacement methods exposed on callback-query reply surfaces                     |
| Discord reply helpers       | `src/chat/discord/reply-helpers.ts`   | `replaceText`/`replaceButtons` via `replaceMessage.edit` with fallback           |
| Discord button dispatch     | `src/chat/discord/button-dispatch.ts` | Passes `replaceMessage` from interaction when `edit` is available                |
| Tests                       | 6 test suites, 115 tests pass         | Replacement routing, Telegram helpers, Discord helpers, interaction integration  |

## Related Decisions

- ADR-0042: Bot Configuration Wizard — the wizard button paths now use replacement methods
- ADR-0051: Discord Chat Provider — Discord interaction types extended for editable messages
- ADR-0065: Discord onInteraction Refactor — prior refactor that made replacement wiring straightforward
