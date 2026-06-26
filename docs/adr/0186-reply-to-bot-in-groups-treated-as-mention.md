<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0186: Reply-to-Bot in Groups Treated as Mention

## Status

Implemented

## Date

2026-06-08

## Context

In group chats, papai only processed a message when the bot was explicitly `@mentioned` (or it was a command). A user who used the platform's native "Reply" action on one of the bot's own messages — without also `@mentioning` — was silently dropped. Replying to a message is already a clear intent signal, so dropping a follow-up to a just-sent answer was poor UX, especially for chained questions inside a busy group.

The group-message gate (`!msg.isMentioned`) was duplicated across three sites — the ignore filter, the queue policy, and group observation — so any fix had to touch all three or behavior would diverge: a reply-to-bot message could be processed yet never recorded in the group-settings/identity registries. Telegram exposes the parent author synchronously via Grammy's `reply_to_message`; Discord's two-stage flow builds the `IncomingMessage` synchronously and fetches reply context later, so the hard group filter ran before the bot could know who the parent author was.

Scope was deliberately limited to Telegram and Discord — the two platforms with a distinct per-message reply action carrying a parent author id. Mattermost threads and Kontur Talk's message-thread scope have no comparable reply-to-message path and were excluded. The behavior is always-on with no per-context config toggle.

## Decision Drivers

- **UX determinism**: replying to a bot message should be treated as intent to address the bot, without a redundant `@mention`.
- **Gate consistency**: the three duplicated `!isMentioned` sites must change in lockstep so processing, queueing, and group observation stay aligned.
- **Provider scope discipline**: only platforms with a real reply-to-message action (Telegram, Discord) change; Mattermost/Kontur Talk stay untouched and `isReplyToBot` stays `undefined` there.
- **No new config surface**: always-on, no per-context toggle, keeping the group-mention contract simple.
- **Minimal cost on the hot path**: the Discord parent pre-fetch must be skipped when the bot is already `@mentioned` or in a DM.
- **Authorization stays mention-gated**: an unauthorized user replying to the bot must not gain a way to provoke a reply notice (the unauthorized-notice path remains `isMentioned`-only).

## Considered Options

### Option A: `isReplyToBot` on `IncomingMessage`, set in adapters, folded into the existing group gates (chosen)

- **Pros**: reuses the existing mention gate with no new routing pathology; the optional field degrades cleanly (`undefined` on Mattermost/Kontur Talk is treated as not-a-reply); Telegram needs no extra fetch — the parent author is already in the Grammy context.
- **Cons**: Discord pays a second parent REST fetch (pre-fetch for detection plus the later fetch for reply-context enrichment); three gate sites must be kept in sync (the observation site is easy to miss).

### Option B: Treat any reply in a group as addressed-to-bot regardless of parent author

- **Pros**: no parent fetch on Discord; simplest.
- **Cons**: a reply to another human would be hijacked into a bot turn — wrong, noisy, and a UX/privacy regression. Rejected.

### Option C: Per-context config toggle for reply-to-bot processing

- **Pros**: operator control.
- **Cons**: adds a settings surface for a near-universal UX win and widens the test/permission matrix. Rejected in favor of always-on.

## Decision

Six coordinated changes implement the feature:

### 1. `isReplyToBot?: boolean` on `IncomingMessage` (`src/chat/types.ts:156`)

Added inside the `Partial` block of `IncomingMessage`. Optional; absent (`undefined`) on Mattermost/Kontur Talk.

### 2. Three group gates updated in lockstep, all `undefined`-safe

- `shouldIgnoreGroupMessage()` (`src/bot.ts:163`): `return !msg.isMentioned && msg.isReplyToBot !== true`
- `willQueueAuthorizedMessage()` (`src/chat/queue-policy.ts:14`): `return msg.isMentioned || msg.isReplyToBot === true`
- `recordGroupObservation()` (`src/bot-group-observation.ts:17`): early-return guard gains `&& msg.isReplyToBot !== true`

The gates use `!== true` / `=== true` consistently rather than `!` / truthy, so `undefined` is explicitly treated as not-a-reply. `willQueueAuthorizedMessage` lives in the dedicated `src/chat/queue-policy.ts` module (imported by `bot.ts`), not inline in `bot.ts`.

### 3. Telegram adapter sets `isReplyToBot` in `extractMessage()` (`src/chat/telegram/index.ts:201`)

Computed from the already-built `replyContext` — `replyContext?.authorId !== undefined && String(ctx.me.id) === replyContext.authorId` — and included in the returned `IncomingMessage`. No extra fetch: Grammy's `ctx.me` and `reply_to_message.from.id` are already present.

### 4. Discord `mapDiscordMessage()` gains the parameter and relaxes its filter (`src/chat/discord/map-message.ts`)

New `isReplyToBot = false` parameter; the hard group filter becomes `if (contextType === 'group' && !mentioned && !isReplyToBot) return null`; `isReplyToBot` is included in the returned `IncomingMessage`; the `CHANNEL_TYPE_DM` constant is exported for reuse.

### 5. Discord `dispatchMessage()` pre-fetches the parent to detect bot authorship (`src/chat/discord/index.ts`)

