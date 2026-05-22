<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Discord Capability Alignment Design

**Date:** 2026-04-11
**Status:** Approved
**Scope:** Bring `DiscordChatProvider` into conformance with the provider capability architecture shipped in PR #90. Narrow remediation only — no new feature work, no cross-provider refactors, no plugin-system changes.
**Supersedes nothing.** Complements `docs/superpowers/specs/2026-04-10-provider-capability-architecture-design.md`.

## Problem Statement

The provider capability architecture (`2026-04-10-provider-capability-architecture-design.md`) was designed and implemented on a branch that did not yet have `DiscordChatProvider`. Discord was scaffolded in parallel and retrofitted onto the new chat-capability types, but the retrofit left four concrete gaps:

1. **Declared capabilities contradict the implementation.**
   - `discordCapabilities` advertises `messages.files` (`src/chat/discord/metadata.ts:6`), but `createDiscordReplyFn().file()` throws `"Discord file send not implemented — deferred"` (`src/chat/discord/reply-helpers.ts:64`). A caller that honestly gates on the capability still crashes.
   - It advertises `files.receive`, but `mapDiscordMessage` never populates `msg.files` (`src/chat/discord/map-message.ts`). Files are silently dropped.
   - It does **not** advertise `messages.redact`, yet `redactMessage` is fully implemented via discord.js `edit()` in `reply-helpers.ts:70`. The capability is usable but invisible to consumers.

2. **Discord bypasses the shared interaction router.** Telegram routes button callbacks through `src/chat/interaction-router.ts` via the `chat.onInteraction(...)` hook registered in `src/bot.ts:221`. Discord does not register an `onInteraction` handler at all. Instead, `DiscordChatProvider.handleButtonInteraction` (`src/chat/discord/index.ts:191`) invokes its own `handleConfigEditorCallback` / `handleWizardCallback` in `src/chat/discord/handlers.ts` — a near-duplicate of the shared router's `defaultHandleConfigInteraction` / `defaultHandleWizardInteraction`. Any future interaction domain (e.g. `plugin_*`) has to be implemented twice, or forgotten for Discord.

3. **A provider-name branch resurfaced.** `src/commands/help.ts:67` checks `providerName === 'discord'` to append a "`/context` export is deferred on Discord" note — exactly the anti-pattern the original design was meant to eliminate. It also becomes actively wrong once the `/context` redesign (`docs/superpowers/specs/2026-04-11-context-command-redesign.md`) lands, because that redesign adds a Discord-specific `renderContext()` and makes `/context` work on Discord.

4. **No automated guard against capability/implementation drift.** The mismatches in (1) slipped in because nothing verifies end-to-end that a declared capability is actually reachable without throwing. Every future provider has the same failure mode.

## Goals

1. Make `discordCapabilities` match `DiscordChatProvider`'s real behavior.
2. Route Discord button callbacks through the shared interaction router, symmetric with Telegram.
3. Remove the last provider-name branch in command handlers.
4. Add a Discord-specific capability conformance test suite with a guard that couples the test file to the metadata file.

## Non-Goals

- **Real Discord file send** (`reply.file`). Deferred. The `/context` redesign eliminates the primary caller via `ChatProvider.renderContext` / `reply.embed`.
- **Real Discord file receive** (`msg.files` in `mapDiscordMessage`). Deferred. No existing feature depends on it today.
- **Telegram `observedGroupMessages` trait discrepancy** (`'mentions_only'` in `src/chat/telegram/metadata.ts:14` vs `'all'` in the original design table). Tracked separately.
- **`maxMessageLength` / `callbackDataMaxLength` trait consumption.** Traits are currently cosmetic; reply chunking uses hardcoded constants. Wiring traits into chunking is a cross-provider refactor and belongs in its own spec.
- **Shared cross-provider conformance harness.** Option B from brainstorming Q5. Considered after this pass lands, when there is more than one concrete data point to generalize from.
- **`routeButtonFallback`-style button-as-command UX.** Deleted outright. If ever wanted later, it belongs in the shared router as a new prefix (e.g. `cmd:<name>`) so Telegram and Mattermost get it for free.
- **Plugin `requiredTaskCapabilities` / `requiredChatCapabilities` runtime enforcement.** Phase 4 of the original design. No plugin runtime exists in `src/` yet.
- **Driving env validation from `ChatProviderConfigRequirement`.** Each provider still throws from its constructor on missing env vars. Same pattern as Telegram and Mattermost; fixing Discord alone would be asymmetric.

