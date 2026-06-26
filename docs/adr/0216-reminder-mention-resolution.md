<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0216: Reminder Mention Resolution

## Status

Implemented

## Date

2026-06-21

## Context

`create_deferred_prompt`'s `delivery.mention_user_ids` field expects **chat platform user IDs**, and `buildDeliveryInput` stores the array verbatim — the three fire paths (Telegram, Discord, Mattermost) consume raw IDs with no name→ID resolution at creation time. Every chat adapter implements `ChatProvider.resolveUserId` and `ChatRouter` delegates it, but **no LLM tool wrapped it**. The existing `find_user` tool resolves **task-tracker** users, whose IDs are useless for chat mentions. The `GROUP_DEFERRED` system prompt told the LLM to put user IDs in `mention_user_ids` but gave it no mechanism to obtain them, so the model fell back to the "ask ONE short question" bullet and asked _who_ to mention even for an unambiguous "remind Alice at 9am".

A pure username-API tool was rejected up front because Telegram's `resolveUserId` is built on `getChat('@username')`, which cannot resolve private accounts — the platform most affected by the bug. The reliable population is people the bot already knows: the curated `group_members` of the group plus the distinct recent senders recorded in `message_metadata`.

## Decision Drivers

- **Reliability on Telegram**: a resolver must not depend on the username API, which silently fails for private accounts.
- **No chat handle in tools today**: tools receive a `TaskProvider` but no `ChatProvider`/`ChatRouter`; the roster's `resolveUserLabel` lives on the chat side and must reach the tool without leaking the whole router.
- **Deterministic ranking**: the model needs a small ranked candidate list it can act on (take the top entry, or ask one disambiguating question), not a guess.
- **Group-only, DI-testable**: the tool must be absent in DMs and when no resolver is injected, and the resolver must be injectable in tests without a live `ChatRouter`.
- **Scope model**: `group_members` is group-shared while `message_metadata` is thread-scoped; member lookup must use the group-level context id even when the message arrived on a thread.
- **Reuse beyond reminders**: the same lookup serves any time the model needs a chat user ID for a named person in a group, not just `create_deferred_prompt`.

## Considered Options

### Option A — Username-API tool wrapping `ChatProvider.resolveUserId`

- Pros: thin; reuses existing adapter capability; one round-trip.
- Cons: unreliable on Telegram (private accounts unresolvable); useless for users known only by display name; no ranked fallback when the API returns nothing.

### Option B — Participant roster (`group_members` ∪ `message_metadata` senders) with server-side fuzzy ranking

- Pros: works without any public username; degrades gracefully (username/ID labels when `resolveUserLabel` is null); deterministic exact>prefix>substring ranking with a stable tie-break; covers people the bot has only _seen_, not just curated members.
- Cons: bounded recall (only known people); `message_metadata` TTL means stale senders drop out; needs a label-resolution hop per candidate.

### Option C — Hybrid (roster first, username-API fallback)

- Pros: maximum recall.
- Cons: doubles the plumbing surface; the API fallback reintroduces the Telegram unreliability the roster was chosen to avoid, with no clean way to report "unresolvable" vs "not found". Rejected for v1.

## Decision

Adopt **Option B**: a provider-agnostic roster service plus a group-only `resolve_chat_participant` tool, fed by a narrowly injected `chatParticipantResolver` bound to the `ChatRouter`.

### 1. Roster service — `src/chat/participants/roster.ts`

`gatherParticipants(contextId)` returns the union of `group_members` (looked up via the **group-level** context id from `getConfigContextIdFromStorageContextId`) and distinct `authorId`/`authorUsername` from `message_metadata(contextId)`, deduped by `userId` (member row's username falls back to the metadata row's). `resolveChatParticipant(contextId, query, resolveLabel, limit)` resolves each candidate's display name with `resolveLabel` under `p-limit(8)`, falls back `resolveLabel → authorUsername → userId` (label errors are caught), and ranks with `computeScore`: case-insensitive exact (3) > prefix (2) > substring (1) > none (0), tie-broken alphabetically by `userId` for determinism. Returns the top-N (default 5) `{ userId, displayName, username, score }` candidates.

### 2. Tool — `src/tools/resolve-chat-participant.ts`

`makeResolveChatParticipantTool(resolver, contextId)` builds `resolve_chat_participant` with input `{ query: string, limit?: number }` and an execute that forwards to the resolver. Risk class **`read('collaboration')`** in `src/tools/tool-metadata.ts` (so the `read-only` preset keeps it available); subject to `tool_prefs` like any tool. The description instructs the model to use it before populating `delivery.mention_user_ids` and to ask ONE targeted question when no confident match is found.

### 3. Plumbing the resolver — narrow injected dependency

Tools receive a `ChatParticipantResolver` **function**, not the `ChatRouter`. It is threaded through every layer so the cache key and gating reflect its presence:

