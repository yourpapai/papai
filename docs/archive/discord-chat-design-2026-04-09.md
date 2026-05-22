<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Discord ChatProvider — Full Design

**Status:** Approved. Open questions resolved. Ready for implementation plan.
**Date:** 2026-04-09
**Author:** `designing-new-provider` skill, Step 5 (design doc).
**Type:** Chat platform adapter (`ChatProvider`).

## Changelog

- **2026-04-09 (design review):**
  - §3.4 ratified — `MessageContent` privileged intent will be requested.
  - §7.2, §10 updated — `ChatProvider.resolveUserId` signature extends to accept the caller's `IncomingMessage` context so the Discord adapter can scope member search to the current guild. This is a breaking change to the shared interface; Telegram and Mattermost implementations accept the new parameter and ignore it.
  - §13.2 Q3 resolved — `/help` on Discord appends a one-line note about `/context` being deferred to Phase 2.
  - §13.2 Q4 resolved — `DISCORD_BOT_TOKEN` gets its own block at the bottom of `.env.example`.

## 1. Goal

Add Discord as a third `ChatProvider` alongside `telegram` and `mattermost`, so a user running papai can talk to the bot either by DMing it or by @mentioning it in a guild channel and get the exact same LLM-backed task-management experience that Telegram and Mattermost users already get. All existing chat-layer commands (`/help`, `/set`, `/config`, `/clear`, `/context`, admin commands) must work unchanged; the LLM layer, task-provider layer, SQLite stores, and authorization model must remain untouched.

## 2. Current state

- **No Discord code exists.** No `src/chat/discord/` directory. No `discord.js` in `package.json`. `src/chat/registry.ts` registers only `telegram` and `mattermost`. `src/index.ts`'s env-validation block knows only those two values for `CHAT_PROVIDER`.
- **Reference implementations:** `src/chat/telegram/` (grammy-based, polling) and `src/chat/mattermost/` (raw HTTP + WebSocket). `tests/chat/telegram/` and `tests/chat/mattermost/` show the test style.
- **Interface contract:** `src/chat/types.ts:114-134` defines `ChatProvider` with 6 required methods. `src/chat/CLAUDE.md` documents the rules.
- **Existing gaps to inherit:** Mattermost buttons are rendered but their webhook handler is not wired (`src/wizard-integration.ts:123-126` has a platform guard that hides buttons on anything but Telegram). Discord does not have this problem because `Events.InteractionCreate` is delivered directly on the Gateway — buttons can be fully wired on day one, which is an improvement over Mattermost parity.

## 3. API surface to cover

Grouped by resource / event family. Items in **bold** are out of Phase 1 scope. Every row cites the official endpoint or event name.

### 3.1 Gateway (WebSocket, handled by `discord.js` `Client`)

| Event / concept                           | Purpose                                                               | In scope?                        |
| ----------------------------------------- | --------------------------------------------------------------------- | -------------------------------- |
| `READY`                                   | initial handshake; populates `client.user.id`, `client.user.username` | Phase 1                          |
| `MessageCreate` (`messageCreate`)         | inbound messages in DMs and guild channels                            | Phase 1                          |
| `InteractionCreate` (`interactionCreate`) | button clicks from `ChatButton`s                                      | Phase 1                          |
| Gateway auto-resume / reconnect           | connection resilience                                                 | Phase 1 (free from `discord.js`) |
| `MessageUpdate`                           | **detecting user edits** to reprocess                                 | **Phase 2+**                     |
| `MessageDelete`                           | **cleanup of cached reply context**                                   | **Phase 2+**                     |
| `GuildCreate` / `GuildDelete`             | **track which guilds the bot is in**                                  | **Phase 2+**                     |
| Voice / stage / thread events             | **all excluded per direction brief**                                  | **non-goal**                     |

Ref: `GatewayIntentBits` enum — `discord-api-types` v10 (`/websites/discord_js`).

### 3.2 REST (via `discord.js` client wrappers, not raw HTTP)

| Endpoint                                                                          | Method use                                                 | In scope?         |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------- | ----------------- |
| `channel.send({ content, reply?, components? })` → `POST /channels/{id}/messages` | `ReplyFn.text`, `formatted`, `buttons`                     | Phase 1           |
| `channel.sendTyping()` → `POST /channels/{id}/typing`                             | `ReplyFn.typing`                                           | Phase 1           |
| `message.edit({ content, components })` → `PATCH /channels/{id}/messages/{id}`    | `ReplyFn.redactMessage`                                    | Phase 1           |
| `user.createDM()` → `POST /users/@me/channels`                                    | `sendMessage(userId, markdown)` announcements              | Phase 1           |
| `guild.members.fetch({ query })` → `GET /guilds/{id}/members/search`              | `resolveUserId(username)` — best-effort, guild-scoped only | Phase 1 (limited) |
| `channel.messages.fetch(id)` → `GET /channels/{id}/messages/{id}`                 | cache-miss fallback for reply-context parent lookup        | Phase 1           |
| `channel.messages.fetch({ limit })` → `GET /channels/{id}/messages`               | **bulk history / backfill**                                | **Phase 2+**      |
| `channel.send({ files: [...] })`                                                  | **outgoing file attachments** (`ReplyFn.file`)             | **Phase 2**       |
| Attachment CDN `GET {attachment.url}`                                             | **incoming file download** (`IncomingFile`)                | **Phase 2**       |
| Application (slash) commands                                                      | all endpoints                                              | **non-goal**      |
| Reactions, threads, voice, stages                                                 | all endpoints                                              | **non-goal**      |