## Design

### 1. Honest capability declaration

Edit `src/chat/discord/metadata.ts`:

```typescript
// src/chat/discord/metadata.ts
export const discordCapabilities: ReadonlySet<ChatCapability> = new Set<ChatCapability>([
  'interactions.callbacks',
  'messages.buttons',
  'messages.redact', // NEW — impl already exists in reply-helpers.ts:70
  'messages.reply-context',
  'users.resolve',
  // removed: 'messages.files' — reply.file() throws "deferred"
  // removed: 'files.receive' — mapDiscordMessage never populates msg.files
])
```

Delete the `file` entry from `createDiscordReplyFn` in `src/chat/discord/reply-helpers.ts`. Every `reply.file` caller in `src/` already gates on `supportsFileReplies(chat)` (e.g. `src/commands/context.ts:118`), so there is no in-tree caller once `messages.files` is absent from `discordCapabilities`.

**Observable consequences:**

- `/context` on Discord (current implementation) takes the existing `supportsFileReplies(chat) === false` branch and replies `"File replies are not supported in this chat. Context export is unavailable."` — no runtime crash. This path is removed entirely when the `/context` redesign lands.
- `messages.redact` becomes available to any consumer that gates on it (prompt-injection redaction flows, `/clear`-style cleanup).
- `mapDiscordMessage` requires no change — it already ignores files, which is now the advertised behavior.

### 2. Shared interaction router migration

`DiscordChatProvider` registers an `onInteraction` handler and routes button clicks through `src/chat/interaction-router.ts`, symmetric with `TelegramChatProvider`.

**Interface additions on `DiscordChatProvider`:**

```typescript
// src/chat/discord/index.ts
private interactionHandler?: (interaction: IncomingInteraction, reply: ReplyFn) => Promise<void>

onInteraction(handler: (interaction: IncomingInteraction, reply: ReplyFn) => Promise<void>): void {
  this.interactionHandler = handler
}
```

`setupBot` at `src/bot.ts:221` already calls `chat.onInteraction?.(...)` and hands it `routeInteraction`. Once this method exists, wiring is transparent.

**Rewritten `handleButtonInteraction`:**

```typescript
private async handleButtonInteraction(
  rawInteraction: ButtonInteractionLike,
  adminUserId: string,
): Promise<void> {
  try {
    await rawInteraction.deferUpdate()
  } catch (error) {
    log.warn(
      { error: error instanceof Error ? error.message : String(error), customId: rawInteraction.customId },
      'Failed to deferUpdate Discord button interaction',
    )
  }

  const channel = rawInteraction.channel
  if (channel === null) {
    log.warn({ channelId: rawInteraction.channelId }, 'Button interaction: channel not available')
    return
  }

  if (this.interactionHandler === undefined) {
    log.warn({ customId: rawInteraction.customId }, 'No interaction handler registered')
    return
  }

  const interaction = buildDiscordInteraction(rawInteraction, adminUserId)
  const reply = createDiscordReplyFn({ channel, replyToMessageId: undefined })
  await this.interactionHandler(interaction, reply)
}
```

**New helper** `src/chat/discord/interaction-helpers.ts` (mirrors `src/chat/telegram/interaction-helpers.ts`):

