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

The `!msg.isMentioned` group gate is duplicated across **three** sites; all three must be updated together or behavior diverges:

1. `shouldIgnoreGroupMessage()` (`src/bot.ts:126-130`) — decides whether to drop the message.
2. `willQueueAuthorizedMessage()` (`src/bot.ts:160-165`) — decides whether the message will be queued (drives reply-completion accounting).
3. `recordGroupObservation()` (`src/bot-group-observation.ts:15-17`) — records the sender/group in the group-settings registry. **If this site is missed, a reply-to-bot message is processed but the sender is never observed** (invisible to the settings-UI group admin/user registries and identity mapping).

```ts
// shouldIgnoreGroupMessage — Before / After
return !msg.isMentioned
return !msg.isMentioned && !msg.isReplyToBot

// willQueueAuthorizedMessage — Before / After
return msg.isMentioned
return msg.isMentioned || msg.isReplyToBot === true

// recordGroupObservation (bot-group-observation.ts) — Before / After
if (msg.commandMatch === undefined && !msg.isMentioned) return
if (msg.commandMatch === undefined && !msg.isMentioned && !msg.isReplyToBot) return
```

`isReplyToBot` is optional, so `!msg.isReplyToBot` and `msg.isReplyToBot === true` both correctly treat `undefined` (Mattermost/Kontur Talk) as "not a reply-to-bot".

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

**Solution:** Add optional `isReplyToBot` parameter to `mapDiscordMessage()`. In `dispatchMessage()`, when the message has a `reference` in a non-DM channel **and is not already mentioned**, fetch the parent message first to check bot authorship, then pass the result to `mapDiscordMessage()`. Skipping the pre-fetch when the bot is already `@mentioned` avoids a wasted REST call on the common path (a mentioned message passes the filter regardless of `isReplyToBot`).

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

`DispatchableMessage.channel.messages` is optional (`src/chat/discord/client-factory.ts:11-18`), so the fetch must be guarded against `undefined` or it will not typecheck. `CHANNEL_TYPE_DM` (= 1) is already defined in `map-message.ts`; export and reuse it instead of an inline `1`.

```ts
private async dispatchMessage(message: DispatchableMessage, botId: string): Promise<void> {
  // Pre-check: is this a reply to the bot's own message? Skip when already
  // mentioned (it passes the filter regardless) or in a DM channel.
  let isReplyToBot = false
  const mentioned = isBotMentioned(message.mentions, botId, /* contextType */ 'group')
  if (
    message.reference?.messageId !== undefined &&
    message.channel.type !== CHANNEL_TYPE_DM &&
    !mentioned
  ) {
    const messages = message.channel.messages
    if (messages !== undefined) {
      try {
        const parent = await messages.fetch(message.reference.messageId)
        isReplyToBot = parent.author.id === botId
      } catch {
        // Parent fetch failed — not a blocker, treat as non-reply
      }
    }
  }

  const mapped = mapDiscordMessage(message, botId, this.platformInstanceId, isReplyToBot)
  if (mapped === null) return

  // ... rest unchanged; replyContext still built here for LLM prompt enrichment ...
}
```

**Cost note:** this is a deliberate second REST fetch of the parent. `buildDiscordReplyContext()` later does its own full fetch for prompt enrichment, so a reply-to-bot message fetches the parent twice. The pre-fetch only needs `author.id` and is skipped entirely when the bot is already mentioned, so the extra call lands only on the new (previously-dropped) reply-without-mention path. If this proves hot, a later optimization can thread the already-fetched parent into `buildDiscordReplyContext()`. Both fetches degrade gracefully on failure.

### Kontur Talk & Mattermost

No changes. These platforms are excluded from this feature.

## Edge Cases

- **Reply to bot in DM:** DMs bypass `shouldIgnoreGroupMessage()` entirely. No change needed.
- **Reply + @mention:** Both signals true; message processed normally. No conflict.
- **Deleted/edited parent message:** If the parent message can't be fetched, `isReplyToBot` is `false`. The message falls back to requiring `@mention`. Acceptable degradation.
- **Bot replies to itself:** Both adapters skip bot-authored messages early (Telegram via Grammy filter, Discord via `message.author.bot` check). No loop risk.
- **Thread messages in Discord:** Discord replies create threads. A reply to the bot's message in a thread is still a reply with `reference.messageId` set, so it's handled correctly.
- **Unauthorized user replies to bot:** `handleMessage()` (`src/bot.ts:138-141`) only sends the "unauthorized" notice on `msg.isMentioned`. A reply-to-bot from an unauthorized user is therefore dropped silently rather than getting a notice. This is **intentional** — it keeps reply-to-bot from becoming a way for unauthorized users to provoke replies. The gate (`isMentioned` only) is left unchanged here on purpose.
- **Group observation:** Without the `recordGroupObservation()` change (see Core Gate Change), a user who only ever replies to the bot would be processed but never recorded in the group-settings registry. The three-site gate update keeps observation consistent with processing.

## Testing

1. **`shouldIgnoreGroupMessage()` unit tests:**
   - `{ isMentioned: false, isReplyToBot: true }` → not ignored
   - `{ isMentioned: false, isReplyToBot: false }` → ignored
   - `{ isMentioned: true, isReplyToBot: false }` → not ignored

1a. **`recordGroupObservation()` unit test:**

- `{ isMentioned: false, isReplyToBot: true }` in a group → records the observation (upserts known context + admin/user rows)
- `{ isMentioned: false, isReplyToBot: false }` in a group → no observation recorded (existing behavior preserved)

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

| File                              | Change                                                                     |
| --------------------------------- | -------------------------------------------------------------------------- |
| `src/chat/types.ts`               | Add `isReplyToBot?: boolean` to `IncomingMessage`                          |
| `src/bot.ts`                      | Update `shouldIgnoreGroupMessage()` and `willQueueAuthorizedMessage()`     |
| `src/bot-group-observation.ts`    | Update `recordGroupObservation()` gate to include `isReplyToBot`           |
| `src/chat/telegram/index.ts`      | Set `isReplyToBot` in `extractMessage()`                                   |
| `src/chat/discord/map-message.ts` | Add `isReplyToBot` parameter, relax group filter, export `CHANNEL_TYPE_DM` |
| `src/chat/discord/index.ts`       | Pre-fetch parent (mention/DM short-circuit) to check bot authorship        |
| `CLAUDE.md`, `src/chat/CLAUDE.md` | Note Discord now also processes replies to bot messages in groups          |
| Tests for each changed module     | New test cases for reply-to-bot scenarios                                  |