Ref: `RESTPostAPIChannelMessageJSONBody` and `RESTPatchAPIChannelMessageJSONBody` (`/websites/discord_js_packages_discord_js_14_25_1`).

### 3.3 Gateway intents requested

```typescript
new Client({
  intents: [
    GatewayIntentBits.Guilds, // 1      — guild/channel cache
    GatewayIntentBits.GuildMessages, // 512    — MessageCreate in guild channels
    GatewayIntentBits.DirectMessages, // 4096   — MessageCreate in DMs
    GatewayIntentBits.MessageContent, // 32768  — privileged; see §3.4
  ],
})
```

Omitted on purpose: `GuildMembers` (privileged; not needed for Phase 1), `GuildPresences` (privileged; never needed), all reaction / typing / voice / scheduled-event intents.

### 3.4 `MessageContent` intent decision — **ratified revision to direction brief**

The direction brief at `docs/discord-chatprovider-direction-brief.md` said we would rely on Discord's exemption that delivers full message content for DMs and @mentioned messages without requesting the privileged `MessageContent` intent. Research surfaced a brittleness in the exemption and a zero-cost path to the privileged intent for unverified bots. **Ratified at design review on 2026-04-09: request the `MessageContent` intent in Phase 1.**

Rationale:

1. **Unverified bots can enable it freely.** Discord's own policy: _"This change affects only verified bots that are in 100 or more servers. Unverified bots are not affected at all."_ papai is a single-tenant personal bot; it will never trip the verification threshold for a typical user.
2. **The exemption is brittle.** The exemption covers DMs and messages that @mention the bot. If a user _replies_ to a bot message with `allowed_mentions.replied_user = false`, the reply is a direct reply to the bot but carries no user-visible mention, and under the exemption rules the `content`, `embeds`, `attachments`, and `components` fields would arrive empty. Enabling the intent removes that failure mode entirely.
3. **Operational simplicity.** Enabling the intent is a single checkbox in the Discord Developer Portal under the Bot page ("Privileged Gateway Intents → MESSAGE CONTENT INTENT"). The setup docs can say "toggle this on" and be done with it.
4. **Future-proofing.** If Phase 2 ever wants to read attachment metadata or embed fields from passively observed messages, the intent is already there. Without it, any such extension is blocked.

Fallback (not chosen): rely on the exemption only, add a defensive `content === ''` code path everywhere reply-context extraction reads content, and add a §13 risk about Discord narrowing the exemption. Rejected because the intent toggle is free.

### 3.5 Rate limiting

`discord.js` handles rate limits automatically via its Undici-backed REST manager. The adapter does **not** implement per-endpoint backoff manually. For telemetry only, subscribe to `client.rest.on('rateLimited', ...)` and log at `warn` level (no PII). No retries beyond what `discord.js` provides.

Ref: `client.rest` events migration (`/discordjs/guide`).

## 4. Message-type mapping (Discord → papai `IncomingMessage`)

Every field in `IncomingMessage` is accounted for — **free** (direct 1:1), **derived** (computed), **dropped** (provider has it but papai doesn't model it; stays in Discord-land), or **missing** (papai expects it, Discord doesn't have it; fallback given).

| `IncomingMessage` field | Source                                                                               | Category          | Notes                                                                                                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------ | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `user.id`               | `message.author.id` (snowflake string)                                               | free              | Discord IDs are already strings in the JSON Gateway payload                                                                                                               |
| `user.username`         | `message.author.username`                                                            | free              | Post-pomelo unique handle (no `#discriminator` concatenation). Human display name lives in `message.author.globalName` — **dropped**; papai has no field for it           |
| `user.isAdmin`          | `message.author.id === ADMIN_USER_ID`                                                | derived           | Global `ADMIN_USER_ID` check, identical to Telegram/Mattermost. No per-guild `Administrator` permission resolution (Direction A)                                          |
| `contextId`             | DM: `message.author.id`; guild channel: `message.channel.id`                         | derived           | Storage key per papai convention (`src/bot.ts:83-117`)                                                                                                                    |
| `contextType`           | `message.channel.type === ChannelType.DM ? 'dm' : 'group'`                           | derived           | `GuildText`, `GuildPublicThread`, etc. all map to `'group'` (threads are a non-goal anyway — threaded channels will be rejected upstream by the guild-channel-only guard) |
| `isMentioned`           | `message.mentions.has(client.user!.id, { ignoreEveryone: true, ignoreRoles: true })` | derived           | In DMs we synthesize `isMentioned = true` (parity with Telegram DMs) to match existing bot.ts logic for natural-language handling                                         |
| `text`                  | `stripBotMention(message.content, client.user!.id)`                                  | derived           | Strip leading `<@botId>` / `<@!botId>` and trim. See §4.2                                                                                                                 |
| `commandMatch`          | set only when `matchCommand(text)` returns non-null                                  | derived           | Parallel to Mattermost's `matchCommand` (`src/chat/mattermost/index.ts:228-238`)                                                                                          |
| `messageId`             | `message.id`                                                                         | free              |                                                                                                                                                                           |
| `replyToMessageId`      | `message.reference?.messageId`                                                       | free              | Discord puts reply metadata in `message.reference`                                                                                                                        |
| `replyContext`          | built from cache-first, fallback `channel.messages.fetch(id)`                        | derived           | See §4.3                                                                                                                                                                  |
| `files`                 | `undefined` in Phase 1                                                               | dropped (Phase 1) | Discord attachments are on `message.attachments` (a `Collection<string, Attachment>`); populating `IncomingFile` is Phase 2 work                                          |