```typescript
// src/chat/discord/interaction-helpers.ts
import type { IncomingInteraction } from '../types.js'
import type { ButtonInteractionLike } from './buttons.js'

const CHANNEL_TYPE_DM = 1

export function buildDiscordInteraction(raw: ButtonInteractionLike, adminUserId: string): IncomingInteraction {
  const contextType = raw.channel?.type === CHANNEL_TYPE_DM ? 'dm' : 'group'
  const contextId = contextType === 'dm' ? raw.user.id : raw.channelId
  return {
    kind: 'button',
    user: {
      id: raw.user.id,
      username: raw.user.username.length > 0 ? raw.user.username : null,
      isAdmin: raw.user.id === adminUserId,
    },
    contextId,
    contextType,
    callbackData: raw.customId,
    messageId: raw.message.id,
  }
}
```

**Deletions:**

- `src/chat/discord/handlers.ts` — the `handleConfigEditorCallback` / `handleWizardCallback` copies are superseded by the shared router's `defaultHandleConfigInteraction` / `defaultHandleWizardInteraction` (`src/chat/interaction-router.ts:15`, `:89`).
- `dispatchButtonInteraction` in `src/chat/discord/buttons.ts`. The prefix-routing logic now belongs to `interaction-router.ts`. `isButtonInteraction` (the runtime type guard) and `toActionRows` (the discord.js `ActionRow` builder) stay — they're Discord-native concerns with no equivalent in the shared router.
- `routeButtonFallback` and its call from `handleButtonInteraction` in `src/chat/discord/index.ts:214`. No known caller emits non-`cfg:`/non-`wizard_` custom-ids; verification step below confirms this before deletion.

**Risk mitigation: is `routeButtonFallback` dead?**

Before deleting, add a `log.warn('routeButtonFallback hit', { customId })` on the first line of `routeButtonFallback` and run `bun test`. If the warn never fires, the path is dead and can be removed. If it fires, convert the caller to emit a proper `cfg:*` / `wizard_*` (or newly introduced `cmd:*`) callback **before** deletion — do not merge the deletion with a live caller in the tree.

### 3. Drop the provider-name help note

Edit `src/commands/help.ts`:

```typescript
export function buildHelpText(contextType: ContextType, opts: { isBotAdmin: boolean; isGroupAdmin: boolean }): string {
  return contextType === 'dm' ? getDmHelpText(opts.isBotAdmin) : getGroupHelpText(opts.isGroupAdmin)
}
```

The `providerName` parameter is removed from `buildHelpText` and its call site at `src/commands/help.ts:78`. The `if (providerName === 'discord' && opts.isBotAdmin)` branch is deleted.

**Rationale.** The note warned admins that `/context` would fail on Discord. The `/context` redesign adds `ChatProvider.renderContext()` with a Discord renderer returning `{ method: 'embed' }`, making `/context` supported on Discord. Removing the note now prevents a stale-note regression window when the redesign lands. The `/context` command continues to emit `"File replies are not supported in this chat. Context export is unavailable."` at runtime on Discord in the meantime, which is sufficient warning.

### 4. Discord capability conformance test suite

New file `tests/chat/discord/capability-conformance.test.ts`. For every string in `discordCapabilities`, a dedicated test drives the relevant entry point on a real `DiscordChatProvider` (using `testSetClient` / `testDispatchButtonInteraction` — the existing test hooks) against in-memory fakes and asserts the declared behavior works end-to-end.

**Structure:**

