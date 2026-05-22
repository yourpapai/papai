<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0051: Add Discord Chat Provider

## Status

Accepted

## Date

2026-04-09

## Context

papai already supports Telegram and Mattermost as chat platforms. Users have requested Discord support as a third option, particularly for:

- Communities that already use Discord as their primary communication platform
- Teams wanting bot functionality in Discord servers alongside other Discord-native tools
- Support for Discord-specific features like reply threading and button interactions

The existing `ChatProvider` abstraction was designed to support multiple platforms, but Discord's API model differs significantly from Telegram/Mattermost:

- **Guild-scoped user resolution**: Discord users exist within the context of a guild/server, requiring `resolveUserId` to search per-guild member lists
- **Message format limitations**: Discord has a 2000-character limit and different markdown dialect
- **Interaction model**: Discord uses button interactions and ephemeral replies differently than other platforms
- **Typing indicators**: Discord supports typing indicators differently than Telegram

The implementation plan at `docs/superpowers/plans/2026-04-09-discord-implementation.md` specifies 8 phases covering interface extension, provider scaffolding, message mapping, formatting, ReplyFn construction, provider wiring, remaining methods, and shipping.

## Decision Drivers

- **Must maintain ChatProvider interface parity** so all commands and tools work identically across platforms
- **Must support guild-scoped user resolution** for @mentions in Discord servers
- **Must handle Discord's 2000-character message limit** with intelligent chunking
- **Should preserve code-fence formatting** when chunking markdown
- **Must prevent mass pings** (@everyone, @here) via zero-width-space escaping
- **Should support button interactions** for wizard flows and confirmations

## Considered Options

### Option 1: Extend ChatProvider with context-aware resolveUserId

Extend the shared `ChatProvider` interface to accept a `ResolveUserContext` parameter in `resolveUserId()`, allowing adapters like Discord to scope user searches to specific guilds.

**Pros:**

- Maintains clean abstraction across all providers
- Enables proper guild-scoped member resolution for Discord
- Backward compatible (Telegram/Mattermost ignore context)
- Consistent API for future providers

**Cons:**

- Requires modifying existing Telegram and Mattermost adapters
- Slightly more complex interface

### Option 2: Create Discord-specific user resolution outside ChatProvider

Keep the existing `resolveUserId(username)` signature and implement guild-scoped resolution as a Discord-specific concern outside the shared interface.

**Pros:**

- No changes to existing adapters
- Simpler interface

**Cons:**

- Breaks abstraction; Discord behaves differently
- Would require special-casing in commands that resolve users
- Harder to maintain consistency

### Option 3: Use a separate DiscordClient class instead of ChatProvider

Create a standalone Discord implementation that doesn't implement `ChatProvider`, with its own command registration and message handling.

**Pros:**

- Complete flexibility for Discord-specific features
- No interface constraints

**Cons:**

- Massive code duplication
- Commands would need Discord-specific versions
- Defeats the purpose of the abstraction
- Maintenance burden doubles

## Decision

We will implement **Option 1**: Extend the `ChatProvider` interface with `ResolveUserContext` and build a full `DiscordChatProvider` using `discord.js` v14.

The implementation includes:

1. **Interface extension**: Add `ResolveUserContext` type and update `resolveUserId` signature
2. **Discord scaffolding**: New `DiscordChatProvider` class with env validation
3. **Message mapping**: Convert Discord `Message` objects to `IncomingMessage`
4. **Formatting**: Discord-dialect markdown normalization with table flattening and mass-mention escaping
5. **Chunking**: Boundary-preserving 2000-character chunker with code-fence preservation
6. **ReplyFn**: Full implementation with text, formatted, typing, redact, and buttons
7. **Button interactions**: `Events.InteractionCreate` handler for wizard flows
8. **Guild-scoped resolution**: `resolveUserId` searches guild members when contextType is 'group'

## Rationale

1. **Abstraction integrity**: Extending the interface preserves the clean separation between chat adapters and business logic
2. **Consistency**: All commands work identically across Telegram, Mattermost, and Discord
3. **Maintainability**: Single codebase for commands, only platform-specific code in adapters
4. **User experience**: Guild-scoped resolution enables proper @mention handling in Discord servers
5. **Feature parity**: Discord users get the same bot capabilities as other platforms

The decision to use `discord.js` v14 (specifically `^14.25.1`) was based on:

- Mature, well-documented library with strong TypeScript support
- Active maintenance and Discord API v10 support
- Built-in intents system for efficient event filtering
- WebSocket-based real-time message handling

## Consequences

### Positive

- **Third platform support**: papai now works in Discord servers and DMs
- **Guild-aware user resolution**: @mentions resolve to correct users within their guild context
- **Rich formatting support**: Markdown tables, code blocks, and formatting preserved
- **Button interactions**: Wizard flows and confirmations work via Discord buttons
- **Reply threading**: Discord reply chains are properly tracked and displayed
- **No breaking changes**: Existing Telegram/Mattermost users unaffected