### 4.1 `ChatUser` mapping

```typescript
const user: ChatUser = {
  id: message.author.id,
  username: message.author.username,
  isAdmin: message.author.id === adminUserId,
}
```

Username is null-safe: papai's `ChatUser.username` is `string | null`, and post-pomelo Discord guarantees a username. We still defensively coerce to `null` if `message.author.username` is the empty string (edge case for deleted users).

### 4.2 Mention stripping

Discord mentions in raw content look like `<@123456789012345678>` or (legacy nickname form) `<@!123456789012345678>`. The stripping function:

```typescript
function stripBotMention(content: string, botId: string): string {
  const pattern = new RegExp(`^<@!?${botId}>\\s*`)
  return content.replace(pattern, '').trim()
}
```

This is the _only_ mention we strip. User/role/channel mentions elsewhere in the message are preserved — they are part of the prompt the LLM sees.

### 4.3 Reply-context building

Mirror `src/chat/mattermost/reply-context.ts`:

```typescript
async function buildDiscordReplyContext(message: Message, contextId: string): Promise<ReplyContext | undefined> {
  const ref = message.reference
  if (ref?.messageId === undefined) return undefined

  const { chain, chainSummary } = buildReplyContextChain(contextId, ref.messageId)

  // cache-first
  const cached = getCachedMessage(contextId, ref.messageId)
  if (cached !== undefined) {
    return {
      messageId: ref.messageId,
      authorId: cached.authorId,
      authorUsername: cached.authorUsername ?? null,
      text: cached.text,
      chain,
      chainSummary,
    }
  }

  // REST fallback — one fetch, bounded by Discord's standard rate limit
  try {
    const parent = await message.channel.messages.fetch(ref.messageId)
    return {
      messageId: ref.messageId,
      authorId: parent.author.id,
      authorUsername: parent.author.username,
      text: parent.content, // requires MessageContent intent
      chain,
      chainSummary,
    }
  } catch (error) {
    log.warn(
      { refId: ref.messageId, error: error instanceof Error ? error.message : String(error) },
      'Failed to fetch Discord parent message',
    )
    return { messageId: ref.messageId, chain, chainSummary }
  }
}
```

`buildReplyContextChain` is imported from the existing shared helper and is identical to Mattermost usage.

### 4.4 Fields we deliberately drop (stay in Discord-land)

- `message.author.globalName` (display name) — papai has no display-name slot. Dropped.
- `message.author.bot`, `message.author.system` — bot-origin messages are filtered out via an early `return` (`if (message.author.bot) return`) before mapping; never enter the pipeline.
- `message.author.avatar` — not modeled.
- `message.attachments`, `message.embeds`, `message.stickers` — Phase 2+.
- `message.guild`, `message.member`, `message.channel.parent` — not part of `IncomingMessage`.
- Pinned / forwarded / crossposted flags — not modeled.
- Discord `MessageType` variants other than `Default` and `Reply` — all other types (join notifications, thread starter, channel follow add, poll result, …) are ignored via a type filter at the top of the `onMessageCreate` handler.

## 5. New & changed code

### 5.1 Files added

| Path                                   | Purpose                                                                                                                                                                                                                                                                                                   |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/chat/discord/index.ts`            | `DiscordChatProvider` class: constructor, `registerCommand`, `onMessage`, `sendMessage`, `resolveUserId`, `start`, `stop`, private helpers for mapping + typing indicator                                                                                                                                 |
| `src/chat/discord/format.ts`           | `formatLlmOutput(markdown)`: normalize LLM markdown for Discord dialect (preserve **bold**, _italic_, `code`, `~~strike~~`, `> quote`, ` ``` ` fences, `[text](url)` links as-is; flatten markdown tables to pipe-separated plain text because Discord has no table support; chunk output to ≤2000 chars) |
| `src/chat/discord/format-chunking.ts`  | `chunkForDiscord(text, maxLen = 2000)`: splits on paragraph, sentence, and word boundaries without breaking code fences or inline code                                                                                                                                                                    |
| `src/chat/discord/map-message.ts`      | `mapDiscordMessage(message, client, adminUserId, cacheMessage)` → `IncomingMessage` (or null to skip)                                                                                                                                                                                                     |
| `src/chat/discord/mention-helpers.ts`  | `stripBotMention(content, botId)`, `isBotMentioned(message, botId, contextType)`                                                                                                                                                                                                                          |
| `src/chat/discord/reply-context.ts`    | `buildDiscordReplyContext(message, contextId)` — cache-first with REST fallback                                                                                                                                                                                                                           |
| `src/chat/discord/reply-helpers.ts`    | `createDiscordReplyFn({ channel, botMessageIdRef, replyToMessageId })` → `ReplyFn`                                                                                                                                                                                                                        |
| `src/chat/discord/buttons.ts`          | `toActionRows(buttons: ChatButton[])`, `dispatchButtonInteraction(interaction, handlers)` — used by `InteractionCreate` handler and the existing wizard/config-editor callback dispatch layer                                                                                                             |
| `src/chat/discord/typing-indicator.ts` | `withTypingIndicator(channel, fn)` — parallel to `src/chat/telegram/index.ts:282-293`; 4s interval                                                                                                                                                                                                        |