```typescript
// tests/chat/discord/capability-conformance.test.ts
import { describe, test, expect } from 'bun:test'

import { discordCapabilities } from '../../../src/chat/discord/metadata.js'
import type { ChatCapability } from '../../../src/chat/types.js'

// Every declared capability MUST have a test here. The guard test below
// enforces that `covered` and `discordCapabilities` are in perfect sync.
const covered: Record<ChatCapability, boolean> = {
  'interactions.callbacks': true,
  'messages.buttons': true,
  'messages.redact': true,
  'messages.reply-context': true,
  'users.resolve': true,
  'commands.menu': false, // shrunk — must NOT appear in discordCapabilities
  'messages.files': false, // shrunk
  'files.receive': false, // shrunk
}

describe('Discord capability conformance', () => {
  test('messages.buttons: reply.buttons emits an ActionRow', async () => {
    /* ... */
  })
  test('messages.redact: reply.redactMessage edits last sent message', async () => {
    /* ... */
  })
  test('messages.reply-context: mapDiscordMessage populates replyContext for replies', async () => {
    /* ... */
  })
  test('interactions.callbacks: button interaction reaches onInteraction handler', async () => {
    /* ... */
  })
  test('users.resolve: resolveUserId returns a guild member id for @username', async () => {
    /* ... */
  })

  test('covered record matches discordCapabilities exactly', () => {
    const declared = [...discordCapabilities].sort()
    const expected = Object.entries(covered)
      .filter(([, isCovered]) => isCovered)
      .map(([cap]) => cap)
      .sort()
    expect(declared).toEqual(expected)
  })
})
```

**The guard test is load-bearing.** It couples the test file to the metadata file. Three failure modes it catches:

| Scenario                                                                      | Guard response                                                                                             |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Someone adds `messages.files` to `discordCapabilities` without writing a test | Guard fails: `declared` contains `messages.files`, `covered` doesn't.                                      |
| Someone writes a conformance test but forgets to advertise the capability     | Guard fails: `covered` has it, `declared` doesn't.                                                         |
| Someone adds a new `ChatCapability` string to the union                       | `covered` is typed `Record<ChatCapability, boolean>`, so TypeScript errors because the new key is missing. |

**Fakes.** `tests/chat/discord/fakes.ts` — shared fixtures for `DiscordClientLike`, `ButtonChannelLike`, `ButtonInteractionLike`, `DispatchableMessage`, `GuildLike`. Existing discord tests already construct these ad-hoc; this file consolidates them so the conformance suite and existing tests draw from one source.

