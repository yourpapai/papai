<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Reply-to-Bot in Group Chats

**Date:** 2026-06-08
**Status:** Draft

## Problem

In group chats, users must `@mention` the bot for it to process their message. If a user replies directly to one of the bot's messages (Telegram "Reply" action, Discord "Reply" action), the message is silently dropped unless they also `@mention` the bot. This is a poor UX — replying to a message is already a clear signal of intent.

## Scope

**Platforms:** Telegram and Discord only.

Mattermost uses threads (not per-message replies), and Kontur Talk lacks a distinct reply-to-message action comparable to Telegram/Discord. Both are excluded.

**Behavior:** Always on, no configuration toggle. Reply to any bot-authored message in a group chat triggers processing, equivalent to an `@mention`.

## Design

### Core Gate Change

Add `isReplyToBot?: boolean` to `IncomingMessage` (`src/chat/types.ts`).

Modify `shouldIgnoreGroupMessage()` in `src/bot.ts:126-130`:

```ts
// Before
return !msg.isMentioned

// After
return !msg.isMentioned && !msg.isReplyToBot
```

Same change in `willQueueAuthorizedMessage()` at `src/bot.ts:160-165`.

### Telegram Adapter

In `extractMessage()` (`src/chat/telegram/index.ts:189-219`), after building `replyContext`, set:

```ts
const isReplyToBot = replyContext?.authorId !== undefined && String(ctx.me?.id) === replyContext.authorId
```

Include `isReplyToBot` in the returned `IncomingMessage`. The bot's Telegram user ID comes from `ctx.me.id` (Grammy context). The `replyContext.authorId` is already populated by `extractReplyContext()` from `ctx.message.reply_to_message.from.id`.

### Discord Adapter

Discord has a two-stage flow in `dispatchMessage()` (`src/chat/discord/index.ts:225-260`):

1. `mapDiscordMessage()` — synchronous, builds `IncomingMessage`, hard-rejects unmentioned group messages at lines 50-52.
2. `buildDiscordReplyContext()` — async, fetches parent message via REST, builds `ReplyContext`.

The problem: the hard filter runs before reply context is built. We need to know if it's a reply-to-bot before filtering.

**Solution:** Add optional `isReplyToBot` parameter to `mapDiscordMessage()`. In `dispatchMessage()`, when the message has a `reference` in a group context, fetch the parent message first to check bot authorship, then pass the result to `mapDiscordMessage()`.

Changes to `mapDiscordMessage()` (`src/chat/discord/map-message.ts`):

```ts
export function mapDiscordMessage(
  message: DiscordMessageLike,
  botId: string,
  platformInstanceId: string,
  isReplyToBot = false, // NEW parameter
): IncomingMessage | null {
  // ... existing checks ...

  if (contextType === 'group' && !mentioned && !isReplyToBot) {
    // MODIFIED
    return null
  }

  return {
    // ... existing fields ...
    isMentioned: mentioned,
    isReplyToBot, // NEW field
    // ...
  }
}
```

Changes to `dispatchMessage()` in `src/chat/discord/index.ts`:

```ts
private async dispatchMessage(message: DispatchableMessage, botId: string): Promise<void> {
  // Pre-check: is this a reply to the bot's own message?
  let isReplyToBot = false
  if (message.reference?.messageId !== undefined && message.channel.type !== 1) {
    try {
      const parent = await message.channel.messages.fetch(message.reference.messageId)
      isReplyToBot = parent.author.id === botId
    } catch {
      // Parent fetch failed — not a blocker, treat as non-reply
    }
  }

  const mapped = mapDiscordMessage(message, botId, this.platformInstanceId, isReplyToBot)
  if (mapped === null) return

  // ... rest unchanged; replyContext still built here for LLM prompt enrichment ...
}
```

This avoids duplicating the fetch — the parent message check is a lightweight fetch (we only need `author.id`), and `buildDiscordReplyContext()` still does the full fetch later for prompt enrichment. If the fetch fails in either place, it degrades gracefully.

### Kontur Talk & Mattermost

No changes. These platforms are excluded from this feature.

## Edge Cases

- **Reply to bot in DM:** DMs bypass `shouldIgnoreGroupMessage()` entirely. No change needed.
- **Reply + @mention:** Both signals true; message processed normally. No conflict.
- **Deleted/edited parent message:** If the parent message can't be fetched, `isReplyToBot` is `false`. The message falls back to requiring `@mention`. Acceptable degradation.
- **Bot replies to itself:** Both adapters skip bot-authored messages early (Telegram via Grammy filter, Discord via `message.author.bot` check). No loop risk.
- **Thread messages in Discord:** Discord replies create threads. A reply to the bot's message in a thread is still a reply with `reference.messageId` set, so it's handled correctly.

## Testing

1. **`shouldIgnoreGroupMessage()` unit tests:**
   - `{ isMentioned: false, isReplyToBot: true }` → not ignored
   - `{ isMentioned: false, isReplyToBot: false }` → ignored
   - `{ isMentioned: true, isReplyToBot: false }` → not ignored

2. **Telegram adapter test:**
   - Mock Grammy context with `reply_to_message.from.id === ctx.me.id`, `isMentioned: false`
   - Verify `IncomingMessage` has `isReplyToBot: true`

3. **Discord `mapDiscordMessage()` test:**
   - Call with `isReplyToBot: true`, group context, no mention
   - Verify message passes (not null)
   - Call with `isReplyToBot: false`, group context, no mention
   - Verify message is null (existing behavior preserved)

4. **Discord `dispatchMessage()` test:**
   - Mock message with `reference.messageId` pointing to bot-authored parent
   - Verify `mapDiscordMessage()` receives `isReplyToBot: true`
   - Mock message with `reference.messageId` pointing to non-bot parent
   - Verify `mapDiscordMessage()` receives `isReplyToBot: false`

## Files Changed

| File                              | Change                                                                 |
| --------------------------------- | ---------------------------------------------------------------------- |
| `src/chat/types.ts`               | Add `isReplyToBot?: boolean` to `IncomingMessage`                      |
| `src/bot.ts`                      | Update `shouldIgnoreGroupMessage()` and `willQueueAuthorizedMessage()` |
| `src/chat/telegram/index.ts`      | Set `isReplyToBot` in `extractMessage()`                               |
| `src/chat/discord/map-message.ts` | Add `isReplyToBot` parameter, relax group filter                       |
| `src/chat/discord/index.ts`       | Pre-fetch parent message to check bot authorship                       |
| Tests for each changed module     | New test cases for reply-to-bot scenarios                              |