Total: **9 new `.ts` files** in `src/chat/discord/`.

### 5.2 Files modified

| Path                           | Change                                                                                                                                                                                                                                             |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/chat/types.ts`            | extend `ChatProvider.resolveUserId` signature to `(username, context: ResolveUserContext)`; export new `ResolveUserContext` type (`{ contextId: string; contextType: ContextType }`). Breaking change to the interface; absorbed by both adapters. |
| `src/chat/telegram/index.ts`   | accept the `_context` parameter in `resolveUserId` and ignore it; no behavior change                                                                                                                                                               |
| `src/chat/mattermost/index.ts` | accept the `_context` parameter in `resolveUserId` and ignore it; no behavior change                                                                                                                                                               |
| `src/commands/group.ts`        | `extractUserId(chat, input)` → `extractUserId(chat, input, context)` and thread `{ contextId: msg.contextId, contextType: msg.contextType }` in from `handleAddUser` / `handleDelUser`                                                             |
| `src/commands/help.ts`         | append a one-line "`/context` export is deferred on Discord" note when `chat.name === 'discord'` (see §13.2 Q3 resolution)                                                                                                                         |
| `src/chat/registry.ts`         | register `discord` factory                                                                                                                                                                                                                         |
| `src/index.ts`                 | extend `CHAT_PROVIDER` allowlist check to include `'discord'`; add provider-specific env-var block that requires `DISCORD_BOT_TOKEN` when `CHAT_PROVIDER=discord`                                                                                  |
| `package.json`                 | add `discord.js` runtime dependency (exact version pinned to a recent 14.x)                                                                                                                                                                        |
| `CLAUDE.md`                    | add Discord to the provider list in the Architecture section and to the Required Environment Variables section                                                                                                                                     |
| `.env.example`                 | append a new `# Discord` block at the bottom with `DISCORD_BOT_TOKEN=` (§13.2 Q4 resolution)                                                                                                                                                       |

### 5.3 Tests added

| Path                                         | Purpose                                                                                                                                                                                           |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/chat/discord/format.test.ts`          | markdown dialect normalization, chunking on paragraph/sentence/word boundaries, code-fence preservation                                                                                           |
| `tests/chat/discord/mention-helpers.test.ts` | strip `<@id>` / `<@!id>`, detection across DM vs guild channel                                                                                                                                    |
| `tests/chat/discord/map-message.test.ts`     | full Discord `Message` → `IncomingMessage` mapping; bot-origin filter; unsupported `MessageType` filter; DM vs guild channel; admin vs non-admin                                                  |
| `tests/chat/discord/reply-context.test.ts`   | cache-hit path, REST-fallback path, error path (fetch fails, returns skeleton)                                                                                                                    |
| `tests/chat/discord/reply-helpers.test.ts`   | `text` / `formatted` (with chunking) / `typing` / `redactMessage` / `buttons` — using mocked `channel` and `message` stubs                                                                        |
| `tests/chat/discord/buttons.test.ts`         | `ChatButton[]` → `ActionRow` builder; 100-char `custom_id` guard; 5-per-row + 5-row limits; interaction dispatch routes to cfg/wizard handlers the same way Telegram's `callback_query:data` does |
| `tests/chat/discord/index.test.ts`           | provider-level: constructor env validation, `registerCommand` routing, `onMessage` routing, command vs natural-language dispatch, mention-only guard in guild channels, start/stop lifecycle      |

Every test file imports its implementation via a `.js` extension (`../../../src/chat/discord/index.js`). Test-file naming mirrors the impl tree: `src/chat/discord/foo.ts` → `tests/chat/discord/foo.test.ts`, so the TDD hook pipeline's test-first gate resolves paths correctly.

## 6. Custom-field / bundle handling

**Not applicable.** This section exists in the brief template for task providers that have project-scoped enums (YouTrack state bundles, Kaneo project statuses). Chat providers do not have an equivalent. Explicitly N/A for this design.

## 7. Pagination strategy

Chat providers are primarily event-driven, so pagination shows up in only two places:

### 7.1 Reply-context parent fetch

Single `channel.messages.fetch(messageId)` call — not paginated. No cap needed beyond Discord's standard rate limit.

### 7.2 `resolveUserId(username, context)` guild-scoped member search

**Interface extension.** The existing `ChatProvider.resolveUserId(username)` signature is changed to accept the caller's message context, so that Discord's member search can be scoped to the guild where the `/group adduser @name` command was issued. This is the only way to correctly resolve a username on Discord: member search is guild-scoped by the Discord REST API and there is no global username directory.

```typescript
// src/chat/types.ts — extended signature (breaking change to the interface)
interface ChatProvider {
  // ...
  resolveUserId(username: string, context: ResolveUserContext): Promise<string | null>
}