A module-level helper `resolveIsReplyToBot(message, botId, mentioned)` (lines 59-78) pre-fetches the parent only when `reference.messageId` is set, the channel is not a DM, and the bot is not already mentioned; on fetch failure it logs a structured `warn` and returns `false`. `dispatchMessage()` (lines 257-261) computes `mentioned` first, calls `resolveIsReplyToBot`, then passes the result to `mapDiscordMessage()`. The pre-fetch is guarded against `channel.messages === undefined` so it typechecks against the optional client-factory surface.

### 6. Documentation notes the new equivalence

`src/chat/CLAUDE.md` and root `CLAUDE.md` record that Telegram and Discord treat a reply to the bot's own message in a group as equivalent to an `@mention` (Mattermost/Kontur Talk excluded).

## Consequences

### Positive

- Replying to a bot message in a Telegram/Discord group now triggers processing without a redundant `@mention` — the primary UX win.
- All three gate sites change together, so a reply-to-bot user is processed, queued, and observed consistently (visible in the settings-UI group admin/user registries and identity mapping).
- Optional `isReplyToBot` degrades cleanly: Mattermost/Kontur Talk are untouched and the gates treat `undefined` as not-a-reply.
- The Discord pre-fetch is skipped on the common hot path (already-mentioned or DM), so the extra REST call lands only on the newly-processed reply-without-mention path.
- Bot-self-reply loops are impossible: both adapters drop bot-authored messages before this code runs (Grammy filter; Discord `author.bot` check).

### Negative

- Discord fetches the parent twice for a reply-to-bot message (once for `resolveIsReplyToBot`, again inside `buildDiscordReplyContext` for prompt enrichment). Deliberately accepted; the pre-fetch needs only `author.id` and is skipped when mentioned. A later optimization can thread the already-fetched parent into the reply-context builder.
- One extra REST call per unmentioned group reply adds latency and a bounded rate cost on a path that previously dropped the message. Failures degrade gracefully to requiring `@mention`.

### Risks

- The three-site gate duplication remains; a future gate added elsewhere could forget `isReplyToBot` and reintroduce divergence. Mitigated today by the observation-site test.
- An unauthorized user replying to the bot is dropped silently (the unauthorized-notice path is still `isMentioned`-only, intentionally, so reply-to-bot is not a way to provoke a notice). Behavior is deliberate; if it surprises users it may need a docs note.
- A Discord parent fetch that fails (deleted/edited parent, rate limit) silently falls back to `isReplyToBot: false`; such a message reverts to requiring `@mention` with no user-visible explanation.

## Related Decisions

- ADR-0140: Kontur Talk Chat Provider — the chat-provider model this feature slots into; confirms the provider-scoped exclusion (Kontur Talk unaffected).
- ADR-0163: Mattermost Mention-Prefixed Command Syntax — the group-mention contract this extends with a reply-as-mention equivalence.
- ADR-0161: Storage Context Sharing (Group Thread Entities) — the thread-isolated vs group-shared scope model; reply-to-bot processing inherits the same group-context gating and observation registry.

## Implementation Notes

Key files, confirming presence in the shipped code:

- `src/chat/types.ts:156` — `isReplyToBot: boolean` in the `Partial` block of `IncomingMessage`.
- `src/bot.ts:160-164` — `shouldIgnoreGroupMessage()` returns `!msg.isMentioned && msg.isReplyToBot !== true`.
- `src/chat/queue-policy.ts:10-14` — `willQueueAuthorizedMessage()` returns `msg.isMentioned || msg.isReplyToBot === true` (imported by `bot.ts:21`).
- `src/bot-group-observation.ts:17` — `recordGroupObservation()` early-return guard includes `msg.isReplyToBot !== true`.
- `src/chat/telegram/index.ts:201,215` — `extractMessage()` sets `isReplyToBot` from `replyContext.authorId` vs `ctx.me.id` and includes it in the returned `IncomingMessage`.
- `src/chat/discord/map-message.ts:26,36,51,72` — exports `CHANNEL_TYPE_DM`; adds `isReplyToBot = false` parameter; relaxes the group filter; includes `isReplyToBot` in the return.
- `src/chat/discord/index.ts:37,59-78,257-261` — imports `CHANNEL_TYPE_DM`; defines `resolveIsReplyToBot()` (parent pre-fetch with structured `log.warn` on failure, DM/mention short-circuit, `messages === undefined` guard); `dispatchMessage()` computes `mentioned`, resolves `isReplyToBot`, then maps.
- `src/chat/CLAUDE.md` and root `CLAUDE.md` — document the reply-to-bot equivalence for Telegram and Discord.

Divergences from the plan/spec, confirmed in code:

- `willQueueAuthorizedMessage` lives in `src/chat/queue-policy.ts`, not inline in `src/bot.ts` as the plan described.
- Discord detection is a named `resolveIsReplyToBot()` helper with structured logging, not an inline `try/catch` with a bare comment.
- Gates use `!== true` / `=== true` rather than `!` / truthy (semantically equivalent for `boolean | undefined`).
- Telegram uses `ctx.me.id` (Grammy guarantees `ctx.me` is populated) rather than the plan's `ctx.me?.id`.