**What this suite does NOT test** (explicitly, so reviewers don't expand scope):

- Network traffic to Discord. All fakes are in-memory.
- Cross-provider symmetry (Telegram and Mattermost are out of scope for this pass).
- Interaction routing logic itself — that belongs to `tests/chat/interaction-router.test.ts`. This suite only verifies Discord's _translation layer_ hands the router a well-formed `IncomingInteraction`.

## Rollout Plan

Four independently shippable steps. Order is chosen to minimize the window where declarations and implementation disagree, and to keep each commit cleanly revertable.

### Step 1 — Shrink declarations

- Edit `src/chat/discord/metadata.ts` (remove `messages.files`, `files.receive`; add `messages.redact`).
- Delete the `file` key from `createDiscordReplyFn` in `src/chat/discord/reply-helpers.ts`.
- Update any existing test that asserted the old capability set.

After this commit: `/context` on Discord responds with the "unavailable on this provider" text path instead of crashing. This is the user-visible fix.

### Step 2 — Shared interaction router migration

- Add `interactionHandler` field + `onInteraction` method on `DiscordChatProvider`.
- Add `src/chat/discord/interaction-helpers.ts` with `buildDiscordInteraction`.
- Rewrite `DiscordChatProvider.handleButtonInteraction` per Section 2.
- Run the dead-path probe on `routeButtonFallback` (`log.warn` + full test suite). If clean, delete `routeButtonFallback` and its call. If not, fix the caller first, then delete.
- Delete `src/chat/discord/handlers.ts` and `src/chat/discord/buttons.ts:dispatchButtonInteraction`.
- Delete `tests/chat/discord/handlers.test.ts`.
- Update `tests/chat/discord/index.test.ts`: remove `routeButtonFallback` cases, add an `onInteraction` dispatch assertion.

### Step 3 — Drop the help-text branch

- Remove `providerName` parameter from `buildHelpText` in `src/commands/help.ts`; delete the branch; update the call site.
- Update `tests/commands/help.test.ts` to drop the Discord-note assertion and fix the call signature.

### Step 4 — Conformance suite

- Add `tests/chat/discord/fakes.ts` (or refactor existing test fixtures into it).
- Add `tests/chat/discord/capability-conformance.test.ts` per Section 4.
- Ensure the guard test passes against the state from Step 1.

Steps 1, 2, 3 each commit independently. Step 4 commits last because the guard test pins the final shape of `discordCapabilities`.

## Verification Checklist

Each step boundary must satisfy the following before commit:

- `bun run check:full` passes.
- Grep guards return empty / expected:
  - `rg -n "providerName === '(discord|telegram|mattermost)'" src` → empty.
  - `rg -n "messages\\.files" src/chat/discord` → empty or comments only.
  - `rg -n "from '\\./handlers'" src/chat/discord` → empty (after Step 2).
  - `rg -n "routeButtonFallback" src` → empty (after Step 2).
  - `rg -n "reply\\.file\\(" src` — every remaining hit is inside a `supportsFileReplies(chat)` branch.
- After Step 4, `bun test tests/chat/discord/capability-conformance.test.ts` passes and contains at least one test case per entry in `discordCapabilities`; the guard test passes.

## Implementation Changes

| File                                                | Change                                                                                                                                                         |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/chat/discord/metadata.ts`                      | Remove `messages.files`, `files.receive`; add `messages.redact`                                                                                                |
| `src/chat/discord/reply-helpers.ts`                 | Delete the `file` entry from `createDiscordReplyFn`                                                                                                            |
| `src/chat/discord/index.ts`                         | Add `interactionHandler` + `onInteraction`; rewrite `handleButtonInteraction`; delete `routeButtonFallback` and its call; keep `testDispatchButtonInteraction` |
| `src/chat/discord/interaction-helpers.ts`           | **New.** `buildDiscordInteraction(raw, adminUserId): IncomingInteraction`                                                                                      |
| `src/chat/discord/handlers.ts`                      | **Delete.** Superseded by `src/chat/interaction-router.ts`                                                                                                     |
| `src/chat/discord/buttons.ts`                       | Delete `dispatchButtonInteraction`; keep `isButtonInteraction`, `toActionRows`, type exports                                                                   |
| `src/commands/help.ts`                              | Drop `providerName` parameter from `buildHelpText` and its call site; delete the Discord branch                                                                |
| `tests/chat/discord/fakes.ts`                       | **New** (or consolidated from existing). Shared fake fixtures for conformance and existing tests                                                               |
| `tests/chat/discord/capability-conformance.test.ts` | **New.** Per-capability tests + guard                                                                                                                          |
| `tests/chat/discord/handlers.test.ts`               | **Delete** with `src/chat/discord/handlers.ts`                                                                                                                 |
| `tests/chat/discord/index.test.ts`                  | Remove `routeButtonFallback` cases; add `onInteraction` dispatch case                                                                                          |
| `tests/commands/help.test.ts`                       | Drop Discord-note assertion; update call signature                                                                                                             |

## Follow-Up Work (Not in This Design)

1. Real Discord `reply.file` send and `mapDiscordMessage.files` ingest — driven by an actual caller requirement.
2. Telegram `observedGroupMessages` trait discrepancy with the original design table.
3. `maxMessageLength` / `callbackDataMaxLength` trait wiring into reply chunking across all providers.
4. Shared cross-provider capability conformance harness (generalization of Section 4).
5. `ChatProviderConfigRequirement`-driven env validation replacing each provider's constructor throw.
6. Plugin `requiredTaskCapabilities` / `requiredChatCapabilities` runtime enforcement and the `incompatible` plugin state — Phase 4 of the original provider capability design, blocked on the plugin runtime landing in `src/`.