export type ResolveUserContext = {
  contextId: string // storage key of the conversation issuing the lookup
  contextType: ContextType // 'dm' | 'group'
}
```

**Telegram** (`src/chat/telegram/index.ts`) and **Mattermost** (`src/chat/mattermost/index.ts`) accept the new parameter and ignore it — their implementations do not depend on guild scoping. The signature change is a two-line edit in each (parameter added, `_context` prefix to silence unused-var lint).

**Discord implementation:**

```typescript
async resolveUserId(
  username: string,
  context: ResolveUserContext,
): Promise<string | null> {
  const clean = username.startsWith('@') ? username.slice(1) : username
  if (/^\d+$/.test(clean)) return clean // already a snowflake

  // Guild-scoped resolution: look up the channel the caller is in,
  // then search members in THAT guild. This matches the user's intent
  // when they run `/group adduser @name` in a specific channel.
  const guildId =
    context.contextType === 'group'
      ? (this.client.channels.cache.get(context.contextId) as GuildTextBasedChannel | undefined)?.guildId
      : undefined

  if (guildId === undefined) {
    log.debug({ username: clean, context }, 'resolveUserId: no guild context, returning null')
    return null
  }

  const guild = this.client.guilds.cache.get(guildId)
  if (guild === undefined) return null

  try {
    const members = await guild.members.fetch({ query: clean, limit: 1 })
    return members.first()?.id ?? null
  } catch (error) {
    log.warn(
      { username: clean, guildId, error: error instanceof Error ? error.message : String(error) },
      'Discord member search failed',
    )
    return null
  }
}
```

**Caller update:** `src/commands/group.ts:111` `extractUserId(chat, input)` → `extractUserId(chat, input, { contextId: msg.contextId, contextType: msg.contextType })`. The `msg` is already in scope in `handleAddUser` and `handleDelUser`, so the threading is mechanical.

**DM semantics:** when a user runs `/group adduser @name` in a DM with the bot (rare — `group` commands are gated to `contextType==='group'` in `src/commands/group.ts:9-12`), the Discord implementation returns `null` because there is no guild context. This is a non-regression: the `group` command itself already rejects DM invocations before `extractUserId` is called.

**Cap:** `limit: 1`, single guild, single REST call per invocation. No iteration, no paging loop. Bounded.

### 7.3 What we do _not_ paginate

- No bulk channel history fetch.
- No guild enumeration.
- No channel enumeration.
- No role / member lists.

None of the `ChatProvider` methods require them.

## 8. Error classification

Chat adapters are "best effort" around I/O errors: most failures are swallowed with a `log.warn` and the bot continues, because a failed typing indicator or a failed `redactMessage` should not crash the whole conversation. Hard failures are reserved for startup and config errors.

| Scenario                                                           | HTTP / error source                                  | Adapter behavior                                                                                     | Log level |
| ------------------------------------------------------------------ | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | --------- |
| Missing `DISCORD_BOT_TOKEN`                                        | constructor check                                    | throw `Error('DISCORD_BOT_TOKEN environment variable is required')` — papai exits via `src/index.ts` | —         |
| Invalid bot token                                                  | `client.login()` rejects with `DiscordAPIError[401]` | rethrow from `start()` — papai startup fails fast                                                    | `error`   |
| Gateway disconnected mid-conversation                              | `Client` auto-resume fires                           | log the resume once; no user-visible error                                                           | `warn`    |
| Missing intent (privileged intent not enabled in portal)           | `client.login()` rejects with `DisallowedIntents`    | rethrow from `start()` with clear error message pointing to the Developer Portal toggle              | `error`   |
| Rate-limited by Discord REST                                       | `discord.js` REST manager auto-retries               | log via `client.rest.on('rateLimited')` once per window                                              | `warn`    |
| Attempt to reply, send fails (404 channel gone, 403 no permission) | `DiscordAPIError` from `channel.send`                | catch, log, do NOT throw — user sees nothing; the conversation turn is considered lost               | `warn`    |
| `redactMessage` fails (message deleted, permissions)               | `DiscordAPIError`                                    | catch, log, return (parallel to Telegram `src/chat/telegram/index.ts:370-376`)                       | `warn`    |
| `typing()` fails                                                   | any                                                  | swallowed at source; parallel to Telegram `src/chat/telegram/index.ts:367-369`                       | (silent)  |
| Schema mismatch on REST JSON                                       | N/A — `discord.js` parses internally                 | not our problem                                                                                      | —         |
| Malformed reply-context fetch                                      | `DiscordAPIError` from `channel.messages.fetch`      | log, return skeleton `{ messageId, chain, chainSummary }` with no text                               | `warn`    |

**No `AppError` mapping.** `src/errors.ts` defines `AppError` as the LLM-facing error union used by task tools — it is not used in chat adapters (Telegram and Mattermost don't emit `AppError`s either; search `src/chat/` for `AppError` confirms zero references). Chat adapter errors are either fatal (startup) or logged-and-dropped (runtime).

## 9. Auth & config

### 9.1 Required environment variables

| Variable            | Required when                | Purpose                                                                               |
| ------------------- | ---------------------------- | ------------------------------------------------------------------------------------- |
| `CHAT_PROVIDER`     | always                       | `'discord'`                                                                           |
| `ADMIN_USER_ID`     | always                       | Discord snowflake of the admin user. String (Discord snowflakes overflow JS `number`) |
| `DISCORD_BOT_TOKEN` | when `CHAT_PROVIDER=discord` | Bot token from Developer Portal → Application → Bot → Reset Token                     |
| `TASK_PROVIDER`     | always                       | existing, unchanged                                                                   |

Extend `src/index.ts` env validation:

```typescript
if (CHAT_PROVIDER !== 'telegram' && CHAT_PROVIDER !== 'mattermost' && CHAT_PROVIDER !== 'discord') {
  log.error({ CHAT_PROVIDER }, 'CHAT_PROVIDER must be either "telegram", "mattermost", or "discord"')
  process.exit(1)
}