- `src/tools/types.ts` — `chatParticipantResolver?` added to `MakeToolsOptions`.
- `src/tools/tools-builder.ts` — `BuilderArgs` extended with the resolver as arg 4; the tool is registered **only** when `contextType === 'group' && chatParticipantResolver !== undefined && contextId !== undefined`.
- `src/tools/index.ts` — `makeTools` forwards `options.chatParticipantResolver` to `buildTools`.
- `src/llm-orchestrator-types.ts` — `chatParticipantResolver?` added to `LlmOrchestratorDeps`.
- `src/llm-orchestrator-tools.ts` — `getOrCreateDescriptors` takes the resolver; the descriptor cache key gains a `resolverScope` segment (`no-resolver`/`with-resolver`) so a context with and without a resolver never share a stale descriptor; `LlmInvocationOptions` carries it.
- `src/llm-orchestrator.ts` — `callLlm` spreads `deps.chatParticipantResolver` into the invocation opts.
- `src/bot.ts` — `chatParticipantResolver?` added to `BotDeps` and passed through `processCoalescedMessage`.
- `src/index.ts` — the resolver is constructed inline, bound to `chatRouter.resolveUserLabel(userId, { contextType:'group', contextId, platformInstanceId })`, and passed into the bot deps.

### 4. Group prompt — explicit population procedure

`GROUP_DEFERRED` (now in `src/system-prompt-group.ts`) spells out the decision procedure: "remind me" → omit `mention_user_ids`; "remind us/everyone" → `[]`; **named people → for each name call `resolve_chat_participant`, take the top candidate's `userId`, collect into `mention_user_ids`, resolve all names before creating**; no match → ask one specific question; ambiguous → name the top candidates in one question and wait. A general "USER IDs IN THIS GROUP" line makes the tool usable for any chat-user-ID need, not only reminders.

## Consequences

### Positive

- "remind Alice at 9am" no longer asks _who_ Alice is when she is a known member or recent sender; the model populates `mention_user_ids` itself.
- Works on Telegram without relying on the username API, so private accounts are resolved as long as they are in the roster.
- Graceful degradation: when `resolveUserLabel` is null (e.g. Kontur Talk echoes the userId), the roster falls back to username/ID labels rather than failing.
- The injected-resolver seam keeps tools decoupled from `ChatRouter` and makes the gating unit-testable with a fake resolver.
- The `resolverScope` cache-key segment prevents stale tool descriptors from leaking across resolver presence.
- `read` risk keeps the tool available under the `read-only` preset.

### Negative

- **Bounded recall.** Only curated members and recently-seen senders are resolvable; a person who has never spoken in the group and is not a member cannot be mentioned by name. The model is directed to ask a clarifying question in that case rather than guess.
- **`message_metadata` TTL.** Expired senders drop out of the roster; `group_members` still covers curated members, so recall is reduced, not silently masked.
- **Extra label-resolution hop.** Every candidate triggers a `resolveUserLabel` call (bounded by `p-limit(8)`); for large rosters this is non-trivial, though cached at the provider layer.
- **Display-name matching can fail on Kontur Talk.** With no real names, matching falls to username/ID, so the model may ask where another platform would resolve. Documented platform limitation, not a regression.

### Risks

- **Stale descriptors** if a future change forgets the `resolverScope` cache segment — guarded by the plumbing test that asserts the tool is absent/present by resolver presence.
- **Prompt drift** — the procedure lives in a string constant; a future edit that drops the "resolve all names before creating" line would reintroduce the original bug. Guarded by the system-prompt fragment assertion test.

## Related Decisions

- ADR-0191: Telegram Username Resolution — the platform unreliability that motivated the roster over a username-API tool.
- ADR-0116: Deferred-Prompt Delivery Redesign — the `delivery.mention_user_ids` field this tool populates.
- ADR-0161: Storage Context Sharing — the group-shared/thread-isolated scope model; member lookup uses the group-level context id.
- ADR-0126: Multi-Provider Phase 3 — Chat Router — `ChatRouter.resolveUserLabel`, the capability the resolver binds to.
- ADR-0141: User-Configurable Tool Access — the `read` risk class and `tool_prefs` gating the tool is subject to.
- ADR-0215: Kaneo Group-Member Provisioning — the explicitly independent sibling spec (task-tracker assignees, not chat mentions; shares no code path).

## Implementation Notes

All referenced files are present and confirmed:

- `src/chat/participants/roster.ts` — exports `ResolveUserLabelFn`, `ParticipantCandidate`, `ChatParticipantResolver`, `gatherParticipants` (synchronous), `computeScore`, `resolveChatParticipant`.
- `src/tools/resolve-chat-participant.ts` — `makeResolveChatParticipantTool`.
- `src/tools/tool-metadata.ts:132` — `resolve_chat_participant: read('collaboration')`.
- `chatParticipantResolver` threaded through `src/tools/types.ts`, `src/tools/tools-builder.ts`, `src/tools/index.ts`, `src/llm-orchestrator-types.ts`, `src/llm-orchestrator-tools.ts` (cache key + `LlmInvocationOptions`), `src/llm-orchestrator.ts`, `src/bot.ts` (`BotDeps`), and constructed in `src/index.ts` bound to `chatRouter.resolveUserLabel`.
- `src/system-prompt-group.ts` — `GROUP_DEFERRED` with the resolve_chat_participant procedure, gated on the enabled tool set.

Divergences from the plan, both improvements:

1. `GROUP_DEFERRED` was extracted to a dedicated `src/system-prompt-group.ts` (the plan placed it in `src/system-prompt.ts`) and the resolve_chat_participant bullets are **gated on the enabled tool set** rather than always appended, so the procedure only appears when the tool is actually available.
2. `gatherParticipants` is **synchronous** (returns `RawCandidate[]`); the plan's draft marked it `async`. Drizzle's `.all()` is synchronous under Bun's sqlite, so the await in tests is a no-op and the public `resolveChatParticipant` contract is unchanged.
3. `src/index.ts` constructs the resolver **inline** rather than via a `makeChatParticipantResolver` factory; behavior is identical.