### Negative

- **Increased bundle size**: `discord.js` adds ~5MB of dependencies
- **Gateway connection management**: Requires WebSocket connection handling and reconnection logic
- **Discord-specific edge cases**: Message rate limits, permission errors, and channel types need platform-specific handling
- **Outgoing file attachments deferred**: Discord file uploads intentionally not implemented in Phase 1 (feature flagged for future)

### Risks

- **Gateway disconnections**: Discord WebSocket may disconnect; mitigation implemented with auto-reconnect
- **Rate limiting**: Discord has strict rate limits; mitigation via request queuing and exponential backoff
- **Permission errors**: Bot needs proper intents; mitigation via clear setup documentation

## Implementation Notes

### File Structure

```
src/chat/discord/
├── index.ts              # DiscordChatProvider class
├── mention-helpers.ts    # stripBotMention, isBotMentioned
├── map-message.ts        # Discord Message → IncomingMessage
├── reply-context.ts      # buildDiscordReplyContext
├── format-chunking.ts    # chunkForDiscord
├── format.ts             # formatLlmOutput
├── typing-indicator.ts   # Typing indicator helpers
├── buttons.ts            # Button row builders
├── reply-helpers.ts      # sendChunkedReply
├── handlers.ts           # Config/wizard handlers
├── metadata.ts           # Capability metadata
└── client-factory.ts     # Client dependency injection
```

### Testing

17 test files covering all Discord-specific functionality:

- Unit tests for mention helpers, message mapping, formatting, chunking
- Integration tests for ReplyFn behavior
- Button interaction tests
- Client factory tests

### Environment Configuration

New required environment variable:

- `DISCORD_BOT_TOKEN`: Bot token from Discord Developer Portal

Bot must have `MESSAGE CONTENT INTENT` enabled in the Developer Portal.

## Verification

- ✅ All 17 Discord-specific test files pass
- ✅ Full test suite passes with Discord provider instantiated
- ✅ Manual E2E checklist completed (DM conversations, @mentions in guilds, button interactions)
- ✅ TypeScript compilation succeeds
- ✅ Lint passes (oxlint)

## Files Changed

### New Files (17)

- `src/chat/discord/index.ts`
- `src/chat/discord/mention-helpers.ts`
- `src/chat/discord/map-message.ts`
- `src/chat/discord/reply-context.ts`
- `src/chat/discord/format-chunking.ts`
- `src/chat/discord/format.ts`
- `src/chat/discord/typing-indicator.ts`
- `src/chat/discord/buttons.ts`
- `src/chat/discord/reply-helpers.ts`
- `src/chat/discord/handlers.ts`
- `src/chat/discord/metadata.ts`
- `src/chat/discord/client-factory.ts`
- 17 test files in `tests/chat/discord/`

### Modified Files (7)

- `src/chat/types.ts` - Added `ResolveUserContext` type, extended `resolveUserId` signature
- `src/chat/telegram/index.ts` - Updated `resolveUserId` to accept context parameter
- `src/chat/mattermost/index.ts` - Updated `resolveUserId` to accept context parameter
- `src/commands/group.ts` - Threaded context through `extractUserId`
- `src/chat/registry.ts` - Registered Discord provider
- `src/env-validation.ts` - Added Discord env validation
- `src/commands/help.ts` - Added Discord `/help` note

### Dependencies

- Added `discord.js@^14.25.1` to `package.json`

## Lessons Learned

1. **Context threading is critical**: The `ResolveUserContext` extension was essential for Discord's guild-scoped member resolution. Without it, @mentions would fail or resolve incorrectly.

2. **Message format adaptation**: Discord's 2000-character limit and different markdown dialect required significant formatting work (table flattening, code-fence preservation, mass-mention escaping).

3. **Button interactions differ**: Discord buttons require explicit interaction handling via `Events.InteractionCreate`, unlike Telegram's callback queries. The abstraction needed platform-specific handling.

4. **Typing indicators are platform-specific**: Discord typing indicators have different timing constraints than Telegram. The abstraction handles this via platform-specific implementations.

5. **Deferral strategy works**: Outgoing file attachments were intentionally deferred (throws `notImplemented` error). This allowed shipping core functionality without blocking on Discord's complex attachment API.

## Related Decisions

- ADR-0014: Multi-Chat-Provider Abstraction (original design for platform abstraction)
- ADR-0018: Group Chat Support (threading model informed Discord's context handling)

## References

- Implementation Plan: `docs/superpowers/plans/2026-04-09-discord-implementation.md`
- Design Document: `docs/discord-chat-design.md`
- Discord.js Documentation: https://discord.js.org/
- Discord Developer Portal: https://discord.com/developers/applications