if (CHAT_PROVIDER === 'discord') {
  const missingDiscord = ['DISCORD_BOT_TOKEN'].filter((v) => (process.env[v]?.trim() ?? '') === '')
  if (missingDiscord.length > 0) {
    log.error({ variables: missingDiscord }, 'Missing required Discord environment variables')
    process.exit(1)
  }
}
```

### 9.2 Per-user runtime config

**No new per-user config keys.** All per-user config (`llm_apikey`, `llm_baseurl`, `main_model`, `small_model`, `timezone`, task-provider-specific keys) is already shared across chat adapters and remains unchanged. The `/config` command output does not need to change.

### 9.3 Discord Developer Portal setup (documented in design, not in code)

1. Create an Application → name it.
2. Under **Bot**:
   - Click **Reset Token**, copy into `DISCORD_BOT_TOKEN`.
   - Disable **Public Bot** unless you want others to be able to invite it.
   - Enable **MESSAGE CONTENT INTENT** (privileged; see §3.4).
   - Leave **SERVER MEMBERS INTENT** and **PRESENCE INTENT** disabled.
3. Under **OAuth2 → URL Generator**:
   - Scopes: `bot`
   - Bot Permissions: `Read Messages/View Channels`, `Send Messages`, `Embed Links`, `Attach Files`, `Read Message History`, `Use External Emojis`, `Add Reactions` (future), `Use Application Commands` (disabled — slash commands are a non-goal)
4. Paste the generated URL into a browser and invite the bot to your guild.
5. Copy the bot's user snowflake into `ADMIN_USER_ID` (right-click the bot's name in Discord → Copy ID; requires Developer Mode in User Settings).

These steps go in a setup doc later, not in the source tree.

## 10. Capability / feature matrix

Discord maps fully onto the `ChatProvider` + `ReplyFn` surface. Deviations from 100% coverage are called out explicitly.

| Method / capability            | Status                                 | Notes                                                                                                                                                                                                                                                                                                                           |
| ------------------------------ | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ChatProvider.name`            | full                                   | `'discord'`                                                                                                                                                                                                                                                                                                                     |
| `ChatProvider.registerCommand` | full                                   | text-prefix `/foo` matching in the same pattern as Mattermost (`src/chat/mattermost/index.ts:228-238`)                                                                                                                                                                                                                          |
| `ChatProvider.onMessage`       | full                                   | single handler, called for all non-command messages after mention filter                                                                                                                                                                                                                                                        |
| `ChatProvider.sendMessage`     | full                                   | creates DM channel via `user.createDM()`, then `channel.send`                                                                                                                                                                                                                                                                   |
| `ChatProvider.resolveUserId`   | partial (context-scoped)               | Takes new `ResolveUserContext` argument (§7.2). When `contextType='group'`, looks up the channel → derives guild → single member search in that guild. When `contextType='dm'`, returns `null` (group command is already gated to guild channels in `src/commands/group.ts:9-12`). Interface change is adopted by all adapters. |
| `ChatProvider.start`           | full                                   | `client.login(token)`, awaits `ready` event, populates `botUserId` + `botUsername`                                                                                                                                                                                                                                              |
| `ChatProvider.stop`            | full                                   | `client.destroy()`                                                                                                                                                                                                                                                                                                              |
| `ReplyFn.text`                 | full                                   | `channel.send({ content })` with chunking on 2000-char overflow                                                                                                                                                                                                                                                                 |
| `ReplyFn.formatted`            | full                                   | LLM markdown → Discord dialect via `format.ts`, chunking preserved                                                                                                                                                                                                                                                              |
| `ReplyFn.file`                 | **throws in Phase 1**                  | Plan ships `ReplyFn.file` that throws `Error('Discord file send not implemented — defer to Phase 2')`. Known breakage: `/context` admin command will fail on Discord; design doc §13 risk item                                                                                                                                  |
| `ReplyFn.typing`               | full                                   | `channel.sendTyping()` + 4500ms interval re-trigger inside `withTypingIndicator` wrapper                                                                                                                                                                                                                                        |
| `ReplyFn.redactMessage`        | full                                   | `message.edit({ content: replacement, components: [] })` on the bot's last outgoing message                                                                                                                                                                                                                                     |
| `ReplyFn.buttons`              | **full** (improvement over Mattermost) | `ActionRowBuilder` + `ButtonBuilder`; `primary→Primary`, `secondary→Secondary`, `danger→Danger`; click events dispatched via `Events.InteractionCreate` through the same cfg/wizard handler fan-out Telegram uses. Unlike Mattermost, Discord has no webhook-handler gap — buttons are click-functional on day one              |
| Reply chains / `replyContext`  | full                                   | `message.reference.messageId` + shared `buildReplyContextChain`                                                                                                                                                                                                                                                                 |
| `IncomingMessage.files`        | deferred                               | stays `undefined` in Phase 1                                                                                                                                                                                                                                                                                                    |
| `IncomingMessage.isMentioned`  | full                                   | true in DMs always, true in guild channels only when `<@botId>` present                                                                                                                                                                                                                                                         |
| `IncomingMessage.messageId`    | full                                   | `message.id`                                                                                                                                                                                                                                                                                                                    |

## 11. Phased rollout

### Phase 1 — thin vertical slice (MVP, this plan)

End-to-end proof: auth → receive a guild @mention → run a command → get a formatted reply → click a button. This must work on day one:

1. `DiscordChatProvider` class scaffold with constructor env check, `start()`, `stop()`.
2. `messageCreate` handler end-to-end for DMs (happy path).
3. Guild channel @mention detection + `contextType='group'` routing.
4. Command dispatch (`matchCommand` on stripped content).
5. `text` and `formatted` reply via chunked send.
6. `typing` indicator wrapper.
7. `redactMessage` wired via `message.edit`.
8. `buttons` wired via `ActionRowBuilder` + `InteractionCreate` handler.
9. `resolveUserId` best-effort, single-guild.
10. `sendMessage` for version-announcement DMs.
11. Registry registration.
12. Env validation in `src/index.ts`.
13. Full unit test coverage of mapping, mention stripping, chunking, buttons, reply context, reply helpers.

**Phase 1 shipping criterion:** `CHAT_PROVIDER=discord bun start` runs, the bot comes online, a `/help` in a DM returns the same help text Telegram users see, an `@bot /help` in a guild channel returns the same help text, a `/config` command renders its buttons and a click routes through the config-editor callback handler, and `bun test` stays green.

### Phase 2 — file support + edit / delete events

- `ReplyFn.file`: `channel.send({ files: [new AttachmentBuilder(buffer, { name })] })`. Removes the `/context` admin-command breakage.
- Incoming `IncomingFile` population from `message.attachments` with CDN download.
- `messageUpdate` → cache update, optional re-dispatch (behind a feature flag).
- `messageDelete` → cache eviction.
- Rollback posture: each phase-2 item is independently revertible by removing its handler; no Phase 1 code depends on Phase 2.

### Phase 3 — quality-of-life (optional)

- Per-guild allowlist / multi-guild authorization opt-in.
- Channel-specific command menus (parallel to Telegram's `setCommands()` per chat type).
- Embed-based rich replies for long structured output.
- `client.rest.on('rateLimited', ...)` hooked into the debug dashboard's SSE event bus.

Phase 3 is out of scope for the implementation plan produced alongside this design doc. It is sketched here so the design does not paint itself into a corner.

## 12. Testing strategy

### 12.1 Unit tests

Use Bun's built-in test runner. Follow `tests/CLAUDE.md` conventions:

- `mock.module()` goes inside `beforeEach`, never at the top level, to avoid mock pollution.
- `mockLogger()` from `tests/utils/test-helpers.ts` is called in `beforeEach` for every test file.
- Reuse `createMockReply()`, `createDmMessage()`, `createGroupMessage()` from `tests/utils/test-helpers.ts` wherever the test doesn't need Discord-specific behavior.

For Discord-specific behavior, build **hand-rolled stub objects** rather than pulling in a heavyweight `discord.js` mock — tests should be pure and fast. Example stub for a `Message`:

```typescript
const fakeMessage = {
  id: 'msg_1',
  author: { id: 'user_1', username: 'alice', bot: false, globalName: 'Alice' },
  content: '<@bot_id> /help',
  channel: { id: 'chan_1', type: ChannelType.GuildText, sendTyping: () => Promise.resolve() },
  mentions: { has: (id: string) => id === 'bot_id' },
  reference: null,
  attachments: new Map(),
} as unknown as Message
```

The `as unknown as Message` cast is the only acceptable use of a cast here; it is the test-boundary equivalent of what Telegram tests do with their `Context` stubs. Production code never uses unsafe casts per papai CLAUDE.md.

### 12.2 Mutation testing (Stryker)

All Phase 1 tasks are designed so Stryker mutants are caught:

- Mention-strip regex has a dedicated test with positive and negative cases.
- Chunking has boundary tests (exactly 2000 chars, 2001, 3999, 4000, 4001) — mutation of `<` vs `<=` will be caught.
- `isMentioned` for DMs is exercised in a `contextType='dm'` test that would fail if the hard-coded `true` were mutated.
- `matchCommand` tests cover exact match `/help`, match with args `/help foo`, and non-match `/helpless` — mutations of the match predicate fail.

No task should need `TDD_MUTATION=0` as an escape hatch. If one does, it is flagged in the implementation plan with a one-sentence justification.

### 12.3 E2E

No automated E2E in Phase 1. Manual E2E checklist (documented in the implementation plan's Phase 1 shipping task):

1. Run against a real test guild.
2. DM the bot, run `/help`, verify formatted reply.
3. @mention the bot in a guild channel, run `/config`, click a button, verify the response routes through the config editor.
4. Post a `/clear` and verify the confirmation button round-trips.
5. Verify `bun test` is green and `bun typecheck` / `bun lint` / `bun format:check` are clean.

A future Phase 2 task can add a Docker-based Discord mock (there is no official one; candidates include `@skyra/discord-proxy` or a handwritten stub WebSocket server). For Phase 1 we do not invest in that.

## 13. Risks & open questions

### 13.1 Risks

| Risk                                                                                                | Likelihood  | Mitigation                                                                                                                                                                                                                                            |
| --------------------------------------------------------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MessageContent` intent enabled but Developer Portal toggle forgotten by operator                   | medium      | §3.4 is ratified. `client.login()` rejects with `DisallowedIntents` when the toggle is off; §8 escalates this to `log.error` with a message pointing at the exact Developer Portal page, and `start()` rethrows so the bot exits fast                 |
| `discord.js` major-version breakage (e.g. v15) between design and execute                           | low         | pin exact version in `package.json` (`"discord.js": "14.25.1"` or latest 14.x); version lock is an explicit Phase 1 task                                                                                                                              |
| `/context` admin command broken on Discord in Phase 1                                               | **certain** | documented in §10; `ReplyFn.file` throws a clear error. Admin users are warned at `/help` (conditional line added only when provider is Discord). Phase 2 fixes permanently                                                                           |
| Button `custom_id` overflow (existing callback data > 100 chars)                                    | low         | add a `custom_id` length guard in `src/chat/discord/buttons.ts` that throws at build time (not runtime). Existing Telegram/Mattermost callback data is always short (`cfg:edit:key`, `wiz:step:N`), but the guard protects against future regressions |
| Gateway zombied connection                                                                          | low         | `discord.js` Client auto-resumes; document in comments that no manual heartbeat code is needed                                                                                                                                                        |
| Username collisions post-pomelo (`message.author.username` can conflict across old-format accounts) | low         | existing `resolveUserId` is best-effort; if a non-unique username is passed, return the first match. Document in user-facing help that numeric IDs are more reliable                                                                                  |
| Chunking splits mid-code-fence                                                                      | medium      | test coverage explicitly checks this — chunking must either include the closing fence in the same chunk or emit a synthetic close + re-open pair                                                                                                      |
| Discord 2000-char limit narrowing (e.g. requiring Nitro for >N)                                     | low         | hard-code 2000 via const; re-verify in the Phase 2 plan                                                                                                                                                                                               |
| Tests import `discord.js` at top level → slow `bun test`                                            | medium      | Tests import only types from `discord.js` (`type Message, ChannelType, ButtonStyle`) and build stubs. No runtime SDK import in the test tree                                                                                                          |

### 13.2 Open questions — all resolved at 2026-04-09 design review

1. ✅ **Ratify `MessageContent` intent revision (§3.4).** Ratified. Request the intent; operator enables it in Developer Portal.
2. ✅ **`resolveUserId` scope.** Resolved with an interface extension rather than a scope cap: the method now takes a `ResolveUserContext` parameter so Discord can scope to the caller's current guild. Telegram/Mattermost ignore the argument. See §7.2, §5.2, §10.
3. ✅ **Help-text note for `/context` breakage.** Append a one-line note to `/help` when `chat.name === 'discord'`: _"Note: `/context` export is deferred to Phase 2 on Discord."_ Change lives in `src/commands/help.ts`.
4. ✅ **`.env.example` ordering.** `DISCORD_BOT_TOKEN` gets its own `# Discord` block appended at the bottom of the file. Telegram and Mattermost blocks are unchanged.

## 14. Non-goals

Copied verbatim from the direction brief, slightly expanded:

- Discord application (slash) commands. Text-prefix commands only, post-mention-strip. The bot does _not_ register `/help` etc. as Discord application commands.
- Message reactions, threads, voice, and stage channels. `Events.MessageReactionAdd`, `ThreadCreate`, `VoiceStateUpdate`, `StageInstanceCreate` are not listened for. Threads are treated the same as any non-supported channel type and ignored.
- OAuth2 user install. No OAuth endpoint, no user-delegated scopes, no refresh tokens.
- Multi-tenant Application support. papai runs as a single bot user per deployment.
- Incoming file uploads (`IncomingFile` population) in Phase 1. Outgoing `ReplyFn.file` throws in Phase 1.
- Per-guild authorization or role-aware admin detection. Global `ADMIN_USER_ID` + `src/users.ts` allowlist is unchanged.
- Sharding. papai is a personal bot; <2500 guilds is always single-shard and `discord.js` handles it automatically.
- Activity presence / status text. The bot does not set a presence.
- Any form of `MessageDelete` auditing beyond the in-Phase-2 cache-eviction handler.
- Migration tooling from Telegram/Mattermost users to Discord users. Each user is identified only within the platform they're talking to.

---

## Self-review checklist (per the brief's quality bar)

- [x] Every claim about Discord cites an official doc URL or a context7 library result.
- [x] Every claim about papai cites a `path:line` in the repo.
- [x] Every `ChatProvider` method and `ReplyFn` method is addressed in §10.
- [x] No `IncomingMessage` extension is proposed (the existing fields cover Discord cleanly; Discord-only data stays in the adapter or is dropped).
- [x] Phase 1 is a thin end-to-end slice (auth + DM message + guild @mention + buttons), not a horizontal layer.
- [x] Pagination is bounded (§7: single REST call per `resolveUserId`, single REST call per reply-context fallback, no loops).
- [x] Error classification covers auth / intent / rate-limit / send-failure / edit-failure / typing-failure.
- [x] Logging conventions follow `src/chat/CLAUDE.md`: `log.debug` on entry, `log.info` on success, `log.warn` on recoverable failures, `log.error` with `error instanceof Error ? error.message : String(error)`, never `!!param`, never log the bot token.
- [x] Revision to the direction brief (`MessageContent` intent) is flagged explicitly in §3.4 and gated on an open question at §13.2.
- [x] All dates are absolute.
- [x] `context7` was called for discord.js v14 guide and v14.25.1 reference (cited in-line).
- [x] No file paths outside `src/`, `client/`, `tests/`, `docs/`.
- [x] User is asked to resolve the 4 open questions at §13.2 before the implementation plan is written.

## Next step

All open questions resolved (§13.2). The `designing-new-provider` skill now moves to Step 6: write `docs/plans/2026-04-09-discord-implementation.md` via the `writing-plans` sub-skill.
